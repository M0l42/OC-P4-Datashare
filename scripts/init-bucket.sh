#!/bin/sh
# Initialisation du stockage objet — DataShare
#
# Crée le bucket, applique la politique CORS et la règle de cycle de vie des
# uploads multipart incomplets.
#
# ┌──────────────────────────────────────────────────────────────────────────┐
# │  POURQUOI CE SCRIPT EXISTE, ET POURQUOI IL UTILISE `mc admin config`     │
# │                                                                          │
# │  Vérifié expérimentalement contre MinIO RELEASE.2025-09-07T16-13-09Z :   │
# │                                                                          │
# │   - `PutBucketCors` renvoie `NotImplemented`. La politique CORS n'est    │
# │     PAS configurable par l'API S3 sur MinIO.                             │
# │   - MinIO renvoie N'IMPORTE QUELLE origine par défaut. Un bug CORS ne    │
# │     peut donc pas se reproduire en local sans ce script.                 │
# │   - `MINIO_API_CORS_ALLOW_ORIGIN` en variable d'environnement n'a AUCUN  │
# │     effet (config effective restée à `*`).                               │
# │   - Seul `mc admin config set <alias> api cors_allow_origin` restreint   │
# │     réellement les origines.                                             │
# │   - `stale_uploads_expiry` vaut 24h par défaut, soit LA MOITIÉ de la      │
# │     fenêtre de reprise de 48 h annoncée. Voir le bloc plus bas.          │
# │                                                                          │
# │  Sans ce script, on développe contre un serveur permissif et on découvre │
# │  le problème sur le premier bucket réel.                                 │
# └──────────────────────────────────────────────────────────────────────────┘
#
# EN PRODUCTION (S3, Cloudflare R2, Scaleway), la règle CORS du bucket doit
# déclarer `ExposeHeaders: ["ETag"]`. L'uploader lit l'ETag de chaque partie
# pour finaliser l'envoi ; MinIO expose tous les en-têtes par défaut, S3 et R2
# n'en exposent aucun. Sans cette ligne, toutes les parties s'envoient
# correctement et `CompleteMultipartUpload` échoue, parce que le navigateur ne
# peut pas lire les ETag. C'est le piège qui marche en local et casse en
# production.

set -eu

ALIAS=local
: "${S3_ENDPOINT:=http://minio:9000}"
: "${S3_ACCESS_KEY:?S3_ACCESS_KEY est requis}"
: "${S3_SECRET_KEY:?S3_SECRET_KEY est requis}"
: "${S3_BUCKET:=datashare}"
: "${PUBLIC_APP_ORIGIN:=http://localhost:8080}"

echo "→ attente de MinIO sur ${S3_ENDPOINT}"
until mc alias set "$ALIAS" "$S3_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null 2>&1; do
  sleep 1
done
echo "  MinIO joignable"

echo "→ bucket ${S3_BUCKET}"
mc mb --ignore-existing "${ALIAS}/${S3_BUCKET}"

# Le bucket reste privé : tout accès passe par une URL pré-signée émise par
# l'API. Aucune politique de lecture publique.
mc anonymous set none "${ALIAS}/${S3_BUCKET}" >/dev/null 2>&1 || true

# ─────────────────────────────────────────────────────────────────────────────
# CORS + durée de vie des uploads multipart incomplets.
#
# Les DEUX réglages passent par `mc admin config set api` en UN SEUL appel :
# MinIO applique le sous-système entier, et le faire en deux commandes fait
# repasser la clé absente à sa valeur par défaut.
#
# stale_uploads_expiry=72h — c'est le réglage important, et son défaut est un
# piège. MinIO abandonne tout seul les uploads multipart incomplets au bout de
# 24 H (vérifié : `stale_uploads_expiry=24h` dans la config effective, balayage
# toutes les 6 h). Or la reprise d'upload est promise sur 48 H (décision D,
# docs/design-decisions.md). Avec le défaut, une reprise tentée entre 24 h et
# 48 h échoue en `NoSuchUpload` alors que la documentation ET le test E2E
# affirment qu'elle fonctionne : MinIO aurait purgé les parties avant le reaper.
#
# 72 h et non 48 h : un filet de sécurité doit se déclencher APRÈS le mécanisme
# principal, jamais avant. Le reaper applicatif (48 h, US10) garde l'autorité
# sur la fenêtre de reprise ; MinIO ne rattrape que les parties orphelines
# qu'aucune ligne en base ne référence plus.
# ─────────────────────────────────────────────────────────────────────────────
echo "→ CORS restreint à ${PUBLIC_APP_ORIGIN}, uploads incomplets purgés à 72 h"
mc admin config set "$ALIAS" api \
  cors_allow_origin="$PUBLIC_APP_ORIGIN" \
  stale_uploads_expiry=72h
# La modification de config demande un redémarrage du service pour être prise
# en compte sur certaines versions.
mc admin service restart "$ALIAS" >/dev/null 2>&1 || true
sleep 2

# Pas de règle `mc ilm rule add` ici, volontairement. Une règle de cycle de vie
# S3 ne sait PAS expirer un upload multipart incomplet sur MinIO : la version
# précédente de ce script posait un `--expire-delete-marker`, qui n'a aucun
# rapport (il concerne les marqueurs de suppression, sur un bucket sans
# versionnage — donc sans effet), et qui s'ajoutait EN DOUBLE à chaque
# `make init-bucket` puisque `ilm rule add` empile au lieu de remplacer.
# Le seul levier réel est `stale_uploads_expiry`, réglé ci-dessus.

echo "→ vérification"
# L'image minio/mc ne fournit ni grep ni sed : on affiche la configuration
# brute plutôt que de la filtrer. Vérifier à l'œil que `cors_allow_origin`
# correspond bien à PUBLIC_APP_ORIGIN.
mc admin config get "$ALIAS" api 2>/dev/null || true
mc ls "${ALIAS}/" || true

echo "✓ stockage initialisé"
