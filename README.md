# Action Effects 5E

Action Effects 5E is a Foundry VTT v14.357+ module for reusable D&D5e automation infrastructure and premade items. Its first subsystem is a low-overhead movement, spatial-event, and rules-aware token relationship framework.

### v0.3.28 Reaction Broker

The module now includes the first generic Reaction Broker foundation: one normalized `spellCast` event adapter, Activity-registered reaction handlers, frozen distance/Dexterity/d20 Reactor ordering, sequential controller-routed Broker windows, longest-connected-GM arbitration, nested transaction lineage, and v0.3.27 active-Reactor indicator integration. v0.3.28 intentionally ships no real Counterspell handler; use the Foundry-only Reaction Broker test harness before building reaction features on top of it.

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


## Required modules

- Midi-QOL
- Dynamic Active Effects (DAE)
- Socketlib
- libWrapper

## Recommended modules

- Sequencer — used by the v0.3.27 selection/popup activity indicator. AE5E continues to function without it; only the advisory visual is omitted.

Chris's Premades and Gambit's Premades are **not dependencies**, but coexistence with both is a first-class design requirement.

## Build 0.3.27: selection/popup activity indicator

v0.3.27 adds reusable UI feedback for the periods when an AE5E workflow is waiting on one player's interaction. This is infrastructure for the upcoming Grapple activity and later spells/features rather than Grapple-specific rules logic.

- `ae5e.selection.acquire()` / `release()` provide reference-counted visual leases. Multiple simultaneous waits on one token share a single indicator.
- `ae5e.selection.withIndicator()` wraps any asynchronous selection flow in guaranteed `try/finally` cleanup.
- `ae5e.selection.waitForDialog()` wraps Foundry v14 `DialogV2.wait()` so button submission, cancel/X dismissal, and thrown errors all end the indicator.
- Selection leases have semantic roles. `originator` is the existing green `#18cc46`; `responder` currently uses temporary amber `#ff9f1c`; `external` uses blue `#2f9bff`. Role presentation is centralized so responder/external colors and sounds can be changed without rewriting activity logic.
- Only the originator profile currently has an assigned audio cue (`notification01.ogg` at volume 1). Responder and external profiles are deliberately silent until distinct sound assets are supplied.
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

### Grapple-link obstruction (0.3.26)

Grapple-like relationships can opt into `linkObstructionPolicy: "grapple"`. Orbital movement then evaluates Follower-body geometry independently from the physical Grapple link. The Follower body resolves third-party hostility relative to the Follower; the Grapple link resolves it relative to the Leader/Grappler. Hostile creatures and movement walls hard-block the link sweep. Nonhostile creatures may be swept through, but a nonhostile creature occupying the final link starts the same 3.5-second grace window used by relationship body overlap and rolls the entire last legal orbit state back if it remains unresolved. The Foundry regression also verifies sweep-only creature handling and the precedence rule that when one third-party creature is nonhostile to the Follower body but hostile to the Leader-relative Grapple link, the hard link conflict wins.

Foundry validation command:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.runGrappleLinkObstructionTest();
```


### v0.3.27 external-prompt isolation regression

Control exactly one token and run `await game.modules.get("action-effects-5e").api.tests.runExternalPromptIsolationTest();` to verify fail-closed external prompt classification, duplicate prevention, shared external leases, and cleanup.
