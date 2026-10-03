import { MODULE_ID } from "../core/constants.js";

export const OA_IMMUNITY_KEY = "flags.gambits-premades.oaImmunity";
export const movementImmunityValue = actor => actor?.flags?.["gambits-premades"]?.oaImmunity;
export function movementImmunitySnapshot(actor) {
  return {
    preparedValue: movementImmunityValue(actor) ?? null,
    storedValue: actor?._source?.flags?.["gambits-premades"]?.oaImmunity ?? null,
    contributors: Array.from(actor.effects?.values?.() ?? actor.effects ?? []).flatMap(effect => {
      const changes = Array.from(effect.system?.changes ?? []).filter(change => change.key === OA_IMMUNITY_KEY)
        .map(({ key, type, phase, value, priority }) => ({ key, type, phase, value, priority }));
      return changes.length ? [{ id: effect.id, name: effect.name, disabled: !!effect.disabled,
        suppressed: !!effect.isSuppressed, changes }] : [];
    }).sort((a, b) => a.id.localeCompare(b.id))
  };
}

/** Provider-compatible, transaction-owned immunity. Never writes an Actor's stored OA flag. */
export class MovementProtectionService {
  #wrapperId = null;
  #wrapperError = null;
  initialize() {
    if (this.#wrapperId !== null) return;
    try {
      this.#wrapperId = globalThis.libWrapper.register(MODULE_ID,
        "CONFIG.ActiveEffect.documentClass.prototype._displayScrollingStatus",
        function ae5eMovementScrollingStatus(wrapped, ...args) {
          const metadata = this.flags?.[MODULE_ID]?.movementProtection;
          if (metadata?.scope === "movement-window" && metadata.suppressScrollingStatus === true &&
              metadata.effectId === this.id && typeof metadata.transactionId === "string" && metadata.transactionId) return;
          return wrapped(...args);
        }, "MIXED");
      this.#wrapperError = null;
    } catch (error) { this.#wrapperError = error.message; }
  }
  getStatus() { return { scrollingWrapperRegistered: this.#wrapperId !== null, error: this.#wrapperError }; }

  async begin(subject, { origin, name = "AE5E — Temporary OA Immunity", validate = () => {} } = {}) {
    if (this.#wrapperId === null) throw new Error(`Movement protection is unavailable: ${this.#wrapperError ?? "not initialized"}`);
    const document = subject?.document ?? subject;
    const actor = document?.actor;
    if (!actor || typeof actor.createEmbeddedDocuments !== "function") throw new Error("Movement protection requires a Token with an Actor.");
    const effectId = globalThis.foundry.utils.randomID();
    const transactionId = globalThis.foundry.utils.randomID();
    const before = movementImmunitySnapshot(actor);
    let disposed = false;
    const assertActive = () => {
      if (disposed) throw new Error("Movement protection has already ended.");
      const effect = actor.effects.get(effectId);
      const metadata = effect?.flags?.[MODULE_ID]?.movementProtection;
      const change = Array.from(effect?.system?.changes ?? []).find(change => change.key === OA_IMMUNITY_KEY);
      if (!effect || effect.disabled || effect.isSuppressed || metadata?.transactionId !== transactionId ||
          change?.type !== "override" || change.phase !== "final" || change.value !== "1" || !movementImmunityValue(actor)) {
        throw new Error("Temporary OA immunity ended before movement completed.");
      }
    };
    const dispose = async () => {
      if (disposed) return { removed: true, alreadyDisposed: true };
      const effect = actor.effects.get(effectId);
      if (effect && effect.flags?.[MODULE_ID]?.movementProtection?.transactionId !== transactionId) {
        throw new Error("Movement immunity ownership mismatch; effect was not deleted.");
      }
      if (effect) await actor.deleteEmbeddedDocuments("ActiveEffect", [effectId]);
      if (actor.effects.get(effectId)) throw new Error("Temporary movement immunity could not be removed.");
      disposed = true;
      const after = movementImmunitySnapshot(actor);
      const comparable = state => JSON.stringify({ storedValue: state.storedValue, contributors: state.contributors });
      const unchangedContributors = comparable(before) === comparable(after);
      const baselineRestored = unchangedContributors ? JSON.stringify(before.preparedValue) === JSON.stringify(after.preparedValue) : null;
      if (baselineRestored === false) throw new Error("Prepared OA immunity did not return to its prior state.");
      return { actorUuid: actor.uuid, effectId, transactionId, removed: true, before, after, unchangedContributors, baselineRestored };
    };
    try {
      validate();
      const created = await actor.createEmbeddedDocuments("ActiveEffect", [{
        _id: effectId, name, img: "icons/svg/wingfoot.svg", origin: origin ?? document.uuid,
        disabled: false, transfer: false,
        system: { changes: [{ key: OA_IMMUNITY_KEY, type: "override", phase: "final", value: "1", priority: 20 }] },
        flags: { [MODULE_ID]: { movementProtection: { effectId, transactionId, tokenUuid: document.uuid,
          scope: "movement-window", suppressScrollingStatus: true } } }
      }], { keepId: true });
      if (created.length !== 1 || created[0].id !== effectId) throw new Error("Unexpected movement immunity creation result.");
      const started = Date.now();
      while (!movementImmunityValue(actor)) {
        validate();
        if (Date.now() - started >= 2000) throw new Error("Timed out waiting for prepared OA immunity.");
        await new Promise(resolve => globalThis.setTimeout(resolve, 20));
      }
      validate();
      assertActive();
      return { actorUuid: actor.uuid, effectId, transactionId, before,
        effect: actor.effects.get(effectId).toObject(), assertActive, dispose };
    } catch (error) {
      try { await dispose(); } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "Movement protection failed and cleanup needs attention.");
      }
      throw error;
    }
  }

  async withImmunity(subject, options, callback) {
    if (typeof callback !== "function") throw new Error("Movement protection requires a callback.");
    const lease = await this.begin(subject, options);
    let result, failure;
    try { result = await callback(lease); } catch (error) { failure = error; }
    try { await lease.dispose(); } catch (error) {
      if (failure) throw new AggregateError([failure, error], "Movement and immunity cleanup failed.");
      throw error;
    }
    if (failure) throw failure;
    return result;
  }
}
