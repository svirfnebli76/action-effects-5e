import {
  ANIMATION_AUTOMATED_ANIMATIONS_POLICIES,
  AUTOMATED_ANIMATIONS_MODULE_ID,
  AUTOMATED_ANIMATIONS_WORKFLOW_START_HOOK
} from "../core/constants.js";
import { Logger } from "../core/logger.js";

export class AutomatedAnimationsAdapter {
  #ownership;
  #initialized = false;
  #hookId = null;
  #stats = {
    workflowsSeen: 0,
    synchronousSuppressions: 0,
    deferredChecks: 0,
    deferredSuppressions: 0
  };

  constructor({ ownership }) {
    this.#ownership = ownership;
  }

  initialize() {
    if (this.#initialized) return;
    this.#initialized = true;

    if (!globalThis.Hooks?.on) return;
    this.#hookId = Hooks.on(
      AUTOMATED_ANIMATIONS_WORKFLOW_START_HOOK,
      (clonedData, animationData) => this.processWorkflowStart(clonedData, animationData)
    );
  }

  processWorkflowStart(clonedData, animationData = null) {
    if (!clonedData || typeof clonedData !== "object") return null;
    this.#stats.workflowsSeen += 1;

    // Most ownership decisions, including transient workflow claims and
    // same-Actor child status inheritance, are available synchronously.
    // Setting stopWorkflow immediately also retains compatibility with older
    // AA releases that do not await deferrals.
    const immediate = this.#ownership.resolveAutomatedAnimationsPolicySync(clonedData, { context: animationData });
    if (immediate.suppress) {
      clonedData.stopWorkflow = true;
      this.#stats.synchronousSuppressions += 1;
      this.#annotate(clonedData, immediate);
      Logger.debug("Suppressing Automated Animations workflow.", this.#diagnostic(immediate, clonedData));
      return immediate;
    }

    // AA 7.0.22+ explicitly awaits clonedData.deferrals before it checks
    // clonedData.stopWorkflow. Use that supported seam for UUID-origin lookups
    // or future ownership decisions that require asynchronous work.
    clonedData.deferrals ??= [];
    if (!Array.isArray(clonedData.deferrals)) return immediate;

    const deferred = this.#resolveDeferred(clonedData, animationData);
    clonedData.deferrals.push(deferred);
    this.#stats.deferredChecks += 1;
    return deferred;
  }

  getStatus() {
    let module = null;
    try {
      module = globalThis.game?.modules?.get?.(AUTOMATED_ANIMATIONS_MODULE_ID) ?? null;
    } catch {
      module = null;
    }
    return {
      initialized: this.#initialized,
      hookRegistered: this.#hookId != null,
      moduleId: AUTOMATED_ANIMATIONS_MODULE_ID,
      installed: Boolean(module),
      active: Boolean(module?.active),
      version: module?.version ?? module?.manifest?.version ?? null,
      workflowStartHook: AUTOMATED_ANIMATIONS_WORKFLOW_START_HOOK
    };
  }

  getStats() {
    return {
      ...this.#stats,
      status: this.getStatus()
    };
  }

  async #resolveDeferred(clonedData, animationData = null) {
    const decision = await this.#ownership.resolveAutomatedAnimationsPolicy(clonedData, { context: animationData });
    if (decision.policy !== ANIMATION_AUTOMATED_ANIMATIONS_POLICIES.SUPPRESS) return decision;

    clonedData.stopWorkflow = true;
    this.#stats.deferredSuppressions += 1;
    this.#annotate(clonedData, decision);
    Logger.debug("Suppressing Automated Animations workflow after deferred ownership resolution.", this.#diagnostic(decision, clonedData));
    return decision;
  }

  #annotate(clonedData, decision) {
    clonedData.actionEffects5e ??= {};
    clonedData.actionEffects5e.animationOwnership = {
      automatedAnimations: decision.policy,
      relation: decision.relation,
      sourceUuid: decision.sourceUuid,
      sourceLabel: decision.sourceLabel,
      inheritedByStatuses: decision.inheritedByStatuses ?? [],
      transient: decision.transient === true,
      claimId: decision.claimId ?? null,
      reason: decision.reason ?? null
    };
  }

  #diagnostic(decision, clonedData) {
    return {
      item: clonedData?.item?.name ?? clonedData?.item?.label ?? clonedData?.item?.uuid ?? null,
      activity: clonedData?.activity?.name ?? clonedData?.activity?.label ?? clonedData?.activity?.uuid ?? null,
      policy: decision.policy,
      relation: decision.relation,
      sourceUuid: decision.sourceUuid,
      sourceLabel: decision.sourceLabel,
      transient: decision.transient === true,
      claimId: decision.claimId ?? null,
      reason: decision.reason ?? null,
      inheritedByStatuses: decision.inheritedByStatuses ?? []
    };
  }
}
