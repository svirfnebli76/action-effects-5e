import assert from "node:assert/strict";
import test from "node:test";

import {
  MODULE_ID,
  ONGOING_ACTION_EFFECT_FLAG,
  ONGOING_ACTION_ITEM_FLAG
} from "../scripts/core/constants.js";
import { OngoingEffectService } from "../scripts/ongoing-effects/ongoing-effect-service.js";

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
globalThis.fromUuid = async uuid => documents.get(uuid) ?? null;
globalThis.canvas = { ready: false };
globalThis.ui = { notifications: { info() {}, error() {} } };

class FakeSocket {
  constructor() { this.handlers = new Map(); }
  register(name, handler) { this.handlers.set(name, handler); }
  async executeAsUser(name, _userId, ...args) { return this.handlers.get(name)(...args); }
}

function makeOngoingService() {
  return new OngoingEffectService({
    socket: new FakeSocket(),
    authority: {
      isPrimary: () => true,
      getPrimaryGm: () => ({ id: "gm" })
    },
    catSpell: { getStatus: () => ({ active: false, capabilities: {} }) },
    selectionIndicator: null
  });
}

function makeGrantItem({ actor, id, sourceEffectUuid }) {
  return {
    documentName: "Item",
    id,
    uuid: `${actor.uuid}.Item.${id}`,
    name: "Escape Web",
    actor,
    parent: actor,
    flags: {
      [MODULE_ID]: {
        [ONGOING_ACTION_ITEM_FLAG]: {
          sourceEffectUuid,
          templateUuid: "Compendium.action-effects-5e.ae5e-administrative.Item.escape",
          activityIdentifier: "escape-web",
          removeEffectOnSuccess: true
        }
      }
    }
  };
}

test("OngoingEffectService serializes concurrent grant requests for one exact Active Effect UUID", async () => {
  const previousGame = globalThis.game;
  globalThis.game = { user: { id: "gm", isGM: true }, settings: { get: () => false } };
  const service = makeOngoingService();

  const template = {
    documentName: "Item",
    uuid: "Compendium.action-effects-5e.ae5e-administrative.Item.escape",
    toObject: () => ({
      _id: "template",
      name: "Escape Web",
      type: "feat",
      system: { activities: {} },
      flags: {}
    })
  };

  let creates = 0;
  const actor = {
    uuid: "Actor.synthetic-owner",
    items: new Map(),
    async createEmbeddedDocuments(type, data) {
      assert.equal(type, "Item");
      creates += 1;
      // Yield once to make the old double-create race deterministic.
      await new Promise(resolve => setTimeout(resolve, 5));
      const id = `escape-${creates}`;
      const item = {
        documentName: "Item",
        id,
        uuid: `${actor.uuid}.Item.${id}`,
        name: data[0].name,
        actor,
        parent: actor,
        flags: structuredClone(data[0].flags),
        system: structuredClone(data[0].system ?? {})
      };
      actor.items.set(id, item);
      documents.set(item.uuid, item);
      return [item];
    }
  };

  const effect = {
    documentName: "ActiveEffect",
    id: "web-a",
    uuid: `${actor.uuid}.ActiveEffect.web-a`,
    name: "Restrained by Web",
    parent: actor,
    flags: {
      [MODULE_ID]: {
        [ONGOING_ACTION_EFFECT_FLAG]: {
          enabled: true,
          templateUuid: template.uuid,
          activityIdentifier: "escape-web",
          removeEffectOnSuccess: true
        }
      }
    },
    async update(data) {
      this.flags[MODULE_ID][ONGOING_ACTION_EFFECT_FLAG] =
        structuredClone(data[`flags.${MODULE_ID}.${ONGOING_ACTION_EFFECT_FLAG}`]);
    }
  };

  documents.set(template.uuid, template);
  documents.set(effect.uuid, effect);

  try {
    const [first, second] = await Promise.all([
      service.ensureGrant(effect),
      service.ensureGrant(effect)
    ]);

    assert.equal(creates, 1, "concurrent callers must create only one helper Item");
    assert.equal(actor.items.size, 1);
    assert.equal(first.item.uuid, second.item.uuid);
    assert.equal(
      first.item.flags[MODULE_ID][ONGOING_ACTION_ITEM_FLAG].sourceEffectUuid,
      effect.uuid
    );
    assert.equal(
      effect.flags[MODULE_ID][ONGOING_ACTION_EFFECT_FLAG].grantedItemUuid,
      first.item.uuid
    );
  } finally {
    documents.clear();
    globalThis.game = previousGame;
  }
});

test("OngoingEffectService reuses an existing sourceEffectUuid grant even when grantedItemUuid is missing", async () => {
  const previousGame = globalThis.game;
  globalThis.game = { user: { id: "gm", isGM: true }, settings: { get: () => false } };
  const service = makeOngoingService();

  let creates = 0;
  const actor = {
    uuid: "Actor.synthetic-owner",
    items: new Map(),
    async createEmbeddedDocuments() { creates += 1; return []; }
  };
  const effect = {
    documentName: "ActiveEffect",
    id: "web-a",
    uuid: `${actor.uuid}.ActiveEffect.web-a`,
    name: "Restrained by Web",
    parent: actor,
    flags: {
      [MODULE_ID]: {
        [ONGOING_ACTION_EFFECT_FLAG]: {
          enabled: true,
          templateUuid: "Compendium.action-effects-5e.ae5e-administrative.Item.escape",
          activityIdentifier: "escape-web"
        }
      }
    },
    async update(data) {
      this.flags[MODULE_ID][ONGOING_ACTION_EFFECT_FLAG] =
        structuredClone(data[`flags.${MODULE_ID}.${ONGOING_ACTION_EFFECT_FLAG}`]);
    }
  };
  const existing = makeGrantItem({ actor, id: "escape-existing", sourceEffectUuid: effect.uuid });
  actor.items.set(existing.id, existing);
  documents.set(existing.uuid, existing);

  try {
    const result = await service.ensureGrant(effect);
    assert.equal(result.created, false);
    assert.equal(result.reason, "already-granted");
    assert.equal(result.item.uuid, existing.uuid);
    assert.equal(creates, 0);
    assert.equal(
      effect.flags[MODULE_ID][ONGOING_ACTION_EFFECT_FLAG].grantedItemUuid,
      existing.uuid,
      "the parent effect should repair its exact helper UUID linkage"
    );
  } finally {
    documents.clear();
    globalThis.game = previousGame;
  }
});

test("OngoingEffectService teardown removes every duplicate helper for one effect without touching another overlapping Web", async () => {
  const previousGame = globalThis.game;
  globalThis.game = { user: { id: "gm", isGM: true }, settings: { get: () => false } };
  const service = makeOngoingService();

  const actor = {
    uuid: "Actor.synthetic-owner",
    items: new Map(),
    deleted: [],
    async deleteEmbeddedDocuments(type, ids) {
      assert.equal(type, "Item");
      for (const id of ids) {
        const item = this.items.get(id);
        if (item) documents.delete(item.uuid);
        this.items.delete(id);
        this.deleted.push(id);
      }
      return ids;
    }
  };

  const effectA = {
    documentName: "ActiveEffect",
    id: "web-a",
    uuid: `${actor.uuid}.ActiveEffect.web-a`,
    parent: actor,
    flags: {
      [MODULE_ID]: {
        [ONGOING_ACTION_EFFECT_FLAG]: {
          enabled: true,
          templateUuid: "Compendium.test.Item.escape",
          grantedItemUuid: `${actor.uuid}.Item.a2`
        }
      }
    }
  };
  const effectB = {
    documentName: "ActiveEffect",
    id: "web-b",
    uuid: `${actor.uuid}.ActiveEffect.web-b`,
    parent: actor,
    flags: {
      [MODULE_ID]: {
        [ONGOING_ACTION_EFFECT_FLAG]: {
          enabled: true,
          templateUuid: "Compendium.test.Item.escape",
          grantedItemUuid: `${actor.uuid}.Item.b1`
        }
      }
    }
  };

  const a1 = makeGrantItem({ actor, id: "a1", sourceEffectUuid: effectA.uuid });
  const a2 = makeGrantItem({ actor, id: "a2", sourceEffectUuid: effectA.uuid });
  const b1 = makeGrantItem({ actor, id: "b1", sourceEffectUuid: effectB.uuid });
  for (const item of [a1, a2, b1]) {
    actor.items.set(item.id, item);
    documents.set(item.uuid, item);
  }
  documents.set(effectA.uuid, effectA);
  documents.set(effectB.uuid, effectB);

  try {
    const result = await service.removeGrant(effectA, a2.uuid);
    assert.equal(result.removed, true);
    assert.equal(result.removedCount, 2);
    assert.deepEqual(new Set(actor.deleted), new Set(["a1", "a2"]));
    assert.equal(actor.items.has("b1"), true, "overlapping Web B helper must survive Web A teardown");
    assert.equal(service.getStats().grantsRemoved, 2);
  } finally {
    documents.clear();
    globalThis.game = previousGame;
  }
});

