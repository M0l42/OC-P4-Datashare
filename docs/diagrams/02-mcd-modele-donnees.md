# Diagramme 2 — MCD (modèle conceptuel de données)

**Livrable** : « Modèle de données », section 3 de la documentation technique. L'étape 1 de la mission demande explicitement « un schéma de la structure de la base de données **de type MCD** ».
**Notation** : **Merise**. C'est ce que « MCD » désigne, et c'est cohérent avec le choix de PostgreSQL. Ne pas livrer un diagramme de classes UML à la place.

---

## Entités à dessiner

### `UTILISATEUR`

| Attribut | Type | Contraintes |
|---|---|---|
| `id` | UUID | **identifiant** |
| `email` | VARCHAR(255) | unique, non nul |
| `mot_de_passe_hash` | VARCHAR(255) | non nul, bcrypt |
| `nom_affiche` | VARCHAR(100) | **nullable** |
| `cree_le` | TIMESTAMPTZ | non nul |

> `nom_affiche` est nullable et optionnel à l'inscription. Il n'existe que pour l'option « afficher mon nom au destinataire ». Sans lui, la seule identité disponible serait l'email, qu'on refuse de publier sur une page non authentifiée.

### `FICHIER`

| Attribut | Type | Contraintes |
|---|---|---|
| `id` | UUID | **identifiant** |
| `nom_original` | VARCHAR(255) | non nul |
| `type_mime` | VARCHAR(127) | non nul |
| `taille_octets` | INTEGER | non nul, ≤ 1 073 741 824 |
| `cle_stockage` | VARCHAR(512) | **nullable** (vidée à l'expiration) |
| `jeton_telechargement` | VARCHAR(64) | unique, non nul, imprédictible |
| `mot_de_passe_hash` | VARCHAR(255) | **nullable** (vidé à l'expiration) |
| `expire_le` | TIMESTAMPTZ | non nul, ≤ création + 7 jours |
| `etat` | ENUM | non nul, voir diagramme 3 |
| `upload_id` | VARCHAR(255) | **nullable**, multipart en cours |
| `taille_partie` | INTEGER | non nul, 8 388 608 par défaut |
| `afficher_expediteur` | BOOLEAN | non nul, défaut `false` |
| `tags` | TEXT[] | tableau, 0..N, 30 caractères max par tag |
| `cree_le` | TIMESTAMPTZ | non nul |

---

## Association

Une seule, et sa cardinalité est le point à ne pas rater :

```
UTILISATEUR ──1,1──< POSSÈDE >──0,N── FICHIER
```

- Côté `FICHIER` → `UTILISATEUR` : **(1,1)**. Tout fichier appartient à exactement un utilisateur. `proprietaire_id` est **NOT NULL** : US01 exige que le fichier soit lié à l'identifiant utilisateur, et l'US07 (dépôt anonyme) a été **retirée du périmètre**, donc rien ne justifie de rendre ce lien optionnel.
- Côté `UTILISATEUR` → `FICHIER` : **(0,N)**. Un utilisateur peut n'avoir aucun fichier — c'est l'état initial après inscription, et c'est l'écran vide de « Mon espace ».

---

## Choix à justifier sur le schéma (annotations encadrées)

Trois annotations, chacune reliée par un trait fin à l'élément concerné :

1. **Sur `tags`** — « Tableau `TEXT[]` plutôt qu'une table de jointure. La spécification demande 0..N tags de texte libre, 30 caractères maximum, sans doublon par fichier. Une table `TAG` + une association n,n n'apporterait rien qu'un tableau ne fait déjà, et le filtrage Tous/Actifs ne porte pas sur les tags. »

2. **Sur `cle_stockage` et `mot_de_passe_hash` (les deux nullables)** — « Vidés à l'expiration, pas supprimés avec la ligne. US01 et US10 exigent la suppression du fichier et de ses métadonnées ; US05 exige que l'historique affiche l'état « expiré ». La contradiction se résout par une ligne fantôme : l'objet et les données sensibles disparaissent, la ligne survit 7 jours pour porter l'état, puis elle est purgée. »

3. **Sur `jeton_telechargement`** — « Imprédictible et unique. C'est la seule autorisation d'accès au fichier pour le destinataire : aucune authentification n'est requise côté destinataire. **128 bits d'entropie minimum**, tirés d'un générateur cryptographique. »

---

## Index à faire figurer

Sous l'entité `FICHIER`, un encadré « Index » :

```
(etat, expire_le)   → purge à expiration + purge des lignes fantômes
(etat, cree_le)     → reaper des uploads abandonnés (fenêtre 48 h)
jeton_telechargement → unique, accès destinataire
proprietaire_id      → liste « Mon espace »
```

Ces trois tâches planifiées balaient la table quotidiennement. Sans index, chacune fait un parcours complet.

---

## Contraintes de style

- Notation Merise stricte : entités en rectangles, association en ovale ou losange entre les deux, cardinalités **(min,max)** aux deux extrémités.
- Identifiants **soulignés**.
- Attributs nullables marqués visiblement — un suffixe `(0,1)` ou une astérisque, avec la convention indiquée en légende.
- Noms d'attributs **en français** : le MCD est un document conceptuel destiné à l'évaluateur, la traduction vers les noms de colonnes anglais se fait dans `schema.prisma`.
- Pas de couleur décorative. Une seule couleur d'accent, réservée aux trois annotations.
- Format portrait, lisible en A4.

---

## Décisions arrêtées au moment de SOC-04 (2026-08-13)

Le MCD fixe les entités et les cardinalités ; il ne tranche pas le passage aux
types Prisma. Ces six points l'ont été, et chacun se défend :

1. **`taille_octets` en `Int`, pas `BigInt`.** Le plafond est 1 GiB
   (1 073 741 824) contre 2 147 483 647 pour un `INTEGER` : il tient avec le
   double de marge. `BigInt` se projetterait en `bigint` JavaScript, sur lequel
   `JSON.stringify` **lève une exception** — il faudrait un sérialiseur global,
   les tailles transiteraient en chaînes de caractères et le contrat OpenAPI
   devrait déclarer `type: string, format: int64`. Un coût permanent pour éviter
   un `ALTER TABLE` unique qui n'aura peut-être jamais lieu. Le plafond réel
   n'est de toute façon pas la colonne : c'est la limite de 10 000 parties du
   multipart, le plafond de scan ClamAV et le coût de stockage.

2. **Le jeton de téléchargement est stocké en clair.** C'est un secret porteur :
   quiconque le détient télécharge. Une fuite de base expose donc tous les
   fichiers actifs. **Compromis assumé** — le produit exige que l'expéditeur
   puisse récupérer le lien après coup (les maquettes n'offrent aucune
   régénération), et l'écran de succès n'est pas une occasion unique
   acceptable. L'alternative — empreinte en base et révélation unique à la
   création — rend un lien définitivement irrécupérable si l'onglet est fermé.
   Le plafond de 7 jours borne la fenêtre d'exposition. À reprendre dans
   SECURITY.md (QA-05).

3. **Jeton : 16 octets d'un générateur cryptographique, encodés en base64url**
   (22 caractères), soit 128 bits. `crypto.randomBytes(16).toString('base64url')`.
   Le jeton court visible dans les maquettes (`UhGyr`, 5 caractères ≈ 30 bits)
   est un remplissage graphique, pas une spécification : 62⁵ ≈ 9·10⁸ se balaie,
   et la limitation de débit sur `/d/:token` ralentit un balayage sans le rendre
   impossible. **Ne jamais utiliser d'UUID comme jeton** (voir point 4).

4. **Identifiants en UUID v7** (`@default(uuid(7))`), pour la localité d'index :
   trois tâches planifiées balaient cette table quotidiennement et des insertions
   ordonnées valent mieux qu'une dispersion aléatoire. Attention au contresens :
   v7 est **moins** imprévisible que v4 — il embarque un horodatage à la
   milliseconde et ne porte qu'environ 74 bits aléatoires contre 122. Acceptable
   pour une clé primaire, jamais pour un secret.

5. **`onDelete: Restrict` sur la relation `FICHIER → UTILISATEUR`.** Aucune
   suppression de compte n'est au périmètre. `Restrict` encode la décision : un
   utilisateur possédant des fichiers ne peut pas être supprimé en dur, ce qui
   force la voie douce le jour venu (marquer le compte supprimé et faire expirer
   ses fichiers, cohérent avec les lignes fantômes). Pas de colonne
   `supprime_le` maintenant — une colonne inutilisée appelle la question « à quoi
   sert-elle ? ».

6. **Aucune contrainte `CHECK` en base**, ni sur la taille ni sur l'échéance.
   Le plafond de 7 jours n'est pas un invariant de la donnée, c'est une **règle
   métier** appelée à bouger (une offre à 30 jours en ferait une migration).
   L'API ne doit jamais accepter `expire_le` du client : le client envoie un
   **choix de durée**, le serveur le valide contre l'ensemble autorisé (US01 :
   1 à 7 jours, défaut 7) et calcule la date lui-même. « L'utilisateur demande
   90 jours » devient alors non représentable plutôt que défendu. Même
   raisonnement pour la taille : le contrôle réel est le `HeadObject` après
   complétion, une taille déclarée n'étant pas une preuve.

---

## Piège à éviter

Ne pas dessiner d'entité `TRANSFERT` parente. Les maquettes ont été vérifiées : « Ajouter **un** fichier », « Tu veux partager **un fichier** ? », une seule ligne de fichier avec une seule taille. Un lien = un fichier. Le « un ou plusieurs fichiers » de l'objectif de la spécification est satisfait par lien, pas par transfert groupé.
