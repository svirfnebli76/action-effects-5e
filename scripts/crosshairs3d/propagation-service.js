import { Crosshair3dPropagationModeService } from "./propagation-mode-service.js";

const key = ({ x, y, z }) => `${x},${y},${z}`;
const AXES = ["x", "y", "z"];
const STEPS = AXES.flatMap(axis => [-1, 1].map(sign => ({ axis, sign })));

function fraction(value, label) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${label} must be a finite fraction between zero and one.`);
  }
  return value;
}

function point(value, label) {
  if (!value || !AXES.every(axis => Number.isFinite(value[axis]))) {
    throw new TypeError(`${label} requires finite XYZ coordinates.`);
  }
  return Object.freeze(Object.fromEntries(AXES.map(axis => [axis, value[axis]])));
}

/**
 * Environment-independent propagation over the authoritative candidate mask.
 *
 * The environment adapter supplies physical geometry evidence, not a second
 * candidate mask. For Direct it returns XY coverage slabs; each slab must be
 * backed by positive Z thickness. Sphere slabs are measured inside the FULL
 * chart cell, never intersected with the mathematical sphere again. Other
 * shapes retain their continuous-primitive clipping policy.
 *
 * Spread evidence is the largest CONTIGUOUS open component of a shared face,
 * not the sum of disconnected holes. Unsupported/ambiguous queries throw;
 * there is no fallback to unobstructed propagation.
 */
export class Crosshair3dPropagationService {
  constructor({ cells, geometry, maxCells = 100000 }) {
    this.cells = cells;
    this.geometry = geometry;
    this.modes = new Crosshair3dPropagationModeService();
    if (!Number.isSafeInteger(maxCells) || maxCells < 1) throw new RangeError("Invalid cell budget.");
    this.maxCells = maxCells;
  }

  async resolve({ shape: input, grid: gridInput, mode = "none", environment,
    origin: originInput, connectors = [], signal } = {}) {
    mode = this.modes.normalize(mode);
    const shape = this.geometry.normalizeShape(input);
    const grid = this.cells.normalizeGrid(gridInput);
    const origin = point(originInput ?? shape.origin, "Propagation origin");
    const checkAbort = () => {
      if (signal?.aborted) throw new Error("Propagation cancelled.");
    };
    checkAbort();
    const bounds = this.cells.candidateBounds(shape, grid);
    const count = AXES.reduce((n, axis) => n * (bounds[axis].max - bounds[axis].min + 1), 1);
    if (!Number.isSafeInteger(count) || count > this.maxCells) {
      throw new RangeError("Propagation candidate cell budget exceeded.");
    }
    const candidate = this.cells.rasterize(shape, { grid });
    const candidates = new Map(candidate.cells.map(cell => [key(cell), cell]));
    const selected = new Set();
    const stats = { candidateCells: candidates.size, directQueries: 0, faceQueries: 0,
      seedQueries: 0, connectorQueries: 0 };
    const support = shape.type === "sphere" ? "chart-cell" : "continuous-primitive";
    const context = cell => ({ shape, grid, origin, support, cell,
      world: this.cells.cellToWorld(cell, grid) });

    if (mode === "none") {
      for (const cellKey of candidates.keys()) selected.add(cellKey);
    } else if (mode === "direct") {
      if (typeof environment?.directCoverage !== "function") {
        throw new Error("Direct propagation requires a physical coverage adapter.");
      }
      for (const cell of candidate.cells) {
        checkAbort();
        const query = context(cell);
        const evidence = await environment.directCoverage(query);
        stats.directQueries++;
        checkAbort();
        if (!Array.isArray(evidence?.slabs)) throw new Error("Missing Direct coverage slabs.");
        let affected = false;
        for (const slab of evidence.slabs) {
          const coverage = fraction(slab.xyCoverage, "Direct XY coverage");
          if (!Number.isFinite(slab.zMin) || !Number.isFinite(slab.zMax)
            || slab.zMax < slab.zMin || slab.zMin < query.world.minZ
            || slab.zMax > query.world.maxZ) throw new Error("Invalid Direct coverage slab.");
          // Zero-thickness tangency never qualifies, including at exactly 50%.
          if (coverage >= 0.5 && slab.zMax - slab.zMin > 1e-8) affected = true;
        }
        if (affected) selected.add(key(cell));
      }
    } else {
      if (typeof environment?.seedOpen !== "function" || typeof environment?.sharedFace !== "function") {
        throw new Error("Spread propagation requires physical seed and shared-face adapters.");
      }
      const queue = [];
      const enqueue = cell => {
        const k = key(cell);
        if (!candidates.has(k) || selected.has(k)) return;
        selected.add(k);
        queue.push(candidates.get(k));
      };
      // Boundary origins seed every incident candidate, but only after the
      // adapter verifies that the origin-facing shared boundary is open.
      for (const cell of candidate.cells) {
        const query = context(cell);
        if (!AXES.every(axis => {
          const lower = grid.origin[axis] + cell[axis] * grid.distance;
          return origin[axis] >= lower - 1e-8 && origin[axis] <= lower + grid.distance + 1e-8;
        })) continue;
        checkAbort();
        const open = await environment.seedOpen(query);
        stats.seedQueries++;
        if (typeof open !== "boolean") throw new Error("Invalid Spread seed evidence.");
        if (open) enqueue(cell);
      }

      const cellAt = p => Object.fromEntries(AXES.map(axis => [axis,
        Math.floor((p[axis] - grid.origin[axis]) / grid.distance)]));
      const connections = new Map();
      for (const connector of connectors) {
        if (connector?.approved !== true) continue;
        const from = point(connector.from, "Connector entrance");
        const to = point(connector.to, "Connector destination");
        const a = cellAt(from), b = cellAt(to);
        if (!candidates.has(key(a)) || !candidates.has(key(b))) continue;
        // For spheres, candidate membership IS original AoE membership.
        // Mathematical containment here would undo chart rounding.
        if (support !== "chart-cell" && (!this.geometry.containsPoint(shape, from)
          || !this.geometry.containsPoint(shape, to))) continue;
        const add = (aCell, bCell, entrance, destination) => {
          const k = key(aCell);
          if (!connections.has(k)) connections.set(k, []);
          connections.get(k).push({ cell: bCell, entrance, destination, id: connector.id ?? null });
        };
        add(a, b, from, to);
        if (connector.bidirectional === true) add(b, a, to, from);
      }

      for (let index = 0; index < queue.length; index++) {
        checkAbort();
        const cell = queue[index];
        for (const { axis, sign } of STEPS) {
          const next = { ...cell, [axis]: cell[axis] + sign };
          if (!candidates.has(key(next)) || selected.has(key(next))) continue;
          const evidence = await environment.sharedFace({ ...context(cell), next,
            nextWorld: this.cells.cellToWorld(next, grid), axis, sign });
          stats.faceQueries++;
          const opening = fraction(evidence?.largestContiguousFraction, "Shared-face opening");
          if (opening >= 0.1) enqueue(next);
        }
        for (const connector of connections.get(key(cell)) ?? []) {
          if (selected.has(key(connector.cell))) continue;
          if (typeof environment.connectorOpen !== "function") {
            throw new Error("Approved Spread connectors require a physical connector adapter.");
          }
          const open = await environment.connectorOpen({ ...context(cell), connector });
          stats.connectorQueries++;
          if (typeof open !== "boolean") throw new Error("Invalid connector evidence.");
          if (open) enqueue(connector.cell);
        }
      }
    }
    checkAbort();
    return Object.freeze({ mode, shape, grid, origin, support,
      cells: Object.freeze(candidate.cells.filter(cell => selected.has(key(cell)))),
      stats: Object.freeze({ ...stats, affectedCells: selected.size }) });
  }
}
