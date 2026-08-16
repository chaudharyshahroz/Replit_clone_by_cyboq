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
# =============================================================================
set -eu

role="${1:-web}"

case "$role" in
  web)
    echo "reklu: starting web on port ${PORT:-3000}"
    # exec: Next.js becomes PID 1 and receives SIGTERM directly, so in-flight
    # streaming responses drain instead of being killed by the shell.
    exec pnpm --filter @reklu/web exec next start --port "${PORT:-3000}" --hostname 0.0.0.0
    ;;

  worker)
    echo "reklu: starting worker"
    exec pnpm --filter @reklu/worker exec tsx src/index.ts
    ;;

  migrate)
    echo "reklu: running migrations"
    exec pnpm --filter @reklu/database exec tsx src/migrate.ts
    ;;

  # Anything else runs verbatim, so `docker run … sh` still works for debugging.
  *)
    exec "$@"
    ;;
esac
