import {
  MODULE_ID,
  ONGOING_ACTION_EFFECT_FLAG,
  ONGOING_ACTION_ITEM_FLAG,
  ONGOING_ACTION_TIMINGS,
  ONGOING_ACTION_PROMPT_TIMEOUT_MS,
  SELECTION_INDICATOR_ROLES
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
      mandatory: false,
      indicatorRole: SELECTION_INDICATOR_ROLES.RESPONDER,
      suppressPromptWhenUnusable: true
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
    record("Responder indicator role is accepted", this.#service.validateConfig(optional).valid === true && optional.indicatorRole === "responder", optional);
    record("Unknown indicator role is rejected", this.#service.validateConfig({ ...mandatory, indicatorRole: "purple" }).reason === "invalid-indicator-role");
    record("Non-boolean unusable-prompt suppression is rejected", this.#service.validateConfig({ ...mandatory, suppressPromptWhenUnusable: "yes" }).reason === "invalid-suppress-prompt-when-unusable");

    const unusableItem = {
      actor: { system: {} },
      system: { activities: new Map([["escape", { id: "escape", uuid: "Synthetic.Activity.escape", canUse: false, activation: { type: "action", value: 1 } }]]) }
    };
    const unusable = this.#service.getActivityUsability(unusableItem, "escape");
    record("Activity canUse=false is recognized as unusable", unusable.usable === false && unusable.reason === "activity-can-use-false", unusable);

    const suppressedPrompt = await this.#service.promptForEffect({
      uuid: "Synthetic.ActiveEffect.escape",
      parent: { uuid: "Synthetic.Actor.escape" },
      flags: { [MODULE_ID]: { [ONGOING_ACTION_EFFECT_FLAG]: { ...optional, activityIdentifier: "escape" } } }
    }, { ...unusableItem, uuid: "Synthetic.Item.escape", name: "Synthetic Escape" });
    record(
      "Configured unusable Activity suppresses optional prompt before routing",
      suppressedPrompt?.prompted === false && suppressedPrompt?.suppressed === true && suppressedPrompt?.reason === "activity-unusable",
      suppressedPrompt
    );

    const actionActivationConfig = globalThis.CONFIG?.DND5E?.activityActivationTypes?.action ?? null;
    const actionResourceProperty = actionActivationConfig?.consume?.property ?? null;
    let actionResourceUsability = null;
    const actorSystem = {};
    if (actionResourceProperty) {
      const path = String(actionResourceProperty).split(".");
      let current = actorSystem;
      for (const part of path.slice(0, -1)) current = current[part] ??= {};
      current[path.at(-1)] = { value: 0 };
    }
    const noActionItem = {
      actor: { system: actorSystem, statuses: new Set() },
      system: { activities: new Map([["escape", { id: "escape", uuid: "Synthetic.Activity.action", canUse: true, activation: { type: "action", value: 1 } }]]) }
    };
    actionResourceUsability = this.#service.getActivityUsability(noActionItem, "escape");
    const actionResourceBehaviorPass = actionResourceProperty
      ? actionResourceUsability?.usable === false && actionResourceUsability?.reason === "activation-resource-unavailable"
      : actionResourceUsability?.usable === true && actionResourceUsability?.activationResource === null;
    record("D&D5e Action-resource usability follows the live system activation schema", actionResourceBehaviorPass, { actionActivationConfig, actionResourceProperty, actionResourceUsability });

    const incapacitatedActionItem = {
      actor: { system: {}, statuses: new Set(["incapacitated"]) },
      system: { activities: new Map([["escape", { id: "escape", uuid: "Synthetic.Activity.incapacitated", canUse: true, activation: { type: "action", value: 1 } }]]) }
    };
    const incapacitatedUsability = this.#service.getActivityUsability(incapacitatedActionItem, "escape");
    record("Incapacitated actor suppresses Standard-action Activity usability", incapacitatedUsability?.usable === false && incapacitatedUsability?.reason === "actor-incapacitated", incapacitatedUsability);

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
    console.log(`%cAE5E 0.4.1.6 — ONGOING EFFECT FOUNDATION — ${passed ? "PASS" : "FAIL"}`, `font-size:24px;font-weight:bold;color:${passed ? "#5cff8d" : "#ff5c5c"};`);
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
    console.log(`%cAE5E 0.4.1.6 — ONGOING EFFECT LIVE LIFECYCLE — ${passed ? "PASS" : "FAIL"}`, `font-size:24px;font-weight:bold;color:${passed ? "#5cff8d" : "#ff5c5c"};`);
    console.table(checks.map(check => ({ Check: check.name, Result: check.passed ? "PASS" : "FAIL" })));
    console.log(result);
    if (notify) ui?.notifications?.[passed ? "info" : "error"]?.(`AE5E ongoing-effect lifecycle ${passed ? "PASSED" : "FAILED"}. See console.`);
    return result;
  }

  async runLiveMandatorySaveExecutionTest({ actor = null, notify = true, forceSuccess = false } = {}) {
    if (!game.user?.isGM) throw new Error("Run the ongoing-effect mandatory-save execution test as a GM.");
    actor ??= canvas?.tokens?.controlled?.[0]?.actor ?? null;
    if (!actor) throw new Error("Control exactly one token or provide an Actor.");
    if ((canvas?.tokens?.controlled?.length ?? 0) > 1 && !arguments?.[0]?.actor) throw new Error("Control exactly one token for this test.");

    const checks = [];
    const record = (name, passed, details = null) => checks.push({ name, passed: Boolean(passed), details });
    const pack = game.packs.get(`${MODULE_ID}.ae5e-administrative`);
    if (!pack) throw new Error("AE5E Administrative compendium is unavailable.");

    const originalLocked = Boolean(pack.locked ?? pack.metadata?.locked);
    let template = null;
    let effect = null;
    let grantItem = null;
    let execution = null;
    let workflowResult = null;
    let source = null;

    const activitiesFrom = item => {
      const activities = item?.system?.activities;
      if (!activities) return [];
      if (typeof activities.values === "function") return [...activities.values()];
      if (Array.isArray(activities)) return activities;
      return Object.values(activities);
    };
    const activityType = activity => String(activity?.type ?? activity?.constructor?.type ?? activity?.constructor?.name ?? "").toLowerCase();
    const findSaveActivity = item => activitiesFrom(item).find(activity => activityType(activity).includes("save")) ?? null;

    const findSource = async () => {
      const preferred = [
        ["dnd5e.spells24", ["Hold Person", "Command", "Bane"]],
        ["dnd5e.spells", ["Hold Person", "Command", "Bane"]],
        ["dnd-players-handbook.spells", ["Hold Person", "Command", "Bane"]],
        [`${MODULE_ID}.spells-level-3`, ["Fireball"]]
      ];
      for (const [collection, names] of preferred) {
        const candidatePack = game.packs.get(collection);
        if (!candidatePack) continue;
        const index = await candidatePack.getIndex();
        for (const name of names) {
          const hit = [...index].find(entry => String(entry.name ?? "").toLowerCase() === name.toLowerCase());
          if (!hit?._id) continue;
          const item = await candidatePack.getDocument(hit._id);
          const activity = findSaveActivity(item);
          if (item && activity) return { item, activity, collection };
        }
      }
      return null;
    };

    const sanitizeTemplateData = (item, saveActivity) => {
      const data = foundry.utils.deepClone(item.toObject());
      delete data._id;
      data.name = "AE5E TEST — Mandatory Repeat Save";
      data.flags ??= {};
      data.flags[MODULE_ID] = { testFixture: true };
      const activityId = saveActivity?.id ?? saveActivity?._id ?? null;
      const rawActivities = data.system?.activities;
      if (rawActivities && !Array.isArray(rawActivities) && typeof rawActivities === "object") {
        for (const [id, raw] of Object.entries(rawActivities)) {
          if (activityId && id !== activityId) { delete rawActivities[id]; continue; }
          raw.name = "Repeat Saving Throw";
          raw.effects = [];
          if (raw.damage?.parts) raw.damage.parts = [];
          if (raw.healing?.parts) raw.healing.parts = [];
          if (raw.consumption?.targets) raw.consumption.targets = [];
          if (typeof raw.consumption?.spellSlot === "boolean") raw.consumption.spellSlot = false;
        }
      }
      return data;
    };

    try {
      source = await findSource();
      record("A live D&D5e Save Activity fixture is available", Boolean(source?.item && source?.activity), { sourceItem: source?.item?.uuid ?? null, activity: source?.activity?.uuid ?? source?.activity?.id ?? null, pack: source?.collection ?? null });
      if (!source) throw new Error("No suitable Save Activity source could be found for the live execution test.");

      if (typeof pack.configure === "function" && originalLocked) await pack.configure({ locked: false });
      const templateData = sanitizeTemplateData(source.item, source.activity);
      template = await Item.create(templateData, { pack: pack.collection, renderSheet: false });
      record("Temporary dedicated template was created in AE5E Administrative", Boolean(template?.uuid?.startsWith(`Compendium.${MODULE_ID}.ae5e-administrative.Item.`)), { templateUuid: template?.uuid ?? null });
      const templateSave = findSaveActivity(template);
      record("Administrative test template retains exactly one Save Activity", activitiesFrom(template).length === 1 && Boolean(templateSave), { activities: activitiesFrom(template).map(a => ({ id: a.id, type: activityType(a), name: a.name })) });

      const expectedSaveDC = forceSuccess ? -100 : 13;
      const fakeCastData = { baseLevel: 2, castLevel: 2, saveDC: expectedSaveDC };
      const [createdEffect] = await actor.createEmbeddedDocuments("ActiveEffect", [{
        name: "AE5E TEST — Mandatory Save Parent",
        img: template.img,
        flags: {
          cat: { castData: fakeCastData },
          [MODULE_ID]: { [ONGOING_ACTION_EFFECT_FLAG]: {
            enabled: true,
            templateUuid: template.uuid,
            timing: ONGOING_ACTION_TIMINGS.TURN_END,
            mandatory: true,
            removeEffectOnSuccess: true
          } }
        }
      }]);
      effect = createdEffect;
      await new Promise(resolve => setTimeout(resolve, 300));
      effect = actor.effects.get(createdEffect.id) ?? createdEffect;
      const effectConfig = this.#service.getEffectConfig(effect);
      grantItem = effectConfig?.grantedItemUuid ? await fromUuid(effectConfig.grantedItemUuid) : null;
      record("Mandatory parent effect grants the Administrative save Item", Boolean(grantItem), { effectUuid: effect.uuid, itemUuid: grantItem?.uuid ?? null });
      const grantConfig = this.#service.getGrantConfig(grantItem);
      record("Granted save Item is linked to the exact parent effect", grantConfig?.sourceEffectUuid === effect.uuid, grantConfig);
      record("Saved cast data is copied onto the granted Item", Number(grantConfig?.savedCastData?.saveDC) === expectedSaveDC, grantConfig?.savedCastData ?? null);

      const grantedSave = findSaveActivity(grantItem);
      record("Granted Item exposes a Save Activity", Boolean(grantedSave), { activities: activitiesFrom(grantItem).map(a => ({ id: a.id, type: activityType(a), name: a.name })) });
      const catStatus = this.#catSpell.getStatus();
      record("CAT completeActivityUse is available for live execution", catStatus.active === true && catStatus.capabilities?.completeActivityUse === true, catStatus);

      console.log(`%cAE5E TEST — perform the saving throw when Midi/D&D5e prompts.${forceSuccess ? " This success-branch fixture uses DC -100 so the live save must succeed." : " The test accepts either a success or failure; it is characterizing workflow outcome and cleanup."}`, "font-size:16px;font-weight:bold;color:#18cc46;");
      execution = await this.#service.executeGrantedItem(grantItem, effect, { claimKey: `ae5e-test-save:${foundry.utils.randomID()}` });
      record("Granted save Activity executes through CAT", execution?.executed === true && execution?.via === "cat", { executed: execution?.executed, via: execution?.via });

      const workflow = execution?.workflow ?? null;
      const snapshot = {
        workflowId: workflow?.id ?? workflow?.uuid ?? null,
        itemUuid: workflow?.item?.uuid ?? null,
        activityUuid: workflow?.activity?.uuid ?? workflow?.activity?.id ?? null,
        saves: [...(workflow?.saves ?? [])].map(value => value?.actor?.uuid ?? value?.uuid ?? value?.id ?? String(value)),
        failedSaves: [...(workflow?.failedSaves ?? [])].map(value => value?.actor?.uuid ?? value?.uuid ?? value?.id ?? String(value)),
        saveDC: workflow?.saveDC ?? null
      };
      record("CAT returned a live Midi workflow", Boolean(workflow), snapshot);
      record("Live Midi workflow uses the ActiveEffect saved save DC", Number(snapshot.saveDC) === expectedSaveDC, { expectedSaveDC, actualSaveDC: snapshot.saveDC });
      workflowResult = workflow ? await this.#service.processWorkflowResult(workflow) : null;
      const determined = workflowResult?.handled === true && typeof workflowResult?.success === "boolean";
      record("AE5E can determine save success/failure from the live workflow", determined, { workflowResult, snapshot });

      await new Promise(resolve => setTimeout(resolve, 300));
      const effectStillExists = Boolean(actor.effects.get(createdEffect.id));
      const grantStillExists = Boolean(grantItem && actor.items.get(grantItem.id));
      if (forceSuccess) record("Success-branch fixture resolves as a successful save", determined && workflowResult?.success === true, { workflowResult, snapshot });
      if (determined && workflowResult.success) {
        record("Successful save removes parent effect", effectStillExists === false, { effectStillExists });
        record("Successful save cleanup removes granted Item", grantStillExists === false, { grantStillExists });
      } else if (determined) {
        record("Failed save preserves parent effect", effectStillExists === true, { effectStillExists });
        record("Failed save preserves granted Item for the next turn", grantStillExists === true, { grantStillExists });
      }
    } finally {
      if (effect?.id && actor.effects.get(effect.id)) await actor.deleteEmbeddedDocuments("ActiveEffect", [effect.id]).catch(() => {});
      // Parent-effect deletion owns child cleanup. Let that hook settle before any
      // best-effort leftover deletion so socket races cannot emit a false error.
      await new Promise(resolve => setTimeout(resolve, 150));
      if (grantItem?.id && actor.items.get(grantItem.id)) await actor.deleteEmbeddedDocuments("Item", [grantItem.id]).catch(() => {});
      if (template?.id) {
        try {
          const liveTemplate = await pack.getDocument(template.id);
          if (liveTemplate) await liveTemplate.delete();
        } catch { /* cleanup best effort */ }
      }
      if (typeof pack.configure === "function" && originalLocked) await pack.configure({ locked: true }).catch(() => {});
    }

    const passed = checks.every(check => check.passed);
    const result = { passed, checks, actorUuid: actor.uuid, sourceItemUuid: source?.item?.uuid ?? null, workflowResult };
    console.log(`%cAE5E 0.4.1.6 — ONGOING EFFECT LIVE MANDATORY SAVE — ${passed ? "PASS" : "FAIL"}`, `font-size:24px;font-weight:bold;color:${passed ? "#5cff8d" : "#ff5c5c"};`);
    console.table(checks.map(check => ({ Check: check.name, Result: check.passed ? "PASS" : "FAIL" })));
    console.log(result);
    if (notify) ui?.notifications?.[passed ? "info" : "error"]?.(`AE5E mandatory-save execution ${passed ? "PASSED" : "FAILED"}. See console.`);
    return result;
  }

}
