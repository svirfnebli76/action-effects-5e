import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  MODULE_ID,
  MOVEMENT_AGENCIES,
  MOVEMENT_PHASES,
  MOVEMENT_RESOURCES,
  OPERATION_METADATA_KEY,
  PATH_TYPES,
  PERSISTENT_AREA_ENTRY_PLANS_KEY
} from "../scripts/core/constants.js";
import { PersistentAreaEntryInterruptionService } from "../scripts/environment/persistent-area-entry-interruption-service.js";

function setupGlobals() {
  globalThis.CONST = { REGION_EVENTS: { TOKEN_MOVE_IN: "tokenMoveIn" } };
  let randomCounter = 0;
  globalThis.foundry = { utils: { randomID: (length = 16) => (`entryrandom${++randomCounter}`.padEnd(length, "x")).slice(0, length) } };
  globalThis.game = { user: { id: "user" } };
  globalThis.ui = { notifications: { error() {} } };
}

function fixture({ entryInterruption = true } = {}) {
  setupGlobals();
  const region = { uuid: "Scene.s.Region.area", hidden: false, behaviors: [] };
  const behavior = {
    uuid: `${region.uuid}.RegionBehavior.area`,
    type: `${MODULE_ID}.persistent-area`,
    disabled: false
  };
  region.behaviors.push(behavior);

  const recipe = {
    schemaVersion: 1,
    gates: {},
    handlers: {
      tokenMoveIn: {
        movement: { pause: true, entryInterruption },
        activity: { itemUuid: "Item.fixture", activityReference: "Fixture Save" }
      }
    }
  };
  const events = { getRecipe: candidate => candidate === behavior ? recipe : null };
  const calls = { holds: [], contexts: [], moves: [], consumer: null };
  const movementService = {
    registerConsumer(config) { calls.consumer = config; return () => { calls.consumer = null; }; },
    acquireInteractionHold(options) { calls.holds.push({ type: "acquire", ...options }); return { acquired: true }; },
    releaseInteractionHold(options) { calls.holds.push({ type: "release", ...options }); return { released: true }; },
    registerMovementContext(movementId, metadata) {
      calls.contexts.push({ movementId, metadata });
      return () => calls.contexts.push({ movementId, released: true });
    }
  };

  const scene = {
    regions: [region],
    async moveTokens(instructions, options) {
      calls.moves.push({ instructions, options });
      return Object.fromEntries(Object.keys(instructions).map(id => [id, true]));
    }
  };

  const token = {
    id: "t",
    uuid: "Scene.s.Token.t",
    x: 3600,
    y: 2200,
    elevation: 0,
    width: 1,
    height: 1,
    parent: scene,
    testInsideRegion(candidateRegion, position) {
      assert.equal(candidateRegion, region);
      return Number(position.x) <= 3300 && Number(position.x) >= 3000;
    }
  };

  const service = new PersistentAreaEntryInterruptionService({ events, movement: movementService });
  return { service, token, region, behavior, movementService, calls };
}

function nativeDragMovement() {
  return {
    id: "native-drag",
    method: "dragging",
    origin: { x: 3600, y: 2200, elevation: 0, snapped: true },
    destination: { x: 3100, y: 2200, elevation: 0, snapped: true },
    passed: {
      waypoints: [
        { x: 3500, y: 2200, elevation: 0, action: "walk", snapped: true, intermediate: true, checkpoint: false },
        { x: 3400, y: 2200, elevation: 0, action: "walk", snapped: true, intermediate: true, checkpoint: false },
        { x: 3349, y: 2200, elevation: 0, action: "walk", snapped: false, intermediate: true, checkpoint: true },
        { x: 3300, y: 2200, elevation: 0, action: "walk", snapped: true, intermediate: true, checkpoint: false },
        { x: 3200, y: 2200, elevation: 0, action: "walk", snapped: true, intermediate: true, checkpoint: false },
        { x: 3100, y: 2200, elevation: 0, action: "walk", snapped: true, explicit: true, intermediate: false, checkpoint: true }
      ]
    },
    pending: { waypoints: [] }
  };
}

function transactionFor(movement, overrides = {}) {
  return {
    phase: MOVEMENT_PHASES.BEFORE,
    movementId: movement.id,
    origin: movement.origin,
    destination: movement.destination,
    path: [...(movement.passed?.waypoints ?? []), ...(movement.pending?.waypoints ?? [])],
    pathType: PATH_TYPES.TRAVERSE,
    agency: MOVEMENT_AGENCIES.UNKNOWN,
    resource: MOVEMENT_RESOURCES.UNKNOWN,
    movementMode: "walk",
    method: movement.method,
    metadata: {},
    userId: "user",
    ...overrides
  };
}

test("preMoveToken planning uses Foundry's already-expanded route and holds at the first complete native interior square", () => {
  const { service, token } = fixture();
  const movement = nativeDragMovement();
  const result = service.planMovement(token, movement, transactionFor(movement));

  assert.equal(result.planned, true);
  assert.deepEqual(
    result.waypoints.filter(point => point.checkpoint).map(point => point.x),
    [3349, 3300, 3100],
    "AE5E must preserve Foundry's existing boundary/terminal checkpoints and add the first complete interior square"
  );
  const entry = result.plan.entries[0];
  assert.equal(entry.position.x, 3300);
  assert.equal(entry.position.snapped, true);
  assert.equal(entry.sourceDestination.x, 3100);
  assert.equal(entry.teleport, false);
});

test("the planner never mistakes the later native snapped waypoint for the first complete interior square", () => {
  const { service, token } = fixture();
  const movement = nativeDragMovement();
  const result = service.planMovement(token, movement, transactionFor(movement));
  assert.equal(result.plan.entries[0].position.x, 3300);
  assert.notEqual(result.plan.entries[0].position.x, 3200);
});

test("one-step keyboard entry promotes that native destination to the interaction checkpoint", () => {
  const { service, token } = fixture();
  const movement = {
    id: "native-keyboard",
    method: "keyboard",
    origin: { x: 3400, y: 2200, elevation: 0, snapped: true },
    destination: { x: 3300, y: 2200, elevation: 0, snapped: true },
    passed: { waypoints: [{ x: 3300, y: 2200, elevation: 0, action: "walk", snapped: true, checkpoint: true }] },
    pending: { waypoints: [] }
  };
  const result = service.planMovement(token, movement, transactionFor(movement));
  assert.equal(result.planned, true);
  assert.equal(result.waypoints.length, 1);
  assert.equal(result.waypoints[0].x, 3300);
  assert.equal(result.waypoints[0].checkpoint, true);
});

test("teleport-style entry resolves only at its actual destination", () => {
  const { service, token } = fixture();
  const movement = {
    id: "native-blink",
    method: "teleport",
    origin: { x: 3600, y: 2200, elevation: 0, snapped: true },
    destination: { x: 3100, y: 2200, elevation: 0, action: "blink", snapped: true, checkpoint: true },
    passed: { waypoints: [{ x: 3100, y: 2200, elevation: 0, action: "blink", snapped: true, checkpoint: true }] },
    pending: { waypoints: [] }
  };
  const result = service.planMovement(token, movement, transactionFor(movement, { pathType: PATH_TYPES.TELEPORT }));
  assert.equal(result.planned, true);
  assert.equal(result.plan.entries.length, 1);
  assert.equal(result.plan.entries[0].position.x, 3100);
  assert.equal(result.plan.entries[0].teleport, true);
  assert.equal(result.waypoints.length, 1);
});

test("unrelated Regions and persistent areas that do not opt in are untouched", () => {
  const { service, token } = fixture({ entryInterruption: false });
  const movement = nativeDragMovement();
  const result = service.planMovement(token, movement, transactionFor(movement));
  assert.equal(result.planned, false);
  assert.equal(result.reason, "no-entry-interruption-regions");
});

test("the pre-movement consumer cancels only the original UI movement and replays one native Scene.moveTokens route with plan context", async () => {
  const { service, token, calls } = fixture();
  service.initialize();

  assert.equal(calls.consumer.id, `${MODULE_ID}.persistent-area-entry-interruption`);
  assert.deepEqual(calls.consumer.phases, [MOVEMENT_PHASES.BEFORE]);
  assert.equal(calls.consumer.priority > 10_000, true, "entry planning must run before relationship translation of the original UI move");

  const movement = nativeDragMovement();
  const transaction = transactionFor(movement);
  const result = calls.consumer.handler(transaction, { document: token, movement, operation: {} });
  assert.equal(result, false);

  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(calls.moves.length, 1);
  const replay = calls.moves[0];
  const instruction = replay.instructions[token.id];
  assert.equal(instruction.waypoints.find(point => point.x === 3300)?.checkpoint, true);
  assert.equal(instruction.method, "dragging");

  const metadata = replay.options[OPERATION_METADATA_KEY];
  assert.equal(metadata.agency, MOVEMENT_AGENCIES.VOLUNTARY, "ordinary untagged UI movement is normalized to voluntary for outcome stop semantics");
  assert.equal(metadata.persistentAreaEntryReplay, true);
  assert.equal(metadata[PERSISTENT_AREA_ENTRY_PLANS_KEY][token.uuid].entries[0].position.x, 3300);
  assert.equal(calls.holds.filter(call => call.type === "acquire").length, 1);
  assert.equal(calls.holds.filter(call => call.type === "release").length, 1);
  assert.equal(calls.contexts.some(call => call.metadata?.persistentAreaEntryReplay === true), true);
});

test("a replay carrying the exact entry plan bypasses the planner instead of recursively translating itself", () => {
  const { service, token, calls } = fixture();
  service.initialize();
  const movement = nativeDragMovement();
  const base = service.planMovement(token, movement, transactionFor(movement));
  const transaction = transactionFor(movement, {
    metadata: { [PERSISTENT_AREA_ENTRY_PLANS_KEY]: { [token.uuid]: base.plan } }
  });
  assert.equal(calls.consumer.handler(transaction, { document: token, movement, operation: {} }), true);
  assert.equal(service.getStats().bypassedPlannedMovements, 1);
});

test(".27 source contains no .25 settlement policy and no failed .26 TokenDocument.move planner wrapper", () => {
  const source = [
    fs.readFileSync(new URL("../scripts/environment/persistent-area-entry-interruption-service.js", import.meta.url), "utf8"),
    fs.readFileSync(new URL("../scripts/environment/persistent-area-event-service.js", import.meta.url), "utf8")
  ].join("\n");

  assert.doesNotMatch(source, /nextSnappedWaypoint/);
  assert.doesNotMatch(source, /persistentAreaSettlements/);
  assert.doesNotMatch(source, /pauseAt/);
  assert.doesNotMatch(source, /TokenDocument\.prototype\.move/);
  assert.doesNotMatch(source, /TOKEN_MOVE_WRAPPER_TARGET/);
});

test("entry interruption is wired through MovementService rather than a global movement wrapper", () => {
  const startup = fs.readFileSync(new URL("../scripts/action-effects-5e.js", import.meta.url), "utf8");
  const api = fs.readFileSync(new URL("../scripts/api.js", import.meta.url), "utf8");

  assert.match(startup, /new\s+PersistentAreaEntryInterruptionService\s*\(\s*\{[\s\S]*?events:\s*persistentAreaEvents,[\s\S]*?movement/);
  assert.match(startup, /persistentAreaEntryInterruption\.initialize\(\)/);
  assert.match(api, /getEntryInterruptionStats:\s*\(\)\s*=>\s*persistentAreaEntryInterruption/);
  assert.doesNotMatch(api, /\bweb\s*=/i);
});
