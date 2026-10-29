import { MODULE_ID } from "../core/constants.js";
import { duplicateSafely, randomId } from "../core/utils.js";
import { Logger } from "../core/logger.js";

const CAST_FLAG = "casting";
const clone = value => duplicateSafely(value);
const marker = activity => activity?.item?.flags?.[MODULE_ID]?.[CAST_FLAG];
const property = (object, path) => path.split(".").reduce((value, key) => value?.[key], object);
const workflowFrom = args => args.flatMap(value => [value, value?.workflow, value?.config?.workflow, value?.usage?.workflow])
  .find(value => value?.actor && value?.activity);

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

  constructor({ declarations, cards, executors }) {
    this.#declarations = declarations;
    this.#cards = cards;
    this.#executors = executors;
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

  eventIdentity(castingId, { phase, targetActorUuid = null, targetTokenUuid = null, rollId = null } = {}) {
    if (!castingId || !phase) throw new Error("Casting and phase identity are required.");
    return JSON.stringify([castingId, phase, targetActorUuid, targetTokenUuid, rollId]);
  }

  async begin(workflow, options = {}) {
    if (!workflow) return true;
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
      selected: [], totalCost: 0, activityUpdates: {}, itemUpdates: {}, activityChecks: [], nativeDebit: null,
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
          }
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
    if (!Array.isArray(selectedIds) || new Set(selectedIds).size !== selectedIds.length
      || selectedIds.length > compiled.selectionLimit || selectedIds.some(id => !offers.some(offer => offer.id === id && !offer.disabled))) {
      throw new Error("Invalid modifier selection.");
    }
    if (!selectedIds.length) {
      record.state = "unmodified";
      this.#archive(record);
      return true;
    }
    // Re-read after awaiting the chooser: grants, attunement, prices and pool may have changed.
    const current = this.#declarations.compile(record.actor, this.#context(record.workflow));
    if (!this.#sameBase(current, record) || selectedIds.length > current.selectionLimit) throw new Error("Caster declarations changed while choosing.");
    const fresh = await this.#offers(current, record);
    for (const id of selectedIds) {
      const option = fresh.find(entry => entry.id === id);
      const offered = offers.find(entry => entry.id === id);
      if (!option || option.disabled || !this.#sameOption(option, offered)) throw new Error("An option changed while choosing; cast again to review it.");
      const prepared = await this.#optionResult(option, "prepare", record);
      if (record.state !== "preparing") throw new Error("The broker request is no longer active.");
      if (!prepared || typeof prepared !== "object") throw new Error("Option did not return casting-local updates.");
      if (prepared.activityUpdates !== undefined && (!prepared.activityUpdates || typeof prepared.activityUpdates !== "object" || Array.isArray(prepared.activityUpdates))) throw new Error("Invalid Activity updates.");
      if (prepared.itemUpdates !== undefined && (!prepared.itemUpdates || typeof prepared.itemUpdates !== "object" || Array.isArray(prepared.itemUpdates))) throw new Error("Invalid Item updates.");
      if (!Object.keys(prepared.activityUpdates ?? {}).length && !Object.keys(prepared.itemUpdates ?? {}).length) throw new Error("Option did not return casting-local updates.");
      for (const [path, value] of Object.entries(prepared.activityUpdates ?? {})) {
        if (!path || /(^|\.)(__proto__|prototype|constructor|_id|consumption|flags)(\.|$)/.test(path)
          || path in record.activityUpdates) throw new Error("Conflicting or reserved Activity update.");
        record.activityUpdates[path] = clone(value);
      }
      for (const [path, value] of Object.entries(prepared.itemUpdates ?? {})) {
        // Item updates are intentionally narrow. Duration is the first consumer;
        // broaden the allowlist only after separately verified casting-local use.
        if (!["system.duration.value", "system.duration.units"].includes(path)
          || path in record.itemUpdates) throw new Error("Conflicting or unsupported casting-local Item update.");
        if (path === "system.duration.value" && (!Number.isSafeInteger(value) || value <= 0)) throw new Error("Invalid spell duration value.");
        if (path === "system.duration.units" && !["round", "minute", "hour", "day"].includes(value)) throw new Error("Invalid spell duration units.");
        record.itemUpdates[path] = clone(value);
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
      for (const [path, expected] of Object.entries(record.itemUpdates)) {
        if (JSON.stringify(property(item, path)) !== JSON.stringify(expected)) {
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
    if (!this.#sameBase(current, record) || record.selected.length > current.selectionLimit
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
    if (Object.entries(record.itemUpdates).some(([path, expected]) =>
      JSON.stringify(property(activity.item, path)) !== JSON.stringify(expected))) {
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

  async #notifyCommitted(record) {
    const context = {
      castingId: record.castingId,
      actor: record.actor,
      workflow: record.workflow,
      activity: record.workflow.activity,
      item: record.workflow.activity.item,
      initiatorUserId: record.initiatorUserId,
      casting: this.#snapshot(record)
    };
    for (const option of record.selected) {
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
    const record = this.#byWorkflow.get(workflow);
    if (!record || ["completed", "unmodified", "rejected"].includes(record.state)) return true;
    // A terminal flag without a committed transition is not proof of refundable cancellation.
    record.state = record.committedAt ? "completed" : "unconfirmed";
    await this.#present(record, record.committedAt ? "Resolved" : "Unconfirmed");
    this.#archive(record);
    return true;
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
