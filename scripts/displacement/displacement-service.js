import {
  DISPLACEMENT_DIRECTION_CONSTRAINTS,
  DISPLACEMENT_TYPES,
  HOOKS,
  MODULE_ID,
  MOVEMENT_AGENCIES,
  MOVEMENT_PHASES,
  MOVEMENT_RESOURCES,
  NONHOSTILE_ENDPOINT_GRACE_MS,
  PATH_TYPES
} from "../core/constants.js";
import { duplicateSafely, randomId } from "../core/utils.js";
import { Logger } from "../core/logger.js";

const MAX_RECENT_RESULTS = 25;

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positionsEqual(a, b) {
  return Math.abs(finiteNumber(a?.x, 0) - finiteNumber(b?.x, 0)) <= 0.01
    && Math.abs(finiteNumber(a?.y, 0) - finiteNumber(b?.y, 0)) <= 0.01
    && Math.abs(finiteNumber(a?.elevation, 0) - finiteNumber(b?.elevation, 0)) <= 0.01;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDocumentPosition({
  scene,
  tokenId,
  expected,
  timeoutMs = 1_500,
  pollMs = 25
} = {}) {
  const startedAt = performance.now();
  let current = scene?.tokens?.get(tokenId) ?? null;
  if (positionsEqual(current, expected)) {
    return { reached: true, timedOut: false, elapsedMs: 0, current };
  }

  while ((performance.now() - startedAt) < timeoutMs) {
    await wait(pollMs);
    current = scene?.tokens?.get(tokenId) ?? null;
    if (positionsEqual(current, expected)) {
      return {
        reached: true,
        timedOut: false,
        elapsedMs: performance.now() - startedAt,
        current
      };
    }
  }

  return {
    reached: false,
    timedOut: true,
    elapsedMs: performance.now() - startedAt,
    current
  };
}

export class DisplacementService {
  #socket;
  #movement;
  #planner;
  #overlay;
  #grace;
  #initialized = false;
  #dndBlockingHook = null;
  #activeTokenBypasses = new Map();
  #recent = [];

  constructor({ socket, movement, planner, overlay, grace }) {
    this.#socket = socket;
    this.#movement = movement;
    this.#planner = planner;
    this.#overlay = overlay;
    this.#grace = grace;
    this.#socket.register("displacement.execute", this.#executeAsGM.bind(this));
  }

  initialize() {
    if (this.#initialized) return;
    this.#initialized = true;

    // D&D5e 5.3 exposes this hook specifically so integrations can alter which
    // occupied grid spaces block a token. During one AE5E displacement only,
    // remove the exact nonhostile blockers which AE5E already classified.
    this.#dndBlockingHook = Hooks.on(
      "dnd5e.determineOccupiedGridSpaceBlocking",
      this.#onDetermineOccupiedGridSpaceBlocking.bind(this)
    );

    Logger.info("Displacement service ready for forced Push/Pull movement.");
  }

  shutdown() {
    if (this.#dndBlockingHook !== null) {
      Hooks.off("dnd5e.determineOccupiedGridSpaceBlocking", this.#dndBlockingHook);
      this.#dndBlockingHook = null;
    }
    this.#overlay.clear({ cancelled: true });
    this.#grace.clearAll("displacement-shutdown");
    this.#activeTokenBypasses.clear();
    this.#initialized = false;
  }

  getStats() {
    return {
      initialized: this.#initialized,
      activeTokenBypasses: this.#activeTokenBypasses.size,
      recentResults: this.#recent.length,
      endpointGrace: this.#grace.getStats()
    };
  }

  getRecentResults() {
    return duplicateSafely(this.#recent);
  }

  clearSelection() {
    this.#overlay.clear({ cancelled: true });
    return true;
  }

  clearEndpointGrace(subjectUuid) {
    return this.#grace.clear(subjectUuid, "api-clear");
  }

  async getCandidates({ sourceUuid, targetUuid, type, directionConstraint, distance } = {}) {
    const { scene, source, target } = await this.#resolveRequestTokens({ sourceUuid, targetUuid });
    this.#validateRequest({ scene, source, target, type, directionConstraint, distance });
    return this.#planner.buildCandidates({
      scene,
      sourceToken: source,
      targetToken: target,
      type,
      directionConstraint,
      distance
    });
  }

  async push(options = {}) {
    return this.request({
      ...options,
      type: DISPLACEMENT_TYPES.PUSH,
      directionConstraint: options.directionConstraint ?? DISPLACEMENT_DIRECTION_CONSTRAINTS.AWAY
    });
  }

  async pull(options = {}) {
    if (options.directionConstraint
      && options.directionConstraint !== DISPLACEMENT_DIRECTION_CONSTRAINTS.STRAIGHT_TOWARD) {
      throw new Error("Pull only supports STRAIGHT_TOWARD movement.");
    }
    if (options.directionKey) {
      throw new Error("Pull direction is resolved automatically and does not accept directionKey.");
    }
    return this.request({
      ...options,
      type: DISPLACEMENT_TYPES.PULL,
      directionConstraint: DISPLACEMENT_DIRECTION_CONSTRAINTS.STRAIGHT_TOWARD,
      directionKey: null
    });
  }

  async request({
    sourceUuid,
    targetUuid,
    type,
    directionConstraint,
    distance,
    directionKey = null,
    endpointGraceMs = NONHOSTILE_ENDPOINT_GRACE_MS,
    title = null
  } = {}) {
    const { scene, source, target } = await this.#resolveRequestTokens({ sourceUuid, targetUuid });
    this.#validateRequest({ scene, source, target, type, directionConstraint, distance });
    this.#assertLocalInitiatorPermission(source);

    const plan = this.#planner.buildCandidates({
      scene,
      sourceToken: source,
      targetToken: target,
      type,
      directionConstraint,
      distance
    });

    let candidate = null;
    if (type === DISPLACEMENT_TYPES.PULL) {
      if (directionKey) {
        throw new Error("Pull direction is resolved automatically and does not accept directionKey.");
      }
      candidate = plan.candidates[0] ?? null;
    } else if (directionKey) {
      candidate = plan.candidates.find((entry) => entry.key === directionKey) ?? null;
      if (!candidate) throw new Error(`Direction '${directionKey}' is not legal for this displacement.`);
    } else {
      candidate = await this.#overlay.select({
        candidates: plan.candidates,
        targetToken: target,
        title: title ?? `Push ${target.name ?? "target"}`
      });
    }

    if (!candidate) {
      return {
        completed: false,
        cancelled: true,
        type,
        directionConstraint,
        requestedDistance: finiteNumber(distance, 0),
        plan: duplicateSafely(plan)
      };
    }
    if (candidate.selectable !== true) {
      return {
        completed: false,
        blocked: true,
        type,
        directionConstraint,
        directionKey: candidate.key,
        requestedDistance: finiteNumber(distance, 0),
        candidate: duplicateSafely(candidate)
      };
    }

    return this.#socket.executeAsGM("displacement.execute", {
      sourceUuid: source.uuid,
      targetUuid: target.uuid,
      type,
      directionConstraint,
      directionKey: candidate.key,
      distance: finiteNumber(distance, 0),
      endpointGraceMs: Math.max(1, finiteNumber(endpointGraceMs, NONHOSTILE_ENDPOINT_GRACE_MS)),
      requestingUserId: game.user?.id ?? null
    });
  }

  async #executeAsGM(request = {}) {
    if (!game.user?.isGM) throw new Error("Forced displacement execution requires a GM client.");
    const requestingUser = game.users.get(request.requestingUserId);
    const { scene, source, target } = await this.#resolveRequestTokens(request);
    this.#validateRequest({
      scene,
      source,
      target,
      type: request.type,
      directionConstraint: request.directionConstraint,
      distance: request.distance
    });
    this.#assertRequestingUserPermission(requestingUser, source);

    // Recompute on the GM immediately before movement. Never trust candidate
    // coordinates supplied by another client.
    const plan = this.#planner.buildCandidates({
      scene,
      sourceToken: source,
      targetToken: target,
      type: request.type,
      directionConstraint: request.directionConstraint,
      distance: request.distance
    });
    const candidate = plan.candidates.find((entry) => entry.key === request.directionKey) ?? null;
    if (!candidate) {
      return this.#remember({
        completed: false,
        stale: true,
        message: "The selected forced-movement direction is no longer legal.",
        plan
      });
    }
    if (candidate.selectable !== true || candidate.actualDistance <= 0) {
      return this.#remember({
        completed: false,
        blocked: true,
        directionKey: candidate.key,
        candidate,
        plan,
        message: "The target cannot be displaced in that direction."
      });
    }

    const displacementId = `${MODULE_ID}-displacement-${randomId(20)}`;
    const action = globalThis.CONFIG?.Token?.movement?.defaultAction ?? "walk";
    const movementId = randomId(16);
    const waypoints = candidate.path.map((position, index) => ({
      x: position.x,
      y: position.y,
      elevation: position.elevation,
      action,
      explicit: true,
      checkpoint: index === candidate.path.length - 1
    }));
    const options = {
      method: "api",
      showRuler: false,
      pan: false,
      autoRotate: false,
      constrainOptions: {
        ignoreWalls: false,
        ignoreCost: true,
        ignoreTokens: false
      },
      ...this.#movement.createOperationOptions({
        transactionId: displacementId,
        pathType: PATH_TYPES.TRAVERSE,
        agency: MOVEMENT_AGENCIES.FORCED,
        resource: MOVEMENT_RESOURCES.NONE,
        movementMode: action,
        sourceUuid: source.uuid,
        initiatorUuid: source.uuid,
        requestingUserId: requestingUser?.id ?? null,
        displacement: true,
        displacementId,
        displacementType: request.type,
        directionConstraint: request.directionConstraint,
        displacementDirection: candidate.key,
        requestedDistance: candidate.requestedDistance,
        actualDistance: candidate.actualDistance,
        generatedBy: MODULE_ID,
        internal: true,
        suppressAutomation: false
      })
    };

    // Foundry's moveToken hook is the authoritative post-update boundary for a
    // movement operation. The TokenDocument#move promise can resolve before
    // AE5E's queued AFTER-transaction consumers have run, so keep both the
    // semantic movement context and D&D5e nonhostile-token bypass alive until
    // that AFTER transaction has been observed. This also prevents endpoint
    // grace from being decided against a transient/stale Scene collection state.
    let settleResolve = null;
    let settleTimer = null;
    let unregisterSettle = null;
    const settledTransaction = new Promise((resolve) => {
      settleResolve = resolve;
      settleTimer = setTimeout(() => resolve(null), 1_500);
    });

    unregisterSettle = this.#movement.registerConsumer({
      id: `${MODULE_ID}.displacement-settle.${displacementId}`,
      phases: [MOVEMENT_PHASES.AFTER],
      tokenUuids: [target.uuid],
      execution: "primaryGM",
      priority: 30_000,
      predicate: (transaction) => transaction?.displacementId === displacementId
        || transaction?.id === displacementId,
      once: true,
      handler: (transaction) => {
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = null;
        settleResolve?.(transaction);
      }
    });

    this.#activeTokenBypasses.set(target.uuid, new Set(candidate.allowedNonhostileUuids));
    const releaseContext = this.#movement.registerMovementContext(movementId, options);
    let movementCompleted = false;
    let afterTransaction = null;
    let documentSettlement = { reached: false, timedOut: false, elapsedMs: 0, current: scene.tokens.get(target.id) };
    try {
      movementCompleted = await target.move(waypoints, {
        ...options,
        id: movementId
      });
      if (movementCompleted === true) {
        afterTransaction = await settledTransaction;

        // Foundry/D&D5e can report the logical AFTER movement transaction while
        // the TokenDocument is still advancing through a multi-waypoint animated
        // path. Keep the AE5E movement context and exact nonhostile-token bypass
        // alive until the Scene document reaches the planned endpoint (or a
        // bounded timeout proves that it did not). The Scene document, not the
        // transaction's intended destination, is authoritative for endpoint grace.
        const settlementTimeoutMs = Math.min(8_000, Math.max(1_000, (candidate.path.length + 1) * 500));
        documentSettlement = await waitForDocumentPosition({
          scene,
          tokenId: target.id,
          expected: candidate.destination,
          timeoutMs: settlementTimeoutMs
        });
      }
    } finally {
      if (settleTimer) clearTimeout(settleTimer);
      unregisterSettle?.();
      releaseContext();
      this.#activeTokenBypasses.delete(target.uuid);
    }

    const current = scene.tokens.get(target.id);
    const reachedPlannedEndpoint = positionsEqual(current, candidate.destination);
    const endpointConflicts = reachedPlannedEndpoint
      ? candidate.endpointConflicts
      : [];

    if (movementCompleted === true && reachedPlannedEndpoint && endpointConflicts.length) {
      this.#grace.schedule({
        scene,
        subjectToken: current,
        sourceUuid: source.uuid,
        requestingUserId: requestingUser?.id ?? null,
        displacementId,
        overlapPosition: candidate.destination,
        rollbackPosition: candidate.graceRollbackPosition,
        occupantUuids: endpointConflicts.map((entry) => entry.blockerUuid ?? entry.otherUuid),
        graceMs: request.endpointGraceMs
      });
    } else {
      this.#grace.clear(target.uuid, "displacement-ended-clear");
    }

    const result = {
      completed: movementCompleted === true,
      movementCompleted: movementCompleted === true,
      movementTransactionObserved: Boolean(afterTransaction),
      reachedPlannedEndpoint,
      documentSettlement: {
        reached: documentSettlement.reached === true,
        timedOut: documentSettlement.timedOut === true,
        elapsedMs: Math.round(finiteNumber(documentSettlement.elapsedMs, 0)),
        position: {
          x: finiteNumber(current?.x, null),
          y: finiteNumber(current?.y, null),
          elevation: finiteNumber(current?.elevation, null)
        }
      },
      fullDistance: candidate.actualDistance >= candidate.requestedDistance - 1e-6,
      partial: candidate.actualDistance < candidate.requestedDistance - 1e-6,
      type: request.type,
      directionConstraint: request.directionConstraint,
      directionKey: candidate.key,
      displacementId,
      sourceUuid: source.uuid,
      targetUuid: target.uuid,
      requestedDistance: candidate.requestedDistance,
      actualDistance: candidate.actualDistance,
      destinationState: candidate.state,
      destination: duplicateSafely(candidate.destination),
      hardBlock: duplicateSafely(candidate.obstruction),
      endpointConflicts: duplicateSafely(endpointConflicts),
      graceStarted: movementCompleted === true && reachedPlannedEndpoint && endpointConflicts.length > 0
    };
    this.#remember(result);
    Hooks.callAll(HOOKS.DISPLACEMENT_RESOLVED, duplicateSafely(result));
    return duplicateSafely(result);
  }

  #onDetermineOccupiedGridSpaceBlocking(_gridSpace, token, _options, found) {
    if (!(found instanceof Set) || !token) return;
    const subject = token.document ?? token;
    const allowed = this.#activeTokenBypasses.get(subject?.uuid);
    if (!allowed?.size) return;

    for (const blocker of [...found]) {
      const document = blocker?.document ?? blocker;
      if (allowed.has(document?.uuid)) found.delete(blocker);
    }
  }

  async #resolveRequestTokens({ sourceUuid, targetUuid } = {}) {
    const source = typeof sourceUuid === "string"
      ? await fromUuid(sourceUuid)
      : (sourceUuid?.document ?? sourceUuid);
    const target = typeof targetUuid === "string"
      ? await fromUuid(targetUuid)
      : (targetUuid?.document ?? targetUuid);
    if (!(source instanceof foundry.documents.TokenDocument)) {
      throw new Error("Forced displacement requires a valid Source TokenDocument or UUID.");
    }
    if (!(target instanceof foundry.documents.TokenDocument)) {
      throw new Error("Forced displacement requires a valid Target TokenDocument or UUID.");
    }
    if (source.uuid === target.uuid) throw new Error("A token cannot forcibly displace itself.");
    if (source.parent?.id !== target.parent?.id) throw new Error("Source and Target must be on the same Scene.");
    const scene = source.parent;
    if (!canvas?.ready || canvas.scene?.id !== scene.id) {
      throw new Error("Forced displacement currently requires the Source and Target Scene to be active on the executing client.");
    }
    return { scene, source, target };
  }

  #validateRequest({ scene, source, target, type, directionConstraint, distance }) {
    if (!Object.values(DISPLACEMENT_TYPES).includes(type)) {
      throw new Error(`Unsupported displacement type '${type}'.`);
    }
    if (!Object.values(DISPLACEMENT_DIRECTION_CONSTRAINTS).includes(directionConstraint)) {
      throw new Error(`Unsupported displacement direction constraint '${directionConstraint}'.`);
    }
    const validConstraints = type === DISPLACEMENT_TYPES.PUSH
      ? [DISPLACEMENT_DIRECTION_CONSTRAINTS.AWAY, DISPLACEMENT_DIRECTION_CONSTRAINTS.STRAIGHT_AWAY]
      : [DISPLACEMENT_DIRECTION_CONSTRAINTS.STRAIGHT_TOWARD];
    if (!validConstraints.includes(directionConstraint)) {
      throw new Error(`Displacement type '${type}' cannot use direction constraint '${directionConstraint}'.`);
    }
    const numericDistance = finiteNumber(distance);
    if (!(numericDistance > 0)) throw new Error("Forced displacement distance must be greater than 0.");

    const squareType = globalThis.CONST?.GRID_TYPES?.SQUARE;
    if (squareType !== undefined && scene.grid?.type !== squareType) {
      throw new Error("AE5E 0.3.25 forced displacement currently supports square-grid Scenes only.");
    }
    if (!source.object || !target.object) {
      throw new Error("Source and Target must both be rendered on the active Scene canvas.");
    }
  }

  #assertLocalInitiatorPermission(source) {
    if (game.user?.isGM) return;
    if (source.actor?.testUserPermission?.(game.user, "OWNER")) return;
    throw new Error("You must own the Source token's Actor to choose and request forced displacement.");
  }

  #assertRequestingUserPermission(user, source) {
    if (!user?.active) throw new Error("The user requesting forced displacement is no longer active.");
    if (user.isGM) return;
    if (source.actor?.testUserPermission?.(user, "OWNER")) return;
    throw new Error("The requesting user does not own the Source token's Actor.");
  }

  #remember(result) {
    const copy = duplicateSafely(result);
    this.#recent.push(copy);
    if (this.#recent.length > MAX_RECENT_RESULTS) this.#recent.shift();
    return copy;
  }
}
