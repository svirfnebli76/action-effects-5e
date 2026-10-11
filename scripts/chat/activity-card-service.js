import { MODULE_ID } from "../core/constants.js";

const FLAG = "activityCard";
const values = value => Array.from(value?.values?.() ?? value ?? []);
const uuidOf = token => (token?.document ?? token)?.uuid;
const actorOf = token => token?.actor ?? token?.document?.actor;
const isHidden = element => {
  for (let node = element; node; node = node.parentElement) {
    if (node.hidden || node.style?.display === "none") return true;
  }
  return false;
};

function policy(workflow) {
  const data = workflow?.activity?.flags?.[MODULE_ID]?.[FLAG];
  return data?.schema === 1 && data.enabled === true && data.title
    && ["save", "movement"].includes(data.kind) ? data : null;
}

function matchingEffects(actor, itemUuid, data) {
  return values(actor?.effects).filter(effect => !effect.disabled && !effect.isSuppressed
    && effect.name === data.effectName
    && (effect.origin === itemUuid || effect.flags?.dae?.itemUuid === itemUuid));
}

function state(token, workflow, data) {
  const actor = actorOf(token);
  const overTimeUuid = data.saveMode === "repeat" ? workflow.workflowOptions?.overTimeEffectUuid : null;
  const effects = overTimeUuid ? values(actor?.effects).filter(effect =>
    effect.uuid === overTimeUuid && effect.name === data.effectName
    && !effect.disabled && !effect.isSuppressed) : matchingEffects(actor, workflow.item.uuid, data);
  return {
    status: data.status ? values(actor?.statuses).includes(data.status) : false,
    presentEffectUuids: values(actor?.effects).map(effect => effect.uuid),
    effects: effects.map(effect => ({
      uuid: effect.uuid,
      timing: JSON.stringify({ duration: effect.duration, start: effect._source?.start })
    }))
  };
}

export function saveOutcome(workflow, token) {
  const uuid = uuidOf(token);
  if (values(workflow.saves).some(value => uuidOf(value) === uuid)) return "passed";
  // failedSaves is initialized with every target before rolling. Require an actual
  // per-target display result so an unfinished/cancelled save is not called failed.
  const row = values(workflow.saveDisplayData).find(value =>
    uuidOf(value.target) === uuid || value.id === (token.document ?? token).id);
  if (row?.saveSymbol && values(workflow.failedSaves).some(value => uuidOf(value) === uuid)) return "failed";
  return "unresolved";
}

export function effectOutcome(before, current, data, outcome) {
  if (outcome === "passed") return "Resisted this attempt.";
  if (outcome !== "failed") return "Save result unavailable; effect not confirmed.";
  const confirmed = data.nativeStatus ? current.status
    : current.effects.length > 0 && (!data.status || current.status);
  if (!confirmed) return `${data.result} was not confirmed.`;
  const unchanged = data.nativeStatus ? before?.status === true
    : before?.effects?.some(previous => current.effects.some(effect =>
      effect.uuid === previous.uuid && effect.timing === previous.timing));
  return `${data.result}${unchanged ? " (already present)" : ""}${data.duration ? ` — ${data.duration}` : ""}.`;
}

/** Repeat saves observe the original effect, never a new application. */
export function repeatSaveOutcome(before, current, data, outcome) {
  const original = before?.effects?.map(effect => effect.uuid) ?? [];
  const confirmed = original.length > 0 && (outcome === "passed"
    ? original.every(uuid => !current.presentEffectUuids.includes(uuid))
    : outcome === "failed" && original.some(uuid => current.effects.some(effect => effect.uuid === uuid))
      && (!data.status || current.status));
  const result = outcome === "passed"
    ? confirmed ? data.passedResult ?? "Effect ended." : "Effect removal was not confirmed."
    : outcome === "failed"
      ? confirmed ? data.failedResult ?? "Effect remains active." : "Continued effect was not confirmed."
      : "Save result unavailable; effect outcome not confirmed.";
  return { confirmed, result };
}

export function movementOutcome(value, units = "", presentation = {}) {
  switch (value?.status) {
    case "completed": return `Movement completed. Allowance used: ${value.cost} / ${value.allowance} ${units}.${presentation.completedText ? ` ${presentation.completedText}` : ""}`;
    case "cancelled": return "Movement cancelled.";
    case "no-movement": return "No movement taken.";
    case "failed": return "Movement did not complete successfully; check the token position.";
    default: return "Movement result unavailable.";
  }
}

/** Opt-in presentation for completed usage cards; native documents and rolls stay intact. */
export class ActivityCardService {
  #before = new WeakMap();
  #pending = new WeakMap();
  #registered = false;

  initialize() {
    if (this.#registered) return;
    this.#registered = true;
    Hooks.on("midi-qol.preCheckSaves", async workflow => {
      try { await this.capture(workflow); }
      catch (error) { console.error(`${MODULE_ID} | Activity card capture failed`, error); }
    });
    Hooks.on("dnd5e.renderChatMessage", (message, html) => {
      try { this.render(message, html); }
      catch (error) { console.error(`${MODULE_ID} | Activity card rendering failed`, error); }
    });
  }

  async capture(workflow) {
    const data = policy(workflow);
    if (!data || data.kind !== "save") return;
    this.#before.set(workflow, new Map(values(workflow.targets).map(token =>
      [uuidOf(token), state(token, workflow, data)])));
    const message = workflow.chatCard ?? game.messages?.get(workflow.itemCardId);
    // A reroll must restore native presentation while the outcome is pending.
    if (message?.isOwner && message.flags?.[MODULE_ID]?.[FLAG]) {
      await message.unsetFlag(MODULE_ID, FLAG);
    }
  }

  async complete(workflow, options = {}) {
    const data = policy(workflow);
    if (data?.kind !== "save" || data.saveMode !== "repeat") return this.#complete(workflow, options);
    if (workflow.aborted) return { updated: false, reason: "not-configured-or-aborted" };
    const message = workflow.chatCard ?? game.messages?.get(workflow.itemCardId);
    if (!message?.isOwner) return { updated: false, reason: "message-unavailable-or-not-owned" };
    const before = this.#before.get(workflow);
    const pending = this.#pending.get(workflow);
    if (pending && pending.before === before) return pending.scheduled;
    // Midi deletes an ActivityOverTime effect AFTER completeActivityUse returns.
    // Returning a scheduled result lets that workflow finish instead of waiting
    // inside its Item macro for a deletion that cannot yet happen.
    const completion = new Promise(resolve => setTimeout(() => {
      void this.#complete(workflow, options, before).then(result => {
        if (this.#pending.get(workflow)?.scheduled === scheduled) this.#pending.delete(workflow);
        resolve(result);
      }, error => {
        if (this.#pending.get(workflow)?.scheduled === scheduled) this.#pending.delete(workflow);
        console.error(`${MODULE_ID} | Repeat-save presentation failed`, error);
        resolve({ updated: false, reason: "presentation-failed" });
      });
    }, 0));
    const scheduled = { updated: false, scheduled: true, messageId: message.id, completion };
    this.#pending.set(workflow, { before, scheduled });
    return scheduled;
  }

  async #complete(workflow, { controlsResolved = false } = {}, before = this.#before.get(workflow)) {
    const data = policy(workflow);
    if (!data || workflow.aborted) return { updated: false, reason: "not-configured-or-aborted" };
    const message = workflow.chatCard ?? game.messages?.get(workflow.itemCardId);
    if (!message?.isOwner) return { updated: false, reason: "message-unavailable-or-not-owned" };
    const targets = values(workflow.targets);
    if (data.saveMode === "repeat" && this.#before.get(workflow) !== before) {
      return { updated: false, reason: "superseded-by-new-save" };
    }
    const snapshot = {
      schema: 1, kind: data.kind, title: data.title,
      activityName: workflow.activity.name, icon: workflow.activity.img ?? workflow.item.img,
      sourceName: workflow.token?.name ?? workflow.actor?.name ?? message.speaker?.alias ?? "Source",
      workflowId: workflow.id ?? workflow.uuid ?? null,
      parentWorkflowId: workflow.workflowOptions?.triggeringWorkflowId ?? null,
      controlsResolved: controlsResolved === true,
      targets: []
    };
    if (data.kind === "save" && data.saveMode === "repeat") {
      snapshot.saveMode = "repeat";
      // Observe at most two seconds without blocking Midi's cleanup. No effect
      // is applied, disabled or deleted by this service.
      for (let attempt = 0; attempt < 80; attempt++) {
        const pending = targets.some(token => {
          const prior = before?.get(uuidOf(token));
          if (!prior?.effects.length || saveOutcome(workflow, token) !== "passed") return false;
          return !repeatSaveOutcome(prior, state(token, workflow, data), data, "passed").confirmed;
        });
        if (!pending || workflow.aborted || this.#before.get(workflow) !== before) break;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      if (workflow.aborted) return { updated: false, reason: "not-configured-or-aborted" };
      snapshot.targets = targets.map(token => {
        const current = state(token, workflow, data);
        const saveResult = saveOutcome(workflow, token);
        const outcome = repeatSaveOutcome(before?.get(uuidOf(token)), current, data, saveResult);
        return { uuid: uuidOf(token), saveResult, effectConfirmed: current.effects.length > 0,
          outcomeConfirmed: outcome.confirmed, result: outcome.result };
      });
      snapshot.controlsResolved &&= snapshot.targets.length > 0
        && snapshot.targets.every(target => target.outcomeConfirmed);
    } else if (data.kind === "movement") {
      snapshot.result = movementOutcome(workflow[data.outcomeKey], workflow.token?.document?.parent?.grid?.units ?? globalThis.canvas?.scene?.grid?.units ?? "", data);
      snapshot.controlsResolved &&= ["completed", "cancelled", "no-movement"].includes(workflow[data.outcomeKey]?.status);
    } else {
      // An effect automation may still be finishing native status creation. This
      // bounded wait observes state only; it never applies or deletes an effect.
      for (let attempt = 0; attempt < 20; attempt++) {
        const missing = targets.some(token => {
          if (saveOutcome(workflow, token) !== "failed") return false;
          const current = state(token, workflow, data);
          return data.nativeStatus ? !current.status
            : !current.effects.length || (data.status && !current.status);
        });
        if (!missing) break;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      snapshot.targets = targets.map(token => {
        const current = state(token, workflow, data);
        const saveResult = saveOutcome(workflow, token);
        const effectConfirmed = data.nativeStatus ? current.status
          : current.effects.length > 0 && (!data.status || current.status);
        return { uuid: uuidOf(token), saveResult, effectConfirmed,
          result: effectOutcome(before?.get(uuidOf(token)), current, data, saveResult) };
      });
      snapshot.controlsResolved &&= snapshot.targets.length > 0 && snapshot.targets.every(target =>
        target.saveResult === "passed" || (target.saveResult === "failed" && target.effectConfirmed));
    }
    if (snapshot.saveMode === "repeat" && this.#before.get(workflow) !== before) {
      return { updated: false, reason: "superseded-by-new-save" };
    }
    if (!message.isOwner || (message.collection && !message.collection.has(message.id))) {
      return { updated: false, reason: "message-unavailable-or-not-owned" };
    }
    await message.setFlag(MODULE_ID, FLAG, snapshot);
    if (snapshot.saveMode !== "repeat" || snapshot.targets.every(target => target.outcomeConfirmed)) {
      this.#before.delete(workflow);
    }
    return { updated: true, messageId: message.id };
  }

  render(message, html) {
    if (message.flags?.[MODULE_ID]?.chatCard?.layout) return;
    const snapshot = message.flags?.[MODULE_ID]?.[FLAG];
    if (snapshot?.schema !== 1 || !message.isContentVisible || message.blind
      || html.hidden || html.style.display === "none" || html.querySelector(".ae5e-activity-card-intro")) return;
    const card = html.querySelector(".message-content .chat-card");
    const header = card?.querySelector(".card-header");
    // Respect unidentified/concealed item presentation.
    if (!header || header.hasAttribute("data-concealed")) return;
    const saves = html.querySelector(".message-content .midi-qol-saves-display");
    const rows = saves ? Array.from(saves.querySelectorAll(".midi-qol-save-class")) : [];
    const rowUuid = row => row.querySelector(".midi-qol-save-name")?.dataset.uuid;
    const completeRows = snapshot.kind === "save" && snapshot.targets.length > 0
      && snapshot.targets.every(target => rows.some(row => rowUuid(row) === target.uuid));
    // Keep controls, recorded targets, and summaries when this client is using
    // dnd5e's summary mode or has no native Midi rows to replace them.
    card.querySelectorAll(".card-description, .card-flavor, .supplement, .icon-row:has(.pills)").forEach(element => element.remove());
    header.removeAttribute("data-action");
    header.classList.add("no-description");
    header.querySelector(".chevron")?.remove();
    const title = header.querySelector(".name-stacked .title");
    if (title) title.textContent = snapshot.title;
    header.querySelector(".subtitle")?.remove();
    // Use the already-enriched activity icon and its source document actions.
    if (header.querySelector(".activity-icon")) header.querySelector(".item-icon")?.remove();
    const intro = document.createElement("p");
    intro.className = "ae5e-activity-card-intro";
    const visibleTargets = completeRows && !isHidden(saves)
      ? rows.filter(row => !isHidden(row)).map(row =>
        row.querySelector(".midi-qol-save-name .title")?.textContent?.trim()).filter(Boolean) : [];
    const sender = html.querySelector(".message-sender");
    const sourceName = (sender?.querySelector(".name-stacked .title") ?? sender)?.textContent?.trim()
      || (game.user?.isGM ? snapshot.sourceName : "Source");
    intro.textContent = `${sourceName} used ${snapshot.activityName}${visibleTargets.length ? ` against ${visibleTargets.join(", ")}` : ""}.`;
    header.after(intro);
    if (snapshot.kind === "movement") {
      const result = document.createElement("p");
      result.textContent = snapshot.result;
      intro.after(result);
    } else if (completeRows && !isHidden(saves)) {
      // Move native nodes with their listeners and privacy masks, not cloned HTML
      // reconstructed from raw stored rolls. All totals/DCs remain native.
      intro.after(saves);
      for (const row of rows) {
        if (isHidden(row)) continue;
        const symbol = row.querySelector(".midi-qol-save-symbol");
        const outcome = symbol?.classList.contains("fa-check") ? "Passed"
          : symbol?.classList.contains("fa-xmark") ? "Failed" : null;
        if (!outcome) continue; // Midi removed the result for this viewer.
        row.querySelector(".midi-qol-save-name").style.display = "none";
        row.querySelector(".midi-qol-save-img")?.remove();
        const label = document.createElement("span");
        label.textContent = outcome;
        symbol.after(label);
        const detail = snapshot.targets.find(target => target.uuid === rowUuid(row));
        if (detail) {
          const result = document.createElement("li");
          result.className = "ae5e-activity-card-result";
          result.textContent = `Result: ${detail.result}`;
          row.after(result);
        }
      }
      // Only remove duplicate system summaries when every target has a native
      // Midi row. No associated messages, rolls, or effect controls are deleted.
      html.querySelectorAll(".card-summary").forEach(element => element.remove());
    }
  }
}
