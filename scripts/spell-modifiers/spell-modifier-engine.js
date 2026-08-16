import {
  HOOKS,
  MODULE_ID,
  SME_MAX_RECENT_SESSIONS,
  SME_MODIFIER_MODES,
  SME_PHASES,
  SME_SESSION_STATES,
  SME_WORKFLOW_STATE_PATH
} from "../core/constants.js";
import { Logger } from "../core/logger.js";
import { SpellModifierContext } from "./spell-modifier-context.js";
import { SpellModifierSession } from "./spell-modifier-session.js";

export class SpellModifierEngine {
  #registry;
  #discovery;
  #choices;
  #catSpell;
  #authority;
  #sessionsByWorkflow = new WeakMap();
  #sessionsById = new Map();
  #workflowsBySessionId = new Map();
  #workflowIds = new WeakMap();
  #workflowCounter = 0;
  #recent = [];
  #stats = {
    phaseCalls: 0,
    nonSpellIgnores: 0,
    sessionsCreated: 0,
    sessionsCompleted: 0,
    sessionsAborted: 0,
    duplicateEventsIgnored: 0,
    discoveryRuns: 0,
    offersDiscovered: 0,
    automaticApplications: 0,
    optionalPrompts: 0,
    optionalSelections: 0,
    modifierApplications: 0,
    modifierSkips: 0,
    modifierErrors: 0,
    rollbacks: 0,
    lastEvent: null
  };

  constructor({ registry, discovery, choices, catSpell, authority }) {
    this.#registry = registry;
    this.#discovery = discovery;
    this.#choices = choices;
    this.#catSpell = catSpell;
    this.#authority = authority;
  }

  registerModifier(id, config) {
    return this.#registry.register(id, config);
  }

  unregisterModifier(id) {
    return this.#registry.unregister(id);
  }

  async discover({ phase, workflow, eventData = {}, syntheticRegistrations = [] } = {}) {
    const session = this.#ensureSession(workflow);
    const context = this.#context({ phase, workflow, session, eventData });
    return this.#discovery.discover(context, session, { syntheticRegistrations });
  }

  async processPhase(phase, workflow, options = {}) {
    this.#stats.phaseCalls += 1;
    const item = workflow?.item ?? workflow?.activity?.item ?? null;
    if (item?.type !== "spell") {
      this.#stats.nonSpellIgnores += 1;
      return { continue: true, ignored: true, reason: "non-spell", phase };
    }

    const session = this.#ensureSession(workflow, options);
    if (session.state !== SME_SESSION_STATES.ACTIVE) {
      return { continue: session.state !== SME_SESSION_STATES.ABORTED, ignored: true, reason: `session-${session.state}`, session: session.toJSON() };
    }

    const context = this.#context({ phase, workflow, session, eventData: options.eventData ?? {} });
    const eventKey = options.eventKey ?? this.#defaultEventKey(context);
    if (session.hasProcessedEvent(eventKey)) {
      this.#stats.duplicateEventsIgnored += 1;
      return { continue: true, duplicate: true, phase, eventKey, session: session.toJSON() };
    }

    session.touchPhase(phase, { eventKey, context });
    this.#syncWorkflowSession(workflow, session);
    this.#record("phase", { sessionId: session.id, phase, eventKey });
    Hooks.callAll(HOOKS.SPELL_MODIFIER_PHASE, context.toJSON(), session.toJSON());

    this.#stats.discoveryRuns += 1;
    const offers = await this.#discovery.discover(context, session, {
      syntheticRegistrations: options.syntheticRegistrations ?? []
    });
    this.#stats.offersDiscovered += offers.length;

    const automatic = offers.filter(offer => offer.mode === SME_MODIFIER_MODES.AUTOMATIC);
    const optional = offers.filter(offer => offer.mode !== SME_MODIFIER_MODES.AUTOMATIC);
    const applied = [];

    for (const offer of automatic) {
      if (this.#isConflicted(session, offer)) {
        this.#stats.modifierSkips += 1;
        session.recordDecision({ phase, type: "automatic-skip", offerId: offer.id, modifierId: offer.modifierId, reason: "conflict-or-already-applied" });
        this.#syncWorkflowSession(workflow, session);
        continue;
      }
      const result = await this.#applyOffer({ offer, context, session, decisionType: "automatic" });
      if (result.applied) {
        applied.push(result);
        this.#stats.automaticApplications += 1;
      }
      if (!result.continue) return this.#phaseResult({ session, context, offers, applied, continueWorkflow: false });
    }

    const selectable = optional.filter(offer => !this.#isConflicted(session, offer));
    if (selectable.length) {
      this.#stats.optionalPrompts += 1;
      const controllerUserId = options.controllerUserId ?? this.#controllerUserId(workflow);
      let selectedIds = [];
      try {
        selectedIds = await this.#choices.choose({
          session,
          context,
          offers: selectable,
          controllerUserId,
          chooser: options.chooser ?? null
        });
      } catch (error) {
        this.#stats.modifierErrors += 1;
        session.recordError({ phase, message: error?.message ?? String(error), stack: error?.stack ?? null });
        Logger.warn("SME choice broker failed open; base spell will continue without optional modifiers.", error);
        selectedIds = [];
      }

      const selectedOffers = this.#validateSelections(selectedIds, selectable, session);
      session.recordDecision({
        phase,
        type: "optional",
        offeredIds: selectable.map(offer => offer.id),
        selectedIds: selectedOffers.map(offer => offer.id),
        controllerUserId
      });
      this.#syncWorkflowSession(workflow, session);
      this.#stats.optionalSelections += selectedOffers.length;

      for (const offer of selectedOffers) {
        if (this.#isConflicted(session, offer)) continue;
        const result = await this.#applyOffer({ offer, context, session, decisionType: "optional" });
        if (result.applied) applied.push(result);
        if (!result.continue) return this.#phaseResult({ session, context, offers, applied, continueWorkflow: false });
      }
    }

    let result = this.#phaseResult({ session, context, offers, applied, continueWorkflow: true });
    this.#syncWorkflowSession(workflow, session);
    if (phase === SME_PHASES.WORKFLOW_COMPLETE) {
      const completed = this.completeSession(workflow, { reason: "workflow-complete" });
      if (completed) result = { ...result, session: completed };
    }
    return result;
  }

  getSession(subject) {
    if (!subject) return null;
    if (typeof subject === "string") return this.#sessionsById.get(subject)?.toJSON?.() ?? this.#recent.find(entry => entry.id === subject) ?? null;
    return this.#sessionsByWorkflow.get(subject)?.toJSON?.() ?? null;
  }

  getLiveSession(subject) {
    if (!subject) return null;
    if (typeof subject === "string") return this.#sessionsById.get(subject) ?? null;
    return this.#sessionsByWorkflow.get(subject) ?? null;
  }

  getRecentSessions() {
    return this.#recent.map(entry => foundry.utils.deepClone(entry));
  }

  completeSession(subject, details = {}) {
    const session = typeof subject === "string" ? this.#sessionsById.get(subject) : this.#sessionsByWorkflow.get(subject);
    if (!session) return null;
    const workflow = typeof subject === "string" ? this.#workflowsBySessionId.get(session.id) ?? null : subject;
    session.complete(details);
    this.#syncWorkflowSession(workflow, session);
    this.#archive(session);
    this.#stats.sessionsCompleted += 1;
    this.#record("complete", { sessionId: session.id, details });
    Hooks.callAll(HOOKS.SPELL_MODIFIER_SESSION_COMPLETE, session.toJSON());
    return session.toJSON();
  }

  async rollbackSession(subject, options = {}) {
    const session = typeof subject === "string" ? this.#sessionsById.get(subject) : this.#sessionsByWorkflow.get(subject);
    if (!session) return null;
    const workflow = typeof subject === "string" ? this.#workflowsBySessionId.get(session.id) ?? null : subject;
    const result = await session.rollback(options);
    this.#stats.rollbacks += 1;
    this.#syncWorkflowSession(workflow, session);
    this.#archive(session);
    Hooks.callAll(HOOKS.SPELL_MODIFIER_SESSION_COMPLETE, session.toJSON());
    return { session: session.toJSON(), results: result };
  }

  clearSession(subject, { archive = false } = {}) {
    const session = typeof subject === "string" ? this.#sessionsById.get(subject) : this.#sessionsByWorkflow.get(subject);
    if (!session) return false;
    const workflow = typeof subject === "string" ? this.#workflowsBySessionId.get(session.id) ?? null : subject;
    if (archive) this.#archive(session);
    else {
      this.#sessionsById.delete(session.id);
      this.#workflowsBySessionId.delete(session.id);
    }
    if (workflow && (typeof workflow === "object" || typeof workflow === "function")) {
      this.#sessionsByWorkflow.delete(workflow);
    }
    return true;
  }

  getStats() {
    return {
      ...this.#stats,
      activeSessions: this.#sessionsById.size,
      recentSessions: this.#recent.length,
      registry: this.#registry.getStats(),
      choices: this.#choices.getStats(),
      cat: this.#catSpell.getStats()
    };
  }

  #ensureSession(workflow, options = {}) {
    if (!workflow || (typeof workflow !== "object" && typeof workflow !== "function")) {
      throw new TypeError("SME requires a live Midi workflow object.");
    }
    let session = this.#sessionsByWorkflow.get(workflow);
    if (session) return session;

    const workflowId = this.#workflowId(workflow);
    const item = workflow?.item ?? workflow?.activity?.item ?? null;
    const actor = workflow?.actor ?? item?.actor ?? null;
    const token = workflow?.token?.document ?? workflow?.token ?? null;
    session = new SpellModifierSession({
      workflowId,
      coordinatorUserId: options.coordinatorUserId ?? workflow?.userId ?? game?.user?.id ?? null,
      source: {
        actorUuid: actor?.uuid ?? null,
        tokenUuid: token?.uuid ?? null,
        itemUuid: item?.uuid ?? null,
        itemName: item?.name ?? null
      }
    });
    this.#sessionsByWorkflow.set(workflow, session);
    this.#sessionsById.set(session.id, session);
    this.#workflowsBySessionId.set(session.id, workflow);
    this.#syncWorkflowSession(workflow, session);
    this.#stats.sessionsCreated += 1;
    this.#record("session-created", { sessionId: session.id, workflowId });
    Hooks.callAll(HOOKS.SPELL_MODIFIER_SESSION_CREATED, session.toJSON());
    return session;
  }

  #context({ phase, workflow, session, eventData }) {
    return new SpellModifierContext({
      phase,
      workflowId: session.workflowId,
      sessionId: session.id,
      workflow,
      catSpell: this.#catSpell,
      eventData,
      coordinatorUserId: session.coordinatorUserId
    });
  }

  async #applyOffer({ offer, context, session, decisionType }) {
    const handler = offer.handler;
    try {
      const raw = await handler.apply({
        context,
        session,
        actor: offer.actor,
        source: offer.source,
        registration: offer.registration,
        option: { id: offer.optionId, data: offer.optionData },
        offer
      });
      const normalized = raw === false
        ? { applied: false }
        : raw && typeof raw === "object"
          ? { applied: raw.applied !== false, ...raw }
          : { applied: true, value: raw };

      if (!normalized.applied) {
        this.#stats.modifierSkips += 1;
        session.recordDecision({ phase: context.phase, type: `${decisionType}-not-applied`, offerId: offer.id, modifierId: offer.modifierId });
        this.#syncWorkflowSession(context.workflow, session);
        return { continue: true, applied: false, offerId: offer.id, modifierId: offer.modifierId, result: normalized };
      }

      session.recordApplication({
        key: offer.key,
        modifierId: offer.modifierId,
        sourceUuid: offer.source?.uuid ?? null,
        sourceName: offer.source?.name ?? null,
        optionId: offer.optionId,
        label: offer.label,
        phase: context.phase,
        mode: offer.mode,
        conflictGroup: offer.conflictGroup,
        result: normalized,
        rollback: normalized.rollback
      });
      this.#stats.modifierApplications += 1;
      this.#syncWorkflowSession(context.workflow, session);
      Hooks.callAll(HOOKS.SPELL_MODIFIER_APPLIED, {
        sessionId: session.id,
        phase: context.phase,
        modifierId: offer.modifierId,
        offerId: offer.id,
        sourceUuid: offer.source?.uuid ?? null,
        optionId: offer.optionId,
        label: offer.label,
        result: session.applications.at(-1)?.result ?? null
      });

      if (normalized.abort === true) {
        session.abort(normalized.reason ?? `modifier '${offer.modifierId}' requested abort`);
        this.#stats.sessionsAborted += 1;
        this.#syncWorkflowSession(context.workflow, session);
        this.#archive(session);
        Hooks.callAll(HOOKS.SPELL_MODIFIER_SESSION_COMPLETE, session.toJSON());
        return { continue: false, applied: true, offerId: offer.id, modifierId: offer.modifierId, result: normalized };
      }
      return { continue: true, applied: true, offerId: offer.id, modifierId: offer.modifierId, result: normalized };
    } catch (error) {
      this.#stats.modifierErrors += 1;
      session.recordError({ modifierId: offer.modifierId, phase: context.phase, message: error?.message ?? String(error), stack: error?.stack ?? null });
      this.#syncWorkflowSession(context.workflow, session);
      Logger.warn(`SME modifier '${offer.modifierId}' failed.`, error);
      if (handler.failurePolicy === "abort") {
        session.abort(`modifier-error:${offer.modifierId}`);
        this.#stats.sessionsAborted += 1;
        this.#syncWorkflowSession(context.workflow, session);
        this.#archive(session);
        Hooks.callAll(HOOKS.SPELL_MODIFIER_SESSION_COMPLETE, session.toJSON());
        return { continue: false, applied: false, offerId: offer.id, modifierId: offer.modifierId, error };
      }
      return { continue: true, applied: false, offerId: offer.id, modifierId: offer.modifierId, error };
    }
  }

  #validateSelections(selectedIds, offers, session) {
    const byId = new Map(offers.map(offer => [offer.id, offer]));
    const result = [];
    const selectionGroups = new Set();
    const conflictGroups = new Set();
    for (const id of selectedIds ?? []) {
      const offer = byId.get(id);
      if (!offer || this.#isConflicted(session, offer)) continue;
      if (offer.selectionGroup && selectionGroups.has(offer.selectionGroup)) continue;
      if (offer.conflictGroup && conflictGroups.has(offer.conflictGroup)) continue;
      result.push(offer);
      if (offer.selectionGroup) selectionGroups.add(offer.selectionGroup);
      if (offer.conflictGroup) conflictGroups.add(offer.conflictGroup);
    }
    return result.sort((a, b) => Number(b.priority) - Number(a.priority));
  }

  #isConflicted(session, offer) {
    if (offer.oncePerCast && session.hasApplied(offer.key)) return true;
    if (offer.conflictGroup && session.hasConflictGroup(offer.conflictGroup)) return true;
    return false;
  }

  #phaseResult({ session, context, offers, applied, continueWorkflow }) {
    const result = {
      continue: Boolean(continueWorkflow),
      phase: context.phase,
      sessionId: session.id,
      offers: offers.map(offer => ({
        id: offer.id,
        modifierId: offer.modifierId,
        label: offer.label,
        mode: offer.mode,
        sourceUuid: offer.source?.uuid ?? null,
        optionId: offer.optionId
      })),
      applied,
      session: session.toJSON()
    };
    this.#record("phase-complete", { sessionId: session.id, phase: context.phase, continue: result.continue, applied: applied.length });
    return result;
  }

  #defaultEventKey(context) {
    const target = context.event?.targetTokenUuid ?? "global";
    return `${context.phase}:${target}`;
  }

  #workflowId(workflow) {
    const explicit = workflow?.uuid ?? workflow?.id ?? workflow?.workflowId ?? null;
    if (explicit) return String(explicit);
    if (!this.#workflowIds.has(workflow)) {
      this.#workflowCounter += 1;
      this.#workflowIds.set(workflow, `${MODULE_ID}-sme-workflow-${this.#workflowCounter}`);
    }
    return this.#workflowIds.get(workflow);
  }

  #controllerUserId(workflow) {
    const explicit = workflow?.userId ? game?.users?.get?.(workflow.userId) : null;
    if (explicit?.active) return explicit.id;
    const actor = workflow?.actor ?? workflow?.item?.actor ?? workflow?.activity?.item?.actor ?? null;
    const ownerLevel = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
    const playerOwner = [...(game?.users ?? [])].find(user => {
      if (!user?.active || user?.isGM) return false;
      try { return actor?.testUserPermission?.(user, ownerLevel) ?? false; } catch { return false; }
    });
    if (playerOwner) return playerOwner.id;
    return this.#authority?.getPrimaryGm?.()?.id ?? (game?.user?.isGM ? game.user.id : null);
  }

  #syncWorkflowSession(workflow, session) {
    if (!workflow || !session) return false;
    return this.#catSpell.trySetWorkflowProperty(
      workflow,
      SME_WORKFLOW_STATE_PATH,
      session.toJSON()
    );
  }

  #archive(session) {
    const snapshot = session.toJSON();
    this.#sessionsById.delete(session.id);
    this.#workflowsBySessionId.delete(session.id);
    const existingIndex = this.#recent.findIndex(entry => entry.id === session.id);
    if (existingIndex >= 0) this.#recent.splice(existingIndex, 1);
    this.#recent.unshift(snapshot);
    if (this.#recent.length > SME_MAX_RECENT_SESSIONS) this.#recent.length = SME_MAX_RECENT_SESSIONS;
  }

  #record(type, details) {
    this.#stats.lastEvent = { at: new Date().toISOString(), type, details };
    Logger.debug("Spell Modifier Engine", this.#stats.lastEvent);
  }
}
