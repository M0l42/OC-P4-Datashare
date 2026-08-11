# Diagramme 5 — Séquence de validation puis téléchargement

**Livrable** : accompagne « Sécurité et gestion des accès » (section 5).
**Pourquoi ce diagramme existe** : il répond à la question que l'évaluateur posera presque certainement à un produit de partage de fichiers — *comment empêchez-vous quelqu'un de distribuer un virus par votre service ?* Le diagramme montre la barrière et montre aussi le prix de cette barrière : une attente que personne n'avait conçue.

**Notation** : diagramme de séquence UML, en **deux actes** sur un même schéma, séparés par une ligne horizontale.

---

## Participants (6 colonnes)

1. `Navigateur expéditeur`
2. `API NestJS`
3. `Worker BullMQ`
4. `ClamAV`
5. `MinIO`
6. `PostgreSQL`

Et, sous la séparation d'actes, un septième participant qui n'apparaît que dans l'acte 2 :

7. `Navigateur destinataire` — **non authentifié**, à marquer explicitement

---

## ACTE 1 — validation (déclenché par l'étape 15 du diagramme 4)

| # | De → Vers | Message |
|---|---|---|
| 1 | Worker → Redis | `dequeue(validation)` |
| 2 | Worker → PostgreSQL | `UPDATE etat='scanning'` — réclame la ligne |
| 3 | Worker → MinIO | `GetObject` |
| 4 | Worker → Worker | lecture des octets magiques, comparaison avec l'extension déclarée |
| 5 | Worker → ClamAV | `INSTREAM` (si taille ≤ 50 Mo) |
| 6 | ClamAV → Worker | `OK` \| `FOUND <signature>` |
| 7 | Worker → PostgreSQL | `UPDATE etat='ready'` \| `UPDATE etat='rejected'` |
| 8 | Worker → MinIO | `DeleteObject` — **uniquement si rejected** |

### Fragments de l'acte 1

`alt` autour des étapes 5–8 :
- `[octets magiques KO]` → `rejected`, `DeleteObject`, raison « extension usurpée »
- `[ClamAV FOUND]` → `rejected`, `DeleteObject`, raison « logiciel malveillant détecté »
- `[taille > 50 Mo]` → **scan ignoré**, `ready`, avec l'annotation ci-dessous
- `[tout OK]` → `ready`

Annotation encadrée sur la branche « taille > 50 Mo » :

> **Limite assumée, documentée dans SECURITY.md.** La limite de flux par défaut de `clamd` est très en dessous de 1 Go, et scanner un fichier de taille pleine obligerait le worker à retirer l'objet entier de MinIO — ce qui casserait la propriété « l'API ne touche jamais les octets » à la frontière du worker. Le plafond à 50 Mo préserve la machine à états, le test EICAR et le discours de sécurité, tout en gardant la propriété intacte. Le risque résiduel est écrit, pas caché.

Annotation sur l'étape 2 :

> Le worker **pose `scanning`** au démarrage du job, il ne se contente pas de lire. C'est ce qui rend un worker mort détectable : une ligne en `scanning` depuis plus de 15 minutes est remise en file.

---

## Séparateur d'actes

Une ligne horizontale traversant tout le schéma, étiquetée :

> **Aucun lien n'a encore été rendu à l'expéditeur.** Le bouton « Copier le lien » reste désactivé tant que l'état n'est pas `ready`. Un fichier refusé n'a donc jamais de lien à partager.

C'est l'annotation qui ferme la boucle produit : il n'y a pas de notification par email dans le MVP, et il n'en faut pas, parce qu'un lien mort ne peut pas être envoyé.

---

## ACTE 2 — téléchargement par le destinataire

| # | De → Vers | Message |
|---|---|---|
| 9 | Nav. destinataire → API | `GET /d/:token` |
| 10 | API → Redis | contrôle du throttle (par jeton **et** par IP) |
| 11 | API → PostgreSQL | `SELECT ... WHERE jeton = ?` |
| 12 | API → Nav. destinataire | métadonnées `{nom, taille, type, expiration, motDePasseRequis, nomExpediteur?}` |
| 13 | Nav. destinataire → API | `POST /d/:token {motDePasse}` |
| 14 | API → API | `bcrypt.compare` |
| 15 | API → MinIO | `getSignedUrl(GetObject, 60 s, response-content-disposition=attachment)` |
| 16 | API → Nav. destinataire | `{url}` |
| 17 | **Nav. destinataire → MinIO** | **`GET` — les octets** |

L'étape 17, comme l'étape 9 du diagramme 4, doit être **épaisse, en couleur d'accent, et sauter par-dessus la colonne de l'API**.

### Fragments de l'acte 2

`alt` sur l'étape 11, cinq branches — c'est le cœur de la sécurité de la page :

| Condition | Réponse | Page affichée |
|---|---|---|
| `etat = ready`, sans mot de passe | métadonnées + URL directement | Callout Info/Alert selon l'échéance |
| `etat = ready`, avec mot de passe | métadonnées, URL après l'étape 14 | champ mot de passe, bouton désactivé |
| `etat = scanning` | `202`, métadonnées, pas d'URL | « Ce fichier est en cours de vérification » + **polling** |
| `etat = expired` | `410` | Callout Error « n'est plus disponible car il a expiré » |
| jeton inconnu \| `rejected` \| `abandoned` | `404` | Callout Error « ce lien n'est pas valide » — **identique dans les trois cas** |

Annotation encadrée sur la dernière ligne :

> **Réponse volontairement identique.** Jeton inconnu, fichier refusé par le scan et upload abandonné rendent exactement la même page. Distinguer les trois transformerait la page en oracle : un attaquant pourrait sonder des jetons pour savoir lesquels ont existé. `expired` fait exception : le destinataire avait déjà le lien, donc lui dire que le fichier a expiré ne révèle rien.

`loop` sur la branche `scanning` :

> `loop [tant que etat = scanning]` — nouvelle interrogation à 2 s, puis 5 s après 30 s, abandon à 2 min.

Annotation :

> **Cette attente n'existe qu'à cause du scan.** Sans écran dédié, un état différent de `ready` s'affiche exactement comme un lien cassé. La barrière de sécurité se lirait comme un bug. C'est le seul écran de ce parcours que les maquettes ne couvrent pas.

Annotation sur l'étape 10 :

> Throttle indispensable : la route est **non authentifiée** et désormais **interrogée toutes les 2 s**. Sans limite, c'est une surface de sondage de jetons, et c'est aussi la cible du test de charge k6 — mesurer une route non limitée ne dit rien de la production.

Annotation sur l'étape 15 :

> `response-content-disposition=attachment` est **obligatoire**, pas cosmétique. Sans lui, un `.html` ou un `.svg` téléversé s'exécute dans le navigateur depuis l'origine du bucket : c'est du XSS stocké, que ni le contrôle d'octets magiques ni la liste noire d'extensions n'attrapent. Vérifié contre MinIO : le paramètre est bien honoré.

---

## Contraintes de style

- Séquence UML. Le participant `Navigateur destinataire` doit porter une marque visuelle « non authentifié » (bordure en pointillés, ou badge).
- Une seule couleur d'accent, réservée à l'étape 17.
- Les branches `rejected` / inconnu / `abandoned` doivent **converger visuellement vers une seule et même boîte de réponse**. C'est la façon de dessiner « indistinguables ».
- Format paysage. Si les deux actes ne tiennent pas, les livrer en deux schémas nommés `05a-validation` et `05b-telechargement`, en conservant l'annotation de séparation en tête du second.
- Lisible en noir et blanc.

## Piège à éviter

Ne pas dessiner l'API en train de servir le fichier. Elle ne sert jamais d'octets, ni en montée ni en descente. Elle vérifie le mot de passe puis rend une URL signée valable 60 secondes.
