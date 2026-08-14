import {
  HOOKS,
  REACTION_MAX_RECENT_TRANSACTIONS,
  REACTION_RESPONSES,
  REACTION_SOURCE_RESULTS,
  REACTION_TRANSACTION_STATES
} from "../core/constants.js";
import { Logger } from "../core/logger.js";
import { duplicateSafely } from "../core/utils.js";
import { ReactionContext } from "./reaction-context.js";
import { ReactionTransaction } from "./reaction-transaction.js";

/**
 * Generic event-driven Reaction Broker.
 *
 * The source workflow client retains the resumable async transaction. The
 * elected longest-connected GM authorizes state-changing decisions and rolls
 * ordering tiebreaks. This split allows the source hook to remain awaitable
 * while still surviving a temporary loss/replacement of GM authority.
 */
export class ReactionBroker {
  #registry;
  #discovery;
  #ordering;
  #authority;
  #dialogs;
  #socket;
  #inFlightByEvent = new Map();
  #transactions = new Map();
  #recent = [];
  #stats = {
    processed: 0,
    bypassNoHandlers: 0,
    bypassNoGm: 0,
    bypassNoReactors: 0,
    duplicateEvents: 0,
    manualCancels: 0,
    selected: 0,
    declined: 0,
    waitingDeclines: 0,
    aborted: 0,
    resumed: 0,
    revalidations: 0,
    reactorsSkipped: 0,
    authorityWaits: 0,
    nestedTransactions: 0,
    lastEvent: null
  };

  constructor({ registry, discovery, ordering, authority, dialogs, socket }) {
    this.#registry = registry;
    this.#discovery = discovery;
    this.#ordering = ordering;
    this.#authority = authority;
    this.#dialogs = dialogs;
    this.#socket = socket;

    socket.register("reactions.transaction.manualCancel", this.#manualCancelSocket.bind(this));
    socket.register("reactions.transaction.waitingDecline", this.#waitingDeclineSocket.bind(this));
    authority.setDecisionValidator(this.#validateDecisionAsAuthority.bind(this));
  }

  async process(context, {
    scene = globalThis.canvas?.scene ?? null,
    tokenDocuments = null,
    sourceStillValid = null
  } = {}) {
    if (!(context instanceof ReactionContext)) context = new ReactionContext(context ?? {});
    if (!this.#registry.hasTrigger(context.trigger)) {
      this.#stats.bypassNoHandlers += 1;
      return this.#sourceResult({ reason: "no-registered-handlers" });
    }

    // The no-GM rule is intentional: never elect a player authority and never
    // stall a new source activity waiting for a GM who was not present.
    await this.#authority.refreshLedger().catch(() => null);
    if (!this.#authority.hasActiveGm() || !this.#authority.getPrimaryGm()) {
      this.#stats.bypassNoGm += 1;
      this.#record("bypass-no-gm", { eventKey: context.eventKey });
      return this.#sourceResult({ reason: "no-active-gm" });
    }

    const existing = this.#inFlightByEvent.get(context.eventKey);
    if (existing) {
      this.#stats.duplicateEvents += 1;
      this.#record("duplicate-joined", { eventKey: context.eventKey });
      return existing;
    }

    const promise = this.#processInternal(context, { scene, tokenDocuments, sourceStillValid });
    this.#inFlightByEvent.set(context.eventKey, promise);
    try {
      return await promise;
    } finally {
      if (this.#inFlightByEvent.get(context.eventKey) === promise) this.#inFlightByEvent.delete(context.eventKey);
    }
  }

  async requestManual(transactionId, reason = "manual-request") {
    const transaction = this.#transactions.get(transactionId);
    if (!transaction) return false;
    transaction.requestManual(reason);
    this.#stats.manualCancels += 1;
    this.#emitUpdated(transaction, { reason: "manual-requested" });
    // A waiting Reactor may cancel while a different Reactor owns the active
    // prompt. Close every view for this transaction immediately so the active
    // prompt Promise resolves MANUAL and the source workflow can unwind.
    await this.#dialogs.closeForOpportunities(transaction.opportunities, transaction.id).catch(() => null);
    return true;
  }


  async requestWaitingDecline(transactionId, reactorTokenUuid) {
    const transaction = this.#transactions.get(transactionId);
    if (!transaction) return { accepted: false, reason: "transaction-not-found" };
    if (!reactorTokenUuid) return { accepted: false, reason: "missing-reactor" };

    const index = transaction.opportunities.findIndex(entry => entry.reactorTokenUuid === reactorTokenUuid);
    if (index < 0) return { accepted: false, reason: "reactor-not-in-queue" };
    if (transaction.hasWaitingDecline(reactorTokenUuid)) return { accepted: true, duplicate: true };
    if (index <= transaction.currentIndex) return { accepted: false, reason: "reactor-not-waiting" };
    if (transaction.manualRequested || transaction.completedAt) return { accepted: false, reason: "transaction-not-active" };

    const opportunity = transaction.opportunities[index];
    const primary = this.#authority.getPrimaryGm();
    if (!primary) return { accepted: false, reason: "no-gm" };

    const response = { type: REACTION_RESPONSES.DECLINED, phase: "waiting" };
    const authorization = await this.#authority.authorizeDecision({
      transaction: transaction.toJSON(),
      context: transaction.context.toJSON?.() ?? duplicateSafely(transaction.context),
      opportunity: this.#serializeOpportunity(opportunity),
      response
    });
    if (!authorization?.authorized) {
      return { accepted: false, reason: authorization?.reason ?? "authorization-failed" };
    }

    transaction.markWaitingDecline(reactorTokenUuid);
    transaction.recordResponse(response);
    this.#stats.declined += 1;
    this.#stats.waitingDeclines += 1;
    this.#record("waiting-decline", { transactionId, reactorTokenUuid });
    this.#emitUpdated(transaction, { reason: "reactor-declined-while-waiting", reactorTokenUuid });
    await this.#dialogs.closeTransaction(opportunity, transaction.id).catch(() => null);
    return { accepted: true, primaryGmId: authorization.primaryGmId ?? primary.id };
  }

  getTransaction(transactionId) {
    return this.#transactions.get(transactionId)?.toJSON?.() ?? null;
  }

  getRecentTransactions() {
    return this.#recent.map(entry => duplicateSafely(entry));
  }

  getStats() {
    return {
      ...this.#stats,
      registry: this.#registry.getStats(),
      authority: this.#authority.getStatus(),
      dialogs: this.#dialogs.getStats(),
      inFlightEvents: this.#inFlightByEvent.size,
      activeTransactions: this.#transactions.size,
      recentTransactions: this.#recent.length
    };
  }

  async #processInternal(context, { scene, tokenDocuments, sourceStillValid }) {
    const transaction = new ReactionTransaction({ context });
    transaction.authorityAvailable = true;
    transaction.primaryGmId = this.#authority.getPrimaryGm()?.id ?? null;
    this.#transactions.set(transaction.id, transaction);
    this.#stats.processed += 1;
    if (transaction.parentTransactionId) this.#stats.nestedTransactions += 1;
    this.#record("transaction-created", { transactionId: transaction.id, eventKey: context.eventKey });
    Hooks.callAll(HOOKS.REACTION_TRANSACTION_CREATED, transaction.toJSON());

    let ordered = [];
    let unsubscribeAuthority = null;
    let finalResult = null;

    try {
      transaction.transition(REACTION_TRANSACTION_STATES.DISCOVERING);
      this.#emitUpdated(transaction);
      const discovered = await this.#discovery.discover(context, { scene, tokenDocuments });
      if (!discovered.length) {
        this.#stats.bypassNoReactors += 1;
        finalResult = transaction.complete(this.#sourceResult({ reason: "no-eligible-reactors" }));
        return finalResult;
      }

      const sourceToken = context.live?.token ?? await this.#resolveToken(context.source?.tokenUuid);
      ordered = await this.#ordering.order(discovered, {
        sourceToken,
        scene,
        rollTies: (uuids) => this.#authority.rollTiebreak(uuids, transaction.id)
      });
      transaction.setQueue(ordered);
      transaction.transition(REACTION_TRANSACTION_STATES.WAITING);
      this.#emitUpdated(transaction, { order: ordered.map(entry => entry.reactorTokenUuid) });

      // Every Reactor sees the Broker immediately. Waiting windows do not own
      // the v0.3.27 indicator; the dialog service acquires it only when ACTIVE.
      await Promise.all(ordered.map(opportunity => this.#dialogs.openWaiting(opportunity, transaction)
        .catch(error => Logger.warn(`Could not open Reaction Broker waiting view for '${opportunity.reactorName}'.`, error))));

      unsubscribeAuthority = this.#authority.onChange(({ primaryGmId }) => {
        transaction.primaryGmId = primaryGmId;
        transaction.authorityAvailable = Boolean(primaryGmId);
        if (!primaryGmId) {
          if ([REACTION_TRANSACTION_STATES.ACTIVE, REACTION_TRANSACTION_STATES.WAITING].includes(transaction.state)) {
            transaction.transition(REACTION_TRANSACTION_STATES.WAITING_FOR_AUTHORITY, { reason: "last-gm-disconnected" });
          }
          this.#stats.authorityWaits += 1;
        } else if (transaction.state === REACTION_TRANSACTION_STATES.WAITING_FOR_AUTHORITY) {
          transaction.transition(
            transaction.currentIndex >= 0 ? REACTION_TRANSACTION_STATES.ACTIVE : REACTION_TRANSACTION_STATES.WAITING,
            { reason: "gm-authority-restored" }
          );
        }
        this.#dialogs.setAuthority(ordered, transaction.id, {
          available: Boolean(primaryGmId),
          primaryGmId
        }).catch(error => Logger.debug("Reaction Broker authority UI update failed.", error));
        this.#emitUpdated(transaction, { reason: "authority-change" });
      });

      for (let index = 0; index < ordered.length; index += 1) {
        if (transaction.manualRequested) {
          finalResult = transaction.complete(this.#manualResult(transaction.manualReason));
          return finalResult;
        }

        const frozen = ordered[index];
        if (transaction.hasWaitingDecline(frozen.reactorTokenUuid)) {
          this.#record("reactor-skipped-waiting-decline", {
            transactionId: transaction.id,
            reactorTokenUuid: frozen.reactorTokenUuid
          });
          await this.#dialogs.closeTransaction(frozen, transaction.id).catch(() => null);
          continue;
        }

        if (typeof sourceStillValid === "function") {
          let sourceValid = false;
          try { sourceValid = Boolean(await sourceStillValid({ context, transaction })); }
          catch (error) { Logger.warn("Reaction Broker source revalidation failed.", error); }
          if (!sourceValid) {
            finalResult = transaction.complete(this.#sourceResult({ reason: "source-no-longer-valid" }));
            return finalResult;
          }
        }

        const opportunity = await this.#discovery.revalidate(context, frozen);
        this.#stats.revalidations += 1;
        if (!opportunity?.offers?.length) {
          this.#stats.reactorsSkipped += 1;
          this.#record("reactor-skipped", { transactionId: transaction.id, reactorTokenUuid: frozen.reactorTokenUuid });
          await this.#dialogs.closeTransaction(frozen, transaction.id);
          continue;
        }

        // Preserve the frozen sort metadata and controller slot while replacing
        // the dynamic offer set with a freshly-validated one.
        Object.assign(frozen, {
          ...opportunity,
          distance: frozen.distance,
          dexterity: frozen.dexterity,
          tieBreak: frozen.tieBreak
        });
        transaction.activate(index, frozen);
        transaction.primaryGmId = this.#authority.getPrimaryGm()?.id ?? null;
        transaction.authorityAvailable = Boolean(transaction.primaryGmId);
        this.#emitUpdated(transaction);

        let response = await this.#promptWithControllerRecovery({
          context,
          transaction,
          opportunity: frozen,
          ordered
        });
        if (response?.skipped) continue;
        if (response?.opportunity) Object.assign(frozen, response.opportunity);
        response = response?.response ?? response;
        if (response?.type === REACTION_RESPONSES.MANUAL || transaction.manualRequested) {
          transaction.requestManual(response?.reason ?? transaction.manualReason ?? "manual-request");
          finalResult = transaction.complete(this.#manualResult(transaction.manualReason));
          return finalResult;
        }

        const authorization = await this.#authorizeWithRecovery({ context, transaction, opportunity: frozen, response, ordered });
        if (authorization.manual) {
          finalResult = transaction.complete(this.#manualResult(authorization.reason));
          return finalResult;
        }
        if (!authorization.authorized) {
          // Eligibility changed while the prompt was open. Revalidate this slot
          // once more; if nothing remains, skip it, otherwise present the fresh
          // choices instead of accepting stale UI state.
          const refreshed = await this.#discovery.revalidate(context, frozen);
          this.#stats.revalidations += 1;
          if (!refreshed?.offers?.length) {
            this.#stats.reactorsSkipped += 1;
            await this.#dialogs.closeTransaction(frozen, transaction.id);
            continue;
          }
          Object.assign(frozen, { ...refreshed, distance: frozen.distance, dexterity: frozen.dexterity, tieBreak: frozen.tieBreak });
          transaction.transition(REACTION_TRANSACTION_STATES.ACTIVE, { reason: "revalidated-after-rejection" });
          response = await this.#promptWithControllerRecovery({
            context,
            transaction,
            opportunity: frozen,
            ordered
          });
          if (response?.skipped) continue;
          if (response?.opportunity) Object.assign(frozen, response.opportunity);
          response = response?.response ?? response;
          if (response?.type === REACTION_RESPONSES.MANUAL) {
            finalResult = transaction.complete(this.#manualResult(response.reason));
            return finalResult;
          }
          const retry = await this.#authorizeWithRecovery({ context, transaction, opportunity: frozen, response, ordered });
          if (!retry.authorized) {
            Logger.warn("Reaction Broker could not authorize a refreshed decision; switching to manual adjudication.", retry);
            finalResult = transaction.complete(this.#manualResult("authorization-failed"));
            return finalResult;
          }
        }

        transaction.recordResponse(response);
        if (response.type === REACTION_RESPONSES.DECLINED) {
          this.#stats.declined += 1;
          await this.#dialogs.setResolving(frozen, transaction, "No reaction selected.");
          await this.#dialogs.closeTransaction(frozen, transaction.id);
          transaction.transition(REACTION_TRANSACTION_STATES.WAITING, { nextIndex: index + 1 });
          this.#emitUpdated(transaction);
          continue;
        }

        const offer = frozen.offers.find(entry => entry.id === response.offerId);
        const handler = offer ? this.#registry.get(offer.handler) : null;
        if (!offer || !handler) {
          Logger.warn("Reaction Broker selected offer disappeared after authorization; switching to manual adjudication.", { response, frozen });
          finalResult = transaction.complete(this.#manualResult("selected-offer-missing"));
          return finalResult;
        }

        this.#stats.selected += 1;
        transaction.transition(REACTION_TRANSACTION_STATES.RESOLVING, {
          selectedOfferId: offer.id,
          selectedHandler: offer.handler
        });
        this.#emitUpdated(transaction);
        await this.#dialogs.setResolving(frozen, transaction, `Resolving ${offer.label ?? "reaction"}…`);

        const handlerResult = await handler.resolve({
          context,
          transaction,
          opportunity: frozen,
          offer,
          actor: offer.actor ?? frozen.actor,
          token: offer.tokenDocument ?? frozen.tokenDocument,
          item: offer.item ?? null,
          activity: offer.activity ?? null,
          broker: this
        });
        const normalized = this.#normalizeHandlerResult(handlerResult, offer);
        transaction.recordReactionResult(normalized);
        await this.#dialogs.closeTransaction(frozen, transaction.id);

        if (normalized.source === REACTION_SOURCE_RESULTS.ABORT) {
          this.#stats.aborted += 1;
          finalResult = transaction.complete(normalized);
          return finalResult;
        }
        if (!normalized.continueCandidates) {
          this.#stats.resumed += 1;
          finalResult = transaction.complete(normalized);
          return finalResult;
        }

        transaction.transition(REACTION_TRANSACTION_STATES.WAITING, { nextIndex: index + 1 });
        this.#emitUpdated(transaction);
      }

      this.#stats.resumed += 1;
      finalResult = transaction.complete(this.#sourceResult({
        reason: "reactor-queue-complete",
        reacted: transaction.reactionResults.length > 0
      }));
      return finalResult;
    } catch (error) {
      Logger.error("Reaction Broker transaction failed; returning source control for manual-safe recovery.", error);
      finalResult = transaction.complete(this.#manualResult("broker-error"));
      return finalResult;
    } finally {
      unsubscribeAuthority?.();
      await this.#dialogs.closeForOpportunities(ordered, transaction.id).catch(() => null);
      if (!finalResult) finalResult = transaction.complete(this.#manualResult("transaction-cleanup"));
      this.#remember(transaction);
      this.#transactions.delete(transaction.id);
      Hooks.callAll(HOOKS.REACTION_TRANSACTION_COMPLETE, transaction.toJSON());
    }
  }

  async #authorizeWithRecovery({ context, transaction, opportunity, response, ordered }) {
    while (true) {
      if (transaction.manualRequested) return { authorized: false, manual: true, reason: transaction.manualReason };
      let primary = this.#authority.getPrimaryGm();
      if (!primary) {
        transaction.authorityAvailable = false;
        transaction.primaryGmId = null;
        transaction.transition(REACTION_TRANSACTION_STATES.WAITING_FOR_AUTHORITY, { reason: "no-gm-during-decision" });
        this.#stats.authorityWaits += 1;
        await this.#dialogs.setAuthority(ordered, transaction.id, { available: false, primaryGmId: null });

        // Poll while allowing a WAITING or ACTIVE Reactor's Cancel button to set
        // transaction.manualRequested on the source coordinator.
        while (!transaction.manualRequested && !(primary = this.#authority.getPrimaryGm())) {
          await new Promise(resolve => setTimeout(resolve, 500));
          await this.#authority.refreshLedger().catch(() => null);
        }
        if (transaction.manualRequested) return { authorized: false, manual: true, reason: transaction.manualReason };
        transaction.authorityAvailable = true;
        transaction.primaryGmId = primary.id;
        await this.#dialogs.setAuthority(ordered, transaction.id, { available: true, primaryGmId: primary.id });
      }

      const result = await this.#authority.authorizeDecision({
        transaction: transaction.toJSON(),
        context: context.toJSON(),
        opportunity: this.#serializeOpportunity(opportunity),
        response
      });
      if (result?.authorized) return result;
      if (["no-gm", "authority-unavailable", "not-primary"].includes(result?.reason)) {
        await new Promise(resolve => setTimeout(resolve, 250));
        await this.#authority.refreshLedger().catch(() => null);
        continue;
      }
      return result ?? { authorized: false, reason: "unknown-authorization-result" };
    }
  }

  async #promptWithControllerRecovery({ context, transaction, opportunity, ordered }) {
    while (true) {
      const response = await this.#dialogs.prompt(opportunity, transaction);
      if (response?.type !== REACTION_RESPONSES.INTERRUPTED) {
        return { response, opportunity };
      }

      this.#record("controller-prompt-interrupted", {
        transactionId: transaction.id,
        reactorTokenUuid: opportunity.reactorTokenUuid,
        controllerUserId: response.controllerUserId ?? opportunity.controllerUserId,
        reason: response.reason ?? null
      });

      // If the disconnected controller was also the last GM, preserve the
      // user's requested authority-loss behavior: suspend the source, disable
      // confirmations on surviving Reactor windows, and wait for a GM to return
      // (or for any visible Reactor to press Cancel for manual adjudication).
      let primary = this.#authority.getPrimaryGm();
      if (!primary) {
        transaction.authorityAvailable = false;
        transaction.primaryGmId = null;
        transaction.transition(REACTION_TRANSACTION_STATES.WAITING_FOR_AUTHORITY, {
          reason: "controller-disconnected-no-gm"
        });
        this.#stats.authorityWaits += 1;
        await this.#dialogs.setAuthority(ordered, transaction.id, {
          available: false,
          primaryGmId: null
        });

        while (!transaction.manualRequested && !(primary = this.#authority.getPrimaryGm())) {
          await new Promise(resolve => setTimeout(resolve, 500));
          await this.#authority.refreshLedger().catch(() => null);
        }
        if (transaction.manualRequested) {
          return {
            response: {
              type: REACTION_RESPONSES.MANUAL,
              reason: transaction.manualReason ?? "manual-request"
            },
            opportunity
          };
        }

        transaction.authorityAvailable = true;
        transaction.primaryGmId = primary.id;
        await this.#dialogs.setAuthority(ordered, transaction.id, {
          available: true,
          primaryGmId: primary.id
        });
      }

      // Re-discover the same frozen queue slot. A disconnected PC controller
      // normally falls back to the elected GM; a reconnected GM gets a fresh
      // DialogV2 host in the new browser session. Sort metadata remains frozen.
      const refreshed = await this.#discovery.revalidate(context, opportunity);
      this.#stats.revalidations += 1;
      if (!refreshed?.offers?.length) {
        this.#stats.reactorsSkipped += 1;
        await this.#dialogs.closeTransaction(opportunity, transaction.id).catch(() => null);
        return { skipped: true, opportunity };
      }

      Object.assign(opportunity, {
        ...refreshed,
        distance: opportunity.distance,
        dexterity: opportunity.dexterity,
        tieBreak: opportunity.tieBreak
      });
      transaction.transition(REACTION_TRANSACTION_STATES.ACTIVE, {
        reason: "controller-rerouted-after-disconnect",
        reactorTokenUuid: opportunity.reactorTokenUuid,
        controllerUserId: opportunity.controllerUserId
      });
      this.#emitUpdated(transaction, { reason: "controller-rerouted-after-disconnect" });
    }
  }

  async #validateDecisionAsAuthority(payload) {
    const context = new ReactionContext(payload?.context ?? {});
    const frozen = payload?.opportunity;
    const response = payload?.response;
    if (!frozen?.reactorTokenUuid) return { valid: false, reason: "missing-reactor" };
    const fresh = await this.#discovery.revalidate(context, frozen);
    if (!fresh?.offers?.length) return { valid: false, reason: "reactor-no-longer-eligible" };
    if (response?.type === REACTION_RESPONSES.SELECTED && !fresh.offers.some(offer => offer.id === response.offerId)) {
      return { valid: false, reason: "selected-reaction-no-longer-eligible" };
    }
    return { valid: true };
  }

  #normalizeHandlerResult(result, offer) {
    const value = result && typeof result === "object" ? result : {};
    return {
      reacted: true,
      response: REACTION_RESPONSES.SELECTED,
      source: value.source === REACTION_SOURCE_RESULTS.ABORT ? REACTION_SOURCE_RESULTS.ABORT : REACTION_SOURCE_RESULTS.RESUME,
      // The user-approved multi-Reactor model advances to the next Reactor by
      // default after a reaction completes. A handler must explicitly return
      // false (or abort the source) to stop the frozen queue.
      continueCandidates: value.continueCandidates !== false,
      reason: value.reason ?? offer.handler,
      selectedOfferId: offer.id,
      selectedHandler: offer.handler,
      childWorkflowId: value.childWorkflowId ?? null,
      manual: false
    };
  }

  #sourceResult({ reason = null, reacted = false } = {}) {
    return {
      reacted: Boolean(reacted),
      response: null,
      source: REACTION_SOURCE_RESULTS.RESUME,
      continueCandidates: false,
      reason,
      selectedOfferId: null,
      selectedHandler: null,
      childWorkflowId: null,
      manual: false
    };
  }

  #manualResult(reason) {
    return {
      reacted: false,
      response: REACTION_RESPONSES.MANUAL,
      source: REACTION_SOURCE_RESULTS.RESUME,
      continueCandidates: false,
      reason: reason ?? "manual-adjudication",
      selectedOfferId: null,
      selectedHandler: null,
      childWorkflowId: null,
      manual: true
    };
  }

  #serializeOpportunity(opportunity) {
    return {
      reactorActorUuid: opportunity.reactorActorUuid,
      reactorTokenUuid: opportunity.reactorTokenUuid,
      reactorName: opportunity.reactorName,
      controllerUserId: opportunity.controllerUserId,
      offers: (opportunity.offers ?? []).map(offer => ({
        id: offer.id,
        activityUuid: offer.activityUuid,
        itemUuid: offer.itemUuid,
        handler: offer.handler,
        trigger: offer.trigger,
        label: offer.label
      }))
    };
  }

  async #waitingDeclineSocket({ transactionId, reactorTokenUuid } = {}) {
    return this.requestWaitingDecline(transactionId, reactorTokenUuid);
  }

  async #manualCancelSocket({ transactionId, reason = "remote-cancel" } = {}) {
    return { accepted: await this.requestManual(transactionId, reason) };
  }

  async #resolveToken(uuid) {
    if (!uuid) return null;
    const canvasToken = globalThis.canvas?.tokens?.placeables?.find(token => token?.document?.uuid === uuid);
    if (canvasToken?.document) return canvasToken.document;
    try {
      const resolved = await globalThis.fromUuid?.(uuid);
      return resolved?.document ?? resolved ?? null;
    } catch {
      return null;
    }
  }

  #emitUpdated(transaction, details = null) {
    Hooks.callAll(HOOKS.REACTION_TRANSACTION_UPDATED, transaction.toJSON(), details);
  }

  #remember(transaction) {
    this.#recent.unshift(transaction.toJSON());
    if (this.#recent.length > REACTION_MAX_RECENT_TRANSACTIONS) this.#recent.length = REACTION_MAX_RECENT_TRANSACTIONS;
  }

  #record(type, details) {
    this.#stats.lastEvent = { at: new Date().toISOString(), type, details };
  }
}
