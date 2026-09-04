import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const { PersistentAreaLifecycleService } = await import("../scripts/environment/persistent-area-lifecycle-service.js");
const {
  MODULE_ID,
  ONGOING_ACTION_EFFECT_FLAG,
  PERSISTENT_AREA_EFFECT_FLAG
} = await import("../scripts/core/constants.js");

function getProperty(object, path) {
  return String(path).split(".").reduce((value, part) => value?.[part], object);
}

function makeCollection(values = []) {
  const map = new Map(values.map(value => [value.id, value]));
  map.find = predicate => [...map.values()].find(predicate);
  return map;
}

function makeActor({ id, uuid }) {
  const actor = {
    id,
    uuid,
    documentName: "Actor",
    effects: makeCollection(),
    items: makeCollection(),
    async createEmbeddedDocuments(type, dataArray) {
      assert.equal(type, "ActiveEffect");
      const created = dataArray.map((data, index) => {
        const effectId = `${id}-effect-${actor.effects.size + index + 1}`;
        const effect = {
          ...structuredClone(data),
          id: effectId,
          uuid: `${uuid}.ActiveEffect.${effectId}`,
          documentName: "ActiveEffect",
          parent: actor,
          getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
        };
        actor.effects.set(effect.id, effect);
        return effect;
      });
      return created;
    },
    async deleteEmbeddedDocuments(type, ids) {
      assert.equal(type, "ActiveEffect");
      for (const effectId of ids) actor.effects.delete(effectId);
      return ids;
    }
  };
  return actor;
}

function makeService({ documents, worldActors = [], sceneTokens = [], hookHandlers = null } = {}) {
  const gm = { id: "gm", isGM: true, active: true };
  globalThis.game = {
    user: gm,
    users: [gm],
    actors: worldActors,
    scenes: [{ id: "scene", tokens: sceneTokens }]
  };
  globalThis.foundry = {
    utils: {
      deepClone: value => structuredClone(value),
      getProperty,
      setProperty(object, path, value) {
        const parts = String(path).split(".");
        const leaf = parts.pop();
        let current = object;
        for (const part of parts) current = current[part] ??= {};
        current[leaf] = value;
        return true;
      },
      unsetProperty(object, path) {
        const parts = String(path).split(".");
        const leaf = parts.pop();
        const current = parts.reduce((value, part) => value?.[part], object);
        if (!current || !(leaf in current)) return false;
        delete current[leaf];
        return true;
      }
    }
  };
  globalThis.fromUuid = async uuid => documents.get(uuid) ?? null;
  globalThis.Hooks = {
    on(name, handler) {
      if (hookHandlers) hookHandlers.set(name, handler);
      return 1;
    }
  };

  const registered = new Map();
  const socket = {
    register(name, handler) { registered.set(name, handler); },
    async executeAsUser(name, _userId, payload) { return registered.get(name)(payload); }
  };
  const authority = { getPrimaryGm: () => gm };
  return new PersistentAreaLifecycleService({ socket, authority });
}

test("PersistentAreaLifecycleService is generic and contains no spell-specific Web rules", async () => {
  const source = await fs.readFile(new URL("../scripts/environment/persistent-area-lifecycle-service.js", import.meta.url), "utf8");
  for (const forbidden of ["Web Save", "Restrained by Web", "Escape Web", "Burning Web Damage", "WEB_ACTIVITY_REFERENCES", "WEB_FLAG_KEY"]) {
    assert.equal(source.includes(forbidden), false, `generic lifecycle source must not contain '${forbidden}'`);
  }
});



test("Persistent-area lifecycle is wired through the public API and ready initialization", async () => {
  const apiSource = await fs.readFile(new URL("../scripts/api.js", import.meta.url), "utf8");
  const mainSource = await fs.readFile(new URL("../scripts/action-effects-5e.js", import.meta.url), "utf8");
  assert.match(apiSource, /persistentAreas:\s*Object\.freeze/);
  assert.match(apiSource, /applyEffectTemplate:\s*\(options\)\s*=>\s*persistentAreaLifecycle\.applyEffectTemplate/);
  assert.match(apiSource, /removeOwnedEffects:\s*\(options\)\s*=>\s*persistentAreaLifecycle\.removeOwnedEffects/);
  assert.match(apiSource, /bindConcentrationDependent:\s*\(options\)\s*=>\s*persistentAreaLifecycle\.bindConcentrationDependent/);
  assert.match(mainSource, /new PersistentAreaLifecycleService/);
  assert.match(mainSource, /persistentAreaLifecycle\.initialize\(\)/);
});

test("PersistentAreaLifecycleService clones an exact editable template and stamps generic ownership/config", async () => {
  const documents = new Map();
  const actor = makeActor({ id: "synthetic", uuid: "Scene.scene.Token.token.Actor.synthetic" });
  const token = { id: "token", uuid: "Scene.scene.Token.token", actor };
  documents.set(token.uuid, token);

  const item = { id: "item", uuid: "Actor.caster.Item.hazard", documentName: "Item" };
  const template = {
    id: "template",
    uuid: `${item.uuid}.ActiveEffect.template`,
    documentName: "ActiveEffect",
    parent: item,
    transfer: false,
    toObject() {
      return {
        name: "Immobilized by Hazard",
        transfer: false,
        disabled: false,
        duration: { value: Infinity, units: "seconds" },
        flags: {}
      };
    }
  };
  documents.set(template.uuid, template);

  const service = makeService({ documents, sceneTokens: [token] });
  const result = await service.applyEffectTemplate({
    targetTokenUuid: token.uuid,
    templateEffectUuid: template.uuid,
    ownerUuid: "Scene.scene.Region.area-a",
    ownerInstanceId: "area-a-instance",
    effectKey: "immobilize",
    omitFields: ["duration"],
    metadata: { dc: 17 },
    ongoingAction: { enabled: true, templateUuid: "Compendium.test.Item.break-free" },
    voluntaryMovementRestriction: { enabled: true, message: "Movement unavailable.", priority: 40 }
  });

  assert.equal(result.created, true);
  const effect = [...actor.effects.values()][0];
  assert.equal(effect.duration, undefined);
  assert.equal(effect.origin, item.uuid);
  assert.deepEqual(getProperty(effect, `flags.${MODULE_ID}.${PERSISTENT_AREA_EFFECT_FLAG}`), {
    schemaVersion: 1,
    ownerUuid: "Scene.scene.Region.area-a",
    ownerInstanceId: "area-a-instance",
    effectKey: "immobilize",
    templateEffectUuid: template.uuid,
    sourceItemUuid: item.uuid,
    appliedAt: getProperty(effect, `flags.${MODULE_ID}.${PERSISTENT_AREA_EFFECT_FLAG}.appliedAt`),
    metadata: { dc: 17 }
  });
  assert.equal(getProperty(effect, `flags.${MODULE_ID}.${ONGOING_ACTION_EFFECT_FLAG}.templateUuid`), "Compendium.test.Item.break-free");
  assert.equal(getProperty(effect, `flags.${MODULE_ID}.movement.voluntaryRestriction.enabled`), true);

  const duplicate = await service.applyEffectTemplate({
    targetTokenUuid: token.uuid,
    templateEffectUuid: template.uuid,
    ownerUuid: "Scene.scene.Region.area-a",
    effectKey: "immobilize"
  });
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.reason, "already-applied");
  assert.equal(actor.effects.size, 1);

  const otherOwner = await service.applyEffectTemplate({
    targetTokenUuid: token.uuid,
    templateEffectUuid: template.uuid,
    ownerUuid: "Scene.scene.Region.area-b",
    effectKey: "immobilize"
  });
  assert.equal(otherOwner.created, true);
  assert.equal(actor.effects.size, 2, "overlapping persistent areas must remain independent by owner UUID");
});

test("PersistentAreaLifecycleService removes Region-owned effects from world and synthetic Token Actors without crossing owners", async () => {
  const documents = new Map();
  const world = makeActor({ id: "world", uuid: "Actor.world" });
  const synthetic = makeActor({ id: "synthetic", uuid: "Scene.scene.Token.synthetic.Actor.synthetic" });
  const token = { id: "synthetic-token", uuid: "Scene.scene.Token.synthetic", actor: synthetic };
  const service = makeService({ documents, worldActors: [world], sceneTokens: [token] });

  const addOwned = (actor, id, ownerUuid, effectKey = "default") => {
    const effect = {
      id,
      uuid: `${actor.uuid}.ActiveEffect.${id}`,
      parent: actor,
      flags: {
        [MODULE_ID]: {
          [PERSISTENT_AREA_EFFECT_FLAG]: { ownerUuid, effectKey }
        }
      }
    };
    actor.effects.set(id, effect);
  };

  addOwned(world, "world-a", "Scene.scene.Region.area-a");
  addOwned(synthetic, "synthetic-a", "Scene.scene.Region.area-a");
  addOwned(synthetic, "synthetic-b", "Scene.scene.Region.area-b");

  const result = await service.removeOwnedEffects({ ownerUuid: "Scene.scene.Region.area-a" });
  assert.equal(result.removedCount, 2);
  assert.equal(world.effects.has("world-a"), false);
  assert.equal(synthetic.effects.has("synthetic-a"), false);
  assert.equal(synthetic.effects.has("synthetic-b"), true, "another persistent area must remain intact");
});

test("PersistentAreaLifecycleService binds an arbitrary dependent document to concentration through Midi-QOL", async () => {
  const documents = new Map();
  const actor = { id: "caster", uuid: "Actor.caster", documentName: "Actor" };
  const item = { id: "source", uuid: "Actor.caster.Item.source", documentName: "Item" };
  const dependent = {
    id: "area",
    uuid: "Scene.scene.Region.area",
    documentName: "Region",
    flags: {},
    getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
  };
  documents.set(actor.uuid, actor);
  documents.set(item.uuid, item);
  documents.set(dependent.uuid, dependent);

  const service = makeService({ documents });
  globalThis.MidiQOL = {
    async addConcentrationDependent(receivedActor, receivedDependent, receivedItem) {
      assert.equal(receivedActor, actor);
      assert.equal(receivedDependent, dependent);
      assert.equal(receivedItem, item);
      dependent.flags.dnd5e = { dependentOn: "Actor.caster.ActiveEffect.concentration" };
      return { ok: true };
    }
  };

  const result = await service.bindConcentrationDependent({
    dependentUuid: dependent.uuid,
    casterActorUuid: actor.uuid,
    sourceItemUuid: item.uuid
  });
  assert.equal(result.bound, true);
  assert.equal(result.dependentOn, "Actor.caster.ActiveEffect.concentration");
  delete globalThis.MidiQOL;
});


test("PersistentAreaLifecycleService cleans synthetic Token Actor effects when their owning Region is deleted", async () => {
  const documents = new Map();
  const hookHandlers = new Map();
  const synthetic = makeActor({ id: "synthetic-hook", uuid: "Scene.scene.Token.hook.Actor.synthetic" });
  const token = { id: "hook-token", uuid: "Scene.scene.Token.hook", actor: synthetic };
  const effect = {
    id: "owned",
    uuid: `${synthetic.uuid}.ActiveEffect.owned`,
    parent: synthetic,
    flags: {
      [MODULE_ID]: {
        [PERSISTENT_AREA_EFFECT_FLAG]: { ownerUuid: "Scene.scene.Region.deleted", effectKey: "fixture" }
      }
    }
  };
  synthetic.effects.set(effect.id, effect);

  const service = makeService({ documents, sceneTokens: [token], hookHandlers });
  service.initialize();
  const onDeleteRegion = hookHandlers.get("deleteRegion");
  assert.equal(typeof onDeleteRegion, "function");
  onDeleteRegion({ uuid: "Scene.scene.Region.deleted", documentName: "Region" });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(synthetic.effects.has("owned"), false);
});

test("PersistentAreaLifecycleService can query exact owner/effect ownership on a synthetic Token Actor", async () => {
  const documents = new Map();
  const actor = makeActor({ id: "query", uuid: "Scene.scene.Token.query.Actor.synthetic" });
  const token = { id: "query-token", uuid: "Scene.scene.Token.query", actor };
  documents.set(token.uuid, token);
  actor.effects.set("owned", {
    id: "owned",
    uuid: `${actor.uuid}.ActiveEffect.owned`,
    parent: actor,
    flags: { [MODULE_ID]: { [PERSISTENT_AREA_EFFECT_FLAG]: { ownerUuid: "Scene.scene.Region.a", effectKey: "fixture" } } }
  });
  const service = makeService({ documents, sceneTokens: [token] });
  const yes = await service.hasOwnedEffect({ ownerUuid: "Scene.scene.Region.a", effectKey: "fixture", targetTokenUuid: token.uuid });
  const no = await service.hasOwnedEffect({ ownerUuid: "Scene.scene.Region.b", effectKey: "fixture", targetTokenUuid: token.uuid });
  assert.equal(yes.found, true);
  assert.equal(no.found, false);
});

test("RegionAuthorityService only configures Foundry core Modify Movement Cost and does not calculate terrain movement", async () => {
  const { RegionAuthorityService } = await import("../scripts/regions/region-authority-service.js");
  const previousConfig = globalThis.CONFIG;
  globalThis.CONFIG = {
    RegionBehavior: {
      dataModels: {
        modifyMovementCost: class {
          static defineSchema() {
            return { difficulties: { fields: { walk: {}, fly: {}, swim: {} } } };
          }
        }
      }
    },
    Token: { movement: { actions: { walk: {}, fly: {}, swim: {} }, defaultAction: "walk" } }
  };
  const service = new RegionAuthorityService({
    socket: { register() {}, ready: true },
    authority: { getPrimaryGm: () => ({ id: "gm" }), getStatus: () => ({}) }
  });
  try {
    const built = service.buildMovementCostBehavior({ multiplier: 2, name: "Fixture Terrain" });
    assert.equal(built.built, true);
    assert.equal(built.behavior.type, "modifyMovementCost");
    assert.deepEqual(built.behavior.system.difficulties, { walk: 2, fly: 2, swim: 2 });
  } finally {
    globalThis.CONFIG = previousConfig;
  }
});
