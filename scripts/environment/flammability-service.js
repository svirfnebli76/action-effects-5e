import { ENVIRONMENT_CAPABILITIES, ENVIRONMENT_EVENT_TYPES } from "../core/constants.js";
import { duplicateSafely, nowIso } from "../core/utils.js";

/** Built-in implementation for the Flammable environmental capability. */
export class FlammabilityService {
  #profiles;
  #mutations;
  #stats = { exposures: 0, handled: 0, unknownProfiles: 0, errors: 0 };

  constructor({ profiles, mutations }) {
    this.#profiles = profiles;
    this.#mutations = mutations;
    profiles.register(ENVIRONMENT_CAPABILITIES.FLAMMABLE, "generic", {
      label: "Generic Flammable",
      metadata: { builtin: true },
      react: (context) => this.#genericReaction(context)
    });
  }

  async handle(context) {
    this.#stats.exposures += 1;
    const profileId = String(context.behavior?.system?.profileId ?? "generic").trim().toLowerCase() || "generic";
    const profile = this.#profiles.get(ENVIRONMENT_CAPABILITIES.FLAMMABLE, profileId);
    if (!profile) {
      this.#stats.unknownProfiles += 1;
      return { handled: false, reason: "unknown-profile", profileId };
    }
    try {
      const currentState = this.#mutations.getState(context.region, context.behavior) ?? {};
      const reaction = await profile.react(Object.freeze({
        ...context,
        profile,
        currentState: duplicateSafely(currentState)
      }));
      if (reaction?.handled !== false) this.#stats.handled += 1;
      return { profile, reaction: reaction ?? { handled: false, reason: "empty-reaction" } };
    } catch (error) {
      this.#stats.errors += 1;
      throw error;
    }
  }

  #genericReaction({ event, currentState }) {
    if (event.type !== ENVIRONMENT_EVENT_TYPES.FIRE) return { handled: false, reason: "unsupported-event" };
    return {
      handled: true,
      state: {
        status: "ignited",
        ignitions: Number(currentState?.ignitions ?? 0) + 1,
        ignitedAt: nowIso(),
        lastDelivery: event.delivery ?? null,
        source: duplicateSafely(event.source ?? null)
      }
    };
  }

  getStats() {
    return Object.freeze({ ...this.#stats });
  }
}
