import assert from "node:assert/strict";
import test from "node:test";
import { MOVEMENT_AGENCIES, OPERATION_METADATA_KEY } from "../scripts/core/constants.js";
import { MovementService } from "../scripts/movement/movement-service.js";

function restrictionEffect(message = "Blocked by test") {
  return {
    id: "restrict",
    uuid: "Actor.a.ActiveEffect.restrict",
    flags: { "action-effects-5e": { movement: { voluntaryRestriction: { enabled: true, message } } } }
  };
}

function setupGlobals() {
  const callbacks = new Map();
  const notices = [];
  globalThis.game = {
    user: { id: "user", isGM: false },
    settings: { get: (_module, key) => key === "movementEnabled" }
  };
  globalThis.ui = { notifications: { warn: message => notices.push(message) } };
  globalThis.CONFIG = { Token: { movement: { actions: new Map([["walk", { teleport: false }], ["blink", { teleport: true }]]) } } };
  globalThis.Hooks = {
    on(name, fn) { callbacks.set(name, fn); return name; },
    off() {},
    call() { return true; },
    callAll() {}
  };
  return { callbacks, notices };
}

function makeService() {
  const registry = {
    register() {}, unregister() {}, getStats: () => ({}), hasPotentialInterest: () => false,
    dispatchSync: () => true, dispatch: async () => true
  };
  const relationships = { involves: () => false };
  const catMovement = { enrichOperation: ({ operation }) => operation };
  return new MovementService({ registry, relationships, catMovement });
}

function token() {
  return { uuid: "Scene.s.Token.t", actor: { effects: [restrictionEffect()] } };
}

function move(action = "walk") {
  return { id: "m1", destination: { action }, passed: { waypoints: [{ action }] } };
}

test("preMoveToken restriction runs before the normal no-interest fast path", () => {
  const { callbacks, notices } = setupGlobals();
  const service = makeService();
  service.initialize();
  const result = callbacks.get("preMoveToken")(token(), move("walk"), {});
  assert.equal(result, false);
  assert.deepEqual(notices, ["Blocked by test"]);
});

test("forced movement is not cancelled by the restriction hook", () => {
  const { callbacks, notices } = setupGlobals();
  const service = makeService();
  service.initialize();
  const result = callbacks.get("preMoveToken")(
    token(),
    move("walk"),
    { [OPERATION_METADATA_KEY]: { agency: MOVEMENT_AGENCIES.FORCED } }
  );
  assert.equal(result, undefined);
  assert.deepEqual(notices, []);
});

test("teleport action is not cancelled by the restriction hook", () => {
  const { callbacks, notices } = setupGlobals();
  const service = makeService();
  service.initialize();
  const result = callbacks.get("preMoveToken")(token(), move("blink"), {});
  assert.equal(result, undefined);
  assert.deepEqual(notices, []);
});
