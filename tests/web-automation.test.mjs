import assert from "node:assert/strict";
import test from "node:test";

import {
  ENVIRONMENT_BEHAVIOR_TYPES,
  ENVIRONMENT_CAPABILITIES,
  MODULE_ID,
  ONGOING_ACTION_EFFECT_FLAG,
  ONGOING_ACTION_ITEM_FLAG,
  WEB_BURN_TIMER_HANDLER,
  WEB_FLAG_KEY,
  WEB_PROFILE_ID
} from "../scripts/core/constants.js";
import { ActivityExecutionService } from "../scripts/activities/activity-execution-service.js";
import { EnvironmentGeometryService } from "../scripts/environment/environment-geometry-service.js";
import { OngoingEffectService } from "../scripts/ongoing-effects/ongoing-effect-service.js";
import { WebService } from "../scripts/environment/web-service.js";

class FakeSocket {
  constructor() { this.handlers = new Map(); this.userCalls = []; }
  register(name, handler) { this.handlers.set(name, handler); }
  async executeAsUser(name, userId, payload) {
    this.userCalls.push({ name, userId, payload });
    return this.handlers.get(name)(payload);
  }
}

const documents = new Map();
globalThis.fromUuid = async uuid => documents.get(uuid) ?? null;
globalThis.foundry = {
  utils: {
    deepClone: value => structuredClone(value),
    getProperty: (object, path) => String(path).split(".").reduce((value, part) => value?.[part], object),
    setProperty: (object, path, value) => {
      const parts = String(path).split(".");
      const leaf = parts.pop();
      let current = object;
      for (const part of parts) current = current[part] ??= {};
      current[leaf] = value;
      return true;
    }
  },
  applications: { api: {} }
};
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 }, REGION_VISIBILITY: { LAYER: 0 } };
class FakeModifyMovementCostModel {
  static defineSchema() {
    return {
      difficulties: {
        fields: { walk: {}, fly: {}, swim: {}, climb: {}, burrow: {}, crawl: {} }
      }
    };
  }
}
globalThis.CONFIG = {
  RegionBehavior: {
    dataModels: {
      difficultTerrain: class FakeDifficultTerrainModel {},
      modifyMovementCost: FakeModifyMovementCostModel
    }
  },
  Token: {
    movement: {
      defaultAction: "walk",
      actions: {
        walk: {}, fly: {}, swim: {}, climb: {}, burrow: {}, crawl: {},
        jump: { deriveTerrainDifficulty: () => 1 }
      }
    }
  }
};
globalThis.canvas = { ready: false };
globalThis.ui = { notifications: { info() {}, error() {} } };

test("ActivityExecutionService preserves CAT/Midi workflow outcomes and de-duplicates requests", async () => {
  const previousGame = globalThis.game;
  const socket = new FakeSocket();
  const authority = { getPrimaryGm: () => ({ id: "gm" }) };
  const activity = { id: "web-save", uuid: "Item.web.Activity.web-save", name: "Web Save" };
  const item = {
    documentName: "Item",
    uuid: "Item.web",
    system: { activities: new Map([[activity.id, activity]]) }
  };
  const actor = { uuid: "Actor.target" };
  const token = { documentName: "Token", uuid: "Scene.test.Token.target", actor };
  documents.set(item.uuid, item);
  documents.set(token.uuid, token);
  const catSpell = {
    getStatus: () => ({ active: true, capabilities: { completeActivityUse: true } }),
    getActivityByIdentifier: () => null,
    completeActivityUse: async (_activity, targets) => ({
      id: "Workflow.web-save",
      saves: new Set(),
      failedSaves: new Set(targets)
    })
  };
  const service = new ActivityExecutionService({ socket, authority, catSpell });
  globalThis.game = { user: { id: "gm", isGM: true }, users: [{ id: "gm", isGM: true, active: true }] };

  try {
    const first = await service.execute({
      itemUuid: item.uuid,
      activityReference: "Web Save",
      targetTokenUuids: [token.uuid],
      idempotencyKey: "web-save-test"
    });
    assert.equal(first.executed, true);
    assert.equal(first.via, "cat-midi");
    assert.deepEqual(first.failedSaves, [token.uuid]);
    assert.doesNotThrow(() => JSON.stringify(first));

    const duplicate = await service.execute({
      itemUuid: item.uuid,
      activityReference: "Web Save",
      targetTokenUuids: [token.uuid],
      idempotencyKey: "web-save-test"
    });
    assert.equal(duplicate.executed, false);
    assert.equal(duplicate.reason, "duplicate");
    assert.equal(service.getStats().duplicates, 1);
  } finally {
    documents.clear();
    globalThis.game = previousGame;
  }
});

test("OngoingEffectService can derive an escape grant from a source Item Activity and patch its DC", async () => {
  const previousGame = globalThis.game;
  const socket = new FakeSocket();
  const authority = { isPrimary: () => true, getPrimaryGm: () => ({ id: "gm" }) };
  const catSpell = { getStatus: () => ({ active: false, capabilities: {} }) };
  const service = new OngoingEffectService({ socket, authority, catSpell, selectionIndicator: null });
  globalThis.game = { user: { id: "gm", isGM: true }, settings: { get: () => false } };

  const escapeActivity = {
    id: "escape-web",
    name: "Escape Web",
    toObject: () => ({
      _id: "escape-web",
      type: "check",
      name: "Escape Web",
      check: { ability: "str", associated: ["ath"], dc: { calculation: "", formula: "0" } },
      consumption: { targets: [], scaling: { allowed: false, max: "" } }
    })
  };
  const sourceItem = {
    documentName: "Item",
    uuid: "Item.web-source",
    name: "Web",
    img: "icons/web.webp",
    system: { activities: new Map([[escapeActivity.id, escapeActivity]]) },
    toObject: () => ({
      name: "Web",
      type: "spell",
      img: "icons/web.webp",
      system: {
        description: { value: "Web", chat: "" },
        source: { custom: "" },
        identifier: "web"
      },
      flags: {}
    })
  };
  let createdItemData = null;
  const actor = {
    uuid: "Actor.target",
    items: new Map(),
    async createEmbeddedDocuments(type, data) {
      assert.equal(type, "Item");
      createdItemData = structuredClone(data[0]);
      const created = {
        documentName: "Item",
        id: "web-escape-grant",
        uuid: "Actor.target.Item.web-escape-grant",
        parent: actor,
        actor,
        name: data[0].name,
        flags: data[0].flags,
        system: data[0].system
      };
      actor.items.set(created.id, created);
      documents.set(created.uuid, created);
      return [created];
    },
    async deleteEmbeddedDocuments() { return []; }
  };
  const effect = {
    documentName: "ActiveEffect",
    id: "restrained-web",
    uuid: "Actor.target.ActiveEffect.restrained-web",
    parent: actor,
    origin: sourceItem.uuid,
    name: "Restrained by Web",
    flags: {
      [MODULE_ID]: {
        [ONGOING_ACTION_EFFECT_FLAG]: {
          enabled: true,
          sourceActivity: {
            activityReference: "Escape Web",
            itemName: "Web — Escape",
            activityPatch: {
              "check.dc.calculation": "",
              "check.dc.formula": "15"
            }
          },
          removeEffectOnSuccess: true
        }
      }
    },
    async update(data) {
      const config = data[`flags.${MODULE_ID}.${ONGOING_ACTION_EFFECT_FLAG}`];
      this.flags[MODULE_ID][ONGOING_ACTION_EFFECT_FLAG] = config;
    }
  };
  documents.set(sourceItem.uuid, sourceItem);
  documents.set(effect.uuid, effect);

  try {
    const validation = service.validateConfig(effect.flags[MODULE_ID][ONGOING_ACTION_EFFECT_FLAG]);
    assert.equal(validation.valid, true);
    const grant = await service.ensureGrant(effect);
    assert.equal(grant.created, true);
    assert.equal(createdItemData.type, "feat");
    assert.equal(createdItemData.name, "Web — Escape");
    const activity = createdItemData.system.activities["escape-web"];
    assert.equal(activity.check.dc.formula, "15");
    const grantFlag = createdItemData.flags[MODULE_ID][ONGOING_ACTION_ITEM_FLAG];
    assert.equal(grantFlag.sourceEffectUuid, effect.uuid);
    assert.equal(grantFlag.sourceItemUuid, sourceItem.uuid);
    assert.equal(grantFlag.sourceActivity, "Escape Web");
    assert.equal(effect.flags[MODULE_ID][ONGOING_ACTION_EFFECT_FLAG].grantedItemUuid, grant.item.uuid);
  } finally {
    documents.clear();
    globalThis.game = previousGame;
  }
});

test("OngoingEffectService interprets a normal Check Activity total against its prepared DC", async () => {
  const previousGame = globalThis.game;
  const socket = new FakeSocket();
  const authority = { isPrimary: () => true, getPrimaryGm: () => ({ id: "gm" }) };
  const service = new OngoingEffectService({
    socket,
    authority,
    catSpell: { getStatus: () => ({ active: false, capabilities: {} }) },
    selectionIndicator: null
  });
  globalThis.game = { user: { id: "gm", isGM: true }, settings: { get: () => false } };

  const actor = {
    uuid: "Actor.target",
    deleted: [],
    async deleteEmbeddedDocuments(type, ids) { this.deleted.push({ type, ids }); return ids; }
  };
  const effect = {
    id: "restrained",
    uuid: "Actor.target.ActiveEffect.restrained",
    parent: actor,
    flags: { [MODULE_ID]: { [ONGOING_ACTION_EFFECT_FLAG]: { enabled: true, templateUuid: "Compendium.test.Item.escape", grantedItemUuid: "Actor.target.Item.escape" } } }
  };
  const item = {
    uuid: "Actor.target.Item.escape",
    parent: actor,
    actor,
    flags: { [MODULE_ID]: { [ONGOING_ACTION_ITEM_FLAG]: { sourceEffectUuid: effect.uuid, removeEffectOnSuccess: true } } }
  };
  documents.set(effect.uuid, effect);
  documents.set(item.uuid, item);
  const workflow = {
    id: "Workflow.escape-check",
    item,
    activity: { check: { dc: { value: 15 } } },
    utilityRolls: [{ total: 15 }],
    saves: new Set(),
    failedSaves: new Set()
  };

  try {
    const result = await service.processWorkflowResult(workflow);
    assert.equal(result.handled, true);
    assert.equal(result.success, true);
    assert.equal(result.effectRemoved, true);
    assert.deepEqual(actor.deleted[0], { type: "ActiveEffect", ids: [effect.id] });
  } finally {
    documents.clear();
    globalThis.game = previousGame;
  }
});

test("WebService creates one Region and Web fire profile quantizes ignition into 5-foot cells", async () => {
  const previousGame = globalThis.game;
  const previousCanvas = globalThis.canvas;
  globalThis.game = { user: { id: "gm", isGM: true }, users: [{ id: "gm", isGM: true, active: true }], combat: null };
  const scene = { documentName: "Scene", uuid: "Scene.test", grid: { size: 100, distance: 5 }, dimensions: { size: 100, distance: 5 } };
  globalThis.canvas = { scene, grid: { size: 100 } };
  const socket = new FakeSocket();
  const geometry = new EnvironmentGeometryService();
  let createdRegionData = null;
  const regions = {
    async create(data) { createdRegionData = structuredClone(data); return { created: true, regionUuid: "Scene.test.Region.web" }; },
    async delete() { return { deleted: true }; }
  };
  let profile = null;
  const profiles = {
    register(capabilityId, profileId, config) {
      assert.equal(capabilityId, ENVIRONMENT_CAPABILITIES.FLAMMABLE);
      assert.equal(profileId, WEB_PROFILE_ID);
      profile = config;
      return () => true;
    }
  };
  let timerHandler = null;
  const timing = {
    registerHandler(id, handler) { assert.equal(id, WEB_BURN_TIMER_HANDLER); timerHandler = handler; return () => true; }
  };
  let currentState = {};
  const mutations = { getState: () => currentState };
  const web = new WebService({
    socket,
    authority: { getPrimaryGm: () => ({ id: "gm" }) },
    regions,
    geometry,
    profiles,
    mutations,
    timing,
    activities: { execute: async () => ({ executed: true }) },
    ongoingEffects: null,
    selectionIndicator: null
  });

  try {
    web.initialize();
    const result = await web.create({
      scene,
      center: { x: 200, y: 200, elevation: 0 },
      sourceItemUuid: "Item.web",
      casterActorUuid: "Actor.caster",
      instanceId: "web-test"
    });
    assert.equal(result.created, true);
    assert.equal(createdRegionData.visibility, globalThis.CONST.REGION_VISIBILITY.LAYER);
    assert.equal(createdRegionData.locked, true);
    assert.equal(createdRegionData.shapes.length, 1);
    assert.equal(createdRegionData.behaviors.length, 3);
    assert.equal(createdRegionData.behaviors.some(entry => entry.type === "difficultTerrain"), true);
    assert.equal(createdRegionData.behaviors.some(entry => entry.type === ENVIRONMENT_BEHAVIOR_TYPES.WEB), true);
    assert.equal(createdRegionData.behaviors.some(entry => entry.type === ENVIRONMENT_BEHAVIOR_TYPES.FLAMMABLE && entry.system.profileId === WEB_PROFILE_ID), true);
    assert.equal(createdRegionData.flags[MODULE_ID][WEB_FLAG_KEY].center.x, 200);

    const behavior = { id: "flammable", _id: "flammable" };
    const region = {
      uuid: "Scene.test.Region.web",
      parent: scene,
      flags: createdRegionData.flags
    };
    const fireGeometry = geometry.fromPoint({ x: 50, y: 50 }, { scene });
    const reaction = await profile.react({ event: { id: "fire-1", geometry: fireGeometry }, region, behavior, currentState: {} });
    assert.equal(reaction.handled, true);
    assert.equal(Object.keys(reaction.state.burningCells).length, 1);
    assert.equal(reaction.scheduleTimers.length, 1);
    assert.equal(reaction.scheduleTimers[0].payload.cellId, "0,0");

    currentState = reaction.state;
    const burn = await timerHandler({ region, behavior, timer: reaction.scheduleTimers[0] });
    assert.equal(burn.handled, true);
    assert.equal(Object.keys(burn.state.burningCells).length, 0);
    assert.equal(Object.keys(burn.state.burnedCells).length, 1);
    assert.equal(burn.addHoles.length, 1);
    assert.equal(burn.addHoles[0].hole, false, "mutation service owns conversion to a Region hole");
  } finally {
    globalThis.game = previousGame;
    globalThis.canvas = previousCanvas;
  }
});

test("WebService falls back to Foundry core modifyMovementCost on D&D5e 5.3.x", async () => {
  const previousModels = globalThis.CONFIG.RegionBehavior.dataModels;
  globalThis.CONFIG.RegionBehavior.dataModels = { modifyMovementCost: FakeModifyMovementCostModel };
  const socket = new FakeSocket();
  const web = new WebService({
    socket,
    authority: { getPrimaryGm: () => ({ id: "gm" }) },
    regions: { create: async () => ({ created: false }), delete: async () => ({ deleted: true }) },
    geometry: new EnvironmentGeometryService(),
    profiles: { register: () => () => true },
    mutations: { getState: () => ({}) },
    timing: { registerHandler: () => () => true },
    activities: { execute: async () => ({ executed: true }) },
    ongoingEffects: null,
    selectionIndicator: null
  });

  try {
    const behavior = web.buildDifficultTerrainBehavior();
    assert.equal(behavior.type, "modifyMovementCost");
    assert.deepEqual(behavior.system.difficulties, {
      walk: 2, fly: 2, swim: 2, climb: 2, burrow: 2, crawl: 2
    });
    assert.equal("jump" in behavior.system.difficulties, false, "derived movement actions are not stored in core difficulty source data");
  } finally {
    globalThis.CONFIG.RegionBehavior.dataModels = previousModels;
  }
});

test("WebService prefers D&D5e semantic difficultTerrain when the system registers it", async () => {
  const socket = new FakeSocket();
  const web = new WebService({
    socket,
    authority: { getPrimaryGm: () => ({ id: "gm" }) },
    regions: { create: async () => ({ created: false }), delete: async () => ({ deleted: true }) },
    geometry: new EnvironmentGeometryService(),
    profiles: { register: () => () => true },
    mutations: { getState: () => ({}) },
    timing: { registerHandler: () => () => true },
    activities: { execute: async () => ({ executed: true }) },
    ongoingEffects: null,
    selectionIndicator: null
  });

  const behavior = web.buildDifficultTerrainBehavior();
  assert.equal(behavior.type, "difficultTerrain");
  assert.deepEqual(behavior.system.types, ["web"]);
  assert.equal(behavior.system.magical, true);
});

test("WebService binds a Web Region to Midi concentration using the public dependent-document API", async () => {
  const previousGame = globalThis.game;
  const previousMidiQOL = globalThis.MidiQOL;
  const socket = new FakeSocket();
  const geometry = new EnvironmentGeometryService();
  const profiles = { register: () => () => true };
  const timing = { registerHandler: () => () => true };
  const mutations = { getState: () => ({}) };
  const region = {
    documentName: "Region",
    id: "web-region",
    uuid: "Scene.test.Region.web-region",
    flags: { [MODULE_ID]: { [WEB_FLAG_KEY]: { instanceId: "web-concentration" } }, dnd5e: {} },
    getFlag(scope, key) { return this.flags?.[scope]?.[key] ?? null; }
  };
  const actor = { documentName: "Actor", uuid: "Actor.caster" };
  const item = { documentName: "Item", id: "web-item", uuid: "Actor.caster.Item.web-item" };
  documents.set(region.uuid, region);
  documents.set(actor.uuid, actor);
  documents.set(item.uuid, item);
  globalThis.game = { user: { id: "gm", isGM: true }, users: [{ id: "gm", isGM: true, active: true }] };
  let called = null;
  globalThis.MidiQOL = {
    async addConcentrationDependent(receivedActor, receivedRegion, receivedItem) {
      called = { receivedActor, receivedRegion, receivedItem };
      receivedRegion.flags.dnd5e.dependentOn = "Actor.caster.ActiveEffect.concentration";
      return true;
    }
  };
  const web = new WebService({
    socket,
    authority: { getPrimaryGm: () => ({ id: "gm" }) },
    regions: { create: async () => ({ created: false }), delete: async () => ({ deleted: true }) },
    geometry,
    profiles,
    mutations,
    timing,
    activities: { execute: async () => ({ executed: true }) },
    ongoingEffects: null,
    selectionIndicator: null
  });

  try {
    const result = await web.bindConcentration({ regionUuid: region.uuid, casterActorUuid: actor.uuid, sourceItemUuid: item.uuid });
    assert.equal(result.bound, true);
    assert.equal(result.dependentOn, "Actor.caster.ActiveEffect.concentration");
    assert.equal(called.receivedActor, actor);
    assert.equal(called.receivedRegion, region);
    assert.equal(called.receivedItem, item);
    assert.equal(web.getStats().concentrationBindings, 1);
  } finally {
    documents.clear();
    globalThis.game = previousGame;
    globalThis.MidiQOL = previousMidiQOL;
  }
});

function makeWebRegionEventFixture({ saveFailed = true, burning = false, restraintOngoingAction = null } = {}) {
  const scene = {
    documentName: "Scene",
    id: "test",
    uuid: "Scene.test",
    grid: { size: 100, distance: 5 },
    dimensions: { size: 100, distance: 5 }
  };
  const sourceItem = {
    documentName: "Item",
    id: "web-source",
    uuid: "Item.web-source",
    name: "Web",
    img: "icons/web.webp",
    effects: [{
      id: "restrained-template",
      name: "Restrained by Web",
      transfer: false,
      disabled: true,
      statuses: new Set(["restrained"]),
      flags: { [MODULE_ID]: { [WEB_FLAG_KEY]: { role: "restrained-template" } } },
      toObject: () => ({
        name: "Restrained by Web",
        transfer: false,
        disabled: true,
        statuses: ["restrained"],
        flags: { [MODULE_ID]: { [WEB_FLAG_KEY]: { role: "restrained-template" } } }
      })
    }],
    system: {
      activities: new Map([
        ["web-save", { id: "web-save", name: "Web Save", type: "save", save: { dc: { value: 15 } } }],
        ["burning-web-damage", { id: "burning-web-damage", name: "Burning Web Damage", type: "damage" }]
      ])
    }
  };
  const caster = {
    documentName: "Actor",
    id: "caster",
    uuid: "Actor.caster",
    system: { attributes: { spell: { dc: 15 } } }
  };
  const actor = {
    documentName: "Actor",
    id: "target",
    uuid: "Actor.target",
    effects: [],
    async createEmbeddedDocuments(type, data) {
      assert.equal(type, "ActiveEffect");
      const created = data.map((source, index) => ({
        ...structuredClone(source),
        id: `web-restraint-${index + 1}`,
        uuid: `${this.uuid}.ActiveEffect.web-restraint-${index + 1}`,
        parent: this,
        disabled: false
      }));
      this.effects.push(...created);
      return created;
    },
    async deleteEmbeddedDocuments(type, ids) {
      assert.equal(type, "ActiveEffect");
      this.effects = this.effects.filter(effect => !ids.includes(effect.id));
      return ids;
    }
  };
  let pauses = 0;
  let resumes = 0;
  let stops = 0;
  const token = {
    documentName: "Token",
    id: "target-token",
    uuid: "Scene.test.Token.target",
    parent: scene,
    actor,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    elevation: 0,
    pauseMovement() {
      pauses += 1;
      return async () => { resumes += 1; };
    },
    stopMovement() { stops += 1; }
  };
  const webFlag = {
    schemaVersion: 1,
    instanceId: "web-event-test",
    sourceItemUuid: sourceItem.uuid,
    casterActorUuid: caster.uuid,
    center: { x: 200, y: 200, elevation: 0 },
    sizeFeet: 20,
    cellSizeFeet: 5,
    state: { turnGates: {} },
    restraintOngoingAction: restraintOngoingAction ? structuredClone(restraintOngoingAction) : null
  };
  const behavior = {
    documentName: "RegionBehavior",
    id: "web-behavior",
    uuid: "Scene.test.Region.web.RegionBehavior.web-behavior",
    type: ENVIRONMENT_BEHAVIOR_TYPES.WEB,
    system: {
      instanceId: webFlag.instanceId,
      sourceItemUuid: sourceItem.uuid,
      casterActorUuid: caster.uuid,
      saveActivity: "Web Save",
      burnDamageActivity: "Burning Web Damage",
      restrainedEffectRole: "restrained-template",
      sizeFeet: 20,
      cellSizeFeet: 5
    }
  };
  const flammable = {
    documentName: "RegionBehavior",
    id: "flammable",
    uuid: "Scene.test.Region.web.RegionBehavior.flammable",
    type: ENVIRONMENT_BEHAVIOR_TYPES.FLAMMABLE,
    system: { profileId: WEB_PROFILE_ID }
  };
  const region = {
    documentName: "Region",
    id: "web",
    uuid: "Scene.test.Region.web",
    parent: scene,
    behaviors: [behavior, flammable],
    flags: { [MODULE_ID]: { [WEB_FLAG_KEY]: structuredClone(webFlag) } },
    async update(changes) {
      const path = `flags.${MODULE_ID}.${WEB_FLAG_KEY}`;
      if (Object.hasOwn(changes, path)) this.flags[MODULE_ID][WEB_FLAG_KEY] = structuredClone(changes[path]);
      return this;
    }
  };
  behavior.region = region;
  behavior.parent = region;
  flammable.region = region;
  flammable.parent = region;

  const activityCalls = [];
  const activities = {
    async execute(request) {
      activityCalls.push(structuredClone(request));
      if (request.activityReference === "Burning Web Damage") {
        return { executed: true, targetUuids: [...request.targetTokenUuids] };
      }
      return saveFailed
        ? { executed: true, failedSaves: [...request.targetTokenUuids], saves: [] }
        : { executed: true, failedSaves: [], saves: [...request.targetTokenUuids] };
    }
  };
  const geometry = new EnvironmentGeometryService();
  const burningState = burning ? {
    burningCells: {
      "0,0": {
        id: "0,0",
        shape: geometry.createRectangle({ x: 0, y: 0, width: 100, height: 100 })
      }
    },
    burnedCells: {}
  } : {};
  const profiles = { register: () => () => true };
  const timing = { registerHandler: () => () => true };
  const mutations = { getState: (_region, regionBehavior) => regionBehavior?.type === ENVIRONMENT_BEHAVIOR_TYPES.FLAMMABLE ? burningState : {} };
  let grants = 0;
  const ongoingEffects = { async ensureGrant() { grants += 1; return { created: true }; } };
  const socket = new FakeSocket();
  const web = new WebService({
    socket,
    authority: { getPrimaryGm: () => ({ id: "gm" }) },
    regions: { create: async () => ({ created: false }), delete: async () => ({ deleted: true }) },
    geometry,
    profiles,
    mutations,
    timing,
    activities,
    ongoingEffects,
    selectionIndicator: null
  });
  web.initialize();

  for (const document of [sourceItem, caster, token, behavior, flammable, region]) documents.set(document.uuid, document);
  return {
    scene,
    sourceItem,
    caster,
    actor,
    token,
    behavior,
    flammable,
    region,
    web,
    activityCalls,
    counters: {
      get pauses() { return pauses; },
      get resumes() { return resumes; },
      get stops() { return stops; },
      get grants() { return grants; }
    }
  };
}

function movementEvent(token, { id = "move-1", agency = "voluntary", method = "dragging", name = "tokenMoveIn" } = {}) {
  return {
    name,
    user: { id: "gm", isSelf: true },
    data: {
      token,
      movement: {
        id,
        method,
        updateOptions: { actionEffects5e: { agency } }
      }
    }
  };
}

test("Web Region entry failure restrains and stops voluntary movement, then exit removes only that Web restraint", async () => {
  const previousGame = globalThis.game;
  const previousCanvas = globalThis.canvas;
  const fixture = makeWebRegionEventFixture({ saveFailed: true });
  globalThis.game = {
    user: { id: "gm", isGM: true },
    users: [{ id: "gm", isGM: true, active: true }],
    combat: { started: true, uuid: "Combat.test", round: 1, turn: 0 }
  };
  globalThis.canvas = { scene: fixture.scene, grid: { size: 100 } };

  try {
    const result = await fixture.web.handleRegionEvent(fixture.behavior, movementEvent(fixture.token));
    assert.equal(result.handled, true);
    assert.equal(result.save?.attempted, true);
    assert.equal(result.save?.failed, true);
    assert.equal(result.stopMovement, true);
    assert.equal(fixture.counters.pauses, 1);
    assert.equal(fixture.counters.stops, 1);
    assert.equal(fixture.counters.resumes, 0);
    assert.equal(fixture.actor.effects.length, 1);
    assert.equal(fixture.actor.effects[0].flags[MODULE_ID][WEB_FLAG_KEY].regionUuid, fixture.region.uuid);
    assert.equal(fixture.actor.effects[0].flags[MODULE_ID].movement.voluntaryRestriction.enabled, true);
    assert.equal(
      fixture.actor.effects[0].flags[MODULE_ID][ONGOING_ACTION_EFFECT_FLAG].sourceActivity.activityReference,
      "Escape Web",
      "pre-v0.4.3.8 source-Activity fallback remains available"
    );
    assert.equal(fixture.counters.grants, 1);

    fixture.actor.effects.push({
      id: "other-web-restraint",
      disabled: false,
      flags: { [MODULE_ID]: { [WEB_FLAG_KEY]: { regionUuid: "Scene.test.Region.other-web" } } }
    });

    const exit = await fixture.web.handleRegionEvent(fixture.behavior, {
      name: "tokenExit",
      user: { id: "gm", isSelf: true },
      data: { token: fixture.token }
    });
    assert.equal(exit.handled, true);
    assert.equal(exit.restraintRemoved, true);
    assert.equal(fixture.actor.effects.length, 1);
    assert.equal(fixture.actor.effects[0].id, "other-web-restraint");
  } finally {
    documents.clear();
    globalThis.game = previousGame;
    globalThis.canvas = previousCanvas;
  }
});



test("Web stamps Item-supplied external Escape helper configuration onto delayed runtime restraints", async () => {
  const previousGame = globalThis.game;
  const previousCanvas = globalThis.canvas;
  const ongoingAction = {
    enabled: true,
    templateUuid: "Compendium.action-effects-5e.ae5e-administrative.Item.escape-web",
    activityIdentifier: "escape-web",
    timing: "turnStart",
    mandatory: false,
    removeEffectOnSuccess: true,
    suppressPromptWhenUnusable: true,
    promptText: "Use your action to attempt to break free from the Web?",
    indicatorRole: "responder"
  };
  const fixture = makeWebRegionEventFixture({ saveFailed: true, restraintOngoingAction: ongoingAction });
  globalThis.game = {
    user: { id: "gm", isGM: true },
    users: [{ id: "gm", isGM: true, active: true }],
    combat: { started: true, uuid: "Combat.test", round: 1, turn: 0 }
  };
  globalThis.canvas = { scene: fixture.scene, grid: { size: 100 } };

  try {
    const result = await fixture.web.handleRegionEvent(fixture.behavior, movementEvent(fixture.token));
    assert.equal(result.save?.failed, true);
    assert.equal(fixture.actor.effects.length, 1);
    const runtimeConfig = fixture.actor.effects[0].flags[MODULE_ID][ONGOING_ACTION_EFFECT_FLAG];
    assert.deepEqual(runtimeConfig, ongoingAction);
    assert.equal(runtimeConfig.templateUuid, ongoingAction.templateUuid);
    assert.equal(runtimeConfig.activityIdentifier, "escape-web");
    assert.equal(runtimeConfig.indicatorRole, "responder");
    assert.equal(
      fixture.sourceItem.effects[0].flags[MODULE_ID][ONGOING_ACTION_EFFECT_FLAG],
      undefined,
      "Item-supplied grant configuration never mutates the editable source Active Effect"
    );
  } finally {
    documents.clear();
    globalThis.game = previousGame;
    globalThis.canvas = previousCanvas;
  }
});

test("Web create persists validated Item-supplied ongoing-action configuration on the authoritative Region", async () => {
  const previousGame = globalThis.game;
  const previousCanvas = globalThis.canvas;
  const previousRandomId = globalThis.foundry?.utils?.randomID;
  globalThis.foundry.utils.randomID = () => "web-config-instance";
  const helper = { documentName: "Item", uuid: "Compendium.test.Item.escape-web" };
  documents.set(helper.uuid, helper);
  const scene = { documentName: "Scene", uuid: "Scene.web-config", grid: { size: 100, distance: 5 }, dimensions: { size: 100, distance: 5 } };
  globalThis.canvas = { scene, grid: { size: 100 } };
  globalThis.game = { user: { id: "gm", isGM: true }, users: [{ id: "gm", isGM: true, active: true }] };
  let regionData = null;
  const config = {
    enabled: true,
    templateUuid: helper.uuid,
    activityIdentifier: "escape-web",
    timing: "turnStart",
    mandatory: false,
    removeEffectOnSuccess: true,
    indicatorRole: "responder"
  };
  const web = new WebService({
    socket: new FakeSocket(),
    authority: { getPrimaryGm: () => ({ id: "gm" }) },
    regions: { async create(data) { regionData = structuredClone(data); return { created: false, reason: "fixture-only" }; } },
    geometry: new EnvironmentGeometryService(), profiles: {}, mutations: {}, timing: {}, activities: {},
    ongoingEffects: { validateConfig: value => value?.templateUuid ? { valid: true } : { valid: false, reason: "missing-grant-source" } },
    selectionIndicator: null, crosshairs: null
  });
  try {
    const result = await web.create({
      scene, center: { x: 500, y: 500 }, sourceItemUuid: "Item.web", casterActorUuid: "Actor.caster",
      restraintOngoingAction: config, visualMode: "none"
    });
    assert.equal(result.created, false);
    assert.deepEqual(regionData.flags[MODULE_ID][WEB_FLAG_KEY].restraintOngoingAction, config);
    assert.equal(regionData.flags[MODULE_ID][WEB_FLAG_KEY].schemaVersion, 2);
  } finally {
    documents.clear();
    globalThis.game = previousGame;
    globalThis.canvas = previousCanvas;
    globalThis.foundry.utils.randomID = previousRandomId;
  }
});

test("Web create fails closed when Item-supplied ongoing-action configuration is invalid", async () => {
  const previousCanvas = globalThis.canvas;
  const scene = { documentName: "Scene", uuid: "Scene.web-invalid", grid: { size: 100, distance: 5 }, dimensions: { size: 100, distance: 5 } };
  globalThis.canvas = { scene, grid: { size: 100 } };
  let createCalls = 0;
  const web = new WebService({
    socket: new FakeSocket(), authority: { getPrimaryGm: () => ({ id: "gm" }) },
    regions: { async create() { createCalls += 1; return { created: true }; } },
    geometry: new EnvironmentGeometryService(), profiles: {}, mutations: {}, timing: {}, activities: {},
    ongoingEffects: { validateConfig: () => ({ valid: false, reason: "missing-grant-source" }) },
    selectionIndicator: null, crosshairs: null
  });
  try {
    const result = await web.create({
      scene, center: { x: 500, y: 500 }, sourceItemUuid: "Item.web", casterActorUuid: "Actor.caster",
      restraintOngoingAction: { enabled: true }, visualMode: "none"
    });
    assert.equal(result.created, false);
    assert.equal(result.reason, "invalid-restraint-ongoing-action");
    assert.equal(result.details, "missing-grant-source");
    assert.equal(createCalls, 0);
  } finally {
    globalThis.canvas = previousCanvas;
  }
});

test("Web ignores nonmovement TOKEN_ENTER events so Region creation does not cause an immediate cast-time save", async () => {
  const previousGame = globalThis.game;
  const previousCanvas = globalThis.canvas;
  const fixture = makeWebRegionEventFixture({ saveFailed: true });
  globalThis.game = {
    user: { id: "gm", isGM: true },
    users: [{ id: "gm", isGM: true, active: true }],
    combat: { started: true, uuid: "Combat.test", round: 1, turn: 0 }
  };
  globalThis.canvas = { scene: fixture.scene, grid: { size: 100 } };

  try {
    const result = await fixture.web.handleRegionEvent(fixture.behavior, {
      name: "tokenEnter",
      user: { id: "gm", isSelf: true },
      data: { token: fixture.token }
    });
    assert.equal(result.handled, false);
    assert.equal(result.reason, "nonmovement-enter");
    assert.equal(fixture.activityCalls.length, 0);
    assert.equal(fixture.actor.effects.length, 0);
  } finally {
    documents.clear();
    globalThis.game = previousGame;
    globalThis.canvas = previousCanvas;
  }
});

test("Web Region entry failure does not stop forced movement even though the creature becomes Restrained", async () => {
  const previousGame = globalThis.game;
  const previousCanvas = globalThis.canvas;
  const fixture = makeWebRegionEventFixture({ saveFailed: true });
  globalThis.game = {
    user: { id: "gm", isGM: true },
    users: [{ id: "gm", isGM: true, active: true }],
    combat: { started: true, uuid: "Combat.test", round: 1, turn: 0 }
  };
  globalThis.canvas = { scene: fixture.scene, grid: { size: 100 } };

  try {
    const result = await fixture.web.handleRegionEvent(fixture.behavior, movementEvent(fixture.token, { agency: "forced" }));
    assert.equal(result.save?.failed, true);
    assert.equal(result.stopMovement, false);
    assert.equal(fixture.counters.pauses, 1);
    assert.equal(fixture.counters.resumes, 1);
    assert.equal(fixture.counters.stops, 0);
    assert.equal(fixture.actor.effects.length, 1);
  } finally {
    documents.clear();
    globalThis.game = previousGame;
    globalThis.canvas = previousCanvas;
  }
});

test("Web saves only once per creature per combat turn after a successful entry save", async () => {
  const previousGame = globalThis.game;
  const previousCanvas = globalThis.canvas;
  const fixture = makeWebRegionEventFixture({ saveFailed: false });
  const combat = { started: true, uuid: "Combat.test", round: 3, turn: 1 };
  globalThis.game = {
    user: { id: "gm", isGM: true },
    users: [{ id: "gm", isGM: true, active: true }],
    combat
  };
  globalThis.canvas = { scene: fixture.scene, grid: { size: 100 } };

  try {
    const first = await fixture.web.handleRegionEvent(fixture.behavior, movementEvent(fixture.token, { id: "move-1" }));
    const duplicate = await fixture.web.handleRegionEvent(fixture.behavior, movementEvent(fixture.token, { id: "move-2" }));
    assert.equal(first.save?.attempted, true);
    assert.equal(first.save?.failed, false);
    assert.equal(duplicate.save?.attempted, false);
    assert.equal(duplicate.save?.reason, "already-checked-this-turn");
    assert.equal(fixture.activityCalls.filter(call => call.activityReference === "Web Save").length, 1);

    combat.turn = 2;
    const nextTurn = await fixture.web.handleRegionEvent(fixture.behavior, movementEvent(fixture.token, { id: "move-3" }));
    assert.equal(nextTurn.save?.attempted, true);
    assert.equal(fixture.activityCalls.filter(call => call.activityReference === "Web Save").length, 2);
  } finally {
    documents.clear();
    globalThis.game = previousGame;
    globalThis.canvas = previousCanvas;
  }
});

test("Web turn start applies burning-cell damage through the damage Activity and then performs the turn's Web save", async () => {
  const previousGame = globalThis.game;
  const previousCanvas = globalThis.canvas;
  const fixture = makeWebRegionEventFixture({ saveFailed: false, burning: true });
  globalThis.game = {
    user: { id: "gm", isGM: true },
    users: [{ id: "gm", isGM: true, active: true }],
    combat: { started: true, uuid: "Combat.test", round: 5, turn: 2 }
  };
  globalThis.canvas = { scene: fixture.scene, grid: { size: 100 } };

  try {
    const result = await fixture.web.handleRegionEvent(fixture.behavior, {
      name: "tokenTurnStart",
      user: { id: "gm", isSelf: true },
      data: { token: fixture.token }
    });
    assert.equal(result.handled, true);
    assert.equal(result.damage?.applied, true);
    assert.equal(result.save?.attempted, true);
    assert.deepEqual(fixture.activityCalls.map(call => call.activityReference), ["Burning Web Damage", "Web Save"]);
    assert.equal(fixture.activityCalls[0].targetTokenUuids[0], fixture.token.uuid);
    assert.equal(fixture.actor.effects.length, 0);
  } finally {
    documents.clear();
    globalThis.game = previousGame;
    globalThis.canvas = previousCanvas;
  }
});

test("ActivityExecutionService fails closed on an unresolved explicit target without poisoning idempotency", async () => {
  const previousGame = globalThis.game;
  const socket = new FakeSocket();
  const authority = { getPrimaryGm: () => ({ id: "gm" }) };
  const activity = { id: "web-save", uuid: "Item.web.Activity.web-save", name: "Web Save", type: "save" };
  const item = { documentName: "Item", uuid: "Item.web", system: { activities: new Map([[activity.id, activity]]) } };
  let uses = 0;
  const catSpell = {
    getStatus: () => ({ active: true, capabilities: { completeActivityUse: true } }),
    getActivityByIdentifier: () => null,
    completeActivityUse: async (_activity, targets) => {
      uses += 1;
      return { id: `Workflow.${uses}`, saves: new Set(targets), failedSaves: new Set() };
    }
  };
  const service = new ActivityExecutionService({ socket, authority, catSpell });
  globalThis.game = { user: { id: "gm", isGM: true }, users: [{ id: "gm", isGM: true, active: true }] };
  documents.set(item.uuid, item);

  try {
    const first = await service.execute({
      itemUuid: item.uuid,
      activityReference: "Web Save",
      targetTokenUuids: ["Scene.test.Token.missing"],
      idempotencyKey: "web-target-retry"
    });
    assert.equal(first.executed, false);
    assert.equal(first.reason, "target-unavailable");
    assert.deepEqual(first.missingTargetUuids, ["Scene.test.Token.missing"]);
    assert.equal(uses, 0);

    const token = { documentName: "Token", uuid: "Scene.test.Token.missing", actor: { uuid: "Actor.target" } };
    documents.set(token.uuid, token);
    const retry = await service.execute({
      itemUuid: item.uuid,
      activityReference: "Web Save",
      targetTokenUuids: [token.uuid],
      idempotencyKey: "web-target-retry"
    });
    assert.equal(retry.executed, true);
    assert.equal(uses, 1);
    assert.deepEqual(retry.saves, [token.uuid]);
  } finally {
    documents.clear();
    globalThis.game = previousGame;
  }
});

test("ActivityExecutionService releases an idempotency claim when CAT/Midi execution throws", async () => {
  const previousGame = globalThis.game;
  const socket = new FakeSocket();
  const authority = { getPrimaryGm: () => ({ id: "gm" }) };
  const activity = { id: "burn", uuid: "Item.web.Activity.burn", name: "Burning Web Damage", type: "damage" };
  const item = { documentName: "Item", uuid: "Item.web", system: { activities: new Map([[activity.id, activity]]) } };
  const token = { documentName: "Token", uuid: "Scene.test.Token.target", actor: { uuid: "Actor.target" } };
  let attempts = 0;
  const catSpell = {
    getStatus: () => ({ active: true, capabilities: { completeActivityUse: true } }),
    getActivityByIdentifier: () => null,
    completeActivityUse: async (_activity, targets) => {
      attempts += 1;
      if (attempts === 1) throw new Error("synthetic CAT failure");
      return { id: "Workflow.retry", hitTargets: new Set(targets) };
    }
  };
  const service = new ActivityExecutionService({ socket, authority, catSpell });
  globalThis.game = { user: { id: "gm", isGM: true }, users: [{ id: "gm", isGM: true, active: true }] };
  documents.set(item.uuid, item);
  documents.set(token.uuid, token);

  try {
    await assert.rejects(() => service.execute({
      itemUuid: item.uuid,
      activityReference: "Burning Web Damage",
      targetTokenUuids: [token.uuid],
      idempotencyKey: "web-burn-retry"
    }), /synthetic CAT failure/);

    const retry = await service.execute({
      itemUuid: item.uuid,
      activityReference: "Burning Web Damage",
      targetTokenUuids: [token.uuid],
      idempotencyKey: "web-burn-retry"
    });
    assert.equal(retry.executed, true);
    assert.equal(attempts, 2);
    assert.equal(service.getStats().duplicates, 0);
  } finally {
    documents.clear();
    globalThis.game = previousGame;
  }
});

test("ActivityExecutionService refuses targeted native fallback when CAT completeActivityUse is unavailable", async () => {
  const previousGame = globalThis.game;
  const socket = new FakeSocket();
  const authority = { getPrimaryGm: () => ({ id: "gm" }) };
  let nativeUses = 0;
  const activity = {
    id: "web-save",
    name: "Web Save",
    type: "save",
    async use() { nativeUses += 1; return { id: "Workflow.native" }; }
  };
  const item = { documentName: "Item", uuid: "Item.web", system: { activities: new Map([[activity.id, activity]]) } };
  const token = { documentName: "Token", uuid: "Scene.test.Token.target", actor: { uuid: "Actor.target" } };
  const catSpell = {
    getStatus: () => ({ active: true, capabilities: { completeActivityUse: false } }),
    getActivityByIdentifier: () => null
  };
  const service = new ActivityExecutionService({ socket, authority, catSpell });
  globalThis.game = { user: { id: "gm", isGM: true }, users: [{ id: "gm", isGM: true, active: true }] };
  documents.set(item.uuid, item);
  documents.set(token.uuid, token);

  try {
    const result = await service.execute({
      itemUuid: item.uuid,
      activityReference: "Web Save",
      targetTokenUuids: [token.uuid],
      idempotencyKey: "no-cat-targeted-fallback"
    });
    assert.equal(result.executed, false);
    assert.equal(result.reason, "cat-targeted-activity-execution-unavailable");
    assert.equal(nativeUses, 0);
  } finally {
    documents.clear();
    globalThis.game = previousGame;
  }
});

function makeValidWebSourceItem() {
  const activities = [
    {
      id: "cast-web",
      uuid: "Item.web.Activity.cast-web",
      name: "Cast Web",
      type: "utility",
      effects: [],
      target: { prompt: false },
      consumption: { targets: [], spellSlot: false }
    },
    {
      id: "web-save",
      uuid: "Item.web.Activity.web-save",
      name: "Web Save",
      type: "save",
      effects: [],
      consumption: { targets: [], spellSlot: false },
      save: { ability: new Set(["dex"]), dc: { calculation: "spellcasting", formula: "" } },
      damage: { parts: [] }
    },
    {
      id: "escape-web",
      uuid: "Item.web.Activity.escape-web",
      name: "Escape Web",
      type: "check",
      effects: [],
      activation: { type: "action", value: 1 },
      consumption: { targets: [], spellSlot: false },
      check: { ability: "str", associated: new Set(["ath"]), dc: { calculation: "spellcasting", formula: "" } },
      damage: { parts: [] }
    },
    {
      id: "burning-web-damage",
      uuid: "Item.web.Activity.burning-web-damage",
      name: "Burning Web Damage",
      type: "damage",
      effects: [],
      consumption: { targets: [], spellSlot: false },
      damage: { parts: [{ number: 2, denomination: 4, bonus: "", types: new Set(["fire"]) }] },
      save: { ability: new Set() }
    }
  ];
  const activityMap = new Map(activities.map(activity => [activity.id, activity]));
  const effect = {
    name: "Restrained by Web",
    transfer: false,
    statuses: new Set(["restrained"]),
    flags: { [MODULE_ID]: { [WEB_FLAG_KEY]: { role: "restrained-template" } } },
    toObject: () => ({ name: "Restrained by Web", transfer: false, statuses: ["restrained"] })
  };
  return {
    documentName: "Item",
    uuid: "Item.web",
    name: "Web",
    type: "spell",
    effects: [effect],
    flags: { [MODULE_ID]: { animation: { automatedAnimations: "suppress" } } },
    system: {
      identifier: "web",
      source: { rules: "2024" },
      level: 2,
      school: "con",
      activation: { type: "action", value: null },
      duration: { value: 1, units: "hour" },
      properties: new Set(["vocal", "somatic", "material", "concentration"]),
      range: { value: 60, units: "ft" },
      target: { template: { type: "cube", size: 20, units: "ft" } },
      activities: activityMap
    }
  };
}

test("Web source Item validator accepts the complete automation contract", async () => {
  const socket = new FakeSocket();
  const geometry = new EnvironmentGeometryService();
  const web = new WebService({
    socket,
    authority: { getPrimaryGm: () => ({ id: "gm" }) },
    regions: {},
    geometry,
    profiles: { register: () => () => true },
    mutations: {},
    timing: { registerHandler: () => () => true },
    activities: {},
    ongoingEffects: {},
    selectionIndicator: null
  });
  const item = makeValidWebSourceItem();
  const result = await web.validateSourceItem(item);
  assert.equal(result.passed, true, result.checks.filter(check => !check.passed).map(check => check.name).join("; "));
  assert.equal(result.activities.cast, "Item.web.Activity.cast-web");
  assert.equal(result.activities.save, "Item.web.Activity.web-save");
  assert.equal(result.activities.escape, "Item.web.Activity.escape-web");
  assert.equal(result.activities.burnDamage, "Item.web.Activity.burning-web-damage");
});

test("Web source Item validator accepts an authoritative external Escape Web helper with no Escape Activity on the spell", async () => {
  const socket = new FakeSocket();
  const web = new WebService({
    socket,
    authority: { getPrimaryGm: () => ({ id: "gm" }) },
    regions: {},
    geometry: new EnvironmentGeometryService(),
    profiles: { register: () => () => true },
    mutations: {},
    timing: { registerHandler: () => () => true },
    activities: {},
    ongoingEffects: {},
    selectionIndicator: null
  });
  const item = makeValidWebSourceItem();
  item.system.activities.delete("escape-web");
  const helperActivity = {
    id: "escape-web",
    uuid: "Compendium.test.Item.escape-web.Activity.escape-web",
    identifier: "escape-web",
    name: "Escape Web",
    type: "check",
    effects: [],
    activation: { type: "action", value: 1 },
    consumption: { targets: [], spellSlot: true },
    check: { ability: "str", associated: new Set(["ath"]), dc: { calculation: "", formula: "" } },
    damage: { parts: [] }
  };
  const helper = {
    documentName: "Item",
    uuid: "Compendium.test.Item.escape-web",
    name: "Escape Web",
    type: "feat",
    system: { activities: new Map([[helperActivity.id, helperActivity]]) }
  };
  documents.set(helper.uuid, helper);
  try {
    const result = await web.validateSourceItem(item, { escapeTemplateUuid: helper.uuid });
    assert.equal(result.passed, true, result.checks.filter(check => !check.passed).map(check => check.name).join("; "));
    assert.equal(result.activities.escapeTemplate, helper.uuid);
    assert.equal(result.activities.escape, helperActivity.uuid);
    assert.equal(result.activities.cast, "Item.web.Activity.cast-web");
  } finally {
    documents.clear();
  }
});


test("Web source Item validator rejects an external spell Escape helper that would consume a spell slot", async () => {
  const socket = new FakeSocket();
  const web = new WebService({
    socket,
    authority: { getPrimaryGm: () => ({ id: "gm" }) },
    regions: {},
    geometry: new EnvironmentGeometryService(),
    profiles: { register: () => () => true },
    mutations: {},
    timing: { registerHandler: () => () => true },
    activities: {},
    ongoingEffects: {},
    selectionIndicator: null
  });
  const item = makeValidWebSourceItem();
  item.system.activities.delete("escape-web");
  const helperActivity = {
    id: "escape-web",
    uuid: "Compendium.test.Item.escape-spell.Activity.escape-web",
    identifier: "escape-web",
    name: "Escape Web",
    type: "check",
    effects: [],
    activation: { type: "action", value: 1 },
    consumption: { targets: [], spellSlot: true },
    check: { ability: "str", associated: new Set(["ath"]), dc: { calculation: "", formula: "" } },
    damage: { parts: [] }
  };
  const helper = {
    documentName: "Item",
    uuid: "Compendium.test.Item.escape-spell",
    name: "Escape Web",
    type: "spell",
    system: { activities: new Map([[helperActivity.id, helperActivity]]) }
  };
  documents.set(helper.uuid, helper);
  try {
    const result = await web.validateSourceItem(item, { escapeTemplateUuid: helper.uuid });
    assert.equal(result.passed, false);
    const failed = new Set(result.checks.filter(check => !check.passed).map(check => check.name));
    assert.equal(failed.has("Escape Web does not consume a spell slot or resource"), true);
  } finally {
    documents.clear();
  }
});

test("Web source Item validator rejects automation Activities that would re-consume a spell slot or apply effects directly", async () => {
  const socket = new FakeSocket();
  const web = new WebService({
    socket,
    authority: { getPrimaryGm: () => ({ id: "gm" }) },
    regions: {},
    geometry: new EnvironmentGeometryService(),
    profiles: { register: () => () => true },
    mutations: {},
    timing: { registerHandler: () => () => true },
    activities: {},
    ongoingEffects: {},
    selectionIndicator: null
  });
  const item = makeValidWebSourceItem();
  const cast = [...item.system.activities.values()].find(activity => activity.name === "Cast Web");
  const save = [...item.system.activities.values()].find(activity => activity.name === "Web Save");
  const burn = [...item.system.activities.values()].find(activity => activity.name === "Burning Web Damage");
  cast.target.prompt = true;
  save.consumption.spellSlot = true;
  save.effects = ["restrained-template"];
  burn.consumption.targets = [{ type: "spellSlots", value: "1" }];

  const result = await web.validateSourceItem(item);
  assert.equal(result.passed, false);
  const failed = new Set(result.checks.filter(check => !check.passed).map(check => check.name));
  assert.equal(failed.has("Cast Web suppresses the native target/template prompt"), true);
  assert.equal(failed.has("Web Save has no damage or automatic effects"), true);
  assert.equal(failed.has("Web Save does not consume another spell slot or resource"), true);
  assert.equal(failed.has("Burning Web Damage does not consume another spell slot or resource"), true);
});

test("Web placement uses an invisible functional anchor with a fixed 20-foot Eskie square and manual live targeting", async () => {
  const previousGame = globalThis.game;
  const previousCanvas = globalThis.canvas;
  const previousSequencer = globalThis.Sequencer;
  const previousConst = globalThis.CONST;
  const scene = { documentName: "Scene", uuid: "Scene.web-placement", grid: { size: 100, distance: 5 }, dimensions: { size: 100, distance: 5 } };
  const casterDoc = { documentName: "Token", id: "caster", uuid: "Scene.web-placement.Token.caster", parent: scene, width: 1, height: 1, x: 0, y: 0, texture: { src: "caster.webp" } };
  const caster = { id: "caster", document: casterDoc, center: { x: 50, y: 50 } };
  const insideLive = { id: "inside-live", document: { id: "inside-live", uuid: "Scene.web-placement.Token.inside-live", hidden: false }, center: { x: 250, y: 250 }, isVisible: true };
  const finalOnly = { id: "final-only", document: { id: "final-only", uuid: "Scene.web-placement.Token.final-only", hidden: false }, center: { x: 550, y: 550 }, isVisible: true };
  const hidden = { id: "hidden", document: { id: "hidden", uuid: "Scene.web-placement.Token.hidden", hidden: true }, center: { x: 250, y: 250 }, isVisible: false };
  const targetHistory = [];
  globalThis.game = {
    user: {
      id: "player",
      isGM: false,
      targets: { ids: ["original"] },
      updateTokenTargets(ids) { targetHistory.push([...ids]); this.targets.ids = [...ids]; }
    }
  };
  globalThis.canvas = { scene, grid: { size: 100 }, tokens: { placeables: [caster, insideLive, finalOnly, hidden], get: id => [caster, insideLive, finalOnly, hidden].find(token => token.id === id) ?? null } };
  globalThis.CONST = { ...previousConst, GRID_SNAPPING_MODES: { ...(previousConst?.GRID_SNAPPING_MODES ?? {}), VERTEX: 240 } };
  globalThis.Sequencer = { Crosshair: { CALLBACKS: { SHOW: "show", MOVE: "move", PLACED: "placed", CANCEL: "cancel" } } };

  let captured = null;
  const crosshairs = {
    async show(options) {
      captured = options;
      await options.callbacks.show({ document: { x: 200, y: 200, direction: 0 } });
      await options.callbacks.move({ document: { x: 200, y: 200, direction: 0 } });
      return { cancelled: false, position: { document: { x: 550, y: 550, direction: 0 } }, mode: "eskie", visual: { source: "premium" } };
    }
  };
  const socket = new FakeSocket();
  const web = new WebService({
    socket,
    authority: { getPrimaryGm: () => null },
    regions: {},
    geometry: new EnvironmentGeometryService(),
    profiles: {},
    mutations: {},
    timing: {},
    activities: {},
    ongoingEffects: null,
    selectionIndicator: null,
    crosshairs
  });

  try {
    const placement = await web.placeCast({ casterToken: caster, sourceItem: { img: "web.webp" } });
    assert.equal(placement.placed, true);
    assert.deepEqual(placement.center, { x: 550, y: 550, elevation: null });
    assert.deepEqual(placement.targetIds, ["final-only"]);
    assert.equal(captured.collectTargets, false);
    assert.equal(captured.type, "circle", "functional crosshair is an anchor, not the displayed square");
    assert.equal(captured.distance, 0.1);
    assert.equal(captured.limitMaxRange, 60);
    assert.equal(captured.placement.snap.position, 240);
    assert.equal(captured.visual.shape, "rectangle");
    assert.deepEqual(captured.visual.size, { width: 20, height: 20 });
    assert.equal(captured.visual.sizeGridUnits, 4);
    assert.equal(captured.visual.scaleToObject, false);
    assert.equal(targetHistory.some(ids => ids.includes("inside-live") && !ids.includes("hidden")), true, "live callback targets the visible token whose center is inside the fixed square");
    assert.deepEqual(targetHistory.at(-1), ["final-only"], "confirmation recomputes authoritative targets from the final anchor");

    const restored = web.restorePlacementTargets(placement);
    assert.equal(restored.restored, true);
    assert.deepEqual(targetHistory.at(-1), ["original"]);
  } finally {
    globalThis.game = previousGame;
    globalThis.canvas = previousCanvas;
    globalThis.Sequencer = previousSequencer;
    globalThis.CONST = previousConst;
  }
});

test("Web placement cancellation restores the user's original Foundry targets", async () => {
  const previousGame = globalThis.game;
  const previousCanvas = globalThis.canvas;
  const previousSequencer = globalThis.Sequencer;
  const previousConst = globalThis.CONST;
  const scene = { documentName: "Scene", uuid: "Scene.web-cancel", grid: { size: 100, distance: 5 }, dimensions: { size: 100, distance: 5 } };
  const casterDoc = { documentName: "Token", id: "caster", uuid: "Scene.web-cancel.Token.caster", parent: scene, width: 1, height: 1, x: 0, y: 0 };
  const caster = { id: "caster", document: casterDoc, center: { x: 50, y: 50 } };
  const target = { id: "new-target", document: { id: "new-target", uuid: "Scene.web-cancel.Token.new-target", hidden: false }, center: { x: 200, y: 200 }, isVisible: true };
  const history = [];
  globalThis.game = { user: { id: "player", isGM: false, targets: { ids: ["original-a", "original-b"] }, updateTokenTargets(ids) { history.push([...ids]); this.targets.ids = [...ids]; } } };
  globalThis.canvas = { scene, grid: { size: 100 }, tokens: { placeables: [caster, target] } };
  globalThis.CONST = { ...previousConst, GRID_SNAPPING_MODES: { ...(previousConst?.GRID_SNAPPING_MODES ?? {}), VERTEX: 1 } };
  globalThis.Sequencer = { Crosshair: { CALLBACKS: { SHOW: "show", MOVE: "move", PLACED: "placed", CANCEL: "cancel" } } };
  const crosshairs = {
    async show(options) {
      await options.callbacks.show({ document: { x: 200, y: 200 } });
      await options.callbacks.cancel({ document: { x: 200, y: 200 } });
      return { cancelled: true, position: null };
    }
  };
  const web = new WebService({
    socket: new FakeSocket(), authority: { getPrimaryGm: () => null }, regions: {}, geometry: new EnvironmentGeometryService(), profiles: {}, mutations: {}, timing: {}, activities: {}, ongoingEffects: null, selectionIndicator: null, crosshairs
  });
  try {
    const result = await web.placeCast({ casterToken: caster });
    assert.equal(result.cancelled, true);
    assert.deepEqual(history.at(-1), ["original-a", "original-b"]);
    assert.equal(web.getStats().placementCancellations, 1);
  } finally {
    globalThis.game = previousGame;
    globalThis.canvas = previousCanvas;
    globalThis.Sequencer = previousSequencer;
    globalThis.CONST = previousConst;
  }
});

test("Premium Web casting preserves Eskie's design while masking persistent BLFX layers to the authoritative Region", async () => {
  const previousGame = globalThis.game;
  const previousCanvas = globalThis.canvas;
  const previousSequence = globalThis.Sequence;
  const previousSequencer = globalThis.Sequencer;
  const calls = [];
  const chain = new Proxy({}, {
    get(_target, property) {
      if (property === "play") return async () => { calls.push(["play"]); return true; };
      return (...args) => { calls.push([String(property), ...args]); return chain; };
    }
  });
  globalThis.Sequence = class { constructor() { return chain; } };
  globalThis.Sequencer = { EffectManager: { async endEffects(options) { calls.push(["endEffects", options]); } } };
  const scene = { documentName: "Scene", uuid: "Scene.web-visual", grid: { size: 100, distance: 5 }, dimensions: { size: 100, distance: 5 } };
  const region = {
    documentName: "Region",
    id: "web-region",
    uuid: "Scene.web-visual.Region.web-region",
    parent: scene,
    flags: { [MODULE_ID]: { [WEB_FLAG_KEY]: { instanceId: "web-visual", center: { x: 400, y: 400 }, sizeFeet: 20, visual: { effectName: "action-effects-5e.web.web-visual.persistent" } } } }
  };
  const caster = { id: "caster", document: { id: "caster", documentName: "Token", uuid: "Scene.web-visual.Token.caster", parent: scene } };
  globalThis.game = { user: { id: "gm", isGM: true }, users: [{ id: "gm", isGM: true, active: true }] };
  globalThis.canvas = { scene, grid: { size: 100 }, tokens: { get: id => id === "caster" ? caster : null, placeables: [caster] } };
  const web = new WebService({
    socket: new FakeSocket(), authority: { getPrimaryGm: () => ({ id: "gm" }) }, regions: {}, geometry: new EnvironmentGeometryService(), profiles: {}, mutations: {}, timing: {}, activities: {}, ongoingEffects: null, selectionIndicator: null, crosshairs: null
  });
  try {
    const result = await web.playCastAnimation({ regionOrUuid: region, casterToken: caster, mode: "premium" });
    assert.equal(result.played, true);
    const files = calls.filter(call => call[0] === "file").map(call => call[1]);
    assert.equal(files.includes("eskie.casting.arcane.01.side.loop.yellow"), true);
    assert.equal(files.includes("eskie.casting.arcane.01.center.loop.yellow"), true);
    assert.equal(files.includes("jb2a.magic_signs.circle.02.conjuration.complete.dark_yellow"), true);
    assert.equal(files.includes("jb2a.markers.light_orb.loop.white"), true);
    assert.equal(files.includes("jb2a.shield_themed.above.eldritch_web.01.dark_green"), true);
    assert.equal(files.includes("jb2a.impact.004.yellow"), true);
    assert.equal(files.includes("blfx.spell.template.square.nature.web.1.color1"), true);
    assert.equal(files.includes("blfx.spell.template.square.nature.web.2.color1"), true);
    assert.equal(calls.filter(call => call[0] === "mask" && call[1] === region).length, 2);
    assert.equal(calls.filter(call => call[0] === "tieToDocuments" && call[1] === region).length, 2);
    assert.equal(calls.filter(call => call[0] === "sound").length, 0, "Eskie reference animation contains no sound layer");
    assert.equal(web.getStats().castAnimations, 1);
  } finally {
    globalThis.game = previousGame;
    globalThis.canvas = previousCanvas;
    globalThis.Sequence = previousSequence;
    globalThis.Sequencer = previousSequencer;
  }
});

test("Web commit creates the authoritative Region, binds concentration, plays Premium presentation, and restores pre-cast targets", async () => {
  const previousGame = globalThis.game;
  const previousCanvas = globalThis.canvas;
  const previousMidiQOL = globalThis.MidiQOL;
  const previousSequence = globalThis.Sequence;
  const previousSequencer = globalThis.Sequencer;
  const previousRandomId = globalThis.foundry?.utils?.randomID;
  globalThis.foundry.utils.randomID = () => "web-commit-instance";
  const scene = { documentName: "Scene", id: "commit", uuid: "Scene.commit", grid: { size: 100, distance: 5 }, dimensions: { size: 100, distance: 5 } };
  const actor = { documentName: "Actor", uuid: "Actor.caster" };
  const item = { documentName: "Item", id: "web-item", uuid: "Actor.caster.Item.web-item" };
  const helper = { documentName: "Item", id: "escape-web", uuid: "Compendium.test.Item.escape-web" };
  const casterDocument = { documentName: "Token", id: "caster", uuid: "Scene.commit.Token.caster", parent: scene };
  const caster = { id: "caster", document: casterDocument };
  casterDocument.object = caster;
  documents.set(actor.uuid, actor);
  documents.set(item.uuid, item);
  documents.set(helper.uuid, helper);
  documents.set(casterDocument.uuid, casterDocument);

  const targetHistory = [];
  globalThis.game = {
    user: { id: "gm", isGM: true, targets: { ids: ["cast-target"] }, updateTokenTargets(ids) { targetHistory.push([...ids]); this.targets.ids = [...ids]; } },
    users: [{ id: "gm", isGM: true, active: true }]
  };
  globalThis.canvas = { scene, grid: { size: 100 }, tokens: { get: id => id === caster.id ? caster : null, placeables: [caster] } };
  globalThis.MidiQOL = {
    async addConcentrationDependent(_actor, region) {
      region.flags.dnd5e ??= {};
      region.flags.dnd5e.dependentOn = "Actor.caster.ActiveEffect.concentration";
      return true;
    }
  };
  const calls = [];
  const chain = new Proxy({}, {
    get(_target, property) {
      if (property === "play") return async () => true;
      return (...args) => { calls.push([String(property), ...args]); return chain; };
    }
  });
  globalThis.Sequence = class { constructor() { return chain; } };
  globalThis.Sequencer = { EffectManager: { async endEffects() {} } };

  let region = null;
  const regions = {
    async create(data) {
      region = {
        documentName: "Region",
        id: "web-region",
        uuid: "Scene.commit.Region.web-region",
        parent: scene,
        flags: structuredClone(data.flags),
        shapes: structuredClone(data.shapes),
        behaviors: structuredClone(data.behaviors),
        getFlag(scope, key) { return this.flags?.[scope]?.[key] ?? null; }
      };
      documents.set(region.uuid, region);
      return { created: true, regionUuid: region.uuid };
    }
  };
  const web = new WebService({
    socket: new FakeSocket(),
    authority: { getPrimaryGm: () => ({ id: "gm" }) },
    regions,
    geometry: new EnvironmentGeometryService(),
    profiles: {}, mutations: {}, timing: {}, activities: {},
    ongoingEffects: { validateConfig: value => value?.templateUuid ? { valid: true } : { valid: false, reason: "missing-grant-source" } },
    selectionIndicator: null, crosshairs: null
  });
  const placement = {
    placed: true,
    center: { x: 500, y: 500, elevation: null },
    sizeFeet: 20,
    visualMode: "premium",
    originalTargetIds: ["pre-a", "pre-b"]
  };
  try {
    const result = await web.commitCast({
      placement,
      sourceItemUuid: item.uuid,
      casterActorUuid: actor.uuid,
      casterTokenUuid: casterDocument.uuid,
      restraintOngoingAction: {
        enabled: true,
        templateUuid: helper.uuid,
        activityIdentifier: "escape-web",
        timing: "turnStart",
        removeEffectOnSuccess: true,
        indicatorRole: "responder"
      }
    });
    assert.equal(result.created, true);
    assert.equal(result.concentration.bound, true);
    assert.equal(result.animation.played, true);
    assert.equal(region.shapes.length, 1);
    assert.equal(region.behaviors.length, 3);
    assert.equal(region.flags[MODULE_ID][WEB_FLAG_KEY].restraintOngoingAction.templateUuid, helper.uuid);
    assert.equal(region.flags[MODULE_ID][WEB_FLAG_KEY].restraintOngoingAction.indicatorRole, "responder");
    assert.deepEqual(targetHistory.at(-1), ["pre-a", "pre-b"]);
    assert.equal(calls.filter(call => call[0] === "mask" && call[1] === region).length, 2);
  } finally {
    documents.clear();
    globalThis.game = previousGame;
    globalThis.canvas = previousCanvas;
    globalThis.MidiQOL = previousMidiQOL;
    globalThis.Sequence = previousSequence;
    globalThis.Sequencer = previousSequencer;
    globalThis.foundry.utils.randomID = previousRandomId;
  }
});

test("Web commit fails closed and removes an orphan Region when concentration binding is unavailable", async () => {
  const previousGame = globalThis.game;
  const previousCanvas = globalThis.canvas;
  const previousMidiQOL = globalThis.MidiQOL;
  const previousSequence = globalThis.Sequence;
  const previousSequencer = globalThis.Sequencer;
  const previousRandomId = globalThis.foundry?.utils?.randomID;
  globalThis.foundry.utils.randomID = () => "web-orphan-instance";
  const scene = { documentName: "Scene", id: "orphan", uuid: "Scene.orphan", grid: { size: 100, distance: 5 }, dimensions: { size: 100, distance: 5 } };
  const actor = { documentName: "Actor", uuid: "Actor.orphan-caster" };
  const item = { documentName: "Item", id: "web-item", uuid: "Actor.orphan-caster.Item.web-item" };
  const casterDocument = { documentName: "Token", id: "caster", uuid: "Scene.orphan.Token.caster", parent: scene };
  const caster = { id: "caster", document: casterDocument };
  casterDocument.object = caster;
  documents.set(actor.uuid, actor);
  documents.set(item.uuid, item);
  documents.set(casterDocument.uuid, casterDocument);
  globalThis.game = {
    user: { id: "gm", isGM: true, targets: { ids: [] }, updateTokenTargets(ids) { this.targets.ids = [...ids]; } },
    users: [{ id: "gm", isGM: true, active: true }]
  };
  globalThis.canvas = { scene, grid: { size: 100 }, tokens: { get: id => id === caster.id ? caster : null, placeables: [caster] } };
  globalThis.MidiQOL = { async addConcentrationDependent() { return false; } };
  globalThis.Sequence = class {};
  globalThis.Sequencer = { EffectManager: { async endEffects() {} } };

  let region = null;
  const deleted = [];
  const regions = {
    async create(data) {
      region = {
        documentName: "Region",
        id: "web-orphan",
        uuid: "Scene.orphan.Region.web-orphan",
        parent: scene,
        flags: structuredClone(data.flags),
        shapes: structuredClone(data.shapes),
        behaviors: structuredClone(data.behaviors),
        getFlag(scope, key) { return this.flags?.[scope]?.[key] ?? null; }
      };
      documents.set(region.uuid, region);
      return { created: true, regionUuid: region.uuid };
    },
    async delete(uuid) {
      deleted.push(uuid);
      documents.delete(uuid);
      return { deleted: true, regionUuid: uuid };
    }
  };
  const web = new WebService({
    socket: new FakeSocket(),
    authority: { getPrimaryGm: () => ({ id: "gm" }) },
    regions,
    geometry: new EnvironmentGeometryService(),
    profiles: {}, mutations: {}, timing: {}, activities: {}, ongoingEffects: null, selectionIndicator: null, crosshairs: null
  });

  try {
    const result = await web.commitCast({
      placement: { placed: true, center: { x: 500, y: 500, elevation: 0 }, sizeFeet: 20, visualMode: "premium", originalTargetIds: [] },
      sourceItemUuid: item.uuid,
      casterActorUuid: actor.uuid,
      casterTokenUuid: casterDocument.uuid
    });
    assert.equal(result.created, false);
    assert.equal(result.reason, "concentration-binding-failed");
    assert.equal(result.cleanup.deleted, true);
    assert.deepEqual(deleted, [region.uuid]);
    assert.equal(documents.has(region.uuid), false);
  } finally {
    documents.clear();
    globalThis.game = previousGame;
    globalThis.canvas = previousCanvas;
    globalThis.MidiQOL = previousMidiQOL;
    globalThis.Sequence = previousSequence;
    globalThis.Sequencer = previousSequencer;
    globalThis.foundry.utils.randomID = previousRandomId;
  }
});

test("Web geometry updates refresh the Region-masked persistent visual once from the primary GM", async () => {
  const previousGame = globalThis.game;
  const previousCanvas = globalThis.canvas;
  const previousSequence = globalThis.Sequence;
  const previousSequencer = globalThis.Sequencer;
  const previousHooks = globalThis.Hooks;
  const callbacks = new Map();
  globalThis.Hooks = {
    on(name, fn) { callbacks.set(name, fn); return `${name}-hook`; }
  };
  globalThis.game = { user: { id: "gm", isGM: true }, users: [{ id: "gm", isGM: true, active: true }] };
  const scene = { documentName: "Scene", uuid: "Scene.refresh", grid: { size: 100, distance: 5 }, dimensions: { size: 100, distance: 5 } };
  globalThis.canvas = { scene, grid: { size: 100 } };
  const calls = [];
  const chain = new Proxy({}, {
    get(_target, property) {
      if (property === "play") return async () => { calls.push(["play"]); return true; };
      return (...args) => { calls.push([String(property), ...args]); return chain; };
    }
  });
  globalThis.Sequence = class { constructor() { return chain; } };
  globalThis.Sequencer = { EffectManager: { async endEffects(options) { calls.push(["endEffects", options]); } } };
  const region = {
    documentName: "Region",
    id: "web-refresh",
    uuid: "Scene.refresh.Region.web-refresh",
    parent: scene,
    flags: { [MODULE_ID]: { [WEB_FLAG_KEY]: { instanceId: "web-refresh", center: { x: 400, y: 400 }, sizeFeet: 20, visual: { effectName: "action-effects-5e.web.web-refresh.persistent", mode: "premium" } } } }
  };
  const web = new WebService({
    socket: new FakeSocket(),
    authority: { getPrimaryGm: () => ({ id: "gm" }) },
    regions: {}, geometry: new EnvironmentGeometryService(),
    profiles: { register: () => () => true }, mutations: {},
    timing: { registerHandler: () => () => true }, activities: {}, ongoingEffects: null, selectionIndicator: null, crosshairs: null
  });

  try {
    web.initialize();
    assert.equal(typeof callbacks.get("updateRegion"), "function");
    callbacks.get("updateRegion")(region, { shapes: [{ type: "rectangle" }] });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(calls.filter(call => call[0] === "play").length, 1);
    assert.equal(calls.filter(call => call[0] === "mask" && call[1] === region).length, 2);
    assert.equal(calls.filter(call => call[0] === "endEffects").length, 1);
  } finally {
    globalThis.game = previousGame;
    globalThis.canvas = previousCanvas;
    globalThis.Sequence = previousSequence;
    globalThis.Sequencer = previousSequencer;
    globalThis.Hooks = previousHooks;
  }
});
