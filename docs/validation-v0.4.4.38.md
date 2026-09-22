# v0.4.4.38 validation

Run `npm test` from the module root. The deterministic suite covers the chart-authoritative Sphere masks, all propagation thresholds, Foundry Wall/Level/Surface adapter behavior, placement publication and cancellation, restricted idempotent Region authority, native-versus-cell persistence selection, and attached Direct/Spread re-resolution including fail-closed behavior.

Live Foundry acceptance has two parts:

1. Run `docs/acceptance-crosshairs3d-v0.4.4.38-gm.txt` as the primary GM on the prepared square-grid Scene with Caerwyn Thorne present.
2. Run `docs/acceptance-crosshairs3d-v0.4.4.38-player.txt` as Caerwyn Thorne's non-GM owner while an active GM remains connected.

Both macros remove their temporary Regions/Wall/Level and restore the state they modify. Inspect the console table if either reports `CHECK CONSOLE`.
