import {
  MODULE_ID,
  OPERATION_METADATA_KEY,
  PATH_TYPES,
  PERSISTENT_AREA_ENTRY_PLANS_KEY,
  PERSISTENT_AREA_ENTRY_PLAN_SCHEMA_VERSION
} from "../core/constants.js";
import { duplicateSafely, randomId } from "../core/utils.js";
import { Logger } from "../core/logger.js";

const TOKEN_MOVE_WRAPPER_TARGET = "foundry.documents.TokenDocument.prototype.move";
const MOVE_IN_EVENT = () => globalThis.CONST?.REGION_EVENTS?.TOKEN_MOVE_IN ?? "tokenMoveIn";
const POSITION_KEYS = new Set([
  "x", "y", "elevation", "width", "height", "depth", "shape", "level",
  "action", "checkpoint", "explicit", "snapped"
]);

function clone(value) {
  return duplicateSafely(value);
}

function asArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value.values === "function") return [...value.values()];
  return [value];
}

function normalizeString(value) {
  return String(value ?? "").trim();
}

function samePosition(a, b) {
  if (!a || !b) return false;
  return Number(a.x) === Number(b.x)
    && Number(a.y) === Number(b.y)
    && Number(a.elevation ?? 0) === Number(b.elevation ?? 0);
}

function movementActionConfig(actionId) {
  const actions = globalThis.CONFIG?.Token?.movement?.actions;
  return actions?.get?.(actionId) ?? actions?.[actionId] ?? null;
}

/**
 * Prepares native Foundry token movement for opt-in persistent-area entry
 * interruption. It does not execute any Item rule. Its only job is to ensure
 * the original native movement contains a checkpoint at the earliest native
 * grid position inside each opted-in Region and to attach a behavior-scoped
 * plan to the movement update options.
 *
 * The caller's original TokenDocument#move promise remains Foundry-owned. We
 * never stop/relaunch the movement merely to insert the entry checkpoint.
 */
export class PersistentAreaEntryInterruptionService {
  #events;
  #initialized = false;
  #wrapperRegistered = false;
  #stats = {
    plannedMovements: 0,
    plannedEntries: 0,
    bypassedPreparedMovements: 0,
    unsupportedComplexMoves: 0,
    wrapperErrors: 0
  };

  constructor({ events }) {
    this.#events = events;
  }

  initialize() {
    if (this.#initialized) return;
    this.#initialized = true;

    const wrapperApi = globalThis.libWrapper;
    if (!wrapperApi?.register) {
      Logger.warn("Persistent-area entry interruption could not register TokenDocument.move; libWrapper is unavailable.");
      return;
    }

    const service = this;
    try {
      wrapperApi.register(
        MODULE_ID,
        TOKEN_MOVE_WRAPPER_TARGET,
        function ae5ePersistentAreaEntryMoveWrapper(wrapped, waypoints, options = {}) {
          return service.#wrapTokenMove(this, wrapped, waypoints, options);
        },
        "MIXED"
      );
      this.#wrapperRegistered = true;
    } catch (error) {
      this.#stats.wrapperErrors += 1;
      Logger.error("Could not register the persistent-area TokenDocument.move wrapper.", error);
    }
  }

  shutdown() {
    if (this.#wrapperRegistered) {
      try { globalThis.libWrapper?.unregister?.(MODULE_ID, TOKEN_MOVE_WRAPPER_TARGET); }
      catch (error) { Logger.debug("Could not unregister persistent-area TokenDocument.move wrapper.", error); }
    }
    this.#wrapperRegistered = false;
    this.#initialized = false;
  }

  getStats() {
    return Object.freeze({ ...this.#stats, initialized: this.#initialized, wrapperRegistered: this.#wrapperRegistered });
  }

  /** Public for deterministic unit testing; not exposed as an Item API. */
  prepareMove(token, waypoints, options = {}) {
    const existingPlan = this.getPlanFromOptions(options, token?.uuid);
    if (existingPlan) {
      this.#stats.bypassedPreparedMovements += 1;
      return { planned: false, reason: "already-prepared", waypoints, options, plan: existingPlan };
    }

    if (!token?.uuid || !token?.parent || typeof token?.getCompleteMovementPath !== "function" || typeof token?.testInsideRegion !== "function") {
      return { planned: false, reason: "token-movement-api-unavailable", waypoints, options, plan: null };
    }

    const normalized = this.#normalizeWaypoints(token, waypoints);
    if (!normalized?.waypoints?.length) return { planned: false, reason: "no-movement-waypoints", waypoints, options, plan: null };
    if (normalized.complex && normalized.waypoints.length > 1) {
      this.#stats.unsupportedComplexMoves += 1;
      return { planned: false, reason: "complex-token-data-move", waypoints, options, plan: null };
    }

    const participants = this.#entryBehaviors(token);
    if (!participants.length) return { planned: false, reason: "no-entry-interruption-regions", waypoints, options, plan: null };

    const originalDestination = normalized.waypoints.at(-1);
    const planId = `${MODULE_ID}-persistent-entry-${randomId(20)}`;
    const entries = [];
    const insertionsBySegment = new Map();
    const regionStates = new Map();

    for (const participant of participants) {
      let inside = false;
      try { inside = token.testInsideRegion(participant.region, normalized.origin) === true; }
      catch { inside = false; }
      regionStates.set(participant.behavior.uuid, { inside, pendingEntry: false });
    }

    let segmentOrigin = normalized.origin;
    for (let segmentIndex = 0; segmentIndex < normalized.waypoints.length; segmentIndex += 1) {
      const endpoint = normalized.waypoints[segmentIndex];
      const teleport = this.#isTeleportSegment(endpoint, options);
      let complete = null;
      try {
        complete = teleport
          ? [clone(segmentOrigin), clone(endpoint)]
          : token.getCompleteMovementPath([clone(segmentOrigin), clone(endpoint)]);
      } catch (error) {
        Logger.debug("Could not expand a movement segment while planning persistent-area entry interruption.", error);
        complete = [clone(segmentOrigin), clone(endpoint)];
      }
      const points = asArray(complete).filter(point => Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y)));
      if (!points.length || !samePosition(points[0], segmentOrigin)) points.unshift(clone(segmentOrigin));

      for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
        const point = points[pointIndex];
        for (const participant of participants) {
          const key = participant.behavior.uuid;
          const state = regionStates.get(key) ?? { inside: false, pendingEntry: false };
          const wasInside = state.inside === true;
          let isInside = false;
          try { isInside = token.testInsideRegion(participant.region, point) === true; }
          catch { isInside = false; }

          // Foundry's geometric ENTER transition may occur at an unsnapped
          // boundary position where a grid token is only partially over the
          // Region. Once that transition begins, keep searching forward along
          // the same native path until we identify the earliest legal snapped
          // Token position that is still inside the Region.
          if (!wasInside && isInside) state.pendingEntry = true;

          if (state.pendingEntry && isInside) {
            let stop = clone(point);
            if (!teleport && stop.snapped !== true && typeof token?.getSnappedPosition === "function") {
              try {
                const snapped = token.getSnappedPosition(stop);
                if (snapped && token.testInsideRegion(participant.region, snapped) === true) {
                  stop = { ...stop, ...clone(snapped), snapped: true };
                }
              } catch { /* keep searching the native path */ }
            }

            // A traversed entry must settle at a native snapped position. If the
            // Region is thinner than one legal grid position, no synthetic
            // coordinate is invented; the ordinary Region event remains free to
            // use Foundry's boundary behavior instead. A true teleport is already
            // discontinuous, so its real destination is the interaction position.
            if (teleport || stop.snapped === true) {
              const entry = {
                entryId: `${planId}-${entries.length + 1}`,
                behaviorUuid: participant.behavior.uuid,
                regionUuid: participant.region.uuid ?? null,
                eventName: MOVE_IN_EVENT(),
                sequence: entries.length,
                segmentIndex,
                position: this.#sanitizePosition(stop),
                teleport,
                sourceMethod: normalizeString(options?.method) || null,
                sourceDestination: this.#sanitizePosition(originalDestination)
              };
              entries.push(entry);
              state.pendingEntry = false;

              if (!insertionsBySegment.has(segmentIndex)) insertionsBySegment.set(segmentIndex, []);
              insertionsBySegment.get(segmentIndex).push({
                order: pointIndex,
                position: entry.position,
                action: stop.action ?? endpoint.action ?? null
              });
            }
          }

          if (!isInside) state.pendingEntry = false;
          state.inside = isInside;
          regionStates.set(key, state);
        }
      }

      segmentOrigin = endpoint;
    }

    if (!entries.length) return { planned: false, reason: "route-does-not-enter", waypoints, options, plan: null };

    const rewritten = [];
    for (let segmentIndex = 0; segmentIndex < normalized.waypoints.length; segmentIndex += 1) {
      const endpoint = { ...clone(normalized.waypoints[segmentIndex]) };
      const insertions = [...(insertionsBySegment.get(segmentIndex) ?? [])]
        .sort((a, b) => a.order - b.order);

      for (const insertion of insertions) {
        if (samePosition(rewritten.at(-1), insertion.position)) {
          rewritten[rewritten.length - 1].checkpoint = true;
          continue;
        }
        if (samePosition(endpoint, insertion.position)) {
          endpoint.checkpoint = true;
          endpoint.snapped = endpoint.snapped === true || insertion.position.snapped === true;
          continue;
        }
        rewritten.push({
          ...clone(insertion.position),
          ...(insertion.action ? { action: insertion.action } : {}),
          checkpoint: true,
          explicit: false,
          snapped: insertion.position.snapped !== false
        });
      }
      rewritten.push(endpoint);
    }

    // A single TokenData-style move may carry fields unrelated to movement.
    // Marking its existing destination as a checkpoint preserves that object,
    // but expanding it into multiple waypoint objects could change update
    // semantics. Fail open rather than splitting a complex TokenData update.
    if (normalized.complex && rewritten.length !== normalized.waypoints.length) {
      this.#stats.unsupportedComplexMoves += 1;
      return { planned: false, reason: "complex-token-data-move", waypoints, options, plan: null };
    }

    const plan = {
      schemaVersion: PERSISTENT_AREA_ENTRY_PLAN_SCHEMA_VERSION,
      planId,
      tokenUuid: token.uuid,
      entries
    };

    const nextOptions = this.#withPlan(options, token.uuid, plan);
    this.#stats.plannedMovements += 1;
    this.#stats.plannedEntries += entries.length;

    const nextWaypoints = Array.isArray(waypoints)
      ? rewritten
      : (rewritten.length === 1 ? rewritten[0] : rewritten);

    return {
      planned: true,
      reason: "entry-checkpoints-added",
      waypoints: nextWaypoints,
      options: nextOptions,
      plan
    };
  }

  getPlanFromOptions(options, tokenUuid) {
    const metadata = options?.[OPERATION_METADATA_KEY];
    const plans = metadata?.[PERSISTENT_AREA_ENTRY_PLANS_KEY];
    const plan = plans?.[tokenUuid];
    if (!plan || Number(plan.schemaVersion) !== PERSISTENT_AREA_ENTRY_PLAN_SCHEMA_VERSION) return null;
    return plan;
  }

  #wrapTokenMove(token, wrapped, waypoints, options = {}) {
    try {
      const prepared = this.prepareMove(token, waypoints, options);
      return wrapped(prepared.waypoints, prepared.options);
    } catch (error) {
      this.#stats.wrapperErrors += 1;
      Logger.error("Persistent-area entry interruption planning failed; using the original Foundry movement.", error);
      return wrapped(waypoints, options);
    }
  }

  #entryBehaviors(token) {
    const results = [];
    for (const region of asArray(token?.parent?.regions)) {
      if (!region) continue;
      for (const behavior of asArray(region.behaviors)) {
        if (!behavior || behavior.disabled === true) continue;
        if (behavior.type !== `${MODULE_ID}.persistent-area`) continue;
        const recipe = this.#events?.getRecipe?.(behavior);
        const handler = recipe?.handlers?.[MOVE_IN_EVENT()] ?? null;
        if (handler?.movement?.entryInterruption !== true) continue;
        results.push({ region, behavior });
      }
    }
    return results;
  }

  #normalizeWaypoints(token, waypoints) {
    const raw = Array.isArray(waypoints) ? waypoints : [waypoints];
    if (!raw.length || raw.some(point => !point || typeof point !== "object")) return null;

    const origin = {
      x: Number(token.x ?? 0),
      y: Number(token.y ?? 0),
      elevation: Number(token.elevation ?? 0),
      width: Number(token.width ?? 1),
      height: Number(token.height ?? 1),
      ...(token.shape != null ? { shape: token.shape } : {}),
      ...(token.level != null ? { level: token.level } : {})
    };

    let previous = origin;
    let complex = false;
    const normalized = raw.map(candidate => {
      for (const key of Object.keys(candidate)) if (!POSITION_KEYS.has(key)) complex = true;
      const resolved = {
        ...clone(candidate),
        x: Number(candidate.x ?? previous.x),
        y: Number(candidate.y ?? previous.y),
        elevation: Number(candidate.elevation ?? previous.elevation),
        width: Number(candidate.width ?? previous.width ?? 1),
        height: Number(candidate.height ?? previous.height ?? 1)
      };
      previous = resolved;
      return resolved;
    });

    return { origin, waypoints: normalized, complex };
  }

  #isTeleportSegment(endpoint, options) {
    const metadata = options?.[OPERATION_METADATA_KEY] ?? {};
    if (metadata?.pathType === PATH_TYPES.TELEPORT || metadata?.teleport === true) return true;
    if (String(options?.method ?? "").toLowerCase() === "teleport") return true;
    return movementActionConfig(endpoint?.action)?.teleport === true;
  }

  #sanitizePosition(value) {
    if (!value || !Number.isFinite(Number(value.x)) || !Number.isFinite(Number(value.y))) return null;
    const result = {
      x: Number(value.x),
      y: Number(value.y),
      elevation: Number.isFinite(Number(value.elevation)) ? Number(value.elevation) : 0
    };
    for (const key of ["width", "height", "depth"]) {
      if (Number.isFinite(Number(value[key]))) result[key] = Number(value[key]);
    }
    if (value.shape != null) result.shape = clone(value.shape);
    if (value.level != null) result.level = clone(value.level);
    if (normalizeString(value.action)) result.action = normalizeString(value.action);
    result.snapped = value.snapped === true;
    return result;
  }

  #withPlan(options, tokenUuid, plan) {
    const next = { ...(options ?? {}) };
    const metadata = options?.[OPERATION_METADATA_KEY] && typeof options[OPERATION_METADATA_KEY] === "object"
      ? { ...options[OPERATION_METADATA_KEY] }
      : {};
    const plans = metadata[PERSISTENT_AREA_ENTRY_PLANS_KEY] && typeof metadata[PERSISTENT_AREA_ENTRY_PLANS_KEY] === "object"
      ? { ...metadata[PERSISTENT_AREA_ENTRY_PLANS_KEY] }
      : {};
    plans[tokenUuid] = clone(plan);
    metadata[PERSISTENT_AREA_ENTRY_PLANS_KEY] = plans;
    next[OPERATION_METADATA_KEY] = metadata;
    return next;
  }
}
