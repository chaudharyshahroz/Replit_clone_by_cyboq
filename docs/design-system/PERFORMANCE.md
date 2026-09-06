# Design Pipeline Performance

- Deterministic product interpretation, skill routing, component selection, lint, and compilation add no provider calls.
- V5 role separation is logical; structured roles share contracts rather than forcing one paid request per title.
- First preview remains on the fast path. Asset fulfillment and visual QA are background work.
- Preview sandboxes are reused; dependency installations and runtime state are cached by the existing preview subsystem.
- Responsive critique uses one call containing all viewport captures.
- Repair is bounded to one pass and constrained to the original provider.

The next optimization target is true incremental file streaming before the complete model response. It is not claimed as complete in this increment.
