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

# npm reads its cache from here, and this path is owned by the build user.
ENV NPM_CONFIG_CACHE=/home/node/.npm

USER node
WORKDIR /home/node

# Warm the cache by installing the stack a generated app actually uses, then
# throw the installation away and keep what npm downloaded.
RUN mkdir -p /home/node/.warm \
  && cd /home/node/.warm \
  && npm init -y > /dev/null 2>&1 \
  && npm install --no-audit --no-fund --silent \
       next react react-dom \
       tailwindcss postcss autoprefixer \
       typescript @types/node @types/react @types/react-dom \
       zod clsx \
  && cd /home/node \
  && rm -rf /home/node/.warm

# Nothing runs by default. The sandbox driver decides what this container does.
CMD ["sleep", "infinity"]
