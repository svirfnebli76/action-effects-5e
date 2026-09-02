import {
  MODULE_ID,
  ONGOING_ACTION_EFFECT_FLAG,
  ONGOING_ACTION_ITEM_FLAG,
  ONGOING_ACTION_TIMINGS,
  ONGOING_ACTION_PROMPT_TIMEOUT_MS,
  SELECTION_INDICATOR_ROLES
} from "../core/constants.js";
import { Logger } from "../core/logger.js";

function duplicate(value) {
  if (globalThis.foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
  if (globalThis.structuredClone) return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
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

function asArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return [...value];
  if (typeof value.values === "function") return [...value.values()];
  return [];
}

export class OngoingEffectService {
  #socket;
  #authority;
  #catSpell;
  #selectionIndicator;
  #initialized = false;
  #hooks = [];
  #combatState = new Map();
  #claims = new Set();
  #workflowResultPromises = new Map();
  #stats = {
    effectsObserved: 0,
    grantsCreated: 0,
    grantsRemoved: 0,
    grantsReconciled: 0,
    prompts: 0,
    promptsSuppressedUnusable: 0,
    promptTimeouts: 0,
    optionalDeclines: 0,
    executions: 0,
    successes: 0,
    failures: 0,
    resultsRoutedToAuthority: 0,
    authorityResultsResolved: 0,
    duplicateWorkflowResults: 0,
    combatTransitions: 0,
    combatEndCards: 0,
    errors: 0,
    lastEvent: null
  };

  constructor({ socket, authority, catSpell, selectionIndicator }) {
    this.#socket = socket;
    this.#authority = authority;
    this.#catSpell = catSpell;
    this.#selectionIndicator = selectionIndicator;

    socket.register("ongoingEffects.createGrant", (effectUuid) => this.ensureGrant(effectUuid));
    socket.register("ongoingEffects.removeGrant", (effectUuid, grantedItemUuid = null) => this.removeGrant(effectUuid, grantedItemUuid));
    socket.register("ongoingEffects.prompt", (payload) => this.#showPrompt(payload));
    socket.register("ongoingEffects.execute", async (itemUuid, effectUuid, claimKey = null) => {
      const result = await this.executeGrantedItem(itemUuid, effectUuid, { claimKey });
      return this.#serializeExecutionResult(result);
    });
    socket.register("ongoingEffects.resolveResult", (payload) => this.resolveWorkflowResultPayload(payload));
  }

  initialize() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#hooks.push(["createActiveEffect", Hooks.on("createActiveEffect", (effect) => this.#onEffectCreated(effect))]);
    this.#hooks.push(["deleteActiveEffect", Hooks.on("deleteActiveEffect", (effect) => this.#onEffectDeleted(effect))]);
    this.#hooks.push(["updateCombat", Hooks.on("updateCombat", (combat) => this.#onCombatUpdated(combat))]);
    this.#hooks.push(["combatStart", Hooks.on("combatStart", (combat) => this.#onCombatStarted(combat))]);
    this.#hooks.push(["deleteCombat", Hooks.on("deleteCombat", (combat) => this.#onCombatDeleted(combat))]);
    this.#hooks.push(["midi-qol.RollComplete", Hooks.on("midi-qol.RollComplete", (workflow) => this.processWorkflowResult(workflow))]);
    this.#hooks.push(["midi-qol.premades.postRollFinished", Hooks.on("midi-qol.premades.postRollFinished", (workflow) => this.processWorkflowResult(workflow))]);

    for (const combat of game?.combats ?? []) this.#combatState.set(combat.id, this.#snapshotCombat(combat));
  }

  shutdown() {
    for (const [hook, id] of this.#hooks) {
      try { Hooks.off(hook, id); } catch { /* noop */ }
    }
    this.#hooks.length = 0;
    this.#combatState.clear();
    this.#workflowResultPromises.clear();
    this.#initialized = false;
  }

  getStats() {
    return { initialized: this.#initialized, hooks: this.#hooks.map(([hook]) => hook), ...this.#stats };
  }

  getEffectConfig(effect) {
    const config = effect?.getFlag?.(MODULE_ID, ONGOING_ACTION_EFFECT_FLAG)
      ?? getProperty(effect, `flags.${MODULE_ID}.${ONGOING_ACTION_EFFECT_FLAG}`)
      ?? null;
    if (!config || config.enabled === false) return null;
    return duplicate(config);
  }

  getGrantConfig(item) {
    const config = item?.getFlag?.(MODULE_ID, ONGOING_ACTION_ITEM_FLAG)
      ?? getProperty(item, `flags.${MODULE_ID}.${ONGOING_ACTION_ITEM_FLAG}`)
      ?? null;
    return config ? duplicate(config) : null;
  }

  validateConfig(config) {
    if (!config || typeof config !== "object") return { valid: false, reason: "missing-config" };
    const templateValid = typeof config.templateUuid === "string" && config.templateUuid.startsWith("Compendium.");
    const sourceActivity = config.sourceActivity;
    const sourceActivityValid = Boolean(
      sourceActivity
      && typeof sourceActivity === "object"
      && typeof sourceActivity.activityReference === "string"
      && sourceActivity.activityReference.trim().length
    );
    if (!templateValid && !sourceActivityValid) return { valid: false, reason: "missing-grant-source" };
    if (sourceActivity !== undefined && !sourceActivityValid) return { valid: false, reason: "invalid-source-activity" };
    if (sourceActivity?.activityPatch !== undefined && (!sourceActivity.activityPatch || typeof sourceActivity.activityPatch !== "object" || Array.isArray(sourceActivity.activityPatch))) {
      return { valid: false, reason: "invalid-source-activity-patch" };
    }
    const timing = config.timing ?? null;
    if (timing !== null && !Object.values(ONGOING_ACTION_TIMINGS).includes(timing)) {
      return { valid: false, reason: "invalid-timing" };
    }
    const indicatorRole = config.indicatorRole ?? SELECTION_INDICATOR_ROLES.ORIGINATOR;
    if (!Object.values(SELECTION_INDICATOR_ROLES).includes(indicatorRole)) {
      return { valid: false, reason: "invalid-indicator-role" };
    }
    if (config.suppressPromptWhenUnusable !== undefined && typeof config.suppressPromptWhenUnusable !== "boolean") {
      return { valid: false, reason: "invalid-suppress-prompt-when-unusable" };
    }
    return { valid: true };
  }

  async ensureGrant(effectOrUuid) {
    const effect = typeof effectOrUuid === "string" ? await fromUuid(effectOrUuid) : effectOrUuid;
    if (!effect) return { created: false, reason: "effect-unavailable" };
    const config = this.getEffectConfig(effect);
    const validation = this.validateConfig(config);
    if (!validation.valid) return { created: false, reason: validation.reason };
    const actor = effect.parent;
    if (!actor?.createEmbeddedDocuments) return { created: false, reason: "actor-unavailable" };

    const existingUuid = config.grantedItemUuid ?? null;
    if (existingUuid) {
      let existing = null;
      try { existing = await fromUuid(existingUuid); } catch { /* recreate below */ }
      if (existing?.parent?.uuid === actor.uuid) return { created: false, reason: "already-granted", item: existing };
    }

    const source = await this.#buildGrantItemData(effect, config);
    if (!source?.itemData) return { created: false, reason: source?.reason ?? "grant-source-unavailable" };
    const itemData = source.itemData;
    const savedCastData = this.#getSavedCastData(effect);
    setProperty(itemData, `flags.${MODULE_ID}.${ONGOING_ACTION_ITEM_FLAG}`, {
      sourceEffectUuid: effect.uuid,
      templateUuid: source.templateUuid ?? null,
      sourceItemUuid: source.sourceItemUuid ?? null,
      sourceActivity: source.sourceActivity ?? null,
      activityIdentifier: source.activityIdentifier ?? config.activityIdentifier ?? null,
      removeEffectOnSuccess: config.removeEffectOnSuccess !== false,
      savedCastData: savedCastData ?? null
    });

    const [created] = await actor.createEmbeddedDocuments("Item", [itemData], { ae5eOngoingGrant: true });
    if (!created) throw new Error(`AE5E failed to create granted Item for '${effect.name ?? effect.uuid}'.`);

    const nextConfig = { ...config, grantedItemUuid: created.uuid };
    await effect.update({ [`flags.${MODULE_ID}.${ONGOING_ACTION_EFFECT_FLAG}`]: nextConfig }, { ae5eOngoingGrantLink: true });
    this.#stats.grantsCreated += 1;
    this.#record("grant-created", {
      effectUuid: effect.uuid,
      itemUuid: created.uuid,
      templateUuid: source.templateUuid ?? null,
      sourceItemUuid: source.sourceItemUuid ?? null,
      sourceActivity: source.sourceActivity ?? null
    });
    return { created: true, effect, item: created };
  }

  async removeGrant(effectOrUuid, grantedItemUuid = null) {
    const effect = typeof effectOrUuid === "string" ? await fromUuid(effectOrUuid) : effectOrUuid;
    const config = effect ? this.getEffectConfig(effect) : null;
    const itemUuid = grantedItemUuid ?? config?.grantedItemUuid ?? null;
    if (!itemUuid) return { removed: false, reason: "no-grant" };
    let item = null;
    try { item = await fromUuid(itemUuid); } catch { /* already absent */ }
    if (!item?.parent?.deleteEmbeddedDocuments) return { removed: false, reason: "already-absent", itemUuid };
    if (!item.parent.items?.get?.(item.id)) return { removed: false, reason: "already-absent", itemUuid };
    try {
      await item.parent.deleteEmbeddedDocuments("Item", [item.id], { ae5eOngoingGrantCleanup: true });
    } catch (error) {
      // Document deletion is socketed; a concurrent cleanup may win the race after
      // the existence check. Treat a now-missing child as a successful no-op.
      if (!item.parent.items?.get?.(item.id)) return { removed: false, reason: "already-absent", itemUuid };
      throw error;
    }
    this.#stats.grantsRemoved += 1;
    this.#record("grant-removed", { effectUuid: effect?.uuid ?? null, itemUuid });
    return { removed: true, itemUuid };
  }

  async reconcileActor(actor) {
    if (!actor) return { repaired: 0, removed: 0 };
    let repaired = 0;
    let removed = 0;
    for (const effect of actor.effects ?? []) {
      const config = this.getEffectConfig(effect);
      if (!config) continue;
      const item = config.grantedItemUuid ? await fromUuid(config.grantedItemUuid) : null;
      if (!item) {
        const result = await this.ensureGrant(effect);
        if (result.created) repaired += 1;
      }
    }
    for (const item of actor.items ?? []) {
      const grant = this.getGrantConfig(item);
      if (!grant?.sourceEffectUuid) continue;
      const effect = await fromUuid(grant.sourceEffectUuid);
      if (!effect) {
        await actor.deleteEmbeddedDocuments("Item", [item.id], { ae5eOngoingGrantReconcile: true });
        removed += 1;
      }
    }
    this.#stats.grantsReconciled += repaired + removed;
    return { repaired, removed };
  }

  async processTiming(actor, timing, { combat = null } = {}) {
    if (!actor || !Object.values(ONGOING_ACTION_TIMINGS).includes(timing)) return [];
    if (!this.#isAuthority()) return [];
    const results = [];
    for (const effect of actor.effects ?? []) {
      const config = this.getEffectConfig(effect);
      if (!config || config.timing !== timing) continue;
      try {
        const grant = await this.ensureGrant(effect);
        const item = grant.item ?? (config.grantedItemUuid ? await fromUuid(config.grantedItemUuid) : null);
        if (!item) continue;
        const promptResult = await this.promptForEffect(effect, item, { combat });
        results.push(promptResult);
      } catch (error) {
        this.#stats.errors += 1;
        Logger.warn("Ongoing effect timing failed open.", error);
      }
    }
    return results;
  }

  async promptForEffect(effect, item, { combat = null } = {}) {
    const config = this.getEffectConfig(effect);
    if (!config) return { prompted: false, reason: "no-config" };
    const actor = effect.parent;
    if (config.suppressPromptWhenUnusable === true) {
      const usability = this.getActivityUsability(item, config.activityIdentifier ?? null);
      if (!usability.usable) {
        this.#stats.promptsSuppressedUnusable += 1;
        this.#record("prompt-suppressed-unusable", {
          effectUuid: effect.uuid,
          itemUuid: item?.uuid ?? null,
          usability
        });
        return { prompted: false, suppressed: true, reason: "activity-unusable", usability };
      }
    }
    const userId = this.#controllerUserId(actor);
    const claimKey = `${combat?.id ?? "manual"}:${combat?.round ?? 0}:${combat?.turn ?? -1}:${effect.uuid}:${config.timing ?? "optional"}`;
    const mandatory = config.mandatory === true;
    const payload = {
      effectUuid: effect.uuid,
      itemUuid: item.uuid,
      actorUuid: actor?.uuid ?? null,
      actorName: actor?.name ?? "Affected creature",
      effectName: effect.name ?? "Ongoing Effect",
      itemName: item.name ?? "Resolve Effect",
      mandatory,
      timeoutMs: mandatory ? Number(config.timeoutMs ?? ONGOING_ACTION_PROMPT_TIMEOUT_MS) : 0,
      claimKey,
      promptText: config.promptText ?? null,
      indicatorRole: config.indicatorRole ?? SELECTION_INDICATOR_ROLES.ORIGINATOR
    };
    this.#stats.prompts += 1;
    this.#record("prompt", { ...payload, userId });
    return this.#socket.executeAsUser("ongoingEffects.prompt", userId, payload);
  }

  getActivityUsability(item, identifier = null) {
    const activity = this.#resolveActivity(item, identifier);
    if (!activity) return { usable: false, reason: "activity-unavailable", activity: null };
    if (activity.canUse === false) {
      return { usable: false, reason: "activity-can-use-false", activityUuid: activity.uuid ?? activity.id ?? null };
    }

    const actor = item?.actor ?? item?.parent ?? activity?.actor ?? null;
    const activationType = activity?.activation?.type ?? null;
    const activationValue = Math.max(1, Number(activity?.activation?.value ?? 1) || 1);
    const activationConfig = globalThis.CONFIG?.DND5E?.activityActivationTypes?.[activationType] ?? null;

    // D&D5e 5.3.x does not model an ordinary Action as a consumable actor
    // resource.  It does, however, expose the canonical Standard activation
    // category and the actor's Incapacitated status.  Use those system
    // semantics to suppress action-economy prompts when the actor cannot take
    // actions at all, without maintaining an AE5E list of conditions such as
    // Stunned/Paralyzed/Unconscious.  Systems/modules which apply those
    // conditions as riders to Incapacitated are handled automatically.
    const standardGroup = "DND5E.ACTIVATION.Category.Standard";
    const isStandardActivation = activationConfig?.group === standardGroup;
    const actorStatuses = actor?.statuses;
    if (isStandardActivation && actorStatuses?.has?.("incapacitated")) {
      return {
        usable: false,
        reason: "actor-incapacitated",
        activityUuid: activity.uuid ?? activity.id ?? null,
        activationType
      };
    }

    // Some D&D5e activation types/versions expose a consumable actor resource.
    // Respect it when present, but never invent one when the system does not
    // expose it (notably ordinary Action in D&D5e 5.3.3).
    const property = activationConfig?.consume?.property ?? null;
    if (actor && property) {
      const resource = getProperty(actor.system, property);
      const available = Number(resource?.value);
      if (Number.isFinite(available) && available < activationValue) {
        return {
          usable: false,
          reason: "activation-resource-unavailable",
          activityUuid: activity.uuid ?? activity.id ?? null,
          activationType,
          required: activationValue,
          available,
          property
        };
      }
    }

    return {
      usable: true,
      reason: "usable",
      activityUuid: activity.uuid ?? activity.id ?? null,
      activationType,
      activationResource: property ?? null
    };
  }

  async executeGrantedItem(itemOrUuid, effectOrUuid = null, { claimKey = null } = {}) {
    if (claimKey && this.#claims.has(claimKey)) return { executed: false, reason: "already-claimed" };
    if (claimKey) this.#claims.add(claimKey);
    const item = typeof itemOrUuid === "string" ? await fromUuid(itemOrUuid) : itemOrUuid;
    if (!item) return { executed: false, reason: "item-unavailable" };
    const grant = this.getGrantConfig(item);
    const effectUuid = typeof effectOrUuid === "string" ? effectOrUuid : effectOrUuid?.uuid ?? grant?.sourceEffectUuid ?? null;
    if (effectUuid && grant?.sourceEffectUuid && effectUuid !== grant.sourceEffectUuid) {
      return { executed: false, reason: "effect-mismatch" };
    }

    const activity = this.#resolveActivity(item, grant?.activityIdentifier);
    this.#stats.executions += 1;
    this.#record("execute", { itemUuid: item.uuid, effectUuid, activityUuid: activity?.uuid ?? null });

    if (activity && this.#catSpell?.getStatus?.().active && this.#catSpell.getStatus().capabilities?.completeActivityUse) {
      const targets = this.#selfTargets(item.actor);
      const workflow = await this.#catSpell.completeActivityUse(activity, targets, {});
      return { executed: true, via: "cat", workflow };
    }
    if (typeof activity?.use === "function") {
      const workflow = await activity.use({});
      return { executed: true, via: "activity", workflow };
    }
    if (typeof item.use === "function") {
      const workflow = await item.use({});
      return { executed: true, via: "item", workflow };
    }
    return { executed: false, reason: "no-execution-method" };
  }

  async processWorkflowResult(workflow) {
    const item = workflow?.item ?? workflow?.activity?.item ?? null;
    const grant = this.getGrantConfig(item);
    if (!grant?.sourceEffectUuid) return { handled: false, reason: "not-a-granted-item" };
    const success = this.#workflowSucceeded(workflow, item?.actor ?? item?.parent);
    if (success === null) return { handled: false, reason: "outcome-undetermined" };

    const payload = this.#buildWorkflowResultPayload(workflow, item, grant, success);
    const resultKey = this.#workflowResultKey(payload);
    if (resultKey && this.#workflowResultPromises.has(resultKey)) {
      this.#stats.duplicateWorkflowResults += 1;
      return this.#workflowResultPromises.get(resultKey);
    }

    const task = this.#isAuthority()
      ? this.resolveWorkflowResultPayload(payload)
      : this.#routeWorkflowResultToAuthority(payload);

    if (resultKey) this.#rememberWorkflowResult(resultKey, task);
    return task;
  }

  async resolveWorkflowResultPayload(payload) {
    if (!this.#isAuthority()) return { handled: false, reason: "not-authority" };
    if (!payload || payload.schema !== "ae5e.ongoing-workflow-result" || payload.version !== 1) {
      return { handled: false, reason: "invalid-result-payload" };
    }
    if (typeof payload.success !== "boolean" || typeof payload.effectUuid !== "string" || typeof payload.itemUuid !== "string") {
      return { handled: false, reason: "invalid-result-payload" };
    }

    let effect = null;
    let item = null;
    try { effect = await fromUuid(payload.effectUuid); } catch { /* validation below */ }
    try { item = await fromUuid(payload.itemUuid); } catch { /* validation below */ }

    // Duplicate Midi completion hooks or a second observer can arrive after the
    // first successful resolution has already removed the parent effect and its
    // granted Item. Treat that as an idempotent successful no-op.
    if (!effect && payload.success === true) {
      return { handled: true, success: true, alreadyResolved: true, effectUuid: payload.effectUuid, itemUuid: payload.itemUuid };
    }
    if (!effect) return { handled: false, reason: "effect-unavailable" };
    if (!item) return { handled: false, reason: "item-unavailable" };

    const grant = this.getGrantConfig(item);
    const effectConfig = this.getEffectConfig(effect);
    if (!grant?.sourceEffectUuid || grant.sourceEffectUuid !== effect.uuid) {
      return { handled: false, reason: "grant-effect-mismatch" };
    }
    if (effectConfig?.grantedItemUuid && effectConfig.grantedItemUuid !== item.uuid) {
      return { handled: false, reason: "effect-grant-mismatch" };
    }
    const itemActorUuid = item?.actor?.uuid ?? item?.parent?.uuid ?? null;
    const effectActorUuid = effect?.parent?.uuid ?? null;
    if (itemActorUuid && effectActorUuid && itemActorUuid !== effectActorUuid) {
      return { handled: false, reason: "actor-mismatch" };
    }
    if (payload.actorUuid && effectActorUuid && payload.actorUuid !== effectActorUuid) {
      return { handled: false, reason: "actor-mismatch" };
    }

    this.#stats.authorityResultsResolved += 1;
    if (!payload.success) {
      this.#stats.failures += 1;
      this.#record("failure", {
        itemUuid: item.uuid,
        effectUuid: effect.uuid,
        workflowId: payload.workflowId ?? null,
        executionUserId: payload.executionUserId ?? null
      });
      return { handled: true, success: false, effectRemoved: false };
    }

    this.#stats.successes += 1;
    this.#record("success", {
      itemUuid: item.uuid,
      effectUuid: effect.uuid,
      workflowId: payload.workflowId ?? null,
      executionUserId: payload.executionUserId ?? null
    });

    let effectRemoved = false;
    if (grant.removeEffectOnSuccess !== false && effect?.parent?.deleteEmbeddedDocuments) {
      await effect.parent.deleteEmbeddedDocuments("ActiveEffect", [effect.id], {
        ae5eOngoingSuccess: true,
        ae5eOngoingWorkflowId: payload.workflowId ?? null
      });
      effectRemoved = true;
    }

    return { handled: true, success: true, effectRemoved };
  }

  async postCombatSummary(combat) {
    if (!this.#isAuthority()) return { posted: false, reason: "not-authority" };
    const entries = [];
    for (const combatant of combat?.combatants ?? []) {
      const actor = combatant.actor;
      if (!actor) continue;
      for (const effect of actor.effects ?? []) {
        const config = this.getEffectConfig(effect);
        if (!config) continue;
        const item = config.grantedItemUuid ? await fromUuid(config.grantedItemUuid) : null;
        entries.push({ actorName: actor.name, effectName: effect.name, itemName: item?.name ?? null, mandatory: config.mandatory === true });
      }
    }
    if (!entries.length) return { posted: false, reason: "no-unresolved-effects", entries };
    const rows = entries.map(entry => `<li><strong>${this.#escape(entry.actorName)}</strong> — <strong>${this.#escape(entry.effectName)}</strong>${entry.itemName ? `: ${this.#escape(entry.itemName)}` : ""}</li>`).join("");
    const content = `<section class="ae5e-ongoing-summary"><h3>Combat Ended — Unresolved Effects</h3><p>These effects remain active. Further saves or escape attempts are resolved at the GM's discretion outside combat.</p><ul>${rows}</ul></section>`;
    await ChatMessage.create({ content, speaker: { alias: "Action Effects 5E" } });
    this.#stats.combatEndCards += 1;
    this.#record("combat-summary", { combatId: combat?.id ?? null, count: entries.length });
    return { posted: true, entries };
  }

  async #onEffectCreated(effect) {
    const config = this.getEffectConfig(effect);
    if (!config) return;
    this.#stats.effectsObserved += 1;
    if (!this.#isAuthority()) return;
    try { await this.ensureGrant(effect); } catch (error) { this.#stats.errors += 1; Logger.warn("Failed to grant ongoing-effect Item.", error); }
  }

  async #onEffectDeleted(effect) {
    const config = this.getEffectConfig(effect);
    if (!config?.grantedItemUuid || !this.#isAuthority()) return;
    try { await this.removeGrant(effect, config.grantedItemUuid); } catch (error) { this.#stats.errors += 1; Logger.warn("Failed to clean up ongoing-effect Item.", error); }
  }

  async #onCombatStarted(combat) {
    this.#combatState.set(combat.id, this.#snapshotCombat(combat));
    const actor = combat?.combatant?.actor ?? null;
    if (actor) await this.processTiming(actor, ONGOING_ACTION_TIMINGS.TURN_START, { combat });
  }

  async #onCombatUpdated(combat) {
    const previous = this.#combatState.get(combat.id) ?? null;
    const current = this.#snapshotCombat(combat);
    this.#combatState.set(combat.id, current);
    if (!previous || (previous.combatantUuid === current.combatantUuid && previous.round === current.round && previous.turn === current.turn)) return;
    this.#stats.combatTransitions += 1;
    const previousCombatant = previous.combatantId ? combat.combatants.get(previous.combatantId) : null;
    if (previousCombatant?.actor) await this.processTiming(previousCombatant.actor, ONGOING_ACTION_TIMINGS.TURN_END, { combat });
    if (combat?.combatant?.actor) await this.processTiming(combat.combatant.actor, ONGOING_ACTION_TIMINGS.TURN_START, { combat });
  }

  async #onCombatDeleted(combat) {
    this.#combatState.delete(combat.id);
    try { await this.postCombatSummary(combat); } catch (error) { this.#stats.errors += 1; Logger.warn("Failed to post ongoing-effects combat summary.", error); }
  }

  async #showPrompt(payload) {
    const mandatory = payload?.mandatory === true;
    const timeoutMs = mandatory ? Math.max(0, Number(payload?.timeoutMs ?? ONGOING_ACTION_PROMPT_TIMEOUT_MS)) : 0;
    const itemUuid = payload?.itemUuid;
    const effectUuid = payload?.effectUuid;
    const claimKey = payload?.claimKey ?? null;
    const itemName = payload?.itemName ?? "Resolve Effect";
    const effectName = payload?.effectName ?? "Ongoing Effect";
    const promptText = payload?.promptText
      ?? (mandatory
        ? `You have <strong>${this.#escape(effectName)}</strong> and must resolve <strong>${this.#escape(itemName)}</strong>. Proceed now?`
        : `You still have <strong>${this.#escape(effectName)}</strong>. You may use <strong>${this.#escape(itemName)}</strong> this turn.`);

    // Socketlib return values must remain plain serializable data. A live Midi
    // Workflow contains document references, Sets, methods, and circular state;
    // never return it through the player -> GM prompt socket. Workflow outcome
    // authority is handled independently by processWorkflowResult().
    const execute = async () => this.#serializeExecutionResult(
      await this.executeGrantedItem(itemUuid, effectUuid, { claimKey })
    );
    const token = this.#tokenForActorUuid(payload?.actorUuid);
    let indicatorId = null;
    try {
      if (token) indicatorId = await this.#selectionIndicator?.acquire?.({
        token,
        role: payload?.indicatorRole ?? SELECTION_INDICATOR_ROLES.ORIGINATOR
      });
    } catch { /* visual enhancement only */ }

    try {
      const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
      if (!DialogV2?.wait) {
        if (mandatory) return execute();
        ui?.notifications?.info?.(`${effectName}: ${itemName}`);
        return { prompted: true, fallback: true };
      }

      let settled = false;
      let timerId = null;
      let app = null;
      const response = await new Promise(async resolve => {
        const finish = async value => {
          if (settled) return;
          settled = true;
          if (timerId) clearTimeout(timerId);
          resolve(value);
          try { await app?.close?.({ animate: false }); } catch { /* noop */ }
        };
        const buttons = mandatory
          ? [{ action: "proceed", label: itemName, default: true, callback: () => finish("proceed") }]
          : [
              { action: "proceed", label: itemName, default: true, callback: () => finish("proceed") },
              { action: "not-now", label: "Not Now", callback: () => finish("not-now") }
            ];
        app = new DialogV2({
          window: { title: effectName },
          content: `<div class="ae5e-ongoing-prompt">${promptText}${mandatory && timeoutMs ? `<p class="notes">Automatically proceeding in ${Math.ceil(timeoutMs / 1000)} seconds.</p>` : ""}</div>`,
          buttons,
          close: () => finish(mandatory ? "proceed" : "not-now")
        });
        await app.render({ force: true });
        if (mandatory && timeoutMs > 0) timerId = setTimeout(() => finish("timeout"), timeoutMs);
      });
      if (response === "timeout") {
        this.#stats.promptTimeouts += 1;
        return execute();
      }
      if (response === "proceed") return execute();
      this.#stats.optionalDeclines += 1;
      return { prompted: true, declined: true };
    } finally {
      if (indicatorId) {
        try { await this.#selectionIndicator?.release?.(indicatorId); } catch { /* noop */ }
      }
    }
  }


  async #routeWorkflowResultToAuthority(payload) {
    this.#stats.resultsRoutedToAuthority += 1;
    this.#record("result-routed-to-authority", {
      itemUuid: payload.itemUuid,
      effectUuid: payload.effectUuid,
      workflowId: payload.workflowId ?? null,
      success: payload.success
    });
    try {
      const authorityResult = await this.#socket.executeAsGM("ongoingEffects.resolveResult", payload);
      return {
        handled: authorityResult?.handled === true,
        success: payload.success,
        routed: true,
        authorityResult: authorityResult ?? null
      };
    } catch (error) {
      this.#stats.errors += 1;
      Logger.warn("Failed to route ongoing-effect workflow result to the primary GM.", error);
      return { handled: false, success: payload.success, routed: false, reason: "authority-route-failed" };
    }
  }

  #buildWorkflowResultPayload(workflow, item, grant, success) {
    const activity = workflow?.activity ?? null;
    const actor = item?.actor ?? item?.parent ?? activity?.actor ?? null;
    const firstRoll = this.#firstWorkflowRoll(workflow);
    const dc = Number(workflow?.saveDC ?? workflow?.dc ?? activity?.dc?.value ?? activity?.check?.dc ?? NaN);
    return {
      schema: "ae5e.ongoing-workflow-result",
      version: 1,
      success: Boolean(success),
      effectUuid: grant.sourceEffectUuid,
      itemUuid: item?.uuid ?? null,
      actorUuid: actor?.uuid ?? null,
      activityUuid: activity?.uuid ?? activity?.id ?? null,
      workflowId: workflow?.uuid ?? workflow?.id ?? null,
      executionUserId: game?.user?.id ?? null,
      rollTotal: Number.isFinite(Number(firstRoll?.total)) ? Number(firstRoll.total) : null,
      dc: Number.isFinite(dc) ? dc : null
    };
  }

  #serializeExecutionResult(result) {
    if (!result || typeof result !== "object") return { executed: false, reason: "empty-execution-result" };
    const workflow = result.workflow ?? null;
    return {
      executed: result.executed === true,
      via: result.via ?? null,
      reason: result.reason ?? null,
      workflowId: workflow?.uuid ?? workflow?.id ?? null,
      activityUuid: workflow?.activity?.uuid ?? workflow?.activity?.id ?? null,
      itemUuid: workflow?.item?.uuid ?? workflow?.activity?.item?.uuid ?? null
    };
  }

  #firstWorkflowRoll(workflow) {
    const candidates = [
      workflow?.utilityRolls,
      workflow?.checkRolls,
      workflow?.skillRolls,
      workflow?.abilityRolls,
      workflow?.saveRolls,
      workflow?.rolls
    ];
    for (const candidate of candidates) {
      const rolls = asArray(candidate);
      if (rolls.length) return rolls[0];
      if (Array.isArray(candidate) && candidate.length) return candidate[0];
    }
    return workflow?.roll ?? null;
  }

  #workflowResultKey(payload) {
    const workflowId = payload?.workflowId;
    if (!workflowId) return null;
    return `${payload.effectUuid ?? "effect"}:${payload.itemUuid ?? "item"}:${workflowId}`;
  }

  #rememberWorkflowResult(key, promise) {
    this.#workflowResultPromises.set(key, Promise.resolve(promise));
    while (this.#workflowResultPromises.size > 100) {
      const oldest = this.#workflowResultPromises.keys().next().value;
      this.#workflowResultPromises.delete(oldest);
    }
  }

  #resolveActivity(item, identifier = null) {
    if (identifier && this.#catSpell?.getStatus?.().active) {
      try {
        const activity = this.#catSpell.getActivityByIdentifier(item, identifier);
        if (activity) return activity;
      } catch { /* fallback below */ }
    }
    const activities = item?.system?.activities;
    if (!activities) return null;
    if (identifier && typeof activities.get === "function") {
      const direct = activities.get(identifier);
      if (direct) return direct;
    }
    const entries = asArray(activities).length
      ? asArray(activities)
      : (typeof activities.values === "function" ? [...activities.values()] : Object.values(activities ?? {}));
    if (identifier) {
      const normalized = String(identifier).trim().toLowerCase();
      const match = entries.find(activity => {
        const id = String(activity?.id ?? activity?._id ?? "").toLowerCase();
        const activityIdentifier = String(activity?.identifier ?? activity?.system?.identifier ?? "").toLowerCase();
        const name = String(activity?.name ?? "").trim().toLowerCase();
        return id === normalized || activityIdentifier === normalized || name === normalized;
      });
      if (match) return match;
    }
    return entries[0] ?? null;
  }

  async #buildGrantItemData(effect, config) {
    if (typeof config.templateUuid === "string" && config.templateUuid.startsWith("Compendium.")) {
      const template = await fromUuid(config.templateUuid);
      if (!template || template.documentName !== "Item") {
        throw new Error(`AE5E ongoing-action template '${config.templateUuid}' could not be resolved to an Item.`);
      }
      const itemData = template.toObject();
      delete itemData._id;
      return {
        itemData,
        templateUuid: config.templateUuid,
        sourceItemUuid: null,
        sourceActivity: null,
        activityIdentifier: config.activityIdentifier ?? null
      };
    }

    const sourceConfig = config.sourceActivity ?? {};
    let sourceItem = null;
    const explicitSourceUuid = String(sourceConfig.itemUuid ?? "").trim();
    const originUuid = String(effect?.origin ?? "").trim();
    for (const uuid of [explicitSourceUuid, originUuid]) {
      if (!uuid) continue;
      try { sourceItem = await fromUuid(uuid); } catch { sourceItem = null; }
      if (sourceItem?.documentName === "Item") break;
      sourceItem = null;
    }
    if (!sourceItem) return { itemData: null, reason: "source-item-unavailable" };

    const activity = this.#resolveActivity(sourceItem, sourceConfig.activityReference);
    if (!activity) return { itemData: null, reason: "source-activity-unavailable" };
    const activityData = duplicate(activity.toObject?.(false) ?? activity.toObject?.() ?? activity);
    delete activityData._id;
    const activityId = String(activity.id ?? activity._id ?? sourceConfig.activityReference).trim() || "ae5e-ongoing-action";
    activityData._id = activityId;
    for (const [path, value] of Object.entries(sourceConfig.activityPatch ?? {})) {
      setProperty(activityData, path, duplicate(value));
    }

    const sourceObject = sourceItem.toObject?.(false) ?? sourceItem.toObject?.() ?? {};
    const sourceSystem = sourceObject.system ?? {};
    const identifier = String(sourceConfig.itemIdentifier ?? sourceSystem.identifier ?? sourceItem.name ?? "ongoing-action")
      .trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "ongoing-action";
    const itemData = {
      name: String(sourceConfig.itemName ?? `${sourceItem.name ?? "Ongoing Effect"} — Action`),
      type: "feat",
      img: sourceConfig.itemImg ?? sourceItem.img ?? effect?.img ?? null,
      system: {
        description: duplicate(sourceSystem.description ?? { value: "", chat: "" }),
        source: duplicate(sourceSystem.source ?? { custom: "Action Effects 5E" }),
        activation: { type: "action", value: 1, condition: "" },
        duration: { value: null, units: "inst" },
        target: { affects: { choice: false, count: "", type: "self" }, template: { units: "ft", contiguous: false, type: "", size: "", count: "" } },
        range: { value: null, units: "self", special: "" },
        uses: { max: "", recovery: [], spent: 0 },
        activities: { [activityId]: activityData },
        identifier
      },
      effects: [],
      flags: {}
    };
    return {
      itemData,
      templateUuid: null,
      sourceItemUuid: sourceItem.uuid ?? explicitSourceUuid ?? originUuid,
      sourceActivity: String(sourceConfig.activityReference),
      activityIdentifier: activityId
    };
  }

  #workflowSucceeded(workflow, actor) {
    const actorUuid = actor?.uuid ?? null;
    const matches = value => {
      const candidate = value?.actor ?? value?.document?.actor ?? value?.object?.actor ?? value;
      return Boolean(candidate && (candidate === actor || candidate?.uuid === actorUuid));
    };
    const saves = asArray(workflow?.saves);
    const failedSaves = asArray(workflow?.failedSaves);
    if (saves.some(matches)) return true;
    if (failedSaves.some(matches)) return false;
    if (typeof workflow?.ae5eOngoingSuccess === "boolean") return workflow.ae5eOngoingSuccess;

    // Ongoing actions can be ordinary D&D5e Check Activities rather than saves.
    // Preserve the normal Midi/D&D5e roll pipeline, then interpret its prepared
    // roll total against the Activity's prepared DC when no save sets exist.
    const roll = this.#firstWorkflowRoll(workflow);
    const total = Number(roll?.total);
    const activity = workflow?.activity ?? null;
    const dc = Number(
      workflow?.dc
      ?? activity?.check?.dc?.value
      ?? activity?.system?.check?.dc?.value
      ?? activity?.check?.dc
      ?? NaN
    );
    if (Number.isFinite(total) && Number.isFinite(dc)) return total >= dc;
    return null;
  }

  #getSavedCastData(effect) {
    try {
      if (typeof this.#catSpell?.getSavedCastData === "function") return this.#catSpell.getSavedCastData(effect);
    } catch (error) {
      Logger.debug?.("CAT saved cast data was unavailable for ongoing effect.", error);
    }
    return getProperty(effect, "flags.cat.castData") ?? getProperty(effect, "flags.midi-qol.castData") ?? null;
  }

  #controllerUserId(actor) {
    const owner = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
    const activeOwner = [...(game?.users ?? [])].find(user => {
      if (!user?.active || user?.isGM) return false;
      try { return actor?.testUserPermission?.(user, owner) ?? false; } catch { return false; }
    });
    if (activeOwner) return activeOwner.id;
    return this.#authority?.getPrimaryGm?.()?.id ?? [...(game?.users ?? [])].find(user => user?.active && user?.isGM)?.id ?? game?.user?.id;
  }

  #isAuthority() {
    return Boolean(game?.user?.isGM && (this.#authority?.isPrimary?.() ?? true));
  }

  #snapshotCombat(combat) {
    return {
      combatantId: combat?.combatant?.id ?? null,
      combatantUuid: combat?.combatant?.uuid ?? null,
      round: combat?.round ?? 0,
      turn: combat?.turn ?? -1
    };
  }

  #selfTargets(actor) {
    const token = actor?.getActiveTokens?.(true, true)?.[0] ?? actor?.getActiveTokens?.()?.[0] ?? null;
    return token ? new Set([token]) : new Set();
  }

  #tokenForActorUuid(actorUuid) {
    if (!actorUuid || !canvas?.ready) return null;
    return canvas.tokens?.placeables?.find(token => token.actor?.uuid === actorUuid) ?? null;
  }

  #escape(value) {
    const text = String(value ?? "");
    if (globalThis.foundry?.utils?.escapeHTML) return foundry.utils.escapeHTML(text);
    return text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
  }

  #record(type, details) {
    this.#stats.lastEvent = { at: new Date().toISOString(), type, details };
  }
}
