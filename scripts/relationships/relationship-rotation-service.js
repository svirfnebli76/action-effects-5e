import {
  COLLISION_POLICIES,
  HOOKS,
  MODULE_ID,
  MOVEMENT_AGENCIES,
  MOVEMENT_RESOURCES,
  OPERATION_METADATA_KEY,
  PATH_TYPES,
  RELATIONSHIP_ALLIED_ENDPOINT_GRACE_MS,
  RELATIONSHIP_ALLIED_ENDPOINT_POLICIES,
  RELATIONSHIP_ROTATION_POLICIES,
  RELATIONSHIP_ORBIT_QUANTUM_DEGREES
} from "../core/constants.js";
import { duplicateSafely, randomId } from "../core/utils.js";
import { Logger } from "../core/logger.js";
import { RelationshipOrbitPlanner } from "./relationship-orbit-planner.js";

const TOKEN_WHEEL_WRAPPER_TARGET = "foundry.canvas.layers.TokenLayer.prototype._onMouseWheel";
const ORBIT_QUANTUM_DEGREES = RELATIONSHIP_ORBIT_QUANTUM_DEGREES;
const ARM_WINDOW_MS = 1_000;
const MAX_RECENT_REQUESTS = 100;
const ROTATION_EPSILON = 1e-5;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export class RelationshipRotationService {
  #socket;
  #relationships;
  #movement;
  #initialized = false;
  #wheelWrapperRegistered = false;
  #hookIds = [];
  #states = new Map();
  #recentRequestIds = new Set();
  #activeRelationshipIds = new Set();
  #rollbackLeaderUuids = new Set();
  #pendingAlliedOverlaps = new Map();

  constructor({ socket, relationships, movement }) {
    this.#socket = socket;
    this.#relationships = relationships;
    this.#movement = movement;
    this.#socket.register("relationships.orbitFollower", this.#orbitFollowerAsGM.bind(this));
  }

  initialize() {
    if (this.#initialized) return;
    this.#initialized = true;

    this.#hookIds.push(Hooks.on("updateToken", this.#onUpdateToken.bind(this)));
    this.#hookIds.push(Hooks.on("controlToken", this.#onControlToken.bind(this)));
    this.#hookIds.push(Hooks.on("canvasReady", () => {
      this.#resetAll("canvas-ready");
      this.#clearAllPendingAlliedOverlaps("canvas-ready");
    }));
    this.#hookIds.push(Hooks.on(HOOKS.RELATIONSHIP_CREATED, (relationship) => {
      this.#resetRelationship(relationship?.id, "relationship-created");
      this.#clearPendingAlliedOverlap(relationship?.id, "relationship-created");
    }));
    this.#hookIds.push(Hooks.on(HOOKS.RELATIONSHIP_REMOVED, (relationship) => {
      this.#resetRelationship(relationship?.id, "relationship-removed");
      this.#clearPendingAlliedOverlap(relationship?.id, "relationship-removed");
    }));
    this.#hookIds.push(Hooks.on(HOOKS.RELATIONSHIPS_REINDEXED, () => {
      this.#pruneStates();
      this.#prunePendingAlliedOverlaps();
    }));
    this.#hookIds.push(Hooks.on(HOOKS.MOVEMENT_TRANSACTION, this.#onMovementTransaction.bind(this)));

    this.#registerWheelWrapper();
    Logger.info("Relationship rotation service ready.");
  }

  shutdown() {
    if (!this.#initialized) return;
    const hookNames = [
      "updateToken",
      "controlToken",
      "canvasReady",
      HOOKS.RELATIONSHIP_CREATED,
      HOOKS.RELATIONSHIP_REMOVED,
      HOOKS.RELATIONSHIPS_REINDEXED,
      HOOKS.MOVEMENT_TRANSACTION
    ];
    for (let index = 0; index < this.#hookIds.length; index += 1) {
      Hooks.off(hookNames[index], this.#hookIds[index]);
    }
    this.#hookIds = [];
    this.#states.clear();
    this.#recentRequestIds.clear();
    this.#activeRelationshipIds.clear();
    this.#rollbackLeaderUuids.clear();
    this.#clearAllPendingAlliedOverlaps("shutdown");
    this.#unregisterWheelWrapper();
    this.#initialized = false;
  }

  getStats() {
    return {
      initialized: this.#initialized,
      wheelWrapperRegistered: this.#wheelWrapperRegistered,
      trackedRelationships: this.#states.size,
      armedGestures: [...this.#states.values()].filter((state) => state.armedUntil > Date.now()).length,
      pendingEvents: [...this.#states.values()].reduce((total, state) => total + state.events.length, 0),
      processingRelationships: [...this.#states.values()].filter((state) => Boolean(state.drainPromise)).length,
      activeGmRequests: this.#activeRelationshipIds.size,
      rotationRollbacks: this.#rollbackLeaderUuids.size,
      pendingAlliedOverlaps: this.#pendingAlliedOverlaps.size,
      recentRequests: this.#recentRequestIds.size,
      orbitQuantumDegrees: ORBIT_QUANTUM_DEGREES
    };
  }

  async waitForSettled({ leaderUuid = null, timeoutMs = 5_000, pollMs = 25 } = {}) {
    const deadline = Date.now() + Math.max(100, Number(timeoutMs) || 5_000);
    const interval = Math.max(5, Number(pollMs) || 25);
    const observedAnimations = new WeakSet();

    while (Date.now() <= deadline) {
      const states = [...this.#states.values()].filter((state) => !leaderUuid || state.leaderUuid === leaderUuid);
      const drains = states.map((state) => state.drainPromise).filter((promise) => promise && typeof promise.then === "function");
      if (drains.length) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await Promise.race([
          Promise.allSettled(drains),
          sleep(Math.min(remaining, interval))
        ]);
        continue;
      }

      const tokenUuids = new Set();
      for (const state of states) {
        tokenUuids.add(state.leaderUuid);
        tokenUuids.add(state.followerUuid);
      }
      const animations = [];
      for (const uuid of tokenUuids) {
        const token = await fromUuid(uuid);
        const animation = token?.object?.movementAnimationPromise;
        if (animation && typeof animation.then === "function" && !observedAnimations.has(animation)) animations.push(animation);
      }
      if (animations.length) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        let timedOut = false;
        await Promise.race([
          Promise.allSettled(animations).then(() => {
            for (const animation of animations) observedAnimations.add(animation);
          }),
          sleep(remaining).then(() => { timedOut = true; })
        ]);
        if (timedOut) break;
        continue;
      }

      const active = [...this.#activeRelationshipIds].some((relationshipId) => {
        if (!leaderUuid) return true;
        return this.#relationships.get(relationshipId)?.leaderUuid === leaderUuid;
      });
      if (!active) return true;
      await sleep(interval);
    }

    throw new Error("Timed out while waiting for Action Effects 5E relationship rotation to settle.");
  }

  #registerWheelWrapper() {
    if (this.#wheelWrapperRegistered) return;
    const wrapperApi = globalThis.libWrapper;
    if (!wrapperApi?.register) {
      Logger.warn("libWrapper TokenLayer mouse-wheel integration is unavailable; relationship orbital rotation is disabled.");
      return;
    }

    const service = this;
    try {
      wrapperApi.register(
        MODULE_ID,
        TOKEN_WHEEL_WRAPPER_TARGET,
        function ae5eTokenLayerMouseWheelWrapper(wrapped, event) {
          service.#armMouseWheelGesture(this, event);
          return wrapped(event);
        },
        "MIXED"
      );
      this.#wheelWrapperRegistered = true;
    } catch (error) {
      Logger.warn("Could not register the TokenLayer mouse-wheel wrapper; relationship orbital rotation is disabled.", error);
      this.#wheelWrapperRegistered = false;
    }
  }

  #unregisterWheelWrapper() {
    if (!this.#wheelWrapperRegistered) return;
    try {
      globalThis.libWrapper?.unregister?.(MODULE_ID, TOKEN_WHEEL_WRAPPER_TARGET);
    } catch (error) {
      Logger.debug("Could not unregister the TokenLayer relationship rotation wrapper during shutdown.", error);
    }
    this.#wheelWrapperRegistered = false;
  }

  #armMouseWheelGesture(layer, event) {
    const nativeEvent = event?.nativeEvent ?? event;
    if (!(nativeEvent?.shiftKey === true || nativeEvent?.ctrlKey === true)) return;

    const controlled = Array.isArray(layer?.controlled) ? layer.controlled : canvas?.tokens?.controlled;
    if (!Array.isArray(controlled) || controlled.length !== 1) return;

    const tokenObject = controlled[0];
    const leader = tokenObject?.document;
    if (!(leader instanceof foundry.documents.TokenDocument)) return;

    const enabled = this.#orbitRelationshipsForLeader(leader.uuid);
    if (enabled.length !== 1) return;

    const relationship = enabled[0];
    const state = this.#stateFor(relationship, leader.rotation);
    const now = Date.now();
    if (state.armedUntil <= now) state.lastObservedRotation = RelationshipOrbitPlanner.normalizeRotation(leader.rotation);
    state.armedUntil = now + ARM_WINDOW_MS;
    state.gestureSerial += 1;
    const serial = state.gestureSerial;

    setTimeout(() => {
      const current = this.#states.get(relationship.id);
      if (!current || current.gestureSerial !== serial) return;
      current.armedUntil = 0;
    }, ARM_WINDOW_MS + 25);
  }

  #onUpdateToken(document, changes, options = {}, userId = null) {
    if (!(document instanceof foundry.documents.TokenDocument)) return;
    if (!Object.prototype.hasOwnProperty.call(changes ?? {}, "rotation")) return;

    // Foundry v14.365 fires updateToken while TokenDocument.rotation still
    // contains the pre-update value. The authoritative committed destination
    // for this hook is changes.rotation. Reading document.rotation here makes
    // orbit tracking lag one rotation update behind the visible token.
    const changedRotation = finiteNumber(changes.rotation);
    if (changedRotation === null) return;
    const currentRotation = RelationshipOrbitPlanner.normalizeRotation(changedRotation);

    const metadata = options?.[OPERATION_METADATA_KEY];
    if (this.#rollbackLeaderUuids.has(document.uuid)
      || (metadata?.relationshipOrbitRollback === true && metadata?.generatedBy === MODULE_ID)) {
      this.#syncKnownRotation(document.uuid, currentRotation);
      return;
    }

    const enabled = this.#orbitRelationshipsForLeader(document.uuid);
    if (!enabled.length) return;

    // Only the client which initiated the native wheel rotation turns that
    // rotation into an orbit request. Other clients observe the document update
    // but never duplicate the Socketlib request.
    if (userId !== game.user?.id) {
      // A rotation initiated by another client is not this client's armed wheel
      // gesture. Reset any partial local accumulator so a stale 15°/22.5°
      // fragment cannot combine with a later local wheel event. GM-authorized
      // orbit rollbacks are handled above through namespaced operation metadata.
      for (const relationship of enabled) {
        this.#resetRelationship(relationship.id, "remote-rotation");
        const state = this.#stateFor(relationship, currentRotation);
        state.lastObservedRotation = currentRotation;
      }
      return;
    }

    if (enabled.length !== 1) {
      for (const relationship of enabled) this.#resetRelationship(relationship.id, "multiple-orbit-followers");
      return;
    }

    const relationship = enabled[0];
    const state = this.#stateFor(relationship, currentRotation);
    const now = Date.now();

    if (state.armedUntil < now) {
      // A non-wheel/API/configuration rotation invalidates any partial orbit
      // accumulation so an old 15° or 22.5° fragment cannot fire later.
      state.accumulator = 0;
      state.lastObservedRotation = currentRotation;
      state.generation += 1;
      state.events.length = 0;
      return;
    }

    // Capture both ends of the native update before asynchronous GM
    // authorization begins. Foundry v14 can still expose the pre-update
    // TokenDocument.rotation while updateToken is running, so rollback must
    // never reconstruct the previous facing from later document state.
    const leaderRotationBefore = RelationshipOrbitPlanner.normalizeRotation(state.lastObservedRotation);
    const leaderRotationAfter = currentRotation;
    const delta = RelationshipOrbitPlanner.signedRotationDelta(leaderRotationBefore, leaderRotationAfter);
    state.lastObservedRotation = leaderRotationAfter;
    if (Math.abs(delta) <= ROTATION_EPSILON) return;

    state.events.push({
      delta,
      leaderRotationBefore,
      leaderRotationAfter,
      generation: state.generation,
      observedAt: now
    });
    this.#ensureDrain(state);
  }

  #onControlToken(token, controlled) {
    if (controlled !== false) return;
    const leaderUuid = token?.document?.uuid;
    if (!leaderUuid) return;
    for (const relationship of this.#orbitRelationshipsForLeader(leaderUuid)) {
      this.#resetRelationship(relationship.id, "leader-released");
    }
  }

  #onMovementTransaction(transaction) {
    if (!transaction || transaction.phase !== "after") return;
    if (transaction.metadata?.relationshipOrbit === true && transaction.generatedBy === MODULE_ID) return;
    if (RelationshipOrbitPlanner.positionsEqual(transaction.origin, transaction.destination)) return;

    for (const relationship of this.#relationships.getForLeader(transaction.subjectUuid)) {
      if (this.#rotationPolicy(relationship) === RELATIONSHIP_ROTATION_POLICIES.ORBIT_FOLLOWER) {
        this.#clearPendingAlliedOverlap(relationship.id, "leader-translated");
        this.#resetRelationship(relationship.id, "leader-translated");
      }
    }
    for (const relationship of this.#relationships.getForFollower(transaction.subjectUuid)) {
      if (this.#rotationPolicy(relationship) === RELATIONSHIP_ROTATION_POLICIES.ORBIT_FOLLOWER) {
        this.#clearPendingAlliedOverlap(relationship.id, "follower-translated");
        this.#resetRelationship(relationship.id, "follower-translated");
      }
    }
  }

  #stateFor(relationship, rotation = 0) {
    let state = this.#states.get(relationship.id);
    if (!state) {
      state = {
        relationshipId: relationship.id,
        leaderUuid: relationship.leaderUuid,
        followerUuid: relationship.followerUuid,
        accumulator: 0,
        lastObservedRotation: RelationshipOrbitPlanner.normalizeRotation(rotation),
        armedUntil: 0,
        gestureSerial: 0,
        generation: 0,
        events: [],
        drainPromise: null
      };
      this.#states.set(relationship.id, state);
    } else {
      state.leaderUuid = relationship.leaderUuid;
      state.followerUuid = relationship.followerUuid;
    }
    return state;
  }

  #ensureDrain(state) {
    if (state.drainPromise) return;
    state.drainPromise = this.#drainState(state)
      .catch((error) => {
        Logger.error("Relationship orbital rotation queue failed.", error);
        ui?.notifications?.error?.(`Action Effects 5E orbital rotation failed: ${error.message}`);
      })
      .finally(() => {
        state.drainPromise = null;
        const relationship = this.#relationships.get(state.relationshipId);
        if (!relationship || this.#rotationPolicy(relationship) !== RELATIONSHIP_ROTATION_POLICIES.ORBIT_FOLLOWER) {
          this.#states.delete(state.relationshipId);
          return;
        }
        if (state.events.length && this.#states.get(state.relationshipId) === state) this.#ensureDrain(state);
      });
  }

  async #drainState(state) {
    while (state.events.length) {
      const event = state.events.shift();
      if (event.generation !== state.generation) continue;

      const relationship = this.#relationships.get(state.relationshipId);
      if (!relationship || this.#rotationPolicy(relationship) !== RELATIONSHIP_ROTATION_POLICIES.ORBIT_FOLLOWER) {
        this.#resetRelationship(state.relationshipId, "relationship-unavailable");
        return;
      }

      const accumulatorBefore = state.accumulator;
      const total = accumulatorBefore + event.delta;
      const signedSteps = Math.trunc(total / ORBIT_QUANTUM_DEGREES);
      if (!signedSteps) {
        state.accumulator = total;
        continue;
      }

      const direction = Math.sign(signedSteps);
      const steps = Math.min(8, Math.abs(signedSteps));
      const consumed = direction * steps * ORBIT_QUANTUM_DEGREES;
      const remainder = total - consumed;

      const leader = await fromUuid(relationship.leaderUuid);
      const follower = await fromUuid(relationship.followerUuid);
      if (!(leader instanceof foundry.documents.TokenDocument) || !(follower instanceof foundry.documents.TokenDocument)) {
        this.#resetRelationship(state.relationshipId, "tokens-unavailable");
        return;
      }

      const request = {
        requestId: `${MODULE_ID}-orbit-${randomId(20)}`,
        requestingUserId: game.user.id,
        relationshipId: relationship.id,
        sceneId: relationship.sceneId,
        leaderUuid: relationship.leaderUuid,
        followerUuid: relationship.followerUuid,
        leaderPosition: { x: leader.x, y: leader.y, elevation: leader.elevation },
        followerPosition: { x: follower.x, y: follower.y, elevation: follower.elevation },
        direction,
        steps,
        rotationDelta: event.delta,
        leaderRotationBefore: event.leaderRotationBefore,
        leaderRotationAfter: event.leaderRotationAfter
      };

      let result;
      try {
        result = await this.#socket.executeAsGM("relationships.orbitFollower", request);
      } catch (error) {
        // The GM did not authorize/complete the orbit. Do not silently consume
        // the threshold; retain the pre-event accumulator and surface the error.
        state.accumulator = accumulatorBefore;
        throw error;
      }

      if (event.generation !== state.generation) continue;

      if (result?.completed === true) {
        state.accumulator = remainder;
        if (Number.isFinite(Number(result.leaderRotation))) {
          state.lastObservedRotation = RelationshipOrbitPlanner.normalizeRotation(result.leaderRotation);
        }
        await this.#awaitLocalFollowerAnimation(relationship.followerUuid);
        continue;
      }

      if (result?.detached === true) {
        this.#resetRelationship(state.relationshipId, "relationship-detached");
        if (result?.message) ui?.notifications?.warn?.(result.message);
        return;
      }

      if (result?.rolledBackRotation === true) {
        state.accumulator = accumulatorBefore;
        if (Number.isFinite(Number(result.leaderRotation))) {
          state.lastObservedRotation = RelationshipOrbitPlanner.normalizeRotation(result.leaderRotation);
        }
      } else {
        state.accumulator = accumulatorBefore;
      }
      if (result?.message) ui?.notifications?.warn?.(result.message);
    }
  }

  async #awaitLocalFollowerAnimation(followerUuid) {
    // Socketlib can deliver the GM result and the Token update on very close but
    // independent network turns. Give the local canvas a short opportunity to
    // expose its movementAnimationPromise before deciding there is nothing to
    // serialize. This keeps rapid wheel input from launching overlapping follower
    // animations without imposing a fixed delay after normal completed movement.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const follower = await fromUuid(followerUuid);
      const animation = follower?.object?.movementAnimationPromise;
      if (animation && typeof animation.then === "function") {
        try {
          await animation;
        } catch (error) {
          Logger.debug("Follower orbit animation ended with a rejected promise.", error);
        }
        return;
      }
      if (!follower?.object) return;
      await sleep(20);
    }
  }

  async #orbitFollowerAsGM(request = {}) {
    this.#assertExecutingAsGM();

    const requestId = String(request.requestId ?? `${MODULE_ID}-orbit-${randomId(20)}`);
    if (this.#recentRequestIds.has(requestId)) {
      return { completed: false, duplicate: true, message: "This orbital movement request was already processed." };
    }
    this.#rememberRequest(requestId);

    const requester = game.users.get(request.requestingUserId);
    if (!requester) throw new Error("The requesting user no longer exists.");

    const relationship = this.#relationships.get(request.relationshipId);
    if (!relationship) return { completed: false, relationshipMissing: true, message: "The token relationship no longer exists." };
    if (this.#rotationPolicy(relationship) !== RELATIONSHIP_ROTATION_POLICIES.ORBIT_FOLLOWER) {
      return { completed: false, message: "This relationship does not permit orbital rotation." };
    }
    if (relationship.leaderUuid !== request.leaderUuid || relationship.followerUuid !== request.followerUuid) {
      throw new Error("The orbital movement request does not match the active relationship.");
    }

    const scene = game.scenes.get(request.sceneId);
    if (!scene || scene.id !== relationship.sceneId) throw new Error("The requested Scene does not match the active relationship.");

    const leader = await fromUuid(relationship.leaderUuid);
    const follower = await fromUuid(relationship.followerUuid);
    if (!(leader instanceof foundry.documents.TokenDocument) || !(follower instanceof foundry.documents.TokenDocument)) {
      throw new Error("The relationship tokens are unavailable.");
    }
    if (leader.parent?.id !== scene.id || follower.parent?.id !== scene.id) {
      throw new Error("The relationship tokens are not on the requested Scene.");
    }

    if (!requester.isGM) {
      const owner = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
      if (!leader.testUserPermission(requester, owner)) {
        throw new Error("The requesting user does not own the relationship leader.");
      }
    }

    const direction = Math.sign(Number(request.direction));
    const steps = Math.trunc(Math.abs(Number(request.steps)));
    const rotationDelta = finiteNumber(request.rotationDelta);
    const leaderRotationBeforeValue = finiteNumber(request.leaderRotationBefore);
    const leaderRotationAfterValue = finiteNumber(request.leaderRotationAfter);
    if (!direction || !(steps >= 1 && steps <= 8) || rotationDelta === null
      || leaderRotationBeforeValue === null || leaderRotationAfterValue === null
      || Math.abs(rotationDelta) > 360 + ROTATION_EPSILON) {
      throw new Error("The orbital movement request contains invalid rotation data.");
    }

    const leaderRotationBefore = RelationshipOrbitPlanner.normalizeRotation(leaderRotationBeforeValue);
    const leaderRotationAfter = RelationshipOrbitPlanner.normalizeRotation(leaderRotationAfterValue);
    const snapshotDelta = RelationshipOrbitPlanner.signedRotationDelta(leaderRotationBefore, leaderRotationAfter);
    if (Math.abs(snapshotDelta - rotationDelta) > ROTATION_EPSILON) {
      throw new Error("The orbital movement request contains inconsistent rotation data.");
    }

    const maximumStepsForDelta = Math.max(1, Math.ceil((Math.abs(rotationDelta) + ORBIT_QUANTUM_DEGREES - ROTATION_EPSILON) / ORBIT_QUANTUM_DEGREES));
    if (steps > maximumStepsForDelta) throw new Error("The orbital movement request exceeds the observed rotation change.");

    if (!RelationshipOrbitPlanner.positionsEqual(request.leaderPosition, leader)
      || !RelationshipOrbitPlanner.positionsEqual(request.followerPosition, follower)) {
      return { completed: false, stale: true, message: "The relationship moved before orbital rotation could be resolved." };
    }

    if (this.#activeRelationshipIds.has(relationship.id)) {
      return { completed: false, busy: true, message: "This relationship is already resolving orbital movement." };
    }

    this.#activeRelationshipIds.add(relationship.id);
    try {
      const waypoints = RelationshipOrbitPlanner.buildWaypoints({
        leader,
        follower,
        grid: scene.grid,
        direction,
        steps
      });

      const collision = this.#preflightFollowerPath({ follower, waypoints });
      if (collision) {
        if (relationship.collisionPolicy === COLLISION_POLICIES.DETACH) {
          await this.#relationships.removeManyAsGM([relationship.id]);
          return {
            completed: false,
            detached: true,
            message: `${follower.name ?? "The follower token"} cannot orbit through that path, so the relationship was detached.`,
            leaderRotation: leader.rotation
          };
        }

        const leaderRotation = await this.#rollbackLeaderRotation(leader, leaderRotationBefore, requestId);
        this.#refreshPendingAlliedOverlap(relationship.id);
        return {
          completed: false,
          collision: true,
          rolledBackRotation: true,
          leaderRotation,
          message: `${follower.name ?? "The follower token"} cannot orbit through that path because it is blocked.`
        };
      }

      const movementId = randomId(16);
      const action = globalThis.CONFIG?.Token?.movement?.defaultAction ?? "walk";
      const followerWaypoints = waypoints.map((waypoint) => ({ ...waypoint, action }));
      const instructions = {
        [follower.id]: {
          id: movementId,
          waypoints: followerWaypoints,
          method: "api",
          showRuler: false,
          autoRotate: false
        }
      };
      const operationOptions = {
        method: "api",
        showRuler: false,
        pan: false,
        autoRotate: false,
        constrainOptions: { ignoreWalls: false, ignoreCost: true },
        ...this.#movement.createOperationOptions({
          transactionId: `${MODULE_ID}-orbit-${randomId(16)}`,
          pathType: PATH_TYPES.TRAVERSE,
          agency: MOVEMENT_AGENCIES.PASSENGER,
          resource: MOVEMENT_RESOURCES.NONE,
          movementMode: action,
          sourceUuid: relationship.sourceUuid ?? null,
          initiatorUuid: leader.uuid,
          leaderUuid: leader.uuid,
          relationshipIds: [relationship.id],
          requestingUserId: requester.id,
          relationshipMovement: true,
          relationshipOrbit: true,
          generatedBy: MODULE_ID,
          internal: true,
          suppressAutomation: false
        })
      };
      const releaseContext = this.#movement.registerMovementContext(movementId, operationOptions);
      let results;
      try {
        results = await scene.moveTokens(instructions, operationOptions);
      } finally {
        releaseContext();
      }

      if (results?.[follower.id] !== true) {
        if (relationship.collisionPolicy === COLLISION_POLICIES.DETACH) {
          await this.#relationships.removeManyAsGM([relationship.id]);
          return {
            completed: false,
            detached: true,
            results,
            leaderRotation: leader.rotation,
            message: "The follower could not complete orbital movement, so the relationship was detached."
          };
        }

        const leaderRotation = await this.#rollbackLeaderRotation(leader, leaderRotationBefore, requestId);
        this.#refreshPendingAlliedOverlap(relationship.id);
        return {
          completed: false,
          rolledBackRotation: true,
          results,
          leaderRotation,
          message: "The follower could not complete orbital movement, so the triggering leader rotation was restored."
        };
      }

      // The path itself may be legal while its terminal square is shared with
      // an allied creature. D&D5e/Foundry permits traversal through allies, and
      // Foundry's constrainMovementPath does not reject an occupied endpoint.
      // Give the user a short continuation window: another orbit may carry the
      // follower through the allied square. If the follower remains there when
      // the grace window expires, restore the exact pre-overlap follower slot
      // and corresponding leader facing.
      await this.#awaitLocalFollowerAnimation(follower.uuid);
      const alliedOccupants = this.#alliedEndpointOccupants({
        scene,
        follower,
        leader,
        destination: followerWaypoints.at(-1)
      });
      if (alliedOccupants.length && this.#alliedEndpointPolicy(relationship) === RELATIONSHIP_ALLIED_ENDPOINT_POLICIES.GRACE) {
        this.#schedulePendingAlliedOverlap({
          relationship,
          requester,
          leader,
          follower,
          anchorFollowerPosition: request.followerPosition,
          anchorLeaderRotation: leaderRotationBefore,
          overlapPosition: followerWaypoints.at(-1),
          occupantUuids: alliedOccupants.map((token) => token.uuid)
        });
      } else {
        this.#clearPendingAlliedOverlap(relationship.id, "orbit-ended-clear");
      }

      Logger.debug("Relationship orbital movement completed", {
        relationshipId: relationship.id,
        leaderUuid: leader.uuid,
        followerUuid: follower.uuid,
        direction,
        steps,
        rotationDelta,
        destination: followerWaypoints.at(-1)
      });

      return {
        completed: true,
        results,
        relationshipId: relationship.id,
        waypoints: duplicateSafely(followerWaypoints),
        leaderRotation: leader.rotation
      };
    } catch (error) {
      if (/currently supports|must occupy|square Scene grid/i.test(error.message ?? "")) {
        const leaderRotation = await this.#rollbackLeaderRotation(leader, leaderRotationBefore, requestId);
        this.#refreshPendingAlliedOverlap(relationship.id);
        return {
          completed: false,
          unsupported: true,
          rolledBackRotation: true,
          leaderRotation,
          message: error.message
        };
      }
      throw error;
    } finally {
      this.#activeRelationshipIds.delete(relationship.id);
    }
  }

  #preflightFollowerPath({ follower, waypoints }) {
    const placeable = follower.object;
    if (!placeable?.constrainMovementPath) {
      Logger.debug(`Skipped orbital collision preflight for ${follower.uuid}; its Scene is not rendered on the active GM canvas.`);
      return false;
    }

    const path = [{ x: follower.x, y: follower.y, elevation: follower.elevation }, ...waypoints];
    const [, wasConstrained] = placeable.constrainMovementPath(path, {
      preview: false,
      ignoreWalls: false,
      ignoreCost: true,
      maxCost: Infinity,
      maxDistance: Infinity
    });
    return wasConstrained === true;
  }

  #alliedEndpointPolicy(relationship) {
    return Object.values(RELATIONSHIP_ALLIED_ENDPOINT_POLICIES).includes(relationship?.alliedEndpointPolicy)
      ? relationship.alliedEndpointPolicy
      : RELATIONSHIP_ALLIED_ENDPOINT_POLICIES.GRACE;
  }

  #alliedEndpointGraceMs(relationship) {
    const configured = finiteNumber(relationship?.alliedEndpointGraceMs);
    return configured !== null && configured > 0
      ? configured
      : RELATIONSHIP_ALLIED_ENDPOINT_GRACE_MS;
  }

  #alliedEndpointOccupants({ scene, follower, leader, destination }) {
    if (!scene?.tokens || !follower || !destination) return [];
    const gridSize = finiteNumber(scene.grid?.size);
    if (!(gridSize > 0)) return [];

    const followerDisposition = finiteNumber(follower.disposition);
    const friendly = finiteNumber(globalThis.CONST?.TOKEN_DISPOSITIONS?.FRIENDLY, 1);
    const hostile = finiteNumber(globalThis.CONST?.TOKEN_DISPOSITIONS?.HOSTILE, -1);
    if (followerDisposition !== friendly && followerDisposition !== hostile) return [];

    const followerBounds = this.#tokenBoundsAt(follower, destination, gridSize);
    const followerElevation = finiteNumber(destination.elevation, finiteNumber(follower.elevation, 0));

    return [...scene.tokens].filter((candidate) => {
      if (!(candidate instanceof foundry.documents.TokenDocument)) return false;
      if (candidate.uuid === follower.uuid || candidate.uuid === leader?.uuid) return false;
      const candidateDisposition = finiteNumber(candidate.disposition);
      if (candidateDisposition !== followerDisposition) return false;
      if (candidateDisposition !== friendly && candidateDisposition !== hostile) return false;
      if (Math.abs(finiteNumber(candidate.elevation, 0) - followerElevation) > 0.01) return false;
      return this.#boundsOverlap(followerBounds, this.#tokenBoundsAt(candidate, candidate, gridSize));
    });
  }

  #tokenBoundsAt(token, position, gridSize) {
    const x = finiteNumber(position?.x, finiteNumber(token?.x, 0));
    const y = finiteNumber(position?.y, finiteNumber(token?.y, 0));
    const width = Math.max(0, finiteNumber(token?.width, 1)) * gridSize;
    const height = Math.max(0, finiteNumber(token?.height, 1)) * gridSize;
    return { left: x, top: y, right: x + width, bottom: y + height };
  }

  #boundsOverlap(a, b) {
    return a.left < b.right - 0.01
      && a.right > b.left + 0.01
      && a.top < b.bottom - 0.01
      && a.bottom > b.top + 0.01;
  }

  #schedulePendingAlliedOverlap({
    relationship,
    requester,
    leader,
    follower,
    anchorFollowerPosition,
    anchorLeaderRotation,
    overlapPosition,
    occupantUuids = []
  }) {
    const existing = this.#pendingAlliedOverlaps.get(relationship.id);
    const serial = (existing?.serial ?? 0) + 1;
    if (existing?.timeoutId) clearTimeout(existing.timeoutId);

    const entry = {
      relationshipId: relationship.id,
      sceneId: relationship.sceneId,
      leaderUuid: leader.uuid,
      followerUuid: follower.uuid,
      requestingUserId: requester?.id ?? game.user?.id ?? null,
      anchorFollowerPosition: duplicateSafely(existing?.anchorFollowerPosition ?? anchorFollowerPosition),
      anchorLeaderRotation: existing?.anchorLeaderRotation ?? RelationshipOrbitPlanner.normalizeRotation(anchorLeaderRotation),
      overlapPosition: duplicateSafely(overlapPosition),
      occupantUuids: [...new Set(occupantUuids)],
      graceMs: this.#alliedEndpointGraceMs(relationship),
      serial,
      timeoutId: null
    };

    entry.timeoutId = setTimeout(() => {
      void this.#expirePendingAlliedOverlap(relationship.id, serial);
    }, entry.graceMs);
    this.#pendingAlliedOverlaps.set(relationship.id, entry);

    Logger.debug("Relationship orbit entered an allied occupied endpoint grace window", {
      relationshipId: relationship.id,
      leaderUuid: leader.uuid,
      followerUuid: follower.uuid,
      graceMs: entry.graceMs,
      occupantUuids: entry.occupantUuids
    });
  }

  #refreshPendingAlliedOverlap(relationshipId) {
    const entry = this.#pendingAlliedOverlaps.get(relationshipId);
    if (!entry) return;
    const relationship = this.#relationships.get(relationshipId);
    if (!relationship) {
      this.#clearPendingAlliedOverlap(relationshipId, "relationship-unavailable");
      return;
    }

    if (entry.timeoutId) clearTimeout(entry.timeoutId);
    entry.serial += 1;
    entry.graceMs = this.#alliedEndpointGraceMs(relationship);
    const serial = entry.serial;
    entry.timeoutId = setTimeout(() => {
      void this.#expirePendingAlliedOverlap(relationshipId, serial);
    }, entry.graceMs);
  }

  async #expirePendingAlliedOverlap(relationshipId, serial) {
    const entry = this.#pendingAlliedOverlaps.get(relationshipId);
    if (!entry || entry.serial !== serial) return;

    // Never roll a token back while a newer GM-authorized orbital operation is
    // still resolving. Defer briefly; a completed follow-up step will either
    // clear or refresh the pending overlap itself.
    if (this.#activeRelationshipIds.has(relationshipId)) {
      entry.timeoutId = setTimeout(() => {
        void this.#expirePendingAlliedOverlap(relationshipId, serial);
      }, 50);
      return;
    }

    const relationship = this.#relationships.get(relationshipId);
    if (!relationship) {
      this.#clearPendingAlliedOverlap(relationshipId, "relationship-unavailable");
      return;
    }

    const scene = game.scenes.get(entry.sceneId);
    const leader = await fromUuid(entry.leaderUuid);
    const follower = await fromUuid(entry.followerUuid);
    if (!scene || !(leader instanceof foundry.documents.TokenDocument) || !(follower instanceof foundry.documents.TokenDocument)) {
      this.#clearPendingAlliedOverlap(relationshipId, "tokens-unavailable");
      return;
    }

    if (!RelationshipOrbitPlanner.positionsEqual(entry.overlapPosition, follower)) {
      this.#clearPendingAlliedOverlap(relationshipId, "follower-left-overlap");
      return;
    }

    const occupants = this.#alliedEndpointOccupants({
      scene,
      follower,
      leader,
      destination: { x: follower.x, y: follower.y, elevation: follower.elevation }
    });
    if (!occupants.length) {
      this.#clearPendingAlliedOverlap(relationshipId, "overlap-cleared");
      return;
    }

    this.#clearPendingAlliedOverlap(relationshipId, "grace-expired");
    const requestId = `${MODULE_ID}-orbit-overlap-rollback-${randomId(20)}`;
    await this.#rollbackFollowerPosition({
      scene,
      leader,
      follower,
      relationship,
      position: entry.anchorFollowerPosition,
      requestId
    });
    await this.#rollbackLeaderRotation(leader, entry.anchorLeaderRotation, requestId);

    Logger.debug("Relationship orbit allied endpoint grace expired; restored the last legal orbit state", {
      relationshipId,
      leaderUuid: leader.uuid,
      followerUuid: follower.uuid,
      restoredFollowerPosition: entry.anchorFollowerPosition,
      restoredLeaderRotation: entry.anchorLeaderRotation
    });
  }

  async #rollbackFollowerPosition({ scene, leader, follower, relationship, position, requestId }) {
    if (!scene.tokens.get(follower.id)) return;
    const movementId = randomId(16);
    const instructions = {
      [follower.id]: {
        id: movementId,
        destination: {
          x: finiteNumber(position?.x, follower.x),
          y: finiteNumber(position?.y, follower.y),
          elevation: finiteNumber(position?.elevation, follower.elevation),
          checkpoint: true
        },
        method: "api",
        showRuler: false,
        autoRotate: false
      }
    };
    const operationOptions = {
      method: "api",
      animate: false,
      showRuler: false,
      pan: false,
      autoRotate: false,
      constrainOptions: { ignoreWalls: true, ignoreCost: true },
      ...this.#movement.createOperationOptions({
        transactionId: `${MODULE_ID}-orbit-overlap-rollback-${randomId(16)}`,
        pathType: PATH_TYPES.REPOSITION,
        agency: MOVEMENT_AGENCIES.ADMINISTRATIVE,
        resource: MOVEMENT_RESOURCES.NONE,
        sourceUuid: relationship.sourceUuid ?? null,
        initiatorUuid: leader.uuid,
        leaderUuid: leader.uuid,
        relationshipIds: [relationship.id],
        requestingUserId: game.user?.id ?? null,
        relationshipMovement: true,
        relationshipOrbit: true,
        relationshipOrbitGraceRollback: true,
        requestId,
        generatedBy: MODULE_ID,
        internal: true,
        suppressAutomation: true
      })
    };
    const releaseContext = this.#movement.registerMovementContext(movementId, operationOptions);
    try {
      await scene.moveTokens(instructions, operationOptions);
    } finally {
      releaseContext();
    }
  }

  #clearPendingAlliedOverlap(relationshipId, reason = "clear") {
    if (!relationshipId) return;
    const entry = this.#pendingAlliedOverlaps.get(relationshipId);
    if (!entry) return;
    if (entry.timeoutId) clearTimeout(entry.timeoutId);
    this.#pendingAlliedOverlaps.delete(relationshipId);
    Logger.debug("Cleared relationship allied endpoint grace state", { relationshipId, reason });
  }

  #clearAllPendingAlliedOverlaps(reason = "clear-all") {
    for (const relationshipId of [...this.#pendingAlliedOverlaps.keys()]) {
      this.#clearPendingAlliedOverlap(relationshipId, reason);
    }
  }

  #prunePendingAlliedOverlaps() {
    for (const relationshipId of [...this.#pendingAlliedOverlaps.keys()]) {
      const relationship = this.#relationships.get(relationshipId);
      if (!relationship || this.#rotationPolicy(relationship) !== RELATIONSHIP_ROTATION_POLICIES.ORBIT_FOLLOWER) {
        this.#clearPendingAlliedOverlap(relationshipId, "relationship-pruned");
      }
    }
  }

  async #rollbackLeaderRotation(leader, rollbackRotation, requestId) {
    const target = RelationshipOrbitPlanner.normalizeRotation(
      finiteNumber(rollbackRotation, leader.rotation)
    );
    this.#rollbackLeaderUuids.add(leader.uuid);
    try {
      await leader.update({ rotation: target }, {
        [OPERATION_METADATA_KEY]: {
          generatedBy: MODULE_ID,
          relationshipOrbitRollback: true,
          requestId,
          internal: true
        }
      });
    } finally {
      this.#rollbackLeaderUuids.delete(leader.uuid);
    }
    return target;
  }

  #orbitRelationshipsForLeader(leaderUuid) {
    return this.#relationships.getForLeader(leaderUuid)
      .filter((relationship) => this.#rotationPolicy(relationship) === RELATIONSHIP_ROTATION_POLICIES.ORBIT_FOLLOWER);
  }

  #rotationPolicy(relationship) {
    return relationship?.rotationPolicy ?? RELATIONSHIP_ROTATION_POLICIES.NONE;
  }

  #syncKnownRotation(leaderUuid, rotation) {
    for (const relationship of this.#orbitRelationshipsForLeader(leaderUuid)) {
      const state = this.#stateFor(relationship, rotation);
      state.lastObservedRotation = RelationshipOrbitPlanner.normalizeRotation(rotation);
    }
  }

  #resetRelationship(relationshipId, reason = "reset") {
    if (!relationshipId) return;
    const state = this.#states.get(relationshipId);
    if (!state) return;
    state.generation += 1;
    state.events.length = 0;
    state.accumulator = 0;
    state.armedUntil = 0;
    Logger.debug("Reset relationship rotation state", { relationshipId, reason });
    if (!state.drainPromise) this.#states.delete(relationshipId);
  }

  #resetAll(reason) {
    for (const relationshipId of [...this.#states.keys()]) this.#resetRelationship(relationshipId, reason);
  }

  #pruneStates() {
    for (const [relationshipId, state] of this.#states) {
      const relationship = this.#relationships.get(relationshipId);
      if (!relationship || this.#rotationPolicy(relationship) !== RELATIONSHIP_ROTATION_POLICIES.ORBIT_FOLLOWER) {
        this.#resetRelationship(relationshipId, "reindexed");
        continue;
      }
      if (state.leaderUuid !== relationship.leaderUuid || state.followerUuid !== relationship.followerUuid) {
        this.#resetRelationship(relationshipId, "relationship-changed");
        continue;
      }
      state.leaderUuid = relationship.leaderUuid;
      state.followerUuid = relationship.followerUuid;
    }
  }

  #rememberRequest(requestId) {
    this.#recentRequestIds.add(requestId);
    if (this.#recentRequestIds.size <= MAX_RECENT_REQUESTS) return;
    this.#recentRequestIds.delete(this.#recentRequestIds.values().next().value);
  }

  #assertExecutingAsGM() {
    if (!game.user?.isGM) throw new Error("Relationship orbital movement must execute as a GM.");
  }
}
