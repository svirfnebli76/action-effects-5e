# Action Effects 5E testing

## Project test policy

Action Effects 5E behavioral and regression testing is performed **inside Foundry VTT**. Do not use an external `npm test` run as a release gate for this project. The repository may retain older Node-oriented development files for history/reference, but current validation is based on the live Foundry APIs, hooks, movement pipeline, Socketlib authority, token documents, canvas geometry, and installed-module coexistence that the production module actually uses.

v0.3.24 adds a built-in Foundry regression harness for relative creature semantics:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.runFollowerBodyDispositionMatrix();
```

The harness configures the exact `Leader`, `Follower`, `Ally`, `Enemy`, `Neutral`, and `Secret` fixture, runs eight Follower-body occupancy cases, waits through the 3.5-second nonhostile endpoint grace where required, verifies rollback and queue settlement, restores all six tokens on a complete pass, and leaves a failed fixture visible for inspection.

## Startup check

After replacing module files and restarting Foundry, v0.3.24 should report:

```text
Action Effects 5E | Registered 9 Socketlib handlers.
Action Effects 5E | v0.3.24 dependencies validated.
Action Effects 5E | Relationship rotation service ready.
Action Effects 5E | Foundation ready.
```

Run the non-destructive smoke test:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.runFoundationSmokeTest();
```

## v0.3.25 forced-displacement foundation

Run the complete Foundry-only displacement regression:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.runDisplacementFoundationTest();
```

The harness resolves the exact `Leader`, `Follower`, `Ally`, `Enemy`, `Neutral`, and `Secret` tokens, rejects unrelated Leader/Follower relationships, removes only AE5E test-harness relationships, snapshots the fixture, and uses a Foundry v14 movement action configured with `teleport: true` for deterministic test positioning. It does **not** use the deprecated database `teleport` update option. Every fixture move verifies the resulting TokenDocument coordinates before behavioral assertions begin.

A normal pass validates nine groups:

1. 1x1 direction semantics: Push `AWAY` = NE/E/SE, Push `STRAIGHT_AWAY` = E, and Pull `STRAIGHT_TOWARD` = W. The Pull execution test calls `displacement.pull()` without a direction key to verify automatic direct-line resolution.
2. Center-relative Large/Huge-style Source geometry: the selected 2x2 and 3x3 fixtures expose N/NE/E/SE for Push `AWAY`.
3. Actual Pull execution and Target-relative hostile collision.
4. Push hard-block when the destination creature is hostile relative to the displaced Target, regardless of Source disposition.
5. Forced movement transaction metadata plus a 10-foot Push ending in nonhostile occupancy; after 3.5 seconds the Target must return only to the last clear 5-foot step.
6. If the nonhostile creature causing an occupied endpoint moves away during grace, the pending rollback clears immediately and the displaced Target remains in place.
7. Neutral and Secret endpoint candidates are soft/selectable.
8. A 10-foot Push may pass through a nonhostile creature at the first step and end clear, exercising the narrow D&D5e occupied-space bypass.
9. A 10-foot Push partially stops at 5 feet when the next step is blocked by the harness's diagnostic wall.

A complete pass removes the diagnostic wall, clears displacement grace, restores the six token states, and prints a large PASS banner/table/full JSON. A failure leaves the fixture visible for inspection.

Interactive selector smoke test: control exactly two tokens in order, Source first and Target second, then run:

```js
await ae5e.tests.previewDisplacementFromControlledTokens({
  type: ae5e.constants.DISPLACEMENT_TYPES.PUSH,
  directionConstraint: ae5e.constants.DISPLACEMENT_DIRECTION_CONSTRAINTS.AWAY,
  distance: 5
});
```

Expected overlay: green = clear; yellow `~` = nonhostile occupied endpoint; orange = partial distance (`actual/requested`); red `X` = hard blocked and not selectable. Press Esc to cancel.

## v0.3.27 selection-indicator and external-prompt regressions

After the interactive indicator tests, control exactly one token and run the automated external-prompt isolation regression:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.runExternalPromptIsolationTest();
```

This is deliberately non-interactive. It exercises the external bridge's fail-closed classification path without broadcasting fake `renderApplicationV2` events to unrelated installed modules. It verifies that ordinary/unrecognized applications remain inert, tokenless adapter matches are ignored, adapter exceptions do not create indicators, AE5E-owned dialogs cannot be claimed by an external adapter, a recognized application's re-render cannot duplicate its lease, two recognized prompts for the same token share one blue visual, closing one preserves the remaining lease, and closing the final prompt returns both bridge and selection-indicator counts to zero.

A complete pass reports `PASS`. The test suppresses notification audio and cleans up all temporary adapters/applications in `finally`.

## Creating a grapple geometry fixture

Control exactly two tokens, Leader first and Follower second, then run:

```js
const ae5e = game.modules.get("action-effects-5e").api;

await ae5e.tests.createGrappleMovementTestRelationshipFromControlledTokens({
  breakDistance: 5,
  coordinationDistance: 5
});
```

For extended reach, first place the tokens on the requested band and use, for example:

```js
await ae5e.tests.createGrappleMovementTestRelationshipFromControlledTokens({
  breakDistance: 10,
  coordinationDistance: 10
});
```

The fixture uses `grappleFollower`, `followerCanSelfMove: false`, `forcedLeaderMovementPolicy: "independent"`, `collisionPolicy: "stopGroup"`, and `rotationPolicy: "orbitFollower"`.

Remove test relationships with:

```js
await ae5e.tests.removeTestRelationships();
```

## Geometry inspection before movement

With the Leader controlled (or pass `{ relationshipId }` explicitly):

```js
await ae5e.tests.inspectRelationshipGeometry();
await ae5e.tests.inspectOrbitShell();
await ae5e.tests.validateRelationshipGeometry();
```

`validateRelationshipGeometry()` should report all checks passed, including unique anchors, no Leader/Follower footprint overlap, clockwise/counterclockwise inverse traversal, and full circuit totals of +360/-360 degrees.

Show the temporary numbered shell overlay:

```js
await ae5e.tests.showOrbitDebug();
```

Clear it with:

```js
ae5e.tests.clearOrbitDebug();
```

The overlay is canvas-only and must not create persistent Drawings, Tiles, Regions, or Scene flags.

## v0.3.24 follower-body disposition matrix

Run:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.runFollowerBodyDispositionMatrix();
```

Expected Follower-relative body outcomes:

```text
Leader HOSTILE / Follower FRIENDLY
  Ally    Hostile  -> HARD
  Enemy   Friendly -> SOFT -> grace -> rollback if overlap persists
  Neutral Neutral  -> SOFT -> grace -> rollback if overlap persists
  Secret  Secret   -> SOFT -> grace -> rollback if overlap persists

Leader FRIENDLY / Follower HOSTILE
  Ally    Hostile  -> SOFT -> grace -> rollback if overlap persists
  Enemy   Friendly -> HARD
  Neutral Neutral  -> SOFT -> grace -> rollback if overlap persists
  Secret  Secret   -> SOFT -> grace -> rollback if overlap persists
```

Before modifying the Scene, the same command runs a 4x4 resolver matrix over Friendly, Hostile, Neutral, and Secret in both reference directions. It also verifies geometry ownership directly: `follower-body` resolves relative to the Follower and the reserved `grapple-link` channel resolves relative to the Leader/Grappler. In v0.3.25 the physical fixture setup uses an exact Foundry movement-action teleport and asserts every resulting coordinate, preventing ordinary token blocking from corrupting the matrix setup.

Leader disposition is deliberately varied as a control. Because this matrix validates **Follower-body** geometry, the third creature is classified relative to the Follower. Neutral and Secret must remain nonhostile regardless of either participant's Friendly/Hostile side. The later physical `grapple-link` collision matrix will use the Leader/Grappler as its reference.

Hard cases must expose `lastDecision.obstruction.geometryChannel === "follower-body"` and `reasonCode === "hostile-creature"`. Soft cases must expose a nonhostile endpoint conflict, `pendingNonhostileOverlaps >= 1`, then restore the complete prior legal Follower position and matching Leader rotation after grace expiry.

## v0.3.23 rotation-input matrix

For every geometry below, test both clockwise and counterclockwise directions.

1. Use Shift+mouse-wheel for one notch/update. Follower must advance exactly one adjacent shell position and Leader must rotate by the exact bearing delta for that step.
2. Reset and use Ctrl+mouse-wheel in the same direction. It must produce the same one-shell-position result even if Foundry's native requested rotation magnitude differs.
3. Inspect:

```js
ae5e.relationships.getRotationStats();
await ae5e.tests.inspectRelationshipGeometry();
```

The diagnostics should retain the native requested rotation/modifier while showing `orbitStepsRequested: 1`, `orbitStepsCompleted: 1`, exact shell indices, calculated leader delta, and committed leader rotation.
4. Rapidly scroll several notches. Follower movement must serialize through each adjacent shell position; no step may be skipped merely because native rotation updates arrived quickly.
5. Reverse direction and confirm each reverse input walks exactly one shell position back.
6. Complete a full circuit. Follower must return exactly to its starting anchor and cumulative Leader rotation must represent one full 360-degree revolution without drift.

Direct service tests can isolate geometry from mouse input:

```js
await ae5e.tests.orbitClockwise();
await ae5e.tests.orbitCounterclockwise();
```

These call the same planner and GM-authorized resolver used by wheel control.

## Size/footprint live matrix

Use actual Token width/height, not creature-size names. Recommended minimum matrix:

```text
Leader   Follower   coordinationDistance
0.5x0.5  0.5x0.5    5
0.5x0.5  1x1        5
1x1      0.5x0.5    5
1x1      1x1        5
2x2      1x1        5
1x1      2x2        5
2x2      2x2        5
2x2      3x3        5
3x3      2x2        5
4x4      3x3        5
1x1      1x1       10
2x2      1x1       10
1x1      2x2       10
2x2      3x3       10
1x1      1x1       15
```

For each configuration:

- inspect/validate the shell;
- rotate at least one full circuit in both directions;
- test a wall on one adjacent shell step and verify exact Leader/Follower rollback;
- test normal Leader translation in multiple directions and around a corner;
- confirm the Follower remains on the configured planar coordination band;
- test follower-manual-movement lock.

Fractional Tiny tokens deserve extra visual scrutiny because Foundry occupied-grid-space measurement can map more than one sub-grid token location to the same 5-foot grid cell.

## Extended-reach/re-anchoring tests

Create a 10-foot relationship at the outer band:

```js
await ae5e.tests.createGrappleMovementTestRelationshipFromControlledTokens({
  breakDistance: 10,
  coordinationDistance: 10
});
```

Validate:

1. normal coordinated translation/orbit preserves the 10-foot band;
2. external forced movement which moves the Follower from 10 feet to a legal 5-foot separation keeps the relationship and updates `coordinationDistance` to 5;
3. future normal translation/orbit now uses the 5-foot shell;
4. force the participant back to a legal 10-foot separation; `coordinationDistance` should become 10;
5. a forced zero-distance overlap may remain temporarily legal but must **not** persist `coordinationDistance: 0`;
6. movement beyond `breakDistance: 10` removes the relationship without moving either participant back.

Inspect persisted state with:

```js
console.log(JSON.stringify(
  ae5e.relationships.list({ sceneId: canvas.scene.id }),
  null,
  2
));
```

## Forced-movement regression matrix retained from v0.3.22

The following 1x1 cases were live-validated before v0.3.23 and must remain unchanged:

- Force Follower; final separation ≤ break distance → Follower moves independently, Leader stays, relationship remains.
- Force Follower; final separation > break distance → Follower stays at forced destination, relationship ends.
- Force Leader with `independent`; final separation ≤ break distance → Leader moves, Follower stays, relationship remains.
- Force Leader; final separation > break distance → Leader stays at forced destination, relationship ends.
- Force both participants in one `Scene.moveTokens()` operation while final separation remains legal → both movements succeed and relationship remains.

No forced-movement break-distance case should use relationship rollback merely because the relationship becomes invalid after successful external movement.

## Nonhostile endpoint grace regression

With a nonhostile creature occupying the next orbit shell anchor:

1. orbit into the occupied endpoint;
2. verify the 3.5-second grace begins only after follower animation settles;
3. allow expiry: Follower and Leader rotation must restore to the exact original legal anchor;
4. repeat and continue to an open shell anchor before expiry: timer must clear with no later snapback;
5. repeat across consecutive nonhostile occupied anchors: original legal anchor remains the rollback target while timer restarts;
6. remove the relationship during grace: no orphaned timer may move either token later;
7. verify Friendly/Friendly and Hostile/Hostile are nonhostile, Friendly/Hostile is hostile, and Neutral/Secret are nonhostile regardless of the other participant's side.

## Collision/rollback regression

For `collisionPolicy: "stopGroup"`:

- block one follower orbit shell step with a wall;
- Follower must remain at the prior shell anchor;
- Leader must restore to the exact pre-step rotation, including non-45-degree angles;
- rapid speculative events queued after the blocked step must be discarded;
- coordinated translation which Foundry partially constrains must restore every surviving linked participant from the pre-move origin snapshot, even when a token's `moveTokens()` result is `false`.

## Translation regression

For `grappleFollower`:

- 1x1/1x1 at 5 feet must retain `F L . -> . F L` behavior on an eastward one-square move;
- 2x2 Leader/1x1 Follower and the reverse must select a rear legal shell anchor without overlap;
- 10-foot coordination must preserve the outer band rather than collapsing to ordinary adjacency;
- multi-step and corner routes should be processed one Leader grid step at a time when Foundry exposes a square-grid direct path;
- pure vertical movement preserves planar offset and follows elevation when enabled;
- teleport-follow preserves fixed offset rather than using grapple trailing geometry.

## Runtime settlement and diagnostics

Never use guessed sleeps when the public settlement helper can observe the relationship pipeline:

```js
const rel = ae5e.relationships.list({ sceneId: canvas.scene.id })[0];
await ae5e.relationships.waitForMovementSettled({ leaderUuid: rel.leaderUuid });
```

Useful diagnostics:

```js
ae5e.movement.getStats();
ae5e.relationships.getStats();
ae5e.relationships.getMovementStats();
ae5e.relationships.getRotationStats();
ae5e.movement.getRecentTransactions();
```

After a settled operation, queued/active relationship movement and rotation counts should return to zero. During nonhostile endpoint grace, `pendingNonhostileOverlaps` should be 1. `pendingAlliedOverlaps` remains a legacy diagnostics alias during the v0.3.x migration.

## Coexistence testing

After isolated geometry tests, repeat representative cases with the user's normal Foundry module set. CPR/GPS coexistence remains a first-class project requirement even though neither is required. Pay particular attention to other modules registering `preMoveToken`, `moveToken`, `preUpdateToken`, `updateToken`, or Scene movement wrappers.

Test isolation should distinguish an AE5E defect from another module altering the same Foundry lifecycle; do not build product behavior around test-only bypasses.

## 0.3.26 Grapple-link obstruction regression

Run only inside Foundry VTT as GM:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.runGrappleLinkObstructionTest();
```

The harness requires exactly one token each named `Leader`, `Follower`, `Ally`, `Enemy`, `Neutral`, and `Secret`. It automatically snapshots/restores them on a complete pass, removes only AE5E test relationships and AE5E diagnostic walls, creates a 10-foot Grapple-like relationship, and verifies:

1. a hostile creature intersecting only the Grapple link hard-blocks orbital movement using Leader-relative disposition semantics;
2. a nonhostile creature occupying only the final Grapple link permits the orbit, starts the 3.5-second grace window, then restores the prior Follower shell plus Leader rotation if unresolved;
3. a movement wall intersecting the Grapple-link sweep hard-blocks while the Follower body path remains clear;
4. a nonhostile creature intersecting only the swept Grapple link may be passed through and does not start endpoint grace when the final link is clear;
   The harness uses a deterministic 0.25x0.25 diagnostic footprint for this narrow sweep-fan fixture and first asserts that the creature is clear of both the initial and final link while intersecting an intermediate sampled link.
5. the same sweep-only geometry hard-blocks when the creature is hostile to the Leader/Grappler;
6. when one creature simultaneously produces a nonhostile Follower-body conflict and a hostile Leader-relative Grapple-link conflict, the hard Grapple-link conflict wins.

A failed fixture is intentionally left in place. No Node/npm behavioral test is a release gate for this project.

## 0.3.27 selection/popup indicator regression

Run inside Foundry VTT with Sequencer active. Control exactly one token, then run:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.runSelectionIndicatorTest();
```

The command performs an automated lease lifecycle first:

1. first lease starts one token visual;
2. second lease on the same token increments the lease count but does not create a second visual;
3. releasing the first lease leaves the visual active;
4. releasing the second/final lease removes the visual.

It then opens an actual Foundry v14 DialogV2 through `selection.waitForDialog()`. While the dialog remains open, verify in Foundry:

- the marker sits slightly inward from the controlled token's upper-right footprint corner and partially overlaps the token;
- visible marker size is approximately 25-30% of token width; repeat with 1x1, 2x2, and 3x3 tokens;
- the marker follows token translation while the dialog is open and does not rotate around the token when the token rotates;
- when Eskie Effects is installed, the raw WebM `modules/eskie-effects/assets/UI/Ability_Check/D20/01/UI_Ability_Check_D20_01_Roll_Default_White.webm` loops seamlessly and is tinted `#18cc46`; if Eskie Effects is absent, `icons/vtt-512.png` is shown instead;
- where the marker overlaps the controlled token's orange selection/control outline, the marker renders above that outline;
- from a second connected client viewing the same Scene, the marker is visible even though the DialogV2 exists only on the selecting user's client;
- closing with the default button, Cancel, or the window X removes the marker immediately;
- after closure, `ae5e.selection.getStats()` reports `activeLeases: 0`, `activeTokens: 0`, and `renderedTokens: 0`.

The visual service is advisory. For a separate compatibility check, disabling Sequencer must not prevent an interaction wrapped by `selection.withIndicator()` or `selection.waitForDialog()` from resolving; AE5E should warn and continue without a marker. Sequencer is recommended, not required.

### Role-pair presentation

Control exactly two tokens in originator-first, responder-second order and run:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.runSelectionIndicatorRolePairTest();
```

Verify the first token has the green `originator` indicator and plays `notification01.ogg` once for the executing user. Verify the second token simultaneously has the temporary amber `responder` indicator and is silent because no responder audio asset is assigned yet. Closing the test dialog must remove both indicators.

### External ApplicationV2 bridge

Control exactly one token and run:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.runExternalPromptBridgeTest();
```

The harness registers one temporary exact-match external adapter and opens a DialogV2 that deliberately does **not** use `selection.waitForDialog()`. The global `renderApplicationV2` bridge should recognize only that tagged test application, display the blue `external` indicator on the controlled token, and remove it from the ApplicationV2 `close` event. The production bridge does not ship with a catch-all token heuristic; unknown external windows remain unmarked until a reliable module-specific adapter exists.

### Production Push-selector integration

To verify the first real consumer of the service, control exactly two tokens in Source-first, Target-second order and run:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.previewDisplacementFromControlledTokens({ type: "push" });
```

While the Push destination overlay is waiting for a click, the selection indicator must be on the Source/acting token, not the displaced Target. Clicking a legal destination or cancelling the selector must remove the indicator. A Pull preview should resolve its direct destination without opening the selector or displaying a waiting marker.


## 0.3.28 Reaction Broker regression

All Reaction Broker behavioral acceptance is performed inside Foundry VTT. The synthetic handlers used by this harness are installed across connected clients only while a test is running and are removed afterward. They are gated to `ae5eTest` contexts and never modify real Items.

### 1. Create/reset the fixture

Run as GM:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.setupReactionBrokerTestScene();
```

This creates/activates `AE5E 0.3.28 Reaction Broker Test` with Attacker, Reactor 1, Reactor 2, Reactor 3, and Non-Reactor tokens. Reactor 1 is closest to Attacker. Reactors 2 and 3 are placed at the same distance, with Reactor 2 carrying the higher Dexterity fixture. The fixture may assign currently active players during initial creation, but the dedicated multiplayer test overrides fixture ownership deterministically for the duration of that test. The fixture also tries to clone a harmless D&D5e cantrip onto Attacker as `AE5E Reaction Gate Probe — ...`; if no suitable core spell is available, the live Midi gate test can use any other real spell cast from the source client.

### 2. Automated foundation test

Run as GM:

```js
await ae5e.tests.runReactionBrokerFoundationTest();
```

The console prints large PASS/FAIL lines and a final table. It validates, without requiring user choices:

- elected Reaction authority exists and is the oldest continuous browser-session start among connected GMs;
- Activity reaction metadata parses independently from test offers;
- `Do not use a reaction` is not registered as an offer/handler;
- three synthetic Reactors are discovered while Non-Reactor is ignored;
- one actual reaction remains exactly one offer and multiple actual reactions remain multiple offers;
- distance precedes Dexterity in Reactor ordering;
- Dexterity orders equal-distance Reactors;
- d20 ties can reroll an unresolved subgroup without losing precedence established by the earlier roll;
- parent/root transaction lineage is preserved for nested transactions;
- concurrent processing of the same event key joins one in-flight transaction;
- one synthetic spell workflow creates exactly one normalized AE5E `spellCast`;
- a non-spell workflow creates no `spellCast`;
- no Broker dialog or selection-indicator lease remains after the noninteractive run.

### 3. Sequential UI test

Run as GM (or on the source client after the GM has created the fixture):

```js
await ae5e.tests.runReactionBrokerInteractiveTest();
```

Expected behavior:

1. Reactor 1, Reactor 2, and Reactor 3 receive Broker windows immediately.
2. Only Reactor 1 is active and only Reactor 1 shows the v0.3.27 animated responder indicator.
3. Reactor 2 and Reactor 3 display `Please wait while another actor chooses whether or not to use a reaction`.
4. Reactor 1 shows two actual synthetic reactions plus `Do not use a reaction`.
5. After Reactor 1 resolves/declines, its indicator and window clean up and Reactor 2's existing window becomes active. Reactor 2 has one actual reaction and still uses the same Broker window, showing that reaction plus `Do not use a reaction`.
6. Reactor 3 follows in the same fashion.
7. `Cancel` from any waiting or active Reactor closes the automated transaction as manual adjudication; it must never be recorded as a decline.
8. At completion, the harness requires `activeLeases: 0` and zero Reaction Broker dialog hosts.

Selecting `Abort Source Test Reaction` proves the Broker's standardized abort contract; selecting Continue/declining through the queue proves the resume path.

### 4. Nested/LIFO UI test

```js
await ae5e.tests.runReactionBrokerInteractiveTest({ nested: true });
```

Choose `Nested Reaction Test` for Reactor 1. The parent transaction enters resolving while a child `spellCast` transaction is created. Any token participating in both transactions reuses its single Broker host; the child view temporarily sits above the parent view. The child transaction must complete before the parent continues. The automated test now verifies the full chronology: parent enters `RESOLVING` before child creation, child carries the correct parent/root lineage, child reaches completion before the parent records the nested reaction result, the parent does not advance to its next Reactor before child completion, and the parent resumes/completes only afterward. The console also prints an `AE5E nested transaction chronology` object with the relevant timestamps and transaction IDs.

### 5. Live Midi workflow gate

This is the release-critical integration probe for the actual `midi-qol.prePreambleComplete` interception point. It uses the next **real spell workflow** on the client running the command while keeping the reaction itself synthetic.

Resume path:

```js
await ae5e.tests.runReactionBrokerMidiWorkflowGateTest({ mode: "resume" });
```

After arming, use the `AE5E Reaction Gate Probe — ...` spell on Attacker (or cast any real spell from that same client if the fixture could not clone one). Choose `Continue Test Reaction` or `Do not use a reaction`. PASS requires the Broker transaction to complete before Midi reaches `midi-qol.postPreambleComplete`, followed by normal source continuation.

Abort path:

```js
await ae5e.tests.runReactionBrokerMidiWorkflowGateTest({ mode: "abort", setup: false });
```

Cast another real spell and choose `Abort Source Test Reaction`. PASS requires the Broker to return the standardized `abort` contract and the matching workflow must **not** reach `midi-qol.postPreambleComplete`. Both modes also require zero stale Broker hosts and zero indicator leases after completion.

This probe deliberately uses real Midi workflow timing rather than simulating the external hook, so it is the strongest evidence in 0.3.28 that the source workflow is actually gated by the Reaction Broker.

### 6. Multiplayer routing

Connect at least one player and one GM. The player does **not** need to place or bring a normal character token onto the fixture Scene. Run from the GM client:

```js
await ae5e.tests.runReactionBrokerMultiplayerTest({ setup: false });
```

The harness temporarily configures the existing fixture so **Reactor 1 is owned by the selected connected player**, while Reactor 2 and Reactor 3 are unowned and therefore route to the elected GM. Original fixture ownership is backed up and restored automatically after the transaction; `clearReactionBrokerTestState()` also restores it after an interrupted test.

For the baseline routing run, let the queue advance normally (do not use the Stop Queue reaction and do not early-decline Reactor 2/3). Expected routing is:

- Reactor 1 Broker host/ACTIVE prompt/indicator appear on the player client only.
- Reactor 2 and Reactor 3 waiting hosts appear on the elected GM client.
- After Reactor 1 resolves/declines, Reactor 2 then Reactor 3 become active on the GM client.
- Only the currently active Reactor has the selection indicator and private notification sound.

The harness captures per-client dialog counters before and after the transaction and automatically verifies the routing split, in addition to the normal interactive cleanup/order assertions.

With two GMs connected, inspect:

```js
ae5e.tests.inspectReactionBroker().authority;
```

The GM with the oldest active browser-session start must be primary. Disconnect that GM while the other remains: authority should transfer to the next-longest session without disabling the active Reactor's OK control.

### 7. Last-GM disconnect/reconnect

For the strongest recovery test, first ensure the fixture exists, then start the multiplayer test from a **player/source client** while one GM is connected. The GM-side socket helper temporarily applies the same Reactor 1 ownership routing even though the command originates from the player:

```js
await ae5e.tests.runReactionBrokerMultiplayerTest({ setup: false, testDisconnectRecovery: true });
```

While an active Reactor is deciding, disconnect or refresh the last GM. Verify:

- the source workflow remains pending rather than being treated as a decline;
- active OK is disabled;
- the warning is visible and available on hover: `Game Master has been disconnected, waiting for game master to reconnect. Click cancel to proceed with manual reaction selection`;
- waiting Reactors remain waiting and do not gain indicators;
- Cancel remains enabled and terminates automated handling as manual adjudication;
- if a GM reconnects instead, the same active view is re-enabled and can continue;
- final cleanup leaves no Broker hosts or indicator leases.

Do not use a GM-owned source workflow for the reconnect-resume assertion: refreshing the browser which owns the original Midi workflow destroys that external workflow call stack, which no module can resume in-place.

### 8. Active Reactor controller-disconnect recovery

With a GM and at least one player connected, run:

```js
await ae5e.tests.runReactionBrokerMultiplayerTest({
  setup: false,
  testControllerDisconnectRecovery: true
});
```

While a **player-owned Reactor is ACTIVE**, disconnect or refresh that player browser.

Verify:

- the Attacker/source workflow does not remain permanently suspended on the lost remote dialog request;
- the disconnect is **not** recorded as `Do not use a reaction`;
- AE5E revalidates the same frozen Reactor queue slot;
- if a GM remains available, control of that Reactor's Broker prompt reroutes to the elected primary GM;
- the original distance/DEX/d20 queue position remains frozen;
- the rerouted decision is still GM-authorized normally.

If the disconnected controller was also the **last GM**, this folds into the normal `WAITING_FOR_AUTHORITY` behavior instead: surviving Reactor windows show the GM-disconnected warning, the source remains suspended, and either a GM reconnect or `Cancel` is required.

### 9. No-GM bypass

Disconnect every GM and run from a player client:

```js
await ae5e.tests.runReactionBrokerNoGmTest();
```

Expected PASS: source result is `resume`, reason is `no-active-gm`, and no Reaction Broker window opens. The Broker never elects a player authority.

### Test cleanup / recovery

If a manual test is interrupted, a browser is refreshed, or you want a clean rerun, use:

```js
await ae5e.tests.clearReactionBrokerTestState();
```

This closes Reaction Broker hosts on all connected clients and unregisters temporary test handlers. To also remove the fixture Scene and its temporary Actors, run as GM:

```js
await ae5e.tests.clearReactionBrokerTestState({ removeFixture: true });
```

### Diagnostics

```js
ae5e.tests.inspectReactionBroker();
ae5e.reactions.getStats();
ae5e.reactions.getAuthorityStatus();
ae5e.reactions.getRecentTransactions();
ae5e.reactions.getDialogStats();
ae5e.reactions.getEventAdapterStats();
```

The final release gate for 0.3.28 is the Foundry matrix above. The repository's legacy Node simulation suite is not a project release gate; the finalized 0.3.27 baseline already contains six relationship-rotation simulation failures which remain unchanged in this build.

### Live Midi gate duplicate-arm/timeout note (0.3.28 revised7)
The live Midi gate remains armed for approximately 10 minutes by default. If a probe is already `armed` or `running`, a second `runReactionBrokerMidiWorkflowGateTest()` call is rejected before any second test instrumentation is installed. Use the already-armed spell probe, or call `await ae5e.tests.clearReactionBrokerTestState()` before intentionally changing modes. The mode banner is printed only after the probe has successfully armed.
