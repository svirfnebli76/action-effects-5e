import { MODULE_ID } from "../core/constants.js";
import { CASTING_PHASES } from "../casting/casting-phase-service.js";
import { duplicateSafely, randomId } from "../core/utils.js";
import { Logger } from "../core/logger.js";
import { validateSpellPropertyUpdate, spellPropertyUpdateMatches } from "./casting-item-properties.js";
import { SaveDisadvantageService } from "./save-disadvantage-service.js";

const CAST_FLAG = "casting";
const clone = value => duplicateSafely(value);
const marker = activity => activity?.item?.flags?.[MODULE_ID]?.[CAST_FLAG];
const property = (object, path) => path.split(".").reduce((value, key) => value?.[key], object);
const itemUpdateMatches = (item, path, expected) => path === "system.properties"
  ? spellPropertyUpdateMatches(item, expected)
  : JSON.stringify(property(item, path)) === JSON.stringify(expected);
const workflowFrom = args => args.flatMap(value => [value, value?.workflow, value?.config?.workflow, value?.usage?.workflow])
  .find(value => value?.actor && value?.activity);
const isActivityOverTime = workflow => Boolean(workflow?.workflowOptions?.overTimeEffectUuid);
const LATE_PHASES = new Set([
  CASTING_PHASES.SAVES_READY,
  CASTING_PHASES.ATTACK_RESOLVED,
  CASTING_PHASES.DAMAGE_MUTABLE,
  CASTING_PHASES.DAMAGE_PRESENTED
]);
const optionSelectionCost = option => Number.isSafeInteger(option?.declaration?.selectionCost)
  ? option.declaration.selectionCost
  : 1;
const selectionCost = options => options.reduce((sum, option) => sum + optionSelectionCost(option), 0);

/** Coordinates Item-provided options. It contains no option rules or names. */
export class MetamagicCastingService {
  #declarations;
  #cards;
  #executors;
  #starting = new WeakMap();
  #byWorkflow = new WeakMap();
  #records = new Map();
  #recent = [];
  #hooks = [];
  #latePending = new WeakMap();
  #lateDone = new WeakMap();
  #attackRollIds = new WeakMap();
  #lateSaveProtection = new WeakMap();
  #damagePresentationActive = new WeakSet();
  #saveDisadvantage;
  #catSpell;

  constructor({ declarations, cards, executors, socket = null, catSpell = null }) {
    this.#declarations = declarations;
    this.#cards = cards;
    this.#executors = executors;
    this.#saveDisadvantage = new SaveDisadvantageService({ socket });
    this.#catSpell = catSpell;
  }

  initialize() {
    if (this.#hooks.length) return;
    const on = (name, callback) => this.#hooks.push([name, Hooks.on(name, callback)]);
    // Midi awaits this hook. Native D&D5e consumption hooks are synchronous.
    on("midi-qol.preTargetingV2", (...args) => this.begin(workflowFrom(args)).catch(error => {
      Logger.warn("Item modifier preparation failed; the cast was stopped before native consumption.", error);
      globalThis.ui?.notifications?.error?.(`AE5E: ${error.message}`);
      return false;
    }));
    on("dnd5e.preUseActivity", activity => this.prepareNative(activity));
    on("dnd5e.preActivityConsumption", (activity, usage, message) => this.prepareConsumption(activity, usage, message));
    on("dnd5e.activityConsumption", (activity, usage, message, updates) => this.validateConsumption(activity, updates));
    on("dnd5e.postActivityConsumption", (activity, usage, message) => this.recordConsumption(activity, message));
    on("dnd5e.postUseActivity", activity => this.observeNative(activity));
    on("midi-qol.premades.postPreambleComplete", (...args) => this.commit(workflowFrom(args)));
    on("midi-qol.hitsChecked", async (...args) => {
      const workflow = workflowFrom(args);
      if (isActivityOverTime(workflow)) return true;
      try {
        return await this.late(workflow, CASTING_PHASES.ATTACK_RESOLVED);
      } catch (error) {
        Logger.warn("Attack-stage Metamagic transaction failed; spell attack resolution continues normally.", error);
        globalThis.ui?.notifications?.error?.("AE5E: " + (error?.message ?? "Attack-stage Metamagic transaction failed."));
        return true;
      }
    });
    on("midi-qol.preCheckSaves", async (...args) => {
      const workflow = workflowFrom(args);
      try {
        await this.#saveDisadvantage.prepareOverTime(workflow);
        if (isActivityOverTime(workflow)) return true;
        return await this.late(workflow);
      } catch (error) {
        Logger.warn("Late Metamagic transaction failed; spell saves continue normally.", error);
        globalThis.ui?.notifications?.error?.("AE5E: " + (error?.message ?? "Late Metamagic transaction failed."));
        return true;
      }
    });
    on("midi-qol.preDamageRollComplete", async (...args) => {
      const workflow = workflowFrom(args);
      if (isActivityOverTime(workflow)) return true;
      try {
        await this.late(workflow, CASTING_PHASES.DAMAGE_MUTABLE);
        const presented = await this.inspectPhaseOffers(workflow, CASTING_PHASES.DAMAGE_PRESENTED);
        if (!presented?.offers?.length) return true;
        await this.#presentDamageRolls(workflow);
        this.#damagePresentationActive.add(workflow);
        return await this.late(workflow, CASTING_PHASES.DAMAGE_PRESENTED);
      } catch (error) {
        Logger.warn("Damage-stage Metamagic transaction failed; spell damage continues normally.", error);
        globalThis.ui?.notifications?.error?.("AE5E: " + (error?.message ?? "Damage-stage Metamagic transaction failed."));
        return true;
      }
    });
    on("midi-qol.premades.postApplyDynamicEffects", (...args) => this.#persistSaveDisadvantage(workflowFrom(args)));
    on("midi-qol.postCheckSaves", (...args) => this.restoreLateSaveProtection(workflowFrom(args)));
    on("midi-qol.RollComplete", (...args) => this.complete(workflowFrom(args)));
    on("midi-qol.premades.postRollFinished", (...args) => this.complete(workflowFrom(args)));
  }

  shutdown() {
    for (const [name, id] of this.#hooks) Hooks.off(name, id);
    this.#hooks.length = 0;
  }

  get(subject) {
    const record = typeof subject === "string"
      ? this.#records.get(subject)?.deref() ?? this.#recent.find(entry => entry.castingId === subject)
      : this.#byWorkflow.get(subject);
    return record ? this.#snapshot(record) : null;
  }

  recent() { return this.#recent.map(clone); }

  /** Read-only discovery for an existing casting; no choice, resource debit or effect application. */
  async inspectPhaseOffers(workflow, phase = CASTING_PHASES.SAVES_READY) {
    if (!LATE_PHASES.has(phase)) throw new Error("Unsupported late Metamagic phase.");
    if (!workflow) return null;
    const record = this.#byWorkflow.get(workflow);
    if (!record || ["rejected", "completed", "unconfirmed"].includes(record.state)) return null;
    if (record.initiatorUserId !== game.user.id || (workflow.userId && workflow.userId !== game.user.id)) return null;
    const current = this.#declarations.compile(record.actor, this.#context(workflow));
    if (!this.#sameBase(current, record)) return null;
    const available = await this.#offers(current, record, phase);
    const selected = new Set(record.selected.map(entry => entry.id));
    const selectionUsed = selectionCost(record.selected);
    const selectionRemaining = Math.max(0, current.selectionLimit - selectionUsed);
    const offers = available.map(entry => {
      const block = selected.has(entry.id)
        ? "This Metamagic was already used on this casting."
        : optionSelectionCost(entry) > selectionRemaining
          ? "The Metamagic selection limit for this casting has been reached."
          : null;
      return block ? { ...entry, disabled: true, reason: block, reasons: [...entry.reasons, block] } : entry;
    });
    const pool = record.actor.items.get(current.resourceId);
    return {
      phase,
      casting: this.#snapshot(record),
      resource: { itemId: current.resourceId, current: Number(pool?.system?.uses?.value),
        max: Number(pool?.system?.uses?.max) },
      selectionLimit: current.selectionLimit,
      selectionUsed,
      selectionRemaining,
      offers: clone(offers)
    };
  }

  /**
   * Offer Item-owned late Metamagic choices at an awaited Midi workflow gate.
   * Discovery is preview-only; payment and application remain one transaction.
   * Keep the accepted pre-cast CAT broker and native consumption unchanged.
   */
  async late(workflow, phase = CASTING_PHASES.SAVES_READY) {
    if (!LATE_PHASES.has(phase)) throw new Error("Unsupported late Metamagic phase.");
    if (!workflow) return true;
    const eventKey = this.#lateEventKey(workflow, phase);
    if (!eventKey || this.#lateDone.get(workflow)?.has(eventKey)) return true;
    const pendingByPhase = this.#latePending.get(workflow);
    if (pendingByPhase?.has(eventKey)) return pendingByPhase.get(eventKey);
    const pending = this.#latePreview(workflow, phase);
    const currentPending = pendingByPhase ?? new Map();
    currentPending.set(eventKey, pending);
    this.#latePending.set(workflow, currentPending);
    try { return await pending; }
    finally {
      currentPending.delete(eventKey);
      if (!currentPending.size) this.#latePending.delete(workflow);
      const done = this.#lateDone.get(workflow) ?? new Set();
      done.add(eventKey);
      this.#lateDone.set(workflow, done);
    }
  }

  #lateEventKey(workflow, phase) {
    if (phase !== CASTING_PHASES.ATTACK_RESOLVED) return phase;
    const roll = workflow.attackRoll ?? workflow.attackRolls?.at?.(-1) ?? null;
    if (!roll || (typeof roll !== "object" && typeof roll !== "function")) return null;
    let id = this.#attackRollIds.get(roll);
    if (!id) {
      id = randomId();
      this.#attackRollIds.set(roll, id);
    }
    return `${phase}:${id}`;
  }

  async #latePreview(workflow, phase) {
    const record = this.#byWorkflow.get(workflow);
    if (!record || !["unmodified", "selected", "native-prepared", "consumed", "committed"].includes(record.state)) return true;
    if (record.initiatorUserId !== game.user.id || (workflow.userId && workflow.userId !== game.user.id)) return true;
    const first = await this.inspectPhaseOffers(workflow, phase);
    if (!first?.offers?.length) return true;
    if (phase === CASTING_PHASES.ATTACK_RESOLVED && !first.offers.some(offer => !offer.disabled)) return true;
    const compiled = this.#declarations.compile(record.actor, this.#context(workflow));
    if (!this.#sameBase(compiled, record)) return true;
    let invoked = 0;
    let answer;
    let callbackResult;
    let callbackError;
    let running = true;
    try {
      answer = await this.#executors.execute({
        actor: record.actor, sourceUuid: compiled.mainUuid, identity: compiled.mainIdentity,
        family: "metamagic", declaration: compiled.mainDeclaration, kind: "broker", phase: "begin",
        context: { actor: record.actor, workflow, initiatorUserId: record.initiatorUserId,
          castingPhase: phase,
          begin: async (source, chooser) => {
            invoked++;
            if (!running || invoked !== 1 || source?.uuid !== compiled.mainUuid
              || record.actor.items.get(source.id) !== source || typeof chooser !== "function")
              throw new Error("Late Metamagic broker must be started once from its base Item.");
            try {
              callbackResult = await this.#chooseLate(record, chooser, phase);
              return callbackResult;
            } catch (error) {
              callbackError = error;
              throw error;
            }
          }
        }
      });
      if (invoked !== 1 || answer !== callbackResult)
        throw new Error("Late Metamagic broker did not return its chooser result.");
    } catch (error) {
      throw callbackError ?? error;
    } finally { running = false; }
    return true;
  }

  /**
   * Present evaluated damage before a post-presentation late phase. Midi's
   * presenter awaits Dice So Nice and marks the shown results as hidden from
   * later DSN passes. A subsequent in-place reroll adds fresh, unhidden result
   * objects which this same presenter can animate independently.
   */
  async #presentDamageRolls(workflow) {
    const rolls = Array.isArray(workflow?.damageRolls) && workflow.damageRolls.length
      ? workflow.damageRolls
      : workflow?.damageRoll ? [workflow.damageRoll] : [];
    if (!rolls.length) throw new Error("No damage rolls are available for presentation.");

    const hasUnpresented = rolls.some(roll => (roll?.dice ?? []).some(die =>
      (die?.results ?? []).some(result => result?.active !== false && result?.hidden !== true)));
    if (!hasUnpresented) return true;

    const midi = globalThis.game?.modules?.get?.("midi-qol")?.api ?? globalThis.MidiQOL;
    if (typeof midi?.displayDSNForRoll !== "function") {
      throw new Error("Midi-QOL's damage-roll presentation service is unavailable.");
    }
    await midi.displayDSNForRoll(rolls, "damageRoll", undefined, undefined, workflow.actor);
    return true;
  }

  /** Present only unshown attack-die results, normally a fresh reroll result. */
  async #presentAttackRoll(workflow) {
    const roll = workflow?.attackRoll ?? workflow?.attackRolls?.at?.(-1) ?? null;
    if (!roll) throw new Error("No attack roll is available for presentation.");
    const hasUnpresented = (roll.dice ?? []).some(die => (die?.results ?? [])
      .some(result => result?.hidden !== true && result?.rerolled !== true));
    if (!hasUnpresented) return true;

    const midi = globalThis.game?.modules?.get?.("midi-qol")?.api ?? globalThis.MidiQOL;
    if (typeof midi?.displayDSNForRoll !== "function") {
      throw new Error("Midi-QOL's attack-roll presentation service is unavailable.");
    }
    await midi.displayDSNForRoll(roll, "attackRollD20", undefined, undefined, workflow.actor);
    return true;
  }

  async #chooseLate(record, chooser, phase) {
    const workflow = record.workflow;
    const original = await this.inspectPhaseOffers(workflow, phase);
    if (!original?.offers.length) return { outcome: "decline", selectedIds: [] };
    const response = await chooser({
      phase, closeOutcome: "decline",
      casting: original.casting, offers: original.offers, resource: original.resource,
      selectionLimit: Math.max(1, original.selectionRemaining)
    });
    const decision = Array.isArray(response)
      ? { outcome: response.length ? "confirm" : "decline", selectedIds: response }
      : { outcome: response?.outcome ?? "decline", selectedIds: response?.selectedIds ?? [] };
    if (decision.outcome !== "confirm") return { outcome: "decline", selectedIds: [] };
    const ids = decision.selectedIds;
    const originalSelections = Array.isArray(ids)
      ? ids.map(id => original.offers.find(option => option.id === id && !option.disabled))
      : [];
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length
      || originalSelections.some(option => !option)
      || selectionCost(originalSelections) > original.selectionRemaining) {
      throw new Error("Late Metamagic selection is no longer valid.");
    }
    const current = this.#declarations.compile(record.actor, this.#context(workflow));
    if (!this.#sameBase(current, record)) throw new Error("Base Metamagic declaration changed while choosing.");
    const fresh = await this.inspectPhaseOffers(workflow, phase);
    if (!fresh) throw new Error("Metamagic selection allowance changed while choosing.");
    const pool = record.actor.items.get(record.resourceId);
    const selected = [];
    let potentialCost = 0;
    for (const id of ids) {
      const option = fresh.offers.find(o => o.id === id && !o.disabled);
      const originallyOffered = original.offers.find(o => o.id === id);
      if (!option || !this.#sameOption(option, originallyOffered)) throw new Error("Late Metamagic option changed while choosing.");
      potentialCost += option.cost;
      selected.push(option);
    }
    if (selectionCost(selected) > fresh.selectionRemaining) throw new Error("Metamagic selection allowance changed while choosing.");
    if (potentialCost > Number(pool?.system?.uses?.value)) throw new Error("Sorcery Points changed; choose Metamagic again.");

    const selections = [];
    for (const option of selected) {
      const selection = await this.#optionResult(option, "select", record, {
        castingPhase: phase, transactionStage: "selection"
      });
      if (selection?.outcome !== "confirm") continue;
      if (selection.payload === undefined) throw new Error(option.label + " did not return a late-selection payload.");
      selections.push({ option, payload: clone(selection.payload) });
    }
    if (!selections.length) return { outcome: "decline", selectedIds: [] };
    const cost = selections.reduce((sum, entry) => sum + entry.option.cost, 0);

    const applications = [];
    for (const entry of selections) {
      const application = await this.#optionResult(entry.option, "apply", record, {
        castingPhase: phase, transactionStage: "prepare-application",
        payload: clone(entry.payload)
      });
      applications.push({ option: entry.option, payload: entry.payload,
        application: this.#validateLateApplication(record, entry.option, application, phase) });
    }

    const debit = await this.#debitLate(record, cost);
    const damageRollbacks = [];
    const attackRollbacks = [];
    try {
      await this.#applyLateApplications(record, applications, damageRollbacks, attackRollbacks);
    } catch (error) {
      this.#clearLateSaveProtection(record.workflow, { removeSuperSavers: true });
      // A compatibility utility failure must not prevent the existing SP refund.
      const cleanupErrors = [];
      try { this.#saveDisadvantage.rollback(record.workflow); }
      catch (failure) { cleanupErrors.push(failure); }
      try { await this.#rollbackDamageRollMutations(record.workflow, damageRollbacks); }
      catch (failure) { cleanupErrors.push(failure); }
      try { await this.#rollbackAttackRollMutations(attackRollbacks); }
      catch (failure) { cleanupErrors.push(failure); }
      const refunded = await this.#refundLate(record, debit);
      if (!refunded) {
        record.lateRefundStatus = "failed";
        this.#remember(record);
        throw new Error("Late Metamagic application failed after payment and refund also failed: " + error.message);
      }
      record.lateRefundStatus = "refunded-after-application-failure";
      this.#remember(record);
      throw new Error("Late Metamagic application failed; Sorcery Points were restored. " + error.message
        + (cleanupErrors.length ? " Application cleanup also failed: "
          + cleanupErrors.map(failure => failure.message).join("; ") : ""));
    }

    record.selected.push(...applications.map(entry => clone(entry.option)));
    record.totalCost += cost;
    record.lateDebits ??= [];
    record.lateDebits.push(clone(debit));
    const lateSelection = {
      phase, status: "paid-applied",
      options: applications.map(entry => ({
        id: entry.option.id, label: entry.option.label, sourceUuid: entry.option.sourceUuid,
        cost: entry.option.cost, payload: clone(entry.payload)
      })),
      totalCost: cost
    };
    record.lateSelection = lateSelection;
    record.lateSelections ??= [];
    record.lateSelections.push(clone(lateSelection));
    delete record.latePreview;
    record.state = "committed";
    record.committedAt ??= new Date().toISOString();
    record.lateRefundStatus = "not-needed";
    this.#remember(record);
    const lateOptions = applications.map(entry => entry.option);
    await this.#notifyLateConsumption(record, lateOptions, debit);
    await this.#notifyCommitted(record, lateOptions);
    await this.#present(record, "Cast");
    return { outcome: "confirm", selectedIds: applications.map(entry => entry.option.id) };
  }

  #validateLateApplication(record, option, application, phase) {
    if (!application || typeof application !== "object" || Array.isArray(application)) {
      throw new Error(option.label + " did not return a declarative late application.");
    }
    if (application.attackRollMutation) {
      if (phase !== CASTING_PHASES.ATTACK_RESOLVED) {
        throw new Error(option.label + " requested an attack-roll mutation outside the attack-resolved phase.");
      }
      if (application.damageRollMutation || application.saveDisadvantage || application.saveProtection) {
        throw new Error(option.label + " combined incompatible late applications.");
      }
      const request = application.attackRollMutation;
      if (!request || typeof request !== "object" || Array.isArray(request)
        || request.operation !== "reroll-die") {
        throw new Error(option.label + " returned an unsupported attack-roll mutation.");
      }
      if (typeof record.workflow.setAttackRoll !== "function" || typeof record.workflow.checkHits !== "function") {
        throw new Error("Midi attack-roll commit and hit-reassessment services are unavailable.");
      }
      if (!this.#catSpell || typeof this.#catSpell.rerollAttackDiePreservingHistory !== "function"
        || typeof this.#catSpell.restoreRerolledAttackDie !== "function") {
        throw new Error("CAT spell attack-die reroll utilities are unavailable.");
      }
      const roll = record.workflow.attackRoll ?? record.workflow.attackRolls?.at?.(-1) ?? null;
      const { dieIndex, resultIndex } = request;
      const die = roll?.dice?.[dieIndex];
      const result = die?.results?.[resultIndex];
      if (![dieIndex, resultIndex].every(value => Number.isSafeInteger(value) && value >= 0)
        || !roll || typeof roll._evaluateTotal !== "function" || !Array.isArray(roll.dice)
        || !die || Number(die.faces) !== 20 || typeof die.roll !== "function" || !Array.isArray(die.results)
        || !result || !Number.isFinite(Number(result.result))) {
        throw new Error(option.label + " returned an invalid attack-die selection.");
      }
      return { attackRollMutation: { operation: "reroll-die", dieIndex, resultIndex } };
    }
    if (application.damageRollMutation) {
      if (![CASTING_PHASES.DAMAGE_MUTABLE, CASTING_PHASES.DAMAGE_PRESENTED].includes(phase)) {
        throw new Error(option.label + " requested a damage-roll mutation outside a supported damage phase.");
      }
      if (application.attackRollMutation || application.saveDisadvantage || application.saveProtection) {
        throw new Error(option.label + " combined incompatible late applications.");
      }
      const request = application.damageRollMutation;
      if (!request || typeof request !== "object" || Array.isArray(request)
        || !["retag", "reroll-dice"].includes(request.operation)) {
        throw new Error(option.label + " returned an unsupported damage-roll mutation.");
      }
      const requiredPhase = request.operation === "retag"
        ? CASTING_PHASES.DAMAGE_MUTABLE
        : CASTING_PHASES.DAMAGE_PRESENTED;
      if (phase !== requiredPhase) {
        throw new Error(option.label + " returned a " + request.operation
          + " mutation during the wrong damage phase.");
      }
      if (typeof record.workflow.setDamageRolls !== "function") {
        throw new Error("Midi workflow.setDamageRolls() is unavailable.");
      }
      const rolls = Array.isArray(record.workflow.damageRolls) && record.workflow.damageRolls.length
        ? record.workflow.damageRolls
        : record.workflow.damageRoll ? [record.workflow.damageRoll] : [];
      if (!rolls.length) throw new Error(option.label + " found no damage rolls to mutate.");

      if (request.operation === "retag") {
        const damageType = request.damageType;
        if (typeof damageType !== "string" || !/^[a-z][a-z0-9-]*$/.test(damageType)) {
          throw new Error(option.label + " returned an invalid damage type.");
        }
        if (!this.#catSpell || typeof this.#catSpell.retagDamageRollsPreservingResults !== "function") {
          throw new Error("CAT spell roll utilities are unavailable.");
        }
        const indexes = request.indexes == null ? rolls.map((_, index) => index) : request.indexes;
        if (!Array.isArray(indexes) || !indexes.length || new Set(indexes).size !== indexes.length
          || indexes.some(index => !Number.isSafeInteger(index) || index < 0 || index >= rolls.length
            || !rolls[index] || !rolls[index].options || typeof rolls[index].options !== "object"
            || Array.isArray(rolls[index].options))) {
          throw new Error(option.label + " returned invalid damage-roll indexes.");
        }
        return { damageRollMutation: { operation: "retag", damageType, indexes: [...indexes] } };
      }

      if (!this.#catSpell || typeof this.#catSpell.rerollDamageDicePreservingHistory !== "function"
        || typeof this.#catSpell.restoreRerolledDamageDice !== "function") {
        throw new Error("CAT spell die-reroll utilities are unavailable.");
      }
      const dice = request.dice;
      const identities = Array.isArray(dice)
        ? dice.map(entry => `${entry?.rollIndex}:${entry?.dieIndex}:${entry?.resultIndex}`)
        : [];
      if (!Array.isArray(dice) || !dice.length || new Set(identities).size !== dice.length
        || dice.some(entry => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) return true;
          const { rollIndex, dieIndex, resultIndex } = entry;
          if (![rollIndex, dieIndex, resultIndex].every(value => Number.isSafeInteger(value) && value >= 0)) return true;
          const roll = rolls[rollIndex];
          const die = roll?.dice?.[dieIndex];
          const result = die?.results?.[resultIndex];
          return !roll || typeof roll._evaluateTotal !== "function" || !Array.isArray(roll.dice)
            || !die || typeof die.roll !== "function" || !Array.isArray(die.results)
            || !Number.isFinite(Number(die.faces)) || Number(die.faces) < 1
            || !result || !Number.isFinite(Number(result.result)) || result.active === false;
        })) {
        throw new Error(option.label + " returned invalid damage-die selections.");
      }
      return { damageRollMutation: { operation: "reroll-dice", dice: dice.map(entry => ({
        rollIndex: entry.rollIndex, dieIndex: entry.dieIndex, resultIndex: entry.resultIndex
      })) } };
    }
    if (phase !== CASTING_PHASES.SAVES_READY) {
      throw new Error(option.label + " returned no supported damage-phase application.");
    }
    if (application.saveDisadvantage && !application.saveProtection) {
      return {
        saveDisadvantage: this.#saveDisadvantage.validate(
          record.workflow,
          application.saveDisadvantage,
          { id: option.id }
        )
      };
    }
    const saveProtection = application.saveProtection;
    if (!saveProtection || typeof saveProtection !== "object" || Array.isArray(saveProtection)) {
      throw new Error(option.label + " returned no supported late application.");
    }
    const tokenUuids = saveProtection.tokenUuids;
    if (!Array.isArray(tokenUuids) || !tokenUuids.length || new Set(tokenUuids).size !== tokenUuids.length
      || tokenUuids.some(uuid => typeof uuid !== "string" || !uuid)) {
      throw new Error(option.label + " returned invalid save-protection targets.");
    }
    if (saveProtection.automaticSuccess !== true || saveProtection.superSaver !== true) {
      throw new Error(option.label + " requested unsupported save-protection semantics.");
    }
    const candidates = new Map([...(record.workflow.hitTargets ?? record.workflow.targets ?? [])]
      .map(token => [token?.document?.uuid ?? token?.uuid, token]).filter(([uuid]) => Boolean(uuid)));
    if (tokenUuids.some(uuid => !candidates.has(uuid))) {
      throw new Error(option.label + " attempted to protect a creature outside the finalized affected targets.");
    }
    if (typeof record.workflow.checkSculptOrCarefulSpells !== "function") {
      throw new Error("Midi-QOL save-protection API is unavailable on this workflow.");
    }
    const superSavers = record.workflow.superSavers;
    if (superSavers != null && (typeof superSavers.add !== "function" || typeof superSavers.has !== "function"
      || typeof superSavers.delete !== "function")) throw new Error("Midi-QOL super-saver collection is incompatible.");
    return { saveProtection: { tokenUuids: [...tokenUuids], automaticSuccess: true, superSaver: true } };
  }

  async #debitLate(record, amount) {
    const pool = record.actor.items.get(record.resourceId);
    const beforeSpent = Number(pool?.system?.uses?.spent);
    const beforeAvailable = Number(pool?.system?.uses?.value);
    if (!pool || !Number.isSafeInteger(amount) || amount <= 0 || !Number.isFinite(beforeSpent)
      || !Number.isFinite(beforeAvailable) || amount > beforeAvailable) {
      throw new Error("Late Metamagic Sorcery Point payment is no longer affordable.");
    }
    if (typeof record.actor.performBulkUpdate !== "function") throw new Error("D&D5e bulk resource update API is unavailable.");
    const afterSpent = beforeSpent + amount;
    const debit = { owner: "ae5e-late", resourceUuid: record.resourceUuid, amount,
      beforeSpent, afterSpent, beforeAvailable, afterAvailable: beforeAvailable - amount };
    await record.actor.performBulkUpdate({ item: [{ _id: pool.id, "system.uses.spent": afterSpent }] });
    const current = record.actor.items.get(record.resourceId);
    if (Number(current?.system?.uses?.spent) !== afterSpent
      || Number(current?.system?.uses?.value) !== debit.afterAvailable) {
      const refunded = await this.#refundLate(record, debit);
      if (refunded) throw new Error("Sorcery Point payment could not be verified; the attempted debit was restored.");
      throw new Error("Sorcery Point payment could not be verified and automatic restoration failed.");
    }
    return debit;
  }

  async #refundLate(record, debit) {
    const pool = record.actor.items.get(record.resourceId);
    if (!pool || debit?.owner !== "ae5e-late"
      || Number(pool.system?.uses?.spent) !== debit.afterSpent
      || Number(pool.system?.uses?.value) !== debit.afterAvailable
      || typeof record.actor.performBulkUpdate !== "function") return false;
    await record.actor.performBulkUpdate({ item: [{ _id: pool.id, "system.uses.spent": debit.beforeSpent }] });
    const current = record.actor.items.get(record.resourceId);
    return Number(current?.system?.uses?.spent) === debit.beforeSpent
      && Number(current?.system?.uses?.value) === debit.beforeAvailable;
  }

  async #applyLateApplications(record, applications, damageRollbacks, attackRollbacks) {
    for (const entry of applications) {
      const request = entry.application.saveProtection;
      if (request) this.#installLateSaveProtection(record.workflow, request.tokenUuids);
      if (entry.application.saveDisadvantage) this.#saveDisadvantage.install(record, entry.application.saveDisadvantage);
      const mutation = entry.application.damageRollMutation;
      if (mutation) {
        const rolls = Array.isArray(record.workflow.damageRolls) && record.workflow.damageRolls.length
          ? record.workflow.damageRolls
          : [record.workflow.damageRoll];
        if (mutation.operation === "retag") {
          const before = mutation.indexes.map(index => ({ index, type: rolls[index].options.type }));
          await this.#catSpell.retagDamageRollsPreservingResults(record.workflow, mutation.damageType,
            { indexes: mutation.indexes });
          damageRollbacks.push({ operation: "retag", rolls, before });
        } else {
          const state = await this.#catSpell.rerollDamageDicePreservingHistory(record.workflow,
            { dice: mutation.dice });
          damageRollbacks.push({ operation: "reroll-dice", ...state });
          if (this.#damagePresentationActive.has(record.workflow)) {
            await this.#presentDamageRolls(record.workflow);
          }
        }
      }
      const attackMutation = entry.application.attackRollMutation;
      if (attackMutation) {
        const state = await this.#catSpell.rerollAttackDiePreservingHistory(record.workflow, {
          dieIndex: attackMutation.dieIndex,
          resultIndex: attackMutation.resultIndex
        });
        attackRollbacks.push(state);
        await this.#presentAttackRoll(record.workflow);
      }
    }
  }

  async #rollbackDamageRollMutations(workflow, states) {
    if (!states.length) return;
    for (const state of [...states].reverse()) {
      if (state.operation === "reroll-dice") {
        this.#catSpell.restoreRerolledDamageDice(state);
      } else {
        for (const entry of state.before) {
          if (state.rolls[entry.index]?.options) state.rolls[entry.index].options.type = entry.type;
        }
      }
    }
    await workflow.setDamageRolls(states[0].rolls);
  }

  async #rollbackAttackRollMutations(states) {
    for (const state of [...states].reverse()) {
      await this.#catSpell.restoreRerolledAttackDie(state);
    }
  }

  #installLateSaveProtection(workflow, tokenUuids) {
    let state = this.#lateSaveProtection.get(workflow);
    if (!state) {
      const original = workflow.checkSculptOrCarefulSpells;
      const protectedUuids = new Set();
      state = { original, protectedUuids, addedSuperSavers: new Set() };
      workflow.checkSculptOrCarefulSpells = function(target, ...args) {
        const uuid = target?.document?.uuid ?? target?.uuid;
        if (uuid && protectedUuids.has(uuid)) return true;
        return original.call(this, target, ...args);
      };
      this.#lateSaveProtection.set(workflow, state);
    }
    const candidates = new Map([...(workflow.hitTargets ?? workflow.targets ?? [])]
      .map(token => [token?.document?.uuid ?? token?.uuid, token]).filter(([uuid]) => Boolean(uuid)));
    workflow.superSavers ??= new Set();
    for (const uuid of tokenUuids) {
      const token = candidates.get(uuid);
      state.protectedUuids.add(uuid);
      if (!workflow.superSavers.has(token)) {
        workflow.superSavers.add(token);
        state.addedSuperSavers.add(token);
      }
    }
  }

  restoreLateSaveProtection(workflow) {
    this.#clearLateSaveProtection(workflow, { removeSuperSavers: false });
    return true;
  }

  #clearLateSaveProtection(workflow, { removeSuperSavers = false } = {}) {
    const state = this.#lateSaveProtection.get(workflow);
    if (!state) return;
    if (workflow?.checkSculptOrCarefulSpells && state.original) workflow.checkSculptOrCarefulSpells = state.original;
    if (removeSuperSavers && workflow?.superSavers) {
      for (const token of state.addedSuperSavers) workflow.superSavers.delete(token);
    }
    this.#lateSaveProtection.delete(workflow);
  }

  async #notifyLateConsumption(record, options, debit) {
    const context = {
      castingId: record.castingId, actor: record.actor, workflow: record.workflow,
      activity: record.workflow.activity, item: record.workflow.activity.item,
      initiatorUserId: record.initiatorUserId, casting: this.#snapshot(record)
    };
    const requests = [
      { ...record.broker, kind: "broker", amount: debit.amount },
      ...options.map(option => ({ sourceUuid: option.sourceUuid, identity: option.identity,
        declaration: option.declaration, kind: "option", amount: option.cost }))
    ];
    for (const entry of requests) {
      const { amount, ...request } = entry;
      try {
        await this.#executors.notify({ ...request, actor: record.actor, family: "metamagic", phase: "consumed",
          context: { ...context, consumption: { ...clone(debit), amount, totalAmount: debit.amount } } });
      } catch (error) {
        try { Logger.warn("Late Metamagic lifecycle notification failed; payment and save protection were retained.", error); }
        catch {}
      }
    }
  }

  eventIdentity(castingId, { phase, targetActorUuid = null, targetTokenUuid = null, rollId = null } = {}) {
    if (!castingId || !phase) throw new Error("Casting and phase identity are required.");
    return JSON.stringify([castingId, phase, targetActorUuid, targetTokenUuid, rollId]);
  }

  async begin(workflow, options = {}) {
    if (!workflow || isActivityOverTime(workflow)) return true;
    if (this.#starting.has(workflow)) return this.#starting.get(workflow);
    const existing = this.#byWorkflow.get(workflow);
    if (existing) return existing.preparing ?? existing.state !== "rejected";
    const starting = this.#start(workflow, options);
    this.#starting.set(workflow, starting);
    try { return await starting; }
    finally { this.#starting.delete(workflow); }
  }

  #context(workflow) {
    return { subjectToken: workflow.token?.document ?? workflow.token,
      activity: workflow.activity, item: workflow.activity?.item,
      context: { casterActorUuid: workflow.actor?.uuid } };
  }

  async #start(workflow, { initiatorUserId = game.user.id, parentCastingId = null, continuation = false } = {}) {
    if (!workflow || (workflow.item ?? workflow.activity?.item)?.type !== "spell") return true;
    if (initiatorUserId !== game.user.id || (workflow.userId && workflow.userId !== game.user.id)) return true;
    const actor = workflow.actor ?? workflow.item?.actor ?? workflow.activity?.actor;
    // No declarations means no participation, not an error for ordinary casts.
    if (!this.#declarations.hasBase(actor)) return true;
    const existing = this.#byWorkflow.get(workflow);
    if (existing) return existing.preparing ?? existing.state !== "rejected";
    if (!actor?.isOwner) throw new Error("The initiating user must own the caster.");
    if (continuation || parentCastingId) throw new Error("Continuation execution requires a validated parent adapter and is not enabled in this first slice.");
    const compiled = this.#declarations.compile(actor, this.#context(workflow));
    if (compiled.participating === false) return true;
    if (!compiled.ready) throw new Error(compiled.diagnostics.map(entry => entry.message).join(" "));
    if (!await this.#guard(workflow, actor, compiled, initiatorUserId, "pre-cast")) return false;
    return this.#broker(workflow, actor, compiled, initiatorUserId);
  }

  async #guard(workflow, actor, compiled, initiatorUserId, castingPhase) {
    if (!this.#executors) throw new Error("The Item-owned macro adapter is unavailable.");
    const guards = compiled.options.filter(option =>
      (option.declaration.guardPhases ?? []).includes(castingPhase));
    for (const option of guards) {
      let result;
      try {
        result = await this.#executors.execute({
          actor,
          sourceUuid: option.sourceUuid,
          identity: option.identity,
          family: "metamagic",
          declaration: option.declaration,
          kind: "option",
          phase: "guard",
          requireResponse: true,
          context: {
            actor,
            workflow,
            activity: workflow.activity,
            item: workflow.activity?.item ?? workflow.item ?? null,
            initiatorUserId,
            castingPhase
          }
        });
      } catch (error) {
        throw new Error(`${option.label} casting guard failed: ${error.message}`);
      }
      if (!result || typeof result.allowed !== "boolean") {
        throw new Error(`${option.label} casting guard must return an explicit allowed result.`);
      }
      if (result.allowed) continue;
      const reason = typeof result.reason === "string" && result.reason.trim()
        ? result.reason.trim()
        : `${option.label} prevents this casting.`;
      globalThis.ui?.notifications?.warn?.(reason);
      return false;
    }
    return true;
  }

  async #broker(workflow, actor, compiled, initiatorUserId) {
    if (!this.#executors) throw new Error("The Item-owned macro adapter is unavailable.");
    let calls = 0;
    let began = false;
    let result;
    let beginError;
    let open = true;
    try {
      const response = await this.#executors.execute({ actor, sourceUuid: compiled.mainUuid, identity: compiled.mainIdentity,
        family: "metamagic", declaration: compiled.mainDeclaration, kind: "broker", phase: "begin",
        context: { actor, workflow, initiatorUserId,
          begin: async (source, chooser) => {
            try {
              calls += 1;
              if (!open || calls !== 1 || source?.uuid !== compiled.mainUuid || actor.items.get(source.id) !== source || typeof chooser !== "function") {
                throw new Error("The base Item must start its broker exactly once with an Item-owned chooser.");
              }
              const current = this.#declarations.compile(actor, this.#context(workflow));
              if (!current.ready || current.mainIdentity !== compiled.mainIdentity
                || JSON.stringify(current.mainDeclaration) !== JSON.stringify(compiled.mainDeclaration)) throw new Error("The base declaration changed before brokering.");
              result = await this.#beginCompiled(workflow, actor, current, chooser, initiatorUserId);
              began = true;
              return result;
            } catch (error) { beginError = error; throw error; }
          } }
      });
      if (calls !== 1 || !began || response !== result) throw new Error("The base Item did not complete its broker request.");
      return result;
    } catch (error) {
      error = beginError ?? error; // CAT catches script errors; retain AE5E's precise rejection reason.
      const record = this.#byWorkflow.get(workflow);
      if (record) { record.state = "rejected"; record.error = error.message; this.#archive(record); }
      throw error;
    } finally { open = false; }
  }

  async #beginCompiled(workflow, actor, compiled, chooser, initiatorUserId) {
    const activity = workflow.activity;
    const item = activity?.item;
    if (!item?.updateSource || !activity?.updateSource || actor.items.get(item.id) === item) {
      throw new Error("Casting-local Activity/Item copy is unavailable; source Items must remain unchanged.");
    }
    const record = {
      version: 1, runtimeRevision: "activity-source-bridge-4", castingId: randomId(), parentCastingId: null, state: "preparing",
      initiatorUserId, controllerUserId: initiatorUserId, executionUserId: game.user.id,
      casterActorUuid: actor.uuid, casterTokenUuid: workflow.token?.document?.uuid ?? workflow.token?.uuid ?? null,
      sourceItemUuid: actor.items.get(item.id)?.uuid ?? item.uuid, sourceActivityId: activity.id,
      provenance: { cachedFor: item.flags?.dnd5e?.cachedFor ?? null, cause: null },
      resourceId: compiled.resourceId, resourceUuid: compiled.resourceUuid,
      mode: "collection", mainIdentity: compiled.mainIdentity,
      broker: { sourceUuid: compiled.mainUuid, identity: compiled.mainIdentity, declaration: clone(compiled.mainDeclaration) },
      selected: [], totalCost: 0, activityUpdates: {}, itemUpdates: {}, effectUpdates: {}, activityChecks: [], nativeDebit: null,
      refundOwner: "native-activity", refundStatus: "not-requested-by-ae5e",
      workflow, actor, nativeActivities: new WeakSet(), consumptionIndexes: new WeakMap()
    };
    this.#byWorkflow.set(workflow, record);
    for (const [id, reference] of this.#records) if (!reference.deref()) this.#records.delete(id);
    this.#records.set(record.castingId, new WeakRef(record));
    const preparing = this.#prepare(record, compiled, chooser);
    record.preparing = preparing;
    try { return await preparing; }
    catch (error) { record.state = "rejected"; record.error = error.message; this.#archive(record); throw error; }
    finally { delete record.preparing; }
  }

  async #optionResult(option, phase, record, extraContext = {}) {
    return this.#executors.execute({ actor: record.actor, sourceUuid: option.sourceUuid, identity: option.identity,
      family: "metamagic", declaration: option.declaration, kind: "option", phase,
      context: { castingId: record.castingId, actor: record.actor, workflow: record.workflow,
        activity: record.workflow.activity, item: record.workflow.activity.item, initiatorUserId: record.initiatorUserId,
        ...extraContext } });
  }

  async #offers(compiled, record, phase = "pre-cast") {
    const pool = record.actor.items.get(compiled.resourceId);
    const available = Number(pool?.system?.uses?.value);
    const maximum = Number(pool?.system?.uses?.max);
    if (!Number.isFinite(available) || pool.system.uses.autoDestroy) throw new Error("Native point pool has invalid uses or automatic destruction enabled.");
    const offers = [];
    for (const option of compiled.options) {
      const declaredPhases = option.declaration.phases ?? ["pre-cast"];
      if (!declaredPhases.includes(phase)) continue;
      let result;
      try {
        result = await this.#optionResult(option, "offer", record, {
          resource: {
            identifier: compiled.mainDeclaration.resource?.identifier ?? null,
            itemId: compiled.resourceId,
            uuid: compiled.resourceUuid,
            available,
            maximum: Number.isFinite(maximum) ? maximum : available,
            cost: option.cost
          },
          castingPhase: phase,
          casting: this.#snapshot(record)
        });
      } catch (error) { result = { eligible: false, reason: error.message }; }
      const eligible = result?.eligible === true;
      const affordable = option.cost <= available;
      const eligibilityReasons = [
        ...(Array.isArray(result?.reasons) ? result.reasons : []),
        ...(result?.reason ? [result.reason] : [])
      ].map(String).filter(Boolean);
      const affordabilityReason = !affordable
        ? String(result?.unaffordableReason ?? "Insufficient resource uses.")
        : null;
      const reasons = [...eligibilityReasons, ...(affordabilityReason ? [affordabilityReason] : [])];
      const acceptances = [
        ...(Array.isArray(result?.acceptances) ? result.acceptances : []),
        ...(result?.acceptance ? [result.acceptance] : [])
      ].map(String).filter(Boolean);
      const advisories = [
        ...(Array.isArray(result?.advisories) ? result.advisories : []),
        ...(result?.advisory ? [result.advisory] : [])
      ].map(String).filter(Boolean);
      const reason = !eligible ? reasons[0] ?? "Not eligible for this casting."
        : !affordable ? affordabilityReason : null;
      offers.push({
        ...option,
        available,
        maximum: Number.isFinite(maximum) ? maximum : available,
        eligible,
        affordable,
        description: typeof result?.description === "string" ? result.description : option.declaration.tooltip,
        dicePreview: result?.dicePreview ?? null,
        disabled: !eligible || !affordable,
        reason,
        reasons,
        acceptances,
        advisories
      });
    }
    return offers;
  }

  async #prepare(record, compiled, chooser) {
    const offers = await this.#offers(compiled, record, "pre-cast");
    if (record.state !== "preparing") throw new Error("The broker request is no longer active.");
    if (!offers.length) {
      record.state = "unmodified";
      this.#archive(record);
      return true;
    }
    const pool = record.actor.items.get(compiled.resourceId);
    const resource = {
      id: compiled.resourceId,
      uuid: compiled.resourceUuid,
      current: Number(pool?.system?.uses?.value),
      max: Number(pool?.system?.uses?.max)
    };
    if (!Number.isFinite(resource.max)) resource.max = resource.current;
    const rawDecision = await chooser({
      casting: this.#snapshot(record),
      phase: "pre-cast",
      closeOutcome: "abort",
      offers: clone(offers),
      resource: clone(resource),
      selectionLimit: compiled.selectionLimit
    });
    if (record.state !== "preparing") throw new Error("The broker request is no longer active.");

    const decision = Array.isArray(rawDecision)
      ? { outcome: rawDecision.length ? "confirm" : "decline", selectedIds: rawDecision }
      : rawDecision && typeof rawDecision === "object"
        ? { outcome: rawDecision.outcome, selectedIds: rawDecision.selectedIds ?? [] }
        : { outcome: "decline", selectedIds: [] };

    if (decision.outcome === "abort") {
      record.state = "rejected";
      record.error = "Casting aborted from the modifier chooser.";
      this.#archive(record);
      return false;
    }
    if (!["confirm", "decline"].includes(decision.outcome)) throw new Error("Invalid modifier chooser outcome.");
    const selectedIds = decision.outcome === "confirm" ? decision.selectedIds : [];
    const selectedOffers = Array.isArray(selectedIds)
      ? selectedIds.map(id => offers.find(offer => offer.id === id && !offer.disabled))
      : [];
    if (!Array.isArray(selectedIds) || new Set(selectedIds).size !== selectedIds.length
      || selectedOffers.some(option => !option) || selectionCost(selectedOffers) > compiled.selectionLimit) {
      throw new Error("Invalid modifier selection.");
    }
    if (!selectedIds.length) {
      record.state = "unmodified";
      this.#archive(record);
      return true;
    }
    // Re-read after awaiting the chooser: grants, attunement, prices and pool may have changed.
    const current = this.#declarations.compile(record.actor, this.#context(record.workflow));
    if (!this.#sameBase(current, record)) throw new Error("Caster declarations changed while choosing.");
    const fresh = await this.#offers(current, record);
    const currentSelections = selectedIds.map(id => fresh.find(entry => entry.id === id));
    if (currentSelections.some(option => !option) || selectionCost(currentSelections) > current.selectionLimit) {
      throw new Error("Caster declarations changed while choosing.");
    }
    for (const id of selectedIds) {
      const option = fresh.find(entry => entry.id === id);
      const offered = offers.find(entry => entry.id === id);
      if (!option || option.disabled || !this.#sameOption(option, offered)) throw new Error("An option changed while choosing; cast again to review it.");
      const prepared = await this.#optionResult(option, "prepare", record);
      if (record.state !== "preparing") throw new Error("The broker request is no longer active.");
      if (!prepared || typeof prepared !== "object") throw new Error("Option did not return casting-local updates.");
      if (prepared.activityUpdates !== undefined && (!prepared.activityUpdates || typeof prepared.activityUpdates !== "object" || Array.isArray(prepared.activityUpdates))) throw new Error("Invalid Activity updates.");
      if (prepared.itemUpdates !== undefined && (!prepared.itemUpdates || typeof prepared.itemUpdates !== "object" || Array.isArray(prepared.itemUpdates))) throw new Error("Invalid Item updates.");
      if (prepared.effectUpdates !== undefined && (!prepared.effectUpdates || typeof prepared.effectUpdates !== "object" || Array.isArray(prepared.effectUpdates))) throw new Error("Invalid Effect updates.");
      if (!Object.keys(prepared.activityUpdates ?? {}).length && !Object.keys(prepared.itemUpdates ?? {}).length && !Object.keys(prepared.effectUpdates ?? {}).length) throw new Error("Option did not return casting-local updates.");
      for (const [path, value] of Object.entries(prepared.activityUpdates ?? {})) {
        if (!path || /(^|\.)(__proto__|prototype|constructor|_id|consumption|flags)(\.|$)/.test(path)
          || path in record.activityUpdates) throw new Error("Conflicting or reserved Activity update.");
        record.activityUpdates[path] = clone(value);
      }
      for (const [path, value] of Object.entries(prepared.itemUpdates ?? {})) {
        // Explicitly allow only verified casting-local Item fields.
        if (!["system.duration.value", "system.duration.units", "system.properties"].includes(path)
          || path in record.itemUpdates) throw new Error("Conflicting or unsupported casting-local Item update.");
        if (path === "system.duration.value" && (!Number.isSafeInteger(value) || value <= 0)) throw new Error("Invalid spell duration value.");
        if (path === "system.duration.units" && !["round", "minute", "hour", "day"].includes(value)) throw new Error("Invalid spell duration units.");
        if (path === "system.properties") {
          const original = record.actor.items.get(record.workflow.activity.item.id);
          validateSpellPropertyUpdate(original, value);
        }
        record.itemUpdates[path] = clone(value);
      }
      // Validate all Effect IDs against the selected casting Activity and detached Item.
      const item = record.workflow.activity.item;
      const source = record.actor.items.get(item.id);
      const references = Array.from(record.workflow.activity.effects ?? []);
      for (const [effectId, changes] of Object.entries(prepared.effectUpdates ?? {})) {
        if (!/^[a-zA-Z0-9]{16}$/.test(effectId) || effectId in record.effectUpdates
          || !changes || typeof changes !== "object" || Array.isArray(changes)
          || !Object.keys(changes).length) throw new Error("Invalid or conflicting Effect update.");
        if (!references.some(ref => ref?._id === effectId && !ref.uuid)) throw new Error("Effect is not referenced by this Activity.");
        const effect = item.effects?.get(effectId);
        const original = source?.effects?.get(effectId);
        if (!effect || !original || effect === original || effect.parent !== item || source === item)
          throw new Error("Casting-local embedded Effect isolation failed.");
        for (const [path, value] of Object.entries(changes)) {
          if (!["duration.value", "duration.units"].includes(path)) throw new Error("Unsupported Effect update path.");
          if (path === "duration.value" && (!Number.isSafeInteger(value) || value <= 0)) throw new Error("Invalid Effect duration value.");
          if (path === "duration.units" && !["seconds", "minutes", "hours", "days", "rounds", "turns"].includes(value))
            throw new Error("Invalid Effect duration unit.");
        }
        record.effectUpdates[effectId] = clone(changes);
      }
      record.selected.push(clone(option));
      record.totalCost += option.cost;
    }
    const currentPool = record.actor.items.get(record.resourceId);
    if (record.totalCost > Number(currentPool?.system?.uses?.value)) throw new Error("Combined option cost is unaffordable.");
    if (!this.#applyActivity(record, record.workflow.activity, "selected")) throw new Error(record.error);
    record.state = "selected";
    this.#remember(record);
    return true;
  }

  #sameBase(compiled, record) {
    return compiled.ready && compiled.resourceUuid === record.resourceUuid
      && compiled.mainIdentity === record.mainIdentity;
  }

  #sameOption(option, previous) {
    return option.sourceUuid === previous.sourceUuid && option.identity === previous.identity && option.cost === previous.cost
      && JSON.stringify(option.declaration) === JSON.stringify(previous.declaration)
      && JSON.stringify(option.provenance) === JSON.stringify(previous.provenance)
      && JSON.stringify(option.adjustments) === JSON.stringify(previous.adjustments);
  }

  #nativeRecord(activity) {
    const tag = marker(activity);
    const record = this.#records.get(tag?.castingId)?.deref();
    return record && tag.initiatorUserId === game.user.id && record.executionUserId === game.user.id
      && activity.actor?.uuid === record.casterActorUuid && activity.id === record.sourceActivityId ? record : null;
  }

  #veto(record, reason) {
    record.error = reason;
    globalThis.ui?.notifications?.warn?.(`AE5E: ${reason}`);
    return false;
  }

  #captureActivity(record, activity, stage) {
    const values = subject => Object.fromEntries(Object.keys(record.activityUpdates).map(path => [path, clone(property(subject, path))]));
    const item = activity.item;
    const current = item.system?.activities?.get?.(activity.id) ?? activity;
    const raw = item._source?.system?.activities?.[activity.id]
      ?? property(item, `system.activities.${activity.id}`);
    record.activityChecks.push({ stage, expected: clone(record.activityUpdates),
      receiver: values(activity), prepared: values(current), parentSource: raw ? values(raw) : null,
      workflow: values(record.workflow.activity), itemRange: clone(item.system?.range ?? null) });
    record.activityChecks = record.activityChecks.slice(-8);
  }

  #verifyEffects(record, item) {
    const source = record.actor.items.get(item.id);
    if (!source || source === item) return false;
    for (const [id, changes] of Object.entries(record.effectUpdates)) {
      const effect = item.effects?.get(id);
      const original = source.effects?.get(id);
      if (!effect || !original || effect === original || effect.parent !== item) return false;
      if (Object.entries(changes).some(([path, expected]) =>
        JSON.stringify(property(effect, path)) !== JSON.stringify(expected))) return false;
    }
    return true;
  }

  #applyActivity(record, activity, stage, extraUpdates = {}) {
    const item = activity.item;
    if (record.actor.items.get(item.id) === item) return this.#veto(record, "A source Item cannot receive casting-local changes.");
    const updates = { ...record.activityUpdates, ...extraUpdates };
    const parentUpdates = Object.fromEntries(Object.entries(updates).map(([path, value]) => [
      `system.activities.${activity.id}.${path}`, clone(value)
    ]));
    // Apply only to the verified detached casting Item; never its actor-owned source.
    for (const [path, value] of Object.entries(record.itemUpdates)) parentUpdates[path] = clone(value);
    // Stage 0's verified path patches both ranges on this unsaved casting copy.
    // Midi falls back to Item range when a live Activity loses override metadata.
    if (record.activityUpdates["range.override"] === true) {
      for (const [path, value] of Object.entries(record.activityUpdates)) {
        if (path.startsWith("range.") && path !== "range.override") parentUpdates[`system.${path}`] = clone(value);
      }
    }
    parentUpdates[`flags.${MODULE_ID}.${CAST_FLAG}`] = {
      version: 1, castingId: record.castingId, initiatorUserId: record.initiatorUserId
    };
    try {
      // Item flags/scaling can reconstruct Activities. Persist the patch in the
      // local parent's source together with the marker before touching receivers.
      const actor = item.actor;
      const hadPreparationFlag = actor && Object.hasOwn(actor, "_embeddedPreparation");
      const previousPreparationFlag = actor?._embeddedPreparation;
      try {
        if (actor) actor._embeddedPreparation = true;
        item.updateSource(parentUpdates);
      } finally {
        if (actor) {
          if (hadPreparationFlag) actor._embeddedPreparation = previousPreparationFlag;
          else delete actor._embeddedPreparation;
        }
      }
      const prepared = item.system?.activities?.get?.(activity.id);
      const receivers = new Set([activity, prepared].filter(Boolean));
      if (record.workflow.activity?.item === item && record.workflow.activity.id === activity.id) receivers.add(record.workflow.activity);
      // Parent updates already contain the fresh child's patch. Only obsolete
      // receivers need their detached source updated. Updating a prepared child
      // afterward would undo FormulaField evaluation (60 becomes source "60").
      for (const receiver of receivers) if (receiver !== prepared) receiver.updateSource(updates);
      item.prepareFinalAttributes?.();
      for (const receiver of receivers) if (receiver !== prepared) receiver.prepareFinalData?.();
      // Active Effects are embedded Documents, not Activity properties. Update
      // only detached effects on this casting Item and verify their live values.
      const originalItem = record.actor.items.get(item.id);
      const referencedIds = new Set(Array.from(activity.effects ?? [])
        .filter(ref => ref?._id && !ref.uuid).map(ref => ref._id));
      for (const [id, changes] of Object.entries(record.effectUpdates)) {
        const effect = item.effects?.get(id);
        const original = originalItem?.effects?.get(id);
        if (!referencedIds.has(id) || !effect || !original || effect === original || effect.parent !== item)
          return this.#veto(record, "Casting-local Effect reference or isolation was lost.");
        effect.updateSource(clone(changes));
      }
      if (!this.#verifyEffects(record, item))
        return this.#veto(record, "Casting-local Effect duration updates were not retained.");
      for (const [path, expected] of Object.entries(record.itemUpdates)) {
        if (!itemUpdateMatches(item, path, expected)) {
          return this.#veto(record, `The casting-local Item did not retain '${path}'; casting was stopped.`);
        }
      }
      this.#captureActivity(record, activity, stage);
      for (const receiver of receivers) {
        for (const [path, expected] of Object.entries(record.activityUpdates)) {
          if (JSON.stringify(property(receiver, path)) !== JSON.stringify(expected)) {
            return this.#veto(record, `The casting-local Activity did not retain '${path}'; ${record.nativeDebit
              ? "native consumption has occurred and modifier completion is unconfirmed."
              : "casting was stopped before payment."}`);
          }
        }
      }
      return true;
    } catch (error) {
      return this.#veto(record, `Casting-local Activity preparation failed: ${error.message}`);
    }
  }

  prepareNative(activity) {
    const record = this.#nativeRecord(activity);
    if (!record) return !marker(activity);
    if (!["selected", "native-prepared"].includes(record.state)) return false;
    if (record.actor.items.get(activity.item.id) === activity.item) return this.#veto(record, "A source Activity cannot receive casting-local changes.");
    if (!this.#applyActivity(record, activity, "native-prepared")) return false;
    record.state = "native-prepared";
    this.#remember(record);
    return true;
  }

  prepareConsumption(activity, usage, message = null) {
    const record = this.#nativeRecord(activity);
    if (!record) return !marker(activity);
    if (!["selected", "native-prepared"].includes(record.state) || record.nativeDebit) return false;
    if (record.actor.items.get(activity.item.id) === activity.item) return this.#veto(record, "Native consumption requires the casting-local Activity copy.");
    const pool = record.actor.items.get(record.resourceId);
    if (!pool || !Number.isFinite(Number(pool.system?.uses?.value)) || record.totalCost > Number(pool.system?.uses?.value)) {
      return this.#veto(record, "The point pool is missing or no longer affordable; cast again.");
    }
    const current = this.#declarations.compile(record.actor, this.#context(record.workflow));
    if (!this.#sameBase(current, record) || selectionCost(record.selected) > current.selectionLimit
      || record.selected.some(selected => !current.options.some(option => option.id === selected.id
        && this.#sameOption(option, selected)))) {
      return this.#veto(record, "Option access or price changed during native spell configuration; cast again.");
    }
    const linked = usage.cause?.activity ? activity.getLinkedActivity?.(usage.cause.activity) : null;
    if (linked?.consumption?.targets?.some(target => target.type === "itemUses" && target.target === record.resourceId)) {
      return this.#veto(record, "The linked Activity already consumes this point pool; a combined-cost adapter is required.");
    }
    // One native target for the aggregate modifier price. Do not implement a second debit/refund engine.
    let index = record.consumptionIndexes.get(activity.item);
    const extraUpdates = {};
    if (index == null && record.totalCost > 0) {
      const targets = activity.consumption.targets.map(target => target.toObject ? target.toObject() : clone(target));
      if (targets.some(target => target.type === "itemUses" && target.target === record.resourceId)) {
        return this.#veto(record, "The spell already consumes the same point pool; a combined-cost adapter is required.");
      }
      index = targets.length;
      targets.push({ type: "itemUses", target: record.resourceId, value: String(record.totalCost), scaling: { mode: "", formula: "" } });
      extraUpdates["consumption.targets"] = targets;
    }
    if (!this.#applyActivity(record, activity, "pre-consumption", extraUpdates)) return false;
    if (index != null) record.consumptionIndexes.set(activity.item, index);
    if (index != null) {
      if (usage.consume === false) usage.consume = { action: false, spellSlot: false, resources: [index] };
      else if (usage.consume !== true) {
        usage.consume ??= {};
        if (usage.consume.resources !== true) usage.consume.resources = [...new Set([...(usage.consume.resources || []), index])];
      }
      usage.hasConsumption = true;
      if (message) message.hasConsumption = true;
    }
    record.provenance.cause = usage.cause?.activity ?? null;
    record.nativeActivities.add(activity);
    this.#remember(record);
    return true;
  }

  validateConsumption(activity, updates) {
    const record = this.#nativeRecord(activity);
    if (!record) return !marker(activity);
    if (!record.nativeActivities.has(activity) || record.nativeDebit) return false;
    const prepared = activity.item.system?.activities?.get?.(activity.id) ?? activity;
    if (!this.#verifyEffects(record, activity.item))
      return this.#veto(record, "Selected Effect changes were lost before native consumption; no modifier payment was accepted.");
    if (Object.entries(record.itemUpdates).some(([path, expected]) =>
      !itemUpdateMatches(activity.item, path, expected))) {
      return this.#veto(record, "Selected Item changes were lost before native consumption; no modifier payment was accepted.");
    }
    for (const receiver of [activity, prepared, record.workflow.activity]) {
      if (Object.entries(record.activityUpdates).some(([path, expected]) => JSON.stringify(property(receiver, path)) !== JSON.stringify(expected))) {
        this.#captureActivity(record, activity, "pre-write-mismatch");
        this.#remember(record);
        return this.#veto(record, "Selected Activity changes were lost before native consumption; no modifier payment was accepted.");
      }
    }
    if (!record.totalCost) return true;
    const pool = record.actor.items.get(record.resourceId);
    const changes = updates.item?.filter(update => update._id === pool?.id) ?? [];
    const valid = changes.length === 1 && !updates.delete?.includes(pool.id)
      && changes[0]["system.uses.spent"] === Number(pool.system.uses.spent) + record.totalCost;
    return valid || this.#veto(record, "The proposed native point debit does not match the selected modifier cost.");
  }

  recordConsumption(activity, message) {
    const record = this.#nativeRecord(activity);
    if (!record) return;
    if (record.nativeDebit) return record.consumptionNotification;
    record.nativeDebit = { resourceUuid: record.resourceUuid, amount: record.totalCost,
      deltas: clone(message?.data?.system?.deltas ?? null), owner: "native-activity" };
    record.state = "consumed";
    this.#captureActivity(record, activity, "post-consumption");
    this.#remember(record);
    if (message?.data) {
      message.data.flags ??= {};
      message.data.flags[MODULE_ID] ??= {};
      message.data.flags[MODULE_ID].castingReceipt = this.#snapshot(record);
    }
    record.consumptionNotification = this.#notifyConsumption(record);
    return record.consumptionNotification;
  }

  async #notifyConsumption(record) {
    const context = {
      castingId: record.castingId, actor: record.actor, workflow: record.workflow,
      activity: record.workflow.activity, item: record.workflow.activity.item,
      initiatorUserId: record.initiatorUserId, casting: this.#snapshot(record)
    };
    const requests = [
      { ...record.broker, kind: "broker", amount: record.nativeDebit.amount },
      ...record.selected.map(option => ({ sourceUuid: option.sourceUuid, identity: option.identity,
        declaration: option.declaration, kind: "option", amount: option.cost }))
    ];
    for (const { amount, ...request } of requests) {
      try {
        await this.#executors.notify({ ...request, actor: record.actor, family: "metamagic", phase: "consumed",
          context: { ...context, consumption: { ...clone(record.nativeDebit), amount, totalAmount: record.nativeDebit.amount } } });
      } catch (error) {
        try { Logger.warn("Item lifecycle notification failed; native consumption was retained.", error); }
        catch { /* Notification/console failures must never change native resolution. */ }
      }
    }
  }

  async #notifyCommitted(record, options = record.selected) {
    const context = {
      castingId: record.castingId,
      actor: record.actor,
      workflow: record.workflow,
      activity: record.workflow.activity,
      item: record.workflow.activity.item,
      initiatorUserId: record.initiatorUserId,
      casting: this.#snapshot(record)
    };
    for (const option of options) {
      try {
        await this.#executors.notify({
          actor: record.actor,
          sourceUuid: option.sourceUuid,
          identity: option.identity,
          family: "metamagic",
          declaration: option.declaration,
          kind: "option",
          phase: "committed",
          context
        });
      } catch (error) {
        try { Logger.warn("Item committed lifecycle notification failed; the native cast remains committed.", error); }
        catch { /* Notification/console failures must never change native resolution. */ }
      }
    }
  }

  observeNative(activity) {
    const record = this.#nativeRecord(activity);
    if (!record) return true;
    this.#captureActivity(record, activity, "post-use-before");
    const receivers = new Set([activity, record.workflow.activity].filter(receiver => this.#nativeRecord(receiver) === record));
    for (const receiver of receivers) {
      const changed = Object.entries(record.activityUpdates).some(([path, expected]) => {
        // Native preparation may omit this metadata from the held live range.
        // Accept that only when source intent, live values AND the Item fallback
        // all retain the selection. Pre-payment validation remains strict.
        if (path === "range.override" && expected === true && receiver.range?.override === undefined
          && receiver._source?.range?.override === true) {
          const fields = Object.entries(record.activityUpdates).filter(([key]) => key.startsWith("range.") && key !== path);
          if (fields.length && fields.every(([key, value]) =>
            JSON.stringify(property(receiver, key)) === JSON.stringify(value)
            && JSON.stringify(property(receiver.item.system, key)) === JSON.stringify(value))) return false;
        }
        // D&D5e can likewise omit activation.override from the held post-use
        // receiver while the selected activation remains mechanically effective.
        // Treat only that exact metadata-loss shape as intact: the receiver's
        // own source must still prove override intent and both source/live values
        // must retain every selected activation field. Pre-payment checks stay strict.
        if (path === "activation.override" && expected === true && receiver.activation?.override === undefined) {
          const source = receiver.item?._source?.system?.activities?.[receiver.id]
            ?? property(receiver.item, `system.activities.${receiver.id}`);
          const fields = Object.entries(record.activityUpdates).filter(([key]) => key.startsWith("activation.") && key !== path);
          if (property(source, path) === true && fields.length && fields.every(([key, value]) =>
            JSON.stringify(property(receiver, key)) === JSON.stringify(value)
            && JSON.stringify(property(source, key)) === JSON.stringify(value))) return false;
        }
        return JSON.stringify(property(receiver, path)) !== JSON.stringify(expected);
      });
      if (changed && !this.#applyActivity(record, receiver, "post-use-restored")) {
        record.postUseMutationFailed = true;
        this.#remember(record);
        // Native post-use false suppresses subsequent actions; it does not refund.
        return false;
      }
    }
    this.#captureActivity(record, activity, "post-use");
    this.#remember(record);
    return true;
  }

  async commit(workflow) {
    const record = this.#byWorkflow.get(workflow);
    if (!record || record.state === "unmodified" || record.state === "rejected" || record.committedAt) return true;
    if (record.postUseMutationFailed) return this.#veto(record, "Modifier preparation failed after native consumption; completion is unconfirmed and resource recovery requires the native owner.");
    if (!record.nativeDebit) {
      record.error = "Native consumption confirmation is missing; do not resolve a paid modifier.";
      globalThis.ui?.notifications?.error?.(`AE5E: ${record.error}`);
      return false;
    }
    record.state = "committed";
    record.committedAt = new Date().toISOString();
    record.targets = [...(workflow.targets ?? [])].map(target => ({
      tokenUuid: target.document?.uuid ?? target.uuid ?? null, actorUuid: target.actor?.uuid ?? null
    }));
    this.#remember(record);
    await this.#notifyCommitted(record);
    await this.#present(record, "Cast");
    return true;
  }

  async complete(workflow) {
    this.restoreLateSaveProtection(workflow);
    await this.#persistSaveDisadvantage(workflow);
    this.#saveDisadvantage.finish(workflow);
    const record = this.#byWorkflow.get(workflow);
    if (!record || ["completed", "unmodified", "rejected"].includes(record.state)) return true;
    // A terminal flag without a committed transition is not proof of refundable cancellation.
    record.state = record.committedAt ? "completed" : "unconfirmed";
    await this.#present(record, record.committedAt ? "Resolved" : "Unconfirmed");
    this.#archive(record);
    return true;
  }

  async #persistSaveDisadvantage(workflow) {
    try { await this.#saveDisadvantage.persist(workflow); }
    catch (error) {
      Logger.warn("Persistent save-disadvantage application failed.", error);
      globalThis.ui?.notifications?.error?.(`AE5E: ${error.message}`);
    }
  }

  async #present(record, outcome) {
    const presentation = record.selected[0]?.declaration.presentation;
    try {
      const message = this.#cards?.message?.(record.workflow);
      if (message?.isOwner) await message.update({ [`flags.${MODULE_ID}.castingReceipt`]: this.#snapshot(record) });
      if (!presentation?.html || !this.#cards) return;
      const result = await this.#cards.upsertContribution(record.workflow, {
        id: `casting-${record.castingId}`, html: presentation.html,
        data: { options: record.selected.map(entry => entry.label).join(", "), cost: record.totalCost, outcome },
        slot: "modifications"
      });
      record.presentation = clone(result);
    } catch (error) {
      record.presentation = { updated: false, reason: error.message };
      Logger.warn("Cast receipt presentation failed; native resolution was retained.", error);
    }
  }

  #snapshot(record) {
    const { workflow, actor, preparing, nativeActivities, consumptionIndexes, broker, consumptionNotification, ...data } = record;
    return clone(data);
  }

  #remember(record) {
    this.#recent = this.#recent.filter(entry => entry.castingId !== record.castingId);
    this.#recent.unshift(this.#snapshot(record));
    this.#recent.length = Math.min(this.#recent.length, 100);
  }

  #archive(record) {
    this.#records.delete(record.castingId);
    this.#remember(record);
  }
}
