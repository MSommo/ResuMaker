# ResuMaker

Build CVs from layouts: pick a layout, fill in your details once, rearrange sections with a drag-and-drop drawer, get AI help, download a PDF.

Built for a household, with real accounts: every person signs in, sees only their own CVs, and an administrator manages who has access (see [Accounts and security](#accounts-and-security)).

```mermaid
flowchart LR
  B[React app<br/>nginx] -- /api (proxy) --> A[FastAPI]
  A --> P[(Postgres<br/>personas, CVs, chat history)]
  A --> R[(Redis<br/>cache + rate limit)]
  A --> G[LangGraph agent] --> M[Gemini]
  A -- Playwright + Chrome --> B
  C[MCP clients<br/>Claude Desktop / Code] --> S[MCP server] --> P
  S --> G
```

| Part | What it does |
|---|---|
| `src/` | React + TypeScript UI: layouts, editor, drawer, preview. CVs are loaded/autosaved through the API. |
| `backend/app/api` | FastAPI REST API (CVs, Improve, chat, PDF). |
| `backend/app/domain` | Typed CV model, layout/template catalog, and the **operations engine**, the one place edits are validated and applied. |
| `backend/app/agent` | The LangGraph editing agent (below). |
| `backend/app/mcp_server.py` | MCP server exposing the same capabilities to MCP clients. |
| Postgres | **Personas** (people, with their personal details) and their **CVs** as validated JSONB documents with optimistic versioning, plus per-CV chat history. The schema is managed by Alembic migrations. |
| Redis | Caches Improve results (24h) and rendered PDFs (keyed by content hash), and rate-limits AI calls per IP. Redis down = cache miss, never an error. |

## Run it

You need Docker and a Gemini key. There are **two completely separate stacks**, so work in progress can never disturb the app you actually use:

| | **Stable** (`make stable-*`) | **Scratch** (`make stack`, …) |
|---|---|---|
| Purpose | The app you use, with your real data | A throwaway copy for testing changes |
| Built from | A git tag (`stable-1`), never the working tree | The working tree |
| Code in containers | Baked into the image: no bind mounts, no hot reload | Baked in too (`HOT=1` adds bind mounts and hot reload) |
| Web (nginx) | **5174** | **5180** |
| API / Postgres / Redis | 8100 / 5433 / 6380 (`STABLE_API_PORT`, `STABLE_PG_PORT`, `STABLE_REDIS_PORT`) | 8180 / 5434 / 6381 (`API_PORT`, `SCRATCH_PG_PORT`, `SCRATCH_REDIS_PORT`) |
| Data | volume `resumaker_resumaker-pgdata` | volume `resumaker-scratch_scratch-pgdata` (empty, disposable) |

```bash
cp .env.example .env                 # add GEMINI_API_KEY

# Scratch: try the current code
make stack                           # build from the working tree, start, wait until healthy → http://localhost:5180
make stack HOT=1                     # same, with hot reload (Vite HMR + uvicorn --reload)
make test                            # backend tests against the scratch database
make scratch-reset                   # wipe the scratch stack completely (asks first)

# Stable: the app you use
make stable-build                    # build images from git tag stable-1 (STABLE_TAG=… for another tag)
make stable-up                       # start / update → http://localhost:5174
make stable-expose                   # reachable from your local network (see below); make stable-hide undoes it
make stable-backup                   # dump the real database to backups/
```

`make` lists every target (logs, MCP, graph, personas, PDFs, migrations…). If something already uses a port, `make` names the process and you can override it, e.g. `make stack WEB_PORT=5181`. Every address the Makefile prints or uses is built from variables (`APP_HOST`, `WEB_PORT`, `API_PORT`, `SCRATCH_PG_PORT`, `SCRATCH_REDIS_PORT`, `DEV_WEB_PORT`, `MCP_HOST`, `MCP_HTTP_PORT`), and the API itself has no built-in database or Redis address: they come from the environment (`.env.example` lists the local values).

**To release a new stable build:** commit, `git tag -a stable-2 -m "…"`, `make stable-build STABLE_TAG=stable-2`, then `make stable-up STABLE_TAG=stable-2`. The database is migrated on startup, so take a `make stable-backup` first.

**Local network.** `make stable-expose` publishes only the web port on all interfaces (`http://<your-ip>:5174`, or `http://<hostname>.local:5174`); the API, Postgres and Redis stay on localhost. Traffic is plain HTTP, so passwords and sessions cross that network unencrypted: only do this on a network you trust (not guest Wi-Fi), or put a TLS proxy in front and set `PUBLIC_URL=https://…` in `.env` (cookies then become `Secure`).

Frontend dependency changes need a rebuild (`make build-web`) unless you use `HOT=1`, where the `web` container runs `npm install` on every start.

**Without Docker for the app:** `make infra` starts just the scratch Postgres and Redis, then `make local-api` and `make local-web` run the API and frontend on the host (needs Node 22+, [uv](https://docs.astral.sh/uv/) and Chrome). Host-side commands default to the **scratch** database, never the stable one.

## Text formatting

Every text box (profile, descriptions, free-text sections) is **Markdown** (CommonMark + GitHub flavour): headings, **bold**, *italic*, ~~strikethrough~~, `code`, links, bulleted / numbered / task lists (nestable), quotes, tables and rules. The editor has a toolbar, shortcuts (⌘/Ctrl + B, I, K, ⇧X), list continuation on Enter, a Write / Preview toggle and a built-in cheat sheet. Single-line fields (bullets, highlight lines) take inline Markdown only. A single line break is kept as typed.

Rendering is safe by design: raw HTML is never rendered and images are not shown (a CV must not load remote content). Long lists and tables are split into page-breakable blocks, so they flow across PDF pages like any other content. In a bullet list on an entry, a line starting with `# ` is this app's own *subheading* marker (not a Markdown heading). `make test-web` runs the unit tests for the Markdown helpers.

## Personas and CVs

A **persona** is a user's profile: name, email, phone, address, birth date and place, nationality. A persona owns any number of **CVs**. A CV stores only its own content and its **headline** (the role it targets, e.g. "AI Strategy Lead" vs "Senior Software Engineer"). The personal details are read live from the persona, so editing them in any CV, or on the persona page, updates all of that person's CVs. Deleting a persona deletes its CVs (the UI asks first).

Schema changes go through Alembic (`backend/migrations/`); the API applies them on startup. `make migration m="..."` creates one, and `make db-backup` dumps the database first (into the git-ignored `backups/`). Migration `0002` introduced personas: it backfilled a persona for every existing CV, merging CVs of the same person by name and email.

## Accounts and security

The old `personas` table is now `users`: each person is an account with a sign-in email (`login`, separate from the contact email on their CV, which anyone may edit) and an Argon2id password hash. Their CVs, history and memories belong to them and to nobody else.

- **Authentication.** `POST /api/auth/login` sets an opaque 256-bit session token in an `HttpOnly`, `SameSite=Strict` cookie scoped to `/api` (`Secure` over HTTPS). Only its SHA-256 is stored (`sessions` table), so a database leak yields no usable sessions. Sessions expire after 7 days idle / 30 days absolute, are replaced at every sign-in, and all other sessions end when the password changes. Wrong passwords lock the account for 15 minutes after 5 tries, sign-in is rate-limited per IP, and every failure returns the same message (no account enumeration, equal timing).
- **Authorisation.** Every route requires a session unless it is explicitly public (`/status`, sign-in, accept-invite): routers are protected by default. Each `{resume_id}` / `{persona_id}` route depends on an ownership check; someone else's CV is a plain 404. `tests/test_auth.py` enumerates the OpenAPI schema and fails if a route is reachable without a session or a CV route skips the ownership check. Roles: `user` and `admin`. **Admins manage accounts only: they cannot read other people's CVs.** The last admin can't be removed, demoted or locked out; deleting an account re-asks for the password.
- **No registration.** There is no sign-up. An admin prepares a **persona draft** on the Users page (just a name and the sign-in email; no password, nobody can sign in), then generates a one-time invite link when it's ready. The person opens it, chooses a password and the account is complete; they fill in the rest of their details themselves. Drafts are *Draft* (no link yet), *Invited* (link out, valid 72 h; expired links revert to Draft) or *Active*.
- **Getting accounts.** The first admin comes from the CLI: `make user-create LOGIN=you@example.com FIRST=You ADMIN=1` (or `make stable-user-create …` for the stable stack) prints a one-time link (`/accept#token`, valid 72 h, usable once, stored hashed, in the URL fragment so no server logs it). Your **existing personas became users with no password**, their sign-in email pre-filled from the persona's email: run `make stable-user-admin LOGIN=<your email>` to make yourself admin, then `make stable-user-invite LOGIN=<email>` (or Users page → *Reset password*) to claim each one. Lost password: `make user-invite` / `make user-passwd`.
- **CSRF.** Unsafe requests need the `x-resumaker` header and, when the browser sends one, a same-site `Origin`; cookies are `SameSite=Strict`. nginx also sends a CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, and API responses are `no-store`.

Everything in place, and what production refuses to start without, is listed in [SECURITY.md](SECURITY.md).
- **PDFs.** Headless Chrome gets a 2-minute, read-only session for that one render, revoked immediately; it never sees the user's own cookie.
- **MCP.** The MCP server acts as **one user**, identified by `RESUMAKER_TOKEN` (`make mcp-token LOGIN=you@example.com`; hashed in the database, expires in a year) and refuses to start without it. Every tool is scoped to that user's CVs. Add it to the client config `env`.

- **AI use per person.** Admins see on the Users page how much each person uses the AI: requests today against the daily limit, the last 7 and 30 days, tokens, estimated cost, failures, refusals and off-topic share, with a per-day chart and the latest requests. Only counts and timings are stored (`ai_usage`, 90 days), never what anyone typed. See [docs/observability.md](docs/observability.md), which also covers request ids, JSON logs, Prometheus metrics, Sentry, and the dashboard and alert rules in `ops/`.

Out of scope for now: e-mailed invites / resets (an admin shares the link), 2FA, per-token scopes.

## The agent

`route` (a cheap model, `gemini-flash-lite-latest`) decides whether a message is a question or an edit request; if it fails, the message is treated as an edit. Questions go to `answer`, which replies in text and changes nothing. Edits go to `decompose` (the cheap model splits a big request, such as a whole-CV rewrite, tailoring or translation, into focused tasks: one per section, or per job; small requests stay one task, and any problem falls back to one task), then either to `plan` (one task) or, for several tasks, to one `write` per task, all at once (LangGraph `Send`, at most 4 concurrent model calls). Each writer plans and validates its part on its own copy of the CV, with its own repair rounds, and also sees the rest of the CV read-only so it can ground its work in real experience. `merge` then replays every writer's operations in task order on the original CV through the same validated engine, so the result is deterministic and saved once (one Undo). A `critic` reads the before/after of every changed section against the request and reports missing parts, invented or lost facts and inconsistencies; if it finds any, `revise` fixes exactly those, once (the critic never loops). A failed task is reported without sinking the others. A single task runs where Gemini returns a structured list of operations. `apply` runs them through the operations engine (deterministic, validated). If some fail, `repair` shows the model what failed and why and asks for corrected operations, up to twice. The model only *proposes*; validated code decides what changes.

```mermaid
graph TD;
  START --> route;
  route -->|question| answer --> END;
  route -->|remember| remember --> END;
  route -->|edit| decompose;
  decompose -->|one task| plan --> apply;
  decompose -->|several tasks, in parallel| write --> merge --> critic;
  critic -->|problems| revise;
  apply -->|all applied| END;
  apply -->|some failed, retries left| repair --> apply;
  apply -->|review mode| review --> finalize --> END;
```

**Review mode (the default in the chat).** The assistant proposes and you approve; "Approve all for this session" (a button in the chat and on the review card) switches to applying right away until the browser tab session ends, and you can Undo either way. The API default is unchanged (`mode: "apply"`; send `"propose"` for review). The graph pauses at `review` and nothing is saved. The paused run is stored in Postgres by LangGraph's checkpointer (its own `checkpoint*` tables; Alembic ignores them), so it survives an API restart; unanswered proposals are pruned after 7 days. You then accept all, none, or some changes; `finalize` re-applies only the accepted ones. A proposal can be decided once (`410` afterwards), and if the CV changed meanwhile the decision fails with `409`.

`make eval-router` runs a golden set of 20 messages (questions vs. edits) against the real fast model (a few cents; excluded from `make test`). It currently scores 20/20.

`make eval-memory` checks memory live (embedding cutoffs, extraction, preferences applied, a wrong memory ignored). `make eval-tailor` checks tailoring honesty live: gaps are named, nothing is invented, and an injected instruction inside a posting is ignored. `make eval-agent` runs 20 end-to-end editing tasks (single edits, multi-part requests, whole-CV rewrites, and the same on a 10-job CV) through the real graph and checks the resulting CV deterministically (no LLM judge). It reports pass rate, repairs and latency and writes `backend/.data/eval-report.json`; `EVAL_DECOMPOSE=0` runs the one-shot baseline. `EVAL_DECOMPOSE=0` runs the one-shot baseline and `EVAL_CRITIC=0` skips the critic. Results so far (single runs are noisy, treat gaps as trends): one-shot 19/20 (long CV 2/3: it left every job of a tailoring request untouched), about 5.5 s per task; sequential tasks 20/20 at about 11.5 s; parallel writers with the critic 39/40 over two runs (long CV 5/6) at about 8 s, against 35/40 without the critic. The critic costs about 1.5 s on multi-part requests.

**Import a CV.** On a person's page, "Import a CV from a file" reads a **PDF, DOCX or HTML** file (up to 10 MB) into an editable CV, shows you what it found (items per section, warnings such as year-only dates, skill levels that were not in the file, unplaced text, dates out of order) and any personal details that differ from the person's, and only creates the CV when you confirm. Old `.doc` and OpenDocument files are refused with a message to save as DOCX or PDF. Pipeline (plain functions, not a graph: it has no branching): `sniff` (what the bytes really are, ignoring the file name; zip-bomb limits) -> extract (PDFs go to Gemini directly, so layout and scans work without OCR; DOCX via python-docx incl. headers, tables, hyperlinks and text boxes; HTML via BeautifulSoup, dropping scripts and hidden elements) -> `ImportedCV` (Gemini structured output) -> a deterministic converter (new ids, dates to YYYY-MM in several languages, ISO country codes, level clamping, section to zone and icon mapping, size caps, ALL-CAPS names fixed) -> checks. The file is untrusted: the model's output is only ever data that the converter clamps and validates, never instructions. Nothing is stored. API: `POST /api/personas/{id}/imports/cv` (multipart `file`) returns a preview; creating is the normal `POST /api/personas/{id}/resumes`. `make eval-import` round-trips a known CV through DOCX, HTML and a real rendered PDF, plus a messy Italian CV, and compares (needs `make stack`). Not covered: scanned image-only PDFs have not been tested; no MCP tool yet (the Docker MCP server cannot see host file paths).

**Memory.** The assistant remembers things about each person, so you don't repeat yourself: style *preferences* ("bullets under 12 words") and *facts* they confirmed ("Staff Engineer at Acme from 2021"). Nothing is saved silently: say "remember that…" in the chat (no approval card, since asking is the consent), or add items in the chat's Memory panel, where every item is listed and can be deleted. Stored per person in Postgres with pgvector (`memories` table, Gemini `gemini-embedding-001` at 768 dimensions; saying the same thing twice keeps one). On each request the writers get all of the person's preferences plus the few facts closest in meaning to the request (cosine distance cutoff 0.38, measured by `make eval-memory`). Memory is context, never truth: the prompt tells the model to trust the CV when they conflict and never to add a remembered fact unasked. If the lookup fails the assistant just runs without it. API: `GET/POST /api/personas/{id}/memories`, `DELETE /api/memories/{id}`; MCP: `list_memories`, `remember`, `forget_memory`. Not built yet: remembering "best bullets from past CVs".

**Database image.** Both stacks run `pgvector/pgvector:pg16` (Debian). The stable stack moved to it in the first pgvector build by dumping the old alpine database (`make stable-backup`) and restoring into a NEW volume, `resumaker_resumaker-pgdata-v2`; the old alpine volume `resumaker_resumaker-pgdata` is still there, untouched, as a rollback (delete it with `docker volume rm resumaker_resumaker-pgdata` once you are happy). To roll back: set `STABLE_TAG=stable-1`, restore the old image and volume lines in `docker-compose.stable.yml` from git history, and `make stable-up`.

**Tailor to a job.** In the chat, "Tailor to a job" takes a pasted posting (the server never fetches URLs). It analyses the posting against your CV into what the role needs, what your CV already shows, and what it lacks (those gaps are never invented), then creates a **new variant CV** and proposes the changes on it in review mode, so the original is never touched. Postings are untrusted web text: only the extracted summary and keywords reach the editing agent, never the raw posting, so instructions hidden in a posting can't steer it. Discarding deletes the variant. API: `POST /api/resumes/{id}/tailor/stream`, then `.../resumes/{variantId}/chat/{runId}/decide`. MCP: `tailor_to_posting`, `list_memories` + `remember` + `forget_memory`, then `decide_proposal` on the variant.

**History and undo.** Every AI, MCP and restore change snapshots the CV first (last 100 kept), and autosaves checkpoint every 15 minutes. Undo restores the snapshot, so it works after a reload. `dryRun` on `/ops` previews changes without saving.

| Endpoint | |
|---|---|
| `POST /api/resumes/{id}/chat` | One turn, plain JSON. |
| `POST /api/resumes/{id}/chat/stream` | Same, as Server-Sent Events: `status`, `step`, then `done`, `proposal` or `error`. Body `{message, mode: "apply"\|"propose"}`. |
| `POST /api/resumes/{id}/chat/{runId}/decide` | `{accept: "all"\|"none"\|[indices]}` for a proposal. |
| `GET /api/resumes/{id}/versions`, `.../versions/{vid}`, `.../diff`, `POST .../restore` | History, diff and restore. |
| `POST /api/resumes/{id}/ops` | Apply operations; `dryRun: true` previews. |

## MCP server

Lets Claude Desktop / Claude Code list, read, edit, improve and export your CVs. It uses the same database and engine, so edits appear in the editor. (Deleting CVs is deliberately not exposed. `export_pdf` needs the frontend running; from the Docker server, files land in `backend/.data/pdfs/`.)

```bash
# Claude Code, against your REAL data (the stable stack must be running: make stable-up)
claude mcp add resumaker -- docker compose -f "$(pwd)/docker-compose.stable.yml" run --rm -T mcp

# Against the scratch stack instead (empty database, for experiments): make mcp  /  make mcp-local
#   HTTP instead of stdio (scratch database):  make mcp-http   →  http://127.0.0.1:8101/mcp
```

Claude Desktop (`claude_desktop_config.json`):

```json
{ "mcpServers": { "resumaker": { "command": "docker", "args": ["compose", "-f", "/ABSOLUTE/PATH/TO/ResuMaker/docker-compose.stable.yml", "run", "--rm", "-T", "mcp"] } } }
```

Tools: `list_personas`, `create_persona`, `list_resumes`, `get_resume`, `create_resume`, `apply_operations` (with `dry_run`), `list_versions`, `diff_version`, `restore_version`, `improve_text`, `ask_assistant`, `propose_changes` + `decide_proposal` (review before applying), `tailor_to_posting`, `export_pdf`. Resource: `resume://{id}`. Prompt: `review_cv`.

## Deployment (Railway)

Four services in one Railway project. The repo holds the config for the two we build (`railway.json` for the web service, `backend/railway.json` for the API): a Dockerfile build, a healthcheck and `ON_FAILURE` restarts.

| Service | Source | Config file (Settings → Config-as-code) | Public domain |
|---|---|---|---|
| **web** | this repo, root `/` | `/railway.json` (`Dockerfile.web.static`: the built app behind nginx) | **yes**: the only public entry point |
| **api** | this repo, root `/backend` | `/backend/railway.json` (`backend/Dockerfile`: FastAPI + Chromium) | **no**: reached by nginx over the private network |
| **Postgres** | the **pgvector** template, or a database service with image `pgvector/pgvector:pg16` | | no |
| **Redis** | Railway's Redis | | no |

Postgres **must have pgvector** (memories): the plain Railway Postgres image doesn't ship it. The first migration runs `CREATE EXTENSION IF NOT EXISTS vector`, which the default `postgres` user is allowed to do. To run the app as a less privileged role, see [SECURITY.md](SECURITY.md#database).

**Variables.** The `${{…}}` references are Railway's: they keep working when a service is renamed or redeployed.

*api*

| Variable | Value |
|---|---|
| `APP_ENV` | `production`: refuses to start with unsafe settings (below), no `/docs` |
| `PORT` | `8100` (fixed, so the web service's `BACKEND_URL` is stable) |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (`postgres://…` is accepted and turned into `postgresql+asyncpg://`) |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` (it must carry a password) |
| `PUBLIC_URL` | `https://${{web.RAILWAY_PUBLIC_DOMAIN}}` (or your custom domain): invite links, and cookies are `Secure` |
| `FRONTEND_URL` | `http://${{web.RAILWAY_PRIVATE_DOMAIN}}:${{web.PORT}}`: headless Chrome loads the app from here to render PDFs |
| `GEMINI_API_KEY` | your key (without it the app runs, with AI off) |
| `SENTRY_DSN` | optional: error reports and traces, scrubbed (see [docs/observability.md](docs/observability.md)) |
| `METRICS_TOKEN` | optional: a long random string; Prometheus metrics at `/api/metrics` with `Authorization: Bearer …` |
| `AI_PRICES` | optional: USD per million tokens per model, for the estimated AI cost (defaults are on the high side) |

*web*

| Variable | Value |
|---|---|
| `BACKEND_URL` | `http://${{api.RAILWAY_PRIVATE_DOMAIN}}:${{api.PORT}}` |
| `PORT` | `8080` (Railway's default for the domain; any value works, nginx listens on `$PORT`) |
| `TRUSTED_PROXIES` | `0.0.0.0/0 ::/0`: only Railway's edge reaches this service, so its client-address header is believed |
| `REAL_IP_HEADER` | `X-Real-IP`: the header Railway's edge overwrites with the real client address |

At start, nginx fills `nginx/default.conf.template` with `BACKEND_URL`, `PORT` and the container's own DNS resolver (read from `/etc/resolv.conf`), re-resolving the API every 10 s because private IPs change on redeploy. It listens on IPv6 too, which Railway's private network uses; uvicorn does the same (`API_HOST` defaults to `::` in the image).

**Production refuses to start** (`APP_ENV=production`) when `PUBLIC_URL` is missing or not `https://`, `COOKIE_SECURE=false`, `FRONTEND_URL` is missing, the database has no password or the local one, Redis has no password, or a `CORS_ORIGINS` entry is plain http. The log lists every problem at once.

**Migrations** run when the API starts, under a Postgres advisory lock (Alembic's and LangGraph's tables alike), so several replicas or a redeploy overlapping the old one are safe.

**PDFs** need Chromium, which is in the API image. It runs without its sandbox (containers have no user namespaces) and with `--disable-dev-shm-usage`, so Railway's small `/dev/shm` doesn't matter. It only ever loads our own frontend. Give the API service at least **1 GB of memory**: a render peaks around a few hundred MB on top of the app.

**MCP server:** not deployed. It acts as a single user without asking who calls, so it is only safe on your own machine (stdio, or HTTP on loopback). Exposing it would need per-request authentication first.

**First run.**

1. Create the four services and set the variables above; deploy. The API's healthcheck is `/api/status` (always 200 once it's up, with `db`/`cache`/`ai`/`pdf` flags), the web service's is `/`.
2. Create the first administrator **inside** the API service, where the private database address resolves (`railway run` executes on your machine, which can't reach `*.railway.internal`):
   ```bash
   railway ssh --service api -- python -m app.cli create-user --login you@example.com --first You --admin
   ```
   It prints a one-time `https://…/accept#…` link (valid 72 h). Open it, choose a password; invite everyone else from the Users page.
3. Check `https://<your domain>/api/status` shows `"db":true,"cache":true,"pdf":true`.

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md). Done: phases 1 to 5 and 7. Deferred: [phase 6, bring a job posting in from a link](docs/phase-6-job-import.md).

## Notes and limits

- **The catalog exists twice** (TypeScript for the UI, Python for the agent/MCP). `backend/tests/test_catalog_parity.py` fails if they drift.
- **PDFs** are rendered by headless Chrome loading `FRONTEND_URL/preview/<id>`, so the frontend must be reachable by the API (in Docker: `http://web:8080`, i.e. nginx, or `http://web:5173` with `HOT=1`; on Railway the web service's private address). Chrome runs with `--no-sandbox` inside the container; it only ever loads our own page.
- **The local stacks are not production**: default database password, no Redis password, plain http. For the internet, see [Deployment (Railway)](#deployment-railway).
- **Concurrent edits:** saves carry the version they were based on; a stale save is rejected (409) and the editor reloads the newer version.
