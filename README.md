# DataShare

Plateforme de transfert sécurisé de fichiers (MVP), style WeTransfer, pour freelances et petites entreprises. Projet réalisé dans le cadre du parcours OpenClassrooms *« Pilotez le développement d'une application full-stack complète »*, en jouant le rôle de tech lead senior pour une PM fictive, Lisa.

**Dépôt** : https://github.com/M0l42/OC-P4-Datashare

## Ce que fait l'application

- **Téléverser** un fichier jusqu'à 1 Go, avec expiration configurable (1 à 7 jours) et mot de passe optionnel.
- **Partager** un lien de téléchargement à durée de vie limitée, sans compte requis côté destinataire.
- **Suivre** ses envois depuis « Mon espace » : état du lien (actif / expiré), historique, suppression.
- **Se protéger** : analyse antivirale (ClamAV) avant que le lien ne devienne actif, mots de passe hachés, jamais d'identifiants de stockage exposés au client.

## Architecture, en une phrase

**L'API ne transporte jamais les octets.** Elle distribue des autorisations (URLs S3 pré-signées) ; le navigateur envoie et reçoit les fichiers directement depuis le stockage objet (MinIO). Une coupure réseau coûte une partie de 8 Mo, pas le fichier entier — voir `docs/documentation-technique.md` §1 pour le détail et les scénarios de panne.

```
Navigateur ─┬─ HTTPS ──> nginx ──> HAProxy ──> API NestJS (×N) ──> PostgreSQL
            │                                        │
            │                                        └──> Redis (BullMQ, rate-limit)
            │                                                  │
            │                                                  └──> Worker ──> ClamAV
            └─ HTTPS (URLs pré-signées) ───────────────────> MinIO (S3)
```

Schémas détaillés (architecture, MCD, machine à états, séquences) : `docs/diagrams/`.

## Stack technique

| Brique | Choix | Pourquoi (résumé) |
|---|---|---|
| Back-end | NestJS (TypeScript) | Un seul langage sur toute la pile ; types partagés front/back |
| Front-end | React | Contrôle direct nécessaire sur `File.slice()` et l'uploader multipart |
| Base de données | PostgreSQL + Prisma | Modèle relationnel (MCD imposé par la spec), migrations fiables |
| Stockage objet | MinIO (API S3) | Un seul chemin de code, valable pour n'importe quel fournisseur S3 en production |
| File de tâches | BullMQ sur Redis | Validation post-upload, purges planifiées, rate-limiting partagé entre réplicas |
| Antivirus | ClamAV (plafond de scan 1 Gio) | Analyse de **tout** fichier accepté, avant que le lien ne devienne actif |
| Authentification | JWT + bcrypt | Hachage salé maison, comme l'exige la spécification |
| Documentation API | `@nestjs/swagger` | Générée depuis les DTO de validation — ne peut pas diverger du code |
| Répartition de charge | HAProxy | Réplicas de l'API scalables (`make scale n=3`) |
| Orchestration | Docker Compose + Makefile | Un `make setup` depuis un clone vierge produit une pile fonctionnelle |

Justification complète de chaque choix, y compris les alternatives écartées : `docs/documentation-technique.md` §2.

## Démarrage rapide

Prérequis : Docker Engine 24+, Docker Compose v2 (`docker compose`, pas `docker-compose`).

```bash
git clone git@github.com:M0l42/OC-P4-Datashare.git && cd OC-P4-Datashare
make setup      # copie .env.example → .env, construit, démarre, attend /api/health
make migrate    # applique les migrations Prisma
```

L'application est servie sur **http://localhost:8080**, l'UI Swagger sur **http://localhost:8080/api/docs**, la console MinIO sur **http://localhost:9001**.

`make setup` n'est pas un simple `docker compose up` : il attend explicitement que `/api/health` réponde avant de rendre la main, et le conteneur éphémère `minio-init` configure seul le bucket et sa politique CORS. Aucune étape manuelle après le clone.

```bash
make help       # liste les ~22 cibles disponibles
make down       # arrête la pile (les volumes sont conservés)
make logs s=api # suit les logs d'un service
```

### Variables d'environnement

Copiées depuis `.env.example` par `make setup`. Aucun secret réel n'est versionné ; à remplacer en production (voir les commentaires du fichier) :

| Variable | Rôle |
|---|---|
| `DATABASE_URL`, `POSTGRES_*` | Connexion et identifiants PostgreSQL |
| `REDIS_URL` | Connexion Redis (BullMQ, rate-limiting) |
| `JWT_SECRET` | Signature des jetons — générer avec `openssl rand -base64 48` |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | Stockage objet, vu depuis l'API (réseau interne) |
| `S3_PUBLIC_ENDPOINT` | Même stockage, vu depuis le **navigateur** — piège de configuration le plus fréquent, voir §7 de la doc technique |
| `PUBLIC_APP_ORIGIN` | Origine autorisée pour la politique CORS du bucket |
| `CLAMAV_HOST`, `CLAMAV_PORT` | Cible de l'antivirus (le plafond de scan est une constante du code, pas une variable d'environnement) |

## Tests

```bash
make test        # unitaire + intégration (Jest, Supertest)
make test-cov     # avec rapport de couverture
make cypress      # end-to-end (Cypress) — nécessite `make up`
make perf-download n=1   # k6 — nécessite `make up`
make perf-upload
```

Détail des trois niveaux, chiffres de couverture réels et scénarios couverts : `TESTING.md` et `docs/test-plan.md`.

## Documentation

| Document | Contenu |
|---|---|
| `docs/documentation-technique.md` | Livrable 1 — architecture, choix technologiques, modèle de données, API, sécurité, qualité, installation, usage de l'IA |
| `TESTING.md` | Plan de suivi qualité — stratégie de test et résultats |
| `SECURITY.md` | Contrôles de sécurité en place, limites assumées, chantiers à venir |
| `PERF.md` | Mesures de performance réelles (k6, upload/download) |
| `MAINTENANCE.md` | Tâches planifiées, maintien en conditions opérationnelles |
| `DESIGN.md` | Design system — tokens résolus depuis les maquettes Figma |
| `docs/design-decisions.md` | Source de vérité des décisions de conception, alternatives écartées |
| `docs/journal-ia.md` | Journal détaillé de la user story confiée à l'IA (US06) |
| `docs/diagrams/` | Architecture logicielle, MCD, machine à états, diagrammes de séquence |
| `docs/api/openapi.json` | Export de la spécification OpenAPI |

## Usage de l'IA dans ce dépôt

Une seule user story (US06, suppression d'un fichier) est développée par un assistant IA sous supervision, traçable dans l'historique Git et détaillée dans `docs/journal-ia.md`. Les huit autres sont écrites à la main. Détail de la posture adoptée : `docs/documentation-technique.md` §8.

## Structure du dépôt

```
backend/    API NestJS
frontend/   SPA React
infra/      Configuration nginx, HAProxy
docs/       Documentation technique, diagrammes, décisions
design/     Maquettes et design system
perf/       Scripts k6
scripts/    Scripts d'initialisation (bucket MinIO)
```

**Auteur** : Nathan Boukobza
