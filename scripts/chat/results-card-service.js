import { MODULE_ID } from "../core/constants.js";

/*
 * AE5E independent Results Cards, schema 1.
 * This service presents author-supplied, already-resolved outcomes.
 * It never rolls saves, calculates damage, or exposes hidden workflow data.
 */
export const RESULTS_CARD_SCHEMA = 1;

export const RESULTS_CARD_DEFAULT_STYLE = Object.freeze({
  iconSize: 48,
  portraitSize: 24,
  saveSymbolSize: 16,
  rowMinHeight: 36,
  rowPadding: 6,
  rowGap: 6,
  sectionSpacing: 10,
  headerGap: 8,
  damageRowPadding: 4,
  damageColumnGap: 8,
  title: Object.freeze({ size: 16, weight: 700 }),
  subtitle: Object.freeze({ size: 16, weight: 600 }),
  saveHeading: Object.freeze({ size: 13, weight: 700 }),
  saveTargetName: Object.freeze({ size: 14, weight: 600 }),
  saveTotal: Object.freeze({ size: 12, weight: 700 }),
  saveDc: Object.freeze({ size: 12, weight: 500 }),
  damageHeading: Object.freeze({ size: 13, weight: 700 }),
  damageTargetName: Object.freeze({ size: 12, weight: 500 }),
  damageAmount: Object.freeze({ size: 12, weight: 700 })
});

const TYPOGRAPHY = new Set([
  "title", "subtitle", "saveHeading", "saveTargetName", "saveTotal", "saveDc",
  "damageHeading", "damageTargetName", "damageAmount"
]);
const GEOMETRY = new Set([
  "iconSize", "portraitSize", "saveSymbolSize", "rowMinHeight", "rowPadding",
  "rowGap", "sectionSpacing", "headerGap", "damageRowPadding", "damageColumnGap"
]);
const cssName = key => key.replace(/[A-Z]/g, letter => "-" + letter.toLowerCase());
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

function text(value, label, { required = false, max = 160 } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new Error(label + " is required.");
    return "";
  }
  if (typeof value !== "string") throw new Error(label + " must be a string.");
  const result = value.trim();
  if (required && !result) throw new Error(label + " cannot be empty.");
  if (result.length > max) throw new Error(label + " is too long (max " + max + ").");
  return result;
}

function integer(value, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(label + " must be an integer between " + min + " and " + max + ".");
  }
  return value;
}

function safeImage(value, label) {
  const candidate = text(value, label, { max: 1024 });
  if (!candidate) return "";
  // Never allow a URL scheme other than HTTP(S) or protocol-relative URLs.
  if (/^\/\//.test(candidate) || ( /^[a-z][a-z0-9+.-]*:/i.test(candidate) && !/^https?:\/\//i.test(candidate) )
    || /[\u0000-\u001f<>]/.test(candidate)) {
    throw new Error(label + " must be a safe HTTP(S) or relative image path.");
  }
  return candidate;
}

/** Validated overrides; omitted values inherit the shared AE5E defaults. */
export function resolveResultsCardStyle(overrides = {}) {
  if (!isObject(overrides)) throw new Error("Results card style must be an object.");
  const result = {};
  for (const [key, original] of Object.entries(RESULTS_CARD_DEFAULT_STYLE)) {
    const supplied = Object.hasOwn(overrides, key) ? overrides[key] : undefined;
    if (TYPOGRAPHY.has(key)) {
      if (supplied !== undefined && !isObject(supplied)) throw new Error("style." + key + " must be an object.");
      const choice = supplied ?? {};
      for (const prop of Object.keys(choice)) {
        if (!["size", "weight"].includes(prop)) throw new Error("Unsupported style." + key + "." + prop);
      }
      result[key] = {
        size: integer(choice.size ?? original.size, "style." + key + ".size", 9, 32),
        weight: integer(choice.weight ?? original.weight, "style." + key + ".weight", 100, 900)
      };
      if (result[key].weight % 100 !== 0) throw new Error("Font weight must use 100-step increments.");
    } else {
      result[key] = integer(supplied ?? original, "style." + key, 0, key === "iconSize" ? 128 : 80);
      if ((key === "iconSize" || key === "portraitSize") && result[key] < 12) {
        throw new Error("style." + key + " must be at least 12 px.");
      }
    }
  }
  for (const key of Object.keys(overrides)) {
    if (!TYPOGRAPHY.has(key) && !GEOMETRY.has(key)) throw new Error("Unknown results card style property: " + key);
  }
  return result;
}

function saveRows(input) {
  if (!Array.isArray(input) || input.length > 50) throw new Error("saves.rows must be an array of at most 50 targets.");
  return input.map((row, index) => {
    const label = "saves.rows[" + index + "]";
    if (!isObject(row)) throw new Error(label + " must be an object.");
    if (!["passed", "failed"].includes(row.outcome)) {
      throw new Error(label + ".outcome must be explicitly 'passed' or 'failed'.");
    }
    return {
      name: text(row.name, label + ".name", { required: true }),
      image: safeImage(row.image ?? "", label + ".image"),
      outcome: row.outcome,
      total: row.total === undefined || row.total === null ? null
        : integer(row.total, label + ".total", -999, 9999),
      dc: row.dc === undefined || row.dc === null ? null
        : integer(row.dc, label + ".dc", 0, 9999)
    };
  });
}

function damageRows(input) {
  if (!Array.isArray(input) || input.length > 50) throw new Error("damage.rows must be an array of at most 50 targets.");
  return input.map((row, index) => {
    const label = "damage.rows[" + index + "]";
    if (!isObject(row)) throw new Error(label + " must be an object.");
    if (typeof row.amount !== "number" || !Number.isFinite(row.amount)
      || row.amount < 0 || row.amount > 1000000000) {
      throw new Error(label + ".amount must be a nonnegative finite resolved damage number.");
    }
    return {
      name: text(row.name, label + ".name", { required: true }),
      amount: row.amount,
      type: text(row.type, label + ".type", { max: 80 })
    };
  });
}

/** Snapshot only visible, explicit presentation data; no workflow internals. */
export function normalizeResultsCard(request) {
  if (!isObject(request)) throw new Error("Results card request must be an object.");
  if (!isObject(request.header)) throw new Error("Results card header is required.");
  const item = request.item ?? request.workflow?.item;
  const header = {
    title: text(request.header.title, "header.title", { required: true }),
    subtitle: text(request.header.subtitle, "header.subtitle"),
    icon: safeImage(request.header.icon ?? item?.img ?? "icons/svg/mystery-man.svg", "header.icon")
  };
  if (request.saves !== undefined && !isObject(request.saves)) throw new Error("saves must be an object.");
  if (request.damage !== undefined && !isObject(request.damage)) throw new Error("damage must be an object.");
  const saves = request.saves ? {
    heading: text(request.saves.heading, "saves.heading", { max: 200 }),
    rows: saveRows(request.saves.rows)
  } : null;
  const damage = request.damage ? {
    heading: text(request.damage.heading ?? "Damage Results", "damage.heading", { max: 200 }),
    rows: damageRows(request.damage.rows)
  } : null;
  if (!saves?.rows.length && !damage?.rows.length) {
    throw new Error("Results card must contain at least one save or damage row.");
  }
  return { schema: RESULTS_CARD_SCHEMA, header, saves, damage, style: resolveResultsCardStyle(request.style) };
}

function cssVariables(style) {
  const entries = [];
  for (const [key, value] of Object.entries(style)) {
    const root = "--ae5e-results-" + cssName(key);
    if (TYPOGRAPHY.has(key)) {
      entries.push(root + "-size:" + value.size + "px");
      entries.push(root + "-weight:" + value.weight);
    } else entries.push(root + ":" + value + "px");
  }
  return entries.join(";");
}

/** Output is escaped HTML and only validated pixel/weight CSS variables. */
export function renderResultsCard(snapshot) {
  if (snapshot?.schema !== RESULTS_CARD_SCHEMA) throw new Error("Unsupported results card schema.");
  const h = snapshot.header;
  const html = [
    '<section class="ae5e-results-card" style="' + cssVariables(snapshot.style) + '">',
    '<div class="ae5e-results-header">',
    h.icon ? '<img class="ae5e-results-icon" src="' + escapeHtml(h.icon) + '" alt="">' : "",
    '<div class="ae5e-results-titles"><strong class="ae5e-results-title">' + escapeHtml(h.title) + '</strong>',
    h.subtitle ? '<span class="ae5e-results-subtitle">' + escapeHtml(h.subtitle) + '</span>' : "",
    '</div></div>'
  ];
  if (snapshot.saves?.rows.length) {
    html.push('<div class="ae5e-results-divider"></div><section class="ae5e-results-saves">');
    if (snapshot.saves.heading) html.push('<div class="ae5e-results-save-heading">' + escapeHtml(snapshot.saves.heading) + '</div>');
    for (const row of snapshot.saves.rows) {
      const passed = row.outcome === "passed";
      html.push('<div class="ae5e-results-save-row ae5e-results-save-' + row.outcome + '">',
        '<i class="fa-solid ' + (passed ? "fa-check" : "fa-xmark") + ' ae5e-results-save-symbol" aria-hidden="true"></i>',
        row.image ? '<img class="ae5e-results-portrait" src="' + escapeHtml(row.image) + '" alt="">' : "",
        '<span class="ae5e-results-target-name">' + escapeHtml(row.name) + '</span>',
        row.total === null ? "" : '<strong class="ae5e-results-save-total">' + row.total + '</strong>',
        row.dc === null ? "" : '<span class="ae5e-results-dc">DC ' + row.dc + '</span>',
        '</div>');
    }
    html.push("</section>");
  }
  if (snapshot.damage?.rows.length) {
    html.push('<div class="ae5e-results-divider"></div><section class="ae5e-results-damage">');
    if (snapshot.damage.heading) html.push('<div class="ae5e-results-damage-heading">' + escapeHtml(snapshot.damage.heading) + '</div>');
    for (const row of snapshot.damage.rows) html.push(
      '<div class="ae5e-results-damage-row"><span class="ae5e-results-damage-name">' + escapeHtml(row.name) + '</span>',
      '<strong class="ae5e-results-damage-amount">' + row.amount
        + (row.type ? " " + escapeHtml(row.type) : "") + '</strong></div>');
    html.push("</section>");
  }
  html.push("</section>");
  return html.join("");
}

/**
 * Caller must pass resolved, viewer-safe data and any intended whisper list.
 * This service never infers a roll, reads private Midi arrays, or applies damage.
 */
export class ResultsCardService {
  getDefaults() {
    return resolveResultsCardStyle();
  }

  async create(request) {
    const snapshot = normalizeResultsCard(request);
    const ChatMessage = globalThis.ChatMessage;
    if (typeof ChatMessage?.create !== "function") throw new Error("ChatMessage.create is unavailable.");
    const data = {
      user: globalThis.game?.user?.id,
      content: renderResultsCard(snapshot),
      flags: { [MODULE_ID]: { resultsCard: snapshot } }
    };
    if (request.speaker !== undefined) data.speaker = request.speaker;
    else if (typeof ChatMessage.getSpeaker === "function") {
      data.speaker = ChatMessage.getSpeaker({ actor: request.workflow?.actor ?? request.item?.parent });
    }
    if (request.whisper !== undefined) {
      if (!Array.isArray(request.whisper) || request.whisper.some(id => typeof id !== "string" || !id)) {
        throw new Error("whisper must be an array of user IDs.");
      }
      data.whisper = [...request.whisper];
    }
    if (request.blind !== undefined) {
      if (typeof request.blind !== "boolean") throw new Error("blind must be a boolean.");
      if (request.blind && !data.whisper?.length) throw new Error("Blind results cards require explicit whisper recipients.");
      data.blind = request.blind;
    }
    return ChatMessage.create(data);
  }
}
