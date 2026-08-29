# DataShare — Maintenance

Document vivant, écrit au fil de l'implémentation (voir `docs/design-decisions.md`,
prémisse 3) : ce qui suit décrit ce qui tourne réellement, pas un plan.

## Tâches planifiées

Quatre balayages tournent en continu, chacun avec sa propre fenêtre. Un futur
mainteneur qui touche à ces constantes doit d'abord comprendre ce qu'elles
protègent — voir le commentaire au-dessus de chacune dans le code source.

| Tâche | Fréquence | Fenêtre | Constante | Fichier |
|---|---|---|---|---|
| Purge des fichiers expirés (`ready` → `expired`, objet supprimé) | Quotidienne, 03:00 | — | `PURGE_SWEEP_CRON` | `backend/src/purge/purge.constants.ts` |
| Purge des lignes fantômes (`expired`/`rejected` anciennes, ligne supprimée) | Quotidienne, 03:00 (même passage) | 7 jours | `GHOST_ROW_TTL_DAYS` | idem |
| Reaper des uploads abandonnés (`pending` jamais complété) | Quotidienne, 03:00 (même passage) | 48 heures | `ABANDONED_UPLOAD_TTL_HOURS` | idem |
| Remise en file des scans bloqués (`scanning` dont le worker est mort) | Horaire | 15 minutes | `SCANNING_STALE_AFTER_MS` | `backend/src/scan/scan.constants.ts` |

Les trois premières sont un seul job BullMQ (`PurgeService.runDailySweep`,
planifié via `upsertJobScheduler` — redémarrer le conteneur `worker` ne crée
pas de second planning, BullMQ reconnaît le même id de job). La quatrième est
indépendante : un `setInterval` dans `ScanWorker`, pas un job BullMQ, hérité de
SOC-05.

**Vérifier qu'elles tournent** : `docker compose logs worker | grep -i "sweep\|purge\|scan worker started"`.
Chaque passage journalise le nombre de lignes traitées par étape
(`Expired N file(s)`, `Purged N ghost row(s)`, `Reaped N abandoned upload(s)`).

**Si une fenêtre doit changer** (ex. la reprise d'upload passe de 48 h à une
autre durée) : `ABANDONED_UPLOAD_TTL_HOURS` doit rester cohérente avec
`stale_uploads_expiry` de MinIO (voir `docs/design-decisions.md`, incident
documenté) — MinIO abandonne les uploads multipart incomplets au bout de
24 h par défaut ; le reaper applicatif doit toujours purger **avant** que
MinIO ne le fasse silencieusement, jamais après.

## Mise à jour des dépendances

**Fréquence** : à chaque `npm audit` haute sévérité touchant une dépendance de
production réellement importée (voir `SECURITY.md`), et sinon en debut de
chaque nouvelle phase de développement — pas de cadence automatisée
(Renovate/Dependabot) pour ce projet.

**Procédure** :

```bash
make install s=api  p=<paquet>@<version>   # ou s=front
docker compose up -d --build --renew-anon-volumes api   # ou front
make test && make test-e2e && make cypress
```

`node_modules` vit dans un volume anonyme (voir le commentaire dans
`docker-compose.yml`) : un `npm install` lancé sur l'hôte n'atteint jamais le
conteneur, d'où le `--renew-anon-volumes` après toute modification de
`package.json`.

**Risques spécifiques à surveiller à chaque montée de version** :

- **Prisma** (`@prisma/client` + `prisma`) : régénérer le client
  (`npx prisma generate`, déjà fait au build) et rejouer les migrations en dev
  (`make migrate-dev`) avant de merger — un changement de version mineure a
  déjà changé le format de certains types générés par le passé dans
  l'écosystème.
- **`@aws-sdk/*`** : le comportement de `getSignedUrl` (présignature, jamais
  d'appel réseau) et le format `UploadPartCommand`/`CompleteMultipartUpload`
  sont ce dont dépend tout le flux d'upload (`docs/documentation-technique.md`,
  §1) — une montée majeure exige de rejouer les trois scénarios Cypress
  (`make cypress`), pas seulement les tests unitaires mockés.
- **BullMQ** : les noms de files (`SCAN_QUEUE_NAME`, `PURGE_QUEUE_NAME`) et le
  format des jobs planifiés (`upsertJobScheduler`) sont sérialisés dans Redis
  — vérifier les notes de version avant une montée majeure, une file
  renommée silencieusement abandonnerait les jobs déjà planifiés.
- **Cypress** : ce projet tourne délibérément la CLI Cypress **dans le
  conteneur officiel `cypress/included`** (voir `Makefile`, cible `cypress`)
  et pas sur l'hôte, à cause d'une incompatibilité entre le loader `tsx`
  embarqué par Cypress 15 et Node 18 côté hôte. Toute montée de version de
  Cypress doit rester compatible avec cette contrainte, ou la lever
  explicitement si l'hôte passe un jour à Node 20+.

Versions de Node de référence pour les conteneurs applicatifs : **22-alpine**
(`backend/Dockerfile`, `frontend/Dockerfile`) — indépendant de la version de
Node installée sur l'hôte, qui n'exécute que les outils listés ci-dessus.

## Sauvegarde et restauration

Trois volumes Docker portent l'état persistant : `postgres_data` (utilisateurs,
fichiers, jetons), `minio_data` (octets des fichiers), `redis_data` (files
BullMQ avec persistance AOF activée — voir `docker-compose.yml`). `clamav_db`
ne contient que des signatures téléchargeables à nouveau, pas d'état à
sauvegarder.

```bash
# Sauvegarde (pile à l'arrêt pour la cohérence)
docker compose stop
docker run --rm -v datashare_postgres_data:/data -v "$(pwd)/backups:/backup" \
  alpine tar czf /backup/postgres-$(date +%Y%m%d).tar.gz -C /data .
docker run --rm -v datashare_minio_data:/data -v "$(pwd)/backups:/backup" \
  alpine tar czf /backup/minio-$(date +%Y%m%d).tar.gz -C /data .
docker compose start
```

Restauration : arrêter la pile, vider le volume cible, `tar xzf` l'archive
dedans, redémarrer. Redis n'a volontairement pas de procédure de sauvegarde :
son contenu (files de jobs, compteurs de limitation de débit à venir) est
entièrement reconstruit par l'application au redémarrage, rien n'y est source
de vérité.

## Diagnostics courants

| Symptôme | Cause probable | Vérification |
|---|---|---|
| `GET /d/:token` répond 502 par intermittence sous charge | Épuisement des ports éphémères nginx (voir `PERF.md`, mesure 1) — pas un problème d'API ou de réplica | `docker compose logs nginx \| grep "Address not available"` |
| Un réplica reste `UP` dans les stats HAProxy alors que Postgres est injoignable | Mauvaise sonde de santé configurée (déjà corrigé, voir `infra/haproxy/haproxy.cfg` — doit cibler `/api/health/ready`, jamais `/api/health`) | `curl localhost:8404/;csv \| grep ^api-` |
| Le conteneur `worker` met plusieurs minutes à répondre `healthy` au premier démarrage | ClamAV télécharge sa base de signatures (plusieurs centaines de Mo, une seule fois grâce au volume `clamav_db`) | `docker compose logs clamav` |
| `make cypress` échoue avec une erreur liée à `tsx` | Cypress lancé avec le Node de l'hôte au lieu du conteneur `cypress/included` | Vérifier que `make cypress` (pas `npx cypress` directement) est bien utilisé |
| `docker compose build` échoue avec `permission denied` sur `frontend/cypress/downloads` ou `screenshots` | Fichiers laissés root-owned par un run Cypress conteneurisé précédent | `docker run --rm -v "$(pwd)/frontend/cypress:/c" alpine chown -R $(id -u):$(id -g) /c` |
