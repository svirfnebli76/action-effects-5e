import test from "node:test";
import assert from "node:assert/strict";

let idCounter = 0;
class FakeTokenDocument {
  constructor({ uuid, id, scene, owner = true }) {
    this.uuid = uuid;
    this.id = id;
    this.parent = scene;
    this.owner = owner;
  }

  testUserPermission() {
    return this.owner;
  }
}

const hookEvents = new Map();
let hookCounter = 0;
globalThis.Hooks = {
  on(name, handler) {
    const id = ++hookCounter;
    if (!hookEvents.has(name)) hookEvents.set(name, new Map());
    hookEvents.get(name).set(id, handler);
    return id;
  },
  once(name, handler) {
    const id = this.on(name, (...args) => {
      this.off(name, id);
      return handler(...args);
    });
    return id;
  },
  off(name, id) {
    hookEvents.get(name)?.delete(id);
  },
  callAll(name, ...args) {
    for (const handler of hookEvents.get(name)?.values() ?? []) handler(...args);
  },
  call(name, ...args) {
    for (const handler of hookEvents.get(name)?.values() ?? []) {
      if (handler(...args) === false) return false;
    }
    return true;
  }
};

globalThis.foundry = {
  documents: { TokenDocument: FakeTokenDocument },
  utils: {
    deepClone: (value) => structuredClone(value),
    randomID: (length = 16) => String(++idCounter).padStart(length, "0"),
    hasProperty: (object, path) => path.split(".").reduce((value, key) => value?.[key], object) !== undefined
  }
};

class FakeCollection extends Map {
  [Symbol.iterator]() {
    return this.values();
  }

  find(predicate) {
    return [...this.values()].find(predicate);
  }
}

const users = new FakeCollection();
const gmUser = { id: "user-1", isGM: true, active: true };
users.set(gmUser.id, gmUser);
users.activeGM = gmUser;

globalThis.game = {
  user: gmUser,
  users,
  scenes: new FakeCollection()
};

globalThis.CONST = {
  DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 }
};

const {
  MOVEMENT_AGENCIES,
  MOVEMENT_PHASES,
  MOVEMENT_RESOURCES,
  OPERATION_METADATA_KEY,
  PATH_TYPES
} = await import("../scripts/core/constants.js");
const { MovementTransaction } = await import("../scripts/movement/movement-transaction.js");
const { MovementRegistry } = await import("../scripts/movement/movement-registry.js");

test("movement transaction preserves Action Effects 5E semantic metadata", () => {
  const document = {
    uuid: "Scene.scene.Token.token",
    id: "token",
    x: 0,
    y: 0,
    elevation: 0,
    parent: { id: "scene" },
    actor: { uuid: "Actor.actor" }
  };
  const movement = {
    id: "movement-1",
    origin: { x: 0, y: 0, elevation: 0 },
    destination: { x: 100, y: 0, elevation: 0, action: "walk" },
    method: "route",
    constrained: true
  };
  const operation = {
    [OPERATION_METADATA_KEY]: {
      pathType: PATH_TYPES.TRAVERSE,
      agency: MOVEMENT_AGENCIES.FORCED,
      resource: MOVEMENT_RESOURCES.NONE,
      sourceUuid: "Item.thunderwave"
    }
  };

  const transaction = MovementTransaction.fromTokenHook({
    document,
    movement,
    operation,
    phase: MOVEMENT_PHASES.AFTER,
    user: { id: "user-2" }
  });

  assert.equal(transaction.subjectUuid, document.uuid);
  assert.equal(transaction.agency, MOVEMENT_AGENCIES.FORCED);
  assert.equal(transaction.resource, MOVEMENT_RESOURCES.NONE);
  assert.equal(transaction.sourceUuid, "Item.thunderwave");
  assert.equal(transaction.path.length, 2);
  assert.ok(Object.isFrozen(transaction));
});

test("movement registry uses token indexes and removes once-only consumers", async () => {
  const registry = new MovementRegistry();
  let calls = 0;

  registry.register({
    id: "test-consumer",
    tokenUuids: ["Scene.scene.Token.token"],
    phases: [MOVEMENT_PHASES.AFTER],
    once: true,
    handler: () => { calls += 1; }
  });

  const document = { uuid: "Scene.scene.Token.token", parent: { id: "scene" } };
  assert.equal(registry.hasPotentialInterest(document, MOVEMENT_PHASES.AFTER, { userId: "user-1" }), true);
  assert.equal(registry.hasPotentialInterest(document, MOVEMENT_PHASES.AFTER, { userId: "other-user" }), false);
  assert.equal(registry.hasPotentialInterest({ uuid: "other", parent: { id: "scene" } }, MOVEMENT_PHASES.AFTER), false);

  const transaction = MovementTransaction.synthetic({
    subjectUuid: document.uuid,
    sceneId: "scene",
    phase: MOVEMENT_PHASES.AFTER
  });
  await registry.dispatch(transaction, MOVEMENT_PHASES.AFTER);

  assert.equal(calls, 1);
  assert.equal(registry.getStats().consumers, 0);
});


test("relationship service persists and reindexes leader/follower relationships", async () => {
  class FakeScene {
    constructor(id) {
      this.id = id;
      this.uuid = `Scene.${id}`;
      this.flags = {};
    }

    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    }

    async setFlag(scope, key, value) {
      this.flags[scope] ??= {};
      this.flags[scope][key] = structuredClone(value);
      Hooks.callAll("updateScene", this, { flags: { [scope]: { [key]: structuredClone(value) } } });
      return this;
    }
  }

  class FakeSocket {
    ready = true;
    handlers = new Map();

    register(name, handler) {
      this.handlers.set(name, handler);
    }

    async executeAsGM(name, payload) {
      return this.handlers.get(name)(payload);
    }
  }

  const scene = new FakeScene("scene-1");
  game.scenes.set(scene.id, scene);
  const leader = new FakeTokenDocument({
    uuid: "Scene.scene-1.Token.leader",
    id: "leader",
    scene
  });
  const follower = new FakeTokenDocument({
    uuid: "Scene.scene-1.Token.follower",
    id: "follower",
    scene
  });
  const documents = new Map([
    [leader.uuid, leader],
    [follower.uuid, follower]
  ]);
  globalThis.fromUuid = async (uuid) => documents.get(uuid) ?? null;

  const { RelationshipService } = await import("../scripts/relationships/relationship-service.js");
  const socket = new FakeSocket();
  const service = new RelationshipService({ socket });
  await service.initialize();

  const relationship = await service.create({
    leaderUuid: leader.uuid,
    followerUuid: follower.uuid,
    type: "test",
    attachmentMode: "adjacentFollower"
  });

  assert.equal(service.involves(leader.uuid), true);
  assert.equal(service.getForLeader(leader.uuid).length, 1);
  assert.equal(service.getForFollower(follower.uuid)[0].id, relationship.id);
  assert.equal(scene.getFlag("action-effects-5e", "relationships").length, 1);

  const removed = await service.remove(relationship.id);
  assert.equal(removed, true);
  assert.equal(service.list().length, 0);
  assert.equal(scene.getFlag("action-effects-5e", "relationships").length, 0);

  service.shutdown();
  game.scenes.delete(scene.id);
});
