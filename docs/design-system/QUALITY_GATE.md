# Premium Quality Gate

Preview health and design approval are separate states.

Approval requires complete viewport evidence, no critical critic finding, verified critical assets, and verified interactions. Source blocking findings force `needs_revision`. Missing evidence produces `pending`, never a fabricated pass.

Current implemented evidence:

- source-quality audit;
- five responsive viewport captures;
- one cross-viewport visual scorecard;
- critical asset-generation failures;
- bounded repair with regression rollback.

Pending browser evidence:

- true full-page captures;
- decoded dimensions and semantic relevance for every critical asset;
- horizontal-overflow DOM measurement;
- route and primary-action click checks;
- keyboard/focus checks;
- measured contrast assertions.

Until these checks are instrumented, the gate records the exact pending reasons in build diagnostics.
