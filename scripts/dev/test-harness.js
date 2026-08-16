import {
  ATTACHMENT_MODES,
  COLLISION_POLICIES,
  DISPLACEMENT_DIRECTION_CONSTRAINTS,
  DISPLACEMENT_TYPES,
  MODULE_ID,
  MOVEMENT_ACTION_IDS,
  MOVEMENT_AGENCIES,
  MOVEMENT_PHASES,
  MOVEMENT_RESOURCES,
  PATH_TYPES,
  RELATIONSHIP_COORDINATION_POLICIES,
  RELATIONSHIP_FORCED_LEADER_MOVEMENT_POLICIES,
  RELATIONSHIP_GEOMETRY_CHANNELS,
  RELATIONSHIP_LINK_OBSTRUCTION_POLICIES,
  RELATIONSHIP_ROTATION_POLICIES,
  RELATIVE_TOKEN_RELATIONSHIPS,
  RELATIONSHIP_TYPES,
  SELECTION_INDICATOR_ROLES,
  TELEPORT_POLICIES
} from "../core/constants.js";
import { Logger } from "../core/logger.js";
import { MovementTransaction } from "../movement/movement-transaction.js";
import { RelationshipGeometryService } from "../relationships/relationship-geometry-service.js";
import { OrbitDebugOverlay } from "./orbit-debug-overlay.js";
import { ReactionBrokerTestSuite } from "./reaction-broker-test-suite.js";

export class TestHarness {
  #dependencies;
  #compatibility;
  #movement;
  #movementAccounting;
  #catMovement;
  #relationships;
  #relationshipMovement;
  #relationshipRotation;
  #relativeRelationships;
  #relationshipLinkObstructions;
  #displacement;
  #selectionIndicator;
  #externalPromptBridge;
  #socket;
  #reactionSuite;
  #orbitOverlay = new OrbitDebugOverlay();

  constructor({ dependencies, compatibility, movement, movementAccounting, catMovement, relationships, relationshipMovement, relationshipRotation, relativeRelationships, relationshipLinkObstructions, displacement, selectionIndicator, externalPromptBridge, reactionRegistry, reactionAuthority, reactionDiscovery, reactionOrdering, reactionDialogs, reactionBroker, reactionEvents, socket }) {
    this.#dependencies = dependencies;
    this.#compatibility = compatibility;
    this.#movement = movement;
    this.#movementAccounting = movementAccounting;
    this.#catMovement = catMovement;
    this.#relationships = relationships;
    this.#relationshipMovement = relationshipMovement;
    this.#relationshipRotation = relationshipRotation;
    this.#relativeRelationships = relativeRelationships;
    this.#relationshipLinkObstructions = relationshipLinkObstructions;
    this.#displacement = displacement;
    this.#selectionIndicator = selectionIndicator;
    this.#externalPromptBridge = externalPromptBridge;
    this.#socket = socket;
    this.#reactionSuite = new ReactionBrokerTestSuite({
      registry: reactionRegistry,
      authority: reactionAuthority,
      discovery: reactionDiscovery,
      ordering: reactionOrdering,
      dialogs: reactionDialogs,
      broker: reactionBroker,
      events: reactionEvents,
      selectionIndicator,
      socket
    });
  }

  setupReactionBrokerTestScene(options) {
    return this.#reactionSuite.setupTestScene(options);
  }

  runReactionBrokerFoundationTest(options) {
    return this.#reactionSuite.runFoundationTest(options);
  }

  runReactionBrokerInteractiveTest(options) {
    return this.#reactionSuite.runInteractiveTest(options);
  }

  runReactionBrokerMidiWorkflowGateTest(options) {
    return this.#reactionSuite.runMidiWorkflowGateTest(options);
  }

  runReactionBrokerMultiplayerTest(options) {
    return this.#reactionSuite.runMultiplayerTest(options);
  }

  runReactionBrokerNoGmTest() {
    return this.#reactionSuite.runNoGmTest();
  }

  clearReactionBrokerTestState(options) {
    return this.#reactionSuite.clearTestState(options);
  }

  inspectReactionBroker() {
    return this.#reactionSuite.inspect();
  }

  async runFoundationSmokeTest({ notify = true } = {}) {
    const checks = [];
    const record = (name, passed, details = null) => checks.push({ name, passed: Boolean(passed), details });

    const dependencyStatus = this.#dependencies.validate({ notify: false });
    record("Required dependencies", dependencyStatus.healthy, dependencyStatus);
    const compatibilityStatus = this.#compatibility.refresh();
    record("Compatibility detection", true, compatibilityStatus);
    const catInteroperabilityStatus = this.#catMovement.getStatus();
    record("CAT interoperability detection", true, catInteroperabilityStatus);

    const consumerId = `${MODULE_ID}.tests.synthetic-consumer`;
    const consumersBefore = this.#movement.getStats().registry.consumers;
    let syntheticReceived = false;
    const unregister = this.#movement.registerConsumer({
      id: consumerId,
      phases: [MOVEMENT_PHASES.AFTER],
      priority: 9999,
      handler: (transaction) => { syntheticReceived = transaction.method === "synthetic"; },
      once: true
    });
    try {
      const transaction = MovementTransaction.synthetic();
      await this.#movement.dispatchSyntheticForTesting(transaction);
      record("Synthetic movement dispatch", syntheticReceived, transaction.toJSON());
    } finally {
      unregister();
    }

    record("Movement registry cleanup", this.#movement.getStats().registry.consumers === consumersBefore, {
      consumersBefore,
      consumersAfter: this.#movement.getStats().registry.consumers
    });
    const accountingStatus = this.#movementAccounting.getStats();
    record("Native movement accounting", accountingStatus.sourceOfTruth === "TokenDocument.movementHistory"
      && accountingStatus.noCostActionRegistered === true
      && accountingStatus.modifierSlotsRegistered === true, accountingStatus);
    record("Relationship indexes", this.#relationships.getStats().relationships >= 0, this.#relationships.getStats());
    record("Relationship movement service", this.#relationshipMovement.getStats().initialized, this.#relationshipMovement.getStats());
    record("Relationship rotation service", this.#relationshipRotation.getStats().initialized, this.#relationshipRotation.getStats());
    record("Displacement service", this.#displacement.getStats().initialized, this.#displacement.getStats());
    record("Selection indicator service", this.#selectionIndicator.getStats().initialized, this.#selectionIndicator.getStats());
    record("External prompt bridge", this.#externalPromptBridge.getStats().initialized, this.#externalPromptBridge.getStats());
    record("Socketlib registration", this.#socket.ready, { ready: this.#socket.ready });

    const passed = checks.every((check) => check.passed);
    const result = {
      passed,
      checks,
      movement: this.#movement.getStats(),
      relationships: this.#relationships.getStats(),
      relationshipMovement: this.#relationshipMovement.getStats(),
      relationshipRotation: this.#relationshipRotation.getStats(),
      displacement: this.#displacement.getStats(),
      selection: this.#selectionIndicator.getStats(),
      externalPrompts: this.#externalPromptBridge.getStats(),
      catInteroperability: catInteroperabilityStatus,
      compatibility: compatibilityStatus
    };
    Logger.info("Foundation smoke test", result);
    if (notify && ui?.notifications) {
      ui.notifications[passed ? "info" : "warn"](
        passed
          ? "Action Effects 5E foundation smoke test passed. See the console for details."
          : "Action Effects 5E foundation smoke test found a problem. See the console for details."
      );
    }
    return result;
  }

  async runMovementAccountingTest({ notify = true } = {}) {
    if (!canvas?.ready) throw new Error("A Scene canvas must be active.");
    const controlled = canvas.tokens.controlled;
    if (controlled.length !== 1) throw new Error("Control exactly one token for the movement-accounting test.");

    const token = controlled[0];
    const document = token.document;
    const checks = [];
    const record = (name, passed, details = null) => checks.push({ name, passed: Boolean(passed), details });
    this.#movementAccounting.ensureRegistered();

    const actions = globalThis.CONFIG?.Token?.movement?.actions;
    const noCost = actions?.get?.(MOVEMENT_ACTION_IDS.NO_COST) ?? actions?.[MOVEMENT_ACTION_IDS.NO_COST];
    record("Internal no-cost action registered", Boolean(noCost), noCost ?? null);
    record("No-cost action exposes a startup-safe icon", typeof noCost?.icon === "string" && noCost.icon.length > 0, { icon: noCost?.icon });
    let selectable = true;
    try {
      selectable = typeof noCost?.canSelect === "function" ? noCost.canSelect(document) : noCost?.canSelect !== false;
    } catch (_error) {
      selectable = true;
    }
    record("No-cost action is hidden from normal selection", selectable === false, { canSelect: noCost?.canSelect, evaluated: selectable });
    record("No-cost action remains measured", noCost?.measure !== false, { measure: noCost?.measure });
    let zeroCostFunction = false;
    try {
      const costFunction = noCost?.getCostFunction?.(document, {});
      zeroCostFunction = typeof costFunction === "function"
        && Math.abs(Number(costFunction(1, null, null, 1, null))) <= 1e-6
        && Math.abs(Number(costFunction(5, null, null, 5, null))) <= 1e-6;
    } catch (_error) {
      zeroCostFunction = false;
    }
    record("No-cost action exposes zero-cost semantics", zeroCostFunction, { getCostFunction: typeof noCost?.getCostFunction });

    const historyBefore = this.#movementAccounting.getHistorySnapshot(document);
    const gridSize = Number(canvas.grid?.size ?? canvas.scene?.grid?.size ?? 100);
    const elevation = Number(document.elevation ?? 0);
    const origin = { x: document.x, y: document.y, elevation };
    const destination = { x: document.x + gridSize, y: document.y, elevation };
    // Use the rendered Token measurement API here. Token#measureMovementPath
    // resolves each waypoint's movement action through Foundry's normalized
    // action-specific cost functions. TokenDocument#measureMovementPath is a
    // lower-level geometry API and does not apply those action costs.
    const noCostResult = token.measureMovementPath([
      { ...origin, action: MOVEMENT_ACTION_IDS.NO_COST },
      { ...destination, action: MOVEMENT_ACTION_IDS.NO_COST }
    ]);
    record("No-cost movement still measures distance", Number(noCostResult?.distance) > 0, noCostResult);
    record("No-cost movement measures native cost as zero", Math.abs(Number(noCostResult?.cost ?? NaN)) <= 1e-6, noCostResult);

    const baseAction = globalThis.CONFIG?.Token?.movement?.defaultAction ?? "walk";
    const baseResult = token.measureMovementPath([
      { ...origin, action: baseAction },
      { ...destination, action: baseAction }
    ]);
    const modifierId = `${MODULE_ID}-test-plus-distance-${foundry.utils.randomID(8)}`;
    const actionIdsBeforeModifier = actions?.keys
      ? [...actions.keys()]
      : Object.keys(actions ?? {});
    let modifiedAction = null;
    try {
      modifiedAction = this.#movementAccounting.registerFinalCostModifier(modifierId, {
        label: "AE5E Test — Native Cost + Distance",
        baseAction,
        modifier: ({ nativeCost, distance }) => nativeCost + distance
      });
      const modifiedResult = token.measureMovementPath([
        { ...origin, action: modifiedAction },
        { ...destination, action: modifiedAction }
      ]);
      const expected = Number(baseResult?.cost ?? 0) + Number(baseResult?.distance ?? 0);
      record("Final cost modifier wraps native cost", Math.abs(Number(modifiedResult?.cost ?? NaN) - expected) <= 1e-6, {
        baseResult,
        modifiedResult,
        expected
      });
      const actionIdsAfterModifier = actions?.keys
        ? [...actions.keys()]
        : Object.keys(actions ?? {});
      record("Runtime modifier registration does not mutate Foundry action registry",
        JSON.stringify(actionIdsAfterModifier) === JSON.stringify(actionIdsBeforeModifier), {
          beforeCount: actionIdsBeforeModifier.length,
          afterCount: actionIdsAfterModifier.length,
          action: modifiedAction
        });
      record("Runtime modifier uses a pre-registered hidden slot",
        /^action-effects-5e\.cost-slot-\d+$/.test(String(modifiedAction ?? "")), { action: modifiedAction });
    } finally {
      if (modifiedAction) this.#movementAccounting.unregisterFinalCostModifier(modifiedAction);
    }
    record("Runtime modifier slot is released after cleanup",
      this.#movementAccounting.getStats().activeCostModifiers.length === 0,
      this.#movementAccounting.getStats());

    const historyAfter = this.#movementAccounting.getHistorySnapshot(document);
    record("Measurement probe does not alter movement history", JSON.stringify(historyAfter) === JSON.stringify(historyBefore), {
      beforeCount: historyBefore.length,
      afterCount: historyAfter.length
    });

    const passed = checks.every((check) => check.passed);
    const result = { passed, checks, accounting: this.#movementAccounting.getStats() };
    Logger.info("Movement accounting test", result);
    if (notify && ui?.notifications) {
      ui.notifications[passed ? "info" : "warn"](
        passed
          ? "Action Effects 5E movement-accounting test passed. See the console for details."
          : "Action Effects 5E movement-accounting test found a problem. See the console for details."
      );
    }
    return result;
  }

  async runCatMovementInteroperabilityTest({ notify = true } = {}) {
    if (!canvas?.ready) throw new Error("A Scene canvas must be active.");
    if (!game.user?.isGM) throw new Error("The CAT movement interoperability test requires a GM user.");

    const status = this.#catMovement.getStatus();
    if (!status.executionAvailable) {
      throw new Error("CAT must be active and expose cat.utils.tokenUtils.moveToken() for the v0.3.30 interoperability test.");
    }

    const results = [];
    const record = (name, passed, details = null) => {
      const entry = { name, passed: Boolean(passed), details };
      results.push(entry);
      console[entry.passed ? "log" : "error"](
        `%c${entry.passed ? "PASS" : "FAIL"}%c  ${name}`,
        `font-size:14px;font-weight:bold;color:${entry.passed ? "#18cc46" : "#ff5555"}`,
        "color:inherit",
        details ?? ""
      );
      return entry;
    };
    const banner = (text, color = "#18cc46", size = 22) => console.log(
      `%c${text}`,
      `font-size:${size}px;font-weight:bold;color:${color}`
    );
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const approx = (a, b) => Math.abs(Number(a) - Number(b)) <= 0.01;
    const scene = canvas.scene;
    const grid = Number(canvas.grid?.size ?? scene?.grid?.size ?? 100);
    const maxX = Math.max(0, Number(scene.width ?? 0) - grid);
    const maxY = Math.max(0, Number(scene.height ?? 0) - grid);
    const baseX = Math.max(0, Math.min(Math.round((Number(scene.width ?? grid) / 2) / grid) * grid, maxX));
    const baseY = Math.max(0, Math.min(Math.round((Number(scene.height ?? grid) / 2) / grid) * grid, maxY));
    const direction = baseX + grid <= maxX ? 1 : -1;
    const start = { x: baseX, y: baseY, elevation: 0 };
    const end = { x: baseX + (direction * grid), y: baseY, elevation: 0 };

    let actor = null;
    let token = null;
    let rawHook = null;
    let activeCase = null;
    let diagnosticWall = null;
    const rawMovements = {};
    const transactions = {};
    const unregisterConsumers = [];
    const originalStats = this.#catMovement.getStats();

    const captureTransaction = (caseId) => {
      let resolveTransaction = null;
      const promise = new Promise((resolve) => { resolveTransaction = resolve; });
      const unregister = this.#movement.registerConsumer({
        id: `${MODULE_ID}.cat-test.${caseId}.${foundry.utils.randomID(8)}`,
        phases: [MOVEMENT_PHASES.AFTER],
        tokenUuids: [token.uuid],
        execution: "initiator",
        priority: 30_000,
        once: true,
        handler: (transaction) => {
          transactions[caseId] = transaction;
          resolveTransaction(transaction);
        }
      });
      unregisterConsumers.push(unregister);
      return Promise.race([promise, sleep(1_500).then(() => null)]);
    };

    const nativeReposition = async (position) => {
      const actions = globalThis.CONFIG?.Token?.movement?.actions;
      const entries = actions?.entries ? [...actions.entries()] : Object.entries(actions ?? {});
      const teleportAction = entries.find(([, config]) => config?.teleport === true)?.[0] ?? null;
      if (!teleportAction) throw new Error("CAT interoperability fixture requires a registered teleport movement action for cleanup positioning.");
      return token.move({ ...position, action: teleportAction, explicit: true, checkpoint: true }, {
        method: "api",
        animate: false,
        pan: false,
        showRuler: false,
        constrainOptions: { ignoreWalls: true, ignoreCost: true, ignoreTokens: true },
        ...this.#movement.createOperationOptions({
          pathType: PATH_TYPES.REPOSITION,
          agency: MOVEMENT_AGENCIES.ADMINISTRATIVE,
          resource: MOVEMENT_RESOURCES.NONE,
          movementMode: teleportAction,
          administrative: true,
          generatedBy: MODULE_ID,
          internal: true,
          suppressAutomation: true,
          testFixture: true
        })
      });
    };

    banner("AE5E 0.3.30 — CAT MOVEMENT INTEROPERABILITY TEST");

    try {
      record("CAT execution facade available", status.executionAvailable === true, status);
      record("CAT catForce action remains intentionally unmeasured", status.forcedAction?.measure === false, status.forcedAction);

      this.#movementAccounting.ensureRegistered();
      const actions = globalThis.CONFIG?.Token?.movement?.actions;
      const noCostAction = actions?.get?.(MOVEMENT_ACTION_IDS.NO_COST) ?? actions?.[MOVEMENT_ACTION_IDS.NO_COST];
      record("AE5E no-cost action remains measured", Boolean(noCostAction) && noCostAction.measure !== false, noCostAction);

      actor = await Actor.create({
        name: "AE5E CAT Interoperability Test — Actor",
        type: "character",
        system: { attributes: { movement: { walk: 30 } } }
      }, { renderSheet: false });
      if (Number(actor.system?.attributes?.movement?.walk ?? 0) !== 30) {
        await actor.update({ "system.attributes.movement.walk": 30 });
      }

      [token] = await scene.createEmbeddedDocuments("Token", [{
        name: "AE5E CAT Interoperability Test — Token",
        actorId: actor.id,
        actorLink: true,
        hidden: false,
        locked: false,
        movementAction: "walk",
        ...start,
        width: 1,
        height: 1
      }]);
      await sleep(200);
      record("Disposable CAT test fixture created", Boolean(actor && token?.object), {
        actorUuid: actor?.uuid ?? null,
        tokenUuid: token?.uuid ?? null
      });

      rawHook = Hooks.on("moveToken", (document, movement) => {
        if (document.id !== token.id || !activeCase) return;
        rawMovements[activeCase] = movement;
      });

      // ------------------------------------------------------
      // CAT -> AE5E: external catForce must become semantic
      // forced/no-resource movement even though CAT intentionally
      // reports zero measured distance for that action.
      // ------------------------------------------------------
      await token.clearMovementHistory();
      activeCase = "externalCatForce";
      const externalTransactionPromise = captureTransaction("externalCatForce");
      const externalResult = await globalThis.cat.utils.tokenUtils.moveToken(token, [{
        ...end,
        action: "catForce",
        checkpoint: true
      }], {
        animate: false,
        pan: false,
        showRuler: false,
        constrainOptions: { ignoreWalls: true, ignoreTokens: true }
      });
      const externalTransaction = await externalTransactionPromise;
      await sleep(75);
      record("External CAT catForce movement completed", externalResult === true && approx(token.x, end.x) && approx(token.y, end.y), {
        result: externalResult,
        position: { x: token.x, y: token.y }
      });
      record("CAT catForce produced a native moveToken event", Boolean(rawMovements.externalCatForce), rawMovements.externalCatForce ?? null);
      record("AE5E recognized CAT catForce as forced movement", externalTransaction?.agency === MOVEMENT_AGENCIES.FORCED, externalTransaction?.toJSON?.() ?? null);
      record("AE5E recognized CAT catForce as consuming no movement resource", externalTransaction?.resource === MOVEMENT_RESOURCES.NONE, externalTransaction?.toJSON?.() ?? null);
      record("AE5E tagged external CAT provenance without inventing Push/Pull semantics",
        externalTransaction?.metadata?.interoperabilityProvider === "cat"
          && externalTransaction?.movementMode === "catForce"
          && externalTransaction?.displacementType == null
          && externalTransaction?.sourceUuid == null,
        externalTransaction?.toJSON?.() ?? null);

      activeCase = null;
      await nativeReposition(start);
      await token.clearMovementHistory();
      await sleep(75);

      // ------------------------------------------------------
      // AE5E -> CAT: pass AE5E's own measured/zero-cost action
      // through the CAT movement facade. CAT executes the move;
      // Foundry still sees measured distance while native cost is 0.
      // ------------------------------------------------------
      activeCase = "ae5eThroughCat";
      const ae5eTransactionPromise = captureTransaction("ae5eThroughCat");
      const beforeCatExecutions = this.#catMovement.getStats().catExecutions;
      const movementId = foundry.utils.randomID(16);
      const ae5eResult = await this.#catMovement.moveToken(token, [{
        ...end,
        action: MOVEMENT_ACTION_IDS.NO_COST,
        explicit: true,
        checkpoint: true
      }], {
        id: movementId,
        method: "api",
        animate: false,
        pan: false,
        showRuler: false,
        constrainOptions: { ignoreWalls: true, ignoreCost: true, ignoreTokens: true },
        ...this.#movement.createOperationOptions({
          transactionId: `${MODULE_ID}-cat-interoperability-${foundry.utils.randomID(8)}`,
          pathType: PATH_TYPES.TRAVERSE,
          agency: MOVEMENT_AGENCIES.FORCED,
          resource: MOVEMENT_RESOURCES.NONE,
          movementMode: "walk",
          nativeMovementAction: MOVEMENT_ACTION_IDS.NO_COST,
          generatedBy: MODULE_ID,
          internal: true,
          suppressAutomation: false,
          catInteroperabilityTest: true
        })
      });
      const ae5eTransaction = await ae5eTransactionPromise;
      await sleep(75);
      const afterCatExecutions = this.#catMovement.getStats().catExecutions;
      const rawAe5e = rawMovements.ae5eThroughCat;
      record("AE5E movement facade actually selected CAT", afterCatExecutions === beforeCatExecutions + 1, {
        beforeCatExecutions,
        afterCatExecutions,
        adapter: this.#catMovement.getStats()
      });
      record("AE5E-through-CAT movement completed", ae5eResult === true && approx(token.x, end.x) && approx(token.y, end.y), {
        result: ae5eResult,
        position: { x: token.x, y: token.y }
      });
      record("AE5E-through-CAT path remained physically measured", Number(rawAe5e?.passed?.distance ?? 0) > 0, {
        distance: rawAe5e?.passed?.distance ?? null,
        cost: rawAe5e?.passed?.cost ?? null
      });
      record("AE5E-through-CAT path retained zero native movement cost",
        Math.abs(Number(rawAe5e?.passed?.cost ?? NaN)) <= 1e-6
          && Math.abs(Number(ae5eTransaction?.movementCostConsumed ?? NaN)) <= 1e-6,
        {
          eventCost: rawAe5e?.passed?.cost ?? null,
          transactionCost: ae5eTransaction?.movementCostConsumed ?? null,
          transaction: ae5eTransaction?.toJSON?.() ?? null
        });
      record("AE5E semantic metadata survived CAT execution",
        ae5eTransaction?.agency === MOVEMENT_AGENCIES.FORCED
          && ae5eTransaction?.resource === MOVEMENT_RESOURCES.NONE
          && ae5eTransaction?.generatedBy === MODULE_ID,
        ae5eTransaction?.toJSON?.() ?? null);

      // ------------------------------------------------------
      // CAT wall preflight: establish that the preferred CAT
      // executor does not bypass a movement wall when AE5E asks
      // it to honor Foundry wall constraints.
      // ------------------------------------------------------
      activeCase = null;
      await nativeReposition(start);
      await token.clearMovementHistory();
      const boundaryX = direction > 0 ? start.x + grid : start.x;
      [diagnosticWall] = await scene.createEmbeddedDocuments("Wall", [{
        c: [boundaryX, start.y, boundaryX, start.y + grid],
        flags: { [MODULE_ID]: { catInteroperabilityDiagnosticWall: true } }
      }]);
      await sleep(100);
      const wallStatsBefore = this.#catMovement.getStats().catExecutions;
      const wallResult = await this.#catMovement.moveToken(token, [{
        ...end,
        action: MOVEMENT_ACTION_IDS.NO_COST,
        explicit: true,
        checkpoint: true
      }], {
        method: "api",
        animate: false,
        pan: false,
        showRuler: false,
        constrainOptions: { ignoreWalls: false, ignoreCost: true, ignoreTokens: true },
        ...this.#movement.createOperationOptions({
          pathType: PATH_TYPES.TRAVERSE,
          agency: MOVEMENT_AGENCIES.ADMINISTRATIVE,
          resource: MOVEMENT_RESOURCES.NONE,
          movementMode: "walk",
          nativeMovementAction: MOVEMENT_ACTION_IDS.NO_COST,
          generatedBy: MODULE_ID,
          internal: true,
          suppressAutomation: true,
          testFixture: true,
          catWallConstraintTest: true
        })
      });
      await sleep(100);
      const wallStatsAfter = this.#catMovement.getStats().catExecutions;
      record("CAT facade handled the wall-constrained execution attempt", wallStatsAfter === wallStatsBefore + 1, {
        before: wallStatsBefore,
        after: wallStatsAfter,
        result: wallResult
      });
      const wallNotCrossed = direction > 0
        ? Number(token.x) < Number(end.x) - 0.01
        : Number(token.x) > Number(end.x) + 0.01;
      record("CAT honored the movement wall and did not move through it",
        wallNotCrossed && approx(token.y, start.y),
        {
          result: wallResult,
          blockedDestination: end,
          actual: { x: token.x, y: token.y }
        });

    } finally {
      activeCase = null;
      if (rawHook !== null) Hooks.off("moveToken", rawHook);
      if (diagnosticWall) {
        try { await scene.deleteEmbeddedDocuments("Wall", [diagnosticWall.id]); } catch {}
      }
      for (const unregister of unregisterConsumers) {
        try { unregister?.(); } catch {}
      }
      if (token) {
        try { await scene.deleteEmbeddedDocuments("Token", [token.id]); } catch {}
      }
      if (actor) {
        try { await actor.delete(); } catch {}
      }
    }

    record("Disposable CAT test Token cleaned up", !token || !scene.tokens.get(token.id));
    record("Disposable CAT test Actor cleaned up", !actor || !game.actors.get(actor.id));
    record("Diagnostic CAT test Wall cleaned up", !diagnosticWall || !scene.walls.get(diagnosticWall.id));

    const passed = results.every((entry) => entry.passed);
    const report = {
      result: passed ? "PASS" : "FAIL",
      version: "0.3.30",
      environment: {
        foundry: game.version,
        dnd5e: game.system.version,
        cat: game.modules.get("cat")?.version ?? null
      },
      adapterBefore: originalStats,
      adapterAfter: this.#catMovement.getStats(),
      summary: {
        passed: results.filter((entry) => entry.passed).length,
        failed: results.filter((entry) => !entry.passed).length,
        total: results.length
      },
      results
    };

    banner(
      `AE5E 0.3.30 CAT INTEROPERABILITY — ${report.summary.passed}/${report.summary.total} PASSED`,
      passed ? "#18cc46" : "#ff5555",
      25
    );
    console.log(report);
    if (notify && ui?.notifications) {
      ui.notifications[passed ? "info" : "warn"](
        passed
          ? "AE5E 0.3.30 CAT movement interoperability test passed. See console for details."
          : "AE5E 0.3.30 CAT movement interoperability test found a problem. See console for details."
      );
    }
    return report;
  }

  async runSelectionIndicatorTest() {
    if (!canvas?.ready) throw new Error("A Scene canvas must be active.");
    const controlled = canvas.tokens.controlled;
    if (controlled.length !== 1) throw new Error("Control exactly one token for the selection-indicator test.");

    const token = controlled[0];
    const baseline = this.#selectionIndicator.getStats();
    if (baseline.activeLeases !== 0) {
      throw new Error("Selection-indicator testing requires no other active AE5E selection leases.");
    }
    if (!baseline.sequencer.active || !baseline.sequencer.apiAvailable) {
      throw new Error("Sequencer must be active for the v0.3.27 visual regression.");
    }

    const lease1 = await this.#selectionIndicator.acquire({ token, reason: "v0.3.27-lease-a", playSound: false });
    const afterFirst = this.#selectionIndicator.getStats();

    // Sequencer 4.x initializes persistent canvas effects asynchronously after
    // Sequence.play() resolves. The lease regression used to end its first
    // synthetic effect immediately, which could race Sequencer's sprite setup
    // and produce a harmless but noisy `sprite === null` volume error. Give the
    // test effect a brief settle window before exercising shared-lease cleanup.
    await new Promise((resolve) => setTimeout(resolve, 400));

    const lease2 = await this.#selectionIndicator.acquire({ token, reason: "v0.3.27-lease-b", playSound: false });
    const afterSecond = this.#selectionIndicator.getStats();
    await lease1.release();
    const afterFirstRelease = this.#selectionIndicator.getStats();
    await lease2.release();
    const afterSecondRelease = this.#selectionIndicator.getStats();

    const leaseChecks = {
      firstLeaseRendered: lease1.rendered === true,
      firstLeaseStartedOneEffect: afterFirst.activeLeases === 1 && afterFirst.activeTokens === 1 && afterFirst.renderedTokens === 1,
      secondLeaseSharedEffect: afterSecond.activeLeases === 2
        && afterSecond.activeTokens === 1
        && afterSecond.renderedTokens === 1
        && afterSecond.effectsStarted === baseline.effectsStarted + 1,
      firstReleaseKeptEffect: afterFirstRelease.activeLeases === 1
        && afterFirstRelease.activeTokens === 1
        && afterFirstRelease.renderedTokens === 1,
      finalReleaseRemovedEffect: afterSecondRelease.activeLeases === 0
        && afterSecondRelease.activeTokens === 0
        && afterSecondRelease.renderedTokens === 0
        && afterSecondRelease.effectsStopped === baseline.effectsStopped + 1
    };

    if (!Object.values(leaseChecks).every(Boolean)) {
      const failed = { baseline, afterFirst, afterSecond, afterFirstRelease, afterSecondRelease, leaseChecks };
      Logger.error("v0.3.27 selection-indicator lease regression failed.", failed);
      throw new Error("Selection-indicator lease regression failed. See the console for details.");
    }

    ui?.notifications?.info?.("AE5E | Lease lifecycle passed. Keep the upcoming dialog open and inspect the controlled token from another connected client if available.");

    const dialogResult = await this.#selectionIndicator.waitForDialog({
      token,
      reason: "v0.3.27-dialog",
      config: {
        window: { title: "AE5E 0.3.27 Selection Indicator Test" },
        content: `
          <div style="display:flex;flex-direction:column;gap:0.6rem;min-width:360px;">
            <p><strong>Leave this dialog open while inspecting the controlled token.</strong></p>
            <p>The visible d20 should be about 10% larger than the previous live test and sit slightly inward from the token's upper-right corner, overlapping the token more clearly.</p>
            <p>If Eskie Effects is installed, AE5E should use the raw white d20 WebM directly, loop seamlessly, and tint it <code>#18cc46</code>. Otherwise Foundry's <code>icons/vtt-512.png</code> should appear.</p>
            <p>The animation should render above the token's orange control/selection outline where they overlap.</p>
            <p><code>notification01.ogg</code> should play once at volume 1 when this dialog opens, and only on the client whose user is making this selection. It must not loop while the indicator remains active.</p>
            <p>Other connected users viewing this Scene should see the indicator even though this dialog exists only on your client; they should not hear this notification sound.</p>
            <p>Close with either button or the window X. The indicator must disappear immediately when the dialog closes.</p>
          </div>`,
        buttons: [
          { action: "complete", label: "Complete Selection", default: true },
          { action: "cancel", label: "Cancel" }
        ]
      }
    });

    const finalStats = this.#selectionIndicator.getStats();
    const cleanupPassed = finalStats.activeLeases === 0
      && finalStats.activeTokens === 0
      && finalStats.renderedTokens === 0;
    const report = {
      result: cleanupPassed ? "PASS" : "FAIL",
      tokenUuid: token.document.uuid,
      tokenName: token.name,
      dialogResult,
      leaseChecks,
      baseline,
      afterFirst,
      afterSecond,
      afterFirstRelease,
      afterSecondRelease,
      finalStats
    };

    Logger.info("AE5E 0.3.27 selection-indicator test", report);
    ui?.notifications?.[cleanupPassed ? "info" : "error"]?.(
      cleanupPassed
        ? "AE5E | Selection indicator cleanup passed. Confirm visual size/position and multi-user visibility manually."
        : "AE5E | Selection indicator cleanup failed. See the console."
    );
    return report;
  }

  async runSelectionIndicatorRolePairTest() {
    if (!canvas?.ready) throw new Error("A Scene canvas must be active.");
    const controlled = canvas.tokens.controlled;
    if (controlled.length !== 2) throw new Error("Control exactly two tokens for the selection-indicator role-pair test.");

    const [originator, responder] = controlled;
    const baseline = this.#selectionIndicator.getStats();
    if (baseline.activeLeases !== 0) {
      throw new Error("Role-pair testing requires no other active AE5E selection leases.");
    }

    const originatorLease = await this.#selectionIndicator.acquire({
      token: originator,
      reason: "v0.3.27-role-originator",
      role: SELECTION_INDICATOR_ROLES.ORIGINATOR,
      playSound: true
    });
    const responderLease = await this.#selectionIndicator.acquire({
      token: responder,
      reason: "v0.3.27-role-responder",
      role: SELECTION_INDICATOR_ROLES.RESPONDER,
      playSound: true
    });

    try {
      const DialogV2 = foundry?.applications?.api?.DialogV2;
      if (!DialogV2?.wait) throw new Error("Foundry DialogV2.wait() is unavailable.");
      await DialogV2.wait({
        classes: [`${MODULE_ID}-owned-dialog`],
        window: { title: "AE5E 0.3.27 Indicator Role Pair Test" },
        content: `
          <div style="display:flex;flex-direction:column;gap:0.6rem;min-width:390px;">
            <p><strong>Inspect both controlled tokens before closing this dialog.</strong></p>
            <p>The first-controlled token <strong>${originator.name}</strong> should show the existing green <code>originator</code> indicator and play <code>notification01.ogg</code> once for this user.</p>
            <p>The second-controlled token <strong>${responder.name}</strong> should show the temporary amber <code>responder</code> indicator. No responder sound asset is assigned yet, so it should be silent.</p>
            <p>Both indicators should remain above token selection outlines and disappear when this test dialog closes.</p>
          </div>`,
        buttons: [
          { action: "complete", label: "Complete Test", default: true },
          { action: "cancel", label: "Cancel" }
        ],
        rejectClose: false
      });
    } finally {
      await responderLease.release();
      await originatorLease.release();
    }

    const finalStats = this.#selectionIndicator.getStats();
    const passed = finalStats.activeLeases === 0
      && finalStats.activeTokens === 0
      && finalStats.renderedTokens === 0;
    const report = {
      result: passed ? "PASS" : "FAIL",
      originator: { tokenUuid: originator.document.uuid, tokenName: originator.name, role: originatorLease.role },
      responder: { tokenUuid: responder.document.uuid, tokenName: responder.name, role: responderLease.role },
      finalStats
    };
    Logger.info("AE5E 0.3.27 selection-indicator role-pair test", report);
    return report;
  }

  async runExternalPromptBridgeTest() {
    if (!canvas?.ready) throw new Error("A Scene canvas must be active.");
    const controlled = canvas.tokens.controlled;
    if (controlled.length !== 1) throw new Error("Control exactly one token for the external-prompt bridge test.");

    const token = controlled[0];
    const testClass = `${MODULE_ID}-external-prompt-test`;
    const adapterId = `${MODULE_ID}.tests.external-prompt`;
    const unregister = this.#externalPromptBridge.registerAdapter({
      id: adapterId,
      priority: 100000,
      match: ({ application, element }) => {
        const raw = application?.options?.classes;
        const classes = raw instanceof Set ? [...raw] : Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/\s+/) : [];
        const matched = classes.includes(testClass) || element?.classList?.contains?.(testClass);
        if (!matched) return null;
        return {
          token,
          reason: "v0.3.27-external-prompt-test",
          playSound: true
        };
      }
    });

    const DialogV2 = foundry?.applications?.api?.DialogV2;
    if (!DialogV2?.wait) {
      unregister();
      throw new Error("Foundry DialogV2.wait() is unavailable.");
    }

    let dialogResult = null;
    try {
      dialogResult = await DialogV2.wait({
        classes: [testClass],
        window: { title: "Simulated External Module Prompt" },
        content: `
          <div style="display:flex;flex-direction:column;gap:0.6rem;min-width:390px;">
            <p><strong>This dialog deliberately does not use an AE5E selection lease.</strong></p>
            <p>The temporary test adapter should recognize it through the global <code>renderApplicationV2</code> bridge and place a <strong>blue external indicator</strong> on ${token.name}.</p>
            <p>No external notification sound asset is assigned yet, so the blue indicator should be silent.</p>
            <p>Closing this dialog should release the bridge-owned lease and remove the blue indicator.</p>
          </div>`,
        buttons: [
          { action: "complete", label: "Complete Test", default: true },
          { action: "cancel", label: "Cancel" }
        ],
        rejectClose: false
      });
      // ApplicationV2's close event is post-close and the bridge releases its
      // lease asynchronously. Allow that close listener one task to settle.
      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      unregister();
    }

    const bridgeStats = this.#externalPromptBridge.getStats();
    const selectionStats = this.#selectionIndicator.getStats();
    const passed = bridgeStats.trackedApplications === 0
      && selectionStats.activeLeases === 0
      && selectionStats.activeTokens === 0
      && selectionStats.renderedTokens === 0;
    const report = {
      result: passed ? "PASS" : "FAIL",
      tokenUuid: token.document.uuid,
      tokenName: token.name,
      dialogResult,
      bridgeStats,
      selectionStats
    };
    Logger.info("AE5E 0.3.27 external-prompt bridge test", report);
    return report;
  }

  async runExternalPromptIsolationTest() {
    if (!canvas?.ready) throw new Error("A Scene canvas must be active.");
    const controlled = canvas.tokens.controlled;
    if (controlled.length !== 1) throw new Error("Control exactly one token for the external-prompt isolation test.");

    const token = controlled[0];
    const baselineBridge = this.#externalPromptBridge.getStats();
    const baselineSelection = this.#selectionIndicator.getStats();
    if (baselineBridge.trackedApplications !== 0 || baselineSelection.activeLeases !== 0) {
      throw new Error("External-prompt isolation testing requires no tracked external applications or active selection leases.");
    }

    const prefix = `${MODULE_ID}-external-isolation-${Date.now()}`;
    const recognizedClass = `${prefix}-recognized`;
    const tokenlessClass = `${prefix}-tokenless`;
    const throwingClass = `${prefix}-throwing`;
    const ordinaryClasses = [
      `${prefix}-actor-sheet`,
      `${prefix}-item-sheet`,
      `${prefix}-settings`,
      `${prefix}-file-picker`,
      `${prefix}-unknown-module-dialog`
    ];
    const adapterIds = {
      throwing: `${MODULE_ID}.tests.external-isolation.throwing.${Date.now()}`,
      tokenless: `${MODULE_ID}.tests.external-isolation.tokenless.${Date.now()}`,
      recognized: `${MODULE_ID}.tests.external-isolation.recognized.${Date.now()}`
    };

    const hasClass = (application, className) => {
      const raw = application?.options?.classes;
      const classes = raw instanceof Set ? [...raw] : Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/\s+/) : [];
      return classes.includes(className);
    };

    const unregister = [];
    unregister.push(this.#externalPromptBridge.registerAdapter({
      id: adapterIds.throwing,
      priority: 300000,
      match: ({ application }) => {
        if (!hasClass(application, throwingClass)) return null;
        throw new Error("Intentional AE5E external-prompt isolation adapter failure.");
      }
    }));
    unregister.push(this.#externalPromptBridge.registerAdapter({
      id: adapterIds.tokenless,
      priority: 200000,
      match: ({ application }) => hasClass(application, tokenlessClass)
        ? { reason: "v0.3.27-tokenless-match", playSound: false }
        : null
    }));
    unregister.push(this.#externalPromptBridge.registerAdapter({
      id: adapterIds.recognized,
      priority: 100000,
      match: ({ application }) => hasClass(application, recognizedClass)
        ? { token, reason: "v0.3.27-recognized-match", playSound: false }
        : null
    }));

    const createSyntheticApplication = ({ id, classes = [] }) => {
      const listeners = new Map();
      return {
        id,
        options: { classes: [...classes] },
        addEventListener(type, callback, { once = false } = {}) {
          const list = listeners.get(type) ?? [];
          list.push({ callback, once: Boolean(once) });
          listeners.set(type, list);
        },
        dispatch(type) {
          const list = [...(listeners.get(type) ?? [])];
          for (const entry of list) {
            try { entry.callback(); } catch (error) { Logger.warn("Synthetic external-prompt test listener failed.", error); }
          }
          listeners.set(type, (listeners.get(type) ?? []).filter((entry) => !entry.once));
        },
        close() { this.dispatch("close"); }
      };
    };

    const render = async (application) => {
      await this.#externalPromptBridge.processRenderForTesting({ application, element: null, context: {}, options: {} });
      await new Promise((resolve) => setTimeout(resolve, 25));
    };
    const closeAndSettle = async (application) => {
      application.close();
      await new Promise((resolve) => setTimeout(resolve, 100));
    };

    const checks = [];
    const record = (name, passed, details = null) => checks.push({ name, passed: Boolean(passed), details });
    const apps = [];

    try {
      // Ordinary/unrecognized windows must remain completely inert.
      for (let i = 0; i < ordinaryClasses.length; i += 1) {
        const app = createSyntheticApplication({ id: `${prefix}-ordinary-${i}`, classes: [ordinaryClasses[i]] });
        apps.push(app);
        await render(app);
      }
      let bridge = this.#externalPromptBridge.getStats();
      let selection = this.#selectionIndicator.getStats();
      record("Ordinary windows ignored", bridge.trackedApplications === 0
        && selection.activeLeases === 0
        && selection.renderedTokens === 0, { bridge, selection });

      // Even a positive adapter match is non-actionable without a token.
      const tokenless = createSyntheticApplication({ id: `${prefix}-tokenless-app`, classes: [tokenlessClass] });
      apps.push(tokenless);
      await render(tokenless);
      bridge = this.#externalPromptBridge.getStats();
      selection = this.#selectionIndicator.getStats();
      record("Tokenless adapter match ignored", bridge.trackedApplications === 0
        && selection.activeLeases === 0
        && selection.renderedTokens === 0, { bridge, selection });

      // Adapter exceptions must fail closed instead of creating an indicator.
      const throwing = createSyntheticApplication({ id: `${prefix}-throwing-app`, classes: [throwingClass] });
      apps.push(throwing);
      await render(throwing);
      bridge = this.#externalPromptBridge.getStats();
      selection = this.#selectionIndicator.getStats();
      record("Adapter failure isolated", bridge.adapterFailures === baselineBridge.adapterFailures + 1
        && bridge.trackedApplications === 0
        && selection.activeLeases === 0, { bridge, selection });

      // AE5E-owned windows are excluded before external adapters can claim them,
      // even when they also carry a class that would otherwise match.
      const ae5eOwned = createSyntheticApplication({
        id: `${prefix}-ae5e-owned`,
        classes: [`${MODULE_ID}-owned-dialog`, recognizedClass]
      });
      apps.push(ae5eOwned);
      await render(ae5eOwned);
      bridge = this.#externalPromptBridge.getStats();
      selection = this.#selectionIndicator.getStats();
      record("AE5E-owned dialog excluded", bridge.ae5eOwnedIgnored === baselineBridge.ae5eOwnedIgnored + 1
        && bridge.trackedApplications === 0
        && selection.activeLeases === 0, { bridge, selection });

      // One positively recognized application should create exactly one blue
      // external lease and one rendered token indicator.
      const recognizedA = createSyntheticApplication({ id: `${prefix}-recognized-a`, classes: [recognizedClass] });
      apps.push(recognizedA);
      await render(recognizedA);
      bridge = this.#externalPromptBridge.getStats();
      selection = this.#selectionIndicator.getStats();
      record("Recognized prompt tracked once", bridge.trackedApplications === 1
        && selection.activeLeases === 1
        && selection.activeTokens === 1
        && selection.renderedTokens === 1
        && selection.activeRoles?.[SELECTION_INDICATOR_ROLES.EXTERNAL] === 1,
      { bridge, selection });

      // ApplicationV2 may re-render while still open. A re-render must not
      // duplicate its lease or restart another visual.
      const effectsStartedAfterA = selection.effectsStarted;
      await render(recognizedA);
      bridge = this.#externalPromptBridge.getStats();
      selection = this.#selectionIndicator.getStats();
      record("Recognized re-render does not duplicate", bridge.trackedApplications === 1
        && selection.activeLeases === 1
        && selection.renderedTokens === 1
        && selection.effectsStarted === effectsStartedAfterA,
      { bridge, selection });

      // A second recognized application for the same token gets its own lease
      // but shares the one rendered blue indicator.
      const recognizedB = createSyntheticApplication({ id: `${prefix}-recognized-b`, classes: [recognizedClass] });
      apps.push(recognizedB);
      await render(recognizedB);
      bridge = this.#externalPromptBridge.getStats();
      selection = this.#selectionIndicator.getStats();
      record("Two external prompts share one visual", bridge.trackedApplications === 2
        && selection.activeLeases === 2
        && selection.activeTokens === 1
        && selection.renderedTokens === 1
        && selection.activeRoles?.[SELECTION_INDICATOR_ROLES.EXTERNAL] === 2,
      { bridge, selection });

      // Closing one prompt must leave the shared visual alive for the other.
      await closeAndSettle(recognizedA);
      bridge = this.#externalPromptBridge.getStats();
      selection = this.#selectionIndicator.getStats();
      record("First external close preserves remaining wait", bridge.trackedApplications === 1
        && selection.activeLeases === 1
        && selection.activeTokens === 1
        && selection.renderedTokens === 1,
      { bridge, selection });

      // Closing the final prompt must return both services to a clean baseline.
      await closeAndSettle(recognizedB);
      bridge = this.#externalPromptBridge.getStats();
      selection = this.#selectionIndicator.getStats();
      record("Final external close fully cleans up", bridge.trackedApplications === 0
        && selection.activeLeases === 0
        && selection.activeTokens === 0
        && selection.renderedTokens === 0,
      { bridge, selection });
    } finally {
      for (const app of apps) {
        try { app.close(); } catch (_) { /* no-op */ }
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      await this.#externalPromptBridge.clearAll();
      for (const fn of unregister.reverse()) {
        try { fn(); } catch (_) { /* no-op */ }
      }
    }

    const finalBridge = this.#externalPromptBridge.getStats();
    const finalSelection = this.#selectionIndicator.getStats();
    const cleanupPassed = finalBridge.trackedApplications === 0
      && finalSelection.activeLeases === 0
      && finalSelection.activeTokens === 0
      && finalSelection.renderedTokens === 0;
    record("Test cleanup", cleanupPassed, { finalBridge, finalSelection });

    const passed = checks.every((check) => check.passed);
    const report = {
      result: passed ? "PASS" : "FAIL",
      tokenUuid: token.document.uuid,
      tokenName: token.name,
      checks,
      baselineBridge,
      baselineSelection,
      finalBridge,
      finalSelection
    };
    Logger.info("AE5E 0.3.27 external-prompt isolation regression", report);
    ui?.notifications?.[passed ? "info" : "error"]?.(
      passed
        ? "AE5E | External-prompt isolation regression passed. Unknown/tokenless/failing prompts stayed inert and recognized prompts cleaned up correctly."
        : "AE5E | External-prompt isolation regression failed. See the console for details."
    );
    return report;
  }

  async createTestRelationshipFromControlledTokens() {
    const [leader, follower] = this.#controlledPair();
    const relationship = await this.#relationships.create({
      type: RELATIONSHIP_TYPES.TEST,
      attachmentMode: ATTACHMENT_MODES.ADJACENT_FOLLOWER,
      leaderUuid: leader.uuid,
      followerUuid: follower.uuid,
      followerCanSelfMove: false,
      followElevation: true,
      followRotation: false,
      teleportPolicy: TELEPORT_POLICIES.DETACH,
      collisionPolicy: COLLISION_POLICIES.STOP_GROUP,
      coordinationPolicy: RELATIONSHIP_COORDINATION_POLICIES.COORDINATED,
      rotationPolicy: RELATIONSHIP_ROTATION_POLICIES.ORBIT_FOLLOWER,
      metadata: { createdByTestHarness: true }
    });
    this.#leaveLeaderControlled(leader);
    ui.notifications.info(`Created test relationship ${relationship.id}. The leader remains controlled; move it to test coordinated following.`);
    return relationship;
  }

  async createGrappleMovementTestRelationshipFromControlledTokens(options = {}) {
    const [leader, follower] = this.#controlledPair();
    const scene = leader.parent;
    const gridDistance = Number(scene?.grid?.distance);
    const defaultDistance = Number.isFinite(gridDistance) && gridDistance > 0 ? gridDistance : 5;
    const currentPlanarDistance = RelationshipGeometryService.planarDistance({ scene, leader, follower });
    const breakDistance = Number.isFinite(Number(options.breakDistance)) && Number(options.breakDistance) >= 0
      ? Number(options.breakDistance)
      : defaultDistance;
    const coordinationDistance = Number.isFinite(Number(options.coordinationDistance)) && Number(options.coordinationDistance) >= 0
      ? Number(options.coordinationDistance)
      : (Number.isFinite(currentPlanarDistance) && currentPlanarDistance > 0 ? currentPlanarDistance : defaultDistance);

    if (coordinationDistance > breakDistance + 1e-6) {
      throw new Error(`The test coordination distance (${coordinationDistance}) cannot exceed breakDistance (${breakDistance}).`);
    }
    if (Number.isFinite(currentPlanarDistance) && currentPlanarDistance > breakDistance + 1e-6) {
      throw new Error(`The controlled tokens are currently ${currentPlanarDistance} distance units apart, beyond breakDistance ${breakDistance}.`);
    }
    if (Object.prototype.hasOwnProperty.call(options, "coordinationDistance")
      && Number.isFinite(currentPlanarDistance)
      && currentPlanarDistance > 1e-6
      && Math.abs(currentPlanarDistance - coordinationDistance) > 1e-6) {
      throw new Error(`The controlled tokens are currently ${currentPlanarDistance} distance units apart; place them on the requested ${coordinationDistance}-unit coordination band first.`);
    }

    const relationship = await this.#relationships.create({
      type: RELATIONSHIP_TYPES.TEST,
      attachmentMode: ATTACHMENT_MODES.GRAPPLE_FOLLOWER,
      leaderUuid: leader.uuid,
      followerUuid: follower.uuid,
      followerCanSelfMove: false,
      followElevation: true,
      followRotation: false,
      teleportPolicy: TELEPORT_POLICIES.DETACH,
      collisionPolicy: COLLISION_POLICIES.STOP_GROUP,
      coordinationPolicy: RELATIONSHIP_COORDINATION_POLICIES.COORDINATED,
      forcedLeaderMovementPolicy: RELATIONSHIP_FORCED_LEADER_MOVEMENT_POLICIES.INDEPENDENT,
      rotationPolicy: RELATIONSHIP_ROTATION_POLICIES.ORBIT_FOLLOWER,
      breakDistance,
      coordinationDistance,
      metadata: {
        createdByTestHarness: true,
        grappleMovementFixture: true,
        requestedTestOptions: { breakDistance, coordinationDistance }
      }
    });

    this.#leaveLeaderControlled(leader);
    ui.notifications.info(
      `Created grapple-like test relationship ${relationship.id} with break distance ${breakDistance} and coordination distance ${coordinationDistance}.`
    );
    return relationship;
  }

  async removeTestRelationships() {
    this.#orbitOverlay.clear();
    const tests = this.#relationships.list({ type: RELATIONSHIP_TYPES.TEST })
      .filter((relationship) => relationship.metadata?.createdByTestHarness === true);
    const results = [];
    for (const relationship of tests) {
      results.push({ id: relationship.id, removed: await this.#relationships.remove(relationship.id) });
    }
    ui.notifications.info(`Removed ${results.filter((entry) => entry.removed).length} test relationship(s).`);
    return results;
  }

  inspectControlledRelationship() {
    if (!canvas?.ready) throw new Error("A Scene canvas must be active.");
    const controlled = canvas.tokens.controlled.map((token) => token.document);
    if (controlled.length !== 1) throw new Error("Control exactly one token to inspect its relationships.");
    const token = controlled[0];
    const result = {
      tokenUuid: token.uuid,
      asLeader: this.#relationships.getForLeader(token.uuid),
      asFollower: this.#relationships.getForFollower(token.uuid),
      movement: this.#relationshipMovement.getStats(),
      rotation: this.#relationshipRotation.getStats()
    };
    Logger.info("Controlled token relationship inspection", result);
    return result;
  }

  async inspectRelationshipGeometry(options = {}) {
    const resolved = await this.#resolveRelationshipTokens(options);
    const { relationship, scene, leader, follower } = resolved;
    const shell = RelationshipGeometryService.generateOrbitShell({ scene, leader, follower, relationship });
    const current = RelationshipGeometryService.findOrbitPosition({ shell, follower });
    const clockwise = RelationshipGeometryService.planOrbitStep({ scene, leader, follower, relationship, direction: 1 });
    const counterclockwise = RelationshipGeometryService.planOrbitStep({ scene, leader, follower, relationship, direction: -1 });
    const result = {
      relationshipId: relationship.id,
      leader: this.#tokenGeometry(leader),
      follower: this.#tokenGeometry(follower),
      breakDistance: relationship.breakDistance ?? null,
      coordinationDistance: RelationshipGeometryService.coordinationDistance({ scene, relationship, leader, follower }),
      currentFollowerBearing: current?.bearing ?? null,
      currentOrbitIndex: current?.index ?? null,
      shellPositions: shell.length,
      clockwiseCandidate: clockwise.target,
      clockwiseDelta: clockwise.angularDelta,
      counterclockwiseCandidate: counterclockwise.target,
      counterclockwiseDelta: counterclockwise.angularDelta,
      rotationDiagnostics: this.#relationshipRotation.getDiagnostics(relationship.id)
    };
    Logger.info("Relationship geometry inspection", result);
    return result;
  }

  async inspectOrbitShell(options = {}) {
    const { relationship, scene, leader, follower } = await this.#resolveRelationshipTokens(options);
    const shell = RelationshipGeometryService.generateOrbitShell({ scene, leader, follower, relationship });
    const result = shell.map((position) => ({
      index: position.index,
      x: position.x,
      y: position.y,
      bearing: position.bearing,
      distance: position.distance
    }));
    Logger.info("Relationship orbit shell", { relationshipId: relationship.id, positions: result });
    return result;
  }

  async validateRelationshipGeometry(options = {}) {
    const { relationship, scene, leader, follower } = await this.#resolveRelationshipTokens(options);
    const result = RelationshipGeometryService.validateOrbitShell({ scene, leader, follower, relationship });
    Logger.info("Relationship geometry validation", { relationshipId: relationship.id, ...result });
    ui?.notifications?.[result.passed ? "info" : "warn"]?.(
      result.passed
        ? `Relationship geometry validation passed (${result.shellSize} orbit positions).`
        : "Relationship geometry validation found a problem. See the console for details."
    );
    return result;
  }

  async showOrbitDebug(options = {}) {
    const { relationship, scene, leader, follower } = await this.#resolveRelationshipTokens(options);
    const shell = RelationshipGeometryService.generateOrbitShell({ scene, leader, follower, relationship });
    const current = RelationshipGeometryService.findOrbitPosition({ shell, follower });
    return this.#orbitOverlay.show({ shell, currentIndex: current?.index ?? null, leader, follower, grid: scene.grid });
  }

  clearOrbitDebug() {
    return this.#orbitOverlay.clear();
  }

  async orbitClockwise(options = {}) {
    const { relationship } = await this.#resolveRelationshipTokens(options);
    return this.#relationshipRotation.requestOrbitStep({ relationshipId: relationship.id, direction: 1 });
  }

  async orbitCounterclockwise(options = {}) {
    const { relationship } = await this.#resolveRelationshipTokens(options);
    return this.#relationshipRotation.requestOrbitStep({ relationshipId: relationship.id, direction: -1 });
  }

  async runFollowerBodyDispositionMatrix({ restoreOnPass = true, graceBufferMs = 700 } = {}) {
    if (!canvas?.ready) throw new Error("A Scene canvas must be active.");
    if (!game.user?.isGM) throw new Error("The follower-body disposition matrix requires a GM user.");

    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const banner = (text, color = "#7ddcff", size = 24) => {
      console.log(`%c${text}`, `font-size:${size}px;font-weight:bold;color:${color};`);
    };
    const angleDifference = (a, b) => Math.abs((((Number(a) - Number(b)) + 540) % 360) - 180);
    const D = globalThis.CONST?.TOKEN_DISPOSITIONS;
    if (!D) throw new Error("Foundry token disposition constants are unavailable.");

    // First validate the centralized resolver itself inside Foundry. This is a
    // synthetic Token-like matrix, so it does not touch the Scene. Neutral and
    // Secret must be universally nonhostile whether they are the reference or
    // the other participant. Friendly/Hostile are opposite sides.
    const resolverFixtures = [
      { name: "Friendly", uuid: "AE5E.Test.Friendly", disposition: D.FRIENDLY },
      { name: "Hostile", uuid: "AE5E.Test.Hostile", disposition: D.HOSTILE },
      { name: "Neutral", uuid: "AE5E.Test.Neutral", disposition: D.NEUTRAL },
      { name: "Secret", uuid: "AE5E.Test.Secret", disposition: D.SECRET }
    ];
    const resolverMatrix = [];
    for (const reference of resolverFixtures) {
      for (const other of resolverFixtures) {
        const expected = (reference.disposition === D.NEUTRAL
          || reference.disposition === D.SECRET
          || other.disposition === D.NEUTRAL
          || other.disposition === D.SECRET
          || reference.disposition === other.disposition)
          ? RELATIVE_TOKEN_RELATIONSHIPS.NONHOSTILE
          : RELATIVE_TOKEN_RELATIONSHIPS.HOSTILE;
        const resolved = this.#relativeRelationships.resolve({ referenceToken: reference, otherToken: other });
        resolverMatrix.push({
          reference: reference.name,
          other: other.name,
          expected,
          actual: resolved.relationship,
          reasonCode: resolved.reasonCode,
          passed: resolved.relationship === expected
        });
      }
    }

    const geometryLeader = { uuid: "AE5E.Test.GeometryLeader", disposition: D.HOSTILE };
    const geometryFollower = { uuid: "AE5E.Test.GeometryFollower", disposition: D.FRIENDLY };
    const geometryOther = { uuid: "AE5E.Test.GeometryOther", disposition: D.HOSTILE };
    const followerBodyReference = this.#relativeRelationships.resolveForGeometry({
      geometryChannel: RELATIONSHIP_GEOMETRY_CHANNELS.FOLLOWER_BODY,
      leaderToken: geometryLeader,
      followerToken: geometryFollower,
      otherToken: geometryOther
    });
    const grappleLinkReference = this.#relativeRelationships.resolveForGeometry({
      geometryChannel: RELATIONSHIP_GEOMETRY_CHANNELS.GRAPPLE_LINK,
      leaderToken: geometryLeader,
      followerToken: geometryFollower,
      otherToken: geometryOther
    });
    const geometryChannelChecks = {
      followerBodyUsesFollower: followerBodyReference.referenceUuid === geometryFollower.uuid,
      followerBodyIsHostileHere: followerBodyReference.relationship === RELATIVE_TOKEN_RELATIONSHIPS.HOSTILE,
      grappleLinkUsesLeader: grappleLinkReference.referenceUuid === geometryLeader.uuid,
      grappleLinkIsNonhostileHere: grappleLinkReference.relationship === RELATIVE_TOKEN_RELATIONSHIPS.NONHOSTILE
    };
    const resolverMatrixPassed = resolverMatrix.every((entry) => entry.passed)
      && Object.values(geometryChannelChecks).every(Boolean);

    banner(
      resolverMatrixPassed
        ? "AE5E RELATIVE-RELATIONSHIP RESOLVER — PASS"
        : "AE5E RELATIVE-RELATIONSHIP RESOLVER — FAIL",
      resolverMatrixPassed ? "#5cff8d" : "#ff5c5c",
      24
    );
    if (!resolverMatrixPassed) {
      console.table(resolverMatrix);
      const report = {
        result: "FAIL",
        stage: "relative-relationship-resolver",
        resolverMatrix,
        geometryChannelChecks,
        followerBodyReference,
        grappleLinkReference
      };
      console.log(JSON.stringify(report, null, 2));
      ui?.notifications?.error?.("AE5E | Relative-relationship resolver matrix FAILED.");
      return report;
    }

    const names = ["Leader", "Follower", "Ally", "Enemy", "Neutral", "Secret"];
    const tokens = {};
    for (const name of names) {
      const matches = canvas.tokens.placeables.filter((token) => token.document.name === name);
      if (matches.length !== 1) {
        throw new Error(`Expected exactly one '${name}' token on the active Scene; found ${matches.length}.`);
      }
      tokens[name] = matches[0].document;
    }

    const snapshots = Object.fromEntries(names.map((name) => {
      const token = tokens[name];
      return [name, {
        _id: token.id,
        x: token.x,
        y: token.y,
        width: token.width,
        height: token.height,
        rotation: token.rotation,
        elevation: token.elevation,
        disposition: token.disposition
      }];
    }));

    const movementActions = globalThis.CONFIG?.Token?.movement?.actions;
    const movementActionEntries = movementActions?.entries
      ? [...movementActions.entries()]
      : Object.entries(movementActions ?? {});
    const fixtureTeleportAction = movementActionEntries.find(([, config]) => config?.teleport === true)?.[0] ?? null;
    if (!fixtureTeleportAction) {
      throw new Error("Follower-body matrix requires a Foundry movement action whose CONFIG.Token.movement action has teleport=true for deterministic fixture placement.");
    }

    const fixtureMove = async (token, { x, y, elevation = 0 }) => {
      const current = canvas.scene.tokens.get(token.id);
      if (current.x === x && current.y === y && Number(current.elevation ?? 0) === Number(elevation)) return current;
      const completed = await current.move({
        x,
        y,
        elevation,
        action: fixtureTeleportAction,
        explicit: true,
        checkpoint: true
      }, {
        method: "api",
        animate: false,
        showRuler: false,
        pan: false,
        autoRotate: false,
        constrainOptions: { ignoreWalls: true, ignoreCost: true, ignoreTokens: true },
        ...this.#movement.createOperationOptions({
          pathType: "reposition",
          agency: "administrative",
          resource: "none",
          movementMode: fixtureTeleportAction,
          administrative: true,
          generatedBy: MODULE_ID,
          internal: true,
          suppressAutomation: true,
          testFixture: true
        })
      });
      await wait(75);
      const after = canvas.scene.tokens.get(token.id);
      if (after.x !== x || after.y !== y || Number(after.elevation ?? 0) !== Number(elevation)) {
        throw new Error(`FIXTURE FAIL | ${token.name} expected (${x},${y},${elevation}); actual (${after.x},${after.y},${after.elevation}); moveCompleted=${completed}.`);
      }
      return after;
    };

    const base = { x: 2200, y: 2800 };
    const followerStart = { x: 2300, y: 2800 };
    const parking = {
      Ally: { x: 3400, y: 2400 },
      Enemy: { x: 3600, y: 2400 },
      Neutral: { x: 3400, y: 2600 },
      Secret: { x: 3600, y: 2600 }
    };

    const cases = [
      {
        id: 1,
        label: "HOSTILE Leader / FRIENDLY Follower -> Hostile Ally",
        leaderDisposition: D.HOSTILE,
        followerDisposition: D.FRIENDLY,
        obstacle: "Ally",
        expected: "hard"
      },
      {
        id: 2,
        label: "HOSTILE Leader / FRIENDLY Follower -> Friendly Enemy",
        leaderDisposition: D.HOSTILE,
        followerDisposition: D.FRIENDLY,
        obstacle: "Enemy",
        expected: "soft"
      },
      {
        id: 3,
        label: "HOSTILE Leader / FRIENDLY Follower -> Neutral",
        leaderDisposition: D.HOSTILE,
        followerDisposition: D.FRIENDLY,
        obstacle: "Neutral",
        expected: "soft"
      },
      {
        id: 4,
        label: "HOSTILE Leader / FRIENDLY Follower -> Secret",
        leaderDisposition: D.HOSTILE,
        followerDisposition: D.FRIENDLY,
        obstacle: "Secret",
        expected: "soft"
      },
      {
        id: 5,
        label: "FRIENDLY Leader / HOSTILE Follower -> Hostile Ally",
        leaderDisposition: D.FRIENDLY,
        followerDisposition: D.HOSTILE,
        obstacle: "Ally",
        expected: "soft"
      },
      {
        id: 6,
        label: "FRIENDLY Leader / HOSTILE Follower -> Friendly Enemy",
        leaderDisposition: D.FRIENDLY,
        followerDisposition: D.HOSTILE,
        obstacle: "Enemy",
        expected: "hard"
      },
      {
        id: 7,
        label: "FRIENDLY Leader / HOSTILE Follower -> Neutral",
        leaderDisposition: D.FRIENDLY,
        followerDisposition: D.HOSTILE,
        obstacle: "Neutral",
        expected: "soft"
      },
      {
        id: 8,
        label: "FRIENDLY Leader / HOSTILE Follower -> Secret",
        leaderDisposition: D.FRIENDLY,
        followerDisposition: D.HOSTILE,
        obstacle: "Secret",
        expected: "soft"
      }
    ];

    const removeHarnessRelationships = async () => {
      const relationships = this.#relationships.list({ sceneId: canvas.scene.id, type: RELATIONSHIP_TYPES.TEST })
        .filter((relationship) => relationship.metadata?.createdByTestHarness === true);
      for (const relationship of relationships) await this.#relationships.remove(relationship.id);
    };

    const ensureNoUnrelatedParticipantRelationships = () => {
      const participantUuids = new Set([tokens.Leader.uuid, tokens.Follower.uuid]);
      const conflicts = this.#relationships.list({ sceneId: canvas.scene.id }).filter((relationship) => (
        participantUuids.has(relationship.leaderUuid) || participantUuids.has(relationship.followerUuid)
      ) && !(relationship.type === RELATIONSHIP_TYPES.TEST && relationship.metadata?.createdByTestHarness === true));
      if (conflicts.length) {
        throw new Error(`Leader/Follower participate in ${conflicts.length} non-test relationship(s). Remove those relationships before running this matrix.`);
      }
    };

    const setupCase = async (testCase) => {
      await removeHarnessRelationships();
      await wait(100);

      await canvas.scene.updateEmbeddedDocuments("Token", [
        {
          _id: tokens.Leader.id,
          width: 1,
          height: 1,
          rotation: 15,
          disposition: testCase.leaderDisposition
        },
        {
          _id: tokens.Follower.id,
          width: 1,
          height: 1,
          rotation: 0,
          disposition: testCase.followerDisposition
        },
        {
          _id: tokens.Ally.id,
          width: 1,
          height: 1,
          rotation: 0,
          disposition: D.HOSTILE
        },
        {
          _id: tokens.Enemy.id,
          width: 1,
          height: 1,
          rotation: 0,
          disposition: D.FRIENDLY
        },
        {
          _id: tokens.Neutral.id,
          width: 1,
          height: 1,
          rotation: 0,
          disposition: D.NEUTRAL
        },
        {
          _id: tokens.Secret.id,
          width: 1,
          height: 1,
          rotation: 0,
          disposition: D.SECRET
        }
      ], {
        animate: false,
        ae5eDiagnosticSetup: true
      });
      await wait(75);

      await fixtureMove(canvas.scene.tokens.get(tokens.Leader.id), { ...base, elevation: 0 });
      await fixtureMove(canvas.scene.tokens.get(tokens.Follower.id), { ...followerStart, elevation: 0 });
      for (const [name, position] of Object.entries(parking)) {
        await fixtureMove(canvas.scene.tokens.get(tokens[name].id), { ...position, elevation: 0 });
      }
      await wait(75);

      const leader = canvas.scene.tokens.get(tokens.Leader.id);
      const follower = canvas.scene.tokens.get(tokens.Follower.id);
      const relationship = await this.#relationships.create({
        type: RELATIONSHIP_TYPES.TEST,
        attachmentMode: ATTACHMENT_MODES.GRAPPLE_FOLLOWER,
        leaderUuid: leader.uuid,
        followerUuid: follower.uuid,
        followerCanSelfMove: false,
        followElevation: true,
        followRotation: false,
        teleportPolicy: TELEPORT_POLICIES.DETACH,
        collisionPolicy: COLLISION_POLICIES.STOP_GROUP,
        coordinationPolicy: RELATIONSHIP_COORDINATION_POLICIES.COORDINATED,
        forcedLeaderMovementPolicy: RELATIONSHIP_FORCED_LEADER_MOVEMENT_POLICIES.INDEPENDENT,
        rotationPolicy: RELATIONSHIP_ROTATION_POLICIES.ORBIT_FOLLOWER,
        breakDistance: 5,
        coordinationDistance: 5,
        metadata: {
          createdByTestHarness: true,
          grappleMovementFixture: true,
          followerBodyDispositionMatrix: true,
          caseId: testCase.id
        }
      });
      await wait(125);

      const plan = RelationshipGeometryService.planOrbitStep({
        scene: canvas.scene,
        leader,
        follower,
        relationship,
        direction: 1
      });
      let obstacle = canvas.scene.tokens.get(tokens[testCase.obstacle].id);
      obstacle = await fixtureMove(obstacle, {
        x: plan.target.x,
        y: plan.target.y,
        elevation: 0
      });
      await wait(100);

      const fixtureChecks = {
        obstacleX: obstacle.x === plan.target.x,
        obstacleY: obstacle.y === plan.target.y,
        obstacleElevation: Number(obstacle.elevation ?? 0) === 0,
        leaderX: leader.x === base.x,
        leaderY: leader.y === base.y,
        followerX: follower.x === followerStart.x,
        followerY: follower.y === followerStart.y
      };
      for (const otherName of ["Ally", "Enemy", "Neutral", "Secret"]) {
        if (otherName === testCase.obstacle) continue;
        const other = canvas.scene.tokens.get(tokens[otherName].id);
        fixtureChecks[`${otherName}NotAtEndpoint`] = !(other.x === plan.target.x && other.y === plan.target.y);
      }
      if (!Object.values(fixtureChecks).every(Boolean)) {
        throw new Error(`CASE ${testCase.id} | FIXTURE FAIL: ${JSON.stringify(fixtureChecks)}`);
      }

      const resolver = this.#relativeRelationships.resolveForGeometry({
        geometryChannel: RELATIONSHIP_GEOMETRY_CHANNELS.FOLLOWER_BODY,
        leaderToken: leader,
        followerToken: follower,
        otherToken: obstacle
      });

      return { relationship, leader, follower, obstacle, plan, resolver, fixtureChecks };
    };

    ensureNoUnrelatedParticipantRelationships();
    banner("AE5E 0.3.25 FOLLOWER-BODY DISPOSITION MATRIX", "#7ddcff", 30);
    banner("8 AUTOMATIC FOUNDRY CASES", "#ffcc66", 19);

    const results = [];
    let failure = null;

    for (const testCase of cases) {
      banner(`CASE ${testCase.id} OF 8 — ${testCase.label}`, "#7ddcff", 20);
      banner(`EXPECTED: ${testCase.expected.toUpperCase()}`, testCase.expected === "hard" ? "#ffcc66" : "#c18cff", 17);

      const fixture = await setupCase(testCase);
      const expectedRelationship = testCase.expected === "hard"
        ? RELATIVE_TOKEN_RELATIONSHIPS.HOSTILE
        : RELATIVE_TOKEN_RELATIONSHIPS.NONHOSTILE;
      const start = {
        follower: { x: fixture.follower.x, y: fixture.follower.y },
        leaderRotation: fixture.leader.rotation,
        orbitIndex: fixture.plan.current.index
      };

      const directResult = await this.#relationshipRotation.requestOrbitStep({
        relationshipId: fixture.relationship.id,
        direction: 1
      });
      await this.#relationshipRotation.waitForSettled({ leaderUuid: fixture.leader.uuid });
      await wait(175);

      const immediateLeader = canvas.scene.tokens.get(tokens.Leader.id);
      const immediateFollower = canvas.scene.tokens.get(tokens.Follower.id);
      const immediateStats = this.#relationshipRotation.getStats();
      const decision = immediateStats.lastDecision;
      const pending = immediateStats.pendingNonhostileOverlaps ?? immediateStats.pendingAlliedOverlaps ?? 0;

      if (testCase.expected === "hard") {
        const checks = {
          resolverHostile: fixture.resolver.relationship === expectedRelationship,
          resolverReferenceFollower: fixture.resolver.referenceUuid === fixture.follower.uuid,
          resolverGeometryFollowerBody: fixture.resolver.geometryChannel === RELATIONSHIP_GEOMETRY_CHANNELS.FOLLOWER_BODY,
          resultNotCompleted: directResult?.completed !== true,
          decisionNotCompleted: decision?.completed !== true,
          hostileReason: decision?.obstruction?.reasonCode === "hostile-creature",
          obstructionFollowerBody: decision?.obstruction?.geometryChannel === RELATIONSHIP_GEOMETRY_CHANNELS.FOLLOWER_BODY,
          followerStayedX: immediateFollower.x === start.follower.x,
          followerStayedY: immediateFollower.y === start.follower.y,
          leaderRotationRestored: angleDifference(immediateLeader.rotation, start.leaderRotation) < 0.001,
          noPendingGrace: pending === 0,
          queuesClear: (immediateStats.pendingEvents ?? 0) === 0
            && (immediateStats.processingRelationships ?? 0) === 0
            && (immediateStats.activeGmRequests ?? 0) === 0
        };
        const passed = Object.values(checks).every(Boolean);
        const result = {
          case: testCase.id,
          label: testCase.label,
          expected: "hard",
          passed,
          resolver: fixture.resolver,
          fixtureChecks: fixture.fixtureChecks,
          checks,
          directResult,
          lastDecision: decision
        };
        results.push(result);
        if (!passed) {
          failure = result;
          banner(`CASE ${testCase.id} — FAIL`, "#ff5c5c", 28);
          console.error(result);
          break;
        }
        banner(`CASE ${testCase.id} — PASS | HARD BLOCK`, "#5cff8d", 21);
        continue;
      }

      const immediateChecks = {
        resolverNonhostile: fixture.resolver.relationship === expectedRelationship,
        resolverReferenceFollower: fixture.resolver.referenceUuid === fixture.follower.uuid,
        resolverGeometryFollowerBody: fixture.resolver.geometryChannel === RELATIONSHIP_GEOMETRY_CHANNELS.FOLLOWER_BODY,
        resultCompleted: directResult?.completed === true,
        decisionCompleted: decision?.completed === true,
        followerReachedX: immediateFollower.x === fixture.plan.target.x,
        followerReachedY: immediateFollower.y === fixture.plan.target.y,
        pendingGrace: pending >= 1,
        endpointConflictRecorded: Array.isArray(decision?.followerBody?.endpointConflicts)
          && decision.followerBody.endpointConflicts.some((entry) => entry.otherUuid === fixture.obstacle.uuid
            && entry.relationship === RELATIVE_TOKEN_RELATIONSHIPS.NONHOSTILE),
        queuesOtherwiseClear: (immediateStats.pendingEvents ?? 0) === 0
          && (immediateStats.processingRelationships ?? 0) === 0
          && (immediateStats.activeGmRequests ?? 0) === 0
      };
      if (!Object.values(immediateChecks).every(Boolean)) {
        const result = {
          case: testCase.id,
          label: testCase.label,
          expected: "soft",
          stage: "entry",
          passed: false,
          resolver: fixture.resolver,
          fixtureChecks: fixture.fixtureChecks,
          immediateChecks,
          directResult,
          lastDecision: decision
        };
        results.push(result);
        failure = result;
        banner(`CASE ${testCase.id} — FAIL DURING SOFT ENTRY`, "#ff5c5c", 28);
        console.error(result);
        break;
      }

      banner(`CASE ${testCase.id} — SOFT CONFLICT / GRACE ACTIVE`, "#c18cff", 19);
      const configuredGrace = Number(fixture.relationship.nonhostileEndpointGraceMs ?? fixture.relationship.alliedEndpointGraceMs ?? 3500);
      await wait(Math.max(1, configuredGrace) + Math.max(250, Number(graceBufferMs) || 700));
      await this.#relationshipRotation.waitForSettled({ leaderUuid: fixture.leader.uuid });
      await wait(100);

      const finalLeader = canvas.scene.tokens.get(tokens.Leader.id);
      const finalFollower = canvas.scene.tokens.get(tokens.Follower.id);
      const finalStats = this.#relationshipRotation.getStats();
      const finalPending = finalStats.pendingNonhostileOverlaps ?? finalStats.pendingAlliedOverlaps ?? 0;
      const rollbackChecks = {
        followerRolledBackX: finalFollower.x === start.follower.x,
        followerRolledBackY: finalFollower.y === start.follower.y,
        leaderRotationRolledBack: angleDifference(finalLeader.rotation, start.leaderRotation) < 0.001,
        graceCleared: finalPending === 0,
        queuesClear: (finalStats.pendingEvents ?? 0) === 0
          && (finalStats.processingRelationships ?? 0) === 0
          && (finalStats.activeGmRequests ?? 0) === 0
      };
      const passed = Object.values(rollbackChecks).every(Boolean);
      const result = {
        case: testCase.id,
        label: testCase.label,
        expected: "soft",
        passed,
        resolver: fixture.resolver,
        fixtureChecks: fixture.fixtureChecks,
        immediateChecks,
        rollbackChecks,
        directResult,
        lastDecision: decision
      };
      results.push(result);
      if (!passed) {
        failure = result;
        banner(`CASE ${testCase.id} — FAIL DURING GRACE ROLLBACK`, "#ff5c5c", 28);
        console.error(result);
        break;
      }
      banner(`CASE ${testCase.id} — PASS | SOFT → ROLLBACK`, "#5cff8d", 21);
    }

    const passed = failure === null && results.length === cases.length && results.every((entry) => entry.passed === true);
    const summary = results.map((entry) => ({
      case: entry.case,
      scenario: entry.label,
      expected: entry.expected,
      result: entry.passed ? "PASS" : "FAIL"
    }));

    if (passed) {
      await removeHarnessRelationships();
      await wait(100);
      if (restoreOnPass) {
        await canvas.scene.updateEmbeddedDocuments("Token", Object.values(snapshots).map((snapshot) => ({
          _id: snapshot._id,
          width: snapshot.width,
          height: snapshot.height,
          rotation: snapshot.rotation,
          disposition: snapshot.disposition
        })), {
          animate: false,
          ae5eDiagnosticRestore: true
        });
        for (const snapshot of Object.values(snapshots)) {
          await fixtureMove(canvas.scene.tokens.get(snapshot._id), {
            x: snapshot.x,
            y: snapshot.y,
            elevation: snapshot.elevation
          });
        }
      }
      canvas.tokens.releaseAll();
      banner("AE5E FOLLOWER-BODY DISPOSITION MATRIX — PASS", "#5cff8d", 30);
      banner("8 / 8 CASES PASSED", "#5cff8d", 22);
      console.table(summary);
    } else {
      banner("AE5E FOLLOWER-BODY DISPOSITION MATRIX — FAIL", "#ff5c5c", 30);
      if (failure) banner(`FAILED CASE ${failure.case}: ${failure.label}`, "#ffcc66", 20);
      console.log("The failing Foundry fixture and test relationship were intentionally left in place for inspection.");
      console.table(summary);
    }

    const stats = this.#relationshipRotation.getStats();
    const report = {
      result: passed ? "PASS" : "FAIL",
      resolverMatrixPassed,
      resolverMatrix,
      geometryChannelChecks,
      casesPlanned: cases.length,
      casesCompleted: results.length,
      failure,
      runtime: {
        pendingEvents: stats.pendingEvents,
        processingRelationships: stats.processingRelationships,
        activeGmRequests: stats.activeGmRequests,
        pendingNonhostileOverlaps: stats.pendingNonhostileOverlaps,
        pendingAlliedOverlaps: stats.pendingAlliedOverlaps
      },
      summary,
      results
    };

    console.log("%cAE5E FOLLOWER-BODY DISPOSITION MATRIX — FULL RESULT", "font-size:20px;font-weight:bold;color:#7ddcff;");
    console.log(JSON.stringify(report, null, 2));
    ui?.notifications?.[passed ? "info" : "error"]?.(
      passed
        ? "AE5E | Follower-body disposition matrix PASSED."
        : "AE5E | Follower-body disposition matrix FAILED."
    );
    return report;
  }

  async previewDisplacementFromControlledTokens({
    type = DISPLACEMENT_TYPES.PUSH,
    directionConstraint = null,
    distance = null
  } = {}) {
    const [source, target] = this.#controlledPair();
    const gridDistance = Number(canvas.scene?.grid?.distance ?? 5);
    const resolvedConstraint = directionConstraint ?? (type === DISPLACEMENT_TYPES.PULL
      ? DISPLACEMENT_DIRECTION_CONSTRAINTS.STRAIGHT_TOWARD
      : DISPLACEMENT_DIRECTION_CONSTRAINTS.AWAY);
    return this.#displacement.request({
      sourceUuid: source.uuid,
      targetUuid: target.uuid,
      type,
      directionConstraint: resolvedConstraint,
      distance: Number.isFinite(Number(distance)) && Number(distance) > 0 ? Number(distance) : gridDistance
    });
  }

  async runDisplacementFoundationTest({ restoreOnPass = true, graceBufferMs = 700 } = {}) {
    if (!canvas?.ready) throw new Error("A Scene canvas must be active.");
    if (!game.user?.isGM) throw new Error("The displacement foundation test requires a GM user.");

    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const banner = (text, color = "#7ddcff", size = 24) => {
      console.log(`%c${text}`, `font-size:${size}px;font-weight:bold;color:${color};`);
    };
    const D = globalThis.CONST?.TOKEN_DISPOSITIONS;
    if (!D) throw new Error("Foundry token disposition constants are unavailable.");

    const names = ["Leader", "Follower", "Ally", "Enemy", "Neutral", "Secret"];
    const tokens = {};
    for (const name of names) {
      const matches = canvas.tokens.placeables.filter((token) => token.document.name === name);
      if (matches.length !== 1) {
        throw new Error(`Expected exactly one '${name}' token on the active Scene; found ${matches.length}.`);
      }
      tokens[name] = matches[0].document;
    }

    const snapshots = Object.fromEntries(names.map((name) => {
      const token = tokens[name];
      return [name, {
        _id: token.id,
        x: token.x,
        y: token.y,
        width: token.width,
        height: token.height,
        rotation: token.rotation,
        elevation: token.elevation,
        disposition: token.disposition
      }];
    }));

    const removeHarnessRelationships = async () => {
      const relationships = this.#relationships.list({ sceneId: canvas.scene.id, type: RELATIONSHIP_TYPES.TEST })
        .filter((relationship) => relationship.metadata?.createdByTestHarness === true);
      for (const relationship of relationships) await this.#relationships.remove(relationship.id);
    };

    const ensureNoUnrelatedParticipantRelationships = () => {
      const participantUuids = new Set([tokens.Leader.uuid, tokens.Follower.uuid]);
      const conflicts = this.#relationships.list({ sceneId: canvas.scene.id }).filter((relationship) => (
        participantUuids.has(relationship.leaderUuid) || participantUuids.has(relationship.followerUuid)
      ) && !(relationship.type === RELATIONSHIP_TYPES.TEST && relationship.metadata?.createdByTestHarness === true));
      if (conflicts.length) {
        throw new Error(`Leader/Follower participate in ${conflicts.length} non-test relationship(s). Remove those relationships before running the displacement foundation test.`);
      }
    };

    const movementActions = globalThis.CONFIG?.Token?.movement?.actions;
    const entries = movementActions?.entries
      ? [...movementActions.entries()]
      : Object.entries(movementActions ?? {});
    const teleportAction = entries.find(([, config]) => config?.teleport === true)?.[0] ?? null;
    if (!teleportAction) {
      throw new Error("AE5E displacement test requires a Foundry movement action whose CONFIG.Token.movement action has teleport=true for deterministic fixture placement.");
    }

    const removeDiagnosticWalls = async () => {
      const ids = canvas.scene.walls
        .filter((wall) => wall.getFlag(MODULE_ID, "displacementDiagnosticWall") === true)
        .map((wall) => wall.id);
      if (ids.length) await canvas.scene.deleteEmbeddedDocuments("Wall", ids);
    };

    const fixtureMove = async (token, { x, y, elevation = 0 }) => {
      const current = canvas.scene.tokens.get(token.id);
      if (current.x === x && current.y === y && Number(current.elevation ?? 0) === Number(elevation)) return current;
      const completed = await current.move({
        x,
        y,
        elevation,
        action: teleportAction,
        explicit: true,
        checkpoint: true
      }, {
        method: "api",
        animate: false,
        showRuler: false,
        pan: false,
        autoRotate: false,
        constrainOptions: { ignoreWalls: true, ignoreCost: true, ignoreTokens: true },
        ...this.#movement.createOperationOptions({
          pathType: "reposition",
          agency: "administrative",
          resource: "none",
          movementMode: teleportAction,
          administrative: true,
          generatedBy: MODULE_ID,
          internal: true,
          suppressAutomation: true,
          testFixture: true
        })
      });
      await wait(75);
      const after = canvas.scene.tokens.get(token.id);
      if (after.x !== x || after.y !== y || Number(after.elevation ?? 0) !== Number(elevation)) {
        throw new Error(`FIXTURE FAIL | ${token.name} expected (${x},${y},${elevation}); actual (${after.x},${after.y},${after.elevation}); moveCompleted=${completed}.`);
      }
      return after;
    };

    const basePositions = {
      Leader: { x: 2200, y: 2800, elevation: 0 },
      Follower: { x: 2300, y: 2800, elevation: 0 },
      Ally: { x: 3400, y: 2400, elevation: 0 },
      Enemy: { x: 3600, y: 2400, elevation: 0 },
      Neutral: { x: 3400, y: 2600, elevation: 0 },
      Secret: { x: 3600, y: 2600, elevation: 0 }
    };

    const parkAll = async () => {
      for (const [name, position] of Object.entries(basePositions)) {
        await fixtureMove(canvas.scene.tokens.get(tokens[name].id), position);
      }
    };

    const configure = async ({ leaderDisposition = D.HOSTILE, followerDisposition = D.FRIENDLY, leaderSize = 1 } = {}) => {
      this.#displacement.clearEndpointGrace(tokens.Follower.uuid);
      await removeDiagnosticWalls();
      await canvas.scene.updateEmbeddedDocuments("Token", [
        { _id: tokens.Leader.id, width: leaderSize, height: leaderSize, rotation: 0, disposition: leaderDisposition },
        { _id: tokens.Follower.id, width: 1, height: 1, rotation: 0, disposition: followerDisposition },
        { _id: tokens.Ally.id, width: 1, height: 1, rotation: 0, disposition: D.HOSTILE },
        { _id: tokens.Enemy.id, width: 1, height: 1, rotation: 0, disposition: D.FRIENDLY },
        { _id: tokens.Neutral.id, width: 1, height: 1, rotation: 0, disposition: D.NEUTRAL },
        { _id: tokens.Secret.id, width: 1, height: 1, rotation: 0, disposition: D.SECRET }
      ], {
        animate: false,
        ae5eDisplacementTestSetup: true
      });
      await parkAll();
      if (leaderSize === 2) await fixtureMove(canvas.scene.tokens.get(tokens.Leader.id), { x: 2100, y: 2800, elevation: 0 });
      if (leaderSize === 3) await fixtureMove(canvas.scene.tokens.get(tokens.Leader.id), { x: 2000, y: 2800, elevation: 0 });
      await wait(75);
    };

    const candidateKeys = async (options) => {
      const plan = await this.#displacement.getCandidates({
        sourceUuid: tokens.Leader.uuid,
        targetUuid: tokens.Follower.uuid,
        distance: 5,
        ...options
      });
      return { plan, keys: plan.candidates.map((candidate) => candidate.key) };
    };

    const sameKeys = (actual, expected) => actual.length === expected.length
      && actual.every((key) => expected.includes(key));

    const results = [];
    let failure = null;
    let passed = false;

    try {
      banner("AE5E 0.3.25 — DISPLACEMENT FOUNDATION", "#7ddcff", 30);
      banner("DIRECTION GEOMETRY + FORCED METADATA + COLLISION + GRACE", "#ffcc66", 18);
      ensureNoUnrelatedParticipantRelationships();
      await removeHarnessRelationships();
      await removeDiagnosticWalls();

      // --------------------------------------------------------
      // Direction semantics: 1x1 source directly west of target.
      // --------------------------------------------------------
      await configure({ leaderDisposition: D.HOSTILE, followerDisposition: D.FRIENDLY, leaderSize: 1 });
      const pushAway = await candidateKeys({
        type: DISPLACEMENT_TYPES.PUSH,
        directionConstraint: DISPLACEMENT_DIRECTION_CONSTRAINTS.AWAY
      });
      const pushStraight = await candidateKeys({
        type: DISPLACEMENT_TYPES.PUSH,
        directionConstraint: DISPLACEMENT_DIRECTION_CONSTRAINTS.STRAIGHT_AWAY
      });
      const pullStraight = await candidateKeys({
        type: DISPLACEMENT_TYPES.PULL,
        directionConstraint: DISPLACEMENT_DIRECTION_CONSTRAINTS.STRAIGHT_TOWARD
      });

      const directionChecks = {
        pushAwayThree: sameKeys(pushAway.keys, ["NE", "E", "SE"]),
        pushStraightEast: sameKeys(pushStraight.keys, ["E"]),
        pullStraightWest: sameKeys(pullStraight.keys, ["W"])
      };
      results.push({ name: "1x1 direction semantics", passed: Object.values(directionChecks).every(Boolean), checks: directionChecks });
      if (!results.at(-1).passed) throw new Error("1x1 direction semantic checks failed.");
      banner("1x1 AWAY / STRAIGHT_AWAY / STRAIGHT_TOWARD — PASS", "#5cff8d", 20);

      // --------------------------------------------------------
      // Large-source center-relative geometry.
      // --------------------------------------------------------
      await configure({ leaderDisposition: D.HOSTILE, followerDisposition: D.FRIENDLY, leaderSize: 2 });
      const large2 = await candidateKeys({
        type: DISPLACEMENT_TYPES.PUSH,
        directionConstraint: DISPLACEMENT_DIRECTION_CONSTRAINTS.AWAY
      });
      await configure({ leaderDisposition: D.HOSTILE, followerDisposition: D.FRIENDLY, leaderSize: 3 });
      const large3 = await candidateKeys({
        type: DISPLACEMENT_TYPES.PUSH,
        directionConstraint: DISPLACEMENT_DIRECTION_CONSTRAINTS.AWAY
      });
      const largeChecks = {
        source2x2FourDirections: sameKeys(large2.keys, ["N", "NE", "E", "SE"]),
        source3x3FourDirections: sameKeys(large3.keys, ["N", "NE", "E", "SE"])
      };
      results.push({ name: "large-source center-relative geometry", passed: Object.values(largeChecks).every(Boolean), checks: largeChecks });
      if (!results.at(-1).passed) throw new Error("Large-source center-relative direction checks failed.");
      banner("2x2 / 3x3 SOURCE CENTER-RELATIVE DIRECTION GEOMETRY — PASS", "#5cff8d", 20);

      // --------------------------------------------------------
      // Pull execution uses the same forced-displacement body pipeline.
      // Keep one clear grid space between Source and Target so a 5-ft
      // STRAIGHT_TOWARD pull can end adjacent to the Source. Then prove
      // a hostile body in that destination blocks the pull.
      // --------------------------------------------------------
      await configure({ leaderDisposition: D.HOSTILE, followerDisposition: D.FRIENDLY, leaderSize: 1 });
      await fixtureMove(canvas.scene.tokens.get(tokens.Leader.id), { x: 2100, y: 2800, elevation: 0 });
      const clearPull = await this.#displacement.pull({
        sourceUuid: tokens.Leader.uuid,
        targetUuid: tokens.Follower.uuid,
        distance: 5
      });
      await wait(175);
      const clearPullFollower = canvas.scene.tokens.get(tokens.Follower.id);
      const clearPullPosition = { x: clearPullFollower.x, y: clearPullFollower.y };

      await configure({ leaderDisposition: D.HOSTILE, followerDisposition: D.FRIENDLY, leaderSize: 1 });
      await fixtureMove(canvas.scene.tokens.get(tokens.Leader.id), { x: 2100, y: 2800, elevation: 0 });
      await fixtureMove(canvas.scene.tokens.get(tokens.Ally.id), { x: 2200, y: 2800, elevation: 0 });
      const blockedPull = await this.#displacement.pull({
        sourceUuid: tokens.Leader.uuid,
        targetUuid: tokens.Follower.uuid,
        distance: 5
      });
      const blockedPullFollower = canvas.scene.tokens.get(tokens.Follower.id);
      const pullExecutionChecks = {
        clearCompleted: clearPull?.completed === true,
        clearTypePull: clearPull?.type === DISPLACEMENT_TYPES.PULL,
        clearDirectionWest: clearPull?.directionKey === "W",
        clearFullDistance: clearPull?.fullDistance === true && clearPull?.actualDistance === 5,
        clearEndedAdjacent: clearPullPosition.x === 2200 && clearPullPosition.y === 2800,
        hostileBlocked: blockedPull?.blocked === true,
        hostileStayed: blockedPullFollower.x === 2300 && blockedPullFollower.y === 2800,
        noGrace: this.#displacement.getStats().endpointGrace.pending === 0
      };
      results.push({
        name: "pull execution and hostile collision",
        passed: Object.values(pullExecutionChecks).every(Boolean),
        checks: pullExecutionChecks,
        clearResult: clearPull,
        blockedResult: blockedPull
      });
      if (!results.at(-1).passed) throw new Error("Pull execution/collision checks failed.");
      banner("PULL EXECUTION + HOSTILE COLLISION — PASS", "#5cff8d", 20);

      // --------------------------------------------------------
      // Hostile relative to TARGET must hard-block. Leader is
      // Hostile too, proving Source disposition is not the body reference.
      // --------------------------------------------------------
      await configure({ leaderDisposition: D.HOSTILE, followerDisposition: D.FRIENDLY, leaderSize: 1 });
      await fixtureMove(canvas.scene.tokens.get(tokens.Ally.id), { x: 2400, y: 2800, elevation: 0 });
      const hard = await this.#displacement.push({
        sourceUuid: tokens.Leader.uuid,
        targetUuid: tokens.Follower.uuid,
        distance: 5,
        directionConstraint: DISPLACEMENT_DIRECTION_CONSTRAINTS.STRAIGHT_AWAY,
        directionKey: "E"
      });
      const hardFollower = canvas.scene.tokens.get(tokens.Follower.id);
      const hardChecks = {
        blocked: hard?.blocked === true,
        followerStayed: hardFollower.x === 2300 && hardFollower.y === 2800,
        noGrace: this.#displacement.getStats().endpointGrace.pending === 0
      };
      results.push({ name: "target-relative hostile hard block", passed: Object.values(hardChecks).every(Boolean), checks: hardChecks, result: hard });
      if (!results.at(-1).passed) throw new Error("Target-relative hostile hard-block checks failed.");
      banner("HOSTILE RELATIVE TO DISPLACED TARGET — HARD BLOCK PASS", "#5cff8d", 20);

      // --------------------------------------------------------
      // Friendly relative to TARGET: move into space, classify as
      // FORCED, start default 3.5s grace, then roll back one step.
      // --------------------------------------------------------
      await configure({ leaderDisposition: D.HOSTILE, followerDisposition: D.FRIENDLY, leaderSize: 1 });
      await fixtureMove(canvas.scene.tokens.get(tokens.Enemy.id), { x: 2500, y: 2800, elevation: 0 });
      let captured = null;
      const unregisterCapture = this.#movement.registerConsumer({
        id: `${MODULE_ID}.tests.displacement-capture.${Date.now()}`,
        phases: [MOVEMENT_PHASES.AFTER],
        tokenUuids: [tokens.Follower.uuid],
        execution: "primaryGM",
        priority: 20_000,
        once: true,
        handler: (transaction) => { captured = transaction; }
      });
      let soft;
      try {
        soft = await this.#displacement.push({
          sourceUuid: tokens.Leader.uuid,
          targetUuid: tokens.Follower.uuid,
          distance: 10,
          directionConstraint: DISPLACEMENT_DIRECTION_CONSTRAINTS.STRAIGHT_AWAY,
          directionKey: "E"
        });
        await wait(175);
      } finally {
        unregisterCapture();
      }
      const softImmediate = canvas.scene.tokens.get(tokens.Follower.id);
      const softImmediateChecks = {
        completed: soft?.completed === true,
        requestedTenFeet: soft?.requestedDistance === 10,
        actualTenFeet: soft?.actualDistance === 10 && soft?.fullDistance === true && soft?.partial === false,
        reachedEndpoint: softImmediate.x === 2500 && softImmediate.y === 2800,
        graceStarted: soft?.graceStarted === true && this.#displacement.getStats().endpointGrace.pending === 1,
        transactionCaptured: Boolean(captured),
        agencyForced: captured?.agency === MOVEMENT_AGENCIES.FORCED,
        displacementType: captured?.displacementType === DISPLACEMENT_TYPES.PUSH,
        directionConstraint: captured?.directionConstraint === DISPLACEMENT_DIRECTION_CONSTRAINTS.STRAIGHT_AWAY,
        directionEast: captured?.displacementDirection === "E",
        transactionRequestedTenFeet: captured?.requestedDistance === 10,
        transactionActualTenFeet: captured?.actualDistance === 10,
        sourceRecorded: captured?.sourceUuid === tokens.Leader.uuid,
        targetRecorded: captured?.subjectUuid === tokens.Follower.uuid
      };
      if (!Object.values(softImmediateChecks).every(Boolean)) {
        const failedChecks = Object.entries(softImmediateChecks)
          .filter(([, passed]) => !passed)
          .map(([name]) => name);
        console.error("AE5E displacement soft-entry failed checks:", failedChecks);
        console.table(Object.entries(softImmediateChecks).map(([check, passed]) => ({ check, passed })));
        console.log("AE5E displacement soft-entry result:", soft);
        console.log("AE5E captured forced movement transaction:", captured?.toJSON?.() ?? captured);
        results.push({ name: "forced metadata and soft entry", passed: false, failedChecks, checks: softImmediateChecks, result: soft, transaction: captured?.toJSON?.() ?? captured });
        throw new Error(`Forced displacement metadata/soft-entry checks failed: ${failedChecks.join(", ") || "unknown"}.`);
      }
      banner("FORCED TRANSACTION + NONHOSTILE ENDPOINT GRACE — PASS", "#5cff8d", 20);
      await wait(3500 + Math.max(250, Number(graceBufferMs) || 700));
      const softFinal = canvas.scene.tokens.get(tokens.Follower.id);
      const softRollbackChecks = {
        rolledBackToLastClearStep: softFinal.x === 2400 && softFinal.y === 2800,
        graceCleared: this.#displacement.getStats().endpointGrace.pending === 0
      };
      results.push({ name: "forced metadata and soft grace rollback", passed: Object.values(softRollbackChecks).every(Boolean), checks: { ...softImmediateChecks, ...softRollbackChecks }, result: soft, transaction: captured?.toJSON?.() ?? captured });
      if (!results.at(-1).passed) throw new Error("Displacement endpoint grace rollback failed.");
      banner("3.5s NONHOSTILE GRACE → LAST CLEAR DISPLACEMENT STEP — PASS", "#5cff8d", 20);

      // --------------------------------------------------------
      // If the creature causing the soft endpoint conflict moves away
      // during grace, the pending rollback must clear immediately.
      // --------------------------------------------------------
      await configure({ leaderDisposition: D.HOSTILE, followerDisposition: D.FRIENDLY, leaderSize: 1 });
      await fixtureMove(canvas.scene.tokens.get(tokens.Enemy.id), { x: 2400, y: 2800, elevation: 0 });
      const graceClearPush = await this.#displacement.push({
        sourceUuid: tokens.Leader.uuid,
        targetUuid: tokens.Follower.uuid,
        distance: 5,
        directionConstraint: DISPLACEMENT_DIRECTION_CONSTRAINTS.STRAIGHT_AWAY,
        directionKey: "E"
      });
      await wait(175);
      const graceBeforeOccupantMove = this.#displacement.getStats().endpointGrace.pending;
      const normalAction = globalThis.CONFIG?.Token?.movement?.defaultAction ?? "walk";
      const enemyDocument = canvas.scene.tokens.get(tokens.Enemy.id);
      await enemyDocument.move({
        x: 2500,
        y: 2800,
        elevation: 0,
        action: normalAction,
        explicit: true,
        checkpoint: true
      }, {
        method: "api",
        animate: false,
        showRuler: false,
        pan: false,
        autoRotate: false,
        constrainOptions: { ignoreWalls: false, ignoreCost: true, ignoreTokens: false }
      });
      await wait(225);
      const enemyAfterLeaving = canvas.scene.tokens.get(tokens.Enemy.id);
      const followerAfterOccupantLeaves = canvas.scene.tokens.get(tokens.Follower.id);
      const occupantLeavesChecks = {
        pushReachedSoftEndpoint: graceClearPush?.completed === true
          && followerAfterOccupantLeaves.x === 2400
          && followerAfterOccupantLeaves.y === 2800,
        graceWasActive: graceBeforeOccupantMove === 1,
        occupantMovedAway: enemyAfterLeaving.x === 2500 && enemyAfterLeaving.y === 2800,
        graceClearedImmediately: this.#displacement.getStats().endpointGrace.pending === 0,
        displacedTargetStayedPut: followerAfterOccupantLeaves.x === 2400 && followerAfterOccupantLeaves.y === 2800
      };
      results.push({
        name: "endpoint grace clears when occupant leaves",
        passed: Object.values(occupantLeavesChecks).every(Boolean),
        checks: occupantLeavesChecks,
        result: graceClearPush
      });
      if (!results.at(-1).passed) throw new Error("Displacement endpoint grace did not clear when the occupant moved away.");
      banner("NONHOSTILE OCCUPANT LEAVES → GRACE CLEARS — PASS", "#5cff8d", 20);

      // --------------------------------------------------------
      // Neutral/Secret candidate endpoints must be soft conflicts.
      // --------------------------------------------------------
      await configure({ leaderDisposition: D.HOSTILE, followerDisposition: D.FRIENDLY, leaderSize: 1 });
      await fixtureMove(canvas.scene.tokens.get(tokens.Neutral.id), { x: 2400, y: 2800, elevation: 0 });
      const neutralPlan = await this.#displacement.getCandidates({
        sourceUuid: tokens.Leader.uuid,
        targetUuid: tokens.Follower.uuid,
        type: DISPLACEMENT_TYPES.PUSH,
        directionConstraint: DISPLACEMENT_DIRECTION_CONSTRAINTS.STRAIGHT_AWAY,
        distance: 5
      });
      await fixtureMove(canvas.scene.tokens.get(tokens.Neutral.id), basePositions.Neutral);
      await fixtureMove(canvas.scene.tokens.get(tokens.Secret.id), { x: 2400, y: 2800, elevation: 0 });
      const secretPlan = await this.#displacement.getCandidates({
        sourceUuid: tokens.Leader.uuid,
        targetUuid: tokens.Follower.uuid,
        type: DISPLACEMENT_TYPES.PUSH,
        directionConstraint: DISPLACEMENT_DIRECTION_CONSTRAINTS.STRAIGHT_AWAY,
        distance: 5
      });
      const neutralCandidate = neutralPlan.candidates.find((candidate) => candidate.key === "E");
      const secretCandidate = secretPlan.candidates.find((candidate) => candidate.key === "E");
      const neutralSecretChecks = {
        neutralSoft: neutralCandidate?.softConflict === true && neutralCandidate?.selectable === true,
        secretSoft: secretCandidate?.softConflict === true && secretCandidate?.selectable === true
      };
      results.push({ name: "Neutral and Secret soft occupancy", passed: Object.values(neutralSecretChecks).every(Boolean), checks: neutralSecretChecks });
      if (!results.at(-1).passed) throw new Error("Neutral/Secret displacement occupancy checks failed.");
      banner("NEUTRAL / SECRET DISPLACED-BODY OCCUPANCY — PASS", "#5cff8d", 20);

      // --------------------------------------------------------
      // Nonhostile transit: pass through one friendly occupied grid
      // space and end clear. This exercises the D&D5e blocking hook.
      // --------------------------------------------------------
      await configure({ leaderDisposition: D.HOSTILE, followerDisposition: D.FRIENDLY, leaderSize: 1 });
      await fixtureMove(canvas.scene.tokens.get(tokens.Enemy.id), { x: 2400, y: 2800, elevation: 0 });
      const through = await this.#displacement.push({
        sourceUuid: tokens.Leader.uuid,
        targetUuid: tokens.Follower.uuid,
        distance: 10,
        directionConstraint: DISPLACEMENT_DIRECTION_CONSTRAINTS.STRAIGHT_AWAY,
        directionKey: "E"
      });
      await wait(175);
      const throughFollower = canvas.scene.tokens.get(tokens.Follower.id);
      const throughChecks = {
        completed: through?.completed === true,
        fullDistance: through?.fullDistance === true,
        reachedSecondStep: throughFollower.x === 2500 && throughFollower.y === 2800,
        noEndpointGrace: this.#displacement.getStats().endpointGrace.pending === 0
      };
      results.push({ name: "nonhostile transit pass-through", passed: Object.values(throughChecks).every(Boolean), checks: throughChecks, result: through });
      if (!results.at(-1).passed) throw new Error("Nonhostile transit pass-through failed.");
      banner("NONHOSTILE TRANSIT PASS-THROUGH — PASS", "#5cff8d", 20);

      // --------------------------------------------------------
      // Wall partial stop: requested 10 ft, first 5 ft clear, second
      // step hard-blocked by a diagnostic movement wall.
      // --------------------------------------------------------
      await configure({ leaderDisposition: D.HOSTILE, followerDisposition: D.FRIENDLY, leaderSize: 1 });
      const createdWalls = await canvas.scene.createEmbeddedDocuments("Wall", [{
        c: [2550, 2600, 2550, 3100],
        flags: { [MODULE_ID]: { displacementDiagnosticWall: true } }
      }]);
      await wait(125);
      const wallPlan = await this.#displacement.getCandidates({
        sourceUuid: tokens.Leader.uuid,
        targetUuid: tokens.Follower.uuid,
        type: DISPLACEMENT_TYPES.PUSH,
        directionConstraint: DISPLACEMENT_DIRECTION_CONSTRAINTS.STRAIGHT_AWAY,
        distance: 10
      });
      const wallCandidate = wallPlan.candidates.find((candidate) => candidate.key === "E");
      const wallPreChecks = {
        candidateExists: Boolean(wallCandidate),
        selectable: wallCandidate?.selectable === true,
        partial: wallCandidate?.partial === true,
        movedFive: wallCandidate?.actualDistance === 5,
        wallReason: wallCandidate?.obstruction?.reasonCode === "environment-obstruction"
      };
      if (!Object.values(wallPreChecks).every(Boolean)) {
        results.push({ name: "wall partial-stop planning", passed: false, checks: wallPreChecks, candidate: wallCandidate });
        throw new Error("Wall partial-stop planning failed.");
      }
      const wallResult = await this.#displacement.push({
        sourceUuid: tokens.Leader.uuid,
        targetUuid: tokens.Follower.uuid,
        distance: 10,
        directionConstraint: DISPLACEMENT_DIRECTION_CONSTRAINTS.STRAIGHT_AWAY,
        directionKey: "E"
      });
      await wait(175);
      const wallFollower = canvas.scene.tokens.get(tokens.Follower.id);
      const wallChecks = {
        ...wallPreChecks,
        movementCompleted: wallResult?.completed === true,
        resultPartial: wallResult?.partial === true && wallResult?.fullDistance === false,
        stoppedAtFive: wallFollower.x === 2400 && wallFollower.y === 2800
      };
      results.push({ name: "wall partial stop", passed: Object.values(wallChecks).every(Boolean), checks: wallChecks, result: wallResult, wallIds: createdWalls.map((wall) => wall.id) });
      if (!results.at(-1).passed) throw new Error("Wall partial-stop execution failed.");
      banner("WALL PARTIAL STOP — PASS", "#5cff8d", 20);

      await removeDiagnosticWalls();
      this.#displacement.clearEndpointGrace(tokens.Follower.uuid);
      passed = results.every((entry) => entry.passed === true);
    } catch (error) {
      failure = { message: error?.message ?? String(error), stack: error?.stack ?? null };
      passed = false;
    }

    const summary = results.map((entry, index) => ({
      case: index + 1,
      test: entry.name,
      result: entry.passed ? "PASS" : "FAIL"
    }));

    if (passed) {
      banner("AE5E 0.3.25 DISPLACEMENT FOUNDATION — PASS", "#5cff8d", 30);
      console.table(summary);
      if (restoreOnPass) {
        await removeHarnessRelationships();
        await removeDiagnosticWalls();
        this.#displacement.clearEndpointGrace(tokens.Follower.uuid);
        await canvas.scene.updateEmbeddedDocuments("Token", Object.values(snapshots).map((snapshot) => ({
          _id: snapshot._id,
          width: snapshot.width,
          height: snapshot.height,
          rotation: snapshot.rotation,
          disposition: snapshot.disposition
        })), { animate: false, ae5eDisplacementTestRestore: true });
        for (const snapshot of Object.values(snapshots)) {
          await fixtureMove(canvas.scene.tokens.get(snapshot._id), {
            x: snapshot.x,
            y: snapshot.y,
            elevation: snapshot.elevation
          });
        }
        canvas.tokens.releaseAll();
        banner("PASS CLEANUP COMPLETE — ORIGINAL TOKEN STATES RESTORED", "#5cff8d", 18);
      }
    } else {
      banner("AE5E 0.3.25 DISPLACEMENT FOUNDATION — FAIL", "#ff5c5c", 30);
      if (failure) console.error("FAILURE", failure);
      console.table(summary);
      console.log("The failing Foundry fixture was intentionally left in place for inspection.");
    }

    const report = {
      result: passed ? "PASS" : "FAIL",
      failure,
      teleportFixtureAction: teleportAction,
      casesCompleted: results.length,
      summary,
      results,
      displacementStats: this.#displacement.getStats(),
      movementStats: this.#movement.getStats()
    };
    console.log("%cAE5E 0.3.25 DISPLACEMENT FOUNDATION — FULL RESULT", "font-size:20px;font-weight:bold;color:#7ddcff;");
    console.log(JSON.stringify(report, null, 2));
    ui?.notifications?.[passed ? "info" : "error"]?.(
      passed
        ? "AE5E | Displacement foundation test PASSED."
        : "AE5E | Displacement foundation test FAILED."
    );
    return report;
  }

  async runGrappleLinkObstructionTest({ restoreOnPass = true, graceBufferMs = 800 } = {}) {
    if (!canvas?.ready) throw new Error("A Scene canvas must be active.");
    if (!game.user?.isGM) throw new Error("The Grapple-link obstruction test requires a GM user.");
    if (!this.#relationshipLinkObstructions) throw new Error("The Grapple-link obstruction service is unavailable.");

    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const banner = (text, color = "#7ddcff", size = 24) => {
      console.log(`%c${text}`, `font-size:${size}px;font-weight:bold;color:${color};`);
    };
    const D = globalThis.CONST?.TOKEN_DISPOSITIONS;
    if (!D) throw new Error("Foundry token disposition constants are unavailable.");

    const names = ["Leader", "Follower", "Ally", "Enemy", "Neutral", "Secret"];
    const tokens = {};
    for (const name of names) {
      const matches = canvas.tokens.placeables.filter((token) => token.document.name === name);
      if (matches.length !== 1) throw new Error(`Expected exactly one '${name}' token on the active Scene; found ${matches.length}.`);
      tokens[name] = matches[0].document;
    }

    const snapshots = Object.fromEntries(names.map((name) => {
      const token = tokens[name];
      return [name, {
        _id: token.id,
        x: token.x,
        y: token.y,
        width: token.width,
        height: token.height,
        rotation: token.rotation,
        elevation: token.elevation,
        disposition: token.disposition
      }];
    }));

    const movementActions = globalThis.CONFIG?.Token?.movement?.actions;
    const entries = movementActions?.entries ? [...movementActions.entries()] : Object.entries(movementActions ?? {});
    const teleportAction = entries.find(([, config]) => config?.teleport === true)?.[0] ?? null;
    if (!teleportAction) throw new Error("AE5E Grapple-link test requires a Foundry teleport movement action for deterministic fixture placement.");

    const fixtureMove = async (token, { x, y, elevation = 0 }) => {
      let current = canvas.scene.tokens.get(token.id);
      if (current.x === x && current.y === y && Number(current.elevation ?? 0) === Number(elevation)) return current;
      await current.move({ x, y, elevation, action: teleportAction, explicit: true, checkpoint: true }, {
        method: "api",
        animate: false,
        showRuler: false,
        pan: false,
        autoRotate: false,
        constrainOptions: { ignoreWalls: true, ignoreCost: true, ignoreTokens: true },
        ...this.#movement.createOperationOptions({
          pathType: "reposition",
          agency: "administrative",
          resource: "none",
          movementMode: teleportAction,
          administrative: true,
          generatedBy: MODULE_ID,
          internal: true,
          suppressAutomation: true,
          testFixture: true
        })
      });
      await wait(90);
      current = canvas.scene.tokens.get(token.id);
      if (current.x !== x || current.y !== y || Number(current.elevation ?? 0) !== Number(elevation)) {
        throw new Error(`FIXTURE FAIL | ${token.name} expected (${x},${y},${elevation}); actual (${current.x},${current.y},${current.elevation}).`);
      }
      return current;
    };

    const removeHarnessRelationships = async () => {
      const relationships = this.#relationships.list({ sceneId: canvas.scene.id, type: RELATIONSHIP_TYPES.TEST })
        .filter((relationship) => relationship.metadata?.createdByTestHarness === true);
      for (const relationship of relationships) await this.#relationships.remove(relationship.id);
    };

    const removeDiagnosticWalls = async () => {
      const ids = canvas.scene.walls
        .filter((wall) => wall.getFlag(MODULE_ID, "grappleLinkDiagnosticWall") === true)
        .map((wall) => wall.id);
      if (ids.length) await canvas.scene.deleteEmbeddedDocuments("Wall", ids);
    };

    const ensureNoUnrelatedParticipantRelationships = () => {
      const participants = new Set([tokens.Leader.uuid, tokens.Follower.uuid]);
      const conflicts = this.#relationships.list({ sceneId: canvas.scene.id }).filter((relationship) => (
        participants.has(relationship.leaderUuid) || participants.has(relationship.followerUuid)
      ) && !(relationship.type === RELATIONSHIP_TYPES.TEST && relationship.metadata?.createdByTestHarness === true));
      if (conflicts.length) throw new Error(`Leader/Follower participate in ${conflicts.length} non-test relationship(s). Remove them before the Grapple-link test.`);
    };

    const basePositions = {
      Leader: { x: 2200, y: 2800, elevation: 0 },
      Follower: { x: 2400, y: 2800, elevation: 0 },
      Ally: { x: 3400, y: 2400, elevation: 0 },
      Enemy: { x: 3600, y: 2400, elevation: 0 },
      Neutral: { x: 3400, y: 2600, elevation: 0 },
      Secret: { x: 3600, y: 2600, elevation: 0 }
    };

    const configureBase = async () => {
      await removeHarnessRelationships();
      await removeDiagnosticWalls();
      await canvas.scene.updateEmbeddedDocuments("Token", [
        { _id: tokens.Leader.id, width: 1, height: 1, rotation: 15, disposition: D.FRIENDLY },
        { _id: tokens.Follower.id, width: 1, height: 1, rotation: 0, disposition: D.HOSTILE },
        { _id: tokens.Ally.id, width: 1, height: 1, rotation: 0, disposition: D.HOSTILE },
        { _id: tokens.Enemy.id, width: 1, height: 1, rotation: 0, disposition: D.FRIENDLY },
        { _id: tokens.Neutral.id, width: 1, height: 1, rotation: 0, disposition: D.NEUTRAL },
        { _id: tokens.Secret.id, width: 1, height: 1, rotation: 0, disposition: D.SECRET }
      ], { animate: false, ae5eGrappleLinkTestSetup: true });
      for (const [name, position] of Object.entries(basePositions)) {
        await fixtureMove(canvas.scene.tokens.get(tokens[name].id), position);
      }
      canvas.tokens.releaseAll();
      canvas.tokens.get(tokens.Leader.id)?.control({ releaseOthers: true, force: true, pan: false });
      canvas.tokens.get(tokens.Follower.id)?.control({ releaseOthers: false, force: true, pan: false });
      const relationship = await this.createGrappleMovementTestRelationshipFromControlledTokens({
        breakDistance: 10,
        coordinationDistance: 10
      });
      canvas.tokens.releaseAll();
      canvas.tokens.get(tokens.Leader.id)?.control({ releaseOthers: true, force: true, pan: false });
      await wait(125);
      const geometry = await this.inspectRelationshipGeometry({ relationshipId: relationship.id });
      if (!geometry?.clockwiseCandidate) throw new Error("Grapple-link fixture has no clockwise orbit candidate.");
      return { relationship, geometry, target: geometry.clockwiseCandidate };
    };

    const angleDiff = (a, b) => Math.abs(((Number(a) - Number(b) + 540) % 360) - 180);
    const pendingGrace = () => {
      const stats = this.#relationshipRotation.getStats();
      return stats?.pendingNonhostileOverlaps ?? stats?.pendingAlliedOverlaps ?? 0;
    };
    const queuesClear = () => {
      const stats = this.#relationshipRotation.getStats();
      return (stats.pendingEvents ?? 0) === 0 && (stats.processingRelationships ?? 0) === 0 && (stats.activeGmRequests ?? 0) === 0;
    };

    const results = [];
    let failure = null;
    let passed = false;

    try {
      banner("AE5E 0.3.26 — GRAPPLE-LINK OBSTRUCTION", "#7ddcff", 30);
      banner("LEADER-RELATIVE CREATURES + LINK SWEEP + FINAL GRACE + WALLS", "#ffcc66", 18);
      ensureNoUnrelatedParticipantRelationships();
      await removeHarnessRelationships();
      await removeDiagnosticWalls();

      // ------------------------------------------------------
      // Case 1: hostile creature intersects only the final link.
      // Leader is Friendly, so Hostile Ally must hard-block.
      // ------------------------------------------------------
      let fixture = await configureBase();
      await fixtureMove(canvas.scene.tokens.get(tokens.Ally.id), { x: 2300, y: 2900, elevation: 0 });
      const targetLink1 = this.#relationshipLinkObstructions.inspectAtPosition({
        scene: canvas.scene,
        leader: canvas.scene.tokens.get(tokens.Leader.id),
        follower: canvas.scene.tokens.get(tokens.Follower.id),
        followerPosition: fixture.target
      });
      const allyLinkConflict = targetLink1.hostile.find((entry) => entry.otherUuid === tokens.Ally.uuid);
      const hardResult = await this.orbitClockwise({ relationshipId: fixture.relationship.id });
      await this.#relationshipRotation.waitForSettled({ leaderUuid: tokens.Leader.uuid });
      await wait(175);
      const hardGeometry = await this.inspectRelationshipGeometry({ relationshipId: fixture.relationship.id });
      const hardStats = this.#relationshipRotation.getStats();
      const hardChecks = {
        targetLinkHostile: Boolean(allyLinkConflict),
        leaderReference: allyLinkConflict?.referenceUuid === tokens.Leader.uuid,
        linkGeometry: allyLinkConflict?.geometryChannel === RELATIONSHIP_GEOMETRY_CHANNELS.GRAPPLE_LINK,
        movementRejected: hardResult?.completed === false,
        obstructionIsLink: hardStats.lastDecision?.obstruction?.geometryChannel === RELATIONSHIP_GEOMETRY_CHANNELS.GRAPPLE_LINK,
        followerStayed: hardGeometry.follower.x === fixture.geometry.follower.x && hardGeometry.follower.y === fixture.geometry.follower.y,
        leaderRestored: angleDiff(hardGeometry.leader.rotation, fixture.geometry.leader.rotation) < 0.001,
        noGrace: pendingGrace() === 0,
        queuesClear: queuesClear()
      };
      results.push({ name: "hostile final Grapple-link hard block", passed: Object.values(hardChecks).every(Boolean), checks: hardChecks, result: hardResult, targetLink: targetLink1 });
      if (!results.at(-1).passed) throw new Error("Hostile Grapple-link hard-block checks failed.");
      banner("HOSTILE FINAL LINK — HARD BLOCK PASS", "#5cff8d", 21);

      // ------------------------------------------------------
      // Case 2: nonhostile creature intersects only final link.
      // Same-side Enemy (Friendly disposition) is nonhostile to
      // Friendly Leader, so orbit completes, grace starts, then
      // full orbit state rolls back after 3.5 seconds.
      // ------------------------------------------------------
      fixture = await configureBase();
      await fixtureMove(canvas.scene.tokens.get(tokens.Enemy.id), { x: 2300, y: 2900, elevation: 0 });
      const targetLink2 = this.#relationshipLinkObstructions.inspectAtPosition({
        scene: canvas.scene,
        leader: canvas.scene.tokens.get(tokens.Leader.id),
        follower: canvas.scene.tokens.get(tokens.Follower.id),
        followerPosition: fixture.target
      });
      const enemyLinkConflict = targetLink2.nonhostile.find((entry) => entry.otherUuid === tokens.Enemy.uuid);
      const softResult = await this.orbitClockwise({ relationshipId: fixture.relationship.id });
      await this.#relationshipRotation.waitForSettled({ leaderUuid: tokens.Leader.uuid });
      await wait(200);
      const softImmediate = await this.inspectRelationshipGeometry({ relationshipId: fixture.relationship.id });
      const softStats = this.#relationshipRotation.getStats();
      const decisionLinkConflict = softStats.lastDecision?.grappleLink?.endpointConflicts?.find((entry) => entry.otherUuid === tokens.Enemy.uuid);
      const softEntryChecks = {
        targetLinkNonhostile: Boolean(enemyLinkConflict),
        leaderReference: enemyLinkConflict?.referenceUuid === tokens.Leader.uuid,
        movementCompleted: softResult?.completed === true,
        followerReachedTarget: softImmediate.follower.x === fixture.target.x && softImmediate.follower.y === fixture.target.y,
        linkConflictRecorded: decisionLinkConflict?.relationship === RELATIVE_TOKEN_RELATIONSHIPS.NONHOSTILE,
        bodyConflictAbsent: (softStats.lastDecision?.followerBody?.endpointConflicts?.length ?? 0) === 0,
        graceStarted: pendingGrace() >= 1,
        queuesClear: queuesClear()
      };
      if (!Object.values(softEntryChecks).every(Boolean)) {
        results.push({ name: "nonhostile final Grapple-link grace", passed: false, stage: "entry", checks: softEntryChecks, result: softResult, stats: softStats });
        throw new Error("Nonhostile Grapple-link grace entry checks failed.");
      }
      banner("NONHOSTILE FINAL LINK — GRACE ACTIVE", "#ffcc66", 20);
      await wait(3500 + graceBufferMs);
      await this.#relationshipRotation.waitForSettled({ leaderUuid: tokens.Leader.uuid });
      await wait(125);
      const softAfter = await this.inspectRelationshipGeometry({ relationshipId: fixture.relationship.id });
      const softRollbackChecks = {
        followerRestored: softAfter.follower.x === fixture.geometry.follower.x && softAfter.follower.y === fixture.geometry.follower.y,
        shellRestored: softAfter.currentOrbitIndex === fixture.geometry.currentOrbitIndex,
        leaderRestored: angleDiff(softAfter.leader.rotation, fixture.geometry.leader.rotation) < 0.001,
        graceCleared: pendingGrace() === 0,
        queuesClear: queuesClear()
      };
      results.push({ name: "nonhostile final Grapple-link grace", passed: Object.values(softRollbackChecks).every(Boolean), entryChecks: softEntryChecks, rollbackChecks: softRollbackChecks, result: softResult });
      if (!results.at(-1).passed) throw new Error("Nonhostile Grapple-link rollback checks failed.");
      banner("NONHOSTILE LINK → 3.5s GRACE → FULL STATE ROLLBACK — PASS", "#5cff8d", 21);

      // ------------------------------------------------------
      // Case 3: a movement wall intersects the link sweep/final
      // geometry while the Follower body path remains clear.
      // ------------------------------------------------------
      fixture = await configureBase();
      const createdWalls = await canvas.scene.createEmbeddedDocuments("Wall", [{
        c: [2350, 2880, 2350, 2940],
        flags: { [MODULE_ID]: { grappleLinkDiagnosticWall: true } }
      }]);
      await wait(150);
      const wallSweep = this.#relationshipLinkObstructions.inspectSweep({
        scene: canvas.scene,
        leader: canvas.scene.tokens.get(tokens.Leader.id),
        follower: canvas.scene.tokens.get(tokens.Follower.id),
        fromPosition: fixture.geometry.follower,
        toPosition: fixture.target
      });
      const wallResult = await this.orbitClockwise({ relationshipId: fixture.relationship.id });
      await this.#relationshipRotation.waitForSettled({ leaderUuid: tokens.Leader.uuid });
      await wait(175);
      const wallGeometry = await this.inspectRelationshipGeometry({ relationshipId: fixture.relationship.id });
      const wallStats = this.#relationshipRotation.getStats();
      const wallChecks = {
        diagnosticWallCreated: createdWalls.length === 1,
        linkWallDetected: wallSweep.wallBlocked === true,
        movementRejected: wallResult?.completed === false,
        obstructionIsLink: wallStats.lastDecision?.obstruction?.geometryChannel === RELATIONSHIP_GEOMETRY_CHANNELS.GRAPPLE_LINK,
        wallReason: ["grapple-link-wall", "grapple-link-wall-preflight-unavailable"].includes(wallStats.lastDecision?.obstruction?.reasonCode),
        followerStayed: wallGeometry.follower.x === fixture.geometry.follower.x && wallGeometry.follower.y === fixture.geometry.follower.y,
        leaderRestored: angleDiff(wallGeometry.leader.rotation, fixture.geometry.leader.rotation) < 0.001,
        noGrace: pendingGrace() === 0,
        queuesClear: queuesClear()
      };
      results.push({ name: "Grapple-link wall hard block", passed: Object.values(wallChecks).every(Boolean), checks: wallChecks, result: wallResult, sweep: wallSweep });
      if (!results.at(-1).passed) throw new Error("Grapple-link wall checks failed.");
      banner("GRAPPLE-LINK WALL — HARD BLOCK PASS", "#5cff8d", 21);

      // ------------------------------------------------------
      // Case 4: nonhostile creature intersects the Grapple-link
      // only during the swept transition. It must be allowed to
      // pass with NO endpoint grace because the final link is
      // clear.
      //
      // The 10-foot orbit fixture sweeps a deliberately narrow
      // fan. A 0.5x0.5 token is physically too tall (once the
      // link-width padding is included) to occupy that fan while
      // remaining clear of both the initial and final link. Use a
      // deterministic 0.25x0.25 diagnostic footprint centered in
      // the interior of the swept fan instead of searching a
      // coarse set of positions. This is test-fixture geometry
      // only; production Grapple-link collision remains unchanged.
      // ------------------------------------------------------
      fixture = await configureBase();
      await canvas.scene.updateEmbeddedDocuments("Token", [{
        _id: tokens.Enemy.id,
        width: 0.25,
        height: 0.25,
        disposition: D.FRIENDLY
      }], { animate: false, ae5eGrappleLinkSweepFixture: true });
      await wait(90);

      const sweepOnlyPosition = { x: 2345, y: 2860, elevation: 0 };
      await fixtureMove(canvas.scene.tokens.get(tokens.Enemy.id), sweepOnlyPosition);

      const sweepInspection = this.#relationshipLinkObstructions.inspectSweep({
        scene: canvas.scene,
        leader: canvas.scene.tokens.get(tokens.Leader.id),
        follower: canvas.scene.tokens.get(tokens.Follower.id),
        fromPosition: fixture.geometry.follower,
        toPosition: fixture.target
      });
      const endpointInspection = this.#relationshipLinkObstructions.inspectAtPosition({
        scene: canvas.scene,
        leader: canvas.scene.tokens.get(tokens.Leader.id),
        follower: canvas.scene.tokens.get(tokens.Follower.id),
        followerPosition: fixture.target
      });
      const initialInspection = this.#relationshipLinkObstructions.inspectAtPosition({
        scene: canvas.scene,
        leader: canvas.scene.tokens.get(tokens.Leader.id),
        follower: canvas.scene.tokens.get(tokens.Follower.id),
        followerPosition: fixture.geometry.follower
      });
      const sweepConflict = sweepInspection.nonhostile.find((entry) => entry.otherUuid === tokens.Enemy.uuid);
      const endpointConflict = endpointInspection.nonhostile.find((entry) => entry.otherUuid === tokens.Enemy.uuid);
      const initialConflict = initialInspection.nonhostile.find((entry) => entry.otherUuid === tokens.Enemy.uuid);
      const sweepOnlyFixture = {
        position: { ...sweepOnlyPosition },
        sweep: sweepInspection,
        endpoint: endpointInspection,
        initial: initialInspection,
        conflict: sweepConflict
      };

      const deterministicSweepFixtureChecks = {
        sweepConflictFound: Boolean(sweepConflict),
        sweepOccurredMidTransition: sweepConflict?.firstSampleT > 0 && sweepConflict?.firstSampleT < 1,
        initialLinkClear: !initialConflict,
        finalLinkClear: !endpointConflict,
        leaderReference: sweepConflict?.referenceUuid === tokens.Leader.uuid
      };
      if (!Object.values(deterministicSweepFixtureChecks).every(Boolean)) {
        console.error("AE5E deterministic sweep-only fixture checks:", deterministicSweepFixtureChecks);
        console.log("AE5E deterministic sweep-only fixture:", sweepOnlyFixture);
        throw new Error("Deterministic nonhostile sweep-only Grapple-link fixture did not isolate the swept link.");
      }
      const nonhostileSweepResult = await this.orbitClockwise({ relationshipId: fixture.relationship.id });
      await this.#relationshipRotation.waitForSettled({ leaderUuid: tokens.Leader.uuid });
      await wait(200);
      const nonhostileSweepGeometry = await this.inspectRelationshipGeometry({ relationshipId: fixture.relationship.id });
      const nonhostileSweepStats = this.#relationshipRotation.getStats();
      const nonhostileSweepDecisionConflict = nonhostileSweepStats.lastDecision?.grappleLink?.preflight?.nonhostile
        ?.find((entry) => entry.otherUuid === tokens.Enemy.uuid);
      const nonhostileSweepEndpointConflict = nonhostileSweepStats.lastDecision?.grappleLink?.endpointConflicts
        ?.find((entry) => entry.otherUuid === tokens.Enemy.uuid);
      const nonhostileSweepChecks = {
        sweepConflictFound: Boolean(sweepOnlyFixture.conflict),
        sweepOccurredMidTransition: sweepOnlyFixture.conflict?.firstSampleT > 0 && sweepOnlyFixture.conflict?.firstSampleT < 1,
        finalLinkClear: !sweepOnlyFixture.endpoint.nonhostile.some((entry) => entry.otherUuid === tokens.Enemy.uuid),
        leaderReference: sweepOnlyFixture.conflict?.referenceUuid === tokens.Leader.uuid,
        preflightRecorded: Boolean(nonhostileSweepDecisionConflict),
        movementCompleted: nonhostileSweepResult?.completed === true,
        followerReachedTarget: nonhostileSweepGeometry.follower.x === fixture.target.x && nonhostileSweepGeometry.follower.y === fixture.target.y,
        noEndpointConflict: !nonhostileSweepEndpointConflict,
        noGrace: pendingGrace() === 0,
        queuesClear: queuesClear()
      };
      results.push({
        name: "nonhostile Grapple-link sweep-only pass-through",
        passed: Object.values(nonhostileSweepChecks).every(Boolean),
        checks: nonhostileSweepChecks,
        fixture: sweepOnlyFixture,
        result: nonhostileSweepResult
      });
      if (!results.at(-1).passed) throw new Error("Nonhostile Grapple-link sweep-only checks failed.");
      banner("NONHOSTILE LINK SWEEP-ONLY → PASS THROUGH / NO GRACE — PASS", "#5cff8d", 21);

      // ------------------------------------------------------
      // Case 5: the exact same sweep-only geometry becomes a hard
      // block when occupied by a creature hostile to the Leader.
      // This proves creature sweep collision is not merely a final
      // endpoint test.
      // ------------------------------------------------------
      const hostileSweepPosition = { ...sweepOnlyFixture.position };
      fixture = await configureBase();
      await canvas.scene.updateEmbeddedDocuments("Token", [{
        _id: tokens.Ally.id,
        width: 0.25,
        height: 0.25,
        disposition: D.HOSTILE
      }], { animate: false, ae5eGrappleLinkSweepFixture: true });
      await wait(90);
      await fixtureMove(canvas.scene.tokens.get(tokens.Ally.id), hostileSweepPosition);
      const hostileSweepInspection = this.#relationshipLinkObstructions.inspectSweep({
        scene: canvas.scene,
        leader: canvas.scene.tokens.get(tokens.Leader.id),
        follower: canvas.scene.tokens.get(tokens.Follower.id),
        fromPosition: fixture.geometry.follower,
        toPosition: fixture.target
      });
      const hostileSweepEndpoint = this.#relationshipLinkObstructions.inspectAtPosition({
        scene: canvas.scene,
        leader: canvas.scene.tokens.get(tokens.Leader.id),
        follower: canvas.scene.tokens.get(tokens.Follower.id),
        followerPosition: fixture.target
      });
      const hostileSweepConflict = hostileSweepInspection.hostile.find((entry) => entry.otherUuid === tokens.Ally.uuid);
      const hostileFinalConflict = hostileSweepEndpoint.hostile.find((entry) => entry.otherUuid === tokens.Ally.uuid);
      const hostileSweepResult = await this.orbitClockwise({ relationshipId: fixture.relationship.id });
      await this.#relationshipRotation.waitForSettled({ leaderUuid: tokens.Leader.uuid });
      await wait(175);
      const hostileSweepGeometry = await this.inspectRelationshipGeometry({ relationshipId: fixture.relationship.id });
      const hostileSweepStats = this.#relationshipRotation.getStats();
      const hostileSweepChecks = {
        sweepConflictFound: Boolean(hostileSweepConflict),
        sweepOccurredMidTransition: hostileSweepConflict?.firstSampleT > 0 && hostileSweepConflict?.firstSampleT < 1,
        finalLinkClear: !hostileFinalConflict,
        leaderReference: hostileSweepConflict?.referenceUuid === tokens.Leader.uuid,
        movementRejected: hostileSweepResult?.completed === false,
        obstructionIsLink: hostileSweepStats.lastDecision?.obstruction?.geometryChannel === RELATIONSHIP_GEOMETRY_CHANNELS.GRAPPLE_LINK,
        hostileReason: hostileSweepStats.lastDecision?.obstruction?.reasonCode === "hostile-creature",
        followerStayed: hostileSweepGeometry.follower.x === fixture.geometry.follower.x && hostileSweepGeometry.follower.y === fixture.geometry.follower.y,
        leaderRestored: angleDiff(hostileSweepGeometry.leader.rotation, fixture.geometry.leader.rotation) < 0.001,
        noGrace: pendingGrace() === 0,
        queuesClear: queuesClear()
      };
      results.push({
        name: "hostile Grapple-link sweep-only hard block",
        passed: Object.values(hostileSweepChecks).every(Boolean),
        checks: hostileSweepChecks,
        sweep: hostileSweepInspection,
        endpoint: hostileSweepEndpoint,
        result: hostileSweepResult
      });
      if (!results.at(-1).passed) throw new Error("Hostile Grapple-link sweep-only checks failed.");
      banner("HOSTILE LINK SWEEP-ONLY → HARD BLOCK — PASS", "#5cff8d", 21);

      // ------------------------------------------------------
      // Case 6: one creature occupies the Follower destination
      // AND the final Grapple-link boundary. With Friendly Leader,
      // Hostile Follower, Hostile Ally:
      //   follower-body => NONHOSTILE (same Hostile disposition)
      //   grapple-link  => HOSTILE    (relative to Friendly Leader)
      // The hard Grapple-link conflict must win.
      // ------------------------------------------------------
      fixture = await configureBase();
      await fixtureMove(canvas.scene.tokens.get(tokens.Ally.id), {
        x: fixture.target.x,
        y: fixture.target.y,
        elevation: fixture.target.elevation ?? 0
      });
      const bodyResolution = this.#relativeRelationships.resolveForGeometry({
        geometryChannel: RELATIONSHIP_GEOMETRY_CHANNELS.FOLLOWER_BODY,
        leaderToken: canvas.scene.tokens.get(tokens.Leader.id),
        followerToken: canvas.scene.tokens.get(tokens.Follower.id),
        otherToken: canvas.scene.tokens.get(tokens.Ally.id)
      });
      const linkResolution = this.#relativeRelationships.resolveForGeometry({
        geometryChannel: RELATIONSHIP_GEOMETRY_CHANNELS.GRAPPLE_LINK,
        leaderToken: canvas.scene.tokens.get(tokens.Leader.id),
        followerToken: canvas.scene.tokens.get(tokens.Follower.id),
        otherToken: canvas.scene.tokens.get(tokens.Ally.id)
      });
      const dualResult = await this.orbitClockwise({ relationshipId: fixture.relationship.id });
      await this.#relationshipRotation.waitForSettled({ leaderUuid: tokens.Leader.uuid });
      await wait(175);
      const dualGeometry = await this.inspectRelationshipGeometry({ relationshipId: fixture.relationship.id });
      const dualStats = this.#relationshipRotation.getStats();
      const bodyPreflightConflict = dualStats.lastDecision?.followerBody?.preflight?.conflicts
        ?.find((entry) => entry.otherUuid === tokens.Ally.uuid);
      const linkPreflightConflict = dualStats.lastDecision?.grappleLink?.preflight?.hostile
        ?.find((entry) => entry.otherUuid === tokens.Ally.uuid);
      const dualChecks = {
        followerBodyClassifiesNonhostile: bodyResolution.relationship === RELATIVE_TOKEN_RELATIONSHIPS.NONHOSTILE,
        followerBodyUsesFollower: bodyResolution.referenceUuid === tokens.Follower.uuid,
        grappleLinkClassifiesHostile: linkResolution.relationship === RELATIVE_TOKEN_RELATIONSHIPS.HOSTILE,
        grappleLinkUsesLeader: linkResolution.referenceUuid === tokens.Leader.uuid,
        bodyConflictRecordedNonhostile: bodyPreflightConflict?.relationship === RELATIVE_TOKEN_RELATIONSHIPS.NONHOSTILE,
        linkConflictRecordedHostile: linkPreflightConflict?.relationship === RELATIVE_TOKEN_RELATIONSHIPS.HOSTILE,
        movementRejected: dualResult?.completed === false,
        hardLinkWins: dualStats.lastDecision?.obstruction?.geometryChannel === RELATIONSHIP_GEOMETRY_CHANNELS.GRAPPLE_LINK
          && dualStats.lastDecision?.obstruction?.reasonCode === "hostile-creature",
        followerStayed: dualGeometry.follower.x === fixture.geometry.follower.x && dualGeometry.follower.y === fixture.geometry.follower.y,
        leaderRestored: angleDiff(dualGeometry.leader.rotation, fixture.geometry.leader.rotation) < 0.001,
        noGrace: pendingGrace() === 0,
        queuesClear: queuesClear()
      };
      results.push({
        name: "dual body/link conflict hard precedence",
        passed: Object.values(dualChecks).every(Boolean),
        checks: dualChecks,
        bodyResolution,
        linkResolution,
        result: dualResult,
        decision: dualStats.lastDecision
      });
      if (!results.at(-1).passed) throw new Error("Dual body/link hard-precedence checks failed.");
      banner("BODY NONHOSTILE + LINK HOSTILE → HARD LINK WINS — PASS", "#5cff8d", 21);

      await removeDiagnosticWalls();
      passed = results.every((entry) => entry.passed === true);
    } catch (error) {
      failure = { message: error?.message ?? String(error), stack: error?.stack ?? null };
      passed = false;
    }

    const summary = results.map((entry, index) => ({ case: index + 1, test: entry.name, result: entry.passed ? "PASS" : "FAIL" }));
    if (passed) {
      banner("AE5E 0.3.26 GRAPPLE-LINK OBSTRUCTION — PASS", "#5cff8d", 30);
      console.table(summary);
      if (restoreOnPass) {
        await removeHarnessRelationships();
        await removeDiagnosticWalls();
        await canvas.scene.updateEmbeddedDocuments("Token", Object.values(snapshots).map((snapshot) => ({
          _id: snapshot._id,
          width: snapshot.width,
          height: snapshot.height,
          rotation: snapshot.rotation,
          disposition: snapshot.disposition
        })), { animate: false, ae5eGrappleLinkTestRestore: true });
        for (const snapshot of Object.values(snapshots)) {
          await fixtureMove(canvas.scene.tokens.get(snapshot._id), { x: snapshot.x, y: snapshot.y, elevation: snapshot.elevation });
        }
        canvas.tokens.releaseAll();
        banner("PASS CLEANUP COMPLETE — ORIGINAL TOKEN STATES RESTORED", "#5cff8d", 18);
      }
    } else {
      banner("AE5E 0.3.26 GRAPPLE-LINK OBSTRUCTION — FAIL", "#ff5c5c", 30);
      if (failure) console.error("FAILURE", failure);
      console.table(summary);
      console.log("The failing Grapple-link fixture was intentionally left in place for inspection.");
    }

    const report = {
      result: passed ? "PASS" : "FAIL",
      failure,
      teleportFixtureAction: teleportAction,
      casesCompleted: results.length,
      summary,
      results,
      rotationStats: this.#relationshipRotation.getStats()
    };
    console.log("%cAE5E 0.3.26 GRAPPLE-LINK OBSTRUCTION — FULL RESULT", "font-size:20px;font-weight:bold;color:#7ddcff;");
    console.log(JSON.stringify(report, null, 2));
    ui?.notifications?.[passed ? "info" : "error"]?.(
      passed ? "AE5E | Grapple-link obstruction test PASSED." : "AE5E | Grapple-link obstruction test FAILED."
    );
    return report;
  }

  #controlledPair() {
    if (!canvas?.ready) throw new Error("A Scene canvas must be active.");
    const controlled = canvas.tokens.controlled.map((token) => token.document);
    if (controlled.length !== 2) throw new Error("Control exactly two tokens: leader first, then follower.");
    return controlled;
  }

  #leaveLeaderControlled(leader) {
    for (const token of canvas.tokens.controlled) token.release();
    leader.object?.control?.({ releaseOthers: true });
  }

  async #resolveRelationshipTokens({ relationshipId = null } = {}) {
    if (!canvas?.ready) throw new Error("A Scene canvas must be active.");
    let relationship = relationshipId ? this.#relationships.get(relationshipId) : null;
    if (!relationship) {
      const controlled = canvas.tokens.controlled.map((token) => token.document);
      if (controlled.length === 1) {
        relationship = this.#relationships.getForLeader(controlled[0].uuid)[0]
          ?? this.#relationships.getForFollower(controlled[0].uuid)[0]
          ?? null;
      }
    }
    if (!relationship) relationship = this.#relationships.list({ sceneId: canvas.scene.id })[0] ?? null;
    if (!relationship) throw new Error("No relationship could be resolved on the active Scene.");

    const scene = game.scenes.get(relationship.sceneId);
    const leader = await fromUuid(relationship.leaderUuid);
    const follower = await fromUuid(relationship.followerUuid);
    if (!scene || !(leader instanceof foundry.documents.TokenDocument) || !(follower instanceof foundry.documents.TokenDocument)) {
      throw new Error("The relationship Scene or tokens are unavailable.");
    }
    return { relationship, scene, leader, follower };
  }

  #tokenGeometry(token) {
    return {
      uuid: token.uuid,
      name: token.name ?? null,
      x: token.x,
      y: token.y,
      elevation: token.elevation,
      width: token.width,
      height: token.height,
      rotation: token.rotation
    };
  }
}
