import {
  MODULE_ID,
  REACTION_RESPONSES,
  REACTION_TRANSACTION_STATES,
  SELECTION_INDICATOR_ROLES
} from "../core/constants.js";
import { Logger } from "../core/logger.js";

const DECLINE_VALUE = "__ae5e_decline__";
const GM_DISCONNECTED_WARNING = "Game Master has been disconnected, waiting for game master to reconnect. Click cancel to proceed with manual reaction selection";

/**
 * Controller-local Reaction Broker window host.
 *
 * One host exists per reacting token. A host can carry a stack of transaction
 * views so a child reaction temporarily replaces its parent without opening a
 * second dialog for that token. Only an ACTIVE view owns a selection-indicator
 * lease; WAITING/RESOLVING/WAITING_FOR_AUTHORITY views never do.
 */
export class ReactionDialogService {
  #socket;
  #selectionIndicator;
  #hosts = new Map();
  #stats = {
    hostsOpened: 0,
    prompts: 0,
    waits: 0,
    responses: 0,
    manualCancels: 0,
    indicatorAcquires: 0,
    indicatorReleases: 0,
    authorityWaits: 0,
    lastEvent: null
  };

  constructor({ socket, selectionIndicator }) {
    this.#socket = socket;
    this.#selectionIndicator = selectionIndicator;

    socket.register("reactions.ui.openWaiting", this.#openWaitingSocket.bind(this));
    socket.register("reactions.ui.prompt", this.#promptSocket.bind(this));
    socket.register("reactions.ui.setResolving", this.#setResolvingSocket.bind(this));
    socket.register("reactions.ui.setAuthority", this.#setAuthoritySocket.bind(this));
    socket.register("reactions.ui.closeTransaction", this.#closeTransactionSocket.bind(this));
    socket.register("reactions.ui.closeAll", this.#closeAllSocket.bind(this));
  }

  async openWaiting(opportunity, transaction) {
    return this.#socket.executeAsUser("reactions.ui.openWaiting", opportunity.controllerUserId, {
      transaction: this.#transactionEnvelope(transaction),
      opportunity: this.#opportunityEnvelope(opportunity)
    });
  }

  async prompt(opportunity, transaction) {
    const controllerUserId = opportunity.controllerUserId;
    const payload = {
      transaction: this.#transactionEnvelope(transaction),
      opportunity: this.#opportunityEnvelope(opportunity)
    };

    // A remote controller can disconnect while their DialogV2 is waiting for
    // input. Do not let Socketlib's outstanding request become an indefinite
    // source-workflow gate. Return an internal INTERRUPTED result so the source
    // coordinator can revalidate/reroute the same Reactor. This is deliberately
    // not DECLINED and not MANUAL.
    if (!controllerUserId || controllerUserId === game?.user?.id) {
      return this.#socket.executeAsUser("reactions.ui.prompt", controllerUserId, payload);
    }

    let disconnectHook = null;
    let resolveDisconnect = null;
    const disconnected = new Promise(resolve => { resolveDisconnect = resolve; });
    disconnectHook = Hooks.on("userConnected", (user, connected) => {
      if (user?.id !== controllerUserId || connected) return;
      resolveDisconnect?.({
        type: REACTION_RESPONSES.INTERRUPTED,
        reason: "reactor-controller-disconnected",
        controllerUserId
      });
    });

    const remotePrompt = this.#socket.executeAsUser("reactions.ui.prompt", controllerUserId, payload)
      .catch(error => {
        const targetStillActive = game?.users?.get?.(controllerUserId)?.active;
        if (!targetStillActive) {
          return {
            type: REACTION_RESPONSES.INTERRUPTED,
            reason: "reactor-controller-unavailable",
            controllerUserId
          };
        }
        throw error;
      });

    try {
      return await Promise.race([remotePrompt, disconnected]);
    } finally {
      if (disconnectHook !== null) Hooks.off("userConnected", disconnectHook);
    }
  }

  async setResolving(opportunity, transaction, message = null) {
    return this.#socket.executeAsUser("reactions.ui.setResolving", opportunity.controllerUserId, {
      transactionId: transaction.id,
      reactorTokenUuid: opportunity.reactorTokenUuid,
      message
    });
  }

  async setAuthority(opportunities, transactionId, { available, primaryGmId = null } = {}) {
    const byUser = new Map();
    for (const opportunity of opportunities ?? []) {
      if (!opportunity?.controllerUserId) continue;
      let tokenUuids = byUser.get(opportunity.controllerUserId);
      if (!tokenUuids) {
        tokenUuids = [];
        byUser.set(opportunity.controllerUserId, tokenUuids);
      }
      tokenUuids.push(opportunity.reactorTokenUuid);
    }
    await Promise.all([...byUser].map(([userId, reactorTokenUuids]) => this.#socket.executeAsUser(
      "reactions.ui.setAuthority",
      userId,
      { transactionId, reactorTokenUuids, available: Boolean(available), primaryGmId }
    ).catch(error => Logger.debug("Could not update Reaction Broker authority UI.", error))));
  }

  async closeTransaction(opportunity, transactionId) {
    if (!opportunity?.controllerUserId) return;
    return this.#socket.executeAsUser("reactions.ui.closeTransaction", opportunity.controllerUserId, {
      transactionId,
      reactorTokenUuid: opportunity.reactorTokenUuid
    }).catch(error => Logger.debug("Could not close a remote Reaction Broker view.", error));
  }

  async closeForOpportunities(opportunities, transactionId) {
    await Promise.all((opportunities ?? []).map(opportunity => this.closeTransaction(opportunity, transactionId)));
  }

  async closeAllLocal({ reason = "manual-clear" } = {}) {
    return this.#closeAllSocket({ reason });
  }

  async closeAllEverywhere({ reason = "manual-clear" } = {}) {
    if (!this.#socket.ready) return this.#closeAllSocket({ reason });
    return this.#socket.executeForEveryone("reactions.ui.closeAll", { reason });
  }

  getStats() {
    return {
      ...this.#stats,
      openHosts: this.#hosts.size,
      openViews: [...this.#hosts.values()].reduce((total, host) => total + host.views.length, 0),
      activeIndicators: [...this.#hosts.values()].filter(host => Boolean(host.indicatorLease)).length,
      hosts: [...this.#hosts.values()].map(host => ({
        reactorTokenUuid: host.reactorTokenUuid,
        viewCount: host.views.length,
        topTransactionId: host.views.at(-1)?.transactionId ?? null,
        topStatus: host.views.at(-1)?.status ?? null,
        hasIndicator: Boolean(host.indicatorLease)
      }))
    };
  }

  async #openWaitingSocket({ transaction, opportunity }) {
    const host = await this.#getOrCreateHost(opportunity);
    const view = this.#upsertView(host, {
      transactionId: transaction.id,
      rootTransactionId: transaction.rootTransactionId,
      parentTransactionId: transaction.parentTransactionId,
      coordinatorUserId: transaction.coordinatorUserId,
      sourceName: transaction.sourceName,
      reactorTokenUuid: opportunity.reactorTokenUuid,
      reactorName: opportunity.reactorName,
      offers: opportunity.offers ?? [],
      status: REACTION_TRANSACTION_STATES.WAITING,
      authorityAvailable: transaction.authorityAvailable !== false,
      primaryGmId: transaction.primaryGmId ?? null,
      currentReactorName: transaction.currentReactorName ?? null,
      message: null
    });
    this.#bringToTop(host, view);
    this.#stats.waits += 1;
    this.#record("waiting", { transactionId: transaction.id, reactorTokenUuid: opportunity.reactorTokenUuid });
    await this.#renderHost(host);
    return { opened: true };
  }

  async #promptSocket({ transaction, opportunity }) {
    const host = await this.#getOrCreateHost(opportunity);
    const view = this.#upsertView(host, {
      transactionId: transaction.id,
      rootTransactionId: transaction.rootTransactionId,
      parentTransactionId: transaction.parentTransactionId,
      coordinatorUserId: transaction.coordinatorUserId,
      sourceName: transaction.sourceName,
      reactorTokenUuid: opportunity.reactorTokenUuid,
      reactorName: opportunity.reactorName,
      offers: opportunity.offers ?? [],
      status: transaction.authorityAvailable === false
        ? REACTION_TRANSACTION_STATES.WAITING_FOR_AUTHORITY
        : REACTION_TRANSACTION_STATES.ACTIVE,
      authorityAvailable: transaction.authorityAvailable !== false,
      primaryGmId: transaction.primaryGmId ?? null,
      currentReactorName: opportunity.reactorName,
      message: null
    });
    this.#bringToTop(host, view);
    const validSelections = new Set([...(view.offers ?? []).map(offer => offer.id), DECLINE_VALUE]);
    if (!validSelections.has(view.selectedValue)) view.selectedValue = null;
    this.#stats.prompts += 1;
    this.#record("prompt", { transactionId: transaction.id, reactorTokenUuid: opportunity.reactorTokenUuid, offers: view.offers.length });

    if (view.pendingPromise) {
      await this.#renderHost(host);
      return view.pendingPromise;
    }

    view.responseSubmitted = false;
    view.pendingPromise = new Promise(resolve => { view.resolve = resolve; });
    await this.#renderHost(host);
    return view.pendingPromise;
  }

  async #setResolvingSocket({ transactionId, reactorTokenUuid, message = null }) {
    const host = this.#hosts.get(reactorTokenUuid);
    const view = host?.views.find(entry => entry.transactionId === transactionId);
    if (!host || !view) return { updated: false };
    view.status = REACTION_TRANSACTION_STATES.RESOLVING;
    view.message = message ?? "Resolving reaction…";
    await this.#renderHost(host);
    return { updated: true };
  }

  async #setAuthoritySocket({ transactionId, reactorTokenUuids = [], available, primaryGmId = null }) {
    let updated = 0;
    for (const tokenUuid of reactorTokenUuids) {
      const host = this.#hosts.get(tokenUuid);
      const view = host?.views.find(entry => entry.transactionId === transactionId);
      if (!host || !view) continue;
      view.authorityAvailable = Boolean(available);
      view.primaryGmId = primaryGmId;
      if (!available && [REACTION_TRANSACTION_STATES.ACTIVE, REACTION_TRANSACTION_STATES.RESOLVING].includes(view.status)) {
        view.status = REACTION_TRANSACTION_STATES.WAITING_FOR_AUTHORITY;
        this.#stats.authorityWaits += 1;
      } else if (available && view.status === REACTION_TRANSACTION_STATES.WAITING_FOR_AUTHORITY) {
        view.status = view.responseSubmitted
          ? REACTION_TRANSACTION_STATES.RESOLVING
          : REACTION_TRANSACTION_STATES.ACTIVE;
      }
      await this.#renderHost(host);
      updated += 1;
    }
    return { updated };
  }

  async #closeTransactionSocket({ transactionId, reactorTokenUuid }) {
    const host = this.#hosts.get(reactorTokenUuid);
    if (!host) return { closed: false };
    const index = host.views.findIndex(view => view.transactionId === transactionId);
    if (index < 0) return { closed: false };
    const [view] = host.views.splice(index, 1);
    if (view.resolve) {
      // Programmatic cleanup should never masquerade as a player decline.
      view.resolve({ type: REACTION_RESPONSES.MANUAL, reason: "transaction-closed" });
      view.resolve = null;
    }
    if (!host.views.length) {
      await this.#destroyHost(host, { programmatic: true });
    } else {
      await this.#renderHost(host);
    }
    return { closed: true };
  }

  async #closeAllSocket({ reason = "manual-clear" } = {}) {
    const hosts = [...this.#hosts.values()];
    for (const host of hosts) {
      for (const view of host.views) {
        if (view.resolve) {
          view.resolve({ type: REACTION_RESPONSES.MANUAL, reason });
          view.resolve = null;
        }
      }
      host.views.length = 0;
      await this.#destroyHost(host, { programmatic: true });
    }
    return { closed: hosts.length };
  }

  async #getOrCreateHost(opportunity) {
    const tokenUuid = opportunity.reactorTokenUuid;
    let host = this.#hosts.get(tokenUuid);
    if (host) return host;

    const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
    if (!DialogV2) throw new Error("Foundry DialogV2 is unavailable; Reaction Broker UI cannot open.");

    const dialog = new DialogV2({
      window: { title: "AE5E Reaction Broker" },
      classes: [`${MODULE_ID}-owned-dialog`, "ae5e-reaction-broker-dialog"],
      content: '<div class="ae5e-reaction-broker-host"></div>',
      // Foundry v14 DialogV2 requires at least one configured button. AE5E
      // owns the real Reaction Broker controls inside the persistent host
      // content, so provide one inert hidden placeholder solely to satisfy the
      // DialogV2 contract without creating a second visible control surface.
      buttons: [{
        action: "ae5e-reaction-host",
        label: "Reaction Broker Host",
        type: "button",
        disabled: true,
        style: { display: "none" }
      }],
      modal: false
    });

    host = {
      reactorTokenUuid: tokenUuid,
      reactorName: opportunity.reactorName,
      dialog,
      views: [],
      indicatorLease: null,
      rendered: false,
      programmaticClose: false
    };
    this.#hosts.set(tokenUuid, host);

    dialog.addEventListener?.("close", () => {
      this.#handleUserClosedHost(host).catch(error => Logger.warn("Reaction Broker close handling failed.", error));
    });
    await dialog.render({ force: true });
    host.rendered = true;
    this.#stats.hostsOpened += 1;
    return host;
  }

  #upsertView(host, data) {
    let view = host.views.find(entry => entry.transactionId === data.transactionId);
    if (view) {
      Object.assign(view, data);
      return view;
    }
    view = { ...data, selectedValue: null, responseSubmitted: false, pendingPromise: null, resolve: null };
    host.views.push(view);
    return view;
  }

  #bringToTop(host, view) {
    const index = host.views.indexOf(view);
    if (index >= 0 && index !== host.views.length - 1) {
      host.views.splice(index, 1);
      host.views.push(view);
    }
  }

  async #renderHost(host) {
    const view = host.views.at(-1);
    if (!view) {
      await this.#destroyHost(host, { programmatic: true });
      return;
    }

    const shouldIndicate = view.status === REACTION_TRANSACTION_STATES.ACTIVE && view.authorityAvailable;
    if (shouldIndicate) await this.#acquireIndicator(host, view);
    else await this.#releaseIndicator(host);

    const root = this.#hostElement(host);
    if (!root) {
      // Render may not have settled on a slow client yet.
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    const settledRoot = this.#hostElement(host);
    if (!settledRoot) throw new Error("Reaction Broker DialogV2 rendered without a host element.");
    settledRoot.innerHTML = this.#viewHtml(view);
    this.#bindControls(host, view, settledRoot);
  }

  #viewHtml(view) {
    const source = this.#escape(view.sourceName || "another actor");
    const reactor = this.#escape(view.reactorName || "Reactor");
    const title = `<header class="ae5e-reaction-header"><strong>${reactor}</strong><span>Reaction Broker</span></header>`;

    if (view.status === REACTION_TRANSACTION_STATES.WAITING) {
      const active = view.currentReactorName
        ? ` <strong>${this.#escape(view.currentReactorName)}</strong> is currently deciding.`
        : "";
      const authorityWarning = !view.authorityAvailable
        ? `<div class="ae5e-reaction-gm-warning" role="status">${GM_DISCONNECTED_WARNING}.</div>`
        : "";
      return `${title}<div class="ae5e-reaction-state ae5e-reaction-waiting">
        <p>Please wait while another actor chooses whether or not to use a reaction.</p>
        ${active ? `<p class="hint">${active}</p>` : ""}
        ${authorityWarning}
        <div class="ae5e-reaction-spinner" aria-hidden="true"></div>
        ${this.#cancelButtonHtml()}
      </div>`;
    }

    if (view.status === REACTION_TRANSACTION_STATES.RESOLVING) {
      return `${title}<div class="ae5e-reaction-state ae5e-reaction-resolving">
        <p>${this.#escape(view.message || "Resolving reaction…")}</p>
        <div class="ae5e-reaction-spinner" aria-hidden="true"></div>
      </div>`;
    }

    const authorityMissing = view.status === REACTION_TRANSACTION_STATES.WAITING_FOR_AUTHORITY || !view.authorityAvailable;
    const offers = (view.offers ?? []).map((offer, index) => `<label class="ae5e-reaction-option">
      <input type="radio" name="ae5e-reaction-${this.#escapeAttr(view.transactionId)}" value="${this.#escapeAttr(offer.id)}" ${view.selectedValue === offer.id ? "checked" : ""}>
      ${offer.img ? `<img src="${this.#escapeAttr(offer.img)}" alt="">` : ""}
      <span>${this.#escape(offer.label || offer.handler || "Reaction")}</span>
    </label>`).join("");
    const decline = `<label class="ae5e-reaction-option ae5e-reaction-decline">
      <input type="radio" name="ae5e-reaction-${this.#escapeAttr(view.transactionId)}" value="${DECLINE_VALUE}" ${view.selectedValue === DECLINE_VALUE ? "checked" : ""}>
      <span>Do not use a reaction</span>
    </label>`;
    const warning = authorityMissing
      ? `<div class="ae5e-reaction-gm-warning" role="status">${GM_DISCONNECTED_WARNING}.</div>`
      : "";
    const confirmButton = authorityMissing
      ? `<span class="ae5e-reaction-disabled-control" title="${this.#escapeAttr(GM_DISCONNECTED_WARNING)}"><button type="button" data-action="confirm" disabled>OK</button></span>`
      : `<button type="button" data-action="confirm" ${view.selectedValue ? "" : "disabled"}>OK</button>`;

    return `${title}<div class="ae5e-reaction-state ae5e-reaction-active">
      <p><strong>${source}</strong> has created a reaction opportunity.</p>
      <fieldset class="ae5e-reaction-options"><legend>Choose a reaction</legend>${offers}${decline}</fieldset>
      ${warning}
      <footer class="ae5e-reaction-actions">
        ${confirmButton}
        <button type="button" data-action="cancel">Cancel</button>
      </footer>
    </div>`;
  }

  #cancelButtonHtml() {
    return '<footer class="ae5e-reaction-actions"><button type="button" data-action="cancel">Cancel</button></footer>';
  }

  #bindControls(host, view, root) {
    const confirm = root.querySelector('[data-action="confirm"]');
    for (const radio of root.querySelectorAll('input[type="radio"]')) {
      radio.addEventListener("change", () => {
        if (!radio.checked) return;
        view.selectedValue = radio.value;
        if (confirm && view.authorityAvailable && view.status === REACTION_TRANSACTION_STATES.ACTIVE) confirm.disabled = false;
      });
    }
    confirm?.addEventListener("click", () => {
      if (!view.authorityAvailable || view.status !== REACTION_TRANSACTION_STATES.ACTIVE) return;
      const selected = root.querySelector('input[type="radio"]:checked')?.value;
      if (!selected) return;
      const response = selected === DECLINE_VALUE
        ? { type: REACTION_RESPONSES.DECLINED }
        : { type: REACTION_RESPONSES.SELECTED, offerId: selected };
      this.#resolveView(host, view, response).catch(error => Logger.warn("Reaction Broker response handling failed.", error));
    });

    root.querySelector('[data-action="cancel"]')?.addEventListener("click", () => {
      this.#manualCancel(host, view, "user-cancelled").catch(error => Logger.warn("Reaction Broker manual cancel failed.", error));
    });
  }

  async #resolveView(host, view, response) {
    if (!view.resolve) return;
    const resolve = view.resolve;
    view.resolve = null;
    view.pendingPromise = null;
    view.responseSubmitted = true;
    view.status = REACTION_TRANSACTION_STATES.RESOLVING;
    view.message = response.type === REACTION_RESPONSES.DECLINED ? "Recording decision…" : "Resolving reaction…";
    this.#stats.responses += 1;
    this.#record("response", { transactionId: view.transactionId, type: response.type, offerId: response.offerId ?? null });
    await this.#renderHost(host);
    resolve(response);
  }

  async #manualCancel(host, view, reason) {
    this.#stats.manualCancels += 1;
    this.#record("manual-cancel", { transactionId: view.transactionId, reason });
    const response = { type: REACTION_RESPONSES.MANUAL, reason };
    if (view.resolve) {
      const resolve = view.resolve;
      view.resolve = null;
      view.pendingPromise = null;
      view.status = REACTION_TRANSACTION_STATES.RESOLVING;
      view.message = "Switching to manual reaction selection…";
      await this.#renderHost(host);
      resolve(response);
      return;
    }

    // Waiting Reactors do not have an outstanding prompt Promise, so notify the
    // source coordinator directly. The GM still arbitrates normal decisions;
    // Cancel is explicitly a request to leave automated adjudication.
    if (view.coordinatorUserId) {
      try {
        await this.#socket.executeAsUser("reactions.transaction.manualCancel", view.coordinatorUserId, {
          transactionId: view.transactionId,
          reactorTokenUuid: view.reactorTokenUuid,
          reason
        });
      } catch (error) {
        Logger.warn("Reaction Broker could not deliver a manual-cancel request to the source coordinator.", error);
      }
    }
    view.status = REACTION_TRANSACTION_STATES.RESOLVING;
    view.message = "Switching to manual reaction selection…";
    await this.#renderHost(host);
  }

  async #handleUserClosedHost(host) {
    if (host.programmaticClose || !this.#hosts.has(host.reactorTokenUuid)) return;
    const view = host.views.at(-1);
    if (view) {
      this.#stats.manualCancels += 1;
      this.#record("manual-cancel", { transactionId: view.transactionId, reason: "window-closed" });
      const response = { type: REACTION_RESPONSES.MANUAL, reason: "window-closed" };
      if (view.resolve) {
        const resolve = view.resolve;
        view.resolve = null;
        view.pendingPromise = null;
        resolve(response);
      } else if (view.coordinatorUserId) {
        this.#socket.executeAsUser("reactions.transaction.manualCancel", view.coordinatorUserId, {
          transactionId: view.transactionId,
          reactorTokenUuid: view.reactorTokenUuid,
          reason: "window-closed"
        }).catch(error => Logger.warn("Reaction Broker could not deliver a window-close manual request.", error));
      }
    }
    // A user-initiated X closes the visual host. The transaction receives MANUAL
    // and will close every participant window as it unwinds.
    await this.#releaseIndicator(host);
    this.#hosts.delete(host.reactorTokenUuid);
  }

  async #acquireIndicator(host, view) {
    if (host.indicatorLease) return;
    host.indicatorLease = await this.#selectionIndicator.acquire({
      tokenUuid: view.reactorTokenUuid,
      reason: `reaction-broker:${view.transactionId}`,
      role: SELECTION_INDICATOR_ROLES.RESPONDER,
      playSound: true,
      notifyUserId: game?.user?.id ?? null
    });
    this.#stats.indicatorAcquires += 1;
  }

  async #releaseIndicator(host) {
    if (!host.indicatorLease) return;
    const lease = host.indicatorLease;
    host.indicatorLease = null;
    await this.#selectionIndicator.release(lease);
    this.#stats.indicatorReleases += 1;
  }

  async #destroyHost(host, { programmatic = true } = {}) {
    await this.#releaseIndicator(host);
    this.#hosts.delete(host.reactorTokenUuid);
    host.programmaticClose = programmatic;
    try {
      await host.dialog?.close?.();
    } catch (error) {
      Logger.debug("Reaction Broker DialogV2 close failed during cleanup.", error);
    } finally {
      host.programmaticClose = false;
    }
  }

  #hostElement(host) {
    const element = host.dialog?.element;
    if (!element) return null;
    if (typeof element.querySelector === "function") return element.querySelector(".ae5e-reaction-broker-host");
    return element?.[0]?.querySelector?.(".ae5e-reaction-broker-host") ?? null;
  }

  #transactionEnvelope(transaction) {
    const context = transaction.context?.toJSON?.() ?? transaction.context ?? {};
    return {
      id: transaction.id,
      rootTransactionId: transaction.rootTransactionId,
      parentTransactionId: transaction.parentTransactionId,
      coordinatorUserId: context.coordinatorUserId ?? game?.user?.id ?? null,
      sourceName: context.source?.tokenName ?? context.source?.actorName ?? context.source?.itemName ?? "Attacker",
      currentReactorName: transaction.currentIndex >= 0 ? transaction.opportunities?.[transaction.currentIndex]?.reactorName ?? null : null,
      authorityAvailable: Boolean(transaction.authorityAvailable ?? true),
      primaryGmId: transaction.primaryGmId ?? null
    };
  }

  #opportunityEnvelope(opportunity) {
    return {
      reactorActorUuid: opportunity.reactorActorUuid,
      reactorTokenUuid: opportunity.reactorTokenUuid,
      reactorName: opportunity.reactorName,
      controllerUserId: opportunity.controllerUserId,
      offers: (opportunity.offers ?? []).map(offer => ({
        id: offer.id,
        label: offer.label,
        handler: offer.handler,
        img: offer.img ?? null
      }))
    };
  }

  #record(type, details) {
    this.#stats.lastEvent = { at: new Date().toISOString(), type, details };
  }

  #escape(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  #escapeAttr(value) {
    return this.#escape(value).replaceAll("`", "&#096;");
  }
}
