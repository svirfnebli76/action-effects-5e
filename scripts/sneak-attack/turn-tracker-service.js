import {
  MODULE_ID,
  SNEAK_ATTACK_USAGE_FLAG,
  SNEAK_ATTACK_USAGE_SCHEMA_VERSION
} from "../core/constants.js";
import { duplicateSafely, nowIso } from "../core/utils.js";

function documentUuid(value) {
  return value?.uuid ?? value?.document?.uuid ?? null;
}

function combatantAt(combat, turnIndex) {
  if (combat?.combatant) return combat.combatant;
  const turns = combat?.turns;
  if (Array.isArray(turns)) return turns[turnIndex] ?? null;
  if (typeof turns?.at === "function") return turns.at(turnIndex) ?? null;
  return null;
}

function actorUsage(actor) {
  try {
    return actor?.getFlag?.(MODULE_ID, SNEAK_ATTACK_USAGE_FLAG) ?? null;
  } catch {
    return actor?.flags?.[MODULE_ID]?.[SNEAK_ATTACK_USAGE_FLAG] ?? null;
  }
}

/**
 * Tracks the generic Sneak Attack family's once-per-current-combat-turn usage.
 *
 * The authoritative key is the active Foundry combat turn, not merely round:
 * combat + round + turn index + active combatant identity. The tracked actor
 * may be different from the active combatant (for example, an off-turn attack).
 *
 * Outside combat there is no authoritative Foundry turn, so the service is
 * intentionally untracked and does not persist a usage marker.
 */
export class SneakAttackTurnTrackerService {
  #locks = new Map();
  #stats = {
    turnResolutions: 0,
    inspections: 0,
    commitRequests: 0,
    commits: 0,
    duplicateCommits: 0,
    blockedAlreadyUsed: 0,
    blockedTurnChanged: 0,
    untrackedCommits: 0,
    writeFailures: 0
  };

  resolveTurn(combat = globalThis.game?.combat ?? null) {
    this.#stats.turnResolutions += 1;
    if (!combat || combat.started === false) return null;

    const combatId = String(combat.id ?? combat._id ?? "").trim();
    const round = Number(combat.round);
    const turn = Number(combat.turn);
    if (!combatId || !Number.isInteger(round) || round < 1 || !Number.isInteger(turn) || turn < 0) return null;

    const combatant = combatantAt(combat, turn);
    const combatantId = String(combatant?.id ?? combatant?._id ?? "").trim();
    if (!combatantId) return null;

    const snapshot = {
      key: `${combatId}:${round}:${turn}:${combatantId}`,
      combatId,
      combatUuid: combat.uuid ?? null,
      round,
      turn,
      combatantId,
      combatantActorUuid: documentUuid(combatant?.actor) ?? combatant?.actorUuid ?? null,
      combatantTokenUuid: documentUuid(combatant?.token) ?? combatant?.tokenUuid ?? null
    };
    return Object.freeze(snapshot);
  }

  inspect(actor, { combat = globalThis.game?.combat ?? null, turn = undefined } = {}) {
    this.#stats.inspections += 1;
    if (!actor) {
      return {
        ok: false,
        available: false,
        tracked: false,
        reason: "actor-unavailable",
        turn: null,
        usage: null
      };
    }

    const currentTurn = turn === undefined ? this.resolveTurn(combat) : turn;
    const usage = actorUsage(actor);
    if (!currentTurn) {
      return {
        ok: true,
        available: true,
        tracked: false,
        reason: "outside-combat-untracked",
        turn: null,
        usage: duplicateSafely(usage)
      };
    }

    const usedThisTurn = usage?.turnKey === currentTurn.key;
    return {
      ok: true,
      available: !usedThisTurn,
      tracked: true,
      reason: usedThisTurn ? "already-committed-this-turn" : null,
      turn: duplicateSafely(currentTurn),
      usage: duplicateSafely(usage),
      usedThisTurn
    };
  }

  isAvailable(actor, options = {}) {
    return this.inspect(actor, options).available === true;
  }

  async commit(actor, {
    transactionId,
    combat = globalThis.game?.combat ?? null,
    expectedTurnKey = undefined
  } = {}) {
    this.#stats.commitRequests += 1;
    if (!actor) return { committed: false, tracked: false, reason: "actor-unavailable", turn: null, usage: null };
    if (!transactionId) return { committed: false, tracked: false, reason: "transaction-id-required", turn: null, usage: null };

    const turn = this.resolveTurn(combat);
    const currentKey = turn?.key ?? null;
    if (expectedTurnKey !== undefined && expectedTurnKey !== currentKey) {
      this.#stats.blockedTurnChanged += 1;
      return {
        committed: false,
        tracked: Boolean(turn),
        reason: "turn-changed",
        expectedTurnKey,
        currentTurnKey: currentKey,
        turn: duplicateSafely(turn),
        usage: duplicateSafely(actorUsage(actor))
      };
    }

    if (!turn) {
      this.#stats.commits += 1;
      this.#stats.untrackedCommits += 1;
      return {
        committed: true,
        tracked: false,
        duplicate: false,
        reason: "outside-combat-untracked",
        turn: null,
        usage: null
      };
    }

    const actorUuid = documentUuid(actor) ?? actor?.id ?? "actor";
    const lockKey = `${actorUuid}:${turn.key}`;
    return this.#enqueue(lockKey, async () => {
      const existing = actorUsage(actor);
      if (existing?.turnKey === turn.key) {
        if (existing?.transactionId === transactionId) {
          this.#stats.duplicateCommits += 1;
          return {
            committed: true,
            tracked: true,
            duplicate: true,
            reason: "already-committed-by-transaction",
            turn: duplicateSafely(turn),
            usage: duplicateSafely(existing)
          };
        }
        this.#stats.blockedAlreadyUsed += 1;
        return {
          committed: false,
          tracked: true,
          duplicate: false,
          reason: "already-committed-this-turn",
          turn: duplicateSafely(turn),
          usage: duplicateSafely(existing)
        };
      }

      const usage = {
        schema: SNEAK_ATTACK_USAGE_SCHEMA_VERSION,
        transactionId,
        actorUuid: documentUuid(actor),
        turnKey: turn.key,
        combatId: turn.combatId,
        combatUuid: turn.combatUuid,
        round: turn.round,
        turn: turn.turn,
        combatantId: turn.combatantId,
        combatantActorUuid: turn.combatantActorUuid,
        combatantTokenUuid: turn.combatantTokenUuid,
        committedAt: nowIso()
      };

      try {
        if (typeof actor.setFlag !== "function") throw new Error("Actor setFlag is unavailable.");
        await actor.setFlag(MODULE_ID, SNEAK_ATTACK_USAGE_FLAG, usage);
      } catch (error) {
        this.#stats.writeFailures += 1;
        return {
          committed: false,
          tracked: true,
          duplicate: false,
          reason: "usage-write-failed",
          error,
          turn: duplicateSafely(turn),
          usage: null
        };
      }

      this.#stats.commits += 1;
      return {
        committed: true,
        tracked: true,
        duplicate: false,
        reason: null,
        turn: duplicateSafely(turn),
        usage: duplicateSafely(usage)
      };
    });
  }

  getStatus() {
    return Object.freeze({
      schemaVersion: SNEAK_ATTACK_USAGE_SCHEMA_VERSION,
      flagScope: MODULE_ID,
      flagKey: SNEAK_ATTACK_USAGE_FLAG,
      turnKeyParts: Object.freeze(["combatId", "round", "turn", "combatantId"]),
      outsideCombatPolicy: "untracked"
    });
  }

  getStats() {
    return Object.freeze({ ...this.#stats, activeLocks: this.#locks.size, status: this.getStatus() });
  }

  async #enqueue(key, task) {
    const previous = this.#locks.get(key) ?? Promise.resolve();
    const next = previous.catch(() => null).then(task);
    this.#locks.set(key, next);
    try {
      return await next;
    } finally {
      if (this.#locks.get(key) === next) this.#locks.delete(key);
    }
  }
}
