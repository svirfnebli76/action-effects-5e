import assert from "node:assert/strict";
import test from "node:test";

globalThis.game = {
  user: { id: "gm", isGM: true },
  combats: []
};
globalThis.Hooks = { callAll() {} };

const { InitiativeCoordinator } = await import("../scripts/initiative/coordinator.js");
const { InitiativeOrderingService } = await import("../scripts/initiative/ordering-service.js");

const MODULE_ID = "action-effects-5e";
const sourceItemUuid = "Actor.caster.Item.summon";
const declaration = {
  id: "summon-fey",
  type: "summon",
  initiative: { mode: "after-summoner" }
};

test("the authority creates one exact-tie combatant per summon in placement order", async () => {
  const handlers = new Map();
  const socket = {
    register: (name, handler) => handlers.set(name, handler),
    executeAsUser: (name, userId, payload) => handlers.get(name)(payload)
  };
  const authority = {
    getPrimaryGm: () => ({ id: "gm" }),
    isPrimary: () => true,
    onChange: () => () => {}
  };
  const declarations = {
    read: () => ({ valid: true, enabled: true, declaration })
  };
  const scene = {
    id: "scene",
    tokens: new Map(),
    async updateEmbeddedDocuments(documentName, updates) {
      assert.equal(documentName, "Token");
      for (const update of updates) {
        const token = this.tokens.get(update._id);
        token.flags[MODULE_ID].summonContext = update[`flags.${MODULE_ID}.summonContext`];
      }
    }
  };
  const casterActor = { uuid: "Actor.caster" };
  const casterToken = {
    id: "caster-token",
    uuid: "Scene.scene.Token.caster-token",
    documentName: "Token",
    parent: scene,
    actor: casterActor
  };
  const native = profile => ({
    level: 5,
    origin: sourceItemUuid,
    activity: "summon",
    profile
  });
  const context = (order, profile) => ({
    version: 1,
    summonerActorUuid: casterActor.uuid,
    summonerTokenUuid: casterToken.uuid,
    sourceItemUuid,
    sourceActivityUuid: `${sourceItemUuid}.Activity.summon`,
    declarationId: declaration.id,
    castLevel: 5,
    baseLevel: 3,
    batchId: "batch",
    placementOrder: order,
    initiativeMode: "after-summoner",
    profileId: profile
  });
  const summonToken = (id, order, profile) => ({
    id,
    uuid: `Scene.scene.Token.${id}`,
    documentName: "Token",
    parent: scene,
    actorId: `actor-${id}`,
    actor: {
      id: `actor-${id}`,
      getFlag: (scope, key) => scope === "dnd5e" && key === "summon" ? native(profile) : null
    },
    flags: { [MODULE_ID]: { summonContext: context(order, profile) } },
    hidden: false
  });
  const first = summonToken("first", 0, "fuming");
  const second = summonToken("second", 1, "mirthful");
  scene.tokens.set(casterToken.id, casterToken);
  scene.tokens.set(first.id, first);
  scene.tokens.set(second.id, second);

  const casterCombatant = {
    id: "caster-combatant",
    tokenId: casterToken.id,
    token: casterToken,
    initiative: 17,
    flags: {},
    group: null
  };
  const combatants = new Map([[casterCombatant.id, casterCombatant]]);
  let nextId = 0;
  const combat = {
    id: "combat",
    uuid: "Combat.combat",
    documentName: "Combat",
    scene,
    combatants,
    async createEmbeddedDocuments(documentName, data) {
      assert.equal(documentName, "Combatant");
      return data.map(source => {
        const created = {
          ...source,
          id: `created-${++nextId}`,
          token: scene.tokens.get(source.tokenId),
          combat: this
        };
        combatants.set(created.id, created);
        return created;
      });
    },
    async updateEmbeddedDocuments(documentName, updates) {
      assert.equal(documentName, "Combatant");
      for (const update of updates) Object.assign(combatants.get(update._id), update);
      return updates.map(update => combatants.get(update._id));
    }
  };
  casterCombatant.combat = combat;
  globalThis.game.combats = [combat];

  const sourceItem = { documentName: "Item", uuid: sourceItemUuid };
  const documents = new Map([
    [sourceItemUuid, sourceItem],
    [casterToken.uuid, casterToken],
    [first.uuid, first],
    [second.uuid, second]
  ]);
  globalThis.fromUuid = uuid => documents.get(uuid) ?? null;

  const ordering = new InitiativeOrderingService();
  const coordinator = new InitiativeCoordinator({ socket, authority, ordering, declarations });
  const result = await coordinator.attachSummons([
    { tokenUuid: second.uuid, context: second.flags[MODULE_ID].summonContext },
    { tokenUuid: first.uuid, context: first.flags[MODULE_ID].summonContext }
  ]);

  assert.equal(result.created, 2);
  const turns = [...combatants.values()].sort((left, right) =>
    ordering.compare(combat, left, right, (a, b) =>
      Number(b.initiative ?? -Infinity) - Number(a.initiative ?? -Infinity)
      || String(a.id).localeCompare(String(b.id))));
  assert.deepEqual(turns.map(turn => turn.tokenId), ["caster-token", "first", "second"]);
  assert.deepEqual(turns.map(turn => turn.initiative), [17, 17, 17]);
  assert.deepEqual(turns.slice(1).map(turn => turn.flags[MODULE_ID].initiativeLink.order), [0, 1]);
});
