import assert from "node:assert/strict";
import test from "node:test";

import { MODULE_ID, MOVEMENT_AGENCIES } from "../scripts/core/constants.js";
import { PersistentAreaEventService } from "../scripts/environment/persistent-area-event-service.js";

class FakeSocket {
  constructor() { this.handlers = new Map(); this.userCalls = []; }
  register(name, handler) { this.handlers.set(name, handler); }
  async executeAsUser(name, userId, payload) {
    this.userCalls.push({ name, userId, payload });
    return this.handlers.get(name)(payload);
  }
}

function makeBehavior(service, recipe, documents, id = "area-behavior") {
  const built = service.buildBehavior({ instanceId: "fixture-area", recipe, name: "Generic Fixture" });
  assert.equal(built.built, true);
  const behavior = {
    documentName: "RegionBehavior",
    id,
    uuid: `Scene.test.Region.area.RegionBehavior.${id}`,
    system: structuredClone(built.behavior.system),
    async update(data) {
      if (data["system.stateJson"] !== undefined) this.system.stateJson = data["system.stateJson"];
      return this;
    }
  };
  documents.set(behavior.uuid, behavior);
  return { behavior, built };
}

function setupGlobals(documents) {
  globalThis.CONST = {
    REGION_EVENTS: {
      TOKEN_MOVE_IN: "tokenMoveIn",
      TOKEN_MOVE_WITHIN: "tokenMoveWithin",
      TOKEN_ENTER: "tokenEnter",
      TOKEN_EXIT: "tokenExit",
      TOKEN_TURN_START: "tokenTurnStart",
      TOKEN_TURN_END: "tokenTurnEnd"
    }
  };
  globalThis.fromUuid = async uuid => documents.get(uuid) ?? null;
  let randomCounter = 0;
  globalThis.foundry = {
    utils: {
      deepClone: value => structuredClone(value),
      randomID: () => `test-random-${++randomCounter}`
    }
  };
}

test("PersistentAreaEventService builds a generic recipe without spell-specific assumptions", () => {
  const documents = new Map();
  setupGlobals(documents);
  const socket = new FakeSocket();
  const service = new PersistentAreaEventService({
    socket,
    authority: { getPrimaryGm: () => ({ id: "gm" }) },
    activities: { execute: async () => ({ executed: true }) }
  });

  const recipe = {
    schemaVersion: 1,
    gates: { primary: { combat: "turn", outsideCombat: "occupancy" } },
    handlers: {
      tokenMoveIn: {
        gateId: "primary",
        activity: { itemUuid: "Item.fixture", activityReference: "Fixture Check" }
      },
      tokenMoveWithin: {
        gateId: "primary",
        activity: { itemUuid: "Item.fixture", activityReference: "Fixture Check" }
      }
    }
  };

  const result = service.buildBehavior({ recipe, instanceId: "fixture" });
  assert.equal(result.built, true);
  assert.equal(result.behavior.type, `${MODULE_ID}.persistent-area`);
  assert.deepEqual(new Set(result.behavior.system.events), new Set(["tokenMoveIn", "tokenMoveWithin", "tokenExit"]));
  assert.equal(JSON.parse(result.behavior.system.recipeJson).handlers.tokenMoveIn.activity.activityReference, "Fixture Check");
  assert.equal(JSON.stringify(result).toLowerCase().includes("web"), false);
});

test("PersistentAreaEventService executes a configured Activity once per combat turn and can stop voluntary movement on failure", async () => {
  const previousGame = globalThis.game;
  const documents = new Map();
  setupGlobals(documents);
  const socket = new FakeSocket();
  let executions = 0;
  const service = new PersistentAreaEventService({
    socket,
    authority: { getPrimaryGm: () => ({ id: "gm" }) },
    activities: {
      execute: async request => {
        executions += 1;
        return { executed: true, failedSaves: [request.targetTokenUuids[0]], saves: [] };
      }
    }
  });
  const recipe = {
    schemaVersion: 1,
    gates: { check: { combat: "turn", outsideCombat: "none" } },
    handlers: {
      tokenMoveWithin: {
        gateId: "check",
        activity: { itemUuid: "Item.fixture", activityReference: "Fixture Check" },
        movement: { pause: true, stopOn: "failure", agencies: [MOVEMENT_AGENCIES.VOLUNTARY] }
      }
    }
  };
  const { behavior } = makeBehavior(service, recipe, documents);
  globalThis.game = {
    user: { id: "gm", isGM: true },
    users: [{ id: "gm", active: true, isGM: true }],
    combat: { uuid: "Combat.one", started: true, round: 2, turn: 3 }
  };
  let paused = 0;
  let resumed = 0;
  let stopped = 0;
  const token = {
    uuid: "Scene.test.Token.target",
    pauseMovement() { paused += 1; return async () => { resumed += 1; }; },
    stopMovement() { stopped += 1; }
  };
  const event = {
    name: "tokenMoveWithin",
    user: { id: "gm", isSelf: true },
    data: {
      token,
      movement: {
        id: "move-1",
        method: "dragging",
        updateOptions: { actionEffects5e: { agency: MOVEMENT_AGENCIES.VOLUNTARY } }
      }
    }
  };

  try {
    const first = await service.handleRegionEvent(behavior, event);
    assert.equal(first.handled, true);
    assert.equal(first.outcome, "failure");
    assert.equal(first.stopMovement, true);
    assert.equal(executions, 1);
    assert.equal(paused, 1);
    assert.equal(stopped, 1);
    assert.equal(resumed, 0);

    const second = await service.handleRegionEvent(behavior, {
      ...event,
      data: { ...event.data, movement: { ...event.data.movement, id: "move-2" } }
    });
    assert.equal(second.gated, true);
    assert.equal(executions, 1);
    assert.equal(stopped, 1);
    assert.equal(resumed, 1);
  } finally {
    globalThis.game = previousGame;
  }
});

test("PersistentAreaEventService supports one check per continuous occupancy outside combat and resets on exit", async () => {
  const previousGame = globalThis.game;
  const documents = new Map();
  setupGlobals(documents);
  const socket = new FakeSocket();
  let executions = 0;
  const idempotencyKeys = [];
  const service = new PersistentAreaEventService({
    socket,
    authority: { getPrimaryGm: () => ({ id: "gm" }) },
    activities: {
      execute: async request => {
        executions += 1;
        idempotencyKeys.push(request.idempotencyKey);
        return { executed: true, saves: [request.targetTokenUuids[0]], failedSaves: [] };
      }
    }
  });
  const recipe = {
    schemaVersion: 1,
    gates: { occupancy: { combat: "none", outsideCombat: "occupancy" } },
    handlers: {
      tokenMoveIn: {
        gateId: "occupancy",
        activity: { itemUuid: "Item.fixture", activityReference: "Fixture Check" }
      },
      tokenMoveWithin: {
        gateId: "occupancy",
        activity: { itemUuid: "Item.fixture", activityReference: "Fixture Check" }
      }
    }
  };
  const { behavior, built } = makeBehavior(service, recipe, documents);
  assert.equal(built.behavior.system.events.includes("tokenExit"), true);
  globalThis.game = {
    user: { id: "gm", isGM: true },
    users: [{ id: "gm", active: true, isGM: true }],
    combat: null
  };
  const token = { uuid: "Scene.test.Token.target" };
  const makeEvent = (name, movementId = null) => ({
    name,
    user: { id: "gm", isSelf: true },
    data: { token, ...(movementId ? { movement: { id: movementId, method: "dragging", updateOptions: {} } } : {}) }
  });

  try {
    const first = await service.handleRegionEvent(behavior, makeEvent("tokenMoveWithin", "move-1"));
    assert.equal(first.handled, true);
    assert.equal(executions, 1);

    const second = await service.handleRegionEvent(behavior, makeEvent("tokenMoveWithin", "move-2"));
    assert.equal(second.gated, true);
    assert.equal(executions, 1);

    const exit = await service.handleRegionEvent(behavior, makeEvent("tokenExit"));
    assert.equal(exit.occupancyReset, true);

    const reentry = await service.handleRegionEvent(behavior, makeEvent("tokenMoveIn", "move-3"));
    assert.equal(reentry.handled, true);
    assert.equal(executions, 2);
    assert.equal(idempotencyKeys.length, 2);
    assert.notEqual(
      idempotencyKeys[0],
      idempotencyKeys[1],
      "A new continuous occupancy must receive a fresh Activity idempotency key."
    );
  } finally {
    globalThis.game = previousGame;
  }
});


test("PersistentAreaEventService rejects recipe event names that Foundry cannot emit", () => {
  const documents = new Map();
  setupGlobals(documents);
  const service = new PersistentAreaEventService({
    socket: new FakeSocket(),
    authority: { getPrimaryGm: () => ({ id: "gm" }) },
    activities: { execute: async () => ({ executed: true }) }
  });
  const validation = service.validateRecipe({
    schemaVersion: 1,
    gates: {},
    handlers: { imaginaryEvent: { activity: { itemUuid: "Item.fixture", activityReference: "Fixture Check" } } }
  });
  assert.equal(validation.valid, false);
  assert.equal(validation.errors.includes("handler-imaginaryEvent-unsupported-event"), true);
});

test("PersistentAreaEventService ignores Region events the Item did not configure", async () => {
  const previousGame = globalThis.game;
  const documents = new Map();
  setupGlobals(documents);
  const socket = new FakeSocket();
  let executions = 0;
  const service = new PersistentAreaEventService({
    socket,
    authority: { getPrimaryGm: () => ({ id: "gm" }) },
    activities: { execute: async () => { executions += 1; return { executed: true }; } }
  });
  const { behavior } = makeBehavior(service, {
    schemaVersion: 1,
    gates: {},
    handlers: {
      tokenMoveWithin: { activity: { itemUuid: "Item.fixture", activityReference: "Fixture Check" } }
    }
  }, documents);
  globalThis.game = { user: { id: "gm", isGM: true }, users: [{ id: "gm", active: true, isGM: true }], combat: null };
  const token = { uuid: "Scene.test.Token.target", pauseMovement() { throw new Error("should not pause"); } };

  try {
    const result = await service.handleRegionEvent(behavior, {
      name: "tokenEnter",
      user: { id: "gm", isSelf: true },
      data: { token }
    });
    assert.equal(result.handled, false);
    assert.equal(result.reason, "unconfigured-event");
    assert.equal(executions, 0);
  } finally {
    globalThis.game = previousGame;
  }
});

test("PersistentAreaEventService composes generic owned-effect conditions and failure lifecycle operations", async () => {
  const previousGame = globalThis.game;
  const documents = new Map();
  setupGlobals(documents);
  const socket = new FakeSocket();
  const calls = { apply: [], remove: [], has: [] };
  const lifecycle = {
    async hasOwnedEffect(options) { calls.has.push(options); return { found: false }; },
    async applyEffectTemplate(options) { calls.apply.push(options); return { created: true, effectUuid: "Actor.target.ActiveEffect.fixture" }; },
    async removeOwnedEffects(options) { calls.remove.push(options); return { removed: true, removedCount: 1 }; }
  };
  const service = new PersistentAreaEventService({
    socket,
    authority: { getPrimaryGm: () => ({ id: "gm" }) },
    activities: { execute: async request => ({ executed: true, failedSaves: [request.targetTokenUuids[0]], saves: [] }) },
    lifecycle
  });
  const recipe = {
    schemaVersion: 1,
    gates: { primary: { combat: "turn", outsideCombat: "occupancy" } },
    handlers: {
      tokenMoveWithin: {
        gateId: "primary",
        conditions: [{ type: "ownedEffect", effectKey: "fixture-restraint", exists: false }],
        activity: { itemUuid: "Item.fixture", activityReference: "Fixture Save" },
        operations: [{
          type: "applyEffectTemplate",
          when: "failure",
          templateEffectUuid: "Item.fixture.ActiveEffect.template",
          effectKey: "fixture-restraint",
          originUuid: "Item.fixture",
          metadata: { owner: "$ownerUuid", token: "$tokenUuid" },
          effectPatch: { flags: { fixture: { regionUuid: "$ownerUuid", behaviorUuid: "$behaviorUuid" } } }
        }]
      },
      tokenExit: {
        operations: [{ type: "removeOwnedEffects", when: "always", effectKey: "fixture-restraint" }]
      }
    }
  };
  const built = service.buildBehavior({ instanceId: "fixture-instance", recipe });
  const region = { uuid: "Scene.test.Region.area" };
  const behavior = {
    uuid: "Scene.test.Region.area.RegionBehavior.fixture",
    parent: region,
    region,
    system: structuredClone(built.behavior.system),
    async update(data) { if (data["system.stateJson"] !== undefined) this.system.stateJson = data["system.stateJson"]; }
  };
  documents.set(behavior.uuid, behavior);
  globalThis.game = { user: { id: "gm", isGM: true }, users: [{ id: "gm", active: true, isGM: true }], combat: null };
  const token = { uuid: "Scene.test.Token.target" };

  try {
    const move = await service.handleRegionEvent(behavior, {
      name: "tokenMoveWithin",
      user: { id: "gm", isSelf: true },
      data: { token, movement: { id: "m1", method: "dragging", updateOptions: {} } }
    });
    assert.equal(move.outcome, "failure");
    assert.equal(calls.has.length, 1);
    assert.equal(calls.apply.length, 1);
    assert.equal(calls.apply[0].ownerUuid, region.uuid);
    assert.equal(calls.apply[0].ownerInstanceId, "fixture-instance");
    assert.equal(calls.apply[0].targetTokenUuid, token.uuid);
    assert.deepEqual(calls.apply[0].metadata, { owner: region.uuid, token: token.uuid });
    assert.equal(calls.apply[0].effectPatch.flags.fixture.regionUuid, region.uuid);
    assert.equal(calls.apply[0].effectPatch.flags.fixture.behaviorUuid, behavior.uuid);

    const exit = await service.handleRegionEvent(behavior, {
      name: "tokenExit",
      user: { id: "gm", isSelf: true },
      data: { token }
    });
    assert.equal(exit.handled, true);
    assert.equal(calls.remove.length, 1);
    assert.equal(calls.remove[0].ownerUuid, region.uuid);
    assert.equal(calls.remove[0].effectKey, "fixture-restraint");
    assert.equal(calls.remove[0].targetTokenUuid, token.uuid);
  } finally {
    globalThis.game = previousGame;
  }
});

test("PersistentAreaEventService can claim a gate then skip its Activity when a configured owned effect already exists", async () => {
  const previousGame = globalThis.game;
  const documents = new Map();
  setupGlobals(documents);
  let executions = 0;
  const service = new PersistentAreaEventService({
    socket: new FakeSocket(),
    authority: { getPrimaryGm: () => ({ id: "gm" }) },
    activities: { execute: async () => { executions += 1; return { executed: true }; } },
    lifecycle: { hasOwnedEffect: async () => ({ found: true }) }
  });
  const { behavior } = makeBehavior(service, {
    schemaVersion: 1,
    gates: { turn: { combat: "turn", outsideCombat: "none" } },
    handlers: {
      tokenTurnStart: {
        gateId: "turn",
        conditions: [{ type: "ownedEffect", effectKey: "fixture", exists: false }],
        activity: { itemUuid: "Item.fixture", activityReference: "Fixture Check" }
      }
    }
  }, documents);
  behavior.parent = { uuid: "Scene.test.Region.area" };
  globalThis.game = { user: { id: "gm", isGM: true }, users: [{ id: "gm", active: true, isGM: true }], combat: { uuid: "Combat.one", started: true, round: 1, turn: 2 } };
  try {
    const result = await service.handleRegionEvent(behavior, {
      name: "tokenTurnStart",
      user: { id: "gm", isSelf: true },
      data: { token: { uuid: "Scene.test.Token.target" } }
    });
    assert.equal(result.skipped, true);
    assert.equal(executions, 0);
    assert.match(result.gateKey, /^combat:/);
  } finally {
    globalThis.game = previousGame;
  }
});

test("PersistentAreaEventService validates tokenCenterInOwnerRegion as a generic event qualifier", () => {
  const documents = new Map();
  setupGlobals(documents);
  const service = new PersistentAreaEventService({
    socket: new FakeSocket(),
    authority: { getPrimaryGm: () => ({ id: "gm" }) },
    activities: { execute: async () => ({ executed: true }) }
  });

  const valid = service.validateRecipe({
    schemaVersion: 1,
    gates: {},
    handlers: {
      tokenMoveWithin: {
        conditions: [{ type: "tokenCenterInOwnerRegion", inside: true }],
        activity: { itemUuid: "Item.fixture", activityReference: "Fixture Check" }
      }
    }
  });
  assert.equal(valid.valid, true, valid.errors?.join(", "));

  const invalid = service.validateRecipe({
    schemaVersion: 1,
    gates: {},
    handlers: {
      tokenMoveWithin: {
        conditions: [{ type: "tokenCenterInOwnerRegion", inside: "yes" }],
        activity: { itemUuid: "Item.fixture", activityReference: "Fixture Check" }
      }
    }
  });
  assert.equal(invalid.valid, false);
  assert.equal(
    invalid.errors.includes("handler-tokenMoveWithin-condition-0-inside-must-be-boolean"),
    true
  );
});

test("tokenCenterInOwnerRegion skips an exiting move-within before consuming the combat-turn gate", async () => {
  const previousGame = globalThis.game;
  const previousCanvas = globalThis.canvas;
  const documents = new Map();
  setupGlobals(documents);

  const socket = new FakeSocket();
  let executions = 0;
  const geometry = {
    fromRegion: region => region,
    fromToken: token => ({ shapes: [{ type: "point", x: token.x + 50, y: token.y + 50 }] }),
    containsPoint: (_region, point) => point.x >= 0 && point.x < 400 && point.y >= 0 && point.y < 400
  };
  const service = new PersistentAreaEventService({
    socket,
    authority: { getPrimaryGm: () => ({ id: "gm" }) },
    activities: {
      execute: async request => {
        executions += 1;
        return { executed: true, saves: [request.targetTokenUuids[0]], failedSaves: [] };
      }
    },
    geometry
  });

  const recipe = {
    schemaVersion: 1,
    gates: { turn: { combat: "turn", outsideCombat: "none" } },
    handlers: {
      tokenMoveWithin: {
        gateId: "turn",
        conditions: [{ type: "tokenCenterInOwnerRegion", inside: true }],
        activity: { itemUuid: "Item.fixture", activityReference: "Fixture Check" }
      },
      tokenMoveIn: {
        gateId: "turn",
        activity: { itemUuid: "Item.fixture", activityReference: "Fixture Check" }
      }
    }
  };

  const { behavior } = makeBehavior(service, recipe, documents);
  const region = { uuid: "Scene.test.Region.area" };
  behavior.parent = region;
  behavior.region = region;

  const scene = { documentName: "Scene", grid: { size: 100 } };
  const token = {
    documentName: "Token",
    uuid: "Scene.test.Token.target",
    x: 100,
    y: 100,
    width: 1,
    height: 1,
    elevation: 0,
    parent: scene
  };
  documents.set(token.uuid, token);

  globalThis.canvas = { grid: { size: 100 } };
  globalThis.game = {
    user: { id: "gm", isGM: true },
    users: [{ id: "gm", active: true, isGM: true }],
    combat: { uuid: "Combat.one", started: true, round: 1, turn: 1 }
  };

  const makeEvent = (name, movementId, destination) => ({
    name,
    user: { id: "gm", isSelf: true },
    data: {
      token,
      movement: {
        id: movementId,
        method: "dragging",
        destination,
        updateOptions: {}
      }
    }
  });

  try {
    // Foundry may emit tokenMoveWithin for the inside portion of a path whose
    // final destination is outside. The qualifier must reject this event.
    const exiting = await service.handleRegionEvent(
      behavior,
      makeEvent("tokenMoveWithin", "exit-path", { x: 500, y: 100, elevation: 0 })
    );
    assert.equal(exiting.handled, true);
    assert.equal(exiting.skipped, true);
    assert.equal(exiting.reason, "condition-failed");
    assert.equal(executions, 0);
    assert.deepEqual(JSON.parse(behavior.system.stateJson), { gates: {} });

    // Because the false move-within did not consume the turn gate, a legitimate
    // re-entry during the same combat turn remains eligible.
    const reentry = await service.handleRegionEvent(
      behavior,
      makeEvent("tokenMoveIn", "reentry-path", { x: 100, y: 100, elevation: 0 })
    );
    assert.equal(reentry.handled, true);
    assert.equal(reentry.gated, undefined);
    assert.equal(executions, 1);
  } finally {
    globalThis.game = previousGame;
    globalThis.canvas = previousCanvas;
  }
});

test("tokenCenterInOwnerRegion allows genuine movement whose final token center remains inside", async () => {
  const previousGame = globalThis.game;
  const previousCanvas = globalThis.canvas;
  const documents = new Map();
  setupGlobals(documents);

  let executions = 0;
  const service = new PersistentAreaEventService({
    socket: new FakeSocket(),
    authority: { getPrimaryGm: () => ({ id: "gm" }) },
    activities: {
      execute: async request => {
        executions += 1;
        return { executed: true, saves: [request.targetTokenUuids[0]], failedSaves: [] };
      }
    },
    geometry: {
      fromRegion: region => region,
      fromToken: token => ({ shapes: [{ type: "point", x: token.x + 50, y: token.y + 50 }] }),
      containsPoint: (_region, point) => point.x >= 0 && point.x < 400 && point.y >= 0 && point.y < 400
    }
  });

  const { behavior } = makeBehavior(service, {
    schemaVersion: 1,
    gates: {},
    handlers: {
      tokenMoveWithin: {
        conditions: [{ type: "tokenCenterInOwnerRegion", inside: true }],
        activity: { itemUuid: "Item.fixture", activityReference: "Fixture Check" }
      }
    }
  }, documents);
  const region = { uuid: "Scene.test.Region.area" };
  behavior.parent = region;
  behavior.region = region;

  const scene = { documentName: "Scene", grid: { size: 100 } };
  const token = {
    documentName: "Token",
    uuid: "Scene.test.Token.target",
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    elevation: 0,
    parent: scene
  };
  documents.set(token.uuid, token);

  globalThis.canvas = { grid: { size: 100 } };
  globalThis.game = {
    user: { id: "gm", isGM: true },
    users: [{ id: "gm", active: true, isGM: true }],
    combat: null
  };

  try {
    const result = await service.handleRegionEvent(behavior, {
      name: "tokenMoveWithin",
      user: { id: "gm", isSelf: true },
      data: {
        token,
        movement: {
          id: "inside-path",
          method: "dragging",
          destination: { x: 200, y: 100, elevation: 0 },
          updateOptions: {}
        }
      }
    });
    assert.equal(result.handled, true);
    assert.equal(result.skipped, undefined);
    assert.equal(executions, 1);
  } finally {
    globalThis.game = previousGame;
    globalThis.canvas = previousCanvas;
  }
});
