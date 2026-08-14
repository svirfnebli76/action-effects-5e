import {
  MODULE_ID,
  REACTION_RESPONSES,
  REACTION_SOURCE_RESULTS,
  REACTION_TRANSACTION_STATES,
  REACTION_TEST_HANDLER_PREFIX,
  REACTION_TRIGGERS
} from "../core/constants.js";
import { Logger } from "../core/logger.js";
import { ReactionContext } from "../reactions/reaction-context.js";
import { ReactionTransaction } from "../reactions/reaction-transaction.js";

const FIXTURE_FLAG = "reactionBroker028";
const MULTIPLAYER_OWNERSHIP_BACKUP_FLAG = "reactionBroker028OwnershipBackup";
const FIXTURE_SCENE_NAME = "AE5E 0.3.28 Reaction Broker Test";
const NAMES = Object.freeze({
  attacker: "AE5E Attacker",
  reactor1: "AE5E Reactor 1",
  reactor2: "AE5E Reactor 2",
  reactor3: "AE5E Reactor 3",
  nonReactor: "AE5E Non-Reactor"
});
const TEST_HANDLERS = Object.freeze({
  CONTINUE: `${REACTION_TEST_HANDLER_PREFIX}continue`,
  STOP: `${REACTION_TEST_HANDLER_PREFIX}stop`,
  ABORT: `${REACTION_TEST_HANDLER_PREFIX}abort`,
  NESTED: `${REACTION_TEST_HANDLER_PREFIX}nested`
});

export class ReactionBrokerTestSuite {
  #registry;
  #authority;
  #discovery;
  #ordering;
  #dialogs;
  #broker;
  #events;
  #selectionIndicator;
  #socket;

  constructor({ registry, authority, discovery, ordering, dialogs, broker, events, selectionIndicator, socket }) {
    this.#registry = registry;
    this.#authority = authority;
    this.#discovery = discovery;
    this.#ordering = ordering;
    this.#dialogs = dialogs;
    this.#broker = broker;
    this.#events = events;
    this.#selectionIndicator = selectionIndicator;
    this.#socket = socket;

    socket.register("reactions.tests.installHandlers", this.#installHandlersSocket.bind(this));
    socket.register("reactions.tests.uninstallHandlers", this.#uninstallHandlersSocket.bind(this));
    socket.register("reactions.tests.getClientStatus", this.#getClientStatusSocket.bind(this));
    socket.register("reactions.tests.prepareMultiplayerOwnership", this.#prepareMultiplayerOwnershipSocket.bind(this));
    socket.register("reactions.tests.restoreMultiplayerOwnership", this.#restoreMultiplayerOwnership.bind(this));
  }

  async setupTestScene({ activate = true, recreate = false } = {}) {
    if (!game?.user?.isGM) throw new Error("A GM must create the Reaction Broker test fixture.");

    let scene = game.scenes?.find?.(entry => entry.name === FIXTURE_SCENE_NAME) ?? null;
    if (scene && recreate) {
      await scene.delete();
      scene = null;
    }
    if (!scene) {
      scene = await Scene.create({
        name: FIXTURE_SCENE_NAME,
        width: 3000,
        height: 2400,
        grid: { type: 1, size: 100, distance: 5, units: "ft" },
        flags: { [MODULE_ID]: { [FIXTURE_FLAG]: true } }
      });
    }

    const existingTokens = [...(scene.tokens ?? [])].filter(token => token.getFlag?.(MODULE_ID, FIXTURE_FLAG));
    if (existingTokens.length) await scene.deleteEmbeddedDocuments("Token", existingTokens.map(token => token.id));

    const oldActors = [...(game.actors ?? [])].filter(actor => actor.getFlag?.(MODULE_ID, FIXTURE_FLAG));
    if (oldActors.length) await Actor.deleteDocuments(oldActors.map(actor => actor.id));

    const activePlayers = [...(game.users ?? [])].filter(user => user.active && !user.isGM);
    const specs = [
      { key: "attacker", name: NAMES.attacker, dex: 12, x: 1000, y: 1000, owner: activePlayers[0]?.id ?? null },
      { key: "reactor1", name: NAMES.reactor1, dex: 12, x: 1200, y: 1000, owner: activePlayers[0]?.id ?? null },
      { key: "reactor2", name: NAMES.reactor2, dex: 18, x: 1400, y: 1000, owner: activePlayers[1]?.id ?? activePlayers[0]?.id ?? null },
      { key: "reactor3", name: NAMES.reactor3, dex: 14, x: 1000, y: 1400, owner: activePlayers[2]?.id ?? activePlayers[0]?.id ?? null },
      { key: "nonReactor", name: NAMES.nonReactor, dex: 20, x: 1800, y: 1500, owner: null }
    ];

    const actors = {};
    const actorType = game.system?.documentTypes?.Actor?.includes?.("npc") ? "npc" : (game.system?.documentTypes?.Actor?.[0] ?? "npc");
    for (const spec of specs) {
      const ownership = { default: 0 };
      if (spec.owner) ownership[spec.owner] = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
      const actor = await Actor.create({
        name: spec.name,
        type: actorType,
        ownership,
        flags: { [MODULE_ID]: { [FIXTURE_FLAG]: true } }
      });
      try { await actor.update({ "system.abilities.dex.value": spec.dex }); } catch { /* system defaults are sufficient for UI testing */ }
      actors[spec.key] = actor;
    }

    const probeSpell = await this.#ensureProbeSpell(actors.attacker);

    const tokenData = specs.map(spec => ({
      name: spec.name,
      actorId: actors[spec.key].id,
      actorLink: true,
      x: spec.x,
      y: spec.y,
      width: 1,
      height: 1,
      elevation: 0,
      disposition: globalThis.CONST?.TOKEN_DISPOSITIONS?.HOSTILE ?? -1,
      flags: { [MODULE_ID]: { [FIXTURE_FLAG]: true, fixtureKey: spec.key } }
    }));
    await scene.createEmbeddedDocuments("Token", tokenData);
    if (activate) {
      await scene.activate();
      await this.#waitForSceneCanvas(scene);
    }

    this.#banner("AE5E 0.3.28 REACTION BROKER TEST SCENE READY", "#7ddcff", 26);
    console.log("Fixture order target: Reactor 1 is closest; Reactors 2 and 3 are equally distant, with Reactor 2 winning on Dexterity.");
    return {
      sceneId: scene.id,
      sceneName: scene.name,
      actors: Object.fromEntries(Object.entries(actors).map(([key, actor]) => [key, actor.uuid])),
      probeSpell: probeSpell ? { uuid: probeSpell.uuid, name: probeSpell.name } : null
    };
  }

  async runFoundationTest({ setup = true } = {}) {
    if (!game?.user?.isGM) throw new Error("Run the Reaction Broker foundation test as a GM.");
    if (setup) await this.setupTestScene({ activate: true });
    await this.#requireTestSceneReady();
    await this.#installHandlersEverywhere();
    try {

    const checks = [];
    const record = (name, passed, details = null) => {
      const entry = { name, passed: Boolean(passed), details };
      checks.push(entry);
      this.#checkLine(entry);
      return entry.passed;
    };

    this.#banner("AE5E 0.3.28 REACTION BROKER FOUNDATION TEST", "#7ddcff", 30);
    const tokens = this.#fixtureTokens();
    const required = ["attacker", "reactor1", "reactor2", "reactor3", "nonReactor"];
    record("Test fixture resolved", required.every(key => Boolean(tokens[key])), Object.fromEntries(required.map(key => [key, tokens[key]?.uuid ?? null])));

    await this.#authority.refreshLedger();
    const authority = this.#authority.getStatus();
    const oldestSessionStart = Math.min(...authority.activeGms.map(entry => Number(entry.sessionStartedAt)).filter(Number.isFinite));
    const elected = authority.activeGms.find(entry => entry.id === authority.primaryGmId);
    record("Reaction authority elected", Boolean(authority.primaryGmId), authority);
    record("Longest-connected GM wins authority", Boolean(elected) && Number(elected.sessionStartedAt) === oldestSessionStart, { elected, activeGms: authority.activeGms });

    const fakeActivity = {
      flags: {
        [MODULE_ID]: {
          reaction: { enabled: true, trigger: REACTION_TRIGGERS.SPELL_CAST, handler: TEST_HANDLERS.CONTINUE }
        }
      }
    };
    const registration = this.#discovery.getActivityRegistration(fakeActivity, null);
    record("Activity reaction metadata parsed", registration?.enabled === true
      && registration?.trigger === REACTION_TRIGGERS.SPELL_CAST
      && registration?.handler === TEST_HANDLERS.CONTINUE, registration);
    record("Do-not-react is not a ReactionOffer", !this.#registry.get("do-not-use-a-reaction"), { registry: this.#registry.getStats() });

    // Exercise the production Activity scan path with document-shaped in-memory
    // data. This is separate from synthetic offer injection and proves a normal
    // Activity flag resolves to a registered handler without writing to a world Item.
    const activityId = "ae5eActivityFlagTest";
    const flaggedActivity = {
      id: activityId,
      name: "Activity Flag Test Reaction",
      flags: { [MODULE_ID]: { reaction: { enabled: true, trigger: REACTION_TRIGGERS.SPELL_CAST, handler: TEST_HANDLERS.CONTINUE } } }
    };
    const flaggedItem = {
      uuid: "Item.ae5e-activity-flag-test",
      name: "AE5E Activity Flag Test",
      img: "icons/svg/d20-grey.svg",
      system: { activities: [flaggedActivity] },
      flags: {}
    };
    const flaggedActor = {
      uuid: "Actor.ae5e-activity-flag-test",
      name: "AE5E Activity Flag Test Actor",
      img: "icons/svg/mystery-man.svg",
      items: [flaggedItem],
      system: { abilities: { dex: { value: 10 } } },
      testUserPermission: () => false
    };
    const flaggedToken = { uuid: "Scene.ae5e.Token.activityFlagTest", name: "Activity Flag Test Reactor", actor: flaggedActor };
    const flaggedContext = ReactionContext.synthetic({
      trigger: REACTION_TRIGGERS.SPELL_CAST,
      eventKey: `ae5e-activity-discovery:${Date.now()}`,
      coordinatorUserId: game.user.id,
      data: { ae5eTest: true }
    });
    const flaggedOpportunity = await this.#discovery.discoverForToken(flaggedContext, flaggedToken);
    record("Production Activity-flag discovery creates one ReactionOffer", flaggedOpportunity?.offers?.length === 1
      && flaggedOpportunity.offers[0].handler === TEST_HANDLERS.CONTINUE, flaggedOpportunity);

    const context = this.#syntheticContext(tokens, {
      eventKey: `ae5e-foundation:${Date.now()}`,
      offers: {
        reactor1: [TEST_HANDLERS.CONTINUE, TEST_HANDLERS.ABORT],
        reactor2: [TEST_HANDLERS.CONTINUE],
        reactor3: [TEST_HANDLERS.CONTINUE]
      }
    });
    const discovered = await this.#discovery.discover(context, { tokenDocuments: required.map(key => tokens[key]).filter(Boolean) });
    const byToken = Object.fromEntries(discovered.map(opportunity => [opportunity.reactorTokenUuid, opportunity]));
    record("Three Reactors discovered", discovered.length === 3, discovered.map(entry => ({ name: entry.reactorName, offers: entry.offers.length })));
    record("Single reaction remains one actual offer", byToken[tokens.reactor2.uuid]?.offers?.length === 1, byToken[tokens.reactor2.uuid]?.offers);
    record("Multiple reactions remain multiple actual offers", byToken[tokens.reactor1.uuid]?.offers?.length === 2, byToken[tokens.reactor1.uuid]?.offers);

    const ordered = await this.#ordering.order(discovered, {
      sourceToken: tokens.attacker,
      scene: canvas.scene,
      rollTies: (uuids) => this.#authority.rollTiebreak(uuids, "foundation-order")
    });
    record("Order uses distance before Dexterity", ordered[0]?.reactorTokenUuid === tokens.reactor1.uuid, ordered.map(this.#orderSummary));
    record("Equal-distance order uses higher Dexterity", ordered.findIndex(entry => entry.reactorTokenUuid === tokens.reactor2.uuid)
      < ordered.findIndex(entry => entry.reactorTokenUuid === tokens.reactor3.uuid), ordered.map(this.#orderSummary));

    let tieRound = 0;
    const tieOpportunities = [tokens.reactor1, tokens.reactor2, tokens.reactor3].map((token, index) => ({
      reactorTokenUuid: token.uuid,
      reactorName: token.name,
      tokenDocument: token,
      actor: { system: { abilities: { dex: { value: 10 } } } },
      offers: [{ id: `tie-${index}` }]
    }));
    const scriptedRolls = [
      [12, 12, 4],
      [7, 18]
    ];
    const tieOrdered = await this.#ordering.order(tieOpportunities, {
      sourceToken: null,
      scene: canvas.scene,
      rollTies: async (uuids) => {
        const values = scriptedRolls[tieRound++] ?? uuids.map(() => 10);
        return { rolls: Object.fromEntries(uuids.map((uuid, index) => [uuid, values[index]])) };
      }
    });
    record("d20 tie rerolls only unresolved tie and preserves prior precedence", tieOrdered[0].reactorTokenUuid === tokens.reactor2.uuid
      && tieOrdered[1].reactorTokenUuid === tokens.reactor1.uuid
      && tieOrdered[2].reactorTokenUuid === tokens.reactor3.uuid, tieOrdered.map(this.#orderSummary));

    const tx = new ReactionTransaction({ context });
    const childContext = ReactionContext.synthetic({
      trigger: REACTION_TRIGGERS.SPELL_CAST,
      eventKey: `ae5e-child:${tx.id}`,
      parentTransactionId: tx.id,
      rootTransactionId: tx.rootTransactionId,
      source: { tokenUuid: tokens.reactor1.uuid }
    });
    const child = new ReactionTransaction({ context: childContext });
    record("Nested transaction lineage is LIFO-capable", child.parentTransactionId === tx.id && child.rootTransactionId === tx.rootTransactionId, {
      parent: tx.toJSON(), child: child.toJSON()
    });

    const duplicateContext = ReactionContext.synthetic({
      trigger: REACTION_TRIGGERS.SPELL_CAST,
      eventKey: `ae5e-duplicate:${Date.now()}`,
      source: { tokenUuid: tokens.attacker.uuid },
      data: { ae5eTest: true, syntheticOffers: {} },
      live: { token: tokens.attacker }
    });
    const beforeDuplicate = this.#broker.getStats().duplicateEvents;
    const [duplicateA, duplicateB] = await Promise.all([
      this.#broker.process(duplicateContext, { tokenDocuments: [] }),
      this.#broker.process(duplicateContext, { tokenDocuments: [] })
    ]);
    const afterDuplicate = this.#broker.getStats().duplicateEvents;
    record("Duplicate event joins one in-flight transaction", afterDuplicate === beforeDuplicate + 1
      && duplicateA.reason === duplicateB.reason, { beforeDuplicate, afterDuplicate, duplicateA, duplicateB });

    let normalizedCount = 0;
    const eventHook = Hooks.on(`${MODULE_ID}.reactionEvent`, () => { normalizedCount += 1; });
    try {
      const fakeSpellWorkflow = {
        id: `ae5e-fake-midi-${Date.now()}`,
        userId: game.user.id,
        item: { type: "spell", name: "AE5E Fake Spell", uuid: "Item.ae5e-fake-spell", actor: { uuid: "Actor.ae5e-fake-attacker", name: NAMES.attacker } },
        actor: { uuid: "Actor.ae5e-fake-attacker", name: NAMES.attacker },
        token: tokens.attacker
      };
      const adapterResult = await this.#events.processMidiSpellWorkflow(fakeSpellWorkflow);
      record("One spell workflow creates exactly one normalized spellCast event", adapterResult === true && normalizedCount === 1, { adapterResult, normalizedCount });
      const beforeNonSpell = normalizedCount;
      const nonSpellResult = await this.#events.processMidiSpellWorkflow({ id: "ae5e-fake-feature", userId: game.user.id, item: { type: "feat" } });
      record("Non-spell workflow creates no spellCast event", nonSpellResult === true && normalizedCount === beforeNonSpell, { nonSpellResult, normalizedCount });
    } finally {
      Hooks.off(`${MODULE_ID}.reactionEvent`, eventHook);
    }

    const selectionStats = this.#selectionIndicator.getStats();
    record("No stale Reaction Broker indicator leases after noninteractive test", selectionStats.activeLeases === 0, selectionStats);
    record("No stale Reaction Broker dialogs after noninteractive test", this.#dialogs.getStats().openHosts === 0, this.#dialogs.getStats());

    const passed = checks.every(entry => entry.passed);
    this.#banner(`AE5E 0.3.28 REACTION BROKER FOUNDATION — ${passed ? "PASS" : "FAIL"}`, passed ? "#5cff8d" : "#ff5c5c", 30);
    console.table(checks.map(entry => ({ test: entry.name, result: entry.passed ? "PASS" : "FAIL" })));
    const report = { result: passed ? "PASS" : "FAIL", checks, broker: this.#broker.getStats(), authority: this.#authority.getStatus(), eventAdapter: this.#events.getStats() };
    console.log("AE5E Reaction Broker foundation full result", report);
    ui?.notifications?.[passed ? "info" : "error"]?.(`AE5E | Reaction Broker foundation ${passed ? "PASSED" : "FAILED"}. See console.`);
    return report;
    } finally {
      await this.#dialogs.closeAllEverywhere({ reason: "foundation-test-cleanup" }).catch(() => null);
      await this.#uninstallHandlersEverywhere();
    }
  }

  async runInteractiveTest({ setup = true, nested = false, distributed = false } = {}) {
    if (setup && game.user.isGM) await this.setupTestScene({ activate: true });
    await this.#requireTestSceneReady();
    if (!this.#authority.hasActiveGm()) throw new Error("An active GM is required for the interactive Reaction Broker test.");
    await this.#installHandlersEverywhere();
    try {

    const tokens = this.#fixtureTokens();
    if (!tokens.attacker || !tokens.reactor1 || !tokens.reactor2 || !tokens.reactor3) throw new Error("Reaction Broker fixture tokens are missing. Run setupReactionBrokerTestScene().");
    const eventKey = `ae5e-interactive:${Date.now()}`;
    const offers = {
      reactor1: nested
        ? [TEST_HANDLERS.NESTED, TEST_HANDLERS.CONTINUE]
        : [TEST_HANDLERS.CONTINUE, TEST_HANDLERS.ABORT],
      reactor2: [TEST_HANDLERS.CONTINUE],
      reactor3: [TEST_HANDLERS.CONTINUE]
    };
    const context = this.#syntheticContext(tokens, { eventKey, offers, nested });

    this.#banner(`AE5E 0.3.28 REACTION BROKER ${nested ? "NESTED " : ""}INTERACTIVE TEST`, "#7ddcff", 28);
    console.log("Expected UI: all three Reactors receive a Broker window immediately; only the ACTIVE Reactor has the animated indicator. The remaining windows say to wait.");
    console.log("Choose reactions/Do not use a reaction in sequence. WAITING Reactors may press Decline to remove only themselves from the remaining queue. Cancel means manual adjudication, not decline.");

    const beforeDialogs = this.#dialogs.getStats();
    const beforeSelection = this.#selectionIndicator.getStats();
    const result = await this.#broker.process(context, {
      tokenDocuments: [tokens.reactor3, tokens.nonReactor, tokens.reactor1, tokens.reactor2].filter(Boolean),
      scene: canvas.scene,
      sourceStillValid: () => true
    });
    const recent = this.#broker.getRecentTransactions();
    const transaction = recent.find(entry => entry.eventKey === eventKey) ?? recent[0] ?? null;
    const selection = this.#selectionIndicator.getStats();
    const dialogs = this.#dialogs.getStats();
    const dialogDelta = {
      hostsOpened: dialogs.hostsOpened - beforeDialogs.hostsOpened,
      waits: dialogs.waits - beforeDialogs.waits,
      prompts: dialogs.prompts - beforeDialogs.prompts,
      indicatorAcquires: dialogs.indicatorAcquires - beforeDialogs.indicatorAcquires,
      notificationSoundsRequested: selection.soundsPlayed - beforeSelection.soundsPlayed
    };
    const checks = {
      transactionCompleted: Boolean(transaction?.completedAt),
      frozenOrderStartsWithClosest: transaction?.opportunities?.[0]?.reactorTokenUuid === tokens.reactor1.uuid,
      secondBeforeThirdByDex: transaction?.opportunities?.findIndex(entry => entry.reactorTokenUuid === tokens.reactor2.uuid)
        < transaction?.opportunities?.findIndex(entry => entry.reactorTokenUuid === tokens.reactor3.uuid),
      ...(distributed ? {
        distributedUiValidatedByMultiplayerAggregator: true
      } : {
        threeBrokerHostsActuallyOpened: dialogDelta.hostsOpened >= 3,
        allThreeReactorsEnteredWaitingUi: dialogDelta.waits >= 3
      }),
      atLeastOneActivePromptActuallyOpened: dialogDelta.prompts >= 1,
      activeReactorIndicatorActuallyAcquired: dialogDelta.indicatorAcquires >= 1,
      activeReactorNotificationSoundRequested: dialogDelta.indicatorAcquires >= 1
        && dialogDelta.notificationSoundsRequested >= dialogDelta.indicatorAcquires,
      noBrokerErrorRecovery: result?.reason !== "broker-error",
      noStaleIndicatorLease: selection.activeLeases === (beforeSelection.activeLeases ?? 0),
      noStaleDialogHost: dialogs.openHosts === 0,
      resultContractValid: [REACTION_SOURCE_RESULTS.RESUME, REACTION_SOURCE_RESULTS.ABORT].includes(result?.source)
    };
    let nestedChronology = null;
    if (nested) {
      const child = recent.find(entry => entry.parentTransactionId === transaction?.id) ?? null;
      const parentHistory = transaction?.history ?? [];
      const nestedResolveStart = parentHistory.find(entry => entry.type === "state"
        && entry.details?.state === REACTION_TRANSACTION_STATES.RESOLVING
        && entry.details?.selectedHandler === TEST_HANDLERS.NESTED) ?? null;
      const nestedReactionResult = parentHistory.find(entry => entry.type === "reaction-result"
        && entry.details?.selectedHandler === TEST_HANDLERS.NESTED) ?? null;
      const parentPostChildWaiting = parentHistory.find(entry => entry.type === "state"
        && entry.details?.state === REACTION_TRANSACTION_STATES.WAITING
        && Number(entry.details?.nextIndex) > 0
        && (!nestedReactionResult || Date.parse(entry.at) >= Date.parse(nestedReactionResult.at))) ?? null;
      const parentNextActivation = parentHistory.find(entry => entry.type === "state"
        && entry.details?.state === REACTION_TRANSACTION_STATES.ACTIVE
        && Number(entry.details?.index) > 0) ?? null;

      const time = value => value ? Date.parse(value) : Number.NaN;
      const parentResolveAt = time(nestedResolveStart?.at);
      const childCreatedAt = time(child?.createdAt);
      const childCompletedAt = time(child?.completedAt);
      const parentResultAt = time(nestedReactionResult?.at);
      const parentWaitingAt = time(parentPostChildWaiting?.at);
      const parentNextActiveAt = time(parentNextActivation?.at);
      const parentCompletedAt = time(transaction?.completedAt);

      checks.nestedChildRecorded = Boolean(child);
      checks.nestedChildParentLinkCorrect = child?.parentTransactionId === transaction?.id;
      checks.nestedChildRootLinkCorrect = child?.rootTransactionId === transaction?.rootTransactionId;
      checks.nestedChildCompleted = Boolean(child?.completedAt);
      checks.parentEnteredResolvingBeforeChild = Number.isFinite(parentResolveAt)
        && Number.isFinite(childCreatedAt)
        && parentResolveAt <= childCreatedAt;
      checks.childCompletedBeforeParentRecordedNestedResult = Number.isFinite(childCompletedAt)
        && Number.isFinite(parentResultAt)
        && childCompletedAt <= parentResultAt;
      checks.parentResumedAfterChildCompleted = Number.isFinite(childCompletedAt)
        && Number.isFinite(parentWaitingAt)
        && childCompletedAt <= parentWaitingAt;
      checks.parentDidNotAdvanceNextReactorBeforeChildCompleted = !Number.isFinite(parentNextActiveAt)
        || (Number.isFinite(childCompletedAt) && childCompletedAt <= parentNextActiveAt);
      checks.parentCompletedAfterChild = Number.isFinite(childCompletedAt)
        && Number.isFinite(parentCompletedAt)
        && childCompletedAt <= parentCompletedAt;

      nestedChronology = {
        parentTransactionId: transaction?.id ?? null,
        childTransactionId: child?.id ?? null,
        rootTransactionId: transaction?.rootTransactionId ?? null,
        parentResolveAt: nestedResolveStart?.at ?? null,
        childCreatedAt: child?.createdAt ?? null,
        childCompletedAt: child?.completedAt ?? null,
        parentNestedResultAt: nestedReactionResult?.at ?? null,
        parentWaitingAfterChildAt: parentPostChildWaiting?.at ?? null,
        parentNextActivationAt: parentNextActivation?.at ?? null,
        parentCompletedAt: transaction?.completedAt ?? null
      };
    }
    const passed = Object.values(checks).every(Boolean);
    this.#banner(`INTERACTIVE REACTION BROKER — ${passed ? "PASS" : "FAIL"}`, passed ? "#5cff8d" : "#ff5c5c", 28);
    console.table(Object.entries(checks).map(([test, ok]) => ({ test, result: ok ? "PASS" : "FAIL" })));
    console.log({ result, transaction, recent, selection, dialogs, dialogDelta, nestedChronology });
    if (nestedChronology) console.log("AE5E nested transaction chronology", nestedChronology);
    return { result: passed ? "PASS" : "FAIL", checks, brokerResult: result, transaction, recent, dialogDelta, nestedChronology };
    } finally {
      await this.#dialogs.closeAllEverywhere({ reason: "interactive-test-cleanup" }).catch(() => null);
      await this.#uninstallHandlersEverywhere();
    }
  }

  async runMidiWorkflowGateTest({ setup = true, mode = "resume", timeoutMs = 600_000 } = {}) {
    if (!["resume", "abort"].includes(mode)) throw new Error("Reaction Broker Midi gate mode must be 'resume' or 'abort'.");
    if (setup && game.user.isGM) await this.setupTestScene({ activate: true });
    await this.#requireTestSceneReady();
    if (!this.#authority.hasActiveGm()) throw new Error("An active GM is required for the live Midi workflow gate test.");

    const existingProbe = this.#events.getTestProbeStatus();
    if (existingProbe && ["armed", "running"].includes(existingProbe.status)) {
      const ageSeconds = Math.max(0, Math.floor((Date.now() - Number(existingProbe.armedAt ?? Date.now())) / 1000));
      throw new Error(`A Reaction Broker Midi test probe is already ${existingProbe.status} (${ageSeconds}s old). Use the already-armed probe, or run ae5e.tests.clearReactionBrokerTestState() before arming another.`);
    }

    const tokens = this.#fixtureTokens();
    if (!tokens.reactor1) throw new Error("Reaction Broker fixture Reactor 1 is missing. Run setupReactionBrokerTestScene().");
    await this.#installHandlersEverywhere();

    let postHook = null;
    let probe = null;
    try {
      const handler = mode === "abort" ? TEST_HANDLERS.ABORT : TEST_HANDLERS.CONTINUE;
      const syntheticOffers = { [tokens.reactor1.uuid]: [{ handler }] };
      const postPreambleEvents = [];
      postHook = Hooks.on("midi-qol.postPreambleComplete", (workflow) => {
        postPreambleEvents.push({
          workflowId: workflow?.id ?? workflow?.workflowId ?? workflow?.itemCardUuid ?? workflow?.uuid ?? null,
          at: Date.now()
        });
      });

      // Arm before announcing the mode. If another probe somehow appears between
      // the preflight check and this call, the surrounding finally block still
      // removes this invocation's temporary hooks/handlers.
      probe = this.#events.armTestSpellProbe({ syntheticOffers, timeoutMs });

      this.#banner(`AE5E 0.3.28 LIVE MIDI GATE — ${mode.toUpperCase()}`, "#7ddcff", 28);
      const attacker = tokens.attacker?.actor;
      const probeSpell = [...(attacker?.items ?? [])].find(item => item.getFlag?.(MODULE_ID, FIXTURE_FLAG) === "midiGateProbe")
        ?? [...(attacker?.items ?? [])].find(item => item.name?.startsWith?.("AE5E Reaction Gate Probe"));
      const instruction = probeSpell
        ? `Use '${probeSpell.name}' from ${attacker.name} on THIS client now.`
        : "Cast any real spell from a token on THIS client now. The next local Midi spell workflow will be used as the probe.";
      const timeoutMinutes = Math.max(1, Math.round((Number(timeoutMs) || 600_000) / 60_000));
      console.warn(instruction);
      console.warn(`The live probe remains armed for approximately ${timeoutMinutes} minute(s).`);
      console.warn(mode === "abort"
        ? "Choose the Abort Source Test Reaction. The live spell must not advance to Midi postPreambleComplete."
        : "Choose Continue Test Reaction or Do not use a reaction. The live spell must remain gated until the Broker closes, then advance to Midi postPreambleComplete.");
      ui?.notifications?.info?.(`AE5E Reaction Broker live Midi test armed for ~${timeoutMinutes} minutes. ${instruction}`);

      const outcome = await probe.promise;
      await new Promise(resolve => setTimeout(resolve, 750));
      const post = postPreambleEvents.find(entry => entry.workflowId && entry.workflowId === outcome.sourceWorkflowId) ?? null;
      const checks = {
        matchingSpellObserved: outcome.status === "complete" && Boolean(outcome.startedAt),
        brokerActuallyWaited: Boolean(outcome.startedAt && outcome.brokerCompletedAt && Number(outcome.brokerCompletedAt) >= Number(outcome.startedAt)),
        requestedSourceContract: mode === "abort"
          ? outcome.result?.source === REACTION_SOURCE_RESULTS.ABORT
          : outcome.result?.source === REACTION_SOURCE_RESULTS.RESUME,
        midiBoundaryBehavior: mode === "abort"
          ? post === null
          : Boolean(post && post.at >= outcome.brokerCompletedAt),
        noStaleIndicatorLease: this.#selectionIndicator.getStats().activeLeases === 0,
        noStaleDialogHost: this.#dialogs.getStats().openHosts === 0
      };
      const passed = Object.values(checks).every(Boolean);
      this.#banner(`LIVE MIDI WORKFLOW GATE — ${passed ? "PASS" : "FAIL"}`, passed ? "#5cff8d" : "#ff5c5c", 28);
      console.table(Object.entries(checks).map(([test, ok]) => ({ test, result: ok ? "PASS" : "FAIL" })));
      if (outcome.status !== "complete") console.warn("AE5E live Midi probe did not observe a matching completed spell workflow.", outcome);
      console.log({ mode, outcome, postPreamble: post, allPostPreambleEvents: postPreambleEvents });
      return { result: passed ? "PASS" : "FAIL", mode, checks, outcome, postPreamble: post };
    } finally {
      if (postHook !== null) Hooks.off("midi-qol.postPreambleComplete", postHook);
      const activeProbe = this.#events.getTestProbeStatus();
      if (probe && activeProbe?.id === probe.id && ["armed", "running"].includes(activeProbe.status)) {
        this.#events.clearTestSpellProbe("live-midi-test-cleanup");
      }
      await this.#dialogs.closeAllEverywhere({ reason: "live-midi-test-cleanup" }).catch(() => null);
      await this.#uninstallHandlersEverywhere();
    }
  }

  async runMultiplayerTest({
    setup = true,
    testDisconnectRecovery = false,
    testControllerDisconnectRecovery = false
  } = {}) {
    if (setup) {
      if (!game?.user?.isGM) throw new Error("A GM must create/refresh the Reaction Broker fixture first. Run the player-side multiplayer test with setup: false.");
      await this.setupTestScene({ activate: true });
    }
    await this.#requireTestSceneReady();

    const activePlayers = [...(game.users ?? [])].filter(user => user.active && !user.isGM);
    if (!activePlayers.length) throw new Error("Connect at least one player client before running the multiplayer Reaction Broker test.");
    if (!this.#authority.hasActiveGm()) throw new Error("Start this test while at least one GM is connected.");

    await this.#authority.refreshLedger();
    const primaryGm = this.#authority.getPrimaryGm();
    if (!primaryGm?.id) throw new Error("Reaction Broker multiplayer test could not resolve the elected primary GM.");

    const player = game?.user && !game.user.isGM
      ? game.user
      : activePlayers[0];
    const routingFixture = game?.user?.isGM
      ? await this.#prepareMultiplayerOwnership(player)
      : await this.#socket.executeAsGM("reactions.tests.prepareMultiplayerOwnership", { playerId: player.id });
    const observedUsers = [primaryGm, player];
    const before = await this.#collectClientStatuses(observedUsers);

    this.#banner("AE5E 0.3.28 REACTION BROKER MULTIPLAYER TEST", "#7ddcff", 28);
    console.log(`Routing fixture: ${NAMES.reactor1} is owned by player '${player.name}'. ${NAMES.reactor2} and ${NAMES.reactor3} are GM-routed.`);
    console.log("Expected normal routing: Reactor 1 window appears only on the player client; Reactors 2 and 3 appear on the elected GM client. Do not stop the queue early during this baseline routing test.");
    if (testDisconnectRecovery) {
      console.warn("DISCONNECT RECOVERY MODE: while the first active Reactor is choosing, disconnect/refresh the LAST connected GM. OK must disable with the agreed warning. Reconnect a GM to resume, or click Cancel to switch to manual adjudication.");
    }
    if (testControllerDisconnectRecovery) {
      console.warn("CONTROLLER DISCONNECT MODE: while the PLAYER-owned Reactor 1 is ACTIVE, disconnect/refresh that player. The source workflow must not hang. AE5E must revalidate the same frozen Reactor slot and reroute its prompt to the elected GM without recording a decline.");
    }

    try {
      const interactive = await this.runInteractiveTest({ setup: false, nested: false, distributed: true });
      const after = await this.#collectClientStatuses(observedUsers);
      const deltas = this.#clientStatusDeltas(before, after);

      const playerDelta = deltas[player.id]?.dialogs ?? {};
      const gmDelta = deltas[primaryGm.id]?.dialogs ?? {};
      const baselineRouting = !testDisconnectRecovery && !testControllerDisconnectRecovery;
      const routingChecks = baselineRouting ? {
        playerReceivedExactlyOneFixtureHost: Number(playerDelta.hostsOpened ?? 0) === 1,
        playerReceivedActivePrompt: Number(playerDelta.prompts ?? 0) >= 1,
        playerReceivedActiveIndicator: Number(playerDelta.indicatorAcquires ?? 0) >= 1,
        gmReceivedTwoFixtureHosts: Number(gmDelta.hostsOpened ?? 0) === 2,
        gmReceivedWaitingViews: Number(gmDelta.waits ?? 0) >= 2,
        gmEventuallyReceivedActivePrompt: Number(gmDelta.prompts ?? 0) >= 1
      } : {};
      const routingPassed = baselineRouting ? Object.values(routingChecks).every(Boolean) : true;
      const overallPassed = interactive?.result === "PASS" && routingPassed;

      this.#banner(`${baselineRouting ? "MULTIPLAYER ROUTING" : "MULTIPLAYER RECOVERY"} — ${overallPassed ? "PASS" : "FAIL"}`, overallPassed ? "#5cff8d" : "#ff5c5c", 28);
      if (baselineRouting) console.table(Object.entries(routingChecks).map(([test, ok]) => ({ test, result: ok ? "PASS" : "FAIL" })));
      console.log("AE5E multiplayer client routing deltas", { player: { id: player.id, name: player.name, delta: playerDelta }, primaryGm: { id: primaryGm.id, name: primaryGm.name, delta: gmDelta } });

      return {
        ...interactive,
        result: overallPassed ? "PASS" : "FAIL",
        routingChecks,
        routingFixture,
        clientDeltas: deltas
      };
    } finally {
      const restore = game?.user?.isGM
        ? this.#restoreMultiplayerOwnership()
        : this.#socket.executeAsGM("reactions.tests.restoreMultiplayerOwnership");
      await restore.catch(error => Logger.warn("Could not restore Reaction Broker multiplayer fixture ownership after test. Run clearReactionBrokerTestState() from a GM after reconnecting.", error));
    }
  }

  async runNoGmTest() {
    if (this.#authority.hasActiveGm()) throw new Error("The no-GM bypass test must be run from a player client while no GM is connected.");
    this.#installHandlersSocket();
    try {
    const context = ReactionContext.synthetic({
      trigger: REACTION_TRIGGERS.SPELL_CAST,
      eventKey: `ae5e-no-gm:${Date.now()}`,
      coordinatorUserId: game.user.id,
      data: { ae5eTest: true, syntheticOffers: {} }
    });
    const result = await this.#broker.process(context, { tokenDocuments: [] });
    const passed = result?.source === REACTION_SOURCE_RESULTS.RESUME && result?.reason === "no-active-gm" && this.#dialogs.getStats().openHosts === 0;
    this.#banner(`NO-GM BYPASS — ${passed ? "PASS" : "FAIL"}`, passed ? "#5cff8d" : "#ff5c5c", 26);
    console.log({ result, dialogs: this.#dialogs.getStats(), broker: this.#broker.getStats() });
    return { result: passed ? "PASS" : "FAIL", brokerResult: result };
    } finally {
      await this.#dialogs.closeAllLocal({ reason: "no-gm-test-cleanup" }).catch(() => null);
      this.#uninstallHandlersSocket();
    }
  }


  async clearTestState({ removeFixture = false } = {}) {
    await this.#dialogs.closeAllEverywhere({ reason: "reaction-broker-test-clear" }).catch(() => null);
    await this.#uninstallHandlersEverywhere();
    const ownershipRestore = game?.user?.isGM
      ? await this.#restoreMultiplayerOwnership().catch(error => ({ restored: 0, error: error?.message ?? String(error) }))
      : { restored: 0, skipped: "not-gm" };

    if (removeFixture) {
      if (!game?.user?.isGM) throw new Error("A GM is required to remove the Reaction Broker test fixture.");
      const scene = game.scenes?.find?.(entry => entry.name === FIXTURE_SCENE_NAME) ?? null;
      if (scene) await scene.delete();
      const actors = [...(game.actors ?? [])].filter(actor => actor.getFlag?.(MODULE_ID, FIXTURE_FLAG));
      if (actors.length) await Actor.deleteDocuments(actors.map(actor => actor.id));
    }

    const report = {
      handlers: this.#registry.getStats(),
      dialogs: this.#dialogs.getStats(),
      selection: this.#selectionIndicator.getStats(),
      ownershipRestore,
      fixtureRemoved: Boolean(removeFixture)
    };
    this.#banner("AE5E REACTION BROKER TEST STATE CLEARED", "#7ddcff", 24);
    console.log(report);
    return report;
  }

  inspect() {
    const report = {
      authority: this.#authority.getStatus(),
      registry: this.#registry.getStats(),
      broker: this.#broker.getStats(),
      dialogs: this.#dialogs.getStats(),
      events: this.#events.getStats(),
      selection: this.#selectionIndicator.getStats(),
      recentTransactions: this.#broker.getRecentTransactions()
    };
    console.log("AE5E 0.3.28 Reaction Broker inspection", report);
    return report;
  }

  async #prepareMultiplayerOwnershipSocket({ playerId } = {}) {
    if (!game?.user?.isGM) throw new Error("Only a GM client may prepare Reaction Broker multiplayer fixture ownership.");
    const player = game?.users?.get?.(playerId) ?? null;
    return this.#prepareMultiplayerOwnership(player);
  }

  async #prepareMultiplayerOwnership(player) {
    if (!game?.user?.isGM) throw new Error("A GM is required to configure Reaction Broker multiplayer fixture ownership.");
    if (!player?.id || player.isGM || !player.active) throw new Error("A connected non-GM player is required for multiplayer ownership routing.");

    const tokens = this.#fixtureTokens();
    const desired = {
      reactor1: player.id,
      reactor2: null,
      reactor3: null
    };
    const summary = {};

    for (const [key, ownerUserId] of Object.entries(desired)) {
      const actor = tokens[key]?.actor ?? null;
      if (!actor) throw new Error(`Reaction Broker multiplayer fixture is missing actor '${key}'.`);

      const existingBackup = actor.getFlag?.(MODULE_ID, MULTIPLAYER_OWNERSHIP_BACKUP_FLAG) ?? null;
      if (!existingBackup) {
        const backup = globalThis.foundry?.utils?.deepClone
          ? foundry.utils.deepClone(actor.ownership ?? {})
          : JSON.parse(JSON.stringify(actor.ownership ?? {}));
        await actor.setFlag(MODULE_ID, MULTIPLAYER_OWNERSHIP_BACKUP_FLAG, backup);
      }

      await this.#replaceActorOwnership(actor, ownerUserId);
      summary[key] = { actorUuid: actor.uuid, ownerUserId, ownership: { ...(actor.ownership ?? {}) } };
    }

    return { playerId: player.id, playerName: player.name, actors: summary };
  }

  async #restoreMultiplayerOwnership() {
    if (!game?.user?.isGM) return { restored: 0, skipped: "not-gm" };
    const actors = [...(game.actors ?? [])].filter(actor => actor.getFlag?.(MODULE_ID, MULTIPLAYER_OWNERSHIP_BACKUP_FLAG));
    let restored = 0;
    for (const actor of actors) {
      const backup = actor.getFlag(MODULE_ID, MULTIPLAYER_OWNERSHIP_BACKUP_FLAG);
      if (!backup || typeof backup !== "object") continue;
      await this.#replaceActorOwnership(actor, null, backup);
      await actor.unsetFlag(MODULE_ID, MULTIPLAYER_OWNERSHIP_BACKUP_FLAG);
      restored += 1;
    }
    return { restored };
  }

  async #replaceActorOwnership(actor, ownerUserId = null, explicitOwnership = null) {
    const NONE = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.NONE ?? 0;
    const OWNER = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
    if (!actor?.update) throw new Error("Reaction Broker multiplayer ownership update requires a valid Actor document.");

    const source = explicitOwnership && typeof explicitOwnership === "object"
      ? explicitOwnership
      : { default: NONE, ...(ownerUserId ? { [ownerUserId]: OWNER } : {}) };
    const target = {};
    for (const [key, rawLevel] of Object.entries(source ?? {})) {
      const level = Number(rawLevel);
      if (!Number.isInteger(level)) throw new Error(`Invalid ownership level '${rawLevel}' for '${key}'.`);
      target[String(key)] = level;
    }
    if (!("default" in target)) target.default = NONE;

    // Foundry v14 validates ownership as a complete userId -> permission mapping.
    // Replace the inner object atomically rather than using flattened -= deletion keys,
    // which DataModel validation interprets as invalid ownership-map entries.
    await actor.update({ ownership: target }, { diff: false, recursive: false });

    const actual = Object.fromEntries(Object.entries(actor.ownership ?? {}).map(([key, value]) => [key, Number(value)]));
    const actualKeys = Object.keys(actual).sort();
    const targetKeys = Object.keys(target).sort();
    const matches = actualKeys.length === targetKeys.length
      && actualKeys.every((key, index) => key === targetKeys[index] && actual[key] === target[key]);
    if (!matches) {
      throw new Error(`Reaction Broker multiplayer ownership replacement did not persist as requested for '${actor.name}'.`);
    }
    return actual;
  }

  #getClientStatusSocket() {
    return {
      user: { id: game?.user?.id ?? null, name: game?.user?.name ?? null, isGM: Boolean(game?.user?.isGM) },
      dialogs: this.#dialogs.getStats(),
      selection: this.#selectionIndicator.getStats()
    };
  }

  async #collectClientStatuses(users) {
    const result = {};
    for (const user of users ?? []) {
      if (!user?.id || !user.active) continue;
      result[user.id] = await this.#socket.executeAsUser("reactions.tests.getClientStatus", user.id);
    }
    return result;
  }

  #clientStatusDeltas(before, after) {
    const result = {};
    const dialogCounters = ["hostsOpened", "prompts", "waits", "responses", "manualCancels", "waitingDeclines", "indicatorAcquires", "indicatorReleases", "authorityWaits"];
    for (const [userId, afterStatus] of Object.entries(after ?? {})) {
      const beforeStatus = before?.[userId] ?? {};
      const dialogs = {};
      for (const key of dialogCounters) dialogs[key] = Number(afterStatus?.dialogs?.[key] ?? 0) - Number(beforeStatus?.dialogs?.[key] ?? 0);
      result[userId] = { user: afterStatus.user, dialogs };
    }
    return result;
  }

  async #installHandlersEverywhere() {
    if (!this.#socket.ready) throw new Error("Socketlib must be ready before installing Reaction Broker test handlers.");
    await this.#socket.executeForEveryone("reactions.tests.installHandlers");
  }

  async #uninstallHandlersEverywhere() {
    if (!this.#socket.ready) return;
    await this.#socket.executeForEveryone("reactions.tests.uninstallHandlers").catch(() => null);
  }

  #installHandlersSocket() {
    const register = (id, config) => {
      if (this.#registry.get(id)) return;
      this.#registry.registerHandler(id, config);
    };
    const eligibility = ({ context }) => context?.data?.ae5eTest === true;
    register(TEST_HANDLERS.CONTINUE, {
      trigger: REACTION_TRIGGERS.SPELL_CAST,
      label: "Continue Test Reaction",
      eligibility,
      resolve: async () => ({ source: REACTION_SOURCE_RESULTS.RESUME, continueCandidates: true, reason: "test-continue" })
    });
    register(TEST_HANDLERS.STOP, {
      trigger: REACTION_TRIGGERS.SPELL_CAST,
      label: "Stop Reactor Queue Test Reaction",
      eligibility,
      resolve: async () => ({ source: REACTION_SOURCE_RESULTS.RESUME, continueCandidates: false, reason: "test-stop" })
    });
    register(TEST_HANDLERS.ABORT, {
      trigger: REACTION_TRIGGERS.SPELL_CAST,
      label: "Abort Source Test Reaction",
      eligibility,
      resolve: async () => ({ source: REACTION_SOURCE_RESULTS.ABORT, continueCandidates: false, reason: "test-abort" })
    });
    register(TEST_HANDLERS.NESTED, {
      trigger: REACTION_TRIGGERS.SPELL_CAST,
      label: "Nested Reaction Test",
      eligibility,
      resolve: async ({ context, transaction, opportunity }) => {
        const nestedOffers = context.data?.nestedSyntheticOffers ?? {};
        const child = ReactionContext.synthetic({
          trigger: REACTION_TRIGGERS.SPELL_CAST,
          eventKey: `ae5e-nested:${transaction.id}:${Date.now()}`,
          coordinatorUserId: game.user.id,
          parentTransactionId: transaction.id,
          rootTransactionId: transaction.rootTransactionId,
          source: {
            actorUuid: opportunity.reactorActorUuid,
            tokenUuid: opportunity.reactorTokenUuid,
            actorName: opportunity.reactorName,
            tokenName: opportunity.reactorName,
            itemName: "Nested Reaction Test"
          },
          data: { ae5eTest: true, syntheticOffers: nestedOffers },
          live: { token: opportunity.tokenDocument }
        });
        const childResult = await this.#broker.process(child, { scene: canvas.scene, sourceStillValid: () => true });
        return {
          source: childResult.source === REACTION_SOURCE_RESULTS.ABORT ? REACTION_SOURCE_RESULTS.RESUME : REACTION_SOURCE_RESULTS.RESUME,
          continueCandidates: true,
          reason: "test-nested-complete",
          childWorkflowId: child.id
        };
      }
    });
    return { installed: true, handlers: Object.values(TEST_HANDLERS) };
  }

  #uninstallHandlersSocket() {
    let removed = 0;
    for (const id of Object.values(TEST_HANDLERS)) if (this.#registry.unregisterHandler(id)) removed += 1;
    return { removed };
  }

  #syntheticContext(tokens, { eventKey, offers, nested = false }) {
    const syntheticOffers = {};
    for (const [key, handlers] of Object.entries(offers ?? {})) {
      const token = tokens[key];
      if (!token) continue;
      syntheticOffers[token.uuid] = handlers.map(handler => ({ handler }));
    }
    const nestedSyntheticOffers = nested && tokens.reactor2
      ? { [tokens.reactor2.uuid]: [{ handler: TEST_HANDLERS.CONTINUE, label: "Counter-Reaction Test" }] }
      : {};
    return ReactionContext.synthetic({
      trigger: REACTION_TRIGGERS.SPELL_CAST,
      eventKey,
      coordinatorUserId: game.user.id,
      source: {
        actorUuid: tokens.attacker.actor?.uuid ?? null,
        tokenUuid: tokens.attacker.uuid,
        actorName: tokens.attacker.actor?.name ?? NAMES.attacker,
        tokenName: tokens.attacker.name ?? NAMES.attacker,
        itemName: "Synthetic Trigger Activity"
      },
      data: { ae5eTest: true, syntheticOffers, nestedSyntheticOffers },
      live: { token: tokens.attacker }
    });
  }

  async #ensureProbeSpell(actor) {
    if (!actor) return null;
    const existing = [...(actor.items ?? [])].find(item => item.name?.startsWith?.("AE5E Reaction Gate Probe"));
    if (existing) return existing;

    const packs = [...(game.packs ?? [])].filter(pack => pack.documentName === "Item" && pack.metadata?.packageName === "dnd5e");
    const preferredNames = ["Blade Ward", "Druidcraft", "Prestidigitation", "Light", "Message"];
    let source = null;
    for (const pack of packs) {
      try {
        const index = await pack.getIndex({ fields: ["type", "system.level"] });
        const spells = [...index].filter(entry => entry.type === "spell" && Number(entry.system?.level ?? 0) === 0);
        const candidate = preferredNames.map(name => spells.find(entry => entry.name === name)).find(Boolean) ?? spells[0];
        if (!candidate) continue;
        source = await pack.getDocument(candidate._id);
        if (source) break;
      } catch {
        // Continue through available core D&D5e Item packs.
      }
    }
    if (!source) {
      Logger.warn("Reaction Broker test fixture could not find a D&D5e cantrip to clone for the live Midi gate probe. Use any real spell from another token for that test.");
      return null;
    }

    const data = source.toObject();
    delete data._id;
    data.name = `AE5E Reaction Gate Probe — ${source.name}`;
    data.flags ??= {};
    data.flags[MODULE_ID] ??= {};
    data.flags[MODULE_ID][FIXTURE_FLAG] = "midiGateProbe";
    const [created] = await actor.createEmbeddedDocuments("Item", [data]);
    return created ?? null;
  }

  async #requireTestSceneReady({ timeoutMs = 30_000 } = {}) {
    const scene = game.scenes?.find?.(entry => entry.name === FIXTURE_SCENE_NAME) ?? null;
    if (!scene) throw new Error("Reaction Broker test Scene is missing. Run setupReactionBrokerTestScene().");

    if (canvas?.ready && canvas?.scene?.id === scene.id) return scene;
    if (!scene.active) throw new Error("Activate the AE5E Reaction Broker test Scene first.");

    await this.#waitForSceneCanvas(scene, { timeoutMs });
    return scene;
  }

  async #waitForSceneCanvas(scene, { timeoutMs = 30_000 } = {}) {
    if (!scene?.id) throw new Error("Cannot wait for an invalid Reaction Broker test Scene.");
    const startedAt = Date.now();

    while ((Date.now() - startedAt) < timeoutMs) {
      if (canvas?.ready && canvas?.scene?.id === scene.id) return true;
      await new Promise(resolve => globalThis.setTimeout(resolve, 50));
    }

    throw new Error(`Timed out waiting for Foundry to finish drawing the Reaction Broker test Scene (${scene.name}).`);
  }

  #fixtureTokens() {
    const result = {};
    for (const token of canvas?.scene?.tokens ?? []) {
      const key = token.getFlag?.(MODULE_ID, "fixtureKey") ?? token.flags?.[MODULE_ID]?.fixtureKey;
      if (key) result[key] = token;
    }
    return result;
  }

  #orderSummary(entry) {
    return {
      reactor: entry.reactorName,
      distance: entry.distance,
      dexterity: entry.dexterity,
      tieBreak: Array.isArray(entry.tieBreak) ? entry.tieBreak.join(" → ") : entry.tieBreak
    };
  }

  #checkLine(entry) {
    const color = entry.passed ? "#5cff8d" : "#ff5c5c";
    console.log(`%c${entry.passed ? "PASS" : "FAIL"} | ${entry.name}`, `font-size:16px;font-weight:bold;color:${color};`, entry.details ?? "");
  }

  #banner(text, color, size = 24) {
    console.log(`%c${text}`, `font-size:${size}px;font-weight:900;color:${color};text-shadow:0 1px 1px #000;`);
  }
}
