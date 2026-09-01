import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  ENVIRONMENT_BEHAVIOR_TYPES,
  ENVIRONMENT_CAPABILITIES,
  ENVIRONMENT_DELIVERY_MODES,
  ENVIRONMENT_EVENT_TYPES,
  ENVIRONMENT_FLAG_KEY,
  MODULE_ID
} from "../scripts/core/constants.js";
import { EnvironmentCapabilityRegistry } from "../scripts/environment/environment-capability-registry.js";
import { EnvironmentProfileRegistry } from "../scripts/environment/environment-profile-registry.js";
import { EnvironmentGeometryService } from "../scripts/environment/environment-geometry-service.js";
import { EnvironmentMutationService } from "../scripts/environment/environment-mutation-service.js";
import { EnvironmentTimingService } from "../scripts/environment/environment-timing-service.js";
import { MidiEnvironmentAdapter } from "../scripts/environment/midi-environment-adapter.js";

function makeScene() {
  return {
    documentName: "Scene",
    id: "scene-test",
    uuid: "Scene.scene-test",
    grid: { size: 100, distance: 5 },
    dimensions: { size: 100, distance: 5 }
  };
}

test("module manifest and public API wire the Flammable RegionBehavior foundation", () => {
  const manifest = JSON.parse(fs.readFileSync(new URL("../module.json", import.meta.url), "utf8"));
  const apiSource = fs.readFileSync(new URL("../scripts/api.js", import.meta.url), "utf8");
  const mainSource = fs.readFileSync(new URL("../scripts/action-effects-5e.js", import.meta.url), "utf8");
  assert.equal(manifest.version, "0.4.3.2");
  assert.deepEqual(manifest.documentTypes?.RegionBehavior?.flammable, {});
  assert.match(apiSource, /this\.environment = Object\.freeze/);
  assert.match(apiSource, /runEnvironmentalAcceptanceTest/);
  assert.match(apiSource, /environment:\s*Object\.freeze/);
  assert.match(apiSource, /runAll:\s*\(options\)\s*=>\s*tests\.runEnvironmentalAcceptanceTest/);
  assert.match(apiSource, /runEnvironmentalFoundationTest/);
  assert.match(apiSource, /runEnvironmentalLiveLifecycleTest/);
  assert.match(apiSource, /runEnvironmentalPerformanceTest/);
  assert.match(mainSource, /environmentBehaviors\.initialize\(\)/);
  assert.match(mainSource, /midiEnvironment\.initialize\(\)/);
  assert.match(mainSource, /environmentTiming\.initialize\(\)/);
});

test("environment capability and profile registries are generic extension seams", () => {
  const capabilities = new EnvironmentCapabilityRegistry();
  const profiles = new EnvironmentProfileRegistry();
  const handler = () => null;
  const unregisterCapability = capabilities.register({
    id: ENVIRONMENT_CAPABILITIES.FLAMMABLE,
    behaviorType: ENVIRONMENT_BEHAVIOR_TYPES.FLAMMABLE,
    eventTypes: [ENVIRONMENT_EVENT_TYPES.FIRE],
    handler
  });
  const unregisterProfile = profiles.register(ENVIRONMENT_CAPABILITIES.FLAMMABLE, "web-test", {
    label: "Web Test",
    react: () => ({ handled: true })
  });

  assert.equal(capabilities.hasEventConsumers("fire"), true);
  assert.equal(capabilities.getForBehaviorType(ENVIRONMENT_BEHAVIOR_TYPES.FLAMMABLE)?.id, "flammable");
  assert.equal(profiles.get("flammable", "web-test")?.label, "Web Test");
  assert.throws(() => profiles.register("flammable", "web-test", { react: () => null }), /already registered/);
  assert.equal(unregisterProfile(), true);
  assert.equal(unregisterCapability(), true);
  assert.equal(capabilities.hasEventConsumers("fire"), false);
});

test("Region-native geometry respects carved hole shapes", () => {
  const geometry = new EnvironmentGeometryService();
  const regionGeometry = geometry.normalize({
    ae5eEnvironmentGeometry: 1,
    source: "test-region",
    sceneUuid: "Scene.scene-test",
    shapes: [
      geometry.createRectangle({ x: 0, y: 0, width: 200, height: 100 }),
      geometry.createRectangle({ x: 50, y: 0, width: 50, height: 100, hole: true })
    ]
  });

  assert.equal(geometry.containsPoint(regionGeometry, { x: 25, y: 50 }), true);
  assert.equal(geometry.containsPoint(regionGeometry, { x: 75, y: 50 }), false);
  assert.equal(geometry.containsPoint(regionGeometry, { x: 150, y: 50 }), true);
  assert.equal(geometry.intersects(geometry.fromPoint({ x: 25, y: 50 }), regionGeometry), true);
  assert.equal(geometry.intersects(geometry.fromPoint({ x: 75, y: 50 }), regionGeometry), false);
});

test("MeasuredTemplate geometry is isolated behind a compatibility adapter", () => {
  const geometry = new EnvironmentGeometryService();
  const scene = makeScene();
  const template = {
    documentName: "MeasuredTemplate",
    uuid: "Scene.scene-test.MeasuredTemplate.fire",
    parent: scene,
    t: "circle",
    x: 200,
    y: 300,
    distance: 20,
    elevation: 0
  };
  const normalized = geometry.fromMeasuredTemplate(template, { scene });
  assert.equal(normalized.source, "measured-template-compatibility");
  assert.equal(normalized.documentUuid, template.uuid);
  assert.equal(normalized.shapes[0].type, "circle");
  assert.equal(normalized.shapes[0].radius, 400);
});

test("environment mutations batch state and hole changes into one Region update", async () => {
  const mutation = new EnvironmentMutationService();
  const updates = [];
  globalThis.game = { user: { isGM: true } };
  const region = {
    uuid: "Scene.scene-test.Region.region-test",
    flags: {},
    toObject: () => ({
      flags: {},
      shapes: [{ type: "rectangle", x: 0, y: 0, width: 200, height: 100 }]
    }),
    async update(data, options) {
      updates.push({ data, options });
      this.flags = data[`flags.${MODULE_ID}.${ENVIRONMENT_FLAG_KEY}`]
        ? { [MODULE_ID]: { [ENVIRONMENT_FLAG_KEY]: data[`flags.${MODULE_ID}.${ENVIRONMENT_FLAG_KEY}`] } }
        : this.flags;
    }
  };
  const behavior = { id: "behavior-1" };
  const capability = { id: "flammable" };
  const profile = { profileId: "web-test" };
  const hole = { type: "rectangle", x: 0, y: 0, width: 100, height: 100, hole: true };
  const event = { id: "fire-event" };

  const result = await mutation.apply(region, [
    { behavior, capability, profile, reaction: {
      handled: true,
      state: { status: "burning" },
      addHoles: [hole],
      scheduleTimers: [{ id: "burn-away", handlerId: "web.burn-away", due: { realTimeMs: 12345 }, payload: { cell: "0,0" } }]
    } },
    { behavior, capability, profile, reaction: { handled: true, addHoles: [hole] } }
  ], event);

  assert.equal(result.updated, true);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].data.shapes.length, 2);
  const state = updates[0].data[`flags.${MODULE_ID}.${ENVIRONMENT_FLAG_KEY}`].states[behavior.id];
  assert.equal(state.status, "burning");
  assert.equal(state.lastEventId, "fire-event");
  const timer = updates[0].data[`flags.${MODULE_ID}.${ENVIRONMENT_FLAG_KEY}`].timers["burn-away"];
  assert.equal(timer.handlerId, "web.burn-away");
  assert.equal(timer.behaviorId, behavior.id);
  assert.equal(timer.payload.cell, "0,0");
});


test("AE5E rectangle helper emits current Foundry v14 anchor schema while preserving top-left footprint", () => {
  const geometry = new EnvironmentGeometryService();
  const rectangle = geometry.createRectangle({ x: 20, y: 40, width: 200, height: 100, rotation: 0 });

  assert.deepEqual(rectangle, {
    type: "rectangle",
    x: 120,
    y: 90,
    width: 200,
    height: 100,
    rotation: 0,
    anchorX: 0.5,
    anchorY: 0.5,
    gridBased: false,
    hole: false
  });

  const normalized = geometry.normalize({ source: "v14-rectangle", shapes: [rectangle] });
  assert.equal(geometry.containsPoint(normalized, { x: 20, y: 40 }), true);
  assert.equal(geometry.containsPoint(normalized, { x: 220, y: 140 }), true);
  assert.equal(geometry.containsPoint(normalized, { x: 10, y: 40 }), false);
  assert.deepEqual(normalized.bounds, { minX: 20, minY: 40, maxX: 220, maxY: 140 });
});

test("environment timer cancellation uses Foundry v14 forced replacement so removed keys stay removed", async () => {
  const mutation = new EnvironmentMutationService();
  const path = `flags.${MODULE_ID}.${ENVIRONMENT_FLAG_KEY}`;
  const previousGame = globalThis.game;
  const previousReplace = globalThis._replace;
  globalThis.game = { user: { isGM: true } };
  globalThis._replace = value => ({ __ae5eForcedReplacement: true, value });

  const region = {
    uuid: "Scene.scene-test.Region.timer-replacement",
    flags: {
      [MODULE_ID]: {
        [ENVIRONMENT_FLAG_KEY]: {
          schemaVersion: 1,
          states: {},
          timers: {
            "burn-away": { id: "burn-away", handlerId: "web.burn-away", due: { realTimeMs: 1 } }
          }
        }
      }
    },
    toObject() {
      return {
        flags: structuredClone(this.flags),
        shapes: [{ type: "rectangle", x: 0, y: 0, width: 200, height: 100 }]
      };
    },
    async update(data) {
      const replacement = data[path];
      assert.equal(replacement?.__ae5eForcedReplacement, true);
      this.flags[MODULE_ID][ENVIRONMENT_FLAG_KEY] = structuredClone(replacement.value);
    }
  };

  try {
    const result = await mutation.apply(region, [{
      behavior: { id: "behavior-1" },
      capability: { id: "flammable" },
      profile: { profileId: "web-test" },
      reaction: { handled: true, cancelTimers: ["burn-away"] }
    }], { id: "timer-complete" });

    assert.equal(result.updated, true);
    assert.equal("burn-away" in region.flags[MODULE_ID][ENVIRONMENT_FLAG_KEY].timers, false);
    assert.equal(mutation.getStats().forcedFlagReplacements, 1);
  } finally {
    globalThis.game = previousGame;
    globalThis._replace = previousReplace;
  }
});

test("Foundry-cleaned Region rectangle defaults do not defeat repeated-hole de-duplication", async () => {
  const mutation = new EnvironmentMutationService();
  const geometry = new EnvironmentGeometryService();
  const previousGame = globalThis.game;
  const previousFoundry = globalThis.foundry;
  globalThis.game = { user: { isGM: true } };

  const cleanRectangle = source => ({
    type: "rectangle",
    hole: Boolean(source.hole),
    x: Number(source.x ?? 0),
    y: Number(source.y ?? 0),
    width: Number(source.width ?? 0),
    height: Number(source.height ?? 0),
    rotation: Number(source.rotation ?? 0),
    anchorX: Number(source.anchorX ?? 0),
    anchorY: Number(source.anchorY ?? 0),
    gridBased: Boolean(source.gridBased ?? false)
  });
  globalThis.foundry = {
    ...(previousFoundry ?? {}),
    data: {
      ...(previousFoundry?.data ?? {}),
      RectangleShapeData: {
        ...(previousFoundry?.data?.RectangleShapeData ?? {}),
        TYPES: { rectangle: { cleanData: cleanRectangle } }
      }
    }
  };

  let updates = 0;
  const persistedHole = {
    type: "rectangle",
    hole: true,
    x: 50,
    y: 50,
    width: 100,
    height: 100,
    rotation: 0,
    anchorX: 0.5,
    anchorY: 0.5,
    gridBased: false
  };
  const region = {
    uuid: "Scene.scene-test.Region.shape-dedupe",
    flags: {},
    toObject: () => ({
      flags: {},
      shapes: [
        { type: "rectangle", x: 0, y: 0, width: 200, height: 100 },
        persistedHole
      ]
    }),
    async update() { updates += 1; }
  };

  try {
    const result = await mutation.apply(region, [{
      behavior: { id: "behavior-1" },
      capability: { id: "flammable" },
      profile: { profileId: "web-test" },
      reaction: {
        handled: true,
        addHoles: [geometry.createRectangle({ x: 0, y: 0, width: 100, height: 100, hole: true })]
      }
    }], { id: "repeat-hole" });

    assert.equal(result.updated, false);
    assert.equal(result.reason, "reaction-noop");
    assert.equal(updates, 0);
    assert.equal(mutation.getStats().holeDedupes, 1);
  } finally {
    globalThis.game = previousGame;
    globalThis.foundry = previousFoundry;
  }
});

test("legacy concise rectangle holes migrate to the same v14 anchored geometry before de-duplication", async () => {
  const mutation = new EnvironmentMutationService();
  const previousGame = globalThis.game;
  const previousFoundry = globalThis.foundry;
  globalThis.game = { user: { isGM: true } };

  const migrateRectangle = source => {
    const migrated = structuredClone(source);
    if (migrated.anchorX === undefined || migrated.anchorY === undefined) {
      migrated.x = Number(migrated.x ?? 0) + Number(migrated.width ?? 0) / 2;
      migrated.y = Number(migrated.y ?? 0) + Number(migrated.height ?? 0) / 2;
      migrated.anchorX = 0.5;
      migrated.anchorY = 0.5;
      migrated.gridBased = false;
    }
    return migrated;
  };
  const cleanRectangle = source => ({
    type: "rectangle",
    hole: Boolean(source.hole),
    x: Number(source.x ?? 0),
    y: Number(source.y ?? 0),
    width: Number(source.width ?? 0),
    height: Number(source.height ?? 0),
    rotation: Number(source.rotation ?? 0),
    anchorX: Number(source.anchorX ?? 0.5),
    anchorY: Number(source.anchorY ?? 0.5),
    gridBased: Boolean(source.gridBased ?? false)
  });
  globalThis.foundry = {
    ...(previousFoundry ?? {}),
    data: {
      ...(previousFoundry?.data ?? {}),
      RectangleShapeData: {
        ...(previousFoundry?.data?.RectangleShapeData ?? {}),
        TYPES: { rectangle: { migrateDataSafe: migrateRectangle, cleanData: cleanRectangle } }
      }
    }
  };

  let updates = 0;
  const region = {
    uuid: "Scene.scene-test.Region.legacy-shape-dedupe",
    flags: {},
    toObject: () => ({
      flags: {},
      shapes: [
        { type: "rectangle", x: 100, y: 50, width: 200, height: 100, rotation: 0, anchorX: 0.5, anchorY: 0.5, gridBased: false, hole: false },
        { type: "rectangle", x: 50, y: 50, width: 100, height: 100, rotation: 0, anchorX: 0.5, anchorY: 0.5, gridBased: false, hole: true }
      ]
    }),
    async update() { updates += 1; }
  };

  try {
    const result = await mutation.apply(region, [{
      behavior: { id: "behavior-1" },
      capability: { id: "flammable" },
      profile: { profileId: "legacy-web-test" },
      reaction: {
        handled: true,
        addHoles: [{ type: "rectangle", x: 0, y: 0, width: 100, height: 100, rotation: 0, hole: true }]
      }
    }], { id: "legacy-repeat-hole" });

    assert.equal(result.updated, false);
    assert.equal(result.reason, "reaction-noop");
    assert.equal(updates, 0);
    assert.equal(mutation.getStats().holeDedupes, 1);
  } finally {
    globalThis.game = previousGame;
    globalThis.foundry = previousFoundry;
  }
});

test("environment timing supports persistent real-time, world-time, and combat-position deadlines", () => {
  const timing = new EnvironmentTimingService({ authority: null, mutations: null });
  assert.equal(timing.isDue({ due: { realTimeMs: 100 } }, { nowMs: 100, worldTime: 0, combat: null }), true);
  assert.equal(timing.isDue({ due: { realTimeMs: 101 } }, { nowMs: 100, worldTime: 0, combat: null }), false);
  assert.equal(timing.isDue({ due: { worldTime: 50 } }, { nowMs: 0, worldTime: 50, combat: null }), true);
  const combat = { uuid: "Combat.test", round: 5, turn: 2 };
  assert.equal(timing.isDue({ due: { combat: { combatUuid: "Combat.test", round: 5, turn: 2 } } }, { combat, nowMs: 0, worldTime: 0 }), true);
  assert.equal(timing.isDue({ due: { combat: { combatUuid: "Combat.test", round: 5, turn: 3 } } }, { combat, nowMs: 0, worldTime: 0 }), false);
});

test("non-fire Midi workflows early-exit before consulting the Region index", () => {
  const geometry = new EnvironmentGeometryService();
  let consumerChecks = 0;
  const environment = {
    hasConsumers: () => { consumerChecks += 1; return true; },
    emit: async () => ({ processed: true })
  };
  const adapter = new MidiEnvironmentAdapter({ environment, geometry });
  const events = adapter.interpretWorkflow({
    id: "workflow-slashing",
    rawDamageDetail: [{ type: "slashing", value: 7 }],
    item: { system: { actionType: "mwak" } },
    activity: { hasAttack: true },
    hitTargets: new Set()
  });
  assert.deepEqual(events, []);
  assert.equal(consumerChecks, 0);
});

test("Midi fire attacks are interpreted without Item modification and misses do not ignite", () => {
  const geometry = new EnvironmentGeometryService();
  const environment = {
    hasConsumers: () => true,
    emit: async () => ({ processed: true })
  };
  const adapter = new MidiEnvironmentAdapter({ environment, geometry });
  const scene = makeScene();
  const target = {
    uuid: "Scene.scene-test.Token.target",
    center: { x: 250, y: 350 },
    document: {
      uuid: "Scene.scene-test.Token.target",
      x: 200,
      y: 300,
      width: 1,
      height: 1,
      elevation: 0,
      parent: scene
    }
  };
  const baseWorkflow = {
    id: "workflow-fire-weapon",
    rawDamageDetail: [{ type: "fire", value: 4 }],
    item: { uuid: "Actor.a.Item.flame-sword", system: { actionType: "mwak" }, flags: {} },
    activity: { uuid: "Actor.a.Item.flame-sword.Activity.attack", hasAttack: true },
    token: { document: { parent: scene, uuid: "Scene.scene-test.Token.attacker" } },
    hitTargets: new Set([target]),
    targets: new Set([target])
  };

  const hitEvents = adapter.interpretWorkflow(baseWorkflow);
  assert.equal(hitEvents.length, 1);
  assert.equal(hitEvents[0].type, ENVIRONMENT_EVENT_TYPES.FIRE);
  assert.equal(hitEvents[0].delivery, ENVIRONMENT_DELIVERY_MODES.IMPACT);
  assert.equal(hitEvents[0].geometry.shapes[0].type, "point");
  assert.equal(baseWorkflow.item.flags[MODULE_ID], undefined, "source Item remains untouched");

  const missEvents = adapter.interpretWorkflow({ ...baseWorkflow, id: "workflow-miss", hitTargets: new Set() });
  assert.equal(missEvents.length, 0);
});

test("Midi area fire prefers native Region geometry and uses raw fire even when final damage could be zero", () => {
  const geometry = new EnvironmentGeometryService();
  const environment = { hasConsumers: () => true, emit: async () => ({ processed: true }) };
  const adapter = new MidiEnvironmentAdapter({ environment, geometry });
  const scene = makeScene();
  const sourceRegion = {
    documentName: "Region",
    uuid: "Scene.scene-test.Region.fireball-template",
    parent: scene,
    elevation: { bottom: 0, top: 20 },
    shapes: [{ type: "ellipse", x: 400, y: 400, radiusX: 400, radiusY: 400 }],
    toObject: () => ({ elevation: { bottom: 0, top: 20 }, shapes: [{ type: "ellipse", x: 400, y: 400, radiusX: 400, radiusY: 400 }] })
  };
  const previousFromUuidSync = globalThis.fromUuidSync;
  globalThis.fromUuidSync = uuid => uuid === sourceRegion.uuid ? sourceRegion : null;
  try {
    const events = adapter.interpretWorkflow({
      id: "workflow-fireball",
      rawDamageDetail: [{ type: "fire", value: 0 }],
      damageDetail: [{ type: "fire", value: 0, active: { resistance: true } }],
      item: { uuid: "Actor.a.Item.fireball", flags: {} },
      activity: { uuid: "Actor.a.Item.fireball.Activity.cast", hasAttack: false },
      token: { document: { parent: scene, uuid: "Scene.scene-test.Token.caster" } },
      templateUuid: sourceRegion.uuid,
      templateUuids: [sourceRegion.uuid],
      targets: new Set()
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].delivery, ENVIRONMENT_DELIVERY_MODES.AREA);
    assert.equal(events[0].geometry.source, "region");
    assert.equal(events[0].geometry.documentUuid, sourceRegion.uuid);
  } finally {
    globalThis.fromUuidSync = previousFromUuidSync;
  }
});

test("live v14 Region shape polygons normalize unsupported native shape families without reimplementing Foundry math", () => {
  const geometry = new EnvironmentGeometryService();
  const scene = makeScene();
  const gridShape = {
    hole: false,
    polygons: [{ points: [0, 0, 100, 0, 100, 100, 0, 100] }],
    toObject: () => ({ type: "grid", hole: false })
  };
  const region = {
    documentName: "Region",
    uuid: "Scene.scene-test.Region.native-grid",
    parent: scene,
    shapes: [gridShape],
    toObject: () => ({ shapes: [{ type: "grid", hole: false }] })
  };

  const normalized = geometry.fromRegion(region);
  assert.equal(normalized.shapes.length, 1);
  assert.equal(normalized.shapes[0].type, "polygon");
  assert.equal(geometry.containsPoint(normalized, { x: 50, y: 50 }), true);
  assert.equal(geometry.containsPoint(normalized, { x: 150, y: 50 }), false);
});

test("plain v14 cone source data accepts the native radius field", () => {
  const geometry = new EnvironmentGeometryService();
  const normalized = geometry.normalize({
    source: "native-cone",
    shapes: [{ type: "cone", x: 0, y: 0, radius: 100, angle: 90, direction: 0 }]
  });
  assert.equal(normalized.shapes[0].type, "cone");
  assert.equal(normalized.shapes[0].distance, 100);
  assert.equal(geometry.containsPoint(normalized, { x: 50, y: 0 }), true);
});

test("completed environmental timers are always consumed even when a handler returns handled false", async () => {
  const applied = [];
  const mutations = {
    async apply(region, entries, event) {
      applied.push({ region, entries, event });
      return { updated: true };
    }
  };
  const timing = new EnvironmentTimingService({ authority: null, mutations });
  const timerId = "test-timer";
  const handlerId = "test.timer";
  const region = {
    uuid: "Scene.scene-test.Region.timer",
    behaviors: [{ id: "behavior-1" }],
    flags: {
      [MODULE_ID]: {
        [ENVIRONMENT_FLAG_KEY]: {
          timers: {
            [timerId]: {
              handlerId,
              behaviorId: "behavior-1",
              capabilityId: "flammable",
              profileId: "generic",
              due: { realTimeMs: 1 },
              payload: {}
            }
          }
        }
      }
    }
  };
  const previousGame = globalThis.game;
  const previousFromUuid = globalThis.fromUuid;
  globalThis.game = { user: { isGM: true }, combat: null, time: { worldTime: 0 } };
  globalThis.fromUuid = async uuid => uuid === region.uuid ? region : null;
  try {
    timing.registerHandler(handlerId, async () => ({ handled: false }));
    const result = await timing.processDue({ regionUuids: [region.uuid] });
    assert.equal(result.fired, 1);
    assert.equal(applied.length, 1);
    assert.equal(applied[0].entries[0].reaction.handled, true);
    assert.deepEqual(applied[0].entries[0].reaction.cancelTimers, [timerId]);
  } finally {
    globalThis.game = previousGame;
    globalThis.fromUuid = previousFromUuid;
  }
});
