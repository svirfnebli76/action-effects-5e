import { Logger } from "../core/logger.js";
import {
  SNEAK_ATTACK_MAX_RECENT_TRANSACTIONS,
  SNEAK_ATTACK_TRANSACTION_STATES
} from "../core/constants.js";
import { duplicateSafely, nowIso } from "../core/utils.js";

function workflowIdOf(workflow) {
  return workflow?.id ?? workflow?.uuid ?? null;
}

function normalizeFormula(value) {
  if (value === null || value === undefined) return null;
  const formula = String(value).trim();
  return formula.length ? formula : null;
}

function normalizeDamageType(value) {
  if (value === null || value === undefined || value === "") return null;
  const type = String(value).trim();
  return type.length ? type : null;
}

function rollSnapshot(roll, index = null) {
  if (!roll) return null;
  return {
    index,
    class: roll?.constructor?.name ?? null,
    formula: roll?.formula ?? null,
    total: Number.isFinite(Number(roll?.total)) ? Number(roll.total) : roll?.total ?? null,
    type: roll?.options?.type ?? null,
    source: roll?.options?.cat?.source ?? null
  };
}

function transactionSnapshot(transaction) {
  if (!transaction) return null;
  if (typeof transaction.toJSON === "function") return transaction.toJSON();
  return duplicateSafely(transaction);
}

/**
 * Parent-workflow bonus-damage bridge for the generic Sneak Attack family.
 *
 * This service deliberately does not know Rogue levels, d6 scaling, Cunning
 * Strike option names, or any other Item-owned rule. Callers supply the final
 * damage formula after transaction choices have been resolved. AE5E validates
 * parent/transaction identity and delegates roll construction, critical-hit
 * conversion, damage-type inheritance, and attachment to CAT's proven
 * workflowUtils.bonusDamage() helper.
 */
export class SneakAttackParentDamageService {
  #catSpell;
  #claims = new Set();
  #claimOrder = [];
  #stats = {
    requests: 0,
    transactionRequests: 0,
    injections: 0,
    duplicates: 0,
    rejected: 0,
    errors: 0,
    lastEvent: null
  };

  constructor({ catSpell } = {}) {
    this.#catSpell = catSpell;
  }

  async inject(workflow, {
    formula,
    damageType = null,
    ignoreCrit = false,
    source = null,
    transactionId = null,
    idempotencyKey = null
  } = {}) {
    this.#stats.requests += 1;

    if (!workflow || typeof workflow !== "object") {
      return this.#reject("parent-workflow-unavailable");
    }

    const normalizedFormula = normalizeFormula(formula);
    if (!normalizedFormula) {
      return this.#reject("formula-unavailable", { workflowId: workflowIdOf(workflow) });
    }

    if (!Array.isArray(workflow.damageRolls)) {
      return this.#reject("parent-damage-rolls-unavailable", { workflowId: workflowIdOf(workflow) });
    }

    const catStatus = this.#catSpell?.getStatus?.() ?? null;
    if (!catStatus?.capabilities?.bonusDamage) {
      return this.#reject("cat-bonus-damage-unavailable", { workflowId: workflowIdOf(workflow) });
    }

    const workflowId = workflowIdOf(workflow);
    const claimKey = idempotencyKey
      ?? (transactionId && workflowId ? `${workflowId}:${transactionId}` : null);

    if (claimKey && this.#claims.has(claimKey)) {
      this.#stats.duplicates += 1;
      this.#record("duplicate", { claimKey, workflowId, transactionId });
      return {
        injected: false,
        duplicate: true,
        reason: "duplicate",
        idempotencyKey: claimKey,
        workflowId,
        transactionId,
        requestedFormula: normalizedFormula,
        addedRollCount: 0,
        addedRolls: []
      };
    }

    const beforeLength = workflow.damageRolls.length;
    const requestedDamageType = normalizeDamageType(damageType);
    if (claimKey) this.#rememberClaim(claimKey);

    try {
      const options = { ignoreCrit: Boolean(ignoreCrit) };
      if (requestedDamageType) options.damageType = requestedDamageType;
      if (source !== null && source !== undefined && String(source).trim()) options.source = String(source).trim();

      await this.#catSpell.bonusDamage(workflow, normalizedFormula, options);

      const afterLength = workflow.damageRolls.length;
      const addedRolls = workflow.damageRolls
        .slice(beforeLength)
        .map((roll, offset) => rollSnapshot(roll, beforeLength + offset))
        .filter(Boolean);
      const addedRollCount = afterLength - beforeLength;

      if (addedRollCount !== 1) {
        if (claimKey && addedRollCount === 0) this.#releaseClaim(claimKey);
        this.#stats.errors += 1;
        this.#record("unexpected-roll-delta", {
          workflowId,
          transactionId,
          beforeLength,
          afterLength,
          addedRollCount
        });
        return {
          injected: addedRollCount > 0,
          duplicate: false,
          reason: "unexpected-damage-roll-delta",
          idempotencyKey: claimKey,
          workflowId,
          transactionId,
          requestedFormula: normalizedFormula,
          requestedDamageType,
          ignoreCrit: Boolean(ignoreCrit),
          isCritical: Boolean(workflow?.isCritical),
          beforeRollCount: beforeLength,
          afterRollCount: afterLength,
          addedRollCount,
          addedRolls
        };
      }

      this.#stats.injections += 1;
      this.#record("injected", {
        workflowId,
        transactionId,
        claimKey,
        formula: normalizedFormula,
        requestedDamageType,
        effectiveFormula: addedRolls[0]?.formula ?? null,
        effectiveDamageType: addedRolls[0]?.type ?? null,
        isCritical: Boolean(workflow?.isCritical)
      });

      return {
        injected: true,
        duplicate: false,
        reason: null,
        idempotencyKey: claimKey,
        workflowId,
        transactionId,
        requestedFormula: normalizedFormula,
        requestedDamageType,
        ignoreCrit: Boolean(ignoreCrit),
        isCritical: Boolean(workflow?.isCritical),
        beforeRollCount: beforeLength,
        afterRollCount: afterLength,
        addedRollCount,
        addedRolls,
        addedRoll: addedRolls[0] ?? null
      };
    } catch (error) {
      const mutated = workflow.damageRolls.length !== beforeLength;
      if (claimKey && !mutated) this.#releaseClaim(claimKey);
      this.#stats.errors += 1;
      this.#record("error", {
        workflowId,
        transactionId,
        claimKey,
        message: error?.message ?? String(error),
        mutated
      });
      Logger.debug("Sneak Attack parent damage injection failed.", error);
      return {
        injected: false,
        duplicate: false,
        reason: "cat-bonus-damage-error",
        idempotencyKey: claimKey,
        workflowId,
        transactionId,
        requestedFormula: normalizedFormula,
        error: error?.message ?? String(error),
        mutated
      };
    }
  }

  async injectForTransaction(workflow, transaction, options = {}) {
    this.#stats.transactionRequests += 1;
    const snapshot = transactionSnapshot(transaction);
    if (!snapshot?.id) return this.#reject("transaction-unavailable");
    if (snapshot.state !== SNEAK_ATTACK_TRANSACTION_STATES.COMMITTED) {
      return this.#reject("transaction-not-committed", {
        transactionId: snapshot.id,
        transactionState: snapshot.state ?? null
      });
    }

    const workflowId = workflowIdOf(workflow);
    if (snapshot.parentWorkflowId && workflowId !== snapshot.parentWorkflowId) {
      return this.#reject("parent-workflow-mismatch", {
        transactionId: snapshot.id,
        expectedParentWorkflowId: snapshot.parentWorkflowId,
        actualParentWorkflowId: workflowId
      });
    }

    return this.inject(workflow, {
      ...options,
      transactionId: snapshot.id,
      idempotencyKey: options?.idempotencyKey ?? `${workflowId ?? "workflow"}:${snapshot.id}`
    });
  }

  getStatus() {
    const cat = this.#catSpell?.getStatus?.() ?? null;
    return Object.freeze({
      catActive: Boolean(cat?.active),
      bonusDamageAvailable: Boolean(cat?.capabilities?.bonusDamage),
      claimedInjections: this.#claims.size,
      strategy: "caller supplies final formula; CAT owns critical conversion and parent damage-type inheritance"
    });
  }

  getStats() {
    return Object.freeze({ ...this.#stats, status: this.getStatus() });
  }

  #rememberClaim(key) {
    if (!key || this.#claims.has(key)) return;
    this.#claims.add(key);
    this.#claimOrder.push(key);
    const limit = SNEAK_ATTACK_MAX_RECENT_TRANSACTIONS * 4;
    while (this.#claimOrder.length > limit) {
      const oldest = this.#claimOrder.shift();
      if (oldest) this.#claims.delete(oldest);
    }
  }

  #releaseClaim(key) {
    if (!key || !this.#claims.delete(key)) return;
    const index = this.#claimOrder.indexOf(key);
    if (index >= 0) this.#claimOrder.splice(index, 1);
  }

  #reject(reason, details = null) {
    this.#stats.rejected += 1;
    this.#record("rejected", { reason, ...(duplicateSafely(details) ?? {}) });
    return {
      injected: false,
      duplicate: false,
      reason,
      ...(duplicateSafely(details) ?? {})
    };
  }

  #record(type, details = null) {
    this.#stats.lastEvent = Object.freeze({
      at: nowIso(),
      type,
      details: duplicateSafely(details)
    });
  }
}
