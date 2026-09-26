import assert from "node:assert/strict";
import test from "node:test";

import {
  MODULE_ID,
  ONGOING_ACTION_EFFECT_FLAG,
  ONGOING_ACTION_ITEM_FLAG
} from "../scripts/core/constants.js";
import { ActivityExecutionService } from "../scripts/activities/activity-execution-service.js";
import { OngoingEffectService } from "../scripts/ongoing-effects/ongoing-effect-service.js";

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
  const activity = { id: "fixture-save", uuid: "Item.fixture.Activity.fixture-save", name: "Fixture Save" };
  const item = {
    documentName: "Item",
    uuid: "Item.fixture",
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
      id: "Workflow.fixture-save",
      saves: new Set(),
      failedSaves: new Set(targets)
    })
  };
  const service = new ActivityExecutionService({ socket, authority, catSpell });
  globalThis.game = { user: { id: "gm", isGM: true }, users: [{ id: "gm", isGM: true, active: true }] };

  try {
    const first = await service.execute({
      itemUuid: item.uuid,
      activityReference: "Fixture Save",
      targetTokenUuids: [token.uuid],
      idempotencyKey: "fixture-save-test"
    });
    assert.equal(first.executed, true);
    assert.equal(first.via, "cat-midi");
    assert.deepEqual(first.failedSaves, [token.uuid]);
    assert.doesNotThrow(() => JSON.stringify(first));

    const duplicate = await service.execute({
      itemUuid: item.uuid,
      activityReference: "Fixture Save",
      targetTokenUuids: [token.uuid],
      idempotencyKey: "fixture-save-test"
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
    id: "escape-fixture",
    name: "Escape Fixture",
    toObject: () => ({
      _id: "escape-fixture",
      type: "check",
      name: "Escape Fixture",
      check: { ability: "str", associated: ["ath"], dc: { calculation: "", formula: "0" } },
      consumption: { targets: [], scaling: { allowed: false, max: "" } }
    })
  };
  const sourceItem = {
    documentName: "Item",
    uuid: "Item.fixture-source",
    name: "Fixture Area",
    img: "icons/fixture.webp",
    system: { activities: new Map([[escapeActivity.id, escapeActivity]]) },
    toObject: () => ({
      name: "Fixture Area",
      type: "spell",
      img: "icons/fixture.webp",
      system: {
        description: { value: "Fixture Area", chat: "" },
        source: { custom: "" },
        identifier: "fixture-area"
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
        id: "fixture-escape-grant",
        uuid: "Actor.target.Item.fixture-escape-grant",
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
    id: "restrained-fixture",
    uuid: "Actor.target.ActiveEffect.restrained-fixture",
    parent: actor,
    origin: sourceItem.uuid,
    name: "Fixture Restraint",
    flags: {
      [MODULE_ID]: {
        [ONGOING_ACTION_EFFECT_FLAG]: {
          enabled: true,
          sourceActivity: {
            activityReference: "Escape Fixture",
            itemName: "Fixture Area — Escape",
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
    assert.equal(createdItemData.name, "Fixture Area — Escape");
    const activity = createdItemData.system.activities["escape-fixture"];
    assert.equal(activity.check.dc.formula, "15");
    const grantFlag = createdItemData.flags[MODULE_ID][ONGOING_ACTION_ITEM_FLAG];
    assert.equal(grantFlag.sourceEffectUuid, effect.uuid);
    assert.equal(grantFlag.sourceItemUuid, sourceItem.uuid);
    assert.equal(grantFlag.sourceActivity, "Escape Fixture");
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

test("ActivityExecutionService fails closed on an unresolved explicit target without poisoning idempotency", async () => {
  const previousGame = globalThis.game;
  const socket = new FakeSocket();
  const authority = { getPrimaryGm: () => ({ id: "gm" }) };
  const activity = { id: "fixture-save", uuid: "Item.fixture.Activity.fixture-save", name: "Fixture Save", type: "save" };
  const item = { documentName: "Item", uuid: "Item.fixture", system: { activities: new Map([[activity.id, activity]]) } };
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
      activityReference: "Fixture Save",
      targetTokenUuids: ["Scene.test.Token.missing"],
      idempotencyKey: "fixture-target-retry"
    });
    assert.equal(first.executed, false);
    assert.equal(first.reason, "target-unavailable");
    assert.deepEqual(first.missingTargetUuids, ["Scene.test.Token.missing"]);
    assert.equal(uses, 0);

    const token = { documentName: "Token", uuid: "Scene.test.Token.missing", actor: { uuid: "Actor.target" } };
    documents.set(token.uuid, token);
    const retry = await service.execute({
      itemUuid: item.uuid,
      activityReference: "Fixture Save",
      targetTokenUuids: [token.uuid],
      idempotencyKey: "fixture-target-retry"
    });
    assert.equal(retry.executed, true);
    assert.equal(uses, 1);
    assert.deepEqual(retry.saves, [token.uuid]);
  } finally {
    documents.clear();
    globalThis.game = previousGame;
  }
});

test("ActivityExecutionService preserves TokenDocument targets and pins CAT execution to the authority GM", async () => {
  const previousGame = globalThis.game;
  const socket = new FakeSocket();
  const authority = { getPrimaryGm: () => ({ id: "gm" }) };
  const activity = {
    id: "fixture-save",
    uuid: "Item.fixture.Activity.fixture-save",
    name: "Fixture Save",
    type: "save",
    actor: { uuid: "Actor.caster" }
  };
  const item = {
    documentName: "Item",
    uuid: "Item.fixture",
    system: { activities: new Map([[activity.id, activity]]) }
  };
  const tokenObject = {
    id: "target",
    document: null
  };
  const tokenDocument = {
    documentName: "Token",
    id: "target",
    uuid: "Scene.test.Token.target",
    actor: { uuid: "Actor.target" },
    object: tokenObject
  };
  tokenObject.document = tokenDocument;

  let receivedTargets = null;
  let receivedOptions = null;
  const catSpell = {
    getStatus: () => ({ active: true, capabilities: { completeActivityUse: true } }),
    getActivityByIdentifier: () => null,
    completeActivityUse: async (_activity, targets, options) => {
      receivedTargets = targets;
      receivedOptions = structuredClone(options);
      return {
        id: "Workflow.fixture-save-authority",
        failedSaves: new Set(targets)
      };
    }
  };

  const service = new ActivityExecutionService({ socket, authority, catSpell });
  globalThis.game = {
    user: { id: "gm", isGM: true },
    users: [
      { id: "gm", isGM: true, active: true },
      { id: "caster-player", isGM: false, active: true }
    ]
  };
  documents.set(item.uuid, item);
  documents.set(tokenDocument.uuid, tokenDocument);

  try {
    const result = await service.execute({
      itemUuid: item.uuid,
      activityReference: "Fixture Save",
      targetTokenUuids: [tokenDocument.uuid],
      idempotencyKey: "fixture-save-authority-contract",
      options: { configureDialog: false }
    });

    assert.equal(result.executed, true);
    assert.equal(receivedTargets.length, 1);
    assert.equal(receivedTargets[0], tokenDocument);
    assert.notEqual(receivedTargets[0], tokenObject);
    assert.equal(receivedTargets[0].uuid, tokenDocument.uuid);
    assert.equal(receivedOptions.userId, "gm");
    assert.equal(receivedOptions.configureDialog, false);
    assert.deepEqual(result.failedSaves, [tokenDocument.uuid]);
  } finally {
    documents.clear();
    globalThis.game = previousGame;
  }
});

test("ActivityExecutionService preserves an explicit CAT execution userId override", async () => {
  const previousGame = globalThis.game;
  const socket = new FakeSocket();
  const authority = { getPrimaryGm: () => ({ id: "gm" }) };
  const activity = { id: "fixture-save", uuid: "Item.fixture.Activity.fixture-save", name: "Fixture Save", type: "save" };
  const item = { documentName: "Item", uuid: "Item.fixture", system: { activities: new Map([[activity.id, activity]]) } };
  const token = { documentName: "Token", uuid: "Scene.test.Token.target", actor: { uuid: "Actor.target" } };
  let receivedOptions = null;
  const catSpell = {
    getStatus: () => ({ active: true, capabilities: { completeActivityUse: true } }),
    getActivityByIdentifier: () => null,
    completeActivityUse: async (_activity, targets, options) => {
      receivedOptions = structuredClone(options);
      return { id: "Workflow.explicit-user", saves: new Set(targets) };
    }
  };
  const service = new ActivityExecutionService({ socket, authority, catSpell });
  globalThis.game = { user: { id: "gm", isGM: true }, users: [{ id: "gm", isGM: true, active: true }] };
  documents.set(item.uuid, item);
  documents.set(token.uuid, token);

  try {
    const result = await service.execute({
      itemUuid: item.uuid,
      activityReference: "Fixture Save",
      targetTokenUuids: [token.uuid],
      idempotencyKey: "fixture-save-explicit-user",
      options: { userId: "explicit-user" }
    });
    assert.equal(result.executed, true);
    assert.equal(receivedOptions.userId, "explicit-user");
  } finally {
    documents.clear();
    globalThis.game = previousGame;
  }
});

test("ActivityExecutionService releases an idempotency claim when CAT/Midi execution throws", async () => {
  const previousGame = globalThis.game;
  const socket = new FakeSocket();
  const authority = { getPrimaryGm: () => ({ id: "gm" }) };
  const activity = { id: "burn", uuid: "Item.fixture.Activity.burn", name: "Fixture Burning Damage", type: "damage" };
  const item = { documentName: "Item", uuid: "Item.fixture", system: { activities: new Map([[activity.id, activity]]) } };
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
      activityReference: "Fixture Burning Damage",
      targetTokenUuids: [token.uuid],
      idempotencyKey: "fixture-burn-retry"
    }), /synthetic CAT failure/);

    const retry = await service.execute({
      itemUuid: item.uuid,
      activityReference: "Fixture Burning Damage",
      targetTokenUuids: [token.uuid],
      idempotencyKey: "fixture-burn-retry"
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
    id: "fixture-save",
    name: "Fixture Save",
    type: "save",
    async use() { nativeUses += 1; return { id: "Workflow.native" }; }
  };
  const item = { documentName: "Item", uuid: "Item.fixture", system: { activities: new Map([[activity.id, activity]]) } };
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
      activityReference: "Fixture Save",
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

