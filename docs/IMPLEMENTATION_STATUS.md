# Reklu — Implementation Status

**Last updated:** 2026-08-16 (tenth increment — M5 foundations)

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

## Milestone 3 — Projects, memory, artifacts ✅ (§126 complete)

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

### Artifact detection ✅ (spec §19–20) — 25 tests

Deterministic heuristics, not a model call: a model would be slow, costly, and
inconsistent between identical replies. Thresholds are deliberately
conservative — **false positives are worse than false negatives**, because
clutter trains users to ignore the panel.

- Long *and* structured prose → document (length alone catches rambling)
- A substantial fenced block that outweighs its prose → code (stores the block,
  not the surrounding chatter)
- A table that essentially *is* the reply → spreadsheet; a report containing a
  table stays a document

Verified end-to-end in the browser: document uploaded → fenced into the prompt →
reply qualified → artifact created → `artifact` stream event → panel opens
beside the chat → row persisted with `sourceMessageId`, and the assistant
message links back to it.

Three real bugs found by these tests: title derivation picked a line of code
from inside a fence; a document containing a table was misclassified as a
spreadsheet because branch order was wrong; and a fixture sat just under the
threshold, which the test now guards against explicitly.

### Memory extraction 🚧 — parsing tested, live call unverified

`extractMemories()` runs after a turn, proposes at most 5 memories, and lands
them **unapproved** so the existing approval gate governs them.

- Parsing is covered by 17 tests: fenced JSON, prose-wrapped JSON, partial
  salvage of a batch containing one bad entry, and 8 malformed inputs that must
  return `[]` rather than throw.
- **Skipped entirely under the development mock**, which cannot do structured
  extraction — inventing memories from it would fill the review queue with
  nonsense. So the live model call is written but **never executed**.

### Remaining in M3 ⬜

- **Project members UI** — schema and authorization exist; no screen yet
- **Artifact editing in place** — viewer and version history are built; editing
  currently means asking in chat

---

## Milestone 4 — Research engine ✅ (§127 complete)

### `@reklu/research` ✅ — 77 tests

| Item | State | Notes |
| ---- | ----- | ----- |
| SSRF guard | ✅ | **49 tests**; blocks cloud metadata, private ranges, IPv4-mapped loopback, non-http schemes, embedded credentials, dangerous ports; re-validates after DNS and on every redirect hop |
| Citation integrity | ✅ | **28 tests**; markers validated against retrieved sources, fabricated ones stripped from prose, claim + passage stored |
| Content extraction | ✅ | dependency-free; strips scripts/nav/boilerplate, prefers `<article>`/`<main>`, rejects cookie walls as non-substantive |
| Bounded fetching | ✅ | per-domain concurrency, byte cap, manual redirect following so each hop is re-checked |
| Web adapters | ✅ | Brave / Tavily / Serper behind one interface |
| Workspace adapter | ✅ | **needs no credential** — researches the workspace's own indexed files |
| Pipeline | ✅ | 11 discrete stages, each reported as entered |
| Modes | ✅ | quick / research / deep differ in depth and rounds, not in kind |

### Verified end-to-end (no API key required)

A research run over workspace files entered **all 11 stages in order**,
retrieved a source, produced a report, persisted the session with its plan and
queries, stored the source with provenance and relevance, and created a
`research_report` artifact linked back to the session.

Two real bugs found by the citation tests: removing a marker left `"grew ."`
and a trailing space at line end. Both removal paths now share one tidy-up
routine, because having two was how they diverged.

### Sources panel ✅ (spec §25)

Every retrieved source with its citation index, domain, snippet, and — expandable
— the claims it supports with the **passage backing each one**. Sources that
failed to retrieve are listed separately with their reason rather than hidden.

### Research history ✅

List and detail screens, scoped to the author *and* workspace.

### Research → execution ✅ (spec §26)

Document, presentation and project conversions. Each preserves provenance:
verified live that a converted document carries
`derived_from_artifact_id → research_report`, so "where did this come from?"
has an answer. Starting a project carries the findings in as project
instructions, so subsequent work inherits them.

### Exact passage locating ✅ — 15 tests

Sliding-window term overlap finds the span of a source that actually supports a
claim. Returns **nothing below an overlap threshold** rather than an arbitrary
passage: an exhibit that does not support the claim is worse than no exhibit,
because it looks like evidence.

### Deep Research as a queued job ✅

Deep mode returns **202 with a session id** and runs on the worker, so a
multi-round run over up to 32 sources is not bound to a request. Stages land in
both the `jobs` row and the `research_sessions` row, so a reconnecting client
sees where the worker actually is.

Verified live: job reached **11/11 stages**, session completed with a report and
artifact, and the AI spend is traceable to the job id.

### Remaining in M4 ⬜

Nothing from §127. Two improvements deferred deliberately:

- **Contradiction detection** — `contradicted_by` is modelled and stored but
  always empty; corroboration scoring is implemented, contradiction is not
- **Academic / news source adapters** — the `SourceAdapter` interface and the
  `source_type` enum support them; only web and workspace adapters exist

### Honest limits

- **Web search is unconfigured**, so only the workspace adapter was exercised.
  The three web adapters are written but have never issued a request.
- The **development mock does not emit `[n]` citations**, so while citation
  stripping is covered by 28 unit tests, the pipeline's enforcement path has not
  been observed removing a real model's fabricated marker.

---

## Milestone 5 — Build 🚧 (sandbox, codegen parsing and checkpoints done)

### `@reklu/sandbox` ✅ — 34 tests

| Item | State | Notes |
| ---- | ----- | ----- |
| Driver abstraction | ✅ | `local` / `docker` / `e2b` behind one interface |
| Path containment | ✅ | traversal, absolute paths, `.git`/`.env`/`.ssh`/`.aws` rejected; resolved path re-checked against root |
| Environment isolation | ✅ | Reklu's `process.env` is **never** spread in; verified through a real `env` subprocess that a canary secret does not appear |
| No shell | ✅ | args passed as an array, so `; rm -rf /` in a filename is an argument |
| Timeout + output cap | ✅ | SIGKILL on timeout; output truncated at a byte cap |
| Batch atomicity | ✅ | every path validated before any file is written |
| Destroy guard | ✅ | refuses to delete a path outside its own root |
| `docker` / `e2b` drivers | ⬜ | **not implemented** — selecting them throws rather than falling back to the non-isolated local driver |

### `@reklu/build` ✅ — 21 tests

| Item | State | Notes |
| ---- | ----- | ----- |
| Codegen parsing | ✅ | accepts path-comment, fence-info and heading forms; unlabelled fences are treated as illustration, not files |
| Path rejection | ✅ | generated paths are attacker-influenced; rejected ones are **recorded with a reason**, and valid files in the same response still land |
| Checkpoints | ✅ | every change stores the **whole tree**, not a diff, so recovery never depends on replaying diffs that may themselves be wrong |
| Changed-path detection | ✅ | diffed against the previous tree, so the list is real |
| Restore | ✅ | creates a new version carrying the old tree, so the restore is undoable |

### Remaining in M5 ⬜

- **Build brief** (spec §29) — schema field exists, generation not written
- **Build chat and file generation loop** — parser and checkpoints exist; the
  orchestration that drives them does not
- **Build workspace UI** — file explorer, code view, console, preview panel
- **Preview engine** — the local driver can start a dev server; nothing calls it
- **Mobile build architecture** (spec §37)

### The isolation caveat, stated plainly

This machine has **no Docker and no E2B key**, so the only driver that can run
here is `local`, which provides **no real isolation**. It enforces path
containment, withholds Reklu's environment, caps output and kills on timeout —
all verified — but a determined process could still read the developer's
filesystem.

Production is protected by refusing to start with `SANDBOX_DRIVER=local`, and
selecting `docker`/`e2b` now throws rather than silently falling back. But the
isolation guarantee itself is **unverifiable in this environment**, and no
amount of further work here will change that.

---

## Milestones 6–11 ⬜

| # | Milestone | Notes |
| - | --------- | ----- |
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

## Verification evidence

The ✅ marks above rest on suites committed to the repo, not on a transcript.
See [VERIFICATION.md](./VERIFICATION.md).

```bash
pnpm test              # 230 unit tests
pnpm verify:auth       # 13 live checks
pnpm verify:projects   # 40 live checks
pnpm verify:queue      # 15 live checks (worker must be running)
```

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
