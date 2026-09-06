# DataShare : Tests

Document vivant, écrit au fil de l'implémentation (voir `docs/design-decisions.md`,
prémisse 3). Trois niveaux, chacun avec son propre but, voir `docs/test-plan.md`
pour le détail page par page et interaction par interaction.

## Unitaire (Jest)

125 tests, 22 suites, tous passants. Cible `src/**/*.spec.ts`, `make test`.

## Intégration (Supertest)

37 tests, 7 suites, contre une base PostgreSQL jetable : `app`, `files`,
`download`, `scan`, `purge`, `file-deletion`, `file-history`. Cible
`test/*.e2e-spec.ts`, `make test-e2e`.

## Bout en bout (Cypress)

3 scénarios critiques, contre la pile réelle (`make up` puis `make cypress`) :

1. **Chemin heureux** — inscription, connexion, envoi, lien de téléchargement.
2. **Rejet au scan** — un fichier dont le contenu contredit l'extension est
   refusé ; jamais de lien de téléchargement émis.
3. **Reprise d'un envoi interrompu (US01-R)** — rechargement en cours
   d'envoi, reprise avec le même fichier, téléchargement vérifié octet pour
   octet par somme MD5.

Tourne dans le conteneur officiel `cypress/included`, jamais avec le Node de
l'hôte — voir `MAINTENANCE.md` pour la raison (incompatibilité du loader
`tsx` de Cypress 15 avec Node 18).

## Couverture — objectif ≥ 70 % de lignes, back-end

Seuil réellement imposé, pas juste visé : `coverageThreshold.global.lines`
dans `backend/package.json` (`jest --coverage` échoue en dessous de 70 %).
`.module.ts` et `main.ts` sont exclus du calcul (`coveragePathIgnorePatterns`)
— fichiers de câblage NestJS et bootstrap, choix méthodologique disclosé, pas
une façon de gonfler le chiffre.

**Résultat courant : 96,53 % de lignes.** Re-généré le 2026-09-06 (remplace le
96,47 % précédent) après l'ajout de `DownloadThrottlerGuard` et de ses trois
tests : un fichier neuf entièrement couvert fait mécaniquement remonter la
moyenne globale, ce n'est pas resté identique par coïncidence.

```
$ make test-cov
------------------------------|---------|----------|---------|---------|-------------------
File                          | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
------------------------------|---------|----------|---------|---------|-------------------
All files                     |   96.52 |    78.63 |   90.67 |   96.53 |
 src                          |     100 |       75 |     100 |     100 |
  app.controller.ts           |     100 |       75 |     100 |     100 | 6
  app.service.ts              |     100 |      100 |     100 |     100 |
 src/auth                     |     100 |    80.76 |     100 |     100 |
  auth.controller.ts          |     100 |       75 |     100 |     100 | 26-49
  auth.service.ts             |     100 |    85.71 |     100 |     100 | 21
 src/auth/dto                 |     100 |      100 |     100 |     100 |
  login.dto.ts                |     100 |      100 |     100 |     100 |
  register.dto.ts             |     100 |      100 |     100 |     100 |
 src/auth/guards              |     100 |      100 |     100 |     100 |
  jwt-auth.guard.ts           |     100 |      100 |     100 |     100 |
 src/auth/strategies          |     100 |       75 |     100 |     100 |
  jwt.strategy.ts             |     100 |       75 |     100 |     100 | 8
 src/download                 |   98.48 |    85.18 |     100 |   98.33 |
  download-throttler.guard.ts |     100 |    78.57 |     100 |     100 | 24,36
  download.controller.ts      |     100 |       80 |     100 |     100 | 30,78
  download.service.ts         |   97.05 |       90 |     100 |   96.87 | 74
 src/download/dto             |     100 |      100 |     100 |     100 |
  verify-password.dto.ts      |     100 |      100 |     100 |     100 |
 src/files                    |   95.34 |    74.82 |   94.28 |      95 |
  file-deletion.controller.ts |     100 |     62.5 |     100 |     100 | 27-44
  file-deletion.service.ts    |   94.73 |    84.37 |     100 |   94.44 | 64,102
  file-history.controller.ts  |     100 |    66.66 |     100 |     100 | 20-31
  files.controller.ts         |     100 |    59.37 |     100 |     100 | 32-120
  files.service.ts            |   92.77 |    83.01 |    87.5 |    92.4 | 124,156,213-225
  upload.constants.ts         |     100 |       50 |     100 |     100 | 33
 src/files/dto                |   95.65 |      100 |       0 |   95.65 |
  complete-upload.dto.ts      |    87.5 |      100 |       0 |    87.5 | 24
  initiate-upload.dto.ts      |     100 |      100 |     100 |     100 |
  list-files-query.dto.ts     |     100 |      100 |     100 |     100 |
 src/health                   |     100 |       75 |     100 |     100 |
  health.controller.ts        |     100 |       75 |     100 |     100 | 9
 src/prisma                   |   83.33 |      100 |       0 |      75 |
  prisma.service.ts           |   83.33 |      100 |       0 |      75 | 10
 src/purge                    |   98.71 |    73.07 |    92.3 |   98.61 |
  purge-queue.service.ts      |     100 |       75 |     100 |     100 | 26
  purge.constants.ts          |     100 |      100 |     100 |     100 |
  purge.service.ts            |     100 |    71.42 |     100 |     100 | 27-51
  purge.worker.ts             |      95 |       75 |      80 |   94.44 | 41
 src/scan                     |   93.75 |    81.94 |   78.57 |   94.55 |
  clamav.client.ts            |   96.15 |    77.77 |   88.88 |     100 | 25-27,58
  magic-bytes.ts              |    92.3 |    83.33 |     100 |   91.66 | 36
  redis.config.ts             |     100 |      100 |     100 |     100 |
  scan-queue.service.ts       |   61.53 |       75 |       0 |   54.54 | 14-41
  scan.constants.ts           |     100 |      100 |     100 |     100 |
  scan.worker.ts              |   94.28 |       75 |   71.42 |   93.93 | 47,54
  validation.service.ts       |     100 |     87.5 |     100 |     100 | 20-21
 src/storage                  |     100 |     87.5 |     100 |     100 |
  storage.service.ts          |     100 |     87.5 |     100 |     100 | 42
------------------------------|---------|----------|---------|---------|-------------------

Test Suites: 22 passed, 22 total
Tests:       125 passed, 125 total
```

125, pas 122 + 2 : le correctif du flux GET/POST a ajouté trois tests sur
`download-throttler.guard.ts`, pas deux. 122 + 3 = 125.

Lowest branch coverage is `scan-queue.service.ts` (54.5 % lines) and `prisma.service.ts`
(75 % lines, 0 % functions), both thin wrappers (BullMQ enqueue calls, a Prisma client
subclass) where the untested branches are framework glue, not application
logic. `HTML` report (not committed — see `.gitignore`) at
`backend/coverage/lcov-report/index.html` after `make test-cov`.
