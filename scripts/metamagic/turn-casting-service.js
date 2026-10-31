import { MODULE_ID, METAMAGIC_TURN_CASTING_SCHEMA_VERSION } from "../core/constants.js";
import { duplicateSafely } from "../core/utils.js";
import { CASTING_PHASES } from "../casting/casting-phase-service.js";

const clone = value => duplicateSafely(value);
const VALID_ACTIVATIONS = new Set(["action", "bonus", "reaction"]);

function valuesOf(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.contents)) return value.contents;
  if (typeof value.values === "function") return [...value.values()];
  if (typeof value[Symbol.iterator] === "function") return [...value];
  return [];
}

function documentUuid(value) {
  return value?.uuid ?? value?.document?.uuid ?? null;
}

function combatantAt(combat, turnIndex) {
  if (combat?.combatant) return combat.combatant;
  const turns = valuesOf(combat?.turns);
  return turns[turnIndex] ?? null;
}

function combatantsOf(combat) {
  const explicit = valuesOf(combat?.combatants);
  return explicit.length ? explicit : valuesOf(combat?.turns);
}

function startedCombat(combat) {
  if (!combat || combat.started === false) return false;
  const round = Number(combat.round);
  const turn = Number(combat.turn);
  return Number.isInteger(round) && round >= 1 && Number.isInteger(turn) && turn >= 0;
}

function turnSnapshot(combat) {
  if (!startedCombat(combat)) return null;
  const combatId = String(combat.id ?? combat._id ?? "").trim();
  if (!combatId) return null;
  const round = Number(combat.round);
  const turn = Number(combat.turn);
  const combatant = combatantAt(combat, turn);
  const combatantId = String(combatant?.id ?? combatant?._id ?? "").trim();
  if (!combatantId) return null;
  return Object.freeze({
    key: `${combatId}:${round}:${turn}:${combatantId}`,
    combatId,
    combatUuid: combat.uuid ?? null,
    round,
    turn,
    combatantId,
    combatantActorUuid: documentUuid(combatant?.actor) ?? combatant?.actorUuid ?? null,
    combatantTokenUuid: documentUuid(combatant?.token) ?? combatant?.tokenUuid ?? null
  });
}

function actorFlag(actor) {
  return actor?.flags?.[MODULE_ID]?.metamagic?.turnCasting ?? null;
}

/**
 * Maintains a bounded, passive snapshot of committed spell casts for actors
 * that own the Metamagic base declaration. It observes generic casting phases;
 * no individual spell or Metamagic option needs tracking configuration.
 */
export class MetamagicTurnCastingService {
  #phases;
  #declarations;
  #unregister = null;
  #locks = new Map();
  #stats = {
    events: 0,
    ignoredNoBase: 0,
    ignoredNonSpell: 0,
    ignoredAutomationOnly: 0,
    ignoredNoTurn: 0,
    ignoredUnknownActivation: 0,
    writes: 0,
    writeFailures: 0
  };

  constructor({ phases, declarations }) {
    this.#phases = phases;
    this.#declarations = declarations;
  }

  initialize() {
    if (this.#unregister) return;
    this.#unregister = this.#phases.register("metamagic-turn-casting", {
      phases: [CASTING_PHASES.POST_TARGETING],
      priority: -100,
      handler: envelope => this.observe(envelope)
    });
  }

  shutdown() {
    this.#unregister?.();
    this.#unregister = null;
  }

  hasBase(actor) {
    try { return this.#declarations.hasBase(actor) === true; }
    catch { return false; }
  }

  resolveTurn(actor, { workflow = null, facts = null, combat = null } = {}) {
    if (!actor) return null;
    if (combat) return turnSnapshot(combat);

    const combats = this.#startedCombats();
    if (!combats.length) return null;

    const tokenUuid = facts?.casterTokenUuid
      ?? documentUuid(workflow?.token?.document ?? workflow?.token)
      ?? null;

    if (tokenUuid) {
      const matches = combats.filter(entry => combatantsOf(entry).some(combatant =>
        (documentUuid(combatant?.token) ?? combatant?.tokenUuid ?? null) === tokenUuid));
      return matches.length === 1 ? turnSnapshot(matches[0]) : null;
    }

    const actorUuid = facts?.casterActorUuid ?? actor.uuid ?? null;
    if (!actorUuid) return null;
    const matches = combats.filter(entry => combatantsOf(entry).some(combatant =>
      (documentUuid(combatant?.actor) ?? combatant?.actorUuid ?? null) === actorUuid));
    return matches.length === 1 ? turnSnapshot(matches[0]) : null;
  }

  get(actor, options = {}) {
    if (!this.hasBase(actor)) return null;
    const turn = this.resolveTurn(actor, options);
    if (!turn) return null;
    const state = actorFlag(actor);
    if (!state || Number(state.schema) !== METAMAGIC_TURN_CASTING_SCHEMA_VERSION) return null;
    if (state.actorUuid !== actor.uuid || state.turnKey !== turn.key) return null;
    return clone(state);
  }

  inspect(actor, options = {}) {
    const participating = this.hasBase(actor);
    const turn = participating ? this.resolveTurn(actor, options) : null;
    const raw = participating ? actorFlag(actor) : null;
    const current = participating && turn
      && Number(raw?.schema) === METAMAGIC_TURN_CASTING_SCHEMA_VERSION
      && raw?.actorUuid === actor?.uuid
      && raw?.turnKey === turn.key;
    return {
      participating,
      tracked: Boolean(current),
      reason: !participating ? "no-metamagic-base"
        : !turn ? "no-unambiguous-combat-turn"
          : current ? null : "no-current-turn-state",
      turn: clone(turn),
      state: current ? clone(raw) : null
    };
  }

  async observe(envelope) {
    this.#stats.events += 1;
    const workflow = envelope?.workflow;
    const actor = envelope?.actor ?? workflow?.actor ?? null;
    const activity = envelope?.activity ?? workflow?.activity ?? null;
    const item = envelope?.item ?? activity?.item ?? workflow?.item ?? null;

    if (!actor || item?.type !== "spell") {
      this.#stats.ignoredNonSpell += 1;
      return true;
    }
    if (!this.hasBase(actor)) {
      this.#stats.ignoredNoBase += 1;
      return true;
    }
    if (this.#isAutomationOnly(workflow, activity)) {
      this.#stats.ignoredAutomationOnly += 1;
      return true;
    }

    const turn = this.resolveTurn(actor, { workflow, facts: envelope?.facts });
    if (!turn) {
      this.#stats.ignoredNoTurn += 1;
      return true;
    }

    const activation = String(envelope?.facts?.activationType
      ?? activity?.activation?.type
      ?? "").trim().toLowerCase();
    const slot = VALID_ACTIVATIONS.has(activation) ? activation : null;

    const baseSpellLevel = this.#finiteLevel(envelope?.facts?.baseSpellLevel ?? item?.system?.level);
    const castLevel = this.#finiteLevel(envelope?.facts?.castLevel ?? workflow?.castData?.castLevel ?? baseSpellLevel);
    const effectiveLevel = castLevel ?? baseSpellLevel;
    const isLevel1Plus = Number.isFinite(effectiveLevel) && effectiveLevel >= 1;

    if (!slot && !isLevel1Plus) {
      this.#stats.ignoredUnknownActivation += 1;
      return true;
    }

    const actorUuid = actor.uuid ?? null;
    const lockKey = `${actorUuid ?? "actor"}:${turn.key}`;
    return this.#enqueue(lockKey, async () => {
      const current = actorFlag(actor);
      const sameTurn = Number(current?.schema) === METAMAGIC_TURN_CASTING_SCHEMA_VERSION
        && current?.actorUuid === actorUuid
        && current?.turnKey === turn.key;

      const state = sameTurn ? clone(current) : this.#emptyState(actorUuid, turn);
      state.level1PlusCast = Boolean(state.level1PlusCast || isLevel1Plus);

      if (slot) {
        state.casts[slot] = {
          castingId: workflow?.uuid ?? workflow?.id ?? envelope?.eventId ?? null,
          itemUuid: envelope?.facts?.sourceItemUuid ?? item?.uuid ?? null,
          activityId: envelope?.facts?.sourceActivityId ?? activity?.id ?? null,
          baseSpellLevel,
          castLevel,
          committedAt: new Date().toISOString()
        };
      }

      try {
        if (typeof actor.update !== "function") throw new Error("Actor update is unavailable.");
        await actor.update({ [`flags.${MODULE_ID}.metamagic.turnCasting`]: state });
        this.#stats.writes += 1;
      } catch {
        this.#stats.writeFailures += 1;
      }
      return true;
    });
  }

  getStatus() {
    return Object.freeze({
      schemaVersion: METAMAGIC_TURN_CASTING_SCHEMA_VERSION,
      flagPath: `flags.${MODULE_ID}.metamagic.turnCasting`,
      boundedSlots: Object.freeze([...VALID_ACTIVATIONS]),
      initialized: Boolean(this.#unregister),
      ...this.#stats,
      activeLocks: this.#locks.size
    });
  }

  #emptyState(actorUuid, turn) {
    return {
      schema: METAMAGIC_TURN_CASTING_SCHEMA_VERSION,
      actorUuid,
      turnKey: turn.key,
      combatId: turn.combatId,
      combatUuid: turn.combatUuid,
      round: turn.round,
      turn: turn.turn,
      combatantId: turn.combatantId,
      level1PlusCast: false,
      casts: { action: null, bonus: null, reaction: null }
    };
  }

  #startedCombats() {
    const source = valuesOf(globalThis.game?.combats);
    const active = globalThis.game?.combat ?? null;
    if (active && !source.some(entry => (entry?.id ?? entry?._id) === (active.id ?? active._id))) source.push(active);
    return source.filter(startedCombat);
  }

  #finiteLevel(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  #isAutomationOnly(workflow, activity) {
    if (activity?.midiProperties?.automationOnly === true) return true;
    const contexts = [
      workflow?.workflowOptions?.ae5eChildContext,
      workflow?.options?.workflowOptions?.ae5eChildContext,
      workflow?.config?.workflowOptions?.ae5eChildContext
    ];
    return contexts.some(Boolean);
  }

  async #enqueue(key, task) {
    const previous = this.#locks.get(key) ?? Promise.resolve();
    const next = previous.catch(() => null).then(task);
    this.#locks.set(key, next);
    try { return await next; }
    finally { if (this.#locks.get(key) === next) this.#locks.delete(key); }
  }
}
