import { MODULE_ID, MODULE_VERSION } from "../core/constants.js";
import {
  CAT_AUTOMATION_MINIMUM_VERSION,
  CAT_AUTOMATION_MODULE_ID,
  CAT_AUTOMATION_SOURCE_ID,
  CAT_AUTOMATION_SOURCE_NAME
} from "../integrations/cat-automation-registry.js";

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

export class CatIntegrationTestSuite {
  #registry;
  #dependencies;

  constructor({ registry, dependencies }) {
    this.#registry = registry;
    this.#dependencies = dependencies;
  }

  async runFoundationTest({ notify = true, readyTimeoutMs = 5000 } = {}) {
    const checks = [];
    const record = (name, passed, details = null) => checks.push({ name, passed: Boolean(passed), details });

    const ae5eModule = globalThis.game?.modules?.get?.(MODULE_ID) ?? null;
    const catModule = globalThis.game?.modules?.get?.(CAT_AUTOMATION_MODULE_ID) ?? null;

    const deadline = Date.now() + Math.max(0, Number(readyTimeoutMs) || 0);
    let status = this.#registry.getStatus();
    while (!status.catReadyObserved && Date.now() < deadline) {
      await wait(100);
      status = this.#registry.getStatus();
    }

    const requiredRelationships = manifestRequires(ae5eModule);
    const catRelationship = requiredRelationships.find(entry => (entry?.id ?? entry) === CAT_AUTOMATION_MODULE_ID) ?? null;
    const dependencyStatus = this.#dependencies.getStatus();
    const catDependency = dependencyStatus.required.find(entry => entry.id === CAT_AUTOMATION_MODULE_ID) ?? null;

    record("AE5E v0.4.2.1 runtime is loaded", ae5eModule?.version === MODULE_VERSION && MODULE_VERSION === "0.4.2.1", {
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
    record("No AE5E Item automations are registered in the foundation release", status.automationsRegistered === 0, {
      automationsRegistered: status.automationsRegistered,
      stage: status.stage
    });
    record("CAT provider integration has no recorded error", status.lastError === null, status.lastError);

    const beforeDuplicate = this.#registry.getStats();
    this.#registry.initialize();
    const afterDuplicate = this.#registry.getStats();
    record("Duplicate initialization is idempotent", afterDuplicate.duplicateInitializeCalls === beforeDuplicate.duplicateInitializeCalls + 1
      && afterDuplicate.sourceRegistrationAttempts === beforeDuplicate.sourceRegistrationAttempts
      && afterDuplicate.status.source.registered === beforeDuplicate.status.source.registered, {
      before: beforeDuplicate,
      after: afterDuplicate
    });

    const passed = checks.every(check => check.passed);
    const result = {
      passed,
      checks,
      registration: this.#registry.getStatus(),
      dependencies: dependencyStatus
    };

    console.groupCollapsed(`AE5E ${MODULE_VERSION} CAT integration foundation: ${passed ? "PASS" : "FAIL"}`);
    console.table(checks.map(({ name, passed }) => ({ check: name, result: passed ? "PASS" : "FAIL" })));
    console.log(result);
    console.groupEnd();
    console.log(
      `%cAE5E ${MODULE_VERSION} — CAT INTEGRATION FOUNDATION — ${passed ? "PASS" : "FAIL"}`,
      `font-size:24px;font-weight:bold;color:${passed ? "#5cff8d" : "#ff5c5c"};`
    );

    if (notify && globalThis.ui?.notifications) {
      const count = checks.filter(check => check.passed).length;
      const message = `AE5E CAT integration foundation: ${count}/${checks.length} ${passed ? "PASS" : "FAIL"}`;
      if (passed) ui.notifications.info(message);
      else ui.notifications.error(message);
    }

    return result;
  }
}
