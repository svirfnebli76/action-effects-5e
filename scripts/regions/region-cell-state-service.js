import {
  MODULE_ID,
  REGION_CELL_FLAG,
  REGION_CELL_SCHEMA_VERSION,
  REGION_CELL_STATES
} from "../core/constants.js";
import { Logger } from "../core/logger.js";

const EPSILON = 1e-9;
// Positive-overlap decisions use a deliberately larger tolerance than pure
// arithmetic comparisons. Token-local rotation/translation can transform an
// exact shared face into a ~1e-15..1e-9 sliver; that is numerical noise, not
// rules-positive overlap. Genuine fractional overlap used by AE5E tests is
// orders of magnitude larger than this threshold.
const OVERLAP_EPSILON = 1e-7;

function duplicate(value) {
  if (globalThis.foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
  if (globalThis.structuredClone) return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function getProperty(object, path) {
  if (globalThis.foundry?.utils?.getProperty) return foundry.utils.getProperty(object, path);
  return String(path).split(".").reduce((value, part) => value?.[part], object);
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function integer(value, fallback = 0) {
  return Math.trunc(finite(value, fallback));
}

function normalizeDegrees(value) {
  let degrees = finite(value, 0) % 360;
  if (degrees < 0) degrees += 360;
  return degrees;
}

function normalizeState(value, fallback = REGION_CELL_STATES.INACTIVE) {
  const state = String(value ?? fallback).trim().toUpperCase();
  if (!state) throw new Error("Region cell state must be a non-empty string.");
  return state;
}

function normalizeCell(cell) {
  if (Array.isArray(cell)) {
    if (cell.length < 3) throw new TypeError("Region cell coordinate array requires x, y, and z.");
    return { x: integer(cell[0]), y: integer(cell[1]), z: integer(cell[2]) };
  }
  if (!cell || typeof cell !== "object") throw new TypeError("Region cell coordinate must be an object or [x,y,z] array.");
  return { x: integer(cell.x), y: integer(cell.y), z: integer(cell.z) };
}

function cellKey(cell) {
  const normalized = normalizeCell(cell);
  return `${normalized.x},${normalized.y},${normalized.z}`;
}

function parseCellKey(key) {
  const parts = String(key ?? "").split(",");
  if (parts.length !== 3 || parts.some(part => !Number.isFinite(Number(part)))) return null;
  return { x: integer(parts[0]), y: integer(parts[1]), z: integer(parts[2]) };
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object ?? {}, key);
}

function polygonArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += (a.x * b.y) - (b.x * a.y);
  }
  return Math.abs(sum) / 2;
}

function clipPolygon(points, inside, intersect) {
  const output = [];
  if (!points.length) return output;
  let previous = points[points.length - 1];
  let previousInside = inside(previous);
  for (const current of points) {
    const currentInside = inside(current);
    if (currentInside) {
      if (!previousInside) output.push(intersect(previous, current));
      output.push(current);
    } else if (previousInside) {
      output.push(intersect(previous, current));
    }
    previous = current;
    previousInside = currentInside;
  }
  return output;
}


function projectPolygon(points, axis) {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    const value = (point.x * axis.x) + (point.y * axis.y);
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return { min, max };
}

function normalizedAxis(x, y) {
  const length = Math.hypot(x, y);
  if (!Number.isFinite(length) || length <= EPSILON) return null;
  return { x: x / length, y: y / length };
}

function polygonAxes(points) {
  const axes = [{ x: 1, y: 0 }, { x: 0, y: 1 }];
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const axis = normalizedAxis(-(b.y - a.y), b.x - a.x);
    if (!axis) continue;
    if (axes.some(existing => Math.abs(Math.abs((axis.x * existing.x) + (axis.y * existing.y)) - 1) <= 1e-8)) continue;
    axes.push(axis);
  }
  return axes;
}

function strictMovingInterval(min0, max0, velocity, fixedMin, fixedMax) {
  let lower = Number.NEGATIVE_INFINITY;
  let upper = Number.POSITIVE_INFINITY;

  // max0 + velocity*t > fixedMin + EPSILON
  const greaterThreshold = fixedMin + EPSILON;
  if (Math.abs(velocity) <= EPSILON) {
    if (!(max0 > greaterThreshold)) return null;
  } else {
    const boundary = (greaterThreshold - max0) / velocity;
    if (velocity > 0) lower = Math.max(lower, boundary);
    else upper = Math.min(upper, boundary);
  }

  // min0 + velocity*t < fixedMax - EPSILON
  const lessThreshold = fixedMax - EPSILON;
  if (Math.abs(velocity) <= EPSILON) {
    if (!(min0 < lessThreshold)) return null;
  } else {
    const boundary = (lessThreshold - min0) / velocity;
    if (velocity > 0) upper = Math.min(upper, boundary);
    else lower = Math.max(lower, boundary);
  }

  const start = Math.max(0, lower);
  const end = Math.min(1, upper);
  return end - start > EPSILON ? { start, end } : null;
}

function movingPolygonCellInterval(points, dx, dy, cellX, cellY) {
  let interval = { start: 0, end: 1 };
  const cell = [
    { x: cellX, y: cellY },
    { x: cellX + 1, y: cellY },
    { x: cellX + 1, y: cellY + 1 },
    { x: cellX, y: cellY + 1 }
  ];

  for (const axis of polygonAxes(points)) {
    const moving = projectPolygon(points, axis);
    const fixed = projectPolygon(cell, axis);
    const velocity = (dx * axis.x) + (dy * axis.y);
    const axisInterval = strictMovingInterval(moving.min, moving.max, velocity, fixed.min, fixed.max);
    if (!axisInterval) return null;
    interval.start = Math.max(interval.start, axisInterval.start);
    interval.end = Math.min(interval.end, axisInterval.end);
    if (interval.end - interval.start <= EPSILON) return null;
  }
  return interval;
}

function mergeIntervals(intervals) {
  const sorted = intervals
    .map(interval => ({ start: Math.max(0, interval.start), end: Math.min(1, interval.end) }))
    .filter(interval => interval.end - interval.start > EPSILON)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (!previous || interval.start > previous.end + EPSILON) merged.push({ ...interval });
    else previous.end = Math.max(previous.end, interval.end);
  }
  return merged;
}

function interpolatePosition(from, to, t) {
  const result = {
    x: finite(from?.x) + ((finite(to?.x) - finite(from?.x)) * t),
    y: finite(from?.y) + ((finite(to?.y) - finite(from?.y)) * t),
    elevation: finite(from?.elevation) + ((finite(to?.elevation) - finite(from?.elevation)) * t)
  };
  for (const key of ["width", "height", "depth", "shape", "level", "action"]) {
    const value = to?.[key] ?? from?.[key];
    if (value !== undefined && value !== null) result[key] = duplicate(value);
  }
  return result;
}

function clipPolygonToCell(points, x, y) {
  const x0 = x;
  const x1 = x + 1;
  const y0 = y;
  const y1 = y + 1;
  let polygon = [...points];

  const verticalIntersection = (boundary) => (a, b) => {
    const dx = b.x - a.x;
    const t = Math.abs(dx) <= EPSILON ? 0 : (boundary - a.x) / dx;
    return { x: boundary, y: a.y + ((b.y - a.y) * t) };
  };
  const horizontalIntersection = (boundary) => (a, b) => {
    const dy = b.y - a.y;
    const t = Math.abs(dy) <= EPSILON ? 0 : (boundary - a.y) / dy;
    return { x: a.x + ((b.x - a.x) * t), y: boundary };
  };

  polygon = clipPolygon(polygon, point => point.x >= x0 - EPSILON, verticalIntersection(x0));
  polygon = clipPolygon(polygon, point => point.x <= x1 + EPSILON, verticalIntersection(x1));
  polygon = clipPolygon(polygon, point => point.y >= y0 - EPSILON, horizontalIntersection(y0));
  polygon = clipPolygon(polygon, point => point.y <= y1 + EPSILON, horizontalIntersection(y1));
  return polygon;
}

/**
 * Generic Region-local three-dimensional cell-state service.
 *
 * Cells are integer grid coordinates in a bounded local frame. A volume has a
 * default state and sparse per-cell overrides. The state vocabulary is owned by
 * the caller; AE5E only reserves ACTIVE/INACTIVE as generic conveniences.
 *
 * This service does not alter native Foundry Region containment or movement.
 * Checkpoint 2 intentionally limits it to persistence, transforms, and volume
 * intersection so the movement integration can be evaluated independently.
 */
export class RegionCellStateService {
  #socket;
  #authority;
  #regions;
  #writeQueues = new Map();
  #stats = {
    configureRequests: 0,
    stateMutationRequests: 0,
    clearRequests: 0,
    configured: 0,
    stateMutations: 0,
    cleared: 0,
    routedToGm: 0,
    containmentQueries: 0,
    pathTraceQueries: 0,
    transformQueries: 0,
    errors: 0,
    lastEvent: null
  };

  constructor({ socket, authority, regions }) {
    this.#socket = socket;
    this.#authority = authority;
    this.#regions = regions;

    socket.register("regionCells.configure", payload => this.#configureAsAuthority(payload));
    socket.register("regionCells.setStates", payload => this.#setStatesAsAuthority(payload));
    socket.register("regionCells.clear", payload => this.#clearAsAuthority(payload));
  }

  getStats() {
    return {
      ...this.#stats,
      pendingWriteQueues: this.#writeQueues.size,
      socketReady: Boolean(this.#socket?.ready),
      authority: this.#authority?.getStatus?.() ?? null
    };
  }

  get flagPath() {
    return `flags.${MODULE_ID}.${REGION_CELL_FLAG}`;
  }

  get schemaVersion() {
    return REGION_CELL_SCHEMA_VERSION;
  }

  normalizeConfig(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new TypeError("Region cell configuration must be an object.");
    }

    const rawBounds = input.bounds ?? {};
    const min = {
      x: integer(rawBounds.min?.x ?? rawBounds.x ?? 0),
      y: integer(rawBounds.min?.y ?? rawBounds.y ?? 0),
      z: integer(rawBounds.min?.z ?? rawBounds.z ?? 0)
    };
    let size = {
      x: integer(rawBounds.size?.x ?? rawBounds.width ?? 1, 1),
      y: integer(rawBounds.size?.y ?? rawBounds.height ?? 1, 1),
      z: integer(rawBounds.size?.z ?? rawBounds.depth ?? 1, 1)
    };
    if (rawBounds.max) {
      size = {
        x: integer(rawBounds.max.x) - min.x,
        y: integer(rawBounds.max.y) - min.y,
        z: integer(rawBounds.max.z) - min.z
      };
    }
    if (size.x <= 0 || size.y <= 0 || size.z <= 0) {
      throw new RangeError("Region cell bounds require positive x, y, and z sizes.");
    }

    const defaultState = normalizeState(input.defaultState, REGION_CELL_STATES.INACTIVE);
    const frame = this.#normalizeFrame(input.frame ?? {});
    const cells = {};
    const rawCells = input.cells ?? input.overrides ?? {};

    if (Array.isArray(rawCells)) {
      for (const entry of rawCells) {
        const coordinate = normalizeCell(entry?.cell ?? entry);
        if (!this.#isWithinBounds({ min, size }, coordinate)) continue;
        const state = normalizeState(entry?.state, defaultState);
        if (state !== defaultState) cells[cellKey(coordinate)] = state;
      }
    } else if (rawCells && typeof rawCells === "object") {
      for (const [key, value] of Object.entries(rawCells)) {
        const coordinate = parseCellKey(key);
        if (!coordinate || !this.#isWithinBounds({ min, size }, coordinate)) continue;
        const state = normalizeState(value, defaultState);
        if (state !== defaultState) cells[cellKey(coordinate)] = state;
      }
    }

    return {
      schemaVersion: REGION_CELL_SCHEMA_VERSION,
      bounds: { min, size },
      defaultState,
      cells,
      frame
    };
  }

  buildRegionFlag(config) {
    return this.normalizeConfig(config);
  }

  isConfigured(region) {
    return Boolean(this.#rawConfig(region));
  }

  getConfig(region) {
    const raw = this.#rawConfig(region);
    if (!raw) return null;
    try {
      return this.normalizeConfig(raw);
    } catch (error) {
      this.#stats.errors += 1;
      this.#record("invalid-config", { regionUuid: region?.uuid ?? null, message: error?.message ?? String(error) });
      return null;
    }
  }

  getCellState(region, cell) {
    const config = this.getConfig(region);
    if (!config) return null;
    return this.getCellStateFromConfig(config, cell);
  }

  getCellStateFromConfig(configInput, cell) {
    const config = configInput?.schemaVersion === REGION_CELL_SCHEMA_VERSION
      ? configInput
      : this.normalizeConfig(configInput);
    const coordinate = normalizeCell(cell);
    if (!this.#isWithinBounds(config.bounds, coordinate)) return null;
    return config.cells?.[cellKey(coordinate)] ?? config.defaultState;
  }

  enumerateCells(regionOrConfig, { states = null } = {}) {
    const config = regionOrConfig?.bounds
      ? (regionOrConfig.schemaVersion === REGION_CELL_SCHEMA_VERSION ? regionOrConfig : this.normalizeConfig(regionOrConfig))
      : this.getConfig(regionOrConfig);
    if (!config) return [];
    const filter = states == null ? null : new Set([].concat(states).map(state => normalizeState(state)));
    const output = [];
    const { min, size } = config.bounds;
    for (let z = min.z; z < min.z + size.z; z += 1) {
      for (let y = min.y; y < min.y + size.y; y += 1) {
        for (let x = min.x; x < min.x + size.x; x += 1) {
          const state = this.getCellStateFromConfig(config, { x, y, z });
          if (filter && !filter.has(state)) continue;
          output.push({ x, y, z, key: `${x},${y},${z}`, state });
        }
      }
    }
    return output;
  }

  summarizeStates(regionOrConfig) {
    const summary = {};
    for (const cell of this.enumerateCells(regionOrConfig)) summary[cell.state] = (summary[cell.state] ?? 0) + 1;
    return summary;
  }

  async configure(regionOrUuid, config) {
    this.#stats.configureRequests += 1;
    const regionUuid = this.#regionUuid(regionOrUuid);
    if (!regionUuid) return { configured: false, reason: "invalid-region-uuid" };
    const normalized = this.normalizeConfig(config);
    const payload = { regionUuid, config: normalized, requestedByUserId: globalThis.game?.user?.id ?? null };
    return this.#executeAsAuthority("regionCells.configure", payload, () => this.#configureAsAuthority(payload));
  }

  async setCellState(regionOrUuid, cell, state) {
    return this.setCellStates(regionOrUuid, [{ cell: normalizeCell(cell), state: normalizeState(state) }]);
  }

  async setCellStates(regionOrUuid, updates) {
    this.#stats.stateMutationRequests += 1;
    const regionUuid = this.#regionUuid(regionOrUuid);
    if (!regionUuid) return { updated: false, reason: "invalid-region-uuid" };
    if (!Array.isArray(updates) || updates.length === 0) return { updated: false, reason: "missing-updates" };
    const normalizedUpdates = updates.map(update => ({
      cell: normalizeCell(update?.cell ?? update),
      state: normalizeState(update?.state)
    }));
    const payload = { regionUuid, updates: normalizedUpdates, requestedByUserId: globalThis.game?.user?.id ?? null };
    return this.#executeAsAuthority("regionCells.setStates", payload, () => this.#setStatesAsAuthority(payload));
  }

  async clear(regionOrUuid) {
    this.#stats.clearRequests += 1;
    const regionUuid = this.#regionUuid(regionOrUuid);
    if (!regionUuid) return { cleared: false, reason: "invalid-region-uuid" };
    const payload = { regionUuid, requestedByUserId: globalThis.game?.user?.id ?? null };
    return this.#executeAsAuthority("regionCells.clear", payload, () => this.#clearAsAuthority(payload));
  }

  localToWorldPoint(region, point, options = {}) {
    this.#stats.transformQueries += 1;
    const config = options.config ?? this.getConfig(region);
    if (!config) return null;
    const grid = this.#gridMetrics(region, options.grid);
    const frame = this.resolveFrame(region, { ...options, config, grid });
    if (!frame) return null;
    const x = finite(point?.x);
    const y = finite(point?.y);
    const z = finite(point?.z ?? point?.elevation);
    const radians = frame.rotation * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const dx = x * grid.size;
    const dy = y * grid.size;
    return {
      x: frame.origin.x + (dx * cos) - (dy * sin),
      y: frame.origin.y + (dx * sin) + (dy * cos),
      elevation: frame.origin.elevation + (z * grid.distance)
    };
  }

  worldToLocalPoint(region, point, options = {}) {
    this.#stats.transformQueries += 1;
    const config = options.config ?? this.getConfig(region);
    if (!config) return null;
    const grid = this.#gridMetrics(region, options.grid);
    const frame = this.resolveFrame(region, { ...options, config, grid });
    if (!frame) return null;
    const dx = finite(point?.x) - frame.origin.x;
    const dy = finite(point?.y) - frame.origin.y;
    const radians = -frame.rotation * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return {
      x: ((dx * cos) - (dy * sin)) / grid.size,
      y: ((dx * sin) + (dy * cos)) / grid.size,
      z: (finite(point?.elevation ?? point?.z) - frame.origin.elevation) / grid.distance
    };
  }

  resolveFrame(region, { config = null, grid = null, sourceToken = null, frameOverride = null } = {}) {
    const normalized = config ?? this.getConfig(region);
    if (!normalized) return null;
    const metrics = grid ?? this.#gridMetrics(region);
    if (frameOverride) return this.#normalizeResolvedFrame(frameOverride);
    const frame = normalized.frame;

    if (frame.type === "token") {
      const source = sourceToken ?? this.#resolveToken(frame.sourceTokenUuid, region);
      if (!source) return null;
      const width = finite(source.width ?? source._source?.width, 1);
      const height = finite(source.height ?? source._source?.height, 1);
      const sourceRotation = normalizeDegrees(source.rotation ?? source._source?.rotation ?? 0);
      const sourceRadians = sourceRotation * Math.PI / 180;
      const cos = Math.cos(sourceRadians);
      const sin = Math.sin(sourceRadians);
      const offsetX = frame.offset.x * metrics.size;
      const offsetY = frame.offset.y * metrics.size;
      const centerX = finite(source.x ?? source._source?.x) + ((width * metrics.size) / 2);
      const centerY = finite(source.y ?? source._source?.y) + ((height * metrics.size) / 2);
      return {
        type: "token",
        sourceTokenUuid: frame.sourceTokenUuid,
        origin: {
          x: centerX + (offsetX * cos) - (offsetY * sin),
          y: centerY + (offsetX * sin) + (offsetY * cos),
          elevation: finite(source.elevation ?? source._source?.elevation) + (frame.offset.z * metrics.distance)
        },
        rotation: normalizeDegrees(sourceRotation + frame.rotationOffset)
      };
    }

    return {
      type: "static",
      origin: duplicate(frame.origin),
      rotation: normalizeDegrees(frame.rotation)
    };
  }

  getCellWorldVolume(region, cell, options = {}) {
    const coordinate = normalizeCell(cell);
    const config = options.config ?? this.getConfig(region);
    if (!config || !this.#isWithinBounds(config.bounds, coordinate)) return null;
    const bottomLeft = this.localToWorldPoint(region, { x: coordinate.x, y: coordinate.y, z: coordinate.z }, { ...options, config });
    const bottomRight = this.localToWorldPoint(region, { x: coordinate.x + 1, y: coordinate.y, z: coordinate.z }, { ...options, config });
    const topRight = this.localToWorldPoint(region, { x: coordinate.x + 1, y: coordinate.y + 1, z: coordinate.z }, { ...options, config });
    const topLeft = this.localToWorldPoint(region, { x: coordinate.x, y: coordinate.y + 1, z: coordinate.z }, { ...options, config });
    const upper = this.localToWorldPoint(region, { x: coordinate.x, y: coordinate.y, z: coordinate.z + 1 }, { ...options, config });
    if (!bottomLeft || !bottomRight || !topRight || !topLeft || !upper) return null;
    return {
      cell: coordinate,
      state: this.getCellStateFromConfig(config, coordinate),
      polygon: [bottomLeft, bottomRight, topRight, topLeft].map(({ x, y }) => ({ x, y })),
      bottom: bottomLeft.elevation,
      top: upper.elevation
    };
  }

  traceTokenSegment(region, token, { from, to, states = [REGION_CELL_STATES.ACTIVE], config = null, grid = null, sourceToken = null, frameOverride = null } = {}) {
    this.#stats.pathTraceQueries += 1;
    const normalized = config ?? this.getConfig(region);
    if (!normalized) return { traced: false, reason: "region-cells-unconfigured", intervals: [], transitions: [], activeFraction: 0 };
    if (!from || !to) return { traced: false, reason: "segment-endpoints-required", intervals: [], transitions: [], activeFraction: 0 };

    const metrics = this.#gridMetrics(region, grid);
    const frame = this.resolveFrame(region, { config: normalized, grid: metrics, sourceToken, frameOverride });
    if (!frame) return { traced: false, reason: "cell-frame-unavailable", intervals: [], transitions: [], activeFraction: 0 };
    const fromVolume = this.#tokenVolume(token, from, metrics);
    const toVolume = this.#tokenVolume(token, to, metrics);
    if (!fromVolume || !toVolume) return { traced: false, reason: "token-volume-empty", intervals: [], transitions: [], activeFraction: 0 };

    const localFrom = fromVolume.polygon.map(point => this.#worldToLocalWithResolvedFrame(point, fromVolume.bottom, frame, metrics));
    const localTo = toVolume.polygon.map(point => this.#worldToLocalWithResolvedFrame(point, toVolume.bottom, frame, metrics));
    const dx = localTo[0].x - localFrom[0].x;
    const dy = localTo[0].y - localFrom[0].y;
    for (let index = 1; index < localFrom.length; index += 1) {
      const vertexDx = localTo[index].x - localFrom[index].x;
      const vertexDy = localTo[index].y - localFrom[index].y;
      if (Math.abs(vertexDx - dx) > 1e-7 || Math.abs(vertexDy - dy) > 1e-7) {
        return { traced: false, reason: "non-rigid-token-segment", intervals: [], transitions: [], activeFraction: 0 };
      }
    }

    const bottom0 = (fromVolume.bottom - frame.origin.elevation) / metrics.distance;
    const top0 = (fromVolume.top - frame.origin.elevation) / metrics.distance;
    const bottom1 = (toVolume.bottom - frame.origin.elevation) / metrics.distance;
    const top1 = (toVolume.top - frame.origin.elevation) / metrics.distance;
    const dz = bottom1 - bottom0;
    if (Math.abs((top1 - top0) - dz) > 1e-7) {
      return { traced: false, reason: "non-rigid-token-depth", intervals: [], transitions: [], activeFraction: 0 };
    }

    const desiredStates = new Set([].concat(states ?? REGION_CELL_STATES.ACTIVE).map(state => normalizeState(state)));
    const cellIntervals = [];
    for (const cell of this.enumerateCells(normalized)) {
      if (!desiredStates.has(cell.state)) continue;
      const xy = movingPolygonCellInterval(localFrom, dx, dy, cell.x, cell.y);
      if (!xy) continue;
      const z = strictMovingInterval(bottom0, top0, dz, cell.z, cell.z + 1);
      if (!z) continue;
      const start = Math.max(xy.start, z.start);
      const end = Math.min(xy.end, z.end);
      if (end - start <= EPSILON) continue;
      cellIntervals.push({ start, end, cell: { ...cell } });
    }

    const intervals = mergeIntervals(cellIntervals);
    const activeFraction = intervals.reduce((total, interval) => total + (interval.end - interval.start), 0);
    const insideAtStart = this.intersectsToken(region, token, { position: from, states, config: normalized, grid: metrics, sourceToken, frameOverride }).intersects;
    const insideAtEnd = this.intersectsToken(region, token, { position: to, states, config: normalized, grid: metrics, sourceToken, frameOverride }).intersects;
    const transitions = [];
    for (const interval of intervals) {
      if (interval.start > EPSILON || !insideAtStart) {
        transitions.push({ type: "enter", t: interval.start, position: interpolatePosition(from, to, interval.start), interval: { ...interval } });
      }
      if (interval.end < 1 - EPSILON || !insideAtEnd) {
        transitions.push({ type: "exit", t: interval.end, position: interpolatePosition(from, to, interval.end), interval: { ...interval } });
      }
    }
    transitions.sort((a, b) => a.t - b.t || (a.type === "exit" ? -1 : 1));

    return {
      traced: true,
      reason: "cell-segment-traced",
      intervals,
      cellIntervals,
      transitions,
      activeFraction,
      insideAtStart,
      insideAtEnd,
      frame,
      from: duplicate(from),
      to: duplicate(to)
    };
  }

  intersectsToken(region, token, { position = null, states = [REGION_CELL_STATES.ACTIVE], config = null, grid = null, sourceToken = null, frameOverride = null } = {}) {
    this.#stats.containmentQueries += 1;
    const normalized = config ?? this.getConfig(region);
    if (!normalized) return { intersects: false, reason: "region-cells-unconfigured", cells: [] };
    const metrics = this.#gridMetrics(region, grid);
    const frame = this.resolveFrame(region, { config: normalized, grid: metrics, sourceToken, frameOverride });
    if (!frame) return { intersects: false, reason: "cell-frame-unavailable", cells: [], tokenVolume: null, frame: null };
    const tokenVolume = this.#tokenVolume(token, position, metrics);
    if (!tokenVolume || tokenVolume.top - tokenVolume.bottom <= EPSILON) {
      return { intersects: false, reason: "token-volume-empty", cells: [], tokenVolume, frame };
    }

    const localPolygon = tokenVolume.polygon.map(point => this.#worldToLocalWithResolvedFrame(point, tokenVolume.bottom, frame, metrics));
    const localBottom = (tokenVolume.bottom - frame.origin.elevation) / metrics.distance;
    const localTop = (tokenVolume.top - frame.origin.elevation) / metrics.distance;
    const desiredStates = new Set([].concat(states ?? REGION_CELL_STATES.ACTIVE).map(state => normalizeState(state)));
    const xs = localPolygon.map(point => point.x);
    const ys = localPolygon.map(point => point.y);
    const bounds = normalized.bounds;
    const minX = Math.max(bounds.min.x, Math.floor(Math.min(...xs)));
    const maxX = Math.min(bounds.min.x + bounds.size.x - 1, Math.floor(Math.max(...xs) - EPSILON));
    const minY = Math.max(bounds.min.y, Math.floor(Math.min(...ys)));
    const maxY = Math.min(bounds.min.y + bounds.size.y - 1, Math.floor(Math.max(...ys) - EPSILON));
    const minZ = Math.max(bounds.min.z, Math.floor(localBottom));
    const maxZ = Math.min(bounds.min.z + bounds.size.z - 1, Math.floor(localTop - EPSILON));
    const intersections = [];

    if (maxX < minX || maxY < minY || maxZ < minZ) {
      return { intersects: false, reason: "outside-cell-bounds", cells: [], tokenVolume, frame };
    }

    for (let z = minZ; z <= maxZ; z += 1) {
      const zOverlap = Math.min(localTop, z + 1) - Math.max(localBottom, z);
      if (zOverlap <= OVERLAP_EPSILON) continue;
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const state = this.getCellStateFromConfig(normalized, { x, y, z });
          if (!desiredStates.has(state)) continue;
          const clipped = clipPolygonToCell(localPolygon, x, y);
          const xyArea = polygonArea(clipped);
          if (xyArea <= OVERLAP_EPSILON) continue;
          intersections.push({ x, y, z, key: `${x},${y},${z}`, state, xyArea, zOverlap });
        }
      }
    }

    return {
      intersects: intersections.length > 0,
      reason: intersections.length ? "active-cell-overlap" : "no-matching-cell-overlap",
      cells: intersections,
      tokenVolume,
      frame
    };
  }

  async #configureAsAuthority(payload) {
    this.#assertAuthority();
    return this.#queueWrite(payload?.regionUuid, async () => {
      const region = await this.#resolveRegion(payload?.regionUuid);
      const ownership = this.#validateWritableRegion(region);
      if (!ownership.ok) return { configured: false, reason: ownership.reason };
      const config = this.normalizeConfig(payload?.config ?? {});
      await this.#replaceConfig(region, config);
      this.#stats.configured += 1;
      const result = { configured: true, regionUuid: region.uuid, config: duplicate(config) };
      this.#record("configured", { regionUuid: region.uuid, bounds: config.bounds, defaultState: config.defaultState });
      return result;
    });
  }

  async #setStatesAsAuthority(payload) {
    this.#assertAuthority();
    return this.#queueWrite(payload?.regionUuid, async () => {
      const region = await this.#resolveRegion(payload?.regionUuid);
      const ownership = this.#validateWritableRegion(region);
      if (!ownership.ok) return { updated: false, reason: ownership.reason };
      const config = this.getConfig(region);
      if (!config) return { updated: false, reason: "region-cells-unconfigured" };

      let changed = 0;
      const ignored = [];
      for (const update of payload?.updates ?? []) {
        const coordinate = normalizeCell(update?.cell ?? update);
        if (!this.#isWithinBounds(config.bounds, coordinate)) {
          ignored.push({ cell: coordinate, reason: "outside-bounds" });
          continue;
        }
        const state = normalizeState(update?.state);
        const key = cellKey(coordinate);
        const previous = config.cells[key] ?? config.defaultState;
        if (previous === state) continue;
        if (state === config.defaultState) delete config.cells[key];
        else config.cells[key] = state;
        changed += 1;
      }

      if (changed > 0) await this.#replaceConfig(region, config);
      this.#stats.stateMutations += changed;
      const result = { updated: true, regionUuid: region.uuid, changed, ignored, config: duplicate(config) };
      this.#record("states-updated", { regionUuid: region.uuid, changed, ignored: ignored.length });
      return result;
    });
  }

  async #clearAsAuthority(payload) {
    this.#assertAuthority();
    return this.#queueWrite(payload?.regionUuid, async () => {
      const region = await this.#resolveRegion(payload?.regionUuid);
      const ownership = this.#validateWritableRegion(region);
      if (!ownership.ok) return { cleared: false, reason: ownership.reason };
      if (!this.isConfigured(region)) return { cleared: false, reason: "already-clear", regionUuid: region.uuid };
      if (typeof region.unsetFlag === "function") await region.unsetFlag(MODULE_ID, REGION_CELL_FLAG);
      else await region.update({ [`flags.${MODULE_ID}.-=${REGION_CELL_FLAG}`]: null }, { ae5eRegionCells: true });
      this.#stats.cleared += 1;
      const result = { cleared: true, regionUuid: region.uuid };
      this.#record("cleared", result);
      return result;
    });
  }

  async #replaceConfig(region, config) {
    // Foundry recursively merges ObjectField updates. A cell mask is a complete
    // snapshot, so omitted cell keys must be removed before the replacement is
    // written; otherwise a shrinking mask silently retains its former cells.
    if (this.isConfigured(region)) {
      if (typeof region.unsetFlag === "function") await region.unsetFlag(MODULE_ID, REGION_CELL_FLAG);
      else await region.update({ [`flags.${MODULE_ID}.-=${REGION_CELL_FLAG}`]: null }, { ae5eRegionCells: true });
    }
    await region.update({ [this.flagPath]: config }, { ae5eRegionCells: true });
  }

  async #executeAsAuthority(socketName, payload, localHandler) {
    const primary = this.#authority?.getPrimaryGm?.() ?? null;
    const fallback = [...(globalThis.game?.users ?? [])].find(user => user?.active && user?.isGM) ?? null;
    const authority = primary ?? fallback;
    if (!authority) return { configured: false, updated: false, cleared: false, reason: "no-active-gm" };
    if (globalThis.game?.user?.id === authority.id) return localHandler();
    this.#stats.routedToGm += 1;
    return this.#socket.executeAsUser(socketName, authority.id, payload);
  }

  async #queueWrite(regionUuid, task) {
    const key = String(regionUuid ?? "");
    const previous = this.#writeQueues.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    this.#writeQueues.set(key, current);
    try {
      return await current;
    } catch (error) {
      this.#stats.errors += 1;
      this.#record("write-error", { regionUuid: key || null, message: error?.message ?? String(error) });
      throw error;
    } finally {
      if (this.#writeQueues.get(key) === current) this.#writeQueues.delete(key);
    }
  }

  #normalizeFrame(input) {
    const type = String(input?.type ?? "static").trim().toLowerCase();
    if (type === "token") {
      const sourceTokenUuid = String(input?.sourceTokenUuid ?? input?.sourceUuid ?? "").trim();
      if (!sourceTokenUuid) throw new Error("Token-local Region cell frame requires sourceTokenUuid.");
      return {
        type: "token",
        sourceTokenUuid,
        offset: {
          x: finite(input?.offset?.x),
          y: finite(input?.offset?.y),
          z: finite(input?.offset?.z ?? input?.offset?.elevation)
        },
        rotationOffset: normalizeDegrees(input?.rotationOffset)
      };
    }
    if (type !== "static") throw new Error(`Unsupported Region cell frame type '${type}'.`);
    return {
      type: "static",
      origin: {
        x: finite(input?.origin?.x),
        y: finite(input?.origin?.y),
        elevation: finite(input?.origin?.elevation ?? input?.origin?.z)
      },
      rotation: normalizeDegrees(input?.rotation)
    };
  }

  #normalizeResolvedFrame(input) {
    return {
      type: String(input?.type ?? "override"),
      sourceTokenUuid: input?.sourceTokenUuid ?? null,
      origin: {
        x: finite(input?.origin?.x ?? input?.x),
        y: finite(input?.origin?.y ?? input?.y),
        elevation: finite(input?.origin?.elevation ?? input?.origin?.z ?? input?.elevation ?? input?.z)
      },
      rotation: normalizeDegrees(input?.rotation)
    };
  }

  #rawConfig(region) {
    if (!region) return null;
    if (typeof region.getFlag === "function") {
      const value = region.getFlag(MODULE_ID, REGION_CELL_FLAG);
      if (value) return value;
    }
    return getProperty(region, this.flagPath) ?? null;
  }

  #isWithinBounds(bounds, cell) {
    const { min, size } = bounds;
    return cell.x >= min.x && cell.x < min.x + size.x
      && cell.y >= min.y && cell.y < min.y + size.y
      && cell.z >= min.z && cell.z < min.z + size.z;
  }

  #gridMetrics(region, override = null) {
    const size = finite(override?.size ?? override?.gridSize ?? region?.parent?.grid?.size ?? globalThis.canvas?.dimensions?.size, 0);
    const distance = finite(override?.distance ?? override?.gridDistance ?? region?.parent?.grid?.distance ?? globalThis.canvas?.dimensions?.distance, 0);
    if (size <= 0 || distance <= 0) throw new Error("Region cell operations require a positive Scene grid size and distance.");
    return { size, distance };
  }

  #resolveToken(uuid, region) {
    if (!uuid) return null;
    try {
      const direct = globalThis.fromUuidSync?.(uuid);
      if (direct) return direct;
    } catch { /* fall through */ }
    const tokenId = String(uuid).split(".Token.")[1]?.split(".")[0] ?? null;
    if (tokenId && region?.parent?.tokens?.get) return region.parent.tokens.get(tokenId) ?? null;
    return null;
  }

  #tokenVolume(token, position, grid) {
    if (!token) return null;
    const source = token._source ?? token.document?._source ?? {};
    const data = {
      x: finite(position?.x ?? token.x ?? token.document?.x ?? source.x),
      y: finite(position?.y ?? token.y ?? token.document?.y ?? source.y),
      elevation: finite(position?.elevation ?? token.elevation ?? token.document?.elevation ?? source.elevation),
      width: finite(position?.width ?? token.width ?? token.document?.width ?? source.width, 1),
      height: finite(position?.height ?? token.height ?? token.document?.height ?? source.height, 1)
    };
    if (data.width <= 0 || data.height <= 0) return null;

    let depth = null;
    if (position && hasOwn(position, "depth") && Number.isFinite(Number(position.depth))) depth = Number(position.depth);
    else if (hasOwn(source, "depth") && Number.isFinite(Number(source.depth))) depth = Number(source.depth);
    else if (hasOwn(token, "depth") && Number.isFinite(Number(token.depth))) depth = Number(token.depth);
    else if (token.document && hasOwn(token.document, "depth") && Number.isFinite(Number(token.document.depth))) depth = Number(token.document.depth);
    if (depth == null) depth = Math.abs(data.width - data.height) <= EPSILON ? data.width : Math.max(data.width, data.height);
    depth = Math.max(0, depth);

    const widthPixels = data.width * grid.size;
    const heightPixels = data.height * grid.size;
    return {
      x: data.x,
      y: data.y,
      width: data.width,
      height: data.height,
      depth,
      bottom: data.elevation,
      top: data.elevation + (depth * grid.distance),
      polygon: [
        { x: data.x, y: data.y },
        { x: data.x + widthPixels, y: data.y },
        { x: data.x + widthPixels, y: data.y + heightPixels },
        { x: data.x, y: data.y + heightPixels }
      ]
    };
  }

  #worldToLocalWithResolvedFrame(point, elevation, frame, grid) {
    const dx = point.x - frame.origin.x;
    const dy = point.y - frame.origin.y;
    const radians = -frame.rotation * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return {
      x: ((dx * cos) - (dy * sin)) / grid.size,
      y: ((dx * sin) + (dy * cos)) / grid.size,
      z: (elevation - frame.origin.elevation) / grid.distance
    };
  }

  #regionUuid(regionOrUuid) {
    if (typeof regionOrUuid === "string") return regionOrUuid.includes(".Region.") ? regionOrUuid : null;
    const uuid = regionOrUuid?.uuid ?? null;
    return uuid && String(uuid).includes(".Region.") ? uuid : null;
  }

  async #resolveRegion(regionUuid) {
    if (!regionUuid) return null;
    const region = await globalThis.fromUuid?.(regionUuid);
    return region?.documentName === "Region" ? region : null;
  }

  #validateWritableRegion(region) {
    if (!region) return { ok: false, reason: "region-unavailable" };
    if (region.documentName !== "Region") return { ok: false, reason: "not-a-region" };
    if (!this.#regions?.isOwned?.(region)) return { ok: false, reason: "not-ae5e-owned" };
    return { ok: true };
  }

  #assertAuthority() {
    if (!globalThis.game?.user?.isGM) throw new Error("AE5E Region cell mutation must execute on a GM client.");
    const primary = this.#authority?.getPrimaryGm?.() ?? null;
    if (primary && globalThis.game?.user?.id !== primary.id) {
      throw new Error("AE5E Region cell mutation reached a non-primary GM client.");
    }
  }

  #record(type, details) {
    this.#stats.lastEvent = { at: new Date().toISOString(), type, details };
    Logger.debug?.("Region cells", this.#stats.lastEvent);
  }
}
