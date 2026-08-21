import assert from "node:assert/strict";
import test from "node:test";

import {
  MOVEMENT_AGENCIES,
  MOVEMENT_RESOURCES,
  OPERATION_METADATA_KEY,
  PATH_TYPES
} from "../scripts/core/constants.js";
import {
  CatMovementAdapter,
  CAT_TELEPORT_MOVEMENT_MODE
} from "../scripts/integrations/cat-movement-adapter.js";
import { VoluntaryMovementRestrictionPolicy } from "../scripts/movement/voluntary-movement-restriction-policy.js";

let randomCounter = 0;
globalThis.foundry = {
  utils: {
    deepClone: (value) => structuredClone(value),
    randomID: (length = 16) => String(++randomCounter).padStart(length, "0")
  }
};

class ValueCollection extends Map {
  [Symbol.iterator]() {
    return this.values();
  }
}

function installGame({ isGM = true, catActive = true } = {}) {
  const users = new ValueCollection();
  const current = { id: isGM ? "gm-1" : "player-1", isGM, active: true };
  const gm = isGM ? current : { id: "gm-1", isGM: true, active: true };
  users.set(current.id, current);
  users.set(gm.id, gm);
  globalThis.game = {
    user: current,
    users,
    modules: new Map([["cat", { active: catActive, version: "0.0.7" }]])
  };
  return { users, current, gm };
}

function catAccessor({ withEvent = false } = {}) {
  class MovementEvent {
    async run() {
      return undefined;
    }
  }
  return () => ({
    utils: { tokenUtils: { moveToken: async () => true } },
    lib: withEvent ? { Events: { MovementEvent } } : { Events: {} }
  });
}

function teleportEvent({ pass = "preTeleport", destination = { x: 100, y: 200 }, tokenUuid = "Scene.scene.Token.target" } = {}) {
  return {
    pass,
    teleport: true,
    destination,
    token: {
      uuid: tokenUuid,
      parent: { id: "scene" }
    }
  };
}

function displaceMovement({ id = "movement-teleport", x = 100, y = 200 } = {}) {
  return {
    id,
    destination: { x, y, elevation: 0, action: "displace" },
    passed: { waypoints: [{ x, y, elevation: 0, action: "displace" }] }
  };
}

function restrictedToken() {
  return {
    uuid: "Scene.scene.Token.target",
    actor: {
      effects: [{
        id: "entangled",
        uuid: "Actor.target.ActiveEffect.entangled",
        name: "Entangled",
        flags: {
          "action-effects-5e": {
            movement: {
              voluntaryRestriction: {
                enabled: true,
                message: "You are Entangled by Magical Vines, and are restrained. You cannot move"
              }
            }
          }
        }
      }]
    }
  };
}

globalThis.CONFIG = {
  Token: {
    movement: {
      actions: new Map([
        ["walk", { teleport: false }],
        ["displace", { teleport: false }],
        ["catForce", { teleport: false, measure: false }]
      ])
    }
  }
};

test("CAT preTeleport semantics classify the following displace movement as AE5E teleport", async () => {
  installGame();
  const adapter = new CatMovementAdapter({ catAccessor: catAccessor() });
  await adapter.observeCatMovementEvent(teleportEvent());

  const movement = displaceMovement();
  const enriched = adapter.enrichOperation({ document: restrictedToken(), movement, operation: {} });
  const metadata = enriched[OPERATION_METADATA_KEY];

  assert.equal(metadata.pathType, PATH_TYPES.TELEPORT);
  assert.equal(metadata.teleport, true);
  assert.equal(metadata.agency, MOVEMENT_AGENCIES.UNKNOWN);
  assert.equal(metadata.resource, MOVEMENT_RESOURCES.NONE);
  assert.equal(metadata.movementMode, CAT_TELEPORT_MOVEMENT_MODE);
  assert.equal(metadata.nativeMovementAction, "displace");
  assert.equal(metadata.interoperabilityProvider, "cat");
  assert.equal(metadata.catTeleport, true);
  assert.equal(metadata.externalMovementSemantics, true);

  await adapter.observeCatMovementEvent(teleportEvent({ pass: "postTeleport" }));
  const postEnriched = adapter.enrichOperation({ document: restrictedToken(), movement, operation: {} });
  assert.equal(postEnriched[OPERATION_METADATA_KEY].pathType, PATH_TYPES.TELEPORT);
  assert.equal(adapter.getStats().recognizedExternalTeleports, 1);
});

test("CAT teleport classification passes the reusable voluntary-movement restriction policy", async () => {
  installGame();
  const adapter = new CatMovementAdapter({ catAccessor: catAccessor() });
  const token = restrictedToken();
  const movement = displaceMovement();
  await adapter.observeCatMovementEvent(teleportEvent());
  const operation = adapter.enrichOperation({ document: token, movement, operation: {} });

  const decision = new VoluntaryMovementRestrictionPolicy().evaluate({ document: token, movement, operation });
  assert.equal(decision.blocked, false);
  assert.equal(decision.reason, "teleport");
});

test("cancelled CAT preTeleport and mismatched destinations do not relabel ordinary displace movement", async () => {
  installGame();
  const cancelled = new CatMovementAdapter({ catAccessor: catAccessor() });
  await cancelled.observeCatMovementEvent(teleportEvent(), { result: true });
  assert.equal(cancelled.enrichOperation({
    document: restrictedToken(),
    movement: displaceMovement({ id: "cancelled" }),
    operation: {}
  })[OPERATION_METADATA_KEY], undefined);
  assert.equal(cancelled.getStats().cancelledTeleportsObserved, 1);

  const mismatched = new CatMovementAdapter({ catAccessor: catAccessor() });
  await mismatched.observeCatMovementEvent(teleportEvent({ destination: { x: 100, y: 200 } }));
  assert.equal(mismatched.enrichOperation({
    document: restrictedToken(),
    movement: displaceMovement({ id: "other", x: 300, y: 400 }),
    operation: {}
  })[OPERATION_METADATA_KEY], undefined);
});

test("player CAT teleport semantics are socketed as plain temporary context to active GMs", async () => {
  const { gm } = installGame({ isGM: false });
  const registrations = new Map();
  const calls = [];
  const socket = {
    ready: true,
    register(name, handler) {
      registrations.set(name, handler);
    },
    async executeForUsers(name, userIds, payload) {
      calls.push({ name, userIds, payload });
      return true;
    }
  };
  const adapter = new CatMovementAdapter({ catAccessor: catAccessor(), socket });
  adapter.initialize();

  await adapter.observeCatMovementEvent(teleportEvent());
  assert.equal(registrations.has("interoperability.cat.teleport.begin"), true);
  assert.equal(registrations.has("interoperability.cat.teleport.end"), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "interoperability.cat.teleport.begin");
  assert.deepEqual(calls[0].userIds, [gm.id]);
  assert.equal(calls[0].payload.tokenUuid, "Scene.scene.Token.target");
  assert.deepEqual(calls[0].payload.destination, { x: 100, y: 200 });
  assert.equal(typeof calls[0].payload.contextId, "string");
  assert.equal(calls[0].payload.token, undefined);

  await adapter.observeCatMovementEvent(teleportEvent({ pass: "postTeleport" }));
  assert.equal(calls.length, 2);
  assert.equal(calls[1].name, "interoperability.cat.teleport.end");
  assert.equal(calls[1].payload.tokenUuid, "Scene.scene.Token.target");

  // Simulate the active GM receiving those same plain-data socket messages.
  // The remote client must be able to classify CAT's GM-executed displace move
  // as the same AE5E teleport without receiving a live Token/Event object.
  installGame({ isGM: true });
  const remoteRegistrations = new Map();
  const remote = new CatMovementAdapter({
    catAccessor: catAccessor(),
    socket: {
      ready: true,
      register(name, handler) { remoteRegistrations.set(name, handler); },
      async executeForUsers() {}
    }
  });
  remote.initialize();
  assert.equal(remoteRegistrations.get(calls[0].name)(calls[0].payload), true);
  const remoteOperation = remote.enrichOperation({
    document: restrictedToken(),
    movement: displaceMovement({ id: "gm-query-teleport" }),
    operation: {}
  });
  assert.equal(remoteOperation[OPERATION_METADATA_KEY].pathType, PATH_TYPES.TELEPORT);
  assert.equal(remoteOperation[OPERATION_METADATA_KEY].catTeleport, true);
  assert.equal(remoteRegistrations.get(calls[1].name)(calls[1].payload), true);
  assert.equal(remote.getStatus().teleportLifecycle.pendingContexts, 0);
});

test("CAT teleport lifecycle integration registers one narrow MovementEvent.run wrapper", () => {
  installGame();
  const previousLibWrapper = globalThis.libWrapper;
  const registrations = [];
  globalThis.libWrapper = {
    register(moduleId, target, wrapper, type) {
      registrations.push({ moduleId, target, wrapper, type });
      return 42;
    },
    unregister() {}
  };
  try {
    const adapter = new CatMovementAdapter({ catAccessor: catAccessor({ withEvent: true }) });
    const status = adapter.initialize();
    assert.equal(registrations.length, 1);
    assert.equal(registrations[0].moduleId, "action-effects-5e");
    assert.equal(registrations[0].target, "cat.lib.Events.MovementEvent.prototype.run");
    assert.equal(registrations[0].type, "WRAPPER");
    assert.equal(status.teleportLifecycle.wrapperRegistered, true);
    assert.equal(status.teleportLifecycle.compatibilityAvailable, true);
    adapter.shutdown();
  } finally {
    globalThis.libWrapper = previousLibWrapper;
  }
});
