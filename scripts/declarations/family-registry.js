import { MODULE_ID } from "../core/constants.js";
import { clone, isObject, jsonIssues, validId } from "./json-data.js";

function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Families are registered by AE5E code, never by Item JSON or Item names. */
export class DeclarationFamilyRegistry {
  #families = new Map();
  #consumers = new Map();

  register({ id, label, flagPath, version = 1, schema, templates = [], validate, migrate = null }) {
    if (!validId(id) || !label || !Number.isSafeInteger(version) || version < 1
      || !new RegExp(`^flags\\.${MODULE_ID}\\.[a-zA-Z][a-zA-Z0-9_-]*$`).test(flagPath)
      || ["cat", "constructor", "prototype", "__proto__"].includes(flagPath.split(".").at(-1))
      || !isObject(schema) || typeof validate !== "function") {
      throw new Error("A declaration family requires an id, label, dedicated AE5E flag, version, schema and validator.");
    }
    if (this.#families.has(id) || this.list().some(family => family.flagPath === flagPath)) {
      throw new Error("Declaration family or storage path is already registered.");
    }
    if (!Array.isArray(templates) || templates.some(template => !validId(template.id)
      || !template.label || !isObject(template.record))
      || new Set(templates.map(template => template.id)).size !== templates.length
      || jsonIssues({ schema, templates }).length || (migrate !== null && typeof migrate !== "function")) {
      throw new Error("Invalid declaration templates, schema or migration.");
    }
    this.#families.set(id, Object.freeze({ id, label, flagPath, version,
      schema: freeze(clone(schema)), templates: freeze(clone(templates)), validate, migrate }));
    return this.get(id);
  }

  get(id) { return this.#families.get(id) ?? null; }
  list() { return [...this.#families.values()]; }

  validateRecord(familyId, record) {
    const family = this.get(familyId);
    const issues = jsonIssues(record);
    if (!family) issues.push(`Unknown declaration family '${familyId}'.`);
    if (!isObject(record)) issues.push("Declaration must be a JSON object.");
    else {
      if (!validId(record.id)) issues.push("id must be a stable identifier starting with a letter.");
      if (Object.hasOwn(record, "enabled")) issues.push("Declarations do not have a generic enabled field; remove the record to stop participation.");
      if (record.family !== undefined && record.family !== familyId) issues.push("family cannot change the registered destination.");
      if (record.condition !== undefined && typeof record.condition !== "string") issues.push("condition must be an AC5E expression string.");
      if (record.activation !== undefined && (!isObject(record.activation)
        || Object.entries(record.activation).some(([key, value]) => !["equipped", "attuned"].includes(key) || typeof value !== "boolean"))) {
        issues.push("activation supports explicit equipped/attuned boolean requirements.");
      }
      if (family && !issues.length) {
        try { issues.push(...family.validate(clone(record))); }
        catch (error) { issues.push(`Family validation failed: ${error.message}`); }
      }
    }
    return { valid: !issues.length, issues };
  }

  registerConsumer(family, id, consumer) {
    if (!this.get(family) || !validId(id) || typeof consumer !== "function") throw new Error("Invalid declaration consumer.");
    const key = JSON.stringify([family, id]);
    if (this.#consumers.has(key)) throw new Error("Declaration consumer is already registered.");
    this.#consumers.set(key, consumer);
  }

  consume(family, id, entries, context) {
    const consumer = this.#consumers.get(JSON.stringify([family, id]));
    if (!consumer) throw new Error("Declaration consumer is not registered.");
    return consumer(entries.filter(entry => entry.family === family), context);
  }
}
