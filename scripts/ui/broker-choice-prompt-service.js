import { MODULE_ID, SELECTION_INDICATOR_ROLES } from "../core/constants.js";
import { Logger } from "../core/logger.js";

function asArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return [...value];
  if (typeof value.values === "function") return [...value.values()];
  return [];
}

/**
 * Generic controller-routed broker prompt.
 *
 * Feature Items own every visible string and every rule. AE5E only renders
 * serializable choice/resource data, projects costs, enforces declared generic
 * selection capacity, and returns confirm/decline/abort outcomes.
 */
export class BrokerChoicePromptService {
  #socket;
  #selectionIndicator;
  #controllerResolver;
  #authority;
  #stats = {
    requests: 0,
    localPrompts: 0,
    remotePrompts: 0,
    gmFallbacks: 0,
    disconnectReroutes: 0,
    confirmations: 0,
    declines: 0,
    aborts: 0,
    failures: 0,
    lastEvent: null
  };

  constructor({ socket, selectionIndicator, controllerResolver, authority }) {
    this.#socket = socket;
    this.#selectionIndicator = selectionIndicator;
    this.#controllerResolver = controllerResolver;
    this.#authority = authority;
    socket.register("prompts.chooseBroker", this.#promptSocket.bind(this));
  }

  validateRequest({
    title,
    prompt = "",
    banner = null,
    choices,
    role = SELECTION_INDICATOR_ROLES.RESPONDER,
    resource = null,
    selectionCapacity = null,
    closeOutcome = "decline"
  } = {}) {
    if (typeof title !== "string" || !title.trim()) return { valid: false, reason: "invalid-title" };
    if (typeof prompt !== "string") return { valid: false, reason: "invalid-prompt" };
    if (banner !== null && (typeof banner !== "string" || !banner.trim())) return { valid: false, reason: "invalid-banner" };
    if (!Object.values(SELECTION_INDICATOR_ROLES).includes(role)) return { valid: false, reason: "invalid-indicator-role" };
    if (!Array.isArray(choices) || choices.length < 1) return { valid: false, reason: "missing-choices" };
    if (selectionCapacity != null && (!Number.isSafeInteger(selectionCapacity) || selectionCapacity < 1)) {
      return { valid: false, reason: "invalid-selection-capacity" };
    }
    if (!["abort", "decline"].includes(closeOutcome)) return { valid: false, reason: "invalid-close-outcome" };

    if (resource !== null) {
      const current = Number(resource?.current);
      const max = Number(resource?.max);
      if (!Number.isFinite(current) || current < 0 || !Number.isFinite(max) || max < current
        || typeof resource?.summary !== "string" || !resource.summary.trim()) {
        return { valid: false, reason: "invalid-resource" };
      }
    }

    const seen = new Set();
    for (const choice of choices) {
      if (!choice || typeof choice !== "object") return { valid: false, reason: "invalid-choice" };
      const id = String(choice.id ?? "").trim();
      const label = String(choice.label ?? "").trim();
      const cost = Number(choice.cost ?? 0);
      const selectionCost = Number(choice.selectionCost ?? 1);
      if (!id) return { valid: false, reason: "invalid-choice-id" };
      if (!label) return { valid: false, reason: "invalid-choice-label" };
      if (seen.has(id)) return { valid: false, reason: "duplicate-choice-id" };
      if (!Number.isFinite(cost) || cost < 0) return { valid: false, reason: "invalid-choice-cost" };
      if (!Number.isSafeInteger(selectionCost) || selectionCost < 0) return { valid: false, reason: "invalid-selection-cost" };
      if (choice.description != null && typeof choice.description !== "string") return { valid: false, reason: "invalid-description" };
      if (choice.costLabel != null && typeof choice.costLabel !== "string") return { valid: false, reason: "invalid-cost-label" };
      for (const field of ["advisories", "reasons"]) {
        if (choice[field] !== undefined && (!Array.isArray(choice[field])
          || choice[field].some(value => typeof value !== "string" || !value.trim()))) {
          return { valid: false, reason: "invalid-" + field };
        }
      }
      seen.add(id);
    }
    return { valid: true };
  }

  async choose({
    actor = null,
    actorUuid = null,
    token = null,
    tokenUuid = null,
    controllerUserId = null,
    title,
    prompt = "",
    banner = null,
    choices,
    resource = null,
    selectionCapacity = null,
    selectionCapacityReason = null,
    resourceInsufficientReason = null,
    role = SELECTION_INDICATOR_ROLES.RESPONDER,
    reason = "broker-choice-prompt",
    playSound = true,
    confirmLabel = "Confirm",
    declineLabel = "Continue",
    closeOutcome = "decline"
  } = {}) {
    const validation = this.validateRequest({
      title, prompt, banner, choices, role, resource, selectionCapacity, closeOutcome
    });
    if (!validation.valid) throw new Error("AE5E broker prompt request is invalid: " + validation.reason + ".");

    const normalized = choices.map(choice => ({
      id: String(choice.id).trim(),
      label: String(choice.label).trim(),
      description: choice.description == null ? "" : String(choice.description),
      cost: Number(choice.cost ?? 0),
      costLabel: choice.costLabel == null ? String(choice.cost ?? 0) : String(choice.costLabel),
      selectionCost: Number(choice.selectionCost ?? 1),
      disabled: choice.disabled === true,
      advisories: (choice.advisories ?? []).map(String),
      reasons: (choice.reasons ?? []).map(String)
    }));

    const controller = await this.#controllerResolver.resolveController({
      actor, actorUuid, token, tokenUuid, controllerUserId
    });
    if (!controller?.userId) throw new Error("AE5E broker prompt could not find an active player controller or active GM.");

    const payload = {
      title: String(title),
      prompt: String(prompt),
      banner: banner == null ? null : String(banner),
      choices: normalized,
      resource: resource == null ? null : {
        current: Number(resource.current),
        max: Number(resource.max),
        summary: String(resource.summary)
      },
      selectionCapacity: selectionCapacity == null ? null : Number(selectionCapacity),
      selectionCapacityReason: selectionCapacityReason == null ? null : String(selectionCapacityReason),
      resourceInsufficientReason: resourceInsufficientReason == null ? null : String(resourceInsufficientReason),
      tokenUuid: controller.tokenUuid ?? token?.document?.uuid ?? token?.uuid ?? tokenUuid ?? null,
      actorUuid: controller.actorUuid ?? actor?.uuid ?? actorUuid ?? null,
      role,
      reason: String(reason || "broker-choice-prompt"),
      playSound: playSound !== false,
      confirmLabel: String(confirmLabel || "Confirm"),
      declineLabel: String(declineLabel || "Continue"),
      closeOutcome
    };

    this.#stats.requests += 1;
    if (controller.isGM) this.#stats.gmFallbacks += 1;
    if (controller.userId === game?.user?.id) this.#stats.localPrompts += 1;
    else this.#stats.remotePrompts += 1;
    this.#record("request", { controllerUserId: controller.userId, title: payload.title, choices: normalized.map(choice => choice.id) });

    try {
      const response = await this.#executeOnController(controller, payload);
      const outcome = ["confirm", "decline", "abort"].includes(response?.outcome)
        ? response.outcome
        : closeOutcome;
      const validIds = new Set(normalized.filter(choice => !choice.disabled).map(choice => choice.id));
      const selectedIds = [...new Set(asArray(response?.selectedIds).map(String))].filter(id => validIds.has(id));
      if (outcome === "confirm") {
        if (!selectedIds.length) throw new Error("AE5E broker prompt confirmed without a valid selection.");
        const selectedChoices = normalized.filter(choice => selectedIds.includes(choice.id));
        const selectionUsed = selectedChoices.reduce((sum, choice) => sum + choice.selectionCost, 0);
        const selectedCost = selectedChoices.reduce((sum, choice) => sum + choice.cost, 0);
        if (selectionCapacity != null && selectionUsed > selectionCapacity) {
          throw new Error("AE5E broker prompt returned a selection above the declared capacity.");
        }
        if (resource != null && selectedCost > Number(resource.current)) {
          throw new Error("AE5E broker prompt returned a selection above the declared resource balance.");
        }
        this.#stats.confirmations += 1;
      } else if (outcome === "abort") this.#stats.aborts += 1;
      else this.#stats.declines += 1;
      this.#record(outcome, { controllerUserId: response?.controllerUserId ?? controller.userId, selectedIds });
      return { outcome, selectedIds, controllerUserId: response?.controllerUserId ?? controller.userId };
    } catch (error) {
      this.#stats.failures += 1;
      this.#record("failed", { controllerUserId: controller.userId, error: error?.message ?? String(error) });
      throw error;
    }
  }

  getStats() {
    return { ...this.#stats };
  }

  async #executeOnController(controller, payload) {
    const userId = controller.userId;
    if (!userId || userId === game?.user?.id) {
      return this.#socket.executeAsUser("prompts.chooseBroker", userId, payload);
    }

    let disconnectHook = null;
    let resolveDisconnect = null;
    const disconnected = new Promise(resolve => { resolveDisconnect = resolve; });
    if (globalThis.Hooks?.on) {
      disconnectHook = Hooks.on("userConnected", (user, connected) => {
        if (user?.id !== userId || connected) return;
        resolveDisconnect?.({ interrupted: true });
      });
    }

    const remote = this.#socket.executeAsUser("prompts.chooseBroker", userId, payload)
      .then(value => ({ completed: true, value }))
      .catch(error => ({ failed: true, error }));

    try {
      const result = await Promise.race([remote, disconnected]);
      if (result?.completed) return result.value;
      await new Promise(resolve => setTimeout(resolve, 50));
      if (result?.failed && game?.users?.get?.(userId)?.active === true) throw result.error;

      const gm = this.#activeGm(new Set([userId]));
      if (!gm) {
        if (result?.failed) throw result.error;
        throw new Error("AE5E broker prompt controller disconnected and no active GM is available.");
      }
      this.#stats.disconnectReroutes += 1;
      this.#stats.gmFallbacks += 1;
      const rerouted = await this.#socket.executeAsUser("prompts.chooseBroker", gm.id, {
        ...payload,
        reroutedFromUserId: userId
      });
      return { ...rerouted, controllerUserId: gm.id, rerouted: true };
    } finally {
      if (disconnectHook !== null) Hooks.off("userConnected", disconnectHook);
    }
  }

  async #promptSocket(payload) {
    const validation = this.validateRequest(payload);
    if (!validation.valid) throw new Error("AE5E remote broker payload is invalid: " + validation.reason + ".");

    const choices = payload.choices.map(choice => ({
      id: String(choice.id),
      label: String(choice.label),
      description: choice.description == null ? "" : String(choice.description),
      cost: Number(choice.cost ?? 0),
      costLabel: choice.costLabel == null ? String(choice.cost ?? 0) : String(choice.costLabel),
      selectionCost: Number(choice.selectionCost ?? 1),
      disabled: choice.disabled === true,
      advisories: (choice.advisories ?? []).map(String),
      reasons: (choice.reasons ?? []).map(String)
    }));

    const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
    if (!DialogV2) throw new Error("Foundry DialogV2 is unavailable; AE5E broker prompt cannot open.");

    const selected = new Set();
    let settled = false;
    let programmaticClose = false;
    let resolveResult = null;
    const resultPromise = new Promise(resolve => { resolveResult = resolve; });

    const dialog = new DialogV2({
      window: { title: payload.title },
      position: { width: 550 },
      classes: [MODULE_ID + "-owned-dialog", "ae5e-broker-choice-dialog"],
      content: '<div class="ae5e-broker-choice-host"></div>',
      buttons: [],
      modal: false
    });

    const finish = async (outcome, selectedIds = []) => {
      if (settled) return;
      settled = true;
      resolveResult?.({ outcome, selectedIds, controllerUserId: game?.user?.id ?? null });
      resolveResult = null;
      programmaticClose = true;
      try { await dialog.close?.(); }
      catch (error) { Logger.debug("AE5E broker prompt close failed after response.", error); }
      finally { programmaticClose = false; }
    };

    dialog.addEventListener?.("close", () => {
      if (programmaticClose || settled) return;
      settled = true;
      resolveResult?.({
        outcome: payload.closeOutcome === "abort" ? "abort" : "decline",
        selectedIds: [],
        controllerUserId: game?.user?.id ?? null
      });
      resolveResult = null;
    });

    const totals = () => {
      const spent = choices.filter(choice => selected.has(choice.id))
        .reduce((sum, choice) => sum + choice.cost, 0);
      const selectionUsed = choices.filter(choice => selected.has(choice.id))
        .reduce((sum, choice) => sum + choice.selectionCost, 0);
      return {
        spent,
        selectionUsed,
        remaining: payload.resource ? Math.max(0, Number(payload.resource.current) - spent) : null
      };
    };

    const canAdd = choice => {
      if (choice.disabled) return false;
      if (selected.has(choice.id)) return true;
      const current = totals();
      if (payload.selectionCapacity != null
        && current.selectionUsed + choice.selectionCost > Number(payload.selectionCapacity)) return false;
      if (payload.resource && choice.cost > current.remaining) return false;
      return true;
    };

    const summary = () => {
      if (!payload.resource) return "";
      const values = totals();
      return String(payload.resource.summary)
        .replaceAll("{remaining}", String(values.remaining))
        .replaceAll("{current}", String(payload.resource.current))
        .replaceAll("{max}", String(payload.resource.max))
        .replaceAll("{selectedCost}", String(values.spent));
    };

    const statusHtml = lines => {
      if (!lines.length) return "";
      return '<div class="ae5e-broker-status" role="status">'
        + lines.map(line => "<div>" + this.#escape(line) + "</div>").join("")
        + "</div>";
    };

    const optionHtml = choice => {
      const checked = selected.has(choice.id);
      const temporarilyBlocked = !choice.disabled && !checked && !canAdd(choice);
      const disabled = choice.disabled || temporarilyBlocked;
      const lines = [...choice.advisories, ...choice.reasons];
      if (temporarilyBlocked) {
        const current = totals();
        if (payload.selectionCapacity != null
          && current.selectionUsed + choice.selectionCost > Number(payload.selectionCapacity)
          && payload.selectionCapacityReason) lines.push(String(payload.selectionCapacityReason));
        if (payload.resource && choice.cost > current.remaining && payload.resourceInsufficientReason) {
          lines.push(String(payload.resourceInsufficientReason));
        }
      }
      return '<label class="ae5e-broker-option'
        + (choice.disabled ? " is-disabled" : "")
        + (temporarilyBlocked ? " is-blocked" : "")
        + '" data-choice-id="' + this.#escapeAttr(choice.id) + '">'
        + '<span class="ae5e-broker-option-heading">'
        + '<input type="checkbox" value="' + this.#escapeAttr(choice.id) + '"'
        + (checked ? " checked" : "") + (disabled ? " disabled" : "") + '>'
        + '<strong class="ae5e-broker-option-name">' + this.#escape(choice.label) + "</strong>"
        + '<span class="ae5e-broker-option-cost">' + this.#escape(choice.costLabel) + "</span>"
        + "</span>"
        + (choice.description ? '<span class="ae5e-broker-option-description">' + this.#escape(choice.description) + "</span>" : "")
        + statusHtml(lines)
        + "</label>";
    };

    const render = () => {
      const element = dialog.element;
      const root = element?.querySelector?.(".ae5e-broker-choice-host")
        ?? element?.[0]?.querySelector?.(".ae5e-broker-choice-host")
        ?? null;
      if (!root) return false;

      root.innerHTML = '<div class="ae5e-broker-choice">'
        + (payload.banner ? '<div class="ae5e-broker-banner"><img src="' + this.#escapeAttr(payload.banner) + '" alt=""></div>' : "")
        + (payload.prompt ? '<div class="ae5e-broker-prompt">' + this.#escape(payload.prompt) + "</div>" : "")
        + (payload.resource ? '<div class="ae5e-broker-resource">' + this.#escape(summary()) + "</div>" : "")
        + '<div class="ae5e-broker-options">' + choices.map(optionHtml).join("") + "</div>"
        + '<footer class="ae5e-broker-actions">'
        + '<button type="button" data-action="confirm"' + (selected.size ? "" : " disabled") + ">"
        + this.#escape(payload.confirmLabel) + "</button>"
        + '<button type="button" data-action="decline">' + this.#escape(payload.declineLabel) + "</button>"
        + "</footer></div>";

      for (const row of root.querySelectorAll(".ae5e-broker-option")) {
        const checkbox = row.querySelector('input[type="checkbox"]');
        if (!checkbox || checkbox.disabled) continue;
        row.addEventListener("click", event => {
          if (event.target?.closest?.('input[type="checkbox"]')) return;
          checkbox.click();
        });
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) selected.add(checkbox.value);
          else selected.delete(checkbox.value);
          render();
        });
      }

      root.querySelector('[data-action="confirm"]')?.addEventListener("click", () => {
        if (!selected.size) return;
        void finish("confirm", [...selected]);
      });
      root.querySelector('[data-action="decline"]')?.addEventListener("click", () => {
        void finish("decline", []);
      });
      return true;
    };

    const lease = this.#selectionIndicator?.acquire
      ? await this.#selectionIndicator.acquire({
          tokenUuid: payload.tokenUuid ?? null,
          reason: payload.reason ?? "broker-choice-prompt",
          role: payload.role ?? SELECTION_INDICATOR_ROLES.RESPONDER,
          playSound: payload.playSound !== false,
          notifyUserId: game?.user?.id ?? null
        })
      : null;

    try {
      await dialog.render({ force: true });
      if (!render()) {
        await new Promise(resolve => setTimeout(resolve, 0));
        if (!render()) throw new Error("AE5E broker prompt rendered without its host element.");
      }
      return await resultPromise;
    } finally {
      if (lease) {
        try { await this.#selectionIndicator.release(lease); }
        catch (error) { Logger.debug("AE5E broker prompt could not release its selection indicator.", error); }
      }
    }
  }

  #activeGm(excluded = new Set()) {
    const candidates = [];
    const primary = this.#authority?.getPrimaryGm?.() ?? null;
    if (primary) candidates.push(primary);
    const foundryActive = game?.users?.activeGM ?? asArray(game?.users).find(user => user?.isActiveGM) ?? null;
    if (foundryActive) candidates.push(foundryActive);
    candidates.push(...asArray(game?.users).filter(user => user?.active && user?.isGM));
    return candidates.find(user => user?.active && user?.isGM && !excluded.has(user.id)) ?? null;
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
    return this.#escape(value).replaceAll(String.fromCharCode(96), "&#096;");
  }

  #record(type, details) {
    this.#stats.lastEvent = { type, at: Date.now(), details };
  }
}
