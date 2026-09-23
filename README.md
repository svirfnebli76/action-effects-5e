# Action Effects 5E

Action Effects 5E (AE5E) provides reusable D&D5e automation infrastructure for Foundry VTT. Individual Items remain responsible for their own game rules; AE5E provides generic capabilities that multiple unrelated automations can reuse.

## Architecture boundary

AE5E runtime may own reusable infrastructure such as:

- PIXI-only 3D placement crosshairs and shared selection indicators;
- Socketlib / primary-GM authority;
- generic Region creation and native Region-event routing;
- generic CAT/Midi Activity execution;
- reusable combat-turn / occupancy event gates and idempotency;
- generic movement pause/resume/stop primitives;
- Region/document-owned runtime Active Effect cloning and cleanup;
- synthetic Token Actor lifecycle support;
- generic ongoing helper-Item lifecycle;
- Midi concentration-dependent document binding;
- environmental capability/state/timing infrastructure;
- adapters that configure native Foundry/D&D5e/module functionality rather than recreating it.

Item automation owns everything that is true because of that specific spell, feature, or action: trigger timing, Activity choices, success/failure rules, geometry, effect-template choice, helper UUIDs, damage, spell-specific environmental behavior, and presentation.

A persistent Item may provide a declarative recipe at use time. AE5E can persist and execute that recipe later without knowing the Item's rules.

## Persistent-area infrastructure

The generic persistent-area stack consists of:

- `action-effects-5e.persistent-area` — native Foundry v14 RegionBehavior type;
- `PersistentAreaEventService` — event recipe validation/routing, CAT/Midi Activity execution, generic gates, pre-gate Region geometry qualifiers, movement pause/stop, and generic outcome operations;
- `PersistentAreaLifecycleService` — source-Item Active Effect cloning, Region/document ownership, synthetic Actor cleanup, ongoing-action propagation, and Midi concentration dependency binding;
- `RegionAuthorityService` — primary-GM Region document authority and native RegionBehavior helpers.
- `RegionCellStateService` — Region-local/source-local 3D grid-cell state with sparse persistence and local↔world transforms.
- `RegionOccupancyService` — compatibility façade that keeps native Foundry containment for ordinary Regions and uses AE5E 3D occupancy for cell-backed Regions.
- `RegionCellMovementCostService` — per-step cell-aware movement-cost classification for cell-backed persistent areas.
- `RegionCellAttachmentService` — stationary-target enter/exit detection when a native Token-attached Region translates, changes elevation, or rotates.

AE5E does not implement spell-specific difficult-terrain rules. Ordinary Regions may use `regions.buildMovementCostBehavior()` to construct Foundry's native Modify Movement Cost RegionBehavior. Cell-backed Regions use the generic Region-cell movement-cost service so inactive/GONE cells can remain normal terrain while ACTIVE cells modify cost; Item automation decides which cell states and multiplier its rules require. Foundry/D&D5e movement measurement and movement history remain authoritative.

## Web status after infrastructure cleanup

Web-specific runtime automation has been removed from AE5E production services. There is no spell-specific Web public API, runtime service/RegionBehavior class, socket handler, or Web rule constant in production runtime code.

The Web On Use macro is intentionally not shipped in this infrastructure checkpoint. It will be re-authored against the finalized generic API after infrastructure acceptance.

Web knowledge remains only in dev/test authoring validation and regression tests. The source Item can be checked with:

```js
await game.modules.get("action-effects-5e").api.tests.environment.validateWebItem({
  itemUuid: "PASTE-WEB-ITEM-UUID-HERE",
  escapeTemplateUuid: "PASTE-ESCAPE-WEB-COMPENDIUM-UUID-HERE",
  notify: true
});
```

The validator requires the automation-only `Cast Web`, `Web Save`, and `Burning Web Damage` Activities to use `target.override = true` and `target.prompt = false`. It validates the external Escape Web helper, requires that helper Activity to target `Self`, and does not require or support the retired legacy Escape Web Activity on the spell.

## Live Foundry acceptance

Repository tests support development, but Foundry runtime acceptance remains required because production behavior depends on Foundry documents/hooks, D&D5e, Midi-QOL, CAT, Socketlib, and installed-module coexistence.

Run as AE5E's primary GM:

```js
const ae5e = game.modules.get("action-effects-5e").api;

await ae5e.tests.environment.runFoundation({ notify: true });
await ae5e.tests.runRegionAuthorityFoundationTest({ notify: true });
await ae5e.tests.runOngoingEffectFoundationTest({ notify: true });
await ae5e.tests.runFoundationSmokeTest({ notify: true });
```

`environment.runFoundation()` verifies the generic persistent-area RegionBehavior registration, authority socket handlers, lifecycle initialization, and a generic persistent-area recipe contract in addition to the existing environmental foundation.

For the broader environmental suite:

```js
await ae5e.tests.environment.runAll({ notify: true });
```

## Development gate

```bash
npm test
```

The suite includes architectural boundary tests that fail if Web-specific runtime terms are reintroduced outside `scripts/dev`.

## Compendium safety

Infrastructure builds must not modify `packs/` or `assets/` unless an isolated Item/asset publication is explicitly intended. Web's working actor Item remains separate from this infrastructure cleanup and should not be overwritten from a stale compendium copy.

Historical release details are retained in `CHANGELOG.md`.

## v0.4.4.41 installation

Install the complete module folder and reload Foundry. v0.4.4.41 publishes Region-cell configurations as exact replacements instead of allowing Foundry v14 to recursively merge stale cell keys. Run only `docs/acceptance-crosshairs3d-v0.4.4.41-attached-wall.txt` as the primary GM; previously accepted interactive Direct, Spread, persistence, and player-authority results remain valid.

## v0.4.4.39 installation

Install the complete module folder and reload Foundry. v0.4.4.39 corrects the attached-area obstruction-hook timing found during final Checkpoint 3 acceptance. The interactive Direct and Spread confirmations from v0.4.4.38 remain valid; run only `docs/acceptance-crosshairs3d-v0.4.4.39-attached-wall.txt` as the primary GM to confirm the correction.

## v0.4.4.38 installation

Install the complete module folder and reload Foundry. v0.4.4.38 hardens Checkpoint 3 persistent areas: attached Direct/Spread masks re-resolve after source or obstruction changes, simple exact prisms/cylinders use native Regions, and complex/chart/clipped volumes remain cell-backed. Run both v0.4.4.38 acceptance macros in `docs/`—the extended macro as GM and the authority macro as Caerwyn Thorne's player with a GM online.

## v0.4.4.37 installation

Sequencer is required for AE5E automations. The placement system itself uses native PIXI and pointer input. The legacy `ae5e.crosshairs` API is removed; existing Items will be migrated after Checkpoint 4. Use `docs/testing.md` for live acceptance.

v0.4.4.37 completes Checkpoint 3 propagation and persistent-area generation. Placement revisions now resolve `none`, `direct`, or `spread` against the authoritative 3D cell mask before collecting targets. Direct uses physical movement-blocking Walls and Surfaces; Spread crosses only sufficiently open shared cell faces. Confirmed persistent placements create one broad native Foundry Region carrying the exact AE5E 3D cell state. Chart-authoritative Sphere cells remain unchanged.
