import {
  MODULE_ID,
  MOVEMENT_AGENCIES,
  OPERATION_METADATA_KEY,
  PERSISTENT_AREA_ENTRY_PLANS_KEY,
  PERSISTENT_AREA_ENTRY_PLAN_SCHEMA_VERSION,
  PERSISTENT_AREA_RECIPE_SCHEMA_VERSION
} from "../core/constants.js";
import { Logger } from "../core/logger.js";
import { duplicateSafely, randomId } from "../core/utils.js";

const GATE_COMBAT_MODES = new Set(["none", "turn"]);
const GATE_OUTSIDE_MODES = new Set(["none", "occupancy", "movement"]);
const STOP_OUTCOMES = new Set(["never", "success", "failure"]);
const OPERATION_WHENS = new Set(["always", "success", "failure", "unknown"]);
const OPERATION_TYPES = new Set(["applyEffectTemplate", "removeOwnedEffects"]);
const CONDITION_TYPES = new Set(["ownedEffect", "tokenCenterInOwnerRegion"]);

function clone(value) {
  return duplicateSafely(value);
}

function asArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return [...value];
  if (typeof value.values === "function") return [...value.values()];
  return [value];
}

function normalizeString(value) {
  return String(value ?? "").trim();
}

function normalizeAgency(value) {
  return normalizeString(value).toLowerCase();
}

function parseJson(value, fallback = null) {
  if (value && typeof value === "object") return clone(value);
  try {
    const parsed = JSON.parse(String(value ?? ""));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function eventNames() {
  const events = globalThis.CONST?.REGION_EVENTS ?? {};
  return Object.freeze({
    moveIn: events.TOKEN_MOVE_IN ?? "tokenMoveIn",
    moveWithin: events.TOKEN_MOVE_WITHIN ?? "tokenMoveWithin",
    enter: events.TOKEN_ENTER ?? "tokenEnter",
    exit: events.TOKEN_EXIT ?? "tokenExit",
    turnStart: events.TOKEN_TURN_START ?? "tokenTurnStart",
    turnEnd: events.TOKEN_TURN_END ?? "tokenTurnEnd"
  });
}

function activityOutcome(result, tokenUuid) {
  const target = normalizeString(tokenUuid);
  if (!target) return "unknown";
  if (asArray(result?.failedSaves).includes(target)) return "failure";
  if (asArray(result?.saves).includes(target)) return "success";
  if (asArray(result?.missedTargets).includes(target)) return "failure";
  if (asArray(result?.hitTargets).includes(target)) return "success";
  return "unknown";
}

/**
 * Generic persistent-area Region-event runtime.
 *
 * Items provide declarative recipes. This service knows only reusable concepts:
 * native Region events, Activity execution, combat/occupancy/movement gates,
 * and pausing/stopping movement based on a configured Activity outcome.
 */
export class PersistentAreaEventService {
  #socket;
  #authority;
  #activities;
  #lifecycle;
  #geometry;
  #movement;
  #locks = new Map();
  #entryClaims = new Map();
  #consumedEntries = new Map();
  #stats = {
    events: 0,
    routed: 0,
    activities: 0,
    gated: 0,
    occupancyResets: 0,
    movementsPaused: 0,
    movementsStopped: 0,
    entryInterruptionsClaimed: 0,
    entryInterruptionsResolved: 0,
    entryInterruptionHolds: 0,
    errors: 0
  };

  constructor({ socket, authority, activities, lifecycle = null, geometry = null, movement = null }) {
    this.#socket = socket;
    this.#authority = authority;
    this.#activities = activities;
    this.#lifecycle = lifecycle;
    this.#geometry = geometry;
    this.#movement = movement;
    socket.register("persistentArea.regionEvent", payload => this.#processRegionEvent(payload));
  }

  validateRecipe(recipe) {
    const errors = [];
    const source = recipe && typeof recipe === "object" ? recipe : null;
    if (!source) return { valid: false, errors: ["recipe-must-be-object"], recipe: null };

    const schemaVersion = Number(source.schemaVersion ?? PERSISTENT_AREA_RECIPE_SCHEMA_VERSION);
    if (schemaVersion !== PERSISTENT_AREA_RECIPE_SCHEMA_VERSION) errors.push("unsupported-schema-version");

    const gates = source.gates && typeof source.gates === "object" ? source.gates : {};
    for (const [gateId, config] of Object.entries(gates)) {
      if (!normalizeString(gateId)) errors.push("gate-id-must-be-non-empty");
      if (!config || typeof config !== "object") {
        errors.push(`gate-${gateId}-must-be-object`);
        continue;
      }
      const combat = normalizeString(config.combat ?? "none").toLowerCase();
      const outsideCombat = normalizeString(config.outsideCombat ?? "none").toLowerCase();
      if (!GATE_COMBAT_MODES.has(combat)) errors.push(`gate-${gateId}-invalid-combat-mode`);
      if (!GATE_OUTSIDE_MODES.has(outsideCombat)) errors.push(`gate-${gateId}-invalid-outside-mode`);
    }

    const handlers = source.handlers && typeof source.handlers === "object" ? source.handlers : null;
    if (!handlers || !Object.keys(handlers).length) errors.push("handlers-required");
    const supportedEvents = new Set(Object.values(eventNames()));
    for (const [eventName, handler] of Object.entries(handlers ?? {})) {
      if (!normalizeString(eventName)) errors.push("handler-event-must-be-non-empty");
      else if (!supportedEvents.has(eventName)) errors.push(`handler-${eventName}-unsupported-event`);
      if (!handler || typeof handler !== "object") {
        errors.push(`handler-${eventName}-must-be-object`);
        continue;
      }
      const action = handler.activity ?? null;
      if (action != null) {
        if (!action || typeof action !== "object") errors.push(`handler-${eventName}-activity-must-be-object`);
        else {
          if (!normalizeString(action.itemUuid)) errors.push(`handler-${eventName}-itemUuid-required`);
          if (!normalizeString(action.activityReference)) errors.push(`handler-${eventName}-activityReference-required`);
        }
      }
      const gateId = normalizeString(handler.gateId);
      if (gateId && !Object.prototype.hasOwnProperty.call(gates, gateId)) errors.push(`handler-${eventName}-unknown-gate-${gateId}`);

      const movement = handler.movement ?? null;
      if (movement != null) {
        if (!movement || typeof movement !== "object") errors.push(`handler-${eventName}-movement-must-be-object`);
        else {
          const stopOn = normalizeString(movement.stopOn ?? "never").toLowerCase();
          if (!STOP_OUTCOMES.has(stopOn)) errors.push(`handler-${eventName}-invalid-stopOn`);
          if (movement.agencies != null && !Array.isArray(movement.agencies)) errors.push(`handler-${eventName}-agencies-must-be-array`);
          if (movement.entryInterruption != null && typeof movement.entryInterruption !== "boolean") {
            errors.push(`handler-${eventName}-entryInterruption-must-be-boolean`);
          }
          if (movement.entryInterruption === true && eventName !== eventNames().moveIn) {
            errors.push(`handler-${eventName}-entryInterruption-requires-tokenMoveIn`);
          }
          if (movement.entryInterruption === true && movement.pause !== true) {
            errors.push(`handler-${eventName}-entryInterruption-requires-pause`);
          }
        }
      }

      const conditions = Array.isArray(handler.conditions) ? handler.conditions : [];
      if (handler.conditions != null && !Array.isArray(handler.conditions)) errors.push(`handler-${eventName}-conditions-must-be-array`);
      for (const [index, condition] of conditions.entries()) {
        if (!condition || typeof condition !== "object") {
          errors.push(`handler-${eventName}-condition-${index}-must-be-object`);
          continue;
        }
        const type = normalizeString(condition.type);
        if (!CONDITION_TYPES.has(type)) errors.push(`handler-${eventName}-condition-${index}-unsupported-type`);
        if (type === "ownedEffect" && !normalizeString(condition.effectKey)) errors.push(`handler-${eventName}-condition-${index}-effectKey-required`);
        if (condition.exists != null && typeof condition.exists !== "boolean") errors.push(`handler-${eventName}-condition-${index}-exists-must-be-boolean`);
        if (type === "tokenCenterInOwnerRegion" && condition.inside != null && typeof condition.inside !== "boolean") {
          errors.push(`handler-${eventName}-condition-${index}-inside-must-be-boolean`);
        }
      }

      const operations = Array.isArray(handler.operations) ? handler.operations : [];
      if (handler.operations != null && !Array.isArray(handler.operations)) errors.push(`handler-${eventName}-operations-must-be-array`);
      for (const [index, operation] of operations.entries()) {
        if (!operation || typeof operation !== "object") {
          errors.push(`handler-${eventName}-operation-${index}-must-be-object`);
          continue;
        }
        const type = normalizeString(operation.type);
        const when = normalizeString(operation.when ?? "always").toLowerCase();
        if (!OPERATION_TYPES.has(type)) errors.push(`handler-${eventName}-operation-${index}-unsupported-type`);
        if (!OPERATION_WHENS.has(when)) errors.push(`handler-${eventName}-operation-${index}-invalid-when`);
        if (type === "applyEffectTemplate" && !normalizeString(operation.templateEffectUuid)) errors.push(`handler-${eventName}-operation-${index}-templateEffectUuid-required`);
        if ((type === "applyEffectTemplate" || type === "removeOwnedEffects") && !normalizeString(operation.effectKey)) errors.push(`handler-${eventName}-operation-${index}-effectKey-required`);
      }
    }

    if (errors.length) return { valid: false, errors, recipe: null };
    return {
      valid: true,
      errors: [],
      recipe: {
        schemaVersion: PERSISTENT_AREA_RECIPE_SCHEMA_VERSION,
        gates: clone(gates),
        handlers: clone(handlers)
      }
    };
  }

  buildBehavior({ instanceId = null, recipe, name = "AE5E — Persistent Area" } = {}) {
    const validation = this.validateRecipe(recipe);
    if (!validation.valid) return { built: false, reason: "invalid-recipe", errors: validation.errors };

    const resolvedInstanceId = normalizeString(instanceId) || randomId();
    const events = new Set(Object.keys(validation.recipe.handlers));
    const exitEvent = eventNames().exit;
    const usesOccupancy = Object.values(validation.recipe.gates)
      .some(gate => normalizeString(gate?.outsideCombat).toLowerCase() === "occupancy");
    if (usesOccupancy) events.add(exitEvent);
    const usesEntryInterruption = Object.entries(validation.recipe.handlers)
      .some(([eventName, handler]) => eventName === eventNames().moveIn && handler?.movement?.entryInterruption === true);
    if (usesEntryInterruption) events.add(eventNames().moveWithin);

    return {
      built: true,
      instanceId: resolvedInstanceId,
      behavior: {
        name,
        type: `${MODULE_ID}.persistent-area`,
        system: {
          events: [...events],
          instanceId: resolvedInstanceId,
          recipeJson: JSON.stringify(validation.recipe),
          stateJson: JSON.stringify({ gates: {} })
        }
      }
    };
  }

  getRecipe(behavior) {
    const parsed = parseJson(behavior?.system?.recipeJson, null);
    const validation = this.validateRecipe(parsed);
    return validation.valid ? validation.recipe : null;
  }

  getState(behavior) {
    const state = parseJson(behavior?.system?.stateJson, { gates: {} }) ?? { gates: {} };
    state.gates ??= {};
    return state;
  }

  async handleRegionEvent(behavior, event) {
    this.#stats.events += 1;
    if (!event?.user?.isSelf) return { handled: false, reason: "not-event-originator" };
    const token = event?.data?.token ?? null;
    if (!token?.uuid) return { handled: false, reason: "token-unavailable" };

    const recipe = this.getRecipe(behavior);
    if (!recipe) return { handled: false, reason: "invalid-recipe" };
    const eventName = normalizeString(event?.name ?? event?.type);

    // Entry-interruption plans are attached before Foundry starts the native
    // movement. They let the Region event at the geometric boundary claim a
    // short-lived movement hold without running the Activity there. The same
    // native movement continues to the first planned interior checkpoint, where
    // AE5E pauses it and resolves the ORIGINAL tokenMoveIn handler through the
    // ordinary ActivityExecutionService / CAT / Midi path.
    const movement = event?.data?.movement ?? null;
    const planned = await this.#handlePlannedEntryEvent({ behavior, recipe, token, movement, event, eventName });
    if (planned) return planned;

    const handler = recipe.handlers[eventName] ?? null;
    const needsOccupancyReset = eventName === eventNames().exit
      && Object.values(recipe.gates).some(gate => normalizeString(gate?.outsideCombat).toLowerCase() === "occupancy");
    if (!handler && !needsOccupancyReset) return { handled: false, reason: "unconfigured-event", eventName };

    // Only native movement events carrying their own movement payload are
    // eligible for movement pausing. Never borrow stale token.movement data.
    const movementConfig = handler?.movement ?? null;
    let resume = null;
    if (movementConfig?.pause === true && movement && typeof token.pauseMovement === "function") {
      try {
        resume = token.pauseMovement();
        if (resume) this.#stats.movementsPaused += 1;
      } catch {
        resume = null;
      }
    }

    const payload = this.#movementPayload({ behavior, eventName, token, movement, eventUserId: event?.user?.id });

    try {
      const result = await this.#routeRegionEvent(payload);
      if (result?.stopMovement === true && movement && typeof token.stopMovement === "function") {
        try {
          token.stopMovement();
          this.#stats.movementsStopped += 1;
        } catch { /* fail open */ }
        return result;
      }
      if (resume) await resume();
      return result;
    } catch (error) {
      this.#stats.errors += 1;
      if (resume) {
        try { await resume(); } catch { /* fail open */ }
      }
      Logger.error("AE5E persistent-area Region event failed", error);
      throw error;
    }
  }

  getStats() {
    this.#pruneEntryState();
    return Object.freeze({ ...this.#stats, locks: this.#locks.size, pendingEntryInterruptions: this.#entryClaims.size });
  }

  async #handlePlannedEntryEvent({ behavior, recipe, token, movement, event, eventName }) {
    if (!movement || !behavior?.uuid) return null;
    const plan = this.#entryPlanFor(movement, token.uuid);
    if (!plan) return null;

    this.#pruneEntryState();
    const candidates = asArray(plan.entries)
      .filter(entry => entry?.behaviorUuid === behavior.uuid)
      .sort((a, b) => Number(a?.sequence ?? 0) - Number(b?.sequence ?? 0));
    if (!candidates.length) return null;

    const unresolved = candidates.filter(entry => !this.#entryWasConsumed(plan.planId, entry.entryId));
    if (!unresolved.length) return null;

    const reached = unresolved.find(entry => this.#movementReachedPosition(token, movement, entry?.position));
    if (reached) {
      return this.#resolvePlannedEntry({ behavior, recipe, token, movement, event, plan, entry: reached });
    }

    const activeClaim = unresolved
      .map(entry => ({ entry, claim: this.#entryClaims.get(this.#entryKey(plan.planId, entry.entryId)) }))
      .find(record => record.claim);
    if (activeClaim) {
      return {
        handled: true,
        eventName,
        entryInterruption: true,
        pending: true,
        entryId: activeClaim.entry.entryId,
        stopMovement: false
      };
    }

    if (eventName !== eventNames().moveIn) return null;
    const entry = unresolved[0];
    const key = this.#entryKey(plan.planId, entry.entryId);
    const holdId = `${MODULE_ID}.persistent-entry.${entry.entryId}`;
    this.#movement?.acquireInteractionHold?.({
      tokenUuid: token.uuid,
      holdId,
      bypassPlanId: plan.planId,
      message: null,
      broadcast: true
    });
    this.#stats.entryInterruptionHolds += 1;

    const claim = {
      key,
      planId: plan.planId,
      entryId: entry.entryId,
      holdId,
      tokenUuid: token.uuid,
      behaviorUuid: behavior.uuid,
      claimedAt: Date.now(),
      payload: this.#movementPayload({
        behavior,
        eventName: entry.eventName ?? eventNames().moveIn,
        token,
        movement,
        eventUserId: event?.user?.id,
        interactionId: entry.entryId,
        movementDestination: entry?.sourceDestination ?? null
      })
    };
    this.#entryClaims.set(key, claim);
    this.#stats.entryInterruptionsClaimed += 1;

    const finished = movement?.finished;
    if (finished && typeof finished.finally === "function") {
      void finished.finally(() => {
        if (!this.#entryWasConsumed(plan.planId, entry.entryId)) this.#releaseEntryClaim(key);
      }).catch(() => undefined);
    }

    return {
      handled: true,
      eventName,
      entryInterruption: true,
      pending: true,
      entryId: entry.entryId,
      stopMovement: false
    };
  }

  async #resolvePlannedEntry({ behavior, token, movement, event, plan, entry }) {
    const key = this.#entryKey(plan.planId, entry.entryId);
    let claim = this.#entryClaims.get(key) ?? null;
    if (!claim) {
      const holdId = `${MODULE_ID}.persistent-entry.${entry.entryId}`;
      this.#movement?.acquireInteractionHold?.({
        tokenUuid: token.uuid,
        holdId,
        bypassPlanId: plan.planId,
        message: null,
        broadcast: true
      });
      this.#stats.entryInterruptionHolds += 1;
      claim = {
        key,
        planId: plan.planId,
        entryId: entry.entryId,
        holdId,
        tokenUuid: token.uuid,
        behaviorUuid: behavior.uuid,
        claimedAt: Date.now(),
        payload: this.#movementPayload({
          behavior,
          eventName: entry.eventName ?? eventNames().moveIn,
          token,
          movement,
          eventUserId: event?.user?.id,
          interactionId: entry.entryId,
          movementDestination: entry?.sourceDestination ?? null
        })
      };
      this.#entryClaims.set(key, claim);
      this.#stats.entryInterruptionsClaimed += 1;
    }

    // Consume before routing so another same-behavior Region event emitted for
    // this checkpoint cannot execute the same Activity twice. Activity execution
    // still has its own authority-side idempotency key as a second safety layer.
    this.#consumeEntry(plan.planId, entry.entryId);

    let resume = null;
    if (typeof token.pauseMovement === "function") {
      try {
        resume = token.pauseMovement();
        if (resume) this.#stats.movementsPaused += 1;
      } catch {
        resume = null;
      }
    }

    try {
      const result = await this.#routeRegionEvent(claim.payload);
      this.#stats.entryInterruptionsResolved += 1;

      // Operations have completed on the authority client before this point. On
      // failure, a persistent restriction (if configured) therefore exists before
      // the short-lived interaction hold is released. This avoids an unlock gap.
      this.#releaseEntryClaim(key);

      if (result?.stopMovement === true && typeof token.stopMovement === "function") {
        try {
          token.stopMovement();
          this.#stats.movementsStopped += 1;
        } catch { /* fail open */ }
        return { ...result, entryInterruption: true, entryId: entry.entryId };
      }

      if (resume) await resume();
      return { ...result, entryInterruption: true, entryId: entry.entryId };
    } catch (error) {
      this.#stats.errors += 1;
      this.#releaseEntryClaim(key);
      if (resume) {
        try { await resume(); } catch { /* fail open */ }
      }
      Logger.error("AE5E persistent-area planned entry resolution failed", error);
      throw error;
    }
  }

  #movementPayload({ behavior, eventName, token, movement, eventUserId = null, interactionId = null, movementDestination = undefined }) {
    const metadata = movement?.updateOptions?.[OPERATION_METADATA_KEY] ?? null;
    return {
      behaviorUuid: behavior?.uuid ?? null,
      eventName,
      tokenUuid: token?.uuid ?? null,
      movementId: movement?.id ?? null,
      movementMethod: movement?.method ?? null,
      movementDestination: movementDestination === undefined
        ? this.#sanitizeMovementDestination(movement?.destination)
        : this.#sanitizeMovementDestination(movementDestination),
      movementAgency: metadata?.agency ?? null,
      eventUserId: eventUserId ?? globalThis.game?.user?.id ?? null,
      interactionId: normalizeString(interactionId) || null
    };
  }

  #entryPlanFor(movement, tokenUuid) {
    const metadata = movement?.updateOptions?.[OPERATION_METADATA_KEY];
    const plan = metadata?.[PERSISTENT_AREA_ENTRY_PLANS_KEY]?.[tokenUuid];
    if (!plan || Number(plan.schemaVersion) !== PERSISTENT_AREA_ENTRY_PLAN_SCHEMA_VERSION) return null;
    if (!normalizeString(plan.planId) || !Array.isArray(plan.entries)) return null;
    return plan;
  }

  #movementReachedPosition(token, movement, position) {
    if (!position || !Number.isFinite(Number(position.x)) || !Number.isFinite(Number(position.y))) return false;
    const candidates = [
      movement?.destination ?? null,
      asArray(movement?.passed?.waypoints).at(-1) ?? null,
      { x: token?.x, y: token?.y, elevation: token?.elevation }
    ];
    return candidates.some(candidate => {
      if (!candidate) return false;
      if (Number(candidate.x) !== Number(position.x) || Number(candidate.y) !== Number(position.y)) return false;
      return Number(candidate.elevation ?? 0) === Number(position.elevation ?? 0);
    });
  }

  #entryKey(planId, entryId) {
    return `${normalizeString(planId)}:${normalizeString(entryId)}`;
  }

  #entryWasConsumed(planId, entryId) {
    this.#pruneEntryState();
    return this.#consumedEntries.has(this.#entryKey(planId, entryId));
  }

  #consumeEntry(planId, entryId) {
    this.#pruneEntryState();
    this.#consumedEntries.set(this.#entryKey(planId, entryId), Date.now());
  }

  #releaseEntryClaim(key) {
    const claim = this.#entryClaims.get(key);
    if (!claim) return false;
    this.#entryClaims.delete(key);
    this.#movement?.releaseInteractionHold?.({
      tokenUuid: claim.tokenUuid,
      holdId: claim.holdId,
      broadcast: true
    });
    return true;
  }

  #pruneEntryState() {
    const cutoff = Date.now() - 15 * 60 * 1000;
    for (const [key, timestamp] of this.#consumedEntries) {
      if (timestamp < cutoff) this.#consumedEntries.delete(key);
    }
    for (const [key, claim] of this.#entryClaims) {
      if (Number(claim?.claimedAt ?? 0) >= cutoff) continue;
      this.#releaseEntryClaim(key);
    }
  }

  async #routeRegionEvent(payload) {
    const primary = this.#authority?.getPrimaryGm?.()
      ?? [...(globalThis.game?.users ?? [])].find(user => user?.active && user?.isGM)
      ?? null;
    if (!primary) return { handled: false, reason: "no-active-gm" };
    if (globalThis.game?.user?.id === primary.id) return this.#processRegionEvent(payload);
    this.#stats.routed += 1;
    return this.#socket.executeAsUser("persistentArea.regionEvent", primary.id, payload);
  }

  async #processRegionEvent(payload) {
    if (!globalThis.game?.user?.isGM) return { handled: false, reason: "not-gm" };
    const primary = this.#authority?.getPrimaryGm?.() ?? null;
    if (primary && globalThis.game.user.id !== primary.id) return { handled: false, reason: "not-primary-gm" };

    let behavior = null;
    try { behavior = await globalThis.fromUuid?.(payload?.behaviorUuid); } catch { behavior = null; }
    if (!behavior) return { handled: false, reason: "behavior-unavailable" };
    const recipe = this.getRecipe(behavior);
    if (!recipe) return { handled: false, reason: "invalid-recipe" };

    return this.#withLock(behavior.uuid, async () => {
      const eventName = normalizeString(payload?.eventName);
      const tokenUuid = normalizeString(payload?.tokenUuid);
      const handler = recipe.handlers[eventName] ?? null;
      const state = this.getState(behavior);

      if (eventName === eventNames().exit) {
        const changed = this.#resetOccupancyGates(state, recipe, tokenUuid);
        if (changed) {
          await this.#writeState(behavior, state);
          this.#stats.occupancyResets += 1;
        }
        if (!handler) return { handled: true, eventName, occupancyReset: changed, stopMovement: false };
      }

      if (!handler) return { handled: false, reason: "unconfigured-event", eventName };

      // Event-qualification conditions run before any turn/occupancy gate is
      // consumed. This is important for native Region movement sequences where
      // Foundry can emit TOKEN_MOVE_WITHIN for the inside portion of a path that
      // ultimately exits the Region. A non-qualifying event must not consume a
      // later legitimate trigger in the same turn or occupancy.
      const qualifiers = await this.#eventQualifiersPass(handler, behavior, payload);
      if (!qualifiers.passed) {
        return {
          handled: true,
          eventName,
          skipped: true,
          reason: "condition-failed",
          condition: qualifiers.condition,
          stopMovement: false
        };
      }

      const gate = this.#claimGate(state, recipe, handler, payload);
      if (!gate.claimed) {
        this.#stats.gated += 1;
        return { handled: true, eventName, gated: true, gateKey: gate.key, stopMovement: false };
      }
      if (gate.changed) await this.#writeState(behavior, state);

      const context = this.#operationContext(behavior, payload);
      const conditions = await this.#conditionsPass(handler, context);
      if (!conditions.passed) {
        return { handled: true, eventName, skipped: true, reason: "condition-failed", gateKey: gate.key, condition: conditions.condition, stopMovement: false };
      }

      const activity = handler.activity ?? null;
      let result = null;
      let outcome = "unknown";
      if (activity) {
        const idempotencyKey = [
          "persistent-area",
          behavior.uuid,
          eventName,
          tokenUuid,
          gate.claimId ?? payload?.interactionId ?? payload?.movementId ?? gate.key ?? "event"
        ].join(":");

        result = await this.#activities.execute({
          itemUuid: activity.itemUuid,
          activityReference: activity.activityReference,
          targetTokenUuids: [tokenUuid],
          idempotencyKey,
          options: activity.options && typeof activity.options === "object" ? clone(activity.options) : {}
        });

        if (result?.executed !== true) {
          if (gate.changed) {
            this.#releaseGate(state, handler, tokenUuid);
            await this.#writeState(behavior, state);
          }
          return { handled: false, reason: result?.reason ?? "activity-not-executed", eventName, result, stopMovement: false };
        }

        this.#stats.activities += 1;
        outcome = activityOutcome(result, tokenUuid);
      }

      const operations = await this.#runOperations(handler, context, outcome);
      const stopMovement = this.#shouldStopMovement(handler, payload, outcome);
      return { handled: true, eventName, result, outcome, operations, gateKey: gate.key, stopMovement };
    });
  }

  #sanitizeMovementDestination(destination) {
    if (!destination || !Number.isFinite(Number(destination.x)) || !Number.isFinite(Number(destination.y))) return null;
    const result = { x: Number(destination.x), y: Number(destination.y) };
    if (Number.isFinite(Number(destination.elevation))) result.elevation = Number(destination.elevation);
    return result;
  }

  async #eventQualifiersPass(handler, behavior, payload) {
    const conditions = Array.isArray(handler?.conditions) ? handler.conditions : [];
    for (const condition of conditions) {
      if (condition?.type !== "tokenCenterInOwnerRegion") continue;
      const result = await this.#tokenCenterInOwnerRegion(behavior, payload);
      const expected = condition.inside !== false;
      if (result.available !== true) {
        return { passed: false, condition, reason: result.reason ?? "geometry-unavailable" };
      }
      if (Boolean(result.inside) !== expected) return { passed: false, condition };
    }
    return { passed: true, condition: null };
  }

  async #tokenCenterInOwnerRegion(behavior, payload) {
    if (!this.#geometry?.fromRegion || !this.#geometry?.containsPoint) {
      return { available: false, inside: false, reason: "geometry-unavailable" };
    }

    const region = behavior?.region ?? behavior?.parent ?? behavior?.system?.behavior?.parent ?? null;
    if (!region) return { available: false, inside: false, reason: "owner-region-unavailable" };

    let token = null;
    try { token = await globalThis.fromUuid?.(payload?.tokenUuid); } catch { token = null; }
    if (!token) return { available: false, inside: false, reason: "token-unavailable" };

    const regionGeometry = this.#geometry.fromRegion(region);
    if (!regionGeometry) return { available: false, inside: false, reason: "owner-region-geometry-unavailable" };

    const destination = payload?.movementDestination;
    let point = null;
    if (destination && Number.isFinite(Number(destination.x)) && Number.isFinite(Number(destination.y))) {
      const document = token?.document ?? token;
      const gridSize = Number(document?.parent?.grid?.size ?? globalThis.canvas?.grid?.size ?? 100);
      const width = Number(document?.width ?? 1);
      const height = Number(document?.height ?? 1);
      const x = Number(destination.x) + (Number.isFinite(width) ? width : 1) * (Number.isFinite(gridSize) ? gridSize : 100) / 2;
      const y = Number(destination.y) + (Number.isFinite(height) ? height : 1) * (Number.isFinite(gridSize) ? gridSize : 100) / 2;
      point = {
        x,
        y,
        elevation: Number.isFinite(Number(destination.elevation)) ? Number(destination.elevation) : Number(document?.elevation ?? 0)
      };
    } else {
      const tokenGeometry = this.#geometry.fromToken?.(token);
      point = tokenGeometry?.shapes?.find?.(shape => shape?.type === "point") ?? null;
    }

    if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) {
      return { available: false, inside: false, reason: "token-center-unavailable" };
    }

    return { available: true, inside: Boolean(this.#geometry.containsPoint(regionGeometry, point)) };
  }

  #operationContext(behavior, payload) {
    const region = behavior?.region ?? behavior?.parent ?? behavior?.system?.behavior?.parent ?? null;
    return {
      ownerUuid: region?.uuid ?? null,
      ownerInstanceId: normalizeString(behavior?.system?.instanceId) || null,
      behaviorUuid: behavior?.uuid ?? null,
      tokenUuid: normalizeString(payload?.tokenUuid) || null,
      eventName: normalizeString(payload?.eventName) || null
    };
  }

  async #conditionsPass(handler, context) {
    for (const condition of Array.isArray(handler?.conditions) ? handler.conditions : []) {
      // tokenCenterInOwnerRegion is an event qualifier and is intentionally
      // evaluated before gate claim in #eventQualifiersPass.
      if (condition?.type !== "ownedEffect") continue;
      if (!this.#lifecycle?.hasOwnedEffect) return { passed: false, condition, reason: "lifecycle-unavailable" };
      const result = await this.#lifecycle.hasOwnedEffect({
        ownerUuid: context.ownerUuid,
        effectKey: condition.effectKey,
        targetTokenUuid: context.tokenUuid
      });
      const expected = condition.exists !== false;
      if (Boolean(result?.found) !== expected) return { passed: false, condition };
    }
    return { passed: true, condition: null };
  }

  #resolveContext(value, context) {
    if (typeof value === "string") {
      const aliases = {
        "$ownerUuid": context.ownerUuid,
        "$ownerInstanceId": context.ownerInstanceId,
        "$behaviorUuid": context.behaviorUuid,
        "$tokenUuid": context.tokenUuid,
        "$eventName": context.eventName
      };
      return Object.prototype.hasOwnProperty.call(aliases, value) ? aliases[value] : value;
    }
    if (Array.isArray(value)) return value.map(entry => this.#resolveContext(entry, context));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, this.#resolveContext(entry, context)]));
    }
    return value;
  }

  async #runOperations(handler, context, outcome) {
    const results = [];
    const operations = Array.isArray(handler?.operations) ? handler.operations : [];
    for (const configured of operations) {
      const when = normalizeString(configured?.when ?? "always").toLowerCase();
      if (when !== "always" && when !== outcome) continue;
      if (!this.#lifecycle) {
        results.push({ executed: false, reason: "lifecycle-unavailable", type: configured?.type ?? null });
        continue;
      }
      const operation = this.#resolveContext(clone(configured), context);
      if (operation.type === "applyEffectTemplate") {
        const result = await this.#lifecycle.applyEffectTemplate({
          targetTokenUuid: context.tokenUuid,
          templateEffectUuid: operation.templateEffectUuid,
          ownerUuid: context.ownerUuid,
          ownerInstanceId: context.ownerInstanceId,
          effectKey: operation.effectKey,
          originUuid: operation.originUuid ?? null,
          metadata: operation.metadata ?? null,
          omitFields: operation.omitFields ?? [],
          effectPatch: operation.effectPatch ?? null,
          ongoingAction: operation.ongoingAction ?? null,
          voluntaryMovementRestriction: operation.voluntaryMovementRestriction ?? null
        });
        results.push({ type: operation.type, result });
        continue;
      }
      if (operation.type === "removeOwnedEffects") {
        const result = await this.#lifecycle.removeOwnedEffects({
          ownerUuid: context.ownerUuid,
          effectKey: operation.effectKey,
          targetTokenUuid: context.tokenUuid
        });
        results.push({ type: operation.type, result });
      }
    }
    return results;
  }

  #claimGate(state, recipe, handler, payload) {
    const gateId = normalizeString(handler?.gateId);
    if (!gateId) return { claimed: true, changed: false, key: null };
    const config = recipe.gates?.[gateId] ?? null;
    if (!config) return { claimed: true, changed: false, key: null };

    const tokenUuid = normalizeString(payload?.tokenUuid);
    const combat = globalThis.game?.combat ?? null;
    const inCombat = Boolean(combat?.started && Number.isFinite(Number(combat.round)) && Number.isFinite(Number(combat.turn)));
    let key = null;
    if (inCombat && normalizeString(config.combat).toLowerCase() === "turn") {
      key = `combat:${combat.uuid ?? combat.id ?? "combat"}:${Number(combat.round)}:${Number(combat.turn)}`;
    } else if (!inCombat) {
      const outside = normalizeString(config.outsideCombat).toLowerCase();
      if (outside === "occupancy") key = "occupancy";
      if (outside === "movement") key = payload?.movementId ? `movement:${payload.movementId}` : null;
    }
    if (!key) return { claimed: true, changed: false, key: null };

    state.gates ??= {};
    state.gates[gateId] ??= {};

    // Store a unique claim identifier alongside the semantic gate key. The
    // semantic key (for example "occupancy") determines whether this event is
    // gated, while claimId distinguishes a later, newly valid claim after the
    // gate has been released/reset. This prevents ActivityExecutionService's
    // longer-lived idempotency cache from mistaking a new occupancy for the
    // earlier one. Older string-only state remains readable for compatibility.
    const existing = state.gates[gateId][tokenUuid];
    const existingKey = typeof existing === "string" ? existing : normalizeString(existing?.key);
    const existingClaimId = typeof existing === "object" ? normalizeString(existing?.claimId) || null : null;
    if (existingKey === key) {
      return { claimed: false, changed: false, key, claimId: existingClaimId };
    }

    const claimId = randomId();
    state.gates[gateId][tokenUuid] = { key, claimId };
    return { claimed: true, changed: true, key, claimId };
  }

  #releaseGate(state, handler, tokenUuid) {
    const gateId = normalizeString(handler?.gateId);
    if (!gateId || !state.gates?.[gateId]) return false;
    if (!Object.prototype.hasOwnProperty.call(state.gates[gateId], tokenUuid)) return false;
    delete state.gates[gateId][tokenUuid];
    return true;
  }

  #resetOccupancyGates(state, recipe, tokenUuid) {
    let changed = false;
    for (const [gateId, config] of Object.entries(recipe.gates ?? {})) {
      if (normalizeString(config?.outsideCombat).toLowerCase() !== "occupancy") continue;
      if (!state.gates?.[gateId] || !Object.prototype.hasOwnProperty.call(state.gates[gateId], tokenUuid)) continue;
      delete state.gates[gateId][tokenUuid];
      changed = true;
    }
    return changed;
  }

  async #writeState(behavior, state) {
    const stateJson = JSON.stringify(state);
    if (typeof behavior?.update === "function") {
      await behavior.update({ "system.stateJson": stateJson }, { ae5ePersistentAreaState: true });
    } else if (behavior?.system) {
      behavior.system.stateJson = stateJson;
    }
  }

  #shouldStopMovement(handler, payload, outcome) {
    const movement = handler?.movement ?? null;
    if (!movement) return false;
    const stopOn = normalizeString(movement.stopOn ?? "never").toLowerCase();
    if (stopOn === "never" || stopOn !== outcome) return false;

    const configured = Array.isArray(movement.agencies)
      ? new Set(movement.agencies.map(normalizeAgency).filter(Boolean))
      : new Set([MOVEMENT_AGENCIES.VOLUNTARY]);
    if (!configured.size) return false;

    const agency = normalizeAgency(payload?.movementAgency);
    if (agency) return configured.has(agency);

    // When an originating movement has no AE5E metadata, preserve the existing
    // generic heuristic used by the movement framework for ordinary user moves.
    const method = normalizeString(payload?.movementMethod).toLowerCase();
    const ordinaryVoluntary = ["dragging", "keyboard", "hud", "config"].includes(method);
    return ordinaryVoluntary && configured.has(MOVEMENT_AGENCIES.VOLUNTARY);
  }

  async #withLock(key, operation) {
    const normalized = normalizeString(key) || randomId();
    const previous = this.#locks.get(normalized) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(operation);
    this.#locks.set(normalized, run);
    try {
      return await run;
    } finally {
      if (this.#locks.get(normalized) === run) this.#locks.delete(normalized);
    }
  }
}
