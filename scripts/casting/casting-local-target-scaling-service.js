/**
 * One-casting-only target-capacity adjustment, applied AFTER native dnd5e
 * upcasting and BEFORE Midi-QOL's late TargetConfirmationDialog is created.
 *
 * This service never modifies the original embedded Item or Activity, never
 * changes slot level, and never spends Sorcery Points. The calling Item owns
 * eligibility, cost and choice. The caller must opt into late Midi target
 * confirmation separately.
 */
const MAX_AGE_MS = 180_000;
const MAX_TARGETS = 100;

export function validateTargetScalingContext(request, activity, usage) {
  const sourceItem = request?.item;
  const sourceActivity = sourceItem?.system?.activities?.get?.(activity?.id);
  const affects = activity?.target?.affects;
  const sourceAffects = sourceActivity?.target?.affects;
  const countDescriptor = affects && Object.getOwnPropertyDescriptor(affects, 'count');
  const currentCount = Number(affects?.count);
  const bonus = request?.bonusTargets;
  const candidate = currentCount + bonus;
  const chosenSlot = usage?.spell?.slot ?? null;
  const actorId = activity?.item?.actor?.id ?? activity?.item?.parent?.id ?? null;
  const reason =
    !sourceActivity ? 'source-activity-missing' :
    activity === sourceActivity || activity.item === sourceItem ||
    activity.target === sourceActivity.target || affects === sourceAffects ? 'activity-not-isolated' :
    activity?.item?.id !== sourceItem?.id || activity?.id !== request.activityId ? 'activity-mismatch' :
    actorId && actorId !== request.actorId ? 'actor-mismatch' :
    !Number.isInteger(bonus) || bonus < 1 || bonus > 10 ? 'invalid-bonus' :
    !countDescriptor?.writable ? 'count-not-writable' :
    !Number.isSafeInteger(currentCount) || currentCount < 1 ? 'invalid-native-count' :
    !Number.isSafeInteger(candidate) || candidate > MAX_TARGETS ? 'result-out-of-bounds' :
    !chosenSlot || !/^spell[1-9]$/.test(chosenSlot) ? 'unsupported-slot-consumption' :
    null;
  return { valid: !reason, reason, count: currentCount, nextCount: candidate, chosenSlot };
}

export class CastingLocalTargetScalingService {
  #pending = new Map();
  #nextId = 0;
  #hookId = null;
  #preTargetingId = null;
  #stats = { armed: 0, applied: 0, rejected: 0, canceled: 0, expired: 0 };

  initialize() {
    if (this.#hookId) return;
    this.#hookId = Hooks.on('dnd5e.preActivityConsumption', (activity, usage) => {
      return this.#apply(activity, usage);
    });
    this.#preTargetingId = Hooks.on('midi-qol.preTargetingV2', (...args) => {
      const workflow = args.flatMap(v => [v, v?.workflow, v?.config?.workflow]).find(v => v?.actor && v?.activity);
      if (!workflow) return;
      for (const [id, request] of this.#pending) {
        if (request.actorId === workflow.actor.id &&
            request.item.id === workflow.activity?.item?.id && request.workflow !== workflow) {
          this.#pending.delete(id);
          this.#stats.canceled++;
        }
      }
      this.#prune();
    });
  }

  arm({ workflow, bonusTargets = 1 } = {}) {
    const actor = workflow?.actor;
    const item = workflow?.activity?.item;
    const ownedItem = actor?.items?.get?.(item?.id);
    if (!game?.user?.id || !actor?.isOwner || !item?.id || !workflow?.activity?.id || !actor.id)
      throw new Error('Casting-local target scaling needs an owned, current Midi workflow.');
    if (ownedItem !== item && ownedItem?.id !== item.id)
      throw new Error('Casting-local target scaling requires an embedded source Item on the caster.');
    if (!Number.isInteger(bonusTargets) || bonusTargets < 1 || bonusTargets > 10)
      throw new Error('bonusTargets must be a positive integer from 1 to 10.');
    this.#prune();
    for (const [id, req] of this.#pending) {
      if (req.actorId === actor.id && req.item.id === item.id && req.userId === game.user.id) {
        this.#pending.delete(id);
        this.#stats.canceled++;
      }
    }
    const id = `ae5e-scale-${++this.#nextId}`;
    this.#pending.set(id, {
      id, workflow, actorId: actor.id, activityId: workflow.activity.id,
      item: ownedItem ?? item, userId: game.user.id, bonusTargets,
      createdAt: Date.now()
    });
    this.#stats.armed++;
    return id;
  }

  cancel(id) {
    if (!this.#pending.delete(id)) return false;
    this.#stats.canceled++;
    return true;
  }

  getStatus() {
    this.#prune();
    return { pending: this.#pending.size, stats: { ...this.#stats } };
  }

  #prune() {
    for (const [id, req] of this.#pending) {
      if (Date.now() - req.createdAt <= MAX_AGE_MS) continue;
      this.#pending.delete(id);
      this.#stats.expired++;
    }
  }

  #apply(activity, usage) {
    this.#prune();
    const castingActorId = activity?.item?.actor?.id ?? activity?.item?.parent?.id ?? null;
    const matching = [...this.#pending].filter(([, request]) =>
      request.item.id === activity?.item?.id && request.activityId === activity?.id &&
      request.userId === game?.user?.id &&
      (!castingActorId || request.actorId === castingActorId));
    // Never apply an ambiguous request when simultaneous casts appear identical.
    if (matching.length > 1) {
      console.warn('AE5E | Ambiguous casting-local target scaling request; casting blocked.');
      globalThis.ui?.notifications?.error?.('AE5E target scaling is ambiguous; casting canceled.');
      return false;
    }
    if (!matching.length) return;
    const [id, request] = matching[0];
    this.#pending.delete(id); // exactly once, even if a later check throws
    let check;
    try {
      check = validateTargetScalingContext(request, activity, usage);
      if (!check.valid) throw new Error(check.reason);
      activity.target.affects.count = check.nextCount;
      this.#stats.applied++;
      return true;
    } catch (error) {
      this.#stats.rejected++;
      console.warn('AE5E | Casting-local target scaling skipped:', error);
      // D&D5e 6.0 documents that returning false here aborts Activity use.
      globalThis.ui?.notifications?.error?.('AE5E target scaling could not be applied; casting canceled.');
      return false;
    }
  }
}
