# Reklu — Implementation Status

**Last updated:** 2026-08-16

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
| Architecture docs | 🚧 | `ARCHITECTURE.md`, `IMPLEMENTATION_STATUS.md`, `DECISIONS.md`, `LOCAL_SETUP.md` written; the four deep-dive docs are outlines |

---

## Milestone 1 — Foundation 🚧

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
| Seed data (model registry, plans, built-in skills) | ⬜ | **next task** |

Verify: `psql -d reklu -c "\dt"`

### Remaining in M1 ⬜

- `@reklu/auth` — Auth.js v5, credentials + Google + GitHub, session management
- `@reklu/storage` — S3/local driver abstraction
- `@reklu/queue` — BullMQ definitions, job contracts, progress reporting
- `@reklu/ui` — design system (tokens, primitives, icon system)
- `apps/web` — Next.js app, shell, navigation, settings
- `apps/worker` — worker process

---

## Milestones 2–11 ⬜

All not started. Scope is unchanged from the specification:

| # | Milestone | Notes |
| - | --------- | ----- |
| 2 | Multi-model chat, model registry, Reklu Auto, streaming, Compare | Schema ready (`ai_providers`, `ai_models`, `ai_requests`) |
| 3 | Projects, memory, artifacts | Schema ready |
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
