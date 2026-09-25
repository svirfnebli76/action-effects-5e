import test from "node:test";
import assert from "node:assert/strict";

import {
  Crosshair3dIntegrationService,
  CROSSHAIR_3D_CONFIGURATION_SCHEMA_VERSION,
  CROSSHAIR_3D_CONFIGURATION_FLAG,
  CROSSHAIR_3D_CAT_PROPAGATION_KEY
} from "../scripts/crosshairs3d/integration-service.js";
import { Crosshair3dPropagationModeService } from "../scripts/crosshairs3d/propagation-mode-service.js";
import { MODULE_ID } from "../scripts/core/constants.js";

function document(uuid, config, parent = null) {
  return {
    uuid,
    parent,
    flags: config == null ? {} : { [MODULE_ID]: { [CROSSHAIR_3D_CONFIGURATION_FLAG]: structuredClone(config) } },
    getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
  };
}

function fixture({ placementResult = { cancelled: false, targetIds: ["target"], shape: { type: "sphere" } } } = {}) {
  globalThis.foundry = { utils: { deepClone: value => structuredClone(value) } };
  delete globalThis.cat;
  const calls = [];
  const placement = {
    async show(options) {
      calls.push(options);
      if (placementResult instanceof Error) throw placementResult;
      return structuredClone(placementResult);
    }
  };
  const service = new Crosshair3dIntegrationService({
    placement,
    propagationModes: new Crosshair3dPropagationModeService()
  });
  return { service, calls };
}

function baseConfig(overrides = {}) {
  return {
    schemaVersion: CROSSHAIR_3D_CONFIGURATION_SCHEMA_VERSION,
    shape: { type: "sphere", radius: 20 },
    range: { max: 60 },
    capabilities: { elevation: true, rotation: false },
    propagation: { mode: "direct" },
    persistent: { enabled: false },
    ...overrides
  };
}

test("Item, Activity, explicit configuration, and runtime overrides merge in documented precedence", async () => {
  const f = fixture();
  const item = document("Item.item", baseConfig({ range: { max: 30 }, capabilities: { elevation: false } }));
  const activity = document("Item.item.Activity.cast", {
    schemaVersion: 1,
    range: { max: 45 },
    capabilities: { elevation: true }
  }, item);
  activity.item = item;
  const resolved = await f.service.resolve({
    activity,
    configuration: { schemaVersion: 1, range: { max: 60 } },
    overrides: { range: { max: 90 }, persistent: { enabled: true } },
    readCat: false
  });

  assert.equal(resolved.options.range.max, 90);
  assert.equal(resolved.options.capabilities.elevation, true);
  assert.equal(resolved.options.persistent.enabled, true);
  assert.deepEqual(resolved.provenance.sources, [
    "item-flag", "activity-flag", "explicit-configuration", "runtime-overrides"
  ]);
  assert.equal(resolved.provenance.itemUuid, item.uuid);
  assert.equal(resolved.provenance.activityUuid, activity.uuid);
  assert.equal(item.flags[MODULE_ID][CROSSHAIR_3D_CONFIGURATION_FLAG].range.max, 30, "stored Item data is immutable input");
});

test("inspection and resolution never recursively traverse or freeze circular Foundry Documents", async () => {
  const f = fixture({ placementResult: { cancelled: false, targets: [] } });
  const item = document("Item.circular", baseConfig());
  const folder = { name: "Folder", contents: [item] };
  item.folder = folder;
  item.parent = { items: [item] };
  const inspected = f.service.inspect({ item });
  assert.equal(inspected.valid, true);
  assert.equal(inspected.itemUuid, item.uuid);
  assert.equal(Object.hasOwn(inspected, "item"), false);
  assert.equal(Object.isFrozen(item), false);
  assert.equal(Object.isFrozen(folder), false);

  const resolved = await f.service.resolve({ item, readCat: false });
  assert.equal(resolved.provenance.itemUuid, item.uuid);
  assert.equal(Object.isFrozen(item), false);
});

test("CAT Item configuration uses the live cat.utils.automationUtils API path", async () => {
  const f = fixture();
  const item = document("Item.item", baseConfig());
  const reads = [];
  const automationUtils = { async getConfigValue(documentArg, key) {
    assert.equal(this, automationUtils, "CAT utility receiver is preserved");
    reads.push([documentArg, key]);
    return "spread";
  } };
  globalThis.cat = { api: {}, lib: {}, utils: { automationUtils } };

  const resolved = await f.service.resolve({ item });
  assert.equal(resolved.provenance.propagation.itemDefault, "direct");
  assert.equal(resolved.provenance.propagation.override, "spread");
  assert.equal(resolved.provenance.propagation.mode, "spread");
  assert.equal(resolved.provenance.propagation.source, "cat-item-configuration");
  assert.deepEqual(reads, [[item, CROSSHAIR_3D_CAT_PROPAGATION_KEY]]);
  assert.equal(f.service.getStats().catReads, 1);
});

test("the early direct CAT utility path remains a compatibility fallback", async () => {
  const f = fixture();
  const item = document("Item.item", baseConfig());
  globalThis.cat = { automationUtils: { getConfigValue() { return "none"; } } };
  const resolved = await f.service.resolve({ item });
  assert.equal(resolved.provenance.propagation.mode, "none");
  assert.equal(resolved.provenance.propagation.source, "cat-item-configuration");
});

test("explicit CAT options support default, none, direct, and spread without consulting CAT", async () => {
  for (const [override, expected] of [["default", "direct"], ["none", "none"], ["direct", "direct"], ["spread", "spread"]]) {
    const f = fixture();
    const item = document("Item.item", baseConfig());
    let reads = 0;
    globalThis.cat = { utils: { automationUtils: { getConfigValue() { reads += 1; return "none"; } } } };
    const resolved = await f.service.resolve({ item, catOptions: { propagation: override } });
    assert.equal(resolved.provenance.propagation.mode, expected);
    assert.equal(reads, 0);
  }
});

test("invalid CAT overrides fail clearly before placement and count as validation failures", async () => {
  const f = fixture();
  await assert.rejects(
    f.service.show({
      source: { id: "source" },
      configuration: baseConfig(),
      catOptions: { propagation: "teleport" }
    }),
    /Invalid CAT 3D propagation override 'teleport'/
  );
  assert.equal(f.calls.length, 0);
  assert.equal(f.service.getStats().validationFailures, 1);
});

test("missing or failed CAT reads retain the Item default and expose diagnostics", async () => {
  const missing = fixture();
  const missingResult = await missing.service.resolve({
    item: document("Item.item", baseConfig())
  });
  assert.equal(missingResult.provenance.propagation.mode, "direct");
  assert.equal(missingResult.provenance.propagation.overrideSource, "default");

  const failed = fixture();
  globalThis.cat = { utils: { automationUtils: { getConfigValue() { throw new Error("synthetic CAT read failure"); } } } };
  const failedResult = await failed.service.resolve({
    item: document("Item.item", baseConfig())
  });
  assert.equal(failedResult.provenance.propagation.mode, "direct");
  assert.equal(failedResult.provenance.propagation.overrideSource, "cat-read-failed");
  assert.equal(failed.service.getStats().catReads, 1);
  assert.equal(failed.service.getStats().catReadFailures, 1);
});

test("CAT propagation descriptor is valid CAT select configuration data", () => {
  const f = fixture();
  const descriptor = f.service.getCatPropagationConfig();
  assert.equal(descriptor.type, "select");
  assert.equal(descriptor.default, "default");
  assert.deepEqual(descriptor.options.map(option => option.value), ["default", "none", "direct", "spread"]);
});

test("unsupported and malformed configurations fail before a placement session begins", async () => {
  const f = fixture();
  const inspected = f.service.inspect({ configuration: {
    schemaVersion: 99,
    shape: {},
    range: { max: 0 },
    capabilities: { los: "sometimes" },
    controls: [],
    placement: "center",
    propagation: { mode: "teleport" },
    persistent: { enabled: "sometimes" },
    unsupportedFutureField: true
  } });
  assert.equal(inspected.valid, false);
  assert.ok(inspected.errors.some(error => error.includes("schemaVersion")));
  assert.ok(inspected.errors.some(error => error.includes("shape.type")));
  assert.ok(inspected.errors.some(error => error.includes("range.max")));
  assert.ok(inspected.errors.some(error => error.includes("capabilities.los")));
  assert.ok(inspected.errors.some(error => error.includes("controls")));
  assert.ok(inspected.errors.some(error => error.includes("placement")));
  assert.ok(inspected.errors.some(error => error.includes("teleport")));
  assert.ok(inspected.errors.some(error => error.includes("persistent.enabled")));
  assert.ok(inspected.errors.some(error => error.includes("unsupportedFutureField")));
  await assert.rejects(f.service.resolve({ configuration: inspected.configuration }), /Invalid Action Effects 3D Crosshairs configuration/);
  assert.equal(f.calls.length, 0);
});

test("configured.show publishes sanitized provenance and forwards only approved runtime callbacks", async () => {
  const target = { id: "target" };
  target.document = { object: target };
  const f = fixture({ placementResult: {
    cancelled: false,
    targetIds: ["target"],
    targets: [target],
    shape: { type: "sphere" }
  } });
  const item = document("Item.item", baseConfig());
  const source = { id: "source" };
  const onRevision = () => {};
  const targetFilter = () => true;
  const result = await f.service.show({
    source,
    item,
    catOptions: { propagation: "none" },
    runtime: { onRevision, targetFilter, unsafe: "discard" }
  });

  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].source, source);
  assert.equal(f.calls[0].onRevision, onRevision);
  assert.equal(f.calls[0].targetFilter, targetFilter);
  assert.equal(f.calls[0].unsafe, undefined);
  assert.equal(f.calls[0].propagation.itemDefault, "direct");
  assert.equal(f.calls[0].propagation.override, "none");
  assert.equal(result.provenance.propagation.mode, "none");
  assert.equal(Object.hasOwn(result.provenance, "item"), false, "provenance never publishes a live Document");
  assert.equal(result.targets[0].id, target.id);
  assert.equal(Object.isFrozen(result.targets[0]), false, "live Token references are never recursively frozen");
  assert.equal(f.service.getStats().confirmed, 1);
  assert.equal(f.service.getRecent().at(-1).type, "confirmed");
});

test("configured placement cancellation and errors remain observable without retaining live objects", async () => {
  const cancelled = fixture({ placementResult: { cancelled: true, targets: [] } });
  const result = await cancelled.service.show({ source: { id: "source" }, configuration: baseConfig(), readCat: false });
  assert.equal(result.cancelled, true);
  assert.equal(cancelled.service.getStats().cancelled, 1);

  const failed = fixture({ placementResult: new Error("synthetic placement failure") });
  await assert.rejects(
    failed.service.show({ source: { id: "source" }, configuration: baseConfig(), readCat: false }),
    /synthetic placement failure/
  );
  assert.equal(failed.service.getStats().errors, 1);
  assert.equal(failed.service.getRecent().at(-1).message, "synthetic placement failure");
});

test("the production contract uses explicit flags and never depends on D&D5e system internals", async () => {
  const f = fixture();
  const item = document("Item.item", baseConfig());
  Object.defineProperty(item, "system", { get() { throw new Error("system internals must not be read"); } });
  const resolved = await f.service.resolve({ item, readCat: false });
  assert.equal(resolved.options.shape.type, "sphere");
  assert.equal(resolved.provenance.itemUuid, "Item.item");
});

test("stored Cone Spread configuration is invalid and cannot reach placement", async () => {
  const f = fixture();
  const configuration = baseConfig({
    shape: { type: "cone", length: 15 },
    propagation: { mode: "spread" }
  });
  const inspected = f.service.inspect({ configuration });
  assert.equal(inspected.valid, false);
  assert.ok(inspected.errors.some(error => error.includes("Cone does not support Spread propagation")));
  await assert.rejects(
    f.service.show({ source: { id: "source" }, configuration, readCat: false }),
    /Cone does not support Spread propagation/
  );
  assert.equal(f.calls.length, 0);
});

test("CAT cannot override a valid Cone configuration to Spread", async () => {
  const f = fixture();
  const configuration = baseConfig({
    shape: { type: "cone", length: 15 },
    propagation: { mode: "direct" }
  });
  await assert.rejects(
    f.service.resolve({ configuration, catOptions: { propagation: "spread" } }),
    /Cone does not support Spread propagation/
  );
  assert.equal(f.service.getStats().validationFailures, 1);
});

test("Cone CAT authoring descriptor omits Spread while the generic descriptor remains unchanged", () => {
  const f = fixture();
  assert.deepEqual(
    f.service.getCatPropagationConfig({ shapeType: "cone" }).options.map(option => option.value),
    ["default", "none", "direct"]
  );
  assert.deepEqual(
    f.service.getCatPropagationConfig().options.map(option => option.value),
    ["default", "none", "direct", "spread"]
  );
});

test("Cone None and Direct remain valid configured propagation modes", async () => {
  for (const mode of ["none", "direct"]) {
    const f = fixture();
    const resolved = await f.service.resolve({
      configuration: baseConfig({
        shape: { type: "cone", length: 15 },
        propagation: { mode }
      }),
      readCat: false
    });
    assert.equal(resolved.provenance.propagation.mode, mode);
  }
});
