import assert from "node:assert/strict";
import test from "node:test";

import { Crosshair3dGeometryService, CROSSHAIR_3D_SHAPES } from "../scripts/crosshairs3d/geometry-service.js";
import { Crosshair3dCellRasterizerService } from "../scripts/crosshairs3d/cell-rasterizer-service.js";
import { Crosshair3dTokenVolumeService } from "../scripts/crosshairs3d/token-volume-service.js";
import { Crosshair3dRangeService } from "../scripts/crosshairs3d/range-service.js";
import { Crosshair3dPlacementRevisionService } from "../scripts/crosshairs3d/placement-revision-service.js";

const geometry = new Crosshair3dGeometryService();
const cells = new Crosshair3dCellRasterizerService({ geometry });
const tokens = new Crosshair3dTokenVolumeService();
const range = new Crosshair3dRangeService();
const revisions = new Crosshair3dPlacementRevisionService();
const grid = { distance: 5 };

test("3D geometry normalizes the six accepted authoritative shape families", () => {
  assert.equal(geometry.normalizeShape({ type: "cube", origin: {}, size: 10 }).type, CROSSHAIR_3D_SHAPES.PRISM);
  assert.equal(geometry.normalizeShape({ type: "cylinder", origin: {}, radius: 5, height: 10 }).type, CROSSHAIR_3D_SHAPES.CYLINDER);
  assert.equal(geometry.normalizeShape({ type: "sphere", origin: {}, radius: 5 }).type, CROSSHAIR_3D_SHAPES.SPHERE);
  assert.equal(geometry.normalizeShape({ type: "cone", origin: {}, length: 15 }).type, CROSSHAIR_3D_SHAPES.CONE);
  assert.equal(geometry.normalizeShape({ type: "line", origin: {}, length: 30, width: 5 }).type, CROSSHAIR_3D_SHAPES.LINE);
  assert.equal(geometry.normalizeShape({ type: "free-line", origin: {}, length: 30, width: 5, height: 5 }).type, CROSSHAIR_3D_SHAPES.FREE_LINE);
});

test("3D range uses true Euclidean XYZ distance", () => {
  assert.equal(range.distanceBetweenPoints({ x: 0, y: 0, z: 0 }, { x: 30, y: 0, z: 40 }), 50);
  const clamped = range.clampPointFromOrigin({ x: 0, y: 0, z: 0 }, { x: 30, y: 0, z: 40 }, 25);
  assert.equal(clamped.clamped, true);
  assert.equal(clamped.x, 15);
  assert.equal(clamped.z, 20);
});

test("remote range can measure from the nearest point on a source Token volume", () => {
  const volume = { minX: 0, maxX: 10, minY: 0, maxY: 10, bottom: 0, top: 10 };
  assert.deepEqual(range.nearestPointOnVolume(volume, { x: 30, y: 5, z: 5 }), { x: 10, y: 5, z: 5 });
  assert.equal(range.distanceFromVolumeToPoint(volume, { x: 30, y: 5, z: 5 }), 20);
  const corner = range.nearestCornerOnVolume(volume, { x: 30, y: 5, z: 5 });
  assert.deepEqual({ x: corner.x, y: corner.y, z: corner.z }, { x: 10, y: 0, z: 0 });
  assert.ok(Math.abs(corner.distance - Math.sqrt(450)) < 1e-12);
  assert.ok(Math.abs(range.distanceFromVolumeCornerToPoint(volume, { x: 30, y: 5, z: 5 }) - Math.sqrt(450)) < 1e-12);
});

test("Token volume prefers explicit Foundry depth and otherwise uses the longest XY edge", () => {
  const explicit = tokens.resolve({ x: 0, y: 0, elevation: 5, width: 1, height: 2, depth: 0.5 }, {
    grid: { size: 100, distance: 5 }
  });
  assert.equal(explicit.depthUnits, 0.5);
  assert.equal(explicit.bottom, 5);
  assert.equal(explicit.top, 7.5);

  const fallback = tokens.resolve({ x: 0, y: 0, elevation: 0, width: 2, height: 3 }, {
    grid: { size: 100, distance: 5 }
  });
  assert.equal(fallback.depthUnits, 3);
  assert.equal(fallback.maxX, 10);
  assert.equal(fallback.maxY, 15);
  assert.equal(fallback.top, 15);
});

test("Token/cell intersection requires positive XY and Z overlap", () => {
  const volume = tokens.resolve({ x: 0, y: 0, elevation: 0, width: 1, height: 1, depth: 1 }, {
    grid: { size: 100, distance: 5 }
  });
  assert.equal(tokens.intersectsCell(volume, { minX: 0, maxX: 5, minY: 0, maxY: 5, minZ: 0, maxZ: 5 }), true);
  assert.equal(tokens.intersectsCell(volume, { minX: 5, maxX: 10, minY: 0, maxY: 5, minZ: 0, maxZ: 5 }), false);
  assert.equal(tokens.intersectsCell(volume, { minX: 0, maxX: 5, minY: 0, maxY: 5, minZ: 5, maxZ: 10 }), false);
});

test("Line zero-roll basis remains deterministic when the beam is vertical", () => {
  const basis = geometry.lineBasis({ yaw: 37, pitch: 90 });
  assert.ok(Math.abs(basis.direction.z - 1) < 1e-12);
  assert.ok(Math.abs(basis.widthAxis.z) < 1e-12);
  const second = geometry.lineBasis({ yaw: 37, pitch: 90 });
  assert.deepEqual(second, basis);
  const changedYaw = geometry.lineBasis({ yaw: 127, pitch: 90 });
  assert.notDeepEqual(changedYaw.widthAxis, basis.widthAxis);
});

test("Prism rasterization activates cells with exactly 50 percent XY coverage", () => {
  const shape = { type: "prism", origin: { x: 0, y: 2.5, z: 0 }, width: 5, length: 5, height: 5 };
  assert.equal(cells.isCellAffected(shape, { x: 0, y: 0, z: 0 }, grid), true);

  const belowHalf = { ...shape, origin: { x: -0.1, y: 2.5, z: 0 } };
  assert.equal(cells.isCellAffected(belowHalf, { x: 0, y: 0, z: 0 }, grid), false);
});

test("A zero-thickness Z face contact never activates the next persistent cell", () => {
  const shape = { type: "prism", origin: { x: 2.5, y: 2.5, z: 0 }, width: 5, length: 5, height: 5 };
  assert.equal(cells.isCellAffected(shape, { x: 0, y: 0, z: 0 }, grid), true);
  assert.equal(cells.isCellAffected(shape, { x: 0, y: 0, z: 1 }, grid), false);
});

test("A 10 by 10 by 5 prism produces a 2 by 2 by 1 affected-cell mask", () => {
  const mask = cells.rasterize({ type: "prism", origin: { x: 5, y: 5, z: 0 }, width: 10, length: 10, height: 5 }, { grid });
  assert.equal(mask.cells.length, 4);
  assert.deepEqual(mask.bounds.size, { x: 2, y: 2, z: 1 });
  assert.equal(mask.contains({ x: 0, y: 0, z: 0 }), true);
  assert.equal(mask.contains({ x: 1, y: 1, z: 0 }), true);
});

test("Sphere rasterization uses chart-derived square-center heights", () => {
  const mask = cells.rasterize({ type: "sphere", origin: { x: 2.5, y: 2.5, z: 0 }, radius: 5 }, { grid });
  assert.deepEqual(mask.cells, [
    { x: 0, y: 0, z: -1 },
    { x: 0, y: 0, z: 0 }
  ]);
});

test("Sphere tangent contact at a cell face has zero positive Z thickness", () => {
  const shape = { type: "sphere", origin: { x: 2.5, y: 2.5, z: 0 }, radius: 5 };
  assert.equal(cells.isCellAffected(shape, { x: 0, y: 0, z: 1 }, grid), false);
});

const suppliedSphereChartFirstRows = new Map([
  [10, [5, 10, 5, 0]],
  [15, [5, 10, 10, 10, 5, 0]],
  [20, [0, 10, 10, 15, 10, 10, 0, 0]],
  [25, [0, 0, 10, 15, 15, 15, 10, 0, 0, 0]],
  [30, [0, 0, 5, 15, 15, 15, 15, 15, 5, 0, 0, 0]],
  [40, [0, 0, 0, 0, 10, 15, 20, 20, 20, 15, 10, 0, 0, 0, 0, 0]],
  [50, [0, 0, 0, 0, 0, 10, 15, 20, 20, 20, 20, 20, 15, 10, 0, 0, 0, 0, 0, 0]],
  [60, [0, 0, 0, 0, 0, 0, 0, 15, 20, 20, 25, 25, 25, 20, 20, 15, 0, 0, 0, 0, 0, 0, 0, 0]]
]);

function sphereHalfHeightMatrix(mask, radius, distance = 5) {
  const extent = radius / distance;
  const start = 1 - extent;
  const counts = new Map();
  for (const cell of mask.cells) {
    const key = `${cell.x}|${cell.y}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from({ length: extent * 2 }, (_, row) =>
    Array.from({ length: extent * 2 }, (_, column) =>
      ((counts.get(`${start + column}|${start + row}`) ?? 0) * distance) / 2
    )
  );
}

for (const [radius, expectedFirstRow] of suppliedSphereChartFirstRows) {
  test(`Sphere ${radius}-foot radius reproduces the supplied chart and remains symmetric`, () => {
    const shape = { type: "sphere", origin: { x: 2.5, y: 2.5, z: 0 }, radius };
    const mask = cells.rasterize(shape, { grid });
    const matrix = sphereHalfHeightMatrix(mask, radius);
    assert.deepEqual(matrix[0], expectedFirstRow);

    const expected = matrix.map((row, rowIndex) => row.map((_value, columnIndex) => {
      const extent = radius / grid.distance;
      const x = (1 - extent + columnIndex) * grid.distance;
      const y = (1 - extent + rowIndex) * grid.distance;
      const heightSquared = (radius * radius) - (x * x) - (y * y);
      if (heightSquared <= 0) return 0;
      return grid.distance * Math.floor((Math.sqrt(heightSquared) / grid.distance) + 0.5 + 1e-9);
    }));
    assert.deepEqual(matrix, expected);

    for (const cell of mask.cells) {
      assert.equal(mask.contains({ x: -cell.x, y: cell.y, z: cell.z }), true);
      assert.equal(mask.contains({ x: cell.x, y: -cell.y, z: cell.z }), true);
      assert.equal(mask.contains({ x: cell.x, y: cell.y, z: -cell.z - 1 }), true);
    }
  });
}

test("Sphere 20-foot chart matches the supplied complete matrix", () => {
  const mask = cells.rasterize({ type: "sphere", origin: { x: 2.5, y: 2.5, z: 0 }, radius: 20 }, { grid });
  assert.deepEqual(sphereHalfHeightMatrix(mask, 20), [
    [0, 10, 10, 15, 10, 10, 0, 0],
    [10, 15, 15, 15, 15, 15, 10, 0],
    [10, 15, 20, 20, 20, 15, 10, 0],
    [15, 15, 20, 20, 20, 15, 15, 0],
    [10, 15, 20, 20, 20, 15, 10, 0],
    [10, 15, 15, 15, 15, 15, 10, 0],
    [0, 10, 10, 15, 10, 10, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0]
  ]);
});

test("Sphere chart validation requires whole-grid radius, centered XY, and grid-aligned elevation", () => {
  assert.throws(() => cells.rasterize({ type: "sphere", origin: { x: 2.5, y: 2.5, z: 0 }, radius: 7.5 }, { grid }), /radius/);
  assert.throws(() => cells.rasterize({ type: "sphere", origin: { x: 0, y: 2.5, z: 0 }, radius: 10 }, { grid }), /XY center/);
  assert.throws(() => cells.rasterize({ type: "sphere", origin: { x: 2.5, y: 2.5, z: 2.5 }, radius: 10 }, { grid }), /elevation/);
});

test("Sphere chart translates across XY and complete positive/negative elevation units", () => {
  const base = cells.rasterize({ type: "sphere", origin: { x: 2.5, y: 2.5, z: 0 }, radius: 10 }, { grid });
  const moved = cells.rasterize({ type: "sphere", origin: { x: 17.5, y: -7.5, z: -10 }, radius: 10 }, { grid });
  assert.deepEqual(moved.cells, base.cells.map(cell => ({ x: cell.x + 3, y: cell.y - 2, z: cell.z - 2 })));
});

test("Vertical Line remains a W by W column in XY and occupies its positive-length Z cells", () => {
  const shape = { type: "line", origin: { x: 2.5, y: 2.5, z: 0 }, length: 10, width: 5, yaw: 0, pitch: 90 };
  const mask = cells.rasterize(shape, { grid });
  assert.deepEqual(mask.cells, [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 }
  ]);
});

test("Pitched Cone point tests use the finite right-cone rule r=s/2", () => {
  const cone = { type: "cone", origin: { x: 0, y: 0, z: 0 }, length: 10, yaw: 0, pitch: 0 };
  assert.equal(geometry.containsPoint(cone, { x: 5, y: 2.4, z: 0 }), true);
  assert.equal(geometry.containsPoint(cone, { x: 5, y: 2.6, z: 0 }), false);
  assert.equal(geometry.containsPoint(cone, { x: 10, y: 5, z: 0 }), true);
  assert.equal(geometry.containsPoint(cone, { x: 10.01, y: 0, z: 0 }), false);
});

test("horizontal Cone apex cells acquire all four cardinal neighbors without lowering later-cell coverage", () => {
  const cases = [
    { yaw: 0, origin: { x: 5, y: 5, z: 0 }, cardinal: { x: 1, y: 0, z: 0 } },
    { yaw: 90, origin: { x: 5, y: 5, z: 0 }, cardinal: { x: 0, y: 1, z: 0 } },
    { yaw: 180, origin: { x: 0, y: 5, z: 0 }, cardinal: { x: -1, y: 0, z: 0 } },
    { yaw: 270, origin: { x: 5, y: 0, z: 0 }, cardinal: { x: 0, y: -1, z: 0 } }
  ];

  for (const { yaw, origin, cardinal } of cases) {
    const cone = { type: "cone", origin, length: 15, yaw, pitch: 0 };
    assert.equal(cells.isCellAffected(cone, cardinal, grid), true, `${yaw} degree Cone acquires its cardinal neighbor`);
  }

  const east = { type: "cone", origin: { x: 5, y: 5, z: 0 }, length: 15, yaw: 0, pitch: 0 };
  assert.equal(cells.isCellAffected(east, { x: 3, y: -1, z: 0 }, grid), false, "a non-apex 25% perimeter sliver still fails the normal 50% rule");
});

test("Cone apex qualification still requires positive 3D interior and does not alter pitched Cone cells", () => {
  const horizontal = { type: "cone", origin: { x: 5, y: 5, z: 0 }, length: 15, yaw: 0, pitch: 0 };
  assert.equal(cells.isCellAffected(horizontal, { x: 1, y: 0, z: 2 }, grid), false, "a vertically separated cell cannot qualify from the XY apex rule");

  const pitched = { ...horizontal, pitch: 30 };
  const candidate = { x: 1, y: 0, z: 0 };
  assert.equal(
    cells.isCellAffected(pitched, candidate, grid),
    geometry.xyCoverageAtZ(pitched, { minX: 5, maxX: 10, minY: 0, maxY: 5 }, 2.5) >= 0.5,
    "pitched Cone cells remain governed by the existing full 3D coverage path"
  );
});

test("Free Line keeps one horizontal bottom plane while yaw changes its XY footprint", () => {
  const line = geometry.normalizeShape({ type: "free-line", origin: { x: 0, y: 0, z: 15 }, length: 20, width: 5, height: 10, yaw: 90 });
  assert.equal(geometry.containsPoint(line, { x: 0, y: 10, z: 20 }), true);
  assert.equal(geometry.containsPoint(line, { x: 0, y: 10, z: 25 }), true);
  assert.equal(geometry.containsPoint(line, { x: 10, y: 0, z: 20 }), false);
});

test("placement revisions are immutable, monotonic, and preserve older revisions", () => {
  const first = revisions.create({ requested: { x: 0 }, resolved: { x: 0 }, targets: ["A"] });
  const second = revisions.revise(first, { requested: { x: 5 }, resolved: { x: 5 }, targets: ["B"] });
  assert.equal(first.revision, 0);
  assert.equal(second.revision, 1);
  assert.deepEqual(first.targets, ["A"]);
  assert.deepEqual(second.targets, ["B"]);
  assert.equal(revisions.isCurrent(first, second), false);
  assert.equal(revisions.isCurrent(second, second), true);
  assert.throws(() => { second.targets.push("C"); }, TypeError);
});

test("shape origins preserve the locked bottom-face, center, apex, and start-point semantics", () => {
  assert.deepEqual(geometry.getBounds({ type: "prism", origin: { x: 0, y: 0, z: 10 }, width: 10, length: 10, height: 15 }), {
    minX: -5, maxX: 5, minY: -5, maxY: 5, minZ: 10, maxZ: 25
  });
  assert.deepEqual(geometry.getBounds({ type: "cylinder", origin: { x: 0, y: 0, z: 10 }, radius: 5, height: 15 }), {
    minX: -5, maxX: 5, minY: -5, maxY: 5, minZ: 10, maxZ: 25
  });
  assert.deepEqual(geometry.getBounds({ type: "sphere", origin: { x: 0, y: 0, z: 10 }, radius: 5 }), {
    minX: -5, maxX: 5, minY: -5, maxY: 5, minZ: 5, maxZ: 15
  });
  assert.equal(geometry.containsPoint({ type: "cone", origin: { x: 0, y: 0, z: 10 }, length: 10 }, { x: 0, y: 0, z: 10 }), true);
  assert.equal(geometry.containsPoint({ type: "free-line", origin: { x: 0, y: 0, z: 10 }, length: 10, width: 5, height: 5 }, { x: 0, y: 0, z: 10 }), true);
});

test("rotated Prism coverage is derived from the rotated continuous footprint", () => {
  const base = { type: "prism", origin: { x: 5, y: 5, z: 0 }, width: 5, length: 15, height: 5 };
  const unrotated = cells.rasterize({ ...base, yaw: 0 }, { grid });
  const rotated = cells.rasterize({ ...base, yaw: 45 }, { grid });
  assert.equal(unrotated.cells.length, 4);
  assert.deepEqual(rotated.cells, [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 1, z: 0 }
  ]);
});

test("grid-cell derivation works in non-5-foot Scene distance units", () => {
  const tenFootGrid = { distance: 10 };
  const mask = cells.rasterize({ type: "prism", origin: { x: 10, y: 10, z: 0 }, width: 20, length: 20, height: 10 }, { grid: tenFootGrid });
  assert.equal(mask.cells.length, 4);
  assert.deepEqual(mask.bounds.size, { x: 2, y: 2, z: 1 });
});

test("grid origins may be offset without changing cell dimensions", () => {
  const offsetGrid = { distance: 5, origin: { x: 100, y: -50, z: 10 } };
  const world = cells.cellToWorld({ x: 2, y: 3, z: -1 }, offsetGrid);
  assert.deepEqual(world, {
    x: 2, y: 3, z: -1,
    minX: 110, maxX: 115,
    minY: -35, maxY: -30,
    minZ: 5, maxZ: 10
  });
});

test("negative elevations rasterize into negative Z cell indices", () => {
  const mask = cells.rasterize({ type: "prism", origin: { x: 2.5, y: 2.5, z: -10 }, width: 5, length: 5, height: 10 }, { grid });
  assert.deepEqual(mask.cells.map(cell => cell.z), [-2, -1]);
});

test("pitched Line bounds and point containment use the same zero-roll geometry", () => {
  const ray = { type: "line", origin: { x: 0, y: 0, z: 0 }, length: 20, width: 5, yaw: 0, pitch: 45 };
  const direction = geometry.direction(ray);
  const midpoint = { x: direction.x * 10, y: direction.y * 10, z: direction.z * 10 };
  assert.equal(geometry.containsPoint(ray, midpoint), true);
  const bounds = geometry.getBounds(ray);
  assert.equal(midpoint.x > bounds.minX && midpoint.x < bounds.maxX, true);
  assert.equal(midpoint.z > bounds.minZ && midpoint.z < bounds.maxZ, true);
});

test("Cone bounds include both its apex and the full terminal circle", () => {
  const cone = geometry.normalizeShape({ type: "cone", origin: { x: 0, y: 0, z: 0 }, length: 20, yaw: 0, pitch: 0 });
  const bounds = geometry.getBounds(cone);
  assert.deepEqual(bounds, { minX: 0, maxX: 20, minY: -10, maxY: 10, minZ: -10, maxZ: 10 });
});

test("propagation-mode foundation resolves Item defaults and future CAT-style overrides deterministically", async () => {
  const { Crosshair3dPropagationModeService } = await import("../scripts/crosshairs3d/propagation-mode-service.js");
  const propagation = new Crosshair3dPropagationModeService();
  assert.deepEqual(propagation.resolve({ itemDefault: "spread" }), { mode: "spread", source: "item-default" });
  assert.deepEqual(propagation.resolve({ itemDefault: "spread", override: "direct" }), { mode: "direct", source: "override" });
  assert.throws(() => propagation.normalize("teleport-through-everything"), RangeError);
});

test("lazy grid targeting follows continuous shape -> affected cells -> Token overlap", async () => {
  const { Crosshair3dTargetingGeometryService } = await import("../scripts/crosshairs3d/targeting-geometry-service.js");
  const targeting = new Crosshair3dTargetingGeometryService({ cells, geometry, tokens });
  const shape = { type: "prism", origin: { x: 2.5, y: 2.5, z: 0 }, width: 5, length: 5, height: 5 };
  const inside = { minX: 4.9, maxX: 9.9, minY: 0, maxY: 5, bottom: 0, top: 5 };
  const touching = { minX: 5, maxX: 10, minY: 0, maxY: 5, bottom: 0, top: 5 };
  assert.equal(targeting.testVolume(shape, inside, { grid }), true, "positive overlap with the affected cell counts");
  assert.equal(targeting.testVolume(shape, touching, { grid }), false, "exact face contact with the affected cell does not count");
});

test("large Token targeting succeeds when any one overlapped affected cell qualifies", async () => {
  const { Crosshair3dTargetingGeometryService } = await import("../scripts/crosshairs3d/targeting-geometry-service.js");
  const targeting = new Crosshair3dTargetingGeometryService({ cells, geometry, tokens });
  const shape = { type: "prism", origin: { x: 2.5, y: 2.5, z: 0 }, width: 5, length: 5, height: 5 };
  const large = { minX: 0, maxX: 15, minY: 0, maxY: 15, bottom: 0, top: 15 };
  const inspection = targeting.inspectVolume(shape, large, { grid });
  assert.equal(inspection.affected, true);
  assert.deepEqual(inspection.affectedCells, [{ x: 0, y: 0, z: 0 }]);
});

test("live-style Cone targeting acquires a Token in the cardinal apex-adjacent cell", async () => {
  const { Crosshair3dTargetingGeometryService } = await import("../scripts/crosshairs3d/targeting-geometry-service.js");
  const targeting = new Crosshair3dTargetingGeometryService({ cells, geometry, tokens });
  const cone = { type: "cone", origin: { x: 5, y: 5, z: 0 }, length: 15, yaw: 0, pitch: 0 };
  const eastToken = { minX: 5, maxX: 10, minY: 0, maxY: 5, bottom: 0, top: 5 };
  const inspection = targeting.inspectVolume(cone, eastToken, { grid });
  assert.equal(inspection.affected, true);
  assert.deepEqual(inspection.affectedCells, [{ x: 1, y: 0, z: 0 }]);
});

test("Sphere targeting treats chart-derived cells as authoritative beyond the continuous surface", async () => {
  const { Crosshair3dTargetingGeometryService } = await import("../scripts/crosshairs3d/targeting-geometry-service.js");
  const targeting = new Crosshair3dTargetingGeometryService({ cells, geometry, tokens });
  const sphere = { type: "sphere", origin: { x: 102.5, y: 77.5, z: 20 }, radius: 10 };
  const roundedCellSliver = { minX: 109.5, maxX: 114.5, minY: 84.5, maxY: 89.5, bottom: 24, top: 29 };
  const excludedAbove = { ...roundedCellSliver, bottom: 25, top: 30 };

  assert.equal(cells.isCellAffected(sphere, { x: 21, y: 16, z: 4 }, grid), true);
  assert.equal(targeting.testVolume(sphere, roundedCellSliver, { grid }), true, "positive overlap with the rounded chart cell is authoritative");
  assert.equal(targeting.testVolume(sphere, excludedAbove, { grid }), false, "face contact with the chart column top remains excluded");
});

test("Sphere targeting excludes cells whose square centers are exactly one radius away", async () => {
  const { Crosshair3dTargetingGeometryService } = await import("../scripts/crosshairs3d/targeting-geometry-service.js");
  const targeting = new Crosshair3dTargetingGeometryService({ cells, geometry, tokens });
  const sphere = { type: "sphere", origin: { x: 2.5, y: 2.5, z: 20 }, radius: 10 };
  const tangent = { minX: 12.5, maxX: 17.5, minY: 0, maxY: 5, bottom: 17.5, top: 22.5 };
  const positive = { minX: 9.5, maxX: 14.5, minY: 0, maxY: 5, bottom: 17.5, top: 22.5 };

  assert.equal(targeting.testVolume(sphere, tangent, { grid }), false);
  assert.equal(targeting.testVolume(sphere, positive, { grid }), true);
});
