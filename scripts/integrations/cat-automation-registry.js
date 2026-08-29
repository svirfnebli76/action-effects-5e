import { MODULE_ID, MODULE_TITLE } from "../core/constants.js";
import { Logger } from "../core/logger.js";

export const CAT_AUTOMATION_MODULE_ID = "cat";
export const CAT_AUTOMATION_MINIMUM_VERSION = "0.0.8";
export const CAT_READY_HOOK = "catReady";
export const CAT_AUTOMATION_SOURCE_ID = MODULE_ID;
export const CAT_AUTOMATION_SOURCE_NAME = MODULE_TITLE;

const REQUIRED_CAT_AUTOMATION_API = Object.freeze([
  "registerSourceName",
  "registerAutomation",
  "registerAutomations",
  "registerAutomationCompendium",
  "registerAutomationModule"
]);

function defaultCatAccessor() {
  return globalThis.cat ?? null;
}

function defaultHooksAccessor() {
  return globalThis.Hooks ?? null;
}

function getCatModule() {
  return globalThis.game?.modules?.get?.(CAT_AUTOMATION_MODULE_ID) ?? null;
}

function automationRegistry(cat) {
  return cat?.lib?.constants?.automations ?? null;
}

function countRegisteredAutomations(cat, source = CAT_AUTOMATION_SOURCE_ID) {
  const automations = automationRegistry(cat)?.automations;
  if (!automations || typeof automations.values !== "function") return null;

  let count = 0;
  for (const automation of automations.values()) {
    if (automation?.source === source) count += 1;
  }
  return count;
}

/**
 * CAT automation-provider registration boundary.
 *
 * v0.4.2.1 intentionally registers only AE5E's source name. No Item automation
 * is registered here yet. Later releases can build on this service without
 * coupling Item/runtime automation to CAT's startup timing.
 */
export class CatAutomationRegistry {
  #catAccessor;
  #hooksAccessor;
  #initialized = false;
  #hookRegistered = false;
  #catReadyObserved = false;
  #sourceRegistrationAttempted = false;
  #sourceRegistered = false;
  #sourceVerified = false;
  #verificationMethod = "none";
  #lastError = null;
  #stats = {
    initializeCalls: 0,
    duplicateInitializeCalls: 0,
    catReadyEvents: 0,
    sourceRegistrationAttempts: 0,
    sourceRegistrations: 0,
    sourceRegistrationErrors: 0
  };

  constructor({ catAccessor = defaultCatAccessor, hooksAccessor = defaultHooksAccessor } = {}) {
    this.#catAccessor = typeof catAccessor === "function" ? catAccessor : defaultCatAccessor;
    this.#hooksAccessor = typeof hooksAccessor === "function" ? hooksAccessor : defaultHooksAccessor;
  }

  initialize() {
    this.#stats.initializeCalls += 1;
    if (this.#initialized) {
      this.#stats.duplicateInitializeCalls += 1;
      return this.getStatus();
    }

    this.#initialized = true;
    const hooks = this.#hooksAccessor();
    if (typeof hooks?.once !== "function") {
      this.#recordError(new Error("Foundry Hooks.once is unavailable; CAT provider registration hook could not be installed."));
      return this.getStatus();
    }

    hooks.once(CAT_READY_HOOK, () => this.#handleCatReady());
    this.#hookRegistered = true;
    Logger.info(`CAT automation-provider hook registered for '${CAT_READY_HOOK}'.`);
    return this.getStatus();
  }

  getStatus() {
    const catModule = getCatModule();
    const cat = this.#catAccessor();
    const api = cat?.api ?? null;
    const capabilities = Object.fromEntries(
      REQUIRED_CAT_AUTOMATION_API.map((name) => [name, Boolean(catModule?.active) && typeof api?.[name] === "function"])
    );
    const registeredAutomationCount = countRegisteredAutomations(cat);

    return {
      initialized: this.#initialized,
      hookRegistered: this.#hookRegistered,
      catReadyObserved: this.#catReadyObserved,
      cat: {
        installed: Boolean(catModule),
        active: Boolean(catModule?.active),
        version: catModule?.version ?? null,
        minimumVersion: CAT_AUTOMATION_MINIMUM_VERSION,
        apiExposed: Boolean(api),
        capabilities
      },
      source: {
        id: CAT_AUTOMATION_SOURCE_ID,
        name: CAT_AUTOMATION_SOURCE_NAME,
        registrationAttempted: this.#sourceRegistrationAttempted,
        registered: this.#sourceRegistered,
        verified: this.#sourceVerified,
        verificationMethod: this.#verificationMethod
      },
      automationsRegistered: registeredAutomationCount,
      stage: "source-foundation",
      lastError: this.#lastError ? { name: this.#lastError.name, message: this.#lastError.message } : null
    };
  }

  getStats() {
    return {
      ...this.#stats,
      status: this.getStatus()
    };
  }

  #handleCatReady() {
    this.#catReadyObserved = true;
    this.#stats.catReadyEvents += 1;
    this.#registerSource();
  }

  #registerSource() {
    if (this.#sourceRegistered) return true;

    this.#sourceRegistrationAttempted = true;
    this.#stats.sourceRegistrationAttempts += 1;

    try {
      const cat = this.#catAccessor();
      const registerSourceName = cat?.api?.registerSourceName;
      if (typeof registerSourceName !== "function") {
        throw new Error("CAT api.registerSourceName is unavailable after catReady.");
      }

      registerSourceName(CAT_AUTOMATION_SOURCE_ID, CAT_AUTOMATION_SOURCE_NAME);
      this.#sourceRegistered = true;
      this.#stats.sourceRegistrations += 1;

      const registry = automationRegistry(cat);
      const getSourceName = registry?.getSourceName;
      if (typeof getSourceName === "function") {
        const registeredName = getSourceName.call(registry, CAT_AUTOMATION_SOURCE_ID);
        this.#sourceVerified = registeredName === CAT_AUTOMATION_SOURCE_NAME;
        this.#verificationMethod = "cat-registry";
      } else {
        // Registration went through CAT's public API; current CAT also exposes
        // registry introspection, but AE5E does not require that private detail.
        this.#sourceVerified = true;
        this.#verificationMethod = "api-call";
      }

      Logger.info(`Registered CAT automation source '${CAT_AUTOMATION_SOURCE_NAME}'.`);
      return true;
    } catch (error) {
      this.#stats.sourceRegistrationErrors += 1;
      this.#recordError(error);
      return false;
    }
  }

  #recordError(error) {
    this.#lastError = error instanceof Error ? error : new Error(String(error));
    Logger.error("CAT automation-provider registration failed.", this.#lastError);
  }
}
