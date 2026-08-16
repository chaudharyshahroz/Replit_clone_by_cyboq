# Live verification suites

> Each suite lives inside the package it verifies, because pnpm links
> dependencies per package — a script outside one cannot resolve them.

Integration checks that run against a **real** Postgres and Redis, covering
behaviour unit tests cannot reach: transactional integrity, cross-workspace
isolation, foreign-key constraints, worker pickup, and timing properties.

These are the evidence behind the ✅ marks in
[IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md). They are
kept in the repo so those claims stay reproducible rather than resting on a
transcript.

## Running

Requires a migrated database, a seeded plan set, and at least one signed-up
user. `apps/worker/scripts/verify.mts` additionally needs the worker running.

```bash
pnpm verify:auth
pnpm verify:projects
pnpm verify:queue    # start the worker first: pnpm worker
```

## What each covers

| Suite | Checks | Notable properties |
| ----- | ------ | ------------------ |
| `packages/auth/scripts/verify.mts` | 13 | registration atomicity, anti-enumeration timing, owner FK is RESTRICT |
| `packages/projects/scripts/verify.mts` | 40 | memory approval gate, cross-workspace isolation, append-only artifact versions, context budget |
| `apps/worker/scripts/verify.mts` | 15 | durable row before enqueue, real stage reporting, cancellation, payload validation |

## Writing more

Two rules learned the hard way here:

1. **Do not assert on transient state a healthy system will change.** An early
   version asserted `status === 'queued'` immediately after enqueue; a worker
   that picked the job up promptly made it fail. Assert the invariant (the
   durable row exists with its stages declared), and test transient states
   where they are deterministic.
2. **Guard your fixtures.** A detector fixture once sat just under a threshold,
   so the test would have passed for the wrong reason. Assert the fixture's own
   properties when a threshold is involved.
