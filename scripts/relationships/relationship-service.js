import {
  ATTACHMENT_MODES,
  COLLISION_POLICIES,
  HOOKS,
  MODULE_ID,
  RELATIONSHIP_NONHOSTILE_ENDPOINT_GRACE_MS,
  RELATIONSHIP_NONHOSTILE_ENDPOINT_POLICIES,
  RELATIONSHIP_COORDINATION_POLICIES,
  RELATIONSHIP_FORCED_LEADER_MOVEMENT_POLICIES,
  RELATIONSHIP_LINK_OBSTRUCTION_POLICIES,
  RELATIONSHIP_CLASSES,
  RELATIONSHIP_MOVEMENT_COST_POLICIES,
  RELATIONSHIP_ROTATION_POLICIES,
  RELATIONSHIP_TYPES,
  SCENE_RELATIONSHIPS_FLAG,
  TELEPORT_POLICIES
} from "../core/constants.js";
import { duplicateSafely, nowIso, randomId } from "../core/utils.js";
import { Logger } from "../core/logger.js";
import {
  isPhysicalRelationship,
  relationshipClassOf,
  withRelationshipClassDefault
} from "./relationship-class.js";
import { normalizeRelationshipConstraints } from "./relationship-constraint-model.js";

function escapeHtml(value) {
  const text = String(value ?? "");
  if (globalThis.foundry?.utils?.escapeHTML) return foundry.utils.escapeHTML(text);
  return text.replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[character]);
}

function safeImagePath(value) {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate) return null;
  if (/^\/\//.test(candidate)
    || (/^[a-z][a-z0-9+.-]*:/i.test(candidate) && !/^https?:\/\//i.test(candidate))
    || /[\u0000-\u001f<>]/.test(candidate)) {
    throw new Error("Relationship breakPresentation image must be a safe HTTP(S) or relative path.");
  }
  return candidate;
}

export class RelationshipService {
  #socket;
  #lifecycle;
  #spending;
  #relationships = new Map();
  #followersByLeader = new Map();
  #relationshipsByFollower = new Map();
  #sceneRelationshipIds = new Map();
  #initialized = false;
  #deleteTokenHook = null;
  #updateSceneHook = null;
  #deleteSceneHook = null;

  constructor({ socket, lifecycle = null, spending = null }) {
    this.#socket = socket;
    this.#lifecycle = lifecycle;
    this.#spending = spending;
    this.#socket.register("relationships.create", this.#createAsGM.bind(this));
    this.#socket.register("relationships.remove", this.#removeAsGM.bind(this));
    this.#socket.register("relationships.updateGeometry", this.#updateGeometryAsGM.bind(this));
    this.#socket.register("relationships.cleanupToken", this.#cleanupTokenAsGM.bind(this));
    this.#socket.register("relationships.breakNotification", this.#showBreakNotification.bind(this));
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

  getForLeader(leaderUuid, { relationshipClass = null } = {}) {
    return [...(this.#followersByLeader.get(leaderUuid) ?? [])]
      .map((id) => this.get(id))
      .filter(Boolean)
      .filter((relationship) => !relationshipClass || relationshipClassOf(relationship) === relationshipClass);
  }

  getForFollower(followerUuid, { relationshipClass = null } = {}) {
    return [...(this.#relationshipsByFollower.get(followerUuid) ?? [])]
      .map((id) => this.get(id))
      .filter(Boolean)
      .filter((relationship) => !relationshipClass || relationshipClassOf(relationship) === relationshipClass);
  }

  list({ sceneId = null, type = null, relationshipClass = null } = {}) {
    return [...this.#relationships.values()]
      .filter((relationship) => !sceneId || relationship.sceneId === sceneId)
      .filter((relationship) => !type || relationship.type === type)
      .filter((relationship) => !relationshipClass || relationshipClassOf(relationship) === relationshipClass)
      .map((relationship) => duplicateSafely(relationship));
  }

  getPhysicalForLeader(leaderUuid) {
    return this.getForLeader(leaderUuid, { relationshipClass: RELATIONSHIP_CLASSES.PHYSICAL });
  }

  getPhysicalForFollower(followerUuid) {
    return this.getForFollower(followerUuid, { relationshipClass: RELATIONSHIP_CLASSES.PHYSICAL });
  }

  listPhysical(filter = {}) {
    return this.list({ ...filter, relationshipClass: RELATIONSHIP_CLASSES.PHYSICAL });
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

  async updateGeometry(id, changes = {}) {
    return this.#socket.executeAsGM("relationships.updateGeometry", {
      requestingUserId: game.user.id,
      id,
      changes: duplicateSafely(changes)
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
  async removeManyAsGM(ids, context = {}) {
    this.#assertExecutingAsGM();
    return this.#removeManyPersisted(new Set(ids), context);
  }

  async updateGeometryAsGM(id, changes = {}) {
    this.#assertExecutingAsGM();
    return this.#updateGeometryPersisted(id, changes);
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
      && relationshipClassOf(relationship) === normalized.relationshipClass
    ));
    if (duplicate) throw new Error(`Relationship '${duplicate.id}' already links these tokens.`);

    // Exclusivity, chains, and cycles are physical-control rules. Observational
    // relationships do not control either participant and may overlap freely.
    if (isPhysicalRelationship(normalized)) {
      const existingFollower = this.getPhysicalForFollower(normalized.followerUuid);
      if (existingFollower.length) {
        throw new Error(`Follower token is already controlled by relationship '${existingFollower[0].id}'.`);
      }
      if (this.getPhysicalForFollower(normalized.leaderUuid).length || this.getPhysicalForLeader(normalized.followerUuid).length) {
        throw new Error("Relationship chains and cycles are not supported by the current Action Effects 5E physical relationship model.");
      }
    }

    if (this.#isGrappleRelationship(normalized)) {
      await this.#reconcileGrappleLeaderLedger({
        leaderUuid: normalized.leaderUuid,
        requestingUserId
      });
    }

    let persisted = normalized;
    let provisionedItemUuids = [];
    if (this.#lifecycle) {
      const provisioned = await this.#lifecycle.provisionParticipantItemGrants(normalized);
      persisted = provisioned.relationship;
      provisionedItemUuids = provisioned.createdItemUuids ?? [];
    }

    const scene = game.scenes.get(persisted.sceneId);
    const relationships = this.#getSceneRelationships(scene);
    relationships.push(persisted);
    try {
      await scene.setFlag(MODULE_ID, SCENE_RELATIONSHIPS_FLAG, relationships);
    } catch (error) {
      if (this.#lifecycle && provisionedItemUuids.length) {
        await this.#lifecycle.cleanupProvisionedItems(provisionedItemUuids, persisted.id);
      }
      throw error;
    }

    this.#index(persisted);
    Hooks.callAll(HOOKS.RELATIONSHIP_CREATED, duplicateSafely(persisted));
    Logger.debug("Created relationship", persisted);
    return duplicateSafely(persisted);
  }

  async #removeAsGM({ requestingUserId, id }) {
    this.#assertExecutingAsGM();
    const relationship = this.#relationships.get(id);
    if (!relationship) return false;

    await this.#validateRequestingUser(requestingUserId, relationship.leaderUuid);
    return (await this.#removeManyPersisted(new Set([id]), { reason: "manual-removal", silent: true })) > 0;
  }


  async #updateGeometryAsGM({ requestingUserId, id, changes = {} }) {
    this.#assertExecutingAsGM();
    const relationship = this.#relationships.get(id);
    if (!relationship) return null;
    await this.#validateRequestingUser(requestingUserId, relationship.leaderUuid);
    return this.#updateGeometryPersisted(id, changes);
  }

  async #updateGeometryPersisted(id, changes = {}) {
    const relationship = this.#relationships.get(id);
    if (!relationship) return null;

    const updated = { ...duplicateSafely(relationship) };
    if (Object.prototype.hasOwnProperty.call(changes, "coordinationDistance")) {
      const value = Number(changes.coordinationDistance);
      updated.coordinationDistance = Number.isFinite(value) && value >= 0 ? value : null;
    }
    if (Object.prototype.hasOwnProperty.call(changes, "breakDistance")) {
      const value = Number(changes.breakDistance);
      updated.breakDistance = Number.isFinite(value) && value >= 0 ? value : null;
    }
    this.#assertGeometryDistanceInvariant(updated);

    const frozen = Object.freeze(updated);
    const scene = game.scenes.get(relationship.sceneId);
    if (!scene) throw new Error("The relationship Scene no longer exists.");
    const entries = this.#getSceneRelationships(scene);
    const index = entries.findIndex((entry) => entry.id === id);
    if (index < 0) return null;
    entries[index] = duplicateSafely(frozen);
    await scene.setFlag(MODULE_ID, SCENE_RELATIONSHIPS_FLAG, entries);

    this.#unindex(relationship);
    this.#index(frozen);
    Hooks.callAll(HOOKS.RELATIONSHIP_UPDATED, duplicateSafely(frozen), duplicateSafely(relationship));
    Logger.debug("Updated relationship geometry", { id, changes, relationship: frozen });
    return duplicateSafely(frozen);
  }

  async #cleanupTokenAsGM({ requestingUserId, tokenUuid }) {
    this.#assertExecutingAsGM();
    const requester = game.users.get(requestingUserId);
    if (!requester?.isGM) throw new Error("Only a GM may request orphan relationship cleanup.");

    const ids = new Set([
      ...(this.#followersByLeader.get(tokenUuid) ?? []),
      ...(this.#relationshipsByFollower.get(tokenUuid) ?? [])
    ]);

    return this.#removeManyPersisted(ids, {
      reason: "participant-unavailable",
      details: { tokenUuid }
    });
  }

  async #removeManyPersisted(ids, context = {}) {
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

    // Unindex first so source-effect cleanup cannot recursively discover the
    // relationship while deleting its owned ActiveEffect.
    for (const relationship of removed) this.#unindex(relationship);

    for (const relationship of removed) {
      if (this.#lifecycle) {
        await this.#lifecycle.cleanupRemovedRelationship(relationship);
      }
      if (context?.silent !== true) await this.#presentBreak(relationship, context);
      Hooks.callAll(HOOKS.RELATIONSHIP_REMOVED, duplicateSafely(relationship), duplicateSafely(context));
      Logger.debug("Removed relationship", relationship);
    }

    return removed.length;
  }

  #isGrappleRelationship(relationship = {}) {
    return isPhysicalRelationship(relationship) && (
      relationship?.type === RELATIONSHIP_TYPES.GRAPPLE
      || relationship?.attachmentMode === ATTACHMENT_MODES.GRAPPLE_FOLLOWER
    );
  }

  async #reconcileGrappleLeaderLedger({ leaderUuid, requestingUserId }) {
    if (!this.#spending?.reconcileLedgerAsAuthority) return null;

    const leader = await fromUuid(leaderUuid);
    if (!(leader instanceof foundry.documents.TokenDocument)) {
      throw new Error("The Grapple leader is not a valid TokenDocument for movement-ledger reconciliation.");
    }

    // TokenDocument coordinates can interpolate during Foundry movement
    // animation even after the destination has already entered movementHistory.
    // Never diagnose or repair that transient state as stale history.
    const animation = leader.object?.movementAnimationPromise;
    if (animation && typeof animation.then === "function") {
      try {
        await animation;
      } catch (error) {
        Logger.debug("Grapple ledger reconciliation waited for a rejected token animation; validating the settled Token state anyway.", error);
      }
    }

    try {
      return await this.#spending.reconcileLedgerAsAuthority(leader, {
        requestedByUserId: requestingUserId,
        reason: "grapple-start",
        clearInactiveHistory: true
      });
    } catch (error) {
      Logger.error("Could not reconcile the Grapple leader movement ledger before relationship creation.", error);
      throw new Error(`Grapple could not begin because the leader's movement history is out of sync and could not be safely reconciled: ${error.message}`);
    }
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
    if (data.relationshipClass !== undefined && !Object.values(RELATIONSHIP_CLASSES).includes(data.relationshipClass)) {
      throw new Error(`Relationship class '${data.relationshipClass}' is not supported.`);
    }
    const relationshipClass = data.relationshipClass ?? RELATIONSHIP_CLASSES.PHYSICAL;
    const constraints = normalizeRelationshipConstraints(data.constraints);
    if (relationshipClass !== RELATIONSHIP_CLASSES.OBSERVATIONAL && constraints.length) {
      throw new Error("Relationship constraints require relationshipClass 'observational'.");
    }
    const attachmentMode = Object.values(ATTACHMENT_MODES).includes(data.attachmentMode)
      ? data.attachmentMode
      : ATTACHMENT_MODES.ADJACENT_FOLLOWER;
    const coordinationDistance = data.coordinationDistance !== null
      && data.coordinationDistance !== undefined
      && Number.isFinite(Number(data.coordinationDistance))
      && Number(data.coordinationDistance) >= 0
      ? Number(data.coordinationDistance)
      : null;
    const breakDistance = data.breakDistance !== null
      && data.breakDistance !== undefined
      && Number.isFinite(Number(data.breakDistance))
      && Number(data.breakDistance) >= 0
      ? Number(data.breakDistance)
      : null;
    this.#assertGeometryDistanceInvariant({ coordinationDistance, breakDistance });

    const id = data.id ?? randomId(20);
    const sourceUuid = data.sourceUuid ?? null;
    const lifecycle = this.#lifecycle
      ? await this.#lifecycle.normalize(data.lifecycle, {
          sourceUuid,
          leader,
          follower
        })
      : (data.lifecycle ? duplicateSafely(data.lifecycle) : null);
    const breakPresentation = this.#normalizeBreakPresentation(data.breakPresentation, leader);

    return Object.freeze({
      id,
      sceneId: leader.parent.id,
      leaderUuid: leader.uuid,
      followerUuid: follower.uuid,
      type,
      relationshipClass,
      constraints,
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
      movementCostPolicy: Object.values(RELATIONSHIP_MOVEMENT_COST_POLICIES).includes(data.movementCostPolicy)
        ? data.movementCostPolicy
        : ((type === RELATIONSHIP_TYPES.GRAPPLE || attachmentMode === ATTACHMENT_MODES.GRAPPLE_FOLLOWER)
          ? RELATIONSHIP_MOVEMENT_COST_POLICIES.GRAPPLE
          : RELATIONSHIP_MOVEMENT_COST_POLICIES.NONE),
      linkObstructionPolicy: Object.values(RELATIONSHIP_LINK_OBSTRUCTION_POLICIES).includes(data.linkObstructionPolicy)
        ? data.linkObstructionPolicy
        : ((type === RELATIONSHIP_TYPES.GRAPPLE || attachmentMode === ATTACHMENT_MODES.GRAPPLE_FOLLOWER)
          ? RELATIONSHIP_LINK_OBSTRUCTION_POLICIES.GRAPPLE
          : RELATIONSHIP_LINK_OBSTRUCTION_POLICIES.NONE),
      ...this.#normalizeNonhostileEndpointPolicy(data),
      // coordinationDistance is the planar band which coordinated dragging
      // and orbiting preserve. It is intentionally separate from breakDistance:
      // a 10-foot-reach grapple may be coordinated at either 5 or 10 feet.
      coordinationDistance,
      // breakDistance is expressed in the Scene grid's distance units (for
      // example 5 on a standard 5-foot D&D grid). Null disables automatic
      // separation detachment for the relationship.
      breakDistance,
      sourceUuid,
      lifecycle,
      breakPresentation,
      metadata: duplicateSafely(data.metadata ?? {}),
      createdBy: data.createdBy ?? game.user.id,
      createdAt: data.createdAt ?? nowIso()
    });
  }


  #normalizeNonhostileEndpointPolicy(data = {}) {
    const requestedPolicy = data.nonhostileEndpointPolicy ?? data.alliedEndpointPolicy;
    const requestedGraceMs = data.nonhostileEndpointGraceMs ?? data.alliedEndpointGraceMs;
    const policy = Object.values(RELATIONSHIP_NONHOSTILE_ENDPOINT_POLICIES).includes(requestedPolicy)
      ? requestedPolicy
      : RELATIONSHIP_NONHOSTILE_ENDPOINT_POLICIES.GRACE;
    const graceMs = Number.isFinite(Number(requestedGraceMs)) && Number(requestedGraceMs) > 0
      ? Number(requestedGraceMs)
      : RELATIONSHIP_NONHOSTILE_ENDPOINT_GRACE_MS;

    return {
      nonhostileEndpointPolicy: policy,
      nonhostileEndpointGraceMs: graceMs,
      // Persist the legacy aliases during the development migration window so
      // v0.3.21-v0.3.23 integrations and saved test fixtures remain readable.
      alliedEndpointPolicy: policy,
      alliedEndpointGraceMs: graceMs
    };
  }

  #normalizeBreakPresentation(value, leader) {
    if (value === null || value === undefined) return null;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("Relationship breakPresentation must be an object.");
    }
    const requestedMessages = value.messages ?? {};
    if (!requestedMessages || typeof requestedMessages !== "object" || Array.isArray(requestedMessages)) {
      throw new TypeError("Relationship breakPresentation messages must be an object.");
    }
    const messages = {};
    for (const [reason, message] of Object.entries(requestedMessages)) {
      const key = String(reason ?? "").trim();
      const text = String(message ?? "").trim();
      if (!key || !text) throw new Error("Relationship breakPresentation messages require non-empty reason keys and text.");
      messages[key] = text;
    }
    if (!Object.keys(messages).length) {
      throw new Error("Relationship breakPresentation requires at least one reason message.");
    }
    const controllerActorUuid = String(value.controllerActorUuid ?? leader?.actor?.uuid ?? "").trim() || null;
    return Object.freeze({
      ui: value.ui !== false,
      chat: value.chat !== false,
      title: String(value.title ?? "Relationship Ended").trim() || "Relationship Ended",
      img: safeImagePath(value.img),
      controllerActorUuid,
      messages: Object.freeze(messages)
    });
  }

  #breakMessage(relationship, context = {}) {
    const messages = relationship?.breakPresentation?.messages ?? null;
    if (!messages || !context?.reason) return null;
    const status = context?.details?.status;
    const exact = status ? `${context.reason}:${status}` : null;
    return (exact ? messages[exact] : null) ?? messages[context.reason] ?? null;
  }

  async #presentBreak(relationship, context = {}) {
    const presentation = relationship?.breakPresentation;
    const message = this.#breakMessage(relationship, context);
    if (!presentation || !message) return false;
    const payload = {
      message,
      controllerActorUuid: presentation.controllerActorUuid
    };
    if (presentation.ui !== false) {
      try {
        if (typeof this.#socket.executeForEveryone === "function") {
          await this.#socket.executeForEveryone("relationships.breakNotification", payload);
        } else {
          await this.#showBreakNotification(payload);
        }
      } catch (error) {
        Logger.warn("Relationship break UI notification failed.", error);
        await this.#showBreakNotification(payload);
      }
    }
    if (presentation.chat !== false && globalThis.ChatMessage?.create) {
      try {
        const image = presentation.img
          ? `<img src="${escapeHtml(presentation.img)}" alt="" width="36" height="36">`
          : "";
        await ChatMessage.create({
          speaker: { alias: "Action Effects 5E" },
          content: `<section class="ae5e-relationship-break"><header class="card-header flexrow">${image}<h3>${escapeHtml(presentation.title)}</h3></header><div class="card-content"><p>${escapeHtml(message)}</p></div></section>`
        });
      } catch (error) {
        Logger.warn("Relationship break chat card failed.", error);
      }
    }
    return true;
  }

  async #showBreakNotification(payload = {}) {
    const message = String(payload?.message ?? "").trim();
    if (!message) return false;
    if (!game.user?.isGM && payload.controllerActorUuid) {
      let actor = null;
      try { actor = await fromUuid(payload.controllerActorUuid); } catch { /* unavailable */ }
      const owner = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
      if (!actor?.testUserPermission?.(game.user, owner)) return false;
    }
    globalThis.ui?.notifications?.info?.(message);
    return true;
  }


  #assertGeometryDistanceInvariant({ coordinationDistance = null, breakDistance = null } = {}) {
    const coordination = coordinationDistance === null || coordinationDistance === undefined
      ? null
      : Number(coordinationDistance);
    const maximum = breakDistance === null || breakDistance === undefined
      ? null
      : Number(breakDistance);
    if (Number.isFinite(coordination) && Number.isFinite(maximum) && coordination > maximum + 1e-6) {
      throw new Error(`Relationship coordinationDistance (${coordination}) cannot exceed breakDistance (${maximum}).`);
    }
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
      // Apply the compatibility default in memory only. Persisted legacy
      // records remain untouched until they are intentionally updated.
      this.#index(Object.freeze(withRelationshipClassDefault(duplicateSafely(relationship))));
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
