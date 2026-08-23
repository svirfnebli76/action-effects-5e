import {
  MODULE_ID,
  RELATIONSHIP_GRANT_FLAG,
  RELATIONSHIP_LIFECYCLE_SCHEMA_VERSION,
  RELATIONSHIP_PARTICIPANTS
} from "../core/constants.js";
import { duplicateSafely } from "../core/utils.js";
import { Logger } from "../core/logger.js";

function documentName(document) {
  return document?.documentName ?? document?.constructor?.documentName ?? null;
}

function getFlag(document, scope, key) {
  return document?.getFlag?.(scope, key)
    ?? document?.flags?.[scope]?.[key]
    ?? null;
}

function setProperty(object, path, value) {
  if (globalThis.foundry?.utils?.setProperty) return foundry.utils.setProperty(object, path, value);
  const parts = String(path).split(".");
  const leaf = parts.pop();
  let current = object;
  for (const part of parts) current = current[part] ??= {};
  current[leaf] = value;
  return true;
}

/**
 * Owns documents whose lifetime is explicitly tied to a persisted token
 * relationship. RelationshipService remains the authority for relationship
 * persistence; this service supplies validation, participant Item grants, and
 * source-Active-Effect cleanup without changing legacy sourceUuid semantics.
 */
export class RelationshipLifecycleService {
  #relationshipsAccessor;
  #initialized = false;
  #deleteActiveEffectHook = null;
  #stats = {
    grantsCreated: 0,
    grantsRemoved: 0,
    sourceEffectsRemoved: 0,
    sourceEffectBreaks: 0,
    reconciledRelationshipsRemoved: 0,
    cleanupErrors: 0
  };

  constructor({ relationshipsAccessor = null } = {}) {
    this.#relationshipsAccessor = relationshipsAccessor;
  }

  async initialize() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#deleteActiveEffectHook = Hooks.on(
      "deleteActiveEffect",
      (effect, options = {}) => this.#onDeleteActiveEffect(effect, options)
    );
    await this.reconcile();
  }

  shutdown() {
    if (this.#deleteActiveEffectHook !== null) Hooks.off("deleteActiveEffect", this.#deleteActiveEffectHook);
    this.#deleteActiveEffectHook = null;
    this.#initialized = false;
  }

  getStats() {
    return {
      initialized: this.#initialized,
      deleteActiveEffectHookRegistered: this.#deleteActiveEffectHook !== null,
      ...this.#stats
    };
  }

  getGrantConfig(item) {
    const config = getFlag(item, MODULE_ID, RELATIONSHIP_GRANT_FLAG);
    return config ? duplicateSafely(config) : null;
  }

  /**
   * Normalize and validate explicitly requested lifecycle behavior.
   * Merely supplying sourceUuid does not opt a relationship into document
   * ownership; existing callers may use sourceUuid for Items, Tokens, etc.
   */
  async normalize(lifecycle, { sourceUuid, leader, follower } = {}) {
    if (lifecycle === null || lifecycle === undefined) return null;
    if (!lifecycle || typeof lifecycle !== "object" || Array.isArray(lifecycle)) {
      throw new TypeError("Relationship lifecycle configuration must be an object.");
    }

    const sourceEffect = lifecycle.sourceEffect ?? null;
    let normalizedSourceEffect = null;
    if (sourceEffect !== null && sourceEffect !== undefined) {
      if (!sourceEffect || typeof sourceEffect !== "object" || Array.isArray(sourceEffect)) {
        throw new TypeError("Relationship lifecycle sourceEffect configuration must be an object.");
      }
      if (typeof sourceUuid !== "string" || !sourceUuid.length) {
        throw new Error("Relationship source-effect lifecycle requires sourceUuid to reference an ActiveEffect.");
      }
      const source = await fromUuid(sourceUuid);
      if (documentName(source) !== "ActiveEffect") {
        throw new Error("Relationship source-effect lifecycle sourceUuid must resolve to an ActiveEffect.");
      }
      normalizedSourceEffect = Object.freeze({
        removeRelationshipOnDelete: sourceEffect.removeRelationshipOnDelete !== false,
        deleteOnRelationshipRemove: sourceEffect.deleteOnRelationshipRemove !== false
      });
    }

    const requestedGrants = lifecycle.participantItemGrants ?? [];
    if (!Array.isArray(requestedGrants)) {
      throw new TypeError("Relationship lifecycle participantItemGrants must be an array.");
    }

    const normalizedGrants = [];
    const seenRoles = new Set();
    for (const [index, grant] of requestedGrants.entries()) {
      if (!grant || typeof grant !== "object" || Array.isArray(grant)) {
        throw new TypeError(`Relationship participant Item grant ${index + 1} must be an object.`);
      }
      const participant = grant.participant;
      if (!Object.values(RELATIONSHIP_PARTICIPANTS).includes(participant)) {
        throw new Error(`Relationship participant Item grant ${index + 1} must target 'leader' or 'follower'.`);
      }
      const role = typeof grant.role === "string" ? grant.role.trim() : "";
      if (!role) throw new Error(`Relationship participant Item grant ${index + 1} requires a non-empty role.`);
      const roleKey = `${participant}:${role}`;
      if (seenRoles.has(roleKey)) {
        throw new Error(`Relationship participant Item grant role '${role}' is duplicated for ${participant}.`);
      }
      seenRoles.add(roleKey);

      const templateUuid = typeof grant.templateUuid === "string" ? grant.templateUuid.trim() : "";
      if (!templateUuid) throw new Error(`Relationship participant Item grant '${role}' requires templateUuid.`);
      const template = await fromUuid(templateUuid);
      if (documentName(template) !== "Item") {
        throw new Error(`Relationship participant Item grant template '${templateUuid}' could not be resolved to an Item.`);
      }

      const participantToken = participant === RELATIONSHIP_PARTICIPANTS.LEADER ? leader : follower;
      const actor = participantToken?.actor ?? null;
      if (!actor?.createEmbeddedDocuments) {
        throw new Error(`Relationship ${participant} does not have an Actor capable of receiving Item grants.`);
      }

      normalizedGrants.push(Object.freeze({
        participant,
        role,
        templateUuid,
        itemUuid: null
      }));
    }

    if (!normalizedSourceEffect && !normalizedGrants.length) return null;
    return Object.freeze({
      schema: RELATIONSHIP_LIFECYCLE_SCHEMA_VERSION,
      sourceEffect: normalizedSourceEffect,
      participantItemGrants: Object.freeze(normalizedGrants)
    });
  }

  /**
   * Create relationship-owned Item clones before the relationship is persisted.
   * The returned relationship carries the created Item UUIDs so every later
   * removal path (manual, teleport, forced separation, token deletion, etc.)
   * has enough information to perform deterministic cleanup.
   */
  async provisionParticipantItemGrants(relationship) {
    const lifecycle = relationship?.lifecycle;
    const grants = lifecycle?.participantItemGrants ?? [];
    if (!grants.length) return { relationship, createdItemUuids: [] };

    const createdItemUuids = [];
    const provisioned = [];
    try {
      for (const grant of grants) {
        const participantToken = await fromUuid(
          grant.participant === RELATIONSHIP_PARTICIPANTS.LEADER
            ? relationship.leaderUuid
            : relationship.followerUuid
        );
        const actor = participantToken?.actor ?? null;
        if (!actor?.createEmbeddedDocuments) {
          throw new Error(`Relationship ${grant.participant} Actor is unavailable while provisioning Item grant '${grant.role}'.`);
        }

        const template = await fromUuid(grant.templateUuid);
        if (documentName(template) !== "Item") {
          throw new Error(`Relationship participant Item grant template '${grant.templateUuid}' is unavailable.`);
        }
        const itemData = template.toObject();
        delete itemData._id;
        setProperty(itemData, `flags.${MODULE_ID}.${RELATIONSHIP_GRANT_FLAG}`, {
          schema: RELATIONSHIP_LIFECYCLE_SCHEMA_VERSION,
          relationshipId: relationship.id,
          relationshipType: relationship.type,
          role: grant.role,
          participant: grant.participant,
          leaderUuid: relationship.leaderUuid,
          followerUuid: relationship.followerUuid,
          sourceEffectUuid: relationship.lifecycle?.sourceEffect ? (relationship.sourceUuid ?? null) : null,
          templateUuid: grant.templateUuid
        });

        const [created] = await actor.createEmbeddedDocuments("Item", [itemData], {
          ae5eRelationshipGrant: true,
          relationshipId: relationship.id
        });
        if (!created) throw new Error(`AE5E failed to create relationship Item grant '${grant.role}'.`);
        createdItemUuids.push(created.uuid);
        this.#stats.grantsCreated += 1;
        provisioned.push(Object.freeze({ ...grant, itemUuid: created.uuid }));
      }
    } catch (error) {
      await this.cleanupProvisionedItems(createdItemUuids, relationship.id);
      throw error;
    }

    const nextLifecycle = Object.freeze({
      ...lifecycle,
      participantItemGrants: Object.freeze(provisioned)
    });
    return {
      relationship: Object.freeze({ ...duplicateSafely(relationship), lifecycle: nextLifecycle }),
      createdItemUuids
    };
  }

  async cleanupProvisionedItems(itemUuids, relationshipId = null) {
    for (const itemUuid of itemUuids ?? []) {
      try {
        const item = await fromUuid(itemUuid);
        if (documentName(item) !== "Item") continue;
        const grant = this.getGrantConfig(item);
        if (relationshipId && grant?.relationshipId !== relationshipId) continue;
        await this.#deleteEmbedded(item, "Item", { ae5eRelationshipGrantRollback: true });
      } catch (error) {
        this.#stats.cleanupErrors += 1;
        Logger.warn("Failed to roll back a relationship Item grant.", error);
      }
    }
  }

  async cleanupRemovedRelationship(relationship) {
    const lifecycle = relationship?.lifecycle;
    if (!lifecycle) return { grantsRemoved: 0, sourceEffectRemoved: false };

    let grantsRemoved = 0;
    for (const grant of lifecycle.participantItemGrants ?? []) {
      if (!grant?.itemUuid) continue;
      try {
        const item = await fromUuid(grant.itemUuid);
        if (documentName(item) !== "Item") continue;
        const config = this.getGrantConfig(item);
        if (config?.relationshipId !== relationship.id) {
          Logger.warn(`Skipped relationship grant cleanup for '${grant.itemUuid}' because its ownership flag does not match relationship '${relationship.id}'.`);
          continue;
        }
        const removed = await this.#deleteEmbedded(item, "Item", {
          ae5eRelationshipGrantCleanup: true,
          relationshipId: relationship.id
        });
        if (removed) {
          grantsRemoved += 1;
          this.#stats.grantsRemoved += 1;
        }
      } catch (error) {
        this.#stats.cleanupErrors += 1;
        Logger.warn("Failed to clean a relationship-owned Item grant.", error);
      }
    }

    let sourceEffectRemoved = false;
    if (lifecycle.sourceEffect?.deleteOnRelationshipRemove === true && relationship.sourceUuid) {
      try {
        const effect = await fromUuid(relationship.sourceUuid);
        if (documentName(effect) === "ActiveEffect") {
          sourceEffectRemoved = await this.#deleteEmbedded(effect, "ActiveEffect", {
            ae5eRelationshipLifecycleCleanup: true,
            relationshipId: relationship.id
          });
          if (sourceEffectRemoved) this.#stats.sourceEffectsRemoved += 1;
        }
      } catch (error) {
        this.#stats.cleanupErrors += 1;
        Logger.warn("Failed to clean a relationship-owned source ActiveEffect.", error);
      }
    }

    return { grantsRemoved, sourceEffectRemoved };
  }

  async reconcile() {
    if (!this.#isAuthority()) return { removed: 0 };
    const relationships = this.#relationships();
    if (!relationships) return { removed: 0 };
    const missingSourceIds = [];
    for (const relationship of relationships.list()) {
      if (relationship.lifecycle?.sourceEffect?.removeRelationshipOnDelete !== true) continue;
      if (!relationship.sourceUuid) continue;
      let source = null;
      try { source = await fromUuid(relationship.sourceUuid); } catch { /* remove below */ }
      if (documentName(source) !== "ActiveEffect") missingSourceIds.push(relationship.id);
    }
    if (missingSourceIds.length) {
      await relationships.removeManyAsGM(missingSourceIds);
      this.#stats.reconciledRelationshipsRemoved += missingSourceIds.length;
    }
    return { removed: missingSourceIds.length };
  }

  async #onDeleteActiveEffect(effect, options = {}) {
    if (!this.#isAuthority()) return;
    if (!effect?.uuid || options?.ae5eRelationshipLifecycleCleanup === true) return;
    const relationships = this.#relationships();
    if (!relationships) return;
    const ids = relationships.list()
      .filter((relationship) => (
        relationship.sourceUuid === effect.uuid
        && relationship.lifecycle?.sourceEffect?.removeRelationshipOnDelete === true
      ))
      .map((relationship) => relationship.id);
    if (!ids.length) return;

    try {
      await relationships.removeManyAsGM(ids);
      this.#stats.sourceEffectBreaks += ids.length;
    } catch (error) {
      this.#stats.cleanupErrors += 1;
      Logger.error("Failed to remove relationship after its source ActiveEffect was deleted.", error);
    }
  }

  #relationships() {
    return typeof this.#relationshipsAccessor === "function"
      ? this.#relationshipsAccessor()
      : null;
  }

  #isAuthority() {
    if (!game?.user?.isGM) return false;
    const activeGm = game.users?.activeGM
      ?? game.users?.find?.((user) => user.active && user.isGM)
      ?? null;
    return !activeGm || activeGm.id === game.user.id;
  }

  async #deleteEmbedded(document, embeddedName, options = {}) {
    const parent = document?.parent;
    if (!parent?.deleteEmbeddedDocuments || !document?.id) return false;
    const collection = embeddedName === "Item" ? parent.items : parent.effects;
    if (collection?.get && !collection.get(document.id)) return false;
    try {
      await parent.deleteEmbeddedDocuments(embeddedName, [document.id], options);
      return true;
    } catch (error) {
      if (collection?.get && !collection.get(document.id)) return false;
      throw error;
    }
  }
}
