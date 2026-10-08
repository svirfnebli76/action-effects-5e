import {
  SNEAK_ATTACK_DECLARATION_KEY
} from "../core/constants.js";

function asArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return [...value];
  if (typeof value.values === "function") {
    try { return [...value.values()]; } catch { /* fall through */ }
  }
  if (typeof value[Symbol.iterator] === "function") {
    try { return [...value]; } catch { /* fall through */ }
  }
  return [value];
}

function effectApplicable(effect) {
  if (!effect) return false;
  if (effect.disabled === true) return false;
  if (effect.isSuppressed === true) return false;
  if (effect.active === false) return false;
  return true;
}

function snapshotEffect(effect) {
  return {
    id: effect?.id ?? effect?._id ?? null,
    uuid: effect?.uuid ?? null,
    name: effect?.name ?? null,
    origin: effect?.origin ?? null,
    disabled: effect?.disabled ?? null,
    isSuppressed: effect?.isSuppressed ?? null,
    active: effect?.active ?? null
  };
}

function defaultDaeAccessor() {
  const candidates = [
    globalThis.DAE,
    globalThis.dae,
    globalThis.game?.modules?.get?.("dae")?.api
  ].filter(Boolean);
  if (!candidates.length) return null;

  const addOwner = candidates.find(candidate => typeof candidate?.addAutoFields === "function") ?? null;
  const resolverOwner = candidates.find(candidate => typeof candidate?.resolveItemFromEffect === "function") ?? null;
  return {
    addAutoFields: addOwner?.addAutoFields?.bind(addOwner),
    resolveItemFromEffect: resolverOwner?.resolveItemFromEffect?.bind(resolverOwner)
  };
}

/**
 * DAE/Foundry-facing transport for Sneak Attack declarations.
 *
 * Declarations are inert data: this service registers the editor-facing field
 * using Foundry v14's built-in Custom change type, scans individual Active Effect
 * changes, and delegates origin-chain resolution to DAE. It never mutates
 * Actor data. The declaration key determines the
 * Sneak Attack consumer.
 */
export class SneakAttackDaeDeclarationService {
  #daeAccessor;
  #moduleAccessor;
  #initialized = false;
  #status = {
    daeAutoFieldRegistered: false,
    daeAutoFieldAvailable: false,
    daeResolverAvailable: false,
    lastError: null
  };
  #stats = {
    initializeCalls: 0,
    scans: 0,
    effectsInspected: 0,
    effectsSkipped: 0,
    changesInspected: 0,
    declarationsFound: 0,
    originResolutionCalls: 0,
    originResolutionErrors: 0
  };

  constructor({
    daeAccessor = defaultDaeAccessor,
    moduleAccessor = () => globalThis.game?.modules?.get?.("dae") ?? null
  } = {}) {
    this.#daeAccessor = daeAccessor;
    this.#moduleAccessor = moduleAccessor;
  }

  initialize() {
    this.#stats.initializeCalls += 1;
    this.#initialized = true;

    try {
      const dae = this.#daeAccessor?.();
      const addAutoFields = dae?.addAutoFields;
      this.#status.daeAutoFieldAvailable = typeof addAutoFields === "function";
      this.#status.daeResolverAvailable = typeof dae?.resolveItemFromEffect === "function";
      if (!this.#status.daeAutoFieldRegistered && typeof addAutoFields === "function") {
        addAutoFields.call(dae, [SNEAK_ATTACK_DECLARATION_KEY]);
        this.#status.daeAutoFieldRegistered = true;
      }
      this.#status.lastError = null;
    } catch (error) {
      this.#status.lastError = { name: error?.name ?? "Error", message: error?.message ?? String(error) };
    }

    return this.getStatus();
  }

  getStatus() {
    const module = this.#moduleAccessor?.() ?? null;
    const dae = this.#daeAccessor?.() ?? null;
    return Object.freeze({
      initialized: this.#initialized,
      installed: Boolean(module),
      active: Boolean(module?.active),
      version: module?.version ?? null,
      declarationKey: SNEAK_ATTACK_DECLARATION_KEY,
      changeType: "custom",
      daeAutoFieldRegistered: this.#status.daeAutoFieldRegistered,
      daeAutoFieldAvailable: typeof dae?.addAutoFields === "function" || this.#status.daeAutoFieldAvailable,
      daeResolverAvailable: typeof dae?.resolveItemFromEffect === "function" || this.#status.daeResolverAvailable,
      lastError: this.#status.lastError
    });
  }

  getStats() {
    return Object.freeze({ ...this.#stats, status: this.getStatus() });
  }

  scanActor(actor) {
    this.#stats.scans += 1;
    const records = [];
    for (const effect of asArray(actor?.appliedEffects)) {
      this.#stats.effectsInspected += 1;
      if (!effectApplicable(effect)) {
        this.#stats.effectsSkipped += 1;
        continue;
      }

      const changes = asArray(effect?.system?.changes);
      changes.forEach((change, changeIndex) => {
        this.#stats.changesInspected += 1;
        if (change?.key !== SNEAK_ATTACK_DECLARATION_KEY) return;
        if (change?.type !== "custom") return;
        this.#stats.declarationsFound += 1;
        records.push({
          actor,
          effect,
          change,
          changeIndex,
          value: String(change?.value ?? ""),
          snapshot: {
            actor: {
              id: actor?.id ?? actor?._id ?? null,
              uuid: actor?.uuid ?? null,
              name: actor?.name ?? null
            },
            effect: snapshotEffect(effect),
            change: {
              key: change?.key ?? null,
              type: change?.type ?? null,
              phase: change?.phase ?? null,
              priority: change?.priority ?? null,
              value: String(change?.value ?? "")
            }
          }
        });
      });
    }
    return records;
  }

  async resolveSourceItem(effect, actor) {
    this.#stats.originResolutionCalls += 1;
    const dae = this.#daeAccessor?.() ?? null;
    const resolver = dae?.resolveItemFromEffect;
    if (typeof resolver !== "function") {
      return {
        resolved: false,
        item: null,
        reason: "dae-origin-resolver-unavailable"
      };
    }

    try {
      const item = await resolver.call(dae, effect, actor);
      if (!item || item.documentName !== "Item") {
        return {
          resolved: false,
          item: null,
          reason: "source-item-unavailable"
        };
      }
      return { resolved: true, item, reason: null };
    } catch (error) {
      this.#stats.originResolutionErrors += 1;
      return {
        resolved: false,
        item: null,
        reason: "dae-origin-resolution-error",
        error
      };
    }
  }
}
