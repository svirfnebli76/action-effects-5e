import {
  MODULE_ID,
  MOVEMENT_AGENCIES,
  MOVEMENT_PHASES,
  MOVEMENT_RESOURCES,
  OPERATION_METADATA_KEY,
  PATH_TYPES,
  PERSISTENT_AREA_ENTRY_PLANS_KEY,
  PERSISTENT_AREA_ENTRY_PLAN_SCHEMA_VERSION
} from "../core/constants.js";
import { duplicateSafely, randomId } from "../core/utils.js";
import { Logger } from "../core/logger.js";

const MOVE_IN_EVENT = () => globalThis.CONST?.REGION_EVENTS?.TOKEN_MOVE_IN ?? "tokenMoveIn";
const CONSUMER_ID = `${MODULE_ID}.persistent-area-entry-interruption`;
const CONSUMER_PRIORITY = 20_000;
const WAYPOINT_FIELDS = Object.freeze([
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

function positionChanged(a, b) {
  return !samePosition(a, b);
}

function sanitizeWaypoint(value) {
  if (!value || !Number.isFinite(Number(value.x)) || !Number.isFinite(Number(value.y))) return null;
  const result = {};
  for (const key of WAYPOINT_FIELDS) {
    if (value[key] === undefined || value[key] === null) continue;
    result[key] = clone(value[key]);
  }
  result.x = Number(value.x);
  result.y = Number(value.y);
  result.elevation = Number.isFinite(Number(value.elevation)) ? Number(value.elevation) : 0;
  if (Number.isFinite(Number(value.width))) result.width = Number(value.width);
  if (Number.isFinite(Number(value.height))) result.height = Number(value.height);
  if (Number.isFinite(Number(value.depth))) result.depth = Number(value.depth);
  result.checkpoint = value.checkpoint === true;
  result.explicit = value.explicit === true;
  result.snapped = value.snapped === true;
  return result;
}

function dedupeWaypoints(points) {
  const result = [];
  for (const raw of points) {
    const point = sanitizeWaypoint(raw);
    if (!point) continue;
    if (samePosition(result.at(-1), point)) {
      const existing = result[result.length - 1];
      const checkpoint = existing.checkpoint === true || point.checkpoint === true;
      const explicit = existing.explicit === true || point.explicit === true;
      Object.assign(existing, point);
      if (checkpoint) existing.checkpoint = true;
      if (explicit) existing.explicit = true;
      continue;
    }
    result.push(point);
  }
  return result;
}

/**
 * Generic opt-in persistent-area entry interruption planner.
 *
 * Foundry v14's normal canvas drag and keyboard movement do not pass through
 * TokenDocument#move or Scene#moveTokens before preMoveToken. The authoritative
 * native route is, however, already expanded by the time preMoveToken fires.
 * This service consumes that route through MovementService, cancels only the
 * original operation before it commits, and replays one native Scene.moveTokens
 * route with the first Foundry-snapped complete interior position promoted to
 * a checkpoint. If Foundry omits that snapped position from the supplied route,
 * AE5E derives it by snapping the geometric Region crossing through Foundry's
 * own TokenDocument API and verifying Region containment.
 *
 * Item rules are never executed here. The persistent-area Region event runtime
 * still owns the Activity/CAT/Midi workflow and the eventual resume/stop decision.
 */
export class PersistentAreaEntryInterruptionService {
  #events;
  #movement;
  #initialized = false;
  #removeConsumer = null;
  #activeOriginalMovements = new Set();
  #stats = {
    observedMovements: 0,
    plannedMovements: 0,
    plannedEntries: 0,
    cancelledOriginalMovements: 0,
    replayedMovements: 0,
    bypassedPlannedMovements: 0,
    blockedOverlappingOriginals: 0,
    noNativeInteriorPosition: 0,
    replayErrors: 0
  };

  constructor({ events, movement }) {
    this.#events = events;
    this.#movement = movement;
  }

  initialize() {
    if (this.#initialized) return;
    this.#initialized = true;

    if (!this.#movement?.registerConsumer) {
      Logger.warn("Persistent-area entry interruption could not register its pre-movement consumer; MovementService is unavailable.");
      return;
    }

    this.#removeConsumer = this.#movement.registerConsumer({
      id: CONSUMER_ID,
      phases: [MOVEMENT_PHASES.BEFORE],
      priority: CONSUMER_PRIORITY,
      execution: "initiator",
      handler: this.#handleBeforeMovement.bind(this)
    });
  }

  shutdown() {
    try { this.#removeConsumer?.(); }
    catch (error) { Logger.debug("Could not unregister persistent-area entry interruption consumer.", error); }
    this.#removeConsumer = null;
    this.#activeOriginalMovements.clear();
    this.#initialized = false;
  }

  getStats() {
    return Object.freeze({
      ...this.#stats,
      initialized: this.#initialized,
      consumerRegistered: Boolean(this.#removeConsumer),
      activeOriginalMovements: this.#activeOriginalMovements.size
    });
  }

  /** Public for deterministic unit testing; not exposed as an Item API. */
  planMovement(token, movement, transaction = {}) {
    if (!token?.uuid || !token?.parent || typeof token?.testInsideRegion !== "function") {
      return { planned: false, reason: "token-region-api-unavailable", waypoints: [], plan: null };
    }

    const participants = this.#entryBehaviors(token);
    if (!participants.length) return { planned: false, reason: "no-entry-interruption-regions", waypoints: [], plan: null };

    const origin = sanitizeWaypoint(transaction?.origin ?? movement?.origin ?? token);
    const route = this.#extractRoute(movement, transaction);
    if (!origin || !route.length) return { planned: false, reason: "movement-route-unavailable", waypoints: [], plan: null };

    const destination = route.at(-1);
    const teleport = transaction?.pathType === PATH_TYPES.TELEPORT;
    const planId = `${MODULE_ID}-persistent-entry-${randomId(20)}`;
    const entries = [];
    const regionStates = new Map();

    for (const participant of participants) {
      let inside = false;
      try { inside = token.testInsideRegion(participant.region, origin) === true; }
      catch { inside = false; }
      regionStates.set(participant.behavior.uuid, { inside, pendingEntry: false });
    }

    const points = teleport ? [destination] : route.map(point => ({ ...clone(point) }));
    for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
      const point = points[pointIndex];
      const previousPoint = pointIndex > 0 ? points[pointIndex - 1] : origin;
      const nextPoint = points[pointIndex + 1] ?? destination;
      const derivedPoints = [];

      for (const participant of participants) {
        const key = participant.behavior.uuid;
        const state = regionStates.get(key) ?? { inside: false, pendingEntry: false };
        const wasInside = state.inside === true;
        let isInside = false;
        try { isInside = token.testInsideRegion(participant.region, point) === true; }
        catch { isInside = false; }

        if (!wasInside && isInside) {
          state.pendingEntry = true;

          // Foundry can report the geometric Region crossing as an unsnapped
          // checkpoint and omit the first complete grid position from its
          // supplied pending waypoints. Ask Foundry to snap that exact crossing
          // (with tiny forward probes only as tie-breakers), verify the snapped
          // token is inside the owning Region, and insert that native position
          // into the replay route. Do not infer a grid-square pixel offset.
          if (!teleport && point.snapped !== true) {
            const derived = this.#firstSnappedInteriorPosition({
              token,
              region: participant.region,
              crossingPoint: point,
              previousPoint,
              nextPoint
            });
            if (derived) derivedPoints.push(derived);
          }
        }

        if (state.pendingEntry && isInside && (teleport || point.snapped === true)) {
          const position = sanitizeWaypoint(point);
          const entry = {
            entryId: `${planId}-${entries.length + 1}`,
            behaviorUuid: participant.behavior.uuid,
            regionUuid: participant.region.uuid ?? null,
            eventName: MOVE_IN_EVENT(),
            sequence: entries.length,
            pathIndex: pointIndex,
            position,
            teleport,
            sourceMethod: normalizeString(movement?.method ?? transaction?.method) || null,
            sourceDestination: sanitizeWaypoint(destination)
          };
          entries.push(entry);
          state.pendingEntry = false;
        }

        if (!isInside) state.pendingEntry = false;
        state.inside = isInside;
        regionStates.set(key, state);
      }

      if (!teleport && derivedPoints.length) {
        this.#insertDerivedPoints(points, pointIndex, derivedPoints, point, nextPoint);
      }
    }

    if (!entries.length) {
      const enteredButUnsettled = [...regionStates.values()].some(state => state.pendingEntry === true);
      if (enteredButUnsettled) this.#stats.noNativeInteriorPosition += 1;
      return { planned: false, reason: enteredButUnsettled ? "no-native-interior-position" : "route-does-not-enter", waypoints: route, plan: null };
    }

    const waypoints = points.map(point => ({ ...clone(point) }));
    for (const entry of entries) {
      const index = waypoints.findIndex(point => samePosition(point, entry.position));
      if (index >= 0) waypoints[index].checkpoint = true;
    }
    if (waypoints.length) waypoints[waypoints.length - 1].checkpoint = true;

    const plan = {
      schemaVersion: PERSISTENT_AREA_ENTRY_PLAN_SCHEMA_VERSION,
      planId,
      tokenUuid: token.uuid,
      originalMovementId: transaction?.movementId ?? movement?.id ?? null,
      entries
    };

    return { planned: true, reason: "native-entry-checkpoints-planned", waypoints, plan };
  }

  #firstSnappedInteriorPosition({ token, region, crossingPoint, previousPoint, nextPoint }) {
    if (!token || !region || !crossingPoint || typeof token.getSnappedPosition !== "function") return null;

    const previous = sanitizeWaypoint(previousPoint);
    const crossing = sanitizeWaypoint(crossingPoint);
    const next = sanitizeWaypoint(nextPoint);
    if (!crossing) return null;

    const directionSource = previous && next && positionChanged(previous, next)
      ? { from: previous, to: next }
      : next && positionChanged(crossing, next)
        ? { from: crossing, to: next }
        : previous && positionChanged(previous, crossing)
          ? { from: previous, to: crossing }
          : null;
    if (!directionSource) return null;

    const dx = Number(directionSource.to.x) - Number(directionSource.from.x);
    const dy = Number(directionSource.to.y) - Number(directionSource.from.y);
    const length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || length <= 0) return null;
    const ux = dx / length;
    const uy = dy / length;

    const maxForward = next
      ? Math.max(0, ((Number(next.x) - Number(crossing.x)) * ux) + ((Number(next.y) - Number(crossing.y)) * uy))
      : Number.POSITIVE_INFINITY;
    const gridSize = Number(token?.parent?.grid?.size ?? globalThis.canvas?.grid?.size ?? 100);
    const base = Number.isFinite(gridSize) && gridSize > 0 ? gridSize : 100;
    const probeDistances = [0, base * 0.001, base * 0.01, base * 0.05, base * 0.1, base * 0.25, base * 0.49];

    for (const distance of probeDistances) {
      if (Number.isFinite(maxForward) && maxForward > 0 && distance > maxForward) continue;
      const probe = {
        ...clone(crossing),
        x: Number(crossing.x) + (ux * distance),
        y: Number(crossing.y) + (uy * distance),
        elevation: Number(crossing.elevation ?? 0)
      };

      let snapped = null;
      try { snapped = token.getSnappedPosition(probe); }
      catch { snapped = null; }
      if (!snapped || !Number.isFinite(Number(snapped.x)) || !Number.isFinite(Number(snapped.y))) continue;

      const candidate = sanitizeWaypoint({
        ...(next ?? crossing),
        ...snapped,
        elevation: Number.isFinite(Number(snapped.elevation)) ? Number(snapped.elevation) : Number(crossing.elevation ?? 0),
        action: crossing.action ?? next?.action ?? previous?.action ?? null,
        checkpoint: false,
        explicit: false,
        snapped: true
      });
      if (!candidate) continue;

      const forward = ((Number(candidate.x) - Number(crossing.x)) * ux)
        + ((Number(candidate.y) - Number(crossing.y)) * uy);
      if (forward < -1e-6) continue;
      if (Number.isFinite(maxForward) && maxForward > 0 && forward > maxForward + 1e-6) continue;

      let inside = false;
      try { inside = token.testInsideRegion(region, candidate) === true; }
      catch { inside = false; }
      if (!inside) continue;

      return candidate;
    }

    return null;
  }

  #insertDerivedPoints(points, insertAfterIndex, candidates, crossingPoint, nextPoint) {
    if (!Array.isArray(points) || !candidates?.length) return;
    const crossing = sanitizeWaypoint(crossingPoint);
    const next = sanitizeWaypoint(nextPoint);
    if (!crossing) return;

    let ux = 0;
    let uy = 0;
    if (next && positionChanged(crossing, next)) {
      const dx = Number(next.x) - Number(crossing.x);
      const dy = Number(next.y) - Number(crossing.y);
      const length = Math.hypot(dx, dy);
      if (Number.isFinite(length) && length > 0) {
        ux = dx / length;
        uy = dy / length;
      }
    }

    const unique = [];
    for (const raw of candidates) {
      const candidate = sanitizeWaypoint(raw);
      if (!candidate || samePosition(candidate, crossing)) continue;
      if (points.some(point => samePosition(point, candidate))) continue;
      if (unique.some(point => samePosition(point, candidate))) continue;
      unique.push(candidate);
    }

    unique.sort((a, b) => {
      const aProgress = ((Number(a.x) - Number(crossing.x)) * ux) + ((Number(a.y) - Number(crossing.y)) * uy);
      const bProgress = ((Number(b.x) - Number(crossing.x)) * ux) + ((Number(b.y) - Number(crossing.y)) * uy);
      return aProgress - bProgress;
    });

    if (unique.length) points.splice(insertAfterIndex + 1, 0, ...unique);
  }

  #handleBeforeMovement(transaction, context = {}) {
    this.#stats.observedMovements += 1;
    const token = context?.document;
    const movement = context?.movement;
    if (!token?.uuid || !movement || !positionChanged(transaction?.origin, transaction?.destination)) return true;

    const existingPlan = this.#planFromMetadata(transaction?.metadata, token.uuid);
    if (existingPlan) {
      this.#stats.bypassedPlannedMovements += 1;
      return true;
    }

    if (this.#activeOriginalMovements.has(transaction.movementId)) {
      this.#stats.blockedOverlappingOriginals += 1;
      return false;
    }

    const prepared = this.planMovement(token, movement, transaction);
    if (!prepared.planned) return true;

    this.#stats.plannedMovements += 1;
    this.#stats.plannedEntries += prepared.plan.entries.length;
    this.#stats.cancelledOriginalMovements += 1;
    this.#activeOriginalMovements.add(transaction.movementId);

    const preflightHoldId = `${MODULE_ID}.persistent-entry-plan.${prepared.plan.planId}`;
    this.#movement?.acquireInteractionHold?.({
      tokenUuid: token.uuid,
      holdId: preflightHoldId,
      bypassPlanId: prepared.plan.planId,
      message: null,
      broadcast: true
    });

    // Foundry is still unwinding the cancelled preMoveToken operation. Match the
    // proven relationship/Grapple translation pattern and begin the replacement
    // on the next event-loop task rather than inside the hook stack.
    setTimeout(() => {
      void this.#replayMovement({
        token,
        transaction,
        movement,
        prepared,
        preflightHoldId
      });
    }, 0);

    return false;
  }

  async #replayMovement({ token, transaction, movement, prepared, preflightHoldId }) {
    const scene = token?.parent;
    const originalMovementId = transaction?.movementId;
    let releaseContext = null;

    try {
      if (!scene?.moveTokens || !token?.id) throw new Error("The originating Scene or Token is no longer available.");
      if (!samePosition(token, transaction.origin)) {
        throw new Error("The token changed position before the entry-interrupted movement could be replayed.");
      }

      const movementId = randomId(16);
      const agency = transaction.agency === MOVEMENT_AGENCIES.UNKNOWN
        ? MOVEMENT_AGENCIES.VOLUNTARY
        : transaction.agency;
      const resource = transaction.resource === MOVEMENT_RESOURCES.UNKNOWN
        ? MOVEMENT_RESOURCES.MOVEMENT
        : transaction.resource;
      const originalMetadata = transaction?.metadata && typeof transaction.metadata === "object"
        ? clone(transaction.metadata)
        : {};

      const metadata = {
        ...originalMetadata,
        transactionId: `${MODULE_ID}-persistent-entry-replay-${randomId(20)}`,
        pathType: transaction.pathType,
        agency,
        resource,
        movementMode: transaction.movementMode ?? null,
        sourceUuid: transaction.sourceUuid ?? originalMetadata.sourceUuid ?? null,
        initiatorUuid: transaction.initiatorUuid ?? token.uuid,
        requestingUserId: transaction.userId ?? globalThis.game?.user?.id ?? null,
        originalMovementId,
        persistentAreaEntryReplay: true,
        persistentAreaEntryPlanId: prepared.plan.planId,
        [PERSISTENT_AREA_ENTRY_PLANS_KEY]: {
          [token.uuid]: clone(prepared.plan)
        },
        ...(originalMetadata.generatedBy && originalMetadata.generatedBy !== MODULE_ID
          ? { externalGeneratedBy: originalMetadata.generatedBy }
          : {}),
        generatedBy: MODULE_ID,
        internal: true,
        suppressAutomation: false
      };

      const instruction = {
        id: movementId,
        waypoints: prepared.waypoints.map(clone),
        method: movement?.method ?? transaction?.method ?? "api",
        autoRotate: movement?.autoRotate === true,
        split: movement?.split === true,
        showRuler: movement?.showRuler ?? (movement?.method === "dragging"),
        ...(movement?.constrainOptions && typeof movement.constrainOptions === "object"
          ? { constrainOptions: clone(movement.constrainOptions) }
          : {}),
        ...(movement?.measureOptions && typeof movement.measureOptions === "object"
          ? { measureOptions: clone(movement.measureOptions) }
          : {}),
        ...(movement?.terrainOptions && typeof movement.terrainOptions === "object"
          ? { terrainOptions: clone(movement.terrainOptions) }
          : {})
      };

      const operationOptions = {
        [OPERATION_METADATA_KEY]: metadata
      };

      releaseContext = this.#movement.registerMovementContext(movementId, metadata);
      const results = await scene.moveTokens({ [token.id]: instruction }, operationOptions);
      this.#stats.replayedMovements += 1;

      if (results?.[token.id] !== true) {
        Logger.debug("Persistent-area entry-interrupted movement ended before its original destination.", {
          tokenUuid: token.uuid,
          originalMovementId,
          planId: prepared.plan.planId,
          result: results?.[token.id]
        });
      }
    } catch (error) {
      this.#stats.replayErrors += 1;
      Logger.error("Persistent-area entry-interrupted movement replay failed.", error);
      globalThis.ui?.notifications?.error?.(`Action Effects 5E could not continue this movement: ${error.message}`);
    } finally {
      try { releaseContext?.(); } catch { /* best effort */ }
      this.#movement?.releaseInteractionHold?.({
        tokenUuid: token?.uuid,
        holdId: preflightHoldId,
        broadcast: true
      });
      if (originalMovementId) this.#activeOriginalMovements.delete(originalMovementId);
    }
  }

  #extractRoute(movement, transaction) {
    const passed = asArray(movement?.passed?.waypoints);
    const pending = asArray(movement?.pending?.waypoints);
    let route = passed.length || pending.length
      ? [...passed, ...pending]
      : asArray(transaction?.path);

    if (!route.length && movement?.destination) route = [movement.destination];
    route = dedupeWaypoints(route);

    const origin = transaction?.origin ?? movement?.origin;
    while (route.length > 1 && samePosition(route[0], origin)) route.shift();
    return route;
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

  #planFromMetadata(metadata, tokenUuid) {
    const plan = metadata?.[PERSISTENT_AREA_ENTRY_PLANS_KEY]?.[tokenUuid];
    if (!plan || Number(plan.schemaVersion) !== PERSISTENT_AREA_ENTRY_PLAN_SCHEMA_VERSION) return null;
    if (!normalizeString(plan.planId) || !Array.isArray(plan.entries)) return null;
    return plan;
  }
}
