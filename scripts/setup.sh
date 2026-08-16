#!/usr/bin/env bash
#
# Reklu local setup.
#
# Idempotent: safe to re-run. Creates .env with freshly generated secrets if it
# does not exist, verifies Postgres and Redis are reachable, ensures the
# database and its extensions exist, then runs migrations and seeds.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1"; exit 1; }

bold "Reklu setup"

# --- .env ---------------------------------------------------------------------
if [ -f .env ]; then
  ok ".env already exists (leaving it alone)"
else
  cp .env.example .env
  AUTH_SECRET="$(openssl rand -base64 32)"
  ENCRYPTION_KEY="$(openssl rand -base64 32)"

  # BSD sed (macOS) needs an explicit empty backup suffix.
  if sed --version >/dev/null 2>&1; then SED_INPLACE=(-i); else SED_INPLACE=(-i ''); fi
  sed "${SED_INPLACE[@]}" "s|^AUTH_SECRET=.*|AUTH_SECRET=${AUTH_SECRET}|" .env
  sed "${SED_INPLACE[@]}" "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=${ENCRYPTION_KEY}|" .env
  ok "created .env with freshly generated AUTH_SECRET and ENCRYPTION_KEY"
  warn "add at least one AI provider key to .env before using Chat"
fi

set -a; . ./.env; set +a
DB_URL="${DATABASE_URL:-postgresql://postgres@localhost:5432/reklu}"

# --- Postgres -----------------------------------------------------------------
command -v psql >/dev/null 2>&1 || fail "psql not found. Install PostgreSQL 15+."
pg_isready -q || fail "PostgreSQL is not accepting connections. Start it, then re-run."
ok "PostgreSQL is running"

DB_NAME="$(printf '%s' "$DB_URL" | sed -e 's|.*/||' -e 's|?.*||')"
if psql -lqt 2>/dev/null | cut -d\| -f1 | tr -d ' ' | grep -qx "$DB_NAME"; then
  ok "database '$DB_NAME' exists"
else
  createdb "$DB_NAME" && ok "created database '$DB_NAME'"
fi

if psql -d "$DB_NAME" -tAc "SELECT 1 FROM pg_extension WHERE extname='vector'" | grep -q 1; then
  ok "pgvector enabled"
else
  if psql -d "$DB_NAME" -q -c "CREATE EXTENSION IF NOT EXISTS vector" 2>/dev/null; then
    ok "enabled pgvector"
  else
    warn "pgvector unavailable — semantic retrieval will be disabled."
    warn "Install it (brew install pgvector, or build from source against your"
    warn "server version), or set DATABASE_VECTOR_ENABLED=false in .env."
  fi
fi
psql -d "$DB_NAME" -q -c "CREATE EXTENSION IF NOT EXISTS pgcrypto" && ok "pgcrypto enabled"

# --- Redis --------------------------------------------------------------------
if command -v redis-cli >/dev/null 2>&1 && redis-cli ping >/dev/null 2>&1; then
  ok "Redis is running"
else
  warn "Redis is not reachable at ${REDIS_URL:-redis://localhost:6379}."
  warn "Background jobs (research, builds, deployments) will not run without it."
  warn "Start it with: brew services start redis"
fi

# --- Schema -------------------------------------------------------------------
bold "Applying schema"
pnpm --filter @reklu/database db:generate
pnpm --filter @reklu/database db:migrate
ok "migrations applied"

pnpm --filter @reklu/database db:seed
ok "seed data loaded"

bold "Ready"
echo "  Start the app with: pnpm dev"
