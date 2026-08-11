# Diagramme 1 — Architecture logicielle

**Livrable** : « Architecture de l'application (diagramme simple) », section 1 de la documentation technique.
**Objectif du diagramme** : montrer les briques logicielles, les protocoles entre elles, et **le fait que les octets des fichiers ne traversent jamais l'API**. C'est la propriété centrale de l'architecture : si le diagramme ne la rend pas évidente d'un coup d'œil, il a raté sa cible.

---

## Ce qu'il faut dessiner

### Trois zones horizontales, de haut en bas

**Zone 1 — Client**
- `Navigateur` — un seul nœud, sous-titre « Desktop 1440px / Mobile 393px ». React SPA.

**Zone 2 — Périmètre Docker** (cadre en pointillés englobant tout le reste, étiqueté « docker compose »)

Rangée 2a, entrée :
- `nginx` — sous-titre « reverse proxy · sert le build React · load balancing `upstream` »
- `HAProxy` — sous-titre « répartition L4 vers N réplicas API » — placé **à droite de nginx**, en gris plus clair, avec la mention « mesure de charge (PERF.md) »

Rangée 2b, application :
- `API NestJS ×3` — dessiner comme **trois rectangles superposés décalés** (effet de pile) pour montrer les réplicas. Sous-titre « REST · JWT · @nestjs/swagger »
- `Worker BullMQ` — sous-titre « validation post-upload · purges · reaper »

Rangée 2c, données et services :
- `PostgreSQL` — sous-titre « users, files, tags »
- `Redis` — sous-titre « files BullMQ · rate limiting »
- `MinIO` — sous-titre « stockage objet compatible S3 »
- `ClamAV` — sous-titre « clamd · scan ≤ 50 Mo »

### Les liens à tracer, avec leurs étiquettes exactes

| De | Vers | Étiquette | Style |
|---|---|---|---|
| Navigateur | nginx | `HTTPS` | trait fin |
| nginx | HAProxy | `HTTP` | trait fin |
| HAProxy | API NestJS | `HTTP` | trait fin |
| API NestJS | PostgreSQL | `TCP 5432 · Prisma` | trait fin |
| API NestJS | Redis | `RESP · rate limit + enqueue` | trait fin |
| API NestJS | MinIO | `S3 API · signature seulement` | trait fin, **pointillés** |
| Worker BullMQ | Redis | `RESP · consommation de jobs` | trait fin |
| Worker BullMQ | PostgreSQL | `TCP 5432 · transitions d'état` | trait fin |
| Worker BullMQ | MinIO | `S3 GetObject · lecture pour scan` | trait fin |
| Worker BullMQ | ClamAV | `INSTREAM sur TCP 3310` | trait fin |
| **Navigateur** | **MinIO** | **`HTTPS · PUT/GET des octets (URLs pré-signées)`** | **trait ÉPAIS, couleur d'accent** |

### Le lien qui porte tout le message

Le lien `Navigateur → MinIO` doit :
- **contourner visuellement** nginx, HAProxy et l'API (le tracer sur le côté, en dehors de la colonne centrale) ;
- être **nettement plus épais** que tous les autres et dans la seule couleur d'accent du schéma ;
- porter une annotation encadrée : **« 1 Go ne passe jamais par l'API. L'API signe, le navigateur transfère. »**

Le lien `API → MinIO` doit être en **pointillés** avec l'étiquette « signature seulement », pour contraster : c'est du contrôle, pas de la donnée.

---

## Légende obligatoire

```
──────  flux de contrôle (JSON, quelques Ko)
━━━━━━  flux de données (octets des fichiers, jusqu'à 1 Go)
- - - -  génération de signature (aucune donnée transférée)
▭▭▭     réplicas horizontaux
┈┈┈┈┈   périmètre docker compose
```

---

## Contraintes de style

- **Pas de logos de technologies.** Des rectangles étiquetés. Un schéma d'architecture, pas une planche de stickers.
- **Une seule couleur d'accent**, réservée au flux de données. Tout le reste en niveaux de gris.
- Typographie : DM Sans pour les titres de nœuds, Inter pour les sous-titres (cohérence avec le design system du projet).
- Orientation **portrait**, lisible en A4 dans un PDF, et lisible en noir et blanc si imprimé.
- Pas de dégradés, pas d'ombres décoratives, pas d'icônes rondes colorées.
- Chaque nœud porte un sous-titre d'une ligne. Aucun nœud sans justification lisible.

## Pièges à éviter

- Ne pas dessiner `nginx → MinIO` : les octets ne traversent pas nginx. C'est l'erreur qui annule le message du schéma.
- Ne pas dessiner `API → ClamAV` : c'est le worker qui scanne, pas l'API.
- Ne pas faire de HAProxy le point d'entrée : nginx est devant, HAProxy est derrière lui.
- Ne pas oublier que ClamAV et HAProxy arrivent en semaine 2 — les dessiner normalement, mais ne pas les présenter comme le cœur du système.
