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


---

### D14 — Session layer implemented directly, not Auth.js v5

**Decision.** Database-backed session cookies implemented in `@reklu/auth`,
against a schema that is already Auth.js-shaped.

**Why.** Auth.js v5 has been in beta for a long time and has historically lagged
Next.js major releases; Next 16 support is unproven. The pieces actually needed
now — password verification and session cookies — are well-understood, and the
schema (`users`, `accounts`, `sessions`, `verification_tokens`) is already
adapter-compatible, so switching later is a configuration change rather than a
migration.

**What is deliberately not hand-rolled.** OAuth authorization-code flows and
token exchange. When Google/GitHub credentials are supplied, those go through a
vetted implementation writing into the existing `accounts` table.

**Properties the implementation holds, each covered by a test:**
- The cookie carries a random 32-byte token; the database stores only its
  SHA-256, so a database leak yields no usable sessions.
- Cookies are `httpOnly` (XSS cannot exfiltrate), `SameSite=Lax` (blocks the
  basic CSRF shape), and `Secure` whenever `APP_URL` is https.
- Sign-in returns one indistinguishable response for unknown account, wrong
  password, OAuth-only account, and suspended account — and burns comparable CPU
  in each case, so the form is not an account-enumeration oracle. Measured
  ratio: 0.95.
- Suspension takes effect on the next request, not the next sign-in.
- scrypt parameters are encoded in each stored hash, so cost can be raised and
  old hashes upgrade transparently on next successful sign-in.

---

### D15 — Unbuilt features render as disabled, never as links

**Decision.** Sidebar entries for Chat, Research, Build, Projects, Artifacts,
Connections and History render as `aria-disabled` items labelled "Soon".

**Why.** Spec §137 forbids dead buttons. A nav link to a route that 404s is
worse than an honest disabled state: it costs the user a click and teaches them
the navigation lies. The home page and settings state the same thing in prose.


---

### D16 — Vendor SDKs sit *inside* the adapter, not behind it

**Decision.** `@reklu/ai` defines Reklu's own `AIProvider` interface, and the
Vercel AI SDK is used as an implementation detail within
`providers/vendor.ts`.

**Why.** Spec §9 requires that Reklu never couple to one AI company, and that
provider-specific code not scatter. Hand-writing five streaming HTTP protocols
would be a large, bug-prone surface for no architectural gain. Using the SDK
underneath a Reklu-owned interface gets correct protocol handling while keeping
the seam: swapping or adding a provider touches one directory, and nothing
outside `providers/` imports a vendor package.

**What Reklu owns regardless of the SDK:** the stream event protocol, token
accounting, the error taxonomy (retryable vs not), and routing.

---

### D17 — A development mock provider, explicitly labelled

**Decision.** When no vendor key is configured in development, a `dev-echo`
provider stands in. It is labelled "Development Mock" in the model selector, on
every message it produces, and in the empty state.

**Why.** Spec §111 permits an isolated development adapter but forbids the UI
pretending a real action succeeded. This lets the whole pipeline — routing,
streaming, persistence, metering, rendering — be exercised and verified without
credentials, which is what made it possible to find and fix real bugs before a
key existed.

**Guards.** It throws if constructed with `NODE_ENV=production`; it is only
selected when zero real providers are configured; it bills **0** units so it can
never consume a customer's quota; and its output describes what it received
rather than imitating an answer.

**Consequence.** It is exempt from plan model-allowlists. Gating it behind one
left developers with no selectable model at all — a real bug, now covered by a
regression test.

---

### D18 — Production guards get named escape hatches, never silent fallbacks

**Decision.** Three startup guards refuse a production boot: non-durable
storage, a non-isolated sandbox, and a missing embedding key. Each now has
exactly one documented way past it, and each is an explicit operator statement
naming what is conceded:

| Guard | Escape hatch | The concession it states |
| --- | --- | --- |
| `STORAGE_DRIVER=local` | `STORAGE_LOCAL_SINGLE_NODE_ACK=true` | The path is a mounted volume and exactly one web replica runs |
| `SANDBOX_DRIVER=local` | `BUILD_ENABLED=false` | The Build workspace is off, so no generated code executes |
| `EMBEDDING_PROVIDER` without a key | `EMBEDDING_PROVIDER=none` | Retrieval is lexical only, deliberately |

**Why.** The guards were written to prevent a deploy that cannot honestly serve
the product, and they were right to. But "cannot deploy at all" was the wrong
outcome for a single-node install with a mounted volume, an operator holding an
Anthropic-only key, or anyone who wants Chat and Research before Build exists.

The distinction that matters is not *whether* a constraint can be relaxed but
*who decides and whether they are told*. A fallback Reklu chooses silently is
the failure mode the guards exist to prevent. A flag the operator sets, whose
name states the condition being accepted, is a decision — and it is recorded in
the environment where it can be audited.

**Why `BUILD_ENABLED` rather than relaxing the sandbox guard.** Build is the
only subsystem that executes model-generated code, so it is the only one needing
isolation. Turning the feature off removes the hazard entirely; weakening the
guard would have left it in place with a smaller warning. Spec §36 is
unconditional, and this keeps it that way.

**Guards on the guards.** `sandbox()` throws when `BUILD_ENABLED=false`, so a
stale form post or a direct server-action call cannot reach a driver the UI has
already disabled. `featuresFor()` reports `build: false` in production without
isolation even if called with a hand-built env, independently of
`loadServerEnv`. Both paths are covered by tests, as is each escape hatch and
each guard it does *not* disable.

**Consequence.** `pnpm verify:production-config` loads the shipped
`.env.production.example` through the real schema and asserts both directions:
that the configuration boots, and that removing any operator-supplied value
still fails loudly. This caught a real bug — values annotated with trailing
`# comments`, which Docker Compose has not always stripped, producing an
`APP_URL` that carried its own comment into URL validation.
