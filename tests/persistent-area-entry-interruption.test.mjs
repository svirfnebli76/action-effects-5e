import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  MODULE_ID,
  OPERATION_METADATA_KEY,
  PATH_TYPES,
  PERSISTENT_AREA_ENTRY_PLANS_KEY
} from "../scripts/core/constants.js";
import { PersistentAreaEntryInterruptionService } from "../scripts/environment/persistent-area-entry-interruption-service.js";

function setupGlobals() {
  globalThis.CONST = {
    REGION_EVENTS: {
      TOKEN_MOVE_IN: "tokenMoveIn"
    }
  };
  let randomCounter = 0;
  globalThis.foundry = { utils: { randomID: () => `entry-random-${++randomCounter}` } };
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
}

function fixture({ entryInterruption = true } = {}) {
  setupGlobals();
  const region = {
    uuid: "Scene.s.Region.area",
    hidden: false,
    behaviors: []
  };
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
  const service = new PersistentAreaEntryInterruptionService({ events });

  const token = {
    uuid: "Scene.s.Token.t",
    x: 3600,
    y: 2200,
    elevation: 0,
    width: 1,
    height: 1,
    parent: { regions: [region] },
    getCompleteMovementPath(waypoints) {
      const [origin, endpoint] = waypoints;
      const result = [{ ...origin, snapped: true }];
      const direction = Math.sign(Number(endpoint.x) - Number(origin.x));
      if (Number(origin.y) === Number(endpoint.y) && direction !== 0) {
        for (let x = Number(origin.x) + 100 * direction; direction > 0 ? x < Number(endpoint.x) : x > Number(endpoint.x); x += 100 * direction) {
          result.push({ x, y: Number(origin.y), elevation: Number(origin.elevation ?? 0), action: endpoint.action ?? "walk", snapped: true });
        }
      }
      result.push({ ...endpoint, snapped: endpoint.snapped !== false });
      return result;
    },
    getSnappedPosition(position) {
      return {
        x: Math.round(Number(position.x) / 100) * 100,
        y: Math.round(Number(position.y) / 100) * 100,
        elevation: Number(position.elevation ?? 0)
      };
    },
    testInsideRegion(candidateRegion, position) {
      assert.equal(candidateRegion, region);
      // The first complete 1x1 grid position inside this fixture is x=3300.
      return Number(position.x) <= 3300 && Number(position.x) >= 3000;
    }
  };

  return { service, token, region, behavior };
}

function planFrom(result, tokenUuid) {
  return result.options?.[OPERATION_METADATA_KEY]?.[PERSISTENT_AREA_ENTRY_PLANS_KEY]?.[tokenUuid] ?? null;
}

test("entry interruption preplans a long drag at the first complete native interior grid position", () => {
  const { service, token } = fixture();
  const result = service.prepareMove(
    token,
    { x: 3100, y: 2200, elevation: 0, action: "walk", snapped: true },
    { method: "dragging" }
  );

  assert.equal(result.planned, true);
  assert.ok(Array.isArray(result.waypoints));
  assert.deepEqual(
    result.waypoints.map(point => ({ x: point.x, checkpoint: point.checkpoint === true })),
    [
      { x: 3300, checkpoint: true },
      { x: 3100, checkpoint: false }
    ]
  );
  assert.notEqual(result.waypoints[0].x, 3200, "The old .25 next-pending-waypoint stop must not survive.");

  const plan = planFrom(result, token.uuid);
  assert.equal(plan.entries.length, 1);
  assert.equal(plan.entries[0].position.x, 3300);
  assert.equal(plan.entries[0].teleport, false);
  assert.equal(plan.entries[0].sourceDestination.x, 3100);
});

test("entry interruption converts an observed unsnapped Region boundary into the first native snapped interior position", () => {
  const { service, token } = fixture();

  // Reproduce the important shape of the live Web diagnostic: Foundry can
  // expose an unsnapped geometric Region boundary before a later snapped
  // waypoint. The infrastructure must not mistake that later waypoint for the
  // first complete square.
  token.getCompleteMovementPath = ([origin, endpoint]) => [
    { ...origin, snapped: true },
    { x: 3500, y: 2200, elevation: 0, action: "walk", snapped: true },
    { x: 3349, y: 2200, elevation: 0, action: "walk", snapped: false },
    { x: 3200, y: 2200, elevation: 0, action: "walk", snapped: true },
    { ...endpoint, snapped: true }
  ];
  token.getSnappedPosition = position => ({
    x: Number(position.x) === 3349 ? 3300 : Math.round(Number(position.x) / 100) * 100,
    y: 2200,
    elevation: 0
  });
  token.testInsideRegion = (_region, position) => Number(position.x) <= 3349 && Number(position.x) >= 3000;

  const result = service.prepareMove(
    token,
    { x: 3100, y: 2200, elevation: 0, action: "walk", snapped: true },
    { method: "dragging" }
  );

  assert.equal(result.planned, true);
  assert.equal(result.waypoints[0].x, 3300);
  assert.equal(result.waypoints[0].checkpoint, true);
  assert.equal(planFrom(result, token.uuid).entries[0].position.x, 3300);
});

test("entry interruption marks a one-square arrow destination as the hold checkpoint without inventing another move", () => {
  const { service, token } = fixture();
  const result = service.prepareMove(
    token,
    { x: 3300, y: 2200, elevation: 0, action: "walk", snapped: true },
    { method: "keyboard" }
  );

  assert.equal(result.planned, true);
  assert.equal(Array.isArray(result.waypoints), false);
  assert.equal(result.waypoints.x, 3300);
  assert.equal(result.waypoints.checkpoint, true);
  assert.equal(planFrom(result, token.uuid).entries[0].position.x, 3300);
});

test("teleport-style entry resolves at its real destination and never fabricates traversed interior squares", () => {
  const { service, token } = fixture();
  let completePathCalls = 0;
  token.getCompleteMovementPath = () => {
    completePathCalls += 1;
    throw new Error("teleport must not expand a traversed path");
  };

  const result = service.prepareMove(
    token,
    { x: 3100, y: 2200, elevation: 0, action: "blink", snapped: true },
    {
      method: "teleport",
      [OPERATION_METADATA_KEY]: { pathType: PATH_TYPES.TELEPORT }
    }
  );

  assert.equal(result.planned, true);
  assert.equal(completePathCalls, 0);
  assert.equal(Array.isArray(result.waypoints), false);
  assert.equal(result.waypoints.x, 3100);
  assert.equal(result.waypoints.checkpoint, true);
  const entry = planFrom(result, token.uuid).entries[0];
  assert.equal(entry.position.x, 3100);
  assert.equal(entry.teleport, true);
});

test("unrelated Regions and AE5E persistent areas that do not opt in remain untouched", () => {
  const { service, token } = fixture({ entryInterruption: false });
  const input = { x: 3100, y: 2200, elevation: 0, action: "walk", snapped: true };
  const options = { method: "dragging" };
  const result = service.prepareMove(token, input, options);
  assert.equal(result.planned, false);
  assert.equal(result.reason, "no-entry-interruption-regions");
  assert.equal(result.waypoints, input);
  assert.equal(result.options, options);
});

test(".26 source contains none of the experimental .25 stop-and-relaunch waypoint policy", () => {
  const source = [
    fs.readFileSync(new URL("../scripts/environment/persistent-area-entry-interruption-service.js", import.meta.url), "utf8"),
    fs.readFileSync(new URL("../scripts/environment/persistent-area-event-service.js", import.meta.url), "utf8")
  ].join("\n");

  assert.doesNotMatch(source, /nextSnappedWaypoint/);
  assert.doesNotMatch(source, /persistentAreaSettlements/);
  assert.doesNotMatch(source, /pauseAt/);
});

test("entry-interruption infrastructure is initialized at module startup and exposed only as generic persistent-area diagnostics", () => {
  const startup = fs.readFileSync(new URL("../scripts/action-effects-5e.js", import.meta.url), "utf8");
  const api = fs.readFileSync(new URL("../scripts/api.js", import.meta.url), "utf8");

  assert.match(startup, /import\s+\{\s*PersistentAreaEntryInterruptionService\s*\}/);
  assert.match(startup, /new\s+PersistentAreaEntryInterruptionService\s*\(\s*\{[\s\S]*?events:\s*persistentAreaEvents/);
  assert.match(startup, /persistentAreaEntryInterruption\.initialize\(\)/);
  assert.match(startup, /new\s+MovementService\s*\(\s*\{[\s\S]*?socket[\s\S]*?\}\s*\)/);
  assert.match(api, /getEntryInterruptionStats:\s*\(\)\s*=>\s*persistentAreaEntryInterruption/);
  assert.doesNotMatch(api, /\bweb\s*=/i);
});
