# DESIGN.md — design system DataShare

Valeurs résolues depuis les maquettes Figma. **Source de vérité visuelle : le fichier Figma**, pas ce document — ici on ne consigne que ce dont le code a besoin pour être écrit.

Figma : `https://www.figma.com/design/My8zErWEhUfCIZZbBz4bgJ/DataShare--copie-`
Page des maquettes : nœud `0:1` (« Maquettes »). Sans `nodeId`, l'API ne renvoie que la page de garde.

Base : **Simple Design System (sds)** de Figma.

## Typographie

Deux familles, jamais de pile système par défaut : **DM Sans** (titres, UI, champs) et **Inter** (texte courant).

| Style | Police | Taille / interligne | Poids |
|---|---|---|---|
| H1 | DM Sans Bold | 32 / 40 | 700 |
| H2 | DM Sans Bold | 28 / 40 | 700 |
| XLarge | DM Sans Light | 30 / 40 | 300 |
| Body Strong | Inter SemiBold | 16 / 22 | 600 |
| Body Base | Inter Regular | 16 / 22 | 400 |
| Normal | Inter Regular | 16 / 24 | 400 |
| Accent | DM Sans SemiBold | 16 / 24 | 600 |
| Input | DM Sans Regular | 16 / 16 | 400 |
| Small | DM Sans Regular | 14 / 16 | 400 |

`H3` et `H4` sont déclarés dans le fichier mais aucun nœud ne les utilise.

Le corps de texte est à **16 px partout**, ce qui satisfait le seuil minimal d'accessibilité.

## Couleur et élévation

```css
--sds-color-text-default-default: #1e1e1e;

/* Drop Shadow/200 — deux ombres superposées */
box-shadow: 0 1px 4px rgba(12, 12, 13, 0.05),
            0 1px 4px rgba(12, 12, 13, 0.10);
```

Fond des pages destinataire et téléversement : dégradé chaud orange → corail, carte blanche centrée à coins arrondis portant l'ombre ci-dessus.

## Points de rupture

| Nom | Largeur | Référence |
|---|---|---|
| Mobile | **393 px** | iPhone 16 (393 × 852) |
| Desktop | **1440 px** | 1440 × 1024 |

Les deux sont dessinés pour chaque parcours. Construire mobile-first sur 393.

## Composants (ne pas en inventer d'autres)

| Composant | Variantes |
|---|---|
| **Button** | Primary / Secondary / Tertiary / Dark × Small (32 px) / Medium (40 px) × Default / Disabled |
| **Callout** | **Info / Alert / Error** — seul motif de message d'état du produit |
| **Header** | Desktop / Mobile × Anonymous / Logged (avatar, nom, menu) |
| **Input** | libellé visible au-dessus, placeholder distinct |
| **Select** | — |
| **Switch** | Selected = All / True / False — c'est le filtre Tous / Actifs |

### Règles d'usage

- **Callout est le seul motif de message d'état.** Ne pas coder de bordures colorées à la main.
- **Libellé visible au-dessus du champ, placeholder distinct** (« Mot de passe » + « Saisissez le mot de passe… »). Le placeholder seul comme libellé est un défaut d'accessibilité évalué.
- **Cible tactile ≥ 44 px sur mobile.** Le bouton Small fait 32 px : utiliser Medium sur 393 px.
- La sévérité du Callout suit l'échéance : Info (« expirera dans 3 jours ») → Alert (« expirera demain ») → Error (« a expiré »). Une seule fonction `expiryTone(expiresAt)` produit cette variante, partagée entre la page destinataire, les lignes de Mon espace et l'écran de succès.

## Voix

**Reprendre les libellés des maquettes tels quels, registre mixte inclus** : tutoiement sur le téléversement (« Tu veux partager un fichier ? »), vouvoiement sur le téléchargement (« Saisissez le mot de passe… »). Décision assumée de fidélité aux maquettes fournies plutôt que de réécriture. Les nouveaux libellés suivent le registre de l'écran où ils apparaissent.

## États non couverts par les maquettes

Quinze états manquent aux maquettes, dont quatre sur la page destinataire (attente de scan, mot de passe erroné, jeton invalide, fichier refusé). Ils sont spécifiés dans `docs/design-decisions.md` (section « Design specification ») et esquissés dans `design/gap-screens/gap-screens.png`. Ces esquisses valent pour **les états et les libellés**, jamais pour la mise en page : celle-ci vient des maquettes.
