# Reklu — System Architecture

> Reklu is an AI workspace where users use the world's best AI models to think,
> research, create, build and take action without leaving one environment.

This document describes the architecture **as implemented**. Sections describing
work not yet built are marked `[PLANNED]` and cross-referenced to
[IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md).

---

## 1. Guiding constraint: one product, not a suite of tools

The single most important architectural decision is that Chat, Research, and
Build are **three entry points into one substrate**, not three applications.
They share the same project context, files, models, skills, tools, artifacts,
permissions, usage accounting, and memory.

Concretely, this means no feature owns its own copy of:

| Concern           | Single owner                        |
| ----------------- | ----------------------------------- |
| Model access      | `@reklu/ai` provider registry       |
| Ownership + authz | `@reklu/database` + `packages/auth` |
| Persistent output | `@reklu/artifacts`                  |
| Context/knowledge | `@reklu/projects` (memory + files)  |
| External actions  | `@reklu/mcp` + `@reklu/integrations`|
| Cost              | `@reklu/billing` usage ledger       |
| Async work        | `@reklu/queue`                      |

A new surface (say, a future "Design" mode) is expected to compose these, not
re-implement them. If a feature needs a private copy of any row in that table,
that is a design smell to resolve before merging.

---

## 2. Topology

```
                          ┌────────────────────────┐
                          │   Browser (Next.js)    │
                          │  marketing · app · admin│
                          └───────────┬────────────┘
                                      │ HTTPS / SSE
                          ┌───────────▼────────────┐
                          │      apps/web          │
                          │  RSC + Route Handlers  │
                          │  auth · API · streaming│
                          └─────┬───────────┬──────┘
                                │           │ enqueue
              ┌─────────────────▼──┐   ┌────▼─────────────────┐
              │   PostgreSQL       │   │   Redis              │
              │   + pgvector       │   │ cache · ratelimit ·  │
              │   domain of record │   │ BullMQ               │
              └────────────────────┘   └────┬─────────────────┘
                                            │ consume
                                   ┌────────▼──────────┐
                                   │   apps/worker     │
                                   │ research · build ·│
                                   │ embed · deploy ·  │
                                   │ media · agents    │
                                   └───┬───────────┬───┘
                                       │           │
                     ┌─────────────────▼─┐   ┌─────▼──────────────┐
                     │  Object storage   │   │  Sandbox runtime   │
                     │  (S3 / R2 / local)│   │  (isolated, never  │
                     │  files · artifacts│   │   the app server)  │
                     └───────────────────┘   └────────────────────┘
                                       │
                          ┌────────────▼─────────────┐
                          │ External: AI providers,  │
                          │ search, GitHub, Vercel,  │
                          │ Supabase, Stripe, MCP    │
                          └──────────────────────────┘
```

`apps/web` never performs long or expensive work inline. Anything that can
exceed a request budget — deep research, embeddings, code generation, builds,
deployments, video — is a queued job with a durable row in `jobs`, so the user
can close the tab and come back.

---

## 3. Package map

```
apps/
  web/        Next.js app: marketing site, product surfaces, API, admin
  worker/     BullMQ consumers; same domain packages, no HTTP surface

packages/
  shared/       env validation, logger, errors, ids, result types, guards
  database/     Drizzle schema, migrations, client, seed
  auth/         Auth.js config, session, workspace authorization helpers
  ai/           provider abstraction, model registry, Reklu Auto router
  research/     research pipeline stages and source adapters
  artifacts/    artifact + version domain services
  projects/     project context assembly, memory, file ingestion
  skills/       skill model, resolution, invocation
  mcp/          MCP client, tool discovery, permission engine
  integrations/ GitHub, Vercel, Supabase OAuth + API clients
  billing/      plans, subscriptions, usage ledger, limits
  sandbox/      isolated execution drivers
  deployment/   deployment provider adapters
  queue/        BullMQ definitions, job contracts, progress reporting
  storage/      object storage abstraction
  ui/           Reklu design system and primitives
```

Dependency direction is strictly one-way: `apps/*` → domain packages →
`shared`/`database`. Domain packages must not import from `apps/*`, and must not
import each other except through explicitly declared, acyclic edges (for
example `research` → `ai`, never `ai` → `research`).

---

## 4. Request lifecycle

### 4.1 Synchronous (chat turn)

1. Route handler authenticates the session and resolves the **workspace scope**.
2. Authorization: does this principal have the required role on this resource?
3. Rate limit check (Redis, plan-aware).
4. Input validated against a Zod schema.
5. Project context assembled: instructions, memory, retrieved file chunks, skills.
6. Model resolved — explicit selection, or Reklu Auto routing.
7. Provider adapter invoked in streaming mode.
8. Tokens stream to the client as typed SSE events.
9. On completion: message persisted, usage ledger written, artifacts extracted.

Steps 1–4 are enforced by a shared handler wrapper, not re-implemented per route,
so a new endpoint cannot accidentally skip authorization or validation.

### 4.2 Asynchronous (deep research, build, deploy, media)

1. Route handler validates and creates a `jobs` row (`queued`).
2. Job enqueued on BullMQ with the job id as its deduplication key.
3. Worker claims it, transitioning `queued → running`.
4. Worker reports **real** stage transitions (`stage`, `stageIndex`, `detail`).
5. Client subscribes to job progress via SSE and renders actual stages.
6. Terminal state `succeeded | failed | cancelled` with output or a typed error.

Progress reflects genuine backend stages. There are no synthetic percentages and
no timer-driven fake progress bars.

---

## 5. Data model

The domain of record is PostgreSQL. See `packages/database/src/schema/` for the
authoritative definitions and [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md)
for what is live.

### 5.1 Ownership

Every substantive resource carries an explicit ownership chain so that
authorization is always answerable from the row itself:

```
user ──┐
       ├── workspace ──── project ──── {conversation, artifact, research,
       │                                build, file, agent run, ...}
       └── workspace_member (role)
```

`workspaceId` is non-null on every workspace-scoped table. A resource that
cannot answer "which workspace is this?" in a single column is a bug, because it
forces authorization to be inferred by traversal — the pattern that produces
cross-tenant leaks.

### 5.2 Entity groups

- **Identity** — `users`, `accounts`, `sessions`, `verification_tokens`
- **Tenancy** — `workspaces`, `workspace_members`, `invitations`
- **Projects** — `projects`, `project_members`, `project_memories`
- **Conversation** — `conversations`, `messages`, `message_attachments`
- **AI** — `ai_providers`, `ai_models`, `ai_requests`, `usage_ledger`
- **Knowledge** — `files`, `file_chunks`, `embeddings`
- **Artifacts** — `artifacts`, `artifact_versions`
- **Research** — `research_sessions`, `research_sources`, `research_citations`
- **Build** — `build_projects`, `build_versions`, `build_files`, `sandboxes`
- **Delivery** — `repository_connections`, `deployments`
- **Tools** — `connections`, `oauth_credentials`, `mcp_servers`, `mcp_tools`,
  `tool_executions`
- **Skills** — `skills`, `skill_versions`, `skill_installs`
- **Agents** — `agent_runs`, `agent_steps`, `agent_approvals`
- **Commerce** — `plans`, `subscriptions`, `usage_ledger`
- **Platform** — `jobs`, `notifications`, `activities`, `audit_logs`,
  `feature_flags`

### 5.3 Deletion

Business-critical records (projects, connections, skills, deployments,
subscriptions) use soft deletion (`deletedAt`) with `createdBy`/`updatedBy`
attribution and an `audit_logs` trail. Ephemeral, high-volume rows (chunks,
request logs) hard-delete.

---

## 6. Security posture

Security decisions are documented where they are enforced; the summary:

- **Authorization on every protected resource**, derived from the ownership
  chain — never from the absence of a UI affordance.
- **Workspace isolation** as the primary tenancy boundary.
- **Secrets** (provider keys, OAuth tokens, MCP credentials) live only on the
  server, encrypted at rest with AES-256-GCM, never logged, never serialized into
  a client payload, and never injected into a sandbox that does not require them.
- **Untrusted content boundary.** Web pages, files, MCP tool results, and
  repository contents are *data*. They are structurally separated from system and
  user instructions and can never redefine them. See
  [RESEARCH_ARCHITECTURE.md](./RESEARCH_ARCHITECTURE.md) and
  [MCP_SECURITY.md](./MCP_SECURITY.md).
- **Sandbox isolation.** Generated code never executes in the app or worker
  process. See [BUILD_ARCHITECTURE.md](./BUILD_ARCHITECTURE.md).
- **Tool risk classes.** Read-only tools may run under standing authorization;
  create/update/delete/financial/security-sensitive tools require explicit
  human approval.
- **Cost as a safety property.** Every AI call is metered and bounded. Runaway
  loops are contained by per-job step ceilings, per-plan concurrency limits, and
  hard source/token caps.

---

## 7. Failure and honesty rules

These are product requirements with architectural consequences:

1. An unconfigured integration reports **"Not configured"** with the exact
   variable required. It never renders a success state.
2. Development mocks are explicitly labelled `Development Mock` in the UI and
   refuse to load when `NODE_ENV=production`.
3. Production **fails startup** when a required secret is missing, rather than
   degrading silently.
4. Errors surface the actionable cause ("Deployment failed during build — view
   logs") rather than "Something went wrong".
5. Partial success is reported as partial ("14 of 18 sources retrieved"), never
   rounded up to success.

---

## 8. Related documents

| Document                                                     | Covers                                    |
| ------------------------------------------------------------ | ----------------------------------------- |
| [AI_ARCHITECTURE.md](./AI_ARCHITECTURE.md)                   | Providers, registry, Reklu Auto, streaming |
| [RESEARCH_ARCHITECTURE.md](./RESEARCH_ARCHITECTURE.md)       | Research pipeline and citation integrity   |
| [BUILD_ARCHITECTURE.md](./BUILD_ARCHITECTURE.md)             | Codegen, sandbox, preview, checkpoints     |
| [MCP_SECURITY.md](./MCP_SECURITY.md)                         | MCP threat model and permission engine     |
| [DEPLOYMENT.md](./DEPLOYMENT.md)                             | Containers, workers, migrations, health    |
| [LOCAL_SETUP.md](./LOCAL_SETUP.md)                           | Running Reklu locally                      |
| [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md)       | What is done, in progress, remaining       |
| [DECISIONS.md](./DECISIONS.md)                               | Technical decision log                     |
