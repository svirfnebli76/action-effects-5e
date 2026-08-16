import { SME_MODIFIER_MODES, SME_PHASES } from "../core/constants.js";

const VALID_PHASES = new Set(Object.values(SME_PHASES));
const VALID_MODES = new Set(Object.values(SME_MODIFIER_MODES));

function normalizePhases(value) {
  const phases = Array.isArray(value) ? value : [value];
  const normalized = [...new Set(phases.filter(Boolean).map(String))];
  if (!normalized.length) throw new TypeError("Spell modifier handler requires at least one phase.");
  for (const phase of normalized) {
    if (!VALID_PHASES.has(phase)) throw new Error(`Unknown SME phase '${phase}'.`);
  }
  return Object.freeze(normalized);
}

function normalizeMode(value) {
  const mode = value ?? SME_MODIFIER_MODES.OPTIONAL;
  if (!VALID_MODES.has(mode)) throw new Error(`Unknown spell modifier mode '${mode}'.`);
  return mode;
}

/** Programmatic handler registry for all SME modifier implementations. */
export class SpellModifierRegistry {
  #handlers = new Map();

  register(id, config = {}) {
    if (typeof id !== "string" || !id.trim()) throw new TypeError("Spell modifier ID must be a non-empty string.");
    if (this.#handlers.has(id)) throw new Error(`Spell modifier '${id}' is already registered.`);
    if (typeof config.apply !== "function") throw new TypeError(`Spell modifier '${id}' requires an apply() function.`);

    const handler = Object.freeze({
      id,
      label: typeof config.label === "string" && config.label.length ? config.label : id,
      phases: normalizePhases(config.phases),
      mode: normalizeMode(config.mode),
      priority: Number.isFinite(Number(config.priority)) ? Number(config.priority) : 0,
      conflictGroup: typeof config.conflictGroup === "string" && config.conflictGroup.length ? config.conflictGroup : null,
      oncePerCast: config.oncePerCast !== false,
      allowMultipleOptions: config.allowMultipleOptions === true,
      failurePolicy: config.failurePolicy === "abort" ? "abort" : "continue",
      requiresCapabilities: Object.freeze([...(config.requiresCapabilities ?? [])].filter(Boolean).map(String)),
      eligibility: typeof config.eligibility === "function" ? config.eligibility : async () => true,
      options: typeof config.options === "function" ? config.options : null,
      apply: config.apply
    });

    this.#handlers.set(id, handler);
    return () => this.unregister(id);
  }

  unregister(id) {
    return this.#handlers.delete(id);
  }

  get(id) {
    return this.#handlers.get(id) ?? null;
  }

  has(id) {
    return this.#handlers.has(id);
  }

  hasPhase(phase) {
    for (const handler of this.#handlers.values()) {
      if (handler.phases.includes(phase)) return true;
    }
    return false;
  }

  list() {
    return [...this.#handlers.values()].map(handler => ({
      id: handler.id,
      label: handler.label,
      phases: [...handler.phases],
      mode: handler.mode,
      priority: handler.priority,
      conflictGroup: handler.conflictGroup,
      oncePerCast: handler.oncePerCast,
      allowMultipleOptions: handler.allowMultipleOptions,
      failurePolicy: handler.failurePolicy,
      requiresCapabilities: [...handler.requiresCapabilities]
    }));
  }

  clear() {
    const count = this.#handlers.size;
    this.#handlers.clear();
    return count;
  }

  getStats() {
    const byPhase = {};
    for (const phase of VALID_PHASES) byPhase[phase] = 0;
    for (const handler of this.#handlers.values()) {
      for (const phase of handler.phases) byPhase[phase] = (byPhase[phase] ?? 0) + 1;
    }
    return {
      handlers: this.#handlers.size,
      byPhase,
      ids: [...this.#handlers.keys()]
    };
  }
}
