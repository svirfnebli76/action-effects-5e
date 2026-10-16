import { MODULE_ID, SELECTION_INDICATOR_ROLES } from "../core/constants.js";
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
  #prompts;
  #cards;
  #resolve;
  #byWorkflow = new WeakMap();
  #records = new Map();
  #recent = [];
  #hooks = [];

  constructor({ declarations, prompts, cards, resolve = uuid => globalThis.fromUuid(uuid) }) {
    this.#declarations = declarations;
    this.#prompts = prompts;
    this.#cards = cards;
    this.#resolve = resolve;
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

  async begin(workflow, { chooser = null, initiatorUserId = game.user.id, parentCastingId = null, continuation = false } = {}) {
    if (!workflow || (workflow.item ?? workflow.activity?.item)?.type !== "spell") return true;
    if (initiatorUserId !== game.user.id || (workflow.userId && workflow.userId !== game.user.id)) return true;
    const actor = workflow.actor ?? workflow.item?.actor ?? workflow.activity?.actor;
    // No declarations means no participation, not an error for ordinary casts.
    if (![...(actor?.items ?? [])].some(item => {
      const raw = item.flags?.[MODULE_ID]?.metamagic;
      return raw?.type === "main" && raw.enabled !== false;
    })) return true;
    const existing = this.#byWorkflow.get(workflow);
    if (existing) return existing.preparing ?? existing.state !== "rejected";
    if (!actor?.isOwner) throw new Error("The initiating user must own the caster.");
    if (continuation || parentCastingId) throw new Error("Continuation execution requires a validated parent adapter and is not enabled in this first slice.");
    const compiled = this.#declarations.compile(actor);
    if (!compiled.ready) throw new Error(compiled.diagnostics.map(entry => entry.message).join(" "));
    const activity = workflow.activity;
    const item = activity?.item;
    if (!item?.updateSource || !activity?.updateSource || actor.items.get(item.id) === item) {
      throw new Error("Casting-local Activity/Item copy is unavailable; source Items must remain unchanged.");
    }
    const record = {
      version: 1, runtimeRevision: "activity-source-bridge-2", castingId: randomId(), parentCastingId: null, state: "preparing",
      initiatorUserId, controllerUserId: initiatorUserId, executionUserId: game.user.id,
      casterActorUuid: actor.uuid, casterTokenUuid: workflow.token?.document?.uuid ?? workflow.token?.uuid ?? null,
      sourceItemUuid: actor.items.get(item.id)?.uuid ?? item.uuid, sourceActivityId: activity.id,
      provenance: { cachedFor: item.flags?.dnd5e?.cachedFor ?? null, cause: null },
      resourceId: compiled.resourceId, resourceUuid: compiled.resourceUuid,
      selected: [], totalCost: 0, activityUpdates: {}, activityChecks: [], nativeDebit: null,
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

  async #optionResult(option, phase, record) {
    const macro = await this.#resolve(option.declaration.execution.macroUuid);
    if (macro?.documentName !== "Macro" || typeof macro.execute !== "function"
      || macro.type !== "script" || macro.canExecute === false) throw new Error(`Executable unavailable for ${option.label}.`);
    return macro.execute({
      phase, declaration: clone(option.declaration),
      context: { castingId: record.castingId, actor: record.actor, workflow: record.workflow,
        activity: record.workflow.activity, item: record.workflow.activity.item,
        initiatorUserId: record.initiatorUserId }
    });
  }

  async #offers(compiled, record) {
    const pool = record.actor.items.get(compiled.resourceId);
    const available = Number(pool?.system?.uses?.value);
    if (!Number.isFinite(available) || pool.system.uses.autoDestroy) throw new Error("Native point pool has invalid uses or automatic destruction enabled.");
    const offers = [];
    for (const option of compiled.options) {
      let result;
      try { result = await this.#optionResult(option, "offer", record); }
      catch (error) { result = { eligible: false, reason: error.message }; }
      const reason = result?.eligible !== true ? result?.reason ?? "Not eligible for this casting."
        : option.cost > available ? "Not enough Sorcery Points." : null;
      offers.push({ ...option, available, disabled: Boolean(reason), reason });
    }
    return offers;
  }

  async #prepare(record, compiled, chooser) {
    const offers = await this.#offers(compiled, record);
    let selectedIds = [];
    if (chooser) selectedIds = await chooser({ casting: this.#snapshot(record), offers: clone(offers), selectionLimit: compiled.selectionLimit });
    else {
      // Reuse the existing controller-routed prompt and its indicator/audio lease.
      while (selectedIds.length < compiled.selectionLimit) {
        const spent = offers.filter(entry => selectedIds.includes(entry.id)).reduce((sum, entry) => sum + entry.cost, 0);
        const remaining = offers.filter(entry => !selectedIds.includes(entry.id));
        if (!remaining.length) break;
        const id = await this.#prompts.choose({
          actor: record.actor, tokenUuid: record.casterTokenUuid, controllerUserId: record.controllerUserId,
          role: SELECTION_INDICATOR_ROLES.ORIGINATOR, title: "Metamagic", prompt: "Choose an option, or continue casting without another option.",
          reason: "metamagic-choice", allowCancel: true, cancelLabel: "Continue casting",
          choices: remaining.map(offer => ({ id: offer.id, label: offer.label,
            detail: `${offer.cost} Sorcery Point(s). ${offer.declaration.tooltip}${offer.reason ? ` ${offer.reason}` : ""}`,
            disabled: offer.disabled || spent + offer.cost > offer.available }))
            .concat({ id: "__finish", label: "Continue casting" }),
          defaultChoiceId: "__finish"
        });
        if (id == null || id === "__finish") break;
        selectedIds.push(id);
      }
    }
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
    const current = this.#declarations.compile(record.actor);
    if (!current.ready || current.resourceUuid !== record.resourceUuid || selectedIds.length > current.selectionLimit) throw new Error("Caster declarations changed while choosing.");
    const fresh = await this.#offers(current, record);
    for (const id of selectedIds) {
      const option = fresh.find(entry => entry.id === id);
      const offered = offers.find(entry => entry.id === id);
      if (!option || option.disabled || JSON.stringify(option.declaration) !== JSON.stringify(offered.declaration)
        || option.sourceUuid !== offered.sourceUuid || option.cost !== offered.cost) throw new Error("An option changed while choosing; cast again to review it.");
      const prepared = await this.#optionResult(option, "prepare", record);
      if (!prepared?.activityUpdates || typeof prepared.activityUpdates !== "object" || Array.isArray(prepared.activityUpdates)) throw new Error("Option did not return Activity updates.");
      for (const [path, value] of Object.entries(prepared.activityUpdates)) {
        if (!path || /(^|\.)(__proto__|prototype|constructor|_id|consumption|flags)(\.|$)/.test(path)
          || path in record.activityUpdates) throw new Error("Conflicting or reserved Activity update.");
        record.activityUpdates[path] = clone(value);
      }
      record.selected.push(clone(option));
      record.totalCost += option.cost;
    }
    const pool = record.actor.items.get(record.resourceId);
    if (record.totalCost > Number(pool?.system?.uses?.value)) throw new Error("Combined option cost is unaffordable.");
    if (!this.#applyActivity(record, record.workflow.activity, "selected")) throw new Error(record.error);
    record.state = "selected";
    this.#remember(record);
    return true;
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
      workflow: values(record.workflow.activity) });
    record.activityChecks = record.activityChecks.slice(-8);
  }

  #applyActivity(record, activity, stage, extraUpdates = {}) {
    const item = activity.item;
    if (record.actor.items.get(item.id) === item) return this.#veto(record, "A source Item cannot receive casting-local changes.");
    const updates = { ...record.activityUpdates, ...extraUpdates };
    const parentUpdates = Object.fromEntries(Object.entries(updates).map(([path, value]) => [
      `system.activities.${activity.id}.${path}`, clone(value)
    ]));
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
      this.#captureActivity(record, activity, stage);
      for (const receiver of receivers) {
        for (const [path, expected] of Object.entries(record.activityUpdates)) {
          if (JSON.stringify(property(receiver, path)) !== JSON.stringify(expected)) {
            return this.#veto(record, `The casting-local Activity did not retain '${path}'; casting was stopped before payment.`);
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
    const current = this.#declarations.compile(record.actor);
    if (!current.ready || current.resourceUuid !== record.resourceUuid || record.selected.length > current.selectionLimit
      || record.selected.some(selected => !current.options.some(option => option.id === selected.id
        && option.sourceUuid === selected.sourceUuid && option.cost === selected.cost
        && JSON.stringify(option.declaration) === JSON.stringify(selected.declaration)))) {
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
  }

  observeNative(activity) {
    const record = this.#nativeRecord(activity);
    if (!record) return true;
    this.#captureActivity(record, activity, "post-use");
    this.#remember(record);
    return true;
  }

  async commit(workflow) {
    const record = this.#byWorkflow.get(workflow);
    if (!record || record.state === "unmodified" || record.state === "rejected" || record.committedAt) return true;
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
    const { workflow, actor, preparing, nativeActivities, consumptionIndexes, ...data } = record;
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
