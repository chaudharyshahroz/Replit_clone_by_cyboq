# MCP Security

> **Status: design, not implementation.** The schema exists
> (`mcp_servers`, `mcp_tools`, `tool_executions`, `connections`,
> `oauth_credentials`); the MCP client and permission engine are **not built**.
> This document is the threat model those will be built against, written first
> deliberately — the controls below are cheap to design in and expensive to
> retrofit.

---

## Why MCP is the highest-risk surface in Reklu

Everywhere else, Reklu decides what a model may do. With MCP, a **third party**
supplies the tool definitions, the descriptions the model reads, and the results
fed back into context — and those tools act on the user's real systems.

That inverts the usual trust direction. An MCP server is not a library; it is an
untrusted remote party that gets to influence a model's behaviour and then
receive its instructions.

---

## Threat model

| # | Threat | Control |
| - | ------ | ------- |
| T1 | **Malicious server** exfiltrates data or acts destructively | Tools opt-in; risk classes; human approval for writes; full audit |
| T2 | **Schema poisoning** — server changes a tool's description or parameters after approval | Approved schema hash pinned; drift re-prompts the user |
| T3 | **Prompt injection via tool results** | Results are data, never instructions; fenced and labelled |
| T4 | **Credential theft** | AES-256-GCM at rest, AAD-bound to the server row; never logged or sent to the client |
| T5 | **SSRF** via an attacker-chosen endpoint | Endpoint allowlist; private ranges and metadata endpoints blocked; DNS re-checked after resolution |
| T6 | **Confused deputy** — one workspace's tool acting with another's credential | Workspace scoping on every row; AAD binding makes cross-row reuse fail |
| T7 | **Resource exhaustion** | Per-call timeouts, response size caps, per-plan concurrency limits |
| T8 | **Local command execution** via `stdio` transport | Disabled unless the deployment explicitly opts in |

---

## T1 — Tools are opt-in, and writes need a human

Discovered tools are stored **disabled**. A user enables each one deliberately,
having seen its name, description, and parameters.

Every tool carries a `risk_class`:

| Class | Meaning | Default |
| ----- | ------- | ------- |
| `read_only` | fetches, does not change anything | may run under standing authorization |
| `create` | adds data | approval required |
| `update` | changes data | approval required |
| `delete` | removes data | approval required |
| `financial` | moves money | approval required, always |
| `security_sensitive` | credentials, permissions, access | approval required, always |

Classification happens at discovery from the server's annotations plus
heuristics, and is **overridable by an admin** — a server declaring its
`delete_all_customers` tool `read_only` must not thereby earn auto-execution.

Spec §49's example is the design target: "search my CRM" may run; "delete all
customers" must stop and ask.

## T2 — Schema poisoning

A server can serve a benign tool definition during approval and a hostile one
afterwards — the model reads tool *descriptions*, so a changed description is a
changed instruction.

`mcp_servers.tool_schema_hash` records the schema the user actually approved,
with `tool_schema_approved_at` / `_by`. Before exposing tools to a model, the
live schema is re-hashed. On drift, tools are suspended and the user is
re-prompted with a diff. Silently accepting the new schema would make approval
meaningless.

## T3 — Tool results are data

Tool output re-enters the model as **user-role content**, fenced and labelled as
external, never merged into the system instruction. Text in a tool result
claiming to be a system message, an authorization, or an instruction to call
another tool has no privileged effect.

The boundary is structural — Reklu composes exactly one system instruction, from
trusted sources only (see [AI_ARCHITECTURE.md](./AI_ARCHITECTURE.md) §7).

## T4 — Credentials

Server credentials live encrypted in `mcp_servers.credential_encrypted`, using
the AES-256-GCM envelope in `packages/shared/src/crypto.ts`, **AAD-bound** to
`mcp:<server id>`.

The binding matters: encryption alone protects a database dump, but not an
attacker who can *write* to the database and copy another workspace's ciphertext
onto their own server row. AAD makes that decryption fail
([DECISIONS.md D4](./DECISIONS.md)).

`env_keys` stores variable **names** only. The logger redacts credential-shaped
values by key name and by value shape.

## T5 — SSRF

Endpoints are attacker-influenced by definition, so before every request:

1. Scheme must be `https` (`http` only for explicitly allowed localhost in dev).
2. Resolve DNS, then reject private and link-local ranges — `127.0.0.0/8`,
   `10/8`, `172.16/12`, `192.168/16`, `169.254/16` (which covers cloud metadata
   at `169.254.169.254`), `::1`, `fc00::/7`.
3. Re-check the resolved address at connection time, not only at validation
   time — otherwise DNS rebinding defeats the check.
4. Do not follow redirects to a host that fails the same checks.

## T6 — Workspace scoping

Every MCP row carries `workspaceId`, and authorization proves membership before
the row is read. Tenancy is a single-column check, never a traversal.

## T7 — Resource limits

Per-call timeout, response size cap (oversized results truncated with a visible
marker rather than silently), per-plan concurrency, and per-plan server counts.

## T8 — stdio transport

`stdio` means executing a local process. It is disabled unless a deployment
explicitly enables it, and is never available to unprivileged users on a shared
instance.

---

## Audit

Every invocation writes a `tool_executions` row — **including denials**, which
are the interesting ones during an incident. Recorded: tool, risk class, status,
arguments (redacted), truncated output, approver and timestamp, denial reason,
and duration.

---

## What users see

Connections show product names ("GitHub", "Slack"), not transport details. But
before enabling a server, users see: which tools it exposes, what each does,
each tool's risk class, and which need approval. Spec §85 requires that the
permissions a connection carries be legible — a user who cannot tell what a
connection permits cannot meaningfully consent to it.
