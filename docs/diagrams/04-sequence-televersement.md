# Diagramme 4 — Séquence de téléversement (multipart pré-signé)

**Livrable** : accompagne « Architecture de l'application » (section 1) et « Documentation d'API » (section 4).
**Pourquoi ce diagramme existe** : c'est le parcours technique le plus intéressant du projet, et le seul dont le fonctionnement n'est pas devinable. Il montre que l'API distribue des autorisations et que le navigateur transfère les octets. Le diagramme d'architecture le dit ; celui-ci le prouve étape par étape.

**Notation** : diagramme de séquence UML.

---

## Participants (4 colonnes, dans cet ordre)

1. `Navigateur` (React)
2. `API NestJS`
3. `MinIO` (S3)
4. `PostgreSQL`

Le worker BullMQ et ClamAV n'apparaissent **pas** ici : ils sont dans le diagramme 5. Ce diagramme s'arrête à `uploaded`.

---

## Séquence — chemin nominal

| # | De → Vers | Message | Note |
|---|---|---|---|
| 1 | Navigateur → API | `POST /files/uploads` `{nom, taille, type, expiration, motDePasse?, tags[], afficherExpediteur}` | |
| 2 | API → API | valide : JWT, extension contre la liste noire, taille déclarée ≤ 1 Go, expiration 1–7 j | |
| 3 | API → MinIO | `CreateMultipartUpload` | |
| 4 | MinIO → API | `uploadId` | |
| 5 | API → PostgreSQL | `INSERT fichier (etat='pending', upload_id, taille_partie=8 Mo)` | |
| 6 | API → MinIO | `getSignedUrl(UploadPart)` × N | **aucun octet ne circule** |
| 7 | API → Navigateur | `{uploadId, taillePartie, urls[N]}` (TTL 1 h) | |
| 8 | Navigateur → Navigateur | `File.slice()` en parties de 8 Mo | |
| 9 | **Navigateur → MinIO** | **`PUT` partie 1..N — les octets** | **flux épais, en couleur d'accent** |
| 10 | MinIO → Navigateur | `ETag` par partie | |
| 11 | Navigateur → API | `POST /files/uploads/:id/complete` `{parties:[{n, etag}]}` | |
| 12 | API → MinIO | `CompleteMultipartUpload` | |
| 13 | API → MinIO | `HeadObject` | **contrôle de taille réel** |
| 14 | API → PostgreSQL | `UPDATE etat='uploaded'` | |
| 15 | API → Redis | `enqueue(validation)` | mène au diagramme 5 |
| 16 | API → Navigateur | `202 { etat: 'uploaded' }` | pas encore de lien |

**L'étape 9 est le message le plus important du diagramme.** Elle doit être visuellement dominante : trait épais, couleur d'accent, et elle **saute par-dessus la colonne de l'API** sans la toucher.

---

## Fragments à représenter

### `loop` — parties séquentielles avec reprise

Englober les étapes 9–10 dans un fragment `loop [pour chaque partie manquante]`, avec à l'intérieur un fragment `alt` :

- `[PUT réussit]` → enregistrer l'`ETag`, persister dans IndexedDB, avancer la progression
- `[PUT échoue]` → réessayer **cette partie seulement**, callout Alert « Connexion interrompue. Nouvelle tentative du morceau 8 sur 14. »

Annotation à côté de la boucle :

> **Une coupure réseau coûte une partie de 8 Mo, pas le fichier entier.** C'est la raison d'être du multipart. Si la reprise est silencieuse, l'architecture ne se voit pas.

### `alt` — dépassement de taille (à l'étape 13)

- `[HeadObject ≤ 1 Go]` → étapes 14–16
- `[HeadObject > 1 Go]` → `DeleteObject`, `UPDATE etat='rejected'`, `413` au navigateur

Annotation encadrée, à mettre en évidence :

> **Une URL PUT pré-signée ne contraint pas `Content-Length`.** Vérifié contre MinIO : un client déclarant 1 Mio a téléversé 25 Mio à travers une seule URL signée, et ça a été accepté. S3 autorise 5 Go par partie. La taille déclarée n'est donc **pas** un contrôle. Le seul contrôle réel est `HeadObject` après complétion.

### `alt` — reprise après rechargement

Un fragment séparé, avant l'étape 8 :

- `[reprise détectée dans IndexedDB]` :
  1. Navigateur affiche « Reprendre » dans Mon espace
  2. Utilisateur **re-sélectionne le fichier** (le handle `File` ne survit pas à un rechargement)
  3. Vérifier `nom + taille + lastModified` — refus si divergence
  4. Navigateur → API `GET /files/uploads/:id/parts`
  5. API → MinIO `ListParts` ; API → Navigateur parties présentes + URLs re-signées
  6. Vérifier un **échantillon** de parties (première, dernière complétée, une au hasard) : MD5 recalculé contre l'`ETag` stocké
  7. Reprendre la boucle sur les parties manquantes uniquement

Annotation :

> **Pourquoi l'échantillon de sommes de contrôle.** Sans lui, un utilisateur qui re-sélectionne un *autre* fichier de taille identique produit un objet dont les parties viennent de deux fichiers, qui se complète sans erreur, passe le contrôle `HeadObject` (la taille est bonne) et livre un fichier corrompu derrière un lien valide. Aucune erreur nulle part.

### `alt` — fichier sous 5 Mio

Court fragment, avant la boucle :

- `[taille < 5 Mio]` → une seule partie, pas de découpage
- Annotation : « Vérifié : S3 et MinIO refusent une partie non finale sous 5 Mio avec `EntityTooSmall`. Un fichier de 2 Mo ne peut pas être découpé. »

---

## Contraintes de style

- Diagramme de séquence UML classique : lignes de vie verticales en pointillés, messages en flèches horizontales étiquetées, fragments en cadres nommés (`loop`, `alt`) avec la condition entre crochets.
- **Une seule couleur d'accent**, réservée aux messages qui transportent des octets (étapes 9 et 10).
- Les messages de signature (étape 6) en pointillés : rien ne circule.
- Format **paysage**. Si la hauteur devient illisible, sortir le fragment de reprise dans un second schéma plutôt que de tout comprimer.
- Numéroter les messages : les numéros servent de références dans le texte de la documentation technique.

## Pièges à éviter

- Ne pas faire passer l'étape 9 par la colonne de l'API. C'est l'erreur qui inverse le message du diagramme.
- Ne pas placer `HeadObject` avant `CompleteMultipartUpload` : l'objet n'existe pas encore.
- Ne pas montrer un lien de téléchargement à l'étape 16. Le lien n'existe qu'en état `ready`, donc après le diagramme 5.
