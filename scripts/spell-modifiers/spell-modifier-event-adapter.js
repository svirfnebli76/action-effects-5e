import { SME_PHASES } from "../core/constants.js";
import { Logger } from "../core/logger.js";

const HOOK_MAP = Object.freeze([
  { hook: "midi-qol.preTargetingV2", phase: SME_PHASES.PRE_TARGETING, gate: true },
  { hook: "midi-qol.premades.postPreambleComplete", phase: SME_PHASES.TARGETING_COMPLETE, gate: true },
  { hook: "midi-qol.premades.postSavesComplete", phase: SME_PHASES.SAVES_COMPLETE, gate: false },
  { hook: "midi-qol.preDamageRoll", phase: SME_PHASES.BEFORE_DAMAGE_ROLL, gate: true },
  { hook: "midi-qol.preDamageRollComplete", phase: SME_PHASES.DAMAGE_ROLL_COMPLETE, gate: false },
  { hook: "midi-qol.premades.preDamageRollComplete", phase: SME_PHASES.DAMAGE_ROLL_COMPLETE, gate: false },
  { hook: "midi-qol.preTargetDamageApplication", phase: SME_PHASES.BEFORE_DAMAGE_APPLICATION, gate: true },
  { hook: "midi-qol.premades.postRollFinished", phase: SME_PHASES.WORKFLOW_COMPLETE, gate: false },
  { hook: "midi-qol.RollComplete", phase: SME_PHASES.WORKFLOW_COMPLETE, gate: false }
]);

/** Normalize Midi-QOL lifecycle hooks into stable SME semantic phases. */
export class SpellModifierEventAdapter {
  #engine;
  #authority;
  #hooks = [];
  #initialized = false;
  #stats = {
    hookCalls: 0,
    spellCalls: 0,
    ignoredNonSpells: 0,
    ignoredOtherCoordinator: 0,
    phasesProcessed: 0,
    aborted: 0,
    errors: 0,
    lastEvent: null
  };

  constructor({ engine, authority }) {
    this.#engine = engine;
    this.#authority = authority;
  }

  initialize() {
    if (this.#initialized) return;
    this.#initialized = true;
    for (const entry of HOOK_MAP) {
      const id = Hooks.on(entry.hook, async (...args) => this.#handleHook(entry, args));
      this.#hooks.push({ hook: entry.hook, id });
    }
  }

  shutdown() {
    for (const { hook, id } of this.#hooks) {
      try { Hooks.off(hook, id); } catch { /* noop */ }
    }
    this.#hooks.length = 0;
    this.#initialized = false;
  }

  async processMidiPhase(phase, workflow, options = {}) {
    if (!workflow) return { continue: true, ignored: true, reason: "no-workflow" };
    const item = workflow?.item ?? workflow?.activity?.item ?? null;
    if (item?.type !== "spell") {
      this.#stats.ignoredNonSpells += 1;
      return { continue: true, ignored: true, reason: "non-spell" };
    }
    if (!options.forceLocal && !this.#isCoordinator(workflow)) {
      this.#stats.ignoredOtherCoordinator += 1;
      return { continue: true, ignored: true, reason: "other-coordinator" };
    }

    this.#stats.spellCalls += 1;
    const result = await this.#engine.processPhase(phase, workflow, {
      coordinatorUserId: workflow?.userId ?? game?.user?.id ?? null,
      eventData: options.eventData ?? {},
      eventKey: options.eventKey ?? null,
      syntheticRegistrations: options.syntheticRegistrations ?? [],
      chooser: options.chooser ?? null,
      controllerUserId: options.controllerUserId ?? null
    });
    this.#stats.phasesProcessed += 1;
    if (result?.continue === false) this.#stats.aborted += 1;
    this.#record("phase", { phase, workflowId: result?.session?.workflowId ?? null, continue: result?.continue !== false });
    return result;
  }

  getStats() {
    return {
      initialized: this.#initialized,
      hooks: this.#hooks.map(entry => entry.hook),
      ...this.#stats
    };
  }

  async #handleHook(entry, args) {
    this.#stats.hookCalls += 1;
    try {
      const { workflow, eventData } = this.#extract(entry.phase, args);
      if (!workflow) return true;
      const item = workflow?.item ?? workflow?.activity?.item ?? null;
      if (item?.type !== "spell") {
        this.#stats.ignoredNonSpells += 1;
        return true;
      }
      if (!this.#isCoordinator(workflow)) {
        this.#stats.ignoredOtherCoordinator += 1;
        return true;
      }
      const targetKey = eventData?.targetToken?.document?.uuid ?? eventData?.targetToken?.uuid ?? "global";
      const result = await this.processMidiPhase(entry.phase, workflow, {
        forceLocal: true,
        eventData: { ...eventData, rawHook: entry.hook },
        eventKey: `${entry.phase}:${targetKey}`
      });
      return entry.gate ? result?.continue !== false : true;
    } catch (error) {
      this.#stats.errors += 1;
      Logger.warn(`SME event adapter failed open during '${entry.hook}'.`, error);
      return true;
    }
  }

  #extract(phase, args) {
    if (phase === SME_PHASES.BEFORE_DAMAGE_APPLICATION) {
      const targetToken = args?.[0] ?? null;
      const second = args?.[1] ?? null;
      const workflow = this.#findWorkflow(args) ?? second?.workflow ?? null;
      const ditem = second?.ditem ?? args?.find(value => value?.ditem)?.ditem ?? null;
      return { workflow, eventData: { targetToken, ditem, rawArgsCount: args.length } };
    }
    return { workflow: this.#findWorkflow(args), eventData: { rawArgsCount: args.length } };
  }

  #findWorkflow(args) {
    for (const value of args ?? []) {
      if (this.#looksLikeWorkflow(value)) return value;
      if (this.#looksLikeWorkflow(value?.workflow)) return value.workflow;
      if (this.#looksLikeWorkflow(value?.options?.workflow)) return value.options.workflow;
    }
    return null;
  }

  #looksLikeWorkflow(value) {
    return Boolean(value && typeof value === "object" && value.actor && (value.item || value.activity));
  }

  #isCoordinator(workflow) {
    if (workflow?.userId) return workflow.userId === game?.user?.id;
    const actor = workflow?.actor ?? workflow?.item?.actor ?? workflow?.activity?.item?.actor ?? null;
    if (!actor) return false;
    const owner = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
    const activePlayers = [...(game?.users ?? [])].filter(user => {
      if (!user?.active || user?.isGM) return false;
      try { return actor.testUserPermission?.(user, owner) ?? false; } catch { return false; }
    });
    if (activePlayers.length) return activePlayers[0].id === game?.user?.id;
    return Boolean(game?.user?.isGM && this.#authority?.isPrimary?.());
  }

  #record(type, details) {
    this.#stats.lastEvent = { at: new Date().toISOString(), type, details };
  }
}
