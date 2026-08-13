import {
  REACTION_RESPONSES,
  REACTION_SOURCE_RESULTS,
  REACTION_TRANSACTION_STATES
} from "../core/constants.js";
import { duplicateSafely, nowIso, randomId } from "../core/utils.js";

export class ReactionTransaction {
  constructor({ context, opportunities = [], id = randomId(), rootTransactionId = null, parentTransactionId = null } = {}) {
    if (!context) throw new TypeError("ReactionTransaction requires a context.");
    this.id = id;
    this.eventKey = context.eventKey;
    this.trigger = context.trigger;
    this.context = context;
    this.rootTransactionId = rootTransactionId ?? context.rootTransactionId ?? id;
    this.parentTransactionId = parentTransactionId ?? context.parentTransactionId ?? null;
    this.opportunities = opportunities;
    this.state = REACTION_TRANSACTION_STATES.CREATED;
    this.currentIndex = -1;
    this.currentReactorTokenUuid = null;
    this.result = null;
    this.reactionResults = [];
    this.history = [];
    this.createdAt = nowIso();
    this.completedAt = null;
    this.manualRequested = false;
    this.manualReason = null;
    this.waitingDeclines = new Set();
    this.#record("created");
  }

  transition(state, details = null) {
    this.state = state;
    this.#record("state", { state, ...(details ?? {}) });
    return this;
  }

  setQueue(opportunities) {
    this.opportunities = opportunities;
    this.#record("queue", {
      reactors: opportunities.map(opportunity => ({
        tokenUuid: opportunity.reactorTokenUuid,
        actorUuid: opportunity.reactorActorUuid,
        offers: opportunity.offers?.map(offer => offer.id) ?? []
      }))
    });
  }

  activate(index, opportunity) {
    this.currentIndex = index;
    this.currentReactorTokenUuid = opportunity?.reactorTokenUuid ?? null;
    this.transition(REACTION_TRANSACTION_STATES.ACTIVE, {
      index,
      reactorTokenUuid: this.currentReactorTokenUuid
    });
  }

  recordResponse(response) {
    this.#record("response", duplicateSafely(response));
  }

  recordReactionResult(result) {
    const snapshot = duplicateSafely(result);
    this.reactionResults.push(snapshot);
    this.#record("reaction-result", snapshot);
  }

  markWaitingDecline(reactorTokenUuid) {
    if (!reactorTokenUuid) return false;
    const before = this.waitingDeclines.size;
    this.waitingDeclines.add(reactorTokenUuid);
    if (this.waitingDeclines.size !== before) {
      this.#record("waiting-decline", { reactorTokenUuid });
      return true;
    }
    return false;
  }

  hasWaitingDecline(reactorTokenUuid) {
    return Boolean(reactorTokenUuid && this.waitingDeclines.has(reactorTokenUuid));
  }

  requestManual(reason = "user-cancelled") {
    this.manualRequested = true;
    this.manualReason = reason;
    this.#record("manual-requested", { reason });
  }

  complete(result = {}) {
    const normalized = {
      reacted: Boolean(result.reacted),
      response: result.response ?? null,
      source: result.source === REACTION_SOURCE_RESULTS.ABORT
        ? REACTION_SOURCE_RESULTS.ABORT
        : REACTION_SOURCE_RESULTS.RESUME,
      continueCandidates: Boolean(result.continueCandidates),
      reason: result.reason ?? null,
      selectedOfferId: result.selectedOfferId ?? null,
      selectedHandler: result.selectedHandler ?? null,
      childWorkflowId: result.childWorkflowId ?? null,
      manual: result.response === REACTION_RESPONSES.MANUAL || Boolean(result.manual)
    };
    this.result = normalized;
    this.state = normalized.manual
      ? REACTION_TRANSACTION_STATES.MANUAL
      : REACTION_TRANSACTION_STATES.COMPLETE;
    this.completedAt = nowIso();
    this.#record("complete", normalized);
    return normalized;
  }

  toJSON() {
    return {
      id: this.id,
      eventKey: this.eventKey,
      trigger: this.trigger,
      rootTransactionId: this.rootTransactionId,
      parentTransactionId: this.parentTransactionId,
      state: this.state,
      currentIndex: this.currentIndex,
      currentReactorTokenUuid: this.currentReactorTokenUuid,
      createdAt: this.createdAt,
      completedAt: this.completedAt,
      manualRequested: this.manualRequested,
      manualReason: this.manualReason,
      waitingDeclinedReactorTokenUuids: [...this.waitingDeclines],
      result: duplicateSafely(this.result),
      reactionResults: duplicateSafely(this.reactionResults),
      context: this.context.toJSON?.() ?? duplicateSafely(this.context),
      opportunities: this.opportunities.map(opportunity => ({
        reactorActorUuid: opportunity.reactorActorUuid,
        reactorTokenUuid: opportunity.reactorTokenUuid,
        controllerUserId: opportunity.controllerUserId,
        reactorName: opportunity.reactorName,
        distance: opportunity.distance ?? null,
        dexterity: opportunity.dexterity ?? null,
        tieBreak: opportunity.tieBreak ?? null,
        offers: (opportunity.offers ?? []).map(offer => ({
          id: offer.id,
          activityUuid: offer.activityUuid,
          itemUuid: offer.itemUuid,
          handler: offer.handler,
          trigger: offer.trigger,
          label: offer.label,
          img: offer.img ?? null
        }))
      })),
      history: duplicateSafely(this.history)
    };
  }

  #record(type, details = null) {
    this.history.push({ at: nowIso(), type, details: duplicateSafely(details) });
  }
}
