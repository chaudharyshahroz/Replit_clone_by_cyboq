# Reklu — Implementation Status

**Last updated:** 2026-08-16 (sixth increment — M3)

This file is the handoff contract. It is deliberately conservative: something is
listed as complete only if it has been executed and verified, not merely written.

---

## Verification legend

| Mark | Meaning |
| ---- | ------- |
| ✅   | Implemented **and** verified by a command that was actually run |
| 🚧   | Partially implemented |
| ⬜   | Not started |

---

## Milestone 0 — Audit & scaffold ✅

The target directory was empty at start; a previous Reklu at
`~/Documents/REKLU` referenced in older notes **no longer exists on disk**. This
is therefore a greenfield build, not a migration. No existing work was destroyed.

| Item | State | Verified by |
| ---- | ----- | ----------- |
| pnpm + Turborepo monorepo | ✅ | `pnpm install` succeeds |
| TypeScript strict base config | ✅ | `tsc --noEmit` exits 0 |
| `.env.example` (grouped, spec §151) | ✅ | parsed by a test that asserts it validates |
| `scripts/setup.sh` one-command setup | 🚧 | written; end-to-end run not yet exercised from clean |
| Architecture docs (§150) | ✅ | All 7 required docs present; every cross-link resolves. RESEARCH/BUILD/MCP docs are marked **design, not implementation** at the top |

---

## Milestone 1 — Foundation ✅

### `@reklu/shared` ✅ — 69 tests passing

| Module | State | Notes |
| ------ | ----- | ----- |
| `env.ts` | ✅ | Lazy, cached validation; reports **all** problems at once; production refuses to boot without an AI provider, with durable storage, with an unisolated sandbox, or over plaintext http |
| `errors.ts` | ✅ | Typed taxonomy separating internal `message` from user-facing `userMessage` + actions. No "Something went wrong" path |
| `logger.ts` | ✅ | Structured JSON/pretty logging with **mandatory** redaction — key-name and value-shape based, cycle-safe, depth-capped |
| `crypto.ts` | ✅ | AES-256-GCM envelope encryption, AAD-bound to the owning row, key rotation, keyed blind index |
| `ids.ts` | ✅ | Prefixed, time-sortable, branded ids (`Id<'project'>` ≠ `Id<'conversation'>`) |
| `result.ts` | ✅ | `Result` + `PartialResult`, the type that forces honest partial-success reporting |

Run: `pnpm --filter @reklu/shared exec vitest run` → **69 passed**

Three real bugs were found by these tests and fixed, not worked around:
1. `ID_SHAPE` validated the time component against the reduced alphabet, so ids
   generated at certain wall-clock times were rejected. Intermittent by nature.
2. Enum env vars rejected `FOO=` (empty), which is how `.env.example` ships
   optional keys — first-run setup would have failed.
3. `EMBEDDING_PROVIDER` (which has a default) demanded a key in development,
   blocking setup for anyone without an OpenAI key. Now production-only.

### `@reklu/database` ✅ — schema live

| Item | State | Verified by |
| ---- | ----- | ----------- |
| Full domain model, 15 schema modules | ✅ | **48 tables** in Postgres |
| Postgres enums | ✅ | **34** created |
| Indexes | ✅ | **198** created |
| pgvector columns | ✅ | 3: `project_memories`, `file_chunks`, `research_sources` |
| Migration generation + runner | ✅ | `migrations/0000_hot_sunfire.sql` generated and applied |
| Extension bootstrap (`vector`, `pgcrypto`) | ✅ | fails loudly rather than degrading silently |
| Pooled client + hot-reload guard | ✅ | written |
| Query helpers (tenancy, soft delete, vector, cursor paging) | ✅ | written |
| Seed data (model registry, plans, flags, built-in skills) | ✅ | idempotent; 5 providers, 9 models, 3 plans, 10 flags, 6 skills |

Verify: `psql -d reklu -c "\dt"`

### `@reklu/auth` ✅ — 17 tests + 13 live checks

Auth.js v5 is still beta and lags Next majors, so the session layer is
implemented directly against the (Auth.js-shaped) schema. See DECISIONS.md D14.

| Item | State | Notes |
| ---- | ----- | ----- |
| Password hashing | ✅ | scrypt, parameters encoded in the hash, transparent upgrade on sign-in |
| Sessions | ✅ | database-backed; cookie holds a random token, DB stores only its SHA-256 |
| Registration | ✅ | user + personal workspace + owner membership + Free subscription in **one transaction** |
| Authentication | ✅ | uniform failure response + CPU burn on unknown accounts (anti-enumeration) |
| Authorization | ✅ | `requireWorkspace` (role-ranked), `requireProject` (visibility-aware), `requireSuperAdmin` |
| OAuth sign-in | ⬜ | schema ready (`accounts`); needs provider credentials |
| Email verification / password reset | ⬜ | schema ready (`verification_tokens`); needs an email sender |

### `apps/web` 🚧

| Item | State | Notes |
| ---- | ----- | ----- |
| Design system + landing page | ✅ | tokens, marketing site |
| Sign up / sign in / sign out | ✅ | server actions; verified end-to-end in a browser |
| Route protection | ✅ | unauthenticated `/home`, `/settings`, `/skills` → 307 to `/login` (server-side) |
| App shell + sidebar | ✅ | unbuilt features render disabled with "Soon", never as dead links |
| Workspace home | ✅ | live model registry, plan, provider configuration state |
| Skills library | ✅ | real rows, grouped by category, instructions inspectable |
| Settings + system status | ✅ | honest per-capability configured/not-configured with the exact env var |
| Onboarding flow | ⬜ | spec §70 |
| Mobile navigation | ⬜ | sidebar hides below `md`; no drawer yet |

### `@reklu/storage` ✅ — 36 tests

S3 (AWS/R2/MinIO) + local drivers. Keys are server-generated from workspace and
file ids; user filenames are metadata only, so traversal is structurally
impossible. Upload validation sniffs MIME from magic bytes and never trusts the
client's Content-Type — HTML uploaded as `image/png` is detected and forced to
download, which is what stops it becoming stored XSS.

### `@reklu/queue` + `apps/worker` ✅ — 10 tests + 14 live checks

Durable `jobs` row written before enqueue; Postgres id doubles as the BullMQ job
id, making a retried enqueue idempotent. Stage reporting is validated against
per-kind declared stages. Cooperative cancellation. Payloads validated at the
worker boundary. Worker verifies Postgres and Redis before accepting work and
drains in-flight jobs on SIGTERM.

Verified live: worker boots, runs a maintenance job to completion, cancels a
queued job, shuts down gracefully.

### `/api/health` ✅

Real dependency status; 503 when Postgres is down, `degraded` when only Redis is.

### Deferred from M1 (deliberate, not forgotten)

- `@reklu/ui` — the design system lives in `apps/web` and is used consistently.
  Extraction is worthwhile only when a second app consumes it.
- Onboarding flow (§70) and the full Settings sections (§77) — Settings has
  Account, Plan and System status; Appearance/AI/Security remain.
- Mobile navigation drawer.

---

## Milestone 2 — Multi-model chat ✅ (§125 complete; §14 extras remain)

### `@reklu/ai` ✅ — 42 tests

| Item | State | Notes |
| ---- | ----- | ----- |
| Provider abstraction (`AIProvider`) | ✅ | generate / stream / embed / capabilities; no vendor SDK is imported outside `providers/` |
| Vendor adapters | ✅ | Anthropic, OpenAI, Google, xAI, DeepSeek via one AI-SDK-backed adapter |
| Development mock provider | ✅ | labelled **Development Mock** everywhere; throws if loaded in production; bills 0 units |
| Model registry | ✅ | reads `ai_models`; annotates each with whether the credential is actually present |
| Reklu Auto | ✅ | `classify()` → `route()`; hard capabilities are filters, not score penalties; every decision carries a reason |
| Usage + cost | ✅ | integer micro-dollars, no float drift; writes `ai_requests` + `usage_ledger`; never throws away an answer if metering fails |
| Quota check | ✅ | reports used/limit/remaining/reset so the UI can explain, not just refuse |

### Chat surface ✅ (verified end-to-end in a browser)

| Item | State | Verified by |
| ---- | ----- | ----------- |
| `POST /api/chat` SSE streaming | ✅ | 188 events, 185 incremental text deltas, real `finish` usage |
| Conversation + message persistence | ✅ | `conversations.message_count = 2`, user seq 0 + assistant seq 1 |
| Usage metering | ✅ | `ai_requests` and `usage_ledger` rows written with latency + TTFT |
| Model selector (grouped, Reklu Auto default) | ✅ | rendered; mock badged |
| Streaming UI, stop button, retry on error | ✅ | rendered |
| Authorization + quota before any write | ✅ | route ordering |

### Compare Mode ✅ (spec §13)

Fans one prompt to 2–4 models concurrently over a single SSE connection, each
event tagged with its `modelKey`. One model failing reports in its own column
while the others continue.

Verified live: 347 events, 171 deltas per model, **139 interleave switches**
(proving genuine concurrency rather than sequential fan-out), both assistant
messages persisted under one `compareGroupId`, per-model usage rows written.

### Conversation history ✅

Thread list, resume by URL, server-rendered transcript restore, auto title from
the first message. Scoped to author **and** workspace — a conversation is private
to its author even among workspace members.

### Markdown rendering ✅

Dependency-free renderer covering headings, lists, code blocks, inline code,
bold, italic, links, blockquotes. Parses to **React elements**, never
`dangerouslySetInnerHTML`, so model output cannot inject markup. Link hrefs
restricted to http/https/mailto, blocking `javascript:`.

### File attachments ✅ (spec §59, §60)

| Item | State | Notes |
| ---- | ----- | ----- |
| Upload route | ✅ | plan-aware size limit; rejects on declared size before buffering |
| Content validation | ✅ | MIME sniffed from magic bytes; the client's Content-Type is never trusted |
| Text extraction | ✅ | text/code inline; PDF via `unpdf`; scanned PDFs say so rather than attaching nothing |
| Images → vision | ✅ | passed as image parts; Reklu Auto then filters to a vision-capable model |
| Untrusted-content fencing | ✅ | file text enters as user-role data inside `<document>` fences, never as instruction |
| Authorized serving | ✅ | `/api/files/*` re-checks workspace membership; `CSP: default-src 'none'; sandbox` |
| Deduplication | ✅ | same bytes in one workspace resolve to one record |
| Composer UI | ✅ | attach, chips, remove, honest warning for unreadable files |

Verified live: text/PDF/image upload, **HTML spoofed as `image/png` stored as
`text/plain`** (not as an image), unrecognised binary and empty files rejected
400, attachment linked to its message, document content reaching the model.

Two real bugs found and fixed while verifying:
1. `STORAGE_LOCAL_PATH=./.storage` resolved against each process's cwd, so the
   web app wrote to `apps/web/.storage` while the worker would read
   `apps/worker/.storage` — an uploaded file would have been invisible to the
   job meant to index it. Now anchored at the monorepo root, with a regression
   test.
2. A synchronous `buildAttachmentParts` variant silently dropped images. Removed
   rather than fixed — near-identical pairs are how that bug recurs.

### Remaining in M2 ⬜

- **Conversation branching / edit-and-regenerate** (spec §14)
- **Archive, favourite, rename, search history** (spec §14)
- **Office format extraction** (docx/xlsx) — stored and reported honestly as
  not-yet-extractable; needs the `embed_file` worker handler

A real bug was found by testing in the browser and fixed: the Free plan's model
allowlist filtered out the development mock, so Chat reported itself
unconfigured even though the mock was available. Covered by a regression test.

---

## Milestone 3 — Projects, memory, artifacts ✅ (§126)

Verified by **40 live checks** against the real database, plus 11 unit tests.

### `@reklu/projects` ✅

| Item | State | Notes |
| ---- | ----- | ----- |
| Project CRUD | ✅ | creator membership created in the same transaction |
| Project instructions | ✅ | applied to every request in the project |
| Memory model | ✅ | discrete, provenance-carrying, individually removable |
| Approval gate | ✅ | **inferred memories are excluded from context until a human approves** |
| Expiry | ✅ | time-bounded facts stop being recalled rather than misleading later |
| Semantic recall | ✅ | pgvector cosine, weighted by importance |
| Lexical fallback | ✅ | Postgres full-text when no embedding provider is configured |
| Chunking | ✅ | prefers paragraph → sentence → whitespace boundaries; never splits a word |
| Indexing | ✅ | idempotent — re-indexing replaces rather than duplicating |
| Context assembly | ✅ | token-budgeted, priority-ordered, reports truncation honestly |

### `@reklu/artifacts` ✅

| Item | State | Notes |
| ---- | ----- | ----- |
| Universal artifact | ✅ | one table, `type` discriminator (DECISIONS.md D6) |
| Append-only versions | ✅ | every edit adds a version |
| Restore | ✅ | creates a **new** version carrying old content, so restore is itself undoable |
| Derivation | ✅ | `derivedFromArtifactId` preserves the research → doc → deck chain |
| Workspace scoping | ✅ | verified not loadable from another workspace |

### UI ✅

Projects list + empty state, project detail, instructions panel, **memory
inspection panel** with approve/discard for unapproved inferences, files list,
artifacts list, artifact viewer with version history and restore.

### Chat integration ✅

A chat inside a project inherits its instructions, approved memories and
retrieved file passages, prepended as a **user** message (project instructions
are user instruction, not system authority). Verified: context reached the
model, conversation attached to the project, project activity bumped.

Two real bugs found while verifying:
1. A raw `Date` interpolated into a `sql` template — postgres.js cannot bind it.
   Typechecked cleanly, failed at runtime. Replaced with Drizzle's typed
   operators throughout.
2. `touch()` built `ARRAY['a','b']` via `sql.raw` string interpolation. Safe with
   our own ids, but the wrong habit — replaced with parameter-binding `inArray`.

### Remaining in M3 ⬜

- **Automatic memory extraction** — Reklu proposing memories from conversation
  (the approval gate and UI are built and waiting for it)
- **Artifact creation from chat** — the artifact system is complete, but nothing
  yet detects "this response is substantial, make it an artifact"
- **Side-by-side artifact viewer beside chat** (spec §20 layout) — the viewer is
  a full page today
- **Project members UI** — schema and authorization exist

---

## Milestones 4–11 ⬜

| # | Milestone | Notes |
| - | --------- | ----- |
| 4 | Research engine + citations | Schema ready |
| 5 | Build workspace, sandbox, preview, checkpoints | Schema ready |
| 6 | GitHub / Vercel / Supabase, deployment | Schema ready |
| 7 | Skills | Schema ready |
| 8 | MCP + Connections + permission engine | Schema ready |
| 9 | Create: documents, slides, images, video | Schema ready |
| 10 | Agents + approvals | Schema ready |
| 11 | Billing, admin, analytics, QA | Schema ready |

The database is deliberately ahead of the application layer so that features are
built against a stable ownership and tenancy model rather than growing tables
ad hoc.

---

## Environment status on this machine

| Dependency | State |
| ---------- | ----- |
| Node | ✅ v20.20.2 (via nvm — **not on the default PATH**) |
| pnpm | ✅ 10.34.5 |
| PostgreSQL | ✅ 16 running (Homebrew), database `reklu` created |
| pgvector | ✅ 0.8.6 — **built from source** against pg16 (Homebrew ships only pg17/18 builds) |
| Redis | ✅ running |
| Docker | ❌ not installed — required later for the `docker` sandbox driver |

`PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"` is required in
non-interactive shells.

---

## Credentials needed to exercise real integrations

Everything below is absent. Each corresponding feature currently reports
**"Not configured"** by design — none of them fake success.

| Capability | Variables |
| ---------- | --------- |
| Chat / Research / Build | at least one of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `XAI_API_KEY`, `DEEPSEEK_API_KEY` |
| Semantic retrieval | `OPENAI_API_KEY` (or Google) for embeddings |
| Web research | `SEARCH_PROVIDER` + its key |
| Google / GitHub sign-in | `AUTH_GOOGLE_*` / `AUTH_GITHUB_*` |
| Repositories | `GITHUB_APP_CLIENT_ID` / `_SECRET` |
| Deployment | `VERCEL_CLIENT_ID` / `_SECRET` |
| Generated-app database | `SUPABASE_CLIENT_ID` / `_SECRET` |
| Billing | `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` |
| Isolated sandbox | `E2B_API_KEY`, or Docker installed |

---

## Known issues / decisions pending

1. **pgvector is a local source build.** It will not survive a
   `brew upgrade postgresql@16`. Production should use a Postgres image with
   pgvector preinstalled. See `docs/LOCAL_SETUP.md`.
2. **Embedding dimension is fixed at 1536 in DDL.** Changing `EMBEDDING_MODEL`
   to a different width requires a migration and a re-index. Documented in
   `.env.example` rather than silently truncating vectors.
3. **`setup.sh` has not been run end-to-end from a clean checkout.** The steps it
   performs were each executed manually and succeeded.
4. **`DATABASE_URL` default in `.env.example` names the `postgres` role**, which
   does not exist on a Homebrew install — Homebrew uses the OS username. The
   local `.env` was corrected; `setup.sh` should detect this.
