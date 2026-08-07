# Testing Action Effects 5E 0.2.0

## Automated tests

From the repository root:

```bash
npm test
```

The suite checks syntax, movement transactions, indexed consumers, relationship persistence, Socketlib registration, waypoint translation, passenger classification, follower blocking, coordinated group instruction construction, post-operation synchronization for external API movement, collision preflight, and partial-movement rollback.

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
5. Drag the leader through a simple multi-waypoint path.
6. Confirm the follower preserves the same X/Y offset and elevation difference.
7. Move the leader with the keyboard and confirm the follower follows.
8. Try to drag the follower and confirm the movement is rejected.
9. Move the leader toward a wall where the translated follower path is blocked. Confirm the group does not separate.
10. Reload Foundry and confirm the relationship persists.
11. Remove the relationship:

```js
await ae5e.tests.removeTestRelationships();
```

12. Confirm the follower can move independently again.

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
