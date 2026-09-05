import assert from "node:assert/strict";
import test from "node:test";

import {
  MODULE_ID,
  ONGOING_ACTION_EFFECT_FLAG,
  ONGOING_ACTION_ITEM_FLAG
} from "../scripts/core/constants.js";
import { OngoingEffectService } from "../scripts/ongoing-effects/ongoing-effect-service.js";

class FakeSocket {
  constructor({ gmResult = { handled: true, success: true, effectRemoved: true } } = {}) {
    this.handlers = new Map();
    this.gmCalls = [];
    this.gmResult = gmResult;
  }

  register(name, handler) {
    this.handlers.set(name, handler);
  }

  async executeAsGM(name, ...args) {
    this.gmCalls.push({ name, args });
    return this.gmResult;
  }

  async executeAsUser(name, _userId, ...args) {
    return this.handlers.get(name)(...args);
  }
}

function makeService({ socket = new FakeSocket(), catSpell = null, authority = null } = {}) {
  catSpell ??= {
    getStatus: () => ({ active: false, capabilities: {} })
  };
  authority ??= {
    isPrimary: () => Boolean(globalThis.game?.user?.isGM),
    getPrimaryGm: () => ({ id: "gm" })
  };
  return {
    socket,
    service: new OngoingEffectService({
      socket,
      authority,
      catSpell,
      selectionIndicator: null
    })
  };
}

function makeGrantFixture() {
  const actor = {
    uuid: "Actor.target",
    deletedEffects: [],
    async deleteEmbeddedDocuments(type, ids) {
      assert.equal(type, "ActiveEffect");
      this.deletedEffects.push(...ids);
      for (const id of ids) documents.delete(`Actor.target.ActiveEffect.${id}`);
      return ids;
    }
  };
  const effect = {
    documentName: "ActiveEffect",
    id: "entangled",
    uuid: "Actor.target.ActiveEffect.entangled",
    parent: actor,
    flags: {
      [MODULE_ID]: {
        [ONGOING_ACTION_EFFECT_FLAG]: {
          enabled: true,
          templateUuid: "Compendium.action-effects-5e.ae5e-administrative.Item.escape",
          grantedItemUuid: "Actor.target.Item.escape"
        }
      }
    }
  };
  const item = {
    documentName: "Item",
    id: "escape",
    uuid: "Actor.target.Item.escape",
    actor,
    parent: actor,
    flags: {
      [MODULE_ID]: {
        [ONGOING_ACTION_ITEM_FLAG]: {
          sourceEffectUuid: effect.uuid,
          templateUuid: "Compendium.action-effects-5e.ae5e-administrative.Item.escape",
          removeEffectOnSuccess: true
        }
      }
    }
  };
  return { actor, effect, item };
}

const documents = new Map();

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

globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 } };
globalThis.canvas = { ready: false };
globalThis.ui = { notifications: { info() {}, error() {} } };
globalThis.fromUuid = async uuid => documents.get(uuid) ?? null;

test("player workflow result is reduced to plain data and routed to the GM authority", async () => {
  const previousGame = globalThis.game;
  globalThis.game = { user: { id: "player", isGM: false }, settings: { get: () => false } };
  const { actor, effect, item } = makeGrantFixture();
  const socket = new FakeSocket();
  const { service } = makeService({ socket });
  const workflow = {
    id: "Workflow.escape.1",
    item,
    activity: { id: "escape-check", uuid: "Activity.escape-check", item },
    saves: new Set(),
    failedSaves: new Set(),
    ae5eOngoingSuccess: true,
    utilityRolls: [{ total: 18 }],
    dc: 14
  };

  try {
    const result = await service.processWorkflowResult(workflow);
    assert.equal(result.handled, true);
    assert.equal(result.success, true);
    assert.equal(result.routed, true);
    assert.equal(socket.gmCalls.length, 1);
    assert.equal(socket.gmCalls[0].name, "ongoingEffects.resolveResult");

    const payload = socket.gmCalls[0].args[0];
    assert.equal(payload.schema, "ae5e.ongoing-workflow-result");
    assert.equal(payload.version, 1);
    assert.equal(payload.success, true);
    assert.equal(payload.effectUuid, effect.uuid);
    assert.equal(payload.itemUuid, item.uuid);
    assert.equal(payload.actorUuid, actor.uuid);
    assert.equal(payload.workflowId, workflow.id);
    assert.equal(payload.rollTotal, 18);
    assert.equal(payload.dc, 14);
    assert.doesNotThrow(() => JSON.stringify(payload));
    assert.equal(actor.deletedEffects.length, 0, "player client must not delete the authoritative effect locally");
  } finally {
    globalThis.game = previousGame;
  }
});

test("duplicate Midi completion hooks route one authority result per workflow", async () => {
  const previousGame = globalThis.game;
  globalThis.game = { user: { id: "player", isGM: false }, settings: { get: () => false } };
  const { actor, item } = makeGrantFixture();
  const socket = new FakeSocket();
  const { service } = makeService({ socket });
  const workflow = {
    id: "Workflow.escape.duplicate",
    item,
    saves: new Set([actor]),
    failedSaves: new Set()
  };

  try {
    const [first, second] = await Promise.all([
      service.processWorkflowResult(workflow),
      service.processWorkflowResult(workflow)
    ]);
    assert.equal(first.handled, true);
    assert.equal(second.handled, true);
    assert.equal(socket.gmCalls.length, 1);
    assert.equal(service.getStats().duplicateWorkflowResults, 1);
  } finally {
    globalThis.game = previousGame;
  }
});


test("same Midi Activity ID is processed independently across failure then success executions", async () => {
  const previousGame = globalThis.game;
  globalThis.game = { user: { id: "gm", isGM: true }, settings: { get: () => false } };
  const { actor, effect, item } = makeGrantFixture();
  documents.set(effect.uuid, effect);
  documents.set(item.uuid, item);
  const { service } = makeService();

  const activity = {
    id: "escape-check",
    uuid: "Actor.target.Item.escape.Activity.escape-check",
    item
  };

  const failure = {
    id: activity.uuid,
    item,
    activity,
    saves: new Set(),
    failedSaves: new Set([actor]),
    tokenSaves: {
      "Scene.test.Token.target": { total: 4, isSuccess: false }
    },
    dc: 15
  };

  const success = {
    id: activity.uuid,
    item,
    activity,
    saves: new Set([actor]),
    failedSaves: new Set(),
    tokenSaves: {
      "Scene.test.Token.target": { total: 18, isSuccess: true }
    },
    dc: 15
  };

  try {
    const failed = await service.processWorkflowResult(failure);
    assert.equal(failed.handled, true);
    assert.equal(failed.success, false);
    assert.deepEqual(actor.deletedEffects, []);

    const succeeded = await service.processWorkflowResult(success);
    assert.equal(succeeded.handled, true);
    assert.equal(succeeded.success, true);
    assert.equal(succeeded.effectRemoved, true);
    assert.deepEqual(actor.deletedEffects, [effect.id]);

    const stats = service.getStats();
    assert.equal(stats.failures, 1);
    assert.equal(stats.successes, 1);
    assert.equal(stats.duplicateWorkflowResults, 0,
      "a later execution of the same Activity UUID must not be mistaken for the earlier workflow");
  } finally {
    documents.clear();
    globalThis.game = previousGame;
  }
});

test("duplicate completion hooks for one workflow object still de-duplicate when workflow.id is an Activity UUID", async () => {
  const previousGame = globalThis.game;
  globalThis.game = { user: { id: "player", isGM: false }, settings: { get: () => false } };
  const { actor, item } = makeGrantFixture();
  const socket = new FakeSocket();
  const { service } = makeService({ socket });

  const workflow = {
    id: "Actor.target.Item.escape.Activity.escape-check",
    item,
    saves: new Set([actor]),
    failedSaves: new Set(),
    tokenSaves: {
      "Scene.test.Token.target": { total: 18, isSuccess: true }
    },
    dc: 15
  };

  try {
    const first = await service.processWorkflowResult(workflow);
    const second = await service.processWorkflowResult(workflow);

    assert.equal(first.handled, true);
    assert.equal(second.handled, true);
    assert.equal(socket.gmCalls.length, 1,
      "both Midi completion hooks for the same live workflow must route only once");
    assert.equal(service.getStats().duplicateWorkflowResults, 1);

    const payload = socket.gmCalls[0].args[0];
    assert.equal(payload.workflowId, workflow.id);
    assert.equal(typeof payload.executionId, "string");
    assert.ok(payload.executionId.length > 0);
  } finally {
    globalThis.game = previousGame;
  }
});

test("ongoing-effect result extraction uses tokenSaves and never touches deprecated Midi getters", async () => {
  const previousGame = globalThis.game;
  globalThis.game = { user: { id: "player", isGM: false }, settings: { get: () => false } };
  const { actor, item } = makeGrantFixture();
  const socket = new FakeSocket();
  const { service } = makeService({ socket });

  const workflow = {
    id: "Actor.target.Item.escape.Activity.escape-check",
    item,
    activity: {
      id: "escape-check",
      uuid: "Actor.target.Item.escape.Activity.escape-check",
      item,
      check: { dc: { value: 15 } }
    },
    saves: new Set([actor]),
    failedSaves: new Set(),
    tokenSaves: new Map([
      ["Scene.test.Token.target", { total: 19, isSuccess: true }]
    ]),
    dc: 15
  };

  Object.defineProperty(workflow, "saveRolls", {
    configurable: true,
    get() {
      throw new Error("deprecated workflow.saveRolls getter was accessed");
    }
  });

  Object.defineProperty(workflow, "uuid", {
    configurable: true,
    get() {
      throw new Error("deprecated workflow.uuid getter was accessed");
    }
  });

  try {
    const result = await service.processWorkflowResult(workflow);
    assert.equal(result.handled, true);
    assert.equal(result.success, true);
    assert.equal(socket.gmCalls.length, 1);

    const payload = socket.gmCalls[0].args[0];
    assert.equal(payload.rollTotal, 19);
    assert.equal(payload.dc, 15);
    assert.equal(payload.workflowId, workflow.id);
    assert.equal(typeof payload.executionId, "string");
  } finally {
    globalThis.game = previousGame;
  }
});

test("GM authority validates the grant/effect pair and removes the parent effect on success", async () => {
  const previousGame = globalThis.game;
  globalThis.game = { user: { id: "gm", isGM: true }, settings: { get: () => false } };
  const { actor, effect, item } = makeGrantFixture();
  documents.set(effect.uuid, effect);
  documents.set(item.uuid, item);
  const { service } = makeService();

  try {
    const result = await service.resolveWorkflowResultPayload({
      schema: "ae5e.ongoing-workflow-result",
      version: 1,
      success: true,
      effectUuid: effect.uuid,
      itemUuid: item.uuid,
      actorUuid: actor.uuid,
      activityUuid: "Activity.escape-check",
      workflowId: "Workflow.escape.2",
      executionUserId: "player",
      rollTotal: 19,
      dc: 14
    });

    assert.equal(result.handled, true);
    assert.equal(result.success, true);
    assert.equal(result.effectRemoved, true);
    assert.deepEqual(actor.deletedEffects, [effect.id]);
    assert.equal(service.getStats().authorityResultsResolved, 1);
    assert.equal(service.getStats().successes, 1);
  } finally {
    documents.clear();
    globalThis.game = previousGame;
  }
});

test("GM authority preserves the parent effect on failure", async () => {
  const previousGame = globalThis.game;
  globalThis.game = { user: { id: "gm", isGM: true }, settings: { get: () => false } };
  const { actor, effect, item } = makeGrantFixture();
  documents.set(effect.uuid, effect);
  documents.set(item.uuid, item);
  const { service } = makeService();

  try {
    const result = await service.resolveWorkflowResultPayload({
      schema: "ae5e.ongoing-workflow-result",
      version: 1,
      success: false,
      effectUuid: effect.uuid,
      itemUuid: item.uuid,
      workflowId: "Workflow.escape.3",
      executionUserId: "player"
    });

    assert.equal(result.handled, true);
    assert.equal(result.success, false);
    assert.equal(result.effectRemoved, false);
    assert.deepEqual(actor.deletedEffects, []);
    assert.equal(service.getStats().failures, 1);
  } finally {
    documents.clear();
    globalThis.game = previousGame;
  }
});

test("prompt socket never returns a live Midi workflow object", async () => {
  const previousGame = globalThis.game;
  globalThis.game = { user: { id: "player", isGM: false }, settings: { get: () => false } };
  const { actor, effect, item } = makeGrantFixture();
  const activity = { id: "escape-check", uuid: "Activity.escape-check", item, actor };
  item.system = { activities: new Map([[activity.id, activity]]) };
  documents.set(effect.uuid, effect);
  documents.set(item.uuid, item);

  const workflow = {
    id: "Workflow.circular",
    item,
    activity
  };
  workflow.circular = workflow;

  const catSpell = {
    getStatus: () => ({ active: true, capabilities: { completeActivityUse: true } }),
    completeActivityUse: async () => workflow
  };
  const socket = new FakeSocket();
  const { service } = makeService({ socket, catSpell });
  void service;

  try {
    const promptHandler = socket.handlers.get("ongoingEffects.prompt");
    assert.equal(typeof promptHandler, "function");
    const result = await promptHandler({
      mandatory: true,
      itemUuid: item.uuid,
      effectUuid: effect.uuid,
      actorUuid: actor.uuid,
      itemName: "Entangle (Escape)",
      effectName: "Entangled",
      claimKey: "test:prompt"
    });

    assert.equal(result.executed, true);
    assert.equal(result.via, "cat");
    assert.equal(result.workflowId, workflow.id);
    assert.equal("workflow" in result, false);
    assert.doesNotThrow(() => JSON.stringify(result));
  } finally {
    documents.clear();
    globalThis.game = previousGame;
  }
});
