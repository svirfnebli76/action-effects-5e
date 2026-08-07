# Testing Action Effects 5E 0.2.5

## Automated tests

From the repository root:

```bash
npm test
```

The suite checks syntax, movement transactions, indexed consumers, relationship persistence, Socketlib registration, rigid and trailing waypoint planning, passenger classification, follower blocking, coordinated group instruction construction, post-operation synchronization for external API movement, symmetric follower-teleport detachment, non-GM GM-receipt validation, collision preflight, and partial-movement rollback.

## Foundry smoke test

After Foundry reaches `ready`:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.runFoundationSmokeTest();
```

Expected result: `passed: true` with seven checks.

## Live relationship movement test

1. Open a Scene with two tokens separated by a visible offset.
2. Control exactly those two tokens.
3. Run:

```js
await ae5e.tests.createTestRelationshipFromControlledTokens();
```

4. Confirm the leader remains controlled and the follower is released.
5. Move the leader one grid square. Confirm the follower moves into the square the leader just vacated.
6. Move the leader through a simple multi-waypoint path. Confirm the follower trails the leader route one waypoint behind instead of mirroring the original offset.
7. Move the leader with the keyboard and confirm the same trailing behavior.
8. Try to drag the follower normally and confirm the movement is rejected.
9. Move the leader toward a wall where the follower's trailing route is blocked. Confirm the group does not separate.
10. Reload Foundry and confirm the relationship persists.
11. Test a leader `blink` teleport with `teleportPolicy: detach`: the leader should teleport, the follower should remain, and the relationship should be removed.
12. Recreate the relationship, then teleport the follower with `blink`: the follower should teleport, the leader should remain, and the relationship should be removed.
13. Remove any remaining test relationship:

```js
await ae5e.tests.removeTestRelationships();
```

14. Confirm the follower can move independently again.

## Diagnostics

```js
ae5e.relationships.getMovementStats();
ae5e.movement.getStats();
ae5e.relationships.list({ sceneId: canvas.scene.id });
```

Enable recent movement capture only while diagnosing:

```js
await game.settings.set("action-effects-5e", "captureMovementDiagnostics", true);
```

Move the relationship group and inspect:

```js
ae5e.movement.getRecentTransactions();
```

Disable capture after testing:

```js
await game.settings.set("action-effects-5e", "captureMovementDiagnostics", false);
```

## Coexistence matrix

Repeat the live movement test in these configurations before release:

1. Action Effects 5E without CPR or GPS.
2. Action Effects 5E with CPR.
3. Action Effects 5E with GPS.
4. Action Effects 5E with CPR and GPS.

Look specifically for duplicate movement, duplicate reactions, movement freezing, incorrect pause/resume behavior, or noticeable performance degradation.


## v0.2.2 regression check

Generated internal movement IDs must be 16-character alphanumeric Foundry UIDs. After startup and before moving a linked token, `ae5e.relationships.getMovementStats()` should be idle and `ae5e.movement.getStats().movementContexts` should be `0`. During internal movement the context is transient and is removed when the operation completes. A non-zero value after movement settles indicates a leaked internal movement context.


## v0.2.3 regression check

For a manual leader drag or keyboard move, Action Effects 5E should reject the original `preMoveToken` operation and start the replacement coordinated movement only after the cancelled Foundry update has fully unwound. After movement settles, `movementContexts`, `pendingTransactions`, `queuedRequests`, and `activeLeaders` should all return to `0`. If Foundry reports a partial or stopped group move, the console now logs the exact `results` and `failedIds` before rollback.


## v0.2.4 regression check

Generated relationship movement must explicitly mark the final leader and follower waypoint as `checkpoint: true`. Intermediate waypoints must retain their existing checkpoint state, and Action Effects 5E must not add `action` or `level` solely for this workaround. Rollback destinations must also be explicit checkpoints.

For the live regression test on Foundry 14.365, create a two-token relationship and move the leader one grid square. Both the leader and follower should complete the coordinated movement without the `Linked movement reported incomplete token movement` rollback warning. After movement settles, `movementContexts`, `pendingTransactions`, `queuedRequests`, and `activeLeaders` should return to `0`.


## v0.2.5 regression check

Movement classification must not access Foundry's deprecated `DatabaseUpdateOperation#teleport` prototype accessor. A `blink` movement action should classify as `pathType: "teleport"` and `movementMode: "blink"` without producing the deprecation warning.

New test-harness relationships use `attachmentMode: "adjacentFollower"`. For a leader route `L0 -> L1 -> L2`, the generated follower route must be `L0 -> L1`; a one-square leader move must place the follower in the leader's starting square. On a gridded Scene, a single long straight drag must expand through grid spaces so a three-space leader move produces a follower route through the first three leader spaces and ends one space behind the leader. `rigidOffset` must continue to preserve the original offset, and teleport-follow must preserve offset rather than trail.

A follower teleport must bypass the normal manual follower lock, complete normally, and then remove the relationship after GM validation. For non-GM users, the detachment request must be verified against a primary-GM movement receipt for that follower. After the operation settles, `queuedFollowerDetaches` should return to `0`.
