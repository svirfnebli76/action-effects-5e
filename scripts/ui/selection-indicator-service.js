import {
  MODULE_ID,
  SELECTION_INDICATOR_EFFECT_NAME,
  SELECTION_INDICATOR_FALLBACK_ASSET,
  SELECTION_INDICATOR_FALLBACK_SCALE,
  SELECTION_INDICATOR_PREFERRED_ASSET,
  SELECTION_INDICATOR_PREFERRED_SCALE,
  SELECTION_INDICATOR_PREFERRED_TINT,
  SELECTION_INDICATOR_CORNER_OFFSET_FACTOR
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
  #renderedTokens = new Set();
  #warnedUnavailable = false;
  #stats = {
    effectsStarted: 0,
    effectsStopped: 0,
    fallbackUses: 0,
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
   */
  async acquire({ token = null, tokenUuid = null, reason = "selection" } = {}) {
    const resolved = await this.#resolveToken({ token, tokenUuid });
    if (!resolved) {
      const lease = this.#createLease({ tokenUuid: tokenUuid ?? null, reason, rendered: false });
      this.#record("acquire-no-token", { leaseId: lease.id, tokenUuid: lease.tokenUuid, reason });
      Logger.warn("Selection indicator could not resolve a canvas token; continuing without a visual.", { token, tokenUuid, reason });
      return this.#leaseFacade(lease);
    }

    const uuid = resolved.document.uuid;
    const lease = this.#createLease({ tokenUuid: uuid, reason, rendered: false });
    let tokenLeases = this.#leasesByToken.get(uuid);
    const firstLease = !tokenLeases?.size;
    if (!tokenLeases) {
      tokenLeases = new Set();
      this.#leasesByToken.set(uuid, tokenLeases);
    }
    tokenLeases.add(lease.id);

    if (firstLease) {
      lease.rendered = await this.#startVisual(resolved);
    } else {
      lease.rendered = this.#renderedTokens.has(uuid);
    }

    this.#record("acquire", {
      leaseId: lease.id,
      tokenUuid: uuid,
      reason,
      firstLease,
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
    tokenLeases?.delete(leaseId);
    this.#leases.delete(leaseId);

    if (uuid && tokenLeases && tokenLeases.size === 0) {
      this.#leasesByToken.delete(uuid);
      const token = await this.#resolveToken({ tokenUuid: uuid });
      await this.#stopVisual(uuid, token);
    }

    this.#record("release", {
      leaseId,
      tokenUuid: uuid,
      remainingForToken: uuid ? (this.#leasesByToken.get(uuid)?.size ?? 0) : 0
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
  async waitForDialog({ token = null, tokenUuid = null, reason = "dialog", config = {} } = {}) {
    const DialogV2 = foundry?.applications?.api?.DialogV2;
    if (!DialogV2?.wait) throw new Error("Foundry DialogV2.wait() is unavailable.");

    const dialogConfig = {
      ...config,
      rejectClose: config.rejectClose ?? false
    };

    return this.withIndicator({ token, tokenUuid, reason }, () => DialogV2.wait(dialogConfig));
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
    return {
      initialized: this.#initialized,
      sequencer: {
        installed: Boolean(sequencer),
        active: Boolean(sequencer?.active),
        version: sequencer?.version ?? null,
        apiAvailable: this.#sequencerAvailable()
      },
      preferredAsset: SELECTION_INDICATOR_PREFERRED_ASSET,
      preferredTint: SELECTION_INDICATOR_PREFERRED_TINT,
      fallbackAsset: SELECTION_INDICATOR_FALLBACK_ASSET,
      preferredScale: SELECTION_INDICATOR_PREFERRED_SCALE,
      fallbackScale: SELECTION_INDICATOR_FALLBACK_SCALE,
      cornerOffsetFactor: SELECTION_INDICATOR_CORNER_OFFSET_FACTOR,
      activeTokens: this.#leasesByToken.size,
      activeLeases: this.#leases.size,
      renderedTokens: this.#renderedTokens.size,
      ...this.#stats
    };
  }

  async #startVisual(token) {
    const uuid = token.document.uuid;
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

      const asset = this.#preferredAssetAvailable()
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
        .file(asset);

      // The preferred Eskie source is the neutral white variant so AE5E owns
      // the indicator color rather than depending on a pre-colored database key.
      if (asset === SELECTION_INDICATOR_PREFERRED_ASSET) {
        effect.tint(SELECTION_INDICATOR_PREFERRED_TINT);
      }

      effect
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
      this.#renderedTokens.add(uuid);
      this.#stats.effectsStarted += 1;
      this.#record("visual-start", {
        tokenUuid: uuid,
        asset,
        tint: asset === SELECTION_INDICATOR_PREFERRED_ASSET ? SELECTION_INDICATOR_PREFERRED_TINT : null,
        scale,
        offset
      });
      return true;
    } catch (error) {
      this.#stats.startFailures += 1;
      this.#renderedTokens.delete(uuid);
      this.#record("visual-start-failed", { tokenUuid: uuid, error: error?.message ?? String(error) });
      Logger.warn("Selection indicator could not be started; continuing without a visual.", error);
      return false;
    }
  }

  async #stopVisual(uuid, token) {
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
      this.#record("visual-stop", { tokenUuid: uuid });
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
      && globalThis.Sequencer?.Database
      && typeof globalThis.Sequence === "function"
    );
  }

  #preferredAssetAvailable() {
    const database = globalThis.Sequencer?.Database;
    if (!database) return false;
    try {
      if (typeof database.entryExists === "function") {
        return Boolean(database.entryExists(SELECTION_INDICATOR_PREFERRED_ASSET));
      }
      if (typeof database.getEntry === "function") {
        return Boolean(database.getEntry(SELECTION_INDICATOR_PREFERRED_ASSET));
      }
    } catch (error) {
      Logger.warn("Could not query the Sequencer database for the preferred selection indicator asset.", error);
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

  #createLease({ tokenUuid, reason, rendered }) {
    const id = globalThis.foundry?.utils?.randomID?.()
      ?? globalThis.crypto?.randomUUID?.()
      ?? `${Date.now()}-${Math.random()}`;
    const lease = {
      id,
      tokenUuid,
      reason,
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
