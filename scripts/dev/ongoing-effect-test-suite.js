import {
  MODULE_ID,
  ONGOING_ACTION_EFFECT_FLAG,
  ONGOING_ACTION_ITEM_FLAG,
  ONGOING_ACTION_TIMINGS,
  ONGOING_ACTION_PROMPT_TIMEOUT_MS
} from "../core/constants.js";

export class OngoingEffectTestSuite {
  #service;
  #catSpell;

  constructor({ service, catSpell }) {
    this.#service = service;
    this.#catSpell = catSpell;
  }

  async runFoundationTest({ notify = true } = {}) {
    const checks = [];
    const record = (name, passed, details = null) => checks.push({ name, passed: Boolean(passed), details });
    const stats = this.#service.getStats();
    const mandatory = {
      enabled: true,
      templateUuid: "Compendium.action-effects-5e.ae5e-administrative.Item.AE5ETestTemplate",
      timing: ONGOING_ACTION_TIMINGS.TURN_END,
      mandatory: true,
      removeEffectOnSuccess: true
    };
    const optional = {
      enabled: true,
      templateUuid: "Compendium.action-effects-5e.ae5e-administrative.Item.AE5ETestEscape",
      timing: ONGOING_ACTION_TIMINGS.TURN_START,
      mandatory: false
    };

    record("Ongoing-effect service initialized", stats.initialized === true, stats);
    record("ActiveEffect creation hook registered", stats.hooks.includes("createActiveEffect"), stats.hooks);
    record("ActiveEffect deletion hook registered", stats.hooks.includes("deleteActiveEffect"), stats.hooks);
    record("Combat transition hook registered", stats.hooks.includes("updateCombat"), stats.hooks);
    record("Combat-start hook registered", stats.hooks.includes("combatStart"), stats.hooks);
    record("Combat-end/delete hook registered", stats.hooks.includes("deleteCombat"), stats.hooks);
    record("Midi RollComplete result hook registered", stats.hooks.includes("midi-qol.RollComplete"), stats.hooks);
    record("Midi postRollFinished result hook registered", stats.hooks.includes("midi-qol.premades.postRollFinished"), stats.hooks);
    record("Turn-start timing is canonical", ONGOING_ACTION_TIMINGS.TURN_START === "turnStart", ONGOING_ACTION_TIMINGS);
    record("Turn-end timing is canonical", ONGOING_ACTION_TIMINGS.TURN_END === "turnEnd", ONGOING_ACTION_TIMINGS);
    record("Mandatory timeout is exactly 10 seconds", ONGOING_ACTION_PROMPT_TIMEOUT_MS === 10_000, ONGOING_ACTION_PROMPT_TIMEOUT_MS);
    record("Mandatory config validates", this.#service.validateConfig(mandatory).valid === true, this.#service.validateConfig(mandatory));
    record("Optional escape config validates", this.#service.validateConfig(optional).valid === true, this.#service.validateConfig(optional));
    record("Non-compendium template UUID is rejected", this.#service.validateConfig({ ...mandatory, templateUuid: "Actor.bad.Item.bad" }).reason === "invalid-template-uuid");
    record("Unknown timing is rejected", this.#service.validateConfig({ ...mandatory, timing: "worldTime" }).reason === "invalid-timing");

    const effect = {
      flags: { [MODULE_ID]: { [ONGOING_ACTION_EFFECT_FLAG]: mandatory } }
    };
    const parsed = this.#service.getEffectConfig(effect);
    record("Effect config is read from AE5E flag", parsed?.templateUuid === mandatory.templateUuid && parsed?.mandatory === true, parsed);

    const item = {
      flags: { [MODULE_ID]: { [ONGOING_ACTION_ITEM_FLAG]: {
        sourceEffectUuid: "Actor.a.ActiveEffect.e",
        templateUuid: mandatory.templateUuid,
        removeEffectOnSuccess: true
      } } }
    };
    const grant = this.#service.getGrantConfig(item);
    record("Granted Item carries parent ActiveEffect UUID", grant?.sourceEffectUuid === "Actor.a.ActiveEffect.e", grant);
    record("Granted Item preserves template UUID", grant?.templateUuid === mandatory.templateUuid, grant);
    record("Granted Item records success cleanup policy", grant?.removeEffectOnSuccess === true, grant);

    const catStatus = this.#catSpell.getStatus();
    record("CAT adapter reports Activity execution capability", Boolean(catStatus.capabilities?.completeActivityUse) === Boolean(catStatus.active && catStatus.capabilities?.completeActivityUse), catStatus);
    record("CAT adapter exposes saved-cast-data capability field", "getSavedCastData" in catStatus.capabilities, catStatus);

    const manifestPack = game?.modules?.get(MODULE_ID)?.packs?.find?.(pack => pack.name === "ae5e-administrative")
      ?? game?.packs?.get?.(`${MODULE_ID}.ae5e-administrative`)
      ?? null;
    if (manifestPack) {
      record("AE5E Administrative compendium exists", true, { collection: manifestPack.collection ?? manifestPack.metadata?.id ?? null });
      const ownership = manifestPack.metadata?.ownership ?? manifestPack.ownership ?? {};
      const none = value => value === "NONE" || value === 0 || value === CONST?.DOCUMENT_OWNERSHIP_LEVELS?.NONE;
      const owner = value => value === "OWNER" || value === 3 || value === CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER;
      const gmOnly = none(ownership.PLAYER) && none(ownership.TRUSTED) && owner(ownership.ASSISTANT);
      record("AE5E Administrative compendium is hidden from players", gmOnly, { ownership });
    } else {
      record("AE5E Administrative compendium exists", false, "Pack was not found in the live module.");
      record("AE5E Administrative compendium is GM-only/private", false, "Pack was not found in the live module.");
    }

    const passed = checks.every(check => check.passed);
    const result = { passed, checks, stats: this.#service.getStats(), cat: catStatus };
    console.log(`%cAE5E 0.4.1.3 — ONGOING EFFECT FOUNDATION — ${passed ? "PASS" : "FAIL"}`, `font-size:24px;font-weight:bold;color:${passed ? "#5cff8d" : "#ff5c5c"};`);
    console.table(checks.map(check => ({ Check: check.name, Result: check.passed ? "PASS" : "FAIL" })));
    console.log(result);
    if (notify) ui?.notifications?.[passed ? "info" : "error"]?.(`AE5E ongoing-effect foundation ${passed ? "PASSED" : "FAILED"}. See console.`);
    return result;
  }

  async runLiveLifecycleTest({ templateUuid = null, actor = null, notify = true } = {}) {
    if (!game.user?.isGM) throw new Error("Run the ongoing-effect live lifecycle test as a GM.");
    actor ??= canvas?.tokens?.controlled?.[0]?.actor ?? null;
    if (!actor) throw new Error("Control one token or provide an Actor.");

    let template = templateUuid ? await fromUuid(templateUuid) : null;
    if (!template) {
      const candidatePacks = [
        `${MODULE_ID}.ae5e-administrative`,
        `${MODULE_ID}.spells-level-3`,
        `${MODULE_ID}.spells-level-1`,
        `${MODULE_ID}.spells-cantrips`
      ];
      for (const collection of candidatePacks) {
        const pack = game.packs.get(collection);
        if (!pack) continue;
        const index = await pack.getIndex();
        const first = [...index][0];
        if (!first?._id) continue;
        template = await pack.getDocument(first._id);
        if (template) break;
      }
    }
    if (!template || template.documentName !== "Item") {
      throw new Error("No AE5E compendium Item is available for the lifecycle fixture. Provide templateUuid explicitly.");
    }
    templateUuid = template.uuid;

    const checks = [];
    const record = (name, passed, details = null) => checks.push({ name, passed: Boolean(passed), details });
    const beforeItemIds = new Set((actor.items ?? []).map(item => item.id));
    const createdEffectIds = new Set();
    const createdItemIds = new Set();
    const createFixtureEffect = async name => {
      const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [{
        name,
        img: template.img,
        flags: { [MODULE_ID]: { [ONGOING_ACTION_EFFECT_FLAG]: {
          enabled: true,
          templateUuid,
          timing: ONGOING_ACTION_TIMINGS.TURN_END,
          mandatory: true,
          removeEffectOnSuccess: true
        } } }
      }]);
      createdEffectIds.add(effect.id);
      await new Promise(resolve => setTimeout(resolve, 250));
      const liveEffect = actor.effects.get(effect.id);
      const config = this.#service.getEffectConfig(liveEffect);
      const item = config?.grantedItemUuid ? await fromUuid(config.grantedItemUuid) : null;
      if (item) createdItemIds.add(item.id);
      return { effect: liveEffect, item, config };
    };

    try {
      const a = await createFixtureEffect("AE5E Ongoing Effect Test A");
      record("Effect creation grants a cloned Item", Boolean(a.item), { effectUuid: a.effect?.uuid, grantedItemUuid: a.item?.uuid });
      const grantA = this.#service.getGrantConfig(a.item);
      record("Clone points to the exact parent ActiveEffect", grantA?.sourceEffectUuid === a.effect?.uuid, grantA);
      record("Clone records the exact compendium template UUID", grantA?.templateUuid === templateUuid, grantA);
      record("ActiveEffect points back to its granted Item", a.config?.grantedItemUuid === a.item?.uuid, a.config);
      record("Clone did not replace any pre-existing Actor Item", [...beforeItemIds].every(id => actor.items.get(id)), { beforeItemCount: beforeItemIds.size });

      const b = await createFixtureEffect("AE5E Ongoing Effect Test B");
      record("Second effect using the same template receives a distinct Item instance", Boolean(b.item) && b.item.id !== a.item?.id, { first: a.item?.uuid, second: b.item?.uuid });
      record("Second clone points only to its own ActiveEffect", this.#service.getGrantConfig(b.item)?.sourceEffectUuid === b.effect?.uuid, this.#service.getGrantConfig(b.item));

      await actor.deleteEmbeddedDocuments("ActiveEffect", [a.effect.id]);
      createdEffectIds.delete(a.effect.id);
      await new Promise(resolve => setTimeout(resolve, 250));
      record("Deleting first parent removes only first granted Item", !actor.items.get(a.item.id) && Boolean(actor.items.get(b.item.id)), { firstItemExists: Boolean(actor.items.get(a.item.id)), secondItemExists: Boolean(actor.items.get(b.item.id)) });
      createdItemIds.delete(a.item.id);

      await actor.deleteEmbeddedDocuments("Item", [b.item.id]);
      createdItemIds.delete(b.item.id);
      const missingBefore = this.#service.getEffectConfig(actor.effects.get(b.effect.id))?.grantedItemUuid;
      record("Manual child deletion leaves parent ActiveEffect intact", Boolean(actor.effects.get(b.effect.id)) && !actor.items.get(b.item.id), { missingBefore });
      const reconciliation = await this.#service.reconcileActor(actor);
      await new Promise(resolve => setTimeout(resolve, 150));
      const bLive = actor.effects.get(b.effect.id);
      const bConfig = this.#service.getEffectConfig(bLive);
      const repairedItem = bConfig?.grantedItemUuid ? await fromUuid(bConfig.grantedItemUuid) : null;
      if (repairedItem) createdItemIds.add(repairedItem.id);
      record("Actor reconciliation recreates a missing granted Item", reconciliation.repaired >= 1 && Boolean(repairedItem), { reconciliation, grantedItemUuid: repairedItem?.uuid });
      record("Repaired Item preserves exact parent-effect linkage", this.#service.getGrantConfig(repairedItem)?.sourceEffectUuid === bLive?.uuid, this.#service.getGrantConfig(repairedItem));

      await actor.deleteEmbeddedDocuments("ActiveEffect", [b.effect.id]);
      createdEffectIds.delete(b.effect.id);
      await new Promise(resolve => setTimeout(resolve, 250));
      record("Deleting reconciled parent cleans the repaired Item", !actor.items.get(repairedItem?.id), { itemId: repairedItem?.id });
      if (repairedItem) createdItemIds.delete(repairedItem.id);
    } finally {
      const effectIds = [...createdEffectIds].filter(id => actor.effects.get(id));
      if (effectIds.length) await actor.deleteEmbeddedDocuments("ActiveEffect", effectIds).catch(() => {});
      const itemIds = [...createdItemIds].filter(id => actor.items.get(id));
      if (itemIds.length) await actor.deleteEmbeddedDocuments("Item", itemIds).catch(() => {});
      const leftovers = [...(actor.items ?? [])].filter(item => !beforeItemIds.has(item.id) && this.#service.getGrantConfig(item));
      if (leftovers.length) await actor.deleteEmbeddedDocuments("Item", leftovers.map(item => item.id)).catch(() => {});
    }
    const passed = checks.every(check => check.passed);
    const result = { passed, checks, actorUuid: actor.uuid, templateUuid };
    console.log(`%cAE5E 0.4.1.3 — ONGOING EFFECT LIVE LIFECYCLE — ${passed ? "PASS" : "FAIL"}`, `font-size:24px;font-weight:bold;color:${passed ? "#5cff8d" : "#ff5c5c"};`);
    console.table(checks.map(check => ({ Check: check.name, Result: check.passed ? "PASS" : "FAIL" })));
    console.log(result);
    if (notify) ui?.notifications?.[passed ? "info" : "error"]?.(`AE5E ongoing-effect lifecycle ${passed ? "PASSED" : "FAILED"}. See console.`);
    return result;
  }
}
