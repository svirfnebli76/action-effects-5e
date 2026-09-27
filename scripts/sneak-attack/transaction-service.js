import {
  SNEAK_ATTACK_MAX_RECENT_TRANSACTIONS,
  SNEAK_ATTACK_TRANSACTION_STATES
} from "../core/constants.js";
import { duplicateSafely } from "../core/utils.js";
import { SneakAttackTransaction } from "./transaction.js";

function uuidOf(value) {
  return value?.uuid ?? value?.document?.uuid ?? null;
}

export class SneakAttackTransactionService {
  #turns;
  #transactions = new Map();
  #actors = new Map();
  #recent = [];
  #stats = {
    created: 0,
    selectionUpdates: 0,
    childResults: 0,
    commitRequests: 0,
    commits: 0,
    commitBlocks: 0,
    declines: 0,
    turnChangedBlocks: 0,
    alreadyUsedBlocks: 0
  };

  constructor({ turns }) {
    this.#turns = turns;
  }

  create({
    actor = null,
    subjectToken = null,
    parentWorkflow = null,
    parentWorkflowId = null,
    parentActivityUuid = null,
    sneakTarget = null,
    sneakTargetUuid = null,
    declarations = [],
    totalDice = null,
    combat = globalThis.game?.combat ?? null,
    metadata = null,
    id = undefined
  } = {}) {
    const resolvedActor = actor ?? subjectToken?.actor ?? null;
    const actorUuid = uuidOf(resolvedActor);
    const targetUuid = sneakTargetUuid ?? uuidOf(sneakTarget);
    if (!resolvedActor || !actorUuid) return { created: false, reason: "actor-unavailable", transaction: null };
    if (!targetUuid) return { created: false, reason: "sneak-target-unavailable", transaction: null };

    const turn = this.#turns.resolveTurn(combat);
    const availability = this.#turns.inspect(resolvedActor, { combat, turn });
    let transaction;
    try {
      transaction = new SneakAttackTransaction({
        ...(id ? { id } : {}),
        actor: resolvedActor,
        subjectToken,
        actorUuid,
        parentWorkflow,
        parentWorkflowId: parentWorkflowId ?? parentWorkflow?.id ?? null,
        parentActivityUuid: parentActivityUuid ?? parentWorkflow?.activity?.uuid ?? null,
        sneakTargetUuid: targetUuid,
        turn,
        declarations,
        totalDice,
        availabilityAtCreation: availability,
        metadata
      });
    } catch (error) {
      return { created: false, reason: "transaction-construction-failed", error, transaction: null };
    }

    this.#transactions.set(transaction.id, transaction);
    this.#actors.set(transaction.id, resolvedActor);
    this.#stats.created += 1;
    this.#trimMaps();
    return { created: true, reason: null, transaction: transaction.toJSON() };
  }

  setSelections(transactionId, selectedDeclarationIds, options = {}) {
    const transaction = this.#transactions.get(transactionId);
    if (!transaction) return { updated: false, reason: "transaction-not-found", transaction: null };
    const result = transaction.setSelections(selectedDeclarationIds, options);
    if (result.updated) this.#stats.selectionUpdates += 1;
    return result;
  }

  recordChildOutcome(transactionId, declarationId, outcome) {
    const transaction = this.#transactions.get(transactionId);
    if (!transaction) return { recorded: false, reason: "transaction-not-found", result: null };
    const result = transaction.recordChildResult(declarationId, outcome);
    this.#stats.childResults += 1;
    return { recorded: true, reason: null, result, transaction: transaction.toJSON() };
  }

  canCommit(transactionId, { actor = null, combat = globalThis.game?.combat ?? null } = {}) {
    const transaction = this.#transactions.get(transactionId);
    if (!transaction) return { ok: false, available: false, reason: "transaction-not-found", transaction: null };
    if (transaction.state !== SNEAK_ATTACK_TRANSACTION_STATES.OPEN) {
      return { ok: true, available: false, reason: "transaction-not-open", transaction: transaction.toJSON() };
    }

    const currentTurn = this.#turns.resolveTurn(combat);
    const currentKey = currentTurn?.key ?? null;
    if (currentKey !== transaction.turnKey) {
      return {
        ok: true,
        available: false,
        reason: "turn-changed",
        expectedTurnKey: transaction.turnKey,
        currentTurnKey: currentKey,
        transaction: transaction.toJSON()
      };
    }

    const resolvedActor = actor ?? this.#actors.get(transactionId) ?? null;
    const availability = this.#turns.inspect(resolvedActor, { combat, turn: currentTurn });
    return { ...availability, transaction: transaction.toJSON() };
  }

  async commitOnOk(transactionId, { actor = null, combat = globalThis.game?.combat ?? null } = {}) {
    this.#stats.commitRequests += 1;
    const transaction = this.#transactions.get(transactionId);
    if (!transaction) return { committed: false, reason: "transaction-not-found", transaction: null, usage: null };

    if (transaction.state === SNEAK_ATTACK_TRANSACTION_STATES.COMMITTED) {
      return {
        committed: true,
        duplicate: true,
        reason: "transaction-already-committed",
        transaction: transaction.toJSON(),
        usage: duplicateSafely(transaction.usage)
      };
    }
    if (transaction.state !== SNEAK_ATTACK_TRANSACTION_STATES.OPEN) {
      return { committed: false, reason: "transaction-not-open", transaction: transaction.toJSON(), usage: duplicateSafely(transaction.usage) };
    }

    const currentTurn = this.#turns.resolveTurn(combat);
    const currentKey = currentTurn?.key ?? null;
    if (currentKey !== transaction.turnKey) {
      this.#stats.commitBlocks += 1;
      this.#stats.turnChangedBlocks += 1;
      transaction.block("turn-changed", {
        expectedTurnKey: transaction.turnKey,
        currentTurnKey: currentKey
      });
      this.#archive(transaction);
      return {
        committed: false,
        reason: "turn-changed",
        expectedTurnKey: transaction.turnKey,
        currentTurnKey: currentKey,
        transaction: transaction.toJSON(),
        usage: null
      };
    }

    const resolvedActor = actor ?? this.#actors.get(transactionId) ?? null;
    const receipt = await this.#turns.commit(resolvedActor, {
      transactionId,
      combat,
      expectedTurnKey: transaction.turnKey
    });

    if (!receipt?.committed) {
      this.#stats.commitBlocks += 1;
      if (receipt?.reason === "already-committed-this-turn") this.#stats.alreadyUsedBlocks += 1;
      if (receipt?.reason === "turn-changed") this.#stats.turnChangedBlocks += 1;
      transaction.block(receipt?.reason ?? "usage-commit-failed", { usage: receipt });
      this.#archive(transaction);
      return {
        committed: false,
        reason: receipt?.reason ?? "usage-commit-failed",
        transaction: transaction.toJSON(),
        usage: duplicateSafely(receipt)
      };
    }

    transaction.commitUsage(receipt);
    this.#stats.commits += 1;
    this.#archive(transaction);
    return {
      committed: true,
      duplicate: Boolean(receipt.duplicate),
      reason: receipt.reason ?? null,
      transaction: transaction.toJSON(),
      usage: duplicateSafely(receipt)
    };
  }

  decline(transactionId, { reason = "do-not-use" } = {}) {
    const transaction = this.#transactions.get(transactionId);
    if (!transaction) return { declined: false, reason: "transaction-not-found", transaction: null };
    if (transaction.state !== SNEAK_ATTACK_TRANSACTION_STATES.OPEN) {
      return { declined: false, reason: "transaction-not-open", transaction: transaction.toJSON() };
    }
    transaction.decline(reason);
    this.#stats.declines += 1;
    this.#archive(transaction);
    return { declined: true, reason: null, transaction: transaction.toJSON() };
  }

  get(transactionId) {
    return this.#transactions.get(transactionId)?.toJSON?.() ?? null;
  }

  getRecent() {
    return this.#recent.map(entry => duplicateSafely(entry));
  }

  getStatus() {
    return Object.freeze({
      activeTransactions: [...this.#transactions.values()].filter(transaction => transaction.state === SNEAK_ATTACK_TRANSACTION_STATES.OPEN).length,
      retainedTransactions: this.#transactions.size,
      recentTransactions: this.#recent.length,
      turnTracker: this.#turns?.getStatus?.() ?? null
    });
  }

  getStats() {
    return Object.freeze({ ...this.#stats, status: this.getStatus() });
  }

  #archive(transaction) {
    const snapshot = transaction.toJSON();
    this.#recent.unshift(snapshot);
    if (this.#recent.length > SNEAK_ATTACK_MAX_RECENT_TRANSACTIONS) this.#recent.length = SNEAK_ATTACK_MAX_RECENT_TRANSACTIONS;
  }

  #trimMaps() {
    const max = SNEAK_ATTACK_MAX_RECENT_TRANSACTIONS * 2;
    if (this.#transactions.size <= max) return;
    for (const [id, transaction] of this.#transactions) {
      if (transaction.state === SNEAK_ATTACK_TRANSACTION_STATES.OPEN) continue;
      this.#transactions.delete(id);
      this.#actors.delete(id);
      if (this.#transactions.size <= max) break;
    }
  }
}
