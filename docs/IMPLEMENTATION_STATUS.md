# Reklu — Implementation Status

**Last updated:** 2026-08-17 (fourteenth increment — M6 integrations)

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
- Onboarding flow (§70) and the full Settings sections (§77) — Settings is a
  rail with Workspace (Overview, Connections, MCP), Account (Usage, Billing)
  and User (Profile); Appearance/AI/Security remain. System status moved to
  `/admin/system`: a customer cannot act on an unreachable database, and
  showing it to them only makes a working product look broken.
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

## Milestone 5 — Build ✅ (§128 complete; isolation unverifiable in this environment)

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

### Build brief ✅ (spec §29) — 25 tests

Reklu interprets the product before writing code, and the brief is persisted so
later edits reason against intent rather than the original prompt string. The
prompt states spec §38 explicitly: **an example is not the scope** — three
exercises in a request does not mean a three-exercise product.

Shown, not asked as a questionnaire. A malformed brief falls back to heuristics
rather than aborting the build, and target inference covers website / web_app /
dashboard / api / mobile_app. Mobile targets Expo + React Native for both stores
(spec §37).

### Generation orchestration ✅

Brief → plan → generate → merge → checkpoint, each stage announced as entered.
`mergeTree` is the property that protects a user's work: **an edit emitting
three files does not delete the other forty**, verified live.

### Build workspace UI ✅ (spec §30–31)

File explorer with a real nested tree and changed-file indicators, code view,
console showing actual install/build output including failures, preview panel,
and checkpoint history. The non-isolation warning is shown **before** anything
can be built, not discovered afterwards.

### Verified live — 24 checks (`pnpm verify:build`)

Whole-tree checkpoints, changed-path diffing against the previous version,
append-only restore that recovers old content while retaining every version,
cross-workspace isolation, edit-preserves-untouched-files, and unsafe generated
paths rejected while safe files in the same response still land.

### Preview engine ✅ (spec §34)

Materializes the tree into a sandbox, installs, starts a dev server, and tracks
it as a `sandboxes` row so idle previews can be reaped. Ports are allocated by
asking the OS rather than guessing, from a range well away from Reklu's own.

Served from a **separate origin** and rendered in a sandboxed iframe: same-origin
would give generated code access to the session cookie, which is the escape the
sandbox exists to prevent.

**Verified live** (`pnpm verify:preview`): install succeeded, a real dev server
answered **HTTP 200 on port 43000** with the generated content, the preview was
tracked as running, and after stopping, the port no longer served.

### Waitlist ✅ — 12 tests

`WAITLIST_MODE=true` turns reklu.app into a waitlist: the landing page collects
email addresses, and every route into signing in or creating an account is
hidden from the nav, the footer and the closing call to action.

**Hidden, not disabled.** `/login` and `/signup` keep working for anyone with
the address. The person running the instance still has to reach the admin
panel, and locking the door with themselves outside is not a launch strategy.

The flag is read per request rather than through `loadServerEnv`, for two
reasons. A statically rendered landing page would freeze it at build time, so
turning the waitlist off would need a rebuild rather than a restart — a value
baked into an image has caught this project once already. And full validation
on that page would make a marketing site refuse to build because no AI provider
key is configured, which is a coupling nobody would choose.

This is the only endpoint in Reklu that anybody on the internet can write to
without an account, so every protection is the only protection:

- An address already on the list gets the same answer as a new one. The
  alternative turns the form into a way to ask "is this person waiting for
  Reklu?" about any address somebody types.
- A hidden field no person can see, hidden from assistive technology too — a
  trap described to a screen reader catches exactly the people it must not.
  Anything that fills it in is told it succeeded, because a bot told it was
  caught learns to stop filling it in.
- Five signups per caller per hour, in memory. Honestly a speed bump: per
  process, forgotten on restart, and keyed on a spoofable header. The unique
  index is what bounds the damage — a flood of one address is one row.

The table holds an email, an optional source, and when an invitation was sent.
No IP address, no user agent, no referrer: each would be personal data
collected before there is an account to attach it to, and none is needed to
send an invitation. It is declared global in the workspace-scoping test, since
somebody on a waitlist has no tenant to belong to.

Admin → Waitlist lists everyone with counts, and exports CSV through a route
that repeats the super-admin check — a route handler inherits nothing from the
layout guarding the page beside it, and this one returns every address.

**Sending the invitations is not built.** Reklu has no mail provider
configured, so the addresses come out as a file rather than behind a Send
button that would do nothing.

### Types are checked before publishing ✅ — 7 tests

`next dev` reports a type error and keeps serving; `next build` refuses. So a
type error is invisible for as long as anybody is looking at the preview and
fatal the moment they publish — one project failed three publishes running,
each on a different line nobody had been shown, in a file they had never
opened.

A generation now asks the compiler, in the container that already has the
dependency tree, and hands what it finds straight back to the model. Once: a
second failure is reported rather than retried, because the same correction
attempted repeatedly is how a build spends real money going nowhere. The repair
carries a flag that stops it typechecking again, since a repair is itself a
generation.

Output is only treated as type errors when it contains `error TS####`. A project
with no TypeScript, or no compiler installed, is not a project with type errors,
and handing "tsc: not found" to a model sends it editing code that was never
wrong.

### repairClientMetadata ✅ — 6 tests

`"use client"` and `export const metadata` in one file is a compile error, and
the reader meets it as a wall of red in the preview. The export is removed and
the directive kept: without the directive the interactive parts throw at
runtime, and without the export the page renders and loses its title — a page
that works beats a page that does not compile.

The whole declaration goes, not its first line. Cutting one line leaves a
dangling object literal, which fails to compile for a new reason. The now-unused
`Metadata` type import goes with it, because the generated build script runs
`next lint` and the default config treats an unused import as an error.

A server component exporting metadata is left alone — that is where it belongs,
and stripping it there would remove the title from every correctly written page.

### Publishing ✅ (spec §40) — 22 tests

A build goes live at `<slug>.<PUBLISH_DOMAIN>` on Reklu's own server, with no
account anywhere else, and takes a custom domain when its owner has one.

A published site is not a preview that lasted longer, and the code keeps them
apart deliberately. They have opposite lifetimes: a preview exists while
somebody is looking at it and is destroyed the moment they are not, while a
published site has to be answering at three in the morning when its owner is
asleep and a stranger follows a link. Sharing a row would let the preview
cleanup take a live website down.

It also runs the application the way it will actually be run — `npm run build`
then the start script, or a static server where the build produced files rather
than a server — instead of the dev server a preview uses. A dev server
recompiles on every request and holds a compiler in memory to do it, which is
the wrong thing to leave under a public address.

The old container is stopped only after the new one is serving, so a failed
publish leaves the previous site up rather than taking a working website down
to put a broken one in its place.

**Custom domains.** A domain is recorded as `pending` and nothing routes until
its DNS is checked. That order is the point: a router carrying a hostname that
does not resolve here makes the proxy ask a certificate authority for it, the
challenge fails, and enough failures in an hour rate-limits the account —
taking down renewal for names that were working. Once verified, the site answers
on the domain, its `www` (or apex, whichever was not given), and its original
Reklu address, so a link shared before the domain existed keeps working.

Names inside Reklu's own domains are refused: a site claiming one would get a
router rule for a hostname Reklu already answers on, and which one wins would
come down to container start order.

Routing a new domain means recreating the container, since Docker labels are
fixed at creation — so it costs a rebuild, and is done only when the DNS has
actually arrived rather than on every check.

**Static export.** The first real publish failed with "Export encountered
errors on following paths", listing `/404`, `/500` and `/`. The cause was
`output: 'export'` in a generated `next.config.js` on an app with route
handlers: a static export has no server, and the model had written both. It
reads as the whole site being broken rather than as one line in a config file.
`repairStaticExport` removes the setting when the tree contains a route handler,
a pages API route, middleware, or headers/redirects/rewrites — and leaves a
genuinely static site alone, since removing it there would turn a site needing
no server into one that does.

This is a class of failure publishing exposes and previewing never did: a dev
server renders on request, so nothing is prerendered and nothing can fail at
prerender. A failed publish therefore keeps its whole build log, shown in the
panel and offered to the model as a fix. The log is trimmed from the first
error rather than tailed — Next prints its conclusion last and the cause well
above it, so tailing reliably captured the summary and dropped the reason.

Needs `PUBLISH_DOMAIN` with wildcard DNS, and `PUBLISH_SERVER_IP` to verify a
custom domain against. Without them the panel says which is missing.

### Tools tab

The Deploy tab held two export buttons, which made everything else a project
has look like it did not exist. It is now Tools: publishing and its domain,
export, the standards each generation was held to, where the code actually runs
(including when the answer is "not isolated"), and what is in the project.
Publishing also has a button in the workspace bar, which opens the panel rather
than publishing silently from a screen with no room to report anything.

Only real things are listed. A row for a feature Reklu does not have would be a
promise the tab cannot keep.

### Preview freshness ✅ — 3 tests

An edit produced new files, a new checkpoint, a reloaded frame — and the old
page. Two separate faults, both invisible because each looked like the other's
excuse.

`startPreview` stopped the previous preview, which destroys the container and
empties the map it tracks, and *then* tried to reuse what was running. It never
found anything. The reuse path — the whole reason an edit does not reinstall a
dependency tree — was unreachable code, and the only symptom was that previews
were slow, which reads as the machine being slow. The two calls are now in the
other order, and a test asserts it: the state involved is a module-private map
and a database row, so the order is checked directly rather than through enough
mocking to test the mocking.

And nothing pushed new files into a running preview at all. Generation wrote to
the database, revalidated the page and returned; the container went on serving
what it was last given. Reloading the frame — added earlier for exactly this
complaint — was reloading a server that had never been told anything changed.
`syncPreview` now runs at the end of a generation, and never fails the build:
the files are saved, and a preview that could not be updated is worth a line in
the log rather than the loss of the work that produced it.

### The composer clearing

The instruction stayed in the box for the whole build, word for word beside its
own copy in the transcript. React holds the updates inside an async transition
until the transition settles, so clearing the box in there cleared it two
minutes later. It happens outside the transition now, where it is an ordinary
update and commits at once.

### A model that repeats itself is stopped ✅ — 8 tests

A quantised model answered "hi" with the same sentence more than a hundred
times, then began reciting the system prompt, and ran until it hit the output
limit. Every token was streamed to the reader and charged for, because nothing
was watching the stream.

The detector is deliberately dull: one substantial sentence repeating six times
in a row. The danger in fixing this is cutting a correct answer short, so the
threshold sits where ordinary prose does not reach, and a repeat only counts
when it is prose — several words and real length.

That last rule came from a test. An early version stopped at any repeated line
of twelve characters, which twenty `return null;` lines satisfy, and Build
streams whole components: a false positive there loses an application rather
than a paragraph.

When it fires it says so in the reply rather than trailing off, because a
message that simply stopped would read as a network failure and lose the useful
part — that this model is a poor fit for the request.

### Imagery ✅ — 16 tests

Asked for a barber shop landing page, the model wrote an image URL from memory
and the page rendered a photograph of someone deadlifting. It was not a bad
guess so much as a guess: no model has a catalogue of real image URLs, so
anything written into a `src` is misremembered or invented, and an invented URL
is a broken image.

Pictures are searched for before any are drawn. A generated image costs money
and about half a minute, and a page wanting six costs six of each — while for
most of what a marketing site needs, a real photograph of exactly that subject
already exists on Pixabay and is free. A miss costs one request and falls
through to the generator, which is the one that never misses. The bytes are
downloaded and stored rather than hotlinked, which Pixabay's licence requires
and which also makes an exported site self-contained. Needs `PIXABAY_API_KEY`;
without it every picture is generated, as before.

The search query is built from the alt text by keeping the nouns, because alt
text is written to be read aloud and a search engine wants the subject. Getting
that wrong does not error — it returns nothing, everything falls through to the
generator, and the saving silently never happens, which is why it is the part
under test.

So the model no longer chooses pictures. It references `/generated/<name>.png`
and writes what the photograph shows in the `alt` it has to write anyway — the
accessibility rule and the art direction turn out to be the same sentence — and
Reklu draws each one with `gpt-image-1`. Proportions come from the `width` and
`height` the page already declares.

An image with no usable description is skipped rather than invented: drawing
something arbitrary would put a confidently wrong picture on the page, which is
the failure this removes rather than a smaller version of it. A picture that
fails to draw is reported and the build ships without it — the application is
written and working, and what is missing is a photograph.

They are drawn one at a time. Image generation is the most expensive call in a
build, and a page wanting six must not open six connections to a provider that
rate-limits by the minute.

The bytes live in object storage and the tree carries a key, because the tree is
read on every page load of the code view and a photograph is a megabyte. They
are fetched at exactly two points: writing a sandbox, and pushing an export —
so a preview shows the real site and an exported repository is the whole of it.
Binary files travel as base64 from the tree down to the tar header.

Requires `OPENAI_API_KEY` with `IMAGE_PROVIDER=openai`; without it the build
still completes and each image is reported as not drawn, naming the variable.

### The Google connector ✅ — 7 tests

The kind of connector other assistants offer: sign in with Google, and Reklu can
read your own documents. It is a different OAuth client from Google sign-in,
because one needs to know who somebody is and the other needs to read their
files — bundling them would ask for Drive access from anybody who wanted a login
button.

Every scope is a `.readonly` variant. A mistake in Reklu, or a model asked to
tidy somebody's Drive, cannot delete a document — and that is a property of the
grant rather than of this code being careful.

Two details that decide whether the connection survives the day. Google issues a
refresh token only for an offline request and only on first consent, so the
authorize URL sets `access_type=offline` and `prompt=consent`; without them a
reconnection returns an access token that expires in an hour and nothing to
renew it with. And the refresh response does not repeat the refresh token, so
the old one is carried forward — dropping it looks like it worked and fails
tomorrow.

**Connecting is not the feature.** A connector that connects and does nothing is
a dead button, so Drive is a source Chat and Research read: a question can be
answered out of somebody's own documents, with the text fetched at search time
so retrieval is a lookup rather than another round trip. Docs, Sheets and Slides
are Drive files, so one scope covers what other products present as four
connectors.

Needs `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`; without them
the connections page names them rather than hiding the provider.

### Finding MCP servers ✅ — 9 tests

Reklu could always connect to an MCP server and could never say which ones
exist, so the form asked for an endpoint almost nobody has memorised. The
feature was complete and looked empty to everybody who had not read the protocol
spec.

Settings → MCP now searches the official registry, and picking a server fills
the connect form. It does not connect: a server is somebody else's code reached
over the network, and its tools already arrive disabled pending review, so the
step before that begins stays deliberate.

Read live rather than kept as a list here, and this repository has already paid
for the alternative — a hardcoded set of free model identifiers, every one
withdrawn upstream within days, failing in a way that looked like Reklu was
broken rather than like the world had moved. Endpoints rot the same way.

Three filters decide what is offered, because every row that survives is
presented as something connectable. A server with no https remote is a local
process, and Reklu does not run other people's code on its own machine. A
superseded version duplicates a newer row. A withdrawn one no longer answers.

### Light mode ✅ — 4 tests

Reklu was dark only. The light tokens already existed and were complete —
declared as their own set rather than patched into the dark ones — so this was
a switch rather than a palette.

Three settings, not two: somebody whose machine changes at sunset wants Reklu to
change with it, and somebody who has chosen wants that choice to survive.
`system` is the default and follows the machine live, because a preference
already expressed elsewhere should not have to be expressed again.

Applied by an inline script in the head, before the first paint. A theme applied
from a component runs after hydration, by which point the wrong one has been
shown — and a flash of the opposite theme is the most noticeable bug a theme
switch can have. The script is tiny and defensive: a browser with storage
disabled throws on read, and a theme script that throws leaves the page
unstyled.

Light's surface ramp was wrong and looking at it is what found it: `surface` and
`surface-raised` were both pure white, which flattened every component that
distinguishes them — a raised panel sat invisibly on the panel it was raised
above, and the selected item in a group looked unselected. Light now has four
steps like dark, on the same rule: raised is further from the canvas.

A test holds the two blocks to the same token names. What each name means is a
design decision; that both exist is not — and a colour declared in one theme
and not the other looks right until somebody switches, then keeps the value from
the theme it was written in.

### Market research before a build ✅ — 6 tests

Asked for a coffee shop landing page, a model writes the coffee shop landing
page it has always written: hero, three cards, a form. It does not know what the
good ones in that trade do — that a neighbourhood cafe lives on hours and a map,
that a menu people can read beats a menu people download.

A first build now researches the trade before deciding anything, through the
existing research pipeline. That routing is deliberate: the pipeline carries
real sources and strips citation markers a model invented, so the findings
cannot be fabricated competitors. Asking a model directly what competitors do
would produce exactly that.

What comes back is turned into a plan rather than left as prose — pages,
sections in the order a visitor needs them, and a direction for how the site
should feel. The plan leads the generation prompt, because it is the part
derived from evidence. `theme` describes a feeling and its consequences and
never hex codes; the design standards choose colour, and what they need from
research is direction.

The report itself is shown in the build log with its citations, so the reasoning
is visible rather than implied.

Only on a first build. An edit already has a site with a shape, and researching
the trade again would spend a minute rediscovering decisions sitting in the
files. Without a search provider it says so, naming the variables, and builds
anyway — a site nobody researched is worth more than no site, and a search
provider that is down must not cost somebody their build.

### Build skills — design, App Router rules, imagery, performance

`VISUAL_DESIGN` addresses a specific, recognisable failure: generated sites
arriving evenly grey and evenly spaced, every heading the same size, a card
around everything — what a model produces when nothing asks it to make a
decision. Each rule names something findable in the output (a type scale with
real extremes, one accent used for one job, a single spacing scale, 65-character
measure, hover and focus states), because the file's own standard is that
guidance nobody can verify is decoration. A test rejects vague verbs in any rule.

`NEXT_CORRECTNESS` collects the App Router rules a model gets wrong in ways that
fail the build rather than the review. The recurring one is the client/server
boundary: a page needs a title so the model exports metadata, the page needs a
dropdown so it adds `"use client"`, and Next refuses the file. Both halves are
reasonable on their own. Not given to mobile builds, which are Expo — advice
about a framework in use nowhere invites a model to invent compliance.

### Build skills — imagery and performance

Two skills were added to the set appended to the system prompt. `IMAGERY` is the
convention above. `PERFORMANCE` states what makes a page fast as things visible
in the output — framework image component, `font-display: swap`, no library for
what the platform does, nothing above the fold waiting on client data, animating
only transform and opacity. Both follow the file's own rule: a standard, not a
preference, and checkable in the generated files.

### Visual selection ✅ (spec §35) — 26 tests

Stable `data-reklu-id` attributes are injected into generated JSX at
**generation time**, with a source map from id → file + line persisted alongside
the tree. Retrofitting this later would mean regenerating every existing
project, which is why §35 asks for the architecture up front.

Alt+click in the preview posts only the element id; the id is validated against
Reklu's own source map server-side before it can influence an edit, so a
generated app cannot steer the editor. The resolved selection becomes a prompt
naming the file, line and surrounding code — "make this card smaller" reaches a
specific place rather than a search.

Three tools sit above the preview and drive the same channel:

| Tool | What it does | What crosses the frame |
| ---- | ------------ | ---------------------- |
| Select | Hover outlines an element and names its tag; clicking selects | the element id |
| Edit text | Click text, retype it in place; edits gather until sent | the ids, and the person's own replacement text |
| Draw | Draw freehand over the page; the frame reports what was circled | the stroke's bounds (out), the id (back) |

Retyped text stays on the page rather than reverting when the caret leaves —
the point of typing in place is seeing it in place — and gathers into one
request, because fixing a heading and the paragraph under it is one thought.
Clearing tells the frame to put the original words back, which is the only undo
there is: nothing has been written, so the page is the only place the edit
exists. The changes reach the model as exact strings with a file and a line
each, not as a description of them; inferring the wording from a sentence about
the wording is how "change the heading" comes back as a different heading.

A bar floats over the preview naming what is picked — `2 text changes`,
`h1 selected`, `Annotation` — with Clear, and undo and redo for drawing. The
composer says the same thing, but while a tool is in your hand your eyes are on
the page, and a count that appears only in the sidebar is a count nobody reads.

A tool is put down as soon as it is used, and `off` is the resting state — with
no tool held the framed application behaves exactly as it will in production,
which is what keeps the preview a preview. The drag for the draw tool is taken
by an overlay on Reklu's side, because a drag that starts over an iframe stops
producing events the moment the pointer crosses into it.

The selection appears as a chip above the composer, with its own dismissal, so
the instruction typed under it has a subject. Attachments and a model choice
ride along the same request: an attached image is passed to the model as a
picture rather than described in words, and a file whose text could not be read
says so in the prompt rather than being silently dropped.

The one-way property is preserved throughout — the bridge sends element ids, not
page content. The single exception is the text tool, where the replacement text
*is* the instruction and the person typed it themselves.

The bridge is served from `public/reklu-bridge.js` and linked from the layout,
so updating it is overwriting a file — inlined, an application generated before
a fix would keep the old bridge for ever and the fix would never reach it.

It reaches a generated app from `instrumentForVisualSelection`, with the ids,
because they are one feature. Kept apart they drifted in the worst possible way:
every element carried an id, the source map resolved all of them, and nothing
ever sent one, because the script was written, exported, and injected into
nothing. Every tool pointed at a page that was not listening — which is
indistinguishable from a tool that does nothing, and is what shipped.

The bridge ships as a string inside every generated application, where nothing
type-checks it, so a test parses it: a syntax error there would break selection
in every generated app at once, with no symptom beyond a tool that does nothing.

Instrumentation is deliberately conservative: ambiguous lines are skipped. A
missed element costs a click-to-edit opportunity; a corrupted generated file
costs the whole build.

A real bug was found by the live run: the sandbox's fixed minimal `PATH`
excluded the Node toolchain, so **every `npm install` failed with exit 127** —
isolated to the point of uselessness. `PATH` now includes the running node's
directory (a location, not a secret), with a regression test proving both that
`npm` runs and that Reklu's secrets still do not leak.

### M5 remaining ⬜

Nothing from §128.

### The isolation caveat, unchanged

No Docker, no E2B key. The only driver that runs here is `local`, which provides
**no real isolation**. Path containment, environment withholding, output caps and
timeout kills are all verified — but a determined process could still read the
developer's filesystem. Production refuses to boot with `SANDBOX_DRIVER=local`,
and selecting `docker`/`e2b` throws rather than falling back. **The isolation
guarantee itself remains unverifiable in this environment.**

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

## Milestone 6 — Integrations ✅

`@reklu/integrations` — 58 tests. GitHub, Vercel and Supabase: OAuth,
connection storage and deployment adapters.

| Item | State | Verified by |
| ---- | ----- | ----------- |
| Provider adapter interface + registry | ✅ | one shape for three providers; adding one is an adapter, not a code path |
| OAuth state — AEAD-sealed, cookie-bound, expiring | ✅ | CSRF, tamper, replay, cross-provider and foreign-key cases all tested |
| PKCE (S256) for providers that support it | ✅ | Supabase; verifier stays in the cookie and never reaches the provider |
| `safeReturnTo` open-redirect guard | ✅ | absolute, protocol-relative, backslash and CRLF cases tested |
| Token storage, AAD-bound to `connection:<id>` | ✅ | encryption centralised in `connections.ts`; no adapter can bypass it |
| Refresh with rotation handling | ✅ | Supabase only — the other two issue non-expiring tokens and say so |
| `/api/integrations/[provider]/start` + `/callback` | ✅ | both routes build; every failure redirects with a readable message |
| Settings → Connections UI | ✅ | three distinct states: not configured, available, connected |
| Unconfigured providers name their env vars + callback URL | ✅ | spec §25 — no dead buttons |
| GitHub push — blobs → tree → commit → ref, one commit | ✅ | empty-repo and existing-branch paths both tested against a stubbed API |
| Vercel deploy — inline file tree, no git repo required | ✅ | reports Vercel's own state; never claims READY on its own |
| Supabase provisioning — project + one-time DB password | ✅ | weak passwords refused; async status polled, never assumed |
| Unicode-safe repo/project naming | ✅ | regression: NFKD combining marks turned every accented letter into a hyphen |
| Export panel in the Build workspace | ✅ | push to GitHub / deploy to Vercel; missing connection reads as setup, not failure |
| `deployments` row written before the external call | ✅ | a crash mid-push leaves a failed record, not silence (D9) |
| Honest deployment status | ✅ | only an explicit READY maps to `ready`; unknown states stay `deploying` |

**Not exercised against a live provider.** No OAuth credentials are registered
yet, so no authorization and no push has completed end to end. Deployment
adapters are tested against a stubbed `fetch`, which verifies request shape,
ordering and what is *not* sent — not that GitHub accepts them. Registering one
GitHub OAuth app is what turns this from tested to verified.

**Export UI is wired.** The Build workspace has an Export panel that pushes to
GitHub or deploys to Vercel, records a durable `deployments` row before the
external call, and reports the provider's own state. It is reachable wherever
Build is — which in production means once `BUILD_ENABLED=true`.

---

---

## Milestone 7 — Skills ✅

`@reklu/skills` — authoring, append-only versioning, rollback, publishing,
install with pinned versions, and `@handle` invocation in chat.

| Item | State | Evidence |
| ---- | ----- | -------- |
| Authoring, editing, duplication | ✅ | `/skills`, `/skills/[skillId]` |
| Append-only versions + rollback | ✅ | rollback appends a version carrying old content |
| Publish / withdraw, install pinning | ✅ | publishing a revision does not move an existing pin |
| `@handle` invocation | ✅ | wired into `/api/chat` |
| Untrusted-content boundary | ✅ | skill text is user-role, fenced, structurally neutralised |
| Cross-workspace isolation | ✅ | `pnpm verify:skills` — private skill unreachable by known handle |

**Not verified:** no skill has been invoked against a live model in production.

---

## Milestone 8 — MCP + permission engine ✅

`@reklu/mcp` — connect servers, classify tools, decide every call, audit
everything.

| Item | State | Evidence |
| ---- | ----- | -------- |
| Server connect, discovery, rediscovery | ✅ | `/settings/mcp` |
| Tools discovered **disabled** | ✅ | connecting grants nothing |
| Risk classification | ✅ | server hints may only raise a class, never lower it |
| Schema-poisoning detection | ✅ | `pnpm verify:mcp` — change withdraws approval *and* re-classifies |
| Audit trail incl. denials | ✅ | `tool_executions` row for every outcome |
| SSRF guard | ✅ | asserts `BLOCKED`, not merely "failed" |
| Co-located sidecar support | ✅ | `MCP_ALLOWED_HOSTS`, narrow by design |
| Chat tool calling | ✅ | every call re-runs the engine |

**Not implemented:** stdio transport (deliberate — see `docs/MCP_SIDECAR.md`),
and OAuth-authenticated MCP servers. Bearer credentials only.

**Not verified:** no MCP server connected through the production UI; no model
has called a tool.

---

## Milestone 9 — Create ✅

`@reklu/create` — documents, slide decks, images, and real Office exports.

| Item | State | Evidence |
| ---- | ----- | -------- |
| Documents → Markdown artifact | ✅ | `/create` |
| Decks → structured data + HTML | ✅ | structure is the source of truth |
| Images → stored, not linked | ✅ | base64 saved under a server-generated key |
| Type-aware artifact rendering | ✅ | images display; decks render as slides |
| PPTX / DOCX export | ✅ | real OOXML, asserted by ZIP signature |
| Video | ⬜ | declared, unimplemented, states so in the UI |

**Not verified:** nothing has been generated against a live model, so exports
have only run on constructed decks.

**PDF export** is deliberately absent: it needs a headless browser, and the
exported HTML already carries print styles.

---

## Milestone 10 — Agents + approvals ✅

`@reklu/agents` — plan, execute one step at a time, stop for a human whenever a
step has a side effect.

| Item | State | Evidence |
| ---- | ----- | -------- |
| Plan before executing | ✅ | `/agents` shows the plan before anything runs |
| One step per call | ✅ | the loop lives with the caller, never in a request |
| Step + cost ceilings | ✅ | checked *before* a step, never after |
| Approval gate for side effects | ✅ | stricter than MCP: only `read_only` runs unattended |
| Payload integrity | ✅ | fingerprinted at approval, re-checked at execution |
| Approval expiry | ✅ | consent does not survive indefinitely |
| Durable runs | ✅ | a crash between steps loses nothing |
| Audit | ✅ | inherits `tool_executions` via the MCP engine |
| Autonomous execution | ✅ | worker drives runs on the `agent` queue |
| Live verification | ✅ | `pnpm verify:agents` — 22 checks against the real database |

**Not verified:** no run has been planned against a live model. `verify:agents`
seeds steps directly so it costs nothing, which means the planner itself — the
one part that calls a model — is still only covered by unit tests.

---

## Milestone 11 — Billing, admin, QA ✅

| Item | State | Evidence |
| ---- | ----- | -------- |
| Whop embedded checkout | ✅ | opens inside the plan picker, wherever it was opened from; card details never touch Reklu |
| Checkout sessions recorded before payment | ✅ | `checkout_sessions`; the link back to a workspace that does not need metadata to survive |
| Reconciliation against Whop's API | ✅ | runs on return from checkout and from a button; `reconcileWorkspaceBilling` |
| Card brand and last four | ✅ | filed from `payment.succeeded` and from reconciliation; null where Whop sent none |
| Auto-renewal | ✅ | Whop renewal plans; the line is shown only where the membership actually renews |
| Cancel from Reklu | ✅ | `POST /memberships/{id}/cancel` at period end; owner/admin only; resume before it ends |
| Checkout session carries the workspace | ✅ | minted via Whop's API so the webhook can attach the membership |
| Plan prices shown from the `plans` table | ✅ | must match the Whop plans the ids point at |
| Webhook signature verification | ✅ | raw body, constant-time, replay-bounded, rotation-aware |
| Membership → subscription | ✅ | idempotent; a downgrade deletes nothing |
| Quota enforced on every model path | ✅ | guarded by `pnpm verify:repo` |
| Admin panel | ✅ | `/admin`, gated on `isSuperAdmin` |
| Content-Security-Policy | ✅ | added; no `unsafe-eval` |
| HSTS, no `X-Powered-By` | ✅ | `pnpm verify:security` |
| Auth required on every app route | ✅ | asserted against a running origin |

**Not verified:** no live Whop delivery received and no payment taken. The
checkout-session call is written against Whop's documented
`POST /api/v1/checkout_configurations` contract and covered by tests against a
stubbed transport, but no real session has been minted. The first live purchase
is what proves the workspace id survives the round trip into the webhook, and
that is the one thing that cannot be proven from here.

`WHOP_API_KEY` is required, not optional: without it there is no checkout
session, so a payment arrives carrying nothing that identifies the workspace
and the customer is charged without being upgraded.

**Accessibility** — axe runs against the served HTML of `/`, `/login` and
`/signup` via `pnpm verify:a11y`. No serious or critical violations. Colour
contrast, focus visibility and target size are **not** covered: jsdom applies
no stylesheet and does no layout, so those rules need a real browser. That is
a real gap, stated rather than papered over.

**Performance** — `pnpm verify:perf` holds a client-JS budget (763 KB against
1.6 MB), response times, and compression. No Lighthouse run: it needs a
browser, and the numbers that matter most here are already covered.

The database was deliberately built ahead of the application layer so features
grow against a stable ownership and tenancy model rather than adding tables ad
hoc. Milestones 0–9 have now caught up to it.

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
pnpm test                        # 895 unit tests
pnpm verify:auth                 # 13 live checks
pnpm verify:projects             # 40 live checks
pnpm verify:queue                # 15 live checks (worker must be running)
pnpm verify:build                # 24 live checks
pnpm verify:preview              # 14 live checks
pnpm verify:production-config    # 17 checks on .env.production.example
pnpm verify:repo                 # a fresh clone contains what the build needs
pnpm verify:links                # every public-page link resolves (no server needed)
pnpm verify:security             # headers, disclosure and auth, against a live origin
pnpm verify:a11y                 # axe against served HTML
pnpm verify:perf                 # JS budget, response time, compression
pnpm verify:all                  # repo, links, a11y, perf, security
pnpm verify:e2b                  # live microVM checks (needs E2B_API_KEY)
pnpm verify:oauth                # sign-in account linking, against the real DB
pnpm verify:skills               # authoring, versioning, cross-workspace isolation
pnpm verify:mcp                  # live MCP server: discovery, permissions, schema drift
pnpm verify:agents               # budgets, payload integrity through real jsonb, tenancy
```

---


## Deployment ✅ — live at https://reklu.app

Targets a Hostinger VPS running Dokploy alongside other applications, at
`reklu.app`. See [DEPLOYMENT.md](./DEPLOYMENT.md).

| Item | State | Verified by |
| ---- | ----- | ----------- |
| `Dockerfile` — one image, `web`/`worker`/`migrate` entrypoints | ✅ | image builds on the host; `next build` compiles and typechecks inside it |
| `scripts/docker-entrypoint.sh` | ✅ | all three roles run; migrate completes and exits 0 |
| `docker-compose.yml` — non-invasive Dokploy stack | ✅ | deployed alongside existing apps; no host ports, no existing service touched |
| E2B sandbox driver — isolated microVM execution | 🚧 | typechecks against the real SDK; selection, isolation claim and config reporting tested. **No live microVM yet** — `pnpm verify:e2b` |
| `docker` sandbox driver | ⬜ | still declared and still throws; points operators at e2b |
| Live health check | ✅ | `GET https://reklu.app/api/health` → 200, `status: ok`, pgvector enabled, queue reachable |
| HTTPS via Traefik + Let's Encrypt | ✅ | certificate issued; homepage and health both 200 |
| `.dockerignore` excludes `.env` and host `node_modules` | ✅ | asserted by inspection; `.env` is also git-ignored |
| `.env.production.example` | ✅ | `pnpm verify:production-config` — 17 checks pass |
| Production guard escape hatches (D18) | ✅ | 11 new tests in `packages/shared/src/__tests__/env.test.ts` |
| `web` production build | ✅ | `pnpm --filter @reklu/web build` succeeds |

Deployed 2026-08-16 to a Hostinger VPS running Dokploy. Five failed attempts
preceded the successful one; every failure was configuration rather than code,
and two produced permanent fixes: startup now rejects unedited template
placeholders, and the container startup path no longer depends on pnpm.

**Postgres initialises its password only once.** Changing `POSTGRES_PASSWORD`
after the volume exists does nothing — the database keeps the original. This
cost two deploy cycles. Recreate the volume, or keep the original value.

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
5. **Build is off in production** (`BUILD_ENABLED=false`) until an E2B key is
   set. The isolated driver now exists; enabling it is `SANDBOX_DRIVER=e2b`
   plus `E2B_API_KEY`, then `BUILD_ENABLED=true`.
9. **The E2B driver has never talked to a live microVM.** It typechecks against
   the real SDK types and its selection/configuration logic is unit-tested, but
   creating a sandbox, writing to it and running a command in it is unverified.
   `pnpm verify:e2b` performs exactly that and needs a key.
8. **`.gitignore` once excluded a whole package.** An unanchored `build/` matched
   `packages/build` and both Build UI directories, so all of M5 was absent from
   every deploy while working locally. Guarded by `pnpm verify:repo`; run it
   before trusting that a green local build means a green clone.
6. **Build is off in the shipped production configuration** (`BUILD_ENABLED=false`).
   Enabling it needs an isolated sandbox — E2B, or a Docker host separate from
   the app server. Neither the `docker` nor the `e2b` sandbox driver is
   implemented; both currently throw rather than falling back. See D18.
7. **`STORAGE_DRIVER=local` in production is single-node only.** Scaling `web`
   past one replica silently breaks uploads. Move to S3/R2 before scaling.
10. **Credit top-ups do not exist.** `/settings/usage` says so rather than
   offering a button. They need a one-off purchase flow and a credit balance
   held separately from the plan's monthly allowance; neither is built, and a
   button would take money for something that would not arrive.
11. **Twenty-seven colour classes named tokens that were never declared** —
   `text-accent-foreground`, `bg-success-subtle`, `border-danger-border`,
   `bg-surface-sunk`. Tailwind emits no rule for a class it cannot resolve, so
   success banners had no background and danger borders no border, across
   sixteen files, silently. All fixed; `pnpm verify:tokens` now fails the build
   on a colour class that resolves to nothing.
23. **Self-hosted sandbox (`SANDBOX_DRIVER=docker`) is implemented but has never
   talked to a real Docker daemon.** The container hardening, tar packing and
   stream demultiplexing are unit-tested, and the tar output was checked against
   the system `tar`. Creating a container, installing packages and serving a
   preview is unverified — there is no daemon on this machine. Setup and the
   security trade are in `docs/SELF_HOSTED_SANDBOX.md`; a container shares the
   host kernel, which is why the daemon belongs on a separate machine and why
   Reklu refuses a local one without `SANDBOX_DOCKER_SAME_HOST_ACK`.
21. **Build previews never started the application in production.** The local
   sandbox driver spawned `npm run dev`; the E2B driver — the one production
   uses — only asked E2B for the public hostname of a port and returned it,
   with nothing ever listening on that port. Every preview was a URL that
   resolved and then refused the connection, indistinguishable from generated
   code that does not work. `devCommandFor` now derives the command from the
   generated `package.json` (Next `--hostname`, Vite `--host`, Expo's web
   subcommand) and both drivers start it, bound to 0.0.0.0 so E2B's proxy can
   reach it. **Unverified against a live microVM** — the local `.env` has no
   E2B key, so this is checked by unit tests and reasoning, not by a running
   sandbox. `pnpm verify:e2b` with a real key is the missing step.
24. **Generation had no visual pass.** One prompt asked a model to implement
   features *and* art direct, so it spent its attention on the features and
   reached for the layout it had seen most. `design-pass.ts` is a second call
   with one job — keep the behaviour, raise the design — run on first
   generation only, for targets where presentation is the product. Failure is
   absorbed: a plain working app beats no app.
26. **`docker system prune` broke the next build, twice.** It removes any image
   no container is using *and* any network nothing is attached to — and a
   sandbox image and network are both unused by definition between builds. Each
   surfaced as an error that reads like a broken deployment. Both are recreated
   on demand now, the network with the same subnet the firewall rules name so it
   does not come back unconstrained.
26b. **The sandbox image was treated as installed once and kept.** It is not:
   `docker system prune` removes any image no container is using, and a sandbox
   image is unused by definition between builds — so the first build after a
   routine cleanup failed with "No such image". Pulled on demand now, once, and
   only when the daemon says it is missing.
28. **A build reported one word for two minutes.** Generation was a single
   non-streaming call, so "generating" was the only honest thing to show for
   its whole duration. It now streams, names each file as its block begins, and
   writes every step to `build_events` — which the workspace reads back as a
   log. Nothing is on a timer; if the list stops moving, the build has stopped.
27. **Building took four deliberate steps**: read a message, notice a link,
   click it, press a button. Now one: the chat navigates to the workspace when
   the brief is ready, generation starts on arrival from `briefing` (never after
   a failure, which would loop), each stage is written down as it is entered and
   read back by the screen, and the preview starts itself when files appear.
25. **The build page was a vertical stack**, so the preview began below the
   fold and the application was never visible beside the conversation about it.
   Now two panes: brief and composer left, preview right. The preview also
   starts on its own and is the default tab once files exist.
22. **Generation gave every target the same advice.** A marketing site and an
   iOS app received an identical prompt. `build-skills.ts` adds per-target
   standards, appended to the system prompt so a request cannot argue them
   away.
20. **Cancelling needs two more scopes on the Whop key**: `membership:cancel`
   to cancel, `member:manage` to resume. Without them the button reports the
   refusal and names the scope; nothing is silently half-done.
19. **CAUSE FOUND: the Whop company API key had no read scopes.** Whop:
   `Company API key is not authorized for the member:basic:read scope`. A
   company API key is created with none of them, so checkout worked (it had
   create scopes) while every read came back 403 — and the code turned that
   403 into "this company has no memberships". Four rounds of code changes
   chased a configuration problem. `REQUIRED_SCOPES` in `whop-api.ts` lists
   what each endpoint needs, the 403 message names them all rather than the one
   Whop reports, and `/admin/billing/diagnostics` shows them without needing to
   hit the error first.
17. **"Whop has no completed purchase for this workspace" was a lie the code
   told.** `get()` returned `undefined` for both "Whop refused" and "Whop
   returned nothing", so a failed API read was rendered to a paying customer as
   proof their purchase did not exist. Reads now return a failure with a status
   and a sentence naming what to change — a 403 says the API key needs
   permission to read memberships, a 404 says `WHOP_COMPANY_ID` is probably the
   wrong company. `lookup_failed` is a distinct outcome from
   `no_membership_yet`.
18. **Applying a purchase required pressing a button, which nobody does.**
   `autoReconcile` now runs in the app layout: one indexed query on the common
   path, a Whop call only when a checkout from the last hour is unresolved,
   rate limited to one check per fifteen seconds per session.
15. **The paid-customer bug survived two fixes because it was never diagnosed.**
   Both attempts reasoned from the symptom to a plausible cause and fixed that.
   There are four causes — Whop not calling the endpoint, a signature that does
   not verify, a payload naming no workspace, and a plan with no Whop id — and
   nothing in the product could tell them apart. Every webhook delivery is now
   recorded in `webhook_deliveries` (including rejected ones, since "nothing
   arrived" and "arrived and was refused" are the whole question), and
   `/admin/billing/diagnostics` reads that log beside Whop's own records and
   names which of the four it is. Diagnose there before changing anything.
16. **The payment form lives in an iframe inside the plan dialog**, so Whop's
   redirect reaching the top window is not something Reklu controls. When it
   does not, no `?status=success` ever loads and reconciliation never runs. The
   dialog now polls while the form is open, bounded to two minutes.
13. **A paid customer stayed on Free, and the cause is still not confirmed.**
   The plan and the payment are two writes from one webhook and both were
   missing, which means the delivery either never arrived or named no
   workspace. Rather than guess, Reklu no longer depends on being told:
   checkout sessions are recorded before payment, Whop stamps that id on the
   membership, and `reconcileWorkspaceBilling` reads it back on return from
   checkout. The webhook is now the fast path, not the only one.
14. **`setPlan` wrote `externalSubscriptionId`, which is not a column.** Drizzle
   drops an unknown key from `.set()` silently — confirmed against a live
   database, it does not throw — and a conditional spread hid it from
   TypeScript. Every Whop membership id since the migration was discarded, so
   there was no way back from a workspace to its membership. Now
   `whopMembershipId`, and reconciliation depends on it.
12. **`pnpm test` can fail on a developer machine at full concurrency.** Turbo
   runs eighteen vitest instances at once; on a constrained host they die and
   turbo reports a test failure. `npx turbo run test --force --concurrency=4`
   is the reliable local invocation — all 18 packages pass under it.
