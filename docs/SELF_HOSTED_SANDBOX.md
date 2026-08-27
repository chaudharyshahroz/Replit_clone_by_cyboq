# Running builds on your own server

Reklu can run generated applications on a Docker daemon you control instead of a
paid microVM service. This is what `SANDBOX_DRIVER=docker` does.

Read the first section before setting it up. The cost saving is real, and so is
the trade.

## What you are choosing

Generated code is arbitrary code. Somebody can ask Reklu to build an app and get
whatever they wrote executed on your machine. The only question is what that
code can reach when it runs.

| | E2B (`e2b`) | Self-hosted (`docker`) |
| --- | --- | --- |
| Boundary | Firecracker microVM — separate kernel | Container — **shares your host's kernel** |
| Cost | Per second of compute | A VM you already pay for |
| Escape means | The attacker is in a throwaway VM | The attacker is on your host |

A container is a real boundary. It is not the same boundary. Kernel bugs that a
microVM shrugs off are container escapes, and they are found regularly.

Everything below exists to make that boundary as strong as Docker allows.

## The one decision that matters

**Run the sandbox daemon on a different machine from Reklu.**

If generated code escapes its container on the machine running Reklu, it reads
`DATABASE_URL`, `ENCRYPTION_KEY`, and every provider key you have — every
workspace's data, at once. On a separate box it reaches a box with nothing on
it.

A small VM is a few dollars a month and turns a total compromise into a
contained one. Reklu refuses to point at a local daemon unless you set
`SANDBOX_DOCKER_SAME_HOST_ACK=true`, so that choice is never made by accident.

## Setting up the sandbox host

### 1. Provision a machine

Anything with 2 GB of RAM will run small builds. It needs no access to your
database, your Redis, or your application — and should be given none.

### 2. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
```

### 3. Create the build network

Builds need the public internet to install packages. They never need anything on
your private network.

```bash
docker network create --subnet 172.31.0.0/16 reklu-sandbox
```

Then stop that network reaching private address space. On a host using
`iptables`:

Accept replies first, then block new outbound connections. Without the first
rule the container cannot answer anything that contacted it — including the
reverse proxy — because its reply is traffic *to* a private address:

```bash
sudo iptables -I DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
```

```bash
sudo iptables -I DOCKER-USER -s 172.31.0.0/16 -d 10.0.0.0/8 -j DROP
sudo iptables -I DOCKER-USER -s 172.31.0.0/16 -d 172.16.0.0/12 -j DROP
sudo iptables -I DOCKER-USER -s 172.31.0.0/16 -d 192.168.0.0/16 -j DROP
sudo iptables -I DOCKER-USER -s 172.31.0.0/16 -d 169.254.169.254/32 -j DROP
```

The last line matters more than it looks: `169.254.169.254` is the cloud
metadata endpoint. On most providers, reaching it from inside a container hands
over the host's own credentials.

Persist the rules (`iptables-persistent`, or your provider's firewall).

### 4. Build the sandbox image

Every generated Next.js application installs the same couple of hundred
packages, and on a small machine that download is most of the wait before a
first preview appears. Building the image with the cache already warm turns it
into a local copy instead.

```bash
docker build -f docker/sandbox.Dockerfile -t reklu-sandbox:latest .
```

Then set `SANDBOX_DOCKER_IMAGE=reklu-sandbox:latest`.

The cache lives in a read-only image layer: a build reads from it and cannot
write to it, so nothing one build installs can reach the next. That is what
makes it safe to share, and why it is a cache rather than a pre-installed
`node_modules`.

The image also carries Python, make and a C++ compiler. A generated app
sometimes depends on a native module — `better-sqlite3` is the one that turned
up — and without a toolchain npm runs node-gyp, node-gyp finds no Python, and
the install fails with forty lines of gyp output that say nothing about the
application. **An image built before this was added will keep failing that way,
so rebuild after upgrading.**

Rebuild it every few months. A stale cache is not wrong, only less useful — npm
fetches whatever is missing.

Or skip it and use the plain image, which works and is slower:

```bash
docker pull node:22-bookworm-slim
```

### 4b. If Reklu runs on this same machine

The `web` service already mounts `/var/run/docker.sock`; nothing else does,
because the socket is root-equivalent and only `web` starts builds.

The app runs as `node`, not root, so it also needs the host's docker group:

```bash
getent group docker | cut -d: -f3
```

Put that number in `DOCKER_GID`. Without it the mount is there and unreadable,
which surfaces as "could not reach the sandbox host" rather than a permission
error.

### 5. Let Reklu reach the daemon

The Docker daemon is root-equivalent. **Never expose it to the internet.**

Best: a private network between the two machines, or an SSH tunnel from the
Reklu host:

```bash
ssh -N -L 2375:/var/run/docker.sock user@sandbox-host
```

Then `SANDBOX_DOCKER_HOST=tcp://127.0.0.1:2375` on the Reklu side. Traffic
crosses the network inside SSH, and the daemon itself listens on nothing.

If you use TLS on port 2376 instead, set `DOCKER_CERT_PATH` to a directory
holding `ca.pem`, `cert.pem` and `key.pem`.

### 6. Decide how previews are reached

Two ways. The first is better for anything public.

**Through the reverse proxy (recommended).** Set `SANDBOX_PREVIEW_DOMAIN` and
each preview is served at `https://<id>.preview.example.com` by the proxy
already in front of Reklu. No port is published to the host, so nothing has to
be opened in a firewall, the server's own IP address never appears in a URL
handed to a visitor, and the preview is https — which means it can be shown
inside Reklu instead of only as a link to a separate tab, because a browser
refuses to embed a plain-http page in a secure one.

Add a wildcard DNS record first:

```
*.preview.example.com    A    <your server IP>
```

The certificate is issued per preview hostname by the proxy's existing
resolver, so no wildcard certificate is needed.

**The trade, stated plainly:** the sandbox container joins the proxy's Docker
network so the proxy can reach it, and on that network it can also reach other
containers. The firewall rules below key on the sandbox network's own subnet and
do not cover this second address. If that matters more than hiding the server's
address, use the port form below, or run the daemon on a separate machine where
there is nothing else on the network to reach.

**By address and port.** Set `SANDBOX_PREVIEW_HOST` to the machine's public
address and open ports **43000–43200** — the range
`packages/build/src/preview.ts` uses. Previews are then plain http on that
address, which exposes the IP and cannot be embedded.

### 7. Optional, and worth it: gVisor

gVisor handles syscalls in userspace instead of passing them to your kernel. It
is the single largest improvement available here.

```bash
# https://gvisor.dev/docs/user_guide/install/
sudo apt-get install -y runsc
sudo runsc install
sudo systemctl restart docker
```

Then set `SANDBOX_DOCKER_RUNTIME=runsc`. Builds run slightly slower and a kernel
bug stops being an escape.

## Reklu configuration

```bash
BUILD_ENABLED=true
SANDBOX_DRIVER=docker

# Previews over https, on a subdomain, through the existing proxy.
# Needs *.preview.example.com pointing at this server.
SANDBOX_PREVIEW_DOMAIN=preview.example.com
SANDBOX_PROXY_NETWORK=dokploy-network
SANDBOX_PROXY_CERT_RESOLVER=letsencrypt

# Where the daemon is. 127.0.0.1 here means the SSH tunnel above.
SANDBOX_DOCKER_HOST=tcp://127.0.0.1:2375

# The public name of the sandbox host. Preview links point here.
SANDBOX_PREVIEW_HOST=builds.example.com

SANDBOX_DOCKER_IMAGE=node:22-bookworm-slim
SANDBOX_DOCKER_NETWORK=reklu-sandbox

# Only if you installed gVisor. Setting it without installing it fails every build.
# SANDBOX_DOCKER_RUNTIME=runsc

# Only if the daemon is on this machine. Read the warning above first.
# SANDBOX_DOCKER_SAME_HOST_ACK=true
```

Check it in **Admin → System**: the sandbox line states which driver is active,
whether it is on a separate host, and which runtime.

## What each container gets

Set in `packages/sandbox/src/drivers/docker.ts`, and asserted by tests because
every one of them is invisible at runtime — a container missing `CapDrop` runs
builds and serves previews exactly like one that has it.

- Every Linux capability dropped, and `no-new-privileges`
- A non-root user (`1000:1000`)
- Memory and swap capped to the same number, so it cannot spill into swap
- CPU and process-count limits, so one build cannot take the host down
- The configured network, not the default bridge
- No mounts of any kind — in particular, never the Docker socket
- None of Reklu's environment
- Files owned by the build user, and a working directory it created itself — Docker
  makes a missing working directory owned by root, which locks an unprivileged
  container out of its own files

## What runs, and for how long

A preview is a Node process holding a compiler. Two limits keep them from
taking the machine:

| Limit | Value | What it does |
| ----- | ----- | ------------ |
| Idle TTL | 30 minutes | A preview nobody has touched is destroyed |
| Ceiling | 4 at once | Over that, the least recently used go first |

Both are enforced when a preview starts, so no scheduler is involved. Using a
preview pushes its deadline out, so an active one is never taken mid-edit.

Published sites are exempt: they are not previews, they have no idle deadline,
and they are meant to be answering when nobody is watching.

**This did not exist at first**, and the effect is worth knowing because it is
the shape of a host that works and then stops answering. `expiresAt` was
written on every sandbox and read by nothing, so a preview container lived
until the same project was previewed again — the number of Node processes on
the machine was the number of builds anybody had opened. Nothing errors;
memory is simply consumed by containers serving pages nobody is looking at,
and the first visible symptom is the proxy timing out on requests that used to
be instant.

## Costs you should expect

Disk fills up. Each build pulls its own `node_modules`. Run a weekly clean:

```bash
docker system prune -f --filter "until=168h" --filter "label!=com.reklu.keep=true"
```

**Not `-a`.** The sandbox image is unused by definition between builds, so `-a`
deletes it — and because it is built here and published to no registry, Docker
cannot get it back. What it reports instead is `pull access denied for
reklu-sandbox ... may require 'docker login'`, which sends you looking for
credentials that do not exist. The label filter is the belt; Reklu rebuilding
the image on the host when it finds it missing is the braces. Either alone is
enough, and the rebuild costs a few minutes on the next build.

## Going back

`SANDBOX_DRIVER=e2b` with `E2B_API_KEY` switches back with no data migration.
The drivers are interchangeable.
