# v0.4.4.44 validation

Checkpoint 4 adds the production Item/Activity integration layer around the already accepted 3D placement, targeting, propagation, persistence, and GM-authority services. v0.4.4.44 applies CAT's live `cat.utils.automationUtils.getConfigValue()` path after the standalone v0.4.4.43 diagnostic proved the stored `spread` preference, AE5E resolution, placement propagation, and persistent Region end to end.

Automated validation covers configuration precedence and immutability, CAT default/override/failure behavior, malformed configuration rejection before placement, runtime callback allowlisting, sanitized provenance, bounded diagnostics, cancellation and error accounting, absence of D&D5e system-internal reads, attached-area rehydration on `canvasReady`, public API publication, syntax, and all prior regressions.

Live Foundry acceptance uses `docs/acceptance-crosshairs3d-v0.4.4.44.txt` as the primary GM on a square-grid Scene containing Caerwyn Thorne. The macro creates a disposable World Item with a stored AE5E Sphere configuration and CAT `spread` preference, proves the real CAT configuration read overrides the Item's `direct` default without `catOptions`, asks for one interactive placement through `showConfigured()`, verifies its persistent Region and provenance, exercises automatic cancellation, checks reload rehydration initialization, and removes all temporary documents. It restores the user's prior targets and does not alter Token positions, Walls, compendiums, or assets.

The earlier Checkpoint 2 and 3 visual, chart-Sphere, Direct/Spread, Wall/Surface, exact persistence, and player-authority acceptance results remain applicable because v0.4.4.42 does not replace those accepted algorithms.
