import { ENVIRONMENT_FLAG_KEY, MODULE_ID } from "../core/constants.js";
import { Logger } from "../core/logger.js";
import { nowIso } from "../core/utils.js";

function timerMap(region) {
  return region?.flags?.[MODULE_ID]?.[ENVIRONMENT_FLAG_KEY]?.timers ?? {};
}

function dueCombatPosition(timer, combat) {
  const due = timer?.due?.combat;
  if (!due || !combat || combat.uuid !== due.combatUuid) return false;
  const round = Number(combat.round ?? 0);
  const turn = Number(combat.turn ?? -1);
  const dueRound = Number(due.round ?? 0);
  const dueTurn = Number(due.turn ?? -1);
  return round > dueRound || (round === dueRound && turn >= dueTurn);
}

/**
 * Persistent, event-driven timers for environmental Region state.
 *
 * No polling loop is used. Real-time deadlines use one-shot timers, while
 * world-time and combat-position deadlines are checked only when Foundry emits
 * the corresponding update hook. Timer records live on the Region so a new
 * primary GM or a browser reload can rehydrate them.
 */
export class EnvironmentTimingService {
  #authority;
  #mutations;
  #handlers = new Map();
  #initialized = false;
  #hooks = [];
  #authorityUnsubscribe = null;
  #trackedRegions = new Set();
  #timeouts = new Map();
  #firing = new Set();
  #blocked = new Set();
  #stats = {
    scans: 0,
    regionSyncs: 0,
    armedRealTimeTimers: 0,
    dueChecks: 0,
    fired: 0,
    handlerErrors: 0,
    missingHandlers: 0,
    cancelledArms: 0,
    authorityResyncs: 0
  };

  constructor({ authority, mutations }) {
    this.#authority = authority;
    this.#mutations = mutations;
  }

  initialize() {
    if (this.#initialized) return;
    this.#initialized = true;
    const hook = (name, fn) => {
      const id = globalThis.Hooks?.on?.(name, fn);
      if (id !== undefined && id !== null) this.#hooks.push([name, id]);
    };
    hook("createRegion", region => this.syncRegion(region));
    hook("updateRegion", region => this.syncRegion(region));
    hook("deleteRegion", region => this.#forgetRegion(region?.uuid));
    hook("updateCombat", combat => this.processDue({ combat }));
    hook("deleteCombat", () => this.processDue({ combat: null }));
    hook("updateWorldTime", () => this.processDue());
    this.#authorityUnsubscribe = this.#authority?.onChange?.(() => {
      this.#stats.authorityResyncs += 1;
      this.#clearArmedTimeouts();
      if (this.#isPrimary()) void this.syncAll();
    }) ?? null;
    if (this.#isPrimary()) void this.syncAll();
  }

  registerHandler(id, handler) {
    const key = String(id ?? "").trim();
    if (!key) throw new TypeError("Environmental timer handler ID must be a non-empty string.");
    if (typeof handler !== "function") throw new TypeError(`Environmental timer handler '${key}' must be a function.`);
    if (this.#handlers.has(key)) throw new Error(`Environmental timer handler '${key}' is already registered.`);
    this.#handlers.set(key, handler);
    for (const blockedKey of [...this.#blocked]) {
      if (blockedKey.endsWith(`|${key}`)) this.#blocked.delete(blockedKey);
    }
    if (this.#isPrimary()) void this.processDue();
    return () => this.#handlers.delete(key);
  }

  async syncAll() {
    if (!this.#isPrimary()) return { synced: 0, reason: "not-primary" };
    this.#stats.scans += 1;
    let synced = 0;
    for (const scene of [...(globalThis.game?.scenes ?? [])]) {
      for (const region of [...(scene?.regions ?? [])]) {
        if (!Object.keys(timerMap(region)).length) continue;
        this.syncRegion(region);
        synced += 1;
      }
    }
    await this.processDue();
    return { synced };
  }

  syncRegion(region) {
    if (!region?.uuid) return;
    this.#stats.regionSyncs += 1;
    if (!this.#isPrimary()) {
      this.#forgetRegion(region.uuid);
      return;
    }
    const timers = timerMap(region);
    const ids = new Set(Object.keys(timers));
    if (ids.size) this.#trackedRegions.add(region.uuid);
    else this.#trackedRegions.delete(region.uuid);

    for (const key of [...this.#timeouts.keys()]) {
      if (!key.startsWith(`${region.uuid}|`)) continue;
      const timerId = key.slice(region.uuid.length + 1);
      if (!ids.has(timerId)) this.#clearArm(key);
    }
    for (const key of [...this.#blocked]) {
      if (!key.startsWith(`${region.uuid}|`)) continue;
      const timerId = key.slice(region.uuid.length + 1).split("|")[0];
      if (!ids.has(timerId)) this.#blocked.delete(key);
    }
    for (const [timerId, timer] of Object.entries(timers)) {
      const key = `${region.uuid}|${timerId}`;
      if (this.#firing.has(key)) {
        this.#clearArm(key);
        continue;
      }
      this.#armRealTime(region.uuid, timerId, timer);
    }
    void this.processDue({ regionUuids: [region.uuid] });
  }

  async processDue({ combat = globalThis.game?.combat ?? null, regionUuids = null } = {}) {
    if (!this.#isPrimary()) return { fired: 0, reason: "not-primary" };
    const uuids = regionUuids ? [...new Set(regionUuids.filter(Boolean))] : [...this.#trackedRegions];
    let fired = 0;
    for (const regionUuid of uuids) {
      let region = null;
      try { region = await globalThis.fromUuid?.(regionUuid); } catch { region = null; }
      if (!region) {
        this.#forgetRegion(regionUuid);
        continue;
      }
      for (const [timerId, timer] of Object.entries(timerMap(region))) {
        this.#stats.dueChecks += 1;
        const blockedKey = `${region.uuid}|${timerId}|${String(timer?.handlerId ?? "").trim()}`;
        if (this.#blocked.has(blockedKey)) continue;
        if (!this.#isDue(timer, combat)) continue;
        const result = await this.#fire(region, timerId, timer);
        if (result?.fired) fired += 1;
      }
    }
    return { fired };
  }

  isDue(timer, { combat = globalThis.game?.combat ?? null, nowMs = Date.now(), worldTime = globalThis.game?.time?.worldTime } = {}) {
    return this.#isDue(timer, combat, nowMs, worldTime);
  }

  getStats() {
    return Object.freeze({
      ...this.#stats,
      initialized: this.#initialized,
      handlers: this.#handlers.size,
      trackedRegions: this.#trackedRegions.size,
      armedTimeouts: this.#timeouts.size,
      blockedTimers: this.#blocked.size,
      primary: this.#isPrimary()
    });
  }

  #isDue(timer, combat, nowMs = Date.now(), worldTime = globalThis.game?.time?.worldTime) {
    const due = timer?.due ?? {};
    const realTimeMs = Number(due.realTimeMs);
    if (Number.isFinite(realTimeMs) && nowMs >= realTimeMs) return true;
    const dueWorldTime = Number(due.worldTime);
    if (Number.isFinite(dueWorldTime) && Number.isFinite(Number(worldTime)) && Number(worldTime) >= dueWorldTime) return true;
    if (dueCombatPosition(timer, combat)) return true;
    return false;
  }

  async #fire(region, timerId, timer) {
    const key = `${region.uuid}|${timerId}`;
    if (this.#firing.has(key)) return { fired: false, reason: "already-firing" };
    const handlerId = String(timer?.handlerId ?? "").trim();
    const handler = this.#handlers.get(handlerId);
    if (!handler) {
      this.#stats.missingHandlers += 1;
      this.#clearArm(key);
      this.#blocked.add(`${region.uuid}|${timerId}|${handlerId}`);
      return { fired: false, reason: "missing-handler", handlerId };
    }
    this.#firing.add(key);
    this.#clearArm(key);
    try {
      const behaviorId = timer?.behaviorId ?? null;
      const behavior = [...(region.behaviors ?? [])].find(entry => (entry.id ?? entry._id) === behaviorId) ?? null;
      const outcome = await handler(Object.freeze({ region, behavior, timerId, timer, firedAt: nowIso() }));
      const reaction = outcome?.reaction ?? outcome ?? {};
      const event = {
        id: `environment-timer:${region.uuid}:${timerId}`,
        type: "timer",
        delivery: "timer",
        source: { timerId, handlerId },
        emittedAt: nowIso()
      };
      const entry = {
        behavior: behavior ?? { id: behaviorId },
        capability: { id: timer?.capabilityId ?? null },
        profile: { profileId: timer?.profileId ?? null },
        reaction: {
          ...reaction,
          handled: true,
          cancelTimers: [...new Set([...(reaction?.cancelTimers ?? []), timerId])]
        }
      };
      await this.#mutations.apply(region, [entry], event);
      this.#stats.fired += 1;
      return { fired: true, timerId, handlerId };
    } catch (error) {
      this.#stats.handlerErrors += 1;
      Logger.error(`Environmental timer '${timerId}' handler '${handlerId}' failed`, error);
      throw error;
    } finally {
      this.#firing.delete(key);
    }
  }

  #armRealTime(regionUuid, timerId, timer) {
    const key = `${regionUuid}|${timerId}`;
    this.#clearArm(key);
    const dueMs = Number(timer?.due?.realTimeMs);
    if (!Number.isFinite(dueMs)) return;
    const delay = Math.max(0, dueMs - Date.now());
    const safeDelay = Math.min(delay, 2_147_000_000);
    const handle = globalThis.setTimeout?.(() => {
      this.#timeouts.delete(key);
      void this.processDue({ regionUuids: [regionUuid] }).catch(error => Logger.error("Environmental real-time timer processing failed", error));
    }, safeDelay);
    if (handle !== undefined) {
      this.#timeouts.set(key, handle);
      this.#stats.armedRealTimeTimers += 1;
    }
  }

  #forgetRegion(regionUuid) {
    if (!regionUuid) return;
    this.#trackedRegions.delete(regionUuid);
    for (const key of [...this.#timeouts.keys()]) if (key.startsWith(`${regionUuid}|`)) this.#clearArm(key);
    for (const key of [...this.#blocked]) if (key.startsWith(`${regionUuid}|`)) this.#blocked.delete(key);
  }

  #clearArm(key) {
    const handle = this.#timeouts.get(key);
    if (handle === undefined) return;
    globalThis.clearTimeout?.(handle);
    this.#timeouts.delete(key);
    this.#stats.cancelledArms += 1;
  }

  #clearArmedTimeouts() {
    for (const key of [...this.#timeouts.keys()]) this.#clearArm(key);
    this.#trackedRegions.clear();
    this.#blocked.clear();
  }

  #isPrimary() {
    const primary = this.#authority?.getPrimaryGm?.() ?? null;
    if (primary) return globalThis.game?.user?.id === primary.id;
    return Boolean(globalThis.game?.user?.isGM);
  }
}
