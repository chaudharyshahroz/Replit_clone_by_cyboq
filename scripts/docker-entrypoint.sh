#!/bin/sh
# =============================================================================
# Reklu container entrypoint.
#
# One image serves three roles. The role is the command:
#   web      → Next.js server
#   worker   → BullMQ job consumer
#   migrate  → apply migrations, then exit
#
# Migrations are a separate role rather than something the web and worker
# containers each run on boot, because N containers starting together would race
# to apply the same migration.
#
# Each role invokes its package's own binary directly rather than going through
# `pnpm --filter … exec`. The runtime stage copies /app from the build stage,
# but corepack's downloaded pnpm lives OUTSIDE /app — so `pnpm` at container
# start would try to fetch itself again, as the non-root `node` user, over a
# network the container may not have. Calling node_modules/.bin/* removes
# corepack, the network, and pnpm itself from the startup path.
# =============================================================================
set -eu

role="${1:-web}"

# Fail with the missing path named, rather than a bare ENOENT from exec.
run() {
  bin="$1"
  shift
  if [ ! -x "$bin" ]; then
    echo "reklu: expected executable not found: $bin" >&2
    echo "reklu: the image is built wrong — dependencies are missing from the runtime stage." >&2
    exit 1
  fi
  # exec: the process becomes PID 1 and receives SIGTERM directly, so in-flight
  # streaming responses drain instead of being killed by the shell.
  exec "$bin" "$@"
}

case "$role" in
  web)
    echo "reklu: starting web on port ${PORT:-3000}"
    cd "${REKLU_APP_ROOT:-/app}/apps/web"
    # Published sites run in sibling Docker containers. Reconcile them in the
    # background on every deploy so a legacy/stopped container is restored at
    # its existing URL without delaying Reklu's own health endpoint.
    tsx="${REKLU_APP_ROOT:-/app}/node_modules/.bin/tsx"
    if [ -x "$tsx" ]; then
      "$tsx" src/restore-publications.ts &
    else
      echo "reklu: publication reconciler skipped; expected executable not found: $tsx" >&2
    fi
    run ./node_modules/.bin/next start --port "${PORT:-3000}" --hostname 0.0.0.0
    ;;

  worker)
    echo "reklu: starting worker"
    cd "${REKLU_APP_ROOT:-/app}/apps/worker"
    run ./node_modules/.bin/tsx src/index.ts
    ;;

  # Prepares the database: schema, then the reference data the product cannot
  # run without. Plans, AI providers and models are not sample data — with no
  # `free` plan row, registration fails and nobody can create an account. The
  # seed is idempotent (every write is an upsert on a business key) and leaves
  # admin-owned fields alone, so running it on every deploy is safe.
  migrate)
    cd "${REKLU_APP_ROOT:-/app}/packages/database"
    tsx=./node_modules/.bin/tsx
    if [ ! -x "$tsx" ]; then
      echo "reklu: expected executable not found: $(pwd)/$tsx" >&2
      exit 1
    fi

    echo "reklu: running migrations"
    "$tsx" src/migrate.ts

    # set -e above means a failed migration never reaches the seed.
    echo "reklu: seeding reference data"
    exec "$tsx" src/seed/index.ts
    ;;

  # Anything else runs verbatim, so `docker run … sh` still works for debugging.
  *)
    exec "$@"
    ;;
esac
