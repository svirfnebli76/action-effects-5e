import { CROSSHAIR_3D_SHAPES } from "./geometry-service.js";
import { degreesToRadians } from "./geometry-utils.js";

const WORLD_AXES = Object.freeze([
  Object.freeze({ x: 1, y: 0, z: 0 }),
  Object.freeze({ x: 0, y: 1, z: 0 }),
  Object.freeze({ x: 0, y: 0, z: 1 })
]);
const AXIS_EPSILON = 1e-10;
const OVERLAP_EPSILON_SCALE = 1e-10;

const dot = (a, b) => (a.x * b.x) + (a.y * b.y) + (a.z * b.z);
const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a, b) => ({
  x: (a.y * b.z) - (a.z * b.y),
  y: (a.z * b.x) - (a.x * b.z),
  z: (a.x * b.y) - (a.y * b.x)
});
const magnitude = value => Math.hypot(value.x, value.y, value.z);
const normalize = value => {
  const length = magnitude(value);
  return length > AXIS_EPSILON
    ? { x: value.x / length, y: value.y / length, z: value.z / length }
    : null;
};

/**
 * Strict positive-volume OBB-vs-AABB separating-axis test.
 *
 * All non-degenerate face normals and edge cross-products are tested. A pure
 * face/edge/point touch is rejected: every tested projection must overlap by
 * more than a scale-aware numerical epsilon.
 */
export function obbIntersectsAabbPositiveVolume(obb, aabb) {
  const aabbCenter = {
    x: (aabb.minX + aabb.maxX) / 2,
    y: (aabb.minY + aabb.maxY) / 2,
    z: (aabb.minZ + aabb.maxZ) / 2
  };
  const aabbHalf = [
    (aabb.maxX - aabb.minX) / 2,
    (aabb.maxY - aabb.minY) / 2,
    (aabb.maxZ - aabb.minZ) / 2
  ];
  const delta = subtract(aabbCenter, obb.center);
  const axes = [...obb.axes, ...WORLD_AXES];
  for (const obbAxis of obb.axes) {
    for (const worldAxis of WORLD_AXES) axes.push(cross(obbAxis, worldAxis));
  }

  const scale = Math.max(1, ...obb.halfExtents, ...aabbHalf);
  const epsilon = scale * OVERLAP_EPSILON_SCALE;
  for (const rawAxis of axes) {
    const axis = normalize(rawAxis);
    if (!axis) continue;
    let obbRadius = 0;
    let aabbRadius = 0;
    for (let index = 0; index < 3; index += 1) {
      obbRadius += obb.halfExtents[index] * Math.abs(dot(obb.axes[index], axis));
      aabbRadius += aabbHalf[index] * Math.abs(dot(WORLD_AXES[index], axis));
    }
    const overlap = obbRadius + aabbRadius - Math.abs(dot(delta, axis));
    if (!(overlap > epsilon)) return false;
  }
  return true;
}

function lineObb(shape, geometry) {
  if (shape.type === CROSSHAIR_3D_SHAPES.LINE) {
    const { direction, widthAxis, heightAxis } = geometry.lineBasis(shape);
    return Object.freeze({
      center: Object.freeze({
        x: shape.origin.x + (direction.x * shape.length / 2),
        y: shape.origin.y + (direction.y * shape.length / 2),
        z: shape.origin.z + (direction.z * shape.length / 2)
      }),
      axes: Object.freeze([direction, widthAxis, heightAxis]),
      halfExtents: Object.freeze([shape.length / 2, shape.width / 2, shape.width / 2])
    });
  }

  if (shape.type === CROSSHAIR_3D_SHAPES.FREE_LINE) {
    const radians = degreesToRadians(shape.yaw);
    const direction = Object.freeze({ x: Math.cos(radians), y: Math.sin(radians), z: 0 });
    const lateral = Object.freeze({ x: -direction.y, y: direction.x, z: 0 });
    const vertical = WORLD_AXES[2];
    return Object.freeze({
      center: Object.freeze({
        x: shape.origin.x + (direction.x * shape.length / 2),
        y: shape.origin.y + (direction.y * shape.length / 2),
        z: shape.origin.z + (shape.height / 2)
      }),
      axes: Object.freeze([direction, lateral, vertical]),
      halfExtents: Object.freeze([shape.length / 2, shape.width / 2, shape.height / 2])
    });
  }

  throw new RangeError(`Analytic Line support is unavailable for shape '${shape.type}'.`);
}

/** Exact traversal-only cell support for the two AE5E Line OBB geometries. */
export class Crosshair3dLineSupportService {
  #cells;
  #geometry;

  constructor({ cells, geometry }) {
    this.#cells = cells;
    this.#geometry = geometry;
  }

  rasterize(shapeInput, { grid: gridInput } = {}) {
    const shape = this.#geometry.normalizeShape(shapeInput);
    if (![CROSSHAIR_3D_SHAPES.LINE, CROSSHAIR_3D_SHAPES.FREE_LINE].includes(shape.type)) {
      throw new RangeError(`Analytic Line support is unavailable for shape '${shape.type}'.`);
    }
    const grid = this.#cells.normalizeGrid(gridInput);
    const bounds = this.#cells.candidateBounds(shape, grid);
    const obb = lineObb(shape, this.#geometry);
    const support = [];
    for (let z = bounds.z.min; z <= bounds.z.max; z += 1) {
      for (let y = bounds.y.min; y <= bounds.y.max; y += 1) {
        for (let x = bounds.x.min; x <= bounds.x.max; x += 1) {
          const cell = Object.freeze({ x, y, z });
          if (obbIntersectsAabbPositiveVolume(obb, this.#cells.cellToWorld(cell, grid))) support.push(cell);
        }
      }
    }
    return Object.freeze({ shape, grid, cells: Object.freeze(support) });
  }
}
