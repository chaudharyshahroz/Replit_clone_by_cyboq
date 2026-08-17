# Running an MCP server alongside Reklu

Most MCP servers distributed today speak **stdio**, not HTTP. Reklu connects
over HTTP only, deliberately: a stdio server means Reklu's own container
spawning a child process, and Reklu does not execute operator-supplied
commands inside the application container.

The bridge is a sidecar. It runs the stdio server and exposes it over HTTP, in
its own container, where a crash or a compromise is contained.

## 1. Add the sidecar to your Compose stack

```yaml
  mcp-filesystem:
    image: node:20-bookworm-slim
    command: >
      npx -y supergateway
      --stdio "npx -y @modelcontextprotocol/server-filesystem /data"
      --port 8000 --baseUrl http://mcp-filesystem:8000
    volumes:
      - mcp-data:/data
    networks: [reklu-internal]
    restart: unless-stopped
    # No ports: — reachable only from inside the stack, never from the internet.
```

Two things matter here. It joins `reklu-internal`, so nothing outside the stack
can reach it. And it publishes no ports, so the only thing that can call it is
Reklu.

## 2. Permit the host

Reklu refuses endpoints resolving to private addresses, because an endpoint URL
is typed by a user and `http://169.254.169.254/` reaches cloud metadata. A
sidecar resolves to a private address too, so name it explicitly:

```
MCP_ALLOWED_HOSTS=mcp-filesystem
```

This is narrow on purpose. There is no "allow private ranges" switch, because
that would reopen the metadata hole for every URL anyone can type.

**Only name services you run.** Any host listed here can be reached by any
endpoint URL a user enters.

## 3. Connect it

Settings → Connections → MCP servers → Add server:

```
http://mcp-filesystem:8000/sse
```

Then review its tools and enable the ones you want. Nothing runs before that.

## Why not implement stdio directly

The schema reserves a `stdio` transport, and it stays unimplemented on purpose.
It would mean Reklu spawning operator-configured commands inside the web
container — a process with the application's filesystem, its network position,
and its environment. The sidecar gets the same capability with a boundary
around it, using infrastructure you already run.

## Security notes

- The sidecar's volume is what it can see. `/data` above is a dedicated volume,
  not a mount of anything belonging to Reklu.
- Tool definitions from any server are untrusted. Reklu hashes them, and a
  change withdraws approval until a human reviews it again.
- Every tool arrives disabled. Connecting grants nothing.
