# v0.4.4.40 validation

Run `npm test` from the module root. Attached propagation coverage verifies that resolved cells are written through `RegionCellStateService.configure`, geometry/metadata updates cannot mutate `regionCells`, empty/error results fail closed, and environment hooks remain limited to attached Direct/Spread Regions.

Live Foundry acceptance requires one focused primary-GM check: run `docs/acceptance-crosshairs3d-v0.4.4.40-attached-wall.txt` on a square-grid Scene containing Caerwyn Thorne. The macro creates its own attached Direct Region and movement Wall, requires both the raw propagation result and persisted mask to shrink behind the Wall, requires exact restoration after deletion, then waits for attached work to finish before removing its temporary documents and restoring Caerwyn.

The v0.4.4.38 interactive Direct, interactive Spread, persistence, and player-authority passes remain valid because v0.4.4.40 changes only attached mask publication.
