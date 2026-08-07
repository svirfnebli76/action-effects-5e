# Foundation Testing

## Static check

From the repository root:

```bash
npm test
```

This checks JavaScript syntax without requiring Foundry globals.

## Foundry smoke test

After Foundry reaches `ready`:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.runFoundationSmokeTest();
```

Expected result: `passed: true` and no permanent world changes.

## Relationship persistence test

1. Open a Scene with two tokens.
2. Control the intended leader, then add the intended follower to the controlled selection.
3. Run:

```js
await ae5e.tests.createTestRelationshipFromControlledTokens();
```

4. Inspect:

```js
ae5e.relationships.list({ sceneId: canvas.scene.id });
```

5. Reload Foundry and verify the relationship remains indexed.
6. Remove it:

```js
await ae5e.tests.removeTestRelationships();
```

## Performance test

With diagnostics disabled and no relationships:

1. Move tokens normally.
2. Confirm `ae5e.movement.getRecentTransactions()` remains empty.
3. Confirm no Action Effects 5E debug output appears unless Debug Logging is enabled.

Enable Capture Recent Movement Transactions only while diagnosing movement:

```js
game.settings.set("action-effects-5e", "captureMovementDiagnostics", true);
```

Move a token and inspect:

```js
ae5e.movement.getRecentTransactions();
```
