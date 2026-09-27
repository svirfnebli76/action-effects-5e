import { MODULE_ID } from "../core/constants.js";

/**
 * Narrow facade around CAT's automation-provider selection API.
 *
 * This adapter is intentionally read-only. Runtime Sneak Attack processing may
 * inspect CAT's current provider, but must never rewrite provider selection in
 * the middle of a workflow.
 */
export class CatAutomationProviderAdapter {
  #catAccessor;
  #moduleAccessor;
  #stats = {
    currentAutomationCalls: 0,
    ae5eOwnershipChecks: 0,
    unavailable: 0,
    errors: 0
  };

  constructor({
    catAccessor = () => globalThis.cat ?? null,
    moduleAccessor = () => globalThis.game?.modules?.get?.("cat") ?? null
  } = {}) {
    this.#catAccessor = catAccessor;
    this.#moduleAccessor = moduleAccessor;
  }

  getStatus() {
    const module = this.#moduleAccessor?.() ?? null;
    const cat = this.#catAccessor?.() ?? null;
    const getCurrentAutomation = cat?.utils?.automationUtils?.getCurrentAutomation;
    return {
      installed: Boolean(module),
      active: Boolean(module?.active),
      version: module?.version ?? null,
      apiExposed: Boolean(cat),
      capabilities: {
        getCurrentAutomation: Boolean(module?.active) && typeof getCurrentAutomation === "function"
      },
      strategy: "Read CAT's current Item automation provider without mutating provider selection."
    };
  }

  getStats() {
    return Object.freeze({ ...this.#stats, status: this.getStatus() });
  }

  getCurrentAutomation(item) {
    this.#stats.currentAutomationCalls += 1;
    const status = this.getStatus();
    if (!status.capabilities.getCurrentAutomation) {
      this.#stats.unavailable += 1;
      return {
        available: false,
        automation: null,
        source: null,
        reason: "cat-get-current-automation-unavailable"
      };
    }

    try {
      const automation = this.#catAccessor().utils.automationUtils.getCurrentAutomation(item) ?? null;
      return {
        available: true,
        automation,
        source: automation?.source ?? null,
        reason: automation ? null : "no-current-automation"
      };
    } catch (error) {
      this.#stats.errors += 1;
      return {
        available: true,
        automation: null,
        source: null,
        reason: "cat-get-current-automation-error",
        error
      };
    }
  }

  getProviderState(item, { expectedSource = MODULE_ID } = {}) {
    this.#stats.ae5eOwnershipChecks += 1;
    const current = this.getCurrentAutomation(item);
    return {
      ...current,
      expectedSource,
      matchesExpectedSource: Boolean(current.automation && current.source === expectedSource)
    };
  }
}
