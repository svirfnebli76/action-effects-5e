const EPSILON = 1e-7;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function overlapInterval(a, b, low, high) {
  const delta = b - a;
  if (Math.abs(delta) <= EPSILON) return a >= low - EPSILON && a <= high + EPSILON
    ? { min: 0, max: 1 } : null;
  let t0 = (low - a) / delta;
  let t1 = (high - a) / delta;
  if (t0 > t1) [t0, t1] = [t1, t0];
  const min = Math.max(0, t0);
  const max = Math.min(1, t1);
  return max - min > EPSILON ? { min, max } : null;
}

/**
 * Foundry v14 physical-obstruction adapter for 3D propagation.
 *
 * Walls are queried once per Scene Level, only over the part of the ray whose
 * elevation lies inside that Level. A wall with no Level assignment is exposed
 * by Foundry in every Level and is consequently unbounded when the Scene's
 * default Level is unbounded. Surfaces are queried without a viewed-Level
 * filter so their exact elevations remain authoritative.
 */
export class Crosshair3dFoundryPropagationEnvironment {
  #metricsService;
  #geometry;
  #xySamples;
  #zSlabs;
  #faceSamples;
  #cooperateEvery;

  constructor({ metricsService, geometry, xySamples = 4, zSlabs = 4, faceSamples = 10, cooperateEvery = 256 } = {}) {
    this.#metricsService = metricsService;
    this.#geometry = geometry;
    for (const [label, value] of [["xySamples", xySamples], ["zSlabs", zSlabs], ["faceSamples", faceSamples], ["cooperateEvery", cooperateEvery]]) {
      if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${label} must be a positive integer.`);
    }
    this.#xySamples = xySamples;
    this.#zSlabs = zSlabs;
    this.#faceSamples = faceSamples;
    this.#cooperateEvery = cooperateEvery;
  }

  create({ scene = globalThis.canvas?.scene, source = null, metrics = this.#metricsService.resolve(),
    collision = null, cooperate = null, signal = null } = {}) {
    if (!scene) throw new Error("A Scene is required for physical propagation.");
    if (cooperate !== null && typeof cooperate !== "function") throw new TypeError("cooperate must be a function when provided.");
    const blocked = collision ?? ((a, b) => this.#collision(scene, source, metrics, a, b));
    let samples = 0;
    const checkAbort = () => {
      if (signal?.aborted) {
        const error = new Error("Propagation cancelled.");
        error.name = "AbortError";
        throw error;
      }
    };
    const isBlocked = async (a, b) => {
      checkAbort();
      const result = Boolean(await blocked(a, b));
      samples += 1;
      if (cooperate && samples % this.#cooperateEvery === 0) {
        await cooperate();
        checkAbort();
      }
      return result;
    };

    return Object.freeze({
      directCoverage: async query => {
        const { world, support, shape } = query;
        const slabs = [];
        // Pitched Cones can exceed 50% cell coverage only within a narrow Z
        // band. Match the rasterizer's 17-slice evidence instead of allowing
        // the generic four fixed midpoints to miss that qualifying band.
        const shapeBounds = shape.type === "cone" ? this.#geometry.getBounds(shape) : null;
        const zLow = shapeBounds ? Math.max(world.minZ, shapeBounds.minZ) : world.minZ;
        const zHigh = shapeBounds ? Math.min(world.maxZ, shapeBounds.maxZ) : world.maxZ;
        if (!(zHigh - zLow > EPSILON)) return Object.freeze({ slabs: Object.freeze([]) });
        const slabCount = shape.type === "cone" ? 17 : this.#zSlabs;
        for (let slab = 0; slab < slabCount; slab += 1) {
          const zMin = zLow + ((zHigh - zLow) * slab / slabCount);
          const zMax = zLow + ((zHigh - zLow) * (slab + 1) / slabCount);
          const z = (zMin + zMax) / 2;
          let clear = 0;
          const total = this.#xySamples * this.#xySamples;
          for (let y = 0; y < this.#xySamples; y += 1) {
            for (let x = 0; x < this.#xySamples; x += 1) {
              const destination = {
                x: world.minX + ((x + 0.5) * (world.maxX - world.minX) / this.#xySamples),
                y: world.minY + ((y + 0.5) * (world.maxY - world.minY) / this.#xySamples),
                z
              };
              if (support !== "chart-cell" && !this.#geometry.containsPoint(shape, destination)) continue;
              if (!(await isBlocked(query.origin, destination))) clear += 1;
            }
          }
          slabs.push(Object.freeze({ zMin, zMax, xyCoverage: clear / total }));
        }
        return Object.freeze({ slabs: Object.freeze(slabs) });
      },

      seedOpen: async query => {
        const world = query.world;
        return !(await isBlocked(query.origin, {
          x: (world.minX + world.maxX) / 2,
          y: (world.minY + world.maxY) / 2,
          z: (world.minZ + world.maxZ) / 2
        }));
      },

      sharedFace: async query => {
        const n = this.#faceSamples;
        const open = Array.from({ length: n }, () => Array(n).fill(false));
        const d = query.grid.distance;
        const inset = Math.max(d * 1e-4, EPSILON * 10);
        for (let v = 0; v < n; v += 1) {
          for (let u = 0; u < n; u += 1) {
            const point = this.#facePoint(query.world, query.axis, query.sign, (u + 0.5) / n, (v + 0.5) / n);
            const a = { ...point, [query.axis]: point[query.axis] - (query.sign * inset) };
            const b = { ...point, [query.axis]: point[query.axis] + (query.sign * inset) };
            open[v][u] = !(await isBlocked(a, b));
          }
        }
        return Object.freeze({ largestContiguousFraction: this.#largestComponent(open) / (n * n) });
      },

      connectorOpen: async ({ connector }) => {
        if (connector?.open === false) return false;
        return !(await isBlocked(connector.entrance, connector.destination));
      }
    });
  }

  #facePoint(world, axis, sign, u, v) {
    const axes = ["x", "y", "z"].filter(candidate => candidate !== axis);
    const bounds = key => [world[`min${key.toUpperCase()}`], world[`max${key.toUpperCase()}`]];
    const [a0, a1] = bounds(axes[0]);
    const [b0, b1] = bounds(axes[1]);
    return {
      [axis]: sign > 0 ? world[`max${axis.toUpperCase()}`] : world[`min${axis.toUpperCase()}`],
      [axes[0]]: a0 + ((a1 - a0) * u),
      [axes[1]]: b0 + ((b1 - b0) * v)
    };
  }

  #largestComponent(matrix) {
    const height = matrix.length;
    const width = matrix[0]?.length ?? 0;
    const seen = new Set();
    let largest = 0;
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const start = `${x},${y}`;
      if (!matrix[y][x] || seen.has(start)) continue;
      const queue = [[x, y]];
      seen.add(start);
      let count = 0;
      for (let i = 0; i < queue.length; i += 1) {
        const [cx, cy] = queue[i];
        count += 1;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy, key = `${nx},${ny}`;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height || !matrix[ny][nx] || seen.has(key)) continue;
          seen.add(key);
          queue.push([nx, ny]);
        }
      }
      largest = Math.max(largest, count);
    }
    return largest;
  }

  #collision(scene, sourceToken, metrics, from, to) {
    const origin = this.#metricsService.distanceToPixels(from, metrics);
    const destination = this.#metricsService.distanceToPixels(to, metrics);
    if (scene.testSurfaceCollision?.(origin, destination, {
      type: "move", mode: "any", tMin: EPSILON, tMax: 1 - EPSILON
    })) return true;

    const backend = globalThis.CONFIG?.Canvas?.polygonBackends?.move;
    if (typeof backend?.testCollision !== "function") {
      throw new Error("Foundry movement collision backend is unavailable.");
    }
    const levels = [...(scene.levels?.contents ?? scene.levels ?? [])];
    if (!levels.length) throw new Error("Scene Levels are unavailable for Wall height evaluation.");
    for (const level of levels) {
      const bottom = finite(level?.elevation?.bottom, Number.NEGATIVE_INFINITY);
      const top = finite(level?.elevation?.top, Number.POSITIVE_INFINITY);
      const interval = overlapInterval(origin.elevation, destination.elevation, bottom, top);
      if (!interval) continue;
      let movementSource = null;
      const PointMovementSource = globalThis.PointMovementSource;
      if (PointMovementSource && sourceToken) {
        movementSource = new PointMovementSource({ object: sourceToken });
        movementSource.initialize?.({ ...origin, level: level.id });
      }
      if (backend.testCollision(origin, destination, {
        type: "move", mode: "any", source: movementSource, level,
        tMin: Math.max(EPSILON, interval.min), tMax: Math.min(1 - EPSILON, interval.max)
      })) return true;
    }
    return false;
  }
}
