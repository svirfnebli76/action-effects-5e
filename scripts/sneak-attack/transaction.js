import {
  SNEAK_ATTACK_TRANSACTION_SCHEMA_VERSION,
  SNEAK_ATTACK_TRANSACTION_STATES
} from "../core/constants.js";
import { duplicateSafely, nowIso, randomId } from "../core/utils.js";

function uuidOf(value) {
  return value?.uuid ?? value?.document?.uuid ?? null;
}

function declarationSnapshot(entry) {
  const declaration = duplicateSafely(entry?.declaration ?? {});
  return {
    declaration,
    provenance: {
      sourceItemUuid: entry?.provenance?.sourceItem?.uuid ?? null,
      sourceItemIdentifier: entry?.provenance?.sourceItemIdentifier ?? null,
      effectUuid: entry?.provenance?.effect?.uuid ?? null,
      catSource: entry?.provenance?.catSource ?? entry?.provenance?.catAutomation?.source ?? null
    }
  };
}

function normalizedDice(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function declarationCost(entry) {
  const raw = entry?.declaration?.cost;
  if (raw === undefined || raw === null || raw === "") return { ok: true, cost: 0 };
  const cost = Number(raw);
  if (!Number.isInteger(cost) || cost < 0) return { ok: false, cost: null };
  return { ok: true, cost };
}

export class SneakAttackTransaction {
  constructor({
    id = randomId(),
    actor = null,
    subjectToken = null,
    actorUuid = uuidOf(actor) ?? subjectToken?.actor?.uuid ?? null,
    subjectTokenUuid = uuidOf(subjectToken),
    parentWorkflow = null,
    parentWorkflowId = parentWorkflow?.id ?? null,
    parentActivityUuid = parentWorkflow?.activity?.uuid ?? null,
    sneakTargetUuid = null,
    turn = null,
    declarations = [],
    totalDice = null,
    availabilityAtCreation = null,
    metadata = null
  } = {}) {
    if (!actorUuid) throw new TypeError("SneakAttackTransaction requires an actor UUID.");
    if (!sneakTargetUuid) throw new TypeError("SneakAttackTransaction requires a sneakTarget UUID.");

    this.schema = SNEAK_ATTACK_TRANSACTION_SCHEMA_VERSION;
    this.id = id;
    this.actorUuid = actorUuid;
    this.subjectTokenUuid = subjectTokenUuid;
    this.parentWorkflowId = parentWorkflowId;
    this.parentActivityUuid = parentActivityUuid;
    this.sneakTargetUuid = sneakTargetUuid;
    this.turn = duplicateSafely(turn);
    this.turnKey = turn?.key ?? null;
    this.entries = Array.isArray(declarations) ? [...declarations] : [];
    this.state = SNEAK_ATTACK_TRANSACTION_STATES.OPEN;
    this.selectedDeclarationIds = [];
    this.dice = {
      total: normalizedDice(totalDice),
      spent: 0,
      remaining: normalizedDice(totalDice)
    };
    this.childResults = [];
    this.usage = null;
    this.availabilityAtCreation = duplicateSafely(availabilityAtCreation);
    this.metadata = duplicateSafely(metadata ?? {});
    this.history = [];
    this.createdAt = nowIso();
    this.completedAt = null;
    this.#record("created", {
      turnKey: this.turnKey,
      sneakTargetUuid: this.sneakTargetUuid
    });
  }

  setSelections(ids = [], { totalDice = undefined } = {}) {
    if (this.state !== SNEAK_ATTACK_TRANSACTION_STATES.OPEN) {
      return { updated: false, reason: "transaction-not-open", transaction: this.toJSON() };
    }

    const selected = [...new Set((ids ?? []).filter(Boolean).map(String))];
    const byId = new Map(this.entries.map(entry => [String(entry?.declaration?.id ?? ""), entry]));
    const missingIds = selected.filter(id => !byId.has(id));
    if (missingIds.length) return { updated: false, reason: "declaration-unavailable", missingIds, transaction: this.toJSON() };

    let spent = 0;
    for (const id of selected) {
      const entry = byId.get(id);
      if (entry?.declaration?.type !== "option") {
        return { updated: false, reason: "declaration-not-selectable", declarationId: id, transaction: this.toJSON() };
      }
      const cost = declarationCost(entry);
      if (!cost.ok) return { updated: false, reason: "invalid-declaration-cost", declarationId: id, transaction: this.toJSON() };
      spent += cost.cost;
    }

    const nextTotal = totalDice === undefined ? this.dice.total : normalizedDice(totalDice);
    if (totalDice !== undefined && nextTotal === null && totalDice !== null) {
      return { updated: false, reason: "invalid-total-dice", transaction: this.toJSON() };
    }
    if (nextTotal !== null && spent > nextTotal) {
      return { updated: false, reason: "insufficient-dice", totalDice: nextTotal, spentDice: spent, transaction: this.toJSON() };
    }

    this.selectedDeclarationIds = selected;
    this.dice = {
      total: nextTotal,
      spent,
      remaining: nextTotal === null ? null : nextTotal - spent
    };
    this.#record("selections", {
      selectedDeclarationIds: [...selected],
      dice: { ...this.dice }
    });
    return { updated: true, reason: null, transaction: this.toJSON() };
  }

  recordChildResult(declarationId, outcome) {
    const result = {
      declarationId: declarationId ?? null,
      outcome: duplicateSafely(outcome),
      recordedAt: nowIso()
    };
    this.childResults.push(result);
    this.#record("child-result", result);
    return duplicateSafely(result);
  }

  commitUsage(receipt) {
    this.usage = duplicateSafely(receipt);
    this.state = SNEAK_ATTACK_TRANSACTION_STATES.COMMITTED;
    this.completedAt = nowIso();
    this.#record("committed", this.usage);
    return this.toJSON();
  }

  block(reason, details = null) {
    this.state = SNEAK_ATTACK_TRANSACTION_STATES.BLOCKED;
    this.completedAt = nowIso();
    this.#record("blocked", { reason, ...(duplicateSafely(details) ?? {}) });
    return this.toJSON();
  }

  decline(reason = "do-not-use") {
    if (this.state !== SNEAK_ATTACK_TRANSACTION_STATES.OPEN) return this.toJSON();
    this.state = SNEAK_ATTACK_TRANSACTION_STATES.DECLINED;
    this.completedAt = nowIso();
    this.#record("declined", { reason });
    return this.toJSON();
  }

  toJSON() {
    return {
      schema: this.schema,
      id: this.id,
      actorUuid: this.actorUuid,
      subjectTokenUuid: this.subjectTokenUuid,
      parentWorkflowId: this.parentWorkflowId,
      parentActivityUuid: this.parentActivityUuid,
      sneakTargetUuid: this.sneakTargetUuid,
      turnKey: this.turnKey,
      turn: duplicateSafely(this.turn),
      state: this.state,
      declarations: this.entries.map(declarationSnapshot),
      selectedDeclarationIds: [...this.selectedDeclarationIds],
      dice: { ...this.dice },
      childResults: duplicateSafely(this.childResults),
      usage: duplicateSafely(this.usage),
      availabilityAtCreation: duplicateSafely(this.availabilityAtCreation),
      metadata: duplicateSafely(this.metadata),
      createdAt: this.createdAt,
      completedAt: this.completedAt,
      history: duplicateSafely(this.history)
    };
  }

  #record(type, details = null) {
    this.history.push({ at: nowIso(), type, details: duplicateSafely(details) });
  }
}
