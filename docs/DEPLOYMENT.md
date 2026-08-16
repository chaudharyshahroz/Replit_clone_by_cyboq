# Deployment

> **Status: partially implemented.** The health endpoint, graceful shutdown,
> migration runner, and startup configuration validation are built and verified.
> Dockerfiles are **not written yet**; the topology and requirements below are
> the target.

---

## Topology

Three processes, deployed separately:

```
              ┌──────────────┐
   traffic ──▶│  apps/web    │  Next.js — requests + streaming
              └──────┬───────┘
                     │ enqueue
     ┌───────────────▼──────────────┐
     │  PostgreSQL 15+ (pgvector)   │◀──┐
     │  Redis 6+                    │   │
     └───────────────┬──────────────┘   │
                     │ consume          │
              ┌──────▼───────┐          │
              │ apps/worker  │──────────┘
              └──────────────┘
                     │
              ┌──────▼───────┐
              │   Sandbox    │  isolated; never the app or worker host
              └──────────────┘
```

Web and worker scale independently on purpose: a burst of deep research or
builds must not starve request handling.

**Migrations run as a separate step before either starts**, never on process
boot — N replicas booting simultaneously would race to apply the same
migration.

```bash
pnpm db:migrate   # release step
pnpm db:seed      # idempotent; safe every deploy
```

---

## Startup contract

Both processes call `loadServerEnv()` before serving. In production it **refuses
to start** when:

- no AI provider key is configured — Reklu could not serve Chat, Research or
  Build;
- `STORAGE_DRIVER=local` — not durable;
- `SANDBOX_DRIVER=local` — no real isolation for untrusted code;
- `APP_URL` is not https — secure cookies require it;
- no embedding key — project memory and file search would silently degrade;
- `AUTH_SECRET` or `ENCRYPTION_KEY` is missing or not 32 bytes.

Every problem is reported at once, so a misconfigured deploy is fixed in one
pass rather than one variable per restart. This is deliberate: a service that
boots misconfigured and fails later is harder to diagnose than one that refuses
to boot.

---

## Health

`GET /api/health` returns real dependency status:

```json
{
  "status": "ok",
  "checks": {
    "database": { "ok": true, "latencyMs": 3, "vectorEnabled": true },
    "queue": { "ok": true, "latencyMs": 1 }
  },
  "capabilities": { "modelProvider": false, "embeddings": false }
}
```

- **200 `ok`** — everything healthy.
- **200 `degraded`** — Postgres up, Redis down. Requests still serve; background
  work cannot run.
- **503 `unhealthy`** — Postgres down. The replica should leave rotation.

Use it as both liveness and readiness. It exposes no configuration values, only
whether things work.

---

## Graceful shutdown

The worker traps `SIGTERM`/`SIGINT` and drains in-flight jobs before exiting,
with a 30-second ceiling before forcing. Without draining, a deploy abandons
work mid-stage and leaves `running` rows that nothing will ever finish.

Give orchestrators a `terminationGracePeriodSeconds` above 30.

---

## Containers `[PLANNED]`

Target: a multi-stage build on `node:20-alpine`, non-root user, `pnpm deploy`
for a pruned production tree, one image with `web` and `worker` entrypoints.

Postgres **must** have pgvector — use `pgvector/pgvector:pg16` or a managed
provider offering it. Do not compile it in the image; the local build in
[LOCAL_SETUP.md](./LOCAL_SETUP.md) is a development convenience and does not
survive an upgrade ([DECISIONS.md D13](./DECISIONS.md)).

---

## Secrets

Provider keys, `AUTH_SECRET`, `ENCRYPTION_KEY` and OAuth secrets come from the
platform's secret store — never an image layer, never a committed file.

`ENCRYPTION_KEY` protects user OAuth and MCP credentials. **Losing it means
those are unrecoverable** and every connection must be re-authorized. Back it up
independently of the database.

Rotation: set the old key as `ENCRYPTION_KEY_PREVIOUS` and the new one as
`ENCRYPTION_KEY`. Decryption falls back automatically and flags rows needing
re-wrap ([DECISIONS.md D4](./DECISIONS.md)).

---

## Operational notes

**Streaming.** Chat and Compare use SSE. Any proxy must not buffer; Reklu sends
`X-Accel-Buffering: no`, but check nginx/CDN settings too, and allow response
timeouts well beyond the default.

**Backups.** Postgres is the domain of record — jobs, artifacts, conversations,
usage. Redis holds only in-flight queue state and can be lost with no data loss
([DECISIONS.md D9](./DECISIONS.md)). Object storage holds uploads and generated
assets; enable versioning.

**Logging.** JSON in production, with mandatory redaction applied inside the
logger rather than at call sites. Ship stdout/stderr to your aggregator.
