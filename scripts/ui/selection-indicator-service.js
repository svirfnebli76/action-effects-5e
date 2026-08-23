import {
  MODULE_ID,
  SELECTION_INDICATOR_CORNER_OFFSET_FACTOR,
  SELECTION_INDICATOR_EFFECT_NAME,
  SELECTION_INDICATOR_FALLBACK_ASSET,
  SELECTION_INDICATOR_FALLBACK_SCALE,
  SELECTION_INDICATOR_PREFERRED_ASSET,
  SELECTION_INDICATOR_PREFERRED_SCALE,
  SELECTION_INDICATOR_PRESENTATIONS,
  SELECTION_INDICATOR_ROLE_PRIORITY,
  SELECTION_INDICATOR_ROLES
} from "../core/constants.js";
import { Logger } from "../core/logger.js";

/**
 * Lightweight visual ownership indicator for AE5E workflows which are waiting
 * on a user's popup, destination selector, or other interactive choice.
 *
 * The service deliberately treats the visual as advisory UI. A Sequencer
 * problem must never prevent the underlying rules workflow from continuing.
 */
export class SelectionIndicatorService {
  #initialized = false;
  #leases = new Map();
  #leasesByToken = new Map();
  #renderedTokens = new Map();
  #warnedUnavailable = false;
  #stats = {
    effectsStarted: 0,
    effectsStopped: 0,
    roleSwitches: 0,
    fallbackUses: 0,
    soundsPlayed: 0,
    startFailures: 0,
    stopFailures: 0,
    lastEvent: null
  };

  async initialize() {
    if (this.#initialized) return;
    this.#initialized = true;

    // A DialogV2 cannot survive a reload, so an old AE5E selection indicator
    // cannot be valid after startup. Only the GM performs this broad cleanup.
    if (game?.user?.isGM && this.#sequencerAvailable()) {
      try {
        await this.#endSequencerEffects({ name: SELECTION_INDICATOR_EFFECT_NAME });
      } catch (error) {
        Logger.warn("Could not clear stale selection indicators during startup.", error);
      }
    }
  }

  /**
   * Acquire one logical "waiting for user" lease for a token.
   * Multiple leases on the same token share one visual effect.
   *
   * role communicates the semantic reason for the wait:
   * - originator: AE5E actor initiating/choosing (green by default)
   * - responder: AE5E target/other participant responding (amber by default)
   * - external: recognized third-party prompt (blue by default)
   */
  async acquire({
    token = null,
    tokenUuid = null,
    reason = "selection",
    role = SELECTION_INDICATOR_ROLES.ORIGINATOR,
    playSound = true,
    notifyUserId = game?.user?.id ?? null
  } = {}) {
    const normalizedRole = this.#normalizeRole(role);
    const resolved = await this.#resolveToken({ token, tokenUuid });
    if (!resolved) {
      const lease = this.#createLease({
        tokenUuid: tokenUuid ?? null,
        reason,
        role: normalizedRole,
        playSound,
        notifyUserId,
        rendered: false
      });
      this.#record("acquire-no-token", {
        leaseId: lease.id,
        tokenUuid: lease.tokenUuid,
        reason,
        role: normalizedRole
      });
      Logger.warn("Selection indicator could not resolve a canvas token; continuing without a visual.", {
        token,
        tokenUuid,
        reason,
        role: normalizedRole
      });
      return this.#leaseFacade(lease);
    }

    const uuid = resolved.document.uuid;
    const lease = this.#createLease({
      tokenUuid: uuid,
      reason,
      role: normalizedRole,
      playSound,
      notifyUserId,
      rendered: false
    });
    let tokenLeases = this.#leasesByToken.get(uuid);
    const firstLease = !tokenLeases?.size;
    if (!tokenLeases) {
      tokenLeases = new Set();
      this.#leasesByToken.set(uuid, tokenLeases);
    }
    tokenLeases.add(lease.id);

    const previousRole = this.#renderedTokens.get(uuid)?.role ?? null;
    const desiredRole = this.#dominantRoleForToken(uuid);

    if (firstLease) {
      lease.rendered = await this.#startVisual(resolved, {
        role: desiredRole,
        playSound: lease.playSound,
        notifyUserId: lease.notifyUserId
      });
    } else if (desiredRole !== previousRole) {
      lease.rendered = await this.#switchVisualRole(resolved, {
        fromRole: previousRole,
        toRole: desiredRole,
        // A newly-acquired lease may announce itself when it becomes dominant.
        // Downgrades caused by release never replay audio (handled in release()).
        playSound: lease.role === desiredRole && lease.playSound,
        notifyUserId: lease.notifyUserId
      });
    } else {
      lease.rendered = this.#renderedTokens.has(uuid);
    }

    this.#record("acquire", {
      leaseId: lease.id,
      tokenUuid: uuid,
      reason,
      role: normalizedRole,
      dominantRole: desiredRole,
      firstLease,
      playSound: Boolean(playSound),
      notifyUserId,
      rendered: lease.rendered,
      leaseCount: tokenLeases.size
    });
    return this.#leaseFacade(lease);
  }

  /** Release a lease returned by acquire(). Safe to call more than once. */
  async release(leaseOrId) {
    const leaseId = typeof leaseOrId === "string" ? leaseOrId : leaseOrId?.id;
    if (!leaseId) return false;

    const lease = this.#leases.get(leaseId);
    if (!lease || lease.released) return false;
    lease.released = true;

    const uuid = lease.tokenUuid;
    const tokenLeases = uuid ? this.#leasesByToken.get(uuid) : null;
    const previousRole = uuid ? (this.#renderedTokens.get(uuid)?.role ?? null) : null;
    tokenLeases?.delete(leaseId);
    this.#leases.delete(leaseId);

    if (uuid && tokenLeases && tokenLeases.size === 0) {
      this.#leasesByToken.delete(uuid);
      const token = await this.#resolveToken({ tokenUuid: uuid });
      await this.#stopVisual(uuid, token);
    } else if (uuid && tokenLeases?.size) {
      const desiredRole = this.#dominantRoleForToken(uuid);
      if (desiredRole && desiredRole !== previousRole) {
        const token = await this.#resolveToken({ tokenUuid: uuid });
        if (token) {
          // Returning to an older still-active lease is a visual state change,
          // not a new prompt, so never replay that lease's notification sound.
          await this.#switchVisualRole(token, {
            fromRole: previousRole,
            toRole: desiredRole,
            playSound: false,
            notifyUserId: null
          });
        }
      }
    }

    this.#record("release", {
      leaseId,
      tokenUuid: uuid,
      role: lease.role,
      remainingForToken: uuid ? (this.#leasesByToken.get(uuid)?.size ?? 0) : 0,
      dominantRole: uuid ? (this.#renderedTokens.get(uuid)?.role ?? null) : null
    });
    return true;
  }

  /**
   * Run any asynchronous interaction while the token displays the indicator.
   * Cleanup is guaranteed by finally, including cancellation and exceptions.
   */
  async withIndicator(options, interaction) {
    if (typeof interaction !== "function") throw new TypeError("Selection indicator interaction must be a function.");
    const lease = await this.acquire(options);
    try {
      return await interaction(lease);
    } finally {
      await this.release(lease);
    }
  }

  /**
   * Convenience wrapper for Foundry v14 DialogV2.wait(). Closing with the X,
   * submitting a button, or an exception all release the visual lease.
   */
  async waitForDialog({
    token = null,
    tokenUuid = null,
    reason = "dialog",
    role = SELECTION_INDICATOR_ROLES.ORIGINATOR,
    playSound = true,
    notifyUserId = game?.user?.id ?? null,
    config = {}
  } = {}) {
    const DialogV2 = foundry?.applications?.api?.DialogV2;
    if (!DialogV2?.wait) throw new Error("Foundry DialogV2.wait() is unavailable.");

    // Mark AE5E-owned DialogV2 windows so the external-prompt bridge can always
    // exclude them even after third-party adapters are added later.
    const classes = new Set([
      ...(Array.isArray(config.classes) ? config.classes : []),
      `${MODULE_ID}-owned-dialog`
    ]);
    const dialogConfig = {
      ...config,
      classes: [...classes],
      rejectClose: config.rejectClose ?? false
    };

    return this.withIndicator(
      { token, tokenUuid, reason, role, playSound, notifyUserId },
      () => DialogV2.wait(dialogConfig)
    );
  }

  /** Release every local lease and end the corresponding visuals. */
  async clearAll() {
    const tokenUuids = [...this.#leasesByToken.keys()];
    this.#leases.clear();
    this.#leasesByToken.clear();

    for (const uuid of tokenUuids) {
      const token = await this.#resolveToken({ tokenUuid: uuid });
      await this.#stopVisual(uuid, token);
    }
    return tokenUuids.length;
  }

  getStats() {
    const sequencer = game?.modules?.get?.("sequencer");
    const activeRoles = {};
    for (const lease of this.#leases.values()) {
      activeRoles[lease.role] = (activeRoles[lease.role] ?? 0) + 1;
    }
    const renderedRoles = {};
    for (const state of this.#renderedTokens.values()) {
      renderedRoles[state.role] = (renderedRoles[state.role] ?? 0) + 1;
    }

    return {
      initialized: this.#initialized,
      sequencer: {
        installed: Boolean(sequencer),
        active: Boolean(sequencer?.active),
        version: sequencer?.version ?? null,
        apiAvailable: this.#sequencerAvailable()
      },
      roles: SELECTION_INDICATOR_ROLES,
      presentations: SELECTION_INDICATOR_PRESENTATIONS,
      preferredAsset: SELECTION_INDICATOR_PREFERRED_ASSET,
      fallbackAsset: SELECTION_INDICATOR_FALLBACK_ASSET,
      preferredScale: SELECTION_INDICATOR_PREFERRED_SCALE,
      fallbackScale: SELECTION_INDICATOR_FALLBACK_SCALE,
      cornerOffsetFactor: SELECTION_INDICATOR_CORNER_OFFSET_FACTOR,
      activeTokens: this.#leasesByToken.size,
      activeLeases: this.#leases.size,
      renderedTokens: this.#renderedTokens.size,
      activeRoles,
      renderedRoles,
      ...this.#stats
    };
  }

  async #switchVisualRole(token, { fromRole = null, toRole, playSound = false, notifyUserId = null } = {}) {
    if (!toRole) return false;
    const uuid = token.document.uuid;
    const hadVisual = this.#renderedTokens.has(uuid);
    if (hadVisual && this.#sequencerAvailable()) {
      try {
        await this.#endSequencerEffects({ name: SELECTION_INDICATOR_EFFECT_NAME, object: token });
      } catch (error) {
        Logger.warn("Could not clear the prior selection-indicator role before switching presentation.", error);
      }
      this.#renderedTokens.delete(uuid);
    }
    const rendered = await this.#startVisual(token, { role: toRole, playSound, notifyUserId });
    if (rendered) {
      this.#stats.roleSwitches += 1;
      this.#record("visual-role-switch", { tokenUuid: uuid, fromRole, toRole });
    }
    return rendered;
  }

  async #startVisual(token, {
    role = SELECTION_INDICATOR_ROLES.ORIGINATOR,
    playSound = true,
    notifyUserId = game?.user?.id ?? null
  } = {}) {
    const uuid = token.document.uuid;
    const normalizedRole = this.#normalizeRole(role);
    const presentation = this.#presentationForRole(normalizedRole);
    if (!this.#sequencerAvailable()) {
      if (!this.#warnedUnavailable) {
        this.#warnedUnavailable = true;
        Logger.warn("Sequencer is not active; selection indicators will be omitted. The underlying workflow will continue normally.");
      }
      return false;
    }

    try {
      // Clear a stale effect on this exact token before starting a new one.
      await this.#endSequencerEffects({ name: SELECTION_INDICATOR_EFFECT_NAME, object: token });

      const asset = await this.#preferredAssetAvailable()
        ? SELECTION_INDICATOR_PREFERRED_ASSET
        : SELECTION_INDICATOR_FALLBACK_ASSET;
      const scale = asset === SELECTION_INDICATOR_PREFERRED_ASSET
        ? SELECTION_INDICATOR_PREFERRED_SCALE
        : SELECTION_INDICATOR_FALLBACK_SCALE;
      if (asset === SELECTION_INDICATOR_FALLBACK_ASSET) this.#stats.fallbackUses += 1;

      const document = token.document;
      const offset = {
        x: Math.max(0, Number(document.width) || 1) * SELECTION_INDICATOR_CORNER_OFFSET_FACTOR,
        y: -Math.max(0, Number(document.height) || 1) * SELECTION_INDICATOR_CORNER_OFFSET_FACTOR
      };

      const sequence = this.#createSequence();
      const effect = sequence
        .effect()
        .name(SELECTION_INDICATOR_EFFECT_NAME)
        .file(asset)
        // Tint both the raw WebM and the Foundry fallback so role semantics are
        // still visible when Eskie Effects is not installed.
        .tint(presentation.tint);

      // The audible cue belongs to the user whose client owns this particular
      // wait, not to every user who can see the broadcast indicator. Role
      // profiles may omit audio entirely until a distinct cue is supplied.
      if (playSound && notifyUserId && presentation.soundAsset) {
        sequence
          .sound()
          .file(presentation.soundAsset)
          .volume(presentation.soundVolume)
          .audioChannel("interface")
          .forUsers(notifyUserId);
        this.#stats.soundsPlayed += 1;
      }

      effect
        // This is an interaction-status marker, not an in-world VFX. Route it
        // through Sequencer's above-interface path so it renders in Foundry's
        // ControlsLayer and can sit above token control/selection outlines.
        .aboveInterface()
        .zIndex(1000)
        .attachTo(token, {
          offset,
          gridUnits: true,
          bindRotation: false,
          bindScale: false
        })
        .scaleToObject(scale, {
          uniform: true,
          considerTokenScale: false
        })
        .persist();

      await sequence.play();
      this.#renderedTokens.set(uuid, { role: normalizedRole, startedAt: Date.now() });
      this.#stats.effectsStarted += 1;
      this.#record("visual-start", {
        tokenUuid: uuid,
        role: normalizedRole,
        asset,
        tint: presentation.tint,
        scale,
        offset,
        sound: playSound && notifyUserId && presentation.soundAsset
          ? { asset: presentation.soundAsset, volume: presentation.soundVolume, userId: notifyUserId }
          : null
      });
      return true;
    } catch (error) {
      this.#stats.startFailures += 1;
      this.#renderedTokens.delete(uuid);
      this.#record("visual-start-failed", {
        tokenUuid: uuid,
        role: normalizedRole,
        error: error?.message ?? String(error)
      });
      Logger.warn("Selection indicator could not be started; continuing without a visual.", error);
      return false;
    }
  }

  async #stopVisual(uuid, token) {
    const state = this.#renderedTokens.get(uuid) ?? null;
    const wasRendered = this.#renderedTokens.delete(uuid);
    if (!wasRendered || !this.#sequencerAvailable()) return false;

    try {
      if (token) {
        await this.#endSequencerEffects({ name: SELECTION_INDICATOR_EFFECT_NAME, object: token });
      } else if (this.#renderedTokens.size === 0) {
        // A vanished token can leave a persistent Sequencer effect without an
        // object we can target. Broad cleanup is only safe when AE5E has no
        // other live selection indicators; otherwise it could erase another
        // user's still-valid visual.
        await this.#endSequencerEffects({ name: SELECTION_INDICATOR_EFFECT_NAME });
      } else {
        Logger.warn(
          "Selection indicator token vanished while other indicators remain active; skipping broad cleanup to avoid clearing another user's visual.",
          { tokenUuid: uuid, remainingRenderedTokens: this.#renderedTokens.size }
        );
      }
      this.#stats.effectsStopped += 1;
      this.#record("visual-stop", { tokenUuid: uuid, role: state?.role ?? null });
      return true;
    } catch (error) {
      this.#stats.stopFailures += 1;
      this.#record("visual-stop-failed", { tokenUuid: uuid, error: error?.message ?? String(error) });
      Logger.warn("Selection indicator cleanup failed.", error);
      return false;
    }
  }

  #createSequence() {
    const SequenceClass = globalThis.Sequence;
    if (typeof SequenceClass !== "function") throw new Error("Sequencer Sequence constructor is unavailable.");

    const version = game?.modules?.get?.("sequencer")?.version ?? "0";
    const isV4 = globalThis.foundry?.utils?.isNewerVersion
      ? foundry.utils.isNewerVersion(version, "3.999.999")
      : Number.parseInt(version, 10) >= 4;

    return isV4
      ? new SequenceClass({ inModuleName: MODULE_ID, softFail: true })
      : new SequenceClass(MODULE_ID, true);
  }

  #sequencerAvailable() {
    return Boolean(
      game?.modules?.get?.("sequencer")?.active
      && globalThis.Sequencer?.EffectManager
      && typeof globalThis.Sequence === "function"
    );
  }

  async #preferredAssetAvailable() {
    // The raw animation lives inside Eskie's package. It is intentionally not
    // resolved through Sequencer.Database because that entry's metadata changes
    // the loop behavior we want for this persistent waiting indicator.
    if (!game?.modules?.get?.("eskie-effects")) return false;

    // Verify the exact physical asset rather than assuming an installed package
    // still contains this particular file. getRoute() preserves Foundry path
    // prefixes used by hosted/reverse-proxy installations.
    try {
      const route = globalThis.foundry?.utils?.getRoute
        ? foundry.utils.getRoute(SELECTION_INDICATOR_PREFERRED_ASSET)
        : SELECTION_INDICATOR_PREFERRED_ASSET;
      let response = await fetch(route, { method: "HEAD", cache: "no-store" });
      if (response.ok) return true;

      // Some static hosts reject HEAD. Probe one byte as a compatibility fallback
      // and immediately cancel the response body so we do not download the WebM.
      if (response.status === 405 || response.status === 501) {
        response = await fetch(route, {
          method: "GET",
          cache: "no-store",
          headers: { Range: "bytes=0-0" }
        });
        const available = response.ok;
        try { await response.body?.cancel?.(); } catch (_error) {}
        return available;
      }
    } catch (error) {
      Logger.warn("Could not verify the preferred raw selection-indicator asset; using the Foundry fallback.", error);
    }
    return false;
  }

  async #endSequencerEffects(filters) {
    const manager = globalThis.Sequencer?.EffectManager;
    if (!manager) return false;
    if (typeof manager.endEffects === "function") return manager.endEffects(filters);
    if (typeof manager.endEffect === "function") return manager.endEffect(filters);
    throw new Error("Sequencer EffectManager does not expose endEffects().");
  }

  async #resolveToken({ token = null, tokenUuid = null } = {}) {
    let candidate = token;
    if (!candidate && tokenUuid) {
      try {
        candidate = await fromUuid(tokenUuid);
      } catch (_error) {
        candidate = null;
      }
    }

    // Token placeable.
    if (candidate?.document?.uuid && candidate?.document?.parent?.id) {
      return candidate;
    }

    // TokenDocument on the currently rendered Scene.
    if (candidate?.uuid && candidate?.parent?.id) {
      if (candidate.object) return candidate.object;
      if (canvas?.ready && canvas.scene?.id === candidate.parent.id) return canvas.tokens?.get?.(candidate.id) ?? null;
    }

    return null;
  }

  #normalizeRole(role) {
    const values = Object.values(SELECTION_INDICATOR_ROLES);
    return values.includes(role) ? role : SELECTION_INDICATOR_ROLES.ORIGINATOR;
  }

  #presentationForRole(role) {
    return SELECTION_INDICATOR_PRESENTATIONS[this.#normalizeRole(role)]
      ?? SELECTION_INDICATOR_PRESENTATIONS[SELECTION_INDICATOR_ROLES.ORIGINATOR];
  }

  #dominantRoleForToken(tokenUuid) {
    const ids = this.#leasesByToken.get(tokenUuid);
    if (!ids?.size) return null;

    let bestRole = SELECTION_INDICATOR_ROLES.EXTERNAL;
    let bestPriority = -Infinity;
    let bestCreatedAt = -Infinity;
    for (const id of ids) {
      const lease = this.#leases.get(id);
      if (!lease || lease.released) continue;
      const priority = Number(SELECTION_INDICATOR_ROLE_PRIORITY[lease.role]) || 0;
      if (priority > bestPriority || (priority === bestPriority && lease.createdAt > bestCreatedAt)) {
        bestRole = lease.role;
        bestPriority = priority;
        bestCreatedAt = lease.createdAt;
      }
    }
    return bestRole;
  }

  #createLease({ tokenUuid, reason, role, playSound, notifyUserId, rendered }) {
    const id = globalThis.foundry?.utils?.randomID?.()
      ?? globalThis.crypto?.randomUUID?.()
      ?? `${Date.now()}-${Math.random()}`;
    const lease = {
      id,
      tokenUuid,
      reason,
      role: this.#normalizeRole(role),
      playSound: Boolean(playSound),
      notifyUserId: notifyUserId ?? null,
      rendered: Boolean(rendered),
      released: false,
      createdAt: Date.now()
    };
    this.#leases.set(id, lease);
    return lease;
  }

  #leaseFacade(lease) {
    return Object.freeze({
      id: lease.id,
      tokenUuid: lease.tokenUuid,
      reason: lease.reason,
      role: lease.role,
      get rendered() { return lease.rendered; },
      release: () => this.release(lease.id)
    });
  }

  #record(type, details) {
    this.#stats.lastEvent = {
      type,
      at: Date.now(),
      ...details
    };
  }
}
