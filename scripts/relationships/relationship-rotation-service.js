import {
  COLLISION_POLICIES,
  HOOKS,
  MODULE_ID,
  MOVEMENT_AGENCIES,
  MOVEMENT_RESOURCES,
  OPERATION_METADATA_KEY,
  PATH_TYPES,
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
    this.#hookIds.push(Hooks.on("canvasReady", () => this.#resetAll("canvas-ready")));
    this.#hookIds.push(Hooks.on(HOOKS.RELATIONSHIP_CREATED, (relationship) => this.#resetRelationship(relationship?.id, "relationship-created")));
    this.#hookIds.push(Hooks.on(HOOKS.RELATIONSHIP_REMOVED, (relationship) => this.#resetRelationship(relationship?.id, "relationship-removed")));
    this.#hookIds.push(Hooks.on(HOOKS.RELATIONSHIPS_REINDEXED, () => this.#pruneStates()));
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

    const delta = RelationshipOrbitPlanner.signedRotationDelta(state.lastObservedRotation, currentRotation);
    state.lastObservedRotation = currentRotation;
    if (Math.abs(delta) <= ROTATION_EPSILON) return;

    state.events.push({
      delta,
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
        this.#resetRelationship(relationship.id, "leader-translated");
      }
    }
    for (const relationship of this.#relationships.getForFollower(transaction.subjectUuid)) {
      if (this.#rotationPolicy(relationship) === RELATIONSHIP_ROTATION_POLICIES.ORBIT_FOLLOWER) {
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
        rotationDelta: event.delta
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
    if (!direction || !(steps >= 1 && steps <= 8) || rotationDelta === null || Math.abs(rotationDelta) > 360 + ROTATION_EPSILON) {
      throw new Error("The orbital movement request contains invalid rotation data.");
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

        const leaderRotation = await this.#rollbackLeaderRotation(leader, rotationDelta, requestId);
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

        const leaderRotation = await this.#rollbackLeaderRotation(leader, rotationDelta, requestId);
        return {
          completed: false,
          rolledBackRotation: true,
          results,
          leaderRotation,
          message: "The follower could not complete orbital movement, so the triggering leader rotation was restored."
        };
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
        const leaderRotation = await this.#rollbackLeaderRotation(leader, rotationDelta, requestId);
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

  async #rollbackLeaderRotation(leader, rotationDelta, requestId) {
    const current = finiteNumber(leader.rotation, 0);
    const target = RelationshipOrbitPlanner.normalizeRotation(current - rotationDelta);
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
