#!/bin/sh
# Seeds one `ready` File row directly in Postgres, bypassing the real upload
# pipeline. GET /d/:token's own cost is a DB read plus a local HMAC signature
# (StorageService.signDownloadUrl never calls MinIO — see storage.service.ts) :
# the load test in download-load-test.js targets exactly that cost, so the
# file backing the token doesn't need to correspond to a real object.
#
# Idempotent: fixed ids, safe to re-run before every k6 run.
set -eu

cd "$(dirname "$0")/.."

TOKEN=perf-test-token-000000000000

docker compose exec -T postgres psql -U datashare -d datashare -v ON_ERROR_STOP=1 >/dev/null <<SQL
INSERT INTO users (id, email, password_hash, display_name)
VALUES ('00000000-0000-7000-8000-000000000001', 'perf-test@example.com', 'x', 'Perf test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO files (id, original_name, mime_type, size_bytes, storage_key, download_token, expires_at, state, part_size, show_sender, tags, owner_id)
VALUES (
  '00000000-0000-7000-8000-000000000002',
  'perf-test.bin', 'application/octet-stream', 1048576, 'uploads/perf-test',
  '$TOKEN', now() + interval '7 days', 'ready', 8388608, false, '{}',
  '00000000-0000-7000-8000-000000000001'
)
ON CONFLICT (id) DO UPDATE SET expires_at = excluded.expires_at, state = 'ready';
SQL

echo "$TOKEN"
