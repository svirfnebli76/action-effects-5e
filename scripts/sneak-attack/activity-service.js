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

function normalized(value) {
  return String(value ?? "").trim().toLowerCase();
}

function uuidOf(value) {
  return value?.uuid ?? value?.document?.uuid ?? value?.object?.document?.uuid ?? null;
}

function activityIdentifier(activity) {
  return String(activity?.identifier ?? activity?.system?.identifier ?? "").trim();
}

function activitySnapshot(activity) {
  if (!activity) return null;
  return {
    id: activity.id ?? activity._id ?? null,
    uuid: activity.uuid ?? null,
    name: activity.name ?? null,
    identifier: activityIdentifier(activity) || null,
    type: activity.type ?? null
  };
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

/**
 * Sneak Attack-specific semantic bridge over the generic authority-safe
 * ActivityExecutionService. It enforces the locked stable-identifier contract
 * and translates semantic targets without knowing any named Rogue feature.
 */
export class SneakAttackActivityService {
  #activities;
  #catSpell;
  #stats = {
    resolutions: 0,
    resolved: 0,
    missing: 0,
    ambiguous: 0,
    typeMismatches: 0,
    executions: 0,
    executionFailures: 0,
    targetResolutionFailures: 0
  };

  constructor({ activities, catSpell }) {
    this.#activities = activities;
    this.#catSpell = catSpell;
  }

  resolve(entryOrItem, { activityIdentifier: identifier = null, activityType = null } = {}) {
    this.#stats.resolutions += 1;
    const sourceItem = entryOrItem?.provenance?.sourceItem ?? entryOrItem;
    const declaration = entryOrItem?.declaration ?? null;
    const requestedIdentifier = String(identifier ?? declaration?.activity ?? "").trim();
    const expectedType = normalized(activityType ?? declaration?.activityType ?? "");

    if (!sourceItem || sourceItem.documentName !== "Item") {
      this.#stats.missing += 1;
      return { resolved: false, reason: "source-item-unavailable", sourceItem: sourceItem ?? null, activity: null, matches: [] };
    }
    if (!requestedIdentifier) {
      this.#stats.missing += 1;
      return { resolved: false, reason: "missing-activity-identifier", sourceItem, activity: null, matches: [] };
    }

    const wanted = normalized(requestedIdentifier);
    const matches = asArray(sourceItem?.system?.activities).filter(activity => normalized(activityIdentifier(activity)) === wanted);

    // CAT's identifier helper is useful when D&D5e's activity collection shape
    // changes, but its result is accepted only if it independently satisfies
    // the same stable-identifier contract. Display names and embedded _id values
    // are intentionally never treated as declaration references here.
    if (!matches.length) {
      try {
        const candidate = this.#catSpell?.getActivityByIdentifier?.(sourceItem, requestedIdentifier) ?? null;
        if (candidate && normalized(activityIdentifier(candidate)) === wanted) matches.push(candidate);
      } catch { /* fail closed below */ }
    }

    const deduped = [];
    const seen = new Set();
    for (const activity of matches) {
      const key = activity?.uuid ?? activity?.id ?? activity?._id ?? activity;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(activity);
    }

    if (!deduped.length) {
      this.#stats.missing += 1;
      return {
        resolved: false,
        reason: "activity-identifier-unavailable",
        sourceItem,
        requestedIdentifier,
        activity: null,
        matches: []
      };
    }
    if (deduped.length !== 1) {
      this.#stats.ambiguous += 1;
      return {
        resolved: false,
        reason: "activity-identifier-ambiguous",
        sourceItem,
        requestedIdentifier,
        activity: null,
        matches: deduped.map(activitySnapshot)
      };
    }

    const activity = deduped[0];
    if (expectedType && normalized(activity?.type) !== expectedType) {
      this.#stats.typeMismatches += 1;
      return {
        resolved: false,
        reason: "activity-type-mismatch",
        sourceItem,
        requestedIdentifier,
        expectedType,
        actualType: activity?.type ?? null,
        activity,
        matches: [activitySnapshot(activity)]
      };
    }

    this.#stats.resolved += 1;
    return {
      resolved: true,
      reason: null,
      sourceItem,
      requestedIdentifier,
      expectedType: expectedType || null,
      activity,
      matches: [activitySnapshot(activity)]
    };
  }

  resolveSemanticTargets(semanticTarget, context = {}) {
    const target = String(semanticTarget ?? "").trim();
    const parentWorkflow = context?.parentWorkflow ?? null;
    switch (target) {
      case "sneakTarget": {
        const uuid = context?.transaction?.sneakTargetUuid ?? context?.transaction?.targetUuid ?? context?.targetUuid ?? context?.sneakTargetUuid ?? null;
        return uuid ? { resolved: true, targetUuids: [uuid], reason: null } : { resolved: false, targetUuids: [], reason: "sneak-target-unavailable" };
      }
      case "self": {
        const uuid = context?.subjectTokenUuid ?? uuidOf(context?.subjectToken);
        return uuid ? { resolved: true, targetUuids: [uuid], reason: null } : { resolved: false, targetUuids: [], reason: "subject-token-unavailable" };
      }
      case "parentTargets": {
        const values = context?.parentTargetUuids ?? asArray(parentWorkflow?.targets).map(uuidOf);
        const uuids = unique(asArray(values));
        return uuids.length ? { resolved: true, targetUuids: uuids, reason: null } : { resolved: false, targetUuids: [], reason: "parent-targets-unavailable" };
      }
      case "parentHitTargets": {
        const values = context?.parentHitTargetUuids ?? asArray(parentWorkflow?.hitTargets).map(uuidOf);
        const uuids = unique(asArray(values));
        return uuids.length ? { resolved: true, targetUuids: uuids, reason: null } : { resolved: false, targetUuids: [], reason: "parent-hit-targets-unavailable" };
      }
      default:
        return { resolved: false, targetUuids: [], reason: target ? "unsupported-semantic-target" : "missing-semantic-target" };
    }
  }

  async execute(entry, context = {}) {
    this.#stats.executions += 1;
    const declaration = entry?.declaration ?? null;
    if (!declaration || declaration.executor !== "activity") {
      this.#stats.executionFailures += 1;
      return { executed: false, reason: "declaration-is-not-activity-executor" };
    }

    const resolved = this.resolve(entry);
    if (!resolved.resolved) {
      this.#stats.executionFailures += 1;
      return { executed: false, reason: resolved.reason, resolution: resolved };
    }

    const targetResolution = this.resolveSemanticTargets(declaration.target, context);
    if (!targetResolution.resolved) {
      this.#stats.targetResolutionFailures += 1;
      this.#stats.executionFailures += 1;
      return { executed: false, reason: targetResolution.reason, resolution: resolved, targetResolution };
    }

    const parentWorkflow = context?.parentWorkflow ?? null;
    const transactionId = context?.transaction?.id ?? context?.transactionId ?? null;
    const options = {
      ...(context?.executionOptions && typeof context.executionOptions === "object" ? context.executionOptions : {})
    };

    if (declaration.consume === false) {
      options.consumeUsage = false;
      options.consumeResources = false;
      options.spellSlot = false;
    }
    if (declaration.configure === false) {
      // CAT 0.0.8 completeActivityUse() consumes Midi's configureDialog flag
      // from its nested options object. Do not map this to CAT's `fast` flag,
      // which also changes attack/damage automation semantics.
      options.options = { ...(options.options ?? {}), configureDialog: false };
    }

    const workflowOptions = {
      ...(options.options?.workflowOptions ?? {}),
      ...(parentWorkflow?.id ? { triggeringWorkflowId: parentWorkflow.id } : {}),
      ...(parentWorkflow?.activity?.uuid ? { triggeringActivityUuid: parentWorkflow.activity.uuid } : {}),
      ae5eSneakAttack: {
        transactionId,
        declarationId: declaration.id ?? null
      }
    };
    options.options = {
      ...(options.options ?? {}),
      workflowOptions
    };

    const outcome = await this.#activities.execute({
      itemUuid: resolved.sourceItem.uuid,
      activityReference: declaration.activity,
      targetTokenUuids: targetResolution.targetUuids,
      idempotencyKey: context?.idempotencyKey ?? (transactionId && declaration.id ? `${transactionId}:${declaration.id}` : null),
      options
    });

    if (!outcome?.executed) this.#stats.executionFailures += 1;
    return {
      ...outcome,
      declarationId: declaration.id ?? null,
      semanticTarget: declaration.target ?? null,
      resolvedActivity: activitySnapshot(resolved.activity),
      resolvedTargetUuids: targetResolution.targetUuids
    };
  }

  getStatus() {
    return Object.freeze({
      activityExecution: this.#activities?.getStats?.() ?? null,
      cat: this.#catSpell?.getStatus?.() ?? null,
      semanticTargets: Object.freeze(["sneakTarget", "self", "parentTargets", "parentHitTargets"])
    });
  }

  getStats() {
    return Object.freeze({ ...this.#stats, status: this.getStatus() });
  }
}
