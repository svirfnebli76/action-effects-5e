import test from "node:test";
import assert from "node:assert/strict";
import {
  CAT_AUTOMATION_SOURCE_ID,
  CAT_AUTOMATION_SOURCE_NAME,
  CAT_READY_HOOK,
  CatAutomationRegistry
} from "../scripts/integrations/cat-automation-registry.js";

function makeIndexEntry({
  id,
  identifier,
  rules = "2014",
  type = "spell",
  source = CAT_AUTOMATION_SOURCE_ID,
  version = "1.0.0",
  configSchema
}) {
  return {
    _id: id,
    id,
    uuid: `Compendium.test.${id}`,
    name: identifier,
    type,
    system: {
      identifier,
      source: { rules }
    },
    flags: {
      ...(source === undefined && version === undefined
        ? {}
        : {
            cat: {
              automation: {
                ...(source !== undefined ? { source } : {}),
                ...(version !== undefined ? { version } : {})
              }
            }
          }),
      ...(configSchema !== undefined
        ? { "action-effects-5e": { cat: { configSchema } } }
        : {})
    }
  };
}

function makePack(id, entries) {
  return {
    collection: id,
    metadata: {
      id,
      label: id.split(".").at(-1),
      type: "Item",
      packageName: CAT_AUTOMATION_SOURCE_ID
    },
    async getIndex() {
      return [...entries];
    }
  };
}

function makeFixture({ registerResults } = {}) {
  const callbacks = new Map();
  const hooks = {
    once(name, callback) {
      callbacks.set(name, callback);
      return callbacks.size;
    }
  };

  const sourceNames = {};
  const automations = new Map();
  const compendiumCalls = [];
  const registry = {
    automations,
    getSourceName(id) {
      return sourceNames[id] ?? id;
    },
    unregisterAutomationsBySource(source) {
      for (const [key, automation] of [...automations.entries()]) {
        if (automation?.source === source) automations.delete(key);
      }
    }
  };

  const cat = {
    api: {
      registerSourceName(id, name) { sourceNames[id] = name; },
      registerAutomation() { return true; },
      registerAutomations() { return []; },
      async registerAutomationCompendium(pack, { source, configs2014 = {}, configs2024 = {} } = {}) {
        const index = await pack.getIndex();
        compendiumCalls.push({ id: pack.collection, source, count: index.length, configs2014, configs2024 });
        if (typeof registerResults === "function") return registerResults(pack, index);
        for (const document of index) {
          const identifier = document.system?.identifier;
          const rules = document.system?.source?.rules;
          automations.set(document.uuid, {
            source,
            identifier,
            rules,
            type: document.type,
            version: document.flags?.cat?.automation?.version,
            config: rules === "2014" ? configs2014[identifier] : configs2024[identifier],
            uuid: document.uuid
          });
        }
        return index.map(() => true);
      },
      registerAutomationModule() { return []; }
    },
    lib: { constants: { automations: registry } }
  };

  return { callbacks, hooks, cat, sourceNames, automations, compendiumCalls };
}

test("CAT provider registers only metadata-ready packs from the explicit public allowlist", async () => {
  const fixture = makeFixture();
  const readyId = "action-effects-5e.spells-level-2";
  const deferredId = "action-effects-5e.spells-level-1";
  const emptyId = "action-effects-5e.spells-level-4";
  const missingId = "action-effects-5e.spells-level-9";
  const internalId = "action-effects-5e.ae5e-administrative";

  const readyPack = makePack(readyId, [makeIndexEntry({ id: "misty", identifier: "misty-step" })]);
  const deferredPack = makePack(deferredId, [makeIndexEntry({
    id: "entangle",
    identifier: "entangle",
    source: null,
    version: null
  })]);
  const emptyPack = makePack(emptyId, []);
  const internalPack = makePack(internalId, [makeIndexEntry({ id: "helper", identifier: "internal-helper" })]);
  const packs = new Map([
    [readyId, readyPack],
    [deferredId, deferredPack],
    [emptyId, emptyPack],
    [internalId, internalPack]
  ]);

  const service = new CatAutomationRegistry({
    catAccessor: () => fixture.cat,
    hooksAccessor: () => fixture.hooks,
    packsAccessor: () => packs,
    publicPackIds: [readyId, deferredId, emptyId, missingId]
  });

  const initial = service.initialize();
  assert.equal(initial.initialized, true);
  assert.equal(initial.hookRegistered, true);
  assert.equal(initial.source.registered, false);
  assert.equal(fixture.callbacks.has(CAT_READY_HOOK), true);

  await fixture.callbacks.get(CAT_READY_HOOK)();
  const status = service.getStatus();
  const stats = service.getStats();

  assert.equal(status.catReadyObserved, true);
  assert.equal(status.source.registered, true);
  assert.equal(status.source.verified, true);
  assert.equal(fixture.sourceNames[CAT_AUTOMATION_SOURCE_ID], CAT_AUTOMATION_SOURCE_NAME);
  assert.equal(status.publicRegistration.complete, true);
  assert.deepEqual(status.publicRegistration.registeredPacks.map(entry => entry.id), [readyId]);
  assert.deepEqual(status.publicRegistration.deferredPacks.map(entry => entry.id), [deferredId]);
  assert.deepEqual(status.publicRegistration.emptyPacks.map(entry => entry.id), [emptyId]);
  assert.deepEqual(status.publicRegistration.missingPacks, [missingId]);
  assert.deepEqual(fixture.compendiumCalls.map(entry => entry.id), [readyId]);
  assert.equal(fixture.compendiumCalls.some(entry => entry.id === internalId), false);
  assert.equal(status.automationsRegistered, 1);
  assert.equal(stats.sourceRegistrationAttempts, 1);
  assert.equal(stats.publicRegistrationRuns, 1);
  assert.equal(stats.packReadinessChecks, 3);
  assert.equal(stats.packRegistrationAttempts, 1);
  assert.equal(stats.packRegistrations, 1);
  assert.equal(stats.itemRegistrations, 1);
  assert.equal(stats.deferredPacks, 1);
  assert.equal(stats.emptyPacks, 1);
  assert.equal(stats.missingPacks, 1);
  assert.equal(status.lastError, null);
  assert.equal(status.stage, "public-compendiums");
});

test("CAT public pack gate rejects invalid source/version/core metadata instead of publishing CAT version 0", async () => {
  const fixture = makeFixture();
  const packId = "action-effects-5e.actions-common";
  const pack = makePack(packId, [
    makeIndexEntry({ id: "missing-source", identifier: "one", source: null, version: "1.0.0" }),
    makeIndexEntry({ id: "bad-version", identifier: "two", version: "0" }),
    makeIndexEntry({ id: "bad-rules", identifier: "three", rules: "legacy" }),
    makeIndexEntry({ id: "missing-id", identifier: "" })
  ]);

  const service = new CatAutomationRegistry({
    catAccessor: () => fixture.cat,
    hooksAccessor: () => fixture.hooks,
    packsAccessor: () => new Map([[packId, pack]]),
    publicPackIds: [packId]
  });

  service.initialize();
  await fixture.callbacks.get(CAT_READY_HOOK)();
  const status = service.getStatus();

  assert.equal(status.publicRegistration.complete, true);
  assert.equal(status.publicRegistration.registeredPacks.length, 0);
  assert.equal(status.publicRegistration.deferredPacks.length, 1);
  assert.equal(status.publicRegistration.deferredPacks[0].invalid, 4);
  assert.equal(fixture.compendiumCalls.length, 0);
  assert.equal(status.automationsRegistered, 0);
  assert.equal(status.lastError, null);
});

test("CAT automation provider initialization and public registration are idempotent", async () => {
  const fixture = makeFixture();
  const packId = "action-effects-5e.spells-level-2";
  const pack = makePack(packId, [makeIndexEntry({ id: "misty", identifier: "misty-step" })]);
  const service = new CatAutomationRegistry({
    catAccessor: () => fixture.cat,
    hooksAccessor: () => fixture.hooks,
    packsAccessor: () => new Map([[packId, pack]]),
    publicPackIds: [packId]
  });

  service.initialize();
  service.initialize();
  await fixture.callbacks.get(CAT_READY_HOOK)();
  service.initialize();

  const stats = service.getStats();
  assert.equal(stats.initializeCalls, 3);
  assert.equal(stats.duplicateInitializeCalls, 2);
  assert.equal(stats.catReadyEvents, 1);
  assert.equal(stats.sourceRegistrationAttempts, 1);
  assert.equal(stats.sourceRegistrations, 1);
  assert.equal(stats.publicRegistrationRuns, 1);
  assert.equal(stats.packRegistrationAttempts, 1);
  assert.equal(stats.packRegistrations, 1);
  assert.equal(fixture.compendiumCalls.length, 1);
  assert.equal(stats.status.source.registered, true);
});

test("CAT automation provider fails closed before pack registration when registerSourceName is missing", async () => {
  const fixture = makeFixture();
  delete fixture.cat.api.registerSourceName;
  const packId = "action-effects-5e.spells-level-2";
  const pack = makePack(packId, [makeIndexEntry({ id: "misty", identifier: "misty-step" })]);
  const service = new CatAutomationRegistry({
    catAccessor: () => fixture.cat,
    hooksAccessor: () => fixture.hooks,
    packsAccessor: () => new Map([[packId, pack]]),
    publicPackIds: [packId]
  });

  service.initialize();
  await fixture.callbacks.get(CAT_READY_HOOK)();
  const status = service.getStatus();

  assert.equal(status.catReadyObserved, true);
  assert.equal(status.source.registrationAttempted, true);
  assert.equal(status.source.registered, false);
  assert.equal(status.publicRegistration.started, false);
  assert.equal(fixture.compendiumCalls.length, 0);
  assert.equal(status.lastError?.message.includes("registerSourceName"), true);
  assert.equal(service.getStats().sourceRegistrationErrors, 1);
});

test("CAT pack registration failure is surfaced without attempting non-ready packs", async () => {
  const fixture = makeFixture({
    registerResults: (_pack, index) => index.map(() => false)
  });
  const readyId = "action-effects-5e.spells-level-2";
  const deferredId = "action-effects-5e.spells-level-1";
  const packs = new Map([
    [readyId, makePack(readyId, [makeIndexEntry({ id: "misty", identifier: "misty-step" })])],
    [deferredId, makePack(deferredId, [makeIndexEntry({ id: "entangle", identifier: "entangle", source: null, version: null })])]
  ]);
  const service = new CatAutomationRegistry({
    catAccessor: () => fixture.cat,
    hooksAccessor: () => fixture.hooks,
    packsAccessor: () => packs,
    publicPackIds: [readyId, deferredId]
  });

  service.initialize();
  await fixture.callbacks.get(CAT_READY_HOOK)();
  const status = service.getStatus();

  assert.equal(status.publicRegistration.complete, true);
  assert.equal(status.publicRegistration.registeredPacks.length, 0);
  assert.equal(status.publicRegistration.deferredPacks.length, 1);
  assert.equal(fixture.compendiumCalls.length, 1);
  assert.equal(service.getStats().packRegistrationErrors, 1);
  assert.equal(status.publicRegistration.failedPacks.length, 1);
  assert.equal(status.publicRegistration.failedPacks[0].id, readyId);
  assert.equal(status.lastError?.message.includes(readyId), true);
  assert.equal(status.stage, "public-registration-error");
});

test("CAT public registration can refresh after authoring metadata changes without a module reload", async () => {
  const fixture = makeFixture();
  const readyId = "action-effects-5e.spells-level-2";
  const deferredId = "action-effects-5e.spells-level-1";
  const readyEntries = [makeIndexEntry({ id: "misty", identifier: "misty-step" })];
  const deferredEntry = makeIndexEntry({ id: "entangle", identifier: "entangle", source: null, version: null });
  const deferredEntries = [deferredEntry];
  const packs = new Map([
    [readyId, makePack(readyId, readyEntries)],
    [deferredId, makePack(deferredId, deferredEntries)]
  ]);

  const service = new CatAutomationRegistry({
    catAccessor: () => fixture.cat,
    hooksAccessor: () => fixture.hooks,
    packsAccessor: () => packs,
    publicPackIds: [readyId, deferredId]
  });

  service.initialize();
  await fixture.callbacks.get(CAT_READY_HOOK)();
  assert.deepEqual(service.getStatus().publicRegistration.registeredPacks.map(entry => entry.id), [readyId]);
  assert.deepEqual(service.getStatus().publicRegistration.deferredPacks.map(entry => entry.id), [deferredId]);

  deferredEntry.flags = { cat: { automation: { source: CAT_AUTOMATION_SOURCE_ID, version: "1.0.0" } } };
  const refreshed = await service.refreshPublicCompendiums();

  assert.equal(refreshed.publicRegistration.complete, true);
  assert.deepEqual(refreshed.publicRegistration.registeredPacks.map(entry => entry.id), [readyId, deferredId]);
  assert.equal(refreshed.publicRegistration.deferredPacks.length, 0);
  assert.equal(refreshed.automationsRegistered, 2);
  assert.equal(service.getStats().publicRegistrationRefreshes, 1);
  assert.equal(service.getStats().publicRegistrationRefreshErrors, 0);
});

test("CAT public registration reconciliation repairs a cleared live provider registry", async () => {
  const fixture = makeFixture();
  const packId = "action-effects-5e.spells-level-2";
  const pack = makePack(packId, [makeIndexEntry({ id: "misty", identifier: "misty-step" })]);
  const service = new CatAutomationRegistry({
    catAccessor: () => fixture.cat,
    hooksAccessor: () => fixture.hooks,
    packsAccessor: () => new Map([[packId, pack]]),
    publicPackIds: [packId]
  });

  service.initialize();
  await fixture.callbacks.get(CAT_READY_HOOK)();
  assert.equal(service.getStatus().automationsRegistered, 1);

  // Simulate CAT runtime state being cleared after AE5E's successful catReady
  // registration while AE5E's cached pack state still says the pack is live.
  fixture.automations.clear();
  assert.equal(service.getStatus().automationsRegistered, 0);

  const reconciliation = await service.reconcilePublicCompendiums();
  assert.equal(reconciliation.repaired, true);
  assert.equal(reconciliation.expected, 1);
  assert.equal(reconciliation.actualBefore, 0);
  assert.equal(reconciliation.actualAfter, 1);
  assert.equal(service.getStatus().automationsRegistered, 1);
  assert.equal(service.getStats().publicRegistrationReconciliations, 1);
  assert.equal(service.getStats().publicRegistrationReconciliationRepairs, 1);
  assert.equal(service.getStats().publicRegistrationReconciliationErrors, 0);
});


test("CAT public registration forwards Item-authored configuration schemas to CAT by ruleset", async () => {
  const fixture = makeFixture();
  const packId = "action-effects-5e.spells-level-2";
  const configSchema = {
    playAnimation: {
      label: "Play Animations",
      type: "checkbox",
      default: true,
      category: "animation"
    }
  };
  const pack = makePack(packId, [makeIndexEntry({
    id: "misty",
    identifier: "misty-step",
    rules: "2014",
    configSchema
  })]);
  const service = new CatAutomationRegistry({
    catAccessor: () => fixture.cat,
    hooksAccessor: () => fixture.hooks,
    packsAccessor: () => new Map([[packId, pack]]),
    publicPackIds: [packId]
  });

  service.initialize();
  await fixture.callbacks.get(CAT_READY_HOOK)();

  assert.equal(fixture.compendiumCalls.length, 1);
  assert.deepEqual(fixture.compendiumCalls[0].configs2014["misty-step"], configSchema);
  assert.deepEqual(fixture.compendiumCalls[0].configs2024, {});
  assert.deepEqual(fixture.automations.get("Compendium.test.misty").config, configSchema);
  const registered = service.getStatus().publicRegistration.registeredPacks[0];
  assert.equal(registered.configurable, 1);
  assert.equal(registered.configurationOptions, 1);
});

test("CAT public registration defers packs with malformed Item-authored configuration data", async () => {
  const fixture = makeFixture();
  const packId = "action-effects-5e.spells-level-2";
  const pack = makePack(packId, [makeIndexEntry({
    id: "misty",
    identifier: "misty-step",
    configSchema: { playAnimation: { type: "checkbox", default: "yes" } }
  })]);
  const service = new CatAutomationRegistry({
    catAccessor: () => fixture.cat,
    hooksAccessor: () => fixture.hooks,
    packsAccessor: () => new Map([[packId, pack]]),
    publicPackIds: [packId]
  });

  service.initialize();
  await fixture.callbacks.get(CAT_READY_HOOK)();
  const status = service.getStatus();
  assert.equal(status.publicRegistration.registeredPacks.length, 0);
  assert.equal(status.publicRegistration.deferredPacks.length, 1);
  assert.equal(status.publicRegistration.deferredPacks[0].invalidItems[0].issues.some(issue => issue.includes("CAT configuration")), true);
  assert.equal(fixture.compendiumCalls.length, 0);
});
