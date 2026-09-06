# Diagramme 6 — Architecture front-end

**Livrable** : accompagne « Architecture de l'application » (section 1), sous-section « Architecture front-end ».
**Pourquoi ce diagramme existe** : le dossier technique décrit l'architecture back-end en détail mais ne montrait jusqu'ici rien du front. Ce schéma comble le trou : arbre de composants réel, où vit l'état, et le seul mécanisme de persistance côté client (IndexedDB pour la reprise d'upload).

**Notation** : boîtes et flux, comme le diagramme 1. Portrait.

---

## Ce qu'il faut dessiner

### Trois zones verticales, de haut en bas

**Zone 1 — Racine**
- `App.tsx` — sous-titre « routage minimal · état d'authentification ». Un seul nœud en haut, qui distribue vers les zones 2 et 3.

**Zone 2 — Vues basculées par état (à `/`)**, cadre englobant quatre nœuds côte à côte :
- `LoginForm` / `RegisterForm` — sous-titre « formulaires, basculent entre eux »
- `Uploader` — sous-titre « sélection, envoi multipart, reprise » — **le nœud le plus large du schéma**, c'est le composant le plus lourd du front
- `MonEspace` — sous-titre « historique, filtre Tous / Actifs / Expiré »

**Zone 3 — Route dédiée (hors du cadre de la zone 2)**
- `RecipientPage` — sous-titre « `/d/:token` · non authentifiée · 8 états d'affichage » — seule vraie route de l'application, à dessiner clairement séparée des vues basculées

**Sous les zones 2 et 3, deux nœuds de support :**
- `IndexedDB` (`datashare-resume`) — sous-titre « magasin `pending-uploads`, clé `fileId` · métadonnées seulement, jamais les octets »
- `API` (`lib/api.ts`) — sous-titre « wrapper `fetch`, JWT en en-tête `Authorization` »

### Les liens à tracer, avec leurs étiquettes exactes

| De | Vers | Étiquette | Style |
|---|---|---|---|
| App.tsx | LoginForm / RegisterForm / Uploader / MonEspace | `bascule par état` | trait fin |
| App.tsx | RecipientPage | `route /d/:token` | trait fin |
| Uploader | IndexedDB | `écrit à l'initiation, avant le 1er octet envoyé` | trait fin |
| Uploader | IndexedDB | `supprime à la complétion / annulation / échec` | trait fin, pointillés |
| Uploader | API | `parties séquentielles, 1 à la fois — 3 tentatives, backoff 500ms/1,5s/3s` | trait fin |
| Uploader | API | `poll statut scan — 1,5 s, ~3 min max` | trait fin |
| MonEspace | API | `GET /files` | trait fin |
| RecipientPage | API | `poll GET /d/:token — 2 s puis 5 s après 30 s, abandon à 2 min` | trait fin |
| LoginForm / RegisterForm | API | `POST /auth/*` | trait fin |

### Annotation encadrée, sous la zone 2

> **Pas de bibliothèque de gestion d'état.** `useState` local et passage de props partout. L'état d'un envoi en cours (`idle` → `configuring` → `uploading` → `verifying` → `scanning` → `done`, plus `cancelled`/`error`) vit entièrement dans `Uploader`, rien n'est partagé au-delà de ce composant sinon via IndexedDB.

### Annotation encadrée, sous IndexedDB

> **IndexedDB ne stocke jamais les octets du fichier ni les `ETag` des parties déjà envoyées.** Uniquement de quoi retrouver un envoi (nom, taille, date de modification, type). Les parties déjà envoyées sont re-demandées à l'API (`GET /files/uploads/:id/parts`) au moment de la reprise, pas relues depuis le disque local.

---

## Légende obligatoire

```
──────  appel réseau vers l'API
- - - -  écriture/suppression locale (IndexedDB)
▭▭▭     zone de vues basculées par état (pas des routes)
```

---

## Contraintes de style

- Même famille visuelle que le diagramme 1 : rectangles étiquetés, une seule couleur d'accent réservée au nœud `Uploader` (c'est le composant central de ce schéma), tout le reste en niveaux de gris.
- Typographie : DM Sans pour les titres de nœuds, Inter pour les sous-titres.
- Portrait, lisible en A4 dans un PDF, lisible en noir et blanc si imprimé.
- Pas de logos de technologies, pas de dégradés, pas d'ombres décoratives, pas d'icônes rondes colorées.
- Chaque nœud porte un sous-titre d'une ligne.

## Pièges à éviter

- Ne pas dessiner `LoginForm`, `RegisterForm`, `Uploader`, `MonEspace` comme des routes séparées : ce sont des vues basculées par état à la racine `/`, une seule vraie route existe (`RecipientPage`, `/d/:token`). Le mélange serait un contresens sur l'architecture réelle.
- Ne pas laisser croire à un état global : il n'y en a pas. Ne pas dessiner de nœud « store » ou « contexte global ».
- Ne pas dessiner IndexedDB comme s'il stockait le fichier lui-même — seulement ses métadonnées.
- Ne pas répéter le diagramme 4 (séquence de téléversement) : celui-ci montre la structure des composants, pas la chronologie des appels. S'ils se recoupent sur `Uploader` → API, rester au niveau structurel ici.
