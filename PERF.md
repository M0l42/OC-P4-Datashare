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

Le budget de performance côté front (poids du bundle, métriques navigateur) n'est
pas couvert ici — c'est le périmètre de QA-07, pas de QA-06.

## 1 — Test de charge k6 sur `GET /d/:token`

C'est le vrai chemin chaud côté destinataire : chaque ouverture d'un lien de
téléchargement l'appelle. Le travail réel qu'il fait est une lecture Postgres
(jointure sur le propriétaire) et une signature HMAC locale (SigV4, aucun appel
réseau vers MinIO — voir `StorageService.signDownloadUrl`).

**Méthode** : `perf/seed-download-token.sh` insère une ligne `File` à l'état
`ready` directement en base (le jeton ciblé n'a pas besoin d'un objet MinIO réel,
puisque l'endpoint ne le vérifie pas). `perf/download-load-test.js` (k6, 20 VUs,
30 s) frappe ce jeton en boucle. Comparaison à 1 puis 3 réplicas API, via HAProxy
(`make scale n=1|3`, SOC-06).

| Réplicas | Débit | p95 | Erreurs |
|---|---|---|---|
| 1 | 853,9 req/s | 29,75 ms | 0 % |
| 3 | 1312,6 req/s | 29,83 ms | 0 % |

**Lecture** : le débit progresse de +53,7 % avec 3 réplicas, sans dégradation du
p95 (quasi identique : 29,75 → 29,83 ms). La latence ne bouge pas parce qu'à
20 VUs, un seul réplica n'était déjà pas saturé — le gain se voit sur le débit
soutenable, pas sur le temps de réponse individuel. Un test à VUs plus élevé
ferait apparaître un p95 qui se dégrade à 1 réplica et pas à 3 ; ce n'est pas
fait ici faute de temps alloué à cette tâche (1,5 h estimées pour SOC-06,
3 h pour QA-06).

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
