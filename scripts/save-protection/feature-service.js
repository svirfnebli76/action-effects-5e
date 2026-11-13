import { MODULE_ID } from "../core/constants.js";
import { CASTING_PHASES } from "../casting/casting-phase-service.js";
import { duplicateSafely } from "../core/utils.js";
import { Logger } from "../core/logger.js";

const clone = value => duplicateSafely(value);
const isActivityOverTime = workflow => Boolean(workflow?.workflowOptions?.overTimeEffectUuid);

/** Coordinates Item-owned, resource-free save-protection features. */
export class SaveProtectionFeatureService {
  #phases;
  #declarations;
  #executors;
  #applications;
  #unregister = null;
  #recent = [];

  constructor({ phases, declarations, executors, applications }) {
    this.#phases = phases;
    this.#declarations = declarations;
    this.#executors = executors;
    this.#applications = applications;
  }

  initialize() {
    if (this.#unregister) return;
    this.#unregister = this.#phases.register("save-protection-features", {
      phases: [CASTING_PHASES.SAVES_READY],
      priority: 25,
      handler: event => this.process(event)
    });
  }

  shutdown() {
    this.#unregister?.();
    this.#unregister = null;
  }

  async process({ workflow, actor, activity, item, phase = CASTING_PHASES.SAVES_READY } = {}) {
    if (phase !== CASTING_PHASES.SAVES_READY || !workflow || !actor
      || (item ?? activity?.item ?? workflow.item)?.type !== "spell"
      || isActivityOverTime(workflow)) return true;
    if (workflow.userId && workflow.userId !== game.user.id) return true;
    if (!actor.isOwner || !this.#declarations.hasAny(actor)) return true;

    const context = this.#context(workflow);
    const compiled = this.#declarations.compile(actor, context);
    if (!compiled.ready) {
      const message = compiled.diagnostics.map(entry => entry.message).join(" ");
      globalThis.ui?.notifications?.error?.(`AE5E: ${message}`);
      Logger.warn("Save-protection declarations are invalid; spell saves continue normally.", compiled.diagnostics);
      return true;
    }

    for (const feature of compiled.features) {
      try {
        await this.#processFeature(workflow, actor, feature, phase);
      } catch (error) {
        Logger.warn(`${feature.label} save protection failed; spell saves continue normally.`, error);
        globalThis.ui?.notifications?.error?.(`AE5E: ${feature.label} could not be applied: ${error.message}`);
      }
    }
    return true;
  }

  getRecent() { return this.#recent.map(clone); }

  getStatus() {
    return {
      initialized: Boolean(this.#unregister),
      recentCount: this.#recent.length,
      application: this.#applications.getStatus()
    };
  }

  async #processFeature(workflow, actor, feature, castingPhase) {
    const offer = await this.#execute(actor, feature, "offer", workflow, { castingPhase });
    if (offer?.eligible !== true) return;

    const selection = await this.#execute(actor, feature, "select", workflow, {
      castingPhase,
      transactionStage: "selection",
      offer: clone(offer)
    });
    if (selection?.outcome !== "confirm") return;
    if (selection.payload === undefined) {
      throw new Error("The Item macro confirmed without returning a selection payload.");
    }

    const fresh = this.#declarations.compile(actor, this.#context(workflow));
    const current = fresh.ready
      ? fresh.features.find(candidate => candidate.identity === feature.identity)
      : null;
    if (!current || JSON.stringify(current.declaration) !== JSON.stringify(feature.declaration)) {
      throw new Error("The feature declaration changed while choosing.");
    }

    const application = await this.#execute(actor, current, "apply", workflow, {
      castingPhase,
      transactionStage: "prepare-application",
      payload: clone(selection.payload)
    });
    const request = application?.saveProtection;
    const normalized = this.#applications.validate(workflow, request, { label: current.label });
    const claim = this.#applications.install(workflow, normalized, { label: current.label });
    this.#remember({
      status: "applied",
      featureId: current.id,
      label: current.label,
      identity: current.identity,
      sourceUuid: current.sourceUuid,
      casterActorUuid: actor.uuid,
      workflowId: workflow.uuid ?? workflow.id ?? null,
      tokenUuids: [...normalized.tokenUuids],
      claimId: claim.id
    });

    try {
      await this.#executors.notify({
        actor,
        sourceUuid: current.sourceUuid,
        identity: current.identity,
        family: "save-protection",
        declaration: current.declaration,
        kind: "feature",
        phase: "applied",
        context: {
          actor,
          workflow,
          activity: workflow.activity,
          item: workflow.activity?.item ?? workflow.item,
          castingPhase,
          tokenUuids: [...normalized.tokenUuids]
        }
      });
    } catch (error) {
      Logger.warn(`${current.label} applied lifecycle notification failed; protection was retained.`, error);
    }
  }

  #execute(actor, feature, phase, workflow, extraContext = {}) {
    return this.#executors.execute({
      actor,
      sourceUuid: feature.sourceUuid,
      identity: feature.identity,
      family: "save-protection",
      declaration: feature.declaration,
      kind: "feature",
      phase,
      context: {
        actor,
        workflow,
        activity: workflow.activity,
        item: workflow.activity?.item ?? workflow.item,
        initiatorUserId: game.user.id,
        ...extraContext
      }
    });
  }

  #context(workflow) {
    return {
      actor: workflow.actor,
      activity: workflow.activity,
      item: workflow.activity?.item ?? workflow.item,
      workflow,
      subjectToken: workflow.token?.document ?? workflow.token ?? null,
      context: { moduleId: MODULE_ID }
    };
  }

  #remember(entry) {
    this.#recent.unshift({ ...clone(entry), at: new Date().toISOString() });
    if (this.#recent.length > 20) this.#recent.length = 20;
  }
}
