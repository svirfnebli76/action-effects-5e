import { MODULE_ID, REGION_CELL_FLAG, REGION_CELL_STATES } from "../core/constants.js";

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function randomId() {
  return globalThis.foundry?.utils?.randomID?.(16)
    ?? globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Builds and persists the broad native Region shell plus exact AE5E 3D cells. */
export class Crosshair3dPersistentAreaService {
  #regions;
  #regionCells;
  #metricsService;

  constructor({ regions, regionCells, metricsService }) {
    this.#regions = regions;
    this.#regionCells = regionCells;
    this.#metricsService = metricsService;
  }

  build({ propagation, scene, source, metrics, options = {} }) {
    const cells = propagation?.cells ?? [];
    if (!cells.length) throw new Error("A persistent area requires at least one affected cell.");
    const xs = cells.map(cell => cell.x), ys = cells.map(cell => cell.y), zs = cells.map(cell => cell.z);
    const min = { x: Math.min(...xs), y: Math.min(...ys), z: Math.min(...zs) };
    const max = { x: Math.max(...xs) + 1, y: Math.max(...ys) + 1, z: Math.max(...zs) + 1 };
    const d = metrics.distance;
    const p0 = this.#metricsService.distanceToPixels({ x: min.x * d, y: min.y * d, z: min.z * d }, metrics);
    const p1 = this.#metricsService.distanceToPixels({ x: max.x * d, y: max.y * d, z: max.z * d }, metrics);
    const attached = options.attached === true;
    const frame = attached
      ? this.#tokenFrame(source?.document ?? source, metrics)
      : { type: "static", origin: { x: metrics.originX, y: metrics.originY, elevation: 0 }, rotation: 0 };
    const config = this.#regionCells.buildRegionFlag({
      bounds: { min, max },
      defaultState: REGION_CELL_STATES.INACTIVE,
      cells: Object.fromEntries(cells.map(cell => [`${cell.x},${cell.y},${cell.z}`, REGION_CELL_STATES.ACTIVE])),
      frame
    });
    const color = String(options.color ?? "#7fefef");
    const regionData = {
      name: String(options.name ?? "AE5E Persistent Area").trim() || "AE5E Persistent Area",
      color,
      shapes: [{
        type: "rectangle", x: p0.x, y: p0.y,
        width: p1.x - p0.x, height: p1.y - p0.y,
        anchorX: 0, anchorY: 0, rotation: 0
      }],
      elevation: { bottom: min.z * d, top: max.z * d },
      behaviors: Array.isArray(options.behaviors) ? options.behaviors : [],
      locked: options.locked !== false,
      visibility: options.visibility ?? 0,
      ...(attached ? { attachment: { token: source.document?.id ?? source.id } } : {}),
      flags: {
        [MODULE_ID]: {
          [REGION_CELL_FLAG]: config,
          crosshair3dPersistentArea: {
            schemaVersion: 1,
            propagation: propagation.mode,
            support: propagation.support,
            shape: propagation.shape,
            origin: propagation.origin,
            sourceTokenUuid: source.document?.uuid ?? source.uuid ?? null,
            attached
          }
        }
      }
    };
    return Object.freeze({ regionData, config, bounds: { min, max }, operationId: randomId(), scene });
  }

  async create(input) {
    const built = this.build(input);
    const result = await this.#regions.create(built.regionData, {
      scene: built.scene,
      requestId: built.operationId,
      metadata: { kind: "crosshair3d-persistent-area", operationId: built.operationId }
    });
    if (!result?.created) throw new Error(`Persistent Region creation failed: ${result?.reason ?? "unknown"}.`);
    return Object.freeze({ ...result, operationId: built.operationId, bounds: built.bounds });
  }

  #tokenFrame(source, metrics) {
    if (!source?.uuid) throw new Error("Attached persistent area requires a persisted source Token.");
    const width = finite(source.width, 1) * metrics.size;
    const height = finite(source.height, 1) * metrics.size;
    const center = { x: finite(source.x) + width / 2, y: finite(source.y) + height / 2 };
    const rotation = finite(source.rotation);
    const radians = -rotation * Math.PI / 180;
    const dx = metrics.originX - center.x;
    const dy = metrics.originY - center.y;
    return {
      type: "token",
      sourceTokenUuid: source.uuid,
      offset: {
        x: ((dx * Math.cos(radians)) - (dy * Math.sin(radians))) / metrics.size,
        y: ((dx * Math.sin(radians)) + (dy * Math.cos(radians))) / metrics.size,
        z: -finite(source.elevation) / metrics.distance
      },
      rotationOffset: ((-rotation % 360) + 360) % 360
    };
  }
}
