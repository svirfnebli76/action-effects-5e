import test from "node:test";
import assert from "node:assert/strict";
import { Crosshair3dGeometryService } from "../scripts/crosshairs3d/geometry-service.js";
import { Crosshair3dCellRasterizerService } from "../scripts/crosshairs3d/cell-rasterizer-service.js";
import { Crosshair3dPropagationService } from "../scripts/crosshairs3d/propagation-service.js";
import { Crosshair3dLineSupportService, obbIntersectsAabbPositiveVolume } from "../scripts/crosshairs3d/line-support-service.js";
import { Crosshair3dFoundryPropagationEnvironment } from "../scripts/crosshairs3d/foundry-propagation-environment.js";

const geometry = new Crosshair3dGeometryService();
const cells = new Crosshair3dCellRasterizerService({ geometry });
const propagation = new Crosshair3dPropagationService({ cells, geometry });
const lineSupport = new Crosshair3dLineSupportService({ cells, geometry });
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

test("Cone Spread is rejected for every pitch instead of being silently remapped", async () => {
  for (const pitch of [0, 15, 30, 45, 60, 75, 90]) {
    await assert.rejects(spreadResult(cone({ pitch })), /Cone does not support Spread propagation/);
  }
});

test("Spread traversal-only support cells never become affected output cells", async () => {
  const shape = sourceLine({ yaw: 45 });
  const affected = cells.rasterize(shape, { grid }).cells;
  const support = lineSupport.rasterize(shape, { grid }).cells;
  assert.ok(support.length > affected.length, "test requires traversal-only support cells");

  const result = await spreadResult(shape);
  sameMask(result.cells, affected);
  assert.equal(result.cells.some(cell => !keys(affected).has(key(cell))), false);
});

test("analytic Source-Line support never loses cells accepted by the v0.4.5.2 sampler across a broad matrix", () => {
  for (const length of [15, 60, 90]) {
    for (const width of [5, 10]) {
      for (const yaw of [0, 15, 30, 45, 60, 75, 90]) {
        for (const pitch of [0, 15, 30, 45, 60, 75, 90]) {
          const shape = { type: "line", origin: { x: 0, y: 0, z: 0 }, length, width, yaw, pitch };
          const sampled = cells.rasterize(shape, { grid, threshold: 1e-6, epsilon: 1e-9, zSamples: 33 }).cells;
          const analytic = keys(lineSupport.rasterize(shape, { grid }).cells);
          for (const cell of sampled) assert.equal(analytic.has(key(cell)), true, `${length}/${width}/${yaw}/${pitch} lost ${key(cell)}`);
        }
      }
    }
  }
});

test("analytic Free-Line support never loses cells accepted by the v0.4.5.2 sampler across yaw/size matrices", () => {
  for (const length of [15, 60, 90]) {
    for (const width of [5, 10]) {
      for (const height of [5, 20]) {
        for (const yaw of [0, 15, 30, 45, 60, 75, 90]) {
          const shape = { type: "free-line", origin: { x: 0, y: 0, z: 0 }, length, width, height, yaw };
          const sampled = cells.rasterize(shape, { grid, threshold: 1e-6, epsilon: 1e-9, zSamples: 33 }).cells;
          const analytic = keys(lineSupport.rasterize(shape, { grid }).cells);
          for (const cell of sampled) assert.equal(analytic.has(key(cell)), true, `${length}/${width}/${height}/${yaw} lost ${key(cell)}`);
        }
      }
    }
  }
});

test("analytic OBB support rejects face, edge, and point tangency but accepts positive overlap", () => {
  const obb = {
    center: { x: 2.5, y: 2.5, z: 2.5 },
    axes: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }],
    halfExtents: [2.5, 2.5, 2.5]
  };
  assert.equal(obbIntersectsAabbPositiveVolume(obb, { minX: 5, maxX: 10, minY: 0, maxY: 5, minZ: 0, maxZ: 5 }), false);
  assert.equal(obbIntersectsAabbPositiveVolume(obb, { minX: 5, maxX: 10, minY: 5, maxY: 10, minZ: 0, maxZ: 5 }), false);
  assert.equal(obbIntersectsAabbPositiveVolume(obb, { minX: 5, maxX: 10, minY: 5, maxY: 10, minZ: 5, maxZ: 10 }), false);
  assert.equal(obbIntersectsAabbPositiveVolume(obb, { minX: 4.999, maxX: 10, minY: 0, maxY: 5, minZ: 0, maxZ: 5 }), true);
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
