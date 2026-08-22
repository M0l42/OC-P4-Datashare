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
`.pdf` passe cette étape. La vérification du contenu réel (octets magiques)
est un chantier séparé (SOC-05, à venir — voir plus bas).

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
caractères), généré à l'initiation. Volontairement pas un UUID : un UUID v7
embarque un horodatage, ce qui rendrait le jeton partiellement prévisible.

---

## À venir (chantiers identifiés, pas encore livrés)

| Contrôle | Chantier | Note |
|---|---|---|
| Octets magiques (contenu réel vs extension déclarée) | SOC-05 | Lecture par plage (`Range: bytes=0-63`), pas de lecture complète |
| Antivirus ClamAV | SOC-05 | Plafonné à 50 Mo, limite assumée et documentée à ce moment-là |
| `Content-Disposition: attachment` forcé au téléchargement | US02 | Empêche un `.html`/`.svg` téléversé de s'exécuter depuis l'origine du bucket |
| Limitation de débit (Redis) sur `/auth/login` et `GET /d/:token` | — | Non câblée ; planifiée mais pas encore un chantier nommé |
| Mot de passe optionnel sur le lien de téléchargement | US09 | |
