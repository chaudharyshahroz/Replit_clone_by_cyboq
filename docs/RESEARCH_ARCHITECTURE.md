# Research Architecture

> **Status: design, not implementation.** The schema exists
> (`research_sessions`, `research_sources`, `research_citations`) and the job
> stages are declared in `packages/queue/src/contracts.ts`. The pipeline itself
> is **not built** — it is Milestone 4.

---

## The thing this must not be

> "Send one page of search results to an LLM and print what it says."

That produces confident text with plausible-looking citations, which is worse
than no research: it is wrong in a way that resists checking. Spec §22 forbids
it explicitly.

---

## Pipeline

Each stage is a separate module with typed input and output, so stages can be
tested, replaced, and reported on individually.

```
User question
  ↓ analyzing_intent      what is actually being asked?
  ↓ planning              sub-questions, evidence needed, stopping condition
  ↓ generating_queries    several angles, not one restatement
  ↓ discovering_sources   search adapters
  ↓ fetching_sources      concurrent, bounded, failures recorded
  ↓ extracting_content    main content; boilerplate discarded
  ↓ ranking_relevance     embeddings + heuristics
  ↓ cross_validating      corroboration and contradiction between sources
  ↓ collecting_evidence   claim → supporting passage pairs
  ↓ reasoning             synthesis over evidence, not over raw pages
  ↓ writing_report        prose with inline [n] markers
  ↓ completed
```

These names are the `research_stage` enum and the declared job stages. Progress
shown to the user is the stage the worker has **actually entered** — never a
timer, never a synthetic percentage ([DECISIONS.md D10](./DECISIONS.md)).

Modes differ in depth, not in kind: **Quick** runs a shortened path; **Research**
runs the full pipeline once; **Deep** iterates — after cross-validation it may
generate new queries and loop, bounded by `RESEARCH_MAX_SOURCES` and a step
ceiling.

---

## Citation integrity

The single most important property.

`research_citations` stores the **claim**, the **source**, and the
**supporting passage** — not just a URL. Storing the passage is what makes hover
preview honest and lets a reviewer check that the source actually says what was
claimed.

Rules:

1. A citation may only reference a `research_sources` row Reklu actually
   retrieved. Sources are inserted when fetched, so a citation cannot point at
   something that was never read.
2. A claim with no supporting passage gets **no citation** — never a
   plausible-looking one. An uncited claim is honest; a fabricated citation is
   not (spec §24).
3. Failed fetches are recorded (`fetch_error`), not dropped, so the UI can say
   "14 of 18 sources retrieved" rather than rounding up to success.
4. Contradictions are recorded (`contradicted_by`) rather than silently
   resolved.

---

## Untrusted content

Fetched web content is **hostile input**. A page can contain text addressed to
the model.

- Extracted content enters as **user-role** content, fenced and labelled with
  its source, never as system instruction.
- Instructions found inside retrieved content are data to be reported, not
  followed.
- The system instruction is composed once, from trusted sources only
  ([AI_ARCHITECTURE.md](./AI_ARCHITECTURE.md) §7).

Fetching is subject to the same SSRF controls as MCP
([MCP_SECURITY.md](./MCP_SECURITY.md) T5): a search result is an
attacker-influenceable URL.

Additionally: `RESEARCH_USER_AGENT` identifies the bot honestly, `robots.txt` is
respected, per-domain concurrency is limited, and response size is capped.

---

## Source adapters

```ts
interface SourceAdapter {
  readonly kind: 'web' | 'news' | 'academic' | 'file' | 'project' | 'connection';
  search(query: string, options): Promise<DiscoveredSource[]>;
  fetch(source: DiscoveredSource): Promise<FetchedSource>;
}
```

Web search is pluggable (`SEARCH_PROVIDER`: brave | tavily | serper). With none
configured, research reports **"not configured"** naming the variable — it does
not fall back to the model's memory and present that as researched (spec §111).

`file` and `project` adapters search the workspace's own indexed knowledge, so
research can draw on uploaded documents alongside the web.

---

## Cost control

Deep Research is the most expensive operation in the product, so bounds are
structural rather than advisory: `RESEARCH_MAX_SOURCES`, per-fetch timeout, a
per-plan monthly cap, a step ceiling on the Deep loop, and cooperative
cancellation checked between stages so a cancelled run stops spending
immediately (spec §106, §109).

---

## Research leads to execution

A completed session produces a `research_report` artifact. Because artifacts are
one table with a `type` discriminator ([DECISIONS.md D6](./DECISIONS.md)),
"turn this into a presentation" or "build from this" is a transformation between
two rows carrying the same evidence — not a re-run and not a copy-paste. This is
the mechanism behind spec §26.
