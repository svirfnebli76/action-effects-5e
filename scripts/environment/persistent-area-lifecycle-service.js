import {
  MODULE_ID,
  ONGOING_ACTION_EFFECT_FLAG,
  PERSISTENT_AREA_EFFECT_FLAG,
  PERSISTENT_AREA_LIFECYCLE_SCHEMA_VERSION
} from "../core/constants.js";
import { Logger } from "../core/logger.js";
import { duplicateSafely, nowIso } from "../core/utils.js";

function clone(value) {
  return duplicateSafely(value);
}

function asArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return [...value];
  if (typeof value.values === "function") return [...value.values()];
  return [value];
}

function getProperty(object, path) {
  if (globalThis.foundry?.utils?.getProperty) return foundry.utils.getProperty(object, path);
  return String(path).split(".").reduce((value, part) => value?.[part], object);
}

function setProperty(object, path, value) {
  if (globalThis.foundry?.utils?.setProperty) return foundry.utils.setProperty(object, path, value);
  const parts = String(path).split(".");
  const leaf = parts.pop();
  let current = object;
  for (const part of parts) current = current[part] ??= {};
  current[leaf] = value;
  return true;
}

function unsetProperty(object, path) {
  if (globalThis.foundry?.utils?.unsetProperty) return foundry.utils.unsetProperty(object, path);
  const parts = String(path).split(".");
  const leaf = parts.pop();
  const parent = parts.reduce((value, part) => value?.[part], object);
  if (!parent || !(leaf in parent)) return false;
  delete parent[leaf];
  return true;
}

function mergeInto(target, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return target;
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const current = target[key];
      target[key] = mergeInto(current && typeof current === "object" && !Array.isArray(current) ? current : {}, value);
    } else {
      target[key] = clone(value);
    }
  }
  return target;
}

function normalizeString(value) {
  return String(value ?? "").trim();
}

/**
 * Generic lifecycle infrastructure for persistent-area automations.
 *
 * The Item owns the rules and supplies exact document UUIDs/configuration.
 * AE5E only provides reusable document lifecycle mechanics:
 * - clone an exact source-Item ActiveEffect template onto a target Actor
 * - stamp deterministic owner/effect metadata
 * - optionally propagate generic ongoing-action and movement-restriction config
 * - remove all effects owned by a Region/document, including synthetic Token Actors
 * - bind an arbitrary dependent document to concentration through Midi-QOL
 */
export class PersistentAreaLifecycleService {
  #socket;
  #authority;
  #initialized = false;
  #hooks = [];
  #stats = {
    applyRequests: 0,
    effectsCreated: 0,
    effectsReused: 0,
    removeRequests: 0,
    effectsRemoved: 0,
    concentrationRequests: 0,
    concentrationBindings: 0,
    concentrationMisses: 0,
    regionCleanupEvents: 0,
    routedToGm: 0,
    errors: 0
  };

  constructor({ socket, authority }) {
    this.#socket = socket;
    this.#authority = authority;
    socket.register("persistentAreaLifecycle.applyEffect", payload => this.#applyEffectAsAuthority(payload));
    socket.register("persistentAreaLifecycle.removeEffects", payload => this.#removeEffectsAsAuthority(payload));
    socket.register("persistentAreaLifecycle.bindConcentration", payload => this.#bindConcentrationAsAuthority(payload));
  }

  initialize() {
    if (this.#initialized) return this.getStats();
    this.#initialized = true;
    if (globalThis.Hooks?.on) {
      this.#hooks.push(["deleteRegion", Hooks.on("deleteRegion", region => {
        if (!this.#isPrimary()) return;
        const ownerUuid = region?.uuid ?? null;
        if (!ownerUuid) return;
        this.#stats.regionCleanupEvents += 1;
        void this.#removeEffectsAsAuthority({ ownerUuid }).catch(error => {
          this.#stats.errors += 1;
          Logger.warn("Persistent-area effect cleanup failed after Region deletion.", error);
        });
      })]);
    }
    return this.getStats();
  }

  getStats() {
    return Object.freeze({ ...this.#stats, initialized: this.#initialized });
  }

  getEffectOwnership(effect) {
    const value = getProperty(effect, `flags.${MODULE_ID}.${PERSISTENT_AREA_EFFECT_FLAG}`) ?? null;
    return value ? clone(value) : null;
  }

  async applyEffectTemplate(options = {}) {
    this.#stats.applyRequests += 1;
    const payload = this.#normalizeApplyRequest(options);
    if (!payload.valid) return { created: false, reason: payload.reason };
    return this.#executeAsAuthority(
      "persistentAreaLifecycle.applyEffect",
      payload.request,
      () => this.#applyEffectAsAuthority(payload.request)
    );
  }

  async hasOwnedEffect(options = {}) {
    const ownerUuid = normalizeString(options.ownerUuid);
    const effectKey = normalizeString(options.effectKey) || null;
    if (!ownerUuid) return { found: false, reason: "missing-owner-uuid", effects: [] };
    const actor = await this.#resolveActor({
      targetTokenUuid: normalizeString(options.targetTokenUuid) || null,
      targetActorUuid: normalizeString(options.targetActorUuid) || null
    });
    if (!actor) return { found: false, reason: "target-actor-unavailable", effects: [] };
    const effects = this.#findOwnedEffects(actor, ownerUuid, effectKey);
    return { found: effects.length > 0, effects };
  }

  async removeOwnedEffects(options = {}) {
    this.#stats.removeRequests += 1;
    const ownerUuid = normalizeString(options.ownerUuid);
    if (!ownerUuid) return { removed: false, reason: "missing-owner-uuid", removedCount: 0 };
    const payload = {
      ownerUuid,
      effectKey: normalizeString(options.effectKey) || null,
      targetTokenUuid: normalizeString(options.targetTokenUuid) || null,
      targetActorUuid: normalizeString(options.targetActorUuid) || null
    };
    return this.#executeAsAuthority(
      "persistentAreaLifecycle.removeEffects",
      payload,
      () => this.#removeEffectsAsAuthority(payload)
    );
  }

  async bindConcentrationDependent(options = {}) {
    this.#stats.concentrationRequests += 1;
    const payload = {
      dependentUuid: normalizeString(options.dependentUuid),
      casterActorUuid: normalizeString(options.casterActorUuid),
      sourceItemUuid: normalizeString(options.sourceItemUuid)
    };
    if (!payload.dependentUuid) return { bound: false, reason: "missing-dependent-uuid" };
    if (!payload.casterActorUuid) return { bound: false, reason: "missing-caster-actor" };
    if (!payload.sourceItemUuid) return { bound: false, reason: "missing-source-item" };
    return this.#executeAsAuthority(
      "persistentAreaLifecycle.bindConcentration",
      payload,
      () => this.#bindConcentrationAsAuthority(payload)
    );
  }

  #normalizeApplyRequest(options) {
    const request = {
      targetTokenUuid: normalizeString(options.targetTokenUuid) || null,
      targetActorUuid: normalizeString(options.targetActorUuid) || null,
      templateEffectUuid: normalizeString(options.templateEffectUuid),
      ownerUuid: normalizeString(options.ownerUuid),
      ownerInstanceId: normalizeString(options.ownerInstanceId) || null,
      effectKey: normalizeString(options.effectKey) || "default",
      originUuid: normalizeString(options.originUuid) || null,
      metadata: options.metadata && typeof options.metadata === "object" ? clone(options.metadata) : null,
      omitFields: asArray(options.omitFields).map(normalizeString).filter(Boolean),
      effectPatch: options.effectPatch && typeof options.effectPatch === "object" ? clone(options.effectPatch) : null,
      ongoingAction: options.ongoingAction && typeof options.ongoingAction === "object" ? clone(options.ongoingAction) : null,
      voluntaryMovementRestriction: options.voluntaryMovementRestriction && typeof options.voluntaryMovementRestriction === "object"
        ? clone(options.voluntaryMovementRestriction)
        : null
    };
    if (!request.targetTokenUuid && !request.targetActorUuid) return { valid: false, reason: "missing-target" };
    if (!request.templateEffectUuid) return { valid: false, reason: "missing-template-effect" };
    if (!request.ownerUuid) return { valid: false, reason: "missing-owner-uuid" };
    return { valid: true, request };
  }

  async #applyEffectAsAuthority(payload) {
    this.#assertAuthority();
    const actor = await this.#resolveActor(payload);
    if (!actor?.createEmbeddedDocuments) return { created: false, reason: "target-actor-unavailable" };

    const existing = this.#findOwnedEffects(actor, payload.ownerUuid, payload.effectKey)[0] ?? null;
    if (existing) {
      this.#stats.effectsReused += 1;
      return { created: false, reason: "already-applied", effectUuid: existing.uuid, effect: existing };
    }

    let template = null;
    try { template = await globalThis.fromUuid?.(payload.templateEffectUuid); } catch { template = null; }
    if (!template || template.documentName !== "ActiveEffect") return { created: false, reason: "template-effect-unavailable" };
    if (template.parent?.documentName !== "Item") return { created: false, reason: "template-effect-must-belong-to-item" };
    if (template.transfer === true) return { created: false, reason: "template-effect-must-not-transfer" };

    const data = template.toObject?.(false) ?? clone(template);
    delete data._id;
    data.disabled = false;
    data.transfer = false;

    for (const path of payload.omitFields ?? []) unsetProperty(data, path);
    if (payload.effectPatch) mergeInto(data, payload.effectPatch);

    const sourceItemUuid = template.parent?.documentName === "Item" ? template.parent.uuid : null;
    data.origin = payload.originUuid ?? sourceItemUuid ?? data.origin ?? null;
    setProperty(data, `flags.${MODULE_ID}.${PERSISTENT_AREA_EFFECT_FLAG}`, {
      schemaVersion: PERSISTENT_AREA_LIFECYCLE_SCHEMA_VERSION,
      ownerUuid: payload.ownerUuid,
      ownerInstanceId: payload.ownerInstanceId ?? null,
      effectKey: payload.effectKey,
      templateEffectUuid: template.uuid,
      sourceItemUuid,
      appliedAt: nowIso(),
      metadata: payload.metadata ?? null
    });

    if (payload.ongoingAction) {
      setProperty(data, `flags.${MODULE_ID}.${ONGOING_ACTION_EFFECT_FLAG}`, clone(payload.ongoingAction));
    }
    if (payload.voluntaryMovementRestriction) {
      setProperty(data, `flags.${MODULE_ID}.movement.voluntaryRestriction`, clone(payload.voluntaryMovementRestriction));
    }

    const [created] = await actor.createEmbeddedDocuments("ActiveEffect", [data], { ae5ePersistentAreaEffect: true });
    if (!created) return { created: false, reason: "creation-prevented" };
    this.#stats.effectsCreated += 1;
    return { created: true, effectUuid: created.uuid, effect: created };
  }

  async #removeEffectsAsAuthority(payload) {
    this.#assertAuthority();
    const actors = await this.#resolveActorsForCleanup(payload);
    let removed = 0;
    const effectUuids = [];
    for (const actor of actors) {
      if (!actor?.deleteEmbeddedDocuments) continue;
      const effects = this.#findOwnedEffects(actor, payload.ownerUuid, payload.effectKey ?? null);
      const ids = effects.map(effect => effect.id).filter(Boolean);
      if (!ids.length) continue;
      effectUuids.push(...effects.map(effect => effect.uuid).filter(Boolean));
      await actor.deleteEmbeddedDocuments("ActiveEffect", ids, { ae5ePersistentAreaCleanup: true });
      removed += ids.length;
    }
    this.#stats.effectsRemoved += removed;
    return { removed: removed > 0, removedCount: removed, effectUuids };
  }

  async #bindConcentrationAsAuthority(payload) {
    this.#assertAuthority();
    let dependent = null;
    let actor = null;
    let item = null;
    try { dependent = await globalThis.fromUuid?.(payload.dependentUuid); } catch { dependent = null; }
    try { actor = await globalThis.fromUuid?.(payload.casterActorUuid); } catch { actor = null; }
    try { item = await globalThis.fromUuid?.(payload.sourceItemUuid); } catch { item = null; }
    if (!dependent) return this.#concentrationMiss("dependent-unavailable");
    if (!actor || actor.documentName !== "Actor") return this.#concentrationMiss("caster-actor-unavailable");
    if (!item || item.documentName !== "Item") return this.#concentrationMiss("source-item-unavailable");

    const addDependent = globalThis.MidiQOL?.addConcentrationDependent;
    if (typeof addDependent !== "function") return this.#concentrationMiss("midi-concentration-api-unavailable");

    try {
      const result = await addDependent(actor, dependent, item);
      let live = dependent;
      try { live = await globalThis.fromUuid?.(dependent.uuid) ?? dependent; } catch { /* use current document */ }
      const dependentOn = live?.getFlag?.("dnd5e", "dependentOn")
        ?? getProperty(live, "flags.dnd5e.dependentOn")
        ?? null;
      if (!dependentOn) return this.#concentrationMiss("concentration-effect-not-found", result);
      this.#stats.concentrationBindings += 1;
      return { bound: true, dependentOn, result: result ?? null };
    } catch (error) {
      this.#stats.errors += 1;
      Logger.warn("Persistent-area concentration dependency binding failed.", error);
      return { bound: false, reason: "concentration-binding-failed", error: error?.message ?? String(error) };
    }
  }

  #concentrationMiss(reason, result = null) {
    this.#stats.concentrationMisses += 1;
    return { bound: false, reason, result };
  }

  async #resolveActor(payload) {
    let actor = null;
    if (payload.targetTokenUuid) {
      let token = null;
      try { token = await globalThis.fromUuid?.(payload.targetTokenUuid); } catch { token = null; }
      actor = token?.actor ?? token?.object?.actor ?? null;
    }
    if (!actor && payload.targetActorUuid) {
      try { actor = await globalThis.fromUuid?.(payload.targetActorUuid); } catch { actor = null; }
    }
    return actor;
  }

  async #resolveActorsForCleanup(payload) {
    const one = await this.#resolveActor(payload);
    if (one) return [one];

    const actors = new Map();
    const addActor = actor => {
      if (!actor?.deleteEmbeddedDocuments) return;
      const key = actor.uuid ?? actor.id ?? null;
      if (key && !actors.has(key)) actors.set(key, actor);
    };
    for (const actor of asArray(globalThis.game?.actors)) addActor(actor);
    for (const scene of asArray(globalThis.game?.scenes)) {
      for (const token of asArray(scene?.tokens)) addActor(token?.actor ?? token?.object?.actor ?? null);
    }
    return [...actors.values()];
  }

  #findOwnedEffects(actor, ownerUuid, effectKey = null) {
    return asArray(actor?.effects).filter(effect => {
      const ownership = this.getEffectOwnership(effect);
      if (!ownership || ownership.ownerUuid !== ownerUuid) return false;
      return !effectKey || ownership.effectKey === effectKey;
    });
  }

  async #executeAsAuthority(socketName, payload, localHandler) {
    const primary = this.#authority?.getPrimaryGm?.() ?? null;
    const fallback = [...(globalThis.game?.users ?? [])].find(user => user?.active && user?.isGM) ?? null;
    const authority = primary ?? fallback;
    if (!authority) return { created: false, removed: false, bound: false, reason: "no-active-gm" };
    if (globalThis.game?.user?.id === authority.id) return localHandler();
    this.#stats.routedToGm += 1;
    return this.#socket.executeAsUser(socketName, authority.id, payload);
  }

  #assertAuthority() {
    if (!globalThis.game?.user?.isGM) throw new Error("AE5E persistent-area lifecycle operation must execute on a GM client.");
    const primary = this.#authority?.getPrimaryGm?.() ?? null;
    if (primary && globalThis.game?.user?.id !== primary.id) {
      throw new Error("AE5E persistent-area lifecycle operation reached a non-primary GM client.");
    }
  }

  #isPrimary() {
    const primary = this.#authority?.getPrimaryGm?.() ?? null;
    if (primary) return Boolean(globalThis.game?.user?.isGM && globalThis.game.user.id === primary.id);
    return Boolean(globalThis.game?.user?.isGM);
  }
}
