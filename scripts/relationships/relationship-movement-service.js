import {
  HOOKS,
  MODULE_ID,
  MOVEMENT_AGENCIES,
  MOVEMENT_PHASES,
  MOVEMENT_RESOURCES,
  OPERATION_METADATA_KEY,
  PATH_TYPES,
  RELATIONSHIP_COORDINATION_POLICIES
} from "../core/constants.js";
import { duplicateSafely, randomId } from "../core/utils.js";
import { Logger } from "../core/logger.js";
import { RelationshipMovementPlanner } from "./relationship-movement-planner.js";

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
  #initialized = false;
  #consumerRemovers = new Map();
  #receiptConsumerRemovers = new Map();
  #movementReceipts = new Map();
  #hookIds = [];
  #queuedMovementIds = new Set();
  #queuedSyncIds = new Set();
  #queuedFollowerDetachIds = new Set();
  #activeLeaders = new Set();
  #recentRequestIds = new Set();
  #sceneMoveWrapperRegistered = false;

  constructor({ socket, relationships, movement }) {
    this.#socket = socket;
    this.#relationships = relationships;
    this.#movement = movement;
    this.#socket.register("relationships.moveGroup", this.#moveGroupAsGM.bind(this));
    this.#socket.register("relationships.syncFollowers", this.#syncFollowersAsGM.bind(this));
    this.#socket.register("relationships.detachFollowerTeleport", this.#detachFollowerAfterTeleportAsGM.bind(this));
  }

  initialize() {
    if (this.#initialized) return;
    this.#initialized = true;

    this.#hookIds.push(Hooks.on(HOOKS.RELATIONSHIP_CREATED, () => this.#reconcileConsumers()));
    this.#hookIds.push(Hooks.on(HOOKS.RELATIONSHIP_REMOVED, () => this.#reconcileConsumers()));
    this.#hookIds.push(Hooks.on(HOOKS.RELATIONSHIPS_REINDEXED, () => this.#reconcileConsumers()));
    this.#reconcileConsumers();
    this.#registerSceneMoveTokensWrapper();

    Logger.info(`Relationship movement service indexed ${this.#consumerRemovers.size} involved token(s).`);
  }

  shutdown() {
    if (!this.#initialized) return;
    Hooks.off(HOOKS.RELATIONSHIP_CREATED, this.#hookIds[0]);
    Hooks.off(HOOKS.RELATIONSHIP_REMOVED, this.#hookIds[1]);
    Hooks.off(HOOKS.RELATIONSHIPS_REINDEXED, this.#hookIds[2]);
    this.#hookIds = [];

    for (const remove of this.#consumerRemovers.values()) remove();
    for (const remove of this.#receiptConsumerRemovers.values()) remove();
    this.#consumerRemovers.clear();
    this.#receiptConsumerRemovers.clear();
    this.#movementReceipts.clear();
    this.#queuedMovementIds.clear();
    this.#queuedSyncIds.clear();
    this.#queuedFollowerDetachIds.clear();
    this.#activeLeaders.clear();
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
      activeLeaders: this.#activeLeaders.size,
      recentRequests: this.#recentRequestIds.size,
      sceneMoveWrapperRegistered: this.#sceneMoveWrapperRegistered
    };
  }

  async moveGroup({
    leaderUuid,
    waypoints = null,
    destination = null,
    pathType = PATH_TYPES.TRAVERSE,
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
        if (animation && typeof animation.then === "function") animations.push(animation);
      }

      if (animations.length) {
        await Promise.race([
          Promise.allSettled(animations),
          new Promise((resolve) => setTimeout(resolve, interval))
        ]);
        continue;
      }

      const busy = leaderUuid
        ? this.#activeLeaders.has(leaderUuid)
        : this.#activeLeaders.size > 0 || this.#queuedMovementIds.size > 0 || this.#queuedSyncIds.size > 0;
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
    // animation starts, but it changes nothing unless exactly one active coordinated
    // relationship leader is being moved by a compatible external-style method.
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
    if (!relationships.every((relationship) => this.#coordinationPolicy(relationship) === RELATIONSHIP_COORDINATION_POLICIES.COORDINATED)) {
      return wrapped(instructions, options);
    }

    const method = leaderInstruction?.method ?? options?.method ?? "api";
    if (!PASSTHROUGH_LEADER_METHODS.has(method)) return wrapped(instructions, options);
    if (this.#instructionHasDimensionChange(leaderInstruction)) return wrapped(instructions, options);
    if (!this.#instructionIsPureMovement(leaderInstruction)) return wrapped(instructions, options);

    const pathType = this.#inferInstructionPathType(leaderInstruction, options);
    // Teleport follow/detach/block has explicit relationship semantics and remains
    // on the validated post-sync path instead of being converted into trailing
    // movement by this wrapper.
    if (pathType === PATH_TYPES.TELEPORT) return wrapped(instructions, options);

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
      const externalMetadata = metadata && typeof metadata === "object" ? metadata : {};
      const request = {
        requestId: `${MODULE_ID}-external-group-${randomId(20)}`,
        requestingUserId: game.user.id,
        sceneId: scene.id,
        leaderUuid: leader.uuid,
        originalMovementId: leaderInstruction?.id ?? null,
        origin: { x: leader.x, y: leader.y, elevation: leader.elevation },
        waypoints: duplicateSafely(waypoints),
        pathType,
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
        relationships: relationships.map((relationship) => relationship.id),
        pathType,
        method
      });

      try {
        const result = await this.#socket.executeAsGM("relationships.moveGroup", request);
        this.#notifyResult(result);
        return { [leaderId]: result?.completed === true && result?.results?.[leaderId] !== false };
      } catch (error) {
        // If Socketlib/GM coordination is unavailable, preserve compatibility by
        // allowing the caller's original movement. The existing terminal post-sync
        // path will still attempt to carry the follower afterward.
        Logger.debug("Could not coordinate player external movement through the GM; using post-sync fallback.", error);
        return wrapped(instructions, options);
      }
    }

    const followerEntries = [];
    for (const relationship of relationships) {
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

    const detachAfterSuccess = new Set();
    while (true) {
      const activeFollowers = followerEntries.filter(({ token }) => augmentedInstructions[token.id]);
      const collisionResult = this.#validateFollowerPaths({
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

    const externalMetadata = metadata && typeof metadata === "object" ? metadata : {};
    const relationshipIds = relationships.map((relationship) => relationship.id);
    const finalWaypoint = RelationshipMovementPlanner.finalWaypoint(waypoints);
    const checkpointCount = waypoints.filter((point) => point.checkpoint === true).length;
    const elevationChange = Number(finalWaypoint?.elevation ?? leader.elevation) - Number(leader.elevation ?? 0);
    const groupTransactionId = `${MODULE_ID}-external-group-${randomId(16)}`;
    const coordinatedMetadata = {
      ...duplicateSafely(externalMetadata),
      transactionId: groupTransactionId,
      pathType,
      agency: externalMetadata.agency ?? MOVEMENT_AGENCIES.VOLUNTARY,
      resource: externalMetadata.resource ?? MOVEMENT_RESOURCES.MOVEMENT,
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
      mode: relationships.map((relationship) => relationship.attachmentMode),
      pathType,
      method,
      checkpoints: checkpointCount,
      elevationChange
    });

    const origins = this.#captureOrigins(scene, Object.keys(augmentedInstructions));
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
        await this.#rollbackCompletedTokens({ scene, results, origins, leaderUuid: leader.uuid });
        ui?.notifications?.warn?.("Linked movement was stopped, so Action Effects 5E restored the group to its starting positions.");
        return { [leaderId]: false };
      }

      if (detachAfterSuccess.size) await this.#relationships.removeManyAsGM(detachAfterSuccess);
      // Preserve the external caller's result shape. Followers were an AE5E
      // implementation detail and are not added to the object returned to the caller.
      return { [leaderId]: results?.[leaderId] === true };
    } catch (error) {
      Logger.error("Coordinated external relationship movement failed before completion.", error);
      throw error;
    } finally {
      releaseMovementContexts();
      this.#activeLeaders.delete(leader.uuid);
    }
  }

  #coordinationPolicy(relationship) {
    return relationship?.coordinationPolicy ?? RELATIONSHIP_COORDINATION_POLICIES.COORDINATED;
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
      movementMode: transaction.movementMode,
      sourceUuid: transaction.sourceUuid,
      autoRotate: context.movement?.autoRotate === true,
      method: context.movement?.method ?? "api",
      split: context.movement?.split === true,
      ignoreWallsRequested: context.movement?.constrainOptions?.ignoreWalls === true
    };

    this.#queuedMovementIds.add(transaction.movementId);
    // Do not begin the replacement Scene.moveTokens() call from a microtask while
    // Foundry is still unwinding the cancelled preMoveToken update. Yield to the
    // next event-loop task so the original movement workflow fully concludes first.
    setTimeout(() => {
      void this.#socket.executeAsGM("relationships.moveGroup", request)
        .then((result) => this.#notifyResult(result))
        .catch((error) => {
          Logger.error("Coordinated relationship movement failed.", error);
          ui?.notifications?.error?.(`Action Effects 5E relationship movement failed: ${error.message}`);
        })
        .finally(() => this.#queuedMovementIds.delete(transaction.movementId));
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
    const normalized = await this.#validateRequest(request, { expectedLeaderPosition: "origin" });
    const { requestId, requester, scene, leader, waypoints } = normalized;

    const duplicate = this.#beginRequest(requestId, leader.uuid);
    if (duplicate) return duplicate;

    try {
      const allRelationships = this.#relationships.getForLeader(leader.uuid);
      if (!allRelationships.length) {
        return { completed: false, message: "The token relationship no longer exists." };
      }

      const isTeleport = normalized.pathType === PATH_TYPES.TELEPORT;
      const detachAfterSuccess = [];
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

      while (true) {
        const activeFollowers = followerEntries.filter(({ token }) => instructions[token.id]);
        const collisionResult = this.#validateFollowerPaths({
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
      const relationshipIds = allRelationships.map((relationship) => relationship.id);
      const operationOptions = {
        method: "api",
        showRuler: false,
        pan: false,
        autoRotate: false,
        ...this.#movement.createOperationOptions({
          transactionId: groupTransactionId,
          pathType: normalized.pathType,
          agency: MOVEMENT_AGENCIES.VOLUNTARY,
          resource: MOVEMENT_RESOURCES.MOVEMENT,
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

      const releaseMovementContexts = this.#registerInstructionMovementContexts(instructions, operationOptions);
      let results;
      try {
        results = await scene.moveTokens(instructions, operationOptions);
      } finally {
        releaseMovementContexts();
      }
      const failedIds = Object.entries(results).filter(([, completed]) => !completed).map(([id]) => id);

      if (failedIds.length) {
        Logger.warn("Linked movement reported incomplete token movement; rolling back the group.", {
          requestId,
          leaderUuid: leader.uuid,
          results,
          failedIds
        });
        await this.#rollbackCompletedTokens({ scene, results, origins, leaderUuid: leader.uuid });
        return {
          completed: false,
          results,
          failedIds,
          rolledBack: true,
          message: "Linked movement was stopped, so Action Effects 5E restored the group to its starting positions."
        };
      }

      if (detachAfterSuccess.length) await this.#relationships.removeManyAsGM(detachAfterSuccess);

      return {
        completed: true,
        results,
        relationshipIds,
        detachedRelationshipIds: [...new Set(detachAfterSuccess)]
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

      while (true) {
        const activeFollowers = followerEntries.filter(({ token }) => instructions[token.id]);
        const collisionResult = this.#validateFollowerPaths({
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
        const relationshipIds = relationships.map((relationship) => relationship.id);
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
      const detachedRelationshipIds = [...detach];
      const unexpectedDetach = detachedRelationshipIds.some((id) => !expectedTeleportDetach.has(id));
      return {
        completed: true,
        results,
        detachedRelationshipIds,
        message: unexpectedDetach
          ? "One or more relationships were detached because an external leader movement could not safely carry the follower."
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
      return { completed: false, duplicate: true, message: "This relationship movement request was already processed." };
    }
    this.#rememberRequest(requestId);

    if (this.#activeLeaders.has(leaderUuid)) {
      return { completed: false, message: "This leader token is already resolving linked movement." };
    }
    this.#activeLeaders.add(leaderUuid);
    return null;
  }

  #validateFollowerPaths({ followers, instructions, allowIgnoreWalls, isTeleport }) {
    if (isTeleport) return { valid: true };

    for (const { token, relationship } of followers) {
      const placeable = token.object;
      if (!placeable?.constrainMovementPath) {
        Logger.debug(`Skipped preflight collision validation for ${token.uuid}; its Scene is not rendered on the active GM canvas.`);
        continue;
      }

      const waypoints = instructions[token.id]?.waypoints ?? [];
      const path = [{ x: token.x, y: token.y, elevation: token.elevation }, ...waypoints];
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

  #captureOrigins(scene, tokenIds) {
    return Object.fromEntries(tokenIds.map((tokenId) => {
      const token = scene.tokens.get(tokenId);
      return [tokenId, { x: token.x, y: token.y, elevation: token.elevation }];
    }));
  }

  async #rollbackCompletedTokens({ scene, results, origins, leaderUuid }) {
    const instructions = {};
    for (const [tokenId, completed] of Object.entries(results)) {
      if (!completed || !origins[tokenId]) continue;
      instructions[tokenId] = {
        destination: {
          ...origins[tokenId],
          // Rollback uses Scene.moveTokens too, so its terminal destination must
          // follow the same explicit-checkpoint rule as coordinated movement.
          checkpoint: true
        },
        method: "api",
        showRuler: false
      };
    }
    if (!Object.keys(instructions).length) return;

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
