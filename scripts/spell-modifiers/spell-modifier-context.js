import { SME_WORKFLOW_STATE_PATH } from "../core/constants.js";
import { duplicateSafely } from "../core/utils.js";

function entityUuid(entity) {
  const document = entity?.document ?? entity;
  return document?.uuid ?? null;
}

/**
 * Stable semantic envelope for one SME workflow phase.
 *
 * `live` contains live Foundry/Midi objects for handler execution and is never
 * serialized. Everything else is safe to expose through hooks/diagnostics.
 *
 * Feature handlers use this AE5E context facade instead of calling CAT
 * directly. That keeps CAT replaceable and leaves modifier semantics under SME.
 */
export class SpellModifierContext {
  constructor({ phase, workflowId, sessionId, workflow, catSpell, eventData = {}, coordinatorUserId = null } = {}) {
    if (!phase) throw new TypeError("SpellModifierContext requires a phase.");
    if (!workflow) throw new TypeError("SpellModifierContext requires a Midi workflow.");

    const item = workflow?.item ?? workflow?.activity?.item ?? null;
    const activity = workflow?.activity ?? null;
    const actor = workflow?.actor ?? item?.actor ?? null;
    const token = workflow?.token?.document ?? workflow?.token ?? null;
    const targetToken = eventData?.targetToken?.document ?? eventData?.targetToken ?? null;
    const ditem = eventData?.ditem ?? null;

    this.phase = phase;
    this.workflowId = workflowId ?? workflow?.id ?? workflow?.uuid ?? null;
    this.sessionId = sessionId ?? null;
    this.coordinatorUserId = coordinatorUserId ?? workflow?.userId ?? null;
    this.source = Object.freeze({
      actorUuid: entityUuid(actor),
      tokenUuid: entityUuid(token),
      itemUuid: entityUuid(item),
      activityId: activity?.id ?? activity?._id ?? null,
      activityUuid: entityUuid(activity),
      itemName: item?.name ?? null,
      activityName: activity?.name ?? null
    });
    this.facts = Object.freeze(catSpell.buildFacts(workflow, { targetToken, ditem }));
    this.event = Object.freeze({
      targetTokenUuid: entityUuid(targetToken),
      hasDitem: Boolean(ditem),
      tag: eventData?.tag ?? null,
      rawHook: eventData?.rawHook ?? null
    });

    const status = catSpell.getStatus();
    this.capabilities = Object.freeze({
      catActive: status.active,
      ...status.capabilities
    });

    this.live = Object.freeze({
      workflow,
      actor,
      token,
      item,
      activity,
      targetToken,
      ditem,
      eventData,
      catSpell
    });

    Object.freeze(this);
  }

  get actor() { return this.live.actor; }
  get token() { return this.live.token; }
  get item() { return this.live.item; }
  get activity() { return this.live.workflow?.activity ?? this.live.activity; }
  get workflow() { return this.live.workflow; }
  get targetToken() { return this.live.targetToken; }
  get ditem() { return this.live.ditem; }

  get targetUuids() {
    return this.facts.targets.map(entry => entry.uuid).filter(Boolean);
  }

  get saveUuids() {
    return this.facts.saves.map(entry => entry.uuid).filter(Boolean);
  }

  get failedSaveUuids() {
    return this.facts.failedSaves.map(entry => entry.uuid).filter(Boolean);
  }

  get hitTargetUuids() {
    return this.facts.hitTargets.map(entry => entry.uuid).filter(Boolean);
  }

  /** Return AE5E's CAT-mirrored session snapshot, if CAT state utilities exist. */
  getSessionMirror(fallback = null) {
    return this.live.catSpell.tryGetWorkflowProperty(
      this.workflow,
      SME_WORKFLOW_STATE_PATH,
      fallback
    );
  }

  setWorkflowProperty(path, value) {
    return this.live.catSpell.setWorkflowProperty(this.workflow, path, value);
  }

  getWorkflowProperty(path) {
    return this.live.catSpell.getWorkflowProperty(this.workflow, path);
  }

  getCastLevel() {
    return this.live.catSpell.getCastLevel(this.workflow);
  }

  getSaveDC(activity = this.activity) {
    return this.live.catSpell.getSaveDC(activity, this.workflow);
  }

  getActionType() {
    return this.live.catSpell.getActionType(this.workflow);
  }

  isAttackType(type, subject = this.workflow) {
    return this.live.catSpell.isAttackType(subject, type);
  }

  getDamageTypes() {
    return this.live.catSpell.getDamageTypes(this.workflow);
  }

  isSustainedRoll() {
    return this.live.catSpell.isSustainedRoll(this.workflow);
  }

  setActivity(activityData) {
    return this.live.catSpell.setActivity(this.workflow, activityData);
  }

  getDamageModifiedActivityData(activity, formula, options = {}) {
    return this.live.catSpell.getDamageModifiedActivityData(activity, formula, options);
  }

  syntheticActivity(activityData, item = this.item, actor = this.actor) {
    return this.live.catSpell.syntheticActivity(activityData, item, actor);
  }

  syntheticItem(itemData, actor = this.actor) {
    return this.live.catSpell.syntheticItem(itemData, actor);
  }

  getActivityByIdentifier(item, identifier) {
    return this.live.catSpell.getActivityByIdentifier(item, identifier);
  }

  getItemDamageTypes(item = this.item) {
    return this.live.catSpell.getItemDamageTypes(item);
  }

  completeActivityUse(activity, targets, options = {}) {
    return this.live.catSpell.completeActivityUse(activity, targets, options);
  }

  rollDiceSync(...args) { return this.live.catSpell.rollDiceSync(...args); }
  rollDice(...args) { return this.live.catSpell.rollDice(...args); }
  getRollsTotal(...args) { return this.live.catSpell.getRollsTotal(...args); }
  getCriticalFormula(...args) { return this.live.catSpell.getCriticalFormula(...args); }
  addToRoll(...args) { return this.live.catSpell.addToRoll(...args); }
  damageRoll(...args) { return this.live.catSpell.damageRoll(...args); }

  /**
   * Rebuild and re-evaluate a changed damage roll using CAT. This intentionally
   * rerolls and is therefore only appropriate while the damage roll is still
   * mutable. For a type-only change after dice have been rolled, use
   * retagDamageRollsPreservingResults().
   */
  rebuildChangedDamageRoll(...args) {
    return this.live.catSpell.rebuildChangedDamageRoll(...args);
  }

  /** Preserve existing roll objects/results while changing their damage type. */
  retagDamageRollsPreservingResults(damageType, options = {}) {
    return this.live.catSpell.retagDamageRollsPreservingResults(this.workflow, damageType, options);
  }

  hasDuplicateDie(...args) { return this.live.catSpell.hasDuplicateDie(...args); }

  applyWorkflowDamage(...args) { return this.live.catSpell.applyWorkflowDamage(...args); }
  modifyDamageAppliedFlat(...args) { return this.live.catSpell.modifyDamageAppliedFlat(...args); }
  setDamageItemDamage(...args) { return this.live.catSpell.setDamageItemDamage(...args); }
  negateDamageItemDamage(...args) { return this.live.catSpell.negateDamageItemDamage(...args); }

  toJSON() {
    return duplicateSafely({
      phase: this.phase,
      workflowId: this.workflowId,
      sessionId: this.sessionId,
      coordinatorUserId: this.coordinatorUserId,
      source: this.source,
      facts: this.facts,
      event: this.event,
      capabilities: this.capabilities
    });
  }
}
