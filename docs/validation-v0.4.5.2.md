# AE5E v0.4.5.2 Validation

## Scope

v0.4.5.2 corrects the live targeting regressions found while testing all Action Effects 3D Crosshair shapes under None, Direct, and Spread:

- Source-driven Line Spread could lose most of its affected cells at non-cardinal yaw or elevated pitch.
- Freely Placed Line Spread could lose targeting or appear to acquire and then drop targets at non-cardinal yaw.
- Pitched Cone Spread could fail to seed at all.
- Pitched Cone Direct could reject normally qualifying cells in completely clear space because four generic Z midpoints missed the qualifying Cone slice.

Sphere chart/tangency behavior is unchanged. Prism and Cylinder behavior is unchanged.

## Architecture

Spread keeps the existing 50% affected-cell mask as the only authoritative output used for targets and persistent Region cells. Source-driven Line, Freely Placed Line, and Cone additionally receive a low-threshold positive-volume traversal mask used only by the internal orthogonal BFS. Physical shared-face evidence remains authoritative and still requires a largest contiguous opening of at least 10%.

Cone Direct samples 17 Z slices across the actual Cone/cell overlap, matching the rasterizer cadence. The Direct threshold remains at least 50% clear XY through positive Z thickness. The horizontal Cone apex-adjacent 25% rasterization exception is intentionally not promoted by Direct.

## Automated validation

- Syntax gate: 127 JavaScript files.
- Complete suite baseline after implementation: 473 tests, 473 passed, 0 failed.
- Nine new focused regressions cover:
  1. Source-driven Line Spread across 0/15/30/45/60/75/90 degree yaw.
  2. Source-driven Line Spread across 15/30/45/60 degree pitch.
  3. Freely Placed Line Spread across 0/15/30/45/60/75/90 degree yaw.
  4. Cone Spread across 0/15/30/45/60/75/90 degree pitch.
  5. Traversal-only support cells never appearing in affected output.
  6. A full wall plane interrupting a 45-degree Line support path.
  7. Closed orthogonal faces preventing diagonal jumping.
  8. Clear-space Foundry Direct preserving every normally qualifying pitched Cone cell.
  9. Horizontal Cone 25% apex cells remaining subject to Direct's independent 50% rule.

Representative clear-space physical-work counts remain bounded: the 45-degree Source Line uses 48 shared-face queries, the 45-degree Freely Placed Line uses 105, and the 45-degree Cone uses 28. These are below the previously measured 20-foot Sphere Spread workload of approximately 254 face queries.

## Live acceptance

Run `docs/acceptance-crosshairs3d-v0.4.5.2.txt` as the primary GM. The macro performs objective clear-space Line/Cone checks, then guides four live placements: Source-driven Line Spread, Freely Placed Line Spread, Cone Direct, and Cone Spread. Verify diagonal Line targeting remains stable after the Target Preview settles and elevated Tokens inside the visible 3D Cone remain targeted.

No Items, Walls, or Regions are created by the live macro. Original user targets are restored in cleanup.

## Package safety

Verified against the accepted v0.4.5.1 archive:

- 78/78 pack files are byte-for-byte identical.
- 26/26 asset files are byte-for-byte identical.
- The obsolete root files `UPDATE-v0.4.4.33.md` and `UPDATE-v0.4.4.34.md` remain absent.
- The complete 473-test suite passed twice consecutively after version/documentation updates and timing-test hardening.
