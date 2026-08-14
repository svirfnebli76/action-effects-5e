import {
  MODULE_ID,
  MOVEMENT_ACTION_IDS
} from "../core/constants.js";
import { duplicateSafely } from "../core/utils.js";
import { Logger } from "../core/logger.js";

const COST_MODIFIER_ACTION_PREFIX = `${MODULE_ID}.cost.`;
const EPSILON = 1e-6;

function actionsCollection() {
  return globalThis.CONFIG?.Token?.movement?.actions ?? null;
}

function getConfiguredAction(actionId) {
  if (!actionId) return null;
  const actions = actionsCollection();
  return actions?.get?.(actionId) ?? actions?.[actionId] ?? null;
}

function setConfiguredAction(actionId, descriptor) {
  const actions = actionsCollection();
  if (!actions) throw new Error("Foundry Token movement actions are not available yet.");
  if (typeof actions.set === "function") actions.set(actionId, descriptor);
  else actions[actionId] = descriptor;
}

function isCompatibleNoCostAction(descriptor) {
  return Boolean(descriptor)
    && descriptor.canSelect === false
    && descriptor.measure !== false
    && Number(descriptor.costMultiplier) === 0
    && descriptor.teleport !== true;
}

function deleteConfiguredAction(actionId, expected = null) {
  const actions = actionsCollection();
  if (!actions) return false;
  const current = actions?.get?.(actionId) ?? actions?.[actionId];
  if (expected && current !== expected) return false;
  if (typeof actions.delete === "function") return actions.delete(actionId);
  if (!Object.prototype.hasOwnProperty.call(actions, actionId)) return false;
  delete actions[actionId];
  return true;
}

function tokenDocument(subject) {
  const candidate = subject?.document ?? subject;
  const TokenDocument = globalThis.foundry?.documents?.TokenDocument;
  if (TokenDocument && candidate instanceof TokenDocument) return candidate;
  if (candidate && typeof candidate === "object" && Array.isArray(candidate.movementHistory)) return candidate;
  throw new TypeError("Movement accounting requires a TokenDocument or Token placeable.");
}

function finiteNonnegative(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function waypointCost(waypoint) {
  return finiteNonnegative(waypoint?.cost, 0);
}

function sumWaypointCosts(waypoints = []) {
  return waypoints.reduce((total, waypoint) => total + waypointCost(waypoint), 0);
}

function movementKeys(movement = {}) {
  const ids = new Set();
  const subpaths = new Set();
  const addId = (value) => {
    if (typeof value === "string" && value.length) ids.add(value);
  };
  const addSubpath = (value) => {
    if (typeof value === "string" && value.length) subpaths.add(value);
  };

  addId(movement?.id);
  addSubpath(movement?.subpathId);
  addSubpath(movement?.origin?.subpathId);
  addSubpath(movement?.destination?.subpathId);

  addId(movement?.origin?.movementId);
  addId(movement?.destination?.movementId);

  // Restrict matching to the current movement/subpath. `movement.history.recorded`
  // can contain the Token's earlier movement history; importing every ID from it
  // would incorrectly report the whole turn as this transaction's cost.
  const collections = [movement?.passed?.waypoints];
  for (const collection of collections) {
    if (!Array.isArray(collection)) continue;
    for (const waypoint of collection) {
      addId(waypoint?.movementId);
      addSubpath(waypoint?.subpathId);
    }
  }

  return { ids, subpaths };
}

function currentMovementCost(history, movement) {
  if (!movement || typeof movement !== "object") return null;
  const { ids, subpaths } = movementKeys(movement);
  const matching = history.filter((waypoint) => (
    (waypoint?.movementId && ids.has(waypoint.movementId))
    || (waypoint?.subpathId && subpaths.has(waypoint.subpathId))
  ));
  if (matching.length) return sumWaypointCosts(matching);

  // During pre-move / move hooks Foundry may expose a measured current subpath
  // before that subpath has been committed to TokenDocument.movementHistory.
  // `passed.waypoints` contains already-traversed measured waypoints; never use
  // pending waypoints here because they have not yet consumed movement.
  const passed = Array.isArray(movement?.passed?.waypoints) ? movement.passed.waypoints : [];
  const measuredPassed = passed.filter((waypoint) => Number.isFinite(Number(waypoint?.cost)));
  return measuredPassed.length ? sumWaypointCosts(measuredPassed) : null;
}

function sanitizeModifierId(id) {
  const raw = String(id ?? "").trim();
  if (!raw) throw new TypeError("Movement cost modifier IDs must be non-empty strings.");
  if (!/^[A-Za-z0-9._-]+$/.test(raw)) {
    throw new TypeError("Movement cost modifier IDs may contain only letters, numbers, dots, underscores, and hyphens.");
  }
  return raw.startsWith(COST_MODIFIER_ACTION_PREFIX) ? raw : `${COST_MODIFIER_ACTION_PREFIX}${raw}`;
}

function defaultCostFunctionFor(descriptor = {}) {
  const multiplier = Number.isFinite(Number(descriptor?.costMultiplier)) ? Number(descriptor.costMultiplier) : 1;
  return (baseCost) => finiteNonnegative(baseCost) * multiplier;
}

function cloneActionPresentation(base = {}) {
  const descriptor = {};
  for (const key of [
    "deriveTerrainDifficulty",
    "getAnimationOptions",
    "icon",
    "img",
    "measure",
    "order",
    "speedMultiplier",
    "teleport",
    "terrainAction",
    "visualize",
    "walls"
  ]) {
    if (base?.[key] !== undefined) descriptor[key] = base[key];
  }
  return descriptor;
}

export class MovementAccountingService {
  #initialized = false;
  #ownedActions = new Map();
  #costModifiers = new Map();

  initialize() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#registerNoCostAction();
    Logger.info("Movement accounting initialized with Foundry TokenDocument.movementHistory as the sole movement-resource ledger.");
  }

  ensureRegistered() {
    if (!this.#initialized) this.initialize();
    const current = getConfiguredAction(MOVEMENT_ACTION_IDS.NO_COST);
    const owned = this.#ownedActions.get(MOVEMENT_ACTION_IDS.NO_COST);
    if (!current) this.#registerNoCostAction();
    else if (current !== owned) {
      if (!isCompatibleNoCostAction(current)) {
        throw new Error(`Movement action '${MOVEMENT_ACTION_IDS.NO_COST}' is already registered with incompatible behavior.`);
      }
      // Foundry or another compatibility layer may normalize the descriptor
      // after registration. Adopt the compatible live descriptor rather than
      // treating object identity as proof of a collision.
      this.#ownedActions.set(MOVEMENT_ACTION_IDS.NO_COST, current);
    }

    for (const [actionId, config] of this.#costModifiers) {
      const live = getConfiguredAction(actionId);
      if (!live) this.#registerModifierAction(actionId, config);
      else if (live !== this.#ownedActions.get(actionId)) this.#ownedActions.set(actionId, live);
    }
  }

  shutdown() {
    for (const [actionId, descriptor] of this.#ownedActions) deleteConfiguredAction(actionId, descriptor);
    this.#ownedActions.clear();
    this.#costModifiers.clear();
    this.#initialized = false;
  }

  get noCostActionId() {
    return MOVEMENT_ACTION_IDS.NO_COST;
  }

  getHistorySnapshot(subject) {
    const document = tokenDocument(subject);
    return duplicateSafely(document.movementHistory ?? []);
  }

  getHistorySummary(subject, movement = null) {
    const document = tokenDocument(subject);
    const history = Array.isArray(document.movementHistory) ? document.movementHistory : [];
    const totalCost = sumWaypointCosts(history);
    const movementCost = currentMovementCost(history, movement);
    return Object.freeze({
      source: "TokenDocument.movementHistory",
      waypointCount: history.length,
      totalCost,
      movementCost,
      lastMovementId: history.at(-1)?.movementId ?? null,
      lastSubpathId: history.at(-1)?.subpathId ?? null,
      lastAction: history.at(-1)?.action ?? null
    });
  }

  getHistoryCost(subject) {
    return this.getHistorySummary(subject).totalCost;
  }

  applyNoCostToWaypoints(waypoints, { clone = true } = {}) {
    if (!Array.isArray(waypoints)) throw new TypeError("Waypoints must be an array.");
    this.ensureRegistered();
    const output = clone ? duplicateSafely(waypoints) : waypoints;
    for (const waypoint of output) {
      if (waypoint && typeof waypoint === "object") waypoint.action = MOVEMENT_ACTION_IDS.NO_COST;
    }
    return output;
  }

  applyNoCostToInstruction(instruction, { clone = false } = {}) {
    if (!instruction || typeof instruction !== "object") throw new TypeError("Movement instruction must be an object.");
    const output = clone ? duplicateSafely(instruction) : instruction;
    if (Array.isArray(output.waypoints)) this.applyNoCostToWaypoints(output.waypoints, { clone: false });
    if (output.destination && typeof output.destination === "object") output.destination.action = MOVEMENT_ACTION_IDS.NO_COST;
    return output;
  }

  registerFinalCostModifier(id, {
    label = null,
    baseAction = null,
    modifier,
    canSelect = false
  } = {}) {
    if (typeof modifier !== "function") throw new TypeError("A final movement cost modifier requires a modifier function.");
    this.ensureRegistered();
    const actionId = sanitizeModifierId(id);
    if (actionId === MOVEMENT_ACTION_IDS.NO_COST) throw new Error("The built-in AE5E no-cost movement action cannot be replaced.");
    if (this.#costModifiers.has(actionId)) throw new Error(`Movement cost modifier '${actionId}' is already registered.`);
    if (getConfiguredAction(actionId)) throw new Error(`Movement action '${actionId}' already exists.`);

    const config = Object.freeze({
      label: label ?? `Action Effects 5E — ${id}`,
      baseAction,
      modifier,
      canSelect
    });
    this.#costModifiers.set(actionId, config);
    this.#registerModifierAction(actionId, config);
    return actionId;
  }

  unregisterFinalCostModifier(id) {
    const actionId = sanitizeModifierId(id);
    const config = this.#costModifiers.get(actionId);
    if (!config) return false;
    const descriptor = this.#ownedActions.get(actionId);
    this.#costModifiers.delete(actionId);
    this.#ownedActions.delete(actionId);
    deleteConfiguredAction(actionId, descriptor);
    return true;
  }

  getStats() {
    return {
      initialized: this.#initialized,
      sourceOfTruth: "TokenDocument.movementHistory",
      noCostActionId: MOVEMENT_ACTION_IDS.NO_COST,
      noCostActionRegistered: getConfiguredAction(MOVEMENT_ACTION_IDS.NO_COST) === this.#ownedActions.get(MOVEMENT_ACTION_IDS.NO_COST),
      costModifierActions: [...this.#costModifiers.keys()]
    };
  }

  #registerNoCostAction() {
    const existing = getConfiguredAction(MOVEMENT_ACTION_IDS.NO_COST);
    const owned = this.#ownedActions.get(MOVEMENT_ACTION_IDS.NO_COST);
    if (existing && existing !== owned) {
      if (!isCompatibleNoCostAction(existing)) {
        throw new Error(`Movement action '${MOVEMENT_ACTION_IDS.NO_COST}' is already registered by another source.`);
      }
      this.#ownedActions.set(MOVEMENT_ACTION_IDS.NO_COST, existing);
      return;
    }

    const descriptor = Object.freeze({
      label: "Action Effects 5E — No Movement Cost",
      canSelect: false,
      measure: true,
      costMultiplier: 0,
      teleport: false,
      visualize: true,
      walls: "move",
      terrainAction: null
    });
    setConfiguredAction(MOVEMENT_ACTION_IDS.NO_COST, descriptor);
    this.#ownedActions.set(MOVEMENT_ACTION_IDS.NO_COST, descriptor);
  }

  #registerModifierAction(actionId, config) {
    const requestedBaseAction = config.baseAction ?? globalThis.CONFIG?.Token?.movement?.defaultAction ?? "walk";
    const base = getConfiguredAction(requestedBaseAction) ?? {};
    const descriptor = Object.freeze({
      ...cloneActionPresentation(base),
      label: config.label,
      canSelect: config.canSelect,
      getCostFunction: (token, options) => {
        const liveBase = getConfiguredAction(requestedBaseAction) ?? base;
        const baseFunction = typeof liveBase?.getCostFunction === "function"
          ? liveBase.getCostFunction(token, options)
          : defaultCostFunctionFor(liveBase);

        return (baseCost, from, to, distance, segment) => {
          const nativeCost = finiteNonnegative(baseFunction(baseCost, from, to, distance, segment));
          const result = Number(config.modifier({
            nativeCost,
            baseCost: finiteNonnegative(baseCost),
            from,
            to,
            distance: finiteNonnegative(distance),
            segment,
            token,
            options,
            baseAction: requestedBaseAction
          }));
          if (!Number.isFinite(result) || result < -EPSILON) {
            Logger.error(`Movement cost modifier '${actionId}' returned an invalid cost; preserving the native cost.`, { result, nativeCost });
            return nativeCost;
          }
          return Math.max(0, result);
        };
      }
    });

    setConfiguredAction(actionId, descriptor);
    this.#ownedActions.set(actionId, descriptor);
  }
}
