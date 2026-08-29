import { MODULE_ID, MODULE_TITLE } from "../core/constants.js";
import { Logger } from "../core/logger.js";
import {
  CAT_PUBLIC_AUTOMATION_PACK_IDS,
  isValidAutomationVersion
} from "../authoring/cat-metadata-authoring-service.js";

export const CAT_AUTOMATION_MODULE_ID = "cat";
export const CAT_AUTOMATION_MINIMUM_VERSION = "0.0.8";
export const CAT_READY_HOOK = "catReady";
export const CAT_AUTOMATION_SOURCE_ID = MODULE_ID;
export const CAT_AUTOMATION_SOURCE_NAME = MODULE_TITLE;

const CAT_AUTOMATION_INDEX_FIELDS = Object.freeze([
  "system.identifier",
  "system.source.rules",
  "flags.cat.automation.source",
  "flags.cat.automation.version",
  "type"
]);

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

function defaultPacksAccessor() {
  return globalThis.game?.packs ?? null;
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

function packLabel(pack) {
  return pack?.metadata?.label ?? pack?.title ?? packId(pack) ?? "Unknown Pack";
}

function indexEntryIssues(document) {
  const issues = [];
  const identifier = String(document?.system?.identifier ?? "").trim();
  const rules = String(document?.system?.source?.rules ?? "").trim();
  const type = String(document?.type ?? "").trim();
  const source = document?.flags?.cat?.automation?.source ?? null;
  const version = document?.flags?.cat?.automation?.version ?? null;

  if (!identifier) issues.push("Missing system.identifier.");
  if (rules !== "2014" && rules !== "2024") issues.push("system.source.rules must be 2014 or 2024.");
  if (!type) issues.push("Missing Item type.");
  if (source !== CAT_AUTOMATION_SOURCE_ID) {
    issues.push(source
      ? `Unexpected CAT automation source: ${source}.`
      : "Missing flags.cat.automation.source.");
  }
  if (!isValidAutomationVersion(version)) {
    issues.push(version
      ? `Invalid CAT automation version: ${version}.`
      : "Missing flags.cat.automation.version.");
  }

  return {
    id: document?.id ?? document?._id ?? null,
    uuid: document?.uuid ?? null,
    name: document?.name ?? null,
    identifier,
    rules,
    type,
    source,
    version,
    valid: issues.length === 0,
    issues
  };
}

/**
 * CAT automation-provider registration boundary.
 *
 * AE5E registers one provider source and then evaluates only the explicit
 * public-compendium allowlist. A pack is registered through CAT's public
 * registerAutomationCompendium() API only when every Item in that non-empty
 * pack carries valid AE5E CAT source/version metadata plus the required
 * identifier/rules/type fields. This fail-closed pack gate prevents CAT from
 * silently publishing an unfinished Item at CAT's fallback version "0".
 * Internal packs such as AE5E Administrative never enter the allowlist.
 */
export class CatAutomationRegistry {
  #catAccessor;
  #hooksAccessor;
  #packsAccessor;
  #publicPackIds;
  #initialized = false;
  #hookRegistered = false;
  #catReadyObserved = false;
  #sourceRegistrationAttempted = false;
  #sourceRegistered = false;
  #sourceVerified = false;
  #verificationMethod = "none";
  #publicRegistrationStarted = false;
  #publicRegistrationComplete = false;
  #registeredPacks = [];
  #deferredPacks = [];
  #emptyPacks = [];
  #missingPacks = [];
  #failedPacks = [];
  #lastError = null;
  #stats = {
    initializeCalls: 0,
    duplicateInitializeCalls: 0,
    catReadyEvents: 0,
    sourceRegistrationAttempts: 0,
    sourceRegistrations: 0,
    sourceRegistrationErrors: 0,
    publicRegistrationRuns: 0,
    publicRegistrationRefreshes: 0,
    publicRegistrationRefreshErrors: 0,
    publicRegistrationReconciliations: 0,
    publicRegistrationReconciliationRepairs: 0,
    publicRegistrationReconciliationErrors: 0,
    packReadinessChecks: 0,
    packRegistrationAttempts: 0,
    packRegistrations: 0,
    packRegistrationErrors: 0,
    itemRegistrations: 0,
    deferredPacks: 0,
    emptyPacks: 0,
    missingPacks: 0
  };

  constructor({
    catAccessor = defaultCatAccessor,
    hooksAccessor = defaultHooksAccessor,
    packsAccessor = defaultPacksAccessor,
    publicPackIds = CAT_PUBLIC_AUTOMATION_PACK_IDS
  } = {}) {
    this.#catAccessor = typeof catAccessor === "function" ? catAccessor : defaultCatAccessor;
    this.#hooksAccessor = typeof hooksAccessor === "function" ? hooksAccessor : defaultHooksAccessor;
    this.#packsAccessor = typeof packsAccessor === "function" ? packsAccessor : defaultPacksAccessor;
    this.#publicPackIds = Object.freeze([...publicPackIds]);
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

    let stage = "waiting-cat";
    if (this.#catReadyObserved) stage = "source-registration";
    if (this.#sourceRegistered) stage = "public-registration-pending";
    if (this.#publicRegistrationComplete) stage = this.#lastError ? "public-registration-error" : "public-compendiums";

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
      publicRegistration: {
        started: this.#publicRegistrationStarted,
        complete: this.#publicRegistrationComplete,
        allowlist: [...this.#publicPackIds],
        registeredPacks: this.#registeredPacks.map((entry) => ({ ...entry })),
        deferredPacks: this.#deferredPacks.map((entry) => ({
          ...entry,
          invalidItems: entry.invalidItems.map((item) => ({ ...item, issues: [...item.issues] }))
        })),
        emptyPacks: this.#emptyPacks.map((entry) => ({ ...entry })),
        missingPacks: [...this.#missingPacks],
        failedPacks: this.#failedPacks.map((entry) => ({ ...entry }))
      },
      automationsRegistered: registeredAutomationCount,
      stage,
      lastError: this.#lastError ? { name: this.#lastError.name, message: this.#lastError.message } : null
    };
  }

  getStats() {
    return {
      ...this.#stats,
      status: this.getStatus()
    };
  }

  async refreshPublicCompendiums() {
    if (!this.#catReadyObserved || !this.#sourceRegistered) {
      throw new Error("CAT public-compendium registration cannot refresh before catReady source registration completes.");
    }

    this.#stats.publicRegistrationRefreshes += 1;
    try {
      const cat = this.#catAccessor();
      const registry = automationRegistry(cat);
      if (typeof registry?.unregisterAutomationsBySource === "function") {
        registry.unregisterAutomationsBySource(CAT_AUTOMATION_SOURCE_ID);
      }

      this.#publicRegistrationStarted = false;
      this.#publicRegistrationComplete = false;
      this.#registeredPacks = [];
      this.#deferredPacks = [];
      this.#emptyPacks = [];
      this.#missingPacks = [];
      this.#failedPacks = [];
      this.#lastError = null;

      return await this.#registerPublicCompendiums();
    } catch (error) {
      this.#stats.publicRegistrationRefreshErrors += 1;
      this.#recordError(error);
      throw error;
    }
  }

  /**
   * Reconcile AE5E's cached publication state with CAT's live automation registry.
   *
   * CAT's registry is runtime state. Another CAT lifecycle operation can clear a
   * provider's registered Automation objects without changing AE5E's cached
   * pack-readiness result. When that happens, refresh the approved public packs
   * from their canonical Item metadata rather than requiring a module reload.
   */
  async reconcilePublicCompendiums() {
    if (!this.#catReadyObserved || !this.#sourceRegistered) {
      throw new Error("CAT public-compendium registration cannot reconcile before catReady source registration completes.");
    }

    this.#stats.publicRegistrationReconciliations += 1;
    try {
      const expected = this.#registeredPacks.reduce(
        (total, entry) => total + (Number(entry?.registered) || 0),
        0
      );
      const actual = countRegisteredAutomations(this.#catAccessor());
      const drifted = this.#publicRegistrationComplete
        && expected > 0
        && Number.isFinite(actual)
        && actual < expected;

      if (!drifted) {
        return {
          repaired: false,
          expected,
          actual,
          status: this.getStatus()
        };
      }

      this.#stats.publicRegistrationReconciliationRepairs += 1;
      Logger.warn(
        `CAT automation registry drift detected for AE5E (${actual}/${expected} published automation(s) present); refreshing public compendiums.`
      );
      const status = await this.refreshPublicCompendiums();
      return {
        repaired: true,
        expected,
        actualBefore: actual,
        actualAfter: countRegisteredAutomations(this.#catAccessor()),
        status
      };
    } catch (error) {
      this.#stats.publicRegistrationReconciliationErrors += 1;
      this.#recordError(error);
      throw error;
    }
  }

  async #handleCatReady() {
    this.#catReadyObserved = true;
    this.#stats.catReadyEvents += 1;
    if (!this.#registerSource()) return this.getStatus();
    await this.#registerPublicCompendiums();
    return this.getStatus();
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

  async #registerPublicCompendiums() {
    if (this.#publicRegistrationComplete || this.#publicRegistrationStarted) return this.getStatus();

    this.#publicRegistrationStarted = true;
    this.#stats.publicRegistrationRuns += 1;

    const cat = this.#catAccessor();
    const registerAutomationCompendium = cat?.api?.registerAutomationCompendium;
    if (typeof registerAutomationCompendium !== "function") {
      this.#stats.packRegistrationErrors += 1;
      this.#publicRegistrationComplete = true;
      this.#recordError(new Error("CAT api.registerAutomationCompendium is unavailable after catReady."));
      return this.getStatus();
    }

    const packs = this.#packsAccessor();

    for (const id of this.#publicPackIds) {
      const pack = packs?.get?.(id) ?? collectionValues(packs).find((candidate) => packId(candidate) === id) ?? null;
      if (!pack) {
        this.#missingPacks.push(id);
        this.#stats.missingPacks += 1;
        continue;
      }

      try {
        this.#stats.packReadinessChecks += 1;
        const index = await pack.getIndex({ fields: [...CAT_AUTOMATION_INDEX_FIELDS] });
        const entries = collectionValues(index);

        if (!entries.length) {
          this.#emptyPacks.push({ id, label: packLabel(pack), total: 0 });
          this.#stats.emptyPacks += 1;
          continue;
        }

        const audited = entries.map((entry) => indexEntryIssues(entry));
        const invalidItems = audited.filter((entry) => !entry.valid);
        if (invalidItems.length) {
          this.#deferredPacks.push({
            id,
            label: packLabel(pack),
            total: audited.length,
            ready: audited.length - invalidItems.length,
            invalid: invalidItems.length,
            invalidItems
          });
          this.#stats.deferredPacks += 1;
          Logger.info(`Deferred CAT automation pack '${id}' because ${invalidItems.length}/${audited.length} Item(s) are not CAT-authored yet.`);
          continue;
        }

        this.#stats.packRegistrationAttempts += 1;
        const results = await registerAutomationCompendium.call(cat.api, pack, {
          source: CAT_AUTOMATION_SOURCE_ID
        });
        const normalizedResults = Array.isArray(results) ? results : [];
        const success = normalizedResults.length === audited.length && normalizedResults.every((result) => result === true);
        if (!success) {
          throw new Error(`CAT registration for '${id}' returned ${normalizedResults.filter((result) => result === true).length}/${audited.length} successful Item registration(s).`);
        }

        this.#registeredPacks.push({
          id,
          label: packLabel(pack),
          total: audited.length,
          registered: normalizedResults.length
        });
        this.#stats.packRegistrations += 1;
        this.#stats.itemRegistrations += normalizedResults.length;
        Logger.info(`Registered ${normalizedResults.length} CAT automation(s) from '${id}'.`);
      } catch (error) {
        this.#stats.packRegistrationErrors += 1;
        this.#failedPacks.push({
          id,
          label: packLabel(pack),
          message: error?.message ?? String(error)
        });
        if (!this.#lastError) this.#recordError(error);
        else Logger.error(`CAT automation pack registration failed for '${id}'.`, error);
      }
    }

    this.#publicRegistrationComplete = true;
    return this.getStatus();
  }

  #recordError(error) {
    this.#lastError = error instanceof Error ? error : new Error(String(error));
    Logger.error("CAT automation-provider registration failed.", this.#lastError);
  }
}
