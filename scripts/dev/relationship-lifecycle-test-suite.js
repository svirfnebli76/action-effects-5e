import {
  ATTACHMENT_MODES,
  COLLISION_POLICIES,
  MODULE_ID,
  RELATIONSHIP_GRANT_FLAG,
  RELATIONSHIP_TYPES,
  TELEPORT_POLICIES
} from "../core/constants.js";
import { Logger } from "../core/logger.js";

export class RelationshipLifecycleTestSuite {
  #relationships;
  #lifecycle;

  constructor({ relationships, lifecycle }) {
    this.#relationships = relationships;
    this.#lifecycle = lifecycle;
  }

  async runLiveTest({ notify = true } = {}) {
    if (!game.user?.isGM) throw new Error("Run the AE5E relationship lifecycle test as a GM.");
    if (!canvas?.ready) throw new Error("An active Scene canvas is required.");

    const controlled = canvas.tokens.controlled.map((token) => token.document);
    if (controlled.length !== 2) throw new Error("Control exactly two tokens: leader first, follower second.");
    const [leader, follower] = controlled;
    if (!leader.actor || !follower.actor) throw new Error("Both controlled tokens must have Actors.");
    if (this.#relationships.involves(leader.uuid) || this.#relationships.involves(follower.uuid)) {
      throw new Error("The controlled tokens must not already be part of an AE5E relationship.");
    }

    const checks = [];
    const createdRelationshipIds = new Set();
    const createdTemplateIds = new Set();
    const createdEffectIds = new Set();
    const record = (name, passed, details = {}) => checks.push({ name, passed: Boolean(passed), ...details });
    const waitUntil = async (predicate, timeoutMs = 1500) => {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        if (await predicate()) return true;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return false;
    };

    const createTemplate = async () => {
      const [item] = await leader.actor.createEmbeddedDocuments("Item", [{ name: "AE5E Relationship Lifecycle Test — Release", type: "feat" }], {
        ae5eRelationshipLifecycleTest: true
      });
      if (!item) throw new Error("Failed to create temporary lifecycle test Item template.");
      createdTemplateIds.add(item.id);
      return item;
    };

    const createSourceEffect = async () => {
      const [effect] = await follower.actor.createEmbeddedDocuments("ActiveEffect", [{ name: "AE5E Relationship Lifecycle Test — Source" }], {
        ae5eRelationshipLifecycleTest: true
      });
      if (!effect) throw new Error("Failed to create temporary lifecycle test ActiveEffect.");
      createdEffectIds.add(effect.id);
      return effect;
    };

    const createRelationship = async (sourceEffect, template) => {
      const relationship = await this.#relationships.create({
        type: RELATIONSHIP_TYPES.TEST,
        attachmentMode: ATTACHMENT_MODES.GRAPPLE_FOLLOWER,
        leaderUuid: leader.uuid,
        followerUuid: follower.uuid,
        followerCanSelfMove: false,
        followElevation: true,
        followRotation: false,
        teleportPolicy: TELEPORT_POLICIES.DETACH,
        collisionPolicy: COLLISION_POLICIES.STOP_GROUP,
        sourceUuid: sourceEffect.uuid,
        lifecycle: {
          sourceEffect: {},
          participantItemGrants: [{
            participant: "leader",
            role: "release",
            templateUuid: template.uuid
          }]
        },
        metadata: {
          createdByTestHarness: true,
          relationshipLifecycleFixture: true
        }
      });
      createdRelationshipIds.add(relationship.id);
      return relationship;
    };

    try {
      const template = await createTemplate();

      const sourceOne = await createSourceEffect();
      const first = await createRelationship(sourceOne, template);
      const firstGrant = first.lifecycle?.participantItemGrants?.[0] ?? null;
      const firstGrantItem = firstGrant?.itemUuid ? await fromUuid(firstGrant.itemUuid) : null;
      const firstGrantFlag = firstGrantItem?.getFlag?.(MODULE_ID, RELATIONSHIP_GRANT_FLAG) ?? null;
      record("relationship persisted source-effect lifecycle", first.lifecycle?.sourceEffect?.removeRelationshipOnDelete === true
        && first.lifecycle?.sourceEffect?.deleteOnRelationshipRemove === true);
      record("leader participant Item grant created", Boolean(firstGrantItem)
        && firstGrant?.participant === "leader"
        && firstGrant?.role === "release"
        && firstGrantFlag?.relationshipId === first.id
        && firstGrantFlag?.sourceEffectUuid === sourceOne.uuid);

      const manualRemoved = await this.#relationships.remove(first.id);
      createdRelationshipIds.delete(first.id);
      const manualGrantGone = firstGrant?.itemUuid ? !(await fromUuid(firstGrant.itemUuid)) : false;
      const manualEffectGone = !(await fromUuid(sourceOne.uuid));
      createdEffectIds.delete(sourceOne.id);
      record("relationship removal cleans participant grant", manualRemoved === true && manualGrantGone);
      record("relationship removal cleans linked source effect", manualRemoved === true && manualEffectGone);

      const sourceTwo = await createSourceEffect();
      const second = await createRelationship(sourceTwo, template);
      const secondGrantUuid = second.lifecycle?.participantItemGrants?.[0]?.itemUuid ?? null;
      await follower.actor.deleteEmbeddedDocuments("ActiveEffect", [sourceTwo.id], {
        ae5eRelationshipLifecycleTest: true
      });
      createdEffectIds.delete(sourceTwo.id);
      const relationshipGone = await waitUntil(() => this.#relationships.get(second.id) === null);
      if (relationshipGone) createdRelationshipIds.delete(second.id);
      const grantGone = await waitUntil(async () => !secondGrantUuid || !(await fromUuid(secondGrantUuid)));
      record("source effect deletion removes relationship", relationshipGone);
      record("source effect deletion cleans participant grant", grantGone);

      const stats = this.#lifecycle.getStats();
      record("lifecycle hook registered", stats.initialized === true && stats.deleteActiveEffectHookRegistered === true, { stats });
    } catch (error) {
      record("test execution", false, { error: error?.message ?? String(error) });
    } finally {
      for (const id of [...createdRelationshipIds]) {
        try { await this.#relationships.remove(id); } catch { /* cleanup best effort */ }
      }
      const remainingEffects = [...createdEffectIds].filter((id) => follower.actor.effects?.get?.(id));
      if (remainingEffects.length) {
        try { await follower.actor.deleteEmbeddedDocuments("ActiveEffect", remainingEffects, { ae5eRelationshipLifecycleTestCleanup: true }); } catch { /* best effort */ }
      }
      const remainingTemplates = [...createdTemplateIds].filter((id) => leader.actor.items?.get?.(id));
      if (remainingTemplates.length) {
        try { await leader.actor.deleteEmbeddedDocuments("Item", remainingTemplates, { ae5eRelationshipLifecycleTestCleanup: true }); } catch { /* best effort */ }
      }
    }

    const passed = checks.every((check) => check.passed);
    const result = { passed, checks, lifecycle: this.#lifecycle.getStats() };
    Logger.info("AE5E relationship lifecycle grant test", result);
    console.log(
      `%cAE5E 0.4.1.16 — RELATIONSHIP LIFECYCLE GRANTS — ${passed ? "PASS" : "FAIL"}`,
      `color:${passed ? "#5cff8d" : "#ff5c5c"};font-size:18px;font-weight:bold;`
    );
    if (notify) {
      ui?.notifications?.[passed ? "info" : "error"]?.(
        passed
          ? "AE5E relationship lifecycle grants: PASS"
          : "AE5E relationship lifecycle grants: FAIL — see console."
      );
    }
    return result;
  }
}
