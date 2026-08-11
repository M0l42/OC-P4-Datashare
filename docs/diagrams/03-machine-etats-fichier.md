# Diagramme 3 — Machine à états du fichier

**Livrable** : accompagne « Modèle de données » (section 3) et « Sécurité et gestion des accès » (section 5).
**Pourquoi ce diagramme existe** : l'invariant de sécurité du produit est *un lien ne résout que dans l'état `ready`*. Cette règle est portée par la colonne `etat`, pas par un contrôle applicatif dispersé. Le diagramme est la preuve visuelle que la sécurité est structurelle.

C'est aussi le diagramme à montrer pendant la soutenance quand l'évaluateur demande comment on empêche la diffusion de malware.

---

## États à dessiner (7)

| État | Signification | Le lien résout ? |
|---|---|---|
| `pending` | Multipart initié, parties en vol | **non** |
| `uploaded` | `CompleteMultipartUpload` réussi, taille vérifiée par `HeadObject` | **non** |
| `scanning` | Réclamé par le worker (posé au démarrage du job) | **non** |
| `ready` | Validé | **OUI — seul état qui résout** |
| `rejected` | Échec octets magiques ou ClamAV. Objet supprimé | **non** |
| `expired` | Ligne fantôme. Objet et données sensibles purgés | **non** |
| `abandoned` | `pending` au-delà de 48 h. Multipart avorté, ligne purgée | **non** (terminal) |

`ready` doit être visuellement distinct de tous les autres : c'est le seul état « ouvert ». Les six autres se ressemblent volontairement — de l'extérieur, un lien qui ne résout pas ne dit jamais pourquoi.

---

## Transitions à tracer

| De | Vers | Déclencheur | Étiquette |
|---|---|---|---|
| *(initial)* | `pending` | `POST /files/uploads` | `CreateMultipartUpload` |
| `pending` | `uploaded` | `POST /files/uploads/:id/complete` | `Complete + HeadObject OK` |
| `pending` | `rejected` | taille réelle > 1 Go | `HeadObject > 1 Go → objet supprimé` |
| `pending` | `abandoned` | tâche planifiée | `> 48 h → AbortMultipartUpload` |
| `pending` | `pending` | reprise | `boucle : re-sélection + ListParts` |
| `uploaded` | `scanning` | worker prend le job | `worker réclame la ligne` |
| `scanning` | `ready` | validation OK | `octets magiques OK + ClamAV OK` |
| `scanning` | `rejected` | validation KO | `extension usurpée ou malware → objet supprimé` |
| `scanning` | `uploaded` | worker mort | `> 15 min → remise en file` |
| `ready` | `expired` | tâche planifiée | `expire_le atteint → objet + secrets purgés` |
| `ready` | *(supprimé)* | US06 | `suppression manuelle par le propriétaire` |
| `expired` | *(supprimé)* | tâche planifiée | `+ 7 jours → ligne purgée` |
| `rejected` | *(supprimé)* | tâche planifiée | `+ 7 jours → ligne purgée` |

---

## Éléments graphiques indispensables

### La barrière

Tracer une **ligne de démarcation** (verticale ou horizontale) qui sépare `ready` de tous les autres états, étiquetée :

> **`GET /d/:token` ne résout que du côté droit. Tout le reste renvoie la même page « ce lien n'est pas valide ».**

### L'annotation anti-oracle

Encadré relié à `rejected`, `abandoned` et `expired` (et au cas « jeton inconnu ») :

> **Ces états sont indistinguables de l'extérieur.** Jeton inconnu, fichier supprimé et fichier refusé par le scan rendent tous exactement la même page. Sinon la page devient un oracle : on peut sonder des jetons pour savoir lesquels ont existé.

Exception : `expired` **est** distingué, avec son propre message (« Ce fichier n'est plus disponible en téléchargement car il a expiré. »), parce que le destinataire connaît déjà l'existence du fichier — il en avait le lien.

### Les trois tâches planifiées

Un encadré latéral listant qui déclenche quoi :

```
Purge à expiration      quotidienne   ready → expired
Purge des fantômes      quotidienne   expired/rejected + 7 j → ligne supprimée
Reaper                  horaire       pending > 48 h → abandoned
Remise en file          horaire       scanning > 15 min → uploaded
```

### La fenêtre de 48 h

Annotation sur la transition `pending → abandoned` :

> **48 h, et ce n'est pas arbitraire.** La reprise a besoin que le multipart existe encore ; le reaper existe pour l'avorter. Ce sont les mêmes uploads. 48 h couvre le cas réel — téléphone verrouillé la nuit, utilisateur qui revient le matin — tout en récupérant le stockage. Au-delà, `ListParts` renvoie `NoSuchUpload` et la reprise affiche un refus explicite.

---

## Contraintes de style

- États en rectangles à coins arrondis. Transitions en flèches orientées, chacune **étiquetée** — une flèche sans étiquette est une flèche inutile.
- `ready` dans la couleur d'accent. Les autres en gris. `rejected` et `abandoned` avec une bordure plus marquée (terminaux).
- Les transitions déclenchées par une **tâche planifiée** en pointillés ; celles déclenchées par une **action utilisateur ou API** en trait plein. Convention en légende.
- Format paysage (la machine est plus large que haute).
- Lisible en noir et blanc.

## Piège à éviter

Ne pas oublier `scanning → uploaded` (remise en file). C'est ce qui rend le système tolérant à un worker qui meurt en cours de scan. Sans cette transition, un crash laisse la ligne bloquée en `scanning` pour toujours et le lien ne résoudra jamais, sans que personne ne sache pourquoi.
