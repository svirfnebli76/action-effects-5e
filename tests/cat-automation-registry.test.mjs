import test from "node:test";
import assert from "node:assert/strict";
import {
  CAT_AUTOMATION_SOURCE_ID,
  CAT_AUTOMATION_SOURCE_NAME,
  CAT_READY_HOOK,
  CatAutomationRegistry
} from "../scripts/integrations/cat-automation-registry.js";

function makeFixture() {
  const callbacks = new Map();
  const hooks = {
    once(name, callback) {
      callbacks.set(name, callback);
      return callbacks.size;
    }
  };

  const sourceNames = {};
  const automations = new Map();
  const registry = {
    automations,
    getSourceName(id) {
      return sourceNames[id] ?? id;
    }
  };

  const cat = {
    api: {
      registerSourceName(id, name) { sourceNames[id] = name; },
      registerAutomation() { return true; },
      registerAutomations() { return []; },
      registerAutomationCompendium() { return []; },
      registerAutomationModule() { return []; }
    },
    lib: { constants: { automations: registry } }
  };

  return { callbacks, hooks, cat, sourceNames, automations };
}

test("CAT automation provider waits for catReady and registers only the AE5E source", () => {
  const fixture = makeFixture();
  const service = new CatAutomationRegistry({
    catAccessor: () => fixture.cat,
    hooksAccessor: () => fixture.hooks
  });

  const initial = service.initialize();
  assert.equal(initial.initialized, true);
  assert.equal(initial.hookRegistered, true);
  assert.equal(initial.source.registered, false);
  assert.equal(fixture.callbacks.has(CAT_READY_HOOK), true);

  fixture.callbacks.get(CAT_READY_HOOK)();
  const status = service.getStatus();

  assert.equal(status.catReadyObserved, true);
  assert.equal(status.source.registered, true);
  assert.equal(status.source.verified, true);
  assert.equal(fixture.sourceNames[CAT_AUTOMATION_SOURCE_ID], CAT_AUTOMATION_SOURCE_NAME);
  assert.equal(status.automationsRegistered, 0);
  assert.equal(service.getStats().sourceRegistrationAttempts, 1);
});

test("CAT automation provider initialization is idempotent", () => {
  const fixture = makeFixture();
  const service = new CatAutomationRegistry({
    catAccessor: () => fixture.cat,
    hooksAccessor: () => fixture.hooks
  });

  service.initialize();
  service.initialize();
  fixture.callbacks.get(CAT_READY_HOOK)();
  service.initialize();

  const stats = service.getStats();
  assert.equal(stats.initializeCalls, 3);
  assert.equal(stats.duplicateInitializeCalls, 2);
  assert.equal(stats.catReadyEvents, 1);
  assert.equal(stats.sourceRegistrationAttempts, 1);
  assert.equal(stats.sourceRegistrations, 1);
  assert.equal(stats.status.source.registered, true);
});

test("CAT automation provider fails closed when registerSourceName is missing", () => {
  const fixture = makeFixture();
  delete fixture.cat.api.registerSourceName;
  const service = new CatAutomationRegistry({
    catAccessor: () => fixture.cat,
    hooksAccessor: () => fixture.hooks
  });

  service.initialize();
  fixture.callbacks.get(CAT_READY_HOOK)();
  const status = service.getStatus();

  assert.equal(status.catReadyObserved, true);
  assert.equal(status.source.registrationAttempted, true);
  assert.equal(status.source.registered, false);
  assert.equal(status.lastError?.message.includes("registerSourceName"), true);
  assert.equal(service.getStats().sourceRegistrationErrors, 1);
});
