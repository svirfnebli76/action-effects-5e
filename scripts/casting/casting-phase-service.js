import { randomId } from "../core/utils.js";
import { Logger } from "../core/logger.js";

export const CASTING_PHASES = Object.freeze({
  PRE_CAST: "pre-cast",
  POST_TARGETING: "post-targeting",
  ATTACK_RESOLVED: "attack-resolved",
  DAMAGE_MUTABLE: "damage-mutable"
});

const KNOWN_PHASES = new Set(Object.values(CASTING_PHASES));

function asArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return [...value];
  if (typeof value.values === "function") return [...value.values()];
  return [];
}

function workflowFrom(args) {
  return asArray(args)
    .flatMap(value => [value, value?.workflow, value?.config?.workflow, value?.usage?.workflow])
    .find(value => value?.actor && value?.activity) ?? null;
}

/**
 * Reusable casting lifecycle adapter.
 *
 * It knows Foundry/Midi lifecycle points, not feature names or rules. Consumers
 * register for semantic phases and decide whether they participate. Only phases
 * explicitly marked cancelSafe may propagate a false result back to the source
 * hook; later phases always fail open so a feature prompt cannot unwind an
 * already-progressed casting.
 */
export class CastingPhaseService {
  #handlers = new Map();
  #hooks = [];
  #objectIds = new WeakMap();
  #seenByWorkflow = new WeakMap();
  #stats = {
    events: 0,
    deduped: 0,
    cancellations: 0,
    handlerFailures: 0,
    lastEvent: null
  };

  initialize() {
    if (this.#hooks.length) return;
    const on = (name, phase, cancelSafe = false) => {
      const id = Hooks.on(name, (...args) => this.dispatch(phase, workflowFrom(args), {
        args,
        hook: name,
        cancelSafe
      }));
      this.#hooks.push([name, id]);
    };

    on("midi-qol.preTargetingV2", CASTING_PHASES.PRE_CAST, true);
    on("midi-qol.premades.postPreambleComplete", CASTING_PHASES.POST_TARGETING, false);
    on("midi-qol.hitsChecked", CASTING_PHASES.ATTACK_RESOLVED, false);
    on("midi-qol.preDamageRollComplete", CASTING_PHASES.DAMAGE_MUTABLE, false);
  }

  shutdown() {
    for (const [name, id] of this.#hooks) Hooks.off(name, id);
    this.#hooks.length = 0;
  }

  register(id, { phases = null, priority = 0, handler } = {}) {
    if (typeof id !== "string" || !id.trim()) throw new Error("Casting phase consumer requires a stable id.");
    if (this.#handlers.has(id)) throw new Error(`Casting phase consumer '${id}' is already registered.`);
    if (typeof handler !== "function") throw new Error("Casting phase consumer requires a handler function.");

    const phaseSet = phases == null
      ? null
      : new Set(asArray(phases).map(String));
    if (phaseSet && [...phaseSet].some(phase => !KNOWN_PHASES.has(phase))) {
      throw new Error("Casting phase consumer registered an unknown phase.");
    }

    this.#handlers.set(id, {
      id,
      phases: phaseSet,
      priority: Number(priority) || 0,
      handler
    });
    return () => this.unregister(id);
  }

  unregister(id) {
    return this.#handlers.delete(id);
  }

  getPhases() {
    return { ...CASTING_PHASES };
  }

  getStats() {
    return {
      initialized: this.#hooks.length > 0,
      consumers: [...this.#handlers.values()].map(entry => ({
        id: entry.id,
        priority: entry.priority,
        phases: entry.phases ? [...entry.phases] : null
      })),
      ...this.#stats
    };
  }

  async dispatch(phase, workflow, {
    args = [],
    hook = null,
    cancelSafe = false,
    eventId = null,
    facts = null
  } = {}) {
    if (!KNOWN_PHASES.has(phase)) throw new Error(`Unknown casting phase '${phase}'.`);
    if (!workflow?.actor || !workflow?.activity) return true;

    const identity = eventId ?? this.#eventIdentity(phase, workflow, args);
    if (identity && this.#alreadySeen(workflow, identity)) {
      this.#stats.deduped += 1;
      return true;
    }

    const envelope = Object.freeze({
      phase,
      eventId: identity,
      hook,
      cancelSafe: cancelSafe === true,
      workflow,
      actor: workflow.actor,
      activity: workflow.activity,
      item: workflow.activity?.item ?? workflow.item ?? null,
      facts: Object.freeze({ ...this.#facts(workflow), ...(facts ?? {}) })
    });

    this.#stats.events += 1;
    this.#stats.lastEvent = {
      phase,
      eventId: identity,
      hook,
      cancelSafe: envelope.cancelSafe,
      actorUuid: workflow.actor?.uuid ?? null,
      activityId: workflow.activity?.id ?? null,
      at: new Date().toISOString()
    };

    const handlers = [...this.#handlers.values()]
      .filter(entry => !entry.phases || entry.phases.has(phase))
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));

    for (const entry of handlers) {
      try {
        const result = await entry.handler(envelope);
        if (result === false && envelope.cancelSafe) {
          this.#stats.cancellations += 1;
          return false;
        }
      } catch (error) {
        this.#stats.handlerFailures += 1;
        Logger.warn(`Casting phase consumer '${entry.id}' failed during '${phase}'.`, error);
        if (envelope.cancelSafe) return false;
      }
    }
    return true;
  }

  #eventIdentity(phase, workflow, args) {
    const subject = this.#eventSubject(phase, workflow, args);
    const subjectId = subject && typeof subject === "object" ? this.#weakId(subject) : null;
    if (!subjectId) return JSON.stringify([phase, workflow?.uuid ?? workflow?.id ?? null, randomId()]);
    return JSON.stringify([phase, subjectId]);
  }

  #eventSubject(phase, workflow, args) {
    if (phase === CASTING_PHASES.ATTACK_RESOLVED) {
      return workflow.attackRoll ?? workflow.attackRolls?.at?.(-1)
        ?? asArray(args).find(value => value?.dice || value?.terms) ?? workflow;
    }
    if (phase === CASTING_PHASES.DAMAGE_MUTABLE) {
      return workflow.damageRoll ?? workflow.damageRolls?.at?.(-1)
        ?? asArray(args).find(value => value?.dice || value?.terms) ?? workflow;
    }
    return workflow;
  }

  #weakId(object) {
    let id = this.#objectIds.get(object);
    if (!id) {
      id = randomId();
      this.#objectIds.set(object, id);
    }
    return id;
  }

  #alreadySeen(workflow, eventId) {
    let seen = this.#seenByWorkflow.get(workflow);
    if (!seen) {
      seen = new Set();
      this.#seenByWorkflow.set(workflow, seen);
    }
    if (seen.has(eventId)) return true;
    seen.add(eventId);
    return false;
  }

  #facts(workflow) {
    const combat = globalThis.game?.combat ?? null;
    const actorUuid = workflow.actor?.uuid ?? null;
    const currentActorUuid = combat?.combatant?.actor?.uuid ?? null;
    const castLevel = Number(workflow.castData?.castLevel ?? workflow.castData?.level ?? workflow.item?.system?.level);
    const baseLevel = Number(workflow.item?.system?.level ?? workflow.activity?.item?.system?.level);

    return {
      combatId: combat?.id ?? null,
      round: Number.isFinite(Number(combat?.round)) ? Number(combat.round) : null,
      turn: Number.isFinite(Number(combat?.turn)) ? Number(combat.turn) : null,
      combatantId: combat?.combatant?.id ?? null,
      isCasterTurn: Boolean(combat && actorUuid && currentActorUuid === actorUuid),
      controllerUserId: workflow.userId ?? globalThis.game?.user?.id ?? null,
      casterActorUuid: actorUuid,
      casterTokenUuid: workflow.token?.document?.uuid ?? workflow.token?.uuid ?? null,
      sourceItemUuid: workflow.item?.uuid ?? workflow.activity?.item?.uuid ?? null,
      sourceActivityId: workflow.activity?.id ?? null,
      activationType: workflow.activity?.activation?.type ?? workflow.activity?.system?.activation?.type ?? null,
      baseSpellLevel: Number.isFinite(baseLevel) ? baseLevel : null,
      castLevel: Number.isFinite(castLevel) ? castLevel : null,
      cachedFor: workflow.item?.flags?.dnd5e?.cachedFor ?? workflow.activity?.item?.flags?.dnd5e?.cachedFor ?? null
    };
  }
}
