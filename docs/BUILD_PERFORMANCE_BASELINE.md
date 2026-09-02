# Build Performance Baseline

**Instrumented:** 2026-09-02

## Measurement status

The reported ~21-minute simple build predates exact span instrumentation. There is no trustworthy historical stage-level trace from which to allocate those 21 minutes, so this document does not invent one.

Build now persists monotonic, wall-clock-anchored `performance` events for:

1. prompt received
2. product understood
3. Design DNA ready
4. generation started
5. first streamed file
6. generation completed
7. design polish completed or deferred
8. assets completed or deferred
9. checkpoint completed
10. preview synchronization started
11. preview updated
12. validation completed
13. build completed

Each event contains its real elapsed milliseconds from the start of that Build action. The next real simple-site run will therefore yield an exact waterfall without changing the database schema or relying on UI estimates.

## Code-path baseline before the V2 fast path

Static tracing found these serial gates before first preview; they are facts about call order, not guessed durations:

1. market research and a strategy-model call;
2. complete application model generation;
3. separate design-model rewrite;
4. source critic and possible second rewrite;
5. stock search or generated artwork for requested assets;
6. complete-tree normalization, instrumentation, and checkpoint;
7. sandbox synchronization and package installation/startup.

This explains why the UI can show streamed filenames while still being unable to display a preview: streamed files were events only, not an executable checkpoint.

## V2 change

Simple websites and compact dependency-free dashboards now enter `Fast Build` deterministically. Before first preview they skip:

- competitor research;
- the separate design-polish model call;
- blocking artwork acquisition/generation;
- full checks.

They still receive persistent Product Context, Design DNA, information architecture, generator design guidance, source normalization, a safe checkpoint, sandbox reuse, and preview health checks. Complex applications remain on the Agentic Build path.

This is the first latency reduction, not the completed two-phase engine. The remaining dominant gate is whole-response generation before the first executable checkpoint. The next milestone is a deterministic Design Compiler shell that can be checkpointed and previewed while completion continues.

## Stage budgets

Fast Build records engineering budgets of 5s planning, 15s critical generation, and 10s preview boot. These are diagnostic thresholds, never fake progress or automatic claims of success.

## How to collect the first measured baseline

Run the acceptance prompt through Build:

> Build a premium website for a modern specialty coffee shop. It should feel warm, sophisticated and distinctive.

Then query the build's ordered `build_events` where `kind = 'performance'`. Compare `first_file`, `preview_updated`, and `build_completed`; the JSON messages contain elapsed milliseconds and timestamps.

