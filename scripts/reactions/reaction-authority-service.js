import {
  HOOKS,
  MODULE_ID,
  REACTION_AUTHORITY_POLL_MS,
  SETTINGS
} from "../core/constants.js";
import { Logger } from "../core/logger.js";
import { duplicateSafely, nowIso, randomId } from "../core/utils.js";

/**
 * Elects the longest-continuously-connected GM as Reaction Broker arbiter.
 *
 * Foundry's built-in activeGM is used only as a single writer for the session
 * ledger. Reaction authority itself is chosen by continuous browser-session age.
 */
export class ReactionAuthorityService {
  #socket;
  #sessionId = randomId();
  #sessionStartedAt = Date.now();
  #initialized = false;
  #userConnectedHook = null;
  #listeners = new Set();
  #pendingReconnects = new Map();
  #validator = null;
  #lastPrimaryId = null;
  #syncPromise = null;
  #stats = {
    ledgerSyncs: 0,
    authorityChanges: 0,
    authorizations: 0,
    authorizationRejects: 0,
    tiebreakRolls: 0,
    lastAuthorityChange: null
  };

  constructor({ socket }) {
    this.#socket = socket;
    socket.register("reactions.authority.getSessionInfo", this.#getSessionInfo.bind(this));
    socket.register("reactions.authority.syncLedger", this.#syncLedgerSocket.bind(this));
    socket.register("reactions.authority.authorizeDecision", this.#authorizeDecisionSocket.bind(this));
    socket.register("reactions.authority.rollTiebreak", this.#rollTiebreakSocket.bind(this));
  }

  async initialize() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#userConnectedHook = Hooks.on("userConnected", (user, connected) => {
      this.#handleUserConnection(user, connected).catch(error => Logger.warn("Reaction authority connection update failed.", error));
    });
    await this.refreshLedger();
    this.#emitIfChanged();
  }

  setDecisionValidator(validator) {
    if (validator !== null && typeof validator !== "function") throw new TypeError("Reaction authority validator must be a function or null.");
    this.#validator = validator;
  }

  onChange(listener) {
    if (typeof listener !== "function") throw new TypeError("Reaction authority listener must be a function.");
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  getPrimaryGm() {
    const activeGms = [...(game?.users ?? [])].filter(user => user?.active && user?.isGM && !this.#pendingReconnects.has(user.id));
    if (!activeGms.length) return null;
    const ledger = this.#readLedger();
    const candidates = activeGms.map(user => ({
      user,
      sessionStartedAt: Number(ledger.sessions?.[user.id]?.sessionStartedAt),
      sequence: Number(ledger.sessions?.[user.id]?.sequence)
    }));
    const known = candidates.filter(entry => Number.isFinite(entry.sessionStartedAt) && entry.sessionStartedAt > 0);
    if (!known.length) return null;
    // Continuous browser-session age is the authoritative ordering key. The
    // ledger sequence is only a deterministic fallback/tiebreak. This also
    // lets a longer-lived GM session discovered slightly later beat a newer
    // GM which happened to be written into the ledger first.
    known.sort((a, b) => a.sessionStartedAt - b.sessionStartedAt
      || a.sequence - b.sequence
      || String(a.user.id).localeCompare(String(b.user.id)));
    return known[0].user;
  }

  hasActiveGm() {
    return [...(game?.users ?? [])].some(user => user?.active && user?.isGM);
  }

  isPrimary(userId = game?.user?.id) {
    return Boolean(userId && this.getPrimaryGm()?.id === userId);
  }

  async refreshLedger() {
    if (!this.#initialized && !game?.users) return this.#readLedger();
    if (this.#syncPromise) return this.#syncPromise;
    this.#syncPromise = this.#refreshLedgerInternal();
    try {
      return await this.#syncPromise;
    } finally {
      this.#syncPromise = null;
    }
  }

  async authorizeDecision(payload) {
    const primary = this.getPrimaryGm();
    if (!primary) return { authorized: false, reason: "no-gm", primaryGmId: null };
    try {
      const result = await this.#socket.executeAsUser("reactions.authority.authorizeDecision", primary.id, payload);
      if (result?.redirectPrimaryGmId && result.redirectPrimaryGmId !== primary.id) {
        await this.refreshLedger();
      }
      return result;
    } catch (error) {
      Logger.debug("Reaction authority authorization target became unavailable.", error);
      await this.refreshLedger().catch(() => null);
      return { authorized: false, reason: "authority-unavailable", primaryGmId: this.getPrimaryGm()?.id ?? null };
    }
  }

  async rollTiebreak(reactorTokenUuids, transactionId = null) {
    const primary = this.getPrimaryGm();
    if (!primary) throw new Error("Reaction Broker cannot roll a tiebreak without an active GM authority.");
    return this.#socket.executeAsUser("reactions.authority.rollTiebreak", primary.id, {
      transactionId,
      reactorTokenUuids
    });
  }

  async waitForAuthority({ signal = null, onWaiting = null } = {}) {
    while (true) {
      if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      const primary = this.getPrimaryGm();
      if (primary) return primary;
      if (typeof onWaiting === "function") await onWaiting();
      await new Promise(resolve => setTimeout(resolve, REACTION_AUTHORITY_POLL_MS));
      await this.refreshLedger().catch(() => null);
    }
  }

  getStatus() {
    const ledger = this.#readLedger();
    const activeGms = [...(game?.users ?? [])]
      .filter(user => user?.active && user?.isGM)
      .map(user => ({
        id: user.id,
        name: user.name,
        sequence: ledger.sessions?.[user.id]?.sequence ?? null,
        sessionStartedAt: ledger.sessions?.[user.id]?.sessionStartedAt ?? null,
        sessionId: ledger.sessions?.[user.id]?.sessionId ?? null,
        reconnectPending: this.#pendingReconnects.has(user.id)
      }))
      .sort((a, b) => (Number(a.sessionStartedAt) || Infinity) - (Number(b.sessionStartedAt) || Infinity)
        || (Number(a.sequence) || Infinity) - (Number(b.sequence) || Infinity));
    return {
      initialized: this.#initialized,
      localSessionId: this.#sessionId,
      primaryGmId: this.getPrimaryGm()?.id ?? null,
      activeGms,
      ledger: duplicateSafely(ledger),
      ...this.#stats
    };
  }

  async #refreshLedgerInternal() {
    const foundryActiveGm = game?.users?.activeGM ?? [...(game?.users ?? [])].find(user => user?.isActiveGM) ?? null;
    if (!foundryActiveGm) {
      this.#clearSettledReconnects();
      this.#emitIfChanged();
      return this.#readLedger();
    }

    if (foundryActiveGm.id === game?.user?.id) {
      const result = await this.#synchronizeLedgerAsWriter();
      this.#clearSettledReconnects();
      this.#emitIfChanged();
      return result;
    }

    try {
      await this.#socket.executeAsUser("reactions.authority.syncLedger", foundryActiveGm.id);
    } catch (error) {
      Logger.debug("Could not request Reaction authority ledger synchronization.", error);
    }
    this.#clearSettledReconnects();
    this.#emitIfChanged();
    return this.#readLedger();
  }

  async #handleUserConnection(user, connected) {
    if (user?.isGM) {
      if (connected) {
        const previousSessionId = this.#readLedger().sessions?.[user.id]?.sessionId ?? null;
        this.#pendingReconnects.set(user.id, previousSessionId);
      } else {
        this.#pendingReconnects.delete(user.id);
      }
    }
    // Give Foundry a short turn to update game.users.activeGM/active flags.
    await new Promise(resolve => setTimeout(resolve, 50));
    await this.refreshLedger();
    this.#clearSettledReconnects();
    this.#emitIfChanged();
  }

  #getSessionInfo() {
    return {
      userId: game?.user?.id ?? null,
      isGM: Boolean(game?.user?.isGM),
      sessionId: this.#sessionId,
      sessionStartedAt: this.#sessionStartedAt
    };
  }

  async #syncLedgerSocket() {
    const foundryActiveGm = game?.users?.activeGM ?? null;
    if (!game?.user?.isGM || (foundryActiveGm && foundryActiveGm.id !== game.user.id)) {
      return { updated: false, reason: "not-ledger-writer" };
    }
    const ledger = await this.#synchronizeLedgerAsWriter();
    this.#clearSettledReconnects();
    this.#emitIfChanged();
    return { updated: true, ledger };
  }

  async #synchronizeLedgerAsWriter() {
    if (!game?.user?.isGM) return this.#readLedger();
    const ledger = duplicateSafely(this.#readLedger());
    ledger.sequence = Number(ledger.sequence) || 0;
    ledger.sessions ??= {};
    const activeGms = [...(game?.users ?? [])].filter(user => user?.active && user?.isGM);
    const activeIds = new Set(activeGms.map(user => user.id));
    let changed = false;

    for (const [userId, entry] of Object.entries(ledger.sessions)) {
      if (entry?.active && !activeIds.has(userId)) {
        entry.active = false;
        entry.disconnectedAt = nowIso();
        changed = true;
      }
    }

    // Gather all active GM browser-session identities first. When the ledger is
    // first established with multiple already-connected GMs, sorting new
    // sessions by their browser session start gives the best available
    // continuous-login ordering instead of depending on game.users iteration.
    const sessionInfos = [];
    for (const gm of activeGms) {
      let info;
      try {
        info = gm.id === game.user.id
          ? this.#getSessionInfo()
          : await this.#socket.executeAsUser("reactions.authority.getSessionInfo", gm.id);
      } catch {
        continue;
      }
      if (info?.sessionId) sessionInfos.push({ gm, info });
    }
    sessionInfos.sort((a, b) => Number(a.info.sessionStartedAt ?? Infinity) - Number(b.info.sessionStartedAt ?? Infinity)
      || String(a.gm.id).localeCompare(String(b.gm.id)));

    for (const { gm, info } of sessionInfos) {
      const previous = ledger.sessions[gm.id];
      if (!previous || previous.sessionId !== info.sessionId || !previous.active) {
        ledger.sequence += 1;
        ledger.sessions[gm.id] = {
          userId: gm.id,
          sessionId: info.sessionId,
          sequence: ledger.sequence,
          active: true,
          sessionStartedAt: Number(info.sessionStartedAt) || Date.now(),
          connectedAt: nowIso(),
          disconnectedAt: null
        };
        changed = true;
      }
    }

    if (changed) {
      await game.settings.set(MODULE_ID, SETTINGS.REACTION_AUTHORITY_LEDGER, ledger);
      this.#stats.ledgerSyncs += 1;
    }
    return ledger;
  }

  async #authorizeDecisionSocket(payload) {
    const primary = this.getPrimaryGm();
    if (!game?.user?.isGM || primary?.id !== game.user.id) {
      this.#stats.authorizationRejects += 1;
      return {
        authorized: false,
        reason: "not-primary",
        redirectPrimaryGmId: primary?.id ?? null
      };
    }

    const response = payload?.response;
    const type = response?.type;
    if (!["selected", "declined", "manual"].includes(type)) {
      this.#stats.authorizationRejects += 1;
      return { authorized: false, reason: "invalid-response" };
    }
    if (type === "selected") {
      const offers = payload?.opportunity?.offers ?? [];
      if (!offers.some(offer => offer?.id === response.offerId)) {
        this.#stats.authorizationRejects += 1;
        return { authorized: false, reason: "offer-not-present" };
      }
    }

    if (this.#validator) {
      try {
        const validation = await this.#validator(payload);
        if (validation === false || validation?.valid === false) {
          this.#stats.authorizationRejects += 1;
          return { authorized: false, reason: validation?.reason ?? "revalidation-failed" };
        }
      } catch (error) {
        Logger.warn("Reaction authority decision revalidation failed.", error);
        this.#stats.authorizationRejects += 1;
        return { authorized: false, reason: "revalidation-error" };
      }
    }

    this.#stats.authorizations += 1;
    return {
      authorized: true,
      primaryGmId: game.user.id,
      authorizedAt: nowIso()
    };
  }

  async #rollTiebreakSocket({ reactorTokenUuids = [] } = {}) {
    const primary = this.getPrimaryGm();
    if (!game?.user?.isGM || primary?.id !== game.user.id) {
      throw new Error("Only the current AE5E primary GM may roll Reaction Broker tiebreaks.");
    }
    const rolls = {};
    for (const uuid of reactorTokenUuids) {
      let total;
      if (globalThis.Roll) {
        const roll = await new Roll("1d20").evaluate();
        total = Number(roll.total);
      } else {
        const random = globalThis.CONFIG?.Dice?.randomUniform?.() ?? Math.random();
        total = Math.floor(random * 20) + 1;
      }
      rolls[uuid] = Math.max(1, Math.min(20, Math.trunc(total)));
      this.#stats.tiebreakRolls += 1;
    }
    return { rolls };
  }

  #clearSettledReconnects() {
    if (!this.#pendingReconnects.size) return;
    const ledger = this.#readLedger();
    for (const [userId, previousSessionId] of this.#pendingReconnects) {
      const current = ledger.sessions?.[userId];
      if (!current?.active) continue;
      if (current.sessionId && current.sessionId !== previousSessionId) this.#pendingReconnects.delete(userId);
    }
  }

  #readLedger() {
    try {
      const value = game?.settings?.get(MODULE_ID, SETTINGS.REACTION_AUTHORITY_LEDGER);
      if (value && typeof value === "object") return value;
    } catch {
      // Tests and very early startup may not have settings available yet.
    }
    return { sequence: 0, sessions: {} };
  }

  #emitIfChanged() {
    const primaryId = this.getPrimaryGm()?.id ?? null;
    if (primaryId === this.#lastPrimaryId) return;
    const previousPrimaryGmId = this.#lastPrimaryId;
    this.#lastPrimaryId = primaryId;
    this.#stats.authorityChanges += 1;
    this.#stats.lastAuthorityChange = {
      at: nowIso(),
      previousPrimaryGmId,
      primaryGmId: primaryId
    };
    const payload = {
      previousPrimaryGmId,
      primaryGmId: primaryId,
      hasActiveGm: this.hasActiveGm()
    };
    for (const listener of this.#listeners) {
      try { listener(payload); } catch (error) { Logger.warn("Reaction authority listener failed.", error); }
    }
    Hooks.callAll(HOOKS.REACTION_AUTHORITY_CHANGED, payload);
  }
}
