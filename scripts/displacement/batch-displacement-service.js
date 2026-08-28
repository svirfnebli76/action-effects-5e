import {
  DISPLACEMENT_DIRECTION_CONSTRAINTS,
  DISPLACEMENT_TYPES,
  HOOKS,
  MODULE_ID,
  MOVEMENT_AGENCIES,
  MOVEMENT_RESOURCES,
  PATH_TYPES
} from "../core/constants.js";
import { duplicateSafely, randomId } from "../core/utils.js";

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positionOf(token) {
  return { x: token.x, y: token.y, elevation: token.elevation };
}

export class BatchDisplacementService {
  #socket;
  #movement;
  #accounting;
  #planner;

  constructor({ socket, movement, accounting, planner }) {
    this.#socket = socket;
    this.#movement = movement;
    this.#accounting = accounting;
    this.#planner = planner;
    this.#socket.register("displacement.executeBatch", this.#executeAsGM.bind(this));
  }

  async push({
    sourceUuid,
    targetUuids = [],
    distance,
    directionConstraint = DISPLACEMENT_DIRECTION_CONSTRAINTS.STRAIGHT_AWAY,
    tokenCollisionPolicy = "all"
  } = {}) {
    if (directionConstraint !== DISPLACEMENT_DIRECTION_CONSTRAINTS.STRAIGHT_AWAY) {
      throw new Error("Batch Push currently requires STRAIGHT_AWAY movement.");
    }
    if (tokenCollisionPolicy !== "all") {
      throw new Error("Batch Push currently requires the all-token collision policy.");
    }

    const source = await this.#resolveToken(sourceUuid, "Source");
    this.#assertLocalPermission(source);
    const normalizedTargets = [...new Set(targetUuids.filter((uuid) => typeof uuid === "string" && uuid.length))]
      .filter((uuid) => uuid !== source.uuid);
    if (!normalizedTargets.length) {
      return { completed: false, cancelled: true, reason: "no-targets", results: [] };
    }

    return this.#socket.executeAsGM("displacement.executeBatch", {
      sourceUuid: source.uuid,
      targetUuids: normalizedTargets,
      type: DISPLACEMENT_TYPES.PUSH,
      directionConstraint,
      distance: finiteNumber(distance, 0),
      tokenCollisionPolicy,
      requestingUserId: game.user?.id ?? null
    });
  }

  async #executeAsGM(request = {}) {
    if (!game.user?.isGM) throw new Error("Batch forced displacement must execute as a GM.");
    const source = await this.#resolveToken(request.sourceUuid, "Source");
    const requester = game.users.get(request.requestingUserId);
    this.#assertRequestPermission(requester, source);
    this.#validateRequest(request, source);

    const targets = [];
    for (const uuid of [...new Set(request.targetUuids ?? [])]) {
      const token = await this.#resolveToken(uuid, "Target");
      if (token.uuid === source.uuid) continue;
      if (token.parent?.id !== source.parent?.id) throw new Error("Every batch target must be on the Source Scene.");
      targets.push(token);
    }
    if (!targets.length) return { completed: false, cancelled: true, reason: "no-targets", results: [] };

    const scene = source.parent;
    const active = new Set(targets.map((token) => token.uuid));
    const plans = new Map();
    const blockedPlans = new Map();
    let changed = true;

    // A participant may be ignored as an obstruction only while it has a legal
    // move of its own. If one participant becomes stationary, recompute every
    // remaining route against that newly-solid body. This fixed point removes
    // target-order dependence while still allowing movement into vacated space.
    while (changed) {
      changed = false;
      plans.clear();
      for (const target of targets) {
        if (!active.has(target.uuid)) continue;
        const ignoredTokenUuids = [...active].filter((uuid) => uuid !== target.uuid);
        const plan = this.#planner.buildCandidates({
          scene,
          sourceToken: source,
          targetToken: target,
          type: DISPLACEMENT_TYPES.PUSH,
          directionConstraint: request.directionConstraint,
          distance: request.distance,
          tokenCollisionPolicy: "all",
          ignoredTokenUuids
        });
        const candidate = this.#chooseCandidate(plan);
        if (!candidate) {
          blockedPlans.set(target.uuid, {
            plan,
            candidate: plan.candidates?.[0] ?? null,
            reasonCode: plan.candidates?.[0]?.obstruction?.reasonCode ?? "no-legal-destination"
          });
          active.delete(target.uuid);
          changed = true;
          continue;
        }
        plans.set(target.uuid, { plan, candidate });
      }
      if (changed) continue;

      const colliding = this.#findBatchCollisions({ scene, targets, active, plans });
      if (colliding.size) {
        for (const uuid of colliding) {
          blockedPlans.set(uuid, {
            ...plans.get(uuid),
            reasonCode: "batch-path-conflict"
          });
          active.delete(uuid);
        }
        changed = true;
      }
    }

    const batchId = `${MODULE_ID}-displacement-batch-${randomId(20)}`;
    const movementMode = globalThis.CONFIG?.Token?.movement?.defaultAction ?? "walk";
    this.#accounting.ensureRegistered();
    const action = this.#accounting.noCostActionId;
    const instructions = {};
    const releases = [];
    const origins = Object.fromEntries(targets.map((token) => [token.id, positionOf(token)]));
    const baseOptions = this.#movement.createOperationOptions({
      transactionId: batchId,
      pathType: PATH_TYPES.TRAVERSE,
      agency: MOVEMENT_AGENCIES.FORCED,
      resource: MOVEMENT_RESOURCES.NONE,
      movementMode,
      nativeMovementAction: action,
      sourceUuid: source.uuid,
      initiatorUuid: source.uuid,
      requestingUserId: requester.id,
      displacement: true,
      displacementBatch: true,
      displacementBatchId: batchId,
      displacementType: DISPLACEMENT_TYPES.PUSH,
      directionConstraint: request.directionConstraint,
      maximumDisplacementDistance: request.distance,
      generatedBy: MODULE_ID,
      internal: true,
      suppressAutomation: false
    });

    for (const target of targets) {
      const candidate = plans.get(target.uuid)?.candidate;
      if (!active.has(target.uuid) || !candidate) continue;
      const movementId = randomId(16);
      const waypoints = candidate.path.map((position, index) => ({
        x: position.x,
        y: position.y,
        elevation: position.elevation,
        action,
        explicit: true,
        checkpoint: index === candidate.path.length - 1
      }));
      instructions[target.id] = {
        id: movementId,
        waypoints,
        method: "api",
        showRuler: false,
        autoRotate: false,
        constrainOptions: { ignoreWalls: false, ignoreCost: true, ignoreTokens: true }
      };
      releases.push(this.#movement.registerMovementContext(movementId, {
        ...baseOptions,
        actionEffects5e: {
          ...baseOptions.actionEffects5e,
          targetUuid: target.uuid,
          displacementDestinationKey: candidate.key,
          displacementDirection: candidate.directionKey ?? null,
          displacementDirectionPath: duplicateSafely(candidate.directionPath ?? []),
          requestedDistance: candidate.requestedDistance,
          actualDistance: candidate.actualDistance
        }
      }));
    }

    let moveResults = {};
    let rolledBack = false;
    let executionError = null;
    try {
      if (Object.keys(instructions).length) {
        moveResults = await scene.moveTokens(instructions, {
          method: "api",
          animate: true,
          showRuler: false,
          pan: false,
          autoRotate: false,
          constrainOptions: { ignoreWalls: false, ignoreCost: true, ignoreTokens: true },
          ...baseOptions
        });
      }
    } catch (error) {
      executionError = error;
    } finally {
      for (const release of releases) release();
    }

    const failedIds = Object.entries(moveResults).filter(([, completed]) => completed !== true).map(([id]) => id);
    if (executionError || failedIds.length) {
      rolledBack = true;
      await this.#rollback(scene, origins, Object.keys(instructions), source.uuid, movementMode);
    }

    const results = targets.map((target) => {
      const candidate = plans.get(target.uuid)?.candidate ?? blockedPlans.get(target.uuid)?.candidate ?? null;
      const moved = active.has(target.uuid) && !rolledBack && moveResults[target.id] === true;
      return {
        targetUuid: target.uuid,
        completed: moved,
        blocked: !active.has(target.uuid),
        rolledBack,
        requestedDistance: request.distance,
        actualDistance: moved ? candidate?.actualDistance ?? 0 : 0,
        partial: moved && candidate.actualDistance < request.distance,
        destination: moved ? duplicateSafely(candidate.destination) : duplicateSafely(origins[target.id]),
        obstruction: active.has(target.uuid) ? null : duplicateSafely({
          ...(candidate?.obstruction ?? {}),
          reasonCode: blockedPlans.get(target.uuid)?.reasonCode
            ?? candidate?.obstruction?.reasonCode
            ?? "no-legal-destination"
        })
      };
    });
    const response = {
      completed: !rolledBack,
      batchId,
      sourceUuid: source.uuid,
      requestedDistance: request.distance,
      movedCount: results.filter((entry) => entry.completed).length,
      blockedCount: results.filter((entry) => entry.blocked).length,
      rolledBack,
      failedIds,
      error: executionError ? String(executionError) : null,
      results
    };
    Hooks.callAll(HOOKS.DISPLACEMENT_RESOLVED, duplicateSafely(response));
    return response;
  }

  #chooseCandidate(plan) {
    return [...(plan?.candidates ?? [])]
      .filter((candidate) => candidate.selectable === true && candidate.actualDistance > 0)
      .sort((a, b) => b.actualDistance - a.actualDistance
        || String(a.pathKey ?? a.key).localeCompare(String(b.pathKey ?? b.key)))[0] ?? null;
  }

  #findBatchCollisions({ scene, targets, active, plans }) {
    const colliding = new Set();
    const movers = targets.filter((token) => active.has(token.uuid));
    const gridSize = finiteNumber(scene.grid?.size, 0);
    for (let left = 0; left < movers.length; left += 1) {
      for (let right = left + 1; right < movers.length; right += 1) {
        const a = movers[left];
        const b = movers[right];
        const aPath = plans.get(a.uuid)?.candidate?.path ?? [];
        const bPath = plans.get(b.uuid)?.candidate?.path ?? [];
        const steps = Math.max(aPath.length, bPath.length);
        for (let step = 0; step < steps; step += 1) {
          const aPosition = aPath[Math.min(step, aPath.length - 1)] ?? positionOf(a);
          const bPosition = bPath[Math.min(step, bPath.length - 1)] ?? positionOf(b);
          const aBounds = this.#boundsAt(a, aPosition, gridSize);
          const bBounds = this.#boundsAt(b, bPosition, gridSize);
          if (this.#overlaps(aBounds, bBounds)) {
            colliding.add(a.uuid);
            colliding.add(b.uuid);
            break;
          }
        }
      }
    }
    return colliding;
  }

  #boundsAt(token, position, gridSize) {
    return {
      left: position.x,
      top: position.y,
      right: position.x + (Math.max(0, finiteNumber(token.width, 1)) * gridSize),
      bottom: position.y + (Math.max(0, finiteNumber(token.height, 1)) * gridSize)
    };
  }

  #overlaps(a, b) {
    return a.left < b.right - 0.01 && a.right > b.left + 0.01
      && a.top < b.bottom - 0.01 && a.bottom > b.top + 0.01;
  }

  async #rollback(scene, origins, tokenIds, sourceUuid, movementMode) {
    const instructions = {};
    for (const tokenId of tokenIds) {
      if (!scene.tokens.get(tokenId)) continue;
      instructions[tokenId] = {
        destination: { ...origins[tokenId], checkpoint: true },
        method: "api",
        showRuler: false
      };
      this.#accounting.applyNoCostToInstruction(instructions[tokenId]);
    }
    if (!Object.keys(instructions).length) return;
    await scene.moveTokens(instructions, {
      method: "api",
      animate: false,
      constrainOptions: { ignoreWalls: true, ignoreCost: true, ignoreTokens: true },
      ...this.#movement.createOperationOptions({
        pathType: PATH_TYPES.REPOSITION,
        agency: MOVEMENT_AGENCIES.ADMINISTRATIVE,
        resource: MOVEMENT_RESOURCES.NONE,
        movementMode,
        sourceUuid,
        displacementBatchRollback: true,
        internal: true,
        suppressAutomation: true
      })
    });
  }

  async #resolveToken(uuid, label) {
    const token = typeof uuid === "string" ? await fromUuid(uuid) : uuid?.document ?? uuid;
    if (!(token instanceof foundry.documents.TokenDocument)) {
      throw new Error(`Batch forced displacement requires a valid ${label} TokenDocument or UUID.`);
    }
    return token;
  }

  #validateRequest(request, source) {
    if (request.type !== DISPLACEMENT_TYPES.PUSH) throw new Error("Batch displacement currently supports Push only.");
    if (request.directionConstraint !== DISPLACEMENT_DIRECTION_CONSTRAINTS.STRAIGHT_AWAY) {
      throw new Error("Batch Push currently requires STRAIGHT_AWAY movement.");
    }
    if (request.tokenCollisionPolicy !== "all") throw new Error("Batch Push requires all-token collision.");
    if (!(finiteNumber(request.distance, 0) > 0)) throw new Error("Batch displacement distance must be greater than 0.");
    const squareType = globalThis.CONST?.GRID_TYPES?.SQUARE;
    if (squareType !== undefined && source.parent?.grid?.type !== squareType) {
      throw new Error("Batch forced displacement currently supports square-grid Scenes only.");
    }
    if (!canvas?.ready || canvas.scene?.id !== source.parent?.id || !source.object) {
      throw new Error("Batch forced displacement requires the Source Scene to be active on the executing client.");
    }
  }

  #assertLocalPermission(source) {
    if (game.user?.isGM || source.actor?.testUserPermission?.(game.user, "OWNER")) return;
    throw new Error("You must own the Source token's Actor to request batch forced displacement.");
  }

  #assertRequestPermission(user, source) {
    if (!user?.active) throw new Error("The user requesting batch forced displacement is no longer active.");
    if (user.isGM || source.actor?.testUserPermission?.(user, "OWNER")) return;
    throw new Error("The requesting user does not own the Source token's Actor.");
  }
}
