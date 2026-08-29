import { MODULE_ID } from "../core/constants.js";
import { CAT_PUBLIC_AUTOMATION_PACK_IDS } from "./cat-metadata-authoring-service.js";

export const CAT_CONFIGURATION_SCHEMA_FLAG = `flags.${MODULE_ID}.cat.configSchema`;

export const CAT_CONFIGURATION_TYPES = Object.freeze([
  "checkbox",
  "number",
  "text",
  "file",
  "select",
  "select-many",
  "documents",
  "selectActivity",
  "selectEffect",
  "selectAnimation",
  "selectIdentifiers",
  "selectSummons",
  "packOrFolderMultiSelect"
]);

const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const CONFIG_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

function defaultFromUuid(uuid) {
  if (typeof globalThis.fromUuid !== "function") return null;
  return globalThis.fromUuid(uuid);
}

function defaultPacksAccessor() {
  return globalThis.game?.packs ?? null;
}

function defaultUserAccessor() {
  return globalThis.game?.user ?? null;
}

function collectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return [...collection];
  if (typeof collection.values === "function") {
    try { return [...collection.values()]; } catch { /* fall through */ }
  }
  if (typeof collection[Symbol.iterator] === "function") {
    try { return [...collection]; } catch { /* fall through */ }
  }
  return [];
}

function packId(pack) {
  return pack?.collection ?? pack?.metadata?.id ?? null;
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneData(value) {
  const deepClone = globalThis.foundry?.utils?.deepClone;
  if (typeof deepClone === "function") {
    try { return deepClone(value); } catch { /* fall through */ }
  }
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function validateSerializable(value, path, issues, seen = new Set()) {
  if (value === null) return;
  const type = typeof value;
  if (["string", "boolean"].includes(type)) return;
  if (type === "number") {
    if (!Number.isFinite(value)) issues.push(`${path} must not contain NaN or Infinity.`);
    return;
  }
  if (["undefined", "function", "symbol", "bigint"].includes(type)) {
    issues.push(`${path} contains a non-JSON value (${type}).`);
    return;
  }
  if (seen.has(value)) {
    issues.push(`${path} contains a circular reference.`);
    return;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateSerializable(entry, `${path}[${index}]`, issues, seen));
    seen.delete(value);
    return;
  }
  if (!isPlainObject(value)) {
    issues.push(`${path} must contain only plain JSON objects and arrays.`);
    seen.delete(value);
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (DANGEROUS_KEYS.has(key)) issues.push(`${path}.${key} is not an allowed property name.`);
    validateSerializable(entry, `${path}.${key}`, issues, seen);
  }
  seen.delete(value);
}

function validateOptions(descriptor, path, issues) {
  if (!("options" in descriptor)) {
    issues.push(`${path}.options is required for ${descriptor.type}.`);
    return;
  }
  if (!Array.isArray(descriptor.options)) {
    issues.push(`${path}.options must be a JSON array.`);
    return;
  }
  descriptor.options.forEach((option, index) => {
    const optionPath = `${path}.options[${index}]`;
    if (!isPlainObject(option)) {
      issues.push(`${optionPath} must be an object with value and label.`);
      return;
    }
    if (!("value" in option)) issues.push(`${optionPath}.value is required.`);
    if (!String(option.label ?? "").trim()) issues.push(`${optionPath}.label is required.`);
  });
}

export function validateCatConfigurationData(data) {
  const issues = [];
  if (!isPlainObject(data)) {
    return {
      valid: false,
      optionCount: 0,
      issues: ["CAT configuration data must be a JSON object keyed by option name."]
    };
  }

  validateSerializable(data, "configuration", issues);

  for (const [key, descriptor] of Object.entries(data)) {
    const path = `configuration.${key}`;
    if (DANGEROUS_KEYS.has(key) || !CONFIG_KEY_PATTERN.test(key)) {
      issues.push(`${path} uses an invalid option key. Use letters/numbers, hyphens, or underscores and start with a letter.`);
    }
    if (!isPlainObject(descriptor)) {
      issues.push(`${path} must be an object.`);
      continue;
    }

    const type = String(descriptor.type ?? "").trim();
    if (!type) issues.push(`${path}.type is required.`);
    else if (!CAT_CONFIGURATION_TYPES.includes(type)) {
      issues.push(`${path}.type "${type}" is not a CAT configuration type supported by this editor.`);
    }

    if (!("default" in descriptor)) issues.push(`${path}.default is required.`);
    if (descriptor.label !== undefined && !String(descriptor.label ?? "").trim()) {
      issues.push(`${path}.label must be a non-empty string when provided.`);
    }
    if (descriptor.hint !== undefined && typeof descriptor.hint !== "string") {
      issues.push(`${path}.hint must be a string when provided.`);
    }
    if (descriptor.category !== undefined && !String(descriptor.category ?? "").trim()) {
      issues.push(`${path}.category must be a non-empty string when provided.`);
    }

    const defaultValue = descriptor.default;
    switch (type) {
      case "checkbox":
        if (typeof defaultValue !== "boolean") issues.push(`${path}.default must be true or false for a checkbox.`);
        break;
      case "number":
        if (defaultValue !== null && (typeof defaultValue !== "number" || !Number.isFinite(defaultValue))) {
          issues.push(`${path}.default must be a finite number or null for a number option.`);
        }
        break;
      case "text":
      case "file":
      case "select":
      case "selectActivity":
      case "selectEffect":
        if (defaultValue !== null && typeof defaultValue !== "string") {
          issues.push(`${path}.default must be a string or null for type ${type}.`);
        }
        break;
      case "select-many":
      case "documents":
      case "selectIdentifiers":
      case "selectSummons":
      case "packOrFolderMultiSelect":
        if (!Array.isArray(defaultValue)) issues.push(`${path}.default must be an array for type ${type}.`);
        break;
      case "selectAnimation":
        if (defaultValue !== null && !isPlainObject(defaultValue)) {
          issues.push(`${path}.default must be an object or null for selectAnimation.`);
        }
        break;
      default:
        break;
    }

    if (type === "select" || type === "select-many") validateOptions(descriptor, path, issues);
  }

  return {
    valid: issues.length === 0,
    optionCount: Object.keys(data).length,
    issues
  };
}

export function parseCatConfigurationText(text) {
  const raw = String(text ?? "").trim();
  if (!raw) {
    return {
      valid: false,
      data: null,
      optionCount: 0,
      issues: ["Paste a JSON object. Use {} when this Item has no CAT configuration options."]
    };
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    return {
      valid: false,
      data: null,
      optionCount: 0,
      issues: [`Invalid JSON: ${error?.message ?? String(error)}`]
    };
  }

  const validation = validateCatConfigurationData(data);
  return {
    ...validation,
    data: validation.valid ? data : null
  };
}

/**
 * Stores CAT automation configuration definitions on canonical AE5E Items.
 *
 * This is authoring data, not a user's chosen CAT preferences. The schema lives
 * under flags.action-effects-5e.cat.configSchema while CAT continues to own
 * installed preference values under flags.cat.config.*.
 */
export class CatConfigurationAuthoringService {
  #fromUuid;
  #packsAccessor;
  #userAccessor;
  #publicPackIds;
  #stats = {
    configurationWrites: 0,
    configurationWriteErrors: 0,
    validations: 0,
    parses: 0,
    compendiumUnlocks: 0,
    compendiumRelocks: 0
  };

  constructor({
    fromUuidAccessor = defaultFromUuid,
    packsAccessor = defaultPacksAccessor,
    userAccessor = defaultUserAccessor,
    publicPackIds = CAT_PUBLIC_AUTOMATION_PACK_IDS
  } = {}) {
    this.#fromUuid = typeof fromUuidAccessor === "function" ? fromUuidAccessor : defaultFromUuid;
    this.#packsAccessor = typeof packsAccessor === "function" ? packsAccessor : defaultPacksAccessor;
    this.#userAccessor = typeof userAccessor === "function" ? userAccessor : defaultUserAccessor;
    this.#publicPackIds = Object.freeze([...publicPackIds]);
  }

  isEligiblePack(packOrId) {
    const id = typeof packOrId === "string" ? packOrId : packId(packOrId);
    return Boolean(id) && this.#publicPackIds.includes(id);
  }

  validate(data) {
    this.#stats.validations += 1;
    return validateCatConfigurationData(data);
  }

  parse(text) {
    this.#stats.parses += 1;
    return parseCatConfigurationText(text);
  }

  getConfiguration(document) {
    if (!document || document.documentName !== "Item") {
      throw new Error("CAT configuration authoring requires an Item document.");
    }
    const data = document.flags?.[MODULE_ID]?.cat?.configSchema;
    return isPlainObject(data) ? cloneData(data) : {};
  }

  getConfigurationText(document) {
    return JSON.stringify(this.getConfiguration(document), null, 2);
  }

  async setConfiguration(documentOrUuid, data) {
    this.#assertGm();
    const document = await this.#resolveItem(documentOrUuid);
    if (!this.isEligiblePack(document.pack)) {
      throw new Error("AE5E CAT configuration authoring is only available for Items in approved AE5E public compendiums.");
    }

    const validation = this.validate(data);
    if (!validation.valid) {
      throw new Error(`CAT configuration validation failed: ${validation.issues.join(" ")}`);
    }
    if (typeof document.update !== "function") throw new Error("Target Item cannot be updated.");

    const pack = document.pack ? this.#resolvePack(document.pack) : null;
    const wasLocked = Boolean(pack?.locked);
    let unlocked = false;

    try {
      if (wasLocked) {
        if (typeof pack?.configure !== "function") {
          throw new Error(`Compendium pack "${document.pack}" is locked and cannot be temporarily unlocked for CAT configuration authoring.`);
        }
        await pack.configure({ locked: false });
        unlocked = true;
        this.#stats.compendiumUnlocks += 1;
      }

      // Foundry merges object updates. Writing {} over an existing object therefore
      // leaves its prior child keys intact. Treat an empty schema as an explicit
      // authoring clear and use Foundry's deletion-key syntax instead.
      const isClear = Object.keys(data).length === 0;
      const updateData = isClear
        ? { [`flags.${MODULE_ID}.cat.-=configSchema`]: null }
        : { [CAT_CONFIGURATION_SCHEMA_FLAG]: cloneData(data) };

      await document.update(updateData);
      this.#stats.configurationWrites += 1;
    } catch (error) {
      this.#stats.configurationWriteErrors += 1;
      throw error;
    } finally {
      if (wasLocked && unlocked) {
        try {
          await pack.configure({ locked: true });
          this.#stats.compendiumRelocks += 1;
        } catch (error) {
          this.#stats.configurationWriteErrors += 1;
          throw new Error(`CAT configuration data was written, but AE5E could not re-lock compendium "${document.pack}": ${error?.message ?? String(error)}`);
        }
      }
    }

    return {
      document,
      configuration: this.getConfiguration(document),
      validation: this.validate(this.getConfiguration(document))
    };
  }

  async setConfigurationText(documentOrUuid, text) {
    const parsed = this.parse(text);
    if (!parsed.valid) throw new Error(parsed.issues.join(" "));
    return this.setConfiguration(documentOrUuid, parsed.data);
  }

  getStatus() {
    return {
      schemaFlag: CAT_CONFIGURATION_SCHEMA_FLAG,
      preferenceFlag: "flags.cat.config.*",
      format: "JSON object keyed by CAT configuration option",
      supportedTypes: [...CAT_CONFIGURATION_TYPES],
      publicPacks: [...this.#publicPackIds]
    };
  }

  getStats() {
    return { ...this.#stats, status: this.getStatus() };
  }

  async #resolveItem(documentOrUuid) {
    let document = documentOrUuid;
    if (typeof documentOrUuid === "string") document = await this.#fromUuid(documentOrUuid);
    if (!document || document.documentName !== "Item") throw new Error("Target must resolve to an Item document.");
    return document;
  }

  #resolvePack(packOrId) {
    if (packOrId && typeof packOrId === "object") return packOrId;
    const id = String(packOrId ?? "").trim();
    if (!id) return null;
    const packs = this.#packsAccessor();
    return packs?.get?.(id) ?? collectionValues(packs).find(pack => packId(pack) === id) ?? null;
  }

  #assertGm() {
    if (!this.#userAccessor()?.isGM) throw new Error("AE5E CAT configuration authoring requires a GM user.");
  }
}
