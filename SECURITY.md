# DataShare — Sécurité

Document vivant, écrit au fil de l'implémentation (voir `docs/design-decisions.md`,
prémisse 3) : chaque section ne décrit que ce qui est réellement construit et
vérifié, pas ce qui est planifié. Les contrôles non encore livrés sont listés
en fin de document avec le chantier qui les porte.

> **Convention** : comme dans `docs/documentation-technique.md`, une section
> commençant par un contrôle déjà en place est démontrable ; une section
> **À VENIR** ne l'est pas encore.

---

## Téléversement — validation à l'initiation et à la complétion

### Liste noire d'extensions

Refusée dès `POST /files/uploads` (`src/files/upload.constants.ts`), avant tout
appel à `CreateMultipartUpload` :

```
.exe .bat .cmd .com .scr .msi .ps1 .vbs .js .jar .sh .dll .app .docm .xlsm .pptm .iso .lnk
```

Couvre les formats exécutables Windows/Unix usuels et les formats Office à
macros. Ce n'est **pas** un contrôle de contenu : un exécutable renommé en
`.pdf` passe cette étape. Le contenu réel est vérifié plus tard, par le
worker de validation (voir « Analyse post-téléversement » ci-dessous).

### Taille : deux contrôles distincts, aucun ne fait confiance au client

Mesuré expérimentalement avant l'écriture du code (voir `docs/design-decisions.md`,
section « The Assignment ») : une URL `PUT` pré-signée **ne contraint pas**
`Content-Length`. Un client déclarant 1 Mio a poussé 25 Mio à travers une seule
URL signée, accepté sans erreur. La taille déclarée à l'initiation n'est donc
pas un contrôle réel — `HeadObject` après `CompleteMultipartUpload` est le
seul point où la taille effective est connue avec certitude.

Deux vérifications indépendantes s'y font (`FilesService.completeUpload`) :

1. **Plafond absolu** — taille réelle > 1 Gio → objet supprimé, ligne passée
   à `rejected`, `413` renvoyé. Vrai quelle que soit la taille déclarée.
2. **Correspondance déclarée/réelle** — taille réelle ≠ taille déclarée à
   l'initiation → objet supprimé, ligne passée à `rejected`, `400` renvoyé.
   Un client honnête produit toujours un objet de taille strictement égale à
   ce qu'il a annoncé ; tout écart (au-dessus **ou** en dessous) est refusé.

Dans les deux cas, l'objet est supprimé du stockage et la ligne `File`
n'est **jamais** promue au-delà de `rejected` — impossible d'obtenir un lien
de téléchargement pour un objet qui a échoué ce contrôle.

## Analyse post-téléversement : la barrière du produit

Un `CompleteMultipartUpload` réussi ne rend **pas** le fichier téléchargeable.
La ligne passe à `uploaded`, un job est mis en file (BullMQ/Redis), et c'est
un **worker séparé** (conteneur `worker`, sans serveur HTTP) qui décide
ensuite de `ready` ou `rejected`. Un lien ne résout que dans `ready` : un
fichier refusé n'a donc jamais eu de lien partageable, même brièvement.
C'est aussi pourquoi `POST /files/uploads/:id/complete` ne renvoie **aucun
jeton** — l'expéditeur le récupère via `GET /files/uploads/:id/status`, qui
ne l'inclut que dans l'état `ready`.

Le worker **pose** `scanning` au démarrage du job au lieu de simplement lire
l'état. C'est ce qui rend un worker mort détectable : une ligne bloquée en
`scanning` au-delà de 15 minutes est remise en file par un balayage horaire.
Sans ça, un worker tué en plein scan laisserait un lien qui ne résoudrait
jamais, sans que personne ne sache pourquoi.

### Deux étapes, et la distinction est une décision de conception

1. **Octets magiques — lecture par plage.** `GetObject` avec
   `Range: bytes=0-63` : une signature de fichier tient dans les premiers
   octets. Si l'extension déclarée est connue de la table de signatures et
   que les octets la contredisent (un `.pdf` dont les octets disent `MZ`),
   le fichier est refusé **sans que l'objet soit jamais lu entièrement**.
   Une extension inconnue de la table n'est jamais refusée sur ce critère :
   on ne prétend pas savoir vérifier ce qu'on ne sait pas vérifier.
2. **ClamAV — objet complet, sous le plafond de 50 Mo uniquement.** La
   lecture complète n'a lieu que dans la branche qui appelle réellement le
   scanner.

**Pourquoi cet ordre compte.** Une lecture complète inconditionnelle
extrairait un gigaoctet de MinIO même pour les fichiers que le scanner
ignore ensuite, ce qui annulerait exactement l'économie que le plafond
existe pour produire. Coût réel de validation d'un fichier de 1 Go : 64
octets, pas 1 Go.

Dans les deux cas de refus, l'objet est supprimé du stockage et
`storage_key` est mis à `NULL` : la ligne subsiste pour l'historique, mais
plus rien n'est récupérable.

### Limite assumée : le plafond de 50 Mo

Au-delà de 50 Mo, **le fichier passe en `ready` sans analyse antivirale**, et
c'est écrit ici plutôt que caché. La limite de flux par défaut de `clamd` est
très inférieure à 1 Go, et scanner un fichier de taille pleine obligerait le
worker à extraire l'objet entier de MinIO — ce qui casserait la propriété
« l'API ne touche jamais les octets » à la frontière du worker. Le contrôle
d'octets magiques, lui, s'applique à **tous** les fichiers quelle que soit
leur taille. Risque résiduel : un fichier de plus de 50 Mo dont l'extension
est cohérente avec ses octets n'est pas analysé.

## Authentification

Mot de passe haché avec **bcrypt** (coût 10, salage inclus par construction),
jamais stocké ni journalisé en clair. La connexion compare systématiquement
contre un hachage factice quand l'email est inconnu, pour que le coût bcrypt
soit payé sur les deux branches : sans ça, l'écart de latence entre « email
inconnu » et « mot de passe faux » trahirait l'existence d'un compte malgré un
message d'erreur identique (`src/auth/auth.service.ts`).

Aucun rôle ni permission : le seul contrôle d'autorisation est la
**propriété**. Voir la section suivante.

## Anti-oracle : propriété d'un fichier

Toutes les routes `files/uploads/*` filtrent par `(id, ownerId)`
(`FilesService.findPendingUpload`). Un identifiant inexistant et un
identifiant appartenant à un autre utilisateur renvoient exactement la même
réponse — `404`, jamais `403` — pour qu'aucune route ne permette de sonder
l'existence d'un fichier appartenant à quelqu'un d'autre.

## Identifiants de stockage : ne quittent jamais le serveur

Le client ne reçoit jamais l'`UploadId` S3 réel ni les identifiants d'accès au
bucket. Les réponses de l'API exposent uniquement `fileId` (l'identifiant
interne de la ligne `File`) ; l'`UploadId` S3 reste en base, côté serveur, et
n'est utilisé que dans les appels serveur → MinIO (`StorageService`).

## Jeton de téléchargement

128 bits d'entropie (`crypto.randomBytes(16).toString('base64url')`, 22
caractères), généré à l'initiation mais gardé côté serveur jusqu'à `complete`
— le renvoyer plus tôt créerait un quatrième cas indistinguable des trois
réponses volontairement identiques de `GET /d/:token` (voir plus bas).
Volontairement pas un UUID : un UUID v7 embarque un horodatage, ce qui
rendrait le jeton partiellement prévisible.

## Téléchargement : le destinataire n'est pas authentifié

La seule autorisation d'accès à un fichier est la possession du jeton dans
l'URL (`GET /d/:token`, `POST /d/:token`). Aucune session, aucun compte requis
côté destinataire. Trois conséquences, toutes assumées et implémentées :

1. **`Content-Disposition: attachment` et `Content-Type: application/octet-stream`
   forcés sur chaque URL signée** (`StorageService.signDownloadUrl`), quel que
   soit le type réel du fichier. Sans ça, un `.html` ou `.svg` téléversé
   s'exécuterait dans le navigateur depuis l'origine du bucket — un XSS
   stocké que ni la liste noire d'extensions ni un futur contrôle d'octets
   magiques n'attrapent. Vérifié en navigateur réel : un fichier nommé pour
   contenir des caractères de balisage se télécharge comme texte brut, jamais
   interprété.
2. **Réponses volontairement identiques.** Jeton inconnu, fichier `rejected`
   et fichier `abandoned` renvoient exactement le même `404` et le même
   message (`DownloadService.resolveToken`). Les distinguer transformerait la
   page en oracle permettant de sonder quels jetons ont existé. Seul `expired`
   fait exception (`410`, message dédié) : le destinataire détenait déjà le
   lien, donc dire que le fichier a expiré ne révèle rien de nouveau.
3. **La date d'expiration est revérifiée à chaque requête**, indépendamment de
   l'état stocké : une ligne encore `ready` mais dont `expiresAt` est dépassé
   est traitée comme expirée, sans attendre le passage de la purge planifiée
   (US10, à venir). Sinon la fenêtre entre l'expiration réelle et le prochain
   passage du job laisserait le fichier téléchargeable.

L'URL de téléchargement elle-même est signée pour **60 secondes** — consommée
immédiatement par le navigateur, pas de fenêtre d'exploitation prolongée si
l'URL fuit (log, historique partagé, etc.).

## Scan de dépendances

`npm audit`, back et front, à chaque modification de `package.json` et avant
chaque livraison. État courant (2026-08-29) :

| Paquet | Sévérité | Chemin | Décision |
|---|---|---|---|
| `deepmerge-ts` < 8.0.0 ([GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx), épuisement de pile sur un graphe récursif) | Haute (×3, même CVE compté par `npm audit` à chaque niveau de la chaîne) | `prisma` (devDependency, CLI) → `@prisma/config` → `deepmerge-ts` | **Acceptée** |

**Pourquoi acceptée plutôt que corrigée.** `npm ls deepmerge-ts` confirme un
seul chemin, entièrement dans `prisma`, le CLI utilisé en développement pour
`generate`/`migrate` — jamais `@prisma/client`, la dépendance réellement
importée par le code applicatif en production. Le code vulnérable n'est donc
ni présent ni atteignable dans le conteneur `api` qui tourne réellement ; il
ne s'exécute que sur la machine d'un développeur, sur un schéma Prisma local
et fiable, jamais sur une entrée venant d'un utilisateur. Le correctif
proposé (`npm audit fix --force`) rétrograderait `prisma` vers `6.12.0` —
un changement cassant pour un outil épinglé et activement utilisé, en échange
d'une vulnérabilité non atteignable. `npm audit --omit=dev` la fait
apparaître malgré tout (limite connue de son calcul des devDependencies
transitives), donc noter ici que c'est délibéré plutôt que de laisser croire
à une exposition en production.

Front : `npm audit` — **0 vulnérabilité**.

---

## À venir (chantiers identifiés, pas encore livrés)

| Contrôle | Chantier | Note |
|---|---|---|
| Limitation de débit (Redis) sur `/auth/login` et `GET/POST /d/:token` | — | Non câblée, et c'est désormais la lacune la plus exposée : SOC-05 étant livré, `GET /d/:token` **est** réellement interrogé toutes les 2 s pendant l'attente de scan, donc c'est à la fois une surface de sondage de jetons et la cible du test de charge. Le compteur de tentatives affiché sur la page destinataire (`RecipientPage`) est **purement côté client** : aucun verrou serveur, un attaquant qui recharge la page repart de zéro |
| Mot de passe optionnel sur le lien de téléchargement | US09 | Le contrôle existe déjà côté téléchargement (`DownloadService.verifyPasswordAndGetUrl`) ; US09 couvre la définition du mot de passe côté envoi |
