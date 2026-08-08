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

function assertGeneratedMovementInstructions(instructions) {
  for (const [tokenId, instruction] of Object.entries(instructions)) {
    assert.match(instruction.id, /^[A-Za-z0-9]{16}$/, `${tokenId} must have a Foundry-valid movement ID.`);
    const terminal = Array.isArray(instruction.waypoints) && instruction.waypoints.length
      ? instruction.waypoints.at(-1)
      : instruction.destination;
    assert.ok(terminal, `${tokenId} must have a terminal movement waypoint or destination.`);
    assert.equal(terminal.checkpoint, true, `${tokenId} terminal movement must explicitly be a checkpoint.`);
  }
}

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


test("movement service restores transient metadata from an explicit movement ID", async () => {
  const previousSettings = game.settings;
  game.settings = {
    get(_module, key) {
      if (key === "movementEnabled") return true;
      if (key === "captureMovementDiagnostics") return false;
      return undefined;
    }
  };

  const relationships = { involves: () => true };
  const registry = new MovementRegistry();
  const { MovementService } = await import("../scripts/movement/movement-service.js");
  const service = new MovementService({ registry, relationships });
  service.initialize();

  let seen = null;
  const removeConsumer = service.registerConsumer({
    id: "test-movement-context",
    tokenUuids: ["Scene.scene.Token.follower"],
    phases: [MOVEMENT_PHASES.BEFORE],
    handler: (transaction) => {
      seen = transaction;
    }
  });

  const releaseContext = service.registerMovementContext("AbCdEfGh12345678", {
    relationshipMovement: true,
    leaderUuid: "Scene.scene.Token.leader",
    agency: MOVEMENT_AGENCIES.VOLUNTARY,
    resource: MOVEMENT_RESOURCES.MOVEMENT,
    generatedBy: "action-effects-5e"
  });

  const document = {
    uuid: "Scene.scene.Token.follower",
    id: "follower",
    x: 100,
    y: 0,
    elevation: 0,
    parent: { id: "scene" },
    actor: null
  };
  const movement = {
    id: "AbCdEfGh12345678",
    origin: { x: 100, y: 0, elevation: 0 },
    destination: { x: 200, y: 0, elevation: 0 },
    pending: { waypoints: [{ x: 200, y: 0, elevation: 0 }] },
    passed: { waypoints: [] },
    method: "keyboard"
  };

  // Deliberately omit Action Effects metadata from the hook operation. This
  // reproduces the live v0.2.0 Scene.moveTokens behavior that caused recursion.
  assert.equal(Hooks.call("preMoveToken", document, movement, {}), true);
  assert.ok(seen);
  assert.equal(seen.metadata.relationshipMovement, true);
  assert.equal(seen.generatedBy, "action-effects-5e");
  assert.equal(seen.agency, MOVEMENT_AGENCIES.PASSENGER);
  assert.equal(seen.resource, MOVEMENT_RESOURCES.NONE);
  assert.equal(service.getStats().movementContexts, 1);

  releaseContext();
  assert.equal(service.getStats().movementContexts, 0);
  removeConsumer();
  service.shutdown();
  game.settings = previousSettings;
});


test("movement service restores AE5E context from a stable Foundry subpath after movement ID changes", async () => {
  const previousSettings = game.settings;
  game.settings = {
    get(_module, key) {
      if (key === "movementEnabled") return true;
      if (key === "captureMovementDiagnostics") return false;
      return undefined;
    }
  };

  const relationships = { involves: () => true };
  const registry = new MovementRegistry();
  const { MovementService } = await import("../scripts/movement/movement-service.js");
  const service = new MovementService({ registry, relationships });
  service.initialize();

  let seen = null;
  const removeConsumer = service.registerConsumer({
    id: "test-subpath-context",
    tokenUuids: ["Scene.scene.Token.leader"],
    phases: [MOVEMENT_PHASES.BEFORE],
    handler: (transaction) => {
      seen = transaction;
    }
  });

  const stableSubpathId = "AbCdEfGh12345678";
  const continuedMovementId = "QsebH0X5zxLnfjj0";
  const releaseContext = service.registerMovementContext(stableSubpathId, {
    relationshipMovement: true,
    leaderUuid: "Scene.scene.Token.leader",
    agency: MOVEMENT_AGENCIES.VOLUNTARY,
    resource: MOVEMENT_RESOURCES.MOVEMENT,
    generatedBy: "action-effects-5e"
  });

  const document = {
    uuid: "Scene.scene.Token.leader",
    id: "leader",
    x: 3300,
    y: 1600,
    elevation: 0,
    parent: { id: "scene" },
    actor: null
  };
  const movement = {
    id: continuedMovementId,
    origin: { x: 3300, y: 1600, elevation: 0 },
    destination: { x: 3300, y: 1800, elevation: 0 },
    passed: {
      waypoints: [
        { x: 3300, y: 1700, elevation: 0, subpathId: stableSubpathId, checkpoint: false },
        { x: 3300, y: 1800, elevation: 0, subpathId: stableSubpathId, checkpoint: true }
      ]
    },
    pending: { waypoints: [] },
    history: {
      unrecorded: {
        waypoints: [
          { x: 3100, y: 1600, elevation: 0, movementId: stableSubpathId, subpathId: stableSubpathId }
        ]
      }
    },
    method: "dragging"
  };

  assert.equal(Hooks.call("preMoveToken", document, movement, {}), true);
  assert.ok(seen);
  assert.equal(seen.movementId, continuedMovementId);
  assert.equal(seen.subpathId, stableSubpathId);
  assert.equal(seen.metadata.relationshipMovement, true);
  assert.equal(seen.generatedBy, "action-effects-5e");
  assert.equal(seen.agency, MOVEMENT_AGENCIES.VOLUNTARY);

  releaseContext();
  removeConsumer();
  service.shutdown();
  game.settings = previousSettings;
});

test("relationship movement ignores an AE5E-owned checkpoint continuation instead of starting another group request", async () => {
  const previousSettings = game.settings;
  const previousUi = globalThis.ui;
  game.settings = {
    get(_module, key) {
      if (key === "movementEnabled") return true;
      if (key === "captureMovementDiagnostics") return false;
      return undefined;
    }
  };
  globalThis.ui = { notifications: { warn() {}, error() {} } };

  const leaderUuid = "Scene.scene.Token.leader";
  const followerUuid = "Scene.scene.Token.follower";
  const relationship = {
    id: "relationship-subpath",
    leaderUuid,
    followerUuid,
    followerCanSelfMove: false
  };
  const relationships = {
    involves: (uuid) => uuid === leaderUuid || uuid === followerUuid,
    list: () => [relationship],
    getForLeader: (uuid) => uuid === leaderUuid ? [relationship] : [],
    getForFollower: (uuid) => uuid === followerUuid ? [relationship] : []
  };

  let socketExecutions = 0;
  const socketHandlers = new Map();
  const socket = {
    register(name, handler) { socketHandlers.set(name, handler); },
    async executeAsGM() { socketExecutions += 1; return { completed: true }; }
  };

  const registry = new MovementRegistry();
  const { MovementService } = await import("../scripts/movement/movement-service.js");
  const { RelationshipMovementService } = await import("../scripts/relationships/relationship-movement-service.js");
  const movementService = new MovementService({ registry, relationships });
  const relationshipMovement = new RelationshipMovementService({
    socket,
    relationships,
    movement: movementService
  });
  movementService.initialize();
  relationshipMovement.initialize();

  const stableSubpathId = "AbCdEfGh12345678";
  const releaseContext = movementService.registerMovementContext(stableSubpathId, {
    transactionId: "action-effects-5e-group",
    relationshipMovement: true,
    internal: true,
    generatedBy: "action-effects-5e",
    leaderUuid,
    initiatorUuid: leaderUuid,
    agency: MOVEMENT_AGENCIES.VOLUNTARY,
    resource: MOVEMENT_RESOURCES.MOVEMENT
  });

  const document = {
    uuid: leaderUuid,
    id: "leader",
    x: 3300,
    y: 1600,
    elevation: 0,
    parent: { id: "scene" },
    actor: null
  };
  const continuation = {
    id: "QsebH0X5zxLnfjj0",
    origin: { x: 3300, y: 1600, elevation: 0 },
    destination: { x: 3300, y: 1800, elevation: 0 },
    passed: {
      waypoints: [
        { x: 3300, y: 1700, elevation: 0, subpathId: stableSubpathId },
        { x: 3300, y: 1800, elevation: 0, subpathId: stableSubpathId, checkpoint: true }
      ]
    },
    pending: { waypoints: [] },
    method: "dragging"
  };

  assert.equal(Hooks.call("preMoveToken", document, continuation, {}), true);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(socketExecutions, 0);

  releaseContext();
  relationshipMovement.shutdown();
  movementService.shutdown();
  game.settings = previousSettings;
  globalThis.ui = previousUi;
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


test("socket service registers handlers when socketlib becomes ready", async () => {
  const registered = new Map();
  globalThis.socketlib = {
    registerModule(id) {
      assert.equal(id, "action-effects-5e");
      return {
        register(name, handler) {
          registered.set(name, handler);
        },
        async executeAsGM(name, ...args) {
          return registered.get(name)(...args);
        }
      };
    }
  };

  const { SocketService } = await import("../scripts/core/socket-service.js");
  const service = new SocketService();
  service.register("test.echo", (value) => value);
  service.initialize();

  assert.equal(service.ready, false);
  Hooks.callAll("socketlib.ready");
  assert.equal(service.ready, true);
  assert.equal(await service.executeAsGM("test.echo", "ok"), "ok");

  delete globalThis.socketlib;
});

test("relationship movement planner preserves a rigid follower offset", async () => {
  const { RelationshipMovementPlanner } = await import("../scripts/relationships/relationship-movement-planner.js");
  const { ATTACHMENT_MODES } = await import("../scripts/core/constants.js");

  const waypoints = RelationshipMovementPlanner.extractWaypoints({
    origin: { x: 0, y: 0, elevation: 0 },
    destination: { x: 200, y: 100, elevation: 5 },
    pending: {
      waypoints: [
        { x: 0, y: 0, elevation: 0 },
        { x: 100, y: 0, elevation: 0, checkpoint: true },
        { x: 200, y: 100, elevation: 5 }
      ]
    }
  });

  assert.equal(waypoints.length, 2);
  const translated = RelationshipMovementPlanner.translateWaypoints({
    leader: { x: 0, y: 0, elevation: 0 },
    follower: { x: 50, y: 100, elevation: 10 },
    relationship: {
      attachmentMode: ATTACHMENT_MODES.RIGID_OFFSET,
      followElevation: true
    },
    waypoints
  });

  assert.deepEqual(translated.map(({ x, y, elevation }) => ({ x, y, elevation })), [
    { x: 150, y: 100, elevation: 10 },
    { x: 250, y: 200, elevation: 15 }
  ]);
});

test("relationship movement planner explicitly checkpoints only the terminal generated waypoint", async () => {
  const { RelationshipMovementPlanner } = await import("../scripts/relationships/relationship-movement-planner.js");

  const waypoints = RelationshipMovementPlanner.sanitizeWaypoints([
    { x: 100, y: 0, elevation: 0 },
    { x: 200, y: 0, elevation: 0, checkpoint: false }
  ]);

  assert.equal("checkpoint" in waypoints[0], false);
  assert.equal(waypoints[1].checkpoint, true);
  assert.equal("action" in waypoints[1], false);
  assert.equal("level" in waypoints[1], false);

  const instructions = RelationshipMovementPlanner.buildInstructions({
    leader: { id: "leader", x: 0, y: 0, elevation: 0 },
    followers: [],
    waypoints
  });

  assert.equal(instructions.leader.waypoints[0].checkpoint, undefined);
  assert.equal(instructions.leader.waypoints.at(-1).checkpoint, true);
});

test("relationship follower transactions are classified as passenger movement", () => {
  const document = {
    uuid: "Scene.scene.Token.follower",
    id: "follower",
    x: 100,
    y: 0,
    elevation: 0,
    parent: { id: "scene" },
    actor: null
  };
  const movement = {
    id: "group-follower",
    origin: { x: 100, y: 0, elevation: 0 },
    destination: { x: 200, y: 0, elevation: 0 },
    pending: { waypoints: [{ x: 200, y: 0, elevation: 0 }] },
    passed: { waypoints: [] },
    method: "api"
  };
  const operation = {
    [OPERATION_METADATA_KEY]: {
      relationshipMovement: true,
      leaderUuid: "Scene.scene.Token.leader",
      agency: MOVEMENT_AGENCIES.VOLUNTARY,
      resource: MOVEMENT_RESOURCES.MOVEMENT,
      relationshipIds: ["relationship-1"],
      generatedBy: "action-effects-5e"
    }
  };

  const transaction = MovementTransaction.fromTokenHook({
    document,
    movement,
    operation,
    phase: MOVEMENT_PHASES.AFTER,
    user: { id: "gm" }
  });

  assert.equal(transaction.agency, MOVEMENT_AGENCIES.PASSENGER);
  assert.equal(transaction.resource, MOVEMENT_RESOURCES.NONE);
  assert.deepEqual(transaction.relationshipIds, ["relationship-1"]);
});

test("relationship movement service indexes only involved tokens and blocks follower self-movement", async () => {
  const registered = [];
  const fakeMovement = {
    registerConsumer(config) {
      registered.push(config);
      return () => {
        const index = registered.indexOf(config);
        if (index >= 0) registered.splice(index, 1);
      };
    },
    createOperationOptions(metadata) {
      return { actionEffects5e: metadata };
    },
    registerMovementContext() { return () => {}; }
  };
  const relationship = {
    id: "relationship-1",
    leaderUuid: "Scene.scene.Token.leader",
    followerUuid: "Scene.scene.Token.follower",
    followerCanSelfMove: false
  };
  const fakeRelationships = {
    list: () => [relationship],
    getForLeader: (uuid) => uuid === relationship.leaderUuid ? [relationship] : [],
    getForFollower: (uuid) => uuid === relationship.followerUuid ? [relationship] : []
  };
  const fakeSocket = {
    register() {},
    async executeAsGM() { return { completed: false }; }
  };
  globalThis.ui = { notifications: { warn() {}, error() {} } };

  const { RelationshipMovementService } = await import("../scripts/relationships/relationship-movement-service.js");
  const service = new RelationshipMovementService({
    socket: fakeSocket,
    relationships: fakeRelationships,
    movement: fakeMovement
  });
  service.initialize();

  assert.equal(service.getStats().indexedTokens, 2);
  assert.equal(service.getStats().indexedReceiptTokens, 2);
  const followerHandler = registered.find((consumer) => (
    consumer.execution === "initiator"
    && consumer.tokenUuids[0] === relationship.followerUuid
  )).handler;
  const result = followerHandler({
    subjectUuid: relationship.followerUuid,
    movementId: "move-1",
    phase: MOVEMENT_PHASES.BEFORE,
    method: "dragging",
    origin: { x: 0, y: 0, elevation: 0 },
    destination: { x: 100, y: 0, elevation: 0 },
    metadata: {}
  }, {});
  assert.equal(result, false);

  const internalResult = followerHandler({
    subjectUuid: relationship.followerUuid,
    movementId: "move-2",
    phase: MOVEMENT_PHASES.BEFORE,
    origin: { x: 0, y: 0, elevation: 0 },
    destination: { x: 100, y: 0, elevation: 0 },
    metadata: {
      relationshipMovement: true,
      generatedBy: "action-effects-5e"
    }
  }, {});
  assert.equal(internalResult, true);

  service.shutdown();
  delete globalThis.ui;
});

test("manual leader replacement is deferred until the cancelled movement hook has unwound", async () => {
  const registered = [];
  const fakeMovement = {
    registerConsumer(config) {
      registered.push(config);
      return () => {};
    },
    createOperationOptions(metadata) {
      return { actionEffects5e: metadata };
    },
    registerMovementContext() { return () => {}; }
  };
  const relationship = {
    id: "relationship-deferred",
    leaderUuid: "Scene.scene.Token.leader",
    followerUuid: "Scene.scene.Token.follower",
    followerCanSelfMove: false
  };
  const fakeRelationships = {
    list: () => [relationship],
    getForLeader: (uuid) => uuid === relationship.leaderUuid ? [relationship] : [],
    getForFollower: (uuid) => uuid === relationship.followerUuid ? [relationship] : []
  };

  let executeCalls = 0;
  let hookFrameOpen = true;
  let executedWhileHookFrameOpen = null;
  const fakeSocket = {
    register() {},
    async executeAsGM() {
      executeCalls += 1;
      executedWhileHookFrameOpen = hookFrameOpen;
      return { completed: true };
    }
  };
  globalThis.ui = { notifications: { warn() {}, error() {} } };

  const { RelationshipMovementService } = await import("../scripts/relationships/relationship-movement-service.js");
  const service = new RelationshipMovementService({
    socket: fakeSocket,
    relationships: fakeRelationships,
    movement: fakeMovement
  });
  service.initialize();

  const leaderHandler = registered.find((config) =>
    config.tokenUuids?.includes(relationship.leaderUuid) && config.phases?.includes(MOVEMENT_PHASES.BEFORE)
  )?.handler;
  assert.equal(typeof leaderHandler, "function");

  const result = leaderHandler({
    subjectUuid: relationship.leaderUuid,
    movementId: "manual-leader-move",
    phase: MOVEMENT_PHASES.BEFORE,
    method: "dragging",
    pathType: PATH_TYPES.TRAVERSE,
    movementMode: "walk",
    sourceUuid: null,
    origin: { x: 0, y: 0, elevation: 0 },
    destination: { x: 100, y: 0, elevation: 0 },
    metadata: {}
  }, {
    document: {
      uuid: relationship.leaderUuid,
      id: "leader",
      parent: { id: "scene" },
      x: 0,
      y: 0,
      elevation: 0
    },
    movement: {
      method: "dragging",
      autoRotate: false,
      split: false,
      constrainOptions: {},
      origin: { x: 0, y: 0, elevation: 0 },
      destination: { x: 100, y: 0, elevation: 0 },
      pending: { waypoints: [{ x: 100, y: 0, elevation: 0, action: "walk" }] }
    }
  });

  assert.equal(result, false);
  assert.equal(executeCalls, 0);

  // A microtask must not be sufficient to start the replacement. This models
  // Foundry still unwinding the preMoveToken update which Action Effects rejected.
  await Promise.resolve();
  assert.equal(executeCalls, 0);

  hookFrameOpen = false;
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(executeCalls, 1);
  assert.equal(executedWhileHookFrameOpen, false);
  assert.equal(service.getStats().queuedRequests, 0);

  service.shutdown();
  delete globalThis.ui;
});

test("GM relationship movement executes one coordinated Scene.moveTokens operation", async () => {
  const scene = {
    id: "scene-group",
    tokens: new FakeCollection(),
    moveCalls: [],
    async moveTokens(instructions, options) {
      assertGeneratedMovementInstructions(instructions);
      this.moveCalls.push({ instructions: structuredClone(instructions), options: structuredClone(options) });
      return Object.fromEntries(Object.keys(instructions).map((id) => [id, true]));
    }
  };
  game.scenes.set(scene.id, scene);

  const leader = new FakeTokenDocument({
    uuid: "Scene.scene-group.Token.leader",
    id: "leader",
    scene
  });
  Object.assign(leader, { x: 0, y: 0, elevation: 0, name: "Leader" });
  const follower = new FakeTokenDocument({
    uuid: "Scene.scene-group.Token.follower",
    id: "follower",
    scene
  });
  Object.assign(follower, { x: 100, y: 0, elevation: 0, name: "Follower", object: null });
  scene.tokens.set(leader.id, leader);
  scene.tokens.set(follower.id, follower);

  const documents = new Map([
    [leader.uuid, leader],
    [follower.uuid, follower]
  ]);
  globalThis.fromUuid = async (uuid) => documents.get(uuid) ?? null;

  const relationship = {
    id: "relationship-group",
    sceneId: scene.id,
    leaderUuid: leader.uuid,
    followerUuid: follower.uuid,
    attachmentMode: "rigidOffset",
    followerCanSelfMove: false,
    followElevation: true,
    followRotation: false,
    teleportPolicy: "detach",
    collisionPolicy: "stopGroup"
  };
  const fakeRelationships = {
    list: () => [relationship],
    getForLeader: (uuid) => uuid === leader.uuid ? [relationship] : [],
    getForFollower: (uuid) => uuid === follower.uuid ? [relationship] : [],
    async removeManyAsGM() { return 0; }
  };
  const socketHandlers = new Map();
  const fakeSocket = {
    register(name, handler) { socketHandlers.set(name, handler); },
    async executeAsGM(name, request) { return socketHandlers.get(name)(request); }
  };
  const fakeMovement = {
    registerConsumer() { return () => {}; },
    createOperationOptions(metadata) { return { actionEffects5e: { generatedBy: "action-effects-5e", ...metadata } }; },
    registerMovementContext() { return () => {}; }
  };

  const { RelationshipMovementService } = await import("../scripts/relationships/relationship-movement-service.js");
  new RelationshipMovementService({
    socket: fakeSocket,
    relationships: fakeRelationships,
    movement: fakeMovement
  });

  const result = await socketHandlers.get("relationships.moveGroup")({
    requestId: "request-group",
    requestingUserId: gmUser.id,
    sceneId: scene.id,
    leaderUuid: leader.uuid,
    originalMovementId: "original-move",
    origin: { x: 0, y: 0, elevation: 0 },
    waypoints: [{ x: 200, y: 100, elevation: 5, action: "walk" }],
    pathType: "traverse",
    movementMode: "walk",
    method: "dragging",
    split: true,
    autoRotate: true
  });

  assert.equal(result.completed, true);
  assert.equal(scene.moveCalls.length, 1);
  const call = scene.moveCalls[0];
  assert.deepEqual(call.instructions.leader.waypoints[0], {
    x: 200,
    y: 100,
    elevation: 5,
    action: "walk",
    checkpoint: true
  });
  assert.deepEqual(call.instructions.follower.waypoints[0], {
    x: 300,
    y: 100,
    elevation: 5,
    action: "walk",
    checkpoint: true
  });
  assert.equal(call.instructions.leader.method, "dragging");
  assert.equal(call.instructions.follower.method, "api");
  assert.match(call.instructions.leader.id, /^[A-Za-z0-9]{16}$/);
  assert.match(call.instructions.follower.id, /^[A-Za-z0-9]{16}$/);
  assert.notEqual(call.instructions.leader.id, call.instructions.follower.id);
  assert.equal(call.options.actionEffects5e.relationshipMovement, true);
  assert.equal(call.options.actionEffects5e.requestingUserId, gmUser.id);

  game.scenes.delete(scene.id);
});

test("external API leader movement synchronizes followers after the leader has moved", async () => {
  const scene = {
    id: "scene-external",
    tokens: new FakeCollection(),
    moveCalls: [],
    async moveTokens(instructions, options) {
      assertGeneratedMovementInstructions(instructions);
      this.moveCalls.push({ instructions: structuredClone(instructions), options: structuredClone(options) });
      return Object.fromEntries(Object.keys(instructions).map((id) => [id, true]));
    }
  };
  game.scenes.set(scene.id, scene);

  const leader = new FakeTokenDocument({
    uuid: "Scene.scene-external.Token.leader",
    id: "leader",
    scene
  });
  Object.assign(leader, { x: 200, y: 0, elevation: 0, name: "Leader" });
  const follower = new FakeTokenDocument({
    uuid: "Scene.scene-external.Token.follower",
    id: "follower",
    scene
  });
  Object.assign(follower, { x: 100, y: 50, elevation: 0, name: "Follower", object: null });
  scene.tokens.set(leader.id, leader);
  scene.tokens.set(follower.id, follower);

  const documents = new Map([
    [leader.uuid, leader],
    [follower.uuid, follower]
  ]);
  globalThis.fromUuid = async (uuid) => documents.get(uuid) ?? null;

  const relationship = {
    id: "relationship-external",
    sceneId: scene.id,
    leaderUuid: leader.uuid,
    followerUuid: follower.uuid,
    attachmentMode: "rigidOffset",
    followerCanSelfMove: false,
    followElevation: true,
    followRotation: false,
    teleportPolicy: "detach",
    collisionPolicy: "stopGroup"
  };
  const removed = [];
  const fakeRelationships = {
    list: () => [relationship],
    getForLeader: (uuid) => uuid === leader.uuid ? [relationship] : [],
    getForFollower: (uuid) => uuid === follower.uuid ? [relationship] : [],
    async removeManyAsGM(ids) { removed.push(...ids); return ids.size ?? ids.length; }
  };
  const socketHandlers = new Map();
  const fakeSocket = {
    register(name, handler) { socketHandlers.set(name, handler); },
    async executeAsGM(name, request) { return socketHandlers.get(name)(request); }
  };
  const fakeMovement = {
    registerConsumer() { return () => {}; },
    createOperationOptions(metadata) { return { actionEffects5e: { generatedBy: "action-effects-5e", ...metadata } }; },
    registerMovementContext() { return () => {}; }
  };

  const { RelationshipMovementService } = await import("../scripts/relationships/relationship-movement-service.js");
  new RelationshipMovementService({
    socket: fakeSocket,
    relationships: fakeRelationships,
    movement: fakeMovement
  });

  const result = await socketHandlers.get("relationships.syncFollowers")({
    requestId: "request-external",
    requestingUserId: gmUser.id,
    sceneId: scene.id,
    leaderUuid: leader.uuid,
    originalMovementId: "external-move",
    origin: { x: 0, y: 0, elevation: 0 },
    destination: { x: 200, y: 0, elevation: 0 },
    waypoints: [{ x: 200, y: 0, elevation: 0, action: "walk" }],
    pathType: "traverse",
    movementMode: "walk"
  });

  assert.equal(result.completed, true);
  assert.deepEqual(removed, []);
  assert.equal(scene.moveCalls.length, 1);
  assert.deepEqual(scene.moveCalls[0].instructions.follower.waypoints[0], {
    x: 300,
    y: 50,
    elevation: 0,
    action: "walk",
    checkpoint: true
  });
  assert.equal(scene.moveCalls[0].options.actionEffects5e.externalLeaderMovement, true);

  game.scenes.delete(scene.id);
});

test("non-GM external synchronization requires and trusts the GM movement receipt", async () => {
  const player = { id: "player-1", isGM: false, active: true };
  game.users.set(player.id, player);

  const scene = {
    id: "scene-receipt",
    tokens: new FakeCollection(),
    moveCalls: [],
    async moveTokens(instructions, options) {
      assertGeneratedMovementInstructions(instructions);
      this.moveCalls.push({ instructions: structuredClone(instructions), options: structuredClone(options) });
      return Object.fromEntries(Object.keys(instructions).map((id) => [id, true]));
    }
  };
  game.scenes.set(scene.id, scene);

  const leader = new FakeTokenDocument({
    uuid: "Scene.scene-receipt.Token.leader",
    id: "leader",
    scene,
    owner: true
  });
  Object.assign(leader, { x: 200, y: 0, elevation: 0, name: "Leader" });
  const follower = new FakeTokenDocument({
    uuid: "Scene.scene-receipt.Token.follower",
    id: "follower",
    scene
  });
  Object.assign(follower, { x: 100, y: 50, elevation: 0, name: "Follower", object: null });
  scene.tokens.set(leader.id, leader);
  scene.tokens.set(follower.id, follower);

  const documents = new Map([
    [leader.uuid, leader],
    [follower.uuid, follower]
  ]);
  globalThis.fromUuid = async (uuid) => documents.get(uuid) ?? null;

  const relationship = {
    id: "relationship-receipt",
    sceneId: scene.id,
    leaderUuid: leader.uuid,
    followerUuid: follower.uuid,
    attachmentMode: "rigidOffset",
    followerCanSelfMove: false,
    followElevation: true,
    followRotation: false,
    teleportPolicy: "detach",
    collisionPolicy: "stopGroup"
  };
  const fakeRelationships = {
    list: () => [relationship],
    getForLeader: (uuid) => uuid === leader.uuid ? [relationship] : [],
    getForFollower: (uuid) => uuid === follower.uuid ? [relationship] : [],
    async removeManyAsGM() { return 0; }
  };
  const socketHandlers = new Map();
  const fakeSocket = {
    register(name, handler) { socketHandlers.set(name, handler); },
    async executeAsGM(name, request) { return socketHandlers.get(name)(request); }
  };
  const consumers = [];
  const fakeMovement = {
    registerConsumer(config) {
      consumers.push(config);
      return () => {};
    },
    createOperationOptions(metadata) { return { actionEffects5e: { generatedBy: "action-effects-5e", ...metadata } }; },
    registerMovementContext() { return () => {}; }
  };

  const { RelationshipMovementService } = await import("../scripts/relationships/relationship-movement-service.js");
  const service = new RelationshipMovementService({
    socket: fakeSocket,
    relationships: fakeRelationships,
    movement: fakeMovement
  });
  service.initialize();

  const receiptConsumer = consumers.find((consumer) => consumer.execution === "primaryGM");
  assert.ok(receiptConsumer);
  const trustedTransaction = {
    movementId: "verified-move",
    subjectUuid: leader.uuid,
    sceneId: scene.id,
    userId: player.id,
    origin: { x: 0, y: 0, elevation: 0 },
    destination: { x: 200, y: 0, elevation: 0 },
    path: [{ x: 0, y: 0, elevation: 0 }, { x: 200, y: 0, elevation: 0, action: "walk" }],
    pathType: "traverse",
    movementMode: "walk",
    sourceUuid: null,
    generatedBy: "external-module",
    metadata: {},
    toJSON() { return structuredClone({ ...this, toJSON: undefined }); }
  };
  receiptConsumer.handler(trustedTransaction);

  const result = await socketHandlers.get("relationships.syncFollowers")({
    requestId: "request-receipt",
    requestingUserId: player.id,
    sceneId: scene.id,
    leaderUuid: leader.uuid,
    originalMovementId: "verified-move",
    // Deliberately forged values: the GM receipt must override these.
    origin: { x: 999, y: 999, elevation: 0 },
    destination: { x: 200, y: 0, elevation: 0 },
    waypoints: [{ x: 999, y: 999, elevation: 0 }]
  });

  assert.equal(result.completed, true);
  assert.deepEqual(scene.moveCalls[0].instructions.follower.waypoints.at(-1), {
    x: 300,
    y: 50,
    elevation: 0,
    action: "walk",
    checkpoint: true
  });

  service.shutdown();
  game.scenes.delete(scene.id);
  game.users.delete(player.id);
});

test("blocked follower path stops coordinated movement before Scene.moveTokens", async () => {
  const scene = {
    id: "scene-collision-stop",
    tokens: new FakeCollection(),
    moveCalls: [],
    async moveTokens(instructions, options) {
      assertGeneratedMovementInstructions(instructions);
      this.moveCalls.push({ instructions, options });
      return Object.fromEntries(Object.keys(instructions).map((id) => [id, true]));
    }
  };
  game.scenes.set(scene.id, scene);

  const leader = new FakeTokenDocument({
    uuid: "Scene.scene-collision-stop.Token.leader",
    id: "leader",
    scene
  });
  Object.assign(leader, { x: 0, y: 0, elevation: 0, name: "Leader" });
  const follower = new FakeTokenDocument({
    uuid: "Scene.scene-collision-stop.Token.follower",
    id: "follower",
    scene
  });
  Object.assign(follower, {
    x: 100,
    y: 0,
    elevation: 0,
    name: "Follower",
    object: {
      constrainMovementPath(path) {
        return [path.slice(0, 1), true];
      }
    }
  });
  scene.tokens.set(leader.id, leader);
  scene.tokens.set(follower.id, follower);

  const documents = new Map([
    [leader.uuid, leader],
    [follower.uuid, follower]
  ]);
  globalThis.fromUuid = async (uuid) => documents.get(uuid) ?? null;

  const relationship = {
    id: "relationship-collision-stop",
    sceneId: scene.id,
    leaderUuid: leader.uuid,
    followerUuid: follower.uuid,
    attachmentMode: "rigidOffset",
    followerCanSelfMove: false,
    followElevation: true,
    followRotation: false,
    teleportPolicy: "detach",
    collisionPolicy: "stopGroup"
  };
  const fakeRelationships = {
    list: () => [relationship],
    getForLeader: (uuid) => uuid === leader.uuid ? [relationship] : [],
    getForFollower: (uuid) => uuid === follower.uuid ? [relationship] : [],
    async removeManyAsGM() { return 0; }
  };
  const handlers = new Map();
  const fakeSocket = {
    register(name, handler) { handlers.set(name, handler); },
    async executeAsGM(name, request) { return handlers.get(name)(request); }
  };
  const fakeMovement = {
    registerConsumer() { return () => {}; },
    createOperationOptions(metadata) { return { actionEffects5e: { generatedBy: "action-effects-5e", ...metadata } }; },
    registerMovementContext() { return () => {}; }
  };

  const { RelationshipMovementService } = await import("../scripts/relationships/relationship-movement-service.js");
  new RelationshipMovementService({ socket: fakeSocket, relationships: fakeRelationships, movement: fakeMovement });

  const result = await handlers.get("relationships.moveGroup")({
    requestId: "request-collision-stop",
    requestingUserId: gmUser.id,
    sceneId: scene.id,
    leaderUuid: leader.uuid,
    origin: { x: 0, y: 0, elevation: 0 },
    waypoints: [{ x: 200, y: 0, elevation: 0 }],
    pathType: "traverse",
    movementMode: "walk",
    method: "dragging"
  });

  assert.equal(result.completed, false);
  assert.equal(result.collision, true);
  assert.equal(scene.moveCalls.length, 0);

  game.scenes.delete(scene.id);
});

test("partial coordinated movement is rolled back with suppressed automation", async () => {
  const scene = {
    id: "scene-rollback",
    tokens: new FakeCollection(),
    moveCalls: [],
    async moveTokens(instructions, options) {
      assertGeneratedMovementInstructions(instructions);
      this.moveCalls.push({ instructions: structuredClone(instructions), options: structuredClone(options) });
      if (this.moveCalls.length === 1) return { leader: true, follower: false };
      return Object.fromEntries(Object.keys(instructions).map((id) => [id, true]));
    }
  };
  game.scenes.set(scene.id, scene);

  const leader = new FakeTokenDocument({
    uuid: "Scene.scene-rollback.Token.leader",
    id: "leader",
    scene
  });
  Object.assign(leader, { x: 0, y: 0, elevation: 0, name: "Leader" });
  const follower = new FakeTokenDocument({
    uuid: "Scene.scene-rollback.Token.follower",
    id: "follower",
    scene
  });
  Object.assign(follower, { x: 100, y: 0, elevation: 0, name: "Follower", object: null });
  scene.tokens.set(leader.id, leader);
  scene.tokens.set(follower.id, follower);

  const documents = new Map([
    [leader.uuid, leader],
    [follower.uuid, follower]
  ]);
  globalThis.fromUuid = async (uuid) => documents.get(uuid) ?? null;

  const relationship = {
    id: "relationship-rollback",
    sceneId: scene.id,
    leaderUuid: leader.uuid,
    followerUuid: follower.uuid,
    attachmentMode: "rigidOffset",
    followerCanSelfMove: false,
    followElevation: true,
    followRotation: false,
    teleportPolicy: "detach",
    collisionPolicy: "stopGroup"
  };
  const fakeRelationships = {
    list: () => [relationship],
    getForLeader: (uuid) => uuid === leader.uuid ? [relationship] : [],
    getForFollower: (uuid) => uuid === follower.uuid ? [relationship] : [],
    async removeManyAsGM() { return 0; }
  };
  const handlers = new Map();
  const fakeSocket = {
    register(name, handler) { handlers.set(name, handler); },
    async executeAsGM(name, request) { return handlers.get(name)(request); }
  };
  const fakeMovement = {
    registerConsumer() { return () => {}; },
    createOperationOptions(metadata) { return { actionEffects5e: { generatedBy: "action-effects-5e", ...metadata } }; },
    registerMovementContext() { return () => {}; }
  };

  const { RelationshipMovementService } = await import("../scripts/relationships/relationship-movement-service.js");
  new RelationshipMovementService({ socket: fakeSocket, relationships: fakeRelationships, movement: fakeMovement });

  const result = await handlers.get("relationships.moveGroup")({
    requestId: "request-rollback",
    requestingUserId: gmUser.id,
    sceneId: scene.id,
    leaderUuid: leader.uuid,
    origin: { x: 0, y: 0, elevation: 0 },
    waypoints: [{ x: 200, y: 0, elevation: 0 }],
    pathType: "traverse",
    movementMode: "walk",
    method: "dragging"
  });

  assert.equal(result.completed, false);
  assert.equal(result.rolledBack, true);
  assert.equal(scene.moveCalls.length, 2);
  assert.deepEqual(Object.keys(scene.moveCalls[1].instructions), ["leader"]);
  assert.equal(scene.moveCalls[1].instructions.leader.destination.checkpoint, true);
  assert.equal(scene.moveCalls[1].options.actionEffects5e.relationshipRollback, true);
  assert.equal(scene.moveCalls[1].options.actionEffects5e.suppressAutomation, true);

  game.scenes.delete(scene.id);
});

test("movement transaction avoids Foundry's deprecated operation.teleport accessor and classifies teleport actions", () => {
  const previousConfig = globalThis.CONFIG;
  globalThis.CONFIG = {
    Token: {
      movement: {
        actions: new Map([
          ["walk", { teleport: false }],
          ["blink", { teleport: true }]
        ])
      }
    }
  };

  try {
    const document = {
      uuid: "Scene.scene.Token.token",
      id: "token",
      x: 0,
      y: 0,
      elevation: 0,
      parent: { id: "scene" },
      actor: null
    };

    const operationPrototype = {};
    Object.defineProperty(operationPrototype, "teleport", {
      configurable: true,
      get() {
        throw new Error("Deprecated operation.teleport getter was accessed.");
      }
    });
    const operation = Object.create(operationPrototype);

    const traverse = MovementTransaction.fromTokenHook({
      document,
      movement: {
        id: "movement-walk",
        origin: { x: 0, y: 0, elevation: 0 },
        destination: { x: 100, y: 0, elevation: 0, action: "walk" },
        method: "api"
      },
      operation,
      phase: MOVEMENT_PHASES.AFTER,
      user: gmUser
    });
    assert.equal(traverse.pathType, PATH_TYPES.TRAVERSE);

    const teleport = MovementTransaction.fromTokenHook({
      document,
      movement: {
        id: "movement-blink",
        origin: { x: 0, y: 0, elevation: 0 },
        // Foundry's completed moveToken data may place the movement action on
        // processed passed waypoints rather than on destination itself.
        destination: { x: 500, y: 0, elevation: 0 },
        passed: { waypoints: [{ x: 500, y: 0, elevation: 0, action: "blink", checkpoint: true }] },
        pending: { waypoints: [] },
        method: "api"
      },
      operation,
      phase: MOVEMENT_PHASES.AFTER,
      user: gmUser
    });
    assert.equal(teleport.pathType, PATH_TYPES.TELEPORT);
    assert.equal(teleport.movementMode, "blink");

    const explicitOwnTeleport = MovementTransaction.fromTokenHook({
      document,
      movement: {
        id: "movement-own-teleport",
        origin: { x: 0, y: 0, elevation: 0 },
        destination: { x: 500, y: 0, elevation: 0 },
        method: "api"
      },
      operation: { teleport: true },
      phase: MOVEMENT_PHASES.AFTER,
      user: gmUser
    });
    assert.equal(explicitOwnTeleport.pathType, PATH_TYPES.TELEPORT);
  } finally {
    globalThis.CONFIG = previousConfig;
  }
});

test("relationship movement planner preserves Foundry passed plus pending checkpoint routes", async () => {
  const { RelationshipMovementPlanner } = await import("../scripts/relationships/relationship-movement-planner.js");

  const movement = {
    id: "c7gPmz250VwNimCY",
    origin: { x: 3100, y: 1600, elevation: 0 },
    // Foundry's destination is only the end of the currently executing leg.
    destination: { x: 3300, y: 1600, elevation: 0 },
    passed: {
      waypoints: [
        { x: 3200, y: 1600, elevation: 0, action: "walk", explicit: false, checkpoint: false },
        { x: 3300, y: 1600, elevation: 0, action: "walk", explicit: true, checkpoint: true }
      ]
    },
    pending: {
      waypoints: [
        { x: 3300, y: 1700, elevation: 0, action: "walk", explicit: false, checkpoint: false },
        { x: 3300, y: 1800, elevation: 0, action: "walk", explicit: true, checkpoint: true }
      ]
    }
  };

  const waypoints = RelationshipMovementPlanner.extractWaypoints(movement);
  assert.deepEqual(waypoints.map(({ x, y }) => ({ x, y })), [
    { x: 3200, y: 1600 },
    { x: 3300, y: 1600 },
    { x: 3300, y: 1700 },
    { x: 3300, y: 1800 }
  ]);
  assert.equal(waypoints[1].explicit, true);
  assert.equal(waypoints[1].checkpoint, true);
  assert.equal(waypoints[2].checkpoint, false);
  assert.equal(waypoints.at(-1).checkpoint, true);
});

test("adjacent follower trails one space behind the complete L-shaped Foundry route", async () => {
  const { RelationshipMovementPlanner } = await import("../scripts/relationships/relationship-movement-planner.js");
  const { ATTACHMENT_MODES } = await import("../scripts/core/constants.js");

  const movement = {
    origin: { x: 3100, y: 1600, elevation: 0 },
    destination: { x: 3300, y: 1600, elevation: 0 },
    passed: {
      waypoints: [
        { x: 3200, y: 1600, elevation: 0, action: "walk", checkpoint: false },
        { x: 3300, y: 1600, elevation: 0, action: "walk", explicit: true, checkpoint: true }
      ]
    },
    pending: {
      waypoints: [
        { x: 3300, y: 1700, elevation: 0, action: "walk", checkpoint: false },
        { x: 3300, y: 1800, elevation: 0, action: "walk", explicit: true, checkpoint: true }
      ]
    }
  };

  const leaderWaypoints = RelationshipMovementPlanner.extractWaypoints(movement);
  const trailing = RelationshipMovementPlanner.translateWaypoints({
    leader: { x: 3100, y: 1600, elevation: 0 },
    follower: { x: 3100, y: 1500, elevation: 0 },
    relationship: {
      attachmentMode: ATTACHMENT_MODES.ADJACENT_FOLLOWER,
      followElevation: true
    },
    waypoints: leaderWaypoints,
    pathType: PATH_TYPES.TRAVERSE
  });

  assert.deepEqual(trailing.map(({ x, y }) => ({ x, y })), [
    { x: 3100, y: 1600 },
    { x: 3200, y: 1600 },
    { x: 3300, y: 1600 },
    { x: 3300, y: 1700 }
  ]);
  assert.equal(trailing[0].checkpoint, true);
  assert.equal(trailing[2].checkpoint, true);
  assert.equal(trailing.at(-1).checkpoint, true);
});

test("adjacent follower checkpoints the leader origin before tracing later checkpoints", async () => {
  const { RelationshipMovementPlanner } = await import("../scripts/relationships/relationship-movement-planner.js");
  const { ATTACHMENT_MODES } = await import("../scripts/core/constants.js");

  // Live Foundry 14.365 regression: the follower begins diagonally adjacent to
  // the leader. Without a checkpoint at the leader origin, Foundry computes a
  // direct path from the follower origin to the later explicit corner and can
  // skip the leader's vacated starting square.
  const trailing = RelationshipMovementPlanner.translateWaypoints({
    leader: { x: 2800, y: 2300, elevation: 0 },
    follower: { x: 2700, y: 2400, elevation: 0 },
    relationship: {
      attachmentMode: ATTACHMENT_MODES.ADJACENT_FOLLOWER,
      followElevation: true
    },
    waypoints: [
      { x: 2900, y: 2300, elevation: 0, action: "walk", checkpoint: false },
      { x: 3000, y: 2300, elevation: 0, action: "walk", checkpoint: false },
      { x: 3100, y: 2300, elevation: 0, action: "walk", explicit: true, checkpoint: true },
      { x: 3100, y: 2400, elevation: 0, action: "walk", checkpoint: false },
      { x: 3100, y: 2500, elevation: 0, action: "walk", checkpoint: false },
      { x: 3100, y: 2600, elevation: 0, action: "walk", checkpoint: false },
      { x: 3100, y: 2700, elevation: 0, action: "walk", explicit: true, checkpoint: true }
    ],
    pathType: PATH_TYPES.TRAVERSE
  });

  assert.deepEqual(trailing.map(({ x, y }) => ({ x, y })), [
    { x: 2800, y: 2300 },
    { x: 2900, y: 2300 },
    { x: 3000, y: 2300 },
    { x: 3100, y: 2300 },
    { x: 3100, y: 2400 },
    { x: 3100, y: 2500 },
    { x: 3100, y: 2600 }
  ]);

  assert.equal(trailing[0].checkpoint, true, "Follower must first enter the leader's vacated origin.");
  assert.notEqual(trailing[0].explicit, true, "The synthetic entry checkpoint is not a user-authored explicit waypoint.");
  assert.equal(trailing[3].checkpoint, true, "The leader's explicit corner checkpoint must be preserved.");
  assert.equal(trailing.at(-1).checkpoint, true, "Follower terminal trailing position must remain a checkpoint.");
  assert.deepEqual(
    trailing.filter((point) => point.checkpoint === true).map(({ x, y }) => ({ x, y })),
    [
      { x: 2800, y: 2300 },
      { x: 3100, y: 2300 },
      { x: 3100, y: 2600 }
    ]
  );
});

test("adjacent follower trails through spaces vacated by the leader while teleport-follow preserves offset", async () => {
  const { RelationshipMovementPlanner } = await import("../scripts/relationships/relationship-movement-planner.js");
  const { ATTACHMENT_MODES } = await import("../scripts/core/constants.js");

  const relationship = {
    attachmentMode: ATTACHMENT_MODES.ADJACENT_FOLLOWER,
    followElevation: true
  };
  const leader = { x: 0, y: 0, elevation: 0 };
  const follower = { x: 0, y: 100, elevation: 0 };
  const leaderWaypoints = [
    { x: 100, y: 0, elevation: 0, action: "walk" },
    { x: 100, y: 100, elevation: 0, action: "walk" },
    { x: 200, y: 100, elevation: 5, action: "walk", checkpoint: true }
  ];

  const trailing = RelationshipMovementPlanner.translateWaypoints({
    leader,
    follower,
    relationship,
    waypoints: leaderWaypoints,
    pathType: PATH_TYPES.TRAVERSE
  });

  assert.deepEqual(trailing.map(({ x, y, elevation }) => ({ x, y, elevation })), [
    { x: 0, y: 0, elevation: 0 },
    { x: 100, y: 0, elevation: 0 },
    { x: 100, y: 100, elevation: 0 }
  ]);
  assert.equal(trailing.at(-1).checkpoint, true);
  assert.equal(trailing[0].action, undefined);
  assert.equal(trailing[1].action, "walk");

  const teleportFollow = RelationshipMovementPlanner.translateWaypoints({
    leader,
    follower,
    relationship,
    waypoints: [{ x: 500, y: 500, elevation: 10, action: "blink", checkpoint: true }],
    pathType: PATH_TYPES.TELEPORT
  });

  assert.deepEqual(teleportFollow.map(({ x, y, elevation }) => ({ x, y, elevation })), [
    { x: 500, y: 600, elevation: 10 }
  ]);
  assert.equal(teleportFollow[0].action, "blink");
  assert.equal(teleportFollow[0].checkpoint, true);

  const fakeSquareGrid = {
    isGridless: false,
    getTopLeftPoint(coords) {
      if (Number.isFinite(coords?.i) && Number.isFinite(coords?.j)) {
        return { x: coords.i * 100, y: coords.j * 100 };
      }
      return {
        x: Math.floor(coords.x / 100) * 100,
        y: Math.floor(coords.y / 100) * 100
      };
    },
    getDirectPath([start, end]) {
      const startI = Math.round(start.x / 100);
      const startJ = Math.round(start.y / 100);
      const endI = Math.round(end.x / 100);
      const endJ = Math.round(end.y / 100);
      const di = Math.sign(endI - startI);
      const dj = Math.sign(endJ - startJ);
      const steps = Math.max(Math.abs(endI - startI), Math.abs(endJ - startJ));
      return Array.from({ length: steps + 1 }, (_, index) => ({
        i: startI + (di * index),
        j: startJ + (dj * index)
      }));
    }
  };

  const longStraightDrag = RelationshipMovementPlanner.translateWaypoints({
    leader,
    follower,
    relationship,
    waypoints: [{ x: 300, y: 0, elevation: 0, action: "walk", checkpoint: true }],
    pathType: PATH_TYPES.TRAVERSE,
    grid: fakeSquareGrid
  });

  assert.deepEqual(longStraightDrag.map(({ x, y }) => ({ x, y })), [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 200, y: 0 }
  ]);
  assert.equal(longStraightDrag.at(-1).checkpoint, true);

  assert.throws(() => RelationshipMovementPlanner.translateWaypoints({
    leader,
    follower,
    relationship,
    waypoints: [{ x: 10100, y: 0, elevation: 0, action: "walk", checkpoint: true }],
    pathType: PATH_TYPES.TRAVERSE,
    grid: fakeSquareGrid
  }), /limited to 100 translated grid steps/);
});

test("follower teleport bypasses manual movement lock and detaches its relationship after completion", async () => {
  const scene = {
    id: "scene-follower-teleport",
    tokens: new FakeCollection()
  };
  game.scenes.set(scene.id, scene);

  const leader = new FakeTokenDocument({
    uuid: "Scene.scene-follower-teleport.Token.leader",
    id: "leader",
    scene
  });
  Object.assign(leader, { x: 0, y: 0, elevation: 0, name: "Leader" });
  const follower = new FakeTokenDocument({
    uuid: "Scene.scene-follower-teleport.Token.follower",
    id: "follower",
    scene
  });
  Object.assign(follower, { x: 200, y: 0, elevation: 0, name: "Follower" });
  scene.tokens.set(leader.id, leader);
  scene.tokens.set(follower.id, follower);

  const documents = new Map([
    [leader.uuid, leader],
    [follower.uuid, follower]
  ]);
  globalThis.fromUuid = async (uuid) => documents.get(uuid) ?? null;

  let relationship = {
    id: "relationship-follower-teleport",
    sceneId: scene.id,
    leaderUuid: leader.uuid,
    followerUuid: follower.uuid,
    attachmentMode: "adjacentFollower",
    followerCanSelfMove: false,
    followElevation: true,
    followRotation: false,
    teleportPolicy: "detach",
    collisionPolicy: "stopGroup"
  };
  const fakeRelationships = {
    list: () => relationship ? [relationship] : [],
    getForLeader: (uuid) => relationship && uuid === leader.uuid ? [structuredClone(relationship)] : [],
    getForFollower: (uuid) => relationship && uuid === follower.uuid ? [structuredClone(relationship)] : [],
    async removeManyAsGM(ids) {
      const values = [...ids];
      if (relationship && values.includes(relationship.id)) {
        relationship = null;
        return 1;
      }
      return 0;
    }
  };

  const handlers = new Map();
  const fakeSocket = {
    register(name, handler) { handlers.set(name, handler); },
    async executeAsGM(name, request) { return handlers.get(name)(request); }
  };
  const consumers = [];
  const fakeMovement = {
    registerConsumer(config) {
      consumers.push(config);
      return () => {};
    },
    createOperationOptions(metadata) { return { actionEffects5e: { generatedBy: "action-effects-5e", ...metadata } }; },
    registerMovementContext() { return () => {}; }
  };
  globalThis.ui = { notifications: { warn() {}, error() {} } };

  const { RelationshipMovementService } = await import("../scripts/relationships/relationship-movement-service.js");
  const service = new RelationshipMovementService({
    socket: fakeSocket,
    relationships: fakeRelationships,
    movement: fakeMovement
  });
  service.initialize();

  const followerConsumer = consumers.find((consumer) => (
    consumer.execution === "initiator"
    && consumer.tokenUuids[0] === follower.uuid
  ));
  assert.ok(followerConsumer);

  const beforeResult = followerConsumer.handler({
    subjectUuid: follower.uuid,
    movementId: "follower-blink",
    phase: MOVEMENT_PHASES.BEFORE,
    method: "keyboard",
    pathType: PATH_TYPES.TELEPORT,
    origin: { x: 100, y: 0, elevation: 0 },
    destination: { x: 200, y: 0, elevation: 0 },
    metadata: {}
  }, {});
  assert.equal(beforeResult, true);

  const afterResult = followerConsumer.handler({
    subjectUuid: follower.uuid,
    movementId: "follower-blink",
    phase: MOVEMENT_PHASES.AFTER,
    method: "api",
    pathType: PATH_TYPES.TELEPORT,
    movementMode: "blink",
    sceneId: scene.id,
    userId: gmUser.id,
    origin: { x: 100, y: 0, elevation: 0 },
    destination: { x: 200, y: 0, elevation: 0 },
    sourceUuid: "Item.teleport",
    generatedBy: "test",
    metadata: {}
  }, {});
  assert.equal(afterResult, true);

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(relationship, null);
  assert.equal(service.getStats().queuedFollowerDetaches, 0);

  service.shutdown();
  delete globalThis.ui;
  game.scenes.delete(scene.id);
});

test("non-GM follower teleport detachment requires a matching primary-GM movement receipt", async () => {
  const player = { id: "player-follower-teleport", isGM: false, active: true };
  game.users.set(player.id, player);

  const scene = {
    id: "scene-follower-teleport-receipt",
    tokens: new FakeCollection()
  };
  game.scenes.set(scene.id, scene);

  const leader = new FakeTokenDocument({
    uuid: "Scene.scene-follower-teleport-receipt.Token.leader",
    id: "leader",
    scene,
    owner: false
  });
  Object.assign(leader, { x: 0, y: 0, elevation: 0, name: "Leader" });
  const follower = new FakeTokenDocument({
    uuid: "Scene.scene-follower-teleport-receipt.Token.follower",
    id: "follower",
    scene,
    owner: true
  });
  Object.assign(follower, { x: 300, y: 0, elevation: 0, name: "Follower" });
  scene.tokens.set(leader.id, leader);
  scene.tokens.set(follower.id, follower);

  const documents = new Map([
    [leader.uuid, leader],
    [follower.uuid, follower]
  ]);
  globalThis.fromUuid = async (uuid) => documents.get(uuid) ?? null;

  let relationship = {
    id: "relationship-follower-teleport-receipt",
    sceneId: scene.id,
    leaderUuid: leader.uuid,
    followerUuid: follower.uuid,
    attachmentMode: "adjacentFollower",
    followerCanSelfMove: false,
    teleportPolicy: "detach",
    collisionPolicy: "stopGroup"
  };
  const fakeRelationships = {
    list: () => relationship ? [relationship] : [],
    getForLeader: (uuid) => relationship && uuid === leader.uuid ? [structuredClone(relationship)] : [],
    getForFollower: (uuid) => relationship && uuid === follower.uuid ? [structuredClone(relationship)] : [],
    async removeManyAsGM(ids) {
      if (relationship && [...ids].includes(relationship.id)) {
        relationship = null;
        return 1;
      }
      return 0;
    }
  };

  const handlers = new Map();
  const fakeSocket = {
    register(name, handler) { handlers.set(name, handler); },
    async executeAsGM(name, request) { return handlers.get(name)(request); }
  };
  const consumers = [];
  const fakeMovement = {
    registerConsumer(config) {
      consumers.push(config);
      return () => {};
    },
    createOperationOptions(metadata) { return { actionEffects5e: metadata }; },
    registerMovementContext() { return () => {}; }
  };

  const { RelationshipMovementService } = await import("../scripts/relationships/relationship-movement-service.js");
  const service = new RelationshipMovementService({
    socket: fakeSocket,
    relationships: fakeRelationships,
    movement: fakeMovement
  });
  service.initialize();

  const followerReceiptConsumer = consumers.find((consumer) => (
    consumer.execution === "primaryGM"
    && consumer.tokenUuids[0] === follower.uuid
  ));
  assert.ok(followerReceiptConsumer);

  followerReceiptConsumer.handler({
    movementId: "verified-follower-blink",
    subjectUuid: follower.uuid,
    sceneId: scene.id,
    userId: player.id,
    origin: { x: 100, y: 0, elevation: 0 },
    destination: { x: 300, y: 0, elevation: 0 },
    path: [{ x: 300, y: 0, elevation: 0, action: "blink", checkpoint: true }],
    pathType: PATH_TYPES.TELEPORT,
    movementMode: "blink",
    sourceUuid: "Item.misty-step",
    generatedBy: "external-module",
    metadata: {},
    toJSON() { return structuredClone({ ...this, toJSON: undefined }); }
  });

  const result = await handlers.get("relationships.detachFollowerTeleport")({
    requestId: "request-follower-teleport-receipt",
    requestingUserId: player.id,
    sceneId: scene.id,
    followerUuid: follower.uuid,
    originalMovementId: "verified-follower-blink",
    // Deliberately forged values: the GM receipt must override them.
    origin: { x: 999, y: 999, elevation: 0 },
    destination: { x: 999, y: 999, elevation: 0 },
    pathType: PATH_TYPES.TRAVERSE,
    movementMode: "walk"
  });

  assert.equal(result.completed, true);
  assert.deepEqual(result.detachedRelationshipIds, ["relationship-follower-teleport-receipt"]);
  assert.equal(relationship, null);
  assert.equal(service.getStats().movementReceipts, 0);

  service.shutdown();
  game.scenes.delete(scene.id);
  game.users.delete(player.id);
});
