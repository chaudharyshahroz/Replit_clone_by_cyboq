# The image builds run in, with the dependency cache already warm.
#
# A generated Next.js application installs the same two hundred packages every
# other one does, and on a small machine that is most of the wait before a
# preview appears. Downloading them once, at image build time, turns the first
# install of every build into a local copy.
#
# The cache is a read-only layer in the image: a build can read from it and
# cannot write to it, so nothing one build installs can reach the next. That is
# the property that makes this safe to share, and the reason it is a cache
# rather than a pre-installed node_modules directory.
#
# Build it on the sandbox host:
#   docker build -f docker/sandbox.Dockerfile -t reklu-sandbox:latest .
# then set SANDBOX_DOCKER_IMAGE=reklu-sandbox:latest
#
# Rebuild it every few months to keep the cache close to current versions. A
# stale cache is not wrong, only less useful — npm fetches whatever is missing.
FROM node:22-bookworm-slim

# A prune's exemption. `docker system prune -a` removes every image no container
# is using, and this one is unused by definition between builds — so the weekly
# cleanup that keeps the disk from filling was also deleting the sandbox. The
# label is what `--filter "label!=com.reklu.keep=true"` matches on.
LABEL com.reklu.keep="true"

# Python and a compiler, because a generated app sometimes depends on a native
# module. `better-sqlite3` is the one that turned up: npm runs node-gyp, node-gyp
# looks for Python, finds none, and the install fails with a wall of gyp output
# that says nothing about the application. The image is a few hundred megabytes
# larger and the failure is gone — and it only costs compile time when a package
# actually needs it, which is rare.
USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g pnpm@10.34.5
USER node

# npm reads its cache from here, and this path is owned by the build user.
ENV NPM_CONFIG_CACHE=/home/node/.npm
ENV PNPM_STORE_DIR=/home/node/.pnpm-store

USER node
WORKDIR /home/node

# Warm pnpm's content-addressable store with the stack generated apps use. A
# preview can hard-link these package files instead of expanding and copying
# hundreds of npm tarballs on every cold start.
#
# The directory is `warmcache`, not `.warm`: npm takes the package name from the
# directory it is initialised in, and a name beginning with a dot is invalid — so
# `npm init` failed, the install never ran, and the image built successfully with
# an empty cache. Every step is chained with `&&` for the same reason: a step
# that is skipped must fail the build rather than produce an image that looks
# built and does nothing.
RUN mkdir -p /home/node/warmcache \
  && cd /home/node/warmcache \
  && npm init -y > /dev/null 2>&1 \
  && pnpm add --store-dir /home/node/.pnpm-store --prefer-offline \
       next react react-dom \
       tailwindcss postcss autoprefixer \
       typescript @types/node @types/react @types/react-dom \
       zod clsx \
  && cd /home/node \
  && rm -rf /home/node/warmcache \
  # Proof the cache is actually warm. An image that built without downloading
  # anything is the failure this replaces, and it is invisible from outside.
  && test "$(du -sm /home/node/.pnpm-store | cut -f1)" -gt 20

# Nothing runs by default. The sandbox driver decides what this container does.
CMD ["sleep", "infinity"]
