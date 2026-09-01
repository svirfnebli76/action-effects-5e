import {
  ENVIRONMENT_DEDUPE_TTL_MS,
  ENVIRONMENT_EVENT_TYPES,
  ENVIRONMENT_MAX_RECENT_EVENTS
} from "../core/constants.js";
import { Logger } from "../core/logger.js";
import { duplicateSafely, nowIso, randomId } from "../core/utils.js";

function normalizeType(value) {
  return String(value ?? "").trim().toLowerCase();
}

function boundsIntersect(left, right) {
  if (!left || !right) return true;
  return left.maxX >= right.minX && left.minX <= right.maxX
    && left.maxY >= right.minY && left.minY <= right.maxY;
}

/**
 * Event-driven environmental dispatcher. It never polls the canvas. External
 * adapters report a normalized event and only intersect Regions which declare
 * a capability interested in that event type.
 */
export class EnvironmentalInteractionService {
  #socket;
  #authority;
  #capabilities;
  #profiles;
  #geometry;
  #index;
  #mutations;
  #initialized = false;
  #seen = new Map();
  #recent = [];
  #stats = {
    emitRequests: 0,
    localEarlyExits: 0,
    routedToGm: 0,
    processed: 0,
    duplicates: 0,
    candidateChecks: 0,
    preciseIntersections: 0,
    reactions: 0,
    regionUpdates: 0,
    errors: 0,
    totalProcessingMs: 0,
    maxProcessingMs: 0,
    lastProcessingMs: 0
  };

  constructor({ socket, authority, capabilities, profiles, geometry, index, mutations }) {
    this.#socket = socket;
    this.#authority = authority;
    this.#capabilities = capabilities;
    this.#profiles = profiles;
    this.#geometry = geometry;
    this.#index = index;
    this.#mutations = mutations;
    socket.register("environment.emit", payload => this.#processAsAuthority(payload));
  }

  initialize() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#index.initialize();
  }

  hasConsumers(eventType, scene = null) {
    const type = normalizeType(eventType);
    if (!type || !this.#capabilities.hasEventConsumers(type)) return false;
    return this.#index.hasConsumers(type, scene);
  }

  async emit(input = {}) {
    this.#stats.emitRequests += 1;
    const event = this.#normalizeEvent(input);
    if (!event) return { processed: false, reason: "invalid-event" };
    const scene = await this.#resolveScene(event.sceneUuid);
    if (!scene) return { processed: false, reason: "scene-unavailable", eventId: event.id };
    event.sceneUuid = scene.uuid;

    if (!this.#index.hasConsumers(event.type, scene)) {
      this.#stats.localEarlyExits += 1;
      return { processed: false, reason: "no-consumers", eventId: event.id, sceneUuid: scene.uuid };
    }

    const primary = this.#authority?.getPrimaryGm?.() ?? [...(globalThis.game?.users ?? [])].find(user => user?.active && user?.isGM) ?? null;
    if (!primary) return { processed: false, reason: "no-active-gm", eventId: event.id };
    if (globalThis.game?.user?.id === primary.id) return this.#processAsAuthority(event);
    this.#stats.routedToGm += 1;
    return this.#socket.executeAsUser("environment.emit", primary.id, event);
  }

  emitFire({ geometry, source = null, delivery = "manual", scene = null, idempotencyKey = null, metadata = null } = {}) {
    return this.emit({
      type: ENVIRONMENT_EVENT_TYPES.FIRE,
      geometry,
      source,
      delivery,
      sceneUuid: typeof scene === "string" ? scene : scene?.uuid ?? null,
      idempotencyKey,
      metadata
    });
  }

  registerCapability(config) {
    this.#index.invalidate();
    const unregister = this.#capabilities.register(config);
    return () => {
      const result = unregister();
      this.#index.invalidate();
      return result;
    };
  }

  registerProfile(capabilityId, profileId, config) {
    return this.#profiles.register(capabilityId, profileId, config);
  }

  unregisterProfile(capabilityId, profileId) {
    return this.#profiles.unregister(capabilityId, profileId);
  }

  getRecentEvents() {
    return duplicateSafely(this.#recent);
  }

  getStats() {
    const processed = this.#stats.processed || 1;
    return Object.freeze({
      ...this.#stats,
      initialized: this.#initialized,
      averageProcessingMs: this.#stats.totalProcessingMs / processed,
      consumers: this.#index.getStats(),
      capabilities: this.#capabilities.getStats(),
      profiles: this.#profiles.getStats(),
      mutations: this.#mutations.getStats()
    });
  }

  async #processAsAuthority(payload) {
    const started = globalThis.performance?.now?.() ?? Date.now();
    const event = this.#normalizeEvent(payload);
    if (!event) return { processed: false, reason: "invalid-event" };
    const primary = this.#authority?.getPrimaryGm?.() ?? null;
    if (!globalThis.game?.user?.isGM || (primary && primary.id !== globalThis.game.user.id)) {
      return { processed: false, reason: "not-primary-gm", eventId: event.id, primaryGmId: primary?.id ?? null };
    }
    this.#cleanupSeen();
    if (this.#seen.has(event.id)) {
      this.#stats.duplicates += 1;
      return { processed: false, reason: "duplicate", eventId: event.id };
    }
    this.#seen.set(event.id, Date.now());

    try {
      const scene = await this.#resolveScene(event.sceneUuid);
      if (!scene) return { processed: false, reason: "scene-unavailable", eventId: event.id };
      const candidates = this.#index.getConsumers(event.type, scene);
      if (!candidates.length) return { processed: false, reason: "no-consumers", eventId: event.id };
      const eventBounds = event.geometry?.bounds ?? this.#geometry.getBounds(event.geometry);
      const reactionsByRegion = new Map();
      let intersectingBehaviors = 0;
      let eventReactions = 0;

      for (const candidate of candidates) {
        this.#stats.candidateChecks += 1;
        if (!boundsIntersect(eventBounds, candidate.bounds)) continue;
        this.#stats.preciseIntersections += 1;
        if (!this.#geometry.intersects(event.geometry, candidate.geometry)) continue;
        intersectingBehaviors += 1;
        const outcome = await candidate.capability.handler(Object.freeze({
          event,
          scene,
          region: candidate.region,
          behavior: candidate.behavior,
          capability: candidate.capability,
          eventGeometry: event.geometry,
          regionGeometry: candidate.geometry,
          geometry: this.#geometry
        }));
        const profile = outcome?.profile ?? null;
        const reaction = outcome?.reaction ?? outcome ?? null;
        if (!reaction || reaction.handled === false) continue;
        this.#stats.reactions += 1;
        eventReactions += 1;
        const key = candidate.region.uuid;
        const list = reactionsByRegion.get(key) ?? { region: candidate.region, entries: [] };
        list.entries.push({ behavior: candidate.behavior, capability: candidate.capability, profile, reaction });
        reactionsByRegion.set(key, list);
      }

      const updates = [];
      for (const { region, entries } of reactionsByRegion.values()) {
        const result = await this.#mutations.apply(region, entries, event);
        if (result.updated) this.#stats.regionUpdates += 1;
        updates.push(result);
      }

      this.#stats.processed += 1;
      const result = {
        processed: true,
        eventId: event.id,
        sceneUuid: scene.uuid,
        candidates: candidates.length,
        intersectingBehaviors,
        reactions: eventReactions,
        updates
      };
      this.#recordRecent(event, result);
      return result;
    } catch (error) {
      this.#stats.errors += 1;
      Logger.error("Environmental interaction processing failed", error);
      throw error;
    } finally {
      const elapsed = (globalThis.performance?.now?.() ?? Date.now()) - started;
      this.#stats.lastProcessingMs = elapsed;
      this.#stats.totalProcessingMs += elapsed;
      this.#stats.maxProcessingMs = Math.max(this.#stats.maxProcessingMs, elapsed);
    }
  }

  #normalizeEvent(input) {
    const type = normalizeType(input?.type);
    if (!type || !this.#capabilities.hasEventConsumers(type)) return null;
    const geometry = this.#geometry.normalize(input?.geometry, { scene: this.#sceneSync(input?.sceneUuid) });
    if (!geometry) return null;
    const explicitKey = String(input?.idempotencyKey ?? input?.id ?? "").trim();
    const id = explicitKey || `environment:${type}:${randomId()}`;
    return {
      id,
      type,
      delivery: normalizeType(input?.delivery) || "unknown",
      geometry: this.#geometry.serialize(geometry),
      sceneUuid: input?.sceneUuid ?? geometry.sceneUuid ?? globalThis.canvas?.scene?.uuid ?? null,
      source: input?.source && typeof input.source === "object" ? duplicateSafely(input.source) : null,
      metadata: input?.metadata && typeof input.metadata === "object" ? duplicateSafely(input.metadata) : null,
      emittedAt: input?.emittedAt ?? nowIso(),
      emittedByUserId: input?.emittedByUserId ?? globalThis.game?.user?.id ?? null
    };
  }

  #sceneSync(sceneUuid) {
    if (!sceneUuid) return globalThis.canvas?.scene ?? null;
    const scenes = globalThis.game?.scenes;
    return scenes?.get?.(String(sceneUuid).split(".").at(-1)) ?? [...(scenes ?? [])].find(scene => scene?.uuid === sceneUuid) ?? null;
  }

  async #resolveScene(sceneUuid) {
    const local = this.#sceneSync(sceneUuid);
    if (local) return local;
    if (sceneUuid && typeof globalThis.fromUuid === "function") {
      const resolved = await globalThis.fromUuid(sceneUuid);
      if (resolved?.documentName === "Scene") return resolved;
    }
    return globalThis.canvas?.scene ?? null;
  }

  #cleanupSeen() {
    const cutoff = Date.now() - ENVIRONMENT_DEDUPE_TTL_MS;
    for (const [key, at] of this.#seen) if (at < cutoff) this.#seen.delete(key);
    while (this.#seen.size > ENVIRONMENT_MAX_RECENT_EVENTS * 5) this.#seen.delete(this.#seen.keys().next().value);
  }

  #recordRecent(event, result) {
    this.#recent.push({
      id: event.id,
      type: event.type,
      delivery: event.delivery,
      sceneUuid: event.sceneUuid,
      source: event.source,
      result: { candidates: result.candidates, intersectingBehaviors: result.intersectingBehaviors, reactions: result.reactions, updates: result.updates.length },
      processedAt: nowIso()
    });
    if (this.#recent.length > ENVIRONMENT_MAX_RECENT_EVENTS) this.#recent.splice(0, this.#recent.length - ENVIRONMENT_MAX_RECENT_EVENTS);
  }
}
