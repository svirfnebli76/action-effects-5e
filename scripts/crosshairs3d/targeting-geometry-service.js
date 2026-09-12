import { CROSSHAIR_3D_EPSILON } from "./geometry-utils.js";

export class Crosshair3dTargetingGeometryService {
  #cells;
  #tokens;

  constructor({ cells, tokens }) {
    this.#cells = cells;
    this.#tokens = tokens;
  }

  candidateCellsForVolume(volume, gridInput) {
    if (!volume) return [];
    const grid = this.#cells.normalizeGrid(gridInput);
    const d = grid.distance;
    const axis = (min, max, origin) => ({
      min: Math.floor((min - origin) / d),
      max: Math.ceil((max - origin) / d) - 1
    });
    const x = axis(volume.minX, volume.maxX, grid.origin.x);
    const y = axis(volume.minY, volume.maxY, grid.origin.y);
    const z = axis(volume.bottom, volume.top, grid.origin.z);
    const candidates = [];
    for (let iz = z.min; iz <= z.max; iz += 1) {
      for (let iy = y.min; iy <= y.max; iy += 1) {
        for (let ix = x.min; ix <= x.max; ix += 1) candidates.push({ x: ix, y: iy, z: iz });
      }
    }
    return candidates;
  }

  inspectVolume(shape, volume, { grid, stopOnFirst = false, ...cellOptions } = {}) {
    const normalizedGrid = this.#cells.normalizeGrid(grid);
    const affectedCells = [];
    for (const cell of this.candidateCellsForVolume(volume, normalizedGrid)) {
      const world = this.#cells.cellToWorld(cell, normalizedGrid);
      if (!this.#tokens.intersectsCell(volume, world, { epsilon: cellOptions.epsilon ?? CROSSHAIR_3D_EPSILON })) continue;
      if (!this.#cells.isCellAffected(shape, cell, normalizedGrid, cellOptions)) continue;
      affectedCells.push(Object.freeze({ ...cell }));
      if (stopOnFirst) break;
    }
    return Object.freeze({
      affected: affectedCells.length > 0,
      affectedCells: Object.freeze(affectedCells)
    });
  }

  testVolume(shape, volume, options = {}) {
    return this.inspectVolume(shape, volume, { ...options, stopOnFirst: true }).affected;
  }
}
