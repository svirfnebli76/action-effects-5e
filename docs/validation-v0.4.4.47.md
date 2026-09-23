# v0.4.4.47 validation

v0.4.4.46 materially improved Direct/Spread responsiveness by yielding physical collision sampling to the browser. Live testing confirmed the improvement, but continuous movement still felt somewhat rough. The v0.4.4.46 counters showed why: Direct produced thousands of presentations and more than five thousand stale discards while only a handful of authoritative revisions completed; Spread showed the same pattern. The remaining cost was repeated short-lived physical work that began before the next high-rate pointer event superseded it.

v0.4.4.47 adds a 24 ms quiet window only for rapid mouse/wheel placement intent under Direct/Spread. Presentation is still synchronous. While the visual state is changing rapidly, newer requests replace the pending physical request and no collision sampling begins. Once the state is stable for the quiet window, the newest request resolves normally. Initial placement, document/environment refreshes, and final confirmation bypass the delay. Cooperative yielding from v0.4.4.46 remains active if an already-running calculation becomes stale.

No rules change: chart-authoritative Sphere cells, Direct 50% XY coverage through positive Z thickness, Spread orthogonal traversal and 10% largest-contiguous-face rule, 10x10 shared-face sampling, Walls, Levels, Surfaces, Token overlap, targeting, and persistent Region exact masks are unchanged.

Automated validation passes 445/445 tests. The added regression sends a rapid Direct pointer burst and proves that no obsolete physical calculation starts during the burst, at least one request is coalesced, and only the newest stable presentation resolves afterward. Existing confirmation, persistence, cancellation, error, cooperative-yield, and all-shape regressions remain active.

Live validation uses `docs/acceptance-crosshairs3d-v0.4.4.47.txt`. The macro reports coalesced requests and actual propagation starts rather than relying on the v0.4.4.46 16 ms sampling detector, which produced a false negative despite presentation vastly outpacing authoritative completion. Visual smoothness remains an explicit acceptance criterion.
