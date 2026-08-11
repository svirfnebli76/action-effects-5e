import {
  MODULE_ID,
  SELECTION_INDICATOR_ROLES
} from "../core/constants.js";
import { Logger } from "../core/logger.js";

/**
 * Conservative bridge between foreign Foundry ApplicationV2 prompts and the
 * AE5E selection indicator service.
 *
 * The global render hook only observes applications. It never guesses a token.
 * A registered adapter must positively identify an actionable prompt and return
 * the token/tokenUuid which owns that wait. This keeps false blue indicators
 * off actor sheets, settings windows, file pickers, and unknown module UI.
 */
export class ExternalPromptBridgeService {
  #selectionIndicator;
  #initialized = false;
  #hookId = null;
  #adapters = new Map();
  #tracked = new Map();
  #pendingApplications = new WeakSet();
  #stats = {
    rendersObserved: 0,
    ae5eOwnedIgnored: 0,
    adapterMatches: 0,
    applicationsTracked: 0,
    applicationsReleased: 0,
    adapterFailures: 0,
    trackFailures: 0,
    lastEvent: null
  };

  constructor({ selectionIndicator }) {
    this.#selectionIndicator = selectionIndicator;
  }

  initialize() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#hookId = Hooks.on("renderApplicationV2", (application, element, context, options) => {
      void this.#handleRender(application, element, context, options);
    });
  }

  /**
   * Register a conservative recognizer for one external prompt family.
   *
   * match({ application, element, context, options }) returns either null/false
   * or { token, tokenUuid, reason?, playSound?, notifyUserId? }.
   */
  registerAdapter({ id, priority = 0, match } = {}) {
    if (!id || typeof id !== "string") throw new TypeError("External prompt adapter requires a string id.");
    if (typeof match !== "function") throw new TypeError(`External prompt adapter '${id}' requires a match() function.`);
    if (this.#adapters.has(id)) throw new Error(`External prompt adapter '${id}' is already registered.`);

    this.#adapters.set(id, {
      id,
      priority: Number(priority) || 0,
      match
    });
    this.#record("adapter-register", { id, priority: Number(priority) || 0 });
    return () => this.unregisterAdapter(id);
  }

  unregisterAdapter(id) {
    const removed = this.#adapters.delete(id);
    if (removed) this.#record("adapter-unregister", { id });
    return removed;
  }

  /**
   * Explicitly associate a foreign ApplicationV2 with a token. This is the
   * integration boundary adapters ultimately use and is also public for future
   * module-specific integrations which already know the application instance.
   */
  async trackApplication({
    application,
    token = null,
    tokenUuid = null,
    reason = "external-prompt",
    playSound = true,
    notifyUserId = game?.user?.id ?? null,
    adapterId = "manual"
  } = {}) {
    if (!application || typeof application.addEventListener !== "function") {
      throw new TypeError("External prompt tracking requires a Foundry ApplicationV2 instance.");
    }

    const key = this.#applicationKey(application);
    const existing = this.#tracked.get(key);
    if (existing) return existing.facade;

    const lease = await this.#selectionIndicator.acquire({
      token,
      tokenUuid,
      reason,
      role: SELECTION_INDICATOR_ROLES.EXTERNAL,
      playSound,
      notifyUserId
    });

    let released = false;
    const release = async () => {
      if (released) return false;
      released = true;
      this.#tracked.delete(key);
      const result = await lease.release();
      this.#stats.applicationsReleased += 1;
      this.#record("application-release", {
        key,
        adapterId,
        tokenUuid: lease.tokenUuid,
        leaseId: lease.id
      });
      return result;
    };

    application.addEventListener("close", () => { void release(); }, { once: true });

    const facade = Object.freeze({
      key,
      application,
      adapterId,
      lease,
      release
    });
    this.#tracked.set(key, { application, adapterId, lease, release, facade });
    this.#stats.applicationsTracked += 1;
    this.#record("application-track", {
      key,
      adapterId,
      tokenUuid: lease.tokenUuid,
      leaseId: lease.id,
      reason
    });
    return facade;
  }

  async clearAll() {
    const tracked = [...this.#tracked.values()];
    for (const entry of tracked) {
      try {
        await entry.release();
      } catch (error) {
        Logger.warn("External prompt bridge could not release a tracked application.", error);
      }
    }
    return tracked.length;
  }

  getStats() {
    return {
      initialized: this.#initialized,
      hookRegistered: this.#hookId !== null,
      adapters: [...this.#adapters.values()]
        .sort((a, b) => b.priority - a.priority)
        .map(({ id, priority }) => ({ id, priority })),
      adapterCount: this.#adapters.size,
      trackedApplications: this.#tracked.size,
      ...this.#stats
    };
  }

  async #handleRender(application, element, context, options) {
    this.#stats.rendersObserved += 1;
    if (!application || this.#tracked.has(this.#applicationKey(application)) || this.#pendingApplications.has(application)) return;

    if (this.#isAe5eOwned(application, element)) {
      this.#stats.ae5eOwnedIgnored += 1;
      return;
    }

    if (this.#adapters.size === 0) return;
    this.#pendingApplications.add(application);
    try {
      const adapters = [...this.#adapters.values()].sort((a, b) => b.priority - a.priority);
      for (const adapter of adapters) {
        let match = null;
        try {
          match = await adapter.match({ application, element, context, options });
        } catch (error) {
          this.#stats.adapterFailures += 1;
          Logger.warn(`External prompt adapter '${adapter.id}' failed while examining an ApplicationV2.`, error);
          continue;
        }
        if (!match) continue;

        // A match is only actionable when the adapter identified a token.
        if (!match.token && !match.tokenUuid) continue;
        this.#stats.adapterMatches += 1;
        try {
          await this.trackApplication({
            application,
            token: match.token ?? null,
            tokenUuid: match.tokenUuid ?? null,
            reason: match.reason ?? `external:${adapter.id}`,
            playSound: match.playSound ?? true,
            notifyUserId: match.notifyUserId ?? (game?.user?.id ?? null),
            adapterId: adapter.id
          });
        } catch (error) {
          this.#stats.trackFailures += 1;
          Logger.warn(`External prompt adapter '${adapter.id}' matched but AE5E could not track the application.`, error);
        }
        return;
      }
    } finally {
      this.#pendingApplications.delete(application);
    }
  }

  #isAe5eOwned(application, element) {
    const marker = `${MODULE_ID}-owned-dialog`;
    const rawClasses = application?.options?.classes;
    const classes = rawClasses instanceof Set
      ? [...rawClasses]
      : Array.isArray(rawClasses)
        ? rawClasses
        : typeof rawClasses === "string"
          ? rawClasses.split(/\s+/)
          : [];
    if (classes.includes(marker)) return true;
    if (element?.classList?.contains?.(marker)) return true;
    if (element?.closest?.(`.${marker}`)) return true;
    return false;
  }

  #applicationKey(application) {
    return String(application?.id ?? application?._appId ?? application?.constructor?.name ?? "unknown");
  }

  #record(type, details) {
    this.#stats.lastEvent = {
      type,
      at: Date.now(),
      ...details
    };
  }
}
