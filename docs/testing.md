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
5. the same sweep-only geometry hard-blocks when the creature is hostile to the Leader/Grappler;
6. when one creature simultaneously produces a nonhostile Follower-body conflict and a hostile Leader-relative Grapple-link conflict, the hard Grapple-link conflict wins.

A failed fixture is intentionally left in place. No Node/npm behavioral test is a release gate for this project.
