# DataShare — Documentation technique

**Projet** : plateforme de transfert sécurisé de fichiers (MVP)
**Auteur** : Nathan Boukobza
**Date** : août 2026
**Dépôt** : *(à renseigner après création du remote)*

> **Convention de lecture** : les blocs marqués **À COMPLÉTER** attendent des résultats que seule l'implémentation peut produire (chiffres de tests, captures, mesures). Tout le reste est arrêté et justifié.

---

## Sommaire

1. [Architecture de l'application](#1--architecture-de-lapplication)
2. [Choix technologiques justifiés](#2--choix-technologiques-justifiés)
3. [Modèle de données](#3--modèle-de-données)
4. [Documentation d'API](#4--documentation-dapi)
5. [Sécurité et gestion des accès](#5--sécurité-et-gestion-des-accès)
6. [Qualité, tests et maintenance](#6--qualité-tests-et-maintenance)
7. [Processus d'installation et d'exécution](#7--processus-dinstallation-et-dexécution)
8. [Utilisation de l'IA dans le développement](#8--utilisation-de-lia-dans-le-développement)

---

## 1 — Architecture de l'application

**Schéma** : voir `docs/diagrams/01-architecture-logicielle.md`.

### Vision globale

DataShare est une application web à séparation front/back stricte, déployée comme un ensemble de conteneurs orchestrés par `docker compose`. Le front est une SPA React servie en statique ; le back est une API REST NestJS ; le stockage des fichiers est délégué à un service objet compatible S3.

| Brique | Rôle | Arrivée |
|---|---|---|
| nginx | Sert le build React, proxifie `/api` vers HAProxy, point de terminaison TLS | J1 |
| API NestJS (×N) | Endpoints REST, authentification JWT, signature des URLs de stockage, génération de la spécification OpenAPI | J1 |
| PostgreSQL | Utilisateurs, fichiers, tags | J1 |
| Redis | Support de files BullMQ et limitation de débit | J1 |
| MinIO | Stockage objet compatible S3 | J1 |
| Worker BullMQ | Validation post-upload, purges planifiées, reaper des uploads abandonnés | S2 |
| ClamAV | Analyse antivirale, plafonnée à 50 Mo | S2 |
| HAProxy | Répartition de charge sur les réplicas de l'API, découverte par DNS (suit `make scale`) | S2 |

Chaque conteneur répond à la question « pourquoi existe-t-il » en une phrase. Aucun n'est présent par principe.

### La propriété centrale : l'API ne transporte jamais les octets

US01 autorise des fichiers jusqu'à 1 Go. L'implémentation naïve fait transiter ce gigaoctet par l'API, ce qui occupe un worker applicatif et un tampon nginx pendant toute la durée du transfert, et fait perdre l'intégralité de l'envoi à la moindre coupure réseau.

L'architecture retenue inverse la responsabilité : **l'API distribue des autorisations, le navigateur transporte les données.**

- Au téléversement, l'API initie un *multipart upload* S3 et renvoie des URLs pré-signées, une par partie de 8 Mo. Le navigateur découpe le fichier avec `File.slice()` et envoie chaque partie **directement à MinIO**. Une coupure réseau coûte une partie de 8 Mo, pas le fichier.
- Au téléchargement, l'API vérifie le jeton, l'état et le mot de passe, puis renvoie une URL pré-signée valable 60 secondes. Le navigateur récupère les octets **directement depuis MinIO**.

Conséquence mesurable : l'API reste disponible quel que soit le volume transféré, et les identifiants de stockage ne quittent jamais le serveur.

### Sécurisation des échanges

- Navigateur ↔ nginx : HTTPS.
- Navigateur ↔ MinIO : HTTPS, autorisation portée par une signature AWS SigV4 à durée de vie limitée (1 h pour les parties en écriture, 60 s en lecture).
- API ↔ MinIO : appels S3 authentifiés par les identifiants du serveur, qui ne sont jamais exposés au client.
- Communications inter-conteneurs : réseau Docker interne, aucun port de base de données ou de Redis publié vers l'hôte.

### Un scénario de panne par point d'intégration

| Point d'intégration | Panne réaliste | Le système répond |
|---|---|---|
| Navigateur → MinIO | Coupure réseau en cours de transfert | Nouvelle tentative de la partie concernée ; reprise possible 48 h |
| API → MinIO | Signature expirée pendant un envoi lent | Endpoint de re-signature via `ListParts` |
| Worker → ClamAV | `clamd` indisponible | Job remis en file ; ligne bloquée en `scanning` détectée après 15 min |
| Worker mort en cours de scan | Processus tué | Ligne en `scanning` depuis plus de 15 min remise en file |
| Reaper vs reprise | Le reaper avorte un upload qu'on voulait reprendre | Fenêtre de 48 h ; `NoSuchUpload` produit un refus explicite |
| API → PostgreSQL | Perte de connexion pendant `complete` | Objet assemblé mais ligne non mise à jour : le reaper le récupère |

---

## 2 — Choix technologiques justifiés

### Contrainte de départ

La spécification imposait un choix dans une liste fermée : back-end parmi Spring Boot, .NET Core, NestJS et Symfony/Laravel ; front parmi Angular, React et Vue ; base parmi PostgreSQL et MongoDB ; stockage en système de fichiers local ou S3.

Mon langage de maîtrise est Python avec Django, qui ne figure pas dans la liste. Le choix ne pouvait donc pas se faire sur la compétence acquise, et j'ai préféré l'assumer explicitement : les décisions ci-dessous sont motivées par l'adéquation au problème, pas par mon confort.

### Tableau des choix

| Élément | Technologie choisie | Alternatives | Justification |
|---|---|---|---|
| Langage / back-end | **NestJS (TypeScript)** | Spring Boot, .NET Core, Symfony/Laravel | Un seul langage sur toute la pile, donc des types partagés pour le contrat front/back. Spring Boot a été écarté volontairement : un projet précédent l'utilisait déjà, et diversifier a plus de valeur pour un portfolio. Le modèle modules/providers de NestJS transpose directement celui de Spring, ce qui limite le coût d'apprentissage. |
| Front-end | **React** | Angular, Vue | Familiarité partielle existante, et surtout un besoin de contrôle direct sur `File.slice()`, l'enchaînement des requêtes et la persistance IndexedDB. L'uploader découpé est la pièce la plus délicate du front ; un framework moins explicite sur ces points aurait gêné. |
| Base de données | **PostgreSQL** | MongoDB | Le modèle est relationnel (un utilisateur possède N fichiers) et le livrable exigé est un **MCD**, une notation relationnelle. Modéliser en Merise puis implémenter en documentaire aurait été incohérent. |
| ORM | **Prisma** | TypeORM, Drizzle | Des migrations fiables comptent plus que l'élégance des requêtes quand le schéma bouge chaque jour de la première semaine. Les types générés attrapent les erreurs de schéma à la compilation, ce qui compte double dans un framework qu'on découvre. `schema.prisma` est en outre un artefact lisible à mettre en regard du MCD. TypeORM aurait mieux transposé mon expérience de JPA et Doctrine, mais sa génération de migrations est notoirement peu fiable. |
| Stockage | **MinIO en local, API S3 exclusivement** | Système de fichiers local | Un seul chemin de code (`@aws-sdk/client-s3`) sert MinIO en développement et n'importe quel fournisseur compatible en production. Le stockage local aurait interdit les URLs pré-signées, donc l'architecture entière. |
| File de tâches | **BullMQ sur Redis** | node-cron, tâches en base | Nécessaire pour la validation post-upload, les purges quotidiennes et le reaper. Redis sert aussi de support à la limitation de débit — obligatoirement partagé, puisque l'API tourne en plusieurs réplicas. |
| Authentification | **JWT émis par l'application, bcrypt** | Keycloak, OAuth2 délégué | US03 et US04 exigent le hachage salé du mot de passe dans notre base et l'émission du jeton. Déléguer à Keycloak aurait cédé une compétence évaluée en échange du conteneur le plus lourd de la pile. Le SSO et la double authentification figurent en perspectives de sécurité, pas dans le MVP. |
| Documentation d'API | **`@nestjs/swagger`** | Markdown rédigé à la main | La spécification OpenAPI est générée depuis les DTO déjà écrits pour la validation, donc elle ne peut pas se désynchroniser du code. |
| Journalisation | **`nestjs-pino`** | Logger NestJS par défaut | PERF.md exige des logs structurés et des métriques ; du JSON corrélé par identifiant de requête est exploitable, du texte libre ne l'est pas. |
| Antivirus | **ClamAV, plafonné à 50 Mo** | Aucun scan, service tiers | Un produit dont la promesse est la sécurité doit pouvoir répondre à « comment empêchez-vous la diffusion de malware ». Le plafond est une limite assumée et documentée, pas un oubli. |
| Tests | **Jest, Supertest, Cypress** | Vitest, Playwright | Jest est l'outil par défaut de NestJS. Supertest couvre le niveau intégration exigé par la mission. Cypress est nommé dans la spécification. |
| Charge | **k6** | Artillery, JMeter | Nommé dans la spécification. C'est un binaire Go qui exécute des scripts JavaScript — ce n'est pas un paquet npm et il ne tourne pas sur Node, ce qui est à savoir avant de l'annoncer comme « du même écosystème ». |
| Orchestration | **Docker Compose + Makefile** | Scripts shell, exécution manuelle | Répond directement au livrable « scripts de déploiement ». Un `make up` qui part d'un clone vierge est aussi la démonstration la plus convaincante en soutenance. |
| Outillage | Git avec Conventional Commits, WebStorm, ESLint + Prettier, npm | — | Conventional Commits est un bonus annoncé par la spécification, et le passage de relais à l'IA sur US06 doit être lisible dans l'historique (`feat(ai):` puis `fix:`). |

### Ce qui a été délibérément écarté

- **US07 (dépôt anonyme)** — retiré. La prise en charge mobile complète impose la reprise d'upload, et l'arbitrage a donné la priorité à la reprise. Conséquence : `proprietaire_id` reste NOT NULL.
- **Keycloak / SSO, double authentification** — perspectives de sécurité, avec les conditions de leur mise en œuvre.
- **Mailpit et toute notification par email** — le MVP n'a aucun besoin de courriel (US03 exclut explicitement le mail de confirmation). Le refus d'un fichier est porté par l'historique, et le lien n'est jamais rendu avant l'état `ready`, donc un fichier refusé n'a jamais de lien à envoyer.
- **SSE / WebSockets pour l'attente de scan** — une interrogation périodique est proportionnée à une attente de quelques secondes ; un second transport et une logique de reconnexion derrière un répartiteur de charge ne l'auraient pas été.

---

## 3 — Modèle de données

**Schéma MCD** : voir `docs/diagrams/02-mcd-modele-donnees.md`.
**Machine à états** : voir `docs/diagrams/03-machine-etats-fichier.md`.

### Deux entités, une association

`UTILISATEUR` (0,N) ── POSSÈDE ── (1,1) `FICHIER`

Un fichier appartient à exactement un utilisateur. Un utilisateur peut n'avoir aucun fichier, ce qui est l'état initial après inscription et correspond à l'écran vide de « Mon espace ».

### `FICHIER.etat` est le centre du modèle

L'invariant de sécurité du produit — *un lien de téléchargement ne résout que dans l'état `ready`* — est porté par une colonne, pas par des contrôles applicatifs dispersés. Sept états : `pending`, `uploaded`, `scanning`, `ready`, `rejected`, `expired`, `abandoned`. Le détail des transitions figure dans le diagramme 3.

### Une contradiction de la spécification, et sa résolution

US01 et US10 exigent la suppression du fichier **et de ses métadonnées** à l'expiration. US05 exige que l'historique affiche « l'état du lien (valide ou expiré) », et les maquettes confirment cette intention : une ligne « Expiré » accompagnée de « Ce fichier a expiré, il n'est plus stocké chez nous », et un sélecteur Tous / Actifs dont l'existence n'a de sens que si des lignes expirées subsistent.

Supprimer la ligne rend « expiré » inaffichable. La résolution retenue :

1. À l'expiration : l'objet est supprimé de MinIO, `cle_stockage` et `mot_de_passe_hash` sont vidés, l'état passe à `expired`. La ligne subsiste avec le nom, la taille et les dates.
2. **Sept jours plus tard**, la ligne est purgée par une seconde passe.

La fenêtre de 7 jours reprend la durée de vie que le produit enseigne déjà à l'utilisateur (« conservé chez nous pendant une semaine ») : la trace vit exactement aussi longtemps que le fichier a vécu. Le compromis de minimisation des données est écrit dans SECURITY.md.

### Index

`(etat, expire_le)`, `(etat, cree_le)`, `jeton_telechargement` (unique), `proprietaire_id`. Trois tâches planifiées balaient quotidiennement les deux premiers couples ; sans index, chacune fait un parcours complet de table.

---

## 4 — Documentation d'API

### Où se trouve la spécification

La spécification OpenAPI est **générée** par `@nestjs/swagger` depuis les DTO de validation, et exposée à `/api/docs` (UI Swagger) et `/api/docs-json` (document brut). Elle ne peut pas diverger du code, puisqu'elle en est dérivée.

> **À COMPLÉTER** — joindre l'export `openapi.json` au dépôt une fois les endpoints implémentés, et une capture de l'UI Swagger.

### Contrat d'interface

| Méthode | Route | Rôle | Auth |
|---|---|---|---|
| POST | `/auth/register` | US03. Email unique, mot de passe ≥ 8 caractères, `nom_affiche` optionnel | non |
| POST | `/auth/login` | US04. Retourne un JWT. Limité en débit | non |
| POST | `/files/uploads` | US01, initiation. Valide auth, extension, taille déclarée. Retourne `uploadId`, `taillePartie`, URLs pré-signées | oui |
| GET | `/files/uploads/:id/parts` | `ListParts` + re-signature des parties manquantes. Rend la reprise possible et couvre l'expiration des signatures | oui |
| POST | `/files/uploads/:id/complete` | `CompleteMultipartUpload`, contrôle de taille par `HeadObject`, état → `uploaded`, mise en file de la validation | oui |
| DELETE | `/files/uploads/:id` | `AbortMultipartUpload` sur annulation explicite | oui |
| GET | `/files` | US05, historique. Filtré au propriétaire. Paramètre de filtre Tous / Actifs | oui |
| DELETE | `/files/:id` | US06, suppression. Filtré au propriétaire. **User story confiée à l'IA** | oui |
| GET | `/d/:token` | US02, métadonnées avant téléchargement. Limité en débit | non |
| POST | `/d/:token` | US02, vérification du mot de passe puis URL pré-signée de 60 s | non |

### Durées de vie des signatures

- Parties en écriture : **1 heure**. Le scénario que le produit revendique est une connexion lente et instable ; une signature courte y expirerait avant la fin du transfert. D'où l'endpoint de re-signature.
- Lecture au téléchargement : **60 secondes**. L'URL est consommée immédiatement par le navigateur.

### Règles de validation

| Champ | Règle | Vérifié |
|---|---|---|
| Email | Format valide, unique en base | client + serveur |
| Mot de passe de compte | 8 caractères minimum (US03) | client + serveur |
| Mot de passe de fichier | 6 caractères minimum si renseigné (US09) | client + serveur (US02 l'exige des deux côtés) |
| Expiration | 1 à 7 jours, 7 par défaut, **plafond 7** | serveur (US10) |
| Taille | ≤ 1 Go déclaré, **re-vérifié par `HeadObject` après complétion** | serveur |
| Extension | Liste noire (`.exe`, `.bat`, …) | serveur, à l'initiation |
| Contenu | Octets magiques cohérents avec l'extension déclarée | worker |
| Tag | Texte libre, ≤ 30 caractères, sans doublon par fichier | client + serveur |

---

## 5 — Sécurité et gestion des accès

### Authentification

Email et mot de passe, haché avec **bcrypt** (salage inclus par construction). À la connexion, l'application émet un **JWT** qu'elle signe elle-même. Aucun rôle ni permission : US03 précise qu'aucun profil administrateur n'est nécessaire dans le MVP. Le seul contrôle d'autorisation est donc la **propriété** : toute requête sur un fichier est filtrée par `proprietaire_id`.

L'absence de ce filtre serait une référence directe non sécurisée à un objet — n'importe quel utilisateur authentifié pourrait supprimer le fichier d'un autre. C'est le premier point vérifié lors de la revue du code de US06, confié à l'IA.

### Le destinataire n'est pas authentifié

C'est le point de sécurité le plus intéressant du produit. La seule autorisation d'accès au fichier est un **jeton imprédictible et unique** dans l'URL. Trois conséquences assumées :

1. **Tout ce que la page affiche est visible de quiconque détient le lien.** D'où le nom de l'expéditeur en **option désactivée par défaut**, et jamais son email : la personne dont l'identité serait exposée est celle qui décide de l'exposer.
2. **Les réponses aux jetons invalides sont volontairement identiques.** Jeton inconnu, fichier supprimé et fichier refusé par le scan rendent exactement la même page. Distinguer les trois transformerait la page en oracle permettant de sonder des jetons. Seul `expired` fait exception, parce que le destinataire détenait déjà le lien.
3. **La route est limitée en débit dans Redis**, par jeton et par IP. Elle est non authentifiée et interrogée toutes les 2 secondes pendant l'attente de scan ; sans limite, c'est une surface de sondage — et c'est aussi la cible du test de charge, or mesurer une route non limitée ne dit rien de la production.

### Mesures de sécurisation

| Mesure | Détail |
|---|---|
| Mots de passe | bcrypt, jamais réversibles. Aucun mécanisme de récupération du mot de passe de fichier (US09) |
| Transport | HTTPS de bout en bout, y compris vers le stockage objet |
| Identifiants de stockage | Ne quittent jamais le serveur. Le client ne reçoit que des signatures à durée limitée |
| Validation | Client **et** serveur pour toute entrée utilisateur |
| Taille maximale | 1 Go, contrôlée par `HeadObject` **après** complétion |
| Types interdits | Liste noire d'extensions à l'initiation, puis contrôle des octets magiques par le worker — **lecture par plage (`Range: bytes=0-63`)**, pas de lecture complète |
| Antivirus | ClamAV sur les fichiers ≤ 50 Mo. L'objet entier ne sort de MinIO **que** pour le scan. Rien n'est téléchargeable avant l'état `ready` |
| Limitation de débit | Redis, sur la connexion et sur la route de téléchargement |
| Téléchargements | `Content-Disposition: attachment` **forcé** dans la signature |

### Deux pièges vérifiés expérimentalement

Ces deux points ont été validés contre MinIO `RELEASE.2025-09-07T16-13-09Z` avant l'écriture du code.

**Une URL PUT pré-signée ne contraint pas `Content-Length`.** Un client déclarant 1 Mio a téléversé **25 Mio** à travers une unique URL signée, et l'envoi a été accepté. S3 autorise jusqu'à 5 Go par partie. La taille déclarée n'est donc pas un contrôle : le seul contrôle réel est `HeadObject` après complétion, avec suppression de l'objet en cas de dépassement.

**Sans `Content-Disposition: attachment`, un fichier téléversé s'exécute dans le navigateur.** Un `.html` ou un `.svg` servi depuis l'origine du bucket devient du XSS stocké — que ni la liste noire d'extensions ni le contrôle des octets magiques n'attrapent. Le paramètre `response-content-disposition=attachment` est donc signé sur chaque URL de lecture. Vérifié : MinIO l'honore.

### Limites assumées

- **ClamAV plafonné à 50 Mo.** La limite de flux par défaut de `clamd` est très inférieure à 1 Go, et scanner un fichier de taille pleine obligerait le worker à extraire l'objet entier de MinIO, ce qui casserait la propriété « l'API ne touche jamais les octets » à la frontière du worker. Risque résiduel écrit, pas caché.

  **Conséquence sur la validation, et c'est une décision de conception à part entière :** le contrôle des octets magiques se fait par une **lecture par plage** (`GetObject` avec `Range: bytes=0-63`), car une signature de fichier tient dans les premiers octets. La lecture complète de l'objet n'a lieu **que** dans les branches qui appellent réellement ClamAV, donc jamais au-delà du plafond. Une lecture complète inconditionnelle aurait extrait un gigaoctet de MinIO même pour les fichiers que le scanner ignore ensuite, ce qui annulerait exactement l'économie que le plafond est censé apporter. Voir le diagramme 05a.
- **Les lignes fantômes conservent le nom du fichier pendant 7 jours** après expiration, pour que l'historique puisse afficher « expiré ».
- **Pas de récupération du mot de passe de fichier**, conformément à US09.

### Perspectives

SSO (OpenID Connect via Keycloak) et double authentification TOTP. Volontairement hors MVP : US03 et US04 exigent que l'application gère elle-même le hachage et l'émission du jeton, et déléguer aurait cédé la compétence évaluée. L'ajout d'une double authentification réintroduirait un service de messagerie pour l'enrôlement.

---

## 6 — Qualité, tests et maintenance

Le détail vit dans quatre fichiers à la racine du dépôt. Cette section en résume l'intention ; les résultats s'y ajouteront au fil de l'implémentation.

### TESTING.md

Objectif de couverture : **70 % de lignes, périmètre back-end**, imposé par un `coverageThreshold` Jest. L'uploader React est couvert par Cypress plutôt que par des tests unitaires, parce que sa valeur est dans l'enchaînement réel des requêtes, pas dans ses fonctions prises isolément.

Trois niveaux : unitaire (Jest), intégration (Supertest sur une base PostgreSQL jetable), bout en bout (Cypress, 2 à 3 scénarios).

Le plan de test détaillé, par page et par interaction, est dans `docs/test-plan.md`.

> **À COMPLÉTER** — rapport de couverture, capture d'écran, résultats d'exécution.

### SECURITY.md

Scan de vulnérabilités des dépendances (`npm audit`), chaque résultat documenté comme corrigé, accepté ou ignoré, avec la raison. Y figureront aussi les limites assumées de la section 5 et le compromis de minimisation des données des lignes fantômes.

> **À COMPLÉTER** — sortie du scan et analyse des décisions.

### PERF.md

Deux mesures distinctes, pour une raison précise :

1. **Test de charge k6 sur `GET /d/:token` + signature**, à 1 puis 3 réplicas, en rapportant le p95 et le taux d'erreur. C'est le vrai chemin chaud côté utilisateur.
2. **Mesure d'un téléversement de 800 Mo** : temps écoulé, CPU et mémoire résidente de l'API pendant le transfert, à mettre en regard du coût calculé d'un passage des mêmes octets par l'API.

Charger l'endpoint d'initiation aurait mesuré un HMAC et un `INSERT` : c'est justement parce que l'API ne touche pas aux octets que le débit ne s'y mesure pas.

Résultats, méthode et un correctif nginx trouvé en cours de mesure (SOC-06) : voir `PERF.md` à la racine.

Budget de performance côté front (poids du bundle, métriques navigateur) : hors périmètre de QA-06, non couvert.

Coût d'egress de la validation à documenter, avec la distinction qui compte : le contrôle des octets magiques est une **lecture par plage** de quelques dizaines d'octets, quelle que soit la taille du fichier ; seul le scan ClamAV extrait l'objet entier, et uniquement sous le plafond de 50 Mo. Un fichier de 1 Go coûte donc 64 octets d'egress de validation, pas 1 Go.

> **À COMPLÉTER** — résultats k6, mesure du téléversement, budget de bundle, captures de logs.

### MAINTENANCE.md

Procédures de mise à jour des dépendances, fréquence, risques. À documenter également : les quatre tâches planifiées et leurs constantes (purge à expiration quotidienne, purge des lignes fantômes à 7 jours, reaper des uploads abandonnés à 48 heures, remise en file des scans bloqués à 15 minutes), parce que ce sont les valeurs qu'un futur mainteneur devra comprendre avant d'y toucher.

> **À COMPLÉTER** — procédures rédigées après stabilisation des dépendances.

---

## 7 — Processus d'installation et d'exécution

Le README est un livrable distinct et détaillé ; cette section en donne l'essentiel.

### Prérequis

| Outil | Version | Remarque |
|---|---|---|
| Docker Engine | 24+ | Vérifié sur 29.1.3 |
| Docker Compose | v2 | `docker compose`, pas `docker-compose`. Vérifié sur 2.40.3 |
| Node.js | 20 LTS minimum | **Uniquement pour l'outillage hors conteneur.** Les conteneurs embarquent Node 22, donc la pile démarre même sous Node 18 en local. L'AWS SDK v3 avertit sous Node 18 et exigera Node 22 après janvier 2027 |
| k6 | dernière | Binaire Go, installé séparément — ce n'est pas un paquet npm |

Une conséquence de la ligne Node : `npm install` lancé **sur l'hôte** n'atteint pas le conteneur, parce que `node_modules` y vit dans un volume anonyme (c'est ce volume qui empêche les binaires natifs compilés pour l'hôte d'écraser ceux du conteneur). D'où la cible `make install s=api p=<paquet>`, qui installe au bon endroit et rappelle le `--renew-anon-volumes` nécessaire après modification de `package.json`.

### Commandes principales

```bash
git clone git@github.com:M0l42/OC-P4-Datashare.git && cd OC-P4-Datashare
make setup                # copie .env, construit, démarre, attend /api/health
make migrate              # prisma migrate deploy
make test                 # unitaires + intégration
make test-e2e             # Cypress
make down
```

`make setup` est le point d'entrée : il copie `.env.example` en `.env` s'il est absent, construit les images, démarre les services et **attend que `/api/health` réponde** avant de rendre la main, au lieu de supposer que la pile est prête. `make init-bucket` n'a pas à être appelée à la main — le conteneur éphémère `minio-init` l'exécute au démarrage ; la cible existe pour rejouer l'initialisation du stockage seule. `make help` liste les 22 cibles.

Un clone vierge suivi de `make setup` produit donc une pile fonctionnelle sans étape manuelle. C'est ce qui satisfait le livrable « scripts de déploiement » : `docker-compose.yml`, les cibles du Makefile, `prisma migrate deploy`, `scripts/init-bucket.sh` et un `.env.example` versionné.

**État vérifié au 11/08/2026** (commit `e20a09c`) : les 7 services démarrent, `/api/health` répond 200 à travers nginx sur 10 requêtes consécutives, le front est servi, et MinIO est joignable depuis l'hôte — ce dernier point n'est pas un confort de développement mais une exigence d'architecture, puisque le navigateur envoie les octets directement au stockage.

### Variables d'environnement

| Variable | Rôle |
|---|---|
| `DATABASE_URL` | Chaîne de connexion PostgreSQL |
| `REDIS_URL` | Connexion Redis |
| `JWT_SECRET` | Signature des jetons |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET` | Cible de stockage, vue **depuis l'API** (réseau interne) |
| `S3_PUBLIC_ENDPOINT` | Même stockage, vu **depuis le navigateur**. Voir l'encadré ci-dessous |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY` | Identifiants de stockage, jamais exposés au client |
| `PUBLIC_APP_ORIGIN` | Origine autorisée pour la politique CORS du bucket |
| `CLAMAV_HOST`, `CLAMAV_MAX_BYTES` | Cible et plafond de l'antivirus |

Aucune valeur d'hôte, de port ou d'identifiant n'est écrite en dur : tout passe par l'environnement, et aucun secret réel n'est versionné.

### Trois pièges de configuration à connaître

Les trois ont été rencontrés pour de bon pendant le montage de la pile, pas anticipés en théorie. Ils partagent un trait : **aucun ne produit d'erreur au démarrage.** Ils se manifestent plus tard, sur un cas d'usage réel.

#### 1. Deux adresses pour un seul stockage

`S3_ENDPOINT` vaut `http://minio:9000` : c'est ainsi que l'**API** joint le stockage, par le réseau interne Docker. Mais les URLs pré-signées sont consommées par le **navigateur**, qui ne sait pas résoudre le nom `minio`. Elles doivent donc porter une adresse joignable depuis l'extérieur, d'où `S3_PUBLIC_ENDPOINT`.

C'est la variable la plus facile à oublier, et son oubli casse *tous* les téléversements avec une erreur réseau opaque côté navigateur — l'API, elle, fonctionne parfaitement. C'est aussi la raison pour laquelle le port 9000 est publié dans `docker-compose.yml`.

#### 2. La durée de vie des uploads incomplets contredisait la reprise

MinIO abandonne de lui-même les uploads multipart incomplets au bout de **24 heures** (`stale_uploads_expiry`, balayage toutes les 6 h). Or la reprise d'un téléversement interrompu est annoncée sur **48 heures**. Le stockage aurait donc purgé les parties une journée entière avant le nettoyage applicatif : toute reprise tentée entre 24 h et 48 h aurait échoué en `NoSuchUpload`, pendant que la documentation et le test end-to-end prévu affirmaient le contraire.

`scripts/init-bucket.sh` porte ce réglage à **72 heures**, et non à 48 : un filet de sécurité doit se déclencher *après* le mécanisme principal, jamais avant. Le nettoyage applicatif garde ainsi l'autorité sur la fenêtre de reprise, et le stockage ne rattrape que les parties orphelines qu'aucune ligne en base ne référence plus.

Ce constat a également invalidé une affirmation du dossier de conception : la « règle de cycle de vie servant de filet de sécurité » n'en était pas une. Une règle de cycle de vie S3 ne sait pas expirer un upload multipart incomplet ; celle qui était posée concernait les marqueurs de suppression et n'avait aucun effet. `stale_uploads_expiry` est le seul levier réel.

#### 3. Le CORS de MinIO ne se configure pas comme sur S3

**L'écart est piégeux.** Vérifié expérimentalement :

- `PutBucketCors` renvoie `NotImplemented` — la politique CORS n'est **pas** configurable par l'API S3 ;
- MinIO **renvoie n'importe quelle origine** par défaut, donc un bug CORS ne peut pas se reproduire en local ;
- la variable d'environnement `MINIO_API_CORS_ALLOW_ORIGIN` **n'a aucun effet** ;
- seul `mc admin config set <alias> api cors_allow_origin='<origine>'` restreint réellement.

`scripts/init-bucket.sh` exécute donc cette commande, afin que la pile locale soit aussi restrictive que la production. Sans cela, on développe contre un serveur permissif et on découvre le problème sur le premier bucket réel.

**Symétriquement, en production**, la règle CORS du bucket doit déclarer `ExposeHeaders: ["ETag"]`. L'uploader lit l'`ETag` de chaque partie pour finaliser l'envoi ; MinIO expose tous les en-têtes par défaut, S3 et R2 n'en exposent aucun. Sans cette ligne, toutes les parties s'envoient correctement et `CompleteMultipartUpload` échoue, parce que le navigateur ne peut pas lire les `ETag`.

---

## 8 — Utilisation de l'IA dans le développement

### Posture adoptée

La règle du projet est explicite : l'IA générative ne peut développer **qu'une seule user story**, le reste doit être codé par moi. J'ai distingué trois cas, dont un seul est restreint :

1. **Code de user story écrit par l'IA** — exactement une story, tracée dans l'historique Git.
2. **IA en assistance pendant que j'écris** — explications, détection d'erreurs, revue de mon code, débogage. C'est moi qui écris, donc rien n'est « codé par l'IA ». La grille de soutenance valorise explicitement la capacité à superviser et à profiter de l'IA.
3. **Artefacts qui ne sont pas des user stories** — `docker-compose`, Makefile, configuration nginx et HAProxy, scripts d'initialisation, prose de README. Écrits par agent, relus par moi.

**Zone grise traitée par la transparence** : les suites de tests sont du code sans être une user story. Toute utilisation est consignée dans le Journal de l'IA, y compris celles envisagées puis écartées. Dire où j'ai placé la limite et pourquoi vaut mieux que de laisser la question ouverte.

### La user story confiée à l'IA : US06 (suppression d'un fichier)

Choisie **contre** US05, après reconsidération, pour le meilleur rapport entre complexité cachée et volume de code. Dans cette architecture, supprimer touche plus de pièces mobiles que n'importe quelle autre story :

- filtrage par propriétaire, sans quoi c'est une référence directe non sécurisée ;
- deux systèmes sans transaction commune (objet dans MinIO, ligne dans PostgreSQL) : l'ordre et la reprise sur échec partiel comptent ;
- `AbortMultipartUpload` pour les envois encore en vol ;
- un job de scan idempotent dont la cible peut disparaître ;
- idempotence de l'endpoint : un double clic ne doit pas produire de 500 ;
- la purge de US10 a besoin de la même logique.

**L'ordre est délibéré** : US06 est confiée **avant** l'écriture de la purge de US10, afin que l'IA possède le service de suppression partagé. Déléguer après aurait réduit la story à une clause de garde et un appel de méthode.

**Frontière avec US05, explicitée parce qu'elle traverse un composant React** : l'IA possède `FileDeletionService`, `DELETE /files/:id` et le composant `<ConfirmDeleteDialog>` (US06 exige une confirmation côté front). Le tableau d'historique de US05, écrit à la main, rend un emplacement que le composant de l'IA remplit. Deux commits marquent la frontière : `feat(ai): …` puis `fix: …` après revue.

**Implémenté le 2026-08-25.** Trace complète — décisions, questions posées à Nathan et ses réponses, ce qui a été construit, QA effectuée, limites constatées — dans `docs/journal-ia.md`. Résumé des quatre questions que la story elle-même posait :

- **Filtrage par propriétaire** : présent (`findFirst({ id, ownerId })` avant tout accès stockage), vérifié en direct (un second utilisateur reçoit 404 sur le fichier du premier).
- **Ordre de suppression** : stockage d'abord (objet ou avortement du multipart), ligne PostgreSQL ensuite — jamais l'inverse, pour ne pas perdre la trace d'un objet orphelin si l'étape stockage échoue.
- **Envois en vol avortés** : oui, `AbortMultipartUpload` sur `pending`, vérifié en direct sur un upload réellement initié.
- **Endpoint idempotent** : oui — double appel séquentiel testé en direct (204 puis 404, jamais 500) ; la course concurrente est couverte par des tests unitaires (Prisma `P2025`, S3 `NoSuchUpload`).

Deux décisions ont été posées à Nathan plutôt que tranchées seules : autoriser la suppression pendant `scanning` (compromis assumé, appuyé sur le `attempts: 3` déjà configuré dans `scan-queue.service.ts` et le garde `skipped` déjà présent dans `validation.service.ts`, sans modifier ni l'un ni l'autre) et autoriser la suppression anticipée des lignes fantômes (`expired`/`rejected`) via le même endpoint. Détail complet dans le journal.

### IA en conception

La conception de ce projet a été menée en dialogue avec un assistant, avec des revues croisées documentées : une revue de complétude contradictoire du document de conception (31 corrections sur 35 relevés), une revue de conception d'interface (complétude passée de 3/10 à 9/10) et une revue d'architecture (13 relevés, dont un défaut critique).

Le défaut critique mérite d'être cité, parce qu'il illustre ce que la supervision apporte réellement. La fonction de reprise d'upload, telle que spécifiée, permettait à un utilisateur re-sélectionnant un **autre** fichier de taille identique de produire un objet assemblé à partir de deux fichiers différents : l'envoi se terminait sans erreur, passait le contrôle de taille `HeadObject` (la taille était correcte) et livrait un fichier corrompu derrière un lien valide. Aucune erreur nulle part. Corrigé par une vérification d'identité (nom, taille, date de modification) puis la vérification d'un **échantillon** de parties par recalcul de somme de contrôle — un échantillon et non la totalité, parce que hacher 800 Mo bloquerait le fil d'exécution principal du navigateur pendant plusieurs secondes.

La trace complète des décisions et des revues est dans `docs/design-decisions.md`.

### IA sur le socle technique — SOC-01 à SOC-03 (11/08/2026, commit `e20a09c`)

Relève de la catégorie 3 ci-dessus : ce sont des artefacts d'infrastructure, pas des user stories. Confié en bloc, et consigné ici plutôt que dilué, parce que la transparence sur le périmètre est ce qui rend la catégorie 3 défendable.

**Confié** : `docker-compose.yml` (7 services), `Makefile` (22 cibles), `infra/nginx/nginx.conf`, `scripts/init-bucket.sh`, `.env.example`, les deux `Dockerfile` multi-étapes, l'amorçage NestJS (`main.ts`, `ValidationPipe` global, préfixe `/api`) et l'endpoint de liveness.

**Explicitement non confié** : `prisma/schema.prisma` ne déclare aucun modèle. Le modèle de données est SOC-04 et est écrit à la main — c'est le cœur du projet, pas de l'outillage. Le fichier ne contient qu'un en-tête rappelant les contraintes à respecter.

**Ce que la supervision a produit de concret.** Sept pièges ont été rencontrés, dont deux méritent d'être cités parce qu'ils ont *corrigé le dossier de conception* et non seulement le code :

- `stale_uploads_expiry` à 24 h contre une fenêtre de reprise annoncée à 48 h (détaillé en section 7). La conception affirmait une garantie que le stockage ne tenait pas. Le test end-to-end prévu aurait passé pour la mauvaise raison.
- La « règle de cycle de vie servant de filet de sécurité » mentionnée dans la conception n'existait pas : la règle réellement posée était sans effet, et s'ajoutait en double à chaque exécution du script.

Les cinq autres relèvent de l'exploitation et sont documentés en commentaire à l'endroit du code qui les corrige : résolution DNS des noms d'`upstream` par nginx, sonde de santé sur `localhost` contre écoute IPv4, `node_modules` en volume anonyme, `url = env(...)` refusé par Prisma 7 (version épinglée en 6), absence de `grep` dans l'image `minio/mc`.

**Limite constatée, notée honnêtement** : sur ces sept points, aucun n'a été anticipé — tous ont été trouvés en exécutant la pile et en *lisant la configuration effective* plutôt qu'en supposant que les valeurs par défaut correspondaient à l'intention. C'est la leçon transférable de cette tâche : les deux défauts les plus graves étaient des valeurs par défaut silencieuses, qui n'auraient produit aucune erreur avant qu'un utilisateur réel revienne le lendemain matin.
