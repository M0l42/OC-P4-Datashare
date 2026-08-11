# Test Plan
Branch: master
Repo: OC-P5 (DataShare) — no remote yet

## Affected Pages/Routes
- `/` (Téléversement) — upload, progress, per-part retry, over-1 Go refusal, success + link
- `/d/:token` (Téléchargement) — 8 states: ready+Info, ready+Alert, password required, wrong password, scanning, expired, unknown token, rejected
- `/mon-espace` — file list, Tous/Actifs switch, Lock badge, expired rows, empty state, loading, **Reprendre on an interrupted upload**
- `/login`, `/register` — validation errors

## Key Interactions to Verify
- Upload a 12 MiB file: 3 parts, progress advances, link appears only after `ready`
- Upload a file under 5 MiB: single part, no chunk grid shown
- Reload mid-upload, return to Mon espace, tap Reprendre, re-select the same file, upload completes
- Re-select the WRONG file on resume: refused before any part is sent
- Enter a wrong download password: Error callout plus attempt counter
- Open a link while the file is still scanning: page resolves itself without a manual refresh
- Toggle Tous / Actifs: expired rows appear and disappear
- Complete an upload using only the keyboard (no pointer)

## Edge Cases
- Resume attempted after 48 h: explicit refusal, not a silent failure
- Declared size 1 MiB but 25 MiB uploaded: rejected after completion via `HeadObject`
- EICAR test string: rejected, never downloadable
- Uploaded `.html`: downloads as an attachment, does not execute
- Unknown token vs deleted vs malware-rejected: identical page, no leak of which
- Expiry boundary: 7 days + 1 minute → expired; tombstone gone at 14 days
- Zero files, and zero ACTIVE files with the Actifs filter on (two different empty states)
- Pre-signed part URL expiry mid-upload: re-signed transparently, upload continues

## Critical Paths
1. Register → login → upload → copy link → recipient downloads
2. Upload → scan rejects → owner sees the reason in Mon espace → no link ever existed
3. Upload interrupted → resume with correct file → download intact (verify checksum end to end)
4. File expires → recipient sees Error callout → owner sees Expiré row → row purged 7 days later
