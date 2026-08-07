# Changelog

## 0.1.1 — Socketlib initialization fix

- Registered the `socketlib.ready` listener during module script evaluation rather than inside the Foundry `init` callback.
- Added a defensive Socketlib API availability check.
- Corrected the movement-service startup log to include its stop listener.

## 0.1.0 — Foundation

- Added Foundry v14+ module manifest.
- Declared D&D5e, Midi-QOL, DAE, Socketlib, and libWrapper requirements.
- Added startup dependency validation.
- Added CPR and GPS compatibility detection.
- Added world overlap-policy setting and client diagnostics settings.
- Added immutable movement transaction model.
- Added indexed movement consumer registry.
- Added low-overhead centralized movement hook service.
- Added persistent Scene-based token relationship registry.
- Added Socketlib-authorized relationship creation and removal.
- Added test harness and syntax-check script.
