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
 * Generic controller-routed, socket-safe choice prompt service.
 *
 * Item/activity macros provide only stable document references plus plain
 * serializable choice data. AE5E resolves the active responder, opens the
 * DialogV2 on that user's client, owns the semantic selection indicator for
 * the entire wait, and returns only the selected choice id (or null).
 */
export class ChoicePromptService {
  #socket;
  #selectionIndicator;
  #authority;
  #stats = {
    requests: 0,
    localPrompts: 0,
    remotePrompts: 0,
    playerControllers: 0,
    gmFallbacks: 0,
    disconnectReroutes: 0,
    selections: 0,
    cancellations: 0,
    failures: 0,
    lastEvent: null
  };

  constructor({ socket, selectionIndicator, authority }) {
    this.#socket = socket;
    this.#selectionIndicator = selectionIndicator;
    this.#authority = authority;
    socket.register("prompts.choose", this.#chooseSocket.bind(this));
  }

  validateRequest({ title, prompt, choices, role = SELECTION_INDICATOR_ROLES.RESPONDER } = {}) {
    if (typeof title !== "string" || !title.trim()) return { valid: false, reason: "invalid-title" };
    if (typeof prompt !== "string" || !prompt.trim()) return { valid: false, reason: "invalid-prompt" };
    if (!Object.values(SELECTION_INDICATOR_ROLES).includes(role)) return { valid: false, reason: "invalid-indicator-role" };
    if (!Array.isArray(choices) || choices.length < 1) return { valid: false, reason: "missing-choices" };

    const seen = new Set();
    for (const choice of choices) {
      if (!choice || typeof choice !== "object") return { valid: false, reason: "invalid-choice" };
      const id = String(choice.id ?? "").trim();
      const label = String(choice.label ?? "").trim();
      if (!id) return { valid: false, reason: "invalid-choice-id" };
      if (!label) return { valid: false, reason: "invalid-choice-label" };
      if (seen.has(id)) return { valid: false, reason: "duplicate-choice-id" };
      seen.add(id);
    }
    return { valid: true };
  }

  async resolveController({
    actor = null,
    actorUuid = null,
    token = null,
    tokenUuid = null,
    controllerUserId = null,
    excludeUserIds = []
  } = {}) {
    const excluded = new Set(asArray(excludeUserIds).map(String));
    const resolved = await this.#resolveSubject({ actor, actorUuid, token, tokenUuid });

    if (controllerUserId) {
      const explicit = this.#userById(controllerUserId);
      if (explicit?.active && !excluded.has(explicit.id)) {
        return this.#controllerEnvelope(explicit, {
          reason: "explicit-controller",
          actorUuid: resolved.actor?.uuid ?? actorUuid ?? null,
          tokenUuid: resolved.tokenDocument?.uuid ?? tokenUuid ?? null
        });
      }
    }

    const subject = resolved.actor ?? resolved.tokenDocument ?? null;
    const ownerLevel = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
    const activePlayers = asArray(game?.users).filter(user => {
      if (!user?.active || user?.isGM || excluded.has(user.id)) return false;
      try { return subject?.testUserPermission?.(user, ownerLevel) ?? false; } catch { return false; }
    });

    // Prefer the local active owner when the initiating client also controls
    // the responder. Otherwise preserve Foundry's user collection ordering.
    const activeOwner = activePlayers.find(user => user.id === game?.user?.id) ?? activePlayers[0] ?? null;
    if (activeOwner) {
      return this.#controllerEnvelope(activeOwner, {
        reason: "active-owner",
        actorUuid: resolved.actor?.uuid ?? actorUuid ?? null,
        tokenUuid: resolved.tokenDocument?.uuid ?? tokenUuid ?? null
      });
    }

    const gm = this.#activeGm(excluded);
    if (gm) {
      return this.#controllerEnvelope(gm, {
        reason: "gm-fallback",
        actorUuid: resolved.actor?.uuid ?? actorUuid ?? null,
        tokenUuid: resolved.tokenDocument?.uuid ?? tokenUuid ?? null
      });
    }

    return {
      userId: null,
      userName: null,
      isGM: false,
      reason: "no-active-controller",
      actorUuid: resolved.actor?.uuid ?? actorUuid ?? null,
      tokenUuid: resolved.tokenDocument?.uuid ?? tokenUuid ?? null
    };
  }

  async choose({
    actor = null,
    actorUuid = null,
    token = null,
    tokenUuid = null,
    controllerUserId = null,
    title,
    prompt,
    choices,
    role = SELECTION_INDICATOR_ROLES.RESPONDER,
    reason = "choice-prompt",
    playSound = true,
    allowCancel = false,
    cancelLabel = "Cancel",
    defaultChoiceId = null
  } = {}) {
    const validation = this.validateRequest({ title, prompt, choices, role });
    if (!validation.valid) throw new Error(`AE5E choice prompt request is invalid: ${validation.reason}.`);

    const normalizedChoices = choices.map(choice => ({
      id: String(choice.id).trim(),
      label: String(choice.label).trim(),
      detail: choice.detail == null ? null : String(choice.detail),
      disabled: choice.disabled === true
    }));
    const enabledChoices = normalizedChoices.filter(choice => !choice.disabled);
    if (!enabledChoices.length) throw new Error("AE5E choice prompt requires at least one enabled choice.");

    const controller = await this.resolveController({ actor, actorUuid, token, tokenUuid, controllerUserId });
    if (!controller.userId) throw new Error("AE5E choice prompt could not find an active player controller or active GM.");

    const validDefault = defaultChoiceId != null
      && enabledChoices.some(choice => choice.id === String(defaultChoiceId))
      ? String(defaultChoiceId)
      : null;

    const payload = {
      title: String(title),
      prompt: String(prompt),
      choices: normalizedChoices,
      tokenUuid: controller.tokenUuid ?? token?.document?.uuid ?? token?.uuid ?? tokenUuid ?? null,
      actorUuid: controller.actorUuid ?? actor?.uuid ?? actorUuid ?? null,
      role,
      reason: String(reason || "choice-prompt"),
      playSound: playSound !== false,
      allowCancel: allowCancel === true,
      cancelLabel: String(cancelLabel || "Cancel"),
      defaultChoiceId: validDefault
    };

    this.#stats.requests += 1;
    if (controller.isGM) this.#stats.gmFallbacks += 1;
    else this.#stats.playerControllers += 1;
    if (controller.userId === game?.user?.id) this.#stats.localPrompts += 1;
    else this.#stats.remotePrompts += 1;
    this.#record("request", { controller, title: payload.title, choices: normalizedChoices.map(choice => choice.id) });

    try {
      const response = await this.#executeOnController(controller, payload);
      const valid = new Set(enabledChoices.map(choice => choice.id));
      const choiceId = response?.choiceId == null ? null : String(response.choiceId);
      if (choiceId !== null && valid.has(choiceId)) {
        this.#stats.selections += 1;
        this.#record("selected", { controllerUserId: response?.controllerUserId ?? controller.userId, choiceId });
        return choiceId;
      }
      this.#stats.cancellations += 1;
      this.#record("cancelled", { controllerUserId: response?.controllerUserId ?? controller.userId });
      return null;
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
      return this.#socket.executeAsUser("prompts.choose", userId, payload);
    }

    let disconnectHook = null;
    let resolveDisconnect;
    const disconnected = new Promise(resolve => { resolveDisconnect = resolve; });
    if (globalThis.Hooks?.on) {
      disconnectHook = Hooks.on("userConnected", (user, connected) => {
        if (user?.id !== userId || connected) return;
        resolveDisconnect?.({ interrupted: true, reason: "controller-disconnected" });
      });
    }

    const remotePrompt = this.#socket.executeAsUser("prompts.choose", userId, payload)
      .then(value => ({ completed: true, value }))
      .catch(error => ({ failed: true, error }));

    try {
      const result = await Promise.race([remotePrompt, disconnected]);
      if (result?.completed) return result.value;

      // Give Foundry a short turn to publish the user's updated active state.
      // This distinguishes a genuine handler failure on a still-connected user
      // from a transport failure caused by that client disappearing.
      await new Promise(resolve => setTimeout(resolve, 50));
      const targetStillActive = this.#userById(userId)?.active === true;
      if (result?.failed && targetStillActive) throw result.error;

      // The intended player became unavailable while their DialogV2 was open
      // (or Socketlib reported that unavailable state). Reroute the same plain
      // request to another active GM rather than hanging the source workflow.
      const gm = this.#activeGm(new Set([userId]));
      if (!gm) {
        if (result?.failed) throw result.error;
        throw new Error("AE5E choice prompt controller disconnected and no active GM is available for fallback.");
      }
      this.#stats.disconnectReroutes += 1;
      this.#stats.gmFallbacks += 1;
      this.#record("disconnect-reroute", { fromUserId: userId, toUserId: gm.id });
      const rerouted = await this.#socket.executeAsUser("prompts.choose", gm.id, {
        ...payload,
        reroutedFromUserId: userId
      });
      return { ...rerouted, controllerUserId: gm.id, rerouted: true };
    } finally {
      if (disconnectHook !== null) Hooks.off("userConnected", disconnectHook);
    }
  }

  async #chooseSocket(payload) {
    const validation = this.validateRequest(payload);
    if (!validation.valid) throw new Error(`AE5E remote choice payload is invalid: ${validation.reason}.`);

    const choices = payload.choices.map(choice => ({
      id: String(choice.id),
      label: String(choice.label),
      detail: choice.detail == null ? null : String(choice.detail),
      disabled: choice.disabled === true
    }));
    const enabled = choices.filter(choice => !choice.disabled);
    if (!enabled.length) return { choiceId: null, controllerUserId: game?.user?.id ?? null };

    const buttons = enabled.map((choice, index) => ({
      action: `choice-${index + 1}`,
      label: choice.detail ? `${choice.label} — ${choice.detail}` : choice.label,
      default: payload.defaultChoiceId ? choice.id === payload.defaultChoiceId : index === 0,
      callback: () => choice.id
    }));
    if (payload.allowCancel === true) {
      buttons.push({
        action: "cancel",
        label: payload.cancelLabel || "Cancel",
        callback: () => null
      });
    }

    const dialogConfig = {
      window: { title: payload.title },
      classes: [`${MODULE_ID}-choice-prompt`],
      content: `<div class="ae5e-choice-prompt"><p>${this.#escape(payload.prompt)}</p></div>`,
      buttons,
      modal: false,
      rejectClose: false
    };

    let result;
    if (this.#selectionIndicator?.waitForDialog) {
      result = await this.#selectionIndicator.waitForDialog({
        tokenUuid: payload.tokenUuid ?? null,
        reason: payload.reason ?? "choice-prompt",
        role: payload.role ?? SELECTION_INDICATOR_ROLES.RESPONDER,
        playSound: payload.playSound !== false,
        notifyUserId: game?.user?.id ?? null,
        config: dialogConfig
      });
    } else {
      const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
      if (!DialogV2?.wait) throw new Error("Foundry DialogV2.wait() is unavailable; AE5E choice prompt cannot open.");
      result = await DialogV2.wait(dialogConfig);
    }

    const choiceId = result == null ? null : String(result);
    return { choiceId, controllerUserId: game?.user?.id ?? null };
  }

  async #resolveSubject({ actor, actorUuid, token, tokenUuid }) {
    let tokenDocument = token?.document ?? token ?? null;
    let resolvedActor = actor ?? tokenDocument?.actor ?? null;

    if (!tokenDocument && tokenUuid && typeof globalThis.fromUuid === "function") {
      try { tokenDocument = await fromUuid(tokenUuid); } catch (error) { Logger.debug("AE5E choice prompt could not resolve token UUID.", error); }
    }
    if (!resolvedActor) resolvedActor = tokenDocument?.actor ?? null;

    if (!resolvedActor && actorUuid && typeof globalThis.fromUuid === "function") {
      try { resolvedActor = await fromUuid(actorUuid); } catch (error) { Logger.debug("AE5E choice prompt could not resolve actor UUID.", error); }
    }

    return { actor: resolvedActor, tokenDocument };
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

  #userById(userId) {
    if (!userId) return null;
    return game?.users?.get?.(userId) ?? asArray(game?.users).find(user => user?.id === userId) ?? null;
  }

  #controllerEnvelope(user, { reason, actorUuid, tokenUuid }) {
    return {
      userId: user.id,
      userName: user.name ?? null,
      isGM: Boolean(user.isGM),
      reason,
      actorUuid: actorUuid ?? null,
      tokenUuid: tokenUuid ?? null
    };
  }

  #escape(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  #record(type, details) {
    this.#stats.lastEvent = { type, at: Date.now(), details };
  }
}
