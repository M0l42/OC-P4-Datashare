# DataShare : Documentation technique

**Projet** : plateforme de transfert sécurisé de fichiers (MVP)
**Auteur** : Nathan Boukobza
**Date** : août 2026
**Dépôt** : https://github.com/M0l42/OC-P4-Datashare

> **Convention de lecture** : tous les chiffres cités (couverture de tests, mesures de charge, temps d'analyse antivirale) proviennent d'exécutions réelles contre la pile locale, pas d'estimations. Chaque section indique le fichier de suivi où la mesure est détaillée.

---

## Sommaire

1. [Architecture de l'application](#1-architecture-de-lapplication)
2. [Choix technologiques justifiés](#2-choix-technologiques-justifiés)
3. [Modèle de données](#3-modèle-de-données)
4. [Documentation d'API](#4-documentation-dapi)
5. [Sécurité et gestion des accès](#5-sécurité-et-gestion-des-accès)
6. [Qualité, tests et maintenance](#6-qualité-tests-et-maintenance)
7. [Processus d'installation et d'exécution](#7-processus-dinstallation-et-dexécution)
8. [Utilisation de l'IA dans le développement](#8-utilisation-de-lia-dans-le-développement)

---

## 1. Architecture de l'application

![Architecture logicielle](diagrams/OC_P4_Diagram_1.png)

*Diagramme 1 : architecture logicielle.*

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
| ClamAV | Analyse antivirale de tous les fichiers acceptés (plafond de scan aligné sur le plafond d'envoi, 1 Gio) | S2 |
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

## 2. Choix technologiques justifiés

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
| File de tâches | **BullMQ sur Redis** | node-cron, tâches en base | Nécessaire pour la validation post-upload, les purges quotidiennes et le reaper. Redis sert aussi de support à la limitation de débit, qui doit être partagée puisque l'API tourne en plusieurs réplicas. |
| Authentification | **JWT émis par l'application, bcrypt** | Keycloak, OAuth2 délégué | US03 et US04 exigent le hachage salé du mot de passe dans notre base et l'émission du jeton. Déléguer à Keycloak aurait cédé une compétence évaluée en échange du conteneur le plus lourd de la pile. |
| Documentation d'API | **`@nestjs/swagger`** | Markdown rédigé à la main | La spécification OpenAPI est générée depuis les DTO déjà écrits pour la validation, donc elle ne peut pas se désynchroniser du code. |
| Journalisation | **`nestjs-pino`** | Logger NestJS par défaut | PERF.md exige des logs structurés et des métriques ; du JSON corrélé par identifiant de requête est exploitable, du texte libre ne l'est pas. |
| Antivirus | **ClamAV, plafond de scan à 1 Gio** | Aucun scan, service tiers | Un produit dont la promesse est la sécurité doit pouvoir répondre à « comment empêchez-vous la diffusion de malware ». Le plafond de scan est aligné sur le plafond d'envoi, donc **tout fichier accepté par l'application est analysé**. Le réglage de `clamd` qui rend cela possible est versionné dans `infra/clamav/clamd.conf`. |
| Tests | **Jest, Supertest, Cypress** | Vitest, Playwright | Jest est l'outil par défaut de NestJS. Supertest couvre le niveau intégration exigé par la mission. Cypress est nommé dans la spécification. |
| Charge | **k6** | Artillery, JMeter | Nommé dans la spécification. C'est un binaire Go qui exécute des scripts JavaScript : ce n'est pas un paquet npm et il ne tourne pas sur Node, ce qui est à savoir avant de l'annoncer comme « du même écosystème ». |
| Orchestration | **Docker Compose + Makefile** | Scripts shell, exécution manuelle | Répond directement au livrable « scripts de déploiement ». Un `make up` qui part d'un clone vierge est aussi la démonstration la plus convaincante en soutenance. |
| Outillage | Git avec Conventional Commits, WebStorm, ESLint + Prettier, npm | Aucune | Conventional Commits est un bonus annoncé par la spécification, et le passage de relais à l'IA sur US06 doit être lisible dans l'historique (`feat(ai):` puis `fix:`). |

### Ce qui a été délibérément écarté

- **US07 (dépôt anonyme)** : retiré. La prise en charge mobile complète impose la reprise d'upload, et l'arbitrage a donné la priorité à la reprise. Conséquence : `proprietaire_id` reste NOT NULL.
- **SSE / WebSockets pour l'attente de scan** : une interrogation périodique est proportionnée à une attente de quelques secondes ; un second transport et une logique de reconnexion derrière un répartiteur de charge ne l'auraient pas été.

---

## 3. Modèle de données

![Modèle conceptuel de données](diagrams/OC_P4_Diagram_2.png)

*Diagramme 2 : modèle conceptuel de données.*

### Deux entités, une association

`UTILISATEUR` (0,N) ── POSSÈDE ── (1,1) `FICHIER`

Un fichier appartient à exactement un utilisateur. Un utilisateur peut n'avoir aucun fichier, ce qui est l'état initial après inscription et correspond à l'écran vide de « Mon espace ».

### `FICHIER.etat` est le centre du modèle

L'invariant de sécurité du produit, *un lien de téléchargement ne résout que dans l'état `ready`*, est porté par une colonne, pas par des contrôles applicatifs dispersés. Sept états : `pending`, `uploaded`, `scanning`, `ready`, `rejected`, `expired`, `abandoned`.

![Machine à états : FICHIER.etat](diagrams/OC_P4_Diagram_3.png)

*Diagramme 3 : machine à états.*

### Une contradiction de la spécification, et sa résolution

US01 et US10 exigent la suppression du fichier **et de ses métadonnées** à l'expiration. US05 exige que l'historique affiche « l'état du lien (valide ou expiré) », et les maquettes confirment cette intention : une ligne « Expiré » accompagnée de « Ce fichier a expiré, il n'est plus stocké chez nous », et un sélecteur Tous / Actifs dont l'existence n'a de sens que si des lignes expirées subsistent.

Supprimer la ligne rend « expiré » inaffichable. La résolution retenue :

1. À l'expiration : l'objet est supprimé de MinIO, `cle_stockage` et `mot_de_passe_hash` sont vidés, l'état passe à `expired`. La ligne subsiste avec le nom, la taille et les dates.
2. **Sept jours plus tard**, la ligne est purgée par une seconde passe.

La fenêtre de 7 jours reprend la durée de vie que le produit enseigne déjà à l'utilisateur (« conservé chez nous pendant une semaine ») : la trace vit exactement aussi longtemps que le fichier a vécu. Le compromis de minimisation des données est écrit dans SECURITY.md.

### Index

`(etat, expire_le)`, `(etat, cree_le)`, `jeton_telechargement` (unique), `proprietaire_id`. Trois tâches planifiées balaient quotidiennement les deux premiers couples ; sans index, chacune fait un parcours complet de table.

---

## 4. Documentation d'API

### Où se trouve la spécification

La spécification OpenAPI est **générée** par `@nestjs/swagger` depuis les DTO de validation, et exposée à `/api/docs` (UI Swagger) et `/api/docs-json` (document brut). Elle ne peut pas diverger du code, puisqu'elle en est dérivée.

L'export est versionné dans `docs/api/openapi.json` (regénérable avec `curl http://localhost:8080/api/docs-json`, stack démarrée), et une capture de l'UI Swagger vit dans `docs/api/swagger-ui.png` :

![Swagger UI de l'API DataShare](api/swagger-ui.png)

### Séquence de téléversement

![Séquence de téléversement (multipart pré-signé)](diagrams/OC_P4_Diagram_4.png)

*Diagramme 4 : séquence de téléversement.*

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

## 5. Sécurité et gestion des accès

### Authentification

Email et mot de passe, haché avec **bcrypt** (salage inclus par construction). À la connexion, l'application émet un **JWT** qu'elle signe elle-même. Aucun rôle ni permission : US03 précise qu'aucun profil administrateur n'est nécessaire dans le MVP. Le seul contrôle d'autorisation est donc la **propriété** : toute requête sur un fichier est filtrée par `proprietaire_id`.

L'absence de ce filtre serait une référence directe non sécurisée à un objet : n'importe quel utilisateur authentifié pourrait supprimer le fichier d'un autre. C'est le premier point vérifié lors de la revue du code de US06, confié à l'IA.

### Le destinataire n'est pas authentifié

![Séquence de téléchargement (05b)](diagrams/OC_P4_Diagram_5b.png)

*Diagramme 5b : séquence de téléchargement.*

C'est le point de sécurité le plus intéressant du produit. La seule autorisation d'accès au fichier est un **jeton imprédictible et unique** dans l'URL. Trois conséquences assumées :

1. **Tout ce que la page affiche est visible de quiconque détient le lien.** D'où le nom de l'expéditeur en **option désactivée par défaut**, et jamais son email : la personne dont l'identité serait exposée est celle qui décide de l'exposer.
2. **Les réponses aux jetons invalides sont volontairement identiques.** Jeton inconnu, fichier supprimé et fichier refusé par le scan rendent exactement la même page. Distinguer les trois transformerait la page en oracle permettant de sonder des jetons. Seul `expired` fait exception, parce que le destinataire détenait déjà le lien.
3. **La route est limitée en débit dans Redis**, par jeton et par IP. Elle est non authentifiée et interrogée toutes les 2 secondes pendant l'attente de scan. Sans limite, c'est une surface de sondage. C'est aussi la cible du test de charge, or mesurer une route non limitée ne dit rien de la production.

### Mesures de sécurisation

| Mesure | Détail |
|---|---|
| Mots de passe | bcrypt, jamais réversibles. Aucun mécanisme de récupération du mot de passe de fichier (US09) |
| Transport | HTTPS de bout en bout, y compris vers le stockage objet |
| Identifiants de stockage | Ne quittent jamais le serveur. Le client ne reçoit que des signatures à durée limitée |
| Validation | Client **et** serveur pour toute entrée utilisateur |
| Taille maximale | 1 Go, contrôlée par `HeadObject` **après** complétion |
| Types interdits | Liste noire d'extensions à l'initiation, puis contrôle des octets magiques par le worker : **lecture par plage (`Range: bytes=0-63`)**, pas de lecture complète |
| Antivirus | ClamAV sur **tous les fichiers acceptés** (plafond de scan à 1 Gio, égal au plafond d'envoi). L'objet entier ne sort de MinIO **que** pour le scan, et uniquement vers le worker. Rien n'est téléchargeable avant l'état `ready` |
| Limitation de débit | Redis, sur la connexion et sur la route de téléchargement |
| Téléchargements | `Content-Disposition: attachment` **forcé** dans la signature |

### Deux pièges vérifiés expérimentalement

Ces deux points ont été validés contre MinIO `RELEASE.2025-09-07T16-13-09Z` avant l'écriture du code.

**Une URL PUT pré-signée ne contraint pas `Content-Length`.** Un client déclarant 1 Mio a téléversé **25 Mio** à travers une unique URL signée, et l'envoi a été accepté. S3 autorise jusqu'à 5 Go par partie. La taille déclarée n'est donc pas un contrôle : le seul contrôle réel est `HeadObject` après complétion, avec suppression de l'objet en cas de dépassement.

**Sans `Content-Disposition: attachment`, un fichier téléversé s'exécute dans le navigateur.** Un `.html` ou un `.svg` servi depuis l'origine du bucket devient du XSS stocké, que ni la liste noire d'extensions ni le contrôle des octets magiques n'attrapent. Le paramètre `response-content-disposition=attachment` est donc signé sur chaque URL de lecture. Vérifié : MinIO l'honore.

### Couverture de l'analyse antivirale : aucun fichier accepté n'y échappe

**Le plafond de scan ClamAV (`CLAMAV_MAX_SCAN_BYTES`) est à 1 Gio, soit exactement le plafond d'envoi (`MAX_FILE_SIZE_BYTES`).** Les deux constantes sont identiques à l'octet près, et le plafond d'envoi est appliqué deux fois : sur la taille déclarée à l'initiation, puis sur la taille réelle par `HeadObject` après complétion, avec suppression de l'objet en cas de dépassement. Aucun fichier stocké ne peut donc dépasser le plafond de scan, et **tout fichier accepté est analysé**.

La branche `sizeBytes > CLAMAV_MAX_SCAN_BYTES` de `validation.service.ts` subsiste mais est **inatteignable en l'état**. Elle est conservée comme garde-fou : si le plafond d'envoi était relevé sans que celui du scan le soit, le service continuerait de livrer des fichiers en `ready` au lieu d'échouer, et le trou se rouvrirait silencieusement. Les deux constantes doivent être modifiées ensemble, et `infra/clamav/clamd.conf` avec elles.

Ce plafond n'a jamais été une limite technique de `clamd`. Ses propres plafonds (`StreamMaxLength`, `MaxFileSize`, `MaxScanSize`) valent 100 Mo par défaut et rejetteraient silencieusement un flux plus gros ; ils sont portés à 1200 Mo dans `infra/clamav/clamd.conf`, volontairement **au-dessus** du plafond applicatif, pour que `clamd` ne soit jamais la cause d'un rejet.

**Mesuré** (2026-08-30, pile locale) : un fichier sain de 1000 Mo est analysé en **74,7 s**, avec un pic CPU d'environ 175 % et une mémoire du conteneur `clamav` de 1,0 à 1,2 Gio, cohérent avec un flux `INSTREAM` qui doit être entièrement reçu avant verdict. La détection reste effective à cette échelle : une signature placée au **dernier octet** d'un fichier de ~950 Mo est détectée en 37,2 s. Le délai d'attente du client est passé de 60 s à 180 s en conséquence (`clamav.client.ts`) ; sans cette marge, un scan sain de 1 Gio expirait côté client et transformait un fichier propre en faux rejet. Détail complet, y compris le faux négatif EICAR et son explication, dans `SECURITY.md`.

**Ordre des deux étapes, et c'est une décision de conception à part entière :** le contrôle des octets magiques se fait par une **lecture par plage** (`GetObject` avec `Range: bytes=0-63`), car une signature de fichier tient dans les premiers octets. Il s'exécute **avant** ClamAV et refuse le fichier sans jamais lire l'objet entier. L'extraction complète depuis MinIO n'a lieu que dans la branche qui appelle réellement le scanner. Cette extraction est portée par le **worker**, jamais par l'API : c'est précisément la raison pour laquelle le scan tourne dans un conteneur séparé, et la propriété « l'API ne touche jamais les octets » reste intacte.

![Séquence de validation (05a)](diagrams/OC_P4_Diagram_5a.png)

*Diagramme 5a : séquence de validation.*

### Limites assumées

- **Le délai d'analyse est visible par l'utilisateur** : environ 75 secondes pour un fichier de 1 Go, pendant lesquelles le lien existe mais n'est pas encore utilisable. C'est le prix de la couverture intégrale décrite ci-dessus. Le worker le porte seul, donc l'API reste disponible.
- **Les lignes fantômes conservent le nom du fichier pendant 7 jours** après expiration, pour que l'historique puisse afficher « expiré ».
- **Pas de récupération du mot de passe de fichier**, conformément à US09.

---

## 6. Qualité, tests et maintenance

Le détail vit dans quatre fichiers à la racine du dépôt. Cette section en résume l'intention ; les résultats s'y ajouteront au fil de l'implémentation.

### TESTING.md

Objectif de couverture : **70 % de lignes, périmètre back-end**, imposé par un `coverageThreshold` Jest. L'uploader React est couvert par Cypress plutôt que par des tests unitaires, parce que sa valeur est dans l'enchaînement réel des requêtes, pas dans ses fonctions prises isolément.

Trois niveaux : unitaire (Jest), intégration (Supertest sur une base PostgreSQL jetable), bout en bout (Cypress, 2 à 3 scénarios).

Le plan de test détaillé, par page et par interaction, est dans `docs/test-plan.md`.

Rapport de couverture, décompte par niveau et résultats d'exécution : voir `TESTING.md` à la racine. Résultat courant : 96,42 % de lignes (objectif 70 %), 121 tests unitaires, 34 tests d'intégration, 3 scénarios Cypress.

### SECURITY.md

Scan de vulnérabilités des dépendances (`npm audit`), chaque résultat documenté comme corrigé, accepté ou ignoré, avec la raison. Y figurent aussi les limites assumées de la section 5 et le compromis de minimisation des données des lignes fantômes.

Résultat courant (QA-05) : 3 vulnérabilités hautes back-end, toutes le même CVE (`deepmerge-ts`), atteignables uniquement via le CLI `prisma` en développement, jamais en production. Décision : acceptées, raison détaillée dans `SECURITY.md`. Front : 0 vulnérabilité.

### PERF.md

Deux mesures distinctes, pour une raison précise :

1. **Test de charge k6 sur `GET /d/:token` + signature**, à 1 puis 3 réplicas, en rapportant le p95 et le taux d'erreur. C'est le vrai chemin chaud côté utilisateur.
2. **Mesure d'un téléversement de 800 Mo** : temps écoulé, CPU et mémoire résidente de l'API pendant le transfert, à mettre en regard du coût calculé d'un passage des mêmes octets par l'API.

Charger l'endpoint d'initiation aurait mesuré un HMAC et un `INSERT` : c'est justement parce que l'API ne touche pas aux octets que le débit ne s'y mesure pas.

Résultats, méthode et un correctif nginx trouvé en cours de mesure (SOC-06) : voir `PERF.md` à la racine, §1 et §2.

Budget de performance côté front (poids du bundle, score Lighthouse, QA-07) : `PERF.md` §3. Bundle JS conforme au budget fixé (130,8 Ko gzip < 200 Ko) ; accessibilité Lighthouse 100 après le correctif de contraste de QA-09.

Coût d'egress de la validation, la distinction qui compte : le contrôle des octets magiques est une **lecture par plage** de quelques dizaines d'octets, quelle que soit la taille du fichier. Un fichier dont l'extension est usurpée est donc refusé pour 64 octets d'egress, sans que l'objet ne sorte jamais de MinIO. Seul le scan ClamAV extrait l'objet entier, et cette extraction est portée par le worker, pas par l'API. Depuis l'alignement du plafond de scan sur le plafond d'envoi (1 Gio), tout fichier qui passe l'étape des octets magiques est bien intégralement analysé : le coût d'egress de validation est assumé, et sa contrepartie est qu'aucun fichier accepté n'échappe à l'antivirus.

### MAINTENANCE.md

Procédures de mise à jour des dépendances, fréquence, risques. Documente aussi les quatre tâches planifiées et leurs constantes (purge à expiration quotidienne, purge des lignes fantômes à 7 jours, reaper des uploads abandonnés à 48 heures, remise en file des scans bloqués à 15 minutes), la sauvegarde/restauration des volumes, et un tableau de diagnostics courants. Voir `MAINTENANCE.md` à la racine.

---

## 7. Processus d'installation et d'exécution

Le README est un livrable distinct et détaillé ; cette section en donne l'essentiel.

### Prérequis

| Outil | Version | Remarque |
|---|---|---|
| Docker Engine | 24+ | Vérifié sur 29.1.3 |
| Docker Compose | v2 | `docker compose`, pas `docker-compose`. Vérifié sur 2.40.3 |
| Node.js | 20 LTS minimum | **Uniquement pour l'outillage hors conteneur.** Les conteneurs embarquent Node 22, donc la pile démarre même sous Node 18 en local. L'AWS SDK v3 avertit sous Node 18 et exigera Node 22 après janvier 2027 |
| k6 | dernière | Binaire Go, installé séparément : ce n'est pas un paquet npm |

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

`make setup` est le point d'entrée : il copie `.env.example` en `.env` s'il est absent, construit les images, démarre les services et **attend que `/api/health` réponde** avant de rendre la main, au lieu de supposer que la pile est prête. `make init-bucket` n'a pas à être appelée à la main : le conteneur éphémère `minio-init` l'exécute au démarrage ; la cible existe pour rejouer l'initialisation du stockage seule. `make help` liste les 22 cibles.

Un clone vierge suivi de `make setup` produit donc une pile fonctionnelle sans étape manuelle. C'est ce qui satisfait le livrable « scripts de déploiement » : `docker-compose.yml`, les cibles du Makefile, `prisma migrate deploy`, `scripts/init-bucket.sh` et un `.env.example` versionné.

**État vérifié au 11/08/2026** (commit `e20a09c`) : les 7 services démarrent, `/api/health` répond 200 à travers nginx sur 10 requêtes consécutives, le front est servi, et MinIO est joignable depuis l'hôte. Ce dernier point n'est pas un confort de développement mais une exigence d'architecture, puisque le navigateur envoie les octets directement au stockage.

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
| `CLAMAV_HOST`, `CLAMAV_PORT` | Cible de l'antivirus. Le plafond de scan n'est pas une variable d'environnement : il est fixé par `CLAMAV_MAX_SCAN_BYTES` (`scan.constants.ts`) et doit rester cohérent avec `infra/clamav/clamd.conf` |

Aucune valeur d'hôte, de port ou d'identifiant n'est écrite en dur : tout passe par l'environnement, et aucun secret réel n'est versionné.

### Trois pièges de configuration à connaître

Les trois ont été rencontrés pour de bon pendant le montage de la pile, pas anticipés en théorie. Ils partagent un trait : **aucun ne produit d'erreur au démarrage.** Ils se manifestent plus tard, sur un cas d'usage réel.

#### 1. Deux adresses pour un seul stockage

`S3_ENDPOINT` vaut `http://minio:9000` : c'est ainsi que l'**API** joint le stockage, par le réseau interne Docker. Mais les URLs pré-signées sont consommées par le **navigateur**, qui ne sait pas résoudre le nom `minio`. Elles doivent donc porter une adresse joignable depuis l'extérieur, d'où `S3_PUBLIC_ENDPOINT`.

C'est la variable la plus facile à oublier, et son oubli casse *tous* les téléversements avec une erreur réseau opaque côté navigateur, alors que l'API, elle, fonctionne parfaitement. C'est aussi la raison pour laquelle le port 9000 est publié dans `docker-compose.yml`.

#### 2. La durée de vie des uploads incomplets contredisait la reprise

MinIO abandonne de lui-même les uploads multipart incomplets au bout de **24 heures** (`stale_uploads_expiry`, balayage toutes les 6 h). Or la reprise d'un téléversement interrompu est annoncée sur **48 heures**. Le stockage aurait donc purgé les parties une journée entière avant le nettoyage applicatif : toute reprise tentée entre 24 h et 48 h aurait échoué en `NoSuchUpload`, pendant que la documentation et le test end-to-end prévu affirmaient le contraire.

`scripts/init-bucket.sh` porte ce réglage à **72 heures**, et non à 48 : un filet de sécurité doit se déclencher *après* le mécanisme principal, jamais avant. Le nettoyage applicatif garde ainsi l'autorité sur la fenêtre de reprise, et le stockage ne rattrape que les parties orphelines qu'aucune ligne en base ne référence plus.

Ce constat a également invalidé une affirmation du dossier de conception : la « règle de cycle de vie servant de filet de sécurité » n'en était pas une. Une règle de cycle de vie S3 ne sait pas expirer un upload multipart incomplet ; celle qui était posée concernait les marqueurs de suppression et n'avait aucun effet. `stale_uploads_expiry` est le seul levier réel.

#### 3. Le CORS de MinIO ne se configure pas comme sur S3

**L'écart est piégeux.** Vérifié expérimentalement :

- `PutBucketCors` renvoie `NotImplemented` : la politique CORS n'est **pas** configurable par l'API S3 ;
- MinIO **renvoie n'importe quelle origine** par défaut, donc un bug CORS ne peut pas se reproduire en local ;
- la variable d'environnement `MINIO_API_CORS_ALLOW_ORIGIN` **n'a aucun effet** ;
- seul `mc admin config set <alias> api cors_allow_origin='<origine>'` restreint réellement.

`scripts/init-bucket.sh` exécute donc cette commande, afin que la pile locale soit aussi restrictive que la production. Sans cela, on développe contre un serveur permissif et on découvre le problème sur le premier bucket réel.

**Symétriquement, en production**, la règle CORS du bucket doit déclarer `ExposeHeaders: ["ETag"]`. L'uploader lit l'`ETag` de chaque partie pour finaliser l'envoi ; MinIO expose tous les en-têtes par défaut, S3 et R2 n'en exposent aucun. Sans cette ligne, toutes les parties s'envoient correctement et `CompleteMultipartUpload` échoue, parce que le navigateur ne peut pas lire les `ETag`.

---

## 8. Utilisation de l'IA dans le développement

Le projet impose une limite explicite : l'IA générative ne pouvait développer qu'une seule user story, le reste étant codé par moi.

### La user story confiée à l'IA : US06 (suppression d'un fichier)

Choisie pour sa complexité cachée : filtrage par propriétaire (sans quoi c'est une référence directe non sécurisée), deux systèmes sans transaction commune (l'objet dans MinIO, la ligne dans PostgreSQL), `AbortMultipartUpload` pour les envois encore en vol, et l'idempotence de l'endpoint.

J'ai relu le code, puis vérifié le comportement moi-même plutôt que de me fier à la seule lecture. L'idée de départ était de passer par l'écran « Mon espace », mais il n'existait pas encore à ce stade du projet : j'ai donc envoyé les requêtes directement à l'API (`curl`), en plus de faire tourner la suite de tests. Résultats :

- un second utilisateur reçoit 404 sur le fichier du premier ;
- un double appel séquentiel renvoie 204 puis 404, jamais 500.

La revue croisée du code a aussi mis au jour un défaut critique en conception : la fonction de reprise d'upload, telle que spécifiée, permettait à un utilisateur de fusionner deux fichiers différents de même taille en un objet corrompu, sans qu'aucune erreur ne se déclenche nulle part. Corrigé par une vérification d'identité (nom, taille, date de modification) suivie d'un contrôle par échantillon de sommes de contrôle.

Trace complète des décisions et de la revue dans `docs/journal-ia.md`.
