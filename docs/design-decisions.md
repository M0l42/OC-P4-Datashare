# Design: DataShare — secure temporary file transfer MVP

Status: APPROVED
Mode: Builder

## Problem Statement

OpenClassrooms project "Pilotez le développement d'une application full-stack complète" (60h nominal). Nathan plays senior technical lead at a fictional company, DataShare, building a WeTransfer-style secure file transfer MVP for freelancers and small businesses. A fictional product manager, Lisa, sets a 4-week deadline for an investor demo.

Two committed goals:

1. **Pass the evaluation cleanly.** The grid weights deliverables as heavily as the app: technical documentation PDF, README, deployment scripts, TESTING.md, SECURITY.md, PERF.md, MAINTENANCE.md, slide deck. The defense is 30 minutes, 10 of which are an evaluator role-playing Lisa and challenging the technical choices.
2. **Work as a portfolio piece.** Distinctive enough to show recruiters.

**Self-imposed deadline: 3 weeks** (D9), against the brief's 4. Estimate is 74–105 of Nathan's hours, midpoint 85. Three weeks at roughly 30h/week gives about 90, which covers the midpoint with modest slack and requires no scope cut. The 2-week deadline originally set was 15 to 45 hours short, and the half that would have been squeezed is the most heavily graded half: tests, k6, the four markdown files, the technical PDF and the defense rehearsal.

## What Makes This Cool

**The upload path is genuinely engineered.** US01 permits 1 GB files. The naive implementation streams a gigabyte through the API and loses everything on a dropped connection. Instead the API issues pre-signed S3 multipart URLs and never touches file bytes: the browser uploads 8 MB parts directly to object storage, retrying individual parts. A dropped connection costs one part, not the whole file.

**The infrastructure is a real system.** Every service is its own container with a written justification tied to a user story or a deliverable. nginx load-balances API replicas so PERF.md reports a scaling comparison rather than a single number.

**Security is structural.** Nothing is downloadable until it has been validated. The file state machine gates the download link, so validation is part of the data model rather than a checklist item. Three specific holes found in review are closed by design: upload size is enforced after the fact via `HeadObject` (a pre-signed PUT cannot bind `Content-Length`), every download is forced to `Content-Disposition: attachment` (otherwise an uploaded `.html` is stored XSS served from the bucket origin), and pre-signed URLs have a defined TTL with a re-sign endpoint.

## Constraints

- **Time:** ~90 hours over 3 weeks (D9). The brief allows 4, so this is still ahead of the stated deadline.
- **Stack menu (fixed by the brief):** back end Spring Boot / .NET Core / NestJS / Symfony-Laravel. Front Angular / React / Vue. Database PostgreSQL / MongoDB. Storage local filesystem / AWS S3.
- **Existing fluency:** Python and Django (mastered, not on the menu). Spring Boot and Symfony/Laravel each used once on prior projects, neither mastered. JavaScript known, React partially.
- **Required quality artifacts:** 70% coverage with a screenshot, unit **and integration** and end-to-end tests, 2–3 Cypress scenarios, a k6 load test with analysis, a front-end performance budget, **structured logs** with key metrics, a dependency vulnerability scan with documented decisions, dependency-update procedures, and accessibility for PSH users.
- **Git:** GitHub or GitLab, clean history, Conventional Commits as a stated bonus.
- **Design:** Figma maquettes supplied and now extracted to `design/figma/` (structure XML, per-screen PNGs at both breakpoints, token README). Fully specified in the Design specification section below.
- **Deployment:** deferred by decision. Architecture stays deployment-ready.

### AI usage policy

The rule: *"vous devrez vous servir de l'IA générative uniquement pour développer une seule User Story (US) du projet uniquement. Le reste devra être codé par vous-même."* Three distinct cases, and only the first is restricted:

1. **AI-authored user-story code** — exactly one story (US06). Traced in git, documented.
2. **AI assisting while Nathan authors** — guidance, error spotting, code review, explaining NestJS, debugging. Nathan writes the code, so nothing is "codé par l'IA". Actively rewarded: the defense grid scores *"votre capacité à superviser, à proposer des optimisations et à profiter de l'IA"*.
3. **Non-user-story artifacts** — docker-compose, Makefile, nginx and HAProxy config, bucket init scripts, CI, README prose, slide text. Agent-authored, reviewed by Nathan.

**Grey zone, handled by disclosure:** test suites are code but are not a user story. Agent-drafted tests are defensible; agent-authored whole suites with no trace are the one thing an evaluator could reasonably question. Every AI use goes in the Journal de l'IA, including uses considered and declined. Saying "here is where I drew the line and why" converts the risk into a scoring opportunity.

## Premises

1. **US08, US09 and US10 are MVP, not optional.** US01's management rules require a configurable expiry (1–7 days, default 7, ceiling enforced server-side), automatic deletion of file and metadata at expiry, and an optional download password (minimum 6 characters). US02 requires the password enforced on download, validated client **and** server side. US01's input controls mention one or more tags. Only tag *filtering* is genuinely optional, which US05 confirms.
2. ~~**US07 anonymous upload is a stretch goal.**~~ **Superseded by the design review.** Full mobile support is committed (the maquettes specify every screen at 393 px), and mobile browsers suspend JavaScript on backgrounded tabs, so cross-reload upload resume is now required rather than optional. That consumes the week-3 slack premise 2 reserved. **US07 is cut.** `File.owner_id` stays NOT NULL.
3. **The deliverables are a workstream, not a phase.** Written alongside the code.
4. **Storage is addressed through the S3 API only**, so the same `@aws-sdk/client-s3` code path serves MinIO and any S3-compatible provider. **Endpoint, credentials, bucket name and region come from environment variables; bucket policy, CORS and lifecycle rules are provisioned per environment by `scripts/init-bucket.sh`.** Verified: the client code is genuinely portable, but **CORS is not** — MinIO does not implement `PutBucketCors` at all and needs `mc admin config set`, while S3 and R2 need a bucket CORS rule including `ExposeHeaders: ["ETag"]`. Two different provisioning paths, one code path. Do not claim "env vars alone" at the defense.
5. **The file state machine is the centre of the data model.** No download link resolves except in state `ready`.
6. **Nine stories are in scope (US01–US06, US08, US09, US10). Eight are hand-written by Nathan; US06 is the AI-authored story.** Non-user-story artifacts are agent-authored per the AI usage policy above.

## Approaches Considered

### The upload path (D2)

**Approach A: proxy through the API.** Simplest, all validation inline, no CORS. But no resumability, and it occupies an API worker plus an nginx request buffer for the whole upload (nginx buffers the entire body to a temp file by default via `proxy_request_buffering`). Completeness 6/10.

**Approach B: pre-signed single PUT.** API never touches bytes, but one atomic transfer, so failure at 95% restarts. Solves scaling, not resilience. Completeness 7/10.

**Approach C (chosen): S3 multipart with pre-signed part URLs.** Per-part retry, real progress, API issues permission slips only. Costs front-end work inside US01 (hand-written) and requires the state machine. Completeness 10/10.

### The build order (D7)

**Approach A (chosen): thin slice first, containers arrive with their story.** Proves the riskiest unknown in week one, working app at every commit. Cost: compose gets touched repeatedly. Completeness 10/10.

**Approach B: full infrastructure first.** One clean pass, but two to three days before anything works and the upload risk stays unproven. Completeness 8/10.

**Approach C: features first, dockerise in week two.** Fastest visible progress, but dockerising lands with no slack and a filesystem-first upload means rewriting US01. Completeness 5/10.

## Recommended Approach

### Stack

| Layer | Choice | Justification for the defense |
|---|---|---|
| Back end | **NestJS (TypeScript)** | One language across the stack, shared types for the front/back contract, and Cypress plus the JS tooling sit natively in the ecosystem. Deliberately not Spring Boot: a prior project already used it, so this adds portfolio breadth. Its module and provider model maps onto Spring's. |
| Front end | **React** | Existing partial familiarity, and the chunked uploader needs direct control over `File.slice()` and request sequencing. |
| Database | **PostgreSQL** | Relational model (user → files → tags) and the required deliverable is an MCD, a relational notation. |
| ORM | **Prisma** | Trustworthy migrations while the schema churns in week one; generated types catch schema errors at compile time in an unfamiliar framework; `schema.prisma` is a readable artifact beside the MCD. |
| Storage | **MinIO locally, S3 API only** | S3-compatible, so the same client code serves any provider later. |
| Queue | **BullMQ on Redis** | The NestJS equivalent of Celery. Runs the US10 expiry purge, the abandoned-upload reaper, and post-upload validation. |
| API docs | **`@nestjs/swagger`** | Generates the OpenAPI spec from the DTOs already being written. Required: the mission lists an interface contract as an Étape 1 output, the technical doc requires an endpoints section, and the defense script names OpenAPI explicitly. |
| Logging | **`nestjs-pino`** | JSON logs with request-id correlation. PERF.md explicitly requires structured logs and key metrics. |

k6 is a standalone Go binary that takes JavaScript test scripts. It is not a Node package and does not run on Node. Do not describe it as part of the JS ecosystem at the defense.

### Services

| Container | Justification | Arrives |
|---|---|---|
| nginx | Serves the React build, proxies `/api`, load-balances API replicas via `upstream`, TLS termination point later | Day 1 |
| NestJS API (×N) | US01–US06, US08–US10 | Day 1 |
| PostgreSQL | Relational model, MCD deliverable | Day 1 |
| MinIO | US01 storage, S3-compatible | Day 1 |
| Redis | BullMQ backing store **and** login rate limiting. Must be Redis-backed rather than in-memory precisely because the API runs multiple replicas | Day 1 |
| BullMQ worker | Post-upload validation, US10 expiry purge, abandoned-upload reaper | Week 2 |
| ClamAV | Malware scanning, gates the download link. Scope capped, see D9 | Week 2 |
| HAProxy | Second-tier load balancing for the PERF.md scaling comparison. Agent-authored config, so it costs review time rather than build time | Week 2 |

File bytes never traverse nginx under Approach C, so `client_max_body_size` is irrelevant here (requests carry a few KB of JSON). Do not cite it as a justification.

Deliberately excluded and documented as security roadmap: **Keycloak SSO and TOTP 2FA**. US03 and US04 require hashing and salting the password in our own database and issuing the JWT ourselves; delegating that to Keycloak hands away a graded competency plus the access-control documentation section. **Mailpit** is excluded because the MVP has no mail requirement (US03 explicitly requires no confirmation email); it returns only alongside 2FA enrollment.

### Data model

- **User**: id, email (unique), password_hash, created_at.
- **File**: id, owner_id (**NOT NULL** — US01 requires the file be linked to the user; relax only if US07 is built), original_name, mime_type, size_bytes, storage_key, download_token (unpredictable, unique), password_hash (nullable), expires_at, state, upload_id (nullable, in-flight multipart), part_size, created_at.
- **Tags**: `tags text[]` on File. The spec requires 0..N free-text tags of at most 30 characters with no duplicates per file; filtering is explicitly optional. A join table buys nothing the array does not.

**File.state:** `pending → uploaded → scanning → ready | rejected`, plus terminal `expired` and `abandoned`.

- `pending` — multipart initiated, parts in flight.
- `uploaded` — `CompleteMultipartUpload` succeeded, size verified by `HeadObject`.
- `scanning` — claimed by the worker (set on job start, so a crashed worker is detectable).
- `ready` — validated. The only state in which a download link resolves.
- `rejected` — failed magic-byte or malware validation. Object deleted, owner told why.
- `expired` — tombstone. Object and sensitive metadata purged, row retained.
- `abandoned` — `pending` beyond the reaper window. Multipart aborted, row purged.

**Resolving a genuine spec contradiction.** US05 requires history to show *"l'état du lien (valide ou expiré)"* and US06 implies expired files remain displayable, while US01 and US10 require the file **and its metadata** deleted at expiry. Deleting the row makes "expiré" unrenderable. Resolution: at expiry, purge the object, the `storage_key` and the `password_hash`, and retain a tombstone row (`state = expired`, name, size, dates) so US05 can render the state and US06's default filter has something to filter. Document this as a data-minimisation tradeoff in SECURITY.md. Naming this contradiction out loud at the defense is worth marks.

### API contract

| Method | Route | Purpose |
|---|---|---|
| POST | `/auth/register` | US03. Email unique, password ≥ 8 chars. |
| POST | `/auth/login` | US04. Returns JWT. Rate-limited via Redis. |
| POST | `/files/uploads` | US01 initiate. Validates auth, extension, declared size. Returns `uploadId`, `partSize`, pre-signed PUT URLs. |
| GET | `/files/uploads/:id/parts` | `ListParts` plus freshly signed URLs for missing parts. Makes resume possible and covers TTL expiry. |
| POST | `/files/uploads/:id/complete` | `CompleteMultipartUpload`, `HeadObject` size check, state → `uploaded`, enqueue validation. |
| DELETE | `/files/uploads/:id` | `AbortMultipartUpload` for an explicit client cancel. |
| GET | `/files` | US05 history. Owner-scoped. |
| DELETE | `/files/:id` | US06. Owner-scoped. **AI-authored story.** |
| GET | `/d/:token` | US02 metadata before download (name, type, size, expiry). From Postgres, never the bucket. |
| POST | `/d/:token` | US02 password check, then a short-lived pre-signed GET. |

**Pre-signed URL TTL: 1 hour** for upload parts, **60 seconds** for downloads. The re-sign endpoint exists because the headline scenario, a slow flaky connection, can outlive a signature.

### Validation rules

| Field | Rule | Enforced |
|---|---|---|
| Email | Valid format, unique in database | Client + server |
| Account password | Minimum 8 characters (US03) | Client + server |
| Download password | Minimum 6 characters if set (US09) | Client + server (US02 requires both) |
| Expiry | 1 to 7 days, default 7, **maximum 7** | Server (US10) |
| File size | ≤ 1 GB declared, **re-verified by `HeadObject` after completion** | Server |
| Extension | Blocklist per security policy (`.exe`, `.bat`, …) | Server at initiate |
| Content | Magic bytes must match claimed extension | Worker |
| Tag | Free text, ≤ 30 characters, no duplicate per file | Client + server |

### Upload flow

1. Browser requests an upload. API validates auth, extension, and declared size, calls `CreateMultipartUpload`, writes a `pending` row, returns `uploadId`, `partSize` and pre-signed PUT URLs (TTL 1h).
2. Browser slices the file and PUTs parts directly to MinIO, retrying failed parts. Parts are sequential in v1; parallelism is a documented next step. Progress is reported from completed parts.
3. Browser posts part ETags. API calls `CompleteMultipartUpload`, then `HeadObject` to verify actual size against the 1 GB cap (a pre-signed PUT cannot bind `Content-Length`, and S3 permits 5 GB per part, so the declared size alone is not enforcement). Over the cap: delete and reject. Otherwise state → `uploaded`, enqueue validation.
4. Worker sets `scanning`, then validates in two stages. **Magic bytes via a ranged read** (`GetObject` with `Range: bytes=0-63`) — a file signature fits in the first bytes, so the object is not pulled out of storage for this. **ClamAV on the full object, only in the branches that actually invoke it**, i.e. under the 50 MB cap. Then `ready` or `rejected`; on rejection the object is deleted and the reason is persisted on the row.

   Corrected 2026-08-11 during the diagram review: an unconditional full `GetObject` would have pulled a gigabyte out of MinIO even for files the scanner then skips, cancelling the egress saving the cap exists to buy. Caught by drawing the sequence, not by reading the prose.

Download: verify token, check expiry and state (`ready` only), verify password if set, return a pre-signed GET valid 60 seconds **signed with `response-content-disposition=attachment; filename="…"` and `response-content-type=application/octet-stream`**. Without those parameters an uploaded `.html` or SVG executes in the browser from the bucket origin, which magic-byte checks and the `.exe` blocklist do not catch.

**Reapers.** `pending` rows older than the reaper window (tab closed mid-upload, the commonest real failure) are aborted and purged; `scanning` rows older than 15 minutes are requeued; a MinIO lifecycle rule expires incomplete multipart uploads as a backstop. Without this, orphaned parts accumulate invisibly and are billed.

**CORS, verified empirically against MinIO RELEASE.2025-09-07T16-13-09Z.** This is worse than "MinIO differs from S3", and the details matter:

- **`PutBucketCors` returns `NotImplemented`.** Bucket-level CORS cannot be configured through the S3 API at all; `GetBucketCors` then fails with `NoSuchCORSConfiguration`.
- **MinIO reflects any origin by default.** A preflight from `http://evil.example.com` came back `204` with `Access-Control-Allow-Origin: http://evil.example.com`. So a CORS bug **cannot** reproduce locally under default settings.
- **The `MINIO_API_CORS_ALLOW_ORIGIN` environment variable did not take effect.** With it set at container start, `mc admin config get … api` still reported `cors_allow_origin=*` and preflights stayed permissive.
- **`mc admin config set <alias> api cors_allow_origin='<origin>'` does work.** After applying it, a disallowed origin gets `204` with no `Access-Control-Allow-Origin` header (a browser blocks the request) and the allowed origin gets the header back.

**Consequence for the build:** `scripts/init-bucket.sh` must run the `mc admin config set` command so the local stack mirrors production restrictiveness. Without it you are developing against a permissive server and the first real bucket is where you find out.

**The `ExposeHeaders` trap, which will bite in production and not locally.** The uploader must read the `ETag` response header of each part to complete the upload. MinIO exposes essentially every header by default (verified: `Access-Control-Expose-Headers` includes `Etag` and `*`), so this works locally with no configuration. Real S3 and R2 expose nothing unless the bucket CORS rule declares `ExposeHeaders: ["ETag"]`. Omit it and every part upload succeeds while `CompleteMultipartUpload` fails, because the browser silently cannot see the ETags. Write it into the production bucket policy from the start.

**Minimum part size is enforced: 5 MiB.** Completing an upload whose non-final parts were 1 MiB was rejected with `EntityTooSmall`. The chosen 8 MB chunk is safely above the floor, but the uploader needs a branch: **files under 5 MiB cannot be split**, so use a single part (or a plain pre-signed PUT) for them.

### The delegated story: US06

Chosen over US05 after explicit reconsideration. In this architecture delete touches more moving parts per line than any other story: owner scoping (without it, a textbook IDOR), two systems with no shared transaction, `AbortMultipartUpload` for in-flight uploads, an idempotent scan job whose target may vanish, endpoint idempotency, and the fact that US10's purge needs the same logic.

**Ordering matters, and the first draft of this document got it wrong.** The rationale rests on the shared deletion service, so the AI must own it. US06 is therefore delegated **before** the US10 purge is written, and the purge is then hand-written on top of the AI's service. Delegating after the service already exists reduces the story to a guard clause and a method call.

**Boundary with US05, which must be explicit because it runs through one React component.** The AI owns `FileDeletionService`, `DELETE /files/:id`, and the `<ConfirmDeleteDialog>` component (US06 requires front-end confirmation). US05's hand-written history table renders a slot the AI's component fills. Two commits land on that boundary: `feat(ai): …` then `fix: …` after human review, matching the mission's own example.

Framing for the defense: this story was chosen for the highest ratio of hidden complexity to code volume, precisely so the supervision exercise would be genuine.

## Design specification

Added by `/plan-design-review` 2026-08-11. Design completeness went 3/10 → 9/10.

### Source of truth

`design/figma/` **on disk only, gitignored** (the human evaluator already has Figma access; the tokens the code needs live in `DESIGN.md` at the repo root): `maquettes-structure.xml` (node tree), `datashare-file.json` (raw), `README.md` (resolved tokens), and per-screen PNGs at both breakpoints under `televersement/`, `telechargement/`, `login/`, `mon-espace/`, `components/`. Figma file `My8zErWEhUfCIZZbBz4bgJ`, page `0:1` ("Maquettes"). Note `get_metadata` without a nodeId returns only the cover page.

### Tokens

Built on Figma's **Simple Design System (sds)**. Two families: **DM Sans** (headings, UI, inputs) and **Inter** (running text). Never substitute a default stack.

| Style | Font | Size / line | Weight |
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

Body text is 16 px throughout, which satisfies the minimum-size rule. `--sds-color-text-default-default: #1e1e1e`. Elevation is `Drop Shadow/200`: `0 1px 4px rgba(12,12,13,.05), 0 1px 4px rgba(12,12,13,.10)`.

**Breakpoints: 393 px (iPhone 16) and 1440 px (desktop).** Both are drawn for every flow. Build mobile-first against 393.

### Component vocabulary (do not invent alternatives)

- **Button** — Primary / Secondary / Tertiary / Dark, each Small (32 px) and Medium (40 px), each Default and Disabled.
- **Callout** — **Info / Alert / Error**. This is the only status-message pattern. Do not hand-roll coloured borders.
- **Header** — Desktop / Mobile × Anonymous / Logged. The logged variant carries avatar, name and menu.
- **Input**, **Select**, **Switch** (Selected = All / True / False — this is the Tous/Actifs filter).

Visible field labels sit above inputs with a separate placeholder ("Mot de passe" + "Saisissez le mot de passe…"). Keep that; placeholder-as-label is a graded accessibility failure.

### Voice

**Ship the maquettes' copy verbatim, mixed register included** (tutoiement on upload, vouvoiement on download). Defense line: the supplied designs were implemented faithfully rather than second-guessed. New strings follow the register of the screen they appear on.

### Screen inventory and states

| Screen | Designed states | To specify |
|---|---|---|
| Téléversement (upload) | idle, file chosen, over-1 Go error, success + link | progress, per-part retry, resume, scanning |
| Téléchargement (recipient) | password required, ready + Info, ready + Alert, expired + Error | **scanning**, wrong password, unknown token, rejected |
| Login | 3 mobile + 3 desktop | validation errors |
| Mon espace | list with Expire dans N/demain/Expiré, Lock badge, Tous/Actifs switch | empty state, loading |

**Expiry is relative and severity-coded**, and this pattern extends to every countdown: Info ("Ce fichier expirera dans 3 jours."), Alert ("Ce fichier expirera demain."), Error ("Ce fichier n'est plus disponible en téléchargement car il a expiré."). Expired drops the file metadata and the button entirely.

### The four missing recipient states

Reuse the card and the Callout component. Suggested copy, register matched to the screen (vouvoiement):

- **`scanning`** — Info callout: "Ce fichier est en cours de vérification. Réessayez dans quelques instants." Button disabled. **This state is why the architecture needs it: without it, `state != ready` renders identically to a broken link.**
- **wrong password** — Error callout: "Mot de passe incorrect." Field retained, attempt counter shown before lockout.
- **unknown / invalid token** and **rejected/deleted** — a single Error callout, deliberately identical: "Ce lien n'est pas valide." Never reveal which case applies, or the page becomes an oracle for probing tokens.

### Waiting mechanism

Both the uploader's post-upload wait and the recipient's `scanning` state **poll every 2 s, back off to 5 s after 30 s, give up at 2 min** with a retry affordance. No SSE or WebSockets: a sub-five-second wait does not justify a second transport and a reconnect story behind a load balancer.

### Decisions taken in this review

- **Sender identity: opt-in per upload, off by default.** Adds `File.show_sender boolean NOT NULL DEFAULT false` and a checkbox on the upload form. The maquettes show no sender anywhere, so "off" is the faithful default and the opt-in is an addition; privacy-by-default goes in SECURITY.md.
- **The link is never rendered or copyable before `state = ready`.** This is the whole answer to "how is the owner told" — a rejected file cannot have a link to send. Rejection persists as a history row carrying the reason.
- **Expired rows are purged 7 days after expiry.** Mirrors the 7-day file lifetime the product already teaches ("conservé chez nous pendant une semaine"). Second scheduled pass on the existing BullMQ purge; documented in SECURITY.md and MAINTENANCE.md.
- **Full mobile, both breakpoints, including upload.** Forces cross-reload resume (see Reviewer Concern 3) and cuts US07.

### Accessibility (graded: "accessibilité prise en compte des utilisateurs PSH")

- Visible labels on every field, as drawn. Never placeholder-only.
- **The file drop zone needs a real `<input type="file">` fallback that is keyboard-reachable and focus-visible.** A drag-only target is unusable without a pointer and is the most likely PSH failure in this product.
- `aria-live="polite"` on upload progress and on the scanning state, so screen readers hear completion rather than watching a bar.
- Focus moves to the Callout when a state changes to Error; focus is trapped in `<ConfirmDeleteDialog>` and returns to the trigger on close.
- Touch targets ≥ 44 px on mobile; the Small button is 32 px, so use Medium on 393 px.
- Contrast: verify the Callout text against its tinted background and the Tertiary button against white. Lighthouse accessibility ≥ 90 as the committed number.

### Empty and loading states (absent from the maquettes)

- **Mon espace, zero files** — explain what the space is for, plus the primary action. Not "Aucun fichier". Suggested: "Rien ici pour l'instant. Les fichiers que tu envoies apparaissent ici avec leur lien et leur date d'expiration." + primary button.
- **Mon espace, loading** — skeleton rows matching the file-row height, not a spinner, so the layout does not jump.
- **Mon espace, Actifs filter with zero active files** — distinct from zero files overall: "Aucun fichier actif. Bascule sur Tous pour voir les fichiers expirés."

## Eng review hardening

Added by `/plan-eng-review` 2026-08-11, scoped to the surface the design review introduced. Five decisions, all folded.

### Resume, corrected and re-scoped (Issue 1)

**A `File` handle does not survive a page reload.** Storing the file itself is not viable at 1 GB (IndexedDB quota, slow writes, and iOS evicts IndexedDB after roughly 7 days idle). Resume is therefore **metadata-only**:

1. Persist `{uploadId, key, partSize, fileName, fileSize, lastModified, completedParts[{n, etag}]}` to IndexedDB.
2. On return, Mon espace shows the interrupted upload with a **Reprendre** action. *This entry point exists in no maquette — it is new UI.*
3. The user **re-selects the file**. Reject on any mismatch of name, size or `lastModified`.
4. **Verify a sample of completed parts** — first, last completed, and one random middle — by recomputing the MD5 and comparing against the stored ETag. Do not hash every part: an 800 MB partial upload would block the main thread for seconds, and far longer on a phone.
5. Diff against `ListParts`, re-sign only the missing parts, continue.

**Revised estimate: ~6h, not 10h.** Not fighting Blob persistence is what makes it cheaper.

**Why step 4 exists (critical gap, Issue 4).** Without it, a user re-selecting a *different* file of the same size produces an upload whose parts come from two files, completes successfully, passes the `HeadObject` size check, and yields a **corrupt object behind a valid link with no error anywhere**. Sampled checksums turn a silent corruption path into a testable safeguard.

### The reaper and resume were in direct conflict (Issue 3)

The reaper's job is aborting `pending` multipart uploads; resume's requirement is that they still exist. The spike confirmed `ListParts` fails with `NoSuchUpload` after an abort, so whichever job ran first would win and the window was undefined.

**Resolved: reaper window is 48 hours.** Long enough for the real case (phone locks overnight, user returns in the morning). Resume is offered only inside that window. `NoSuchUpload` renders an explicit refusal plus a start-over action, never an unexplained failure. The MinIO lifecycle rule stays as a backstop.

### `show_sender` needed a field that did not exist (Issue 2)

`User` had only `email`, so the feature would have published a working email address on an unauthenticated page — a larger disclosure than the one the opt-in was meant to make safe. **Resolved: add `User.display_name` (nullable, optional at signup) and render that.** Justify the extra field in the technical doc, since US03 does not ask for it.

### Code quality (Issue 5)

- **Split the deletion service into two named methods.** `deleteFileCompletely()` (object + row, AI-owned via US06) and `purgeTombstone()` (row only, hand-written). A row-only purge must not be able to reach `DeleteObject` on an already-null `storage_key`.
- **`expiryTone(expiresAt)`** returns the Callout variant (Info / Alert / Error). Needed on the recipient page, Mon espace rows and the uploader success screen — one implementation, not three.
- **`usePollUntil`** hook shared by the uploader wait and the recipient wait.

### Performance (Issue 5)

- **Indexes in the first migration:** `(state, expires_at)` for both purge passes, `(state, created_at)` for the reaper. Free now, annoying to retrofit.
- **Throttle `GET /d/:token` in Redis, per token and per IP.** It is unauthenticated, now polled every 2 s, a token-probing surface, *and* the k6 target — load-testing an unthrottled route produces a number that says nothing about production. Reuses the limiter already needed for login.
- **Document the ClamAV egress cost in PERF.md:** the worker pulls each object out of MinIO to scan it, bounded at the 50 MB cap.

### Test gaps on the new surface (17, none covered — nothing is built yet)

Resume: re-selected file matches / differs / `NoSuchUpload` after 48 h. Polling: resolves before give-up, gives up at 2 min. `show_sender`: off by default, on renders `display_name` and never the email. Tombstone purge: 7-day boundary, idempotent re-run. Recipient states: `scanning` auto-resolves, wrong password with attempt count, unknown-token and rejected indistinguishable. Plus three the spike already proved and which must become automated tests: `HeadObject` rejects an over-cap upload, EICAR never becomes downloadable, an uploaded `.html` downloads as an attachment.

Four are E2E rather than unit: reload mid-upload → Reprendre, resume after 48 h, wrong file refused, `scanning` → auto-resolve.

## Resolved Decisions

**D9 — scope versus time. Resolved: three weeks, full scope.** The estimate (74–105h, midpoint 85) did not fit 60 hours, and the shortfall would have been paid out of the most heavily graded deliverables. Three weeks buys roughly 90 hours, covers the midpoint, and remains inside the brief's own 4-week deadline. No scope was cut to reach this.

Two things that were candidates for cutting were kept, for stated reasons:

- **HAProxy is kept.** Its config is agent-authored, so removing it would have saved review time rather than build time, which was the entire case for removing it.
- **ClamAV is kept but capped to files under ~50 MB**, with the residual risk documented in SECURITY.md. This is a technical decision, not a scheduling one: clamd's default stream limit sits well below 1 GB, and scanning a full-size file would require the worker to stream the whole object back out of MinIO, which breaks the "the API never touches file bytes" property the architecture is built on. The cap preserves the state machine, the EICAR test and the security narrative while keeping the property intact.

Trims held in reserve if weeks 1 or 2 run long: 2 Cypress scenarios instead of 3, and dropping tag filtering (already optional per US05).

## Reviewer Concerns

Raised by adversarial review. Concern 1 is resolved; the rest remain open.

1. ~~**The hour budget exceeds the deadline.**~~ Resolved by D9: three weeks, no scope cut.
2. ~~**Multi-file transfer is unsettled.**~~ **RESOLVED by the maquettes: single file per link.** The upload screen reads "Ajouter **un** fichier" and "Tu veux partager **un fichier** ?", and shows exactly one file row with one size. No multi-file drop zone exists at either breakpoint. The *Objectif*'s "un ou plusieurs" is satisfied per-link. **No `Transfer` parent entity. The schema is unblocked.**
3. ~~**Full upload resume is not achievable as originally specified.**~~ **RESOLVED as in-scope, forced by full mobile.** Persist `{uploadId, key, partSize, completedParts[]}` to IndexedDB, resume by diffing against `ListParts`, re-sign the missing parts. Roughly 10h, funded by cutting US07 (premise 2).
4. **The k6 narrative is weaker than the first draft claimed.** Load-testing the initiate endpoint measures an HMAC and an insert, not gigabyte throughput, precisely because the API does not touch bytes. Resolution adopted: load-test `GET /d/:token` plus presign (the real user-facing hot path) at 1 versus 3 replicas, reporting p95 and error rate. Separately, obtain the multipart headline number by measuring one 800 MB upload (wall clock, API CPU and RSS) beside a calculation of what proxying the same bytes would cost. Honest, and about an hour of work.

## Success Criteria

**Graded:**
- US01–US06 plus US08, US09, US10 working end to end.
- **70% line coverage, backend only, enforced by a Jest `coverageThreshold`**, with a screenshot. The React uploader is covered by Cypress rather than unit tests.
- Unit, **integration** (Supertest against a throwaway Postgres), and 2–3 Cypress end-to-end scenarios covering account creation, upload and download.
- A k6 load test as described in Reviewer Concerns 4, with written analysis.
- Front-end performance budget (bundle size, browser metrics) and a Lighthouse accessibility score.
- Accessibility for PSH users: semantic form labels, focus management on the upload dialog, `aria-live` upload progress.
- Dependency vulnerability scan with every finding documented as fixed, accepted or ignored, and why.
- TESTING.md, SECURITY.md, PERF.md, MAINTENANCE.md, a README taking a stranger from clone to running, and the technical documentation PDF including architecture diagram, MCD, OpenAPI overview, and the AI usage section.
- Slide deck supporting a 15-minute presentation, rehearsed and timed.
- Clean git history, Conventional Commits, US06 delegation visible as `feat(ai):` then `fix:`.
- Delivery package: zip named `Titre_du_projet_nom_prenom` containing `Nom_Prenom_1_documentation_mmaaaa` and so on, plus a TXT or PDF file containing the repository link.

**Self-imposed:**
- `git clone && make up` produces a working stack with no manual steps.
- Individual part failures retry transparently; an upload survives a network outage within the signature window. (Full cross-reload resume is Reviewer Concerns 3.)
- The EICAR test string is rejected and never becomes downloadable, proven by an automated test.
- An uploaded `.html` file downloads as an attachment and does not execute, proven by a test.
- Every container answers "why does this exist" in one sentence.

## Distribution Plan

Not a published artifact: this is a web application. Delivery is the Git repository plus the documentation set and the zip package above.

**The "deployment scripts" deliverable is satisfied by** `docker-compose.yml` plus `make up`, `prisma migrate deploy`, `scripts/init-bucket.sh` and a committed `.env.example`. That argument belongs in the README explicitly, because the spec names deployment scripts as a deliverable and a Makefile target does not self-evidently read as one.

Runtime deployment is deferred. Two pieces of free insurance keep it cheap: every host, port, bucket and credential comes from environment variables with no hardcoded `localhost`, and no real secret is ever committed. When revisited, the intended path is a small VPS running the same compose file.

CI is not required. If added, running tests plus the vulnerability scan on push produces TESTING.md and SECURITY.md evidence as a side effect.

## Next Steps

Hours are Nathan's own, assuming AI-assisted authoring. Infrastructure marked **[agent]** is agent-authored and costs review time only.

**Week 1 — prove the risk, then build outward (~27h at midpoint)**
0. Create the GitHub or GitLab remote and push. Fix `.gitignore`: it contains `*/`, which ignores every subdirectory and will silently swallow `backend/` and `frontend/`. **(0.5h)**
1. Spike the pre-signed upload against MinIO. See The Assignment. **(1h)**
2. Open the Figma maquettes and settle the single-file versus multi-file question before the schema. **(0.5h)**
3. Minimal compose (Postgres, MinIO, Redis, API, front, nginx), Makefile, `/health`, `scripts/init-bucket.sh`. **[agent] (1–2h review)**
4. Prisma schema and first migration, including the full state enum. **(2–3h)**
5. US03 and US04: signup, login, bcrypt, JWT, guards, Redis-backed rate limiting. **(5–6h)**
6. Multipart endpoints: initiate, `ListParts` re-sign, complete with `HeadObject`, abort. **(5–6h)**
7. React chunked uploader: sequential parts, per-part retry, progress. Interim rule: complete sets `ready` directly with a `// TODO(step 10)` marker so week one has a working download path. **(8–11h)**

**Week 2 — close the system (~29h at midpoint)**
8. US02: token lookup, expiry and state gates, password check, pre-signed GET with forced attachment disposition. **(3–4h)**
9. **US06 delegated to the AI copilot including `FileDeletionService`**, then reviewed, corrected, and committed as a visible two-step history. Journal entry written the same day. **(3–4h)**
10. Worker: `scanning` claim, magic bytes, ClamAV within the cap, state transitions. US10 purge and reapers built on the AI's deletion service. Replace step 7's interim rule. **(5–7h)**
11. US05 history (hand-written, rendering the AI's dialog in a slot) and US08 tags. **(3–4h)**
12. Rest of the React app: routing, auth forms, download page, tag input, error and empty states, accessibility pass. **(10–14h — omitted entirely from the first draft of this plan)**

**Decision point, end of week 2:** if weeks 1 and 2 landed on estimate, week 3 has slack for exactly one of US07 anonymous upload or full cross-reload upload resume. Otherwise, neither.

**Week 3 — measure, test, document (~30h at midpoint)**
13. HAProxy plus replicas **[agent]**, then k6 per Reviewer Concerns 4. Bundle budget, Lighthouse. **(3–4h)**
14. Coverage to 70% backend lines, integration tests, 2–3 Cypress scenarios, `npm audit`. **(12–18h)**
15. Four markdown files, README, technical documentation PDF, slide deck, timed rehearsal. **(9–14h)**

Deliverables are written as their subject is built, not batched at the end (premise 3).

## The Assignment — COMPLETED 2026-08-11

Run against MinIO `RELEASE.2025-09-07T16-13-09Z` with `@aws-sdk/client-s3` v3, in a throwaway directory outside the repo. **The architecture holds. Build Approach C; there is no reason to fall back to B.**

**Verified working**
- Full flow: `CreateMultipartUpload` → pre-signed part PUTs → `ListParts` → `CompleteMultipartUpload` → `HeadObject` → pre-signed GET. 12 MiB as 3 parts (5, 5, 2).
- Round-trip integrity: the downloaded sha256 matched the uploaded bytes exactly.
- **TTL is enforced.** A 5-second signature returned `200` inside its window and `403 AccessDenied` after 8 seconds. The 1-hour part TTL plus a `ListParts` re-sign endpoint is therefore both sound and necessary, not belt-and-braces.
- **`response-content-disposition=attachment` is honoured.** The download came back `Content-Disposition: attachment; filename="report.pdf"`, `Content-Type: application/octet-stream`. The stored-XSS fix works.
- **`AbortMultipartUpload` reclaims parts** (a later `ListParts` fails with `NoSuchUpload`), which is exactly what US06 needs for in-flight uploads.
- `ListParts` reports per-part sizes, so resume is implementable server-side.

**Problems confirmed**
- **Declared size is not enforcement.** A client declaring 1 MiB was signed a single part URL and pushed **25 MiB** through it, accepted. Reviewer finding 3.2 is empirically true, so the `HeadObject` check after completion is mandatory rather than defensive.
- **Minimum part size is 5 MiB**, enforced with `EntityTooSmall` at completion. The 8 MB chunk is safely above it, but the uploader needs a small-file branch: files under 5 MiB cannot be split.
- **CORS is worse than assumed.** Details in the upload flow section: `PutBucketCors` is `NotImplemented`, the `MINIO_API_CORS_ALLOW_ORIGIN` env var has no effect, and only `mc admin config set … api cors_allow_origin` restricts anything.

**Real-browser leg: verified in headless Chromium**, once `GSTACK_CHROMIUM_NO_SANDBOX=1` was available (Ubuntu AppArmor blocks the unprivileged user namespaces Chromium's sandbox needs).

- **Positive path.** With `cors_allow_origin=http://localhost:8080` and the page served from that origin, a 12 MiB Blob was sliced in the browser and uploaded as 3 cross-origin parts (42 ms, 39 ms, 20 ms). **`ETag` was readable from page JavaScript on every part**, and `CompleteMultipartUpload` assembled a 12,582,912-byte object. `Blob.slice()` plus `fetch` PUT plus ETag reading all work.
- **Negative path.** With `cors_allow_origin` pointed at a different origin, Chromium refused the request outright: *"blocked by CORS policy: Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header is present"*, followed by `net::ERR_FAILED`. So the MinIO CORS setting genuinely gates real browsers, and a misconfiguration fails loudly at part 1 rather than subtly later.

**One more thing observed in the signed URLs.** The AWS SDK v3 adds `x-amz-checksum-crc32` and `x-amz-sdk-checksum-algorithm=CRC32` query parameters by default. This MinIO release accepted them, but some S3-compatible providers (older MinIO builds, and R2 in certain configurations) reject them with opaque 400s. If a different provider fails where MinIO worked, set `requestChecksumCalculation: 'WHEN_REQUIRED'` on the `S3Client` before debugging anything else.

## What already exists (reuse, do not reinvent)

- **A complete design system.** Figma's sds with DM Sans + Inter, six components with full variant matrices, and a documented shadow token. Nothing needs designing from scratch; it needs wiring.
- **Both breakpoints drawn for every flow.** 393 px and 1440 px. Responsive is a transcription job, not a design job.
- **Callout Info/Alert/Error** already covers every status message in the product, including the four states the maquettes omit.
- **The `<ConfirmDeleteDialog>` boundary** already defined for the US06 delegation.
- **Extracted assets** at `design/figma/` (local, untracked) so no Figma seat is needed during the build. Tokens are committed in `DESIGN.md`.

## NOT in scope (considered, deliberately deferred)

- **US07 anonymous upload** — cut. Week-3 slack goes to upload resume, which full mobile makes mandatory.
- **Rewriting the maquettes' mixed tu/vous register** — deliberate fidelity to the supplied designs; state that reasoning at the defense.
- **Email notification of rejection** — gating the link on `ready` removes the failure mode for an hour instead of four plus a container.
- **SSE or WebSockets for the scan wait** — polling is proportionate to a sub-five-second wait.
- **AI-generated mockups** — the maquettes are the visual authority; only the four undesigned states were wireframed.
- **A separate TODOS.md** — design debt is captured as T1–T12 below rather than split across two files.

## Implementation Tasks

Synthesized from this review. Mostly *specification* of work already budgeted in Next Steps step 12, not new hours. The genuine addition is **T4 (~10h)**, funded by cutting US07.

- [ ] **T1 (P1, human: ~4h / CC: ~30min)** — recipient-page — Add the four missing states via the Callout component
  - Surfaced by: Pass 2 — maquettes cover 4 states; `scanning`, wrong password, unknown token and rejected are absent
  - Verify: each state reachable in Cypress; unknown-token and rejected render identically
- [ ] **T2 (P1, human: ~2h / CC: ~15min)** — upload-form — Keyboard-reachable file input behind the drop zone
  - Surfaced by: Pass 6 — a drag-only target is unusable without a pointer, and PSH accessibility is graded
  - Verify: complete an upload using only the keyboard
- [ ] **T3 (P1, human: ~1h / CC: ~10min)** — file-state — Gate link render and copy on `ready`; persist rejection reason
  - Surfaced by: Issue 3 — plan said "the owner is told why" but named no channel after Mailpit was cut
  - Verify: a rejected upload never exposes a copyable link
- [ ] **T4 (P1, human: ~10h / CC: ~1h)** — uploader — Cross-reload resume via IndexedDB + `ListParts` diff + re-sign
  - Surfaced by: Issue 4 — full mobile committed; mobile browsers suspend backgrounded tabs
  - Verify: reload mid-upload, upload resumes from the last completed part
- [ ] **T5 (P1, human: ~6h / CC: ~40min)** — responsive — Both breakpoints across all four flows
  - Surfaced by: Pass 6 — plan had zero responsive decisions; maquettes draw every screen at both widths
- [ ] **T6 (P2, human: ~2h / CC: ~15min)** — polling — 2 s → 5 s → give up at 2 min on the scanning state
- [ ] **T7 (P2, human: ~1h / CC: ~10min)** — sender-opt-in — `File.show_sender`, upload checkbox, conditional render
- [ ] **T8 (P2, human: ~1h / CC: ~10min)** — retention — Purge tombstone rows 7 days after expiry
- [ ] **T9 (P2, human: ~2h / CC: ~15min)** — empty-states — Mon espace empty, loading skeleton, zero-active-with-filter
- [ ] **T10 (P2, human: ~4h / CC: ~30min)** — design-system — Wire sds tokens and the six components as React primitives
- [ ] **T11 (P2, human: ~2h / CC: ~15min)** — a11y-runtime — `aria-live` on progress and scanning, focus management
- [ ] **T12 (P3, human: ~1h / CC: ~10min)** — a11y-verify — Contrast check, commit to Lighthouse ≥ 90

### From the eng review

- [ ] **E1 (P1, human: ~6h / CC: ~40min)** — uploader — Metadata-only resume: IndexedDB, re-select with identity check, sampled checksums, `ListParts` diff
  - Surfaced by: Issues 1 + 4 — a `File` handle does not survive reload; wrong-file re-selection corrupts silently
  - Verify: reload mid-upload and finish; re-select a different same-size file and be refused
  - **Supersedes T4** (was ~10h with Blob persistence)
- [ ] **E2 (P1, human: ~1h / CC: ~10min)** — reaper — 48 h window, explicit `NoSuchUpload` handling
  - Surfaced by: Issue 3 — the reaper aborts exactly the uploads resume needs; window was undefined
- [ ] **E3 (P1, human: ~1h / CC: ~10min)** — user-model — Add `User.display_name`, render it instead of the email
  - Surfaced by: Issue 2 — `User` had only `email`, so `show_sender` would publish an address publicly
- [ ] **E4 (P2, human: ~1h / CC: ~10min)** — deletion-service — Split into `deleteFileCompletely()` and `purgeTombstone()`
- [ ] **E5 (P2, human: ~1h / CC: ~10min)** — dry — Extract `expiryTone(expiresAt)` and `usePollUntil`
- [ ] **E6 (P2, human: ~15min / CC: ~5min)** — db-index — `(state, expires_at)` and `(state, created_at)` in the first migration
- [ ] **E7 (P2, human: ~1h / CC: ~10min)** — rate-limit — Redis throttle on `GET /d/:token` per token and per IP
- [ ] **E8 (P2, human: ~6h / CC: ~45min)** — tests — Cover the 17 gaps on the new surface, 4 of them E2E
- [ ] **E9 (P3, human: ~15min / CC: ~5min)** — perf-doc — ClamAV egress cost in PERF.md

**Net hour impact:** resume drops from ~10h to ~6h, hardening adds ~4h. Roughly a wash against the ~90h budget.

## Approved Mockups

| Screen/Section | Mockup Path | Direction | Notes |
|---|---|---|---|
| The four undesigned states + empty states | `design/gap-screens/gap-screens.png` (source: `gap-screens.html`) | Deliberately rough; states and copy are the deliverable, layout is not | Superseded on layout by the maquettes. Build the card + Callout pattern from the Figma `telechargement` screens, take the state list and the copy intent from here. |

## What I noticed about how you think

- **You reached for a task queue before anyone mentioned one.** You listed "one for celery" in your container plan. Celery is Python-only so the name did not survive the stack choice, but the instinct did: you had already worked out that expiry purging and post-upload work do not belong in the request cycle.

- **You derived the hardest requirement in the project yourself.** Before I explained pre-signed URLs you wrote: "we probably need to chunk it, 1GB can be long and a sudden network problem will make the upload fail." That is the entire justification for S3 multipart, reasoned from a file size and a bad wifi connection. I then spent several paragraphs formalising a conclusion you had already reached.

- **You overturned my call with two words.** I dismissed US06 as "thirty lines" and you replied "What about US6?" You were right, and I was measuring code volume when the graded artifact is the supervision narrative.

- **You refused to let your own comfort pick the stack.** You said "the choice should be 'what's the best option for our project and technical decision?'" while telling me Python and Django is what you actually master, then chose the framework you know least for a defensible reason.

- **You caught me over-correcting.** When an independent reviewer argued the AI rule should be read strictly, I narrowed my advice and you pushed back: "nothing about having AI Assisting me, as long as i'm the one coding, it's fair game as well." That is the correct reading, it is what the grading grid actually rewards, and it changed the hour budget enough to reverse one of my recommendations.

- **You went and got the missing evidence instead of guessing.** Three review questions in a row bottomed out at "the maquettes would answer this", so you had the Figma extracted rather than letting me keep speculating. It resolved a schema-blocking question, killed a stretch goal, and converted the weakest section of the plan from 2/10 to 9/10 in one move.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | 13 issues, 1 critical gap |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR (FULL) | score: 3/10 → 9/10, 6 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

**Context not in the table:** an adversarial completeness review ran against the pre-design-review version of this document on 2026-08-11 via `/office-hours` (6/10, 31 of 35 findings fixed). It was logged to `spec-review.jsonl` rather than the review log, so it has no dashboard row.

**Outside voice: not run.** Codex is not installed (`CODEX_MODE: not_installed`), and the Claude-subagent fallback was not dispatched because this session does not spawn subagents unsolicited. Install for cross-model coverage: `npm install -g @openai/codex`.

**Critical gap found and closed:** resume could silently assemble a corrupt object from two different files and pass every existing check. Fixed by identity verification plus sampled per-part checksums (E1).

**VERDICT:** DESIGN + ENG CLEARED — ready to implement.

NO UNRESOLVED DECISIONS
