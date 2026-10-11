import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { ChatCardAdapter } from "../scripts/chat/chat-card-adapter.js";
import { ActivityCardService } from "../scripts/chat/activity-card-service.js";

const entry = fs.readFileSync(new URL("../scripts/action-effects-5e.js", import.meta.url), "utf8");
const harness = fs.readFileSync(new URL("../scripts/dev/test-harness.js", import.meta.url), "utf8");

test("restored chat messages reach both presentation services before ready", () => {
  const callbacks = new Map();
  const hooks = {
    once(name, callback) { callbacks.set(name, callback); },
    on(name, callback) {
      const listeners = callbacks.get(name) ?? [];
      listeners.push(callback);
      callbacks.set(name, listeners);
    }
  };
  const previousHooks = globalThis.Hooks;
  globalThis.Hooks = hooks;
  try {
    const seen = [];
    const activityCards = new ActivityCardService();
    const chatCardAdapter = new ChatCardAdapter();
    activityCards.render = (message, html) => seen.push(["activity", message, html]);
    chatCardAdapter.render = (message, html) => seen.push(["adapter", message, html]);
    const context = {
      Hooks: hooks, Logger: { log() {} }, registerSettings() {},
      MODULE_ID: "action-effects-5e", api: {}, game: { modules: new Map() },
      activityCards, chatCardAdapter
    };
    const init = entry.slice(entry.indexOf('Hooks.once("init"'), entry.indexOf('Hooks.once("setup"'));
    for (const [, service] of init.matchAll(/\b(\w+)\.initialize\(\)/g)) {
      context[service] ??= { initialize() {} };
    }
    vm.runInNewContext(init, context);
    callbacks.get("init")();
    const message = { flags: { "action-effects-5e": { chatCard: {
      contributions: { probe: { id: "probe", html: "<p>Persisted contribution</p>" } }
    } } } };
    const html = {};
    for (const callback of callbacks.get("dnd5e.renderChatMessage") ?? []) callback(message, html);
    assert.deepEqual(seen, [["activity", message, html], ["adapter", message, html]],
      "initial history rendering must reach the services without waiting for ready");
    activityCards.initialize();
    chatCardAdapter.initialize();
    assert.equal(callbacks.get("dnd5e.renderChatMessage").length, 2,
      "reinitializing must not duplicate render listeners");
  } finally {
    globalThis.Hooks = previousHooks;
  }
});

test("persistent-area services are threaded through live TestHarness startup wiring", () => {
  assert.match(
    entry,
    /const\s+tests\s*=\s*new\s+TestHarness\s*\(\s*\{[\s\S]*?persistentAreaEvents\s*,[\s\S]*?persistentAreaLifecycle\s*,[\s\S]*?\}\s*\)/,
    "module entry must pass persistentAreaEvents and persistentAreaLifecycle into TestHarness"
  );

  const constructor = harness.match(/constructor\s*\(\s*\{([\s\S]*?)\}\s*\)\s*\{/);
  assert.ok(constructor, "TestHarness constructor destructuring must be discoverable");
  assert.match(constructor[1], /\bpersistentAreaEvents\b/, "TestHarness constructor must receive persistentAreaEvents");
  assert.match(constructor[1], /\bpersistentAreaLifecycle\b/, "TestHarness constructor must receive persistentAreaLifecycle");

  assert.match(
    harness,
    /new\s+EnvironmentalTestSuite\s*\(\s*\{[\s\S]*?persistentAreaEvents\s*,[\s\S]*?persistentAreaLifecycle\s*,[\s\S]*?\}\s*\)/,
    "TestHarness must forward both persistent-area services into EnvironmentalTestSuite"
  );

  assert.match(
    entry,
    /new\s+PersistentAreaEventService\s*\(\s*\{[\s\S]*?geometry\s*:\s*environmentGeometry[\s\S]*?\}\s*\)/,
    "PersistentAreaEventService must receive the shared EnvironmentGeometryService for generic Region event qualifiers"
  );
});
