import { SME_SESSION_STATES } from "../core/constants.js";
import { duplicateSafely, nowIso, randomId } from "../core/utils.js";

export class SpellModifierSession {
  #rollbackStack = [];
  #appliedKeys = new Set();
  #conflictGroups = new Set();
  #processedEventKeys = new Set();

  constructor({ workflowId, source = {}, coordinatorUserId = null } = {}) {
    this.id = `sme-${randomId(18)}`;
    this.workflowId = workflowId ?? null;
    this.rootWorkflowId = workflowId ?? null;
    this.coordinatorUserId = coordinatorUserId ?? null;
    this.source = duplicateSafely(source ?? {});
    this.state = SME_SESSION_STATES.ACTIVE;
    this.createdAt = nowIso();
    this.updatedAt = this.createdAt;
    this.completedAt = null;
    this.currentPhase = null;
    this.phaseVisits = [];
    this.decisions = [];
    this.applications = [];
    this.errors = [];
    this.metadata = {};
  }

  touchPhase(phase, { eventKey = null, context = null } = {}) {
    this.#assertActive();
    this.currentPhase = phase;
    this.updatedAt = nowIso();
    this.phaseVisits.push({
      phase,
      eventKey,
      at: this.updatedAt,
      targetTokenUuid: context?.event?.targetTokenUuid ?? null,
      rawHook: context?.event?.rawHook ?? null
    });
    if (eventKey) this.#processedEventKeys.add(eventKey);
  }

  hasProcessedEvent(eventKey) {
    return Boolean(eventKey && this.#processedEventKeys.has(eventKey));
  }

  hasApplied(key) {
    return Boolean(key && this.#appliedKeys.has(key));
  }

  hasConflictGroup(group) {
    return Boolean(group && this.#conflictGroups.has(group));
  }

  recordDecision(entry = {}) {
    this.updatedAt = nowIso();
    this.decisions.push({ at: this.updatedAt, ...duplicateSafely(entry) });
  }

  recordApplication({ key, modifierId, sourceUuid = null, sourceName = null, optionId = null, label = null, phase = null, mode = null, conflictGroup = null, result = null, rollback = null } = {}) {
    this.updatedAt = nowIso();
    const entry = {
      at: this.updatedAt,
      key,
      modifierId,
      sourceUuid,
      sourceName,
      optionId,
      label,
      phase,
      mode,
      conflictGroup,
      result: this.#safeResult(result)
    };
    this.applications.push(entry);
    if (key) this.#appliedKeys.add(key);
    if (conflictGroup) this.#conflictGroups.add(conflictGroup);
    if (typeof rollback === "function") {
      this.#rollbackStack.push({
        key,
        modifierId,
        phase,
        rollback
      });
    }
    return entry;
  }

  recordError({ modifierId = null, phase = null, message = null, stack = null } = {}) {
    this.updatedAt = nowIso();
    const entry = { at: this.updatedAt, modifierId, phase, message, stack };
    this.errors.push(entry);
    return entry;
  }

  async rollback({ reason = "manual-rollback", context = null } = {}) {
    const results = [];
    for (const entry of [...this.#rollbackStack].reverse()) {
      try {
        const result = await entry.rollback({ session: this, context, reason });
        results.push({ key: entry.key, modifierId: entry.modifierId, rolledBack: true, result: this.#safeResult(result) });
      } catch (error) {
        results.push({ key: entry.key, modifierId: entry.modifierId, rolledBack: false, error: error?.message ?? String(error) });
      }
    }
    this.#rollbackStack.length = 0;
    this.state = SME_SESSION_STATES.ROLLED_BACK;
    this.updatedAt = nowIso();
    this.completedAt = this.updatedAt;
    this.metadata.rollbackReason = reason;
    return results;
  }

  abort(reason = "modifier-requested-abort") {
    if (this.state !== SME_SESSION_STATES.ACTIVE) return this;
    this.state = SME_SESSION_STATES.ABORTED;
    this.updatedAt = nowIso();
    this.completedAt = this.updatedAt;
    this.metadata.abortReason = reason;
    return this;
  }

  complete(details = {}) {
    if (this.state === SME_SESSION_STATES.ACTIVE) this.state = SME_SESSION_STATES.COMPLETE;
    this.updatedAt = nowIso();
    this.completedAt = this.completedAt ?? this.updatedAt;
    Object.assign(this.metadata, duplicateSafely(details ?? {}));
    return this;
  }

  toJSON() {
    return duplicateSafely({
      id: this.id,
      workflowId: this.workflowId,
      rootWorkflowId: this.rootWorkflowId,
      coordinatorUserId: this.coordinatorUserId,
      source: this.source,
      state: this.state,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      completedAt: this.completedAt,
      currentPhase: this.currentPhase,
      phaseVisits: this.phaseVisits,
      decisions: this.decisions,
      applications: this.applications,
      errors: this.errors,
      metadata: this.metadata,
      appliedKeys: [...this.#appliedKeys],
      conflictGroups: [...this.#conflictGroups]
    });
  }

  #assertActive() {
    if (this.state !== SME_SESSION_STATES.ACTIVE) {
      throw new Error(`Spell modifier session '${this.id}' is not active (${this.state}).`);
    }
  }

  #safeResult(result) {
    if (result == null) return result;
    if (typeof result !== "object") return result;
    const copy = {};
    for (const [key, value] of Object.entries(result)) {
      if (key === "rollback" || typeof value === "function") continue;
      try { copy[key] = duplicateSafely(value); } catch { copy[key] = String(value); }
    }
    return copy;
  }
}
