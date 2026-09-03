import { Logger } from "../core/logger.js";

function asArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return [...value];
  if (typeof value.values === "function") return [...value.values()];
  return [value];
}

function uuidOf(value) {
  return value?.uuid ?? value?.document?.uuid ?? value?.object?.document?.uuid ?? null;
}

function normalizeReference(value) {
  return String(value ?? "").trim();
}

function clone(value) {
  if (value === undefined) return undefined;
  if (globalThis.foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
  if (globalThis.structuredClone) return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

/**
 * Authority-safe execution bridge for a real D&D5e Activity.
 * CAT/Midi remain responsible for normal saves, damage, chat, Dice So Nice,
 * and third-party workflow hooks. Live Workflow objects never cross Socketlib.
 *
 * Targeted execution intentionally fails closed when CAT's characterized
 * completeActivityUse utility is unavailable. Calling native Activity.use()
 * on the primary GM would otherwise rely on the GM client's current targets,
 * which is not a safe substitute for the requesting player's explicit Token
 * UUIDs.
 */
export class ActivityExecutionService {
  #socket;
  #authority;
  #catSpell;
  #claims = new Map();
  #claimTtlMs = 5 * 60 * 1000;
  #stats = {
    requests: 0,
    routedToAuthority: 0,
    executions: 0,
    duplicates: 0,
    unresolvedItems: 0,
    unresolvedActivities: 0,
    unresolvedTargets: 0,
    rejectedTargetedFallbacks: 0,
    nativeFallbacks: 0,
    errors: 0
  };

  constructor({ socket, authority, catSpell }) {
    this.#socket = socket;
    this.#authority = authority;
    this.#catSpell = catSpell;
    socket.register("activities.execute", payload => this.#executeAsAuthority(payload));
  }

  async execute({ itemUuid, activityReference, targetTokenUuids = [], idempotencyKey = null, options = {} } = {}) {
    this.#stats.requests += 1;
    const payload = {
      itemUuid: normalizeReference(itemUuid),
      activityReference: normalizeReference(activityReference),
      targetTokenUuids: [...new Set(asArray(targetTokenUuids).map(normalizeReference).filter(Boolean))],
      idempotencyKey: normalizeReference(idempotencyKey) || null,
      options: options && typeof options === "object" ? clone(options) : {},
      requestedByUserId: globalThis.game?.user?.id ?? null
    };
    if (!payload.itemUuid) return { executed: false, reason: "missing-item-uuid" };
    if (!payload.activityReference) return { executed: false, reason: "missing-activity-reference" };

    const primary = this.#authority?.getPrimaryGm?.()
      ?? [...(globalThis.game?.users ?? [])].find(user => user?.active && user?.isGM)
      ?? null;
    if (!primary) return { executed: false, reason: "no-active-gm" };
    if (globalThis.game?.user?.id === primary.id) return this.#executeAsAuthority(payload);
    this.#stats.routedToAuthority += 1;
    return this.#socket.executeAsUser("activities.execute", primary.id, payload);
  }

  getStats() {
    return Object.freeze({ ...this.#stats, claims: this.#claims.size });
  }

  async #executeAsAuthority(payload) {
    if (!globalThis.game?.user?.isGM) return { executed: false, reason: "not-gm" };
    const primary = this.#authority?.getPrimaryGm?.() ?? null;
    if (primary && globalThis.game.user.id !== primary.id) {
      return { executed: false, reason: "not-primary-gm", primaryGmId: primary.id };
    }

    const item = await globalThis.fromUuid?.(payload?.itemUuid);
    if (!item || item.documentName !== "Item") {
      this.#stats.unresolvedItems += 1;
      return { executed: false, reason: "item-unavailable", itemUuid: payload?.itemUuid ?? null };
    }

    const activity = this.#resolveActivity(item, payload?.activityReference);
    if (!activity) {
      this.#stats.unresolvedActivities += 1;
      return { executed: false, reason: "activity-unavailable", itemUuid: item.uuid, activityReference: payload?.activityReference ?? null };
    }

    const targets = [];
    const missingTargetUuids = [];
    for (const uuid of payload?.targetTokenUuids ?? []) {
      let token = null;
      try { token = await globalThis.fromUuid?.(uuid); } catch { token = null; }
      if (!token) {
        this.#stats.unresolvedTargets += 1;
        missingTargetUuids.push(uuid);
        continue;
      }
      // CAT's characterized workflowUtils.completeActivityUse() expects
      // document-style targets and derives Midi targetUuids from target.uuid.
      // Keep the resolved TokenDocument instead of converting it to the
      // canvas Token placeable, whose UUID is only available on .document.
      targets.push(token?.document ?? token);
    }
    if (missingTargetUuids.length) {
      return {
        executed: false,
        reason: "target-unavailable",
        itemUuid: item.uuid,
        activityReference: payload?.activityReference ?? null,
        missingTargetUuids
      };
    }

    const status = this.#catSpell?.getStatus?.() ?? {};
    const canUseCat = Boolean(status.active && status.capabilities?.completeActivityUse);
    if (!canUseCat && targets.length) {
      this.#stats.rejectedTargetedFallbacks += 1;
      return {
        executed: false,
        reason: "cat-targeted-activity-execution-unavailable",
        itemUuid: item.uuid,
        activityReference: payload?.activityReference ?? null,
        targetUuids: targets.map(uuidOf).filter(Boolean)
      };
    }
    if (!canUseCat && typeof activity.use !== "function") {
      return { executed: false, reason: "no-activity-execution-method" };
    }

    this.#cleanupClaims();
    const claim = normalizeReference(payload?.idempotencyKey);
    if (claim && this.#claims.has(claim)) {
      this.#stats.duplicates += 1;
      return { executed: false, reason: "duplicate", idempotencyKey: claim };
    }
    if (claim) this.#claims.set(claim, Date.now());

    try {
      let workflow = null;
      if (canUseCat) {
        // This bridge executes only on the authoritative primary GM. Pin CAT's
        // completeActivityUse() to that same user unless the caller explicitly
        // supplied a userId. Otherwise CAT defaults to the first owner of the
        // source actor, which can route an environmental Activity away from the
        // authority client and cause Midi to return no local workflow.
        const executionOptions = payload?.options && typeof payload.options === "object"
          ? clone(payload.options)
          : {};
        executionOptions.userId ??= globalThis.game?.user?.id ?? undefined;
        workflow = await this.#catSpell.completeActivityUse(activity, targets, executionOptions);
      } else {
        this.#stats.nativeFallbacks += 1;
        workflow = await activity.use(payload?.options ?? {});
      }

      if (!workflow) {
        if (claim) this.#claims.delete(claim);
        return {
          executed: false,
          reason: "activity-use-returned-no-workflow",
          itemUuid: item.uuid,
          activityReference: payload?.activityReference ?? null
        };
      }

      this.#stats.executions += 1;
      return this.#serializeOutcome({ workflow, item, activity, targets, claim, viaCat: canUseCat });
    } catch (error) {
      // A failed execution must not poison the idempotency key. The same
      // environmental event can be safely retried after a transient CAT/Midi
      // or document-resolution failure.
      if (claim) this.#claims.delete(claim);
      this.#stats.errors += 1;
      Logger.error("AE5E Activity execution failed", error);
      throw error;
    }
  }

  #resolveActivity(item, reference) {
    const ref = normalizeReference(reference);
    const activities = item?.system?.activities;
    if (!activities || !ref) return null;

    if (typeof activities.get === "function") {
      const direct = activities.get(ref);
      if (direct) return direct;
    }

    try {
      const byIdentifier = this.#catSpell?.getActivityByIdentifier?.(item, ref);
      if (byIdentifier) return byIdentifier;
    } catch { /* continue */ }

    const normalized = ref.toLowerCase();
    return asArray(activities).find(activity => {
      const id = String(activity?.id ?? activity?._id ?? "").toLowerCase();
      const identifier = String(activity?.identifier ?? activity?.system?.identifier ?? "").toLowerCase();
      const name = String(activity?.name ?? "").trim().toLowerCase();
      return id === normalized || identifier === normalized || name === normalized;
    }) ?? null;
  }

  #serializeOutcome({ workflow, item, activity, targets, claim, viaCat }) {
    const uuids = list => [...new Set(asArray(list).map(uuidOf).filter(Boolean))];
    return {
      executed: true,
      via: viaCat ? "cat-midi" : "activity",
      idempotencyKey: claim,
      workflowId: workflow?.id ?? workflow?.uuid ?? null,
      itemUuid: item?.uuid ?? null,
      activityUuid: activity?.uuid ?? null,
      activityId: activity?.id ?? activity?._id ?? null,
      activityType: activity?.type ?? null,
      targetUuids: [...new Set(targets.map(uuidOf).filter(Boolean))],
      saves: uuids(workflow?.saves),
      failedSaves: uuids(workflow?.failedSaves),
      hitTargets: uuids(workflow?.hitTargets),
      missedTargets: uuids(workflow?.missedTargets ?? workflow?.missTargets)
    };
  }

  #cleanupClaims() {
    const cutoff = Date.now() - this.#claimTtlMs;
    for (const [key, at] of this.#claims) if (at < cutoff) this.#claims.delete(key);
    while (this.#claims.size > 500) this.#claims.delete(this.#claims.keys().next().value);
  }
}
