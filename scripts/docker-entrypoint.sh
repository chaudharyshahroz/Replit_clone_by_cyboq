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
    run ./node_modules/.bin/next start --port "${PORT:-3000}" --hostname 0.0.0.0
    ;;

  worker)
    echo "reklu: starting worker"
    cd "${REKLU_APP_ROOT:-/app}/apps/worker"
    run ./node_modules/.bin/tsx src/index.ts
    ;;

  migrate)
    echo "reklu: running migrations"
    cd "${REKLU_APP_ROOT:-/app}/packages/database"
    run ./node_modules/.bin/tsx src/migrate.ts
    ;;

  # Anything else runs verbatim, so `docker run … sh` still works for debugging.
  *)
    exec "$@"
    ;;
esac
