# v0.4.5.1 validation

v0.4.5.1 is a presentation-only follow-up to the live-accepted v0.4.4.47 responsiveness work. It adds the informational line `Target Preview takes 1-2sec` below the existing bottom control hint whenever the resolved propagation mode is Direct or Spread. None mode intentionally has no notice. The notice uses the same 16 px font size as the control hint and color `#e0dcdd`.

The resolved propagation mode is supplied by the placement session to the PIXI renderer, so the notice follows the actual effective mode rather than merely reading the caller's raw option. This preserves CAT/configured propagation overrides. All six renderer families have None/Direct/Spread regression coverage, and a live-session regression verifies mode handoff into presentation.

No propagation or targeting rule changed. The v0.4.4.47 24 ms rapid-intent coalescing, v0.4.4.46 cooperative sampling, final-confirmation barrier, chart-authoritative Sphere cells, Direct/Spread obstruction rules, persistence, cancellation, and cleanup remain unchanged. Packs and assets must remain byte-for-byte identical to the authoritative baseline.

Live validation uses `docs/acceptance-crosshairs3d-v0.4.5.1.txt` and checks the notice visually under None, Direct, and Spread using the same 20-foot Sphere.
