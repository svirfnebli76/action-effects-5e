import test from "node:test";
import assert from "node:assert/strict";
import { Crosshair3dGeometryService } from "../scripts/crosshairs3d/geometry-service.js";
import { Crosshair3dCellRasterizerService } from "../scripts/crosshairs3d/cell-rasterizer-service.js";
import { Crosshair3dPropagationService } from "../scripts/crosshairs3d/propagation-service.js";
import { Crosshair3dFoundryPropagationEnvironment } from "../scripts/crosshairs3d/foundry-propagation-environment.js";

const geometry = new Crosshair3dGeometryService();
const cells = new Crosshair3dCellRasterizerService({ geometry });
const propagation = new Crosshair3dPropagationService({ cells, geometry });
const grid = { distance: 5 };
const key = cell => `${cell.x},${cell.y},${cell.z}`;
const keys = list => new Set(list.map(key));
const sameMask = (a, b) => assert.deepEqual(keys(a), keys(b));
const clearSpread = {
  seedOpen: () => true,
  sharedFace: () => ({ largestContiguousFraction: 1 })
};

function sourceLine({ yaw = 0, pitch = 0 } = {}) {
  return { type: "line", origin: { x: 0, y: 0, z: 0 }, length: 60, width: 5, yaw, pitch };
}

function freeLine({ yaw = 0 } = {}) {
  return { type: "free-line", origin: { x: 0, y: 0, z: 0 }, length: 60, width: 5, height: 20, yaw };
}

function cone({ pitch = 0 } = {}) {
  return { type: "cone", origin: { x: 0, y: 0, z: 0 }, length: 15, yaw: 0, pitch };
}

async function spreadResult(shape, environment = clearSpread) {
  return propagation.resolve({ shape, grid, mode: "spread", environment });
}

const foundryEnvironment = new Crosshair3dFoundryPropagationEnvironment({
  metricsService: { resolve: () => ({}) },
  geometry,
  cooperateEvery: 1000000
});
const clearDirect = foundryEnvironment.create({ scene: {}, metrics: {}, collision: () => false });

test("Source-driven Line Spread preserves every affected cell across non-cardinal yaw", async () => {
  for (const yaw of [0, 15, 30, 45, 60, 75, 90]) {
    const shape = sourceLine({ yaw });
    const expected = cells.rasterize(shape, { grid }).cells;
    const result = await spreadResult(shape);
    sameMask(result.cells, expected);
  }
});

test("Source-driven Line Spread preserves every affected cell while pitched", async () => {
  for (const pitch of [15, 30, 45, 60]) {
    const shape = sourceLine({ pitch });
    const expected = cells.rasterize(shape, { grid }).cells;
    const result = await spreadResult(shape);
    sameMask(result.cells, expected);
  }
});

test("Freely Placed Line Spread preserves every affected cell across non-cardinal yaw", async () => {
  for (const yaw of [0, 15, 30, 45, 60, 75, 90]) {
    const shape = freeLine({ yaw });
    const expected = cells.rasterize(shape, { grid }).cells;
    const result = await spreadResult(shape);
    sameMask(result.cells, expected);
  }
});

test("Pitched Cone Spread seeds through traversal support and reaches every affected cell", async () => {
  for (const pitch of [0, 15, 30, 45, 60, 75, 90]) {
    const shape = cone({ pitch });
    const expected = cells.rasterize(shape, { grid }).cells;
    const result = await spreadResult(shape);
    sameMask(result.cells, expected);
    assert.ok(result.stats.seedQueries > 0, `pitch ${pitch} must have at least one physical seed query`);
  }
});

test("Spread traversal-only support cells never become affected output cells", async () => {
  const shape = sourceLine({ yaw: 45 });
  const affected = cells.rasterize(shape, { grid }).cells;
  const support = cells.rasterize(shape, {
    grid,
    threshold: 1e-6,
    epsilon: 1e-9,
    zSamples: 33
  }).cells;
  assert.ok(support.length > affected.length, "test requires traversal-only support cells");

  const result = await spreadResult(shape);
  sameMask(result.cells, affected);
  assert.equal(result.cells.some(cell => !keys(affected).has(key(cell))), false);
});

test("A full blocking wall plane interrupts a 45-degree Line support path", async () => {
  const shape = sourceLine({ yaw: 45 });
  const result = await spreadResult(shape, {
    seedOpen: () => true,
    sharedFace: ({ cell, next, axis }) => {
      const crossesWall = axis === "x"
        && ((cell.x === 0 && next.x === 1) || (cell.x === 1 && next.x === 0));
      return { largestContiguousFraction: crossesWall ? 0 : 1 };
    }
  });

  assert.deepEqual(keys(result.cells), new Set(["0,0,-1", "0,0,0"]));
});

test("Spread never jumps diagonally when every orthogonal shared face is closed", async () => {
  const shape = sourceLine({ yaw: 45 });
  const result = await spreadResult(shape, {
    seedOpen: () => true,
    sharedFace: () => ({ largestContiguousFraction: 0 })
  });
  assert.deepEqual(keys(result.cells), new Set(["0,0,-1", "0,0,0"]));
});

test("Foundry Direct clear-space sampling preserves every normally qualifying pitched Cone cell", async () => {
  for (const pitch of [15, 30, 45, 60, 75, 90]) {
    const shape = cone({ pitch });
    const expected = cells.rasterize(shape, { grid }).cells;
    const result = await propagation.resolve({ shape, grid, mode: "direct", environment: clearDirect });
    sameMask(result.cells, expected);
  }
});

test("Horizontal Cone apex 25-percent exception remains subject to Direct's independent 50-percent rule", async () => {
  const shape = cone({ pitch: 0 });
  const affected = cells.rasterize(shape, { grid }).cells;
  const result = await propagation.resolve({ shape, grid, mode: "direct", environment: clearDirect });
  assert.equal(affected.length, 16);
  assert.equal(result.cells.length, 12);
  assert.equal(result.cells.every(cell => keys(affected).has(key(cell))), true);
  assert.deepEqual(
    [...keys(affected)].filter(cellKey => !keys(result.cells).has(cellKey)).sort(),
    ["0,-1,-1", "0,-1,0", "0,0,-1", "0,0,0"].sort()
  );
});
