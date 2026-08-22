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

### 4. Pull the build image

```bash
docker pull node:22-bookworm-slim
```

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

### 6. Open the preview ports

Previews are served from the sandbox host on ports 4300–4399. Open that range to
the public, and nothing else.

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

## Costs you should expect

Disk fills up. Each build pulls its own `node_modules`. Run a weekly clean:

```bash
docker system prune -af --filter "until=168h"
```

## Going back

`SANDBOX_DRIVER=e2b` with `E2B_API_KEY` switches back with no data migration.
The drivers are interchangeable.
