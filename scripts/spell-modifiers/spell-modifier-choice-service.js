import { MODULE_ID, SELECTION_INDICATOR_ROLES } from "../core/constants.js";
import { Logger } from "../core/logger.js";

export class SpellModifierChoiceService {
  #socket;
  #selectionIndicator;
  #stats = {
    prompts: 0,
    remotePrompts: 0,
    selections: 0,
    skips: 0,
    closes: 0,
    failures: 0,
    lastEvent: null
  };

  constructor({ socket, selectionIndicator }) {
    this.#socket = socket;
    this.#selectionIndicator = selectionIndicator;
    socket.register("sme.ui.choose", this.#chooseSocket.bind(this));
  }

  async choose({ session, context, offers, controllerUserId, chooser = null } = {}) {
    if (!offers?.length) return [];
    if (typeof chooser === "function") {
      const result = await chooser({ session, context, offers });
      return this.#normalizeSelection(result, offers);
    }

    const payload = {
      session: {
        id: session.id,
        workflowId: session.workflowId,
        source: session.source
      },
      context: context.toJSON(),
      offers: offers.map(offer => this.#offerEnvelope(offer))
    };

    const userId = controllerUserId ?? game?.user?.id ?? null;
    if (!userId) return [];
    if (userId !== game?.user?.id) this.#stats.remotePrompts += 1;
    const result = await this.#socket.executeAsUser("sme.ui.choose", userId, payload);
    return this.#normalizeSelection(result?.selectedIds ?? result, offers);
  }

  getStats() {
    return { ...this.#stats };
  }

  async #chooseSocket({ session, context, offers }) {
    this.#stats.prompts += 1;
    this.#record("prompt", { sessionId: session?.id ?? null, offers: offers?.length ?? 0 });

    const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
    if (!DialogV2) {
      this.#stats.failures += 1;
      throw new Error("Foundry DialogV2 is unavailable; Spell Modifier Engine choice UI cannot open.");
    }

    const tokenUuid = context?.source?.tokenUuid ?? null;
    let indicatorLease = null;
    try {
      indicatorLease = await this.#selectionIndicator.acquire({
        tokenUuid,
        reason: "spell-modifier-choice",
        role: SELECTION_INDICATOR_ROLES.ORIGINATOR,
        notifyUserId: game?.user?.id ?? null,
        playSound: true
      });
    } catch (error) {
      Logger.debug("SME choice indicator could not start; continuing without it.", error);
    }

    let resolveChoice;
    let settled = false;
    const promise = new Promise(resolve => { resolveChoice = resolve; });
    const finish = async selectedIds => {
      if (settled) return;
      settled = true;
      const normalized = Array.isArray(selectedIds) ? selectedIds : [];
      if (normalized.length) this.#stats.selections += normalized.length;
      else this.#stats.skips += 1;
      try { await indicatorLease?.release?.(); } catch { /* advisory UI */ }
      resolveChoice({ selectedIds: normalized });
    };

    const spellName = context?.source?.itemName ?? "Spell";
    const dialog = new DialogV2({
      window: { title: "AE5E Spell Modifier Engine" },
      classes: [`${MODULE_ID}-owned-dialog`, "ae5e-sme-dialog"],
      content: '<div class="ae5e-sme-host"></div>',
      buttons: [{
        action: "ae5e-sme-host",
        label: "Spell Modifier Engine Host",
        type: "button",
        disabled: true,
        style: { display: "none" }
      }],
      modal: false
    });

    dialog.addEventListener?.("close", () => {
      this.#stats.closes += 1;
      finish([]).catch(() => null);
    });

    await dialog.render({ force: true });
    await new Promise(resolve => setTimeout(resolve, 0));
    const element = dialog.element;
    const root = typeof element?.querySelector === "function"
      ? element.querySelector(".ae5e-sme-host")
      : element?.[0]?.querySelector?.(".ae5e-sme-host") ?? null;
    if (!root) {
      await finish([]);
      try { await dialog.close(); } catch { /* noop */ }
      throw new Error("SME DialogV2 rendered without its host element.");
    }

    root.innerHTML = this.#html({ spellName, offers });
    const inputs = [...root.querySelectorAll('input[type="checkbox"][data-ae5e-sme-offer]')];
    const apply = root.querySelector('[data-ae5e-sme-action="apply"]');
    const skip = root.querySelector('[data-ae5e-sme-action="skip"]');

    const enforce = changed => {
      if (!changed?.checked) return;
      const selectionGroup = changed.dataset.selectionGroup || null;
      const conflictGroup = changed.dataset.conflictGroup || null;
      for (const input of inputs) {
        if (input === changed || !input.checked) continue;
        if (selectionGroup && input.dataset.selectionGroup === selectionGroup) input.checked = false;
        else if (conflictGroup && input.dataset.conflictGroup === conflictGroup) input.checked = false;
      }
    };

    for (const input of inputs) input.addEventListener("change", () => enforce(input));

    apply?.addEventListener("click", async event => {
      event.preventDefault();
      const selectedIds = inputs.filter(input => input.checked).map(input => input.value);
      await finish(selectedIds);
      try { await dialog.close(); } catch { /* noop */ }
    });

    skip?.addEventListener("click", async event => {
      event.preventDefault();
      await finish([]);
      try { await dialog.close(); } catch { /* noop */ }
    });

    return promise;
  }

  #normalizeSelection(result, offers) {
    const ids = Array.isArray(result)
      ? result
      : Array.isArray(result?.selectedIds)
        ? result.selectedIds
        : result == null
          ? []
          : [result];
    const valid = new Set(offers.map(offer => offer.id));
    return [...new Set(ids.map(String).filter(id => valid.has(id)))];
  }

  #offerEnvelope(offer) {
    return {
      id: offer.id,
      label: offer.label,
      description: offer.description ?? null,
      img: offer.img ?? null,
      modifierId: offer.modifierId,
      sourceName: offer.source?.name ?? offer.sourceName ?? null,
      sourceUuid: offer.source?.uuid ?? offer.sourceUuid ?? null,
      selectionGroup: offer.selectionGroup ?? null,
      conflictGroup: offer.conflictGroup ?? null
    };
  }

  #html({ spellName, offers }) {
    const rows = (offers ?? []).map(offer => `<label class="ae5e-sme-option">
      <input type="checkbox" data-ae5e-sme-offer value="${this.#escapeAttr(offer.id)}"
        data-selection-group="${this.#escapeAttr(offer.selectionGroup ?? "")}"
        data-conflict-group="${this.#escapeAttr(offer.conflictGroup ?? "")}">
      ${offer.img ? `<img src="${this.#escapeAttr(offer.img)}" alt="">` : ""}
      <span class="ae5e-sme-option-copy">
        <strong>${this.#escape(offer.label ?? offer.modifierId ?? "Modifier")}</strong>
        ${offer.sourceName ? `<small>${this.#escape(offer.sourceName)}</small>` : ""}
        ${offer.description ? `<span>${this.#escape(offer.description)}</span>` : ""}
      </span>
    </label>`).join("");

    return `<header class="ae5e-sme-header"><strong>${this.#escape(spellName)}</strong><span>Spell Modifier Engine</span></header>
      <div class="ae5e-sme-state">
        <p>Select any legal modifiers to apply to this spell at this stage.</p>
        <div class="ae5e-sme-options">${rows}</div>
        <div class="ae5e-sme-actions">
          <button type="button" data-ae5e-sme-action="skip">Continue without modifiers</button>
          <button type="button" data-ae5e-sme-action="apply">Apply selected modifiers</button>
        </div>
      </div>`;
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
    return this.#escape(value);
  }

  #record(type, details) {
    this.#stats.lastEvent = { at: new Date().toISOString(), type, details };
  }
}
