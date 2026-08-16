# =============================================================================
# Reklu — application image
#
# One image, three entrypoints (see scripts/docker-entrypoint.sh):
#   web      → Next.js server
#   worker   → BullMQ job consumer
#   migrate  → run migrations, then exit
#
# Web and worker share every workspace package, so building them separately
# would mean building the same tree twice. The entrypoint selects the role.
#
# Debian slim rather than Alpine: Next 16, @tailwindcss/oxide and sharp all ship
# native binaries, and glibc builds are the well-trodden path for them.
# =============================================================================

FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app


# -----------------------------------------------------------------------------
# Build — install dependencies and compile the Next.js application.
# -----------------------------------------------------------------------------
FROM base AS build

# `next build` may evaluate the environment schema while compiling. These
# placeholders exist only to satisfy *shape* validation during compilation; they
# are stage-local metadata, never written to disk, and the runtime stage below
# starts from a clean environment, so none of them can reach the final image.
# Real configuration is injected by the orchestrator at run time.
ENV APP_URL=http://build.invalid \
    DATABASE_URL=postgresql://build:build@build.invalid:5432/build \
    REDIS_URL=redis://build.invalid:6379 \
    AUTH_SECRET=Yg8kQ1vJ3mR7pL2nX5tZ0aB4cD6eF8gH0iJ2kL4mN6o= \
    ENCRYPTION_KEY=Zx9wV7uT5sR3qP1oN8mL6kJ4iH2gF0eD8cB6aY4xW2v=

COPY . .

# --frozen-lockfile: the image must be reproducible. A lockfile that no longer
# matches the manifests should fail the build, not be silently resolved.
RUN pnpm install --frozen-lockfile

# Type errors fail this build (next.config.ts sets ignoreBuildErrors: false).
RUN pnpm --filter @reklu/web build

# Dev dependencies are deliberately kept: the worker runs TypeScript source
# through tsx, and migrations run through drizzle-kit.


# -----------------------------------------------------------------------------
# Runtime
# -----------------------------------------------------------------------------
FROM base AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1

# Run as a non-root user. `node` already exists in the base image with uid 1000.
COPY --from=build --chown=node:node /app /app
COPY --chown=node:node scripts/docker-entrypoint.sh /usr/local/bin/reklu-entrypoint
RUN chmod +x /usr/local/bin/reklu-entrypoint

# Mount points for the local storage driver and sandbox scratch space. Created
# here so they are owned by `node` even when a volume is mounted over them.
RUN mkdir -p /app/.storage /app/.sandbox && chown -R node:node /app/.storage /app/.sandbox

USER node
EXPOSE 3000

# Reports real dependency status and returns 503 when Postgres is unreachable,
# so an unhealthy container is actually removed from rotation.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["reklu-entrypoint"]
CMD ["web"]
