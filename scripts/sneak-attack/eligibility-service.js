function snapshotEntry(entry) {
  return {
    declarationId: entry?.declaration?.id ?? null,
    declarationType: entry?.declaration?.type ?? null,
    sourceItemUuid: entry?.provenance?.sourceItem?.uuid ?? null,
    sourceItemIdentifier: entry?.provenance?.sourceItemIdentifier ?? null
  };
}

function transactionContext(context = {}, entry = null) {
  const transaction = context?.transaction ?? {};
  return {
    family: "sneakAttack",
    hook: context?.hook ?? "sneakAttack",
    transactionId: transaction?.id ?? context?.transactionId ?? null,
    parentWorkflowId: context?.parentWorkflow?.id ?? context?.parentWorkflowId ?? null,
    parentActivityUuid: context?.parentWorkflow?.activity?.uuid ?? context?.parentActivityUuid ?? null,
    sneakTargetUuid: transaction?.sneakTargetUuid ?? transaction?.targetUuid ?? context?.targetUuid ?? context?.sneakTargetUuid ?? null,
    declaration: snapshotEntry(entry)
  };
}

/**
 * Generic declaration eligibility service. Feature-specific rules remain in
 * declaration.condition and are evaluated only by AC5E.
 */
export class SneakAttackEligibilityService {
  #ac5e;
  #stats = {
    evaluations: 0,
    unconditional: 0,
    eligible: 0,
    ineligible: 0,
    errors: 0
  };

  constructor({ ac5e }) {
    this.#ac5e = ac5e;
  }

  evaluate(entry, context = {}) {
    this.#stats.evaluations += 1;
    const declaration = entry?.declaration ?? null;
    if (!declaration) {
      this.#stats.errors += 1;
      this.#stats.ineligible += 1;
      return {
        ok: false,
        eligible: false,
        reason: "missing-declaration",
        entry,
        diagnostic: {
          severity: "error",
          code: "missing-declaration",
          message: "Eligibility evaluation requires a compiled declaration entry."
        }
      };
    }

    const expression = typeof declaration.condition === "string"
      ? declaration.condition.trim()
      : "";
    if (!expression) {
      this.#stats.unconditional += 1;
      this.#stats.eligible += 1;
      return {
        ok: true,
        eligible: true,
        reason: "no-condition",
        entry,
        expression: "",
        diagnostic: null
      };
    }

    const activity = context?.activity ?? context?.parentWorkflow?.activity ?? null;
    const item = context?.item ?? activity?.item ?? context?.parentWorkflow?.item ?? null;
    const result = this.#ac5e.evaluateCondition({
      expression,
      subjectToken: context?.subjectToken ?? null,
      opponentToken: context?.opponentToken ?? null,
      activity,
      item,
      options: context?.ac5eOptions ?? {},
      context: transactionContext(context, entry),
      debug: Boolean(context?.debug)
    });

    if (result.eligible) this.#stats.eligible += 1;
    else this.#stats.ineligible += 1;
    if (!result.ok) this.#stats.errors += 1;

    return {
      ...result,
      entry,
      diagnostic: result.ok
        ? null
        : {
            severity: "error",
            code: result.reason ?? "condition-evaluation-error",
            message: `Could not safely evaluate eligibility for declaration '${declaration.id ?? "unknown"}'.`,
            declarationId: declaration.id ?? null,
            sourceItemUuid: entry?.provenance?.sourceItem?.uuid ?? null,
            sourceItemIdentifier: entry?.provenance?.sourceItemIdentifier ?? null,
            expression
          }
    };
  }

  evaluateAll(entries, context = {}) {
    const results = (Array.isArray(entries) ? entries : []).map(entry => this.evaluate(entry, context));
    return {
      ok: results.every(result => result.ok),
      results,
      eligible: results.filter(result => result.eligible).map(result => result.entry),
      ineligible: results.filter(result => !result.eligible).map(result => result.entry),
      diagnostics: results.map(result => result.diagnostic).filter(Boolean)
    };
  }

  getStatus() {
    return Object.freeze({ ac5e: this.#ac5e.getStatus() });
  }

  getStats() {
    return Object.freeze({ ...this.#stats, ac5e: this.#ac5e.getStats() });
  }
}
