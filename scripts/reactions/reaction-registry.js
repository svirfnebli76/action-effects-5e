import { REACTION_TRIGGERS } from "../core/constants.js";

export class ReactionRegistry {
  #handlers = new Map();
  #byTrigger = new Map();

  registerHandler(id, config = {}) {
    if (typeof id !== "string" || !id.trim()) throw new TypeError("Reaction handler ID must be a non-empty string.");
    if (this.#handlers.has(id)) throw new Error(`Reaction handler '${id}' is already registered.`);
    if (typeof config.trigger !== "string" || !config.trigger.trim()) throw new TypeError(`Reaction handler '${id}' requires a trigger.`);
    const supportedTriggers = new Set(Object.values(REACTION_TRIGGERS));
    if (!supportedTriggers.has(config.trigger)) {
      throw new Error(`Reaction handler '${id}' requested unsupported trigger '${config.trigger}'. v0.3.28 supports: ${[...supportedTriggers].join(", ")}.`);
    }
    if (config.eligibility !== undefined && typeof config.eligibility !== "function") {
      throw new TypeError(`Reaction handler '${id}' eligibility must be a function when provided.`);
    }
    if (typeof config.resolve !== "function") throw new TypeError(`Reaction handler '${id}' requires a resolve function.`);

    const normalized = Object.freeze({
      id,
      trigger: config.trigger,
      label: config.label ?? id,
      eligibility: config.eligibility ?? (() => true),
      resolve: config.resolve,
      revalidate: config.revalidate ?? config.eligibility ?? (() => true)
    });
    this.#handlers.set(id, normalized);
    let ids = this.#byTrigger.get(normalized.trigger);
    if (!ids) {
      ids = new Set();
      this.#byTrigger.set(normalized.trigger, ids);
    }
    ids.add(id);
    return () => this.unregisterHandler(id);
  }

  unregisterHandler(id) {
    const handler = this.#handlers.get(id);
    if (!handler) return false;
    this.#handlers.delete(id);
    const ids = this.#byTrigger.get(handler.trigger);
    ids?.delete(id);
    if (ids && !ids.size) this.#byTrigger.delete(handler.trigger);
    return true;
  }

  get(id) {
    return this.#handlers.get(id) ?? null;
  }

  getForTrigger(trigger) {
    return [...(this.#byTrigger.get(trigger) ?? [])]
      .map(id => this.#handlers.get(id))
      .filter(Boolean);
  }

  hasTrigger(trigger) {
    return Boolean(this.#byTrigger.get(trigger)?.size);
  }

  getStats() {
    return {
      handlers: this.#handlers.size,
      triggers: Object.fromEntries([...this.#byTrigger].map(([trigger, ids]) => [trigger, ids.size]))
    };
  }
}
