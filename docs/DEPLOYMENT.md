# Deployment

> **Status: implemented, not yet deployed.** The health endpoint, graceful
> shutdown, migration runner, startup configuration validation, Dockerfile,
> entrypoint and Compose stack are all written, and the configuration is
> verified by `pnpm verify:production-config`.
>
> **Not yet verified on a live host.** The image has not been built or run —
> there is no Docker daemon on the development machine. Treat the first deploy
> as the verification step for the container layer specifically; everything
> below it has been exercised locally.

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

## Containers

[`Dockerfile`](../Dockerfile) builds one image with three entrypoints, selected
by the container command via [`scripts/docker-entrypoint.sh`](../scripts/docker-entrypoint.sh):

| Command   | Process                                    |
| --------- | ------------------------------------------ |
| `web`     | Next.js server on `$PORT` (default 3000)   |
| `worker`  | BullMQ consumer                            |
| `migrate` | Applies migrations, then exits             |

Web and worker share every workspace package, so building them as separate
images would compile the same tree twice.

`migrate` is its own role rather than something each container runs on boot:
several containers starting together would otherwise race to apply the same
migration. `docker-compose.yml` gates `web` and `worker` behind
`service_completed_successfully`.

Base image is `node:20-bookworm-slim`, not Alpine — Next 16,
`@tailwindcss/oxide` and sharp all ship native binaries, and glibc is the
well-trodden path for them. Runs as the non-root `node` user.

Dev dependencies are deliberately **not** pruned: the worker runs TypeScript
source through `tsx`, and migrations run through `drizzle-kit`. Pruning them
would break both roles.

Each role invokes its package's own `node_modules/.bin/*` binary directly
rather than going through `pnpm --filter … exec`. The runtime stage copies
`/app` from the build stage, but corepack's downloaded pnpm lives *outside*
`/app` — so `pnpm` at container start would try to fetch itself again, as the
non-root `node` user, over a network the container may not have. Calling the
binaries directly removes corepack, the network and pnpm from the startup path.

**`.env` is in [`.dockerignore`](../.dockerignore)** and must stay there.
Deleting a secret in a later `RUN` does not remove it — the layer that added it
remains in the image history.

Postgres **must** have pgvector — `docker-compose.yml` uses
`pgvector/pgvector:pg16`. Do not compile it in the image; the local build in
[LOCAL_SETUP.md](./LOCAL_SETUP.md) is a development convenience and does not
survive an upgrade ([DECISIONS.md D13](./DECISIONS.md)).

---

## Deploying to Dokploy

[`docker-compose.yml`](../docker-compose.yml) is written for a Dokploy host that
is **already running other applications**. It is deliberately non-invasive:

- **No host ports are published.** Traefik reaches `web` over the shared
  `dokploy-network`, so nothing can collide with a port another app holds — and
  Postgres and Redis are unreachable from the public internet.
- **`dokploy-network` is declared `external`.** Compose attaches to it rather
  than creating or modifying it, because other applications depend on it.
- **Postgres and Redis are Reklu's own containers on Reklu's own volumes.** No
  existing database is touched; removing the stack removes only Reklu's data.
- Every container, volume and network name is prefixed `reklu`.

### Runbook

1. Push this repository to your Git remote.
2. In Dokploy: **Create Application → Compose**, point it at the repository and
   branch, with Compose path `docker-compose.yml`.
3. **Environment tab:** paste [`.env.production.example`](../.env.production.example)
   and fill in the blanks. Generate `POSTGRES_PASSWORD`, `AUTH_SECRET` and
   `ENCRYPTION_KEY` separately with `openssl rand -base64 32`; add at least one
   AI provider key.
4. **Domains tab:** add the domain, service `web`, container port `3000`,
   HTTPS on with Let's Encrypt. Dokploy writes the Traefik labels.
5. Point the domain's DNS `A` record at the VPS before deploying, or
   certificate issuance fails.
6. **Deploy.** First run builds the image and applies migrations.
7. Verify: `GET https://<domain>/api/health` returns `200` with
   `"status": "ok"` and a `capabilities` block reporting what is actually
   configured.

### Before deploying

```bash
pnpm verify:production-config
```

This loads `.env.production.example` through the real environment schema and
asserts it is a configuration Reklu will boot on — catching drift between the
example and the schema here rather than as a crash-looping container on the
host. It also enforces that no value carries a trailing `# comment`: Docker
Compose's handling of those has varied between versions, and an `APP_URL` read
with its own comment appended fails validation in a way that is hard to see.

### What is switched off in this configuration, and why

Three production guards would otherwise refuse to boot. Each has exactly one
documented way past it, and each is an explicit statement by the operator about
what is being given up — never a silent fallback.

| Guard | Setting | What it concedes |
| --- | --- | --- |
| `STORAGE_DRIVER=local` is not durable | `STORAGE_LOCAL_SINGLE_NODE_ACK=true` | Asserts `/app/.storage` is a mounted volume and exactly **one** `web` replica runs. Scale past one and uploads become invisible to half the requests. |
| `SANDBOX_DRIVER=local` is not isolated | `BUILD_ENABLED=false` | The Build workspace is off. It reports itself unavailable and names what is missing, rather than running model-generated code on the app server (spec §36). |
| `EMBEDDING_PROVIDER` needs a key | `EMBEDDING_PROVIDER=none` | Project memory and file search fall back to lexical retrieval. Recall is weaker; the UI says so. Pick this only if you have no embedding-capable key — Anthropic does not serve embeddings. |

To turn Build on later, set `BUILD_ENABLED=true` together with either
`SANDBOX_DRIVER=e2b` and `E2B_API_KEY`, or `SANDBOX_DRIVER=docker` **on a
Docker host that is not this one**. Mounting the host Docker socket into the
Reklu container is not an acceptable substitute: it grants root on the host,
which is strictly worse than the local driver this guard exists to prevent.

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
