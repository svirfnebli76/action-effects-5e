import { MODULE_ID } from "../core/constants.js";

const FLAG = "chatCard";
export const CARD_SECTIONS_FLAG = "initialCardSections";
export const CARD_SECTION_CLASSES = Object.freeze({
  flavor: "ae5e-hide-initial-flavor",
  targeting: "ae5e-hide-initial-targeting",
  saves: "ae5e-hide-initial-saves",
  damageApplication: "ae5e-hide-initial-damage-application"
});

/** An explicit per-message presentation snapshot; unconfigured cards stay native. */
export function cardSectionPolicy(value) {
  const required = ["targeting", "saves", "damageApplication"];
  if (value?.schema !== 1 || required.some(key => typeof value[key] !== "boolean")
    || (value.flavor !== undefined && typeof value.flavor !== "boolean")) return null;
  return { schema: 1,
    ...(value.flavor === undefined ? {} : { flavor: value.flavor }),
    targeting: value.targeting, saves: value.saves,
    damageApplication: value.damageApplication };
}

export function applyCardSections(content, value) {
  const policy = cardSectionPolicy(value);
  for (const [key, cssClass] of Object.entries(CARD_SECTION_CLASSES)) {
    content.classList.toggle(cssClass, policy?.[key] === true);
  }
}
const INTERIM_TIMEOUT = 8000;
// Match Midi's chat-save policy. Unknown settings fail open.
function automaticSaves() {
  const settings = globalThis.MidiQOL?.configSettings?.();
  const modes = [settings?.rollNPCLinkedSaves, settings?.rollNPCSaves, settings?.playerRollSaves];
  return Boolean(settings?.autoCheckSaves && settings.autoCheckSaves !== "none"
    && modes.every(mode => typeof mode === "string" && !["none", "chat"].includes(mode)));
}
const SLOTS = new Set(["header", "description", "flavor", "use", "attack", "hits", "saves", "damage", "utility", "outcome", "controls", "modifications"]);
const SELECTORS = {
  header: ".card-header", description: ".card-description", flavor: ".card-flavor",
  attack: ".midi-qol-attack-roll", hits: ".midi-qol-hits-display",
  saves: ".midi-qol-saves-display",
  damage: ".midi-qol-damage-roll, .midi-qol-other-damage-roll, .midi-qol-bonus-damage-roll",
  utility: ".midi-qol-utility-roll"
};
const hidden = element => {
  for (let node = element; node; node = node.parentElement) {
    if (node.hidden || node.style?.display === "none") return true;
  }
  return false;
};
const escape = value => String(value ?? "").replace(/[&<>"']/g, character =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const TAGS = new Set(["DIV", "SECTION", "P", "SPAN", "STRONG", "B", "EM", "I", "SMALL", "BR", "UL", "OL", "LI", "H3", "H4"]);
const CSS = new Set(["display", "flex-direction", "align-items", "justify-content", "gap", "margin", "margin-top", "margin-bottom", "padding", "padding-top", "padding-bottom", "font-size", "font-weight", "line-height", "text-align", "color", "background-color", "border", "border-radius", "width", "max-width"]);

/** Restricted presentation HTML only: no scripts, event handlers, URLs or global CSS. */
export function presentationHTML(html, data = {}, { layout = false } = {}) {
  if (typeof html !== "string" || html.length > 20000) throw new Error("Card HTML must be a string of at most 20,000 characters.");
  const substituted = html.replace(/\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g, (_, key) => {
    const value = data[key];
    if (!["string", "number", "boolean", "undefined"].includes(typeof value)) throw new Error(`Invalid card value: ${key}`);
    return escape(value);
  });
  const template = document.createElement("template");
  template.innerHTML = substituted;
  const slots = new Set();
  for (const node of template.content.querySelectorAll("*")) {
    if (!TAGS.has(node.tagName)) throw new Error(`Unsupported card element: ${node.tagName}`);
    for (const attribute of Array.from(node.attributes)) {
      if (!["class", "style", "data-ae5e-slot"].includes(attribute.name)) throw new Error(`Unsupported card attribute: ${attribute.name}`);
      if (attribute.name === "class" && !attribute.value.split(/\s+/).every(name => !name || /^ae5e-[a-z0-9_-]+$/i.test(name))) {
        throw new Error("Authored classes must start with ae5e-.");
      }
      if (attribute.name === "style") {
        for (const declaration of attribute.value.split(";")) {
          if (!declaration.trim()) continue;
          const colon = declaration.indexOf(":");
          const property = declaration.slice(0, colon).trim().toLowerCase();
          const value = declaration.slice(colon + 1).trim();
          const sizeVariable = ["--ae5e-icon-size", "--ae5e-title-size", "--ae5e-target-name-size", "--ae5e-save-total-size", "--ae5e-save-dc-size"].includes(property) && /^\d{1,3}px$/.test(value);
          if (colon < 0 || (!CSS.has(property) && !sizeVariable) || /[\\<>@]|url\s*\(|expression\s*\(|var\s*\(|!important/i.test(value)) {
            throw new Error(`Unsupported card style: ${property}`);
          }
        }
      }
      if (attribute.name === "data-ae5e-slot") {
        if (!layout || !SLOTS.has(attribute.value) || slots.has(attribute.value)
          || node.parentElement?.closest("[data-ae5e-slot]")) throw new Error("Invalid, duplicate or nested card slot.");
        slots.add(attribute.value);
      }
    }
  }
  if (layout && !slots.has("header")) throw new Error("A card layout requires a header slot.");
  return template.content;
}

export function itemPresentation(activity) {
  // Explicit disabled activity policy overrides the Item default too.
  const value = activity?.flags?.[MODULE_ID]?.[FLAG] ?? activity?.item?.flags?.[MODULE_ID]?.[FLAG];
  if (value?.schema !== 1 || value.enabled !== true || typeof value.layout !== "string") return null;
  return { schema: 1, enabled: true, layout: value.layout,
    titlePrefix: typeof value.titlePrefix === "string" ? value.titlePrefix.slice(0, 160) : "",
    saveStyle: value.saveStyle === "target" ? "target" : "native",
    hideCompletedControls: value.hideCompletedControls === true,
    hideUntilComplete: value.hideUntilComplete === true };
}

export class ChatCardAdapter {
  #registered = false;
  #writes = new Map();
  #interim = new Map();

  initialize() {
    if (this.#registered) return;
    this.#registered = true;
    Hooks.on("dnd5e.preCreateUsageMessage", (activity, config) => {
      try {
        const value = itemPresentation(activity);
        if (!value) return;
        presentationHTML(value.layout, {}, { layout: true });
        if (value.hideUntilComplete && activity.type === "save" && automaticSaves()) {
          value.interimStartedAt = Date.now();
        }
        config.data.flags ??= {};
        config.data.flags[MODULE_ID] ??= {};
        config.data.flags[MODULE_ID][FLAG] = value;
      } catch (error) { console.warn(`${MODULE_ID} | Invalid card layout; native card retained`, error); }
    });
    Hooks.on("dnd5e.renderChatMessage", (message, html) => {
      try { this.render(message, html); }
      catch (error) { console.error(`${MODULE_ID} | Chat card adapter retained native presentation`, error); }
    });
    Hooks.on("deleteChatMessage", message => this.#clearInterim(message.id));
  }

  #clearInterim(id) {
    const pending = this.#interim.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.html.classList.remove("ae5e-card-interim");
    this.#interim.delete(id);
  }

  #deferInterim(message, html, policy, snapshot) {
    this.#clearInterim(message.id);
    const started = policy.interimStartedAt;
    const remaining = INTERIM_TIMEOUT - (Date.now() - started);
    if (!policy.hideUntilComplete || policy.interimReleased || snapshot?.schema === 1
      || !Number.isFinite(started) || started > Date.now() || remaining <= 0
      || !automaticSaves()) return;
    // Automatic save/check buttons can remain enabled while Midi processes them.
    // Other usable roll, consumption and placement buttons still require access.
    const manual = [...html.querySelectorAll("button[data-action]")].some(button =>
      !button.disabled && !button.hasAttribute("disabled") && !hidden(button)
      && !["rollSave", "rollCheck"].includes(button.dataset.action)
      && /^(roll|consume|placeTemplate)/.test(button.dataset.action ?? ""));
    if (manual) return;
    html.classList.add("ae5e-card-interim");
    const timer = setTimeout(() => this.#clearInterim(message.id), remaining);
    this.#interim.set(message.id, { html, timer });
  }

  async snapshotLayout(workflow) {
    const message = this.message(workflow);
    if (!message?.isOwner || message.flags?.[MODULE_ID]?.[FLAG]?.layout) return;
    const value = itemPresentation(workflow.activity);
    if (!value) return;
    presentationHTML(value.layout, {}, { layout: true });
    await message.update(Object.fromEntries(Object.entries(value).map(([key, data]) =>
      [`flags.${MODULE_ID}.${FLAG}.${key}`, data])));
  }

  message(subject) {
    if (subject?.documentName === "ChatMessage") return subject;
    return subject?.chatCard ?? game.messages?.get(subject?.itemCardId);
  }

  async #write(subject, operation) {
    const message = this.message(subject);
    if (!message?.isOwner) return { updated: false, reason: "message-unavailable-or-not-owned" };
    const previous = this.#writes.get(message.id) ?? Promise.resolve();
    const pending = previous.catch(() => {}).then(() => operation(message));
    this.#writes.set(message.id, pending);
    try { return await pending; }
    finally { if (this.#writes.get(message.id) === pending) this.#writes.delete(message.id); }
  }

  async upsertContribution(subject, contribution) {
    const { id, source, data = {}, slot = "modifications", placement = "after-description" } = contribution ?? {};
    if (!validId(id)) throw new Error("Contribution ID must be 1–160 letters, digits, underscores or hyphens and cannot be a reserved object key.");
    if (!SLOTS.has(slot)) throw new Error("Unknown contribution slot.");
    if (!["after-description", "before-results", "after-results"].includes(placement)) throw new Error("Unknown native insertion location.");
    const template = contribution.html ?? source?.flags?.[MODULE_ID]?.[FLAG]?.contribution?.html;
    const fragment = presentationHTML(template, data);
    const wrapper = document.createElement("div");
    wrapper.append(fragment);
    // Save the rendered, validated contribution rather than rereading an Item
    // on every render. Source changes/deletion cannot rewrite historical cards.
    const value = { id, sourceUuid: source?.uuid ?? null, slot, placement, html: wrapper.innerHTML };
    return this.#write(subject, async message => {
      await message.update({ [`flags.${MODULE_ID}.${FLAG}.contributions.${id}`]: value });
      return { updated: true, messageId: message.id, id };
    });
  }

  async removeContribution(subject, id) {
    if (!validId(id)) throw new Error("Invalid contribution ID.");
    return this.#write(subject, async message => {
      await message.update({
        [`flags.${MODULE_ID}.${FLAG}.contributions.${id}`]: new foundry.data.operators.ForcedDeletion()
      });
      return { updated: true, messageId: message.id, id };
    });
  }

  async setSections(subject, options) {
    const policy = cardSectionPolicy(options);
    if (!policy) throw new Error("Card sections require schema: 1, three boolean section switches, and optional flavor boolean.");
    return this.#write(subject, async message => {
      const previous = cardSectionPolicy(message.flags?.[MODULE_ID]?.[CARD_SECTIONS_FLAG]);
      if (previous && ["targeting", "saves", "damageApplication"].every(key => previous[key] === policy[key])
        && Boolean(previous.flavor) === Boolean(policy.flavor)) {
        return { updated: false, reason: "unchanged", messageId: message.id };
      }
      await message.update({ [`flags.${MODULE_ID}.${CARD_SECTIONS_FLAG}`]: policy });
      return { updated: true, messageId: message.id };
    });
  }

  render(message, html) {
    const policy = message.flags?.[MODULE_ID]?.[FLAG];
    this.#clearInterim(message.id);
    const content = html.querySelector(".message-content");
    if (!content) return;
    // Apply before the custom-layout guard. Ordinary native usage cards can
    // suppress individual sections without opting into a replacement layout.
    applyCardSections(content, message.flags?.[MODULE_ID]?.[CARD_SECTIONS_FLAG]);
    if (!policy || !message.isContentVisible || message.blind || hidden(html)) return;
    const card = content?.querySelector(".chat-card");
    const header = card?.querySelector(".card-header");
    if (!header || header.hasAttribute("data-concealed")) return;
    // Validate everything before moving any native nodes. Invalid layouts retain
    // native content, including controls and masked roll presentation.
    let fragment = null;
    if (policy.schema === 1 && policy.enabled === true && policy.layout) {
      fragment = presentationHTML(policy.layout, {}, { layout: true });
    }
    const contributions = Object.values(policy.contributions ?? {}).map(value => ({
      ...value, fragment: presentationHTML(value.html)
    }));
    const snapshot = message.flags?.[MODULE_ID]?.activityCard;
    this.#deferInterim(message, html, policy, snapshot);
    if (html.querySelector(".ae5e-card-frame, .ae5e-card-contribution")) return;
    let frame = null;
    if (fragment) {
      frame = document.createElement("div");
      frame.className = "ae5e-card-frame";
      frame.append(fragment);
      // Remember visibility inherited from native parents before relocation.
      const parts = Object.fromEntries(Object.entries(SELECTORS).map(([key, selector]) =>
        [key, Array.from(content.querySelectorAll(selector))]));
      for (const [key, nodes] of Object.entries(parts)) {
        const slot = frame.querySelector(`[data-ae5e-slot="${key}"]`);
        if (!slot) continue; // Omitted native components remain in their original location.
        for (const node of nodes) { if (hidden(node)) node.hidden = true; slot.append(node); }
      }
      card.append(frame);
      const controls = frame.querySelector('[data-ae5e-slot="controls"]');
      if (controls) {
        for (const node of cardControls(content)) {
          if (hidden(node)) node.hidden = true;
          controls.append(node);
        }
      }
      if (snapshot?.schema === 1) this.#completed(content, frame, header, snapshot, policy);
    }
    for (const value of contributions) {
      const element = document.createElement("section");
      element.className = "ae5e-card-contribution";
      element.dataset.ae5eContribution = value.id;
      element.append(value.fragment);
      const slot = frame?.querySelector(`[data-ae5e-slot="${value.slot}"]`);
      if (slot) slot.append(element);
      else {
        // No Item configuration is required on an ordinary parent spell card.
        const anchor = value.placement === "after-description"
          ? card.querySelector(".card-description, .card-flavor") ?? header
          : content.querySelector(".midi-results") ?? card;
        if (value.placement === "before-results") anchor.before(element);
        else {
          // Keep multiple contributors in insertion order rather than reversing them.
          let tail = anchor;
          while (tail.nextElementSibling?.classList.contains("ae5e-card-contribution")) tail = tail.nextElementSibling;
          tail.after(element);
        }
      }
    }
  }

  #completed(content, frame, header, snapshot, policy) {
    header.removeAttribute("data-action");
    header.classList.add("no-description");
    header.querySelector(".chevron")?.remove();
    const title = header.querySelector(".name-stacked .title");
    if (title) title.textContent = snapshot.title;
    if (title && policy.titlePrefix) {
      const prefix = document.createElement("span");
      prefix.className = "ae5e-title-prefix";
      prefix.textContent = policy.titlePrefix;
      title.before(prefix);
    }
    header.querySelector(".subtitle")?.remove();
    if (header.querySelector(".activity-icon")) header.querySelector(".item-icon")?.remove();
    const description = frame.querySelector(".card-description");
    if (description) {
      description.classList.remove("collapsible");
      description.querySelector(".collapsible-content")?.classList.remove("collapsible-content");
    }
    const saves = content.querySelector(".midi-qol-saves-display");
    const rows = Array.from(saves?.querySelectorAll(".midi-qol-save-class") ?? []);
    const visibleRows = rows.filter(row => !hidden(row) && !hidden(saves));
    const rowUuid = row => row.querySelector(".midi-qol-save-name")?.dataset.uuid;
    const complete = snapshot.kind === "save" && snapshot.targets.length > 0
      && snapshot.targets.every(target => rows.some(row => rowUuid(row) === target.uuid));
    const names = visibleRows.map(row => row.querySelector(".midi-qol-save-name .title")?.textContent?.trim()).filter(Boolean);
    const sender = content.closest(".message")?.querySelector(".message-sender");
    const source = (sender?.querySelector(".name-stacked .title") ?? sender)?.textContent?.trim()
      || (game.user?.isGM ? snapshot.sourceName : "Source");
    const use = frame.querySelector('[data-ae5e-slot="use"]');
    if (use) { const p = document.createElement("p"); p.textContent = `${source} used ${snapshot.activityName}${complete && names.length ? ` against ${names.join(", ")}` : ""}.`; use.append(p); }
    const outcome = frame.querySelector('[data-ae5e-slot="outcome"]');
    if (snapshot.kind === "movement" && outcome) {
      const p = document.createElement("p"); p.textContent = snapshot.result; outcome.append(p);
    }
    if (complete && !hidden(saves)) {
      for (const row of visibleRows) {
        const symbol = row.querySelector(".midi-qol-save-symbol");
        const result = symbol?.classList.contains("fa-check") ? "passed"
          : symbol?.classList.contains("fa-xmark") ? "failed" : null;
        if (!result) continue; // Never reconstruct a result that Midi masked.
        if (policy.saveStyle === "target") {
          row.classList.add("ae5e-save-row", `ae5e-save-${result}`);
          const label = document.createElement("span");
          label.className = "ae5e-save-label"; label.textContent = result === "passed" ? "Passed" : "Failed";
          symbol.after(label);
          const total = row.querySelector(".midi-qol-save-total");
          if (total && !hidden(total)) {
            const rollLabel = document.createElement("span");
            rollLabel.className = "ae5e-save-label"; rollLabel.textContent = "Roll ";
            total.before(rollLabel);
          }
          const nativeDC = saves.querySelector(".midi-qol-saveDC");
          if (nativeDC && !hidden(nativeDC)) {
            const dc = document.createElement("span"); dc.className = "ae5e-save-dc";
            const text = nativeDC.textContent.trim();
            dc.textContent = /^DC\b/i.test(text) ? text : `DC ${text}`;
            row.append(dc);
          }
        }
        const detail = snapshot.targets.find(target => target.uuid === rowUuid(row));
        if (detail && outcome) {
          const p = document.createElement("p");
          const name = row.querySelector(".midi-qol-save-name .title")?.textContent?.trim();
          p.textContent = `${visibleRows.length > 1 && name ? `${name} — ` : ""}Result: ${detail.result}`;
          outcome.append(p);
        }
      }
      content.querySelectorAll(".card-summary").forEach(suppressPresentation);
    }
    // Only an explicit automation completion signal authorizes hiding manual
    // targeting/effect controls; default behavior preserves all interactions.
    if (policy.hideCompletedControls && snapshot.controlsResolved === true
      && (snapshot.kind === "movement" || complete)) {
      // Keep completion on the content host too. Other renderers can rebuild
      // rows outside our controls slot after this hook; scoped CSS still applies.
      content.classList.add("ae5e-controls-resolved");
      // Suppress the slot as well: native custom elements may build children
      // after this hook, and system/theme display rules can override [hidden].
      const controls = frame.querySelector('[data-ae5e-slot="controls"]');
      if (controls) suppressPresentation(controls);
      cardControls(content).forEach(suppressPresentation);
    }
  }
}

function suppressPresentation(node) {
  node.hidden = true;
  node.classList.add("ae5e-card-suppressed");
}

function cardControls(content) {
  return Array.from(content.querySelectorAll(".chat-card .icon-row, recorded-targets, effect-application, [data-action='midiApplyEffects']"));
}

function validId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(id)
    && !["__proto__", "constructor", "prototype"].includes(id);
}
