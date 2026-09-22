# v0.4.4.37 validation

Checkpoint 3 is validated at three layers:

- Pure propagation tests reproduce the supplied chart-authoritative Sphere masks for radii 5–60 feet, including the complete 20-foot matrix and rounded cells outside the continuous sphere. They cover Direct coverage immediately below, at, and above 50%; positive Z thickness; no Direct detours; Spread face thresholds; disconnected openings; boundary seeds; connectors; cancellation; and cell budgets.
- Foundry adapter tests verify full-cell Sphere sampling, contiguous Spread openings, all-Level Wall height intervals, viewed-Level-independent Surface queries, persistent Region flags, static and attached frames, and idempotent Region creation.
- Placement integration tests verify propagated-cell target collection, immutable final revision publication, one persistent creation after confirmation, no creation after cancellation, resource cleanup, and compatibility with every supported shape.

Run `npm test` from the module root for the automated suite. In Foundry, paste `docs/acceptance-crosshairs3d-v0.4.4.37.txt` into a Script Macro and run it as a GM in the prepared Scene. The macro reports each check in the console and restores all Token positions, targets, and temporary documents in `finally` cleanup.
