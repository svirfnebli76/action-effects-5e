import { CROSSHAIR_3D_SHAPES } from "./geometry-service.js";
import { CROSSHAIR_3D_EPSILON, clamp, finiteNumber } from "./geometry-utils.js";

export const CROSSHAIR_3D_CELL_COVERAGE_THRESHOLD = 0.5;

function cellKey(cell) {
  return `${cell.x},${cell.y},${cell.z}`;
}

export class Crosshair3dCellRasterizerService {
  #geometry;

  constructor({ geometry }) {
    this.#geometry = geometry;
  }

  normalizeGrid(grid = {}) {
    const distance = finiteNumber(grid.distance ?? grid.gridDistance ?? grid.cellSize, 0);
    if (!(distance > 0)) throw new RangeError("3D cell rasterization requires a positive Scene grid distance.");
    return Object.freeze({
      distance,
      origin: Object.freeze({
        x: finiteNumber(grid.origin?.x ?? grid.originX),
        y: finiteNumber(grid.origin?.y ?? grid.originY),
        z: finiteNumber(grid.origin?.z ?? grid.originZ)
      })
    });
  }

  cellToWorld(cell, gridInput) {
    const grid = this.normalizeGrid(gridInput);
    const d = grid.distance;
    const minX = grid.origin.x + (cell.x * d);
    const minY = grid.origin.y + (cell.y * d);
    const minZ = grid.origin.z + (cell.z * d);
    return {
      x: cell.x,
      y: cell.y,
      z: cell.z,
      minX,
      maxX: minX + d,
      minY,
      maxY: minY + d,
      minZ,
      maxZ: minZ + d
    };
  }

  candidateBounds(shapeInput, gridInput) {
    const shape = this.#geometry.normalizeShape(shapeInput);
    const grid = this.normalizeGrid(gridInput);
    const bounds = this.#geometry.getBounds(shape);
    const d = grid.distance;
    const axis = (min, max, origin) => ({
      min: Math.floor((min - origin) / d),
      max: Math.ceil((max - origin) / d) - 1
    });
    return {
      x: axis(bounds.minX, bounds.maxX, grid.origin.x),
      y: axis(bounds.minY, bounds.maxY, grid.origin.y),
      z: axis(bounds.minZ, bounds.maxZ, grid.origin.z)
    };
  }

  isCellAffected(shapeInput, cell, gridInput, options = {}) {
    const shape = this.#geometry.normalizeShape(shapeInput);
    const grid = this.normalizeGrid(gridInput);
    const world = this.cellToWorld(cell, grid);
    const threshold = finiteNumber(options.threshold, CROSSHAIR_3D_CELL_COVERAGE_THRESHOLD);
    const epsilon = finiteNumber(options.epsilon, CROSSHAIR_3D_EPSILON);
    const shapeBounds = this.#geometry.getBounds(shape);
    const zLow = Math.max(world.minZ, shapeBounds.minZ);
    const zHigh = Math.min(world.maxZ, shapeBounds.maxZ);
    if (!(zHigh - zLow > epsilon)) return false;
    const rect = { minX: world.minX, maxX: world.maxX, minY: world.minY, maxY: world.maxY };

    const constantByZ = [
      CROSSHAIR_3D_SHAPES.PRISM,
      CROSSHAIR_3D_SHAPES.CYLINDER,
      CROSSHAIR_3D_SHAPES.LINE
    ].includes(shape.type)
      || (shape.type === CROSSHAIR_3D_SHAPES.RAY && (Math.abs(this.#geometry.direction(shape).z) <= epsilon || Math.abs(Math.abs(this.#geometry.direction(shape).z) - 1) <= epsilon));

    if (constantByZ) {
      const z = (zLow + zHigh) / 2;
      return this.#geometry.xyCoverageAtZ(shape, rect, z, { ...options, thresholdHint: threshold }) >= threshold - epsilon;
    }

    if (shape.type === CROSSHAIR_3D_SHAPES.SPHERE) {
      const candidate = clamp(shape.origin.z, zLow, zHigh);
      const interior = Math.min(zHigh - epsilon, Math.max(zLow + epsilon, candidate));
      const coverage = this.#geometry.xyCoverageAtZ(shape, rect, interior, { ...options, thresholdHint: threshold });
      if (coverage > threshold + epsilon) return true;
      if (coverage < threshold - epsilon) return false;
      const delta = Math.min((zHigh - zLow) / 100, grid.distance / 1000);
      if (!(delta > epsilon)) return false;
      const lower = interior - delta > zLow + epsilon
        ? this.#geometry.xyCoverageAtZ(shape, rect, interior - delta, { ...options, thresholdHint: threshold })
        : 0;
      const upper = interior + delta < zHigh - epsilon
        ? this.#geometry.xyCoverageAtZ(shape, rect, interior + delta, { ...options, thresholdHint: threshold })
        : 0;
      return lower >= threshold - epsilon || upper >= threshold - epsilon;
    }

    const zSamples = Math.max(9, Math.trunc(finiteNumber(options.zSamples, 17)) | 1);
    let previousQualified = false;
    for (let index = 0; index < zSamples; index += 1) {
      const t = (index + 0.5) / zSamples;
      const z = zLow + ((zHigh - zLow) * t);
      const coverage = this.#geometry.xyCoverageAtZ(shape, rect, z, { ...options, thresholdHint: threshold });
      if (coverage > threshold + epsilon) return true;
      const qualified = coverage >= threshold - epsilon;
      if (qualified && previousQualified) return true;
      previousQualified = qualified;
    }
    return false;
  }

  rasterize(shapeInput, { grid, ...options } = {}) {
    const shape = this.#geometry.normalizeShape(shapeInput);
    const normalizedGrid = this.normalizeGrid(grid);
    const candidates = this.candidateBounds(shape, normalizedGrid);
    const cells = [];
    for (let z = candidates.z.min; z <= candidates.z.max; z += 1) {
      for (let y = candidates.y.min; y <= candidates.y.max; y += 1) {
        for (let x = candidates.x.min; x <= candidates.x.max; x += 1) {
          const cell = { x, y, z };
          if (this.isCellAffected(shape, cell, normalizedGrid, options)) cells.push(cell);
        }
      }
    }
    const keys = new Set(cells.map(cellKey));
    const bounds = this.#boundsFromCells(cells);
    return Object.freeze({
      shape,
      grid: normalizedGrid,
      cells: Object.freeze(cells.map(cell => Object.freeze({ ...cell }))),
      bounds,
      candidateBounds: candidates,
      contains: cell => keys.has(cellKey(cell))
    });
  }

  worldCells(mask) {
    return mask.cells.map(cell => this.cellToWorld(cell, mask.grid));
  }

  #boundsFromCells(cells) {
    if (!cells.length) return null;
    const min = {
      x: Math.min(...cells.map(cell => cell.x)),
      y: Math.min(...cells.map(cell => cell.y)),
      z: Math.min(...cells.map(cell => cell.z))
    };
    const max = {
      x: Math.max(...cells.map(cell => cell.x)) + 1,
      y: Math.max(...cells.map(cell => cell.y)) + 1,
      z: Math.max(...cells.map(cell => cell.z)) + 1
    };
    return Object.freeze({ min: Object.freeze(min), max: Object.freeze(max), size: Object.freeze({ x: max.x - min.x, y: max.y - min.y, z: max.z - min.z }) });
  }
}
