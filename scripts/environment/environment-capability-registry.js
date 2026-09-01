function normalizeId(value, label) {
  const id = String(value ?? "").trim().toLowerCase();
  if (!id) throw new TypeError(`${label} must be a non-empty string.`);
  return id;
}

/**
 * Maps RegionBehavior subtypes to environmental capabilities and event types.
 * This is the extension seam for future capabilities such as Meltable,
 * Freezable, Dispersible, or Corrodible.
 */
export class EnvironmentCapabilityRegistry {
  #capabilities = new Map();
  #byBehaviorType = new Map();
  #byEventType = new Map();
  #stats = { registrations: 0, unregistrations: 0 };

  register({ id, behaviorType, eventTypes, handler }) {
    const capabilityId = normalizeId(id, "Environmental capability ID");
    const normalizedBehaviorType = String(behaviorType ?? "").trim();
    if (!normalizedBehaviorType) throw new TypeError(`Environmental capability '${capabilityId}' requires a RegionBehavior type.`);
    if (typeof handler !== "function") throw new TypeError(`Environmental capability '${capabilityId}' requires a handler.`);
    const events = [...new Set((eventTypes ?? []).map(value => normalizeId(value, "Environmental event type")))];
    if (!events.length) throw new TypeError(`Environmental capability '${capabilityId}' requires at least one event type.`);
    if (this.#capabilities.has(capabilityId)) throw new Error(`Environmental capability '${capabilityId}' is already registered.`);
    if (this.#byBehaviorType.has(normalizedBehaviorType)) throw new Error(`RegionBehavior type '${normalizedBehaviorType}' already belongs to an environmental capability.`);

    const entry = Object.freeze({
      id: capabilityId,
      behaviorType: normalizedBehaviorType,
      eventTypes: Object.freeze(events),
      handler
    });
    this.#capabilities.set(capabilityId, entry);
    this.#byBehaviorType.set(normalizedBehaviorType, entry);
    for (const eventType of events) {
      const set = this.#byEventType.get(eventType) ?? new Set();
      set.add(entry);
      this.#byEventType.set(eventType, set);
    }
    this.#stats.registrations += 1;
    return () => this.unregister(capabilityId);
  }

  unregister(id) {
    const capabilityId = normalizeId(id, "Environmental capability ID");
    const entry = this.#capabilities.get(capabilityId);
    if (!entry) return false;
    this.#capabilities.delete(capabilityId);
    this.#byBehaviorType.delete(entry.behaviorType);
    for (const eventType of entry.eventTypes) {
      const set = this.#byEventType.get(eventType);
      set?.delete(entry);
      if (!set?.size) this.#byEventType.delete(eventType);
    }
    this.#stats.unregistrations += 1;
    return true;
  }

  get(id) {
    return this.#capabilities.get(normalizeId(id, "Environmental capability ID")) ?? null;
  }

  getForBehaviorType(behaviorType) {
    return this.#byBehaviorType.get(String(behaviorType ?? "").trim()) ?? null;
  }

  getForEvent(eventType) {
    return [...(this.#byEventType.get(normalizeId(eventType, "Environmental event type")) ?? [])];
  }

  hasEventConsumers(eventType) {
    return this.getForEvent(eventType).length > 0;
  }

  list() {
    return [...this.#capabilities.values()];
  }

  getStats() {
    return Object.freeze({
      ...this.#stats,
      capabilities: this.#capabilities.size,
      eventTypes: this.#byEventType.size,
      behaviorTypes: this.#byBehaviorType.size
    });
  }
}
