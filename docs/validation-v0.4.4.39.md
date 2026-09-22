# v0.4.4.39 validation

Run `npm test` from the module root. The attached-propagation suite includes a deterministic scheduler regression proving that Wall-triggered re-propagation waits for Foundry collision geometry to settle while source-Token changes remain immediate.

Live Foundry acceptance requires one focused primary-GM check: run `docs/acceptance-crosshairs3d-v0.4.4.39-attached-wall.txt` on a square-grid Scene with one source Token selected. The macro creates its attached Direct Region and movement Wall, verifies the mask shrinks after Wall creation and returns to its exact original count after Wall deletion, then cleans up both documents. No other Token setup is required.

The v0.4.4.38 interactive Direct, interactive Spread, persistence, and player-authority passes remain valid because this release changes only environment-hook scheduling.
