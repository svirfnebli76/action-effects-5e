import { Logger } from "../core/logger.js";

function asArray(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return [...collection];
  if (collection instanceof Set) return [...collection];
  if (typeof collection.values === "function") {
    try { return [...collection.values()]; } catch { /* fall through */ }
  }
  if (typeof collection[Symbol.iterator] === "function") {
    try { return [...collection]; } catch { /* fall through */ }
  }
  return [];
}

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function damageTypes(activity) {
  const result = [];
  for (const part of asArray(activity?.damage?.parts)) {
    const types = asArray(part?.types);
    for (const type of types) {
      if (typeof type === "string" && type.length) result.push(type);
    }
  }
  return [...new Set(result)];
}

function entitySnapshot(entity) {
  const document = entity?.document ?? entity;
  if (!document) return null;
  return {
    id: document.id ?? document._id ?? null,
    uuid: document.uuid ?? null,
    name: document.name ?? null
  };
}

function collectionSnapshot(collection) {
  return asArray(collection).map(entitySnapshot).filter(Boolean);
}

/**
 * Narrow facade around the CAT 0.0.6 spell/workflow utilities that AE5E has
 * characterized in Foundry. SME handlers consume this facade through their
 * context rather than importing/calling CAT directly.
 *
 * AE5E remains the owner of modifier semantics, eligibility, conflicts,
 * choices, resource policy and per-cast state. CAT is a replaceable utility
 * provider underneath those semantics.
 */
export class CatSpellAdapter {
  #stats = {
    castLevelCalls: 0,
    saveDcCalls: 0,
    workflowStateSets: 0,
    workflowStateGets: 0,
    activitySubstitutions: 0,
    damageActivityBuilds: 0,
    syntheticActivities: 0,
    syntheticItems: 0,
    completeActivityUses: 0,
    rollUtilityCalls: 0,
    appliedDamageUtilityCalls: 0,
    genericUtilityCalls: 0,
    fallbacks: 0,
    errors: 0,
    lastEvent: null
  };

  #cat() {
    return globalThis.cat ?? null;
  }

  #active() {
    return Boolean(globalThis.game?.modules?.get?.("cat")?.active);
  }

  getStatus() {
    const module = globalThis.game?.modules?.get?.("cat") ?? null;
    const cat = this.#cat();
    const activityUtils = cat?.utils?.activityUtils;
    const workflowUtils = cat?.utils?.workflowUtils;
    const itemUtils = cat?.utils?.itemUtils;
    const rollUtils = cat?.utils?.rollUtils;

    const functionAvailable = fn => Boolean(module?.active) && typeof fn === "function";

    return {
      installed: Boolean(module),
      active: Boolean(module?.active),
      version: module?.version ?? null,
      apiExposed: Boolean(cat),
      capabilities: {
        getActionType: functionAvailable(workflowUtils?.getActionType),
        isAttackType: functionAvailable(workflowUtils?.isAttackType),
        setWorkflowProperty: functionAvailable(workflowUtils?.setWorkflowProperty),
        getWorkflowProperty: functionAvailable(workflowUtils?.getWorkflowProperty),
        getCastLevel: functionAvailable(workflowUtils?.getCastLevel),
        getDamageTypes: functionAvailable(workflowUtils?.getDamageTypes),
        isSustainedRoll: functionAvailable(workflowUtils?.isSustainedRoll),
        setActivity: functionAvailable(workflowUtils?.setActivity),
        getSaveDC: functionAvailable(activityUtils?.getSaveDC),
        getDamageModifiedActivityData: functionAvailable(activityUtils?.getDamageModifiedActivityData),
        syntheticActivity: functionAvailable(activityUtils?.syntheticActivity),
        syntheticItem: functionAvailable(itemUtils?.syntheticItem),
        getActivityByIdentifier: functionAvailable(itemUtils?.getActivityByIdentifier),
        getItemDamageTypes: functionAvailable(itemUtils?.getItemDamageTypes),
        completeActivityUse: functionAvailable(workflowUtils?.completeActivityUse),
        rollDiceSync: functionAvailable(rollUtils?.rollDiceSync),
        rollDice: functionAvailable(rollUtils?.rollDice),
        getRollsTotal: functionAvailable(rollUtils?.getRollsTotal),
        getCriticalFormula: functionAvailable(rollUtils?.getCriticalFormula),
        addToRoll: functionAvailable(rollUtils?.addToRoll),
        damageRoll: functionAvailable(rollUtils?.damageRoll),
        getChangedDamageRoll: functionAvailable(rollUtils?.getChangedDamageRoll),
        hasDuplicateDie: functionAvailable(rollUtils?.hasDuplicateDie),
        applyWorkflowDamage: functionAvailable(workflowUtils?.applyWorkflowDamage),
        modifyDamageAppliedFlat: functionAvailable(workflowUtils?.modifyDamageAppliedFlat),
        setDamageItemDamage: functionAvailable(workflowUtils?.setDamageItemDamage),
        negateDamageItemDamage: functionAvailable(workflowUtils?.negateDamageItemDamage)
      },
      strategy: "CAT supplies characterized spell/workflow/roll utilities when active; AE5E SME owns modifier semantics and lifecycle."
    };
  }

  getStats() {
    return { ...this.#stats, status: this.getStatus() };
  }

  getCastLevel(workflow) {
    this.#stats.castLevelCalls += 1;
    const fn = this.#active() ? this.#cat()?.utils?.workflowUtils?.getCastLevel : null;
    if (typeof fn === "function") {
      try {
        const value = finiteNumber(fn(workflow), null);
        if (value !== null) return value;
      } catch (error) {
        this.#recordError("getCastLevel", error);
      }
    }

    this.#stats.fallbacks += 1;
    return finiteNumber(
      workflow?.castData?.castLevel
      ?? workflow?.castData?.level
      ?? workflow?.item?.system?.level
      ?? workflow?.activity?.item?.system?.level,
      null
    );
  }

  getSaveDC(activity, workflow = null) {
    this.#stats.saveDcCalls += 1;
    const fn = this.#active() ? this.#cat()?.utils?.activityUtils?.getSaveDC : null;
    if (typeof fn === "function" && activity) {
      try {
        const value = finiteNumber(fn(activity), null);
        if (value !== null) return value;
      } catch (error) {
        this.#recordError("getSaveDC", error);
      }
    }

    this.#stats.fallbacks += 1;
    return finiteNumber(
      activity?.save?.dc?.value
      ?? activity?.save?.dc
      ?? workflow?.saveDC
      ?? workflow?.actor?.system?.attributes?.spelldc,
      null
    );
  }

  setWorkflowProperty(workflow, path, value) {
    const fn = this.#require("workflowUtils", "setWorkflowProperty");
    this.#stats.workflowStateSets += 1;
    this.#record("setWorkflowProperty", { path });
    return fn(workflow, path, value);
  }

  getWorkflowProperty(workflow, path) {
    const fn = this.#require("workflowUtils", "getWorkflowProperty");
    this.#stats.workflowStateGets += 1;
    return fn(workflow, path);
  }

  trySetWorkflowProperty(workflow, path, value) {
    const fn = this.#active() ? this.#cat()?.utils?.workflowUtils?.setWorkflowProperty : null;
    if (typeof fn !== "function") return false;
    try {
      this.#stats.workflowStateSets += 1;
      fn(workflow, path, value);
      this.#record("setWorkflowProperty", { path });
      return true;
    } catch (error) {
      this.#recordError("setWorkflowProperty", error);
      return false;
    }
  }

  tryGetWorkflowProperty(workflow, path, fallback = null) {
    const fn = this.#active() ? this.#cat()?.utils?.workflowUtils?.getWorkflowProperty : null;
    if (typeof fn !== "function") return fallback;
    try {
      this.#stats.workflowStateGets += 1;
      return fn(workflow, path) ?? fallback;
    } catch (error) {
      this.#recordError("getWorkflowProperty", error);
      return fallback;
    }
  }

  setActivity(workflow, activityData) {
    const fn = this.#require("workflowUtils", "setActivity");
    this.#stats.activitySubstitutions += 1;
    this.#record("setActivity", { workflowId: workflow?.id ?? workflow?.uuid ?? null, activityName: activityData?.name ?? null });
    return fn(workflow, activityData);
  }

  getDamageModifiedActivityData(activity, formula, options = {}) {
    const fn = this.#require("activityUtils", "getDamageModifiedActivityData");
    this.#stats.damageActivityBuilds += 1;
    this.#record("getDamageModifiedActivityData", { activityName: activity?.name ?? null, formula, options });
    return fn(activity, formula, options);
  }

  syntheticActivity(activityData, item, actor) {
    const fn = this.#require("activityUtils", "syntheticActivity");
    this.#stats.syntheticActivities += 1;
    return fn(activityData, item, actor);
  }

  syntheticItem(itemData, actor) {
    const fn = this.#require("itemUtils", "syntheticItem");
    this.#stats.syntheticItems += 1;
    return fn(itemData, actor);
  }

  getActivityByIdentifier(item, identifier) {
    return this.#callGeneric("itemUtils", "getActivityByIdentifier", [item, identifier]);
  }

  getItemDamageTypes(item) {
    return this.#callGeneric("itemUtils", "getItemDamageTypes", [item]);
  }

  getActionType(workflow) {
    return this.#callGeneric("workflowUtils", "getActionType", [workflow]);
  }

  isAttackType(workflowOrActionType, type) {
    return this.#callGeneric("workflowUtils", "isAttackType", [workflowOrActionType, type]);
  }

  getDamageTypes(workflow) {
    return this.#callGeneric("workflowUtils", "getDamageTypes", [workflow]);
  }

  isSustainedRoll(workflow) {
    return this.#callGeneric("workflowUtils", "isSustainedRoll", [workflow]);
  }

  completeActivityUse(activity, targets, options = {}) {
    const fn = this.#require("workflowUtils", "completeActivityUse");
    this.#stats.completeActivityUses += 1;
    return fn(activity, targets, options);
  }

  rollDiceSync(...args) { return this.#callRoll("rollDiceSync", args); }
  rollDice(...args) { return this.#callRoll("rollDice", args); }
  getRollsTotal(...args) { return this.#callRoll("getRollsTotal", args); }
  getCriticalFormula(...args) { return this.#callRoll("getCriticalFormula", args); }
  addToRoll(...args) { return this.#callRoll("addToRoll", args); }
  damageRoll(...args) { return this.#callRoll("damageRoll", args); }
  getChangedDamageRoll(...args) { return this.#callRoll("getChangedDamageRoll", args); }
  hasDuplicateDie(...args) { return this.#callRoll("hasDuplicateDie", args); }

  applyWorkflowDamage(...args) { return this.#callAppliedDamage("applyWorkflowDamage", args); }
  modifyDamageAppliedFlat(...args) { return this.#callAppliedDamage("modifyDamageAppliedFlat", args); }
  setDamageItemDamage(...args) { return this.#callAppliedDamage("setDamageItemDamage", args); }
  negateDamageItemDamage(...args) { return this.#callAppliedDamage("negateDamageItemDamage", args); }

  buildFacts(workflow, { targetToken = null, ditem = null } = {}) {
    const item = workflow?.item ?? workflow?.activity?.item ?? null;
    const activity = workflow?.activity ?? null;
    const actor = workflow?.actor ?? item?.actor ?? null;
    const token = workflow?.token?.document ?? workflow?.token ?? null;
    const baseLevel = finiteNumber(item?.system?.level, null);
    const castLevel = this.getCastLevel(workflow);

    return {
      isSpell: item?.type === "spell",
      actor: entitySnapshot(actor),
      token: entitySnapshot(token),
      item: entitySnapshot(item),
      itemType: item?.type ?? null,
      activity: entitySnapshot(activity),
      activityType: activity?.type ?? null,
      baseLevel,
      castLevel,
      scaling: baseLevel !== null && castLevel !== null ? Math.max(0, castLevel - baseLevel) : null,
      saveDC: this.getSaveDC(activity, workflow),
      damageTypes: damageTypes(activity),
      targets: collectionSnapshot(workflow?.targets),
      saves: collectionSnapshot(workflow?.saves),
      failedSaves: collectionSnapshot(workflow?.failedSaves),
      hitTargets: collectionSnapshot(workflow?.hitTargets),
      targetToken: entitySnapshot(targetToken),
      hasDamageItem: Boolean(ditem),
      damageItem: ditem ? {
        actorUuid: ditem.actorUuid ?? null,
        tokenUuid: ditem.tokenUuid ?? null,
        totalDamage: finiteNumber(ditem.totalDamage, null),
        hpDamage: finiteNumber(ditem.hpDamage, null),
        tempDamage: finiteNumber(ditem.tempDamage, null),
        oldHP: finiteNumber(ditem.oldHP, null),
        newHP: finiteNumber(ditem.newHP, null),
        oldTempHP: finiteNumber(ditem.oldTempHP, null),
        newTempHP: finiteNumber(ditem.newTempHP, null)
      } : null,
      damageRolls: (Array.isArray(workflow?.damageRolls) ? workflow.damageRolls : (workflow?.damageRoll ? [workflow.damageRoll] : []))
        .map(roll => ({
          class: roll?.constructor?.name ?? null,
          formula: roll?.formula ?? null,
          total: finiteNumber(roll?.total, null),
          type: roll?.options?.type ?? null
        }))
    };
  }

  #require(group, name) {
    if (!this.#active()) throw new Error(`SME CAT utility '${group}.${name}' requires active CAT.`);
    const fn = this.#cat()?.utils?.[group]?.[name];
    if (typeof fn !== "function") throw new Error(`CAT ${group}.${name}() is unavailable.`);
    return fn;
  }

  #callGeneric(group, name, args) {
    const fn = this.#require(group, name);
    this.#stats.genericUtilityCalls += 1;
    return fn(...args);
  }

  #callRoll(name, args) {
    const fn = this.#require("rollUtils", name);
    this.#stats.rollUtilityCalls += 1;
    this.#record(`rollUtils.${name}`);
    return fn(...args);
  }

  #callAppliedDamage(name, args) {
    const fn = this.#require("workflowUtils", name);
    this.#stats.appliedDamageUtilityCalls += 1;
    this.#record(`workflowUtils.${name}`);
    return fn(...args);
  }

  #record(type, details = null) {
    this.#stats.lastEvent = { at: new Date().toISOString(), type, details };
  }

  #recordError(type, error) {
    this.#stats.errors += 1;
    this.#record(`${type}-error`, { message: error?.message ?? String(error) });
    Logger.debug(`CAT spell adapter ${type} fallback after error.`, error);
  }
}
