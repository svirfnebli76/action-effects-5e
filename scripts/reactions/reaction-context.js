import { REACTION_TRIGGERS } from "../core/constants.js";
import { duplicateSafely, randomId } from "../core/utils.js";

/**
 * Socket-safe snapshot of a game event which may be reacted to.
 *
 * Live workflow/document references are deliberately kept outside the serialized
 * data so a ReactionContext can cross Socketlib boundaries safely.
 */
export class ReactionContext {
  #data;
  #live;

  constructor(data = {}, { live = {} } = {}) {
    const normalized = {
      id: data.id ?? randomId(),
      eventKey: data.eventKey ?? null,
      trigger: data.trigger ?? null,
      coordinatorUserId: data.coordinatorUserId ?? null,
      source: {
        workflowId: data.source?.workflowId ?? null,
        workflowUuid: data.source?.workflowUuid ?? null,
        actorUuid: data.source?.actorUuid ?? null,
        tokenUuid: data.source?.tokenUuid ?? null,
        itemUuid: data.source?.itemUuid ?? null,
        activityUuid: data.source?.activityUuid ?? null,
        actorName: data.source?.actorName ?? null,
        tokenName: data.source?.tokenName ?? null,
        itemName: data.source?.itemName ?? null,
        activityName: data.source?.activityName ?? null
      },
      targetUuids: Array.isArray(data.targetUuids) ? [...data.targetUuids] : [],
      parentTransactionId: data.parentTransactionId ?? null,
      rootTransactionId: data.rootTransactionId ?? null,
      data: duplicateSafely(data.data ?? {})
    };

    if (!normalized.eventKey) {
      const identity = normalized.source.workflowId
        ?? normalized.source.workflowUuid
        ?? normalized.id;
      normalized.eventKey = `${normalized.trigger ?? "reaction"}:${identity}`;
    }

    this.#data = Object.freeze(normalized);
    this.#live = live ?? {};
    Object.freeze(this);
  }

  static fromMidiSpellWorkflow(workflow, { parentTransactionId = null, rootTransactionId = null } = {}) {
    const item = workflow?.item ?? workflow?.activity?.item ?? null;
    const activity = workflow?.activity ?? null;
    const actor = workflow?.actor ?? item?.actor ?? activity?.actor ?? null;
    const token = workflow?.token ?? actor?.token?.object ?? actor?.token ?? null;
    const tokenDocument = token?.document ?? token ?? null;
    const workflowId = workflow?.id ?? workflow?.workflowId ?? workflow?.itemCardUuid ?? workflow?.uuid ?? null;
    const workflowUuid = workflow?.uuid ?? workflow?.itemCardUuid ?? null;
    const coordinatorUserId = this.#resolveCoordinatorUserId(workflow);
    const targets = workflow?.targets instanceof Set
      ? [...workflow.targets]
      : Array.isArray(workflow?.targets) ? workflow.targets : [];

    const data = {
      id: randomId(),
      trigger: REACTION_TRIGGERS.SPELL_CAST,
      coordinatorUserId,
      source: {
        workflowId,
        workflowUuid,
        actorUuid: actor?.uuid ?? null,
        tokenUuid: tokenDocument?.uuid ?? token?.uuid ?? null,
        itemUuid: item?.uuid ?? null,
        activityUuid: activity?.uuid ?? null,
        actorName: actor?.name ?? null,
        tokenName: tokenDocument?.name ?? token?.name ?? null,
        itemName: item?.name ?? null,
        activityName: activity?.name ?? null
      },
      targetUuids: targets.map(target => target?.document?.uuid ?? target?.uuid).filter(Boolean),
      parentTransactionId,
      rootTransactionId,
      data: {
        itemType: item?.type ?? null,
        activityType: activity?.type ?? null,
        castLevel: Number(workflow?.castData?.castLevel ?? workflow?.castLevel ?? activity?.spell?.level ?? item?.system?.level ?? NaN),
        midi: {
          itemCardId: workflow?.itemCardId ?? null,
          itemCardUuid: workflow?.itemCardUuid ?? null
        }
      }
    };

    return new ReactionContext(data, {
      live: { workflow, item, activity, actor, token: tokenDocument }
    });
  }

  static synthetic({
    trigger = REACTION_TRIGGERS.SPELL_CAST,
    eventKey = null,
    coordinatorUserId = globalThis.game?.user?.id ?? null,
    source = {},
    data = {},
    parentTransactionId = null,
    rootTransactionId = null,
    live = {}
  } = {}) {
    return new ReactionContext({
      id: randomId(), trigger, eventKey, coordinatorUserId, source, data,
      parentTransactionId, rootTransactionId
    }, { live });
  }

  get id() { return this.#data.id; }
  get eventKey() { return this.#data.eventKey; }
  get trigger() { return this.#data.trigger; }
  get coordinatorUserId() { return this.#data.coordinatorUserId; }
  get source() { return this.#data.source; }
  get targetUuids() { return this.#data.targetUuids; }
  get parentTransactionId() { return this.#data.parentTransactionId; }
  get rootTransactionId() { return this.#data.rootTransactionId; }
  get data() { return this.#data.data; }
  get live() { return this.#live; }

  withParent({ parentTransactionId = null, rootTransactionId = null } = {}) {
    return new ReactionContext({
      ...this.toJSON(),
      parentTransactionId,
      rootTransactionId
    }, { live: this.#live });
  }

  toJSON() {
    return duplicateSafely(this.#data);
  }

  static #resolveCoordinatorUserId(workflow) {
    const direct = workflow?.userId
      ?? workflow?.workflowOptions?.userId
      ?? workflow?.options?.userId
      ?? workflow?.config?.userId
      ?? workflow?.itemCard?.user?.id
      ?? workflow?.itemCard?.userId;
    if (direct) return direct;

    const messageId = workflow?.itemCardId
      ?? (typeof workflow?.itemCardUuid === "string" ? workflow.itemCardUuid.split(".").at(-1) : null);
    if (messageId) {
      const message = globalThis.game?.messages?.get?.(messageId);
      const messageUserId = message?.user?.id ?? message?.userId;
      if (messageUserId) return messageUserId;
    }

    return null;
  }
}
