import { MODULE_ID, MODULE_VERSION } from "../core/constants.js";
import {
  CAT_AUTOMATION_MINIMUM_VERSION,
  CAT_AUTOMATION_MODULE_ID,
  CAT_AUTOMATION_SOURCE_ID,
  CAT_AUTOMATION_SOURCE_NAME
} from "../integrations/cat-automation-registry.js";
import {
  CAT_INTERNAL_PACK_IDS,
  CAT_PUBLIC_AUTOMATION_PACK_IDS,
  isValidAutomationVersion
} from "../authoring/cat-metadata-authoring-service.js";

function asArray(collection) {
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

function manifestRequires(module) {
  const live = asArray(module?.relationships?.requires);
  if (live.length) return live;
  try {
    return asArray(module?.toObject?.()?.relationships?.requires);
  } catch {
    return [];
  }
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function uuidBelongsToPack(uuid, packId) {
  return typeof uuid === "string" && uuid.startsWith(`Compendium.${packId}.Item.`);
}

export class CatIntegrationTestSuite {
  #registry;
  #dependencies;

  constructor({ registry, dependencies }) {
    this.#registry = registry;
    this.#dependencies = dependencies;
  }

  async runFoundationTest({ notify = true, readyTimeoutMs = 8000 } = {}) {
    const checks = [];
    const record = (name, passed, details = null) => checks.push({ name, passed: Boolean(passed), details });

    const ae5eModule = globalThis.game?.modules?.get?.(MODULE_ID) ?? null;
    const catModule = globalThis.game?.modules?.get?.(CAT_AUTOMATION_MODULE_ID) ?? null;

    const deadline = Date.now() + Math.max(0, Number(readyTimeoutMs) || 0);
    let status = this.#registry.getStatus();
    while ((!status.catReadyObserved || !status.publicRegistration?.complete) && Date.now() < deadline) {
      await wait(100);
      status = this.#registry.getStatus();
    }

    let reconciliation = null;
    if (status.catReadyObserved && status.source?.registered && status.publicRegistration?.complete) {
      try {
        reconciliation = await this.#registry.reconcilePublicCompendiums();
        status = this.#registry.getStatus();
      } catch (error) {
        reconciliation = {
          error: error?.message ?? String(error)
        };
      }
    }

    const requiredRelationships = manifestRequires(ae5eModule);
    const catRelationship = requiredRelationships.find(entry => (entry?.id ?? entry) === CAT_AUTOMATION_MODULE_ID) ?? null;
    const dependencyStatus = this.#dependencies.getStatus();
    const catDependency = dependencyStatus.required.find(entry => entry.id === CAT_AUTOMATION_MODULE_ID) ?? null;

    record("AE5E v0.4.3.1 runtime is loaded", ae5eModule?.version === MODULE_VERSION && MODULE_VERSION === "0.4.3.1", {
      moduleVersion: ae5eModule?.version ?? null,
      runtimeVersion: MODULE_VERSION
    });
    record("CAT is declared as a required module relationship", Boolean(catRelationship), catRelationship);
    record("CAT minimum compatibility is 0.0.8+", catRelationship?.compatibility?.minimum === CAT_AUTOMATION_MINIMUM_VERSION, catRelationship?.compatibility ?? null);
    record("AE5E dependency validation includes CAT", Boolean(catDependency), catDependency);
    record("CAT is installed and active", Boolean(catModule?.active), {
      installed: Boolean(catModule),
      active: Boolean(catModule?.active),
      version: catModule?.version ?? null
    });
    record("CAT provider integration initialized", status.initialized && status.hookRegistered, status);
    record("CAT catReady lifecycle was observed", status.catReadyObserved, status);
    record("CAT public API is exposed", status.cat.apiExposed, status.cat);

    const missingCapabilities = Object.entries(status.cat.capabilities)
      .filter(([, available]) => !available)
      .map(([name]) => name);
    record("CAT automation registration API surface is available", missingCapabilities.length === 0, {
      capabilities: status.cat.capabilities,
      missingCapabilities
    });

    record("AE5E source registration was attempted exactly once", this.#registry.getStats().sourceRegistrationAttempts === 1, this.#registry.getStats());
    record("Action Effects 5E source is registered", status.source.registered, status.source);
    record("CAT registry verifies the Action Effects 5E source name", status.source.verified
      && status.source.id === CAT_AUTOMATION_SOURCE_ID
      && status.source.name === CAT_AUTOMATION_SOURCE_NAME, status.source);

    const publicRegistration = status.publicRegistration ?? {};
    record("Permanent public-compendium registration completed", publicRegistration.started === true && publicRegistration.complete === true, publicRegistration);
    record("CAT live registry is reconciled with AE5E's published-pack state", !reconciliation?.error, reconciliation);
    record("Permanent registration uses the explicit public pack allowlist", JSON.stringify(publicRegistration.allowlist ?? []) === JSON.stringify(CAT_PUBLIC_AUTOMATION_PACK_IDS), {
      expected: CAT_PUBLIC_AUTOMATION_PACK_IDS,
      actual: publicRegistration.allowlist ?? []
    });
    record("AE5E Administrative remains excluded from CAT publication", CAT_INTERNAL_PACK_IDS.includes(`${MODULE_ID}.ae5e-administrative`)
      && !CAT_PUBLIC_AUTOMATION_PACK_IDS.includes(`${MODULE_ID}.ae5e-administrative`)
      && !(publicRegistration.registeredPacks ?? []).some(entry => entry.id === `${MODULE_ID}.ae5e-administrative`), {
      internalPacks: CAT_INTERNAL_PACK_IDS,
      registeredPacks: publicRegistration.registeredPacks ?? []
    });
    record("All configured public packs exist in the live module", (publicRegistration.missingPacks ?? []).length === 0, {
      missingPacks: publicRegistration.missingPacks ?? []
    });

    const catRegistry = globalThis.cat?.lib?.constants?.automations ?? null;
    const registeredAutomations = asArray(catRegistry?.automations)
      .map(entry => Array.isArray(entry) && entry.length === 2 ? entry[1] : entry)
      .filter(automation => automation?.source === CAT_AUTOMATION_SOURCE_ID);

    const registeredPackIds = new Set((publicRegistration.registeredPacks ?? []).map(entry => entry.id));
    record("Every published AE5E automation has an authored SemVer and belongs to a registered public pack", registeredAutomations.length > 0
      && registeredAutomations.every(automation => isValidAutomationVersion(automation.version)
        && [...registeredPackIds].some(packId => uuidBelongsToPack(automation.uuid, packId))), {
      automations: registeredAutomations.map(automation => ({
        identifier: automation.identifier,
        rules: automation.rules,
        version: automation.version,
        uuid: automation.uuid
      })),
      registeredPackIds: [...registeredPackIds]
    });

    record("Deferred packs are fail-closed instead of publishing fallback version 0", (publicRegistration.deferredPacks ?? []).every(pack => pack.invalid > 0
      && Array.isArray(pack.invalidItems)
      && pack.invalidItems.length === pack.invalid
      && !registeredAutomations.some(automation => uuidBelongsToPack(automation.uuid, pack.id))), {
      deferredPacks: publicRegistration.deferredPacks ?? []
    });

    const mistyStep = catRegistry?.getAutomationByIdentifier?.("misty-step", {
      source: CAT_AUTOMATION_SOURCE_ID,
      rules: "2014",
      type: "spell"
    }) ?? null;
    record("Canonical Misty Step is permanently registered from Level 2", Boolean(mistyStep)
      && mistyStep.version === "1.0.0"
      && mistyStep.uuid === "Compendium.action-effects-5e.spells-level-2.Item.pLcoNw3VnVbgzGU8"
      && registeredPackIds.has(`${MODULE_ID}.spells-level-2`), {
      automation: mistyStep ? {
        source: mistyStep.source,
        identifier: mistyStep.identifier,
        rules: mistyStep.rules,
        version: mistyStep.version,
        uuid: mistyStep.uuid,
        type: mistyStep.type
      } : null,
      registeredPacks: [...registeredPackIds]
    });

    record("No AE5E Administrative Item is registered as a CAT automation", !registeredAutomations.some(automation => uuidBelongsToPack(automation.uuid, `${MODULE_ID}.ae5e-administrative`)), {
      registeredCount: registeredAutomations.length
    });
    record("CAT provider integration has no recorded error", status.lastError === null, status.lastError);

    const beforeDuplicate = this.#registry.getStats();
    this.#registry.initialize();
    const afterDuplicate = this.#registry.getStats();
    record("Duplicate initialization is idempotent", afterDuplicate.duplicateInitializeCalls === beforeDuplicate.duplicateInitializeCalls + 1
      && afterDuplicate.sourceRegistrationAttempts === beforeDuplicate.sourceRegistrationAttempts
      && afterDuplicate.publicRegistrationRuns === beforeDuplicate.publicRegistrationRuns
      && afterDuplicate.packRegistrationAttempts === beforeDuplicate.packRegistrationAttempts
      && afterDuplicate.status.source.registered === beforeDuplicate.status.source.registered, {
      before: beforeDuplicate,
      after: afterDuplicate
    });

    const passed = checks.every(check => check.passed);
    const result = {
      passed,
      checks,
      registration: this.#registry.getStatus(),
      dependencies: dependencyStatus,
      registeredAutomations: registeredAutomations.map(automation => ({
        source: automation.source,
        identifier: automation.identifier,
        rules: automation.rules,
        version: automation.version,
        uuid: automation.uuid,
        type: automation.type
      }))
    };

    console.groupCollapsed(`AE5E ${MODULE_VERSION} CAT integration: ${passed ? "PASS" : "FAIL"}`);
    console.table(checks.map(({ name, passed }) => ({ check: name, result: passed ? "PASS" : "FAIL" })));
    console.log(result);
    console.groupEnd();
    console.log(
      `%cAE5E ${MODULE_VERSION} — CAT PUBLIC REGISTRATION — ${passed ? "PASS" : "FAIL"}`,
      `font-size:24px;font-weight:bold;color:${passed ? "#5cff8d" : "#ff5c5c"};`
    );

    if (notify && globalThis.ui?.notifications) {
      const count = checks.filter(check => check.passed).length;
      const message = `AE5E CAT public registration: ${count}/${checks.length} ${passed ? "PASS" : "FAIL"}`;
      if (passed) ui.notifications.info(message);
      else ui.notifications.error(message);
    }

    return result;
  }
}
