/**
 * Reusable, opt-in presentation/validation adapter for Midi-QOL 14.6.3's
 * TargetConfirmationDialog. Never replaces Midi's target list, roll/cancel
 * callbacks, or resource-consumption/refund lifecycle.
 *
 * The Item supplies rules, text and casting-local Activity modifications.
 */

const CLASS = "ae5e-target-confirmation";
const MAX_PENDING_AGE_MS = 180_000;
const DEFAULTS = Object.freeze({
  windowWidth: 480,
  maxHeight: 800,
  portraitSize: 48,
  ringWidth: 3,
  rowMinHeight: 66,
  rowPadding: 8,
  rowGap: 6,
  sectionGap: 10,
  reminderGap: 4,
  title: Object.freeze({ fontSize: 15, fontWeight: 700 }),
  instructions: Object.freeze({ fontSize: 13, fontWeight: 400 }),
  targetName: Object.freeze({ fontSize: 14, fontWeight: 700 }),
  range: Object.freeze({ fontSize: 12, fontWeight: 500 }),
  counter: Object.freeze({ fontSize: 13, fontWeight: 600 }),
  reminder: Object.freeze({ fontSize: 12, fontWeight: 400 }),
  buttons: Object.freeze({ fontSize: 13, fontWeight: 700 }),
  colors: Object.freeze({
    hostile: "#f05b5b", friendly: "#18cc46", neutral: "#ff9f1c",
    secret: "#a668d8", unrevealed: "#888888",
    inRange: "#18cc46", longRange: "#ff9f1c", outOfRange: "#f05b5b"
  })
});

const safeObject = value => value && typeof value === "object" && !Array.isArray(value);
const validHex = value => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
const validSize = value => typeof value === "number" && Number.isFinite(value) && value >= 8 && value <= 48;
const validWeight = value => Number.isInteger(value) && value >= 100 && value <= 900 && value % 100 === 0;
const clampNumber = (value, fallback, low, high) =>
  typeof value === "number" && Number.isFinite(value) && value >= low && value <= high ? value : fallback;

/** Apply only known and bounded options. Unknown/malformed overrides are ignored. */
export function normalizeTargetConfirmationAppearance(input = {}) {
  const raw = safeObject(input) ? input : {};
  const output = {};
  for (const [name, min, max] of [
    ["windowWidth", 340, 1000], ["maxHeight", 350, 1200],
    ["portraitSize", 28, 80], ["ringWidth", 1, 7],
    ["rowMinHeight", 42, 150], ["rowPadding", 0, 32],
    ["rowGap", 0, 32], ["sectionGap", 0, 32], ["reminderGap", 0, 20]
  ]) {
    output[name] = clampNumber(raw[name], DEFAULTS[name], min, max);
  }
  for (const name of ["title", "instructions", "targetName", "range", "counter", "reminder", "buttons"]) {
    const style = safeObject(raw[name]) ? raw[name] : {};
    output[name] = {
      fontSize: validSize(style.fontSize) ? style.fontSize : DEFAULTS[name].fontSize,
      fontWeight: validWeight(style.fontWeight) ? style.fontWeight : DEFAULTS[name].fontWeight,
      textColor: validHex(style.textColor) ? style.textColor : null,
      align: ["left", "center", "right"].includes(style.align) ? style.align :
        (["counter", "reminder"].includes(name) ? "center" : "left")
    };
  }
  output.rowBackgroundColor = validHex(raw.rowBackgroundColor) ? raw.rowBackgroundColor : null;
  const colors = safeObject(raw.colors) ? raw.colors : {};
  output.colors = Object.fromEntries(Object.keys(DEFAULTS.colors).map(key => [
    key, validHex(colors[key]) ? colors[key] : DEFAULTS.colors[key]
  ]));
  return output;
}

/**
 * Display-only. A player does not receive a distinct indicator for SECRET;
 * the secret-specific color appears only for an authorized GM.
 */
export function visibleDisposition(disposition, { isGM = false, dispositions = null } = {}) {
  const values = dispositions ?? { HOSTILE: -1, NEUTRAL: 0, FRIENDLY: 1, SECRET: -2 };
  if (disposition === values.SECRET) return isGM ? "secret" : "unrevealed";
  if (disposition === values.HOSTILE) return "hostile";
  if (disposition === values.FRIENDLY) return "friendly";
  if (disposition === values.NEUTRAL) return "neutral";
  return "unrevealed";
}

function boundedString(value, fallback, length = 1000) {
  return typeof value === "string" && value.length <= length ? value : fallback;
}

function identity(document) { return document?.uuid ?? document?.id ?? null; }

function resolvedToken(actor) {
  const controlled = globalThis.canvas?.tokens?.controlled ?? [];
  const controlledToken = controlled.find(t => t.actor?.id === actor?.id);
  if (controlledToken) return controlledToken;
  return actor?.getActiveTokens?.(true, true)?.[0] ?? null;
}

function textWithEmphasis(container, input) {
  // Tiny, safe **bold** notation. Item text is never parsed as HTML.
  const fragments = String(input).split(/(\*\*[^*]+\*\*)/g);
  for (const fragment of fragments) {
    if (/^\*\*[^*]+\*\*$/.test(fragment)) {
      const strong = document.createElement("strong");
      strong.textContent = fragment.slice(2, -2);
      container.appendChild(strong);
    } else {
      container.appendChild(document.createTextNode(fragment));
    }
  }
}

function swapButtonLabel(button, label, owned) {
  if (!button || !label) return;
  const leaf = [...button.childNodes].find(n => n.nodeType === 3 && n.textContent.trim())
    ?? [...button.querySelectorAll("span")].flatMap(s => [...s.childNodes])
      .find(n => n.nodeType === 3 && n.textContent.trim());
  if (!leaf) return;
  owned.push({ node: leaf, previous: leaf.textContent });
  leaf.textContent = ` ${label}`;
}

function formatCount(template, selected, maximum) {
  return template.replace(/\{selected\}/g, String(selected))
    .replace(/\{maximum\}/g, String(maximum));
}

export class TargetConfirmationAdapter {
  #pending = new Map();
  #active = new Map();
  #hooks = [];
  #nextId = 0;
  #stats = { armed: 0, claimed: 0, blocked: 0, closed: 0, expired: 0 };

  initialize() {
    if (this.#hooks.length) return;
    this.#hooks.push(["renderApplicationV2", Hooks.on("renderApplicationV2", app => this.#render(app))]);
    this.#hooks.push(["closeApplicationV2", Hooks.on("closeApplicationV2", app => this.#close(app))]);
    // A pending request must not spill onto a subsequent casting of the same Item.
    this.#hooks.push(["midi-qol.preTargetingV2", Hooks.on("midi-qol.preTargetingV2", (...args) => {
      const workflow = args.flatMap(v => [v, v?.workflow]).find(v => v?.actor && v?.activity);
      if (!workflow) return;
      for (const [id, request] of this.#pending) {
        if (request.workflow && request.workflow !== workflow && request.actorId === workflow.actor?.id
          && request.itemId === workflow.activity?.item?.id) this.#pending.delete(id);
      }
      this.#prune();
    })]);
  }

  /**
   * Called by an Item macro only when it wants a customized late native dialog.
   * Does NOT force native target confirmation: the caller/broker must arrange
   * that independently. Also does not apply Twinned scaling or charge points.
   */
  arm({ workflow, actor = workflow?.actor, item = workflow?.activity?.item,
    title = "Target Confirmation", instructions = "Select your targets.",
    counter = "{selected} of {maximum} targets selected.", reminder = "",
    labels = {}, appearance = {}, validation = {} } = {}) {
    if (!globalThis.game?.user?.id) throw new Error("An active Foundry user is required.");
    if (!workflow?.activity || !actor?.id || !item?.id || !actor.isOwner)
      throw new Error("A current owned casting workflow, actor, and Item are required.");
    if (workflow.actor?.id !== actor.id || workflow.activity.item?.id !== item.id)
      throw new Error("Target Confirmation must be scoped to the initiating workflow Item.");
    this.#prune();
    for (const [id, request] of this.#pending) {
      if (request.actorId === actor.id && request.itemId === item.id && request.userId === game.user.id)
        this.#pending.delete(id);
    }
    const id = `ae5e-target-${++this.#nextId}`;
    const request = {
      id, workflow, actorId: actor.id, itemId: item.id, userId: game.user.id,
      created: Date.now(),
      title: boundedString(title, "Target Confirmation", 120),
      instructions: boundedString(instructions, "Select your targets."),
      counter: boundedString(counter, "{selected} of {maximum} targets selected.", 200),
      reminder: boundedString(reminder, "", 400),
      labels: {
        continue: boundedString(labels?.continue, "Continue Casting", 80),
        cancel: boundedString(labels?.cancel, "Cancel Casting", 80),
        clear: boundedString(labels?.clear, "Clear Targets", 80)
      },
      appearance: normalizeTargetConfirmationAppearance(appearance),
      validation: {
        minTargets: Number.isInteger(validation?.minTargets) && validation.minTargets >= 0 && validation.minTargets <= 100
          ? validation.minTargets : 1,
        enforceRange: validation?.enforceRange !== false,
        allowLongRange: validation?.allowLongRange !== false
      }
    };
    this.#pending.set(id, request);
    this.#stats.armed++;
    return id;
  }

  cancel(id) {
    if (this.#pending.delete(id)) return true;
    for (const [app, session] of this.#active) {
      if (session.request.id !== id) continue;
      this.#restore(app, session);
      this.#active.delete(app);
      return true;
    }
    return false;
  }

  getStatus() {
    return {
      pending: this.#pending.size,
      active: this.#active.size,
      stats: { ...this.#stats }
    };
  }

  #prune() {
    for (const [id, request] of this.#pending) {
      if (Date.now() - request.created <= MAX_PENDING_AGE_MS) continue;
      this.#pending.delete(id);
      this.#stats.expired++;
    }
  }

  #matches(app, request) {
    return app?.constructor?.name === "TargetConfirmationDialog"
      && app?.data?.actor?.id === request.actorId
      && app?.data?.activity?.item?.id === request.itemId
      && game.user?.id === request.userId
      && (!app.data.user?.id || app.data.user.id === request.userId);
  }

  #render(app) {
    if (app?.constructor?.name !== "TargetConfirmationDialog") return;
    let session = this.#active.get(app);
    if (!session) {
      this.#prune();
      const found = [...this.#pending].find(([, request]) => this.#matches(app, request));
      if (!found) return;
      const [id, request] = found;
      this.#pending.delete(id);
      session = { request, originals: null, guardedRoot: null, clickGuard: null, submitGuard: null };
      this.#active.set(app, session);
      this.#stats.claimed++;
    }
    try {
      this.#decorate(app, session);
    } catch (error) {
      console.warn("AE5E | Target Confirmation adapter failed; canceling through Midi.", error);
      this.#restore(app, session);
      this.#active.delete(app);
      globalThis.ui?.notifications?.error?.("AE5E: Target confirmation could not be prepared; casting canceled.");
      // Midi owns this callback and restores any already-consumed spell slot.
      void app.close?.();
    }
  }

  #setVariables(root, appearance) {
    const px = (name, value) => root.style.setProperty(`--ae5e-target-${name}`, `${value}px`);
    px("window-width", appearance.windowWidth);
    px("max-height", appearance.maxHeight);
    px("portrait-size", appearance.portraitSize);
    px("ring-width", appearance.ringWidth);
    px("row-min-height", appearance.rowMinHeight);
    px("row-padding", appearance.rowPadding);
    px("row-gap", appearance.rowGap);
    px("section-gap", appearance.sectionGap);
    px("reminder-gap", appearance.reminderGap);
    for (const slot of ["title", "instructions", "targetName", "range", "counter", "reminder", "buttons"]) {
      const cssName = slot.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
      px(`${cssName}-size`, appearance[slot].fontSize);
      root.style.setProperty(`--ae5e-target-${cssName}-weight`, String(appearance[slot].fontWeight));
      root.style.setProperty(`--ae5e-target-${cssName}-align`, appearance[slot].align);
      if (appearance[slot].textColor) root.style.setProperty(`--ae5e-target-${cssName}-color`, appearance[slot].textColor);
    }
    if (appearance.rowBackgroundColor) root.style.setProperty("--ae5e-target-row-background", appearance.rowBackgroundColor);
    for (const [key, value] of Object.entries(appearance.colors)) {
      if (value !== DEFAULTS.colors[key]) root.style.setProperty(`--ae5e-target-color-${key}`, value);
    }
  }

  #guard(app, session, root) {
    if (session.guardedRoot === root) return;
    if (session.guardedRoot) {
      session.guardedRoot.removeEventListener("click", session.clickGuard, true);
      session.guardedRoot.removeEventListener("keydown", session.clickGuard, true);
      session.guardedRoot.removeEventListener("submit", session.submitGuard, true);
    }
    session.clickGuard = event => {
      const node = event.target;
      if (!(node instanceof Element) || !node.closest('[data-action="roll"]')) return;
      if (event.type === "keydown" && ![" ", "Enter"].includes(event.key)) return;
      if (this.#validate(app, session).valid) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.#stats.blocked++;
      this.#updateStatus(app, session);
    };
    session.submitGuard = event => {
      if (this.#validate(app, session).valid) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.#stats.blocked++;
      this.#updateStatus(app, session);
    };
    root.addEventListener("click", session.clickGuard, true);
    root.addEventListener("keydown", session.clickGuard, true);
    root.addEventListener("submit", session.submitGuard, true);
    session.guardedRoot = root;
  }

  #decorate(app, session) {
    const root = app?.element;
    const form = root?.querySelector("form");
    const list = form?.querySelector(".midi-qol-target-confirmation-list");
    if (!form || !list) throw new Error("Midi Target Confirmation markup is incompatible with the AE5E adapter.");
    const request = session.request;
    if (session.originals?.form === form) {
      this.#updateStatus(app, session);
      return;
    }
    root.classList.add(CLASS);
    this.#setVariables(root, request.appearance);
    this.#guard(app, session, root);

    const titleNode = root.querySelector(".window-title");
    const originals = {
      form, list, root, titleNode, originalTitle: titleNode?.textContent ?? "",
      hidden: document.createElement("div"), banner: null, counterSection: null,
      labels: [], button: root.querySelector('[data-action="roll"]')
    };
    session.originals = originals;
    if (titleNode) titleNode.textContent = request.title;
    originals.hidden.hidden = true;
    originals.hidden.className = "ae5e-target-native-blurb";
    while (form.firstChild && form.firstChild !== list) originals.hidden.appendChild(form.firstChild);
    form.insertBefore(originals.hidden, list);

    const banner = document.createElement("div");
    banner.className = "ae5e-target-instructions";
    textWithEmphasis(banner, request.instructions);
    form.insertBefore(banner, list);
    originals.banner = banner;

    const section = document.createElement("div");
    section.className = "ae5e-target-count-section";
    const counter = document.createElement("div");
    counter.className = "ae5e-target-counter";
    counter.setAttribute("aria-live", "polite");
    section.appendChild(counter);
    if (request.reminder) {
      const reminder = document.createElement("div");
      reminder.className = "ae5e-target-reminder";
      reminder.textContent = request.reminder;
      section.appendChild(reminder);
    }
    list.insertAdjacentElement("afterend", section);
    originals.counterSection = section;

    swapButtonLabel(root.querySelector('[data-action="roll"]'), request.labels.continue, originals.labels);
    swapButtonLabel(root.querySelector('[data-action="cancel"]'), request.labels.cancel, originals.labels);
    swapButtonLabel(root.querySelector('[data-action="clearTargets"]'), request.labels.clear, originals.labels);
    this.#updateStatus(app, session);
  }

  #validate(app, session) {
    const targets = [...(game.user?.targets ?? [])];
    const maximum = Number(app.data.maxTargets);
    const effectiveMaximum = Number.isFinite(maximum) ? maximum : null;
    const validation = session.request.validation;
    const rows = [];
    const invalidReasons = [];
    if (targets.length < validation.minTargets) invalidReasons.push("too-few-targets");
    if (effectiveMaximum !== null && targets.length > effectiveMaximum) invalidReasons.push("too-many-targets");
    const activity = app.data.activity;
    const caster = resolvedToken(app.data.actor);
    const checker = globalThis.MidiQOL?.checkActivityRange;
    for (const target of targets) {
      let rangeStatus = "normal";
      if (validation.enforceRange) {
        if (!caster || typeof checker !== "function") rangeStatus = "unknown";
        else {
          try {
            rangeStatus = checker(activity, caster, new Set([target]), false)?.result ?? "unknown";
          } catch { rangeStatus = "unknown"; }
        }
      }
      const invalid = validation.enforceRange &&
        (rangeStatus === "fail" || rangeStatus === "unknown" ||
          (rangeStatus === "dis" && !validation.allowLongRange) ||
          !["normal", "dis", "fail", "unknown"].includes(rangeStatus));
      if (invalid) invalidReasons.push("invalid-range");
      rows.push({ token: target, rangeStatus, invalid });
    }
    return { valid: invalidReasons.length === 0, selected: targets.length, maximum: effectiveMaximum, rows, invalidReasons };
  }

  #updateStatus(app, session) {
    const root = app?.element;
    const validation = this.#validate(app, session);
    const count = root?.querySelector(".ae5e-target-counter");
    if (count) count.textContent = formatCount(
      session.request.counter, validation.selected, validation.maximum ?? "any"
    );
    const continueButton = root?.querySelector('[data-action="roll"]');
    if (continueButton) {
      continueButton.disabled = !validation.valid;
      continueButton.setAttribute("aria-disabled", String(!validation.valid));
    }
    const rowNodes = root?.querySelectorAll(".midi-qol-target-confirmation-list .midi-qol-box") ?? [];
    for (const row of rowNodes) {
      row.classList.remove("ae5e-target-range-normal", "ae5e-target-range-dis", "ae5e-target-range-fail", "ae5e-target-range-unknown", "ae5e-target-invalid-row");
      const img = row.querySelector('img[id]');
      if (!img) continue;
      img.classList.add("ae5e-target-portrait");
      row.classList.add("ae5e-target-row");
      const matching = validation.rows.find(entry => entry.token.document?.uuid === img.id);
      if (!matching) continue;
      const dispositions = globalThis.CONST?.TOKEN_DISPOSITIONS;
      const ring = visibleDisposition(matching.token.document?.disposition, {
        isGM: Boolean(game.user?.isGM), dispositions
      });
      // Never add a SECRET CSS class for a non-GM viewer.
      for (const className of [...row.classList]) if (className.startsWith("ae5e-target-disposition-")) row.classList.remove(className);
      row.classList.add(`ae5e-target-disposition-${ring}`);
      row.classList.add(`ae5e-target-range-${matching.rangeStatus}`);
      row.classList.toggle("ae5e-target-invalid-row", matching.invalid);
    }
    return validation;
  }

  #restore(app, session) {
    const previous = session.originals;
    if (previous?.form?.isConnected) {
      const { form, list, hidden, banner, counterSection, labels, titleNode, originalTitle } = previous;
      if (hidden.isConnected) {
        while (hidden.firstChild) form.insertBefore(hidden.firstChild, list);
        hidden.remove();
      }
      banner?.remove();
      counterSection?.remove();
      for (const { node, previous: oldText } of labels) if (node.isConnected) node.textContent = oldText;
      if (titleNode?.isConnected) titleNode.textContent = originalTitle;
      const button = form.closest(".application")?.querySelector('[data-action="roll"]');
      if (button) { button.disabled = false; button.removeAttribute("aria-disabled"); }
    }
    if (session.guardedRoot) {
      session.guardedRoot.removeEventListener("click", session.clickGuard, true);
      session.guardedRoot.removeEventListener("keydown", session.clickGuard, true);
      session.guardedRoot.removeEventListener("submit", session.submitGuard, true);
      session.guardedRoot.classList.remove(CLASS);
      for (const name of [...session.guardedRoot.style]) if (name.startsWith("--ae5e-target-")) session.guardedRoot.style.removeProperty(name);
    }
    session.originals = null;
    session.guardedRoot = null;
  }

  #close(app) {
    const session = this.#active.get(app);
    if (!session) return;
    this.#restore(app, session);
    this.#active.delete(app);
    this.#stats.closed++;
  }
}