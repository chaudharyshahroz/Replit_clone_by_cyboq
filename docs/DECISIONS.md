# Technical Decision Log

Decisions that were not obvious, with the reasoning and the alternative that was
rejected. Spec §147 asks for this so a later session does not silently undo a
deliberate choice.

---

### D1 — Packages export TypeScript source, not build output

**Decision.** Workspace packages set `"main": "./src/index.ts"`. `apps/web` uses
Next's `transpilePackages`; `apps/worker` runs under `tsx`.

**Why.** A per-package `tsup`/`tsc` build step in a monorepo this size costs a
watch process per package and produces a class of bug where stale `dist/` output
silently shadows a source edit. Neither consumer needs prebuilt output.

**Rejected.** Building each package to `dist/`. Reconsider if a package is ever
published externally or consumed by a runtime that cannot transpile TS.

---

### D2 — Auth.js (v5) with our own tables, rather than a hosted auth vendor

**Decision.** Own the `users` / `accounts` / `sessions` tables.

**Why.** Reklu's authorization model is workspace-scoped with roles, project
membership, plan-derived entitlements, and a super-admin plane. All of that has
to join against user rows. With a hosted vendor those joins cross a network
boundary or require a shadow user table that can drift.

**Rejected.** Clerk/Auth0. Faster to start, but the entitlement joins and the
admin panel are the bulk of the work and both want local rows.

---

### D3 — Prefixed, branded, time-sortable ids instead of UUIDs

**Decision.** `prj_0abc…`, typed as `Id<'project'>`.

**Why.** Two concrete wins. A stray id in a log or support ticket is
self-describing. And `Id<'project'>` is not assignable to `Id<'conversation'>`,
so passing the wrong id to an authorization check is a compile error rather
than a 404 — or worse, a cross-tenant read. The time prefix keeps B-tree inserts
local, which random UUIDv4 does not.

**Note.** The time component is base-32 (`0-9a-v`) while the random suffix uses a
reduced look-alike-free alphabet. The validation regex must accept both — getting
this wrong produced an intermittent bug caught by tests.

---

### D4 — Secrets are AAD-bound to their owning row

**Decision.** `encrypt(token, "connection:con_abc")`; decryption requires the
same associated data.

**Why.** Encryption alone protects against a database dump. It does *not* stop an
attacker who can write to the database from copying another workspace's
ciphertext onto their own connection row and having the app decrypt it for them.
AAD binding turns that into a decryption failure.

**Cost.** Callers must pass the owner string. Enforced by the `SecretBox` API
shape and covered by tests.

---

### D5 — One `conversations` table for Chat, Research, Build, Compare, Agent

**Decision.** Discriminate with a `mode` enum.

**Why.** These surfaces share history, branching, attachments, artifacts and
permissions. Spec §121 explicitly forbids parallel feature silos; separate tables
would force every shared capability to be implemented several times and would
make "continue this research in Build" a data migration.

---

### D6 — One `artifacts` table for every output type

**Decision.** Documents, decks, images, code, apps, and research reports are all
artifacts with a `type` discriminator and shared version history.

**Why.** The product's core promise is that research becomes a document becomes a
deck becomes an application. That is a transformation between two rows of the
same shape. Per-type tables would make each conversion a bespoke integration.

---

### D7 — Models and plan limits are data, not code

**Decision.** `ai_models` rows carry capabilities, cost, routing priority and
plan availability. `plans.limits` is JSON.

**Why.** Spec §80 requires admins to enable/disable models and change plan access
without a deploy, and §73 forbids hard-coded pricing. It also means Reklu Auto's
routing inputs are tunable in production.

**Cost.** `plans.limits` JSON is validated by a Zod schema in the billing package
rather than by the database.

---

### D8 — `numeric` for money and token rates, never floating point

**Decision.** `numeric(12,4)` / `numeric(12,6)`.

**Why.** These values are multiplied out into billing and quota decisions.
Binary floating-point drift in a usage ledger is not acceptable.

---

### D9 — Durable `jobs` rows; Redis is transport, not truth

**Decision.** Every async operation has a Postgres `jobs` row. BullMQ carries it.

**Why.** A Redis restart should cost throughput, not a user's in-flight deep
research run. It also gives cancellation, attempt counting, and the Activity
panel a single queryable source.

---

### D10 — Progress reflects real backend stages

**Decision.** `research_stage` and `jobs.stage` are enums/strings written by the
code that actually performs the step.

**Why.** Spec §25 and §89 forbid fake progress. A timer-driven progress bar is
worse than none: it teaches users that the indicator is meaningless, so a genuine
stall looks normal.

---

### D11 — Missing configuration degrades honestly; production refuses to boot

**Decision.** `features()` reports per-capability availability; the UI renders
"Not configured" naming the exact variable. In production, missing critical
configuration is a hard startup failure.

**Why.** Spec §111 and §137. A dead button that looks alive is the specific
failure mode the specification calls out repeatedly. Development should be easy
to start; production should be impossible to misconfigure quietly.

**Correction made.** `EMBEDDING_PROVIDER` initially demanded a key in all
environments. Because it carries a *default*, a developer never opted in, so
this blocked first-run setup for anyone without an OpenAI key. Now
production-only.

---

### D12 — Audit logs are separate from the activity feed

**Decision.** `audit_logs` and `activities` are distinct tables.

**Why.** They have different consumers and different retention and integrity
requirements. Activities are a product feature. Audit logs are a security record:
append-only, actor preserved via `ON DELETE SET NULL` plus a denormalized
`actor_email`, so deleting a user cannot erase the trail.

---

### D13 — pgvector built from source against PostgreSQL 16

**Decision.** Compiled `pgvector` 0.8.6 against the running Homebrew pg16.

**Why.** Homebrew's `pgvector` bottle ships only pg17/pg18 libraries. The
alternative — installing pg17 — risked disturbing an unrelated database
(`ordli_dev`) already living on the pg16 instance.

**Consequence.** The build does not survive a `brew upgrade postgresql@16`.
Production should use a Postgres image with pgvector preinstalled.
