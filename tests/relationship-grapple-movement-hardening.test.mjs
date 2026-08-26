import test from "node:test";
import assert from "node:assert/strict";

const hookHandlers = new Map();
let hookId = 0;

globalThis.Hooks = {
  on(name, handler) {
    const id = ++hookId;
    if (!hookHandlers.has(name)) hookHandlers.set(name, new Map());
    hookHandlers.get(name).set(id, handler);
    return id;
  },
  off(name, id) {
    hookHandlers.get(name)?.delete(id);
  },
  callAll() {}
};

globalThis.game = {
  user: { id: "player", isGM: false },
  settings: { get: () => false }
};

globalThis.ui = {
  notifications: {
    warn() {},
    error() {}
  }
};

class FakeTokenDocument {
  constructor({ id, scene }) {
    this.id = id;
    this.parent = scene;
    this.uuid = `Scene.${scene.id}.Token.${id}`;
    this.x = 0;
    this.y = 0;
    this.elevation = 0;
  }
}

globalThis.foundry = {
  documents: { TokenDocument: FakeTokenDocument },
  utils: {
    deepClone: (value) => structuredClone(value),
    randomID: (() => {
      let counter = 0;
      return (length = 16) => String(++counter).padStart(length, "0");
    })()
  }
};

globalThis.libWrapper = null;

const { MOVEMENT_AGENCIES, MOVEMENT_PHASES, MOVEMENT_RESOURCES, PATH_TYPES } = await import("../scripts/core/constants.js");
const { RelationshipMovementService } = await import("../scripts/relationships/relationship-movement-service.js");

class DeferredSocket {
  handlers = new Map();
  moveCalls = [];
  pending = [];

  register(name, handler) {
    this.handlers.set(name, handler);
  }

  executeAsGM(name, payload) {
    if (name !== "relationships.moveGroup") {
      return Promise.resolve(this.handlers.get(name)?.(payload));
    }
    this.moveCalls.push(structuredClone(payload));
    return new Promise((resolve, reject) => this.pending.push({ resolve, reject }));
  }

  resolveNext(result = { completed: true, results: {} }) {
    const deferred = this.pending.shift();
    deferred?.resolve(result);
  }
}

class FakeMovement {
  consumers = new Map();

  registerConsumer(config) {
    this.consumers.set(config.id, config);
    return () => this.consumers.delete(config.id);
  }

  handlerFor(uuid) {
    return [...this.consumers.values()].find((config) =>
      config.tokenUuids?.includes(uuid) && !config.id.includes(".receipt.")
    )?.handler ?? null;
  }

  createOperationOptions(metadata) {
    return { ae5eMovement: metadata };
  }
}

function makeRelationship({ leader, follower, type = "grapple", attachmentMode = "grappleFollower" }) {
  return {
    id: "relationship-1",
    leaderUuid: leader.uuid,
    followerUuid: follower.uuid,
    type,
    attachmentMode,
    followerCanSelfMove: false,
    followRotation: false,
    teleportPolicy: "detach",
    collisionPolicy: "stopGroup",
    coordinationPolicy: "coordinated",
    forcedLeaderMovementPolicy: "independent",
    movementCostPolicy: type === "grapple" ? "grapple" : "none"
  };
}

function transaction({ leader, movementId, destination = { x: 100, y: 0, elevation: 0 } }) {
  return {
    phase: MOVEMENT_PHASES.BEFORE,
    subjectUuid: leader.uuid,
    movementId,
    origin: { x: leader.x, y: leader.y, elevation: leader.elevation },
    destination,
    pathType: PATH_TYPES.TRAVERSE,
    agency: MOVEMENT_AGENCIES.VOLUNTARY,
    resource: MOVEMENT_RESOURCES.MOVEMENT,
    movementMode: "walk",
    sourceUuid: null,
    method: "keyboard",
    metadata: {}
  };
}

function movementContext({ leader, movementId, destination = { x: 100, y: 0, elevation: 0 } }) {
  return {
    document: leader,
    movement: {
      id: movementId,
      origin: { x: leader.x, y: leader.y, elevation: leader.elevation },
      destination,
      passed: { waypoints: [destination] },
      pending: { waypoints: [] },
      method: "keyboard",
      autoRotate: false,
      split: false,
      constrainOptions: {}
    }
  };
}

function fixture({ type = "grapple", attachmentMode = "grappleFollower" } = {}) {
  const scene = { id: "scene" };
  const leader = new FakeTokenDocument({ id: "leader", scene });
  const follower = new FakeTokenDocument({ id: "follower", scene });
  const relationship = makeRelationship({ leader, follower, type, attachmentMode });
  const relationships = {
    list: () => [relationship],
    getForLeader: (uuid) => uuid === leader.uuid ? [relationship] : [],
    getForFollower: (uuid) => uuid === follower.uuid ? [relationship] : [],
    removeManyAsGM: async () => 0
  };
  const socket = new DeferredSocket();
  const movement = new FakeMovement();
  const service = new RelationshipMovementService({ socket, relationships, movement });
  service.initialize();
  return { leader, follower, relationship, socket, movement, service };
}

async function waitForTimer() {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

test("rapid Grapple leader inputs are discarded while one coordinated movement request is in flight", async () => {
  const f = fixture();
  const handler = f.movement.handlerFor(f.leader.uuid);
  assert.equal(typeof handler, "function");

  assert.equal(
    handler(transaction({ leader: f.leader, movementId: "move-1" }), movementContext({ leader: f.leader, movementId: "move-1" })),
    false
  );
  assert.equal(f.service.getStats().activeLocalGrappleLeaders, 1, "Leader lock must engage before the deferred socket call starts.");

  assert.equal(
    handler(transaction({ leader: f.leader, movementId: "move-2" }), movementContext({ leader: f.leader, movementId: "move-2" })),
    false
  );

  await waitForTimer();
  assert.equal(f.socket.moveCalls.length, 1, "Second rapid input must not create another GM moveGroup request.");
  assert.equal(f.service.getStats().activeLocalGrappleLeaders, 1);

  f.socket.resolveNext();
  await waitForTimer();
  assert.equal(f.service.getStats().activeLocalGrappleLeaders, 0, "Leader must unlock after the full socket request returns.");

  assert.equal(
    handler(transaction({ leader: f.leader, movementId: "move-3" }), movementContext({ leader: f.leader, movementId: "move-3" })),
    false
  );
  await waitForTimer();
  assert.equal(f.socket.moveCalls.length, 2, "A new movement after completion must be accepted normally.");
  f.socket.resolveNext();
  await waitForTimer();

  f.service.shutdown();
});

test("non-grapple relationship movement does not engage the Grapple-only local leader lock", async () => {
  const f = fixture({ type: "test", attachmentMode: "adjacentFollower" });
  const handler = f.movement.handlerFor(f.leader.uuid);

  assert.equal(
    handler(transaction({ leader: f.leader, movementId: "move-non-grapple" }), movementContext({ leader: f.leader, movementId: "move-non-grapple" })),
    false
  );
  assert.equal(f.service.getStats().activeLocalGrappleLeaders, 0);

  await waitForTimer();
  assert.equal(f.socket.moveCalls.length, 1);
  f.socket.resolveNext();
  await waitForTimer();
  f.service.shutdown();
});
