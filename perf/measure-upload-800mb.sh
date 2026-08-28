#!/bin/bash
# QA-06, measurement 2: an 800 Mo upload, timed, while sampling the API
# container's CPU and resident memory. The claim under test is architectural
# (docs/documentation-technique.md, "L'API ne transporte jamais les octets"):
# the browser streams parts straight to MinIO, so the API should stay close
# to idle regardless of transfer size. This script drives the real multipart
# flow (initiate -> N presigned PUTs -> complete) exactly as the browser does,
# against the running `make up` stack, and reports what the API container
# actually did meanwhile.
set -euo pipefail

cd "$(dirname "$0")/.."

BASE_URL="${BASE_URL:-http://localhost:8080}"
API_CONTAINER="${API_CONTAINER:-datashare-api-1}"
SIZE_MB=800
PART_MB=8
WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

echo "== generating ${SIZE_MB} Mo test file ==" >&2
dd if=/dev/urandom of="$WORKDIR/payload.bin" bs=1M count=$SIZE_MB status=none

EMAIL="perf-upload-$(date +%s)@example.com"
PASSWORD="perfUploadPass123"

curl -sf -X POST "$BASE_URL/api/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" >/dev/null

TOKEN=$(curl -sf -X POST "$BASE_URL/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

echo "== starting CPU/mem sampling on $API_CONTAINER ==" >&2
STATS_LOG="$WORKDIR/stats.csv"
(
  while true; do
    docker stats --no-stream --format '{{.CPUPerc}},{{.MemUsage}}' "$API_CONTAINER" 2>/dev/null >>"$STATS_LOG" || true
    sleep 1
  done
) &
SAMPLER_PID=$!
disown

START=$(date +%s.%N)

INITIATE=$(curl -sf -X POST "$BASE_URL/api/files/uploads" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"originalName\":\"perf-800mb.bin\",\"mimeType\":\"application/octet-stream\",\"sizeBytes\":$((SIZE_MB * 1024 * 1024))}")

FILE_ID=$(echo "$INITIATE" | grep -o '"fileId":"[^"]*"' | cut -d'"' -f4)

echo "== splitting into ${PART_MB} Mo parts ==" >&2
split -b "${PART_MB}m" -d -a 4 --numeric-suffixes=1 "$WORKDIR/payload.bin" "$WORKDIR/part-"

echo "== uploading parts ==" >&2
# Parses the initiate response's "parts":[{"partNumber":N,"url":"..."}]
# array by scanning matched pairs — jq isn't assumed to be present.
echo "$INITIATE" | grep -o '"partNumber":[0-9]*,"url":"[^"]*"' >"$WORKDIR/parts.txt"

while IFS= read -r ENTRY; do
  PART_NUM=$(echo "$ENTRY" | grep -o '"partNumber":[0-9]*' | grep -o '[0-9]*')
  URL=$(echo "$ENTRY" | grep -o '"url":"[^"]*"' | cut -d'"' -f4 | sed 's/\\u0026/\&/g')
  PART_FILE=$(printf "%s/part-%04d" "$WORKDIR" "$PART_NUM")
  HDRS=$(curl -sf -X PUT --upload-file "$PART_FILE" "$URL" -D - -o /dev/null)
  ETAG=$(echo "$HDRS" | grep -i '^etag:' | sed 's/^[Ee][Tt][Aa][Gg]: *//' | tr -d '\r')
  echo "{\"partNumber\":$PART_NUM,\"etag\":$ETAG}" >>"$WORKDIR/completed-parts.jsonl"
done <"$WORKDIR/parts.txt"

PARTS_JSON="[$(paste -sd, "$WORKDIR/completed-parts.jsonl")]"

curl -sf -X POST "$BASE_URL/api/files/uploads/$FILE_ID/complete" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"parts\":$PARTS_JSON}" >/dev/null

END=$(date +%s.%N)
kill "$SAMPLER_PID" 2>/dev/null || true

ELAPSED=$(echo "$END - $START" | bc)

echo ""
echo "== results =="
echo "elapsed: ${ELAPSED}s for ${SIZE_MB} Mo ($(echo "scale=1; $SIZE_MB / $ELAPSED" | bc) Mo/s)"
echo ""
echo "API container samples (CPU%, MemUsage) during transfer:"
cat "$STATS_LOG"
echo ""
echo "peak CPU%:"
sed 's/%.*//' "$STATS_LOG" | sort -n | tail -1
