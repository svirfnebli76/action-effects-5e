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

test("Sphere rasterization derives grid cells from the continuous sphere rather than from a box", () => {
  const mask = cells.rasterize({ type: "sphere", origin: { x: 5, y: 5, z: 5 }, radius: 5 }, { grid });
  assert.equal(mask.cells.length, 8);
  assert.equal(mask.cells.every(cell => [0, 1].includes(cell.x) && [0, 1].includes(cell.y) && [0, 1].includes(cell.z)), true);
});

test("Sphere tangent contact at a cell face has zero positive Z thickness", () => {
  const shape = { type: "sphere", origin: { x: 2.5, y: 2.5, z: 0 }, radius: 5 };
  assert.equal(cells.isCellAffected(shape, { x: 0, y: 0, z: 1 }, grid), false);
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
  const targeting = new Crosshair3dTargetingGeometryService({ cells, tokens });
  const shape = { type: "prism", origin: { x: 2.5, y: 2.5, z: 0 }, width: 5, length: 5, height: 5 };
  const inside = { minX: 4.9, maxX: 9.9, minY: 0, maxY: 5, bottom: 0, top: 5 };
  const touching = { minX: 5, maxX: 10, minY: 0, maxY: 5, bottom: 0, top: 5 };
  assert.equal(targeting.testVolume(shape, inside, { grid }), true, "positive overlap with the affected cell counts");
  assert.equal(targeting.testVolume(shape, touching, { grid }), false, "exact face contact with the affected cell does not count");
});

test("large Token targeting succeeds when any one overlapped affected cell qualifies", async () => {
  const { Crosshair3dTargetingGeometryService } = await import("../scripts/crosshairs3d/targeting-geometry-service.js");
  const targeting = new Crosshair3dTargetingGeometryService({ cells, tokens });
  const shape = { type: "prism", origin: { x: 2.5, y: 2.5, z: 0 }, width: 5, length: 5, height: 5 };
  const large = { minX: 0, maxX: 15, minY: 0, maxY: 15, bottom: 0, top: 15 };
  const inspection = targeting.inspectVolume(shape, large, { grid });
  assert.equal(inspection.affected, true);
  assert.deepEqual(inspection.affectedCells, [{ x: 0, y: 0, z: 0 }]);
});

test("live-style Cone targeting acquires a Token in the cardinal apex-adjacent cell", async () => {
  const { Crosshair3dTargetingGeometryService } = await import("../scripts/crosshairs3d/targeting-geometry-service.js");
  const targeting = new Crosshair3dTargetingGeometryService({ cells, tokens });
  const cone = { type: "cone", origin: { x: 5, y: 5, z: 0 }, length: 15, yaw: 0, pitch: 0 };
  const eastToken = { minX: 5, maxX: 10, minY: 0, maxY: 5, bottom: 0, top: 5 };
  const inspection = targeting.inspectVolume(cone, eastToken, { grid });
  assert.equal(inspection.affected, true);
  assert.deepEqual(inspection.affectedCells, [{ x: 1, y: 0, z: 0 }]);
});
