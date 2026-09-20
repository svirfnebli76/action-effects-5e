# v0.4.4.33 validation

- `npm test`: **349/349 PASS**, zero failures, cancellations, skips or TODO tests.
- JavaScript syntax validation: PASS (runtime source and asynchronous acceptance macro).
- Static relative-import scan: PASS; no missing imported runtime files.
- Placement runtime reference scan: PASS; no runtime Sequencer, Sequence, Eskie or MeasuredTemplate references in `scripts/crosshairs3d/`.
- Legacy public API: removed, with no redirect/wrapper.
- Sequencer: required in both manifest and runtime dependency validator.
- Compendium packs and animation assets: byte-identical to the v0.4.4.32 input.
- Git deletion Bash script: validated in a disposable Git checkout, including refusal to discard a locally modified obsolete file.
- PowerShell deletion script: reviewed; PowerShell execution was not available in this environment.

The previous suite included obsolete carrier/media/overlay tests. Those tests were replaced or removed with their retired implementation; the current total is not directly comparable to the previous release's count. Existing geometry, Region, environmental, Web infrastructure, movement, relationship, authority and animation-ownership regressions remain covered.

This is automated integration validation, not live Foundry acceptance. Tests emulate pointer events and record PIXI drawing commands; they do not reproduce Foundry's browser rendering, multiplayer clients or all third-party modules. The standalone designs were accepted previously; this integrated build still needs the live checks in `docs/testing.md`.

No new Direct/Spread propagation, persistent Region generation, or legacy Item migration is claimed. Old Item macros that call the removed API are intentionally unsupported until migration after Checkpoint 4.
