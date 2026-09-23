# Action Effects 3D Crosshairs production contract

Checkpoint 4 publishes an opt-in configuration boundary without migrating any existing Item. An Item or Activity may store the following flag:

```json
{
  "flags": {
    "action-effects-5e": {
      "crosshairs3d": {
        "schemaVersion": 1,
        "shape": { "type": "sphere", "radius": 20 },
        "range": { "max": 60 },
        "capabilities": { "elevation": true },
        "propagation": { "mode": "direct" },
        "persistent": { "enabled": true }
      }
    }
  }
}
```

Resolution precedence is Item flag, Activity flag, explicit `configuration`, then runtime `overrides`. Later layers replace matching values while retaining unrelated nested values. The resolver clones and freezes its output; it does not mutate the Item or Activity.

The production entry point is:

```js
const result = await game.modules
  .get("action-effects-5e")
  .api.crosshairs3d.showConfigured({
    source: canvas.tokens.controlled[0],
    item,
    activity
  });
```

`crosshairs3d.configured.show()` is the equivalent grouped entry point. `crosshairs3d.configuration.inspect()` provides synchronous structural validation, while `crosshairs3d.configuration.resolve()` also reads the optional CAT propagation choice. The accepted Item default propagation modes are `none`, `direct`, and `spread`.

CAT configuration authors can obtain the canonical select descriptor from `crosshairs3d.configuration.getCatPropagationConfig()` and store it under the option key `propagation`. Its choices are `default`, `none`, `direct`, and `spread`. `default` retains the Item-authored mode. AE5E reads the choice through CAT's `automationUtils.getConfigValue(item, "propagation")` boundary and falls back to the Item default if CAT is unavailable or its read fails.

Only `signal`, `onRevision`, and `targetFilter` are accepted from the runtime-only callback object. Returned provenance contains UUIDs, configuration source names, and resolved propagation choices; it never retains or publishes live Item, Activity, or Token documents. Recent configured-placement diagnostics are bounded to twenty entries.

This contract reads only AE5E and CAT flags. It deliberately does not inspect D&D5e Item system internals, keeping the current D&D5e 5.3.3 integration isolated from future D&D5e 6.0 schema changes.

