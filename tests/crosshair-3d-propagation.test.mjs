import test from "node:test";
import assert from "node:assert/strict";
import { Crosshair3dGeometryService } from "../scripts/crosshairs3d/geometry-service.js";
import { Crosshair3dCellRasterizerService } from "../scripts/crosshairs3d/cell-rasterizer-service.js";
import { Crosshair3dPropagationService } from "../scripts/crosshairs3d/propagation-service.js";
import { wallCoverage } from "./helpers/analytic-wall-coverage.mjs";

const geometry = new Crosshair3dGeometryService();
const cells = new Crosshair3dCellRasterizerService({ geometry });
const propagation = new Crosshair3dPropagationService({ cells, geometry });
const grid = { distance: 5 };
const sphere = { type: "sphere", origin: { x: 2.5, y: 2.5, z: 20 }, radius: 10 };
const key = c => `${c.x},${c.y},${c.z}`;
const has = (result, x, y, z) => result.cells.some(c => c.x === x && c.y === y && c.z === z);
const direct = (coverage = 1) => ({
  directCoverage: query => ({ slabs: [{ xyCoverage: coverage,
    zMin: query.world.minZ, zMax: query.world.maxZ }] })
});
const spread = () => ({ seedOpen: () => true,
  sharedFace: () => ({ largestContiguousFraction: 1 }) });

for (const radius of [5, 10, 15, 20, 25, 30, 40, 50, 60]) {
  test(`Sphere R${radius}: clear Direct and Spread preserve every chart cell`, async () => {
    const shape = { ...sphere, radius };
    const expected = cells.rasterize(shape, { grid }).cells;
    for (const mode of ["none", "direct", "spread"]) {
      const result = await propagation.resolve({ shape, grid, mode,
        environment: mode === "spread" ? spread() : direct() });
      assert.deepEqual(result.cells, expected);
      assert.equal(result.support, "chart-cell");
    }
  });
}

test("20-foot clear Direct result matches the fixed accepted full chart", async () => {
  const result = await propagation.resolve({ shape: { ...sphere, radius: 20 }, grid,
    mode: "direct", environment: direct() });
  const expected = [
    [0,10,10,15,10,10,0,0], [10,15,15,15,15,15,10,0],
    [10,15,20,20,20,15,10,0], [15,15,20,20,20,15,15,0],
    [10,15,20,20,20,15,10,0], [10,15,15,15,15,15,10,0],
    [0,10,10,15,10,10,0,0], [0,0,0,0,0,0,0,0]
  ];
  const heights = expected.map((row, y) => row.map((_, x) =>
    result.cells.filter(c => c.x === x - 3 && c.y === y - 3).length * 2.5));
  assert.deepEqual(heights, expected);
});

test("Sphere Direct adapter receives full chart-cell support, including rounded corners", async () => {
  let roundedCornerSeen = false;
  const result = await propagation.resolve({ shape: sphere, grid, mode: "direct", environment: {
    directCoverage(query) {
      assert.equal(query.support, "chart-cell");
      if (key(query.cell) === "1,1,4") {
        const outside = { x: query.world.maxX - 0.001, y: query.world.maxY - 0.001,
          z: query.world.maxZ - 0.001 };
        assert.equal(geometry.containsPoint(sphere, outside), false);
        roundedCornerSeen = true;
      }
      return direct().directCoverage(query);
    }
  } });
  assert.equal(roundedCornerSeen, true);
  assert.equal(has(result, 1, 1, 4), true);
});

for (const [coverage, expected] of [[0, false], [0.01, false], [0.1, false],
  [0.49, false], [0.499999, false], [0.5, true], [0.500001, true], [1, true]]) {
  test(`Direct XY coverage ${coverage}: ${expected ? "include" : "exclude"}`, async () => {
    const result = await propagation.resolve({ shape: sphere, grid, mode: "direct",
      environment: direct(coverage) });
    assert.equal(result.cells.length > 0, expected);
    assert.equal(has(result, 1, 1, 4), expected, "rounded corner uses the same obstruction policy");
  });
}

test("Direct does not aggregate disconnected Z slabs to reach 50% XY coverage", async () => {
  const result = await propagation.resolve({ shape: sphere, grid, mode: "direct", environment: {
    directCoverage: ({ world }) => ({ slabs: [
      { xyCoverage: 0.3, zMin: world.minZ, zMax: world.minZ + 1 },
      { xyCoverage: 0.3, zMin: world.maxZ - 1, zMax: world.maxZ }
    ] })
  } });
  assert.equal(result.cells.length, 0);
});

test("Direct excludes zero-thickness tangency, accepts a thin positive slab", async () => {
  for (const [thickness, expected] of [[0, false], [0.001, true]]) {
    const result = await propagation.resolve({ shape: sphere, grid, mode: "direct", environment: {
      directCoverage: ({ world }) => ({ slabs: [{ xyCoverage: 0.5,
        zMin: world.minZ, zMax: world.minZ + thickness }] })
    } });
    assert.equal(result.cells.length > 0, expected);
  }
});

test("Direct never invokes Spread paths to rescue a blocked cell", async () => {
  const result = await propagation.resolve({ shape: sphere, grid, mode: "direct", environment: {
    ...direct(0), sharedFace() { throw new Error("Must not route around corners"); }
  } });
  assert.equal(result.cells.length, 0);
});

for (const [wallStart, expected] of [[3.99, false], [4, true], [4.01, true]]) {
  test(`Analytic wall shadow on rounded Sphere corner: wall starts at ${wallStart}`, async () => {
    let cornerCoverage;
    const result = await propagation.resolve({ shape: sphere, grid, mode: "direct", environment: {
      directCoverage(query) {
        const coverage = wallCoverage(query, 4, [[wallStart, 1000]]);
        if (key(query.cell) === "1,1,4") cornerCoverage = coverage;
        return { slabs: [{ xyCoverage: coverage, zMin: query.world.minZ, zMax: query.world.maxZ }] };
      }
    } });
    assert.equal(has(result, 1, 1, 4), expected);
    if (wallStart === 4) assert.equal(cornerCoverage, 0.5);
    if (wallStart < 4) assert.ok(cornerCoverage < 0.5);
    if (wallStart > 4) assert.ok(cornerCoverage > 0.5);
  });
}

test("Analytic narrow aperture cannot qualify a rounded Sphere boundary cell", async () => {
  let cornerCoverage;
  const result = await propagation.resolve({ shape: sphere, grid, mode: "direct", environment: {
    directCoverage(query) {
      const coverage = wallCoverage(query, 4, [[-1000, 4], [4.05, 1000]]);
      if (key(query.cell) === "1,1,4") cornerCoverage = coverage;
      return { slabs: [{ xyCoverage: coverage, zMin: query.world.minZ, zMax: query.world.maxZ }] };
    }
  } });
  assert.ok(cornerCoverage > 0 && cornerCoverage < 0.05);
  assert.equal(has(result, 1, 1, 4), false);
  assert.equal(has(result, -1, 0, 4), true, "unobstructed cells on source side remain affected");
});

test("None never queries obstruction adapters", async () => {
  const result = await propagation.resolve({ shape: sphere, grid, environment: {
    directCoverage() { throw new Error("Unexpected obstruction query"); },
    sharedFace() { throw new Error("Unexpected obstruction query"); }
  } });
  assert.deepEqual(result.cells, cells.rasterize(sphere, { grid }).cells);
});

test("Sphere Direct parity survives translation and negative elevations", async () => {
  const shape = { ...sphere, origin: { x: 17.5, y: -7.5, z: -10 } };
  const result = await propagation.resolve({ shape, grid, mode: "direct", environment: direct() });
  assert.deepEqual(result.cells, cells.rasterize(shape, { grid }).cells);
});

test("Non-spheres retain continuous primitive support", async () => {
  const result = await propagation.resolve({ grid, mode: "direct", shape: {
    type: "prism", origin: { x: 2.5, y: 2.5, z: 0 }, length: 5, width: 5, height: 5
  }, environment: { directCoverage(query) {
    assert.equal(query.support, "continuous-primitive");
    return direct().directCoverage(query);
  } } });
  assert.ok(result.cells.length);
});

for (const [opening, expected] of [[0, false], [0.099999, false], [0.1, true], [0.11, true]]) {
  test(`Spread contiguous shared opening ${opening}`, async () => {
    const result = await propagation.resolve({ shape: sphere, grid, mode: "spread", environment: {
      seedOpen: ({ cell }) => key(cell) === "0,0,4",
      sharedFace: () => ({ largestContiguousFraction: opening, totalOpenFraction: 1 })
    } });
    assert.equal(has(result, 1, 0, 4), expected);
    assert.equal(has(result, 0, 0, 4), true);
  });
}

test("Spread rejects diagonal-only contact and does not sum disconnected holes", async () => {
  const result = await propagation.resolve({ shape: sphere, grid, mode: "spread", environment: {
    seedOpen: ({ cell }) => key(cell) === "0,0,4",
    sharedFace(query) {
      assert.equal(["x", "y", "z"].reduce((n, a) => n + Math.abs(query.cell[a] - query.next[a]), 0), 1);
      return { largestContiguousFraction: 0.06, totalOpenFraction: 0.6 };
    }
  } });
  assert.deepEqual(result.cells.map(key), ["0,0,4"]);
});

test("Spread follows a permitted around-corner path without leaving candidate cells", async () => {
  const path = ["0,0,4", "1,0,4", "1,1,4"];
  const result = await propagation.resolve({ shape: sphere, grid, mode: "spread", environment: {
    seedOpen: ({ cell }) => key(cell) === path[0],
    sharedFace: ({ cell, next }) => ({ largestContiguousFraction:
      path.includes(key(cell)) && path.includes(key(next)) ? 1 : 0 })
  } });
  assert.deepEqual(new Set(result.cells.map(key)), new Set(path));
});

test("Boundary origin tests both incident Z seeds and excludes blocked one", async () => {
  const queries = [];
  const result = await propagation.resolve({ shape: sphere, grid, mode: "spread", environment: {
    seedOpen: ({ cell }) => { queries.push(key(cell)); return cell.z === 4; },
    sharedFace: () => ({ largestContiguousFraction: 0 })
  } });
  assert.deepEqual(queries, ["0,0,3", "0,0,4"]);
  assert.deepEqual(result.cells.map(key), ["0,0,4"]);
});

test("Approved connector can reach a rounded Sphere cell, but not extend the mask", async () => {
  const result = await propagation.resolve({ shape: sphere, grid, mode: "spread", connectors: [
    { approved: true, from: { x: 2.5, y: 2.5, z: 21 }, to: { x: 9.9, y: 9.9, z: 24.9 } },
    { approved: true, from: { x: 2.5, y: 2.5, z: 21 }, to: { x: 100, y: 100, z: 100 } }
  ], environment: { seedOpen: ({ cell }) => cell.z === 4,
    sharedFace: () => ({ largestContiguousFraction: 0 }), connectorOpen: () => true } });
  assert.deepEqual(new Set(result.cells.map(key)), new Set(["0,0,4", "1,1,4"]));
  assert.equal(result.stats.connectorQueries, 1);
});

test("Unsupported or malformed physical evidence fails closed", async () => {
  for (const mode of ["direct", "spread"]) {
    await assert.rejects(propagation.resolve({ shape: sphere, grid, mode }));
  }
  for (const coverage of [NaN, Infinity, -0.1, 1.01, "0.5"]) {
    await assert.rejects(propagation.resolve({ shape: sphere, grid, mode: "direct", environment: direct(coverage) }));
  }
  await assert.rejects(propagation.resolve({ shape: sphere, grid, mode: "direct", environment: {
    directCoverage: () => ({ slabs: [{ xyCoverage: 1, zMin: -10000, zMax: 10000 }] })
  } }));
});

test("Cancellation and oversized candidate masks stop before publication", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(propagation.resolve({ shape: sphere, grid, signal: controller.signal }), /cancelled/);
  await assert.rejects(propagation.resolve({ shape: { ...sphere, radius: 10000 }, grid }), /budget/);
  const later = new AbortController();
  await assert.rejects(propagation.resolve({ shape: sphere, grid, mode: "direct", signal: later.signal,
    environment: { directCoverage(query) { later.abort(); return direct().directCoverage(query); } } }), /cancelled/);
});
