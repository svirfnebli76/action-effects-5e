const AC5E_MODULE_ID = "automated-conditions-5e";

function clonePlain(value) {
  if (value === undefined) return undefined;
  try {
    if (globalThis.foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
    if (globalThis.structuredClone) return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

/**
 * Narrow facade over AC5E's public evaluation helpers.
 *
 * AE5E does not parse or execute declaration conditions itself. AC5E builds
 * the normal evaluation sandbox and safely evaluates the expression; AE5E
 * only supplies the Sneak Attack transaction context and interprets the
 * resulting condition as eligible/ineligible.
 */
export class Ac5eEligibilityAdapter {
  #ac5eAccessor;
  #moduleAccessor;
  #stats = {
    sandboxBuilds: 0,
    evaluations: 0,
    trueResults: 0,
    falseResults: 0,
    unavailable: 0,
    errors: 0,
    lastError: null
  };

  constructor({
    ac5eAccessor = () => globalThis.ac5e ?? null,
    moduleAccessor = () => globalThis.game?.modules?.get?.(AC5E_MODULE_ID) ?? null
  } = {}) {
    this.#ac5eAccessor = ac5eAccessor;
    this.#moduleAccessor = moduleAccessor;
  }

  getStatus() {
    const module = this.#moduleAccessor?.() ?? null;
    const ac5e = this.#ac5eAccessor?.() ?? null;
    return Object.freeze({
      installed: Boolean(module),
      active: Boolean(module?.active),
      version: module?.version ?? null,
      apiExposed: Boolean(ac5e),
      capabilities: Object.freeze({
        evaluationData: Boolean(module?.active) && typeof ac5e?.evaluationData === "function",
        safeEval: Boolean(module?.active) && typeof ac5e?.safeEval === "function",
        getItem: Boolean(module?.active) && typeof ac5e?.getItem === "function",
        getItems: Boolean(module?.active) && typeof ac5e?.getItems === "function",
        hasItem: Boolean(module?.active) && typeof ac5e?.hasItem === "function"
      })
    });
  }

  getStats() {
    return Object.freeze({ ...this.#stats, status: this.getStatus() });
  }

  buildSandbox({ subjectToken, opponentToken, activity = null, item = null, options = {}, context = {} } = {}) {
    this.#stats.sandboxBuilds += 1;
    const status = this.getStatus();
    if (!status.capabilities.evaluationData) {
      this.#stats.unavailable += 1;
      return { ok: false, reason: "ac5e-evaluation-data-unavailable", sandbox: null };
    }

    try {
      const ac5e = this.#ac5eAccessor();
      const evaluationOptions = {
        ...(options && typeof options === "object" ? options : {}),
        ...(activity ? { activity } : {}),
        ...(item ? { item } : {})
      };
      const baseSandbox = ac5e.evaluationData({ subjectToken, opponentToken, options: evaluationOptions });
      if (!baseSandbox || typeof baseSandbox !== "object") {
        return { ok: false, reason: "ac5e-evaluation-data-empty", sandbox: null };
      }

      // AC5E owns the normal evaluation namespace. Extend it through the
      // prototype rather than mutating AC5E's object, mirroring AC5E's own
      // integration pattern for layered evaluation data.
      const sandbox = Object.create(baseSandbox);
      sandbox.ae5e = clonePlain(context && typeof context === "object" ? context : {});
      return { ok: true, reason: null, sandbox };
    } catch (error) {
      this.#recordError(error);
      return { ok: false, reason: "ac5e-evaluation-data-error", sandbox: null, error };
    }
  }

  evaluateCondition({ expression, subjectToken, opponentToken, activity = null, item = null, options = {}, context = {}, debug = false } = {}) {
    this.#stats.evaluations += 1;
    const normalizedExpression = typeof expression === "string" ? expression.trim() : "";
    if (!normalizedExpression) {
      this.#stats.trueResults += 1;
      return {
        ok: true,
        eligible: true,
        reason: "no-condition",
        expression: normalizedExpression,
        result: true,
        sandbox: null
      };
    }

    const status = this.getStatus();
    if (!status.capabilities.safeEval) {
      this.#stats.unavailable += 1;
      this.#stats.falseResults += 1;
      return {
        ok: false,
        eligible: false,
        reason: "ac5e-safe-eval-unavailable",
        expression: normalizedExpression,
        result: null,
        sandbox: null
      };
    }

    const built = this.buildSandbox({ subjectToken, opponentToken, activity, item, options, context });
    if (!built.ok) {
      this.#stats.falseResults += 1;
      return {
        ok: false,
        eligible: false,
        reason: built.reason,
        expression: normalizedExpression,
        result: null,
        sandbox: null,
        error: built.error ?? null
      };
    }

    try {
      const ac5e = this.#ac5eAccessor();
      const raw = ac5e.safeEval({
        expression: normalizedExpression,
        sandbox: built.sandbox,
        mode: "condition",
        debug
      });
      const eligible = Boolean(raw);
      if (eligible) this.#stats.trueResults += 1;
      else this.#stats.falseResults += 1;
      return {
        ok: true,
        eligible,
        reason: eligible ? null : "condition-false",
        expression: normalizedExpression,
        result: raw,
        sandbox: built.sandbox
      };
    } catch (error) {
      this.#recordError(error);
      this.#stats.falseResults += 1;
      return {
        ok: false,
        eligible: false,
        reason: "ac5e-condition-evaluation-error",
        expression: normalizedExpression,
        result: null,
        sandbox: built.sandbox,
        error
      };
    }
  }

  #recordError(error) {
    this.#stats.errors += 1;
    this.#stats.lastError = {
      name: error?.name ?? "Error",
      message: error?.message ?? String(error)
    };
  }
}
