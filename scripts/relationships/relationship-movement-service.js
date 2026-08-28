import {
  HOOKS,
  MODULE_ID,
  MOVEMENT_AGENCIES,
  MOVEMENT_PHASES,
  MOVEMENT_RESOURCES,
  OPERATION_METADATA_KEY,
  PATH_TYPES,
  RELATIONSHIP_COORDINATION_POLICIES,
  RELATIONSHIP_FORCED_LEADER_MOVEMENT_POLICIES,
  RELATIONSHIP_GEOMETRY_CHANNELS,
  RELATIVE_TOKEN_RELATIONSHIPS
} from "../core/constants.js";
import { duplicateSafely, randomId } from "../core/utils.js";
import { Logger } from "../core/logger.js";
import { RelationshipMovementPlanner } from "./relationship-movement-planner.js";
import { RelationshipDistance } from "./relationship-distance.js";
import { RelationshipMovementCostPolicy } from "./relationship-movement-cost-policy.js";

const CONSUMER_PREFIX = `${MODULE_ID}.relationship-movement`;
const MAX_RECENT_REQUESTS = 100;
const MANUAL_SELF_MOVEMENT_METHODS = new Set(["dragging", "keyboard", "hud", "config"]);
const PASSTHROUGH_LEADER_METHODS = new Set(["api", "undo", "paste"]);
const SUPPORTED_METHODS = new Set(["api", "config", "hud", "dragging", "keyboard", "paste", "undo"]);
const SCENE_MOVE_TOKENS_WRAPPER_TARGET = "foundry.documents.Scene.prototype.moveTokens";

export class RelationshipMovementService {
  #socket;
  #relationships;
  #movement;
  #accounting;
  #spending;
  #obstructions;
  #initialized = false;
  #consumerRemovers = new Map();
  #receiptConsumerRemovers = new Map();
  #movementReceipts = new Map();
  #hookIds = [];
  #queuedMovementIds = new Set();
  #queuedSyncIds = new Set();
  #queuedFollowerDetachIds = new Set();
  #queuedSeparationChecks = new Set();
  #activeLeaders = new Set();
  #activeLocalGrappleLeaders = new Set();
  #recentRequestIds = new Set();
  #sceneMoveWrapperRegistered = false;
  #grappleDragCostApplications = 0;
  #lastGrappleDragCost = null;
  #grappleLedgerGuards = 0;
  #lastGrappleLedgerGuard = null;

  constructor({ socket, relationships, movement, accounting = null, spending = null, obstructions = null }) {
    this.#socket = socket;
    this.#relationships = relationships;
    this.#movement = movement;
    this.#accounting = accounting;
    this.#spending = spending;
    this.#obstructions = obstructions;
    this.#socket.register("relationships.moveGroup", this.#moveGroupAsGM.bind(this));
    this.#socket.register("relationships.syncFollowers", this.#syncFollowersAsGM.bind(this));
    this.#socket.register("relationships.detachFollowerTeleport", this.#detachFollowerAfterTeleportAsGM.bind(this));
    this.#socket.register("relationships.enforceBreakDistance", this.#enforceBreakDistanceAsGM.bind(this));
  }

  initialize() {
    if (this.#initialized) return;
    this.#initialized = true;

    this.#hookIds.push(Hooks.on(HOOKS.RELATIONSHIP_CREATED, () => this.#reconcileConsumers()));
    this.#hookIds.push(Hooks.on(HOOKS.RELATIONSHIP_UPDATED, () => this.#reconcileConsumers()));
    this.#hookIds.push(Hooks.on(HOOKS.RELATIONSHIP_REMOVED, () => this.#reconcileConsumers()));
    this.#hookIds.push(Hooks.on(HOOKS.RELATIONSHIPS_REINDEXED, () => this.#reconcileConsumers()));
    this.#reconcileConsumers();
    this.#registerSceneMoveTokensWrapper();

    Logger.info(`Relationship movement service indexed ${this.#consumerRemovers.size} involved token(s).`);
  }

  shutdown() {
    if (!this.#initialized) return;
    Hooks.off(HOOKS.RELATIONSHIP_CREATED, this.#hookIds[0]);
    Hooks.off(HOOKS.RELATIONSHIP_UPDATED, this.#hookIds[1]);
    Hooks.off(HOOKS.RELATIONSHIP_REMOVED, this.#hookIds[2]);
    Hooks.off(HOOKS.RELATIONSHIPS_REINDEXED, this.#hookIds[3]);
    this.#hookIds = [];

    for (const remove of this.#consumerRemovers.values()) remove();
    for (const remove of this.#receiptConsumerRemovers.values()) remove();
    this.#consumerRemovers.clear();
    this.#receiptConsumerRemovers.clear();
    this.#movementReceipts.clear();
    this.#queuedMovementIds.clear();
    this.#queuedSyncIds.clear();
    this.#queuedFollowerDetachIds.clear();
    this.#queuedSeparationChecks.clear();
    this.#activeLeaders.clear();
    this.#activeLocalGrappleLeaders.clear();
    this.#recentRequestIds.clear();
    this.#unregisterSceneMoveTokensWrapper();
    this.#initialized = false;
  }

  getStats() {
    return {
      initialized: this.#initialized,
      indexedTokens: this.#consumerRemovers.size,
      indexedReceiptTokens: this.#receiptConsumerRemovers.size,
      indexedLeaderReceipts: new Set(this.#relationships.list().map((relationship) => relationship.leaderUuid)).size,
      movementReceipts: this.#movementReceipts.size,
      queuedRequests: this.#queuedMovementIds.size,
      queuedExternalSyncs: this.#queuedSyncIds.size,
      queuedFollowerDetaches: this.#queuedFollowerDetachIds.size,
      queuedSeparationChecks: this.#queuedSeparationChecks.size,
      activeLeaders: this.#activeLeaders.size,
      activeLocalGrappleLeaders: this.#activeLocalGrappleLeaders.size,
      recentRequests: this.#recentRequestIds.size,
      sceneMoveWrapperRegistered: this.#sceneMoveWrapperRegistered,
      grappleDragCostApplications: this.#grappleDragCostApplications,
      lastGrappleDragCost: duplicateSafely(this.#lastGrappleDragCost),
      grappleLedgerGuards: this.#grappleLedgerGuards,
      lastGrappleLedgerGuard: duplicateSafely(this.#lastGrappleLedgerGuard)
    };
  }

  async moveGroup({
    leaderUuid,
    waypoints = null,
    destination = null,
    pathType = PATH_TYPES.TRAVERSE,
    agency = MOVEMENT_AGENCIES.VOLUNTARY,
    resource = MOVEMENT_RESOURCES.MOVEMENT,
    movementMode = null,
    sourceUuid = null,
    autoRotate = false,
    method = "api",
    split = false,
    ignoreWallsRequested = false
  } = {}) {
    const leader = await fromUuid(leaderUuid);
    if (!(leader instanceof foundry.documents.TokenDocument)) {
      throw new Error("Relationship group movement requires a valid leader TokenDocument UUID.");
    }

    const cleanWaypoints = RelationshipMovementPlanner.extractInstructionWaypoints({
      waypoints: Array.isArray(waypoints) && waypoints.length ? waypoints : undefined,
      destination: !Array.isArray(waypoints) || !waypoints.length ? destination : undefined
    }, leader);

    return this.#socket.executeAsGM("relationships.moveGroup", {
      requestId: `${MODULE_ID}-public-group-${randomId(20)}`,
      requestingUserId: game.user.id,
      sceneId: leader.parent?.id,
      leaderUuid: leader.uuid,
      originalMovementId: null,
      origin: { x: leader.x, y: leader.y, elevation: leader.elevation },
      waypoints: cleanWaypoints,
      pathType,
      agency,
      resource,
      movementMode,
      sourceUuid,
      autoRotate: autoRotate === true,
      method: SUPPORTED_METHODS.has(method) ? method : "api",
      split: split === true,
      ignoreWallsRequested: ignoreWallsRequested === true
    });
  }

  async waitForMovementSettled({ leaderUuid = null, timeoutMs = 5_000, pollMs = 25 } = {}) {
    const deadline = Date.now() + Math.max(100, Number(timeoutMs) || 5_000);
    const interval = Math.max(5, Number(pollMs) || 25);
    // Foundry documents movementAnimationPromise as null when no animation is
    // active. Keep a WeakSet anyway so a module or browser timing edge which
    // temporarily retains an already-resolved Promise cannot trap this helper in
    // a hot loop until timeout.
    const observedAnimations = new WeakSet();

    while (Date.now() <= deadline) {
      const tokenUuids = new Set();
      if (leaderUuid) {
        tokenUuids.add(leaderUuid);
        for (const relationship of this.#relationships.getForLeader(leaderUuid)) {
          tokenUuids.add(relationship.followerUuid);
        }
      } else {
        for (const relationship of this.#relationships.list()) {
          tokenUuids.add(relationship.leaderUuid);
          tokenUuids.add(relationship.followerUuid);
        }
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
          new Promise((resolve) => setTimeout(() => {
            timedOut = true;
            resolve();
          }, remaining))
        ]);
        if (timedOut) break;
        continue;
      }

      const busy = leaderUuid
        ? this.#activeLeaders.has(leaderUuid) || this.#activeLocalGrappleLeaders.has(leaderUuid)
        : this.#activeLeaders.size > 0 || this.#activeLocalGrappleLeaders.size > 0 || this.#queuedMovementIds.size > 0 || this.#queuedSyncIds.size > 0;
      if (!busy) return true;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    throw new Error("Timed out while waiting for Action Effects 5E relationship movement to settle.");
  }

  #registerSceneMoveTokensWrapper() {
    if (this.#sceneMoveWrapperRegistered) return;
    const wrapperApi = globalThis.libWrapper;
    if (!wrapperApi?.register) {
      Logger.debug("libWrapper Scene.moveTokens integration is unavailable; external relationship movement will use post-sync fallback.");
      return;
    }

    const service = this;
    try {
      wrapperApi.register(
        MODULE_ID,
        SCENE_MOVE_TOKENS_WRAPPER_TARGET,
        function ae5eSceneMoveTokensWrapper(wrapped, instructions, options = {}) {
          return service.#wrapSceneMoveTokens(this, wrapped, instructions, options);
        },
        "MIXED"
      );
      this.#sceneMoveWrapperRegistered = true;
    } catch (error) {
      // Relationship movement must remain usable even if another module or a
      // future Foundry/libWrapper change prevents this optional coordination
      // boundary from registering. The existing after-phase post-sync path is
      // deliberately retained as the compatibility fallback.
      Logger.warn("Could not register the Scene.moveTokens coordination wrapper; external relationship movement will use post-sync fallback.", error);
      this.#sceneMoveWrapperRegistered = false;
    }
  }

  #unregisterSceneMoveTokensWrapper() {
    if (!this.#sceneMoveWrapperRegistered) return;
    try {
      globalThis.libWrapper?.unregister?.(MODULE_ID, SCENE_MOVE_TOKENS_WRAPPER_TARGET);
    } catch (error) {
      Logger.debug("Could not unregister the Scene.moveTokens relationship wrapper during shutdown.", error);
    }
    this.#sceneMoveWrapperRegistered = false;
  }

  async #wrapSceneMoveTokens(scene, wrapped, instructions = {}, options = {}) {
    const metadata = options?.[OPERATION_METADATA_KEY];
    if (metadata?.relationshipMovement === true && metadata?.generatedBy === MODULE_ID) {
      return wrapped(instructions, options);
    }

    // The wrapper is intentionally narrow. It sees Scene.moveTokens calls because
    // that is the only public API boundary where AE5E can add followers before
    // animation starts, but it changes nothing unless exactly one relationship
    // leader is being moved by a compatible external-style method.
    if (!instructions || typeof instructions !== "object" || Array.isArray(instructions)) {
      return wrapped(instructions, options);
    }

    const entries = Object.entries(instructions);
    if (entries.length !== 1) return wrapped(instructions, options);

    const [leaderId, leaderInstruction] = entries[0];
    const leader = scene?.tokens?.get?.(leaderId);
    if (!(leader instanceof foundry.documents.TokenDocument)) return wrapped(instructions, options);

    const relationships = this.#relationships.getForLeader(leader.uuid);
    if (!relationships.length) return wrapped(instructions, options);

    const method = leaderInstruction?.method ?? options?.method ?? "api";
    if (!PASSTHROUGH_LEADER_METHODS.has(method)) return wrapped(instructions, options);
    if (this.#instructionHasDimensionChange(leaderInstruction)) return wrapped(instructions, options);
    if (!this.#instructionIsPureMovement(leaderInstruction)) return wrapped(instructions, options);

    const pathType = this.#inferInstructionPathType(leaderInstruction, options);
    // Teleport follow/detach/block has explicit relationship semantics and remains
    // on the validated post-sync path instead of being converted into trailing
    // movement by this wrapper.
    if (pathType === PATH_TYPES.TELEPORT) return wrapped(instructions, options);

    const externalMetadata = metadata && typeof metadata === "object" ? metadata : {};
    const agency = Object.values(MOVEMENT_AGENCIES).includes(externalMetadata.agency)
      ? externalMetadata.agency
      : MOVEMENT_AGENCIES.VOLUNTARY;
    const resource = Object.values(MOVEMENT_RESOURCES).includes(externalMetadata.resource)
      ? externalMetadata.resource
      : MOVEMENT_RESOURCES.MOVEMENT;
    const followRelationships = relationships.filter((relationship) => this.#leaderMovementCarriesFollower(relationship, agency));
    const independentRelationships = relationships.filter((relationship) => !followRelationships.some((entry) => entry.id === relationship.id));

    // A grapple-like relationship can explicitly say that externally forced
    // movement of the leader does not carry its follower. Let the external move
    // resolve on the leader alone; break-distance enforcement then decides whether
    // the relationship survives the new separation.
    if (!followRelationships.length) {
      const results = await wrapped(instructions, options);
      if (game.user?.isGM && results?.[leaderId] === true && independentRelationships.length) {
        // Foundry can resolve Scene.moveTokens() while the live TokenDocument is
        // still exposing its animated/intermediate position. Break distance must
        // be measured from settled participant coordinates, not that stale state.
        await this.#awaitTokenAnimations([leader]);
        await this.#detachRelationshipsBeyondBreakDistance({
          scene,
          relationships: independentRelationships,
          reanchorCoordinationDistance: agency === MOVEMENT_AGENCIES.FORCED
        });
      }
      return results;
    }

    if (!followRelationships.every((relationship) => this.#coordinationPolicy(relationship) === RELATIONSHIP_COORDINATION_POLICIES.COORDINATED)) {
      return wrapped(instructions, options);
    }

    if (this.#activeLeaders.has(leader.uuid)) {
      ui?.notifications?.warn?.("This token is already resolving linked movement.");
      return { [leaderId]: false };
    }

    let waypoints;
    try {
      waypoints = RelationshipMovementPlanner.extractInstructionWaypoints(leaderInstruction, leader);
    } catch (error) {
      Logger.debug("External API relationship movement could not be safely coordinated before execution; using post-sync fallback.", error);
      return wrapped(instructions, options);
    }

    if (!game.user?.isGM) {
      const request = {
        requestId: `${MODULE_ID}-external-group-${randomId(20)}`,
        requestingUserId: game.user.id,
        sceneId: scene.id,
        leaderUuid: leader.uuid,
        originalMovementId: leaderInstruction?.id ?? null,
        origin: { x: leader.x, y: leader.y, elevation: leader.elevation },
        waypoints: duplicateSafely(waypoints),
        pathType,
        agency,
        resource,
        movementMode: externalMetadata.movementMode ?? this.#instructionMovementMode(leaderInstruction),
        sourceUuid: externalMetadata.sourceUuid ?? null,
        autoRotate: (leaderInstruction?.autoRotate ?? options?.autoRotate) === true,
        method,
        split: (leaderInstruction?.split ?? options?.split) === true,
        ignoreWallsRequested: leaderInstruction?.constrainOptions?.ignoreWalls === true
          || options?.constrainOptions?.ignoreWalls === true
      };

      Logger.debug("Coordinating player external relationship movement through the active GM.", {
        source: "external-api",
        leaderUuid: leader.uuid,
        relationships: followRelationships.map((relationship) => relationship.id),
        independentRelationships: independentRelationships.map((relationship) => relationship.id),
        pathType,
        agency,
        method
      });

      try {
        const result = await this.#socket.executeAsGM("relationships.moveGroup", request);
        this.#notifyResult(result);
        return { [leaderId]: result?.completed === true && result?.results?.[leaderId] !== false };
      } catch (error) {
        // If Socketlib/GM coordination is unavailable, preserve compatibility by
        // allowing the caller's original movement. The existing terminal post-sync
        // path will still attempt to carry eligible followers afterward.
        Logger.debug("Could not coordinate player external movement through the GM; using post-sync fallback.", error);
        return wrapped(instructions, options);
      }
    }

    const followerEntries = [];
    for (const relationship of followRelationships) {
      const followerId = relationship.followerUuid.split(".").at(-1);
      const token = scene.tokens.get(followerId);
      if (!(token instanceof foundry.documents.TokenDocument)) {
        Logger.debug("External API relationship movement has an unavailable follower; using post-sync fallback.", {
          leaderUuid: leader.uuid,
          relationshipId: relationship.id,
          followerUuid: relationship.followerUuid
        });
        return wrapped(instructions, options);
      }
      followerEntries.push({ token, relationship });
    }

    if (RelationshipMovementCostPolicy.leaderDragMultiplier({
      relationships: followRelationships,
      pathType,
      agency,
      resource
    }) > 1) {
      const ledgerGuard = await this.#guardGrappleLeaderLedger({
        leader,
        requestingUserId: game.user.id,
        reason: "grapple-translation"
      });
      if (ledgerGuard.failed) {
        ui?.notifications?.warn?.(ledgerGuard.message);
        return { [leaderId]: false };
      }
    }

    const planned = RelationshipMovementPlanner.buildInstructions({
      leader,
      followers: followerEntries,
      waypoints,
      pathType,
      grid: this.#gridForScene(scene)
    });

    const augmentedInstructions = {
      [leaderId]: duplicateSafely(leaderInstruction)
    };
    this.#ensureInstructionTerminalCheckpoint(augmentedInstructions[leaderId]);
    for (const { token, relationship } of followerEntries) {
      const followerInstruction = duplicateSafely(planned[token.id]);
      followerInstruction.method = "api";
      followerInstruction.showRuler = false;
      followerInstruction.autoRotate = (leaderInstruction?.autoRotate ?? options?.autoRotate) === true
        && relationship.followRotation === true;
      augmentedInstructions[token.id] = followerInstruction;
    }
    this.#applyNativeAccounting({
      instructions: augmentedInstructions,
      leaderId,
      followerEntries,
      pathType,
      resource
    });

    const detachAfterSuccess = new Set();
    while (true) {
      const activeFollowers = followerEntries.filter(({ token }) => augmentedInstructions[token.id]);
      const collisionResult = this.#validateFollowerPaths({
        leader,
        followers: activeFollowers,
        instructions: augmentedInstructions,
        allowIgnoreWalls: (leaderInstruction?.constrainOptions?.ignoreWalls === true || options?.constrainOptions?.ignoreWalls === true),
        isTeleport: false
      });
      if (collisionResult.valid) break;

      if (collisionResult.relationship?.collisionPolicy === "detach") {
        detachAfterSuccess.add(collisionResult.relationship.id);
        delete augmentedInstructions[collisionResult.token.id];
        continue;
      }

      ui?.notifications?.warn?.(collisionResult.message);
      Logger.debug("Blocked coordinated external relationship movement during follower preflight.", {
        leaderUuid: leader.uuid,
        relationshipId: collisionResult.relationship?.id ?? null,
        followerUuid: collisionResult.token?.uuid ?? null
      });
      return { [leaderId]: false };
    }

    const relationshipIds = followRelationships.map((relationship) => relationship.id);
    const finalWaypoint = RelationshipMovementPlanner.finalWaypoint(waypoints);
    const checkpointCount = waypoints.filter((point) => point.checkpoint === true).length;
    const elevationChange = Number(finalWaypoint?.elevation ?? leader.elevation) - Number(leader.elevation ?? 0);
    const groupTransactionId = `${MODULE_ID}-external-group-${randomId(16)}`;
    const coordinatedMetadata = {
      ...duplicateSafely(externalMetadata),
      transactionId: groupTransactionId,
      pathType,
      agency,
      resource,
      movementMode: externalMetadata.movementMode ?? this.#instructionMovementMode(leaderInstruction),
      sourceUuid: externalMetadata.sourceUuid ?? null,
      initiatorUuid: leader.uuid,
      leaderUuid: leader.uuid,
      relationshipIds,
      requestingUserId: game.user.id,
      relationshipMovement: true,
      coordinatedExternalMovement: true,
      externalGeneratedBy: externalMetadata.generatedBy ?? null,
      generatedBy: MODULE_ID,
      internal: true
    };
    const coordinatedOptions = {
      ...options,
      [OPERATION_METADATA_KEY]: coordinatedMetadata
    };

    Logger.debug("Coordinated relationship movement", {
      source: "external-api",
      leaderUuid: leader.uuid,
      followers: Object.keys(augmentedInstructions).length - 1,
      relationshipIds,
      independentRelationships: independentRelationships.map((relationship) => relationship.id),
      mode: followRelationships.map((relationship) => relationship.attachmentMode),
      pathType,
      agency,
      method,
      checkpoints: checkpointCount,
      elevationChange
    });

    const origins = this.#captureOrigins(scene, Object.keys(augmentedInstructions));
    const activeCostRelationships = followerEntries
      .filter(({ token }) => Boolean(augmentedInstructions[token.id]))
      .map(({ relationship }) => relationship);
    const releaseGrappleDragCost = this.#applyGrappleDragCost({
      instruction: augmentedInstructions[leaderId],
      relationships: activeCostRelationships,
      pathType,
      agency,
      resource,
      movementMode: externalMetadata.movementMode ?? this.#instructionMovementMode(leaderInstruction),
      requestId: groupTransactionId
    });
    this.#activeLeaders.add(leader.uuid);
    const releaseMovementContexts = this.#registerInstructionMovementContexts(
      augmentedInstructions,
      coordinatedOptions,
      { preserveExistingIds: true }
    );

    try {
      const results = await wrapped(augmentedInstructions, coordinatedOptions);
      const failedIds = Object.entries(results ?? {})
        .filter(([, completed]) => !completed)
        .map(([id]) => id);

      if (failedIds.length) {
        Logger.warn("Coordinated external relationship movement reported incomplete token movement; rolling back the group.", {
          leaderUuid: leader.uuid,
          results,
          failedIds
        });
        await this.#rollbackGroupTokens({ scene, origins, leaderUuid: leader.uuid });
        ui?.notifications?.warn?.("Linked movement was stopped, so Action Effects 5E restored the group to its starting positions.");
        return { [leaderId]: false };
      }

      if (detachAfterSuccess.size) await this.#relationships.removeManyAsGM(detachAfterSuccess);
      if (independentRelationships.length) {
        await this.#awaitTokenAnimations([leader]);
        await this.#detachRelationshipsBeyondBreakDistance({ scene, relationships: independentRelationships });
      }
      // Preserve the external caller's result shape. Followers were an AE5E
      // implementation detail and are not added to the object returned to the caller.
      return { [leaderId]: results?.[leaderId] === true };
    } catch (error) {
      Logger.error("Coordinated external relationship movement failed before completion.", error);
      throw error;
    } finally {
      releaseMovementContexts();
      releaseGrappleDragCost();
      this.#activeLeaders.delete(leader.uuid);
    }
  }

  async #guardGrappleLeaderLedger({ leader, requestingUserId, reason }) {
    if (!this.#spending?.reconcileLedgerAsAuthority) {
      // Keep the service independently constructible for compatibility/test
      // harnesses. Production AE5E injects MovementSpendService and therefore
      // always executes the integrity guard.
      return { failed: false, skipped: true, result: null };
    }

    this.#grappleLedgerGuards += 1;
    try {
      const result = await this.#spending.reconcileLedgerAsAuthority(leader, {
        requestedByUserId: requestingUserId,
        reason,
        clearInactiveHistory: true
      });
      this.#lastGrappleLedgerGuard = {
        leaderUuid: leader.uuid,
        reason,
        failed: false,
        result: duplicateSafely(result)
      };
      return { failed: false, result };
    } catch (error) {
      this.#lastGrappleLedgerGuard = {
        leaderUuid: leader?.uuid ?? null,
        reason,
        failed: true,
        message: error?.message ?? String(error)
      };
      Logger.error("Could not verify the Grapple leader movement ledger before coordinated translation.", error);
      return {
        failed: true,
        message: `Grapple movement could not begin because the leader's movement history could not be safely reconciled: ${error.message}`
      };
    }
  }

  #coordinationPolicy(relationship) {
    return relationship?.coordinationPolicy ?? RELATIONSHIP_COORDINATION_POLICIES.COORDINATED;
  }

  #leaderMovementCarriesFollower(relationship, agency) {
    const policy = Object.values(RELATIONSHIP_FORCED_LEADER_MOVEMENT_POLICIES).includes(relationship?.forcedLeaderMovementPolicy)
      ? relationship.forcedLeaderMovementPolicy
      : RELATIONSHIP_FORCED_LEADER_MOVEMENT_POLICIES.FOLLOW;
    return !(agency === MOVEMENT_AGENCIES.FORCED
      && policy === RELATIONSHIP_FORCED_LEADER_MOVEMENT_POLICIES.INDEPENDENT);
  }

  #instructionIsPureMovement(instruction = {}) {
    const allowedInstructionFields = new Set([
      "id", "destination", "waypoints", "method", "showRuler", "autoRotate",
      "constrainOptions", "measureOptions", "terrainOptions", "split"
    ]);
    if (Object.keys(instruction).some((key) => !allowedInstructionFields.has(key))) return false;

    const allowedWaypointFields = new Set([
      "x", "y", "elevation", "action", "checkpoint", "explicit", "snapped", "level"
    ]);
    const points = [
      ...(Array.isArray(instruction?.waypoints) ? instruction.waypoints : []),
      instruction?.destination
    ].filter(Boolean);
    return points.every((point) => (
      point && typeof point === "object"
      && Object.keys(point).every((key) => allowedWaypointFields.has(key))
    ));
  }

  #instructionHasDimensionChange(instruction = {}) {
    if (instruction?.dimensions && typeof instruction.dimensions === "object") return true;
    const points = [
      ...(Array.isArray(instruction?.waypoints) ? instruction.waypoints : []),
      instruction?.destination
    ].filter(Boolean);
    return points.some((point) => ["width", "height", "depth", "shape"].some((field) => point?.[field] !== undefined));
  }

  #instructionMovementMode(instruction = {}) {
    const points = Array.isArray(instruction?.waypoints) && instruction.waypoints.length
      ? instruction.waypoints
      : [instruction?.destination].filter(Boolean);
    return points.map((point) => point?.action).filter(Boolean).at(-1) ?? null;
  }

  #inferInstructionPathType(instruction = {}, options = {}) {
    const metadata = options?.[OPERATION_METADATA_KEY];
    if (metadata?.pathType && Object.values(PATH_TYPES).includes(metadata.pathType)) return metadata.pathType;

    const ownTeleport = Object.getOwnPropertyDescriptor(options ?? {}, "teleport")?.value === true;
    if (ownTeleport || metadata?.teleport === true) return PATH_TYPES.TELEPORT;

    const method = String(instruction?.method ?? options?.method ?? "api").toLowerCase();
    if (method.includes("teleport")) return PATH_TYPES.TELEPORT;
    if (method.includes("fall")) return PATH_TYPES.FALL;

    const points = [
      ...(Array.isArray(instruction?.waypoints) ? instruction.waypoints : []),
      instruction?.destination
    ].filter(Boolean);
    for (const action of points.map((point) => point?.action).filter(Boolean)) {
      const actions = globalThis.CONFIG?.Token?.movement?.actions;
      const config = actions?.get?.(action) ?? actions?.[action];
      if (config?.teleport === true) return PATH_TYPES.TELEPORT;
    }

    return PATH_TYPES.TRAVERSE;
  }

  #ensureInstructionTerminalCheckpoint(instruction = {}) {
    if (Array.isArray(instruction.waypoints) && instruction.waypoints.length) {
      instruction.waypoints[instruction.waypoints.length - 1] = {
        ...instruction.waypoints.at(-1),
        checkpoint: true
      };
      return instruction;
    }
    if (instruction.destination && typeof instruction.destination === "object") {
      instruction.destination = { ...instruction.destination, checkpoint: true };
    }
    return instruction;
  }

  #reconcileConsumers() {
    const involved = new Set();
    for (const relationship of this.#relationships.list()) {
      involved.add(relationship.leaderUuid);
      involved.add(relationship.followerUuid);
    }

    for (const [tokenUuid, remove] of this.#consumerRemovers) {
      if (involved.has(tokenUuid)) continue;
      remove();
      this.#consumerRemovers.delete(tokenUuid);
    }
    for (const [tokenUuid, remove] of this.#receiptConsumerRemovers) {
      if (involved.has(tokenUuid)) continue;
      remove();
      this.#receiptConsumerRemovers.delete(tokenUuid);
    }

    for (const tokenUuid of involved) {
      if (this.#consumerRemovers.has(tokenUuid)) continue;
      const remove = this.#movement.registerConsumer({
        id: `${CONSUMER_PREFIX}.${tokenUuid}`,
        phases: [MOVEMENT_PHASES.BEFORE, MOVEMENT_PHASES.AFTER],
        priority: 10_000,
        tokenUuids: [tokenUuid],
        execution: "initiator",
        handler: this.#handleMovement.bind(this)
      });
      this.#consumerRemovers.set(tokenUuid, remove);
    }

    // Primary-GM receipts are indexed for every relationship participant.
    // Leader receipts authorize post-operation follower synchronization; follower
    // receipts authorize relationship detachment after a follower teleports away.
    for (const tokenUuid of involved) {
      if (this.#receiptConsumerRemovers.has(tokenUuid)) continue;
      const remove = this.#movement.registerConsumer({
        id: `${CONSUMER_PREFIX}.receipt.${tokenUuid}`,
        phases: [MOVEMENT_PHASES.AFTER],
        priority: 10_100,
        tokenUuids: [tokenUuid],
        execution: "primaryGM",
        handler: this.#recordMovementReceipt.bind(this)
      });
      this.#receiptConsumerRemovers.set(tokenUuid, remove);
    }
  }

  #recordMovementReceipt(transaction, context = {}) {
    const metadata = transaction.metadata ?? {};
    if (metadata.relationshipMovement === true && metadata.generatedBy === MODULE_ID) return true;
    if (!this.#positionChanged(transaction.origin, transaction.destination)) return true;

    // Explicit checkpoints split one Foundry route into multiple movement
    // operations. Only the terminal operation is authoritative for follower
    // synchronization or follower-teleport detachment. Recording a receipt for
    // an earlier leg lets a non-GM client request synchronization before the
    // overall subpath has actually reached its final destination.
    if (!RelationshipMovementPlanner.isTerminalSubpathMovement(context?.movement)) return true;

    let trusted = transaction.toJSON();
    try {
      const route = RelationshipMovementPlanner.extractFullSubpathRoute(context?.movement, trusted);
      trusted = {
        ...trusted,
        origin: duplicateSafely(route.origin),
        destination: duplicateSafely(route.destination),
        path: duplicateSafely(route.waypoints)
      };
    } catch (error) {
      Logger.debug("Could not reconstruct the full terminal subpath for a primary-GM movement receipt; using the transaction path.", error);
    }

    this.#movementReceipts.set(transaction.movementId, {
      transaction: trusted,
      recordedAt: Date.now()
    });
    while (this.#movementReceipts.size > MAX_RECENT_REQUESTS) {
      this.#movementReceipts.delete(this.#movementReceipts.keys().next().value);
    }
    return true;
  }

  #handleMovement(transaction, context) {
    const metadata = transaction.metadata ?? {};
    if (metadata.relationshipMovement === true && metadata.generatedBy === MODULE_ID) return true;

    if (transaction.phase === MOVEMENT_PHASES.BEFORE) {
      return this.#handleBeforeMovement(transaction, context);
    }

    if (transaction.phase === MOVEMENT_PHASES.AFTER) {
      return this.#handleAfterMovement(transaction, context);
    }

    return true;
  }

  #handleBeforeMovement(transaction, context) {
    const metadata = transaction.metadata ?? {};
    if (metadata.bypassRelationshipLock === true && game.user?.isGM) return true;
    if (!this.#positionChanged(transaction.origin, transaction.destination)) return true;

    const followerRelationships = this.#relationships.getForFollower(transaction.subjectUuid);
    const blockingRelationship = followerRelationships.find((relationship) => relationship.followerCanSelfMove === false);
    if (blockingRelationship
      && transaction.pathType !== PATH_TYPES.TELEPORT
      && MANUAL_SELF_MOVEMENT_METHODS.has(transaction.method)) {
      ui?.notifications?.warn?.("This token is attached to another token and cannot move independently.");
      Logger.debug("Blocked independent follower movement", {
        tokenUuid: transaction.subjectUuid,
        relationshipId: blockingRelationship.id,
        method: transaction.method
      });
      return false;
    }

    const leaderRelationships = this.#relationships.getForLeader(transaction.subjectUuid);
    if (!leaderRelationships.length) return true;

    // Let API/undo/paste callers finish their own promise. The after phase then
    // synchronizes followers without converting the caller's success to false.
    if (PASSTHROUGH_LEADER_METHODS.has(transaction.method)) return true;

    const hasGrappleRelationship = leaderRelationships.some((relationship) => RelationshipMovementCostPolicy.isGrappleLike(relationship));
    if (hasGrappleRelationship && this.#activeLocalGrappleLeaders.has(transaction.subjectUuid)) {
      // Option A: while one player-originated Grapple translation is still
      // resolving through the GM-authoritative group movement, discard additional
      // movement inputs for this leader. Do not queue stale absolute origins and
      // do not surface a notification for ordinary rapid key repeat.
      Logger.debug("Ignored overlapping Grapple leader movement while a coordinated request is still in flight.", {
        leaderUuid: transaction.subjectUuid,
        movementId: transaction.movementId,
        method: transaction.method
      });
      return false;
    }

    if (this.#hasDimensionChange(context.document, context.movement)) {
      ui?.notifications?.warn?.("Action Effects 5E cannot combine token resizing with linked movement yet. Move or resize the leader separately.");
      return false;
    }

    if (this.#queuedMovementIds.has(transaction.movementId)) return false;

    let waypoints;
    try {
      waypoints = RelationshipMovementPlanner.extractWaypoints(context.movement);
    } catch (error) {
      ui?.notifications?.warn?.(`Action Effects 5E could not coordinate this movement: ${error.message}`);
      Logger.error("Failed to extract relationship movement waypoints.", error);
      return false;
    }

    const requestId = `${MODULE_ID}-relationship-${randomId(20)}`;
    const request = {
      requestId,
      requestingUserId: game.user.id,
      sceneId: context.document.parent?.id,
      leaderUuid: context.document.uuid,
      originalMovementId: transaction.movementId,
      origin: duplicateSafely(transaction.origin),
      waypoints,
      pathType: transaction.pathType,
      agency: transaction.agency === MOVEMENT_AGENCIES.UNKNOWN ? MOVEMENT_AGENCIES.VOLUNTARY : transaction.agency,
      resource: transaction.resource === MOVEMENT_RESOURCES.UNKNOWN ? MOVEMENT_RESOURCES.MOVEMENT : transaction.resource,
      movementMode: transaction.movementMode,
      sourceUuid: transaction.sourceUuid,
      autoRotate: context.movement?.autoRotate === true,
      method: context.movement?.method ?? "api",
      split: context.movement?.split === true,
      ignoreWallsRequested: context.movement?.constrainOptions?.ignoreWalls === true
    };

    this.#queuedMovementIds.add(transaction.movementId);
    if (hasGrappleRelationship) this.#activeLocalGrappleLeaders.add(transaction.subjectUuid);

    // Do not begin the replacement Scene.moveTokens() call from a microtask while
    // Foundry is still unwinding the cancelled preMoveToken update. Yield to the
    // next event-loop task so the original movement workflow fully concludes first.
    setTimeout(() => {
      void (async () => {
        try {
          const result = await this.#socket.executeAsGM("relationships.moveGroup", request);
          this.#notifyResult(result);
        } catch (error) {
          Logger.error("Coordinated relationship movement failed.", error);
          ui?.notifications?.error?.(`Action Effects 5E relationship movement failed: ${error.message}`);
        } finally {
          this.#queuedMovementIds.delete(transaction.movementId);
          if (hasGrappleRelationship) this.#activeLocalGrappleLeaders.delete(transaction.subjectUuid);
        }
      })();
    }, 0);

    // Foundry v14 does not permit rewriting final waypoints in preMoveToken.
    // Cancel the original move and replace it with one Scene.moveTokens call.
    return false;
  }

  async #handleAfterMovement(transaction, context = {}) {
    if (!this.#positionChanged(transaction.origin, transaction.destination)) return true;

    const lifecycleKey = transaction.subpathId ?? transaction.movementId;
    const terminalSubpath = RelationshipMovementPlanner.isTerminalSubpathMovement(context?.movement);
    const followerRelationships = this.#relationships.getForFollower(transaction.subjectUuid);
    if (followerRelationships.length && transaction.pathType === PATH_TYPES.TELEPORT) {
      // A checkpointed teleport (or another module which models teleportation as
      // multiple Foundry movement operations) may produce several after-hooks for
      // one subpath. Detach only after the terminal operation has settled.
      if (!terminalSubpath) return true;
      if (this.#queuedFollowerDetachIds.has(lifecycleKey)) return true;

      this.#queuedFollowerDetachIds.add(lifecycleKey);
      try {
        if (!await this.#awaitMovementSettled(context)) return true;

        const route = RelationshipMovementPlanner.extractFullSubpathRoute(context?.movement, transaction);
        const request = {
          requestId: `${MODULE_ID}-follower-teleport-${randomId(20)}`,
          requestingUserId: transaction.userId ?? game.user.id,
          sceneId: transaction.sceneId,
          followerUuid: transaction.subjectUuid,
          originalMovementId: transaction.movementId,
          origin: duplicateSafely(route.origin),
          destination: duplicateSafely(route.destination),
          pathType: transaction.pathType,
          movementMode: transaction.movementMode,
          sourceUuid: transaction.sourceUuid,
          externalGeneratedBy: transaction.generatedBy
        };

        const result = await this.#socket.executeAsGM("relationships.detachFollowerTeleport", request);
        this.#notifyResult(result);
      } catch (error) {
        Logger.error("Follower teleport relationship detachment failed.", error);
        ui?.notifications?.warn?.(`Action Effects 5E could not detach a teleported follower: ${error.message}`);
      } finally {
        this.#queuedFollowerDetachIds.delete(lifecycleKey);
      }
      return true;
    }

    if (followerRelationships.length) {
      if (!terminalSubpath) return true;
      if (this.#queuedSeparationChecks.has(lifecycleKey)) return true;

      this.#queuedSeparationChecks.add(lifecycleKey);
      try {
        if (!await this.#awaitMovementSettled(context)) return true;
        const result = await this.#socket.executeAsGM("relationships.enforceBreakDistance", {
          requestId: `${MODULE_ID}-separation-${randomId(20)}`,
          requestingUserId: transaction.userId ?? game.user.id,
          sceneId: transaction.sceneId,
          movedTokenUuid: transaction.subjectUuid,
          relationshipIds: followerRelationships.map((relationship) => relationship.id),
          reanchorCoordinationDistance: transaction.agency === MOVEMENT_AGENCIES.FORCED
        });
        this.#notifyResult(result);
      } catch (error) {
        Logger.error("Follower break-distance validation failed.", error);
        ui?.notifications?.warn?.(`Action Effects 5E could not validate the token relationship after external movement: ${error.message}`);
      } finally {
        this.#queuedSeparationChecks.delete(lifecycleKey);
      }
      return true;
    }

    if (!this.#relationships.getForLeader(transaction.subjectUuid).length) return true;

    // Foundry splits an external route at explicit checkpoints. Non-terminal
    // operations can already expose future pending waypoints, but the live leader
    // has only reached the current checkpoint. Synchronizing from that first leg
    // races the continuation and causes exact-position validation against the
    // overall final destination to fail. Ignore intermediate legs completely; the
    // terminal operation carries the earlier route in movement.history.
    if (!terminalSubpath) return true;
    if (this.#queuedSyncIds.has(lifecycleKey)) return true;

    let route;
    try {
      route = RelationshipMovementPlanner.extractFullSubpathRoute(context?.movement, transaction);
    } catch (error) {
      Logger.error("Could not reconstruct the terminal external leader subpath for follower synchronization.", error);
      return true;
    }

    this.#queuedSyncIds.add(lifecycleKey);
    try {
      if (!await this.#awaitMovementSettled(context)) return true;

      const request = {
        requestId: `${MODULE_ID}-external-sync-${randomId(20)}`,
        requestingUserId: transaction.userId ?? game.user.id,
        sceneId: transaction.sceneId,
        leaderUuid: transaction.subjectUuid,
        originalMovementId: transaction.movementId,
        origin: duplicateSafely(route.origin),
        destination: duplicateSafely(route.destination),
        waypoints: duplicateSafely(route.waypoints),
        pathType: transaction.pathType,
        agency: transaction.agency,
        resource: transaction.resource,
        movementMode: transaction.movementMode,
        sourceUuid: transaction.sourceUuid,
        externalGeneratedBy: transaction.generatedBy
      };

      const result = await this.#socket.executeAsGM("relationships.syncFollowers", request);
      this.#notifyResult(result);
    } catch (error) {
      Logger.error("External leader movement follower synchronization failed.", error);
      ui?.notifications?.warn?.(`Action Effects 5E could not synchronize attached followers: ${error.message}`);
    } finally {
      this.#queuedSyncIds.delete(lifecycleKey);
    }

    return true;
  }

  async #awaitTokenAnimations(tokens = []) {
    const animations = tokens
      .map((token) => token?.object?.movementAnimationPromise)
      .filter((animation) => animation && typeof animation.then === "function");
    if (animations.length) await Promise.allSettled(animations);
  }

  async #awaitMovementSettled(context = {}) {
    const movement = context?.movement;
    const finished = movement?.finished;
    if (!finished || typeof finished.then !== "function") {
      // Test/synthetic callers may not provide a live TokenMovementOperation.
      // Preserve the old next-task handoff as a compatibility fallback.
      await new Promise((resolve) => setTimeout(resolve, 0));
      return true;
    }

    try {
      if (await finished === false) return false;
    } catch (error) {
      Logger.debug("Movement completion promise rejected before relationship synchronization.", error);
      return false;
    }

    const animationEnded = movement?.animation?.ended;
    if (!animationEnded || typeof animationEnded.then !== "function") return true;

    try {
      await animationEnded;
      return true;
    } catch (error) {
      Logger.debug("Movement animation promise rejected before relationship synchronization.", error);
      return false;
    }
  }

  async #moveGroupAsGM(request = {}) {
    this.#assertExecutingAsGM();

    const requestedLeaderUuid = typeof request?.leaderUuid === "string" ? request.leaderUuid : null;
    if (requestedLeaderUuid && this.#activeLeaders.has(requestedLeaderUuid)) {
      return {
        completed: false,
        busy: true,
        reason: "leader-busy",
        message: null
      };
    }

    let normalized;
    try {
      normalized = await this.#validateRequest(request, { expectedLeaderPosition: "origin" });
    } catch (error) {
      if (error?.message === "The leader changed position before the linked movement request could be validated. Try again.") {
        return {
          completed: false,
          stale: true,
          reason: "stale-origin",
          message: null
        };
      }
      throw error;
    }
    const { requestId, requester, scene, leader, waypoints } = normalized;

    const duplicate = this.#beginRequest(requestId, leader.uuid);
    if (duplicate) return duplicate;

    try {
      const allRelationships = this.#relationships.getForLeader(leader.uuid);
      if (!allRelationships.length) {
        return { completed: false, message: "The token relationship no longer exists." };
      }

      const isTeleport = normalized.pathType === PATH_TYPES.TELEPORT;
      if (RelationshipMovementCostPolicy.leaderDragMultiplier({
        relationships: allRelationships,
        pathType: normalized.pathType,
        agency: normalized.agency,
        resource: normalized.resource
      }) > 1) {
        const ledgerGuard = await this.#guardGrappleLeaderLedger({
          leader,
          requestingUserId: requester.id,
          reason: "grapple-translation"
        });
        if (ledgerGuard.failed) {
          return {
            completed: false,
            ledgerIntegrityFailed: true,
            reason: "grapple-ledger-integrity",
            message: ledgerGuard.message
          };
        }
      }
      const detachAfterSuccess = [];
      const independentRelationships = [];
      const followerEntries = [];

      for (const relationship of allRelationships) {
        if (isTeleport) {
          if (relationship.teleportPolicy === "block") {
            return { completed: false, message: "This relationship prevents the leader from teleporting." };
          }
          if (relationship.teleportPolicy !== "follow") {
            detachAfterSuccess.push(relationship.id);
            continue;
          }
        }

        if (!isTeleport && !this.#leaderMovementCarriesFollower(relationship, normalized.agency)) {
          independentRelationships.push(relationship);
          continue;
        }

        const token = await fromUuid(relationship.followerUuid);
        if (!(token instanceof foundry.documents.TokenDocument) || token.parent?.id !== scene.id) {
          detachAfterSuccess.push(relationship.id);
          continue;
        }
        followerEntries.push({ token, relationship });
      }

      const groupTransactionId = `${MODULE_ID}-${randomId(16)}`;
      const instructions = RelationshipMovementPlanner.buildInstructions({
        leader,
        followers: followerEntries,
        waypoints,
        pathType: normalized.pathType,
        grid: this.#gridForScene(scene)
      });
      this.#applyNativeAccounting({
        instructions,
        leaderId: leader.id,
        followerEntries,
        pathType: normalized.pathType,
        resource: normalized.resource
      });

      while (true) {
        const activeFollowers = followerEntries.filter(({ token }) => instructions[token.id]);
        const collisionResult = this.#validateFollowerPaths({
          leader,
          followers: activeFollowers,
          instructions,
          allowIgnoreWalls: requester.isGM && normalized.ignoreWallsRequested,
          isTeleport
        });

        if (collisionResult.valid) break;
        const relationship = collisionResult.relationship;
        if (relationship?.collisionPolicy === "detach") {
          detachAfterSuccess.push(relationship.id);
          delete instructions[collisionResult.token.id];
          continue;
        }
        return { completed: false, collision: true, message: collisionResult.message };
      }

      instructions[leader.id].autoRotate = normalized.autoRotate;
      instructions[leader.id].method = normalized.method;
      instructions[leader.id].split = normalized.split;
      for (const { token, relationship } of followerEntries) {
        if (instructions[token.id]) instructions[token.id].autoRotate = normalized.autoRotate && relationship.followRotation === true;
      }

      const origins = this.#captureOrigins(scene, Object.keys(instructions));
      const relationshipIds = followerEntries.map(({ relationship }) => relationship.id);
      const operationOptions = {
        method: "api",
        showRuler: false,
        pan: false,
        autoRotate: false,
        ...this.#movement.createOperationOptions({
          transactionId: groupTransactionId,
          pathType: normalized.pathType,
          agency: normalized.agency,
          resource: normalized.resource,
          movementMode: normalized.movementMode,
          sourceUuid: normalized.sourceUuid,
          initiatorUuid: leader.uuid,
          leaderUuid: leader.uuid,
          relationshipIds,
          requestingUserId: requester.id,
          relationshipMovement: true,
          originalMovementId: normalized.originalMovementId,
          internal: true,
          suppressAutomation: false
        })
      };

      const activeCostRelationships = followerEntries
        .filter(({ token }) => Boolean(instructions[token.id]))
        .map(({ relationship }) => relationship);
      const releaseGrappleDragCost = this.#applyGrappleDragCost({
        instruction: instructions[leader.id],
        relationships: activeCostRelationships,
        pathType: normalized.pathType,
        agency: normalized.agency,
        resource: normalized.resource,
        movementMode: normalized.movementMode,
        requestId: groupTransactionId
      });
      const releaseMovementContexts = this.#registerInstructionMovementContexts(instructions, operationOptions);
      let results;
      try {
        results = await scene.moveTokens(instructions, operationOptions);
      } finally {
        releaseMovementContexts();
        releaseGrappleDragCost();
      }
      const failedIds = Object.entries(results).filter(([, completed]) => !completed).map(([id]) => id);

      if (failedIds.length) {
        Logger.warn("Linked movement reported incomplete token movement; rolling back the group.", {
          requestId,
          leaderUuid: leader.uuid,
          results,
          failedIds
        });
        await this.#rollbackGroupTokens({ scene, origins, leaderUuid: leader.uuid });
        return {
          completed: false,
          results,
          failedIds,
          rolledBack: true,
          message: "Linked movement was stopped, so Action Effects 5E restored the group to its starting positions."
        };
      }

      if (allRelationships.some((relationship) => RelationshipMovementCostPolicy.isGrappleLike(relationship))) {
        const movedTokens = [
          leader,
          ...followerEntries
            .filter(({ token }) => Boolean(instructions[token.id]))
            .map(({ token }) => token)
        ];
        await this.#awaitTokenAnimations(movedTokens);
      }

      if (detachAfterSuccess.length) await this.#relationships.removeManyAsGM(detachAfterSuccess);
      if (independentRelationships.length) await this.#awaitTokenAnimations([leader]);
      const separation = independentRelationships.length
        ? await this.#detachRelationshipsBeyondBreakDistance({
          scene,
          relationships: independentRelationships,
          reanchorCoordinationDistance: normalized.agency === MOVEMENT_AGENCIES.FORCED
        })
        : { detachedRelationshipIds: [] };
      const detachedRelationshipIds = [...new Set([
        ...detachAfterSuccess,
        ...(separation.detachedRelationshipIds ?? [])
      ])];

      return {
        completed: true,
        results,
        relationshipIds,
        detachedRelationshipIds,
        message: detachedRelationshipIds.length && separation.detachedRelationshipIds?.length
          ? "A token relationship ended because the participants moved beyond its break distance."
          : null
      };
    } finally {
      this.#activeLeaders.delete(leader.uuid);
    }
  }

  async #syncFollowersAsGM(request = {}) {
    this.#assertExecutingAsGM();
    const normalized = await this.#validateExternalSyncRequest(request);
    const { requestId, requester, scene, leader, waypoints } = normalized;

    const duplicate = this.#beginRequest(requestId, leader.uuid);
    if (duplicate) return duplicate;

    try {
      const relationships = this.#relationships.getForLeader(leader.uuid);
      if (!relationships.length) return { completed: true, results: {}, detachedRelationshipIds: [] };

      const isTeleport = normalized.pathType === PATH_TYPES.TELEPORT;
      const detach = new Set();
      const expectedTeleportDetach = new Set();
      const independentRelationships = [];
      const followerEntries = [];
      const instructions = {};
      const groupTransactionId = `${MODULE_ID}-sync-${randomId(16)}`;
      const leaderOrigin = { id: leader.id, ...normalized.origin };

      for (const relationship of relationships) {
        if (isTeleport && relationship.teleportPolicy !== "follow") {
          detach.add(relationship.id);
          if (relationship.teleportPolicy === "detach") expectedTeleportDetach.add(relationship.id);
          continue;
        }

        if (!isTeleport && !this.#leaderMovementCarriesFollower(relationship, normalized.agency)) {
          independentRelationships.push(relationship);
          continue;
        }

        const token = await fromUuid(relationship.followerUuid);
        if (!(token instanceof foundry.documents.TokenDocument) || token.parent?.id !== scene.id) {
          detach.add(relationship.id);
          continue;
        }

        const translated = RelationshipMovementPlanner.translateWaypoints({
          leader: leaderOrigin,
          follower: token,
          relationship,
          waypoints,
          pathType: normalized.pathType,
          grid: this.#gridForScene(scene)
        });
        instructions[token.id] = {
          waypoints: translated,
          method: "api",
          showRuler: false,
          autoRotate: false
        };
        followerEntries.push({ token, relationship });
      }
      this.#applyNativeAccounting({
        instructions,
        followerEntries,
        pathType: normalized.pathType,
        resource: MOVEMENT_RESOURCES.NONE
      });

      while (true) {
        const activeFollowers = followerEntries.filter(({ token }) => instructions[token.id]);
        const collisionResult = this.#validateFollowerPaths({
          leader,
          followers: activeFollowers,
          instructions,
          allowIgnoreWalls: false,
          isTeleport
        });
        if (collisionResult.valid) break;

        detach.add(collisionResult.relationship.id);
        delete instructions[collisionResult.token.id];
      }

      let results = {};
      if (Object.keys(instructions).length) {
        const relationshipIds = followerEntries.map(({ relationship }) => relationship.id);
        const operationOptions = {
          method: "api",
          showRuler: false,
          pan: false,
          autoRotate: false,
          ...this.#movement.createOperationOptions({
            transactionId: groupTransactionId,
            pathType: normalized.pathType,
            agency: MOVEMENT_AGENCIES.PASSENGER,
            resource: MOVEMENT_RESOURCES.NONE,
            movementMode: normalized.movementMode,
            sourceUuid: normalized.sourceUuid,
            initiatorUuid: leader.uuid,
            leaderUuid: leader.uuid,
            relationshipIds,
            requestingUserId: requester.id,
            relationshipMovement: true,
            externalLeaderMovement: true,
            originalMovementId: normalized.originalMovementId,
            externalGeneratedBy: normalized.externalGeneratedBy,
            internal: true,
            suppressAutomation: false
          })
        };
        const releaseMovementContexts = this.#registerInstructionMovementContexts(instructions, operationOptions);
        try {
          results = await scene.moveTokens(instructions, operationOptions);
        } finally {
          releaseMovementContexts();
        }

        for (const [tokenId, completed] of Object.entries(results)) {
          if (completed) continue;
          const entry = followerEntries.find(({ token }) => token.id === tokenId);
          if (entry) detach.add(entry.relationship.id);
        }
      }

      if (detach.size) await this.#relationships.removeManyAsGM(detach);
      const separation = independentRelationships.length
        ? await this.#detachRelationshipsBeyondBreakDistance({
          scene,
          relationships: independentRelationships,
          reanchorCoordinationDistance: normalized.agency === MOVEMENT_AGENCIES.FORCED
        })
        : { detachedRelationshipIds: [] };
      const detachedRelationshipIds = [...new Set([
        ...detach,
        ...(separation.detachedRelationshipIds ?? [])
      ])];
      const unexpectedDetach = [...detach].some((id) => !expectedTeleportDetach.has(id));
      const separated = separation.detachedRelationshipIds?.length > 0;
      return {
        completed: true,
        results,
        detachedRelationshipIds,
        message: unexpectedDetach
          ? "One or more relationships were detached because an external leader movement could not safely carry the follower."
          : separated
            ? "A token relationship ended because the participants moved beyond its break distance."
            : null
      };
    } finally {
      this.#activeLeaders.delete(leader.uuid);
    }
  }

  async #detachFollowerAfterTeleportAsGM(request = {}) {
    this.#assertExecutingAsGM();

    const requestId = String(request.requestId ?? `${MODULE_ID}-follower-teleport-${randomId(20)}`);
    if (this.#recentRequestIds.has(requestId)) {
      return { completed: false, duplicate: true, message: "This follower teleport request was already processed." };
    }
    this.#rememberRequest(requestId);

    const requester = game.users.get(request.requestingUserId);
    if (!requester) throw new Error("The requesting user no longer exists.");

    const scene = game.scenes.get(request.sceneId);
    if (!scene) throw new Error("The requested Scene no longer exists.");

    const follower = await fromUuid(request.followerUuid);
    if (!(follower instanceof foundry.documents.TokenDocument) || follower.parent?.id !== scene.id) {
      throw new Error("The relationship follower is not a valid token on the requested Scene.");
    }

    if (!requester.isGM) {
      const owner = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
      if (!follower.testUserPermission(requester, owner)) {
        throw new Error("The requesting user does not own the teleported follower.");
      }
    }

    let trusted;
    if (requester.isGM) {
      trusted = {
        movementId: request.originalMovementId,
        subjectUuid: request.followerUuid,
        sceneId: request.sceneId,
        userId: requester.id,
        origin: request.origin,
        destination: request.destination,
        pathType: request.pathType,
        movementMode: request.movementMode,
        sourceUuid: request.sourceUuid,
        generatedBy: request.externalGeneratedBy
      };
    } else {
      trusted = await this.#waitForMovementReceipt(request.originalMovementId);
      if (!trusted) throw new Error("The active GM could not verify the follower teleport.");
      if (trusted.subjectUuid !== follower.uuid || trusted.sceneId !== scene.id || trusted.userId !== requester.id) {
        throw new Error("The follower teleport receipt did not match the request.");
      }
    }

    if (trusted.pathType !== PATH_TYPES.TELEPORT) {
      throw new Error("Only a completed teleport can break the relationship through this operation.");
    }

    const destination = RelationshipMovementPlanner.sanitizePosition(trusted.destination, "verified teleport destination");
    if (!RelationshipMovementPlanner.positionsEqual(destination, follower)) {
      throw new Error("The follower changed position before teleport detachment could be validated.");
    }

    this.#movementReceipts.delete(request.originalMovementId);
    const relationships = this.#relationships.getForFollower(follower.uuid);
    const detachedRelationshipIds = relationships.map((relationship) => relationship.id);
    if (detachedRelationshipIds.length) await this.#relationships.removeManyAsGM(detachedRelationshipIds);

    return {
      completed: true,
      detachedRelationshipIds,
      message: null
    };
  }

  async #enforceBreakDistanceAsGM(request = {}) {
    this.#assertExecutingAsGM();

    const requestId = String(request.requestId ?? `${MODULE_ID}-separation-${randomId(20)}`);
    if (this.#recentRequestIds.has(requestId)) {
      return { completed: false, duplicate: true, detachedRelationshipIds: [], message: null };
    }
    this.#rememberRequest(requestId);

    const requester = game.users.get(request.requestingUserId);
    if (!requester) throw new Error("The requesting user no longer exists.");

    const scene = game.scenes.get(request.sceneId);
    if (!scene) throw new Error("The requested Scene no longer exists.");

    const movedToken = await fromUuid(request.movedTokenUuid);
    if (!(movedToken instanceof foundry.documents.TokenDocument) || movedToken.parent?.id !== scene.id) {
      throw new Error("The moved relationship participant is not a valid token on the requested Scene.");
    }

    if (!requester.isGM) {
      const owner = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
      if (!movedToken.testUserPermission(requester, owner)) {
        throw new Error("The requesting user does not own the moved relationship participant.");
      }
    }

    const requestedIds = Array.isArray(request.relationshipIds) ? new Set(request.relationshipIds) : null;
    const relationships = [
      ...this.#relationships.getForLeader(movedToken.uuid),
      ...this.#relationships.getForFollower(movedToken.uuid)
    ].filter((relationship, index, entries) => (
      relationship.sceneId === scene.id
      && (!requestedIds || requestedIds.has(relationship.id))
      && entries.findIndex((entry) => entry.id === relationship.id) === index
    ));

    const result = await this.#detachRelationshipsBeyondBreakDistance({
      scene,
      relationships,
      reanchorCoordinationDistance: request.reanchorCoordinationDistance === true
    });
    return {
      completed: true,
      ...result,
      message: result.detachedRelationshipIds.length
        ? "A token relationship ended because the participants moved beyond its break distance."
        : null
    };
  }

  async #detachRelationshipsBeyondBreakDistance({ scene, relationships = [], reanchorCoordinationDistance = false } = {}) {
    this.#assertExecutingAsGM();
    const detachedRelationshipIds = [];
    const evaluations = [];
    const reanchors = [];

    for (const relationship of relationships) {
      if (relationship?.breakDistance === null || relationship?.breakDistance === undefined) continue;
      const breakDistance = Number(relationship.breakDistance);
      if (!Number.isFinite(breakDistance) || breakDistance < 0) continue;

      const current = this.#relationships.get(relationship.id);
      if (!current || current.sceneId !== scene?.id) continue;

      const leader = await fromUuid(current.leaderUuid);
      const follower = await fromUuid(current.followerUuid);
      if (!(leader instanceof foundry.documents.TokenDocument)
        || !(follower instanceof foundry.documents.TokenDocument)
        || leader.parent?.id !== scene.id
        || follower.parent?.id !== scene.id) continue;

      const distance = RelationshipDistance.measure({ scene, leader, follower });
      if (!Number.isFinite(distance)) {
        Logger.debug("Could not measure relationship break distance; leaving the relationship unchanged.", {
          relationshipId: current.id,
          leaderUuid: current.leaderUuid,
          followerUuid: current.followerUuid,
          breakDistance
        });
        continue;
      }

      const exceeded = distance > breakDistance + 1e-6;
      const planarDistance = RelationshipDistance.measurePlanar({ scene, leader, follower });
      evaluations.push({
        relationshipId: current.id,
        distance,
        planarDistance,
        breakDistance,
        coordinationDistance: current.coordinationDistance ?? null,
        exceeded
      });
      if (exceeded) {
        detachedRelationshipIds.push(current.id);
      } else if (reanchorCoordinationDistance && Number.isFinite(planarDistance) && planarDistance > 1e-6) {
        const configured = Number(current.coordinationDistance);
        if (!Number.isFinite(configured) || Math.abs(configured - planarDistance) > 1e-6) {
          reanchors.push({ relationshipId: current.id, coordinationDistance: planarDistance });
        }
      }
    }

    if (detachedRelationshipIds.length) {
      await this.#relationships.removeManyAsGM(new Set(detachedRelationshipIds));
      Logger.debug("Detached relationships after break-distance validation.", {
        detachedRelationshipIds,
        evaluations
      });
    }

    const detachedSet = new Set(detachedRelationshipIds);
    const updatedRelationshipIds = [];
    for (const reanchor of reanchors) {
      if (detachedSet.has(reanchor.relationshipId)) continue;
      if (typeof this.#relationships.updateGeometryAsGM !== "function") continue;
      const updated = await this.#relationships.updateGeometryAsGM(reanchor.relationshipId, {
        coordinationDistance: reanchor.coordinationDistance
      });
      if (updated) updatedRelationshipIds.push(reanchor.relationshipId);
    }

    return { detachedRelationshipIds, updatedRelationshipIds, evaluations };
  }

  async #validateExternalSyncRequest(request) {
    const requester = game.users.get(request.requestingUserId);
    if (!requester) throw new Error("The requesting user no longer exists.");

    const scene = game.scenes.get(request.sceneId);
    if (!scene) throw new Error("The requested Scene no longer exists.");

    const leader = await fromUuid(request.leaderUuid);
    if (!(leader instanceof foundry.documents.TokenDocument) || leader.parent?.id !== scene.id) {
      throw new Error("The relationship leader is not a valid token on the requested Scene.");
    }

    if (!requester.isGM) {
      const owner = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
      if (!leader.testUserPermission(requester, owner)) {
        throw new Error("The requesting user does not own the relationship leader.");
      }
    }

    let trusted = null;
    if (requester.isGM) {
      trusted = {
        movementId: request.originalMovementId,
        subjectUuid: request.leaderUuid,
        sceneId: request.sceneId,
        userId: requester.id,
        origin: request.origin,
        destination: request.destination,
        path: request.waypoints,
        pathType: request.pathType,
        agency: request.agency,
        resource: request.resource,
        movementMode: request.movementMode,
        sourceUuid: request.sourceUuid,
        generatedBy: request.externalGeneratedBy
      };
    } else {
      trusted = await this.#waitForMovementReceipt(request.originalMovementId);
      if (!trusted) throw new Error("The active GM could not verify the external leader movement.");
      if (trusted.subjectUuid !== leader.uuid || trusted.sceneId !== scene.id || trusted.userId !== requester.id) {
        throw new Error("The external leader movement receipt did not match the request.");
      }
      this.#movementReceipts.delete(request.originalMovementId);
    }

    const origin = RelationshipMovementPlanner.sanitizePosition(trusted.origin, "verified movement origin");
    const waypoints = RelationshipMovementPlanner.extractTransactionWaypoints(trusted);
    const destination = RelationshipMovementPlanner.sanitizePosition(
      RelationshipMovementPlanner.finalWaypoint(waypoints) ?? trusted.destination,
      "verified movement destination"
    );
    if (!RelationshipMovementPlanner.positionsEqual(destination, leader)) {
      throw new Error("The leader changed position before follower synchronization could be validated.");
    }

    return {
      requestId: String(request.requestId ?? randomId(20)),
      requester,
      scene,
      leader,
      origin,
      destination,
      waypoints,
      originalMovementId: trusted.movementId ?? request.originalMovementId ?? null,
      pathType: Object.values(PATH_TYPES).includes(trusted.pathType) ? trusted.pathType : PATH_TYPES.TRAVERSE,
      agency: Object.values(MOVEMENT_AGENCIES).includes(trusted.agency) ? trusted.agency : MOVEMENT_AGENCIES.VOLUNTARY,
      resource: Object.values(MOVEMENT_RESOURCES).includes(trusted.resource) ? trusted.resource : MOVEMENT_RESOURCES.MOVEMENT,
      movementMode: trusted.movementMode ?? null,
      sourceUuid: trusted.sourceUuid ?? null,
      externalGeneratedBy: trusted.generatedBy ?? null,
      method: "api",
      split: false,
      autoRotate: false,
      ignoreWallsRequested: false
    };
  }

  async #waitForMovementReceipt(movementId, timeoutMs = 750) {
    const expires = Date.now() + timeoutMs;
    while (Date.now() <= expires) {
      const receipt = this.#movementReceipts.get(movementId);
      if (receipt) return receipt.transaction;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return null;
  }

  async #validateRequest(request, { expectedLeaderPosition }) {
    const requester = game.users.get(request.requestingUserId);
    if (!requester) throw new Error("The requesting user no longer exists.");

    const scene = game.scenes.get(request.sceneId);
    if (!scene) throw new Error("The requested Scene no longer exists.");

    const leader = await fromUuid(request.leaderUuid);
    if (!(leader instanceof foundry.documents.TokenDocument) || leader.parent?.id !== scene.id) {
      throw new Error("The relationship leader is not a valid token on the requested Scene.");
    }

    if (!requester.isGM) {
      const owner = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
      if (!leader.testUserPermission(requester, owner)) {
        throw new Error("The requesting user does not own the relationship leader.");
      }
    }

    const origin = RelationshipMovementPlanner.sanitizePosition(request.origin, "requested origin");
    const destination = RelationshipMovementPlanner.sanitizePosition(
      request.destination ?? request.waypoints?.at?.(-1),
      "requested destination"
    );
    const expected = expectedLeaderPosition === "destination" ? destination : origin;
    if (!RelationshipMovementPlanner.positionsEqual(expected, leader)) {
      throw new Error("The leader changed position before the linked movement request could be validated. Try again.");
    }

    return {
      requestId: String(request.requestId ?? randomId(20)),
      requester,
      scene,
      leader,
      origin,
      destination,
      waypoints: RelationshipMovementPlanner.sanitizeWaypoints(request.waypoints),
      originalMovementId: request.originalMovementId ?? null,
      pathType: Object.values(PATH_TYPES).includes(request.pathType) ? request.pathType : PATH_TYPES.TRAVERSE,
      agency: Object.values(MOVEMENT_AGENCIES).includes(request.agency) ? request.agency : MOVEMENT_AGENCIES.VOLUNTARY,
      resource: Object.values(MOVEMENT_RESOURCES).includes(request.resource) ? request.resource : MOVEMENT_RESOURCES.MOVEMENT,
      movementMode: request.movementMode ?? null,
      sourceUuid: request.sourceUuid ?? null,
      externalGeneratedBy: request.externalGeneratedBy ?? null,
      method: SUPPORTED_METHODS.has(request.method) ? request.method : "api",
      split: request.split === true,
      autoRotate: request.autoRotate === true,
      ignoreWallsRequested: request.ignoreWallsRequested === true
    };
  }

  #beginRequest(requestId, leaderUuid) {
    if (this.#recentRequestIds.has(requestId)) {
      return { completed: false, duplicate: true, reason: "duplicate-request", message: "This relationship movement request was already processed." };
    }
    this.#rememberRequest(requestId);

    if (this.#activeLeaders.has(leaderUuid)) {
      return { completed: false, busy: true, reason: "leader-busy", message: null };
    }
    this.#activeLeaders.add(leaderUuid);
    return null;
  }

  #applyGrappleDragCost({ instruction, relationships = [], pathType, agency, resource, movementMode = null, requestId = null }) {
    if (!this.#accounting || !instruction || !RelationshipMovementCostPolicy.shouldDoubleLeaderDrag({ relationships, pathType, agency, resource })) {
      return () => {};
    }

    this.#accounting.ensureRegistered();
    const points = Array.isArray(instruction.waypoints) && instruction.waypoints.length
      ? instruction.waypoints
      : [instruction.destination].filter(Boolean);
    if (!points.length) return () => {};

    const fallbackAction = movementMode ?? globalThis.CONFIG?.Token?.movement?.defaultAction ?? "walk";
    const registrations = new Map();
    let inheritedAction = fallbackAction;
    try {
      for (const point of points) {
        const baseAction = point?.action ?? inheritedAction ?? fallbackAction;
        inheritedAction = baseAction;
        if (!registrations.has(baseAction)) {
          const logicalId = `grapple-drag-${String(requestId ?? randomId(12))}-${registrations.size + 1}-${randomId(6)}`;
          const slotActionId = this.#accounting.registerFinalCostModifier(logicalId, {
            label: "Action Effects 5E — Grapple Drag (2×)",
            baseAction,
            canSelect: false,
            modifier: ({ nativeCost }) => nativeCost * 2
          });
          registrations.set(baseAction, slotActionId);
        }
        point.action = registrations.get(baseAction);
      }
    } catch (error) {
      for (const slotActionId of registrations.values()) this.#accounting.unregisterFinalCostModifier(slotActionId);
      throw error;
    }

    this.#grappleDragCostApplications += 1;
    this.#lastGrappleDragCost = {
      requestId: requestId ?? null,
      relationshipIds: relationships.filter((relationship) => RelationshipMovementCostPolicy.usesGrappleCosts(relationship)).map((relationship) => relationship.id),
      multiplier: 2,
      baseActions: [...registrations.keys()],
      modifierActions: [...registrations.values()]
    };

    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const slotActionId of registrations.values()) this.#accounting.unregisterFinalCostModifier(slotActionId);
    };
  }

  #applyNativeAccounting({ instructions, leaderId = null, followerEntries = [], pathType, resource }) {
    if (!this.#accounting || pathType === PATH_TYPES.TELEPORT) return;
    this.#accounting.ensureRegistered();

    // Passenger/follower movement is spatially real but does not spend that
    // Token's movement resource. The Leader retains the movement action supplied
    // by Foundry/D&D5e unless the initiating movement itself is explicitly a
    // no-resource movement transaction.
    for (const { token } of followerEntries) {
      const instruction = instructions[token.id];
      if (instruction) this.#accounting.applyNoCostToInstruction(instruction);
    }
    if (leaderId && resource === MOVEMENT_RESOURCES.NONE && instructions[leaderId]) {
      this.#accounting.applyNoCostToInstruction(instructions[leaderId]);
    }
  }

  #validateFollowerPaths({ leader, followers, instructions, allowIgnoreWalls, isTeleport }) {
    if (isTeleport) return { valid: true };

    for (const { token, relationship } of followers) {
      const instruction = instructions[token.id];
      if (!instruction) continue;

      // Relationship followers are passengers. Their translated movement must not
      // be limited by their own movement budget (a Grappled creature commonly has
      // Speed 0), and D&D5e v5.3 token blocking must not treat the simultaneously
      // vacating leader as an obstruction. We therefore preflight environment and
      // creature occupancy ourselves, then bypass cost/token constraints only for
      // the generated follower instruction. The leader's own native constraints
      // remain untouched.
      instruction.constrainOptions = {
        ...(instruction.constrainOptions ?? {}),
        ignoreCost: true
      };

      const placeable = token.object;
      if (!placeable?.constrainMovementPath) {
        Logger.debug(`Skipped preflight collision validation for ${token.uuid}; its Scene is not rendered on the active GM canvas.`);
        continue;
      }

      const waypoints = instruction.waypoints ?? [];
      const path = [{ x: token.x, y: token.y, elevation: token.elevation }, ...waypoints];

      // First isolate walls/surfaces from D&D5e's creature-space constraints.
      // `ignoreTokens` is a D&D5e extension used by AE5E's orbit/displacement
      // services for the same reason.
      const [, environmentConstrained] = placeable.constrainMovementPath(path, {
        preview: false,
        ignoreWalls: allowIgnoreWalls,
        ignoreCost: true,
        ignoreTokens: true,
        maxCost: Infinity,
        maxDistance: Infinity
      });

      if (environmentConstrained) {
        return {
          valid: false,
          token,
          relationship,
          message: `${token.name ?? "A follower token"} cannot follow that path because its translated route is blocked.`
        };
      }

      // When the obstruction service is available, AE5E owns follower-body token
      // semantics for this generated passenger move. The relationship leader is
      // deliberately excluded because the follower is entering space the leader
      // vacates in the same coordinated Scene.moveTokens operation.
      if (this.#obstructions?.inspectBodyAtPosition) {
        const conflicts = this.#collectFollowerBodyConflicts({
          scene: token.parent,
          follower: token,
          leader,
          path
        });
        const hostile = conflicts.filter((entry) => entry.relationship === RELATIVE_TOKEN_RELATIONSHIPS.HOSTILE);
        if (hostile.length) {
          return {
            valid: false,
            token,
            relationship,
            message: `${token.name ?? "A follower token"} cannot follow that path because its translated route is blocked.`
          };
        }

        // Transit through a nonhostile creature can be legal in D&D5e, but a
        // follower must not finish in another non-participant creature's space.
        // The leader is already excluded from this list.
        const endpoint = this.#collectFollowerEndpointConflicts({
          scene: token.parent,
          follower: token,
          leader,
          position: path.at(-1)
        });
        if (endpoint.length) {
          return {
            valid: false,
            token,
            relationship,
            message: `${token.name ?? "A follower token"} cannot follow that path because its destination is occupied.`
          };
        }

        instruction.constrainOptions = {
          ...instruction.constrainOptions,
          ignoreTokens: true
        };
        continue;
      }

      // Compatibility fallback when no AE5E obstruction classifier was injected.
      // Preserve the previous public constraint check while still applying the
      // passenger ignoreCost rule above.
      const [, wasConstrained] = placeable.constrainMovementPath(path, {
        preview: false,
        ignoreWalls: allowIgnoreWalls,
        ignoreCost: true,
        maxCost: Infinity,
        maxDistance: Infinity
      });

      if (wasConstrained) {
        return {
          valid: false,
          token,
          relationship,
          message: `${token.name ?? "A follower token"} cannot follow that path because its translated route is blocked.`
        };
      }
    }

    return { valid: true };
  }

  #collectFollowerBodyConflicts({ scene, follower, leader, path }) {
    if (!scene?.tokens || !Array.isArray(path) || path.length < 2) return [];

    let completePath = path;
    if (typeof follower.getCompleteMovementPath === "function") {
      try {
        const expanded = follower.getCompleteMovementPath(path);
        if (Array.isArray(expanded) && expanded.length) completePath = expanded;
      } catch (error) {
        Logger.debug("Could not expand relationship follower path while classifying token obstruction; using supplied waypoints.", {
          followerUuid: follower.uuid,
          error: String(error)
        });
      }
    }

    const conflicts = [];
    for (const position of completePath.slice(1)) {
      const occupancy = this.#obstructions.inspectBodyAtPosition({
        scene,
        subjectToken: follower,
        position,
        geometryChannel: RELATIONSHIP_GEOMETRY_CHANNELS.FOLLOWER_BODY
      });
      for (const entry of occupancy?.conflicts ?? []) {
        if (entry?.blockerUuid === leader?.uuid) continue;
        conflicts.push(entry);
      }
    }
    return conflicts;
  }

  #collectFollowerEndpointConflicts({ scene, follower, leader, position }) {
    if (!scene?.tokens || !position || !this.#obstructions?.inspectBodyAtPosition) return [];
    const occupancy = this.#obstructions.inspectBodyAtPosition({
      scene,
      subjectToken: follower,
      position,
      geometryChannel: RELATIONSHIP_GEOMETRY_CHANNELS.FOLLOWER_BODY
    });
    return (occupancy?.conflicts ?? []).filter((entry) => entry?.blockerUuid !== leader?.uuid);
  }

  #captureOrigins(scene, tokenIds) {
    return Object.fromEntries(tokenIds.map((tokenId) => {
      const token = scene.tokens.get(tokenId);
      return [tokenId, { x: token.x, y: token.y, elevation: token.elevation }];
    }));
  }

  async #rollbackGroupTokens({ scene, origins, leaderUuid }) {
    const instructions = {};
    for (const [tokenId, origin] of Object.entries(origins)) {
      // Foundry can report a token movement as incomplete after constraining that
      // token partway along its attempted route. A false result therefore does
      // not mean the token is still at its origin. Atomic linked rollback must
      // restore every surviving participant from the pre-move origin snapshot,
      // not only tokens whose Scene.moveTokens() result was true.
      if (!scene.tokens.get(tokenId)) continue;
      instructions[tokenId] = {
        destination: {
          ...origin,
          // Rollback uses Scene.moveTokens too, so its terminal destination must
          // follow the same explicit-checkpoint rule as coordinated movement.
          checkpoint: true
        },
        method: "api",
        showRuler: false
      };
    }
    if (!Object.keys(instructions).length) return;
    const movementMode = globalThis.CONFIG?.Token?.movement?.defaultAction ?? "walk";
    const nativeMovementAction = this.#accounting?.noCostActionId ?? movementMode;
    if (this.#accounting) {
      this.#accounting.ensureRegistered();
      for (const instruction of Object.values(instructions)) this.#accounting.applyNoCostToInstruction(instruction);
    }

    const operationOptions = {
      method: "api",
      animate: false,
      showRuler: false,
      pan: false,
      constrainOptions: { ignoreWalls: true, ignoreCost: true },
      ...this.#movement.createOperationOptions({
        pathType: PATH_TYPES.REPOSITION,
        agency: MOVEMENT_AGENCIES.ADMINISTRATIVE,
        resource: MOVEMENT_RESOURCES.NONE,
        movementMode,
        nativeMovementAction,
        leaderUuid,
        relationshipMovement: true,
        relationshipRollback: true,
        internal: true,
        suppressAutomation: true
      })
    };
    const releaseMovementContexts = this.#registerInstructionMovementContexts(instructions, operationOptions);
    try {
      await scene.moveTokens(instructions, operationOptions);
    } finally {
      releaseMovementContexts();
    }
  }

  #registerInstructionMovementContexts(instructions, operationOptions, { preserveExistingIds = false } = {}) {
    const removers = [];
    try {
      for (const instruction of Object.values(instructions)) {
        const movementId = preserveExistingIds && typeof instruction.id === "string" && instruction.id.length
          ? instruction.id
          : randomId(16);
        instruction.id = movementId;
        removers.push(this.#movement.registerMovementContext(movementId, operationOptions));
      }
    } catch (error) {
      for (const remove of removers) remove();
      throw error;
    }

    return () => {
      for (const remove of removers) remove();
    };
  }

  #gridForScene(scene) {
    // Foundry v14 exposes a BaseGrid instance directly on every Scene, so path
    // expansion does not depend on the active GM rendering the player's Scene.
    return scene?.grid ?? null;
  }

  #hasDimensionChange(document, movement) {
    const waypoints = movement?.pending?.waypoints;
    const destination = Array.isArray(waypoints) && waypoints.length ? waypoints.at(-1) : movement?.destination;
    if (!destination) return false;

    for (const field of ["width", "height", "depth", "shape"]) {
      if (destination[field] === undefined) continue;
      if (JSON.stringify(destination[field]) !== JSON.stringify(document[field])) return true;
    }
    return false;
  }

  #positionChanged(origin, destination) {
    return !RelationshipMovementPlanner.positionsEqual(origin, destination);
  }

  #notifyResult(result) {
    if (result?.message) ui?.notifications?.warn?.(result.message);
  }

  #rememberRequest(requestId) {
    this.#recentRequestIds.add(requestId);
    if (this.#recentRequestIds.size <= MAX_RECENT_REQUESTS) return;
    this.#recentRequestIds.delete(this.#recentRequestIds.values().next().value);
  }

  #assertExecutingAsGM() {
    if (!game.user?.isGM) throw new Error("Coordinated relationship movement must execute as a GM.");
  }
}
