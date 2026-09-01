import { duplicateSafely } from "../core/utils.js";

function normalizeId(value, label) {
  const id = String(value ?? "").trim().toLowerCase();
  if (!id) throw new TypeError(`${label} must be a non-empty string.`);
  return id;
}

/**
 * Runtime registry for environmental material/reaction profiles.
 *
 * Profiles are deliberately independent of Foundry RegionBehavior classes so
 * spell/material-specific rules can be added later without changing the core
 * environmental dispatcher.
 */
export class EnvironmentProfileRegistry {
  #profiles = new Map();
  #stats = { registrations: 0, unregistrations: 0 };

  register(capabilityId, profileId, config = {}) {
    const capability = normalizeId(capabilityId, "Environmental capability ID");
    const profile = normalizeId(profileId, "Environmental profile ID");
    const key = `${capability}:${profile}`;
    if (this.#profiles.has(key)) throw new Error(`Environmental profile '${key}' is already registered.`);
    if (typeof config.react !== "function") throw new TypeError(`Environmental profile '${key}' requires a react() function.`);

    const entry = Object.freeze({
      capabilityId: capability,
      profileId: profile,
      label: String(config.label ?? profileId),
      react: config.react,
      metadata: config.metadata && typeof config.metadata === "object" ? duplicateSafely(config.metadata) : null
    });
    this.#profiles.set(key, entry);
    this.#stats.registrations += 1;
    return () => this.unregister(capability, profile);
  }

  unregister(capabilityId, profileId) {
    const key = `${normalizeId(capabilityId, "Environmental capability ID")}:${normalizeId(profileId, "Environmental profile ID")}`;
    const removed = this.#profiles.delete(key);
    if (removed) this.#stats.unregistrations += 1;
    return removed;
  }

  get(capabilityId, profileId) {
    const capability = normalizeId(capabilityId, "Environmental capability ID");
    const profile = normalizeId(profileId, "Environmental profile ID");
    return this.#profiles.get(`${capability}:${profile}`) ?? null;
  }

  list(capabilityId = null) {
    const normalized = capabilityId === null ? null : normalizeId(capabilityId, "Environmental capability ID");
    return [...this.#profiles.values()].filter(entry => !normalized || entry.capabilityId === normalized);
  }

  getStats() {
    return Object.freeze({
      ...this.#stats,
      profiles: this.#profiles.size,
      byCapability: Object.freeze(this.list().reduce((summary, entry) => {
        summary[entry.capabilityId] = (summary[entry.capabilityId] ?? 0) + 1;
        return summary;
      }, {}))
    });
  }
}
