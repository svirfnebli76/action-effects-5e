# v0.4.4.46 validation

v0.4.4.46 supersedes the live-failed v0.4.4.45 responsiveness candidate. v0.4.4.45 correctly separated immediate PIXI presentation from authoritative propagation, but its Direct/Spread resolver still consumed one long browser task because Foundry collision tests are synchronous and Promise microtasks do not admit pointer events or rendering. Live acceptance therefore remained noticeably laggy and reported no observed presentation advance while the authoritative resolver was held behind.

The correction adds cooperative main-thread scheduling only to live Foundry physical sampling. The adapter yields after bounded batches of collision samples and checks a request-scoped stale/cancel signal after the yield. A newer presented serial therefore aborts obsolete physical work at the next cooperative boundary, allowing the existing latest-request queue to resolve the newest visual state. `none` propagation does not use this path.

No propagation rule is weakened: chart-authoritative Sphere cells are unchanged; Direct retains its full XY/Z sampling and >=50% clear XY through positive Z thickness rule; Spread retains orthogonal traversal and the >=10% largest contiguous opening rule with 10x10 shared-face sampling; Walls, Levels, Surfaces, target overlap, and persistent Region representation are unchanged.

Automated validation passes 444/444 tests. New regressions prove that cooperative physical sampling yields without altering evidence, cancellation is observed immediately after a cooperative boundary, and a newer pointer presentation can supersede an in-flight physical calculation without publishing stale targets. The v0.4.4.45 authority, persistence, cancellation, and confirmation-barrier regressions remain active.

Live validation uses `docs/acceptance-crosshairs3d-v0.4.4.46.txt`. Direct and Spread must both feel comparably responsive to None during continuous movement. In addition to final serial/target, persistence, cancellation, restoration, and cleanup checks, the macro now requires observed presentation advance while the physical resolver remains behind for Direct and Spread.
