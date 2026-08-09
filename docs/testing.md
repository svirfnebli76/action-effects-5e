# Action Effects 5E testing

## Automated suite

Run from the module repository root:

```bash
npm test
```

v0.3.23 currently performs syntax validation across all JavaScript files and **61 Node regressions**. Coverage includes the established movement/Socketlib/rollback pipeline plus dynamic footprint shells, 5/10/15-foot orbit bands, exact ±360° circuit closure, Shift/Ctrl normalization, rapid predicted orbit input, variable-angle rollback, allied endpoint grace, forced-movement break distance, unequal-size trailing, and forced re-anchoring.

Automated geometry tests deliberately use the same production `RelationshipGeometryService`, `RelationshipMovementPlanner`, and `RelationshipRotationService` code paths exposed to Foundry.
The relationship-service regression also rejects invalid coordination/break-distance geometry before persistence and verifies that rejected updates leave the prior relationship state intact.

## Startup check

After replacing module files and restarting Foundry, v0.3.23 should report:

```text
Action Effects 5E | Registered 9 Socketlib handlers.
Action Effects 5E | v0.3.23 dependencies validated.
Action Effects 5E | Relationship rotation service ready.
Action Effects 5E | Foundation ready.
```

Run the non-destructive smoke test:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.runFoundationSmokeTest();
```

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

## Allied endpoint grace regression

With same-side occupancy on the next orbit shell anchor:

1. orbit into the occupied endpoint;
2. verify the 3.5-second grace begins only after follower animation settles;
3. allow expiry: Follower and Leader rotation must restore to the exact original legal anchor;
4. repeat and continue to an open shell anchor before expiry: timer must clear with no later snapback;
5. repeat across consecutive same-side occupied anchors: original legal anchor remains the rollback target while timer restarts;
6. remove the relationship during grace: no orphaned timer may move either token later;
7. Hostile+Friendly or Neutral/Secret cases must not be inferred as same-side grace solely from one token's disposition label.

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

After a settled operation, queued/active relationship movement and rotation counts should return to zero. During allied endpoint grace, `pendingAlliedOverlaps` should be 1.

## Coexistence testing

After isolated geometry tests, repeat representative cases with the user's normal Foundry module set. CPR/GPS coexistence remains a first-class project requirement even though neither is required. Pay particular attention to other modules registering `preMoveToken`, `moveToken`, `preUpdateToken`, `updateToken`, or Scene movement wrappers.

Test isolation should distinguish an AE5E defect from another module altering the same Foundry lifecycle; do not build product behavior around test-only bypasses.
