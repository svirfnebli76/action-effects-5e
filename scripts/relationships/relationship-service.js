import {
  ATTACHMENT_MODES,
  HOOKS,
  MODULE_ID,
  RELATIONSHIP_TYPES,
  SCENE_RELATIONSHIPS_FLAG
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

    const affectedScenes = new Set();
    for (const id of ids) {
      const relationship = this.#relationships.get(id);
      if (!relationship) continue;
      affectedScenes.add(relationship.sceneId);
      this.#unindex(relationship);
      Hooks.callAll(HOOKS.RELATIONSHIP_REMOVED, duplicateSafely(relationship));
    }

    for (const sceneId of affectedScenes) {
      const scene = game.scenes.get(sceneId);
      const relationships = this.#getSceneRelationships(scene).filter((entry) => !ids.has(entry.id));
      await scene.setFlag(MODULE_ID, SCENE_RELATIONSHIPS_FLAG, relationships);
    }

    return ids.size;
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
      teleportPolicy: data.teleportPolicy ?? "detach",
      collisionPolicy: data.collisionPolicy ?? "stopGroup",
      breakDistance: Number.isFinite(Number(data.breakDistance)) ? Number(data.breakDistance) : null,
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
