import {
  MODULE_ID,
  SME_MODIFIER_MODES,
  SME_PHASES,
  SME_WORKFLOW_STATE_PATH
} from "../core/constants.js";

function banner(text, color = "#18cc46", size = 20) {
  console.log(`%c${text}`, `font-size:${size}px;font-weight:bold;color:${color}`);
}

function fakeToken(uuid, name) {
  return { uuid, id: uuid.split(".").at(-1), name };
}

export class SpellModifierEngineTestSuite {
  #engine;
  #registry;
  #discovery;
  #events;
  #catSpell;

  constructor({ engine, registry, discovery, events, catSpell }) {
    this.#engine = engine;
    this.#registry = registry;
    this.#discovery = discovery;
    this.#events = events;
    this.#catSpell = catSpell;
  }

  async runFoundationTest({ notify = true } = {}) {
    const checks = [];
    const cleanup = [];
    const order = [];
    const rollbackOrder = [];
    const record = (name, passed, details = null) => {
      const entry = { name, passed: Boolean(passed), details };
      checks.push(entry);
      console.log(
        `%c${entry.passed ? "PASS" : "FAIL"}%c | ${name}`,
        `font-size:14px;font-weight:bold;color:${entry.passed ? "#18cc46" : "#ff5555"}`,
        "color:inherit",
        details ?? ""
      );
      return entry;
    };

    banner("AE5E 0.4.1 — SPELL MODIFIER ENGINE FOUNDATION", "#7ddcff", 26);

    const prefix = `${MODULE_ID}.sme-test.${foundry.utils.randomID(8)}`;
    const ids = {
      automatic: `${prefix}.automatic`,
      options: `${prefix}.options`,
      conflictA: `${prefix}.conflict-a`,
      conflictB: `${prefix}.conflict-b`,
      late: `${prefix}.late`
    };

    const makeRollback = label => async () => {
      rollbackOrder.push(label);
      return { label };
    };

    try {
      cleanup.push(this.#engine.registerModifier(ids.automatic, {
        label: "Automatic Test Modifier",
        phases: [SME_PHASES.PRE_TARGETING],
        mode: SME_MODIFIER_MODES.AUTOMATIC,
        priority: 100,
        eligibility: async ({ context }) => context.facts.damageTypes.includes("fire"),
        apply: async ({ context }) => {
          order.push("automatic");
          context.workflow._ae5eSmeAutomatic = true;
          return { applied: true, marker: "automatic", rollback: makeRollback("automatic") };
        }
      }));

      cleanup.push(this.#engine.registerModifier(ids.options, {
        label: "Option Test Modifier",
        phases: [SME_PHASES.PRE_TARGETING],
        mode: SME_MODIFIER_MODES.OPTIONAL,
        priority: 50,
        options: async () => [
          { id: "alpha", label: "Alpha", data: { value: "alpha" } },
          { id: "beta", label: "Beta", data: { value: "beta" } }
        ],
        apply: async ({ option }) => {
          order.push(`option:${option.id}`);
          return { applied: true, option: option.id, rollback: makeRollback(`option:${option.id}`) };
        }
      }));

      for (const [key, label] of [["conflictA", "Conflict A"], ["conflictB", "Conflict B"]]) {
        cleanup.push(this.#engine.registerModifier(ids[key], {
          label,
          phases: [SME_PHASES.PRE_TARGETING],
          mode: SME_MODIFIER_MODES.OPTIONAL,
          conflictGroup: "sme-test-exclusive",
          priority: key === "conflictA" ? 40 : 30,
          apply: async () => {
            order.push(key);
            return { applied: true, rollback: makeRollback(key) };
          }
        }));
      }

      cleanup.push(this.#engine.registerModifier(ids.late, {
        label: "Late Test Modifier",
        phases: [SME_PHASES.BEFORE_DAMAGE_ROLL],
        mode: SME_MODIFIER_MODES.AUTOMATIC,
        priority: 10,
        apply: async () => {
          order.push("late");
          return { applied: true, rollback: makeRollback("late") };
        }
      }));

      record("SME registry accepted five test handlers", ids && Object.values(ids).every(id => this.#registry.has(id)), this.#registry.getStats());
      record("SME exposes the seven semantic spell phases", Object.keys(SME_PHASES).length === 7, SME_PHASES);
      record("CAT spell utility adapter exposes capability diagnostics", Boolean(this.#catSpell.getStatus()?.capabilities), this.#catSpell.getStatus());

      const semanticDamageStatus = this.#catSpell.getStatus();
      record(
        "Damage-roll API distinguishes intentional reroll reconstruction from preserve-results retagging",
        typeof this.#catSpell.rebuildChangedDamageRoll === "function"
          && typeof this.#catSpell.retagDamageRollsPreservingResults === "function"
          && semanticDamageStatus.capabilities?.rebuildChangedDamageRoll === semanticDamageStatus.active
          && !("getChangedDamageRoll" in semanticDamageStatus.capabilities),
        semanticDamageStatus
      );

      const retagRollA = {
        formula: "1d8 + 2",
        total: 7,
        options: { type: "fire" },
        terms: [{ values: [5] }],
        evaluate: () => { throw new Error("Preserve-results retag must never evaluate an existing roll."); }
      };
      const retagRollB = {
        formula: "1d6",
        total: 4,
        options: { type: "fire" },
        terms: [{ values: [4] }],
        evaluate: () => { throw new Error("Preserve-results retag must never evaluate an existing roll."); }
      };
      const originalRetagRolls = [retagRollA, retagRollB];
      let retagCommitCalls = 0;
      let retagCommittedRolls = null;
      const retagWorkflow = {
        damageRolls: originalRetagRolls,
        setDamageRolls: async rolls => {
          retagCommitCalls += 1;
          retagCommittedRolls = rolls;
          retagWorkflow.damageRolls = rolls;
        }
      };
      const retagResult = await this.#catSpell.retagDamageRollsPreservingResults(retagWorkflow, "cold");
      record(
        "Preserve-results damage retag changes type without replacing, rerolling, or changing totals/formulas",
        retagResult.changed === true
          && retagResult.preserved === true
          && retagCommitCalls === 1
          && retagCommittedRolls === originalRetagRolls
          && retagWorkflow.damageRolls[0] === retagRollA
          && retagWorkflow.damageRolls[1] === retagRollB
          && retagRollA.total === 7
          && retagRollA.formula === "1d8 + 2"
          && retagRollA.options.type === "cold"
          && retagRollB.total === 4
          && retagRollB.formula === "1d6"
          && retagRollB.options.type === "cold",
        { retagResult, retagCommitCalls }
      );

      const target1 = fakeToken("Scene.test.Token.target1", "Target 1");
      const target2 = fakeToken("Scene.test.Token.target2", "Target 2");

      const featureItems = [
        { uuid: "Actor.test.Item.auto", name: "Automatic Feature", img: "icons/svg/aura.svg", flags: { [MODULE_ID]: { spellModifier: { enabled: true, handler: ids.automatic } } } },
        { uuid: "Actor.test.Item.options", name: "Options Feature", img: "icons/svg/d20-highlight.svg", flags: { [MODULE_ID]: { spellModifier: { enabled: true, handler: ids.options } } } },
        { uuid: "Actor.test.Item.conflictA", name: "Conflict Feature A", flags: { [MODULE_ID]: { spellModifier: { enabled: true, handler: ids.conflictA } } } },
        { uuid: "Actor.test.Item.conflictB", name: "Conflict Feature B", flags: { [MODULE_ID]: { spellModifier: { enabled: true, handler: ids.conflictB } } } },
        { uuid: "Actor.test.Item.late", name: "Late Feature", flags: { [MODULE_ID]: { spellModifier: { enabled: true, handler: ids.late } } } }
      ];

      const actor = {
        uuid: "Actor.ae5e-sme-test",
        id: "ae5e-sme-test",
        name: "SME Test Caster",
        img: "icons/svg/mystery-man.svg",
        items: featureItems,
        effects: [],
        system: { attributes: { spelldc: 15 } },
        testUserPermission: () => true
      };
      const spellItem = {
        uuid: "Actor.ae5e-sme-test.Item.spell",
        id: "spell",
        name: "SME Test Spell",
        type: "spell",
        actor,
        system: { level: 3 }
      };
      const activity = {
        uuid: "Actor.ae5e-sme-test.Item.spell.Activity.damage",
        id: "damage",
        name: "SME Test Damage",
        type: "save",
        item: spellItem,
        damage: { parts: [{ types: new Set(["fire"]) }] },
        save: { dc: { value: 15 } }
      };
      spellItem.system.activities = new Map([[activity.id, activity]]);
      const workflow = {
        userId: game.user.id,
        actor,
        token: null,
        item: spellItem,
        activity,
        castData: { baseLevel: 3, castLevel: 5, scaling: 2 },
        targets: new Set([target1, target2]),
        saves: new Set([target1]),
        failedSaves: new Set([target2]),
        hitTargets: new Set(),
        damageRolls: []
      };

      const discovered = await this.#engine.discover({ phase: SME_PHASES.PRE_TARGETING, workflow });
      record("Actor Item spellModifier flags discover all early modifier offers", discovered.length === 5, discovered.map(offer => ({ id: offer.id, modifierId: offer.modifierId, optionId: offer.optionId })));
      record("One modifier with two options becomes two mutually-exclusive offers", discovered.filter(offer => offer.modifierId === ids.options).length === 2 && new Set(discovered.filter(offer => offer.modifierId === ids.options).map(offer => offer.selectionGroup)).size === 1, discovered.filter(offer => offer.modifierId === ids.options));

      let chooserCalls = 0;
      const first = await this.#engine.processPhase(SME_PHASES.PRE_TARGETING, workflow, {
        eventKey: "foundation:preTargeting:1",
        chooser: async ({ offers }) => {
          chooserCalls += 1;
          return offers.map(offer => offer.id);
        }
      });

      record("Automatic modifier applied before optional choices", order[0] === "automatic" && workflow._ae5eSmeAutomatic === true, order);
      record("Optional opportunities were aggregated into one chooser call", chooserCalls === 1, { chooserCalls, offers: first.offers });
      record("Multi-option modifier accepted only one option from the same selection group", first.applied.filter(entry => entry.modifierId === ids.options).length === 1, first.applied);
      record("Explicit conflict group accepted only one conflicting modifier", first.applied.filter(entry => [ids.conflictA, ids.conflictB].includes(entry.modifierId)).length === 1, first.applied);
      record("Spell facts expose base level 3 and cast level 5", first.session && first.session.source.itemUuid === spellItem.uuid && this.#catSpell.buildFacts(workflow).baseLevel === 3 && this.#catSpell.buildFacts(workflow).castLevel === 5, this.#catSpell.buildFacts(workflow));
      record("Spell facts expose scaling level 2", this.#catSpell.buildFacts(workflow).scaling === 2, this.#catSpell.buildFacts(workflow));
      record("Spell facts preserve target/save/failed-save classification", this.#catSpell.buildFacts(workflow).targets.length === 2 && this.#catSpell.buildFacts(workflow).saves.length === 1 && this.#catSpell.buildFacts(workflow).failedSaves.length === 1, this.#catSpell.buildFacts(workflow));

      const duplicate = await this.#engine.processPhase(SME_PHASES.PRE_TARGETING, workflow, {
        eventKey: "foundation:preTargeting:1",
        chooser: async () => { chooserCalls += 1; return []; }
      });
      record("Duplicate normalized phase event is ignored", duplicate.duplicate === true && chooserCalls === 1, duplicate);

      const repeatPhase = await this.#engine.processPhase(SME_PHASES.PRE_TARGETING, workflow, {
        eventKey: "foundation:preTargeting:2",
        chooser: async () => { chooserCalls += 1; return []; }
      });
      record("oncePerCast prevents already-applied early modifiers from reappearing", repeatPhase.offers.length === 0, repeatPhase.offers);

      const late = await this.#engine.processPhase(SME_PHASES.BEFORE_DAMAGE_ROLL, workflow, {
        eventKey: "foundation:beforeDamage:1",
        chooser: async () => []
      });
      record("One per-cast session persists across later spell phases", late.sessionId === first.sessionId && late.applied.some(entry => entry.modifierId === ids.late), { first: first.sessionId, late: late.sessionId, applied: late.applied });
      record("Late automatic modifier ran after early phase applications", order.at(-1) === "late", order);

      const liveSession = this.#engine.getLiveSession(first.sessionId);
      const applicationCount = liveSession?.applications?.length ?? 0;
      record("Session recorded all successful modifier applications", applicationCount === 4, liveSession?.toJSON?.());

      const rollback = await this.#engine.rollbackSession(first.sessionId, { reason: "foundation-test" });
      record("Session rollback executed every registered rollback callback", rollback?.results?.length === applicationCount && rollback.results.every(entry => entry.rolledBack), rollback);
      record("Rollback executes in reverse application order", rollbackOrder.length === applicationCount && rollbackOrder[0] === "late" && rollbackOrder.at(-1) === "automatic", rollbackOrder);
      record("Rolled-back session moved into recent-session history", this.#engine.getRecentSessions().some(entry => entry.id === first.sessionId && entry.state === "rolledBack"), this.#engine.getRecentSessions().find(entry => entry.id === first.sessionId));

      const nonSpell = { actor, item: { ...spellItem, type: "feat", name: "Not a Spell" }, activity, userId: game.user.id };
      const ignored = await this.#engine.processPhase(SME_PHASES.PRE_TARGETING, nonSpell, { eventKey: "foundation:nonspell" });
      record("Non-spell workflows are ignored without creating modifier work", ignored.ignored === true && ignored.reason === "non-spell", ignored);

      const completeWorkflow = { ...workflow, castData: { ...workflow.castData } };
      const complete = await this.#engine.processPhase(SME_PHASES.WORKFLOW_COMPLETE, completeWorkflow, { eventKey: "foundation:complete" });
      record("Workflow-complete phase archives its SME session", complete.continue === true && this.#engine.getRecentSessions().some(entry => entry.id === complete.sessionId && entry.state === "complete"), { complete, recent: this.#engine.getRecentSessions().find(entry => entry.id === complete.sessionId) });

      const eventStats = this.#events.getStats();
      record("SME Midi event adapter is initialized with normalized lifecycle hooks", eventStats.initialized === true && eventStats.hooks.includes("midi-qol.preTargetingV2") && eventStats.hooks.includes("midi-qol.preDamageRoll") && eventStats.hooks.includes("midi-qol.preTargetDamageApplication"), eventStats);
    } catch (error) {
      record("Foundation test execution completed without exception", false, { message: error?.message ?? String(error), stack: error?.stack ?? null });
    } finally {
      for (const unregister of cleanup.reverse()) {
        try { unregister?.(); } catch { /* noop */ }
      }
    }

    record("Test modifier handlers cleaned up", Object.values(ids).every(id => !this.#registry.has(id)), this.#registry.getStats());

    const passed = checks.every(check => check.passed);
    const report = {
      result: passed ? "PASS" : "FAIL",
      version: game.modules.get(MODULE_ID)?.version ?? null,
      environment: {
        foundry: game.version,
        dnd5e: game.system.version,
        midiQol: game.modules.get("midi-qol")?.version ?? null,
        cat: game.modules.get("cat")?.version ?? null
      },
      summary: {
        passed: checks.filter(check => check.passed).length,
        failed: checks.filter(check => !check.passed).length,
        total: checks.length
      },
      checks,
      sme: this.#engine.getStats()
    };

    console.table(checks.map((check, index) => ({ "#": index + 1, Check: check.name, Result: check.passed ? "PASS" : "FAIL" })));
    banner(`AE5E 0.4.1 SME FOUNDATION — ${report.summary.passed}/${report.summary.total} ${passed ? "PASS" : "FAIL"}`, passed ? "#18cc46" : "#ff5555", 28);
    console.log("AE5E SME foundation full result", report);
    if (notify && ui?.notifications) {
      ui.notifications[passed ? "info" : "error"](
        passed
          ? `AE5E 0.4.1 SME foundation passed (${report.summary.passed}/${report.summary.total}).`
          : `AE5E 0.4.1 SME foundation FAILED (${report.summary.failed} failing checks). See console.`
      );
    }
    return report;
  }

  async runLiveActivitySubstitutionTest({ notify = true } = {}) {
    const checks = [];
    const record = (name, passed, details = null) => {
      const entry = { name, passed: Boolean(passed), details };
      checks.push(entry);
      console.log(
        `%c${entry.passed ? "PASS" : "FAIL"}%c | ${name}`,
        `font-size:14px;font-weight:bold;color:${entry.passed ? "#18cc46" : "#ff5555"}`,
        "color:inherit",
        details ?? ""
      );
      return entry;
    };

    banner("AE5E 0.4.1 — SME LIVE MIDI/CAT ACTIVITY SUBSTITUTION", "#7ddcff", 26);

    if (!globalThis.game?.user?.isGM) {
      throw new Error("The SME live activity-substitution test must be run from the GM client.");
    }
    if (!globalThis.canvas?.ready) {
      throw new Error("An active Scene canvas is required for the SME live activity-substitution test.");
    }

    const controlled = canvas.tokens.controlled ?? [];
    if (controlled.length !== 1) {
      throw new Error("Control exactly ONE caster token before running the SME live activity-substitution test.");
    }

    const realToken = controlled[0];
    const realActor = realToken.actor;
    if (!realActor) throw new Error("The controlled token has no Actor.");

    const catStatus = this.#catSpell.getStatus();
    const requiredCapabilities = [
      "setActivity",
      "getDamageModifiedActivityData",
      "setWorkflowProperty",
      "getWorkflowProperty",
      "syntheticItem",
      "completeActivityUse"
    ];
    record(
      "Required CAT spell mutation/execution capabilities are available",
      catStatus.active && requiredCapabilities.every(capability => catStatus.capabilities?.[capability] === true),
      catStatus
    );
    if (!checks.at(-1).passed) {
      return this.#liveReport(checks, { notify, details: { catStatus }, resultLabel: "SME LIVE MIDI/CAT" });
    }

    let templateItem = null;
    let templateActivity = null;
    for (const item of realActor.items ?? []) {
      if (item.type !== "spell") continue;
      for (const activity of item.system?.activities ?? []) {
        const parts = Array.from(activity?.damage?.parts ?? []);
        const hasTemplate = Boolean(activity?.target?.template?.type);
        if (activity.type === "damage" && parts.length > 0 && !hasTemplate) {
          templateItem = item;
          templateActivity = activity;
          break;
        }
      }
      if (templateActivity) break;
    }

    record(
      "Controlled caster provides a non-template damaging spell Activity as a read-only fixture template",
      Boolean(templateItem && templateActivity),
      { item: templateItem?.name ?? null, activity: templateActivity?.name ?? null, type: templateActivity?.type ?? null }
    );
    if (!templateActivity) {
      return this.#liveReport(checks, { notify, details: { catStatus }, resultLabel: "SME LIVE MIDI/CAT" });
    }

    const baseline = {
      hp: realActor.system?.attributes?.hp?.value ?? null,
      items: realActor.items?.size ?? Array.from(realActor.items ?? []).length,
      effects: realActor.effects?.size ?? Array.from(realActor.effects ?? []).length,
      spells: foundry.utils.deepClone(realActor.system?.spells ?? {})
    };
    const oldMessages = new Set(game.messages.map(message => message.id));

    const modifierId = `${MODULE_ID}.sme-live-test.${foundry.utils.randomID(10)}.transmute`;
    const observerId = `${MODULE_ID}.sme-live-test.${foundry.utils.randomID(10)}.observer`;
    const syntheticName = "AE5E SME Live Test — Synthetic Spell";
    const featureName = "AE5E SME Live Test — Modifier Source";
    const state = {
      transmuteApplications: 0,
      phases: [],
      preDamage: null,
      dndDamage: null,
      targetDamageHookCalls: 0,
      targetDamageHookTargetUuid: null,
      targetDamageHookHasDamageItem: false,
      workflowComplete: false
    };

    let sourceActor = null;
    let targetActor = null;
    let sourceTokenDoc = null;
    let targetTokenDoc = null;
    let featureItem = null;
    let syntheticItem = null;
    let syntheticActivity = null;
    let workflow = null;
    let unregisterTransmute = null;
    let unregisterObserver = null;
    const hookHandles = [];
    let executionError = null;

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const damageTypes = activity => {
      const out = [];
      for (const part of Array.from(activity?.damage?.parts ?? [])) {
        for (const type of Array.from(part?.types ?? [])) if (typeof type === "string") out.push(type);
      }
      return [...new Set(out)];
    };
    const rollSummary = rolls => (rolls ?? []).map(roll => ({
      class: roll?.constructor?.name ?? null,
      formula: roll?.formula ?? null,
      total: roll?.total ?? null,
      type: roll?.options?.type ?? null
    }));
    const getRolls = testWorkflow => Array.isArray(testWorkflow?.damageRolls) && testWorkflow.damageRolls.length
      ? [...testWorkflow.damageRolls]
      : testWorkflow?.damageRoll
        ? [testWorkflow.damageRoll]
        : [];
    const matchesWorkflow = testWorkflow => (
      testWorkflow?.item?.name === syntheticName
      && testWorkflow?.item?.actor?.id === sourceActor?.id
    );
    const matchesActivity = activity => (
      activity?.item?.name === syntheticName
      && activity?.item?.actor?.id === sourceActor?.id
    );

    try {
      unregisterTransmute = this.#engine.registerModifier(modifierId, {
        label: "SME Test: Fire → Cold",
        phases: [SME_PHASES.BEFORE_DAMAGE_ROLL],
        mode: SME_MODIFIER_MODES.AUTOMATIC,
        priority: 50_000,
        requiresCapabilities: ["setActivity", "getDamageModifiedActivityData"],
        eligibility: async ({ context }) => context.facts.damageTypes.includes("fire"),
        apply: async ({ context }) => {
          const current = context.activity;
          const coldData = context.getDamageModifiedActivityData(current, "1d6 + 2", {
            types: ["cold"],
            specificIndex: 0
          });
          coldData.damage.includeBase = false;
          coldData.damage.parts = [coldData.damage.parts[0]];
          coldData.name = "AE5E SME Live Test — Cold Damage";
          await context.setActivity(coldData);
          state.transmuteApplications += 1;
          state.phases.push({
            phase: context.phase,
            damageTypes: [...context.facts.damageTypes],
            afterDamageTypes: damageTypes(context.workflow.activity),
            sessionId: context.sessionId
          });
          return { applied: true, changedDamageType: "cold" };
        }
      });

      unregisterObserver = this.#engine.registerModifier(observerId, {
        label: "SME Test Lifecycle Observer",
        phases: [
          SME_PHASES.BEFORE_DAMAGE_ROLL,
          SME_PHASES.DAMAGE_ROLL_COMPLETE,
          SME_PHASES.BEFORE_DAMAGE_APPLICATION,
          SME_PHASES.WORKFLOW_COMPLETE
        ],
        mode: SME_MODIFIER_MODES.AUTOMATIC,
        priority: -50_000,
        oncePerCast: false,
        apply: async ({ context }) => {
          state.phases.push({
            phase: context.phase,
            damageTypes: [...context.facts.damageTypes],
            damageRolls: foundry.utils.deepClone(context.facts.damageRolls),
            targetTokenUuid: context.event.targetTokenUuid,
            hasDamageItem: context.event.hasDamageItem,
            damageItem: foundry.utils.deepClone(context.facts.damageItem),
            sessionId: context.sessionId
          });
          if (context.phase === SME_PHASES.WORKFLOW_COMPLETE) state.workflowComplete = true;
          return { applied: true, observed: true };
        }
      });

      sourceActor = await Actor.create({ name: "AE5E SME Live Test — Source", type: "character" }, { renderSheet: false });
      targetActor = await Actor.create({ name: "AE5E SME Live Test — Target", type: "character" }, { renderSheet: false });
      await sourceActor.update({ "system.attributes.hp.value": 100, "system.attributes.hp.max": 100 });
      await targetActor.update({ "system.attributes.hp.value": 100, "system.attributes.hp.max": 100 });
      record("Disposable SME source/target Actors created", Boolean(sourceActor && targetActor));

      [featureItem] = await sourceActor.createEmbeddedDocuments("Item", [{
        name: featureName,
        type: "feat",
        flags: {
          [MODULE_ID]: {
            spellModifier: [
              { enabled: true, handler: modifierId },
              { enabled: true, handler: observerId }
            ]
          }
        }
      }]);
      record("Disposable caster feature exposes declarative spellModifier registrations", Boolean(featureItem), this.#discovery.getRegistration(featureItem));

      const grid = Number(canvas.grid?.size ?? canvas.scene?.grid?.size ?? 100);
      const maxX = Math.max(0, Number(canvas.scene.width ?? grid) - grid);
      const maxY = Math.max(0, Number(canvas.scene.height ?? grid) - grid);
      const x = Math.max(0, Math.min(Number(realToken.document.x ?? 0), maxX));
      const y = Math.max(0, Math.min(Number(realToken.document.y ?? 0), maxY));
      let tx = Math.min(x + grid, maxX);
      let ty = y;
      if (tx === x) tx = Math.max(0, x - grid);
      if (tx === x) ty = Math.min(y + grid, maxY);

      [sourceTokenDoc, targetTokenDoc] = await canvas.scene.createEmbeddedDocuments("Token", [
        { name: "AE5E SME Live Test — Source", actorId: sourceActor.id, actorLink: true, hidden: true, x, y },
        { name: "AE5E SME Live Test — Target", actorId: targetActor.id, actorLink: true, hidden: true, x: tx, y: ty }
      ]);
      await sleep(200);
      record("Disposable hidden SME Tokens created", Boolean(sourceTokenDoc?.object && targetTokenDoc?.object));

      const fireData = this.#catSpell.getDamageModifiedActivityData(templateActivity, "1d6 + 2", {
        types: ["fire"],
        specificIndex: 0
      });
      fireData.damage.includeBase = false;
      fireData.damage.parts = [fireData.damage.parts[0]];
      fireData.name = "AE5E SME Live Test — Fire Damage";

      const itemData = templateItem.toObject();
      itemData._id = foundry.utils.randomID();
      itemData.name = syntheticName;
      itemData.effects = [];
      itemData.system.activities = { [fireData._id]: fireData };
      syntheticItem = this.#catSpell.syntheticItem(itemData, sourceActor);
      syntheticActivity = syntheticItem.system.activities.get(fireData._id);

      record("Synthetic spell created in memory and begins as fire", Boolean(syntheticActivity) && damageTypes(syntheticActivity).includes("fire"), {
        embeddedItems: sourceActor.items.size,
        damageTypes: damageTypes(syntheticActivity)
      });
      record("Synthetic spell itself was not embedded on the disposable Actor", sourceActor.items.size === 1 && sourceActor.items.get(featureItem.id) === featureItem, { itemCount: sourceActor.items.size });

      hookHandles.push(["midi-qol.preDamageRoll", Hooks.on("midi-qol.preDamageRoll", testWorkflow => {
        if (!matchesWorkflow(testWorkflow)) return;
        state.preDamage = {
          activityName: testWorkflow.activity?.name ?? null,
          activityTypes: damageTypes(testWorkflow.activity),
          existingRolls: rollSummary(getRolls(testWorkflow))
        };
      })]);

      hookHandles.push(["dnd5e.rollDamage", Hooks.on("dnd5e.rollDamage", (rolls, data) => {
        const subject = data?.subject;
        if (!matchesActivity(subject)) return;
        state.dndDamage = {
          subjectName: subject?.name ?? null,
          subjectTypes: damageTypes(subject),
          rolls: rollSummary(rolls)
        };
      })]);

      // This Midi hook is settings/outcome dependent. Capture whether Midi itself
      // invoked it; SME is required to mirror it only when the underlying hook runs.
      hookHandles.push(["midi-qol.preTargetDamageApplication", Hooks.on(
        "midi-qol.preTargetDamageApplication",
        (targetToken, data = {}) => {
          const testWorkflow = data?.workflow ?? null;
          if (!matchesWorkflow(testWorkflow)) return;
          state.targetDamageHookCalls += 1;
          state.targetDamageHookTargetUuid = targetToken?.document?.uuid ?? targetToken?.uuid ?? null;
          state.targetDamageHookHasDamageItem = Boolean(data?.damageItem ?? data?.ditem);
        }
      )]);

      workflow = await this.#catSpell.completeActivityUse(
        syntheticActivity,
        [targetTokenDoc],
        {
          userId: game.user.id,
          consumeUsage: false,
          consumeResources: false,
          spellSlot: false,
          fast: true,
          autoDamage: true,
          options: {
            configureDialog: false,
            workflowOptions: { autoRollDamage: "always", autoFastDamage: true }
          },
          dialog: { configure: false }
        }
      );
      await sleep(500);

      record("SME automatic Before Damage Roll modifier applied exactly once", state.transmuteApplications === 1, state);
      record("SME replaced the live workflow Activity with cold before damage roll", state.preDamage?.activityTypes?.includes("cold") === true && state.preDamage?.activityTypes?.includes("fire") !== true, state.preDamage);
      record("No evaluated damage roll existed yet at SME Before Damage Roll", (state.preDamage?.existingRolls?.length ?? -1) === 0, state.preDamage);
      record("Actual D&D5e damage-roll subject is cold", state.dndDamage?.subjectTypes?.includes("cold") === true && state.dndDamage?.subjectTypes?.includes("fire") !== true, state.dndDamage);
      record("Actual D&D5e damage roll is cold with no fire roll", (state.dndDamage?.rolls?.length ?? 0) > 0 && state.dndDamage.rolls.every(roll => roll.type === "cold"), state.dndDamage);

      const observedPhases = new Set(state.phases.map(entry => entry.phase));
      record("SME observed Before Damage Roll in the real Midi workflow", observedPhases.has(SME_PHASES.BEFORE_DAMAGE_ROLL), state.phases);
      record("SME observed Damage Roll Complete in the real Midi workflow", observedPhases.has(SME_PHASES.DAMAGE_ROLL_COMPLETE), state.phases);
      const beforeDamageApplicationEntries = state.phases.filter(entry => entry.phase === SME_PHASES.BEFORE_DAMAGE_APPLICATION);
      const underlyingTargetDamageHookFired = state.targetDamageHookCalls > 0;
      record(
        "SME Before Damage Application mirrors Midi when the underlying per-target hook is invoked",
        !underlyingTargetDamageHookFired || (
          observedPhases.has(SME_PHASES.BEFORE_DAMAGE_APPLICATION)
          && beforeDamageApplicationEntries.some(entry => entry.targetTokenUuid === targetTokenDoc.uuid)
          && beforeDamageApplicationEntries.some(entry => entry.hasDamageItem === state.targetDamageHookHasDamageItem)
        ),
        {
          deferred: !underlyingTargetDamageHookFired,
          reason: !underlyingTargetDamageHookFired
            ? "Midi did not invoke the settings/outcome-dependent preTargetDamageApplication hook during this synthetic workflow."
            : null,
          midiHookCalls: state.targetDamageHookCalls,
          midiTargetTokenUuid: state.targetDamageHookTargetUuid,
          midiHasDamageItem: state.targetDamageHookHasDamageItem,
          smeEntries: beforeDamageApplicationEntries
        }
      );
      record("SME observed and archived Workflow Complete", state.workflowComplete === true, state.phases);

      const workflowMirror = this.#catSpell.tryGetWorkflowProperty(
        workflow,
        SME_WORKFLOW_STATE_PATH,
        null
      );
      record(
        "Completed SME session is mirrored into CAT workflow-local state",
        workflowMirror?.state === "complete"
          && workflowMirror?.source?.actorUuid === sourceActor.uuid
          && workflowMirror?.source?.itemName === syntheticName,
        workflowMirror
      );

      const recent = this.#engine.getRecentSessions().find(session => (
        session.source?.actorUuid === sourceActor.uuid
        && session.source?.itemName === syntheticName
      ));
      record("One SME session carried the synthetic spell across the live lifecycle", Boolean(recent) && recent.state === "complete" && new Set(recent.phaseVisits.map(visit => visit.phase)).has(SME_PHASES.BEFORE_DAMAGE_ROLL), recent);
      record("SME session recorded the transmutation plus lifecycle observations", (recent?.applications?.length ?? 0) >= 4 && recent.applications.some(entry => entry.modifierId === modifierId), recent?.applications ?? null);
      record("Live workflow completed without SME-requested abort", Boolean(workflow) && executionError === null, { workflowClass: workflow?.constructor?.name ?? null });

      record("Real caster HP remained unchanged", (realActor.system?.attributes?.hp?.value ?? null) === baseline.hp, { before: baseline.hp, after: realActor.system?.attributes?.hp?.value ?? null });
      record("Real caster Item count remained unchanged", (realActor.items?.size ?? Array.from(realActor.items ?? []).length) === baseline.items, { before: baseline.items, after: realActor.items?.size ?? null });
      record("Real caster ActiveEffect count remained unchanged", (realActor.effects?.size ?? Array.from(realActor.effects ?? []).length) === baseline.effects, { before: baseline.effects, after: realActor.effects?.size ?? null });
      record("Real caster spell resource data remained unchanged", JSON.stringify(realActor.system?.spells ?? {}) === JSON.stringify(baseline.spells));
    } catch (error) {
      executionError = { message: error?.message ?? String(error), stack: error?.stack ?? null };
      record("Live SME workflow executed without exception", false, executionError);
    } finally {
      for (const [hook, id] of hookHandles.reverse()) {
        try { Hooks.off(hook, id); } catch { /* noop */ }
      }
      try { unregisterObserver?.(); } catch { /* noop */ }
      try { unregisterTransmute?.(); } catch { /* noop */ }

      if (workflow) {
        try { this.#engine.clearSession(workflow); } catch { /* already archived */ }
      }

      if (sourceTokenDoc && canvas.scene.tokens.get(sourceTokenDoc.id)) {
        try { await canvas.scene.deleteEmbeddedDocuments("Token", [sourceTokenDoc.id]); } catch { /* noop */ }
      }
      if (targetTokenDoc && canvas.scene.tokens.get(targetTokenDoc.id)) {
        try { await canvas.scene.deleteEmbeddedDocuments("Token", [targetTokenDoc.id]); } catch { /* noop */ }
      }
      if (sourceActor && game.actors.get(sourceActor.id)) {
        try { await sourceActor.delete(); } catch { /* noop */ }
      }
      if (targetActor && game.actors.get(targetActor.id)) {
        try { await targetActor.delete(); } catch { /* noop */ }
      }

      const newMessageIds = game.messages.filter(message => !oldMessages.has(message.id)).map(message => message.id);
      if (newMessageIds.length) {
        try { await ChatMessage.deleteDocuments(newMessageIds); } catch { /* noop */ }
      }
    }

    record("Disposable source Actor cleaned up", !sourceActor || !game.actors.get(sourceActor.id));
    record("Disposable target Actor cleaned up", !targetActor || !game.actors.get(targetActor.id));
    record("Disposable source Token cleaned up", !sourceTokenDoc || !canvas.scene.tokens.get(sourceTokenDoc.id));
    record("Disposable target Token cleaned up", !targetTokenDoc || !canvas.scene.tokens.get(targetTokenDoc.id));
    record("Temporary SME handlers unregistered", !this.#registry.has(modifierId) && !this.#registry.has(observerId), this.#registry.getStats());
    record("Test-created ChatMessages cleaned up", game.messages.every(message => oldMessages.has(message.id)));
    record(
      "Real caster still unchanged after cleanup",
      (realActor.system?.attributes?.hp?.value ?? null) === baseline.hp
      && (realActor.items?.size ?? Array.from(realActor.items ?? []).length) === baseline.items
      && (realActor.effects?.size ?? Array.from(realActor.effects ?? []).length) === baseline.effects
      && JSON.stringify(realActor.system?.spells ?? {}) === JSON.stringify(baseline.spells)
    );

    return this.#liveReport(checks, {
      notify,
      details: {
        cat: this.#catSpell.getStats(),
        eventAdapter: this.#events.getStats(),
        executionError,
        state
      },
      resultLabel: "SME LIVE MIDI/CAT"
    });
  }

  #liveReport(checks, { notify = true, details = {}, resultLabel = "SME LIVE" } = {}) {
    const passed = checks.every(check => check.passed);
    const report = {
      result: passed ? "PASS" : "FAIL",
      version: game.modules.get(MODULE_ID)?.version ?? null,
      environment: {
        foundry: game.version,
        dnd5e: game.system.version,
        midiQol: game.modules.get("midi-qol")?.version ?? null,
        cat: game.modules.get("cat")?.version ?? null
      },
      summary: {
        passed: checks.filter(check => check.passed).length,
        failed: checks.filter(check => !check.passed).length,
        total: checks.length
      },
      checks,
      ...details
    };
    console.table(checks.map((check, index) => ({ "#": index + 1, Check: check.name, Result: check.passed ? "PASS" : "FAIL" })));
    banner(`AE5E 0.4.1 ${resultLabel} — ${report.summary.passed}/${report.summary.total} ${passed ? "PASS" : "FAIL"}`, passed ? "#18cc46" : "#ff5555", 28);
    console.log("AE5E SME live test full result", report);
    if (notify && ui?.notifications) {
      ui.notifications[passed ? "info" : "error"](
        passed
          ? `AE5E 0.4.1 ${resultLabel} passed (${report.summary.passed}/${report.summary.total}).`
          : `AE5E 0.4.1 ${resultLabel} FAILED (${report.summary.failed} failing checks). See console.`
      );
    }
    return report;
  }

}
