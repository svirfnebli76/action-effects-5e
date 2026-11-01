import { MODULE_ID } from "../core/constants.js";

const SAVE_KEY = "flags.automated-conditions-5e.save.disadvantage";
const FLAG = "saveDisadvantage";
const uuidOf = token => token?.document?.uuid ?? token?.uuid;
const tokens = workflow => [...(workflow?.hitTargets ?? workflow?.targets ?? [])];
const flag = effect => effect?.flags?.[MODULE_ID]?.[FLAG];

/** Applies an Item-declared, target-specific save modifier and persists it on the spell effect. */
export class SaveDisadvantageService {
  #pending = new WeakMap();
  #overTimeModifiers = new WeakMap();
  #cat;
  #socket;

  constructor({ socket = null, catAccessor = () => globalThis.cat } = {}) {
    this.#cat = catAccessor;
    this.#socket = socket;
    socket?.register("metamagic.stampSaveDisadvantage", (effectUuid, metadata) => this.stamp(effectUuid, metadata));
  }

  validate(workflow, request, option) {
    const uuids = request?.tokenUuids;
    if (!Array.isArray(uuids) || uuids.length !== 1 || typeof uuids[0] !== "string")
      throw new Error("Save disadvantage requires exactly one affected target.");
    const target = tokens(workflow).find(token => uuidOf(token) === uuids[0]);
    if (!target?.actor?.uuid || !(target.id ?? target.document?.id)
      || (target.document ?? target).disposition === (globalThis.CONST?.TOKEN_DISPOSITIONS?.SECRET ?? -2))
      throw new Error("Save disadvantage target is outside the eligible finalized affected targets.");
    const utils = this.#cat()?.utils?.workflowUtils;
    if (!["grantRollModifier", "getWorkflowProperty", "setWorkflowProperty"].every(key => typeof utils?.[key] === "function"))
      throw new Error("CAT selected-target roll modifier API is unavailable.");
    if (request.persistence !== "ac5e-itemLimited") throw new Error("Unsupported save disadvantage persistence.");
    if (!globalThis.game?.modules?.get?.("automated-conditions-5e")?.active)
      throw new Error("Persistent save disadvantage requires Automated Conditions 5E.");
    const label = request?.label?.trim?.();
    if (!label || label.includes(";")) throw new Error("Save disadvantage requires a valid display label.");
    return {
      tokenUuids: [...uuids],
      persistence: request.persistence,
      optionId: option.id,
      label
    };
  }

  install(record, request) {
    const workflow = record.workflow;
    if (this.#pending.has(workflow)) throw new Error("Selected save disadvantage is already applied to this casting.");
    const target = tokens(workflow).find(token => uuidOf(token) === request.tokenUuids[0]);
    if (!target?.actor) throw new Error("Selected save disadvantage target is no longer available.");
    const sourceActivityUuid = `${record.sourceItemUuid}.Activity.${record.sourceActivityId}`;
    const state = {
      target,
      existingEffects: new Set([...(target.actor.effects ?? [])].map(effect => effect.uuid)),
      identifier: `ae5e-${request.optionId}-${record.castingId}`,
      metadata: {
        optionId: request.optionId,
        label: request.label,
        sourceActorUuid: record.casterActorUuid,
        sourceItemUuid: record.sourceItemUuid,
        sourceActivityUuid,
        targetActorUuid: target.actor.uuid,
        targetTokenUuid: request.tokenUuids[0],
        castingId: record.castingId,
        sourceMessageUuid: workflow.itemCardUuid ?? null,
        concentrationEffectUuid: null
      }
    };
    this.#pending.set(workflow, state);
    this.#cat().utils.workflowUtils.grantRollModifier(
      workflow, "dis", target.id ?? target.document.id, state.identifier, request.label
    );
  }

  rollback(workflow) {
    const state = this.#pending.get(workflow);
    if (!state) return;
    this.#removeModifier(workflow, state.identifier);
    this.#pending.delete(workflow);
  }

  #removeModifier(workflow, identifier) {
    const utils = this.#cat()?.utils?.workflowUtils;
    const modifiers = utils?.getWorkflowProperty(workflow, "rollModifiers");
    if (!modifiers) return;
    for (const [id, entries] of Object.entries(modifiers))
      modifiers[id] = entries.filter(entry => entry.identifier !== identifier);
    utils.setWorkflowProperty(workflow, "rollModifiers", modifiers);
  }

  async persist(workflow) {
    const state = this.#pending.get(workflow);
    if (!state) return;
    state.metadata.sourceMessageUuid ??= workflow.itemCardUuid ?? null;
    const concentration = workflow.actor?.effects?.get?.(workflow.concentrationId);
    state.metadata.concentrationEffectUuid = concentration?.uuid ?? null;
    for (const effect of state.target.actor.effects ?? []) {
      if (state.existingEffects.has(effect.uuid) || flag(effect)?.castingId === state.metadata.castingId) continue;
      if (!await this.#matches(effect, state.metadata)) continue;
      const updated = effect.isOwner || globalThis.game?.user?.isGM
        ? await this.stamp(effect.uuid, state.metadata)
        : await this.#socket?.executeAsGM("metamagic.stampSaveDisadvantage", effect.uuid, state.metadata);
      if (updated !== true) throw new Error("Could not persist save disadvantage on the selected target's spell effect.");
    }
  }

  finish(workflow) {
    const state = this.#pending.get(workflow);
    if (state) this.#removeModifier(workflow, state.identifier);
    const overtime = this.#overTimeModifiers.get(workflow);
    if (overtime) this.#removeModifier(workflow, overtime);
    this.#pending.delete(workflow);
    this.#overTimeModifiers.delete(workflow);
  }

  async #matches(effect, metadata) {
    if (effect?.parent?.uuid !== metadata.targetActorUuid || effect.transfer) return false;
    const origin = effect.system?.origin ?? {};
    if (origin.message && origin.message !== metadata.sourceMessageUuid) return false;
    if (origin.activity && origin.activity !== metadata.sourceActivityUuid) return false;
    const dependency = origin.effect ?? effect.flags?.dnd5e?.dependentOn
      ?? (effect.origin?.includes(".ActiveEffect.") ? effect.origin : null);
    const concentration = dependency ? await globalThis.fromUuid?.(dependency) : null;
    const source = origin.activity ?? concentration?.system?.origin?.activity ?? concentration?.origin ?? effect.origin;
    if (![metadata.sourceItemUuid, metadata.sourceActivityUuid].includes(source)) return false;
    return Boolean((metadata.sourceMessageUuid && origin.message === metadata.sourceMessageUuid)
      || (metadata.concentrationEffectUuid && dependency === metadata.concentrationEffectUuid));
  }

  async stamp(effectUuid, metadata) {
    if (!metadata?.optionId || !metadata.label || !metadata.castingId || !metadata.sourceActorUuid
      || !metadata.targetTokenUuid || !metadata.sourceItemUuid?.startsWith(`${metadata.sourceActorUuid}.Item.`)
      || !metadata.sourceActivityUuid?.startsWith(`${metadata.sourceItemUuid}.Activity.`)) return false;
    const effect = await globalThis.fromUuid?.(effectUuid);
    if (!effect || !await this.#matches(effect, metadata)) return false;
    if (flag(effect)) return flag(effect).castingId === metadata.castingId;
    const changes = [...(effect.changes ?? [])];
    const value = `itemLimited; name=${metadata.label}`;
    if (!changes.some(change => change.key === SAVE_KEY && change.value === value)) {
      changes.push({
        key: SAVE_KEY,
        value,
        type: globalThis.CONST?.ACTIVE_EFFECT_CHANGE_TYPES?.CUSTOM ?? "custom"
      });
    }
    await effect.update({ changes, [`flags.${MODULE_ID}.${FLAG}`]: { ...metadata } });
    return true;
  }

  /** Bridges only the exact effect supplied by Midi's ActivityOverTime workflow. */
  async prepareOverTime(workflow) {
    const effectUuid = workflow?.workflowOptions?.overTimeEffectUuid;
    if (!effectUuid) return;
    const effect = await globalThis.fromUuid?.(effectUuid);
    const metadata = flag(effect);
    if (!effect || effect.uuid !== effectUuid || effect.disabled || effect.isSuppressed || !metadata?.castingId
      || !metadata.sourceActorUuid || !metadata.sourceItemUuid || !metadata.sourceActivityUuid
      || effect.parent?.uuid !== metadata.targetActorUuid) return;
    const item = workflow.item ?? workflow.activity?.item;
    if (item?.id !== metadata.sourceItemUuid.split(".Item.").at(-1)
      || !await this.#matches(effect, metadata)) return;
    const utils = this.#cat()?.utils?.workflowUtils;
    if (typeof utils?.grantRollModifier !== "function")
      throw new Error("CAT roll modifier API is unavailable for the repeated save.");
    for (const target of tokens(workflow)) {
      if (target.actor?.uuid !== metadata.targetActorUuid) continue;
      const identifier = `ae5e-${metadata.optionId}-${metadata.castingId}`;
      const current = utils.getWorkflowProperty(workflow, "rollModifiers")?.[target.id ?? target.document?.id] ?? [];
      if (!current.some(entry => entry.identifier === identifier)) {
        utils.grantRollModifier(workflow, "dis", target.id ?? target.document.id, identifier, metadata.label);
        this.#overTimeModifiers.set(workflow, identifier);
      }
    }
  }
}
