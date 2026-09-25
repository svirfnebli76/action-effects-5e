import { MODULE_ID } from "../core/constants.js";
import {
  CROSSHAIR_3D_PROPAGATION_MODES,
  CROSSHAIR_3D_PROPAGATION_OVERRIDE_DEFAULT
} from "./propagation-mode-service.js";

export const CROSSHAIR_3D_CONFIGURATION_SCHEMA_VERSION = 1;
export const CROSSHAIR_3D_CONFIGURATION_FLAG = "crosshairs3d";
export const CROSSHAIR_3D_CAT_PROPAGATION_KEY = "propagation";

export const CROSSHAIR_3D_CAT_PROPAGATION_CONFIG = Object.freeze({
  label: "3D Area Propagation",
  hint: "Choose how physical movement obstructions limit this area.",
  type: "select",
  default: CROSSHAIR_3D_PROPAGATION_OVERRIDE_DEFAULT,
  category: "Action Effects 3D Crosshairs",
  options: Object.freeze([
    Object.freeze({ value: "default", label: "Item Default" }),
    Object.freeze({ value: "none", label: "None" }),
    Object.freeze({ value: "direct", label: "Direct" }),
    Object.freeze({ value: "spread", label: "Spread" })
  ])
});

const TOP_LEVEL_KEYS = new Set([
  "schemaVersion", "shape", "range", "capabilities", "controls", "placement",
  "propagation", "persistent", "remote", "includeSource"
]);
const BOOLEAN_CAPABILITIES = ["elevation", "rotation", "resize", "los"];
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const MAX_RECENT = 20;

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function clone(value) {
  if (value === undefined) return undefined;
  if (globalThis.foundry?.utils?.deepClone) {
    try { return foundry.utils.deepClone(value); } catch { /* fall through */ }
  }
  return structuredClone(value);
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) freeze(entry);
  return Object.freeze(value);
}

function merge(target, source, path = "configuration") {
  if (source === undefined) return target;
  if (!isPlainObject(source)) throw new TypeError(`${path} must be a plain object.`);
  for (const [key, value] of Object.entries(source)) {
    if (DANGEROUS_KEYS.has(key)) throw new TypeError(`${path}.${key} is not an allowed property.`);
    if (isPlainObject(value)) {
      const base = isPlainObject(target[key]) ? target[key] : {};
      target[key] = merge(base, value, `${path}.${key}`);
    } else target[key] = clone(value);
  }
  return target;
}

function documentFlag(document) {
  if (!document) return null;
  if (typeof document.getFlag === "function") {
    try { return document.getFlag(MODULE_ID, CROSSHAIR_3D_CONFIGURATION_FLAG) ?? null; }
    catch { /* fall through */ }
  }
  return document.flags?.[MODULE_ID]?.[CROSSHAIR_3D_CONFIGURATION_FLAG] ?? null;
}

function uuid(document) {
  return document?.uuid ?? null;
}

function normalizePropagationConfig(input) {
  if (typeof input === "string") return { mode: input };
  if (input == null) return {};
  if (!isPlainObject(input)) throw new TypeError("configuration.propagation must be a mode string or plain object.");
  return clone(input);
}

function shapeType(configurationOrShape) {
  if (typeof configurationOrShape === "string") return configurationOrShape.trim().toLowerCase();
  const shape = configurationOrShape?.shape ?? configurationOrShape;
  return String(shape?.type ?? "").trim().toLowerCase();
}

/**
 * Production Item/Activity boundary for Action Effects 3D Crosshairs.
 *
 * Low-level show() remains available for diagnostics and bespoke macros. This
 * service resolves opt-in persisted configuration, CAT's user override, and
 * runtime-only callbacks into one validated placement request with provenance.
 */
export class Crosshair3dIntegrationService {
  #placement;
  #propagationModes;
  #recent = [];
  #stats = {
    resolutionRequests: 0,
    successfulResolutions: 0,
    validationFailures: 0,
    configuredPlacements: 0,
    confirmed: 0,
    cancelled: 0,
    errors: 0,
    catReads: 0,
    catReadFailures: 0,
    last: null
  };

  constructor({ placement, propagationModes }) {
    this.#placement = placement;
    this.#propagationModes = propagationModes;
  }

  getCatPropagationConfig(input = {}) {
    const descriptor = clone(CROSSHAIR_3D_CAT_PROPAGATION_CONFIG);
    const requestedShape = typeof input === "string" ? input : input?.shapeType ?? input?.shape ?? input;
    if (shapeType(requestedShape) === "cone") {
      descriptor.options = descriptor.options.filter(option => option.value !== CROSSHAIR_3D_PROPAGATION_MODES.SPREAD);
    }
    return descriptor;
  }

  getStats() {
    return freeze({ ...this.#stats, recent: this.#recent.length });
  }

  getRecent() {
    return freeze(this.#recent.map(entry => clone(entry)));
  }

  inspect(input = {}) {
    try {
      const assembled = this.#assemble(input);
      const errors = this.#validate(assembled.configuration);
      return freeze({
        valid: errors.length === 0,
        errors,
        configuration: clone(assembled.configuration),
        sources: [...assembled.sources],
        itemUuid: uuid(assembled.item),
        activityUuid: uuid(assembled.activity)
      });
    } catch (error) {
      return freeze({
        valid: false,
        errors: [error?.message ?? String(error)],
        configuration: null,
        sources: [],
        itemUuid: uuid(input.item),
        activityUuid: uuid(input.activity)
      });
    }
  }

  async resolve(input = {}) {
    this.#stats.resolutionRequests += 1;
    let assembled;
    try {
      assembled = this.#assemble(input);
    } catch (cause) {
      this.#stats.validationFailures += 1;
      const issues = [cause?.message ?? String(cause)];
      const error = new Error(`Invalid Action Effects 3D Crosshairs configuration: ${issues.join(" ")}`, { cause });
      error.issues = issues;
      throw error;
    }
    const errors = this.#validate(assembled.configuration);
    if (errors.length) {
      this.#stats.validationFailures += 1;
      const error = new Error(`Invalid Action Effects 3D Crosshairs configuration: ${errors.join(" ")}`);
      error.issues = [...errors];
      throw error;
    }

    const configuration = clone(assembled.configuration);
    configuration.propagation = normalizePropagationConfig(configuration.propagation);
    const item = assembled.item;
    const cat = await this.#resolveCatOverride({
      item,
      catOptions: input.catOptions,
      readCat: input.readCat !== false,
      key: input.catPropagationKey ?? CROSSHAIR_3D_CAT_PROPAGATION_KEY
    });
    const itemDefault = configuration.propagation.mode ?? CROSSHAIR_3D_PROPAGATION_MODES.NONE;
    let selection;
    try {
      selection = this.#propagationModes.resolve({ itemDefault, override: cat.value });
    } catch (cause) {
      this.#stats.validationFailures += 1;
      const error = new Error(
        `Invalid CAT 3D propagation override '${String(cat.value)}'. Expected default, none, direct, or spread.`,
        { cause }
      );
      error.issues = [cause?.message ?? String(cause)];
      throw error;
    }
    try {
      this.#propagationModes.assertSupported(configuration.shape, selection.mode);
    } catch (cause) {
      this.#stats.validationFailures += 1;
      const error = new Error(`Invalid Action Effects 3D Crosshairs configuration: ${cause?.message ?? String(cause)}`, { cause });
      error.issues = [cause?.message ?? String(cause)];
      throw error;
    }
    configuration.propagation = {
      ...configuration.propagation,
      itemDefault,
      override: cat.value
    };

    const provenance = freeze({
      schemaVersion: CROSSHAIR_3D_CONFIGURATION_SCHEMA_VERSION,
      itemUuid: uuid(item),
      activityUuid: uuid(assembled.activity),
      sources: [...assembled.sources],
      propagation: {
        mode: selection.mode,
        source: selection.source === "override" ? cat.source : "item-default",
        overrideSource: cat.source,
        itemDefault,
        override: cat.value
      }
    });
    const options = freeze({ ...configuration, propagation: {
      ...configuration.propagation,
      itemDefault,
      override: cat.value
    } });
    const resolved = freeze({ configuration: options, options, provenance });
    this.#stats.successfulResolutions += 1;
    this.#record("resolved", provenance);
    return resolved;
  }

  async show(input = {}) {
    if (!input?.source) throw new Error("Configured 3D placement requires a source Token.");
    const resolved = await this.resolve(input);
    const runtime = input.runtime == null ? {} : input.runtime;
    if (!isPlainObject(runtime)) throw new TypeError("Configured 3D placement runtime options must be a plain object.");
    const allowedRuntime = {};
    for (const key of ["signal", "onRevision", "targetFilter"]) {
      if (runtime[key] !== undefined) allowedRuntime[key] = runtime[key];
    }
    this.#stats.configuredPlacements += 1;
    try {
      const result = await this.#placement.show({
        ...clone(resolved.options),
        ...allowedRuntime,
        source: input.source
      });
      if (result.cancelled) this.#stats.cancelled += 1;
      else this.#stats.confirmed += 1;
      // Placement results intentionally retain live Token references in
      // `targets`. Freeze only the wrapper; never recursively traverse or
      // freeze Foundry Documents or Placeables.
      const published = Object.freeze({ ...result, provenance: resolved.provenance });
      this.#record(result.cancelled ? "cancelled" : "confirmed", resolved.provenance);
      return published;
    } catch (error) {
      this.#stats.errors += 1;
      this.#record("error", { ...resolved.provenance, message: error?.message ?? String(error) });
      throw error;
    }
  }

  #assemble(input) {
    const activity = input.activity ?? null;
    const item = input.item ?? activity?.item ?? activity?.parent ?? null;
    const configuration = {};
    const sources = [];
    const add = (value, source) => {
      if (value == null) return;
      merge(configuration, value);
      sources.push(source);
    };
    add(documentFlag(item), "item-flag");
    add(documentFlag(activity), "activity-flag");
    add(input.configuration, "explicit-configuration");
    add(input.overrides, "runtime-overrides");
    if (!sources.length) {
      throw new Error(`No flags.${MODULE_ID}.${CROSSHAIR_3D_CONFIGURATION_FLAG} configuration or explicit configuration was provided.`);
    }
    configuration.schemaVersion ??= CROSSHAIR_3D_CONFIGURATION_SCHEMA_VERSION;
    return { configuration, sources, item, activity };
  }

  #validate(configuration) {
    const errors = [];
    if (!isPlainObject(configuration)) return ["The resolved configuration must be a plain object."];
    if (configuration.schemaVersion !== CROSSHAIR_3D_CONFIGURATION_SCHEMA_VERSION) {
      errors.push(`schemaVersion must be ${CROSSHAIR_3D_CONFIGURATION_SCHEMA_VERSION}.`);
    }
    for (const key of Object.keys(configuration)) {
      if (!TOP_LEVEL_KEYS.has(key)) errors.push(`Unsupported top-level property '${key}'.`);
    }
    if (!isPlainObject(configuration.shape) || !String(configuration.shape?.type ?? "").trim()) {
      errors.push("shape.type is required.");
    }
    if (configuration.range !== undefined) {
      if (!isPlainObject(configuration.range)) errors.push("range must be a plain object.");
      else if (configuration.range.max !== undefined && !(Number.isFinite(Number(configuration.range.max)) && Number(configuration.range.max) > 0)) {
        errors.push("range.max must be a positive finite number.");
      }
    }
    if (configuration.capabilities !== undefined) {
      if (!isPlainObject(configuration.capabilities)) errors.push("capabilities must be a plain object.");
      else for (const key of BOOLEAN_CAPABILITIES) {
        if (configuration.capabilities[key] !== undefined && typeof configuration.capabilities[key] !== "boolean") {
          errors.push(`capabilities.${key} must be true or false.`);
        }
      }
    }
    for (const key of ["controls", "placement"]) {
      if (configuration[key] !== undefined && !isPlainObject(configuration[key])) {
        errors.push(`${key} must be a plain object.`);
      }
    }
    try {
      const propagation = normalizePropagationConfig(configuration.propagation);
      const mode = this.#propagationModes.normalize(propagation.mode ?? CROSSHAIR_3D_PROPAGATION_MODES.NONE);
      this.#propagationModes.assertSupported(configuration.shape, mode);
      if (propagation.connectors !== undefined && !Array.isArray(propagation.connectors)) {
        errors.push("propagation.connectors must be an array.");
      }
    } catch (error) { errors.push(error?.message ?? String(error)); }
    if (configuration.persistent !== undefined) {
      if (!isPlainObject(configuration.persistent)) errors.push("persistent must be a plain object.");
      else if (configuration.persistent.enabled !== undefined && typeof configuration.persistent.enabled !== "boolean") {
        errors.push("persistent.enabled must be true or false.");
      }
    }
    for (const key of ["remote", "includeSource"]) {
      if (configuration[key] !== undefined && typeof configuration[key] !== "boolean") {
        errors.push(`${key} must be true or false.`);
      }
    }
    return errors;
  }

  async #resolveCatOverride({ item, catOptions, readCat, key }) {
    if (catOptions !== undefined) {
      if (!isPlainObject(catOptions)) throw new TypeError("catOptions must be a plain object.");
      if (catOptions[key] !== undefined) return { value: catOptions[key], source: "cat-options" };
    }
    if (!readCat || !item) return { value: CROSSHAIR_3D_PROPAGATION_OVERRIDE_DEFAULT, source: "default" };
    // CAT publishes its supported macro utilities beneath `cat.utils`.
    // Retain the early-development direct path as a compatibility fallback.
    const utilities = globalThis.cat?.utils?.automationUtils
      ?? globalThis.cat?.automationUtils;
    const getter = utilities?.getConfigValue;
    if (typeof getter !== "function") return { value: CROSSHAIR_3D_PROPAGATION_OVERRIDE_DEFAULT, source: "default" };
    this.#stats.catReads += 1;
    try {
      const value = await getter.call(utilities, item, key);
      return {
        value: value ?? CROSSHAIR_3D_PROPAGATION_OVERRIDE_DEFAULT,
        source: value == null ? "default" : "cat-item-configuration"
      };
    } catch (error) {
      this.#stats.catReadFailures += 1;
      return { value: CROSSHAIR_3D_PROPAGATION_OVERRIDE_DEFAULT, source: "cat-read-failed" };
    }
  }

  #record(type, details) {
    const entry = freeze({
      type,
      at: new Date().toISOString(),
      itemUuid: details?.itemUuid ?? null,
      activityUuid: details?.activityUuid ?? null,
      sources: [...(details?.sources ?? [])],
      propagation: details?.propagation ? clone(details.propagation) : null,
      ...(details?.message ? { message: details.message } : {})
    });
    this.#stats.last = entry;
    this.#recent.push(entry);
    if (this.#recent.length > MAX_RECENT) this.#recent.splice(0, this.#recent.length - MAX_RECENT);
  }
}
