import assert from "node:assert/strict";
import test from "node:test";

import {
  MOVEMENT_AGENCIES,
  OPERATION_METADATA_KEY,
  PATH_TYPES
} from "../scripts/core/constants.js";
import {
  DEFAULT_VOLUNTARY_MOVEMENT_RESTRICTION_MESSAGE,
  VoluntaryMovementRestrictionPolicy
} from "../scripts/movement/voluntary-movement-restriction-policy.js";

globalThis.CONFIG = {
  Token: {
    movement: {
      actions: new Map([
        ["walk", { teleport: false }],
        ["blink", { teleport: true }],
        ["action-effects-5e.no-cost", { teleport: false }]
      ])
    }
  }
};

function makeEffect({
  id = "restricted",
  enabled = true,
  message = "You are Entangled by Magical Vines, and are restrained. You cannot move",
  priority = 0,
  disabled = false,
  suppressed = false
} = {}) {
  return {
    id,
    uuid: `Actor.target.ActiveEffect.${id}`,
    name: id,
    disabled,
    isSuppressed: suppressed,
    flags: {
      "action-effects-5e": {
        movement: {
          voluntaryRestriction: { enabled, message, priority }
        }
      }
    }
  };
}

function makeToken(effects = [makeEffect()]) {
  return {
    uuid: "Scene.test.Token.target",
    actor: { uuid: "Actor.target", effects }
  };
}

function movement(action = "walk") {
  return {
    destination: { x: 100, y: 0, elevation: 0, action },
    passed: { waypoints: [{ x: 100, y: 0, elevation: 0, action }] }
  };
}

function operation(metadata = null) {
  return metadata ? { [OPERATION_METADATA_KEY]: metadata } : {};
}

test("native untagged walk is denied when an active restriction exists", () => {
  const policy = new VoluntaryMovementRestrictionPolicy();
  const result = policy.evaluate({ document: makeToken(), movement: movement("walk"), operation: {} });
  assert.equal(result.blocked, true);
  assert.equal(result.message, "You are Entangled by Magical Vines, and are restrained. You cannot move");
});

test("explicit voluntary relationship leader movement remains denied", () => {
  const policy = new VoluntaryMovementRestrictionPolicy();
  const token = makeToken();
  const result = policy.evaluate({
    document: token,
    movement: movement("walk"),
    operation: operation({
      agency: MOVEMENT_AGENCIES.VOLUNTARY,
      relationshipMovement: true,
      leaderUuid: token.uuid,
      internal: true,
      generatedBy: "action-effects-5e"
    })
  });
  assert.equal(result.blocked, true);
});

test("forced movement is allowed", () => {
  const policy = new VoluntaryMovementRestrictionPolicy();
  const result = policy.evaluate({
    document: makeToken(),
    movement: movement("action-effects-5e.no-cost"),
    operation: operation({ agency: MOVEMENT_AGENCIES.FORCED })
  });
  assert.equal(result.blocked, false);
  assert.equal(result.reason, "agency:forced");
});

test("compelled movement is allowed because the policy restricts voluntary movement only", () => {
  const policy = new VoluntaryMovementRestrictionPolicy();
  const result = policy.evaluate({
    document: makeToken(),
    movement: movement("action-effects-5e.no-cost"),
    operation: operation({ agency: MOVEMENT_AGENCIES.COMPELLED })
  });
  assert.equal(result.blocked, false);
});

test("passenger movement is allowed", () => {
  const policy = new VoluntaryMovementRestrictionPolicy();
  const result = policy.evaluate({
    document: makeToken(),
    movement: movement("action-effects-5e.no-cost"),
    operation: operation({ agency: MOVEMENT_AGENCIES.PASSENGER })
  });
  assert.equal(result.blocked, false);
});

test("grapple/relationship follower movement is allowed even if an older caller leaves agency unknown", () => {
  const policy = new VoluntaryMovementRestrictionPolicy();
  const token = makeToken();
  const result = policy.evaluate({
    document: token,
    movement: movement("action-effects-5e.no-cost"),
    operation: operation({
      agency: MOVEMENT_AGENCIES.UNKNOWN,
      relationshipMovement: true,
      leaderUuid: "Scene.test.Token.grappler"
    })
  });
  assert.equal(result.blocked, false);
  assert.equal(result.reason, "relationship-follower");
});

test("administrative movement is allowed", () => {
  const policy = new VoluntaryMovementRestrictionPolicy();
  const result = policy.evaluate({
    document: makeToken(),
    movement: movement("action-effects-5e.no-cost"),
    operation: operation({ agency: MOVEMENT_AGENCIES.ADMINISTRATIVE, administrative: true })
  });
  assert.equal(result.blocked, false);
  assert.equal(result.reason, "administrative");
});

test("Foundry teleport movement action is allowed without AE5E metadata", () => {
  const policy = new VoluntaryMovementRestrictionPolicy();
  const result = policy.evaluate({ document: makeToken(), movement: movement("blink"), operation: {} });
  assert.equal(result.blocked, false);
  assert.equal(result.reason, "teleport");
});

test("AE5E pathType teleport is allowed", () => {
  const policy = new VoluntaryMovementRestrictionPolicy();
  const result = policy.evaluate({
    document: makeToken(),
    movement: movement("walk"),
    operation: operation({ pathType: PATH_TYPES.TELEPORT })
  });
  assert.equal(result.blocked, false);
});

test("disabled or suppressed restriction effects are ignored", () => {
  const policy = new VoluntaryMovementRestrictionPolicy();
  const disabled = policy.evaluate({ document: makeToken([makeEffect({ disabled: true })]), movement: movement(), operation: {} });
  const suppressed = policy.evaluate({ document: makeToken([makeEffect({ suppressed: true })]), movement: movement(), operation: {} });
  assert.equal(disabled.blocked, false);
  assert.equal(disabled.restricted, false);
  assert.equal(suppressed.blocked, false);
  assert.equal(suppressed.restricted, false);
});

test("boolean restriction shorthand uses the generic default message", () => {
  const policy = new VoluntaryMovementRestrictionPolicy();
  const effect = {
    id: "simple",
    uuid: "Actor.target.ActiveEffect.simple",
    flags: { "action-effects-5e": { movement: { voluntaryRestriction: true } } }
  };
  const result = policy.evaluate({ document: makeToken([effect]), movement: movement(), operation: {} });
  assert.equal(result.blocked, true);
  assert.equal(result.message, DEFAULT_VOLUNTARY_MOVEMENT_RESTRICTION_MESSAGE);
});

test("highest-priority active restriction supplies the denial message", () => {
  const policy = new VoluntaryMovementRestrictionPolicy();
  const result = policy.evaluate({
    document: makeToken([
      makeEffect({ id: "low", priority: 1, message: "Low" }),
      makeEffect({ id: "high", priority: 10, message: "High" })
    ]),
    movement: movement(),
    operation: {}
  });
  assert.equal(result.blocked, true);
  assert.equal(result.message, "High");
});
