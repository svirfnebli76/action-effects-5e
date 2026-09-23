# v0.4.4.45 validation

v0.4.4.45 corrects the live Direct/Spread placement responsiveness defect discovered after Checkpoint 4 acceptance. The accepted chart-authoritative Sphere rasterization, Direct 50% XY/positive-Z obstruction rule, Spread 10% contiguous shared-face rule, Foundry Wall/Level/Surface environment model, target overlap rules, and persistent Region representation are unchanged.

The placement scheduler now has an immediate presentation stage and an asynchronous authoritative stage. Every accepted input request synchronously builds and renders its legal shape as `session.presentation`. Direct/Spread propagation and target collection resolve in the existing coalesced drain. A completed result is published only if its request serial is still newest; otherwise it is discarded. `session.current` remains the last fully authoritative revision.

Final confirmation freezes input, enqueues the exact final visual state, and waits until that newest request has completed propagation and targeting. Persistent Region creation receives that exact authoritative propagation object. Cancellation invalidates pending work and restores the original target set; late results cannot publish.

Automated validation: syntax passes for all JavaScript files and the full suite passes with the new scheduling regressions included. The added tests deliberately delay propagation promises to prove immediate rendering, rapid visual revisions, stale-result rejection, newest-target publication, confirmation/persistence barriers, cancellation, and propagation-error cleanup. All existing shape, chart-Sphere, Direct/Spread, Foundry obstruction, targeting, persistence, integration, and Region regressions remain active.

Live validation uses `docs/acceptance-crosshairs3d-v0.4.4.45.txt`. The primary GM interactively compares the same 20-foot Sphere under None, Direct, and Spread, moving each continuously before confirming. The macro checks authoritative serial/target agreement, exact Spread Region cells, automatic cancellation, target restoration, and cleanup. Visual responsiveness remains a required human acceptance observation.
