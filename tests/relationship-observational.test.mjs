import test from "node:test";
import assert from "node:assert/strict";

import {
  RELATIONSHIP_CLASSES,
  RELATIONSHIP_CONSTRAINT_STATES,
  RELATIONSHIP_CONSTRAINT_TYPES
} from "../scripts/core/constants.js";
import { relationshipClassOf } from "../scripts/relationships/relationship-class.js";
import { RelationshipDistanceProviderService } from "../scripts/relationships/relationship-distance-provider-service.js";
import { RelationshipConstraintService } from "../scripts/relationships/relationship-constraint-service.js";

const hookHandlers = new Map();
let hookId = 0;
globalThis.Hooks = {
  on(name, handler) {
    const id = ++hookId;
    if (!hookHandlers.has(name)) hookHandlers.set(name, new Map());
    hookHandlers.get(name).set(id, handler);
    return id;
  },
  off(name, id) { hookHandlers.get(name)?.delete(id); },
  callAll(name, ...args) {
    for (const handler of hookHandlers.get(name)?.values() ?? []) handler(...args);
  }
};

class FakeCollection extends Map {
  [Symbol.iterator]() { return this.values(); }
  find(predicate) { return [...this.values()].find(predicate); }
}

class FakeScene {
  constructor(id) {
    this.id = id;
    this.flags = {};
    this.grid = { size: 100, distance: 5 };
  }
  getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
  async setFlag(scope, key, value) {
    this.flags[scope] ??= {};
    this.flags[scope][key] = structuredClone(value);
    Hooks.callAll("updateScene", this, { flags: { [scope]: { [key]: structuredClone(value) } } });
  }
}

class FakeTokenDocument {
  documentName = "Token";
  width = 1;
  height = 1;
  elevation = 0;
  constructor(id, scene, x = 0, y = 0) {
    this.id = id;
    this.parent = scene;
    this.uuid = `Scene.${scene.id}.Token.${id}`;
    this.x = x;
    this.y = y;
  }
  testUserPermission() { return true; }
}

class FakeSocket {
  handlers = new Map();
  register(name, handler) { this.handlers.set(name, handler); }
  executeAsGM(name, payload) { return this.handlers.get(name)(payload); }
}

const documents = new Map();
const gm = { id: "gm", isGM: true, active: true };
const users = new FakeCollection([[gm.id, gm]]);
users.activeGM = gm;
globalThis.game = {
  user: gm,
  users,
  scenes: new FakeCollection(),
  settings: { get: () => false }
};
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 } };
globalThis.foundry = {
  documents: { TokenDocument: FakeTokenDocument },
  utils: {
    deepClone: value => structuredClone(value),
    randomID: (() => { let id = 0; return (length = 16) => String(++id).padStart(length, "0"); })(),
    hasProperty: (object, path) => path.split(".").reduce((value, key) => value?.[key], object) !== undefined
  }
};
globalThis.fromUuid = async uuid => documents.get(uuid) ?? null;

const { RelationshipService } = await import("../scripts/relationships/relationship-service.js");

function fixture(name) {
  const scene = new FakeScene(name);
  game.scenes.set(scene.id, scene);
  const tokens = ["leader-a", "leader-b", "leader-c", "target"].map((id, index) => new FakeTokenDocument(id, scene, index * 100, 0));
  for (const token of tokens) documents.set(token.uuid, token);
  return { scene, leaderA: tokens[0], leaderB: tokens[1], leaderC: tokens[2], target: tokens[3] };
}

test("legacy relationship records default to the physical class", async () => {
  assert.equal(relationshipClassOf({ type: "grapple" }), RELATIONSHIP_CLASSES.PHYSICAL);
  const f = fixture("legacy-default");
  f.scene.flags["action-effects-5e"] = {
    relationships: [{
      id: "legacy-grapple",
      sceneId: f.scene.id,
      leaderUuid: f.leaderA.uuid,
      followerUuid: f.target.uuid,
      type: "grapple",
      attachmentMode: "grappleFollower"
    }]
  };
  const service = new RelationshipService({ socket: new FakeSocket() });
  await service.initialize();
  assert.equal(service.get("legacy-grapple").relationshipClass, RELATIONSHIP_CLASSES.PHYSICAL);
  assert.equal(service.getPhysicalForFollower(f.target.uuid).length, 1);
  assert.equal(f.scene.getFlag("action-effects-5e", "relationships")[0].relationshipClass, undefined, "reading a legacy record must not rewrite it");
  service.shutdown();
});

test("observational relationships coexist with physical control and remain nonexclusive", async () => {
  const f = fixture("coexistence");
  const service = new RelationshipService({ socket: new FakeSocket() });
  await service.initialize();
  const physical = await service.create({
    leaderUuid: f.leaderA.uuid,
    followerUuid: f.target.uuid,
    type: "grapple",
    attachmentMode: "grappleFollower"
  });
  const observedOne = await service.create({
    leaderUuid: f.leaderB.uuid,
    followerUuid: f.target.uuid,
    type: "tether",
    relationshipClass: RELATIONSHIP_CLASSES.OBSERVATIONAL,
    constraints: [{ type: RELATIONSHIP_CONSTRAINT_TYPES.MAXIMUM_DISTANCE, maximum: 60 }]
  });
  const observedTwo = await service.create({
    leaderUuid: f.leaderC.uuid,
    followerUuid: f.target.uuid,
    type: "attachedEffect",
    relationshipClass: RELATIONSHIP_CLASSES.OBSERVATIONAL,
    constraints: [{ type: RELATIONSHIP_CONSTRAINT_TYPES.COVER }]
  });

  assert.equal(physical.relationshipClass, RELATIONSHIP_CLASSES.PHYSICAL);
  assert.equal(observedOne.relationshipClass, RELATIONSHIP_CLASSES.OBSERVATIONAL);
  assert.equal(observedOne.constraints[0].provider, "center3d");
  assert.equal(observedTwo.constraints[0].provider, "midi");
  assert.equal(service.getForFollower(f.target.uuid).length, 3);
  assert.equal(service.getPhysicalForFollower(f.target.uuid).length, 1);
  assert.equal(service.list({ relationshipClass: RELATIONSHIP_CLASSES.OBSERVATIONAL }).length, 2);

  await assert.rejects(
    service.create({
      leaderUuid: f.leaderB.uuid,
      followerUuid: f.target.uuid,
      type: "mount",
      relationshipClass: RELATIONSHIP_CLASSES.PHYSICAL
    }),
    /already controlled by relationship/i,
    "observational coexistence must not weaken physical follower exclusivity"
  );
  await assert.rejects(
    service.create({
      leaderUuid: f.leaderB.uuid,
      followerUuid: f.leaderC.uuid,
      type: "tether",
      constraints: [{ type: RELATIONSHIP_CONSTRAINT_TYPES.MAXIMUM_DISTANCE, maximum: 30 }]
    }),
    /constraints require relationshipClass 'observational'/i
  );
  await assert.rejects(
    service.create({
      leaderUuid: f.leaderB.uuid,
      followerUuid: f.leaderC.uuid,
      type: "tether",
      relationshipClass: "observer"
    }),
    /relationship class .* not supported/i
  );
  service.shutdown();
});

test("center-to-center distance honors the Scene grid's diagonal rule before adding elevation", async () => {
  const providers = new RelationshipDistanceProviderService();
  const scene = {
    grid: {
      size: 100,
      distance: 5,
      measurePath: () => ({ distance: 5 })
    }
  };
  const leader = { x: 0, y: 0, elevation: 0, width: 1, height: 1 };
  const follower = { x: 100, y: 100, elevation: 12, width: 1, height: 1 };
  const result = await providers.measure({ scene, leader, follower, provider: "center3d" });
  assert.equal(result.distance, 13, "5-foot planar distance and 12-foot elevation form a 13-foot 3D distance");
});

test("full-route distance evaluation catches an intermediate violation and removes only the observational relationship", async () => {
  const f = fixture("full-route");
  f.leaderA.x = 0;
  f.target.x = 0;
  const relationship = {
    id: "observed-route",
    sceneId: f.scene.id,
    leaderUuid: f.leaderA.uuid,
    followerUuid: f.target.uuid,
    relationshipClass: RELATIONSHIP_CLASSES.OBSERVATIONAL,
    constraints: [{
      id: "range",
      type: RELATIONSHIP_CONSTRAINT_TYPES.MAXIMUM_DISTANCE,
      maximum: 6,
      provider: "center3d",
      evaluateRoute: true
    }]
  };
  const removed = [];
  const relationships = {
    get: id => id === relationship.id ? structuredClone(relationship) : null,
    getForLeader: uuid => uuid === relationship.leaderUuid ? [structuredClone(relationship)] : [],
    getForFollower: uuid => uuid === relationship.followerUuid ? [structuredClone(relationship)] : [],
    list: () => [structuredClone(relationship)],
    async removeManyAsGM(ids) { removed.push(...ids); return ids.length; }
  };
  const movement = { registerConsumer: () => () => {} };
  const distanceProviders = new RelationshipDistanceProviderService();
  const coverProviders = { evaluate: async () => ({ state: RELATIONSHIP_CONSTRAINT_STATES.CLEAR }) };
  const service = new RelationshipConstraintService({ relationships, movement, distanceProviders, coverProviders });

  const results = await service.evaluateForToken(f.target.uuid, {
    route: [
      { x: 0, y: 0, elevation: 0 },
      { x: 200, y: 0, elevation: 0 },
      { x: 0, y: 0, elevation: 0 }
    ],
    removeBroken: true
  });
  assert.equal(results[0].state, RELATIONSHIP_CONSTRAINT_STATES.BROKEN);
  assert.ok(results[0].sampleCount > 3, "long route legs should be sampled between supplied waypoints");
  assert.deepEqual(removed, [relationship.id]);
});
