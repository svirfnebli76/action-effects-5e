import test from "node:test";
import assert from "node:assert/strict";

import { RegionCellStateService } from "../scripts/regions/region-cell-state-service.js";
import { RegionOccupancyService } from "../scripts/regions/region-occupancy-service.js";
import { RegionCellMovementCostService } from "../scripts/regions/region-cell-movement-cost-service.js";
import { PersistentAreaEntryInterruptionService } from "../scripts/environment/persistent-area-entry-interruption-service.js";
import { MovementAccountingService } from "../scripts/movement/movement-accounting-service.js";
import {
  MODULE_ID,
  REGION_CELL_FLAG,
  MOVEMENT_AGENCIES,
  MOVEMENT_RESOURCES,
  PATH_TYPES
} from "../scripts/core/constants.js";

function getProperty(object, path) {
  return String(path).split(".").reduce((value, part) => value?.[part], object);
}

function makeCoreFixture({ config, completePath = null } = {}) {
  globalThis.foundry = {
    utils: {
      deepClone: value => structuredClone(value),
      getProperty,
      randomID: length => "R".repeat(length ?? 16)
    }
  };
  globalThis.CONST = {
    REGION_EVENTS: {
      TOKEN_MOVE_IN: "tokenMoveIn",
      TOKEN_MOVE_WITHIN: "tokenMoveWithin"
    }
  };
  const gm = { id: "gm", isGM: true, active: true };
  globalThis.game = { user: gm, users: [gm] };

  const socket = { register() {}, ready: true };
  const authority = { getPrimaryGm: () => gm, getStatus: () => ({ primaryGmUserId: gm.id }) };
  const regions = { isOwned: () => true };
  const cells = new RegionCellStateService({ socket, authority, regions });
  const occupancy = new RegionOccupancyService({ cells });
  const scene = { grid: { size: 100, distance: 5 }, regions: [], tokens: new Map() };
  const region = {
    uuid: "Scene.scene.Region.cell",
    documentName: "Region",
    parent: scene,
    flags: { [MODULE_ID]: {} },
    behaviors: [],
    getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
  };
  if (config) region.flags[MODULE_ID][REGION_CELL_FLAG] = cells.normalizeConfig(config);
  scene.regions.push(region);

  const token = {
    uuid: "Scene.scene.Token.mover",
    id: "mover",
    parent: scene,
    x: 0,
    y: 0,
    elevation: 0,
    width: 1,
    height: 1,
    depth: 1,
    testInsideRegion() { throw new Error("native containment must not decide cell-backed movement"); },
    getCompleteMovementPath(waypoints) {
      if (typeof completePath === "function") return completePath(waypoints);
      return waypoints;
    }
  };
  scene.tokens.set(token.id, token);
  return { cells, occupancy, scene, region, token };
}

function cellConfig({ size = { x: 5, y: 1, z: 1 }, cells = {}, defaultState = "GONE" } = {}) {
  return {
    bounds: { min: { x: 0, y: 0, z: 0 }, size },
    defaultState,
    cells,
    frame: { type: "static", origin: { x: 0, y: 0, elevation: 0 }, rotation: 0 }
  };
}

function makePersistentPlanner({ occupancy, region, behavior, recipe }) {
  region.behaviors.push(behavior);
  const events = { getRecipe: candidate => candidate === behavior ? recipe : null };
  return new PersistentAreaEntryInterruptionService({ events, movement: null, occupancy });
}

function routePoints(from, to, { stepX = 100, stepY = 0, stepZ = 0 } = {}) {
  const points = [{ ...from, snapped: true }];
  let current = { ...from };
  while (current.x !== to.x || current.y !== to.y || current.elevation !== to.elevation) {
    current = {
      ...current,
      x: current.x === to.x ? current.x : current.x + Math.sign(to.x - current.x) * Math.min(Math.abs(to.x - current.x), Math.abs(stepX || to.x - current.x)),
      y: current.y === to.y ? current.y : current.y + Math.sign(to.y - current.y) * Math.min(Math.abs(to.y - current.y), Math.abs(stepY || to.y - current.y)),
      elevation: current.elevation === to.elevation ? current.elevation : current.elevation + Math.sign(to.elevation - current.elevation) * Math.min(Math.abs(to.elevation - current.elevation), Math.abs(stepZ || to.elevation - current.elevation)),
      snapped: true
    };
    points.push(current);
  }
  return points;
}

const entryRecipe = {
  handlers: {
    tokenMoveIn: { movement: { entryInterruption: true, pause: true, stopOn: "failure" } }
  }
};

function movementTransaction(origin, destination, overrides = {}) {
  return {
    origin,
    destination,
    movementId: "movement-1",
    pathType: PATH_TYPES.TRAVERSE,
    agency: MOVEMENT_AGENCIES.VOLUNTARY,
    resource: MOVEMENT_RESOURCES.MOVEMENT,
    ...overrides
  };
}

test("cell-backed entry planning uses Foundry complete snapped path and catches inactive-to-active inside one broad Region", () => {
  const fixture = makeCoreFixture({
    config: cellConfig({ cells: { "2,0,0": "ACTIVE" } }),
    completePath: ([from, to]) => routePoints(from, to, { stepX: 100 })
  });
  const behavior = { uuid: "Scene.scene.Region.cell.RegionBehavior.entry", type: `${MODULE_ID}.persistent-area`, disabled: false };
  const planner = makePersistentPlanner({ occupancy: fixture.occupancy, region: fixture.region, behavior, recipe: entryRecipe });
  const origin = { x: 0, y: 0, elevation: 0, snapped: true };
  const destination = { x: 300, y: 0, elevation: 0, snapped: true };
  const result = planner.planMovement(fixture.token, { pending: { waypoints: [destination] }, destination, method: "dragging" }, movementTransaction(origin, destination));

  assert.equal(result.planned, true);
  assert.deepEqual(result.plan.entries.map(entry => entry.position.x), [200]);
  assert.equal(result.waypoints.find(point => point.x === 200)?.checkpoint, true);
  assert.equal(fixture.occupancy.getStats().nativeQueries, 0);
  assert.ok(fixture.occupancy.getStats().cellQueries > 0);
});

test("burned tunnel produces separate active entries with a GONE settled cell between them", () => {
  const fixture = makeCoreFixture({
    config: cellConfig({ cells: { "1,0,0": "ACTIVE", "3,0,0": "ACTIVE" } }),
    completePath: ([from, to]) => routePoints(from, to, { stepX: 100 })
  });
  const behavior = { uuid: "Scene.scene.Region.cell.RegionBehavior.entry", type: `${MODULE_ID}.persistent-area`, disabled: false };
  const planner = makePersistentPlanner({ occupancy: fixture.occupancy, region: fixture.region, behavior, recipe: entryRecipe });
  const origin = { x: 0, y: 0, elevation: 0, snapped: true };
  const destination = { x: 300, y: 0, elevation: 0, snapped: true };
  const result = planner.planMovement(fixture.token, { pending: { waypoints: [destination] }, destination, method: "api" }, movementTransaction(origin, destination));

  assert.equal(result.planned, true);
  assert.deepEqual(result.plan.entries.map(entry => entry.position.x), [100, 300]);
  assert.equal(result.waypoints.find(point => point.x === 200)?.checkpoint, false, "GONE tunnel waypoint must not become an entry checkpoint");
});

test("movement beginning ACTIVE can leave through GONE and trigger only on re-entry", () => {
  const fixture = makeCoreFixture({
    config: cellConfig({ cells: { "0,0,0": "ACTIVE", "2,0,0": "ACTIVE" } }),
    completePath: ([from, to]) => routePoints(from, to, { stepX: 100 })
  });
  const behavior = { uuid: "Scene.scene.Region.cell.RegionBehavior.entry", type: `${MODULE_ID}.persistent-area`, disabled: false };
  const planner = makePersistentPlanner({ occupancy: fixture.occupancy, region: fixture.region, behavior, recipe: entryRecipe });
  const origin = { x: 0, y: 0, elevation: 0, snapped: true };
  const destination = { x: 200, y: 0, elevation: 0, snapped: true };
  const result = planner.planMovement(fixture.token, { pending: { waypoints: [destination] }, destination }, movementTransaction(origin, destination));
  assert.equal(result.planned, true);
  assert.deepEqual(result.plan.entries.map(entry => entry.position.x), [200]);
});

test("diagonal, vertical, and simultaneous XYZ complete-path entries are cell-aware", () => {
  for (const scenario of [
    {
      name: "diagonal",
      config: cellConfig({ size: { x: 2, y: 2, z: 1 }, cells: { "1,1,0": "ACTIVE" } }),
      destination: { x: 100, y: 100, elevation: 0, snapped: true },
      steps: { stepX: 100, stepY: 100, stepZ: 0 }
    },
    {
      name: "vertical",
      config: cellConfig({ size: { x: 1, y: 1, z: 3 }, cells: { "0,0,1": "ACTIVE" } }),
      destination: { x: 0, y: 0, elevation: 10, snapped: true },
      steps: { stepX: 0, stepY: 0, stepZ: 5 }
    },
    {
      name: "xyz",
      config: cellConfig({ size: { x: 2, y: 2, z: 2 }, cells: { "1,1,1": "ACTIVE" } }),
      destination: { x: 100, y: 100, elevation: 5, snapped: true },
      steps: { stepX: 100, stepY: 100, stepZ: 5 }
    }
  ]) {
    const fixture = makeCoreFixture({ config: scenario.config, completePath: ([from, to]) => routePoints(from, to, scenario.steps) });
    const behavior = { uuid: `Scene.scene.Region.cell.RegionBehavior.${scenario.name}`, type: `${MODULE_ID}.persistent-area`, disabled: false };
    const planner = makePersistentPlanner({ occupancy: fixture.occupancy, region: fixture.region, behavior, recipe: entryRecipe });
    const origin = { x: 0, y: 0, elevation: 0, snapped: true };
    const result = planner.planMovement(fixture.token, { pending: { waypoints: [scenario.destination] }, destination: scenario.destination }, movementTransaction(origin, scenario.destination, { agency: MOVEMENT_AGENCIES.FORCED }));
    assert.equal(result.planned, true, scenario.name);
    assert.equal(result.plan.entries.length, 1, scenario.name);
    assert.deepEqual(
      [result.plan.entries[0].position.x, result.plan.entries[0].position.y, result.plan.entries[0].position.elevation],
      [scenario.name === "vertical" ? 0 : 100, scenario.name === "vertical" ? 0 : 100, scenario.name === "diagonal" ? 0 : 5],
      scenario.name
    );
  }
});

test("analytic cell tracer reports exact positive-overlap transition intervals without sampling", () => {
  const fixture = makeCoreFixture({ config: cellConfig({ cells: { "2,0,0": "ACTIVE" } }) });
  const tiny = { ...fixture.token, width: 0.1, height: 0.1, depth: 1 };
  const trace = fixture.cells.traceTokenSegment(fixture.region, tiny, {
    from: { x: 0, y: 0, elevation: 0 },
    to: { x: 400, y: 0, elevation: 0 }
  });
  assert.equal(trace.traced, true);
  assert.equal(trace.intervals.length, 1);
  assert.ok(Math.abs(trace.intervals[0].start - 0.475) < 1e-6, trace.intervals);
  assert.ok(Math.abs(trace.intervals[0].end - 0.75) < 1e-6, trace.intervals);
});

test("cell-aware movement cost marks only ACTIVE settled steps and explicitly restores cost through a burned hole", () => {
  const fixture = makeCoreFixture({ config: cellConfig({ cells: { "1,0,0": "ACTIVE", "3,0,0": "ACTIVE" } }) });
  const registered = new Map();
  let counter = 0;
  const accounting = {
    ensureRegistered() {},
    registerFinalCostModifier(id, config) { const slot = `${MODULE_ID}.cost-slot-${++counter}`; registered.set(slot, { id, ...config }); return slot; },
    unregisterFinalCostModifier(slot) { return registered.delete(slot); }
  };
  globalThis.CONFIG = { Token: { movement: { defaultAction: "walk" } } };
  const costs = new RegionCellMovementCostService({ occupancy: fixture.occupancy, accounting });
  const instruction = {
    waypoints: [
      { x: 100, y: 0, elevation: 0, snapped: true, action: "walk" },
      { x: 200, y: 0, elevation: 0, snapped: true },
      { x: 300, y: 0, elevation: 0, snapped: true }
    ]
  };
  const release = costs.applyToInstruction({ region: fixture.region, token: fixture.token, instruction, states: ["ACTIVE"], multiplier: 2, id: "terrain-test" });

  assert.match(instruction.waypoints[0].action, /^action-effects-5e\.cost-slot-/);
  assert.equal(instruction.waypoints[1].action, "walk", "GONE step must explicitly restore base action instead of inheriting terrain cost");
  assert.equal(instruction.waypoints[2].action, instruction.waypoints[0].action, "same base action reuses one temporary modifier slot");
  assert.equal(registered.size, 1);
  const modifier = registered.values().next().value.modifier;
  assert.equal(modifier({ nativeCost: 5 }), 10);
  release();
  assert.equal(registered.size, 0);
});

test("cell-aware cost classification uses full large-Token occupancy, not only its top-left cell", () => {
  const fixture = makeCoreFixture({
    config: cellConfig({ size: { x: 4, y: 2, z: 2 }, cells: { "2,0,0": "ACTIVE" } })
  });
  fixture.token.width = 2;
  fixture.token.height = 2;
  fixture.token.depth = 2;
  const costs = new RegionCellMovementCostService({ occupancy: fixture.occupancy, accounting: {} });
  const classification = costs.classifyInstruction({
    region: fixture.region,
    token: fixture.token,
    instruction: { waypoints: [{ x: 100, y: 0, elevation: 0, snapped: true }] },
    states: ["ACTIVE"]
  });
  assert.equal(classification[0].costly, true, "2x2 token overlaps ACTIVE cell at local x=2 even though top-left is local x=1");
});

test("movement accounting allows temporary cost modifiers to compose through assigned internal slots", () => {
  const actions = new Map([
    ["walk", { label: "Walk", icon: "fa-person-walking", measure: true, costMultiplier: 1, canSelect: true, teleport: false }]
  ]);
  globalThis.CONFIG = { Token: { movement: { actions, defaultAction: "walk" } } };
  globalThis.foundry ??= { utils: { deepClone: value => structuredClone(value) } };
  const accounting = new MovementAccountingService();
  accounting.initialize();
  const first = accounting.registerFinalCostModifier("first", { baseAction: "walk", modifier: ({ nativeCost }) => nativeCost * 2 });
  const second = accounting.registerFinalCostModifier("second", { baseAction: first, modifier: ({ nativeCost }) => nativeCost + 5 });
  const costFunction = actions.get(second).getCostFunction({}, {});
  assert.equal(costFunction(5, { i: 0, j: 0, k: 0 }, { i: 0, j: 1, k: 0 }, 5, {}), 15);
  assert.equal(accounting.unregisterFinalCostModifier(second), true);
  assert.equal(accounting.unregisterFinalCostModifier(first), true);
  accounting.shutdown();
});
