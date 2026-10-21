import { MODULE_ID, SELECTION_INDICATOR_ROLES } from "../core/constants.js";
import { Logger } from "../core/logger.js";

function asArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return [...value];
  if (typeof value.values === "function") return [...value.values()];
  return [];
}

const BROKER_PRESENTATION_FIELDS = Object.freeze({
  title: Object.freeze(["fontSize", "fontWeight"]),
  prompt: Object.freeze(["fontSize", "fontWeight"]),
  resource: Object.freeze(["fontSize", "fontWeight"]),
  optionName: Object.freeze(["fontSize", "fontWeight"]),
  optionDescription: Object.freeze(["fontSize", "fontWeight"]),
  optionCost: Object.freeze(["fontSize", "fontWeight"]),
  advisory: Object.freeze([
    "fontSize",
    "fontWeight",
    "textColor",
    "borderColor",
    "backgroundColor",
    "backgroundOpacity",
    "borderOpacity"
  ]),
  reason: Object.freeze([
    "fontSize",
    "fontWeight",
    "textColor",
    "borderColor",
    "backgroundColor",
    "backgroundOpacity",
    "borderOpacity"
  ]),
  confirmButton: Object.freeze(["fontSize", "fontWeight"]),
  declineButton: Object.freeze(["fontSize", "fontWeight"])
});

const BROKER_STATUS_DEFAULTS = Object.freeze({
  advisory: Object.freeze({
    textColor: "#ff9f1c",
    borderColor: "#ff9f1c",
    backgroundColor: "#ff9f1c",
    backgroundOpacity: 0.14,
    borderOpacity: 0.6
  }),
  reason: Object.freeze({
    textColor: "#f05b5b",
    borderColor: "#dc4646",
    backgroundColor: "#731818",
    backgroundOpacity: 0.22,
    borderOpacity: 0.6
  })
});

const BROKER_PRESENTATION_VARIABLES = Object.freeze({
  title: Object.freeze({
    fontSize: "--ae5e-broker-title-font-size",
    fontWeight: "--ae5e-broker-title-font-weight"
  }),
  prompt: Object.freeze({
    fontSize: "--ae5e-broker-prompt-font-size",
    fontWeight: "--ae5e-broker-prompt-font-weight"
  }),
  resource: Object.freeze({
    fontSize: "--ae5e-broker-resource-font-size",
    fontWeight: "--ae5e-broker-resource-font-weight"
  }),
  optionName: Object.freeze({
    fontSize: "--ae5e-broker-option-name-font-size",
    fontWeight: "--ae5e-broker-option-name-font-weight"
  }),
  optionDescription: Object.freeze({
    fontSize: "--ae5e-broker-option-description-font-size",
    fontWeight: "--ae5e-broker-option-description-font-weight"
  }),
  optionCost: Object.freeze({
    fontSize: "--ae5e-broker-option-cost-font-size",
    fontWeight: "--ae5e-broker-option-cost-font-weight"
  }),
  advisory: Object.freeze({
    fontSize: "--ae5e-broker-advisory-font-size",
    fontWeight: "--ae5e-broker-advisory-font-weight",
    textColor: "--ae5e-broker-advisory-text-color",
    borderColor: "--ae5e-broker-advisory-border-color",
    backgroundColor: "--ae5e-broker-advisory-background-color"
  }),
  reason: Object.freeze({
    fontSize: "--ae5e-broker-reason-font-size",
    fontWeight: "--ae5e-broker-reason-font-weight",
    textColor: "--ae5e-broker-reason-text-color",
    borderColor: "--ae5e-broker-reason-border-color",
    backgroundColor: "--ae5e-broker-reason-background-color"
  }),
  confirmButton: Object.freeze({
    fontSize: "--ae5e-broker-confirm-button-font-size",
    fontWeight: "--ae5e-broker-confirm-button-font-weight"
  }),
  declineButton: Object.freeze({
    fontSize: "--ae5e-broker-decline-button-font-size",
    fontWeight: "--ae5e-broker-decline-button-font-weight"
  })
});

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validFontSize(value) {
  return Number.isFinite(value) && value >= 8 && value <= 48;
}

function validFontWeight(value) {
  return Number.isSafeInteger(value) && value >= 100 && value <= 900 && value % 100 === 0;
}

function validHexColor(value) {
  return typeof value === "string" && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
}

function validOpacity(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function validatePresentation(presentation) {
  if (presentation == null) return { valid: true };
  if (!isPlainObject(presentation)) return { valid: false, reason: "invalid-presentation" };

  for (const [slot, style] of Object.entries(presentation)) {
    const allowed = BROKER_PRESENTATION_FIELDS[slot];
    if (!allowed || !isPlainObject(style)) {
      return { valid: false, reason: "invalid-presentation-" + slot };
    }

    for (const [field, value] of Object.entries(style)) {
      if (!allowed.includes(field)) {
        return { valid: false, reason: "invalid-presentation-" + slot + "-" + field };
      }
      if (field === "fontSize" && !validFontSize(value)) {
        return { valid: false, reason: "invalid-presentation-" + slot + "-fontSize" };
      }
      if (field === "fontWeight" && !validFontWeight(value)) {
        return { valid: false, reason: "invalid-presentation-" + slot + "-fontWeight" };
      }
      if (["textColor", "borderColor", "backgroundColor"].includes(field) && !validHexColor(value)) {
        return { valid: false, reason: "invalid-presentation-" + slot + "-" + field };
      }
      if (["backgroundOpacity", "borderOpacity"].includes(field) && !validOpacity(value)) {
        return { valid: false, reason: "invalid-presentation-" + slot + "-" + field };
      }
    }
  }

  return { valid: true };
}

function normalizePresentation(presentation) {
  if (presentation == null) return null;
  return Object.fromEntries(
    Object.entries(presentation).map(([slot, style]) => [
      slot,
      Object.fromEntries(Object.entries(style))
    ])
  );
}

function hexToRgba(hex, opacity) {
  const normalized = hex.slice(1);
  const expanded = normalized.length === 3
    ? normalized.split("").map(value => value + value).join("")
    : normalized;
  const channels = [
    Number.parseInt(expanded.slice(0, 2), 16),
    Number.parseInt(expanded.slice(2, 4), 16),
    Number.parseInt(expanded.slice(4, 6), 16)
  ];
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${opacity})`;
}

function presentationVariables(presentation) {
  if (!presentation) return {};
  const variables = {};

  for (const [slot, style] of Object.entries(presentation)) {
    const names = BROKER_PRESENTATION_VARIABLES[slot];
    if (!names) continue;

    if (style.fontSize !== undefined) variables[names.fontSize] = style.fontSize + "px";
    if (style.fontWeight !== undefined) variables[names.fontWeight] = String(style.fontWeight);

    if (slot !== "advisory" && slot !== "reason") continue;

    const defaults = BROKER_STATUS_DEFAULTS[slot];
    if (style.textColor !== undefined) variables[names.textColor] = style.textColor;

    if (style.borderColor !== undefined || style.borderOpacity !== undefined) {
      variables[names.borderColor] = hexToRgba(
        style.borderColor ?? defaults.borderColor,
        style.borderOpacity ?? defaults.borderOpacity
      );
    }

    if (style.backgroundColor !== undefined || style.backgroundOpacity !== undefined) {
      variables[names.backgroundColor] = hexToRgba(
        style.backgroundColor ?? defaults.backgroundColor,
        style.backgroundOpacity ?? defaults.backgroundOpacity
      );
    }
  }

  return variables;
}

function applyPresentationVariables(element, presentation) {
  const target = element?.style ? element : element?.[0] ?? null;
  if (!target?.style?.setProperty) return;

  for (const [name, value] of Object.entries(presentationVariables(presentation))) {
    target.style.setProperty(name, value);
  }
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
    closeOutcome = "decline",
    presentation = null
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
    const presentationValidation = validatePresentation(presentation);
    if (!presentationValidation.valid) return presentationValidation;

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
    closeOutcome = "decline",
    presentation = null
  } = {}) {
    const validation = this.validateRequest({
      title, prompt, banner, choices, role, resource, selectionCapacity, closeOutcome, presentation
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
      closeOutcome,
      presentation: normalizePresentation(presentation)
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

    const presentation = normalizePresentation(payload.presentation);

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
    let resolveResult = null;
    const resultPromise = new Promise(resolve => { resolveResult = resolve; });

    const finish = (outcome, selectedIds = []) => {
      if (settled) return;
      settled = true;
      resolveResult?.({ outcome, selectedIds, controllerUserId: game?.user?.id ?? null });
      resolveResult = null;
    };

    // Use real DialogV2 actions: Foundry requires a non-empty buttons array.
    // Guard keyboard/programmatic submission as well as the visible button.
    class BrokerDialog extends DialogV2 {
      async _onSubmit(target, event) {
        if (settled || (target?.dataset?.action === "confirm" && !selected.size)) return this;
        return super._onSubmit(target, event);
      }
    }

    const dialog = new BrokerDialog({
      window: { title: payload.title },
      position: { width: 550 },
      classes: [MODULE_ID + "-owned-dialog", "ae5e-broker-choice-dialog"],
      content: '<div class="ae5e-broker-choice-host"></div>',
      buttons: [{
        action: "confirm",
        label: payload.confirmLabel,
        disabled: true,
        callback: () => ({ outcome: "confirm", selectedIds: [...selected] })
      }, {
        action: "decline",
        label: payload.declineLabel,
        callback: () => ({ outcome: "decline", selectedIds: [] })
      }],
      submit: response => finish(response.outcome, response.selectedIds),
      modal: false
    });

    dialog.addEventListener?.("close", () => {
      finish(payload.closeOutcome === "abort" ? "abort" : "decline");
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

    const statusHtml = (lines, kind) => {
      if (!lines.length) return "";
      return '<div class="ae5e-broker-status is-' + kind + '" role="status">'
        + lines.map(line => "<div>" + this.#escape(line) + "</div>").join("")
        + "</div>";
    };

    const optionHtml = choice => {
      const checked = selected.has(choice.id);
      const temporarilyBlocked = !choice.disabled && !checked && !canAdd(choice);
      const disabled = choice.disabled || temporarilyBlocked;
      const advisories = [...choice.advisories];
      const reasons = [...choice.reasons];
      if (temporarilyBlocked) {
        const current = totals();
        if (payload.selectionCapacity != null
          && current.selectionUsed + choice.selectionCost > Number(payload.selectionCapacity)
          && payload.selectionCapacityReason) reasons.push(String(payload.selectionCapacityReason));
        if (payload.resource && choice.cost > current.remaining && payload.resourceInsufficientReason) {
          reasons.push(String(payload.resourceInsufficientReason));
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
        + statusHtml(advisories, "advisory")
        + statusHtml(reasons, "reason")
        + "</label>";
    };

    const render = () => {
      const element = dialog.element;
      const root = element?.querySelector?.(".ae5e-broker-choice-host")
        ?? element?.[0]?.querySelector?.(".ae5e-broker-choice-host")
        ?? null;
      if (!root) return false;

      applyPresentationVariables(element, presentation);

      root.innerHTML = '<div class="ae5e-broker-choice">'
        + (payload.banner ? '<div class="ae5e-broker-banner"><img src="' + this.#escapeAttr(payload.banner) + '" alt=""></div>' : "")
        + (payload.prompt ? '<div class="ae5e-broker-prompt">' + this.#escape(payload.prompt) + "</div>" : "")
        + (payload.resource ? '<div class="ae5e-broker-resource">' + this.#escape(summary()) + "</div>" : "")
        + '<div class="ae5e-broker-options">' + choices.map(optionHtml).join("") + "</div>"
        + "</div>";

      const confirm = element?.querySelector?.('button[data-action="confirm"]')
        ?? element?.[0]?.querySelector?.('button[data-action="confirm"]');
      if (confirm) {
        confirm.disabled = selected.size === 0;
        confirm.closest("footer")?.classList.add("ae5e-broker-actions");
      }

      for (const row of root.querySelectorAll(".ae5e-broker-option")) {
        const checkbox = row.querySelector('input[type="checkbox"]');
        if (!checkbox || checkbox.disabled) continue;
        // The surrounding label already toggles its checkbox, including row clicks.
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) selected.add(checkbox.value);
          else selected.delete(checkbox.value);
          render();
        });
      }

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
