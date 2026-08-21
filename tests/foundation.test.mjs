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
  DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 },
  TOKEN_DISPOSITIONS: { FRIENDLY: 1, NEUTRAL: 0, HOSTILE: -1, SECRET: -2 }
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
  PATH_TYPES,
  RELATIONSHIP_ALLIED_ENDPOINT_GRACE_MS,
  RELATIONSHIP_ALLIED_ENDPOINT_POLICIES,
  RELATIONSHIP_COORDINATION_POLICIES,
  RELATIONSHIP_FORCED_LEADER_MOVEMENT_POLICIES,
  RELATIONSHIP_GEOMETRY_CHANNELS,
  RELATIONSHIP_ROTATION_POLICIES
} = await import("../scripts/core/constants.js");
const { MovementTransaction } = await import("../scripts/movement/movement-transaction.js");
const { MovementRegistry } = await import("../scripts/movement/movement-registry.js");
const { RelationshipOrbitPlanner } = await import("../scripts/relationships/relationship-orbit-planner.js");
const { RelationshipDistance } = await import("../scripts/relationships/relationship-distance.js");
const { RelationshipGeometryService } = await import("../scripts/relationships/relationship-geometry-service.js");

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


test("CAT movement adapter recognizes external catForce semantics without inventing displacement details", async () => {
  const { CatMovementAdapter } = await import("../scripts/integrations/cat-movement-adapter.js");
  const previousModules = game.modules;
  game.modules = new Map([["cat", { active: true, version: "0.0.6" }]]);
  try {
    const adapter = new CatMovementAdapter({ catAccessor: () => ({ utils: { tokenUtils: { moveToken: async () => true } } }) });
    const enriched = adapter.enrichOperation({
      movement: {
        origin: { x: 0, y: 0, elevation: 0 },
        destination: { x: 100, y: 0, elevation: 0, action: "catForce" },
        passed: { waypoints: [] }
      },
      operation: {}
    });
    const metadata = enriched[OPERATION_METADATA_KEY];
    assert.equal(metadata.agency, MOVEMENT_AGENCIES.FORCED);
    assert.equal(metadata.resource, MOVEMENT_RESOURCES.NONE);
    assert.equal(metadata.movementMode, "catForce");
    assert.equal(metadata.interoperabilityProvider, "cat");
    assert.equal(metadata.generatedBy, "cat");
    assert.equal(metadata.displacementType, undefined);
    assert.equal(metadata.sourceUuid, undefined);
  } finally {
    game.modules = previousModules;
  }
});

test("CAT movement adapter prefers CAT when available and falls back only when unavailable before execution", async () => {
  const { CatMovementAdapter } = await import("../scripts/integrations/cat-movement-adapter.js");
  const previousModules = game.modules;
  let catCalls = 0;
  let nativeCalls = 0;
  let active = true;
  game.modules = new Map([["cat", { active: true, version: "0.0.6" }]]);
  const catApi = { utils: { tokenUtils: { moveToken: async () => { catCalls += 1; return true; } } } };
  const document = { move: async () => { nativeCalls += 1; return true; } };
  try {
    const adapter = new CatMovementAdapter({ catAccessor: () => active ? catApi : null });
    assert.equal(await adapter.moveToken(document, [{ x: 100, y: 0, checkpoint: true }], {}), true);
    assert.equal(catCalls, 1);
    assert.equal(nativeCalls, 0);

    active = false;
    game.modules.set("cat", { active: false, version: "0.0.6" });
    assert.equal(await adapter.moveToken(document, [{ x: 0, y: 0, checkpoint: true }], {}), true);
    assert.equal(catCalls, 1);
    assert.equal(nativeCalls, 1);
    assert.equal(adapter.getStats().catExecutions, 1);
    assert.equal(adapter.getStats().nativeFallbackExecutions, 1);
  } finally {
    game.modules = previousModules;
  }
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

  await assert.rejects(
    service.create({
      leaderUuid: leader.uuid,
      followerUuid: follower.uuid,
      type: "test",
      attachmentMode: "grappleFollower",
      coordinationDistance: 15,
      breakDistance: 10
    }),
    /coordinationDistance .* cannot exceed breakDistance/i
  );
  assert.equal(service.list().length, 0, "Invalid relationship geometry must not be persisted.");

  const relationship = await service.create({
    leaderUuid: leader.uuid,
    followerUuid: follower.uuid,
    type: "test",
    attachmentMode: "adjacentFollower"
  });

  assert.equal(service.involves(leader.uuid), true);
  assert.equal(service.getForLeader(leader.uuid).length, 1);
  assert.equal(service.getForFollower(follower.uuid)[0].id, relationship.id);
  assert.equal(relationship.coordinationPolicy, RELATIONSHIP_COORDINATION_POLICIES.COORDINATED);
  assert.equal(relationship.forcedLeaderMovementPolicy, RELATIONSHIP_FORCED_LEADER_MOVEMENT_POLICIES.FOLLOW);
  assert.equal(relationship.breakDistance, null);
  assert.equal(relationship.rotationPolicy, RELATIONSHIP_ROTATION_POLICIES.NONE, "Pre-v0.3.0/default relationships must not opt into orbital rotation implicitly.");
  assert.equal(relationship.alliedEndpointPolicy, RELATIONSHIP_ALLIED_ENDPOINT_POLICIES.GRACE);
  assert.equal(relationship.alliedEndpointGraceMs, RELATIONSHIP_ALLIED_ENDPOINT_GRACE_MS);
  assert.equal(scene.getFlag("action-effects-5e", "relationships").length, 1);
  assert.equal(socket.handlers.size, 4, "RelationshipService should register create/remove/updateGeometry/cleanup handlers.");

  const updated = await service.updateGeometry(relationship.id, { coordinationDistance: 10, breakDistance: 15 });
  assert.equal(updated.coordinationDistance, 10);
  assert.equal(updated.breakDistance, 15);
  assert.equal(service.get(relationship.id).coordinationDistance, 10);
  assert.equal(service.get(relationship.id).breakDistance, 15);
  assert.equal(scene.getFlag("action-effects-5e", "relationships")[0].coordinationDistance, 10);
  assert.equal(scene.getFlag("action-effects-5e", "relationships")[0].breakDistance, 15);

  await assert.rejects(
    service.updateGeometry(relationship.id, { coordinationDistance: 20 }),
    /coordinationDistance .* cannot exceed breakDistance/i
  );
  assert.equal(service.get(relationship.id).coordinationDistance, 10, "Rejected geometry updates must leave persisted state unchanged.");
  assert.equal(service.get(relationship.id).breakDistance, 15);

  await assert.rejects(
    service.updateGeometry(relationship.id, { breakDistance: 5 }),
    /coordinationDistance .* cannot exceed breakDistance/i
  );
  assert.equal(service.get(relationship.id).coordinationDistance, 10);
  assert.equal(service.get(relationship.id).breakDistance, 15, "A rejected break-distance reduction must not corrupt relationship geometry.");

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

test("non-GM terminal checkpoint synchronization trusts a primary-GM full-subpath receipt", async () => {
  const player = { id: "player-terminal-subpath", isGM: false, active: true };
  game.users.set(player.id, player);

  const scene = {
    id: "scene-terminal-subpath-receipt",
    tokens: new FakeCollection(),
    moveCalls: [],
    grid: null,
    async moveTokens(instructions, options) {
      assertGeneratedMovementInstructions(instructions);
      this.moveCalls.push({ instructions: structuredClone(instructions), options: structuredClone(options) });
      return Object.fromEntries(Object.keys(instructions).map((id) => [id, true]));
    }
  };
  game.scenes.set(scene.id, scene);

  const leader = new FakeTokenDocument({
    uuid: "Scene.scene-terminal-subpath-receipt.Token.leader",
    id: "leader",
    scene,
    owner: true
  });
  Object.assign(leader, { x: 200, y: 200, elevation: 0, name: "Leader" });
  const follower = new FakeTokenDocument({
    uuid: "Scene.scene-terminal-subpath-receipt.Token.follower",
    id: "follower",
    scene
  });
  Object.assign(follower, { x: 0, y: -100, elevation: 0, name: "Follower", object: null });
  scene.tokens.set(leader.id, leader);
  scene.tokens.set(follower.id, follower);

  const documents = new Map([[leader.uuid, leader], [follower.uuid, follower]]);
  globalThis.fromUuid = async (uuid) => documents.get(uuid) ?? null;

  const relationship = {
    id: "relationship-terminal-subpath-receipt",
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
  const consumers = [];
  const fakeMovement = {
    registerConsumer(config) { consumers.push(config); return () => {}; },
    createOperationOptions(metadata) { return { actionEffects5e: { generatedBy: "action-effects-5e", ...metadata } }; },
    registerMovementContext() { return () => {}; }
  };

  const { RelationshipMovementService } = await import("../scripts/relationships/relationship-movement-service.js");
  const service = new RelationshipMovementService({ socket: fakeSocket, relationships: fakeRelationships, movement: fakeMovement });
  service.initialize();

  const receiptConsumer = consumers.find((consumer) => (
    consumer.execution === "primaryGM"
    && consumer.tokenUuids[0] === leader.uuid
  ));
  assert.ok(receiptConsumer);

  const subpathId = "receipt-subpath-id";
  const toJsonTransaction = (data) => ({
    ...data,
    metadata: {},
    toJSON() { return structuredClone({ ...this, toJSON: undefined }); }
  });

  receiptConsumer.handler(toJsonTransaction({
    movementId: "receipt-first-leg",
    subpathId,
    subjectUuid: leader.uuid,
    sceneId: scene.id,
    userId: player.id,
    origin: { x: 0, y: 0, elevation: 0 },
    destination: { x: 200, y: 0, elevation: 0 },
    path: [
      { x: 100, y: 0, elevation: 0 },
      { x: 200, y: 0, elevation: 0, checkpoint: true }
    ],
    pathType: PATH_TYPES.TRAVERSE,
    movementMode: "walk",
    sourceUuid: null,
    generatedBy: "external-module"
  }), {
    movement: {
      pending: { waypoints: [{ x: 200, y: 200, elevation: 0, subpathId, checkpoint: true }] }
    }
  });
  assert.equal(service.getStats().movementReceipts, 0, "Non-terminal legs must not create GM synchronization receipts.");

  const terminalTransaction = toJsonTransaction({
    movementId: "receipt-terminal-leg",
    subpathId,
    subjectUuid: leader.uuid,
    sceneId: scene.id,
    userId: player.id,
    origin: { x: 200, y: 0, elevation: 0 },
    destination: { x: 200, y: 200, elevation: 0 },
    path: [
      { x: 200, y: 100, elevation: 0 },
      { x: 200, y: 200, elevation: 0, checkpoint: true }
    ],
    pathType: PATH_TYPES.TRAVERSE,
    movementMode: "walk",
    sourceUuid: null,
    generatedBy: "external-module"
  });
  receiptConsumer.handler(terminalTransaction, {
    movement: {
      id: "receipt-terminal-leg",
      history: {
        recorded: { waypoints: [] },
        unrecorded: {
          waypoints: [
            { x: 0, y: 0, elevation: 0, subpathId, checkpoint: true },
            { x: 100, y: 0, elevation: 0, subpathId, checkpoint: false },
            { x: 200, y: 0, elevation: 0, subpathId, explicit: true, checkpoint: true }
          ]
        }
      },
      passed: {
        waypoints: [
          { x: 200, y: 100, elevation: 0, subpathId, checkpoint: false },
          { x: 200, y: 200, elevation: 0, subpathId, checkpoint: true }
        ]
      },
      pending: { waypoints: [] }
    }
  });
  assert.equal(service.getStats().movementReceipts, 1);

  const result = await handlers.get("relationships.syncFollowers")({
    requestId: "request-terminal-subpath-receipt",
    requestingUserId: player.id,
    sceneId: scene.id,
    leaderUuid: leader.uuid,
    originalMovementId: "receipt-terminal-leg",
    // Deliberately forged values. The primary-GM full-subpath receipt must win.
    origin: { x: 999, y: 999, elevation: 99 },
    destination: { x: 999, y: 999, elevation: 99 },
    waypoints: [{ x: 999, y: 999, elevation: 99 }]
  });

  assert.equal(result.completed, true);
  assert.deepEqual(scene.moveCalls[0].instructions.follower.waypoints, [
    { x: 0, y: 0, elevation: 0, checkpoint: true },
    { x: 100, y: 0, elevation: 0, checkpoint: false },
    { x: 200, y: 0, elevation: 0, explicit: true, checkpoint: true },
    { x: 200, y: 100, elevation: 0, checkpoint: true }
  ]);
  assert.equal(service.getStats().movementReceipts, 0, "The trusted terminal receipt should be consumed after synchronization.");

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

test("partial coordinated movement restores completed and partially constrained failed tokens", async () => {
  const scene = {
    id: "scene-rollback",
    tokens: new FakeCollection(),
    moveCalls: [],
    async moveTokens(instructions, options) {
      assertGeneratedMovementInstructions(instructions);
      this.moveCalls.push({ instructions: structuredClone(instructions), options: structuredClone(options) });

      if (this.moveCalls.length === 1) {
        // Reproduce Foundry's live constrained-movement behavior: the leader can
        // complete while the follower is reported false after already advancing
        // partway into the blocked path.
        Object.assign(leader, { x: 200, y: 0, elevation: 0 });
        Object.assign(follower, { x: 150, y: 0, elevation: 0 });
        return { leader: true, follower: false };
      }

      for (const [id, instruction] of Object.entries(instructions)) {
        const token = this.tokens.get(id);
        const destination = instruction.waypoints?.at?.(-1) ?? instruction.destination;
        if (token && destination) {
          Object.assign(token, {
            x: destination.x,
            y: destination.y,
            elevation: destination.elevation
          });
        }
      }
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
  assert.deepEqual(result.failedIds, ["follower"]);
  assert.equal(scene.moveCalls.length, 2);
  assert.deepEqual(Object.keys(scene.moveCalls[1].instructions).sort(), ["follower", "leader"]);
  assert.equal(scene.moveCalls[1].instructions.leader.destination.checkpoint, true);
  assert.equal(scene.moveCalls[1].instructions.follower.destination.checkpoint, true);
  assert.deepEqual(
    {
      x: scene.moveCalls[1].instructions.leader.destination.x,
      y: scene.moveCalls[1].instructions.leader.destination.y
    },
    { x: 0, y: 0 }
  );
  assert.deepEqual(
    {
      x: scene.moveCalls[1].instructions.follower.destination.x,
      y: scene.moveCalls[1].instructions.follower.destination.y
    },
    { x: 100, y: 0 }
  );
  assert.deepEqual({ x: leader.x, y: leader.y }, { x: 0, y: 0 });
  assert.deepEqual({ x: follower.x, y: follower.y }, { x: 100, y: 0 });
  assert.equal(scene.moveCalls[1].options.constrainOptions.ignoreWalls, true);
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

test("adjacent follower treats Foundry same-space elevation interpolation as one planar destination", async () => {
  const { RelationshipMovementPlanner } = await import("../scripts/relationships/relationship-movement-planner.js");

  const translated = RelationshipMovementPlanner.translateWaypoints({
    leader: { x: 2800, y: 2600, elevation: 0 },
    follower: { x: 2700, y: 2600, elevation: 0 },
    relationship: {
      attachmentMode: "adjacentFollower",
      followElevation: true
    },
    waypoints: [
      { x: 2900, y: 2600, elevation: 5, action: "walk", checkpoint: false },
      { x: 2900, y: 2600, elevation: 10, action: "walk", checkpoint: true }
    ],
    pathType: PATH_TYPES.TRAVERSE,
    grid: null
  });

  assert.deepEqual(translated.map(({ x, y, elevation, checkpoint }) => ({ x, y, elevation, checkpoint })), [
    { x: 2800, y: 2600, elevation: 0, checkpoint: true }
  ]);
});

test("adjacent follower preserves planar offset during pure vertical movement while following elevation", async () => {
  const { RelationshipMovementPlanner } = await import("../scripts/relationships/relationship-movement-planner.js");

  const translated = RelationshipMovementPlanner.translateWaypoints({
    leader: { x: 1000, y: 1000, elevation: 0 },
    follower: { x: 900, y: 1000, elevation: 0 },
    relationship: {
      attachmentMode: "adjacentFollower",
      followElevation: true
    },
    waypoints: [
      { x: 1000, y: 1000, elevation: 5, action: "walk", checkpoint: false },
      { x: 1000, y: 1000, elevation: 10, action: "walk", checkpoint: true }
    ],
    pathType: PATH_TYPES.TRAVERSE,
    grid: null
  });

  assert.deepEqual(translated.map(({ x, y, elevation, checkpoint }) => ({ x, y, elevation, checkpoint })), [
    { x: 900, y: 1000, elevation: 10, checkpoint: true }
  ]);
});

test("external elevation synchronization waits for movement.finished and animation.ended before validating the leader", async () => {
  const scene = {
    id: "scene-external-elevation-finished",
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
    uuid: "Scene.scene-external-elevation-finished.Token.leader",
    id: "leader",
    scene
  });
  Object.assign(leader, { x: 2800, y: 2600, elevation: 0, name: "Leader" });
  const follower = new FakeTokenDocument({
    uuid: "Scene.scene-external-elevation-finished.Token.follower",
    id: "follower",
    scene
  });
  Object.assign(follower, { x: 2700, y: 2600, elevation: 0, name: "Follower", object: null });
  scene.tokens.set(leader.id, leader);
  scene.tokens.set(follower.id, follower);

  const documents = new Map([
    [leader.uuid, leader],
    [follower.uuid, follower]
  ]);
  globalThis.fromUuid = async (uuid) => documents.get(uuid) ?? null;

  const relationship = {
    id: "relationship-external-elevation-finished",
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
  const service = new RelationshipMovementService({ socket: fakeSocket, relationships: fakeRelationships, movement: fakeMovement });
  service.initialize();

  const leaderConsumer = consumers.find((consumer) => (
    consumer.execution === "initiator"
    && consumer.tokenUuids[0] === leader.uuid
  ));
  assert.ok(leaderConsumer);

  let finishMovement;
  let finishAnimation;
  const finished = new Promise((resolve) => { finishMovement = resolve; });
  const animationEnded = new Promise((resolve) => { finishAnimation = resolve; });
  const transaction = {
    subjectUuid: leader.uuid,
    movementId: "elevation-move",
    subpathId: "elevation-move",
    phase: MOVEMENT_PHASES.AFTER,
    method: "api",
    pathType: PATH_TYPES.TRAVERSE,
    movementMode: "walk",
    sceneId: scene.id,
    userId: gmUser.id,
    origin: { x: 2800, y: 2600, elevation: 0 },
    destination: { x: 2900, y: 2600, elevation: 10 },
    path: [
      { x: 2900, y: 2600, elevation: 5, action: "walk", checkpoint: false },
      { x: 2900, y: 2600, elevation: 10, action: "walk", checkpoint: true }
    ],
    sourceUuid: null,
    generatedBy: "external-module",
    metadata: {}
  };

  const synchronization = leaderConsumer.handler(transaction, {
    movement: {
      finished,
      animation: { ended: animationEnded }
    }
  });
  await Promise.resolve();
  assert.equal(scene.moveCalls.length, 0, "Follower synchronization must wait for logical movement completion.");

  // Live Foundry v14 can resolve movement.finished while the public TokenDocument
  // is still animated at its origin even though the movement destination is final.
  finishMovement(true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(scene.moveCalls.length, 0, "Follower synchronization must also wait for animation.ended.");
  assert.deepEqual({ x: leader.x, y: leader.y, elevation: leader.elevation }, { x: 2800, y: 2600, elevation: 0 });

  Object.assign(leader, { x: 2900, y: 2600, elevation: 10 });
  finishAnimation();
  assert.equal(await synchronization, true);

  assert.equal(scene.moveCalls.length, 1);
  assert.deepEqual(scene.moveCalls[0].instructions.follower.waypoints, [
    { x: 2800, y: 2600, elevation: 0, checkpoint: true }
  ]);
  assert.equal(service.getStats().queuedExternalSyncs, 0);

  service.shutdown();
  delete globalThis.ui;
  game.scenes.delete(scene.id);
});

test("terminal external checkpoint operation reconstructs the full subpath and synchronizes exactly once", async () => {
  const scene = {
    id: "scene-external-subpath-terminal",
    tokens: new FakeCollection(),
    moveCalls: [],
    grid: null,
    async moveTokens(instructions, options) {
      assertGeneratedMovementInstructions(instructions);
      this.moveCalls.push({ instructions: structuredClone(instructions), options: structuredClone(options) });
      return Object.fromEntries(Object.keys(instructions).map((id) => [id, true]));
    }
  };
  game.scenes.set(scene.id, scene);

  const leader = new FakeTokenDocument({ uuid: "Scene.scene-external-subpath-terminal.Token.leader", id: "leader", scene });
  Object.assign(leader, { x: 0, y: 0, elevation: 0, name: "Leader" });
  const follower = new FakeTokenDocument({ uuid: "Scene.scene-external-subpath-terminal.Token.follower", id: "follower", scene });
  Object.assign(follower, { x: 0, y: -100, elevation: 0, name: "Follower", object: null });
  scene.tokens.set(leader.id, leader);
  scene.tokens.set(follower.id, follower);

  const documents = new Map([[leader.uuid, leader], [follower.uuid, follower]]);
  globalThis.fromUuid = async (uuid) => documents.get(uuid) ?? null;

  const relationship = {
    id: "relationship-external-subpath-terminal",
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
  const consumers = [];
  const fakeMovement = {
    registerConsumer(config) { consumers.push(config); return () => {}; },
    createOperationOptions(metadata) { return { actionEffects5e: { generatedBy: "action-effects-5e", ...metadata } }; },
    registerMovementContext() { return () => {}; }
  };
  globalThis.ui = { notifications: { warn() {}, error() {} } };

  const { RelationshipMovementService } = await import("../scripts/relationships/relationship-movement-service.js");
  const service = new RelationshipMovementService({ socket: fakeSocket, relationships: fakeRelationships, movement: fakeMovement });
  service.initialize();
  const leaderConsumer = consumers.find((consumer) => consumer.execution === "initiator" && consumer.tokenUuids[0] === leader.uuid);
  assert.ok(leaderConsumer);

  const subpathId = "stable-subpath-id";
  const firstTransaction = {
    subjectUuid: leader.uuid,
    movementId: "first-leg-id",
    subpathId,
    phase: MOVEMENT_PHASES.AFTER,
    method: "api",
    pathType: PATH_TYPES.TRAVERSE,
    movementMode: "walk",
    sceneId: scene.id,
    userId: gmUser.id,
    origin: { x: 0, y: 0, elevation: 0 },
    destination: { x: 200, y: 0, elevation: 0 },
    path: [
      { x: 100, y: 0, elevation: 0, action: "walk", checkpoint: false },
      { x: 200, y: 0, elevation: 0, action: "walk", explicit: true, checkpoint: true },
      { x: 200, y: 100, elevation: 0, action: "walk", checkpoint: false },
      { x: 200, y: 200, elevation: 0, action: "walk", checkpoint: true }
    ],
    sourceUuid: null,
    generatedBy: "external-module",
    metadata: {}
  };

  const firstResult = await leaderConsumer.handler(firstTransaction, {
    movement: {
      id: "first-leg-id",
      pending: {
        waypoints: [
          { x: 200, y: 100, elevation: 0, subpathId, checkpoint: false },
          { x: 200, y: 200, elevation: 0, subpathId, checkpoint: true }
        ]
      }
    }
  });
  assert.equal(firstResult, true);
  assert.equal(scene.moveCalls.length, 0, "A non-terminal checkpoint leg must not synchronize followers.");
  assert.equal(service.getStats().queuedExternalSyncs, 0);

  Object.assign(leader, { x: 200, y: 200, elevation: 0 });
  const terminalTransaction = {
    ...firstTransaction,
    movementId: "terminal-leg-id",
    origin: { x: 200, y: 0, elevation: 0 },
    destination: { x: 200, y: 200, elevation: 0 },
    path: [
      { x: 200, y: 100, elevation: 0, action: "walk", checkpoint: false },
      { x: 200, y: 200, elevation: 0, action: "walk", checkpoint: true }
    ]
  };

  const terminalMovement = {
    id: "terminal-leg-id",
    origin: { x: 200, y: 0, elevation: 0, subpathId },
    destination: { x: 200, y: 200, elevation: 0, subpathId },
    history: {
      recorded: { waypoints: [] },
      unrecorded: {
        waypoints: [
          { x: 0, y: 0, elevation: 0, subpathId, checkpoint: true },
          { x: 100, y: 0, elevation: 0, subpathId, checkpoint: false },
          { x: 200, y: 0, elevation: 0, subpathId, explicit: true, checkpoint: true }
        ]
      }
    },
    passed: {
      waypoints: [
        { x: 200, y: 100, elevation: 0, subpathId, checkpoint: false },
        { x: 200, y: 200, elevation: 0, subpathId, checkpoint: true }
      ]
    },
    pending: { waypoints: [] }
  };

  assert.equal(await leaderConsumer.handler(terminalTransaction, { movement: terminalMovement }), true);
  assert.equal(scene.moveCalls.length, 1, "Only the terminal operation should synchronize followers.");
  assert.deepEqual(scene.moveCalls[0].instructions.follower.waypoints, [
    { x: 0, y: 0, elevation: 0, checkpoint: true },
    { x: 100, y: 0, elevation: 0, checkpoint: false },
    { x: 200, y: 0, elevation: 0, explicit: true, checkpoint: true },
    { x: 200, y: 100, elevation: 0, checkpoint: true }
  ]);
  assert.equal(service.getStats().queuedExternalSyncs, 0);

  service.shutdown();
  delete globalThis.ui;
  game.scenes.delete(scene.id);
});

test("full subpath extraction preserves multiple checkpoint legs from Foundry history", async () => {
  const { RelationshipMovementPlanner } = await import("../scripts/relationships/relationship-movement-planner.js");
  const subpathId = "multi-checkpoint-subpath";
  const movement = {
    id: "terminal-id",
    origin: { x: 200, y: 100, elevation: 0, subpathId },
    destination: { x: 300, y: 200, elevation: 0, subpathId },
    history: {
      recorded: { waypoints: [] },
      unrecorded: {
        waypoints: [
          { x: 0, y: 0, elevation: 0, subpathId, checkpoint: true },
          { x: 100, y: 0, elevation: 0, subpathId, checkpoint: false },
          { x: 200, y: 0, elevation: 0, subpathId, explicit: true, checkpoint: true },
          { x: 200, y: 100, elevation: 0, subpathId, explicit: true, checkpoint: true }
        ]
      }
    },
    passed: {
      waypoints: [
        { x: 300, y: 100, elevation: 0, subpathId, checkpoint: false },
        { x: 300, y: 200, elevation: 0, subpathId, explicit: true, checkpoint: true }
      ]
    },
    pending: { waypoints: [] }
  };

  const route = RelationshipMovementPlanner.extractFullSubpathRoute(movement, {
    subpathId,
    origin: { x: 200, y: 100, elevation: 0 },
    destination: { x: 300, y: 200, elevation: 0 },
    path: movement.passed.waypoints
  });

  assert.equal(route.terminal, true);
  assert.deepEqual(route.origin, { x: 0, y: 0, elevation: 0 });
  assert.deepEqual(route.waypoints, [
    { x: 100, y: 0, elevation: 0, checkpoint: false },
    { x: 200, y: 0, elevation: 0, explicit: true, checkpoint: true },
    { x: 200, y: 100, elevation: 0, explicit: true, checkpoint: true },
    { x: 300, y: 100, elevation: 0, checkpoint: false },
    { x: 300, y: 200, elevation: 0, explicit: true, checkpoint: true }
  ]);
  assert.deepEqual(route.destination, { x: 300, y: 200, elevation: 0 });
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

  let finishTeleportMovement;
  let finishTeleportAnimation;
  const teleportFinished = new Promise((resolve) => { finishTeleportMovement = resolve; });
  const teleportAnimationEnded = new Promise((resolve) => { finishTeleportAnimation = resolve; });

  const afterResultPromise = followerConsumer.handler({
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
  }, {
    movement: {
      finished: teleportFinished,
      animation: { ended: teleportAnimationEnded }
    }
  });

  await Promise.resolve();
  assert.notEqual(relationship, null, "Follower teleport relationship must remain until movement completion.");
  finishTeleportMovement(true);
  await Promise.resolve();
  await Promise.resolve();
  assert.notEqual(relationship, null, "Follower teleport relationship must remain until animation settlement.");

  finishTeleportAnimation();
  const afterResult = await afterResultPromise;
  assert.equal(afterResult, true);
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

test("instruction waypoint extraction resolves partial Foundry waypoints without losing checkpoints", async () => {
  const { RelationshipMovementPlanner } = await import("../scripts/relationships/relationship-movement-planner.js");
  const waypoints = RelationshipMovementPlanner.extractInstructionWaypoints({
    waypoints: [
      { x: 100, action: "walk" },
      { elevation: 5, explicit: true },
      { y: 100, checkpoint: true },
      { elevation: 10 }
    ]
  }, { x: 0, y: 0, elevation: 0 });

  assert.deepEqual(waypoints.map(({ x, y, elevation, checkpoint, explicit }) => ({
    x, y, elevation, checkpoint: checkpoint ?? false, explicit: explicit ?? false
  })), [
    { x: 100, y: 0, elevation: 0, checkpoint: false, explicit: false },
    { x: 100, y: 0, elevation: 5, checkpoint: false, explicit: true },
    { x: 100, y: 100, elevation: 5, checkpoint: true, explicit: false },
    { x: 100, y: 100, elevation: 10, checkpoint: true, explicit: false }
  ]);
});

test("GM external API leader movement is selectively augmented into one simultaneous relationship move", async () => {
  const previousLibWrapper = globalThis.libWrapper;
  const previousUi = globalThis.ui;
  const previousFromUuid = globalThis.fromUuid;
  const registrations = [];
  globalThis.libWrapper = {
    register(moduleId, target, fn, type) {
      registrations.push({ moduleId, target, fn, type });
    },
    unregister() {}
  };
  globalThis.ui = { notifications: { warn() {}, error() {} } };

  const scene = {
    id: "scene-wrapper-coordinated",
    grid: { isGridless: true },
    tokens: new FakeCollection()
  };
  const leader = new FakeTokenDocument({
    uuid: "Scene.scene-wrapper-coordinated.Token.leader",
    id: "leader",
    scene
  });
  Object.assign(leader, { x: 0, y: 0, elevation: 0, name: "Leader", object: null });
  const follower = new FakeTokenDocument({
    uuid: "Scene.scene-wrapper-coordinated.Token.follower",
    id: "follower",
    scene
  });
  Object.assign(follower, { x: -100, y: 0, elevation: 0, name: "Follower", object: null });
  scene.tokens.set(leader.id, leader);
  scene.tokens.set(follower.id, follower);
  globalThis.fromUuid = async (uuid) => uuid === leader.uuid ? leader : uuid === follower.uuid ? follower : null;

  const relationship = {
    id: "relationship-wrapper-coordinated",
    sceneId: scene.id,
    leaderUuid: leader.uuid,
    followerUuid: follower.uuid,
    attachmentMode: "adjacentFollower",
    followerCanSelfMove: false,
    followElevation: true,
    followRotation: false,
    teleportPolicy: "detach",
    collisionPolicy: "stopGroup",
    // Omit coordinationPolicy to verify persisted pre-v0.2.11 relationships
    // default to coordinated behavior at runtime.
  };
  const fakeRelationships = {
    list: () => [relationship],
    getForLeader: (uuid) => uuid === leader.uuid ? [relationship] : [],
    getForFollower: (uuid) => uuid === follower.uuid ? [relationship] : [],
    async removeManyAsGM() { return 0; }
  };
  const registeredContexts = [];
  const fakeMovement = {
    registerConsumer() { return () => {}; },
    createOperationOptions(metadata) { return { actionEffects5e: metadata }; },
    registerMovementContext(id, options) {
      registeredContexts.push({ id, options });
      return () => {};
    }
  };
  const fakeSocket = { register() {}, async executeAsGM() { throw new Error("Wrapper test must not use post-sync Socketlib."); } };

  const { RelationshipMovementService } = await import("../scripts/relationships/relationship-movement-service.js");
  const service = new RelationshipMovementService({ socket: fakeSocket, relationships: fakeRelationships, movement: fakeMovement });
  service.initialize();

  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].moduleId, "action-effects-5e");
  assert.equal(registrations[0].target, "foundry.documents.Scene.prototype.moveTokens");
  assert.equal(registrations[0].type, "MIXED");

  let wrappedCalls = 0;
  let captured = null;
  const wrapped = async (instructions, options) => {
    wrappedCalls += 1;
    captured = { instructions: structuredClone(instructions), options: structuredClone(options) };
    assertGeneratedMovementInstructions(instructions);
    return Object.fromEntries(Object.keys(instructions).map((id) => [id, true]));
  };

  const result = await registrations[0].fn.call(scene, wrapped, {
    leader: {
      id: "ExternalMove0001",
      waypoints: [
        { x: 100, y: 0, elevation: 0, action: "walk", checkpoint: false },
        { x: 200, y: 0, elevation: 0, action: "walk", explicit: true, checkpoint: true },
        { x: 200, y: 100, elevation: 5, action: "walk", checkpoint: false },
        { x: 200, y: 200, elevation: 10, action: "walk", checkpoint: true }
      ],
      method: "api",
      showRuler: false
    }
  }, {
    method: "api",
    showRuler: false,
    pan: false
  });

  assert.equal(wrappedCalls, 1, "Leader and follower must enter one Scene.moveTokens operation.");
  assert.deepEqual(Object.keys(captured.instructions).sort(), ["follower", "leader"]);
  assert.deepEqual(captured.instructions.follower.waypoints.map(({ x, y, elevation }) => ({ x, y, elevation })), [
    { x: 0, y: 0, elevation: 0 },
    { x: 100, y: 0, elevation: 0 },
    { x: 200, y: 0, elevation: 0 },
    { x: 200, y: 100, elevation: 5 }
  ]);
  assert.equal(captured.instructions.follower.waypoints[0].checkpoint, true);
  assert.equal(captured.instructions.follower.waypoints.at(-1).checkpoint, true);
  assert.equal(captured.options.actionEffects5e.relationshipMovement, true);
  assert.equal(captured.options.actionEffects5e.coordinatedExternalMovement, true);
  assert.equal(captured.options.actionEffects5e.generatedBy, "action-effects-5e");
  assert.equal(registeredContexts.length, 2);
  assert.deepEqual(result, { leader: true }, "The external caller must receive only its original result key.");

  service.shutdown();
  globalThis.libWrapper = previousLibWrapper;
  globalThis.ui = previousUi;
  globalThis.fromUuid = previousFromUuid;
});

test("Scene.moveTokens integration leaves unrelated and post-sync API movements untouched", async () => {
  const previousLibWrapper = globalThis.libWrapper;
  const previousFromUuid = globalThis.fromUuid;
  const registrations = [];
  globalThis.libWrapper = {
    register(_moduleId, _target, fn) { registrations.push(fn); },
    unregister() {}
  };

  const scene = { id: "scene-wrapper-passthrough", grid: { isGridless: true }, tokens: new FakeCollection() };
  const unrelated = new FakeTokenDocument({
    uuid: "Scene.scene-wrapper-passthrough.Token.unrelated",
    id: "unrelated",
    scene
  });
  Object.assign(unrelated, { x: 0, y: 0, elevation: 0 });
  const leader = new FakeTokenDocument({
    uuid: "Scene.scene-wrapper-passthrough.Token.leader",
    id: "leader",
    scene
  });
  Object.assign(leader, { x: 0, y: 0, elevation: 0 });
  const follower = new FakeTokenDocument({
    uuid: "Scene.scene-wrapper-passthrough.Token.follower",
    id: "follower",
    scene
  });
  Object.assign(follower, { x: -100, y: 0, elevation: 0 });
  scene.tokens.set(unrelated.id, unrelated);
  scene.tokens.set(leader.id, leader);
  scene.tokens.set(follower.id, follower);
  globalThis.fromUuid = async (uuid) => [unrelated, leader, follower].find((token) => token.uuid === uuid) ?? null;

  const relationship = {
    id: "relationship-post-sync",
    leaderUuid: leader.uuid,
    followerUuid: follower.uuid,
    coordinationPolicy: RELATIONSHIP_COORDINATION_POLICIES.POST_SYNC
  };
  const fakeRelationships = {
    list: () => [relationship],
    getForLeader: (uuid) => uuid === leader.uuid ? [relationship] : [],
    getForFollower: (uuid) => uuid === follower.uuid ? [relationship] : []
  };
  const fakeMovement = {
    registerConsumer() { return () => {}; },
    createOperationOptions(metadata) { return { actionEffects5e: metadata }; },
    registerMovementContext() { return () => {}; }
  };
  const fakeSocket = { register() {} };
  const { RelationshipMovementService } = await import("../scripts/relationships/relationship-movement-service.js");
  const service = new RelationshipMovementService({ socket: fakeSocket, relationships: fakeRelationships, movement: fakeMovement });
  service.initialize();

  let captured = [];
  const wrapped = async (instructions, options) => {
    captured.push({ instructions, options });
    return Object.fromEntries(Object.keys(instructions).map((id) => [id, true]));
  };

  const unrelatedInstructions = { unrelated: { destination: { x: 100, y: 0, elevation: 0 }, method: "api" } };
  await registrations[0].call(scene, wrapped, unrelatedInstructions, { method: "api" });
  assert.equal(captured[0].instructions, unrelatedInstructions, "Unrelated API instructions must be passed through by identity.");

  const leaderInstructions = { leader: { destination: { x: 100, y: 0, elevation: 0 }, method: "api" } };
  await registrations[0].call(scene, wrapped, leaderInstructions, { method: "api" });
  assert.equal(captured[1].instructions, leaderInstructions, "postSync policy must preserve the external leader call unchanged.");

  const followerInstructions = { follower: { destination: { x: 0, y: 100, elevation: 0 }, method: "api" } };
  await registrations[0].call(scene, wrapped, followerInstructions, { method: "api" });
  assert.equal(captured[2].instructions, followerInstructions, "Follower-only API movement must not be treated as leader coordination.");

  const multiTokenInstructions = {
    leader: { destination: { x: 200, y: 0, elevation: 0 }, method: "api" },
    unrelated: { destination: { x: 200, y: 100, elevation: 0 }, method: "api" }
  };
  await registrations[0].call(scene, wrapped, multiTokenInstructions, { method: "api" });
  assert.equal(captured[3].instructions, multiTokenInstructions, "Multi-token external API calls must remain untouched.");

  service.shutdown();
  globalThis.libWrapper = previousLibWrapper;
  globalThis.fromUuid = previousFromUuid;
});

test("Scene.moveTokens integration does not recurse into AE5E-generated relationship movement", async () => {
  const previousLibWrapper = globalThis.libWrapper;
  const registrations = [];
  globalThis.libWrapper = {
    register(_moduleId, _target, fn) { registrations.push(fn); },
    unregister() {}
  };
  const scene = { id: "scene-wrapper-recursion", tokens: new FakeCollection() };
  const leader = new FakeTokenDocument({ uuid: "Scene.scene-wrapper-recursion.Token.leader", id: "leader", scene });
  Object.assign(leader, { x: 0, y: 0, elevation: 0 });
  scene.tokens.set(leader.id, leader);
  const relationship = { id: "relationship-recursion", leaderUuid: leader.uuid, followerUuid: "Scene.scene-wrapper-recursion.Token.follower" };
  const fakeRelationships = {
    list: () => [relationship],
    getForLeader: (uuid) => uuid === leader.uuid ? [relationship] : [],
    getForFollower: () => []
  };
  const fakeMovement = {
    registerConsumer() { return () => {}; },
    createOperationOptions(metadata) { return { actionEffects5e: metadata }; },
    registerMovementContext() { return () => {}; }
  };
  const fakeSocket = { register() {} };
  const { RelationshipMovementService } = await import("../scripts/relationships/relationship-movement-service.js");
  const service = new RelationshipMovementService({ socket: fakeSocket, relationships: fakeRelationships, movement: fakeMovement });
  service.initialize();

  const instructions = { leader: { destination: { x: 100, y: 0, elevation: 0, checkpoint: true }, method: "api" } };
  const options = {
    method: "api",
    actionEffects5e: { relationshipMovement: true, generatedBy: "action-effects-5e" }
  };
  let called = 0;
  await registrations[0].call(scene, async (receivedInstructions, receivedOptions) => {
    called += 1;
    assert.equal(receivedInstructions, instructions);
    assert.equal(receivedOptions, options);
    return { leader: true };
  }, instructions, options);
  assert.equal(called, 1);

  service.shutdown();
  globalThis.libWrapper = previousLibWrapper;
});

test("relationship movement settlement helper waits for active token animation promises", async () => {
  const previousFromUuid = globalThis.fromUuid;
  const scene = { id: "scene-settlement-helper" };
  let resolveAnimation;
  const animationPromise = new Promise((resolve) => { resolveAnimation = resolve; });
  const leader = new FakeTokenDocument({ uuid: "Scene.scene-settlement-helper.Token.leader", id: "leader", scene });
  Object.assign(leader, { object: { movementAnimationPromise: animationPromise } });
  const follower = new FakeTokenDocument({ uuid: "Scene.scene-settlement-helper.Token.follower", id: "follower", scene });
  Object.assign(follower, { object: { movementAnimationPromise: null } });
  globalThis.fromUuid = async (uuid) => uuid === leader.uuid ? leader : uuid === follower.uuid ? follower : null;

  const relationship = { id: "relationship-settlement-helper", leaderUuid: leader.uuid, followerUuid: follower.uuid };
  const fakeRelationships = {
    list: () => [relationship],
    getForLeader: (uuid) => uuid === leader.uuid ? [relationship] : [],
    getForFollower: (uuid) => uuid === follower.uuid ? [relationship] : []
  };
  const fakeMovement = { registerConsumer() { return () => {}; } };
  const fakeSocket = { register() {} };
  const { RelationshipMovementService } = await import("../scripts/relationships/relationship-movement-service.js");
  const service = new RelationshipMovementService({ socket: fakeSocket, relationships: fakeRelationships, movement: fakeMovement });

  let settled = false;
  const waiting = service.waitForMovementSettled({ leaderUuid: leader.uuid, timeoutMs: 500, pollMs: 5 }).then(() => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(settled, false);
  leader.object.movementAnimationPromise = null;
  resolveAnimation();
  await waiting;
  assert.equal(settled, true);

  globalThis.fromUuid = previousFromUuid;
});

test("player external API relationship movement is coordinated through the GM without running the original leader-only call", async () => {
  const previousLibWrapper = globalThis.libWrapper;
  const previousFromUuid = globalThis.fromUuid;
  const previousUser = game.user;
  const previousUi = globalThis.ui;
  const player = { id: "player-wrapper", isGM: false, active: true };
  game.users.set(player.id, player);
  game.user = player;
  globalThis.ui = { notifications: { warn() {}, error() {} } };

  const registrations = [];
  globalThis.libWrapper = {
    register(_moduleId, _target, fn) { registrations.push(fn); },
    unregister() {}
  };

  const scene = { id: "scene-player-wrapper", grid: { isGridless: true }, tokens: new FakeCollection() };
  const leader = new FakeTokenDocument({ uuid: "Scene.scene-player-wrapper.Token.leader", id: "leader", scene, owner: true });
  Object.assign(leader, { x: 0, y: 0, elevation: 0 });
  const follower = new FakeTokenDocument({ uuid: "Scene.scene-player-wrapper.Token.follower", id: "follower", scene });
  Object.assign(follower, { x: -100, y: 0, elevation: 0 });
  scene.tokens.set(leader.id, leader);
  scene.tokens.set(follower.id, follower);
  globalThis.fromUuid = async (uuid) => uuid === leader.uuid ? leader : uuid === follower.uuid ? follower : null;

  const relationship = {
    id: "relationship-player-wrapper",
    leaderUuid: leader.uuid,
    followerUuid: follower.uuid,
    attachmentMode: "adjacentFollower",
    coordinationPolicy: RELATIONSHIP_COORDINATION_POLICIES.COORDINATED
  };
  const fakeRelationships = {
    list: () => [relationship],
    getForLeader: (uuid) => uuid === leader.uuid ? [relationship] : [],
    getForFollower: (uuid) => uuid === follower.uuid ? [relationship] : []
  };
  const socketCalls = [];
  const fakeSocket = {
    register() {},
    async executeAsGM(name, request) {
      socketCalls.push({ name, request: structuredClone(request) });
      return { completed: true, results: { leader: true, follower: true } };
    }
  };
  const fakeMovement = {
    registerConsumer() { return () => {}; },
    createOperationOptions(metadata) { return { actionEffects5e: metadata }; },
    registerMovementContext() { return () => {}; }
  };
  const { RelationshipMovementService } = await import("../scripts/relationships/relationship-movement-service.js");
  const service = new RelationshipMovementService({ socket: fakeSocket, relationships: fakeRelationships, movement: fakeMovement });
  service.initialize();

  let wrappedCalls = 0;
  const result = await registrations[0].call(scene, async () => {
    wrappedCalls += 1;
    return { leader: true };
  }, {
    leader: {
      id: "PlayerMove000001",
      destination: { x: 100, y: 0, elevation: 0, action: "walk", checkpoint: true },
      method: "api"
    }
  }, { method: "api" });

  assert.equal(wrappedCalls, 0, "The player's original leader-only Scene.moveTokens call must be replaced, not executed.");
  assert.equal(socketCalls.length, 1);
  assert.equal(socketCalls[0].name, "relationships.moveGroup");
  assert.equal(socketCalls[0].request.requestingUserId, player.id);
  assert.equal(socketCalls[0].request.leaderUuid, leader.uuid);
  assert.deepEqual(socketCalls[0].request.waypoints.map(({ x, y, elevation }) => ({ x, y, elevation })), [
    { x: 100, y: 0, elevation: 0 }
  ]);
  assert.deepEqual(result, { leader: true });

  service.shutdown();
  globalThis.libWrapper = previousLibWrapper;
  globalThis.fromUuid = previousFromUuid;
  globalThis.ui = previousUi;
  game.user = previousUser;
  game.users.delete(player.id);
});

test("teleport and mixed-payload API movement stay on the compatibility fallback path", async () => {
  const previousLibWrapper = globalThis.libWrapper;
  const registrations = [];
  globalThis.libWrapper = {
    register(_moduleId, _target, fn) { registrations.push(fn); },
    unregister() {}
  };

  const scene = { id: "scene-wrapper-fallbacks", grid: { isGridless: true }, tokens: new FakeCollection() };
  const leader = new FakeTokenDocument({ uuid: "Scene.scene-wrapper-fallbacks.Token.leader", id: "leader", scene });
  Object.assign(leader, { x: 0, y: 0, elevation: 0 });
  scene.tokens.set(leader.id, leader);
  const relationship = {
    id: "relationship-wrapper-fallbacks",
    leaderUuid: leader.uuid,
    followerUuid: "Scene.scene-wrapper-fallbacks.Token.follower",
    coordinationPolicy: RELATIONSHIP_COORDINATION_POLICIES.COORDINATED
  };
  const fakeRelationships = {
    list: () => [relationship],
    getForLeader: (uuid) => uuid === leader.uuid ? [relationship] : [],
    getForFollower: () => []
  };
  const fakeMovement = {
    registerConsumer() { return () => {}; },
    createOperationOptions(metadata) { return { actionEffects5e: metadata }; },
    registerMovementContext() { return () => {}; }
  };
  const fakeSocket = { register() {} };
  const { RelationshipMovementService } = await import("../scripts/relationships/relationship-movement-service.js");
  const service = new RelationshipMovementService({ socket: fakeSocket, relationships: fakeRelationships, movement: fakeMovement });
  service.initialize();

  const calls = [];
  const wrapped = async (instructions, options) => {
    calls.push({ instructions, options });
    return { leader: true };
  };

  const teleportInstructions = { leader: { destination: { x: 500, y: 0, elevation: 0, action: "walk" }, method: "api" } };
  const teleportOptions = { method: "api", actionEffects5e: { pathType: PATH_TYPES.TELEPORT } };
  await registrations[0].call(scene, wrapped, teleportInstructions, teleportOptions);
  assert.equal(calls[0].instructions, teleportInstructions);

  const mixedInstructions = {
    leader: {
      destination: { x: 100, y: 0, elevation: 0, texture: { tint: "#ff0000" } },
      method: "api"
    }
  };
  await registrations[0].call(scene, wrapped, mixedInstructions, { method: "api" });
  assert.equal(calls[1].instructions, mixedInstructions, "Movement carrying unrelated token updates must remain untouched.");

  service.shutdown();
  globalThis.libWrapper = previousLibWrapper;
});

test("public relationship moveGroup API delegates a normalized route through Socketlib", async () => {
  const previousFromUuid = globalThis.fromUuid;
  const scene = { id: "scene-public-move" };
  const leader = new FakeTokenDocument({ uuid: "Scene.scene-public-move.Token.leader", id: "leader", scene });
  Object.assign(leader, { x: 10, y: 20, elevation: 5 });
  globalThis.fromUuid = async (uuid) => uuid === leader.uuid ? leader : null;

  let received = null;
  const fakeSocket = {
    register() {},
    async executeAsGM(name, request) {
      assert.equal(name, "relationships.moveGroup");
      received = structuredClone(request);
      return { completed: true };
    }
  };
  const fakeRelationships = { list: () => [], getForLeader: () => [] };
  const fakeMovement = {};
  const { RelationshipMovementService } = await import("../scripts/relationships/relationship-movement-service.js");
  const service = new RelationshipMovementService({ socket: fakeSocket, relationships: fakeRelationships, movement: fakeMovement });

  const result = await service.moveGroup({
    leaderUuid: leader.uuid,
    waypoints: [
      { x: 110, action: "walk" },
      { y: 120, elevation: 10 }
    ],
    movementMode: "walk",
    sourceUuid: "Item.test"
  });

  assert.equal(result.completed, true);
  assert.deepEqual(received.origin, { x: 10, y: 20, elevation: 5 });
  assert.deepEqual(received.waypoints.map(({ x, y, elevation, checkpoint }) => ({ x, y, elevation, checkpoint: checkpoint ?? false })), [
    { x: 110, y: 20, elevation: 5, checkpoint: false },
    { x: 110, y: 120, elevation: 10, checkpoint: true }
  ]);
  assert.equal(received.sourceUuid, "Item.test");

  globalThis.fromUuid = previousFromUuid;
});

test("coordinated external API movement preflights follower collision before either token moves", async () => {
  const previousLibWrapper = globalThis.libWrapper;
  const previousUi = globalThis.ui;
  const registrations = [];
  let warned = null;
  globalThis.libWrapper = {
    register(_moduleId, _target, fn) { registrations.push(fn); },
    unregister() {}
  };
  globalThis.ui = { notifications: { warn(message) { warned = message; }, error() {} } };

  const scene = { id: "scene-wrapper-collision", grid: { isGridless: true }, tokens: new FakeCollection() };
  const leader = new FakeTokenDocument({ uuid: "Scene.scene-wrapper-collision.Token.leader", id: "leader", scene });
  Object.assign(leader, { x: 0, y: 0, elevation: 0, name: "Leader", object: null });
  const follower = new FakeTokenDocument({ uuid: "Scene.scene-wrapper-collision.Token.follower", id: "follower", scene });
  Object.assign(follower, {
    x: -100,
    y: 0,
    elevation: 0,
    name: "Follower",
    object: {
      constrainMovementPath(path) { return [path, true]; }
    }
  });
  scene.tokens.set(leader.id, leader);
  scene.tokens.set(follower.id, follower);

  const relationship = {
    id: "relationship-wrapper-collision",
    leaderUuid: leader.uuid,
    followerUuid: follower.uuid,
    attachmentMode: "adjacentFollower",
    followElevation: true,
    followRotation: false,
    collisionPolicy: "stopGroup",
    coordinationPolicy: RELATIONSHIP_COORDINATION_POLICIES.COORDINATED
  };
  const fakeRelationships = {
    list: () => [relationship],
    getForLeader: (uuid) => uuid === leader.uuid ? [relationship] : [],
    getForFollower: (uuid) => uuid === follower.uuid ? [relationship] : [],
    async removeManyAsGM() { return 0; }
  };
  const fakeMovement = {
    registerConsumer() { return () => {}; },
    createOperationOptions(metadata) { return { actionEffects5e: metadata }; },
    registerMovementContext() { return () => {}; }
  };
  const fakeSocket = { register() {} };
  const { RelationshipMovementService } = await import("../scripts/relationships/relationship-movement-service.js");
  const service = new RelationshipMovementService({ socket: fakeSocket, relationships: fakeRelationships, movement: fakeMovement });
  service.initialize();

  let wrappedCalls = 0;
  const result = await registrations[0].call(scene, async () => {
    wrappedCalls += 1;
    return { leader: true };
  }, {
    leader: {
      destination: { x: 100, y: 0, elevation: 0, action: "walk", checkpoint: true },
      method: "api"
    }
  }, { method: "api" });

  assert.equal(wrappedCalls, 0);
  assert.deepEqual(result, { leader: false });
  assert.match(warned, /cannot follow that path/i);

  service.shutdown();
  globalThis.libWrapper = previousLibWrapper;
  globalThis.ui = previousUi;
});


function makeOrbitRig({
  sceneId = `scene-orbit-${++idCounter}`,
  leaderWidth = 1,
  leaderHeight = leaderWidth,
  followerWidth = 1,
  followerHeight = followerWidth,
  leaderPosition = { x: 100, y: 100 },
  followerPosition = { x: 0, y: 100 },
  leaderRotation = 0,
  followerRotation = 0,
  coordinationDistance = 5,
  breakDistance = 5,
  collision = false,
  alliedToken = null,
  requestingUser = gmUser,
  alliedEndpointGraceMs = 50
} = {}) {
  const previousLibWrapper = globalThis.libWrapper;
  const previousUi = globalThis.ui;
  const previousFromUuid = globalThis.fromUuid;
  const previousCanvas = globalThis.canvas;
  const previousConfig = globalThis.CONFIG;
  const previousGameUser = game.user;
  const registrations = [];
  const warnings = [];
  const socketCalls = [];
  const moveCalls = [];

  globalThis.libWrapper = {
    register(moduleId, target, fn, type) { registrations.push({ moduleId, target, fn, type }); },
    unregister() {}
  };
  globalThis.ui = { notifications: { warn(message) { warnings.push(message); }, error() {}, info() {} } };
  globalThis.CONFIG = { Token: { movement: { defaultAction: "walk" } } };
  game.user = requestingUser;

  const scene = {
    id: sceneId,
    grid: makeFiveFootSquareGrid(),
    tokens: new FakeCollection(),
    async moveTokens(instructions) {
      assertGeneratedMovementInstructions(instructions);
      moveCalls.push(structuredClone(instructions));
      for (const [tokenId, instruction] of Object.entries(instructions)) {
        const token = scene.tokens.get(tokenId);
        const final = instruction.waypoints?.at(-1) ?? instruction.destination;
        if (!token || !final) continue;
        token.x = final.x;
        token.y = final.y;
        token.elevation = final.elevation ?? token.elevation;
      }
      return Object.fromEntries(Object.keys(instructions).map((id) => [id, true]));
    }
  };
  game.scenes.set(scene.id, scene);

  const leader = new FakeTokenDocument({ uuid: `Scene.${scene.id}.Token.leader`, id: "leader", scene, owner: true });
  Object.assign(leader, {
    x: leaderPosition.x,
    y: leaderPosition.y,
    elevation: 0,
    width: leaderWidth,
    height: leaderHeight,
    rotation: leaderRotation,
    name: "Leader"
  });
  const follower = new FakeTokenDocument({ uuid: `Scene.${scene.id}.Token.follower`, id: "follower", scene });
  Object.assign(follower, {
    x: followerPosition.x,
    y: followerPosition.y,
    elevation: 0,
    width: followerWidth,
    height: followerHeight,
    rotation: followerRotation,
    name: "Follower",
    disposition: -1,
    object: {
      movementAnimationPromise: Promise.resolve(),
      constrainMovementPath: (path) => [path, collision === true]
    }
  });
  scene.tokens.set(leader.id, leader);
  scene.tokens.set(follower.id, follower);

  if (alliedToken) {
    const token = new FakeTokenDocument({ uuid: `Scene.${scene.id}.Token.ally`, id: "ally", scene });
    Object.assign(token, {
      x: alliedToken.x,
      y: alliedToken.y,
      elevation: 0,
      width: alliedToken.width ?? 1,
      height: alliedToken.height ?? 1,
      disposition: alliedToken.disposition ?? -1,
      name: "Other"
    });
    scene.tokens.set(token.id, token);
  }

  const leaderPlaceable = { document: leader };
  leader.object = leaderPlaceable;
  globalThis.canvas = { ready: true, scene, dimensions: { size: scene.grid.size }, grid: scene.grid, tokens: { controlled: [leaderPlaceable] } };
  globalThis.fromUuid = async (uuid) => scene.tokens.find((token) => token.uuid === uuid) ?? null;

  const relationship = {
    id: `relationship-${scene.id}`,
    sceneId: scene.id,
    leaderUuid: leader.uuid,
    followerUuid: follower.uuid,
    attachmentMode: "grappleFollower",
    followerCanSelfMove: false,
    followElevation: true,
    followRotation: false,
    rotationPolicy: RELATIONSHIP_ROTATION_POLICIES.ORBIT_FOLLOWER,
    collisionPolicy: "stopGroup",
    coordinationDistance,
    breakDistance,
    alliedEndpointPolicy: RELATIONSHIP_ALLIED_ENDPOINT_POLICIES.GRACE,
    alliedEndpointGraceMs,
    sourceUuid: null
  };
  const fakeRelationships = {
    get: (id) => id === relationship.id ? relationship : null,
    list: () => [relationship],
    getForLeader: (uuid) => uuid === leader.uuid ? [relationship] : [],
    getForFollower: (uuid) => uuid === follower.uuid ? [relationship] : [],
    async removeManyAsGM() { return 0; }
  };
  const socketHandlers = new Map();
  const fakeSocket = {
    register(name, handler) { socketHandlers.set(name, handler); },
    async executeAsGM(name, request) {
      socketCalls.push({ name, request: structuredClone(request), callerUserId: game.user.id });
      const handler = socketHandlers.get(name);
      const prior = game.user;
      game.user = gmUser;
      try {
        return await handler(request);
      } finally {
        game.user = prior;
      }
    }
  };
  const fakeMovement = {
    createOperationOptions(metadata) { return { actionEffects5e: metadata }; },
    registerMovementContext() { return () => {}; }
  };
  const fakeAccounting = {
    noCostActionId: "action-effects-5e.no-cost",
    ensureRegistered() {}
  };
  // Production AE5E always supplies RelationshipRotationService with the
  // grapple-link obstruction service. These orbit tests isolate follower-body
  // and shell behavior, so provide an explicit clear-link test double instead
  // of accidentally exercising the service's fail-closed "preflight unavailable"
  // fallback. Dedicated grapple-link obstruction coverage lives elsewhere.
  const fakeLinkObstructions = {
    inspectSweep() {
      return {
        blocked: false,
        geometryChannel: RELATIONSHIP_GEOMETRY_CHANNELS.GRAPPLE_LINK,
        reasonCode: "clear",
        wallBlocked: false,
        wallCheckAvailable: true,
        conflicts: [],
        hostile: [],
        nonhostile: [],
        samples: []
      };
    },
    inspectAtPosition() {
      return {
        geometryChannel: RELATIONSHIP_GEOMETRY_CHANNELS.GRAPPLE_LINK,
        segment: null,
        wallBlocked: false,
        wallCheckAvailable: true,
        conflicts: [],
        hostile: [],
        nonhostile: []
      };
    }
  };

  leader.update = async (changes, options = {}) => {
    const preChanges = { ...changes };
    if (Hooks.call("preUpdateToken", leader, preChanges, options, game.user.id) === false) return leader;
    Hooks.callAll("updateToken", leader, preChanges, options, game.user.id);
    Object.assign(leader, preChanges);
    return leader;
  };

  const cleanup = () => {
    game.scenes.delete(scene.id);
    game.user = previousGameUser;
    globalThis.libWrapper = previousLibWrapper;
    globalThis.ui = previousUi;
    globalThis.fromUuid = previousFromUuid;
    globalThis.canvas = previousCanvas;
    globalThis.CONFIG = previousConfig;
  };

  return {
    scene,
    leader,
    follower,
    leaderPlaceable,
    relationship,
    fakeRelationships,
    fakeSocket,
    fakeMovement,
    fakeAccounting,
    fakeLinkObstructions,
    registrations,
    warnings,
    socketCalls,
    moveCalls,
    cleanup
  };
}

async function makeOrbitService(rig) {
  const { RelationshipRotationService } = await import("../scripts/relationships/relationship-rotation-service.js");
  return new RelationshipRotationService({
    socket: rig.fakeSocket,
    relationships: rig.fakeRelationships,
    movement: rig.fakeMovement,
    accounting: rig.fakeAccounting,
    linkObstructions: rig.fakeLinkObstructions
  });
}

async function performWheelStep(rig, service, { modifier = "shift", nativeDelta = 45 } = {}) {
  const wheel = rig.registrations.find((entry) => entry.target.includes("TokenLayer"));
  assert.ok(wheel, "Relationship rotation must register the TokenLayer mouse-wheel wrapper.");
  const before = rig.leader.rotation;
  const nativeRequested = RelationshipOrbitPlanner.normalizeRotation(before + nativeDelta);
  const event = {
    shiftKey: modifier === "shift",
    ctrlKey: modifier === "ctrl",
    deltaY: nativeDelta >= 0 ? 1 : -1
  };
  const native = () => {
    const changes = { rotation: nativeRequested };
    const options = {};
    const allowed = Hooks.call("preUpdateToken", rig.leader, changes, options, game.user.id);
    if (allowed === false) return false;
    // Match Foundry v14.365: TokenDocument.rotation is still the old value while
    // updateToken observers receive the committed differential.
    Hooks.callAll("updateToken", rig.leader, changes, options, game.user.id);
    rig.leader.rotation = changes.rotation;
    return true;
  };
  wheel.fn.call({ controlled: [rig.leaderPlaceable] }, native, event);
  await service.waitForSettled({ leaderUuid: rig.leader.uuid });
  return { before, nativeRequested, after: rig.leader.rotation };
}

test("relationship orbit geometry preserves the familiar 3x3 shell for 1x1 tokens", () => {
  const scene = { grid: makeFiveFootSquareGrid() };
  const leader = { x: 100, y: 100, elevation: 0, width: 1, height: 1 };
  const follower = { x: 0, y: 100, elevation: 0, width: 1, height: 1 };
  const relationship = { coordinationDistance: 5 };
  const shell = RelationshipGeometryService.generateOrbitShell({ scene, leader, follower, relationship });
  assert.equal(shell.length, 8);
  const positive = RelationshipOrbitPlanner.buildWaypoints({ scene, leader, follower, relationship, direction: 1, steps: 4 });
  assert.deepEqual(positive.map(({ x, y }) => ({ x, y })), [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 100 }
  ]);
});

test("dynamic orbit shells cover Tiny through Gargantuan-style rectangular footprints", () => {
  const cases = [
    { leader: 0.5, follower: 0.5, distance: 5, count: 8 },
    { leader: 0.5, follower: 1, distance: 5, count: 12 },
    { leader: 1, follower: 0.5, distance: 5, count: 12 },
    { leader: 1, follower: 1, distance: 5, count: 8 },
    { leader: 2, follower: 1, distance: 5, count: 12 },
    { leader: 1, follower: 2, distance: 5, count: 12 },
    { leader: 2, follower: 2, distance: 5, count: 16 },
    { leader: 2, follower: 3, distance: 5, count: 20 },
    { leader: 3, follower: 4, distance: 5, count: 28 },
    { leader: 4, follower: 3, distance: 5, count: 28 },
    { leader: 1, follower: 1, distance: 10, count: 16 },
    { leader: 2, follower: 1, distance: 10, count: 20 },
    { leader: 1, follower: 2, distance: 10, count: 20 },
    { leader: 2, follower: 3, distance: 10, count: 28 }
  ];
  const scene = { grid: makeFiveFootSquareGrid() };
  for (const entry of cases) {
    const leader = { x: 500, y: 500, elevation: 0, width: entry.leader, height: entry.leader };
    const follower = {
      x: 500 + (entry.leader * scene.grid.size) + (((entry.distance / scene.grid.distance) - 1) * scene.grid.size),
      y: 500,
      elevation: 0,
      width: entry.follower,
      height: entry.follower
    };
    const relationship = { coordinationDistance: entry.distance };
    const shell = RelationshipGeometryService.generateOrbitShell({ scene, leader, follower, relationship });
    assert.equal(shell.length, entry.count, `${entry.leader}x${entry.leader} -> ${entry.follower}x${entry.follower} @ ${entry.distance} ft`);
    const validation = RelationshipGeometryService.validateOrbitShell({ scene, leader, follower, relationship });
    assert.equal(validation.passed, true, `${entry.leader} -> ${entry.follower} shell must validate`);
  }
});

test("orbit shell traversal closes at exactly plus/minus 360 degrees without drift", () => {
  const scene = { grid: makeFiveFootSquareGrid() };
  const leader = { x: 100, y: 100, elevation: 0, width: 2, height: 2 };
  const follower = { x: 300, y: 100, elevation: 0, width: 1, height: 1 };
  const relationship = { coordinationDistance: 5 };
  const shell = RelationshipGeometryService.generateOrbitShell({ scene, leader, follower, relationship });
  let clockwise = 0;
  let counterclockwise = 0;
  for (let index = 0; index < shell.length; index += 1) {
    clockwise += RelationshipGeometryService.directedBearingDelta(shell[index].bearing, shell[(index + 1) % shell.length].bearing, 1);
    counterclockwise += RelationshipGeometryService.directedBearingDelta(shell[index].bearing, shell[(index - 1 + shell.length) % shell.length].bearing, -1);
  }
  assert.ok(Math.abs(clockwise - 360) < 1e-8);
  assert.ok(Math.abs(counterclockwise + 360) < 1e-8);
});

test("relationship orbit planner measures actual signed rotation changes across 0/360", () => {
  assert.equal(RelationshipOrbitPlanner.signedRotationDelta(350, 5), 15);
  assert.equal(RelationshipOrbitPlanner.signedRotationDelta(5, 350), -15);
  assert.equal(RelationshipOrbitPlanner.signedRotationDelta(0, 22.5), 22.5);
  assert.equal(RelationshipOrbitPlanner.signedRotationDelta(22.5, 0), -22.5);
});

test("Shift-wheel and Ctrl-wheel each normalize to one identical shell step", async () => {
  const run = async (modifier, nativeDelta) => {
    const rig = makeOrbitRig({
      sceneId: `scene-modifier-${modifier}`,
      leaderWidth: 2,
      followerWidth: 1,
      leaderPosition: { x: 100, y: 100 },
      followerPosition: { x: 300, y: 100 },
      coordinationDistance: 5
    });
    const service = await makeOrbitService(rig);
    service.initialize();
    try {
      const result = await performWheelStep(rig, service, { modifier, nativeDelta });
      return {
        follower: { x: rig.follower.x, y: rig.follower.y },
        leaderRotation: rig.leader.rotation,
        diagnostics: service.getStats().lastDecision,
        result
      };
    } finally {
      service.shutdown();
      rig.cleanup();
    }
  };

  const shift = await run("shift", 45);
  const ctrl = await run("ctrl", 15);
  assert.deepEqual(shift.follower, ctrl.follower);
  assert.ok(Math.abs(shift.leaderRotation - ctrl.leaderRotation) < 1e-8);
  assert.deepEqual(shift.follower, { x: 300, y: 200 });
  assert.ok(Math.abs(shift.leaderRotation - 36.86989764584405) < 1e-8);
  assert.equal(shift.diagnostics.orbitStepsCompleted, 1);
  assert.equal(ctrl.diagnostics.orbitStepsCompleted, 1);
  assert.equal(shift.diagnostics.inputModifier, "shift");
  assert.equal(ctrl.diagnostics.inputModifier, "ctrl");
  assert.equal(shift.diagnostics.inputNormalized, true);
  assert.equal(ctrl.diagnostics.inputNormalized, true);
});

test("rapid wheel inputs use predicted shell state and serialize multiple one-box steps", async () => {
  const rig = makeOrbitRig({
    sceneId: "scene-rapid-shell-input",
    leaderWidth: 2,
    followerWidth: 1,
    leaderPosition: { x: 100, y: 100 },
    followerPosition: { x: 300, y: 100 },
    coordinationDistance: 5
  });
  const service = await makeOrbitService(rig);
  service.initialize();
  try {
    const wheel = rig.registrations.find((entry) => entry.target.includes("TokenLayer"));
    const issue = (nativeDelta, modifier) => {
      const event = { shiftKey: modifier === "shift", ctrlKey: modifier === "ctrl", deltaY: 1 };
      const native = () => {
        const changes = { rotation: RelationshipOrbitPlanner.normalizeRotation(rig.leader.rotation + nativeDelta) };
        const options = {};
        assert.notEqual(Hooks.call("preUpdateToken", rig.leader, changes, options, game.user.id), false);
        Hooks.callAll("updateToken", rig.leader, changes, options, game.user.id);
        rig.leader.rotation = changes.rotation;
      };
      wheel.fn.call({ controlled: [rig.leaderPlaceable] }, native, event);
    };
    issue(45, "shift");
    issue(15, "ctrl");
    await service.waitForSettled({ leaderUuid: rig.leader.uuid });
    assert.deepEqual({ x: rig.follower.x, y: rig.follower.y }, { x: 300, y: 300 });
    assert.equal(rig.socketCalls.filter((call) => call.name === "relationships.orbitFollower").length, 2);
  } finally {
    service.shutdown();
    rig.cleanup();
  }
});

test("blocked non-45-degree shell step restores the exact pre-update leader rotation", async () => {
  const rig = makeOrbitRig({
    sceneId: "scene-orbit-variable-angle-collision",
    leaderWidth: 2,
    followerWidth: 1,
    leaderPosition: { x: 100, y: 100 },
    followerPosition: { x: 300, y: 100 },
    leaderRotation: 270,
    coordinationDistance: 5,
    collision: true
  });
  const service = await makeOrbitService(rig);
  service.initialize();
  try {
    await performWheelStep(rig, service, { modifier: "shift", nativeDelta: 45 });
    assert.equal(rig.leader.rotation, 270, "Rollback must restore the exact captured pre-input facing.");
    assert.deepEqual({ x: rig.follower.x, y: rig.follower.y }, { x: 300, y: 100 });
    assert.equal(rig.moveCalls.length, 0, "A blocked follower-body preflight must stop before Scene.moveTokens.");
    const decision = service.getStats().lastDecision;
    assert.equal(decision?.collision, true);
    assert.equal(decision?.obstruction?.geometryChannel, RELATIONSHIP_GEOMETRY_CHANNELS.FOLLOWER_BODY);
    assert.equal(decision?.obstruction?.reasonCode, "environment-obstruction");
    assert.match(rig.warnings.at(-1), /cannot orbit/i);
  } finally {
    service.shutdown();
    rig.cleanup();
  }
});

test("allied occupied shell endpoint starts grace and restores the exact prior orbit state", async () => {
  const rig = makeOrbitRig({
    sceneId: "scene-orbit-allied-grace-v023",
    leaderPosition: { x: 100, y: 100 },
    followerPosition: { x: 200, y: 100 },
    coordinationDistance: 5,
    alliedToken: { x: 200, y: 200, disposition: -1 },
    alliedEndpointGraceMs: 500
  });
  const service = await makeOrbitService(rig);
  service.initialize();
  try {
    await performWheelStep(rig, service, { modifier: "shift", nativeDelta: 45 });
    assert.deepEqual({ x: rig.follower.x, y: rig.follower.y }, { x: 200, y: 200 });
    await new Promise((resolve) => setTimeout(resolve, 650));
    assert.deepEqual({ x: rig.follower.x, y: rig.follower.y }, { x: 200, y: 100 });
    assert.equal(rig.leader.rotation, 0);
  } finally {
    service.shutdown();
    rig.cleanup();
  }
});

test("continuing out of an allied occupied shell endpoint cancels the grace rollback", async () => {
  const rig = makeOrbitRig({
    sceneId: "scene-orbit-allied-continue-v023",
    leaderPosition: { x: 100, y: 100 },
    followerPosition: { x: 200, y: 100 },
    coordinationDistance: 5,
    alliedToken: { x: 200, y: 200, disposition: -1 },
    alliedEndpointGraceMs: 500
  });
  const service = await makeOrbitService(rig);
  service.initialize();
  try {
    await performWheelStep(rig, service, { modifier: "shift", nativeDelta: 45 });
    await performWheelStep(rig, service, { modifier: "ctrl", nativeDelta: 15 });
    assert.deepEqual({ x: rig.follower.x, y: rig.follower.y }, { x: 100, y: 200 });
    await new Promise((resolve) => setTimeout(resolve, 650));
    assert.deepEqual({ x: rig.follower.x, y: rig.follower.y }, { x: 100, y: 200 });
  } finally {
    service.shutdown();
    rig.cleanup();
  }
});

test("opposing occupied endpoint hard-blocks follower orbit and never arms nonhostile grace", async () => {
  const rig = makeOrbitRig({
    sceneId: "scene-orbit-opposing-v023",
    leaderPosition: { x: 100, y: 100 },
    followerPosition: { x: 200, y: 100 },
    coordinationDistance: 5,
    alliedToken: { x: 200, y: 200, disposition: 1 },
    alliedEndpointGraceMs: 20
  });
  const service = await makeOrbitService(rig);
  service.initialize();
  try {
    await performWheelStep(rig, service, { modifier: "shift", nativeDelta: 45 });
    assert.deepEqual({ x: rig.follower.x, y: rig.follower.y }, { x: 200, y: 100 });
    assert.equal(rig.moveCalls.length, 0, "Hostile occupied endpoints must hard-block before Scene.moveTokens.");
    const stats = service.getStats();
    assert.equal(stats.pendingAlliedOverlaps, 0);
    assert.equal(stats.lastDecision?.collision, true);
    assert.equal(stats.lastDecision?.obstruction?.geometryChannel, RELATIONSHIP_GEOMETRY_CHANNELS.FOLLOWER_BODY);
    assert.equal(stats.lastDecision?.obstruction?.reasonCode, "hostile-creature");
  } finally {
    service.shutdown();
    rig.cleanup();
  }
});

test("player wheel orbit is GM-authorized and the player does not directly move the follower", async () => {
  const player = { id: "player-orbit-v023", isGM: false, active: true };
  users.set(player.id, player);
  const rig = makeOrbitRig({
    sceneId: "scene-player-orbit-v023",
    requestingUser: player,
    leaderPosition: { x: 100, y: 100 },
    followerPosition: { x: 0, y: 100 },
    coordinationDistance: 5
  });
  const service = await makeOrbitService(rig);
  service.initialize();
  try {
    await performWheelStep(rig, service, { modifier: "shift", nativeDelta: 45 });
    assert.equal(rig.socketCalls.filter((call) => call.name === "relationships.orbitFollower").length, 1);
    assert.deepEqual({ x: rig.follower.x, y: rig.follower.y }, { x: 0, y: 0 });
    assert.equal(rig.moveCalls.length, 1, "Follower movement must occur only inside the GM-authorized resolver.");
  } finally {
    service.shutdown();
    rig.cleanup();
    users.delete(player.id);
    game.user = gmUser;
  }
});

test("movement settlement helper tolerates a retained already-resolved animation promise", async () => {
  const previousFromUuid = globalThis.fromUuid;
  const scene = { id: "scene-retained-settled-promise" };
  const resolved = Promise.resolve();
  const leader = new FakeTokenDocument({ uuid: "Scene.scene-retained-settled-promise.Token.leader", id: "leader", scene });
  Object.assign(leader, { object: { movementAnimationPromise: resolved } });
  const relationship = { id: "relationship-retained-promise", leaderUuid: leader.uuid, followerUuid: "Scene.scene-retained-settled-promise.Token.follower" };
  const fakeRelationships = {
    list: () => [relationship],
    getForLeader: (uuid) => uuid === leader.uuid ? [relationship] : [],
    getForFollower: () => []
  };
  globalThis.fromUuid = async (uuid) => uuid === leader.uuid ? leader : null;
  const fakeSocket = { register() {} };
  const fakeMovement = { registerConsumer() { return () => {}; } };
  const { RelationshipMovementService } = await import("../scripts/relationships/relationship-movement-service.js");
  const service = new RelationshipMovementService({ socket: fakeSocket, relationships: fakeRelationships, movement: fakeMovement });

  await service.waitForMovementSettled({ leaderUuid: leader.uuid, timeoutMs: 100, pollMs: 5 });
  globalThis.fromUuid = previousFromUuid;
});

function makeFiveFootSquareGrid() {
  const size = 100;
  const distance = 5;
  return {
    isGridless: false,
    isSquare: true,
    isHexagonal: false,
    size,
    sizeX: size,
    sizeY: size,
    distance,
    getOffsetRange(bounds) {
      const i0 = Math.floor(bounds.y / size);
      const j0 = Math.floor(bounds.x / size);
      const i1 = Math.ceil((bounds.y + bounds.height) / size);
      const j1 = Math.ceil((bounds.x + bounds.width) / size);
      return [i0, j0, i1, j1];
    },
    getCenterPoint({ i, j }) {
      return { x: (j * size) + (size / 2), y: (i * size) + (size / 2) };
    },
    measurePath([a, b]) {
      const planarX = Math.abs(Number(b.x) - Number(a.x)) / size * distance;
      const planarY = Math.abs(Number(b.y) - Number(a.y)) / size * distance;
      const vertical = Math.abs(Number(b.elevation ?? 0) - Number(a.elevation ?? 0));
      return { distance: Math.max(planarX, planarY, vertical) };
    }
  };
}

test("relationship break distance measures the closest occupied grid spaces instead of token centers", () => {
  const grid = makeFiveFootSquareGrid();
  const scene = { id: "scene-distance", grid };
  const leader = { x: 0, y: 0, elevation: 0, width: 1, height: 1 };
  const adjacent = { x: 100, y: 0, elevation: 0, width: 1, height: 1 };
  const separated = { x: 200, y: 0, elevation: 0, width: 1, height: 1 };
  const large = { x: 0, y: 0, elevation: 0, width: 2, height: 2 };
  const besideLarge = { x: 200, y: 0, elevation: 0, width: 1, height: 1 };
  const elevated = { x: 0, y: 0, elevation: 10, width: 1, height: 1 };

  assert.equal(RelationshipDistance.measure({ scene, leader, follower: adjacent }), 5);
  assert.equal(RelationshipDistance.measure({ scene, leader, follower: separated }), 10);
  assert.equal(RelationshipDistance.measure({ scene, leader: large, follower: besideLarge }), 5,
    "A larger token must measure from its closest occupied grid space.");
  assert.equal(RelationshipDistance.measure({ scene, leader, follower: elevated }), 10,
    "Foundry grid measurement remains authoritative for elevation separation.");
});

test("break-distance enforcement preserves an in-range relationship and detaches it after external separation", async () => {
  const previousFromUuid = globalThis.fromUuid;
  const scene = { id: "scene-break-distance", grid: makeFiveFootSquareGrid(), tokens: new FakeCollection() };
  game.scenes.set(scene.id, scene);
  const leader = new FakeTokenDocument({ uuid: `Scene.${scene.id}.Token.leader`, id: "leader", scene });
  Object.assign(leader, { x: 0, y: 0, elevation: 0, width: 1, height: 1 });
  const follower = new FakeTokenDocument({ uuid: `Scene.${scene.id}.Token.follower`, id: "follower", scene });
  Object.assign(follower, { x: 100, y: 0, elevation: 0, width: 1, height: 1 });
  scene.tokens.set(leader.id, leader);
  scene.tokens.set(follower.id, follower);
  globalThis.fromUuid = async (uuid) => uuid === leader.uuid ? leader : uuid === follower.uuid ? follower : null;

  const relationship = {
    id: "relationship-break-distance",
    sceneId: scene.id,
    leaderUuid: leader.uuid,
    followerUuid: follower.uuid,
    breakDistance: 5
  };
  const stored = new Map([[relationship.id, relationship]]);
  const fakeRelationships = {
    list: () => [...stored.values()],
    get: (id) => stored.get(id) ?? null,
    getForLeader: (uuid) => uuid === leader.uuid && stored.has(relationship.id) ? [relationship] : [],
    getForFollower: (uuid) => uuid === follower.uuid && stored.has(relationship.id) ? [relationship] : [],
    async removeManyAsGM(ids) {
      let count = 0;
      for (const id of ids) if (stored.delete(id)) count += 1;
      return count;
    }
  };
  const handlers = new Map();
  const fakeSocket = {
    register(name, handler) { handlers.set(name, handler); },
    async executeAsGM(name, request) { return handlers.get(name)(request); }
  };
  const fakeMovement = { registerConsumer() { return () => {}; } };
  const { RelationshipMovementService } = await import("../scripts/relationships/relationship-movement-service.js");
  new RelationshipMovementService({ socket: fakeSocket, relationships: fakeRelationships, movement: fakeMovement });

  const inRange = await fakeSocket.executeAsGM("relationships.enforceBreakDistance", {
    requestId: "separation-in-range",
    requestingUserId: game.user.id,
    sceneId: scene.id,
    movedTokenUuid: follower.uuid,
    relationshipIds: [relationship.id]
  });
  assert.deepEqual(inRange.detachedRelationshipIds, []);
  assert.equal(stored.has(relationship.id), true);

  follower.x = 200;
  const outOfRange = await fakeSocket.executeAsGM("relationships.enforceBreakDistance", {
    requestId: "separation-out-of-range",
    requestingUserId: game.user.id,
    sceneId: scene.id,
    movedTokenUuid: follower.uuid,
    relationshipIds: [relationship.id]
  });
  assert.deepEqual(outOfRange.detachedRelationshipIds, [relationship.id]);
  assert.equal(stored.has(relationship.id), false);
  assert.equal(outOfRange.evaluations[0].distance, 10);
  assert.equal(outOfRange.evaluations[0].breakDistance, 5);

  game.scenes.delete(scene.id);
  globalThis.fromUuid = previousFromUuid;
});

test("forced external leader movement can leave a grapple-like follower behind instead of being converted into group movement", async () => {
  const previousLibWrapper = globalThis.libWrapper;
  const previousFromUuid = globalThis.fromUuid;
  const registrations = [];
  globalThis.libWrapper = {
    register(_moduleId, _target, fn) { registrations.push(fn); },
    unregister() {}
  };

  const scene = { id: "scene-forced-leader-independent", grid: makeFiveFootSquareGrid(), tokens: new FakeCollection() };
  const leader = new FakeTokenDocument({ uuid: `Scene.${scene.id}.Token.leader`, id: "leader", scene });
  Object.assign(leader, { x: 0, y: 0, elevation: 0, width: 1, height: 1 });
  const follower = new FakeTokenDocument({ uuid: `Scene.${scene.id}.Token.follower`, id: "follower", scene });
  Object.assign(follower, { x: 100, y: 0, elevation: 0, width: 1, height: 1 });
  scene.tokens.set(leader.id, leader);
  scene.tokens.set(follower.id, follower);
  globalThis.fromUuid = async (uuid) => uuid === leader.uuid ? leader : uuid === follower.uuid ? follower : null;

  const relationship = {
    id: "relationship-forced-leader-independent",
    sceneId: scene.id,
    leaderUuid: leader.uuid,
    followerUuid: follower.uuid,
    attachmentMode: "adjacentFollower",
    coordinationPolicy: RELATIONSHIP_COORDINATION_POLICIES.COORDINATED,
    forcedLeaderMovementPolicy: RELATIONSHIP_FORCED_LEADER_MOVEMENT_POLICIES.INDEPENDENT,
    breakDistance: null
  };
  const fakeRelationships = {
    list: () => [relationship],
    get: (id) => id === relationship.id ? relationship : null,
    getForLeader: (uuid) => uuid === leader.uuid ? [relationship] : [],
    getForFollower: (uuid) => uuid === follower.uuid ? [relationship] : [],
    async removeManyAsGM() { return 0; }
  };
  const fakeMovement = {
    registerConsumer() { return () => {}; },
    createOperationOptions(metadata) { return { actionEffects5e: metadata }; },
    registerMovementContext() { return () => {}; }
  };
  const fakeSocket = { register() {} };
  const { RelationshipMovementService } = await import("../scripts/relationships/relationship-movement-service.js");
  const service = new RelationshipMovementService({ socket: fakeSocket, relationships: fakeRelationships, movement: fakeMovement });
  service.initialize();

  let capturedKeys = null;
  const wrapped = async (instructions) => {
    capturedKeys = Object.keys(instructions).sort();
    const destination = instructions.leader.destination;
    leader.x = destination.x;
    leader.y = destination.y;
    leader.elevation = destination.elevation;
    return { leader: true };
  };

  await registrations[0].call(scene, wrapped, {
    leader: {
      destination: { x: -100, y: 0, elevation: 0, checkpoint: true },
      method: "api"
    }
  }, {
    method: "api",
    [OPERATION_METADATA_KEY]: {
      agency: MOVEMENT_AGENCIES.FORCED,
      resource: MOVEMENT_RESOURCES.NONE,
      sourceUuid: "Item.shove"
    }
  });

  assert.deepEqual(capturedKeys, ["leader"], "Forced leader displacement must not implicitly drag an independent grapple-like follower.");
  assert.deepEqual({ x: follower.x, y: follower.y }, { x: 100, y: 0 });

  service.shutdown();
  globalThis.libWrapper = previousLibWrapper;
  globalThis.fromUuid = previousFromUuid;
});

test("forced leader separation beyond breakDistance leaves the follower in place and detaches the relationship", async () => {
  const previousLibWrapper = globalThis.libWrapper;
  const previousFromUuid = globalThis.fromUuid;
  const registrations = [];
  globalThis.libWrapper = {
    register(_moduleId, _target, fn) { registrations.push(fn); },
    unregister() {}
  };

  const scene = { id: "scene-forced-leader-break", grid: makeFiveFootSquareGrid(), tokens: new FakeCollection() };
  game.scenes.set(scene.id, scene);
  const leader = new FakeTokenDocument({ uuid: `Scene.${scene.id}.Token.leader`, id: "leader", scene });
  Object.assign(leader, { x: 0, y: 0, elevation: 0, width: 1, height: 1 });
  const follower = new FakeTokenDocument({ uuid: `Scene.${scene.id}.Token.follower`, id: "follower", scene });
  Object.assign(follower, { x: 100, y: 0, elevation: 0, width: 1, height: 1 });
  scene.tokens.set(leader.id, leader);
  scene.tokens.set(follower.id, follower);
  globalThis.fromUuid = async (uuid) => uuid === leader.uuid ? leader : uuid === follower.uuid ? follower : null;

  const relationship = {
    id: "relationship-forced-leader-break",
    sceneId: scene.id,
    leaderUuid: leader.uuid,
    followerUuid: follower.uuid,
    attachmentMode: "adjacentFollower",
    coordinationPolicy: RELATIONSHIP_COORDINATION_POLICIES.COORDINATED,
    forcedLeaderMovementPolicy: RELATIONSHIP_FORCED_LEADER_MOVEMENT_POLICIES.INDEPENDENT,
    breakDistance: 5
  };
  let removed = false;
  const fakeRelationships = {
    list: () => removed ? [] : [relationship],
    get: (id) => !removed && id === relationship.id ? relationship : null,
    getForLeader: (uuid) => !removed && uuid === leader.uuid ? [relationship] : [],
    getForFollower: (uuid) => !removed && uuid === follower.uuid ? [relationship] : [],
    async removeManyAsGM(ids) {
      if ([...ids].includes(relationship.id)) removed = true;
      return removed ? 1 : 0;
    }
  };
  const fakeMovement = {
    registerConsumer() { return () => {}; },
    createOperationOptions(metadata) { return { actionEffects5e: metadata }; },
    registerMovementContext() { return () => {}; }
  };
  const fakeSocket = { register() {} };
  const { RelationshipMovementService } = await import("../scripts/relationships/relationship-movement-service.js");
  const service = new RelationshipMovementService({ socket: fakeSocket, relationships: fakeRelationships, movement: fakeMovement });
  service.initialize();

  const wrapped = async (instructions) => {
    leader.x = instructions.leader.destination.x;
    leader.y = instructions.leader.destination.y;
    return { leader: true };
  };

  await registrations[0].call(scene, wrapped, {
    leader: { destination: { x: -100, y: 0, elevation: 0, checkpoint: true }, method: "api" }
  }, {
    method: "api",
    [OPERATION_METADATA_KEY]: {
      agency: MOVEMENT_AGENCIES.FORCED,
      resource: MOVEMENT_RESOURCES.NONE
    }
  });

  assert.equal(removed, true);
  assert.deepEqual({ x: leader.x, y: leader.y }, { x: -100, y: 0 });
  assert.deepEqual({ x: follower.x, y: follower.y }, { x: 100, y: 0 }, "The successful forced movement must never be rolled back or copied to the follower.");

  service.shutdown();
  game.scenes.delete(scene.id);
  globalThis.libWrapper = previousLibWrapper;
  globalThis.fromUuid = previousFromUuid;
});

test("forced follower movement is allowed through the generic relationship layer and detaches only after exceeding breakDistance", async () => {
  const previousLibWrapper = globalThis.libWrapper;
  const previousUi = globalThis.ui;
  const previousFromUuid = globalThis.fromUuid;
  globalThis.libWrapper = undefined;
  globalThis.ui = { notifications: { warn() {}, error() {} } };

  const scene = { id: "scene-forced-follower-after", grid: makeFiveFootSquareGrid(), tokens: new FakeCollection() };
  game.scenes.set(scene.id, scene);
  const leader = new FakeTokenDocument({ uuid: `Scene.${scene.id}.Token.leader`, id: "leader", scene });
  Object.assign(leader, { x: 0, y: 0, elevation: 0, width: 1, height: 1 });
  const follower = new FakeTokenDocument({ uuid: `Scene.${scene.id}.Token.follower`, id: "follower", scene });
  Object.assign(follower, { x: 100, y: 0, elevation: 0, width: 1, height: 1 });
  scene.tokens.set(leader.id, leader);
  scene.tokens.set(follower.id, follower);
  globalThis.fromUuid = async (uuid) => uuid === leader.uuid ? leader : uuid === follower.uuid ? follower : null;

  const relationship = {
    id: "relationship-forced-follower-after",
    sceneId: scene.id,
    leaderUuid: leader.uuid,
    followerUuid: follower.uuid,
    followerCanSelfMove: false,
    forcedLeaderMovementPolicy: RELATIONSHIP_FORCED_LEADER_MOVEMENT_POLICIES.INDEPENDENT,
    breakDistance: 5
  };
  let removed = false;
  const fakeRelationships = {
    list: () => removed ? [] : [relationship],
    get: (id) => !removed && id === relationship.id ? relationship : null,
    getForLeader: (uuid) => !removed && uuid === leader.uuid ? [relationship] : [],
    getForFollower: (uuid) => !removed && uuid === follower.uuid ? [relationship] : [],
    async removeManyAsGM(ids) {
      if ([...ids].includes(relationship.id)) removed = true;
      return removed ? 1 : 0;
    }
  };
  const socketHandlers = new Map();
  const fakeSocket = {
    register(name, handler) { socketHandlers.set(name, handler); },
    async executeAsGM(name, request) { return socketHandlers.get(name)(request); }
  };
  const consumers = [];
  const fakeMovement = {
    registerConsumer(config) { consumers.push(config); return () => {}; },
    createOperationOptions(metadata) { return { actionEffects5e: metadata }; },
    registerMovementContext() { return () => {}; }
  };
  const { RelationshipMovementService } = await import("../scripts/relationships/relationship-movement-service.js");
  const service = new RelationshipMovementService({ socket: fakeSocket, relationships: fakeRelationships, movement: fakeMovement });
  service.initialize();
  const followerConsumer = consumers.find((config) => config.execution === "initiator" && config.tokenUuids?.includes(follower.uuid));
  assert.ok(followerConsumer);

  follower.x = 0;
  follower.y = 100;
  await followerConsumer.handler(MovementTransaction.synthetic({
    subjectUuid: follower.uuid,
    sceneId: scene.id,
    tokenId: follower.id,
    phase: MOVEMENT_PHASES.AFTER,
    origin: { x: 100, y: 0, elevation: 0 },
    destination: { x: 0, y: 100, elevation: 0 },
    agency: MOVEMENT_AGENCIES.FORCED,
    resource: MOVEMENT_RESOURCES.NONE
  }), { movement: null });
  assert.equal(removed, false, "Forced movement to another in-range adjacent space must preserve the relationship.");

  follower.x = 200;
  follower.y = 0;
  await followerConsumer.handler(MovementTransaction.synthetic({
    subjectUuid: follower.uuid,
    sceneId: scene.id,
    tokenId: follower.id,
    phase: MOVEMENT_PHASES.AFTER,
    origin: { x: 0, y: 100, elevation: 0 },
    destination: { x: 200, y: 0, elevation: 0 },
    agency: MOVEMENT_AGENCIES.FORCED,
    resource: MOVEMENT_RESOURCES.NONE
  }), { movement: null });
  assert.equal(removed, true, "Forced movement beyond the configured range must detach after the successful movement.");
  assert.deepEqual({ x: follower.x, y: follower.y }, { x: 200, y: 0 }, "The successful external movement must remain in place after detachment.");

  service.shutdown();
  game.scenes.delete(scene.id);
  globalThis.libWrapper = previousLibWrapper;
  globalThis.ui = previousUi;
  globalThis.fromUuid = previousFromUuid;
});

test("forced leader movement within breakDistance preserves a grapple-like relationship while leaving the follower stationary", async () => {
  const previousLibWrapper = globalThis.libWrapper;
  const previousFromUuid = globalThis.fromUuid;
  const registrations = [];
  globalThis.libWrapper = {
    register(_moduleId, _target, fn) { registrations.push(fn); },
    unregister() {}
  };

  const scene = { id: "scene-forced-leader-in-range", grid: makeFiveFootSquareGrid(), tokens: new FakeCollection() };
  game.scenes.set(scene.id, scene);
  const leader = new FakeTokenDocument({ uuid: `Scene.${scene.id}.Token.leader`, id: "leader", scene });
  Object.assign(leader, { x: 0, y: 0, elevation: 0, width: 1, height: 1 });
  const follower = new FakeTokenDocument({ uuid: `Scene.${scene.id}.Token.follower`, id: "follower", scene });
  Object.assign(follower, { x: 100, y: 0, elevation: 0, width: 1, height: 1 });
  scene.tokens.set(leader.id, leader);
  scene.tokens.set(follower.id, follower);
  globalThis.fromUuid = async (uuid) => uuid === leader.uuid ? leader : uuid === follower.uuid ? follower : null;

  const relationship = {
    id: "relationship-forced-leader-in-range",
    sceneId: scene.id,
    leaderUuid: leader.uuid,
    followerUuid: follower.uuid,
    attachmentMode: "adjacentFollower",
    coordinationPolicy: RELATIONSHIP_COORDINATION_POLICIES.COORDINATED,
    forcedLeaderMovementPolicy: RELATIONSHIP_FORCED_LEADER_MOVEMENT_POLICIES.INDEPENDENT,
    breakDistance: 5
  };
  let removed = false;
  const fakeRelationships = {
    list: () => removed ? [] : [relationship],
    get: (id) => !removed && id === relationship.id ? relationship : null,
    getForLeader: (uuid) => !removed && uuid === leader.uuid ? [relationship] : [],
    getForFollower: (uuid) => !removed && uuid === follower.uuid ? [relationship] : [],
    async removeManyAsGM(ids) {
      if ([...ids].includes(relationship.id)) removed = true;
      return removed ? 1 : 0;
    }
  };
  const fakeMovement = {
    registerConsumer() { return () => {}; },
    createOperationOptions(metadata) { return { actionEffects5e: metadata }; },
    registerMovementContext() { return () => {}; }
  };
  const fakeSocket = { register() {} };
  const { RelationshipMovementService } = await import("../scripts/relationships/relationship-movement-service.js");
  const service = new RelationshipMovementService({ socket: fakeSocket, relationships: fakeRelationships, movement: fakeMovement });
  service.initialize();

  const wrapped = async (instructions) => {
    leader.x = instructions.leader.destination.x;
    leader.y = instructions.leader.destination.y;
    return { leader: true };
  };

  await registrations[0].call(scene, wrapped, {
    leader: { destination: { x: 100, y: 100, elevation: 0, checkpoint: true }, method: "api" }
  }, {
    method: "api",
    [OPERATION_METADATA_KEY]: {
      agency: MOVEMENT_AGENCIES.FORCED,
      resource: MOVEMENT_RESOURCES.NONE
    }
  });

  assert.equal(removed, false);
  assert.deepEqual({ x: leader.x, y: leader.y }, { x: 100, y: 100 });
  assert.deepEqual({ x: follower.x, y: follower.y }, { x: 100, y: 0 });
  assert.equal(RelationshipDistance.measure({ scene, leader, follower }), 5);

  service.shutdown();
  game.scenes.delete(scene.id);
  globalThis.libWrapper = previousLibWrapper;
  globalThis.fromUuid = previousFromUuid;
});

test("forced leader break-distance validation waits for the live movement animation before reading TokenDocument position", async () => {
  const previousLibWrapper = globalThis.libWrapper;
  const previousFromUuid = globalThis.fromUuid;
  const registrations = [];
  globalThis.libWrapper = {
    register(_moduleId, _target, fn) { registrations.push(fn); },
    unregister() {}
  };

  const scene = { id: "scene-forced-leader-animation", grid: makeFiveFootSquareGrid(), tokens: new FakeCollection() };
  game.scenes.set(scene.id, scene);
  const leader = new FakeTokenDocument({ uuid: `Scene.${scene.id}.Token.leader`, id: "leader", scene });
  Object.assign(leader, { x: 0, y: 0, elevation: 0, width: 1, height: 1 });
  const follower = new FakeTokenDocument({ uuid: `Scene.${scene.id}.Token.follower`, id: "follower", scene });
  Object.assign(follower, { x: 100, y: 0, elevation: 0, width: 1, height: 1 });
  scene.tokens.set(leader.id, leader);
  scene.tokens.set(follower.id, follower);
  globalThis.fromUuid = async (uuid) => uuid === leader.uuid ? leader : uuid === follower.uuid ? follower : null;

  const relationship = {
    id: "relationship-forced-leader-animation",
    sceneId: scene.id,
    leaderUuid: leader.uuid,
    followerUuid: follower.uuid,
    attachmentMode: "adjacentFollower",
    coordinationPolicy: RELATIONSHIP_COORDINATION_POLICIES.COORDINATED,
    forcedLeaderMovementPolicy: RELATIONSHIP_FORCED_LEADER_MOVEMENT_POLICIES.INDEPENDENT,
    breakDistance: 5
  };
  let removed = false;
  const fakeRelationships = {
    list: () => removed ? [] : [relationship],
    get: (id) => !removed && id === relationship.id ? relationship : null,
    getForLeader: (uuid) => !removed && uuid === leader.uuid ? [relationship] : [],
    getForFollower: (uuid) => !removed && uuid === follower.uuid ? [relationship] : [],
    async removeManyAsGM(ids) {
      if ([...ids].includes(relationship.id)) removed = true;
      return removed ? 1 : 0;
    }
  };
  const fakeMovement = {
    registerConsumer() { return () => {}; },
    createOperationOptions(metadata) { return { actionEffects5e: metadata }; },
    registerMovementContext() { return () => {}; }
  };
  const fakeSocket = { register() {} };
  const { RelationshipMovementService } = await import("../scripts/relationships/relationship-movement-service.js");
  const service = new RelationshipMovementService({ socket: fakeSocket, relationships: fakeRelationships, movement: fakeMovement });
  service.initialize();

  const wrapped = async () => {
    leader.object = {
      movementAnimationPromise: new Promise((resolve) => {
        setTimeout(() => {
          leader.x = -100;
          leader.y = 0;
          resolve();
        }, 5);
      })
    };
    return { leader: true };
  };

  await registrations[0].call(scene, wrapped, {
    leader: { destination: { x: -100, y: 0, elevation: 0, checkpoint: true }, method: "api" }
  }, {
    method: "api",
    [OPERATION_METADATA_KEY]: {
      agency: MOVEMENT_AGENCIES.FORCED,
      resource: MOVEMENT_RESOURCES.NONE
    }
  });

  assert.equal(removed, true,
    "Break-distance enforcement must observe the settled forced destination rather than the stale pre-animation TokenDocument position.");
  assert.deepEqual({ x: leader.x, y: leader.y }, { x: -100, y: 0 });
  assert.deepEqual({ x: follower.x, y: follower.y }, { x: 100, y: 0 });

  service.shutdown();
  game.scenes.delete(scene.id);
  globalThis.libWrapper = previousLibWrapper;
  globalThis.fromUuid = previousFromUuid;
});

test("simultaneous external displacement preserves a break-distance relationship when both final token spaces remain in range", async () => {
  const previousFromUuid = globalThis.fromUuid;
  const scene = { id: "scene-simultaneous-forced", grid: makeFiveFootSquareGrid(), tokens: new FakeCollection() };
  game.scenes.set(scene.id, scene);
  const leader = new FakeTokenDocument({ uuid: `Scene.${scene.id}.Token.leader`, id: "leader", scene });
  Object.assign(leader, { x: 300, y: 200, elevation: 0, width: 1, height: 1 });
  const follower = new FakeTokenDocument({ uuid: `Scene.${scene.id}.Token.follower`, id: "follower", scene });
  Object.assign(follower, { x: 400, y: 200, elevation: 0, width: 1, height: 1 });
  scene.tokens.set(leader.id, leader);
  scene.tokens.set(follower.id, follower);
  globalThis.fromUuid = async (uuid) => uuid === leader.uuid ? leader : uuid === follower.uuid ? follower : null;

  const relationship = {
    id: "relationship-simultaneous-forced",
    sceneId: scene.id,
    leaderUuid: leader.uuid,
    followerUuid: follower.uuid,
    breakDistance: 5
  };
  const stored = new Map([[relationship.id, relationship]]);
  const fakeRelationships = {
    list: () => [...stored.values()],
    get: (id) => stored.get(id) ?? null,
    getForLeader: (uuid) => uuid === leader.uuid && stored.has(relationship.id) ? [relationship] : [],
    getForFollower: (uuid) => uuid === follower.uuid && stored.has(relationship.id) ? [relationship] : [],
    async removeManyAsGM(ids) {
      let count = 0;
      for (const id of ids) if (stored.delete(id)) count += 1;
      return count;
    }
  };
  const handlers = new Map();
  const fakeSocket = {
    register(name, handler) { handlers.set(name, handler); },
    async executeAsGM(name, request) { return handlers.get(name)(request); }
  };
  const fakeMovement = { registerConsumer() { return () => {}; } };
  const { RelationshipMovementService } = await import("../scripts/relationships/relationship-movement-service.js");
  new RelationshipMovementService({ socket: fakeSocket, relationships: fakeRelationships, movement: fakeMovement });

  const result = await fakeSocket.executeAsGM("relationships.enforceBreakDistance", {
    requestId: "simultaneous-forced-final-state",
    requestingUserId: game.user.id,
    sceneId: scene.id,
    movedTokenUuid: leader.uuid,
    relationshipIds: [relationship.id]
  });

  assert.deepEqual(result.detachedRelationshipIds, []);
  assert.equal(stored.has(relationship.id), true,
    "Moving both participants together must preserve the relationship when their settled final separation remains legal.");
  assert.equal(result.evaluations[0].distance, 5);

  game.scenes.delete(scene.id);
  globalThis.fromUuid = previousFromUuid;
});

test("grapple follower trailing preserves rear-shell geometry for unequal token footprints and extended reach", async () => {
  const { RelationshipMovementPlanner } = await import("../scripts/relationships/relationship-movement-planner.js");
  const { ATTACHMENT_MODES } = await import("../scripts/core/constants.js");
  const grid = makeFiveFootSquareGrid();

  const cases = [
    {
      label: "2x2 leader with 1x1 follower at 5 feet",
      leader: { x: 0, y: 0, elevation: 0, width: 2, height: 2 },
      follower: { x: -100, y: 100, elevation: 0, width: 1, height: 1 },
      coordinationDistance: 5,
      expected: { x: 0, y: 100 }
    },
    {
      label: "1x1 leader with 2x2 follower at 5 feet",
      leader: { x: 0, y: 0, elevation: 0, width: 1, height: 1 },
      follower: { x: -200, y: 0, elevation: 0, width: 2, height: 2 },
      coordinationDistance: 5,
      expected: { x: -100, y: 0 }
    },
    {
      label: "1x1 pair at a 10-foot coordination band",
      leader: { x: 0, y: 0, elevation: 0, width: 1, height: 1 },
      follower: { x: -200, y: 0, elevation: 0, width: 1, height: 1 },
      coordinationDistance: 10,
      expected: { x: -100, y: 0 }
    },
    {
      label: "2x2 leader with 3x3 follower at a 10-foot coordination band",
      leader: { x: 0, y: 0, elevation: 0, width: 2, height: 2 },
      follower: { x: -400, y: 0, elevation: 0, width: 3, height: 3 },
      coordinationDistance: 10,
      expected: { x: -300, y: 0 }
    }
  ];

  for (const entry of cases) {
    const relationship = {
      attachmentMode: ATTACHMENT_MODES.GRAPPLE_FOLLOWER,
      coordinationDistance: entry.coordinationDistance,
      followElevation: true
    };
    const translated = RelationshipMovementPlanner.translateWaypoints({
      leader: entry.leader,
      follower: entry.follower,
      relationship,
      waypoints: [{ x: entry.leader.x + 100, y: entry.leader.y, elevation: 0 }],
      grid
    });

    assert.deepEqual(
      { x: translated.at(-1).x, y: translated.at(-1).y },
      entry.expected,
      `${entry.label} should select the legal rear shell after an eastward leader step.`
    );

    const finalLeader = { ...entry.leader, x: entry.leader.x + 100 };
    const finalFollower = { ...entry.follower, ...entry.expected };
    assert.equal(
      RelationshipDistance.measurePlanar({ scene: { grid }, leader: finalLeader, follower: finalFollower }),
      entry.coordinationDistance,
      `${entry.label} should preserve its configured planar coordination band.`
    );
  }
});

test("forced movement re-anchors coordinationDistance inside reach, avoids zero-distance overlap, and detaches beyond reach", async () => {
  const previousFromUuid = globalThis.fromUuid;
  const previousUi = globalThis.ui;
  globalThis.ui = { notifications: { warn() {}, error() {} } };

  const scene = { id: "scene-reanchor", grid: makeFiveFootSquareGrid(), tokens: new FakeCollection() };
  game.scenes.set(scene.id, scene);
  const leader = new FakeTokenDocument({ uuid: `Scene.${scene.id}.Token.leader`, id: "leader", scene });
  Object.assign(leader, { x: 0, y: 0, elevation: 0, width: 1, height: 1 });
  const follower = new FakeTokenDocument({ uuid: `Scene.${scene.id}.Token.follower`, id: "follower", scene });
  Object.assign(follower, { x: 200, y: 0, elevation: 0, width: 1, height: 1 });
  scene.tokens.set(leader.id, leader);
  scene.tokens.set(follower.id, follower);
  globalThis.fromUuid = async (uuid) => uuid === leader.uuid ? leader : uuid === follower.uuid ? follower : null;

  const relationship = {
    id: "relationship-reanchor",
    sceneId: scene.id,
    leaderUuid: leader.uuid,
    followerUuid: follower.uuid,
    attachmentMode: "grappleFollower",
    followerCanSelfMove: false,
    coordinationPolicy: RELATIONSHIP_COORDINATION_POLICIES.COORDINATED,
    forcedLeaderMovementPolicy: RELATIONSHIP_FORCED_LEADER_MOVEMENT_POLICIES.INDEPENDENT,
    coordinationDistance: 10,
    breakDistance: 10
  };
  let removed = false;
  const updates = [];
  const fakeRelationships = {
    list: () => removed ? [] : [structuredClone(relationship)],
    get: (id) => !removed && id === relationship.id ? structuredClone(relationship) : null,
    getForLeader: (uuid) => !removed && uuid === leader.uuid ? [structuredClone(relationship)] : [],
    getForFollower: (uuid) => !removed && uuid === follower.uuid ? [structuredClone(relationship)] : [],
    async removeManyAsGM(ids) {
      if ([...ids].includes(relationship.id)) removed = true;
      return removed ? 1 : 0;
    },
    async updateGeometryAsGM(id, changes) {
      assert.equal(id, relationship.id);
      updates.push(structuredClone(changes));
      if (Object.hasOwn(changes, "coordinationDistance")) relationship.coordinationDistance = changes.coordinationDistance;
      if (Object.hasOwn(changes, "breakDistance")) relationship.breakDistance = changes.breakDistance;
      return structuredClone(relationship);
    }
  };
  const handlers = new Map();
  const consumers = [];
  const fakeSocket = {
    register(name, handler) { handlers.set(name, handler); },
    async executeAsGM(name, request) { return handlers.get(name)(request); }
  };
  const fakeMovement = {
    registerConsumer(config) { consumers.push(config); return () => {}; },
    createOperationOptions(metadata) { return { actionEffects5e: metadata }; },
    registerMovementContext() { return () => {}; }
  };

  const { RelationshipMovementService } = await import("../scripts/relationships/relationship-movement-service.js");
  const service = new RelationshipMovementService({ socket: fakeSocket, relationships: fakeRelationships, movement: fakeMovement });
  service.initialize();
  const followerConsumer = consumers.find((config) => config.execution === "initiator" && config.tokenUuids?.includes(follower.uuid));
  assert.ok(followerConsumer);

  const forceFollower = async ({ x, y }) => {
    const origin = { x: follower.x, y: follower.y, elevation: follower.elevation };
    follower.x = x;
    follower.y = y;
    await followerConsumer.handler(MovementTransaction.synthetic({
      subjectUuid: follower.uuid,
      sceneId: scene.id,
      tokenId: follower.id,
      phase: MOVEMENT_PHASES.AFTER,
      origin,
      destination: { x, y, elevation: follower.elevation },
      agency: MOVEMENT_AGENCIES.FORCED,
      resource: MOVEMENT_RESOURCES.NONE
    }), { movement: null });
  };

  await forceFollower({ x: 100, y: 0 });
  assert.equal(removed, false);
  assert.equal(relationship.coordinationDistance, 5, "A legal forced move from the 10-foot band to 5 feet should re-anchor future coordination to 5 feet.");

  await forceFollower({ x: 200, y: 0 });
  assert.equal(removed, false);
  assert.equal(relationship.coordinationDistance, 10, "A legal forced move back to the 10-foot band should re-anchor future coordination to 10 feet.");

  const updateCountBeforeOverlap = updates.length;
  await forceFollower({ x: 0, y: 0 });
  assert.equal(removed, false);
  assert.equal(updates.length, updateCountBeforeOverlap, "A zero-distance overlap should not become the persistent coordination band.");
  assert.equal(relationship.coordinationDistance, 10);

  await forceFollower({ x: 300, y: 0 });
  assert.equal(removed, true, "Forced movement beyond the 10-foot maximum reach should detach the relationship.");
  assert.equal(relationship.coordinationDistance, 10, "Detachment should not persist an out-of-range coordination band.");
  assert.deepEqual(updates, [{ coordinationDistance: 5 }, { coordinationDistance: 10 }]);

  service.shutdown();
  game.scenes.delete(scene.id);
  globalThis.fromUuid = previousFromUuid;
  globalThis.ui = previousUi;
});
