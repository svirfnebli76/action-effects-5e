import {
  ATTACHMENT_MODES,
  COLLISION_POLICIES,
  HOOKS,
  MODULE_ID,
  RELATIONSHIP_ALLIED_ENDPOINT_GRACE_MS,
  RELATIONSHIP_ALLIED_ENDPOINT_POLICIES,
  RELATIONSHIP_COORDINATION_POLICIES,
  RELATIONSHIP_FORCED_LEADER_MOVEMENT_POLICIES,
  RELATIONSHIP_ROTATION_POLICIES,
  RELATIONSHIP_TYPES,
  SCENE_RELATIONSHIPS_FLAG,
  TELEPORT_POLICIES
} from "../core/constants.js";
import { duplicateSafely, nowIso, randomId } from "../core/utils.js";
import { Logger } from "../core/logger.js";

export class RelationshipService {
  #socket;
  #relationships = new Map();
  #followersByLeader = new Map();
  #relationshipsByFollower = new Map();
  #sceneRelationshipIds = new Map();
  #initialized = false;
  #deleteTokenHook = null;
  #updateSceneHook = null;
  #deleteSceneHook = null;

  constructor({ socket }) {
    this.#socket = socket;
    this.#socket.register("relationships.create", this.#createAsGM.bind(this));
    this.#socket.register("relationships.remove", this.#removeAsGM.bind(this));
    this.#socket.register("relationships.cleanupToken", this.#cleanupTokenAsGM.bind(this));
  }

  async initialize() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#rebuildFromScenes();
    this.#deleteTokenHook = Hooks.on("deleteToken", this.#onDeleteToken.bind(this));
    this.#updateSceneHook = Hooks.on("updateScene", this.#onUpdateScene.bind(this));
    this.#deleteSceneHook = Hooks.on("deleteScene", this.#onDeleteScene.bind(this));
    Logger.info(`Relationship service loaded ${this.#relationships.size} persisted relationship(s).`);
  }

  shutdown() {
    if (this.#deleteTokenHook !== null) Hooks.off("deleteToken", this.#deleteTokenHook);
    if (this.#updateSceneHook !== null) Hooks.off("updateScene", this.#updateSceneHook);
    if (this.#deleteSceneHook !== null) Hooks.off("deleteScene", this.#deleteSceneHook);
    this.#deleteTokenHook = null;
    this.#updateSceneHook = null;
    this.#deleteSceneHook = null;
    this.#relationships.clear();
    this.#followersByLeader.clear();
    this.#relationshipsByFollower.clear();
    this.#sceneRelationshipIds.clear();
    this.#initialized = false;
  }

  involves(tokenUuid) {
    return this.#followersByLeader.has(tokenUuid) || this.#relationshipsByFollower.has(tokenUuid);
  }

  get(id) {
    const relationship = this.#relationships.get(id);
    return relationship ? duplicateSafely(relationship) : null;
  }

  getForLeader(leaderUuid) {
    return [...(this.#followersByLeader.get(leaderUuid) ?? [])]
      .map((id) => this.get(id))
      .filter(Boolean);
  }

  getForFollower(followerUuid) {
    return [...(this.#relationshipsByFollower.get(followerUuid) ?? [])]
      .map((id) => this.get(id))
      .filter(Boolean);
  }

  list({ sceneId = null, type = null } = {}) {
    return [...this.#relationships.values()]
      .filter((relationship) => !sceneId || relationship.sceneId === sceneId)
      .filter((relationship) => !type || relationship.type === type)
      .map((relationship) => duplicateSafely(relationship));
  }

  async create(data) {
    return this.#socket.executeAsGM("relationships.create", {
      requestingUserId: game.user.id,
      data: duplicateSafely(data)
    });
  }

  async remove(id) {
    return this.#socket.executeAsGM("relationships.remove", {
      requestingUserId: game.user.id,
      id
    });
  }

  async cleanupToken(tokenUuid) {
    return this.#socket.executeAsGM("relationships.cleanupToken", {
      requestingUserId: game.user.id,
      tokenUuid
    });
  }

  /**
   * Remove relationships during a GM-authorized internal module operation.
   * This is intentionally not exposed through the public API.
   */
  async removeManyAsGM(ids) {
    this.#assertExecutingAsGM();
    return this.#removeManyPersisted(new Set(ids));
  }

  getStats() {
    return {
      relationships: this.#relationships.size,
      leaders: this.#followersByLeader.size,
      followers: this.#relationshipsByFollower.size,
      indexedScenes: this.#sceneRelationshipIds.size
    };
  }

  async #createAsGM({ requestingUserId, data }) {
    this.#assertExecutingAsGM();

    const normalized = await this.#normalizeRelationship({ ...data, createdBy: requestingUserId });
    await this.#validateRequestingUser(requestingUserId, normalized.leaderUuid);

    const duplicate = this.list({ sceneId: normalized.sceneId }).find((relationship) => (
      relationship.leaderUuid === normalized.leaderUuid
      && relationship.followerUuid === normalized.followerUuid
      && relationship.type === normalized.type
    ));
    if (duplicate) throw new Error(`Relationship '${duplicate.id}' already links these tokens.`);

    const existingFollower = this.getForFollower(normalized.followerUuid);
    if (existingFollower.length) {
      throw new Error(`Follower token is already controlled by relationship '${existingFollower[0].id}'.`);
    }
    if (this.getForFollower(normalized.leaderUuid).length || this.getForLeader(normalized.followerUuid).length) {
      throw new Error("Relationship chains and cycles are not supported in Action Effects 5E v0.3.0.");
    }

    const scene = game.scenes.get(normalized.sceneId);
    const relationships = this.#getSceneRelationships(scene);
    relationships.push(normalized);
    await scene.setFlag(MODULE_ID, SCENE_RELATIONSHIPS_FLAG, relationships);

    this.#index(normalized);
    Hooks.callAll(HOOKS.RELATIONSHIP_CREATED, duplicateSafely(normalized));
    Logger.debug("Created relationship", normalized);
    return duplicateSafely(normalized);
  }

  async #removeAsGM({ requestingUserId, id }) {
    this.#assertExecutingAsGM();
    const relationship = this.#relationships.get(id);
    if (!relationship) return false;

    await this.#validateRequestingUser(requestingUserId, relationship.leaderUuid);
    const scene = game.scenes.get(relationship.sceneId);
    const relationships = this.#getSceneRelationships(scene).filter((entry) => entry.id !== id);
    await scene.setFlag(MODULE_ID, SCENE_RELATIONSHIPS_FLAG, relationships);

    this.#unindex(relationship);
    Hooks.callAll(HOOKS.RELATIONSHIP_REMOVED, duplicateSafely(relationship));
    Logger.debug("Removed relationship", relationship);
    return true;
  }

  async #cleanupTokenAsGM({ requestingUserId, tokenUuid }) {
    this.#assertExecutingAsGM();
    const requester = game.users.get(requestingUserId);
    if (!requester?.isGM) throw new Error("Only a GM may request orphan relationship cleanup.");

    const ids = new Set([
      ...(this.#followersByLeader.get(tokenUuid) ?? []),
      ...(this.#relationshipsByFollower.get(tokenUuid) ?? [])
    ]);

    return this.#removeManyPersisted(ids);
  }

  async #removeManyPersisted(ids) {
    const affectedScenes = new Map();
    const removed = [];

    for (const id of ids) {
      const relationship = this.#relationships.get(id);
      if (!relationship) continue;
      if (!affectedScenes.has(relationship.sceneId)) affectedScenes.set(relationship.sceneId, new Set());
      affectedScenes.get(relationship.sceneId).add(id);
      removed.push(relationship);
    }

    for (const [sceneId, sceneIds] of affectedScenes) {
      const scene = game.scenes.get(sceneId);
      if (!scene) continue;
      const relationships = this.#getSceneRelationships(scene).filter((entry) => !sceneIds.has(entry.id));
      await scene.setFlag(MODULE_ID, SCENE_RELATIONSHIPS_FLAG, relationships);
    }

    for (const relationship of removed) {
      this.#unindex(relationship);
      Hooks.callAll(HOOKS.RELATIONSHIP_REMOVED, duplicateSafely(relationship));
      Logger.debug("Removed relationship", relationship);
    }

    return removed.length;
  }

  async #normalizeRelationship(data = {}) {
    const leader = await fromUuid(data.leaderUuid);
    const follower = await fromUuid(data.followerUuid);

    if (!(leader instanceof foundry.documents.TokenDocument)) throw new Error("Relationship leader must be a TokenDocument UUID.");
    if (!(follower instanceof foundry.documents.TokenDocument)) throw new Error("Relationship follower must be a TokenDocument UUID.");
    if (leader.uuid === follower.uuid) throw new Error("A token cannot follow itself.");
    if (leader.parent?.id !== follower.parent?.id) throw new Error("Initial relationships must link tokens on the same Scene.");

    const type = Object.values(RELATIONSHIP_TYPES).includes(data.type)
      ? data.type
      : RELATIONSHIP_TYPES.TEST;
    const attachmentMode = Object.values(ATTACHMENT_MODES).includes(data.attachmentMode)
      ? data.attachmentMode
      : ATTACHMENT_MODES.ADJACENT_FOLLOWER;

    return Object.freeze({
      id: data.id ?? randomId(20),
      sceneId: leader.parent.id,
      leaderUuid: leader.uuid,
      followerUuid: follower.uuid,
      type,
      attachmentMode,
      followerCanSelfMove: data.followerCanSelfMove ?? false,
      followElevation: data.followElevation ?? true,
      followRotation: data.followRotation ?? false,
      teleportPolicy: Object.values(TELEPORT_POLICIES).includes(data.teleportPolicy)
        ? data.teleportPolicy
        : TELEPORT_POLICIES.DETACH,
      collisionPolicy: Object.values(COLLISION_POLICIES).includes(data.collisionPolicy)
        ? data.collisionPolicy
        : COLLISION_POLICIES.STOP_GROUP,
      coordinationPolicy: Object.values(RELATIONSHIP_COORDINATION_POLICIES).includes(data.coordinationPolicy)
        ? data.coordinationPolicy
        : RELATIONSHIP_COORDINATION_POLICIES.COORDINATED,
      forcedLeaderMovementPolicy: Object.values(RELATIONSHIP_FORCED_LEADER_MOVEMENT_POLICIES).includes(data.forcedLeaderMovementPolicy)
        ? data.forcedLeaderMovementPolicy
        : RELATIONSHIP_FORCED_LEADER_MOVEMENT_POLICIES.FOLLOW,
      rotationPolicy: Object.values(RELATIONSHIP_ROTATION_POLICIES).includes(data.rotationPolicy)
        ? data.rotationPolicy
        : RELATIONSHIP_ROTATION_POLICIES.NONE,
      alliedEndpointPolicy: Object.values(RELATIONSHIP_ALLIED_ENDPOINT_POLICIES).includes(data.alliedEndpointPolicy)
        ? data.alliedEndpointPolicy
        : RELATIONSHIP_ALLIED_ENDPOINT_POLICIES.GRACE,
      alliedEndpointGraceMs: Number.isFinite(Number(data.alliedEndpointGraceMs)) && Number(data.alliedEndpointGraceMs) > 0
        ? Number(data.alliedEndpointGraceMs)
        : RELATIONSHIP_ALLIED_ENDPOINT_GRACE_MS,
      // breakDistance is expressed in the Scene grid's distance units (for
      // example 5 on a standard 5-foot D&D grid). Null disables automatic
      // separation detachment for the relationship.
      breakDistance: data.breakDistance !== null
        && data.breakDistance !== undefined
        && Number.isFinite(Number(data.breakDistance))
        && Number(data.breakDistance) >= 0
        ? Number(data.breakDistance)
        : null,
      sourceUuid: data.sourceUuid ?? null,
      metadata: duplicateSafely(data.metadata ?? {}),
      createdBy: data.createdBy ?? game.user.id,
      createdAt: data.createdAt ?? nowIso()
    });
  }

  async #validateRequestingUser(userId, leaderUuid) {
    const user = game.users.get(userId);
    if (!user) throw new Error("The requesting user no longer exists.");
    if (user.isGM) return;

    const leader = await fromUuid(leaderUuid);
    const ownerLevel = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
    if (!leader?.testUserPermission(user, ownerLevel)) {
      throw new Error("The requesting user does not own the relationship leader.");
    }
  }

  #rebuildFromScenes() {
    this.#relationships.clear();
    this.#followersByLeader.clear();
    this.#relationshipsByFollower.clear();
    this.#sceneRelationshipIds.clear();

    for (const scene of game.scenes) this.#reindexScene(scene);
  }


  #reindexScene(scene) {
    if (!scene) return;

    for (const id of [...(this.#sceneRelationshipIds.get(scene.id) ?? [])]) {
      const relationship = this.#relationships.get(id);
      if (relationship) this.#unindex(relationship);
    }

    for (const relationship of this.#getSceneRelationships(scene)) {
      if (!relationship?.id || !relationship.leaderUuid || !relationship.followerUuid) continue;
      this.#index(Object.freeze(duplicateSafely(relationship)));
    }

    Hooks.callAll(HOOKS.RELATIONSHIPS_REINDEXED, scene.id);
  }

  #onUpdateScene(scene, changes) {
    const path = `flags.${MODULE_ID}.${SCENE_RELATIONSHIPS_FLAG}`;
    if (!foundry.utils.hasProperty(changes, path)) return;
    this.#reindexScene(scene);
    Logger.debug(`Reindexed relationships for Scene '${scene.id}'.`);
  }

  #onDeleteScene(scene) {
    for (const id of [...(this.#sceneRelationshipIds.get(scene.id) ?? [])]) {
      const relationship = this.#relationships.get(id);
      if (relationship) this.#unindex(relationship);
    }
    Hooks.callAll(HOOKS.RELATIONSHIPS_REINDEXED, scene.id);
  }

  #getSceneRelationships(scene) {
    if (!scene) return [];
    const value = scene.getFlag(MODULE_ID, SCENE_RELATIONSHIPS_FLAG);
    return Array.isArray(value) ? duplicateSafely(value) : [];
  }

  #index(relationship) {
    this.#relationships.set(relationship.id, relationship);
    this.#addToIndex(this.#sceneRelationshipIds, relationship.sceneId, relationship.id);
    this.#addToIndex(this.#followersByLeader, relationship.leaderUuid, relationship.id);
    this.#addToIndex(this.#relationshipsByFollower, relationship.followerUuid, relationship.id);
  }

  #unindex(relationship) {
    this.#relationships.delete(relationship.id);
    this.#removeFromIndex(this.#sceneRelationshipIds, relationship.sceneId, relationship.id);
    this.#removeFromIndex(this.#followersByLeader, relationship.leaderUuid, relationship.id);
    this.#removeFromIndex(this.#relationshipsByFollower, relationship.followerUuid, relationship.id);
  }

  #addToIndex(index, key, id) {
    if (!index.has(key)) index.set(key, new Set());
    index.get(key).add(id);
  }

  #removeFromIndex(index, key, id) {
    const set = index.get(key);
    if (!set) return;
    set.delete(id);
    if (!set.size) index.delete(key);
  }

  #assertExecutingAsGM() {
    if (!game.user.isGM) throw new Error("This Action Effects 5E operation must execute as a GM.");
  }

  #onDeleteToken(document) {
    if (!game.user.isGM || !this.involves(document.uuid)) return;

    const activeGm = game.users.activeGM
      ?? game.users.find((user) => user.active && user.isGM);
    if (activeGm?.id !== game.user.id) return;

    void this.#cleanupTokenAsGM({
      requestingUserId: game.user.id,
      tokenUuid: document.uuid
    }).catch((error) => Logger.error("Failed to clean relationships for a deleted token.", error));
  }
}
