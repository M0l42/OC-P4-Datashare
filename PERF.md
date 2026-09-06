# DataShare — Performance

Document vivant, écrit au fil de l'implémentation (voir `docs/design-decisions.md`,
prémisse 3) : les chiffres ci-dessous viennent d'exécutions réelles contre la pile
locale (`make up`), pas d'estimations. Reproductible via `make perf-download n=1|3`
et `make perf-upload`.

Deux mesures, pour une raison précise (voir `docs/documentation-technique.md`, §6) :
charger l'endpoint d'initiation de téléversement aurait mesuré un HMAC et un
`INSERT` — c'est justement parce que l'API ne touche pas aux octets que le débit
ne se mesure pas là. Les deux mesures ci-dessous ciblent donc les deux seuls
endroits où l'API fait un travail réel : signer un lien de téléchargement, et
signer 100 URLs de parties à l'initiation d'un envoi.

Le budget de performance côté front (poids du bundle, métriques navigateur,
QA-07) est couvert en section 3, séparément des deux mesures back-end de
QA-06 ci-dessous.

## 1 — Test de charge k6 sur `GET /d/:token`

C'est le vrai chemin chaud côté destinataire : chaque ouverture d'un lien de
téléchargement l'appelle. Le travail réel qu'il fait est une lecture Postgres
(jointure sur le propriétaire) et une signature HMAC locale (SigV4, aucun appel
réseau vers MinIO — voir `StorageService.signDownloadUrl`).

**Méthode** : `perf/seed-download-token.sh` insère une ligne `File` à l'état
`ready` directement en base (le jeton ciblé n'a pas besoin d'un objet MinIO réel,
puisque l'endpoint ne le vérifie pas). `perf/download-load-test.js` frappe ce
jeton en boucle avec l'exécuteur par défaut de k6 : `VUS=60` (variable
d'environnement du script), 30 secondes, VUs constants en boucle fermée, sans
pause entre deux requêtes d'un même VU, pas de montée en charge progressive.
Comparaison à 1 puis 3 réplicas API, via HAProxy (`make scale n=1|3`, SOC-06).
`PERF_TEST_SECRET` (voir `.env.example`) fait passer ce test outre le rate
limiting de `/d/:token` (SOC-07) : sans lui, 60 VUs en boucle fermée épuisent
les deux compteurs de `throttler.module.ts` en quelques centaines de
millisecondes, et le test mesurerait la vitesse de rejet du throttler, pas le
chemin réel.

Premier essai à 20 VUs (2026-08-30) : dans un système en boucle fermée à
concurrence fixe, le débit ne peut augmenter avec le nombre de réplicas que si
la latence baisse en proportion (loi de Little : concurrence ≈ débit × latence
moyenne). Le relevé de l'époque annonçait +53,7 % de débit avec un p95
inchangé, ce qui est mathématiquement incohérent : une hausse de débit à
concurrence fixe *est* la preuve qu'un goulot a été desserré, pas celle d'une
absence de saturation. Repris à VUs plus élevés (60) pour lever l'ambiguïté et
rapporter la médiane et la moyenne, pas seulement le p95 :

| Réplicas | Débit | Moyenne | Médiane | p90 | p95 | p99 | Max | Erreurs |
|---|---|---|---|---|---|---|---|---|
| 1 | 764,13 req/s | 78,34 ms | 74,93 ms | 84,38 ms | 90,05 ms | 100,47 ms | 1,93 s | 0 % |
| 3 | 1117,18 req/s | 53,49 ms | 23,07 ms | 128,79 ms | 140,28 ms | 188,61 ms | 1,54 s | 0 % |

Re-mesuré le 2026-09-06 (remplace le relevé du 2026-09-05, même méthode et
même script, écart attendu d'un run à l'autre sur une machine partagée avec
le client k6 lui-même) pour ajouter p99 et le max, absents du premier relevé.

**Lecture** : débit et latence moyenne évoluent en sens inverse, comme l'impose
un système en boucle fermée à concurrence fixe (loi de Little, N = X × R : la
concurrence est le produit du débit et du temps de réponse moyen). Vérification
directe : 764,13 × 0,07834 ≈ 59,9 requêtes en vol en moyenne à 1 réplica,
1117,18 × 0,05349 ≈ 59,8 à 3 réplicas, un nombre quasiment identique malgré des
débits très différents, ce qui confirme que le harnais tournait à une
concurrence constante (~60 VUs) d'un run à l'autre, pas à une dérive de
méthode. La loi ne contraint que la moyenne, pas les autres quantiles : c'est
pourquoi le p95 et le p99 progressent (90 → 140 ms, 100 → 189 ms) sans
contredire une moyenne et une médiane en forte baisse (78 → 53 ms, 75 → 23
ms). La queue de distribution est tirée vers le haut par une minorité de
requêtes plus lentes, indépendamment de ce que fait la moyenne, cohérent
avec `docker stats` ci-dessous (contention CPU entre les trois réplicas). Le
max, lui, baisse (1,93 s → 1,54 s) : c'est un point unique par run, pas une
statistique de queue, il ne se lit pas comme le p99.

Le gain observé (+46,2 %, soit ×1,46) reste net en dessous d'un ×3 linéaire.
`docker stats` pendant l'exécution à 3 réplicas explique pourquoi : les trois
processus API tournent à 146 %, 146 % et 163 % de CPU simultanément, sur la
même machine que le client k6 lui-même, les quatre processus se partageant le
même jeu de cœurs. C'est de la contention de ressources sur l'environnement de
mesure, pas un plafond de l'architecture testée ; un environnement avec un
cœur dédié par réplica montrerait vraisemblablement un gain plus proche du
linéaire.

**Piège rencontré en reproduisant cette mesure** : juste après `make scale n=3`,
HAProxy peut encore n'avoir qu'un seul réplica marqué `UP` dans ses propres
vérifications de santé (`resolvers docker`, `hold valid 10s` dans
`infra/haproxy/haproxy.cfg`) alors que Docker les rapporte déjà `healthy`. Un
test lancé trop tôt frappe alors un seul réplica sur les trois et ne montre
aucun gain, pas parce que le système ne passe pas à l'échelle, mais parce que
la mesure a démarré avant que la répartition ne soit effective. Vérifier
`curl http://localhost:8404/;csv` (page de stats HAProxy) avant de lancer k6.

### Un vrai problème trouvé et corrigé en cours de route

La première exécution à 3 réplicas montrait 6,21 % d'erreurs (502), absentes à
1 réplica. Ce n'était ni HAProxy ni l'API : les logs HAProxy ne montraient que
des 200, et les logs nginx un `connect() ... failed (99: Address not available)`
— épuisement des ports éphémères du conteneur nginx. `infra/nginx/nginx.conf`
proxifiait `/api/` via une variable (`set $api_target ...; proxy_pass $api_target;`)
pour forcer une re-résolution DNS à chaque requête — nécessaire tant que la
cible pouvait être recréée en cours de dev, mais cela empêche tout pool de
connexions : nginx ouvrait une connexion TCP neuve par requête. À 1 réplica,
le débit plafonnait avant d'épuiser les ports ; à 3 réplicas, HAProxy a laissé
le débit monter assez haut pour le déclencher. C'est la conséquence acceptée
documentée dans la décision D7, rendue visible seulement maintenant qu'il existe
enfin assez de capacité côté API pour l'atteindre.

Correction : HAProxy, contrairement à `front` ou à l'ancien accès direct à
`api`, n'a quasiment aucune raison d'être recréé en cours de session de dev — un
bloc `upstream` classique avec `keepalive 32` est donc un compromis sûr pour ce
seul saut (voir le commentaire dans `infra/nginx/nginx.conf`). `front` garde la
technique par variable, qui reste justifiée pour lui. Les chiffres du tableau
ci-dessus sont déjà ceux mesurés **après** ce correctif (0 % d'erreurs aux deux
paliers).

## 2 — Mesure d'un téléversement de 800 Mo

Vérifie la propriété centrale de l'architecture (`docs/documentation-technique.md`,
§1) : l'API ne transporte jamais les octets, donc son CPU et sa mémoire ne
devraient pas dépendre de la taille du fichier envoyé.

**Méthode** : `perf/measure-upload-800mb.sh` génère 800 Mo aléatoires, exécute le
vrai flux multipart (`POST /files/uploads` → 100 PUT pré-signés directement vers
MinIO → `POST /files/uploads/:id/complete`) contre la pile réelle, et échantillonne
`docker stats` sur le conteneur API chaque seconde pendant le transfert.

| Mesure | Valeur |
|---|---|
| Temps total | 8,11 s pour 800 Mo (98,6 Mo/s) |
| CPU API — pic | 13,17 % (pendant `initiate`, signature des 100 URLs de parties) |
| CPU API — pendant le transfert des octets | 0,43 – 0,96 % |
| Mémoire API | 352 – 373 Mio, stable, aucune croissance avec la taille du fichier |

**Lecture** : le seul pic CPU de l'API a lieu à l'initiation (100 signatures
HMAC), pas pendant le transfert — cohérent avec `signPartUrls` qui ne fait aucun
I/O. La mémoire ne bouge pas parce qu'aucun octet du fichier ne transite par le
process Node.

**Coût calculé d'un passage des mêmes octets par l'API** (alternative rejetée à
la conception, jamais implémentée ici — donc estimée, pas mesurée) : un design
naïf où le navigateur envoie les octets à l'API, qui les relaie vers MinIO,
imposerait de tenir un tampon par requête active (au minimum une taille de
partie, 8 Mio, souvent davantage selon l'implémentation du relais) pendant toute
la durée du transfert, et un worker HTTP occupé de bout en bout — donc une
mémoire et une durée d'indisponibilité du worker proportionnelles à la taille du
fichier, là où la mesure ci-dessus est plate quelle que soit cette taille. C'est
la justification chiffrée, a posteriori, de la décision prise dès la conception.

## 3 — Budget de performance front (QA-07)

**Méthode** : bundle de production réel (`npm run build`, `frontend/dist`),
servi tel quel par nginx statique — pas le serveur de dev Vite, qui inclut le
client HMR et du code non minifié. Lighthouse (mode mobile par défaut,
throttling réseau/CPU simulé) exécuté contre ce bundle.

### Poids du bundle

| Fichier | Brut | Gzip |
|---|---|---|
| JS | 445,8 Ko | 130,8 Ko |
| CSS | 19,2 Ko | 3,8 Ko |

**Budget fixé** : < 200 Ko gzip pour le JS (repère usuel pour un bundle
initial sans découpage de route sur une SPA de cette taille — pas de
bibliothèque de routing ni de composants tiers ici, seuls `react` +
`react-dom`). **Résultat : conforme** (130,8 Ko, 35 % de marge).

### Scores Lighthouse

| Catégorie | Score |
|---|---|
| Performance | 93–94 |
| Accessibilité | 100 (92 avant correctif QA-09, voir plus bas) |
| Bonnes pratiques | 78 |
| SEO | 90 |

| Métrique | Valeur |
|---|---|
| First Contentful Paint | 2,5 s |
| Largest Contentful Paint | 2,5 s |
| Total Blocking Time | 0 ms |
| Cumulative Layout Shift | 0,003 |

**Lecture** : Performance et CLS confirment ce que la taille du bundle laissait
attendre — pas de JavaScript qui bloque le thread principal (TBT = 0 ms), pas
de décalage de mise en page. FCP/LCP à 2,5 s reflètent le throttling réseau
simulé par défaut de Lighthouse (4G lente), pas un problème de l'application.

Les deux causes du score Bonnes pratiques (78) sont attendues en local et hors
périmètre de QA-07 : absence de HTTPS et de redirection HTTP→HTTPS. Raison
détaillée dans `SECURITY.md` : ce projet n'a jamais prétendu terminer TLS en
développement (`docker-compose.yml` sert tout en HTTP local), la terminaison
TLS reste un chantier de production, pas un oubli.

Le premier passage Lighthouse (score Accessibilité 92) a révélé un vrai défaut
de contraste : deux variantes de bouton du design system, plus un troisième
trouvé en vérifiant manuellement le reste du même audit (le Callout `alert`,
sous 4,5:1 lui aussi). Corrigé sous QA-09 (`docs/design-decisions.md` a le
détail du calcul et les valeurs retenues) ; le score ci-dessus (100) est déjà
celui d'après correctif, pas une projection.
