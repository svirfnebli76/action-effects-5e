import {
  HOOKS,
  MODULE_ID,
  MOVEMENT_AGENCIES,
  MOVEMENT_PHASES,
  MOVEMENT_RESOURCES,
  PATH_TYPES
} from "../core/constants.js";
import { duplicateSafely, randomId } from "../core/utils.js";
import { Logger } from "../core/logger.js";
import { RelationshipMovementPlanner } from "./relationship-movement-planner.js";

const CONSUMER_PREFIX = `${MODULE_ID}.relationship-movement`;
const MAX_RECENT_REQUESTS = 100;
const MANUAL_SELF_MOVEMENT_METHODS = new Set(["dragging", "keyboard", "hud", "config"]);
const PASSTHROUGH_LEADER_METHODS = new Set(["api", "undo", "paste"]);
const SUPPORTED_METHODS = new Set(["api", "config", "hud", "dragging", "keyboard", "paste", "undo"]);

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
      recentRequests: this.#recentRequestIds.size
    };
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

  #recordMovementReceipt(transaction) {
    const metadata = transaction.metadata ?? {};
    if (metadata.relationshipMovement === true && metadata.generatedBy === MODULE_ID) return true;
    if (!this.#positionChanged(transaction.origin, transaction.destination)) return true;

    this.#movementReceipts.set(transaction.movementId, {
      transaction: transaction.toJSON(),
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
    const followerRelationships = this.#relationships.getForFollower(transaction.subjectUuid);
    if (followerRelationships.length && transaction.pathType === PATH_TYPES.TELEPORT) {
      if (this.#queuedFollowerDetachIds.has(lifecycleKey)) return true;

      // Foundry's moveToken hook fires before the movement animation/document
      // position has necessarily reached its final destination. The public
      // TokenMovementOperation.finished promise resolves only after the entire
      // movement has completed (including checkpoint continuations). Hold the
      // stable subpath key while awaiting it so later continuation hooks cannot
      // schedule duplicate detach operations.
      this.#queuedFollowerDetachIds.add(lifecycleKey);
      try {
        if (!await this.#awaitMovementFinished(context)) return true;

        const request = {
          requestId: `${MODULE_ID}-follower-teleport-${randomId(20)}`,
          requestingUserId: transaction.userId ?? game.user.id,
          sceneId: transaction.sceneId,
          followerUuid: transaction.subjectUuid,
          originalMovementId: transaction.movementId,
          origin: duplicateSafely(transaction.origin),
          destination: duplicateSafely(transaction.destination),
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
    if (this.#queuedSyncIds.has(lifecycleKey)) return true;

    let waypoints;
    try {
      waypoints = RelationshipMovementPlanner.extractTransactionWaypoints(transaction);
    } catch (error) {
      Logger.error("Could not read an external leader movement path for follower synchronization.", error);
      return true;
    }

    // Hold the stable subpath key before awaiting movement.finished. Explicit
    // checkpoints receive new movement IDs but keep the same subpathId, so only
    // the first after-hook for an external movement owns synchronization. Its
    // transaction already contains passed + pending waypoints for the full route.
    this.#queuedSyncIds.add(lifecycleKey);
    try {
      if (!await this.#awaitMovementFinished(context)) return true;

      const destination = RelationshipMovementPlanner.finalWaypoint(waypoints)
        ?? transaction.destination;
      const request = {
        requestId: `${MODULE_ID}-external-sync-${randomId(20)}`,
        requestingUserId: transaction.userId ?? game.user.id,
        sceneId: transaction.sceneId,
        leaderUuid: transaction.subjectUuid,
        originalMovementId: transaction.movementId,
        origin: duplicateSafely(transaction.origin),
        destination: duplicateSafely(destination),
        waypoints,
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

  async #awaitMovementFinished(context = {}) {
    const finished = context?.movement?.finished;
    if (!finished || typeof finished.then !== "function") {
      // Test/synthetic callers may not provide a live TokenMovementOperation.
      // Preserve the old next-task handoff as a compatibility fallback.
      await new Promise((resolve) => setTimeout(resolve, 0));
      return true;
    }

    try {
      return await finished !== false;
    } catch (error) {
      Logger.debug("Movement completion promise rejected before relationship synchronization.", error);
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

  #registerInstructionMovementContexts(instructions, operationOptions) {
    const removers = [];
    try {
      for (const [tokenId, instruction] of Object.entries(instructions)) {
        const movementId = randomId(16);
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
