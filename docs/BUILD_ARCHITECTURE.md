# Build Architecture

> **Status: design, not implementation.** The schema exists (`build_projects`,
> `build_versions`, `build_files`, `sandboxes`, `repository_connections`,
> `deployments`) and job stages are declared. The build pipeline, sandbox
> drivers, and preview are **not built** — Milestones 5 and 6.

---

## 1. The non-negotiable

> **Generated code never executes in the Reklu app or worker process.**

Everything else here is design preference. This one is a hard boundary: user
prompts produce arbitrary code, and arbitrary code on the application server is
a full compromise — database credentials, provider keys, and every workspace's
data are in that process.

`loadServerEnv()` already enforces the deployable half of this: production
**refuses to start** with `SANDBOX_DRIVER=local`.

---

## 2. Understand the product before writing code

Spec §28 and §38: a one-line prompt is not a specification, and an example is
not the full scope. "Build a fitness app" that shows three exercises in a mockup
does not mean the product supports three exercises.

```
Prompt
  ↓ interpreting_product     what is this, who uses it, what must it do?
  ↓ planning_architecture    pages, data model, auth needs, integrations
  ↓ [Build Brief]            shown to the user; editable before any code
  ↓ generating_files
  ↓ installing_dependencies
  ↓ running_checks           typecheck, lint, build
  ↓ starting_preview
```

The **Build Brief** (`build_projects.brief`) is persisted because later edits
are reasoned against the product's intent, not re-derived from the original
prompt string. Simple landing pages skip ahead; substantial applications do not.

The brief is shown, not asked as a questionnaire — Reklu infers sensible
defaults and lets the user correct them.

---

## 3. Checkpoints

Every meaningful AI change creates a `build_versions` row with the full file
tree, the prompt that caused it, a change summary, and the touched paths.

This exists so a model that breaks a working application can always be undone
(spec §33). Without it, "make the header smaller" that silently deletes routing
is unrecoverable — the single worst failure mode in AI code generation.

`checksPassed` records whether the generated tree actually built, so a broken
checkpoint is visibly broken rather than silently current.

---

## 4. Sandbox

```ts
interface SandboxDriver {
  create(options): Promise<Sandbox>;
  writeFiles(id, files): Promise<void>;
  exec(id, command, options): Promise<ExecResult>;
  startPreview(id, port): Promise<string>;
  destroy(id): Promise<void>;
}
```

| Driver | Isolation | Use |
| ------ | --------- | --- |
| `local` | none | development only; production startup rejects it |
| `docker` | container | self-hosted |
| `e2b` | microVM | managed |

Required properties for any production driver, per spec §36:

- no access to the host filesystem or Reklu's process environment;
- no access to the internal network — egress allowlisted to package registries;
- **no Reklu secrets injected**, ever. A generated app gets its *own*
  credentials (e.g. a Supabase anon key), never Reklu's provider or database
  keys;
- CPU, memory, disk, and wall-clock ceilings, recorded on the `sandboxes` row so
  a run's limits are auditable after the fact;
- idle reaping — the worker's `reap_sandboxes` maintenance task already exists.

---

## 5. Preview

Preview is served from the sandbox, never from Reklu's origin. Same-origin would
give generated code access to the session cookie, which is exactly the escape
the sandbox exists to prevent.

The workspace offers desktop/tablet/mobile widths, reload, external open, and —
importantly — **real error surfacing**: a build failure shows the actual
compiler output, not a generic failure state (spec §88).

---

## 6. Visual editing

Not in the first version, but the data model is shaped for it: generated
components carry stable identifiers so a clicked element in the preview can be
resolved back to the source range that produced it. Retrofitting that later
would mean regenerating every existing project (spec §35).

---

## 7. Delivery

`repository_connections` and `deployments` are provider-agnostic:

- **GitHub** — create or import a repo, push generated code. Tokens live
  encrypted in `oauth_credentials`, AAD-bound, and never reach the browser.
- **Deployment adapters** — Vercel first, but the schema carries `provider`
  precisely so Netlify, Cloudflare, Railway and others are additions rather than
  a refactor (spec §45).
- **Supabase** — database provisioning for generated apps. The service-role key
  is never placed in generated frontend code (spec §43).

Production deployment is an approval-gated action: it is outward-facing and hard
to reverse.

Deployment logs are stored (or spilled to object storage when large) so a
failure can be read rather than guessed at.

---

## 8. Importing an existing repository

```
Connect GitHub → select repo → clone into sandbox → analyze → index → open workspace
```

`codebaseAnalysis` persists the derived architecture summary so that "add
subscription billing" is reasoned against the actual codebase rather than
against assumptions. Analysis reads the repository as **data**, subject to the
same untrusted-content boundary as everything else — a comment in an imported
file is not an instruction.
