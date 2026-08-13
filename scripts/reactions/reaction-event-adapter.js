import { HOOKS, REACTION_SOURCE_RESULTS, REACTION_TRIGGERS } from "../core/constants.js";
import { Logger } from "../core/logger.js";
import { ReactionContext } from "./reaction-context.js";

/**
 * Small external-event adapter. v0.3.28 intentionally normalizes only spellCast.
 * Reaction handlers never need to know the Midi hook name.
 */
export class ReactionEventAdapter {
  #broker;
  #registry;
  #authority;
  #hookId = null;
  #initialized = false;
  #testProbe = null;
  #stats = {
    midiSpellHooks: 0,
    normalizedSpellCasts: 0,
    ignoredNonSpells: 0,
    ignoredNoSubscribers: 0,
    ignoredOtherCoordinator: 0,
    resumed: 0,
    aborted: 0,
    testProbesArmed: 0,
    testProbesCompleted: 0,
    lastTestProbe: null,
    lastEvent: null
  };

  constructor({ broker, registry, authority }) {
    this.#broker = broker;
    this.#registry = registry;
    this.#authority = authority;
  }

  initialize() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#hookId = Hooks.on("midi-qol.prePreambleComplete", async (workflow) => this.processMidiSpellWorkflow(workflow));
  }

  shutdown() {
    if (this.#hookId !== null) Hooks.off("midi-qol.prePreambleComplete", this.#hookId);
    this.#hookId = null;
    this.#initialized = false;
  }

  armTestSpellProbe({ syntheticOffers = {}, nestedSyntheticOffers = {}, expectedSourceTokenUuid = null, timeoutMs = 120_000 } = {}) {
    if (this.#testProbe) throw new Error("A Reaction Broker Midi test probe is already armed.");
    let resolveProbe;
    const promise = new Promise(resolve => { resolveProbe = resolve; });
    const id = `reaction-midi-probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const probe = {
      id,
      syntheticOffers,
      nestedSyntheticOffers,
      expectedSourceTokenUuid,
      armedAt: Date.now(),
      startedAt: null,
      brokerCompletedAt: null,
      sourceWorkflowId: null,
      sourceEventKey: null,
      status: "armed",
      resolveProbe,
      promise,
      timer: null
    };
    probe.timer = setTimeout(() => {
      if (this.#testProbe !== probe) return;
      this.#finishTestProbe(probe, { status: "timeout", reason: "no-matching-spell-before-timeout" });
    }, Math.max(5_000, Number(timeoutMs) || 120_000));
    this.#testProbe = probe;
    this.#stats.testProbesArmed += 1;
    return { id, promise };
  }

  clearTestSpellProbe(reason = "cleared") {
    const probe = this.#testProbe;
    if (!probe) return false;
    this.#finishTestProbe(probe, { status: "cleared", reason });
    return true;
  }

  getTestProbeStatus() {
    if (!this.#testProbe) return this.#stats.lastTestProbe ? { ...this.#stats.lastTestProbe } : null;
    const { resolveProbe, promise, timer, syntheticOffers, nestedSyntheticOffers, ...safe } = this.#testProbe;
    return { ...safe, syntheticOfferReactors: Object.keys(syntheticOffers ?? {}).length, nestedOfferReactors: Object.keys(nestedSyntheticOffers ?? {}).length };
  }

  async processMidiSpellWorkflow(workflow, options = {}) {
    this.#stats.midiSpellHooks += 1;
    const item = workflow?.item ?? workflow?.activity?.item ?? null;
    if (item?.type !== "spell") {
      this.#stats.ignoredNonSpells += 1;
      return true;
    }
    if (!this.#registry.hasTrigger(REACTION_TRIGGERS.SPELL_CAST)) {
      this.#stats.ignoredNoSubscribers += 1;
      return true;
    }

    let context = ReactionContext.fromMidiSpellWorkflow(workflow, options);
    const coordinatorUserId = context.coordinatorUserId;
    if (coordinatorUserId && coordinatorUserId !== game?.user?.id) {
      this.#stats.ignoredOtherCoordinator += 1;
      return true;
    }

    // Midi workflows normally expose the initiating user. If a third-party
    // workflow omits it, process only on the client which owns the live workflow
    // rather than deliberately fanning the event out over Socketlib.
    if (!coordinatorUserId && !this.#looksLikeLocalWorkflow(workflow)) {
      this.#stats.ignoredOtherCoordinator += 1;
      return true;
    }

    const probe = this.#testProbe;
    const sourceTokenUuid = context.source?.tokenUuid ?? null;
    const probeMatches = Boolean(probe
      && probe.status === "armed"
      && (!probe.expectedSourceTokenUuid || probe.expectedSourceTokenUuid === sourceTokenUuid));
    if (probeMatches) {
      probe.status = "running";
      probe.startedAt = Date.now();
      probe.sourceWorkflowId = context.source?.workflowId ?? null;
      probe.sourceEventKey = context.eventKey;
      context = new ReactionContext({
        ...context.toJSON(),
        data: {
          ...context.data,
          ae5eTest: true,
          syntheticOffers: probe.syntheticOffers ?? {},
          nestedSyntheticOffers: probe.nestedSyntheticOffers ?? {},
          midiGateProbeId: probe.id
        }
      }, { live: context.live });
    }

    this.#stats.normalizedSpellCasts += 1;
    this.#record("spellCast", { eventKey: context.eventKey, coordinatorUserId: coordinatorUserId ?? game?.user?.id ?? null });
    Hooks.callAll(HOOKS.REACTION_EVENT, context.toJSON());

    const result = await this.#broker.process(context);
    if (probeMatches) {
      probe.brokerCompletedAt = Date.now();
      this.#finishTestProbe(probe, {
        status: "complete",
        result,
        sourceWorkflowId: context.source?.workflowId ?? probe.sourceWorkflowId,
        sourceEventKey: context.eventKey
      });
    }
    if (result?.source === REACTION_SOURCE_RESULTS.ABORT) {
      this.#stats.aborted += 1;
      return false;
    }
    this.#stats.resumed += 1;
    return true;
  }

  getStats() {
    return { initialized: this.#initialized, ...this.#stats };
  }

  #finishTestProbe(probe, details = {}) {
    if (!probe) return;
    if (probe.timer) clearTimeout(probe.timer);
    probe.timer = null;
    const completed = {
      id: probe.id,
      armedAt: probe.armedAt,
      startedAt: probe.startedAt,
      brokerCompletedAt: probe.brokerCompletedAt,
      sourceWorkflowId: details.sourceWorkflowId ?? probe.sourceWorkflowId,
      sourceEventKey: details.sourceEventKey ?? probe.sourceEventKey,
      status: details.status ?? probe.status ?? "complete",
      reason: details.reason ?? null,
      result: details.result ?? null,
      completedAt: Date.now()
    };
    if (this.#testProbe === probe) this.#testProbe = null;
    this.#stats.lastTestProbe = completed;
    if (completed.status === "complete") this.#stats.testProbesCompleted += 1;
    try { probe.resolveProbe?.(completed); } catch { /* probe completion is best-effort */ }
  }

  #looksLikeLocalWorkflow(workflow) {
    if (workflow?.userId === game?.user?.id) return true;
    const actor = workflow?.actor ?? workflow?.item?.actor ?? null;
    if (!actor) return false;
    // Prefer exactly one active non-GM owner when both players and GMs own the
    // Actor. If there is no active player owner, fall back to the elected AE5E
    // Reaction GM rather than allowing every GM client to process the hook.
    const activeNonGmOwners = [...(game?.users ?? [])].filter(user => {
      if (!user?.active || user?.isGM) return false;
      try {
        const owner = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
        return actor.testUserPermission?.(user, owner) ?? false;
      } catch {
        return false;
      }
    });
    if (activeNonGmOwners.length) return activeNonGmOwners[0].id === game?.user?.id;
    return Boolean(game?.user?.isGM && this.#authority?.isPrimary?.());
  }

  #record(type, details) {
    this.#stats.lastEvent = { at: new Date().toISOString(), type, details };
    Logger.debug("Reaction event adapter", this.#stats.lastEvent);
  }
}
