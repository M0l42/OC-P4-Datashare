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
2. **ClamAV — objet complet, sous le plafond de 1 Go uniquement.** La
   lecture complète n'a lieu que dans la branche qui appelle réellement le
   scanner.

**Pourquoi cet ordre compte.** Une lecture complète inconditionnelle
extrairait l'objet de MinIO même pour les fichiers que le scanner ignore
ensuite, ce qui annulerait exactement l'économie que le plafond existe pour
produire. Coût réel de validation d'un fichier de 5 Go : 64 octets, pas 5 Go.

Dans les deux cas de refus, l'objet est supprimé du stockage et
`storage_key` est mis à `NULL` : la ligne subsiste pour l'historique, mais
plus rien n'est récupérable.

### Le plafond de scan, et pourquoi il ne laisse plus de trou

Le plafond de scan (`CLAMAV_MAX_SCAN_BYTES`) vaut **1 Gio, exactement la même
valeur que le plafond d'envoi** (`MAX_FILE_SIZE_BYTES`). Les deux constantes
sont identiques à l'octet près, et le plafond d'envoi est appliqué deux fois :
sur la taille déclarée à l'initiation, puis sur la taille réelle via
`HeadObject` après complétion — un objet trop gros est supprimé du stockage et
la ligne passe en `rejected`.

**Conséquence : aucun fichier stocké ne peut dépasser le plafond de scan, donc
tout fichier accepté est analysé.** Il n'y a plus de risque résiduel de fichier
non scanné, là où la version précédente de ce document en documentait un (le
plafond était alors à 50 Mo).

La branche `sizeBytes > CLAMAV_MAX_SCAN_BYTES` de `validation.service.ts`
subsiste, mais elle est **inatteignable en l'état**. Elle est conservée
volontairement, comme garde-fou : si `MAX_FILE_SIZE_BYTES` était un jour relevé
sans que `CLAMAV_MAX_SCAN_BYTES` le soit, le service continuerait de livrer des
fichiers en `ready` plutôt que d'échouer — le trou se rouvrirait alors
silencieusement. **Les deux constantes doivent être modifiées ensemble**, et
`infra/clamav/clamd.conf` avec elles.

Le contrôle d'octets magiques, lui, s'applique de toute façon à **tous** les
fichiers quelle que soit leur taille, et s'exécute avant le scan.

Ce plafond n'est pas une limite technique de `clamd` (ses propres limites,
`StreamMaxLength`/`MaxFileSize`/`MaxScanSize` dans `infra/clamav/clamd.conf`,
sont réglées à 1200 Mo — au-dessus, pas en dessous, pour ne jamais être la
cause du rejet) : c'est un choix de coût et de latence pour le worker, qui
extrait bien l'objet entier de MinIO pour le scanner — cette extraction ne
casse aucune propriété de l'API elle-même, qui n'y participe jamais ; c'est
précisément pour ça que le scan tourne dans un conteneur séparé.

Configuration effective confirmée en direct sur le conteneur (`clamdscan --version`
donne ClamAV 1.5.4, `clamconf -n` donne la configuration réellement chargée par
le démon, pas seulement ce que le fichier déclare) :

```
$ docker compose exec clamav clamconf -n | grep -iE 'StreamMaxLength|MaxFileSize|MaxScanSize'
StreamMaxLength = "1258291200"
MaxScanSize = "1258291200"
MaxFileSize = "1258291200"
```

1 258 291 200 octets = 1200 Mio, les trois alignées, aucune n'a été oubliée
lors du dernier réglage de `clamd.conf`. Leurs valeurs par défaut respectives
(100 Mo, 100 Mo, 400 Mo d'après `clamd.conf.sample`, non égales entre elles)
n'ont donc plus cours ici : c'est la configuration ci-dessus, pas le vendor
default, qui s'applique réellement.

**Mesuré, pas supposé** (`clamdscan --stream` en local, 2026-09-05, **3
exécutions par scénario avec un fichier neuf à chaque run**, pour éliminer
tout effet de cache disque) : un fichier sain de 1000 Mo scanne en 40,7 à
46,5 s (médiane 42,1 s). Un fichier de test avec une signature à l'octet
**final** d'un fichier de ~950 Mo est détecté en 38,7 à 39,4 s (médiane
39,3 s), dans le même ordre de grandeur que le scénario sain : cohérent avec
un flux INSTREAM qui doit être entièrement reçu avant verdict, quel que soit
le résultat.

**Une première mesure (2026-08-30, un seul run par scénario, même fichier
relu d'un essai à l'autre) avait montré un écart d'un facteur deux (74,7 s
contre 37,2 s)**, qui semblait dépendre du contenu du fichier. Cet écart
disparaît avec un fichier neuf à chaque run : il s'expliquait par un effet de
cache page (un fichier déjà lu une première fois se rescanne depuis le cache
mémoire, pas depuis le disque), pas par un comportement de `clamd` sensible
au contenu. Pic CPU et mémoire du conteneur `clamav` observés sur cette
première mesure (environ 175 % et 1,0 à 1,2 Gio), non répétés lors de la
seconde série.

(Le premier essai de détection avait utilisé le fichier de test EICAR
standard en préfixe d'un gros fichier, et donnait un faux négatif : pas un
vrai trou de détection, la signature EICAR de ClamAV est un hash du fichier
entier à 68 octets exacts, pas un motif recherché dans le contenu, donc
n'importe quel ajout après elle la fait échouer à toute taille, y compris
1 Mo. Une signature de test locale en recherche de sous-chaîne, elle, détecte
correctement, et c'est celle utilisée pour les deux séries de mesures
ci-dessus.)

`ClamAvClient`'s `SOCKET_TIMEOUT_MS` (`backend/src/scan/clamav.client.ts`) est
fixé à 180 s, une marge large au-dessus des 40 à 46 s mesurés ci-dessus,
choisie par prudence plutôt qu'en réaction à un dépassement réellement
observé : un timeout trop serré transformerait un scan sain mais lent en faux
rejet côté client, sans que `clamd` lui-même n'ait signalé quoi que ce soit
d'anormal.

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

## Limitation de débit

Ajoutée le 2026-09-04, en réponse directe au relevé ci-dessus : le jeton de
téléchargement n'a de valeur que si la surface de sondage qui l'entoure est
bornée. Stockage **Redis** (`ThrottlerStorageRedisService`, connexion dédiée,
distincte de celle de BullMQ), donc partagé entre les réplicas de l'API
(`docker-compose.yml`) : un compteur en mémoire locale n'aurait rien empêché,
puisqu'un client aurait pu épuiser sa limite sur un réplica et repartir à
zéro sur le suivant au tour de répartition HAProxy suivant.

| Route | Limite | Fenêtre | Clé |
|---|---|---|---|
| `POST /auth/login` | 10 requêtes | 60 s | IP |
| `POST /auth/register` | 10 requêtes | 60 s | IP |
| `GET /d/:token` | 60 requêtes | 120 s | jeton |
| `POST /d/:token`, fichier avec mot de passe | 6 requêtes | 120 s | jeton |
| `POST /d/:token`, fichier sans mot de passe | aucune (au-delà de la limite par IP ci-dessous) | n/a | n/a |
| `GET`/`POST /d/:token` | 100 requêtes | 60 s | IP |

`GET` et `POST` sur `/d/:token` avaient initialement un compteur `dlToken`
commun. Le relever de 40 à 60 pour laisser de la marge au polling (voir
ci-dessous) relevait dans le même mouvement le budget de tentatives de mot de
passe testables, sans rapport avec la raison du changement. Les deux verbes
ont maintenant des compteurs indépendants (`throttler.module.ts`) : `dlToken`
(`GET` seul) suit le polling, `dlTokenPassword` (`POST`) protège
spécifiquement les mots de passe.

**`POST /d/:token` n'est pas la route des tentatives de mot de passe, c'est
la route de tout clic sur Télécharger, avec ou sans mot de passe.** `GET` ne
rend plus jamais d'URL de téléchargement, même pour un fichier sans mot de
passe : la signer au chargement de la page donnerait une capacité de
téléchargement à tout ce qui charge la page sans qu'un humain ait cliqué
(robot d'indexation, aperçu de lien Slack/WhatsApp, scanner antivirus). La
signature n'a lieu que sur ce `POST`, déclenché par le clic. Régression
trouvée et corrigée pendant cette relecture : le code livrait initialement
l'URL directement dans la réponse `GET` quand le fichier n'avait pas de mot
de passe, contredisant le diagramme 5 qui avait posé cette règle dès le
départ.

Appliquer le même plafond de 6/2 min à un `POST` sans mot de passe
pénaliserait une reprise légitime (connexion coupée, rechargement) sans rien
protéger : il n'y a rien à brute-forcer sur un fichier qui n'a pas de secret.
`DownloadThrottlerGuard` (`download-throttler.guard.ts`) résout ça en
surchargeant `handleRequest` : avant d'appliquer `dlTokenPassword`, il
vérifie si le fichier référencé par le jeton a réellement un `passwordHash`
; sinon, ce compteur est entièrement court-circuité pour cette requête,
`dlToken`/`dlIp` restent les seules limites.

`dlToken` à 60/120 s : le destinataire légitime interroge sa propre page
toutes les 2 s pendant les 30 premières secondes de l'attente de scan, puis
toutes les 5 s jusqu'à l'abandon à 2 minutes (`usePollUntil.ts`), soit 15
requêtes à 2 s puis 18 à 5 s, **~34 au total** avec la requête initiale ; 60
laisse une marge large sans avoir à absorber autre chose. Cette marge assume
une seule session de polling par fenêtre de 2 minutes : un rechargement de
page réinitialise l'état côté client (`RecipientPage` recommence son cycle
de polling) mais pas le compteur Redis, qui continue depuis l'appel du
destinataire précédent. Deux rechargements complets pendant l'attente d'un
fichier proche du plafond (~34 requêtes chacun) peuvent dépasser 60 et
produire un 429 sur un usage légitime. Compromis assumé plutôt que corrigé :
la fonction du compteur est de borner le sondage, pas de garantir un nombre
de rechargements arbitraire, et un destinataire qui recharge deux fois en
moins de 2 minutes reste un cas marginal face au brute-force qu'il borne.

`dlTokenPassword` à 6/120 s, uniquement quand le fichier a un mot de passe :
un mot de passe de 6 caractères minimum sans verrouillage ni backoff
applicatif n'a que ce compteur comme rempart contre le brute-force. Le
compteur par IP (100 sur 60 s) attrape en parallèle le sondage de plusieurs
jetons différents depuis une même origine, sans jamais pénaliser un seul
destinataire légitime. Vérifié en direct contre la pile réelle (deux fichiers
distincts, un avec mot de passe et un sans) : sur le fichier protégé, 6
`POST` avec un mauvais mot de passe renvoient `401`, le 7e renvoie `429` ;
sur le fichier sans mot de passe, 8 `POST` consécutifs renvoient tous `200`,
aucun `429`. Un jeton neuf interrogé juste après l'épuisement du compteur
`dlToken` ou `dlTokenPassword` d'un autre jeton renvoie toujours `404`,
jamais `429`.

**Le compteur de tentatives affiché sur `RecipientPage` reste indicatif côté
client**, mais n'est plus la seule ligne de défense : la limite serveur
ci-dessus s'applique indépendamment de ce que l'interface affiche ou de l'état
du navigateur (recharger la page ne réinitialise plus rien côté serveur).

Couverture de test : suite unitaire complète (125/125 : 122 issus des
changements précédents plus 3 pour `DownloadThrottlerGuard`, voir ci-dessus),
suite d'intégration (37/37 : 36 précédents plus un test qui envoie 8 `POST`
sans mot de passe et vérifie l'absence de tout `429`). Un fichier de tests
d'intégration dédié à
cette fonctionnalité (`backend/test/throttler.e2e-spec.ts`) existe mais est
actuellement **désactivé** (`describe.skip`) : la simulation de 100+ requêtes
concurrentes dans le même processus Jest s'est heurtée à des limites
d'infrastructure de test (connexions réinitialisées, cycle de vie de la
connexion Redis du service de stockage) plutôt qu'à un défaut du mécanisme
lui-même, déjà vérifié manuellement contre la pile réelle (résultats
ci-dessus). À stabiliser avant la prochaine itération plutôt que laissé pour
compte.

## En-têtes de sécurité

`helmet` sur l'API (`main.ts`) : HSTS, `X-Content-Type-Options`,
`X-Frame-Options`, `X-DNS-Prefetch-Control`, `X-Download-Options`,
`X-Permitted-Cross-Domain-Policies`, `Cross-Origin-Opener-Policy`,
`Cross-Origin-Resource-Policy`, `Origin-Agent-Cluster`, confirmés en direct
sur `/api/health`. CSP explicitement **désactivée** : cette API ne rend aucun
HTML elle-même (le front est servi séparément par nginx) ; la politique par
défaut d'helmet casserait le script inline de Swagger UI, servi par cette
même API à `/api/docs`, pour une protection qui ne s'applique à aucune page
que cette API rend.

**`helmet` ne couvre que l'API.** L'origine qui rend le HTML et détient le
JWT en `localStorage` est celle servie par `nginx` (`infra/nginx/nginx.conf`),
une origine différente, sans en-tête de sécurité jusqu'ici. Ajouté sur la
`location /` qui sert le front, pas au niveau `server` : `X-Frame-Options:
DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy:
strict-origin-when-cross-origin`. Portés par cette `location` seule pour ne
jamais dupliquer ceux que `helmet` pose déjà sur `/api/` (nginx n'hérite les
`add_header` du bloc `server` que pour les `location` qui n'en déclarent
aucun des leurs). Vérifié en direct : `curl` sur `/` renvoie les trois
nouveaux en-têtes, `curl` sur `/api/health` renvoie toujours exactement les
en-têtes `helmet`, sans doublon. Pas de CSP complète : Vite en développement a
besoin d'`eval` pour le HMR, et l'URL publique de MinIO que le front appelle
est un réglage de déploiement, pas une valeur fixe qu'une CSP contraignant
`script-src` ou `connect-src` pourrait déclarer ici sans risquer de casser
l'un des deux environnements sans l'avoir testé contre les deux. Trois
directives qui ne dépendent d'aucun des deux sont posées quand même :
`object-src 'none'`, `base-uri 'self'`, `form-action 'self'` (vérifiées en
direct sur `/`, sans effet sur `/api/`). Le reste (`script-src`,
`connect-src`) reste un gap reconnu, pas résolu.

## Journalisation

**`nestjs-pino`**, JSON structuré, corrélé par un identifiant de requête
généré automatiquement pour chaque appel (`app.module.ts`). Les en-têtes
`Authorization` et `Cookie`, ainsi que `req.body.password`, sont explicitement
**exclus** des journaux (`redact`, censurés par `[redacted]`) : même en cas de
bug applicatif qui logguerait le corps ou les en-têtes d'une requête, un JWT
ou un mot de passe ne peut pas finir en clair dans les logs de l'API.

**Le jeton de `/d/:token` est masqué à deux endroits**, pas un seul : dans les
logs applicatifs (`serializers.req` personnalisé dans `app.module.ts`, qui
remplace le jeton par `[redacted]` dans `req.url` avant écriture) et dans
l'accès nginx (`map $request_uri $logged_uri` dans `infra/nginx/nginx.conf`,
même logique). Aucune URL pré-signée MinIO ne peut, elle, apparaître dans ces
journaux : elle n'est jamais transmise en paramètre d'une requête vers nginx
ou l'API, seulement retournée dans un corps de réponse JSON, et ni pino-http
ni la configuration nginx ne journalisent les corps de réponse.

## Scan de dépendances

`npm audit`, back et front, à chaque modification de `package.json` et avant
chaque livraison. État courant (2026-09-04, re-exécuté avant le rendu final,
remplace le relevé du 2026-08-29) :

| Paquet | Sévérité | Chemin | Décision |
|---|---|---|---|
| `deepmerge-ts` < 8.0.0 ([GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx), épuisement de pile sur un graphe récursif) | Haute (×3, même CVE compté par `npm audit` à chaque niveau de la chaîne) | `prisma` (devDependency, CLI) → `@prisma/config` → `deepmerge-ts` | **Acceptée** |
| `fast-uri` < 3.1.6 (4 avis : [GHSA-5jgf-p345-68v8](https://github.com/advisories/GHSA-5jgf-p345-68v8), [GHSA-f65p-4m7j-42xc](https://github.com/advisories/GHSA-f65p-4m7j-42xc), [GHSA-fph4-wmhf-6fwf](https://github.com/advisories/GHSA-fph4-wmhf-6fwf), [GHSA-jqff-g426-hqxp](https://github.com/advisories/GHSA-jqff-g426-hqxp), confusion d'hôte / SSRF sur normalisation IDN et IPv6) | Haute (×4) | `@nestjs/cli` / `@nestjs/schematics` (devDependencies, CLI de build) → `@angular-devkit/core` → `ajv` → `fast-uri` | **Acceptée** |
| `qs` ([GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx), [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g), contournement de limite de tableau / déni de service) | Modérée (×2) | Back : `@nestjs/platform-express` → `express` → `body-parser`/`qs` (**dépendance de production**, contrairement aux deux lignes ci-dessus) ; front : dépendance transitive de l'outillage de test | **Signalée, non close** |

**Pourquoi les deux premières sont acceptées.** Même raisonnement dans les
deux cas : `npm ls` confirme que le seul chemin passe par un outil de
développement (`prisma` CLI, `@nestjs/cli`/`@angular-devkit`), jamais par
`@prisma/client` ou tout autre paquet réellement importé par le code qui
tourne dans le conteneur `api` en production. `npm audit --omit=dev` les
fait apparaître malgré tout (limite connue du calcul des devDependencies
transitives), donc noter ici que c'est délibéré plutôt que de laisser croire
à une exposition en production.

**Pourquoi `qs` reste ouverte.** Contrairement aux deux lignes précédentes,
le chemin backend passe par `express`, la dépendance qui sert réellement les
requêtes HTTP en production, via `@nestjs/platform-express`. Le paquet `qs`
est verrouillé par la version d'`express` elle-même (`6.15.3`, pas de version
patchée disponible sans mise à jour d'`express` en amont) : pas de correctif
direct à appliquer aujourd'hui. Sévérité modérée (CVSS 3.7–5.3, bornée à un
déni de service ou un contournement de limite sur le nombre de clés d'un
objet parsé) plutôt que critique, mais faute d'avoir pu établir avec
certitude son inatteignabilité côté production, elle reste listée comme
ouverte plutôt que classée acceptée par confort. À revoir à la prochaine
mise à jour d'`express`.

Front : `npm audit` : **1 vulnérabilité modérée** (`qs`, même CVE, dépendance
transitive de l'outillage de test, pas du bundle applicatif servi aux
utilisateurs).

---

## À venir (chantiers identifiés, pas encore livrés)

Aucun contrôle listé ici au 2026-09-04. Les deux lignes qui y figuraient
(limitation de débit, mot de passe optionnel sur le lien) sont livrées : voir
respectivement « Limitation de débit » ci-dessus et le tableau des règles de
validation de `docs/documentation-technique.md` (section 4, US09).

**TLS reste hors périmètre pour la démonstration locale, et c'est un choix, pas un oubli.** Un certificat public (Let's Encrypt) valide la possession d'un nom de domaine réel joignable depuis l'extérieur ; ni `localhost` ni la pile Docker locale n'en ont un. L'alternative locale (`mkcert`, une autorité de certification installée dans le magasin de confiance du système) fonctionne, mais exigerait que chaque évaluateur l'installe avant `make setup`, ce qui contredit l'objectif d'un clone qui démarre sans rien préparer sur l'hôte. En production, un vrai nom de domaine lève ce blocage : nginx termine le TLS avec un certificat Let's Encrypt renouvelé automatiquement, quelques lignes de configuration. Conséquence mesurée côté score Lighthouse : voir `PERF.md`, §3 (QA-07).
