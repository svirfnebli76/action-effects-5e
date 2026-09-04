import assert from "node:assert/strict";
import test from "node:test";

class RegionBehaviorType {
  static _createEventsField() { return {}; }
}
class Field {
  constructor(options = {}) { Object.assign(this, options); }
}

test("production module graph evaluates far enough to register Foundry lifecycle hooks", async () => {
  globalThis.foundry = {
    data: {
      regionBehaviors: { RegionBehaviorType },
      fields: { StringField: Field, NumberField: Field }
    },
    utils: {
      duplicate: value => structuredClone(value),
      randomID: length => "x".repeat(Number(length) || 16),
      getProperty: (object, path) => String(path).split(".").reduce((value, part) => value?.[part], object),
      setProperty: (object, path, value) => {
        const parts = String(path).split(".");
        const leaf = parts.pop();
        let current = object;
        for (const part of parts) current = current[part] ??= {};
        current[leaf] = value;
        return true;
      },
      unsetProperty: () => true
    }
  };
  globalThis.CONST = { REGION_EVENTS: {} };
  const hooks = new Map();
  globalThis.Hooks = {
    once: (name, fn) => { hooks.set(name, fn); return 1; },
    on: () => 1,
    callAll: () => {}
  };
  const moduleRecord = { version: "0.4.3.21", active: true };
  globalThis.game = {
    modules: new Map([["action-effects-5e", moduleRecord]]),
    users: [],
    settings: { register() {}, get() {}, set() {} },
    system: { version: "5.3.3" },
    version: "14.367"
  };
  globalThis.CONFIG = { RegionBehavior: { dataModels: {}, typeLabels: {}, typeIcons: {} } };
  globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };

  await import(`../scripts/action-effects-5e.js?module-evaluation-test=${Date.now()}`);

  assert.ok(hooks.has("socketlib.ready"), "Socketlib registration hook should be registered during module evaluation");
  assert.ok(hooks.has("init"), "Foundry init hook should be registered during module evaluation");
  assert.ok(hooks.has("setup"), "Foundry setup hook should be registered during module evaluation");
  assert.ok(hooks.has("ready"), "Foundry ready hook should be registered during module evaluation");
});
