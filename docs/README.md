# docs/ — documentation du projet

## Livrables

| Fichier | Statut | Livrable OpenClassrooms |
|---|---|---|
| `documentation-technique.md` | En cours — 8 sections, arrêtées sauf résultats de mesures | Livrable 1 (à exporter en PDF) |
| `diagrams/` | Spécifications écrites, diagrammes à produire | Étape 1 : schéma d'architecture, MCD, contrat d'interface |
| `test-plan.md` | Écrit | Alimente TESTING.md et `/qa` |

## Documents de travail

| Fichier | Rôle |
|---|---|
| `design-decisions.md` | **Source de vérité des décisions.** Trace complète : choix, alternatives écartées, revues passées, résultats du spike, tâches. En cas de contradiction avec un autre document, celui-ci fait foi. |

## Ailleurs dans le dépôt

- `DESIGN.md` (racine) — tokens du design system résolus depuis les maquettes : typographie, points de rupture, élévation, composants et leurs variantes. C'est ce dont le code a besoin.
- Les maquettes elles-mêmes vivent **dans Figma**, pas dans le dépôt. L'évaluateur y a déjà accès, et 26 Mo d'exports PNG n'ont rien à faire dans un clone. Un export local existe (`design/figma/`, non versionné) pour l'assistant pendant l'implémentation.
- `design/gap-screens/` — maquettes filaires des 15 états que les maquettes Figma ne couvrent pas (attente de scan, mot de passe erroné, jeton invalide, fichier refusé, états vides). Volontairement grossières : ce sont les **états et les libellés** qui sont le livrable, pas la mise en page.

## À produire à la racine du dépôt

`README.md`, `TESTING.md`, `SECURITY.md`, `PERF.md`, `MAINTENANCE.md` — livrables exigés, à écrire au fil de l'implémentation et non en fin de parcours.

## Ordre de travail

1. Créer le remote Git et pousser.
2. Produire le **MCD** (`diagrams/02`) — bloque `schema.prisma`, donc tout le reste.
3. Produire la **machine à états** (`diagrams/03`) — l'énumération fait partie de la première migration.
4. Produire le **schéma d'architecture** (`diagrams/01`).
5. Coder, en tenant à jour les quatre fichiers de suivi.
6. Compléter les blocs **À COMPLÉTER** de `documentation-technique.md` au fur et à mesure, puis exporter en PDF.
