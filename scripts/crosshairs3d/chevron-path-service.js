/** Chevron placement is a point/path selector, never an affected-area primitive. */
export function validateChevronOptions(options = {}) {
  const mode = options.placement?.mode ?? "point";
  if (!["point", "path"].includes(mode)) throw new Error("Chevron placement.mode must be point or path.");
  const max = Number(options.range?.max ?? 60);
  if (!(Number.isFinite(max) && max > 0)) throw new Error("Chevron range.max must be positive and finite.");
  const metric = options.range?.metric ?? (mode === "path" ? "grid" : "euclidean");
  if (!["grid", "euclidean"].includes(metric)) throw new Error("Chevron range.metric must be grid or euclidean.");
  if (options.persistent?.enabled) throw new Error("Chevron placement cannot create a persistent area.");
  if (options.capabilities?.rotation || options.capabilities?.resize || options.capabilities?.los) {
    throw new Error("Chevron placement supports elevation only; rotation, resize, and los are unavailable.");
  }
  const elevationStep = options.controls?.elevationStep;
  if (elevationStep !== undefined && !(Number.isFinite(Number(elevationStep)) && Number(elevationStep) > 0)) {
    throw new Error("Chevron controls.elevationStep must be positive and finite.");
  }
  const movement = options.movement;
  if (movement !== undefined && (!movement || typeof movement !== "object" || Array.isArray(movement))) {
    throw new Error("Chevron movement must be an options object.");
  }
  if (movement?.enabled !== undefined && typeof movement.enabled !== "boolean") {
    throw new Error("Chevron movement.enabled must be true or false.");
  }
  if (movement?.enabled && (mode !== "path" || metric !== "grid")) {
    throw new Error("Chevron movement cost requires grid-metric path placement.");
  }
  if (movement?.enabled && (typeof movement.action !== "string" || !movement.action.trim())) {
    throw new Error("Chevron movement.action must identify a native movement action.");
  }
  for (const key of ["instructions", "opportunityAttackImmunity"]) {
    if (movement?.[key] !== undefined && typeof movement[key] !== "boolean") throw new Error(`Chevron movement.${key} must be true or false.`);
  }
  if (movement?.opportunityAttackImmunity && !movement.enabled) throw new Error("Chevron immunity notice requires movement placement.");
  return { mode, max, metric, movement: movement?.enabled ? { action: movement.action } : null, elevation: options.capabilities?.elevation !== false };
}

export function assertChevronGrid(grid, origin, size, distance) {
  if (!grid?.isSquare || typeof grid.getCenterPoint !== "function" || typeof grid.measurePath !== "function") {
    throw new Error("Chevron placement requires a square grid with native path measurement.");
  }
  for (const steps of [1, 2]) {
    const measured = Number(grid.measurePath([origin, {
      x: origin.x + size * steps, y: origin.y + size * steps
    }]).distance);
    if (!Number.isFinite(measured) || Math.abs(measured - distance * steps) > 1e-6) {
      throw new Error("Chevron grid distance currently requires equal-cost diagonals (one diagonal square costs one grid unit).");
    }
  }
}

/** Pixel XY, Scene-unit elevation. Grid mode preserves the accepted equal-cost XYZ rule. */
export function measureChevronPath(points, { grid, size, distance, metric = "grid" }) {
  let total = 0;
  if (metric === "euclidean") {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      total += Math.hypot((b.x - a.x) * distance / size,
        (b.y - a.y) * distance / size, b.elevation - a.elevation);
    }
  } else {
    total = Number(grid.measurePath(points.map(({ x, y }) => ({ x, y }))).distance);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const flat = Number(grid.measurePath([{ x: a.x, y: a.y }, { x: b.x, y: b.y }]).distance);
      total += Math.max(0, Math.abs(b.elevation - a.elevation) - flat);
    }
  }
  if (!Number.isFinite(total) || total < 0) throw new Error("Invalid Chevron path distance.");
  return total;
}

export function chevronElevationChanges(origin, waypoints) {
  return waypoints.flatMap((point, index) => {
    const change = point.elevation - (index ? waypoints[index - 1] : origin).elevation;
    return change ? [{ point, change }] : [];
  });
}

/** Use Foundry's token-specific terrain/cost pipeline; Terrain Mapper is optional. */
export function measureChevronMovement(points, { source, size, action }) {
  const document = source.document;
  const requested = points.filter((point, index) => !index ||
    point.x !== points[index - 1].x || point.y !== points[index - 1].y ||
    point.elevation !== points[index - 1].elevation).map(point => ({
      x: point.x - document.width * size / 2,
      y: point.y - document.height * size / 2,
      elevation: point.elevation, action,
      width: document.width, height: document.height, depth: document.depth,
      shape: document.shape, level: document.level,
      explicit: true, checkpoint: true, snapped: true, intermediate: false
    }));
  const terrainPath = source.createTerrainMovementPath(requested, { preview: true });
  if (!Array.isArray(terrainPath) || !terrainPath.length) throw new Error("Invalid native Chevron terrain path.");
  const result = source.measureMovementPath(terrainPath, { preview: true });
  if (!Number.isFinite(result.distance) || result.distance < 0 ||
      typeof result.cost !== "number" || Number.isNaN(result.cost) || result.cost < 0) {
    throw new Error("Invalid native Chevron movement measurement.");
  }
  return { cost: result.cost, movementDistance: result.distance, movementAction: action };
}
