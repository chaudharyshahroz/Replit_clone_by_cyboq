# Reklu Build Performance

**Status:** streaming file progress, sandbox reuse, HMR sync, and preview recovery exist; first-preview generation is still blocked by full initial generation and design work.

## Current execution path

```text
brief/research
  → one model response for the generated tree (stream parsed)
  → optional full visual-file design call
  → optional source critic repair call
  → artwork acquisition/generation
  → checkpoint
  → sandbox allocation or reuse
  → materialize files
  → dependency install when required
  → development server health check
  → preview URL
  → background-like visual review (currently invoked in the request path)
```

## Five largest time-to-first-preview sources found

1. **The runnable shell is not checkpointed early.** Files stream to progress events, but the preview cannot start until the entire model response is parsed, post-processed, and checkpointed.
2. **Design work precedes preview.** Initial design pass, source critique, artwork, normalization, and instrumentation all run before a user can see the first frame.
3. **Research blocks generation.** When configured, competitor research and strategy generation complete before core files start.
4. **Dependency installation happens after generation.** There is package-manager cache support through the runtime, but no explicit warm stack lease or dependency-ready signal before the project tree arrives.
5. **Build orchestration lives in a server action.** Durable build events exist, but generation is not yet a resumable queued job with independently scheduled Fast Preview and Polish phases.

## Existing performance infrastructure

- streamed provider output and per-file build events
- SSE progress endpoint backed by durable `build_events`
- dependency-aware sandbox synchronization
- reuse of a running preview container for iterative edits
- HMR update without unconditional restart
- preview process, HTTP, compiler, and runtime health checks
- bounded automatic repair and rollback
- idle sandbox reaping and a global preview ceiling

## Required two-phase architecture

### Phase A — Fast Preview

Generate and checkpoint only package metadata, framework config, design tokens, root layout, primary route, and critical components. Assign a warm sandbox as early as possible and start the dev server as soon as that tree is runnable.

### Phase B — Complete Build

Continue secondary routes, interactions, data, media, tests, breakpoint screenshots, design evaluation, and targeted refinement while the preview remains usable and hot-updates.

The state boundary must be durable: refreshing the browser must not cancel Phase B or lose the preview-ready state.

## Metrics to add

- prompt received → planning start/completion
- first file
- sandbox assigned
- dependencies ready
- dev server started
- first preview
- full generation complete
- design review complete
- patch received → preview updated

Targets are measurements, not simulated progress: 10–20 seconds for a simple warm-stack first visual; 20–40 seconds for medium builds; 2–8 seconds for warm targeted edits.

## Next performance milestones

1. Split generation output into `shell` and `completion` contracts.
2. Move orchestration to a durable Build job and stream semantic events.
3. Start preview from the shell checkpoint while completion continues.
4. Add a build file/symbol index and retrieve only affected files for edits.
5. Add a validated CREATE/UPDATE/DELETE/RENAME patch protocol.
6. Add warm sandbox leases and explicit dependency-cache timing.
7. Persist performance spans and expose internal percentile dashboards.

