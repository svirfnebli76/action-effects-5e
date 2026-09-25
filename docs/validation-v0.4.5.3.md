# AE5E v0.4.5.3 Validation

## Scope

v0.4.5.3 replaces sampled hidden traversal support for source-driven and freely placed Lines with exact OBB-vs-grid-cell SAT support, and explicitly retires Cone Spread. Cone None/Direct, Sphere, Prism, Cylinder, authoritative affected-cell rasterization, shared-face obstruction policy, and the responsive placement scheduler are intentionally unchanged.

## Automated validation

Run:

```text
npm test
```

Expected result: 483/483 tests passing plus JavaScript syntax validation.

Focused additions cover:

- broad Source-Line yaw/pitch/length/width analytic-vs-v0.4.5.2-sampler comparison;
- broad Free-Line yaw/length/width/height comparison;
- strict positive-volume SAT behavior, excluding face/edge/point tangency;
- clear-space Spread reachability and traversal-only output isolation;
- full wall-plane interruption and orthogonal-only traversal;
- low-level, raw-placement, configured, and CAT Cone Spread rejection;
- Cone-specific CAT authoring options;
- Cone None/Direct validity and existing tilted Cone Direct regressions;
- legacy attached Cone Spread fail-closed deactivation without repeated rewrites.

## Live acceptance

Run `docs/acceptance-crosshairs3d-v0.4.5.3.txt` as the primary GM on a square-grid Scene with a selected source Token.

The macro runs automatic Line/Cone/configuration checks, creates and removes one temporary movement Wall for a real Foundry obstruction check, and then guides Source-driven Line Spread, Freely Placed Line Spread, Cone Direct, Sphere None, Prism None, and Cylinder None placements. Prior targets are restored and the temporary Wall is removed in cleanup.

The release is not considered live-accepted until the Foundry macro and visual checks pass.
