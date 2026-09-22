import { MODULE_ID, REGION_CELL_STATES } from "../core/constants.js";
import { Logger } from "../core/logger.js";

const META_FLAG = "crosshair3dPersistentArea";
const TRANSFORM_FIELDS = Object.freeze(["x", "y", "elevation", "rotation", "width", "height"]);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clone(value) {
  if (globalThis.foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
  return structuredClone(value);
}

function getFlag(region, key) {
  if (typeof region?.getFlag === "function") return region.getFlag(MODULE_ID, key);
  return region?.flags?.[MODULE_ID]?.[key] ?? null;
}

function randomId() {
  return globalThis.foundry?.utils?.randomID?.(16)
    ?? globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Re-resolves attached Direct/Spread persistent areas after their source or
 * physical environment changes. None areas remain a pure Foundry attachment
 * transform and never query obstruction geometry.
 */
export class Crosshair3dAttachedPropagationService {
  #authority;
  #regions;
  #regionCells;
  #propagation;
  #environment;
  #persistentAreas;
  #metricsService;
  #hooks = [];
  #queues = new Map();
  #initialized = false;
  #stats = { queued: 0, resolved: 0, deactivated: 0, skipped: 0, errors: 0, last: null };

  constructor({ authority, regions, regionCells, propagation, environment, persistentAreas, metricsService }) {
    this.#authority = authority;
    this.#regions = regions;
    this.#regionCells = regionCells;
    this.#propagation = propagation;
    this.#environment = environment;
    this.#persistentAreas = persistentAreas;
    this.#metricsService = metricsService;
  }

  initialize() {
    if (this.#initialized || !globalThis.Hooks?.on) return;
    this.#initialized = true;
    this.#on("updateToken", (document, changes) => {
      if (!TRANSFORM_FIELDS.some(field => Object.hasOwn(changes ?? {}, field))) return;
      const source = this.#sourceWithChanges(document, changes);
      for (const region of this.#regionsForSource(document)) this.#queue(region, { source, reason: "source-transform" });
    });
    for (const name of ["createWall", "updateWall", "deleteWall", "createLevel", "updateLevel", "deleteLevel"]) {
      this.#on(name, document => this.#queueScene(document?.parent, name));
    }
    this.#on("updateRegion", (document, changes, options = {}) => {
      if (options.ae5eCrosshair3dRepropagation) return;
      const isSurface = [...(document?.behaviors ?? [])].some(behavior =>
        !behavior.disabled && behavior.type === "defineSurface" && behavior.system?.move);
      if (!isSurface && !Object.hasOwn(changes ?? {}, "behaviors")) return;
      this.#queueScene(document?.parent, "surface-update");
    });
    for (const name of ["createRegion", "deleteRegion"]) this.#on(name, document => {
      const surface = [...(document?.behaviors ?? [])].some(behavior =>
        !behavior.disabled && behavior.type === "defineSurface" && behavior.system?.move);
      if (surface) this.#queueScene(document?.parent, name);
    });
    Logger.info("Attached 3D propagation service ready.");
  }

  shutdown() {
    for (const [name, id] of this.#hooks) globalThis.Hooks?.off?.(name, id);
    this.#hooks = [];
    this.#queues.clear();
    this.#initialized = false;
  }

  getStats() {
    return Object.freeze({ ...this.#stats, initialized: this.#initialized, pending: this.#queues.size });
  }

  async resolveRegion(region, { source = null, reason = "manual" } = {}) {
    if (!this.#isAuthority()) return { resolved: false, reason: "not-primary-gm" };
    const metadata = getFlag(region, META_FLAG);
    if (!this.#isEnvironmentSensitive(metadata)) return { resolved: false, reason: "not-environment-sensitive" };
    const scene = region.parent;
    if (!scene || globalThis.canvas?.scene !== scene) {
      return { resolved: false, reason: "scene-not-active" };
    }
    const sourceDocument = source ?? await globalThis.fromUuid?.(metadata.sourceTokenUuid);
    if (!sourceDocument) return this.#deactivate(region, metadata, "source-unavailable");
    const metrics = this.#metricsService.resolve(globalThis.canvas);
    const priorTransform = metadata.sourceTransform;
    const nextTransform = this.#sourceTransform(sourceDocument);
    if (!priorTransform) return this.#deactivate(region, metadata, "source-transform-unavailable");
    const shape = this.#transformShape(metadata.shape, priorTransform, nextTransform, metrics);
    const origin = this.#transformPoint(metadata.origin, priorTransform, nextTransform, metrics);
    const connectors = (metadata.connectors ?? []).map(connector => ({
      ...clone(connector),
      from: this.#transformPoint(connector.from, priorTransform, nextTransform, metrics),
      to: this.#transformPoint(connector.to, priorTransform, nextTransform, metrics)
    }));
    const placeable = sourceDocument.object ?? globalThis.canvas?.tokens?.get?.(sourceDocument.id) ?? sourceDocument;
    try {
      const environment = this.#environment.create({ scene, source: placeable, metrics });
      const result = await this.#propagation.resolve({
        shape,
        grid: metrics.grid,
        mode: metadata.propagation,
        environment,
        origin,
        connectors
      });
      if (!result.cells.length) return this.#deactivate(region, {
        ...metadata, shape, origin, connectors, sourceTransform: nextTransform
      }, "no-affected-cells");
      const built = this.#persistentAreas.build({
        propagation: result,
        scene,
        source: sourceDocument,
        metrics,
        options: {
          attached: true,
          connectors,
          name: region.name,
          color: region.color,
          locked: region.locked,
          visibility: region.visibility,
          behaviors: [...(region.behaviors ?? [])].map(behavior => behavior.toObject?.() ?? clone(behavior))
        }
      });
      const nextMetadata = built.regionData.flags[MODULE_ID][META_FLAG];
      const configured = await this.#regionCells.configure(region, built.config);
      if (!configured?.configured) {
        throw new Error(`Region cell-mask replacement failed: ${configured?.reason ?? "unknown"}.`);
      }
      const update = await this.#regions.updateCrosshair3d(region, {
        shapes: built.regionData.shapes,
        elevation: built.regionData.elevation,
        [`flags.${MODULE_ID}.${META_FLAG}`]: { ...nextMetadata, lastReason: reason,
          repropagatedAt: new Date().toISOString() }
      }, { requestId: `${region.uuid}:${randomId()}` });
      if (!update?.updated) {
        await this.#deactivateCells(region, built.config);
        throw new Error(`Region re-propagation update failed: ${update?.reason ?? "unknown"}.`);
      }
      this.#stats.resolved += 1;
      this.#record("resolved", { regionUuid: region.uuid, reason, cells: result.cells.length });
      return { resolved: true, regionUuid: region.uuid, reason, cells: result.cells.length, propagation: result };
    } catch (error) {
      this.#stats.errors += 1;
      await this.#deactivate(region, { ...metadata, shape, origin, connectors, sourceTransform: nextTransform },
        "resolution-error");
      Logger.warn("Attached 3D propagation failed closed.", error);
      return { resolved: false, reason: "resolution-error", error: error?.message ?? String(error) };
    }
  }

  #on(name, fn) {
    const wrapped = (...args) => {
      try { return fn(...args); }
      catch (error) { this.#stats.errors += 1; Logger.warn("Attached 3D propagation hook failed.", error); }
    };
    this.#hooks.push([name, Hooks.on(name, wrapped)]);
  }

  #queueScene(scene, reason) {
    if (!scene || globalThis.canvas?.scene !== scene) return;
    for (const region of scene.regions ?? []) {
      const metadata = getFlag(region, META_FLAG);
      if (this.#isEnvironmentSensitive(metadata)) this.#queue(region, { reason });
    }
  }

  #queue(region, options) {
    if (!this.#isAuthority()) { this.#stats.skipped += 1; return; }
    const key = region.uuid;
    const previous = this.#queues.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(() => this.resolveRegion(region, options));
    this.#queues.set(key, current);
    this.#stats.queued += 1;
    current.finally(() => { if (this.#queues.get(key) === current) this.#queues.delete(key); });
  }

  #regionsForSource(source) {
    const scene = source?.parent;
    if (!scene || globalThis.canvas?.scene !== scene) return [];
    return [...(scene.regions ?? [])].filter(region => {
      const metadata = getFlag(region, META_FLAG);
      return this.#isEnvironmentSensitive(metadata) && metadata.sourceTokenUuid === source.uuid;
    });
  }

  #isEnvironmentSensitive(metadata) {
    return metadata?.attached === true && ["direct", "spread"].includes(metadata.propagation);
  }

  #isAuthority() {
    if (!globalThis.game?.user?.isGM) return false;
    const primary = this.#authority?.getPrimaryGm?.() ?? null;
    return !primary || primary.id === globalThis.game.user.id;
  }

  #sourceWithChanges(source, changes) {
    return Object.freeze({
      id: source.id,
      uuid: source.uuid,
      parent: source.parent,
      object: source.object,
      ...Object.fromEntries(TRANSFORM_FIELDS.map(field => [field,
        Object.hasOwn(changes ?? {}, field) ? changes[field] : source[field]]))
    });
  }

  #sourceTransform(source) {
    return Object.fromEntries(TRANSFORM_FIELDS.map(field => [field,
      finite(source?.[field], ["width", "height"].includes(field) ? 1 : 0)]));
  }

  #center(transform, metrics) {
    return {
      x: ((transform.x + (transform.width * metrics.size / 2) - metrics.originX) / metrics.size) * metrics.distance,
      y: ((transform.y + (transform.height * metrics.size / 2) - metrics.originY) / metrics.size) * metrics.distance,
      z: transform.elevation
    };
  }

  #transformPoint(point, fromTransform, toTransform, metrics) {
    if (!point) return null;
    const from = this.#center(fromTransform, metrics);
    const to = this.#center(toTransform, metrics);
    const radians = (toTransform.rotation - fromTransform.rotation) * Math.PI / 180;
    const dx = point.x - from.x;
    const dy = point.y - from.y;
    return {
      x: to.x + (dx * Math.cos(radians)) - (dy * Math.sin(radians)),
      y: to.y + (dx * Math.sin(radians)) + (dy * Math.cos(radians)),
      z: point.z + (to.z - from.z)
    };
  }

  #transformShape(shapeInput, fromTransform, toTransform, metrics) {
    const shape = clone(shapeInput);
    shape.origin = this.#transformPoint(shape.origin, fromTransform, toTransform, metrics);
    if (Number.isFinite(shape.yaw)) {
      shape.yaw = ((shape.yaw + toTransform.rotation - fromTransform.rotation) % 360 + 360) % 360;
    }
    return shape;
  }

  async #deactivate(region, metadata, reason) {
    const existing = this.#regionCells.getConfig(region);
    if (!existing) return { resolved: false, reason: "cell-config-unavailable" };
    const config = this.#regionCells.buildRegionFlag({
      bounds: existing.bounds,
      defaultState: REGION_CELL_STATES.INACTIVE,
      cells: {},
      frame: existing.frame
    });
    const configured = await this.#regionCells.configure(region, config);
    const update = await this.#regions.updateCrosshair3d(region, {
      [`flags.${MODULE_ID}.${META_FLAG}`]: { ...clone(metadata), lastReason: reason,
        repropagatedAt: new Date().toISOString() }
    }, { requestId: `${region.uuid}:${randomId()}` });
    if (configured?.configured && update?.updated) {
      this.#stats.deactivated += 1;
      this.#record("deactivated", { regionUuid: region.uuid, reason });
    }
    return { resolved: false, reason, deactivated: Boolean(configured?.configured && update?.updated) };
  }

  async #deactivateCells(region, config) {
    const inactive = this.#regionCells.buildRegionFlag({
      bounds: config.bounds,
      defaultState: REGION_CELL_STATES.INACTIVE,
      cells: {},
      frame: config.frame
    });
    await this.#regionCells.configure(region, inactive);
  }

  #record(type, details) {
    this.#stats.last = { type, at: new Date().toISOString(), ...details };
  }
}
