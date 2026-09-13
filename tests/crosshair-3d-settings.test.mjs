import test from "node:test";
import assert from "node:assert/strict";

import { registerSettings } from "../scripts/core/settings.js";
import { MODULE_ID, SETTINGS } from "../scripts/core/constants.js";

test("3D Crosshair reverse ELEVATE wheel setting is visible, client-scoped, and enabled by default", () => {
  const registered = [];
  const hookEvents = [];
  const previousGame = globalThis.game;
  const previousHooks = globalThis.Hooks;
  try {
    globalThis.game = {
      settings: {
        register(moduleId, key, config) {
          registered.push({ moduleId, key, config });
        }
      }
    };
    globalThis.Hooks = { on: (hook, fn) => hookEvents.push({ hook, fn }) };

    registerSettings();

    const entry = registered.find(item => item.key === SETTINGS.CROSSHAIR_3D_REVERSE_ELEVATION_WHEEL);
    assert.ok(entry, "reverse ELEVATE wheel setting is registered");
    assert.equal(entry.moduleId, MODULE_ID);
    assert.equal(entry.config.scope, "client");
    assert.equal(entry.config.config, true);
    assert.equal(entry.config.type, Boolean);
    assert.equal(entry.config.default, true, "new installs/clients reverse ELEVATE wheel direction by default");
    assert.ok(hookEvents.some(event => event.hook === "renderSettingsConfig"), "settings renderer installs the 3D Crosshair section heading");
  } finally {
    globalThis.game = previousGame;
    globalThis.Hooks = previousHooks;
  }
});
