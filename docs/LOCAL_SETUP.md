# Running Reklu locally

## Requirements

| Dependency | Version | Notes |
| ---------- | ------- | ----- |
| Node.js | ≥ 20.9 | 20.20.2 verified |
| pnpm | ≥ 10 | `corepack enable` or `npm i -g pnpm` |
| PostgreSQL | ≥ 15 | with the `pgvector` extension |
| Redis | ≥ 6 | required for jobs, caching, rate limits |

Reklu runs without Docker. Docker is only needed later for the `docker` sandbox
driver.

---

## Quick start

```bash
pnpm install
pnpm setup
pnpm dev
```

`pnpm setup` is idempotent. It creates `.env` with freshly generated
`AUTH_SECRET` and `ENCRYPTION_KEY`, verifies Postgres and Redis, creates the
database and its extensions, then runs migrations and seeds.

---

## What you get without any API keys

Reklu starts and is navigable with **no AI provider configured**. Every
capability that needs a credential reports "Not configured" and names the exact
variable required — nothing simulates success.

To use Chat, Research, or Build, add at least one provider key to `.env`.
For example, use a key issued directly by Anthropic:

```
ANTHROPIC_API_KEY=sk-ant-...
```

DeepSeek and Kimi can also be connected directly—no aggregator key is needed:

```bash
DEEPSEEK_API_KEY=...
MOONSHOT_API_KEY=...
```

`MOONSHOT_API_KEY` is the name used by Kimi's official Moonshot AI platform.
Reklu sends it only to `https://api.moonshot.ai/v1`. The optional
`MOONSHOT_BASE_URL` setting exists for an operator-controlled compatible proxy;
leave the documented default unchanged for the official integration.

---

## Verifying the install

```bash
psql -d reklu -c "\dt"
```

Expect **48 tables**. Also useful:

```bash
psql -d reklu -tAc "SELECT extname, extversion FROM pg_extension ORDER BY extname;"
psql -d reklu -tAc "SELECT table_name||'.'||column_name FROM information_schema.columns WHERE udt_name='vector';"
```

Run the test suite:

```bash
pnpm test
```

---

## pgvector

Reklu uses pgvector for project memory, file retrieval, and research knowledge.

### macOS / Homebrew

Homebrew's `pgvector` bottle currently ships libraries for **PostgreSQL 17 and 18
only**. If you run `postgresql@16`, `brew install pgvector` installs files your
server cannot load, and `CREATE EXTENSION vector` fails with
`extension "vector" is not available`.

Build it against your actual server instead:

```bash
git clone --branch v0.8.6 --depth 1 https://github.com/pgvector/pgvector.git
cd pgvector
make PG_CONFIG=/opt/homebrew/opt/postgresql@16/bin/pg_config
make install PG_CONFIG=/opt/homebrew/opt/postgresql@16/bin/pg_config
```

Then:

```bash
psql -d reklu -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

A source build does **not** survive a `brew upgrade postgresql@16` — repeat these
steps after upgrading. In production, use a Postgres image with pgvector already
installed rather than building it.

### Running without pgvector

Set `DATABASE_VECTOR_ENABLED=false`. Semantic retrieval degrades to lexical
search; the product still runs. This is a development convenience, not a
supported production configuration.

---

## Common problems

### `role "postgres" does not exist`

Homebrew initializes PostgreSQL with your **OS username** as the superuser, not
`postgres`. Fix `DATABASE_URL` in `.env`:

```
DATABASE_URL=postgresql://$(whoami)@localhost:5432/reklu
```

### `Reklu cannot start: the environment is not configured correctly`

Working as intended — every problem is listed at once with the fix. This is a
startup guard (spec §82), not a crash.

### Node is not on PATH in scripts

If you use nvm, non-interactive shells may not see it:

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
```

### Redis not reachable

```bash
brew services start redis
```

Without Redis, background jobs — deep research, builds, deployments, media
generation — cannot run. The app still starts.

---

## Useful commands

| Command | Purpose |
| ------- | ------- |
| `pnpm dev` | Start web + worker |
| `pnpm test` | Run all tests |
| `pnpm typecheck` | Strict typecheck across the monorepo |
| `pnpm db:generate` | Generate a migration from schema changes |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:studio` | Browse the database |
| `pnpm db:seed` | Load seed data |

Always `db:generate` **and** commit the SQL — migrations are reviewed, and
`db:push` is for local experimentation only.
