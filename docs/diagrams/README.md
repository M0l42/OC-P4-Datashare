# Spécifications de diagrammes

Un fichier par diagramme. Chaque fichier est une **spécification complète** : éléments à dessiner, étiquettes exactes, annotations, contraintes de style, pièges à éviter. Assez précis pour être donné tel quel à un outil de génération de diagrammes sans avoir à répondre à des questions de suivi.

| # | Fichier | Livre la section | Notation | Format |
|---|---|---|---|---|
| 1 | `01-architecture-logicielle.md` | 1 — Architecture de l'application | Boîtes et flux | Portrait |
| 2 | `02-mcd-modele-donnees.md` | 3 — Modèle de données | **Merise (MCD)** | Portrait |
| 3 | `03-machine-etats-fichier.md` | 3 + 5 | Machine à états | Paysage |
| 4 | `04-sequence-televersement.md` | 1 + 4 | Séquence UML | Paysage |
| 5 | `05-sequence-validation-telechargement.md` | 5 — Sécurité | Séquence UML | Paysage |

Les diagrammes 1, 2 et 4 sont exigés explicitement par l'étape 1 de la mission (schéma d'architecture, schéma de BDD de type MCD, contrat d'interface). Les diagrammes 3 et 5 ne sont pas demandés : ils existent parce qu'ils portent les réponses aux deux questions les plus probables de la soutenance, et parce que la machine à états est le centre du modèle de données.

## Ordre de production recommandé

1. **02 — MCD.** Bloque le `schema.prisma` et donc tout le reste du code.
2. **03 — Machine à états.** L'énumération `etat` fait partie de la première migration.
3. **01 — Architecture.** Le schéma qu'on montre en premier en soutenance.
4. **04 — Séquence téléversement.** À produire avant d'écrire l'uploader.
5. **05 — Validation et téléchargement.** Peut attendre la semaine 2.

## Conventions communes

- **Une seule couleur d'accent** par schéma, jamais décorative. Dans 01, 04 et 05 elle est réservée aux flux qui transportent des octets de fichier.
- **Lisible en noir et blanc.** Le PDF de documentation technique peut être imprimé.
- **Typographie** : DM Sans pour les titres, Inter pour le corps — cohérence avec le design system consigné dans `DESIGN.md`.
- **Pas de logos de technologies, pas d'icônes rondes colorées, pas de dégradés, pas d'ombres décoratives.**
- **Légende obligatoire** dès qu'une convention visuelle est utilisée (épaisseur, pointillés, empilement).
- Toute flèche porte une étiquette. Une flèche sans étiquette est une flèche inutile.

## Le message qui traverse trois schémas

Les diagrammes 1, 4 et 5 doivent tous rendre la même propriété évidente : **les octets des fichiers ne traversent jamais l'API.** L'API valide, signe, et rend des autorisations ; le navigateur parle directement au stockage objet. Si un lecteur peut regarder les trois schémas sans remarquer ça, ils sont à refaire.

## Source des décisions

Toutes les valeurs, contraintes et justifications de ces spécifications viennent de `docs/design-decisions.md`, qui est la trace des décisions prises et des revues passées. En cas de contradiction, c'est ce document qui fait foi — et il faut corriger la spécification de diagramme.
