# AI Architecture

How Reklu talks to models. This describes what is **implemented** in
`packages/ai`; see [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) for
what is not.

---

## 1. The rule

> No vendor SDK is imported outside `packages/ai/src/providers/`.

Everything else in Reklu — chat, compare, research, build, agents — speaks to
`AIProvider`. That single constraint is what makes "add xAI" a change to one
directory rather than a search across the codebase, and what keeps a provider's
retry semantics or token-field naming from leaking into product code.

```
product code
     │  AIProvider
     ▼
packages/ai/src/providers/
     ├── vendor.ts     one adapter, parameterized by an AI SDK model factory
     ├── dev-echo.ts   development mock (no network)
     └── index.ts      construction + credential detection
```

---

## 2. The provider contract

```ts
interface AIProvider {
  key: string;
  displayName: string;
  isDevelopmentMock: boolean;

  capabilities(): ProviderCapabilities;
  generate(options: GenerateOptions): Promise<GenerateResult>;
  stream(options: GenerateOptions): AsyncIterable<StreamEvent>;
  embed?(options: EmbedOptions): Promise<EmbedResult>;
}
```

`embed` is optional because not every provider offers embeddings; callers check
rather than assume.

### Why one adapter for five vendors

`vendor.ts` is parameterized by an AI SDK model factory. The vendors' wire
protocols differ, but the SDK already normalizes that. What Reklu adds — and
therefore owns regardless of the SDK — is:

- the **stream event protocol** (below),
- **token accounting**, normalized across providers that name the same fields
  differently (`promptTokens` vs `inputTokens`),
- the **error taxonomy**, specifically the retryable/not distinction.

See [DECISIONS.md D16](./DECISIONS.md).

---

## 3. Stream events

A discriminated union, so the client renders incremental state without guessing:

| Event | Purpose |
| ----- | ------- |
| `start` | model chosen, plus the Reklu Auto reason |
| `text-delta` | incremental text |
| `reasoning-delta` | incremental reasoning, where supported |
| `tool-call` / `tool-result` | tool execution |
| `status` | a long operation reporting a real stage |
| `finish` | token usage + finish reason |
| `error` | user-safe message + whether a retry could work |

`status` and `error` are first-class rather than out-of-band: a long tool call
must be able to report progress, and a mid-stream failure must be
distinguishable from a clean finish. Transport is SSE (`text/event-stream`) with
`X-Accel-Buffering: no`, without which proxies buffer the response and defeat
streaming entirely.

---

## 4. The model registry

Models are **rows in `ai_models`**, not constants
([DECISIONS.md D7](./DECISIONS.md)). Each row carries capabilities, context
window, cost, `bestFor` tags, routing priority, and plan availability.

`loadRegistry()` annotates every model with `isConfigured` — whether this
instance actually holds the provider's credential. Unconfigured models are still
returned so the UI can show them as unavailable rather than hiding capability
that exists in the product.

`selectableModels(registry, planLimits)` then applies plan gating. One
deliberate exemption: the development mock bypasses plan allowlists, because a
plan's allowlist naturally names only real models and gating the mock left
developers with nothing selectable at all.

---

## 5. Reklu Auto

Two stages, deliberately separated:

```
classify(messages, system, hasTools) → RequestProfile
route(profile, candidates, limits)   → RoutingDecision
```

**`classify`** derives intent (`quick` | `general` | `reasoning` | `coding` |
`research` | `long_context` | `vision`), whether vision or tools are required,
estimated input tokens, and a 0–1 complexity score from message length and
conversation depth.

**`route`** filters, then scores.

The distinction that matters: **hard capabilities are filters, not penalties.**
A model that cannot see an image is removed from consideration for a request
containing one, no matter how well it scores otherwise. Scoring only ranks
models that are already capable of the job.

`score()` rewards `bestFor` matches and admin routing priority, prefers cheap
fast models for trivial work and stronger models for complex work, penalizes
reasoning models on trivial requests (their latency is not repaid), and heavily
penalizes a context window that barely fits — the reply and any tool results
still have to land inside it.

Every decision returns a human-readable `reason`, persisted on
`ai_requests.routingReason` and shown in the UI. A router that cannot explain
itself is one users stop trusting the first time it picks badly.

`score()` is the intended replacement point for a learned router; classification
and callers stay unchanged.

### No silent substitution

When a user explicitly names a model that is unavailable, Reklu **errors**
rather than quietly using a different one (spec §107). Auto-routing is opt-in.

---

## 6. Cost accounting

Every provider call writes `ai_requests` (observability) and `usage_ledger`
(billing).

Money is computed in **integer micro-dollars** and converted to a decimal string
only at the boundary. Accumulating float dollars across millions of rows drifts,
and a ledger that disagrees with the invoice is worse than no ledger
([DECISIONS.md D8](./DECISIONS.md)).

`billableUnits` is deliberately decoupled from raw provider cost: users should
not have to reason about token prices, and Reklu must be able to re-price
without changing what a customer's quota means. The development mock bills
**zero**.

`recordUsage()` never throws. Losing an answer the user already received because
an accounting insert failed is the wrong trade; failures are logged loudly for
reconciliation instead.

---

## 7. The untrusted-content boundary

Reklu composes exactly one system instruction, from **trusted sources only**:
product rules, project instructions, and skills.

Retrieved web pages, uploaded file content, tool results, and repository
contents are **data**. They enter as user-role content, fenced and labelled, and
can never redefine instructions. See
[RESEARCH_ARCHITECTURE.md](./RESEARCH_ARCHITECTURE.md) and
[MCP_SECURITY.md](./MCP_SECURITY.md).

---

## 8. The development mock

When no vendor key is configured **and** `NODE_ENV !== 'production'`, a
`dev-echo` provider stands in. It:

- is labelled **Development Mock** in the selector, on every message, and in the
  empty state;
- **throws** if constructed in production;
- bills **zero** units;
- describes what it received rather than imitating an answer.

Two variants exist (`dev-echo-1`, `dev-echo-2`, differing in stream rate) purely
so Compare Mode — which requires two models — is exercisable without keys.

This is what allowed the full pipeline to be verified end to end before any
credential existed. It is not a substitute for verifying against a real model,
and the status document says so.

---

## 9. What is not built

Provider fallback on failure (spec §107), tool calling through to MCP,
structured output helpers, and embeddings wiring are designed for but not
implemented. See [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md).
