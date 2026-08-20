### v0.4.1.2 reusable Eskie crosshair foundation

AE5E now exposes a centralized `ae5e.crosshairs` service for custom spell/item placement visuals. It detects Patreon Eskie (`eskie-effects`) separately from the public free module (`eskie-effects-free`), prefers native premium recolors, falls back to the free white artwork plus Sequencer tinting when possible, and leaves the native Sequencer crosshair visible when no compatible Eskie visual exists. The catalog explicitly contains all 244 supplied premium crosshair files and 52 confirmed free white crosshair files. Rectangle and Reticle are resolved from their direct free asset paths even though the current public free Sequencer database does not register those families.

Supported Eskie visual vocabulary: **Circle, Cone, Line, Ray, Rectangle, Reticle**. AE5E intentionally preserves the semantic distinction that **Line** is a source-to-template tracer (Fireball pattern), while **Ray** is the beam/path itself. The free and premium catalogs both cover all six shapes. Premium provides native Red/Teal/White/Yellow recolors, while the free catalog provides white artwork that AE5E can tint when a colored visual is requested.

The proven Fireball presentation rule is centralized: when a custom Eskie replacement is available, AE5E hides the functional Sequencer crosshair with `borderAlpha: 0`, `fillAlpha: 0`, and `gridHighlight: false`; if no Eskie replacement resolves, AE5E does **not** hide the native crosshair. This release adds infrastructure only and does not rewrite the existing Fireball item.

Primary APIs:

```js
const ae5e = game.modules.get("action-effects-5e").api;

ae5e.crosshairs.getEskieStatus();
ae5e.crosshairs.getShapeInfo("line");
ae5e.crosshairs.getCatalog({ source: "premium", shape: "circle" });
ae5e.crosshairs.resolveAsset({ shape: "circle", size: 20, color: "red" });
```

A Fireball-style placement can be expressed centrally as:

```js
const result = await ae5e.crosshairs.show({
  source: token,
  type: "circle",
  distance: 20,
  limitMaxRange: 150,
  visual: { shape: "circle", style: "fantasy_01", size: 20, color: "red" },
  tracer: { shape: "line", style: "generic_01", size: 90, color: "red" }
});

if (result.cancelled) return;
const position = result.position;
```

### v0.4.1.1 compendium library foundation

AE5E now ships its first module-owned Compendium Pack hierarchy: **Action Effects 5E → Spells → Cantrips / Level 1–9**. Each spell level is a separate empty D&D5e `Item` pack with a stable internal identifier (`spells-cantrips`, `spells-level-1` … `spells-level-9`) ready for AE5E spell content. The v0.4.1 runtime behavior remains the validated baseline.

# Action Effects 5E

Action Effects 5E is a Foundry VTT v14.357+ module for reusable D&D5e automation infrastructure and premade items. Its reusable subsystems now include rules-aware movement/relationships, forced displacement, the Reaction Broker, and the Spell Modifier Engine.


### v0.4.1 final acceptance

The tested **revised3 runtime** is the final v0.4.1 runtime; finalization changes documentation only. Foundry acceptance completed with SME foundation **26/26**, live preserve-results damage retag **31/31**, interactive SME chooser **9/9**, remote non-GM routing **5/5** plus player-only indicator/audio confirmation, live save lifecycle **8/8**, and the preserved v0.3.30 regression suites **66/66** across foundation, native movement accounting, displacement, Follower-body disposition, Grapple-link obstruction, and Reaction Broker foundation sanity.

### v0.4.1 Spell Modifier Engine

The **Spell Modifier Engine (SME)** is AE5E's generic spell-interaction layer. A spell does not need to know that a specific feat, metamagic option, class feature, item, or effect exists. Instead, modifier sources declare a registered handler, SME discovers all legal opportunities on the caster, normalizes the live Midi workflow into stable semantic phases, aggregates optional choices, applies the selected handlers, and keeps one isolated session for that cast.

The first foundation exposes these semantic phases:

| SME phase | Primary live boundary | Purpose |
|---|---|---|
| `preTargeting` | `midi-qol.preTargetingV2` | Earliest spell-modifier eligibility, decision staging, and pre-targeting workflow work. |
| `targetingComplete` | `midi-qol.premades.postPreambleComplete` | Target set/preamble has settled. |
| `savesComplete` | `midi-qol.premades.postSavesComplete` | Save outcomes are available. |
| `beforeDamageRoll` | `midi-qol.preDamageRoll` | **Midi On-Use internal pass `preDamageRoll` = UI “Before Damage Roll”**; evaluated damage rolls do not yet exist, so type/resource decisions can be staged here. |
| `damageRollComplete` | Midi damage-roll-complete hooks | Evaluated damage rolls are now available for preserve-results metadata changes such as damage-type retagging. |
| `beforeDamageApplication` | `midi-qol.preTargetDamageApplication` | Per-target final damage application can be inspected/adjusted. |
| `workflowComplete` | Midi roll/workflow completion hooks | Terminal bookkeeping/cleanup. |

Modifier implementations register once with SME, for example:

```js
const ae5e = game.modules.get("action-effects-5e").api;

const unregister = ae5e.sme.registerModifier("my-module.example", {
  label: "Example Spell Modifier",
  phases: [ae5e.constants.SME_PHASES.PRE_TARGETING],
  mode: ae5e.constants.SME_MODIFIER_MODES.OPTIONAL,
  priority: 100,
  oncePerCast: true,
  requiresCapabilities: ["setActivity"],
  eligibility: async ({ context }) => context.facts.isSpell,
  apply: async ({ context }) => {
    // Use AE5E context methods; do not call CAT directly.
    return { applied: true };
  }
});
```

A caster feature then opts into that generic handler with a flag rather than changing the spell:

```js
flags: {
  "action-effects-5e": {
    spellModifier: {
      handler: "my-module.example",
      enabled: true
    }
  }
}
```

Declarations may live on the caster Actor, an embedded Item, or an ActiveEffect. A handler can provide multiple runtime options; SME groups those options when only one may be chosen, honors explicit conflict groups, applies automatic modifiers before optional choices, and presents all remaining optional opportunities for the current phase in **one** AE5E choice window.

Every cast receives a `SpellModifierSession`. It records phase visits, decisions, applications, conflicts, errors, and rollback callbacks without writing transient state onto the Actor or spell Item. When CAT's characterized workflow-state helpers are present, AE5E also mirrors the session snapshot at `workflow.cat.sme.actionEffects5e`; that mirror is isolated to the current workflow and is not the authoritative SME state.

CAT is behind `CatSpellAdapter`. Modifier handlers use methods on `SpellModifierContext` for Activity replacement, cast/save facts, synthetic Activities/Items, roll utilities, and per-target damage adjustment. If a handler declares a CAT capability that is unavailable, that handler is not offered. The generic SME registry/session/discovery layer itself does not require CAT.

Damage-roll mutation deliberately distinguishes **re-evaluation** from **preserving an existing result**. CAT 0.0.6 `rollUtils.getChangedDamageRoll()` constructs/evaluates a new DamageRoll, so SME exposes it only under the explicit semantic name `context.rebuildChangedDamageRoll(...)`. For mechanics that already have evaluated dice and only need to change damage-type metadata (the CPR Chaos Bolt pattern), use `context.retagDamageRollsPreservingResults(type, options)`: it keeps the same roll objects/totals/formulas, changes `roll.options.type`, and commits them with Midi `workflow.setDamageRolls()`. Live Foundry validation proved CAT `setActivity()` does not replace the already-running D&D5e Activity instance used by `rollDamage()`, so Transmuted Spell-style mechanics should stage the chosen type before damage is rolled and perform the physical preserve-results retag at `damageRollComplete`.

**v0.4.1 is the engine foundation.** It intentionally does not yet bundle bespoke implementations of Transmuted Spell, Empowered Spell, Careful Spell, Sculpt Spells, or other individual features. Those become small consumers of this subsystem rather than new spell-specific frameworks.

Foundry validation begins with:

```js
await ae5e.tests.runSpellModifierEngineFoundationTest();
```

Then, with CAT active and exactly one caster token controlled that owns a simple non-template damaging spell Activity:

```js
await ae5e.tests.runSpellModifierEngineLiveActivitySubstitutionTest();
```

The live gate creates disposable Actors/Tokens and an in-memory synthetic spell, performs a real Midi workflow with zero real caster resource consumption, verifies D&D5e evaluates the original damage roll once and SME then retags that exact evaluated roll without rerolling/replacing it, and removes its temporary documents/messages afterward.

### v0.3.30 CAT movement interoperability

v0.3.30 adds a bidirectional movement interoperability layer for **Coven's Automation Toolkit (CAT)** without transferring AE5E's rules ownership to CAT. CAT is recommended rather than required; AE5E remains usable when CAT is absent.

- **AE5E → CAT:** eligible single-token execution now goes through one `CatMovementAdapter`. When CAT 0.0.6 is active and exposes `cat.utils.tokenUtils.moveToken()`, the adapter uses it; otherwise it falls back to Foundry `TokenDocument.move()` before execution begins. AE5E never retries natively after a CAT execution exception, preventing duplicate movement after a possible partial CAT move.
- **AE5E retains semantics:** Push/Pull direction rules, large-token center geometry, creature/wall/grace handling, Grapple/link semantics, relationship movement, resource policy, and `MovementTransaction` metadata stay in AE5E. Relationship group movement remains on AE5E's coordinated `Scene.moveTokens()` path because CAT's single-token helper is not a replacement for atomic Leader/Follower movement.
- **Measured zero-cost movement remains AE5E-owned:** CAT 0.0.6's `catForce` action is intentionally `measure: false`, so it records 0 distance / 0 cost. AE5E therefore keeps `action-effects-5e.no-cost` (`measure: true`, cost 0) and passes that action through CAT for forced displacement. This preserves real traversed distance while consuming no ordinary movement.
- **CAT → AE5E:** external movement using CAT's unique `catForce` action is recognized as `agency: forced`, `resource: none`, with `interoperabilityProvider: "cat"`. AE5E does not invent Push/Pull type, source, or direction when CAT did not provide them. Ordinary CAT `walk` is not guessed as CAT-origin because after delegation it is indistinguishable from other native/API walk movement.
- Public diagnostics are available at `ae5e.interoperability.cat.getStatus()` / `getStats()`.

Primary Foundry validation:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.runCatMovementInteroperabilityTest();
```

The test creates and deletes its own disposable Actor/Token. It validates CAT execution, CAT `catForce` recognition, preservation of AE5E's measured/zero-cost action through CAT, semantic transaction metadata, and live wall constraint handling.

**Final v0.3.30 Foundry acceptance:** CAT interoperability **19/19 PASS**; non-owner player → GM CAT routing **PASS**; broad movement regression **48/48 PASS**; live forced-displacement accounting **21/21 PASS**; Reaction Broker foundation sanity **18/18 PASS**; revised Shove geometry **11/11 PASS**; live 2x2 and 3x3 large-token selector usability **PASS**; and the post-revision final displacement gate **9/9 + 21/21 PASS**. The finalized runtime is the tested revised1 implementation with release-documentation cleanup only.

### v0.3.29 Native movement accounting

v0.3.29 moves AE5E movement-resource accounting onto Foundry/D&D5e's native movement system. `TokenDocument.movementHistory` is the only movement-resource ledger; AE5E keeps semantic movement transactions but no parallel allowance/spent/remaining counter.

- Ordinary Leader movement keeps the movement action and native cost selected by Foundry/D&D5e.
- AE5E-generated forced displacement, Follower/passenger movement, orbit movement, and administrative rollback use a hidden **measured, zero-cost** movement action. Their path/distance remains real while their native movement cost is 0.
- Grapple-like trailing movement remains exactly as previously validated: the Follower enters the Leader's vacated spaces.
- A reusable final-cost modifier API is available for future rules. The planned 2024 Grapple drag cost is `native D&D5e cost + distance moved`, which preserves existing terrain/action costs before adding the Grapple surcharge.
- Stationary Grapple-orbit charging and the actual Grapple Activity remain deferred; v0.3.29 does not create fake Leader movement or a private accounting ledger.

Final Foundry acceptance passed across the movement-accounting foundation, live combat Leader/Follower accounting, forced Push/Pull and rollback accounting, disposition and Grapple-link geometry regressions, a Reaction Broker sanity regression, and a live final-cost modifier move. The final modifier acceptance recorded `5 native + 5 distance = 10` directly in Foundry's native movement history.

Foundry validation:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.runFoundationSmokeTest();
await ae5e.tests.runMovementAccountingTest(); // control exactly one token
```

The complete existing v0.3.28 Reaction Broker regression matrix remains applicable because the reaction subsystem is preserved unchanged.

### v0.3.28 Reaction Broker

v0.3.28 finalizes the first generic Reaction Broker foundation: one normalized `spellCast` event adapter, Activity-registered reaction handlers, frozen distance/Dexterity/d20 Reactor ordering, sequential controller-routed Broker windows, longest-connected-GM arbitration, nested transaction lineage, real Midi workflow gating, multiplayer authority recovery, and v0.3.27 active-Reactor indicator integration. v0.3.28 intentionally ships no real Counterspell handler; Counterspell and later reactions are consumers of this reusable infrastructure.

Primary Foundry validation commands:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.setupReactionBrokerTestScene();
await ae5e.tests.runReactionBrokerFoundationTest({ setup: false });
await ae5e.tests.runReactionBrokerInteractiveTest({ setup: false });
await ae5e.tests.runReactionBrokerMidiWorkflowGateTest({ setup: false, mode: "resume" });
await ae5e.tests.runReactionBrokerMidiWorkflowGateTest({ setup: false, mode: "abort" });
```

Multiplayer, last-GM disconnect/reconnect, nested, no-GM bypass, diagnostics, and cleanup procedures are documented in `docs/testing.md`.

Final Foundry acceptance passed across the foundation, normal/nested interactive Broker, live Midi resume/abort gates, ordinary multiplayer routing, last-GM recovery, active-controller reroute recovery, and no-GM bypass. See `docs/testing.md` and `CHANGELOG.md` for the recorded matrix.


## Required modules

- Midi-QOL
- Dynamic Active Effects (DAE)
- Socketlib
- libWrapper

## Recommended modules

- CAT (Coven's Automation Toolkit) — preferred low-level single-token movement executor/permission facade and the characterized utility provider used by CAT-capability-gated SME modifiers. AE5E keeps CAT behind dedicated adapters and does not make it a hard module dependency.
- Sequencer — used by the v0.3.27 selection/popup activity indicator. AE5E continues to function without it; only the advisory visual is omitted.

Chris's Premades and Gambit's Premades are **not dependencies**, but coexistence with both is a first-class design requirement.

## Build 0.3.27: selection/popup activity indicator

v0.3.27 adds reusable UI feedback for the periods when an AE5E workflow is waiting on one player's interaction. This is infrastructure for the upcoming Grapple activity and later spells/features rather than Grapple-specific rules logic.

- `ae5e.selection.acquire()` / `release()` provide reference-counted visual leases. Multiple simultaneous waits on one token share a single indicator.
- `ae5e.selection.withIndicator()` wraps any asynchronous selection flow in guaranteed `try/finally` cleanup.
- `ae5e.selection.waitForDialog()` wraps Foundry v14 `DialogV2.wait()` so button submission, cancel/X dismissal, and thrown errors all end the indicator.
- Selection leases have semantic roles. `originator` is the existing green `#18cc46`; `responder` currently uses temporary amber `#ff9f1c`; `external` uses blue `#2f9bff`. Role presentation is centralized so responder/external colors and sounds can be changed without rewriting activity logic.
- Originator and responder profiles use `notification01.ogg` at volume 1 for their private activation cue. The external profile remains deliberately silent until a distinct sound asset is supplied.
- `ae5e.externalPrompts` provides a conservative bridge for third-party ApplicationV2 prompts. The global render hook does not guess token ownership; a module-specific adapter must positively identify the actionable window and associated token before AE5E creates a blue external indicator. AE5E-owned dialogs are explicitly excluded.
- With Sequencer active, the effect is attached to the token and uses Sequencer's normal shared playback, so other connected users viewing the Scene can see that the player is making a choice.
- The visible indicator targets roughly 25-30% of the token footprint width and is positioned slightly inward from the upper-right token corner, producing the intended partial overlap. Token artwork scale is ignored. The preferred Eskie asset uses a larger `scaleToObject(0.68)` because the visible d20 occupies only part of that animation's transparent source canvas; the Foundry fallback remains at `0.28`.
- Preferred asset: raw `modules/eskie-effects/assets/UI/Ability_Check/D20/01/UI_Ability_Check_D20_01_Roll_Default_White.webm`, tinted `#18cc46`. AE5E intentionally bypasses Eskie's Sequencer database metadata so the persisted WebM loops seamlessly. If that physical asset is unavailable, the fallback is `icons/vtt-512.png`.
- The effect uses Sequencer `aboveInterface()` with a high effect `zIndex` so the waiting marker can render above Foundry token control/selection outlines.
- Sequencer is recommended rather than required; a missing Sequencer integration cannot interrupt the underlying rules workflow.
- The existing interactive Push destination selector now consumes this service: the marker is shown on the acting/Source token only while the player is choosing a Push destination. Automatic Pull and preselected Push directions do not create a waiting marker.

### v0.3.27 Foundry test command

Control exactly one token and run:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.runSelectionIndicatorTest();
```

The command first verifies reference-counted lease behavior automatically, then opens a real DialogV2 on the executing client. While it is open, inspect the token's upper-right corner and, when possible, inspect the same Scene from another connected client. Close the dialog with a button or the X; the indicator must disappear and the returned report must show zero active leases/tokens.

To inspect the new role language, control exactly two tokens in originator-first, responder-second order and run:

```js
await ae5e.tests.runSelectionIndicatorRolePairTest();
```

To verify the conservative third-party ApplicationV2 bridge, control exactly one token and run:

```js
await ae5e.tests.runExternalPromptBridgeTest();
```

The external test temporarily registers one exact-match adapter for its own simulated foreign dialog. The production bridge ships with no broad heuristic adapters; future Midi-QOL/CPR/GPS adapters will be added only after their prompt-to-token association can be identified reliably in Foundry.

## Build 0.3.24: relative creature semantics

v0.3.24 keeps the validated v0.3.23 orbit-shell geometry intact and establishes the creature-relationship semantics needed before physical Grapple-link obstruction is added:

- `RelativeTokenRelationshipService` resolves a third creature relative to an explicitly selected reference creature. Friendly/Hostile tokens on the same side are nonhostile; opposing Friendly/Hostile sides are hostile; Neutral and Secret are universally nonhostile.
- Geometry channels now distinguish `follower-body` from the reserved future `grapple-link` channel. Follower-body collision uses the Follower as the reference creature. Grapple-link/appendage collision will use the Leader/Grappler as the reference when that validator is added.
- Orbit preflight separates environment obstruction from creature obstruction. Walls/surfaces remain authoritative, while hostile Follower-body intersections hard-block and nonhostile creature intersections may proceed.
- The former same-side endpoint grace is generalized to nonhostile endpoint grace. Neutral and Secret occupied orbit endpoints can therefore enter the existing 3.5-second grace window and roll back to the complete last legal relationship state if the overlap persists.
- New `nonhostileEndpointPolicy` / `nonhostileEndpointGraceMs` names are persisted alongside the legacy `alliedEndpointPolicy` / `alliedEndpointGraceMs` aliases during the v0.3.x migration.
- Rotation diagnostics now expose structured follower-body obstruction information and `pendingNonhostileOverlaps` while retaining `pendingAlliedOverlaps` as a legacy diagnostics alias.
- Foundry-only regression tooling adds `await ae5e.tests.runFollowerBodyDispositionMatrix()`. The command first validates the full Friendly/Hostile/Neutral/Secret resolver matrix and geometry-channel reference ownership without touching the Scene, then configures and validates the six-token Leader/Follower/Ally/Enemy/Neutral/Secret follower-body fixture automatically.

Physical Grapple-link sweep/final-corridor collision is intentionally deferred to the next development step so it can consume these semantics without modifying the validated orbit geometry.

### v0.3.24 Foundry test command

After loading the module in the dedicated test Scene, run:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.runFollowerBodyDispositionMatrix();
```

A full pass restores the six fixture tokens. A failure leaves the failing fixture and test relationship in place for inspection. Project regression testing is performed in Foundry rather than through an external Node test command.

## Build 0.3.23: dynamic grapple geometry

v0.3.23 keeps the live-validated v0.3.22 forced-movement behavior and replaces the old 1x1/fixed-angle Grapple geometry assumptions with a footprint-aware coordination layer:

- Grapple-like fixtures now use `attachmentMode: "grappleFollower"`. Actual TokenDocument `width` and `height` drive geometry; creature-size labels remain a future Grapple-rules concern.
- `breakDistance` is the maximum legal relationship separation. `coordinationDistance` is the planar band normal dragging and orbiting preserve. A 10-foot-reach relationship can therefore be coordinated at either 5 or 10 feet.
- Orbit shells are generated dynamically for square grids from leader footprint, follower footprint, and coordination distance. Integer, fractional, and rectangular token footprints are supported by the geometry service.
- One qualifying Shift+wheel **or** Ctrl+wheel rotation update advances the follower exactly one adjacent orbit-shell position clockwise/counterclockwise. AE5E rewrites the pending leader rotation to the exact bearing delta represented by that physical shell step, so large/extended shells use variable angles rather than forcing 45 degrees.
- Shift and Ctrl are equivalent while the controlled token is an active AE5E orbit leader; Foundry's native fast/slow requested magnitude is ignored except for direction and diagnostics. Outside an active AE5E orbit relationship, normal Foundry controls are untouched.
- Rapid wheel input uses predicted leader/follower state for planning but resolves actual follower movement serially. A failed step discards later speculative input and restores exact captured state.
- Grapple-follow translation is footprint-aware. Each leader grid step selects a legal trailing shell position opposite the leader's movement direction. For the ordinary 1x1/5-foot case, this still reduces to the follower entering the leader's vacated square.
- Legal external forced movement can re-anchor `coordinationDistance` to a new non-zero planar band while still inside `breakDistance`. Movement beyond `breakDistance` detaches without snapback, exactly as validated in v0.3.22.
- Existing wall/collision handling, atomic rollback, follower manual-movement lock, teleport policies, allied occupied-endpoint grace, and CPR/GPS-safe namespacing remain in place.

### Grapple rules boundary

The generic relationship layer intentionally does not decide creature-size eligibility, Grappled/Prone effects, escape checks, or action economy. The later Grapple adapter will provide those rules. The agreed rules state remains: Prone alone does not break a grapple; a Grappled+Prone target cannot stand while Grappled keeps its Speed at 0; external forced movement resolves normally and only breaks the relationship when final separation exceeds the grapple's maximum reach.

### v0.3.23 development geometry tools

The test facade now exposes the same production geometry/orbit pipeline used by live relationship movement:

```js
await ae5e.tests.inspectRelationshipGeometry();
await ae5e.tests.inspectOrbitShell();
await ae5e.tests.validateRelationshipGeometry();
await ae5e.tests.showOrbitDebug();
ae5e.tests.clearOrbitDebug();
await ae5e.tests.orbitClockwise();
await ae5e.tests.orbitCounterclockwise();
```

`showOrbitDebug()` creates only temporary canvas graphics; it does not create Scene Drawings, Tiles, Regions, or persistent flags.

A configurable grapple-like fixture can be created after controlling Leader first and Follower second:

```js
await ae5e.tests.createGrappleMovementTestRelationshipFromControlledTokens({
  breakDistance: 10,
  coordinationDistance: 10
});
```

Place the tokens on the requested coordination band before creation. The harness rejects a requested coordination distance greater than the break distance or an obviously out-of-range fixture.

### v0.2.11 selective simultaneous external coordination

AE5E now uses a narrow libWrapper integration at Foundry v14's public `Scene.moveTokens()` boundary. The wrapper performs only indexed relationship lookups for normal calls and changes nothing unless exactly one token instruction is moving the leader of an active relationship whose `coordinationPolicy` is `coordinated`. Compatible planar/elevation API, undo, and paste movement is converted into one leader+follower movement operation before animation begins, preserving `adjacentFollower` trailing, elevation, checkpoints, wall/surface preflight, rollback, and transient movement identity. GM callers are augmented in-place at the API boundary; player callers are routed through the existing GM-authorized Socketlib group-movement handler.

The integration deliberately falls back to v0.2.10 terminal post-sync when safe pre-coordination cannot be guaranteed: teleports, resize/mixed token-update payloads, multi-token external calls, unavailable followers, `coordinationPolicy: "postSync"`, or Socketlib/GM handoff failure. AE5E-generated movement is tagged and bypasses the wrapper, preventing recursion. A public `relationships.moveGroup()` API and `relationships.waitForMovementSettled()` helper are also available for future consumers and deterministic live tests.

### v0.2.10 terminal-subpath external synchronization

Foundry splits an external/API route at explicit checkpoints into multiple movement operations that share a stable `subpathId`. AE5E now waits for the **terminal** operation before synchronizing followers. Earlier checkpoint legs are ignored even when they already expose future `pending.waypoints`. On the terminal operation, AE5E reconstructs the complete route from Foundry's current-subpath history plus the terminal passed waypoints, then performs the existing logical + animation settlement checks before exact-position validation. This prevents the first checkpoint from racing the later continuation and keeps `adjacentFollower` one planar space behind across API-driven multi-turn routes. Primary-GM receipts use the same terminal full-subpath reconstruction so non-GM synchronization never trusts a client-supplied path.

### v0.2.9 animation-settled external synchronization

Live Foundry 14.365 timing showed that `TokenMovementOperation.finished` can resolve while the public TokenDocument and rendered token are still interpolating at their old coordinates. The movement's authoritative destination is already committed, but exact `document.x`, `document.y`, and `document.elevation` values do not settle until `movement.animation.ended` resolves. AE5E therefore waits for logical movement completion **and**, when present, animation settlement before exact-position validation, external follower synchronization, or follower-teleport detachment. Synthetic/API contexts without an animation promise retain the existing completion/fallback behavior.

### v0.2.8 external movement completion and elevation correction

v0.2.8 introduced stable-subpath deduplication, full-route destination validation, elevation-interpolation collapsing, and waiting for `TokenMovementOperation.finished`. Live testing subsequently showed that `finished` alone does not guarantee the live TokenDocument has reached its final animated coordinates; v0.2.9 completes that lifecycle handling by also waiting for `movement.animation.ended` when available.

For `adjacentFollower`, consecutive elevation interpolation points at the same x/y coordinate are collapsed into one planar space before applying the one-space trailing offset. A leader that moves one square while rising therefore leaves the follower in the leader's vacated x/y/elevation position instead of consuming the trailing offset on an intermediate elevation-only point. Pure vertical movement preserves the follower's planar offset while applying the leader's elevation delta when `followElevation` is enabled.

### v0.2.7 follower entry-anchor correction

Foundry computes a direct path between checkpoints. For an `adjacentFollower`, the first synthetic trailing destination is the leader's vacated origin. If that destination is only a non-checkpoint waypoint, a follower starting to the side of the leader can skip the vacated origin and cut diagonally toward a later checkpoint. AE5E now marks the leader's vacated origin as the follower's first checkpoint, then preserves the leader's declared checkpoints and the follower's terminal trailing checkpoint. This makes the follower enter the leader's starting square first and then trace the leader's route one space behind.

### v0.2.6 checkpoint and continuation correction

Foundry v14 processes a user-authored route with explicit checkpoints as multiple movement operations. At each checkpoint the current `movement.id` can change, while waypoint `subpathId` continues to identify the original movement instruction. The current leg is exposed through `movement.passed.waypoints` and later legs through `movement.pending.waypoints`. AE5E now reconstructs the full intercepted route from both collections and resolves transient internal movement metadata through either the current movement ID or the stable subpath ID. This preserves L-shaped and other multi-checkpoint routes and prevents Foundry continuation stages from being mistaken for new manual relationship movement.



### v0.2.5 trailing and teleport correction

`adjacentFollower` now represents a dragged/trailing relationship instead of behaving like `rigidOffset`. For a leader route `L0 -> L1 -> L2`, the follower route is `L0 -> L1`, so the follower occupies the space the leader just vacated. On a gridded Scene, AE5E expands straight or multi-waypoint segments through Foundry's public grid `getDirectPath()` API before dropping the leader's final space; this keeps a follower one grid space behind even when the leader is dragged several spaces in one operation. A one-square leader move therefore places the follower directly into the leader's starting square. `rigidOffset` remains available for mounts, passengers, carried objects, and other relationships that should mirror movement. Teleport-follow deliberately preserves offset instead of using the trailing route.

Follower teleports are symmetric with leader detach behavior: the teleport itself is not blocked by `followerCanSelfMove: false`, and after the completed movement the active GM validates the teleport and removes the follower's relationship. Primary-GM movement receipts are now indexed for both leaders and followers so this also works for non-GM players without trusting a client-supplied detach request.

Movement classification no longer reads Foundry's deprecated `DatabaseUpdateOperation#teleport` accessor. Teleports are detected from AE5E metadata, explicit own caller data, movement methods, and Foundry movement actions such as `blink`.

### v0.2.4 terminal-checkpoint correction

Live Foundry 14.365 testing demonstrated that programmatic `Scene.moveTokens()` relationship movement can resolve `false` when the generated terminal waypoint omits an explicit checkpoint, even though the final waypoint is terminal. Action Effects 5E now explicitly sets `checkpoint: true` on the final leader and follower waypoint for coordinated movement, follower synchronization, and rollback destinations. Intermediate waypoint checkpoint state is preserved. The fix does not inject `action` or `level`; those continue to use Foundry's normal movement state.

### v0.2.3 replacement-movement scheduling correction

Manual leader movement is cancelled in `preMoveToken` and replaced with one coordinated `Scene.moveTokens()` operation. The replacement is now deferred to the **next event-loop task** rather than a microtask. This gives Foundry time to completely unwind the rejected original movement workflow before Action Effects 5E starts a new movement document update. External follower synchronization uses the same next-task boundary to avoid nested movement updates from inside `moveToken`.

### v0.2.2 movement identity correction

Foundry v14 accepts explicit IDs on `Scene.moveTokens()` instructions, but those IDs must be valid Foundry UIDs. Action Effects 5E therefore uses opaque 16-character alphanumeric movement IDs and keeps module-specific semantic metadata in its transient movement-context registry. This prevents recursive relationship handling without placing namespaced strings into Foundry's validated movement-ID field.

### Current attachment scope

`adjacentFollower` remains the legacy trailing mode used by existing relationship tests/integrations. `grappleFollower` is the v0.3.23 footprint-aware mode for Grapple-style coordination. `rigidOffset`, `passenger`, and `anchoredFollower` retain their existing fixed-offset semantics.

The dynamic orbit system currently targets square Scene grids. Core token occupancy is not globally treated as an endpoint collision; Foundry remains authoritative for movement constraints, while the existing allied endpoint grace rule handles successful same-side orbit overlap.

## Installation for development

Place the repository at:

```text
Data/modules/action-effects-5e
```

Enable the required modules and then enable Action Effects 5E. Restart Foundry after replacing module files.

## Console API

```js
const ae5e = game.modules.get("action-effects-5e").api;
```

Run the non-destructive foundation test:

```js
await ae5e.tests.runFoundationSmokeTest();
```

Future consumers can request GM-authorized relationship movement without constructing Foundry movement instructions themselves:

```js
await ae5e.relationships.moveGroup({
  leaderUuid: leader.uuid,
  destination: {
    x: leader.x + canvas.grid.size,
    y: leader.y,
    elevation: leader.elevation,
    action: "walk",
    checkpoint: true
  }
});
```

For live tests, wait for the relationship movement/animation state rather than guessing a timeout:

```js
await ae5e.relationships.waitForMovementSettled({ leaderUuid: leader.uuid });
```

## Coordinated movement test

1. Place two tokens on the same Scene.
2. Control exactly two tokens. The first entry in the controlled-token collection becomes the leader and the second becomes the follower.
3. Run:

```js
await ae5e.tests.createTestRelationshipFromControlledTokens();
```

The harness releases the follower and leaves the leader controlled.

4. Drag or keyboard-move the leader one square. The `adjacentFollower` should move into the square the leader just vacated.
5. Try to drag the follower manually. The move should be rejected with a warning.
6. Inspect either controlled token:

```js
ae5e.tests.inspectControlledRelationship();
```

7. Remove the test relationship:

```js
await ae5e.tests.removeTestRelationships();
```

Inspect runtime state:

```js
ae5e.movement.getStats();
ae5e.relationships.getStats();
ae5e.relationships.getMovementStats();
ae5e.relationships.list();
ae5e.compatibility.getStatus();
```

## Performance principles

- One central movement hook set, not one hook per item.
- Relationship movement consumers are indexed only for tokens that currently participate in a relationship.
- A token with no relationship or registered movement consumer exits after inexpensive map lookups.
- No canvas-wide token, Item, Active Effect, or Region scans occur during normal movement.
- No polling and no animation-frame document writes.
- One coordinated `Scene.moveTokens()` call moves the active relationship group.
- Scene flags are written only when relationships are created, removed, detached, or cleaned up.
- Detailed collision work runs only for actual followers.

## Original implementation policy

Action Effects 5E is an independent implementation based on D&D5e rules and Foundry's public APIs. CPR and GPS may be studied for compatibility and high-level architectural lessons, but their code is not copied or required.


## Forced displacement semantics

Push supports `AWAY` and `STRAIGHT_AWAY`. Pull is direct-line only: `displacement.pull()` always uses `STRAIGHT_TOWARD`, resolves the direction automatically, and never opens the destination selector.

In the v0.3.30 revised Shove geometry, `AWAY` is a fixed directional fan rather than a fixed ray. The fan is calculated once from the original Source-to-Target geometry, but a multi-step Push may change between directions inside that fan at each grid step. The distance is an up-to maximum for `AWAY`: a 10-foot Push may intentionally stop after 5 feet. For a Source directly south of a Target, an unobstructed 10-foot `AWAY` selector therefore offers the three 5-foot destinations plus five 10-foot destinations. Large/Huge targets retain faint full-footprint destination ghosts and use separate smaller bright-green edge/corner handles so overlapping choices remain clickable.

### Grapple-link obstruction (0.3.26)

Grapple-like relationships can opt into `linkObstructionPolicy: "grapple"`. Orbital movement then evaluates Follower-body geometry independently from the physical Grapple link. The Follower body resolves third-party hostility relative to the Follower; the Grapple link resolves it relative to the Leader/Grappler. Hostile creatures and movement walls hard-block the link sweep. Nonhostile creatures may be swept through, but a nonhostile creature occupying the final link starts the same 3.5-second grace window used by relationship body overlap and rolls the entire last legal orbit state back if it remains unresolved. The Foundry regression also verifies sweep-only creature handling and the precedence rule that when one third-party creature is nonhostile to the Follower body but hostile to the Leader-relative Grapple link, the hard link conflict wins.

Foundry validation command:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.runGrappleLinkObstructionTest();
```


### v0.3.27 external-prompt isolation regression

Control exactly one token and run `await game.modules.get("action-effects-5e").api.tests.runExternalPromptIsolationTest();` to verify fail-closed external prompt classification, duplicate prevention, shared external leases, and cleanup.


### 0.3.29 Foundry v14.365 validation note

Foundry v14.365 live validation showed that internal movement actions must use an explicit `canSelect: () => false` function for deterministic hidden-selection behavior. The movement-accounting test harness also measures action-aware cost through the rendered Token API.

### Damage-type changes in live spell workflows
For effects such as Transmuted Spell, SME distinguishes the **decision point** from the **physical roll mutation point**. A feature may choose/store the new damage type before damage is rolled, then use `retagDamageRollsPreservingResults()` at `damageRollComplete` to change only the evaluated rolls' type metadata. CAT `setActivity()` remains exposed for workflow metadata substitution, but AE5E does not assume it replaces an already-running D&D5e Activity instance.

## Ongoing effect actions (v0.4.1.4)

AE5E ongoing effects can grant an affected Actor a dedicated follow-up Item cloned from a stable compendium UUID. The ActiveEffect is the lifecycle owner: it stores the granted Item UUID, while the cloned Item stores the exact parent ActiveEffect UUID and source template UUID. This supports spell-specific actions such as **Hold Person — Repeat Save**, **Entangle — Escape**, or **Burning — Stop-Drop-and-Roll** without hard-coding their presentation into runtime JavaScript.

While Combat is active, an effect may declare `turnStart` or `turnEnd` timing. Mandatory actions prompt the controlling player and auto-proceed after ten seconds if unanswered; optional actions never auto-proceed and are offered again on the next applicable turn while the effect remains. Outside Combat, AE5E does not invent a six-second clock: the granted Item remains available and the GM decides when the player should use it. If Combat ends with unresolved ongoing effects, AE5E posts a public summary chat card for the table.

v0.4.1.4 adds two optional presentation/eligibility controls to the declaration stored at `flags.action-effects-5e.ongoingAction`:

- `indicatorRole`: one of the semantic AE5E selection-indicator roles (`originator`, `responder`, or `external`). Omitting it preserves the existing green/originator presentation.
- `suppressPromptWhenUnusable`: when `true`, AE5E checks the granted D&D5e Activity before showing the turn prompt. A prompt is suppressed if the Activity itself reports that it cannot be used or its configured activation resource is unavailable. The granted Item remains on the Actor for normal lifecycle cleanup/manual use.

The module includes a GM-only **AE5E Administrative** Item compendium under the **Action Effects 5E** compendium hierarchy. It is intended for dedicated spell/effect follow-up templates whose names, artwork, descriptions, Activities, and HUD presentation can be edited independently of AE5E runtime code.

## GM-authoritative Region persistence (v0.4.1.4)

`ae5e.regions` is a deliberately narrow persistence bridge for Item/activity macros that need to create Scene Regions from player-driven placement. The caller owns geometry and all feature-specific Region behavior data; AE5E routes document creation/deletion to the primary active GM and stamps only generic AE5E ownership/lifecycle metadata.

```js
const ae5e = game.modules.get("action-effects-5e").api;

const created = await ae5e.regions.create({
  name: "Example Region",
  shapes: [{ type: "rectangle", x: 1000, y: 1000, width: 400, height: 400 }],
  behaviors: []
}, {
  scene: canvas.scene,
  metadata: { source: "example-item-macro" }
});

await ae5e.regions.delete(created.regionUuid);
```

The delete API only accepts Regions carrying AE5E's authority ownership flag; it does not provide a generic remote-delete primitive for unrelated Scene Regions.

## Animation ownership and Automated Animations (v0.4.1.5)

AE5E can claim animation ownership for an Item or Active Effect without globally disabling Automated Animations. Store the policy on the owning document:

```js
flags.action-effects-5e.animation.automatedAnimations = "suppress"
```

When Automated Animations raises `AutomatedAnimations-WorkflowStart`, AE5E resolves the effective policy and sets `clonedData.stopWorkflow = true` when the workflow belongs to a suppressing owner. AE5E uses AA's `clonedData.deferrals` mechanism when an origin UUID must be resolved asynchronously. Automated Animations remains optional and no global AA setting is changed.

Ownership follows effect provenance rather than the global status definition. An Item-owned Active Effect can inherit the Item policy, an embedded Active Effect can inherit from a resolvable origin chain, and a child/native status can inherit from a same-Actor suppressing Active Effect that owns the same status ID. For example, an `Entangled` Active Effect carrying native `restrained` can suppress both its own AA animation and a related `Restrained` Active Effect animation while an unrelated Restrained on another Actor remains available to AA.

When AE5E or an Item macro explicitly constructs child effect data, the public helper can stamp the exact policy onto that child instead of relying on inference:

```js
const ae5e = game.modules.get("action-effects-5e").api;
const childData = { name: "Child Effect", flags: {} };
ae5e.animationOwnership.inheritAutomatedAnimationsPolicy(parentEffect, childData);
```

Diagnostics:

```js
ae5e.animationOwnership.resolveAutomatedAnimationsPolicy(effect);
ae5e.animationOwnership.getStats();
ae5e.animationOwnership.getAutomatedAnimationsStatus();
ae5e.interoperability.automatedAnimations.getStats();
```
