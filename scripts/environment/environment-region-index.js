import { Logger } from "../core/logger.js";

function sceneForDocument(document) {
  if (!document) return null;
  if (document.documentName === "Scene") return document;
  if (document.documentName === "Region") return document.parent ?? null;
  if (document.documentName === "RegionBehavior") return document.parent?.parent ?? null;
  return document.parent?.documentName === "Scene" ? document.parent : null;
}

function behaviorList(region) {
  try { return [...(region?.behaviors ?? [])]; } catch { return []; }
}

/** Cached Scene index of Regions that advertise environmental capabilities. */
export class EnvironmentRegionIndex {
  #capabilities;
  #geometry;
  #initialized = false;
  #cache = new Map();
  #hooks = [];
  #stats = { builds: 0, invalidations: 0, cacheHits: 0, scans: 0, indexedBehaviors: 0 };

  constructor({ capabilities, geometry }) {
    this.#capabilities = capabilities;
    this.#geometry = geometry;
  }

  initialize() {
    if (this.#initialized) return;
    this.#initialized = true;
    const invalidate = (document) => this.invalidate(sceneForDocument(document));
    for (const hook of ["createRegion", "updateRegion", "deleteRegion", "createRegionBehavior", "updateRegionBehavior", "deleteRegionBehavior"]) {
      const id = globalThis.Hooks?.on?.(hook, invalidate);
      if (id !== undefined && id !== null) this.#hooks.push([hook, id]);
    }
    const canvasReadyId = globalThis.Hooks?.on?.("canvasReady", (canvas) => this.invalidate(canvas?.scene ?? globalThis.canvas?.scene));
    if (canvasReadyId !== undefined && canvasReadyId !== null) this.#hooks.push(["canvasReady", canvasReadyId]);
  }

  invalidate(scene = null) {
    if (!scene) {
      if (this.#cache.size) this.#stats.invalidations += 1;
      this.#cache.clear();
      return;
    }
    const key = scene.uuid ?? scene.id;
    if (key && this.#cache.delete(key)) this.#stats.invalidations += 1;
  }

  hasConsumers(eventType, scene = null) {
    return this.getConsumers(eventType, scene).length > 0;
  }

  getConsumers(eventType, scene = null) {
    scene ??= globalThis.canvas?.scene ?? null;
    if (!scene) return [];
    const key = scene.uuid ?? scene.id;
    if (!key) return [];
    let index = this.#cache.get(key);
    if (!index) {
      index = this.#build(scene);
      this.#cache.set(key, index);
    } else {
      this.#stats.cacheHits += 1;
    }
    return [...(index.byEvent.get(String(eventType ?? "").trim().toLowerCase()) ?? [])];
  }

  getStats() {
    return Object.freeze({ ...this.#stats, scenes: this.#cache.size, initialized: this.#initialized });
  }

  #build(scene) {
    this.#stats.builds += 1;
    const byEvent = new Map();
    for (const region of [...(scene.regions ?? [])]) {
      this.#stats.scans += 1;
      let regionGeometry = null;
      for (const behavior of behaviorList(region)) {
        if (behavior?.disabled === true) continue;
        const capability = this.#capabilities.getForBehaviorType(behavior?.type);
        if (!capability) continue;
        regionGeometry ??= this.#geometry.fromRegion(region);
        if (!regionGeometry) continue;
        const entry = Object.freeze({
          region,
          behavior,
          capability,
          geometry: regionGeometry,
          bounds: regionGeometry.bounds
        });
        for (const eventType of capability.eventTypes) {
          const list = byEvent.get(eventType) ?? [];
          list.push(entry);
          byEvent.set(eventType, list);
        }
        this.#stats.indexedBehaviors += 1;
      }
    }
    for (const [eventType, entries] of byEvent) {
      entries.sort((a, b) => Number(b.behavior?.system?.priority ?? 0) - Number(a.behavior?.system?.priority ?? 0));
      byEvent.set(eventType, Object.freeze(entries));
    }
    Logger.debug?.("Environmental Region index built", { sceneUuid: scene.uuid, events: [...byEvent.keys()] });
    return { byEvent };
  }
}
