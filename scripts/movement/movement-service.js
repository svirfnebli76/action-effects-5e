import {
  HOOKS,
  MAX_RECENT_TRANSACTIONS,
  MODULE_ID,
  MOVEMENT_PHASES,
  OPERATION_METADATA_KEY,
  PERSISTENT_AREA_ENTRY_PLANS_KEY,
  SETTINGS
} from "../core/constants.js";
import { duplicateSafely, randomId } from "../core/utils.js";
import { Logger } from "../core/logger.js";
import { MovementTransaction } from "./movement-transaction.js";
import { VoluntaryMovementRestrictionPolicy } from "./voluntary-movement-restriction-policy.js";

function addMovementContextKey(keys, value) {
  if (typeof value === "string" && value.length) keys.add(value);
}

function movementContextKeys(movement = {}) {
  const keys = new Set();
  addMovementContextKey(keys, movement?.id);
  addMovementContextKey(keys, movement?.subpathId);
  addMovementContextKey(keys, movement?.origin?.subpathId);
  addMovementContextKey(keys, movement?.destination?.subpathId);

  const collections = [
    movement?.passed?.waypoints,
    movement?.pending?.waypoints,
    movement?.waypoints,
    movement?.history?.unrecorded?.waypoints,
    movement?.history?.recorded?.waypoints,
    movement?.history?.path
  ];
  for (const collection of collections) {
    if (!Array.isArray(collection)) continue;
    for (const point of collection) addMovementContextKey(keys, point?.subpathId);
  }

  return [...keys];
}

export class MovementService {
  #registry;
  #relationships;
  #accounting;
  #catMovement;
  #socket;
  #voluntaryMovementRestriction;
  #initialized = false;
  #pending = new Map();
  #recent = [];
  #hookIds = [];
  #movementContexts = new Map();
  #interactionHolds = new Map();
  #interactionHoldTtlMs = 15 * 60 * 1000;
  #interactionHoldStats = {
    acquired: 0,
    released: 0,
    blockedMovements: 0,
    bypassedContinuations: 0,
    expired: 0
  };

  constructor({ registry, relationships, accounting = null, catMovement = null, socket = null, voluntaryMovementRestriction = null }) {
    this.#registry = registry;
    this.#relationships = relationships;
    this.#accounting = accounting;
    this.#catMovement = catMovement;
    this.#socket = socket;
    this.#voluntaryMovementRestriction = voluntaryMovementRestriction ?? new VoluntaryMovementRestrictionPolicy();
    this.#socket?.register?.("movement.interactionHold.acquire", payload => this.#applyInteractionHold(payload));
    this.#socket?.register?.("movement.interactionHold.release", payload => this.#removeInteractionHold(payload));
  }

  initialize() {
    if (this.#initialized) return;
    this.#initialized = true;

    this.#hookIds.push(Hooks.on("preMoveToken", this.#onPreMoveToken.bind(this)));
    this.#hookIds.push(Hooks.on("moveToken", this.#onMoveToken.bind(this)));
    this.#hookIds.push(Hooks.on("stopToken", this.#onStopToken.bind(this)));

    Logger.info("Movement service initialized with one pre-move, one post-move, and one stop listener.");
  }

  shutdown() {
    if (!this.#initialized) return;
    Hooks.off("preMoveToken", this.#hookIds[0]);
    Hooks.off("moveToken", this.#hookIds[1]);
    Hooks.off("stopToken", this.#hookIds[2]);
    this.#hookIds = [];
    this.#pending.clear();
    this.#movementContexts.clear();
    this.#interactionHolds.clear();
    this.#initialized = false;
  }

  registerConsumer(config) {
    return this.#registry.register(config);
  }

  unregisterConsumer(id) {
    return this.#registry.unregister(id);
  }

  getMovementContext(movement = {}) {
    const context = this.#resolveMovementContext(movement);
    return context ? duplicateSafely(context) : null;
  }

  registerMovementContext(movementId, metadata = {}) {
    if (typeof movementId !== "string" || !movementId.length) {
      throw new TypeError("Movement context requires a non-empty movement ID.");
    }

    const source = metadata?.[OPERATION_METADATA_KEY] ?? metadata;
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw new TypeError("Movement context metadata must be an object.");
    }

    const context = Object.freeze(duplicateSafely(source));
    this.#movementContexts.set(movementId, context);

    return () => {
      if (this.#movementContexts.get(movementId) === context) this.#movementContexts.delete(movementId);
    };
  }

  createOperationOptions({
    transactionId = `${MODULE_ID}-${randomId()}`,
    pathType,
    agency,
    resource,
    movementMode,
    sourceUuid,
    initiatorUuid,
    leaderUuid,
    relationshipId,
    internal = true,
    suppressAutomation = false,
    generatedBy = MODULE_ID,
    ...additional
  } = {}) {
    return {
      [OPERATION_METADATA_KEY]: {
        transactionId,
        pathType,
        agency,
        resource,
        movementMode,
        sourceUuid,
        initiatorUuid,
        leaderUuid,
        relationshipId,
        internal,
        suppressAutomation,
        generatedBy,
        ...duplicateSafely(additional)
      }
    };
  }

  getRecentTransactions() {
    return this.#recent.map((transaction) => transaction.toJSON());
  }

  getVoluntaryMovementRestriction(subject) {
    return this.#voluntaryMovementRestriction.resolve(subject);
  }

  getVoluntaryMovementRestrictionFlagPath() {
    return this.#voluntaryMovementRestriction.getFlagPath();
  }

  evaluateVoluntaryMovementRestriction(options) {
    return this.#voluntaryMovementRestriction.evaluate(options);
  }

  acquireInteractionHold({ tokenUuid, holdId = `${MODULE_ID}-hold-${randomId(20)}`, bypassPlanId = null, message = null, broadcast = true } = {}) {
    const payload = {
      tokenUuid: typeof tokenUuid === "string" ? tokenUuid : tokenUuid?.uuid,
      holdId,
      bypassPlanId: typeof bypassPlanId === "string" && bypassPlanId.length ? bypassPlanId : null,
      message: typeof message === "string" && message.trim().length ? message.trim() : null,
      createdAt: Date.now()
    };
    const result = this.#applyInteractionHold(payload);
    if (result.acquired && broadcast) this.#broadcastInteractionHold("movement.interactionHold.acquire", payload);
    return Object.freeze({ ...result, ...payload });
  }

  releaseInteractionHold({ tokenUuid, holdId, broadcast = true } = {}) {
    const payload = {
      tokenUuid: typeof tokenUuid === "string" ? tokenUuid : tokenUuid?.uuid,
      holdId
    };
    const result = this.#removeInteractionHold(payload);
    if (result.released && broadcast) this.#broadcastInteractionHold("movement.interactionHold.release", payload);
    return Object.freeze({ ...result, ...payload });
  }

  getInteractionHolds(tokenUuid = null) {
    this.#pruneInteractionHolds();
    if (tokenUuid) return [...(this.#interactionHolds.get(tokenUuid)?.values() ?? [])].map(duplicateSafely);
    return [...this.#interactionHolds.entries()].flatMap(([uuid, holds]) => [...holds.values()].map(hold => ({ tokenUuid: uuid, ...duplicateSafely(hold) })));
  }

  async dispatchSyntheticForTesting(transaction) {
    await this.#registry.dispatch(transaction, MOVEMENT_PHASES.AFTER, { synthetic: true, service: this });
  }

  getStats() {
    return {
      initialized: this.#initialized,
      pendingTransactions: this.#pending.size,
      recentTransactions: this.#recent.length,
      movementContexts: this.#movementContexts.size,
      interactionHolds: this.getInteractionHolds().length,
      interactionHoldStats: duplicateSafely(this.#interactionHoldStats),
      accounting: this.#accounting?.getStats?.() ?? null,
      voluntaryMovementRestriction: this.#voluntaryMovementRestriction.getStats(),
      registry: this.#registry.getStats()
    };
  }

  #applyInteractionHold(payload = {}) {
    this.#pruneInteractionHolds();
    const tokenUuid = typeof payload?.tokenUuid === "string" ? payload.tokenUuid : null;
    const holdId = typeof payload?.holdId === "string" ? payload.holdId : null;
    if (!tokenUuid || !holdId) return { acquired: false, reason: "invalid-hold" };
    if (!this.#interactionHolds.has(tokenUuid)) this.#interactionHolds.set(tokenUuid, new Map());
    const holds = this.#interactionHolds.get(tokenUuid);
    const already = holds.has(holdId);
    holds.set(holdId, Object.freeze({
      holdId,
      bypassPlanId: typeof payload?.bypassPlanId === "string" && payload.bypassPlanId.length ? payload.bypassPlanId : null,
      message: typeof payload?.message === "string" && payload.message.trim().length ? payload.message.trim() : null,
      createdAt: Number.isFinite(Number(payload?.createdAt)) ? Number(payload.createdAt) : Date.now()
    }));
    if (!already) this.#interactionHoldStats.acquired += 1;
    return { acquired: true, already };
  }

  #removeInteractionHold(payload = {}) {
    const tokenUuid = typeof payload?.tokenUuid === "string" ? payload.tokenUuid : null;
    const holdId = typeof payload?.holdId === "string" ? payload.holdId : null;
    if (!tokenUuid || !holdId) return { released: false, reason: "invalid-hold" };
    const holds = this.#interactionHolds.get(tokenUuid);
    if (!holds?.delete(holdId)) return { released: false, reason: "hold-unavailable" };
    if (!holds.size) this.#interactionHolds.delete(tokenUuid);
    this.#interactionHoldStats.released += 1;
    return { released: true };
  }

  #broadcastInteractionHold(name, payload) {
    if (!this.#socket?.ready || !globalThis.game?.users) return;
    const recipients = [...game.users]
      .filter(user => user?.active && user?.id && user.id !== game.user?.id)
      .map(user => user.id);
    if (!recipients.length) return;
    void this.#socket.executeForUsers(name, recipients, duplicateSafely(payload)).catch(error => {
      Logger.debug(`Could not synchronize AE5E interaction hold '${name}'.`, error);
    });
  }

  #evaluateInteractionHolds(document, operation = {}) {
    this.#pruneInteractionHolds();
    const holds = this.#interactionHolds.get(document?.uuid);
    if (!holds?.size) return { blocked: false, reason: "no-interaction-hold" };

    const metadata = operation?.[OPERATION_METADATA_KEY] ?? {};
    const tokenPlan = metadata?.[PERSISTENT_AREA_ENTRY_PLANS_KEY]?.[document?.uuid] ?? null;
    const planId = typeof tokenPlan?.planId === "string" ? tokenPlan.planId : null;
    const bypassAll = metadata?.bypassInteractionHolds === true && metadata?.generatedBy === MODULE_ID;
    if (bypassAll) {
      this.#interactionHoldStats.bypassedContinuations += 1;
      return { blocked: false, reason: "ae5e-explicit-bypass" };
    }

    for (const hold of holds.values()) {
      if (hold.bypassPlanId && planId === hold.bypassPlanId) continue;
      this.#interactionHoldStats.blockedMovements += 1;
      return { blocked: true, reason: "interaction-in-progress", hold, message: hold.message ?? null };
    }

    this.#interactionHoldStats.bypassedContinuations += 1;
    return { blocked: false, reason: "planned-continuation" };
  }

  #pruneInteractionHolds() {
    const cutoff = Date.now() - this.#interactionHoldTtlMs;
    for (const [tokenUuid, holds] of this.#interactionHolds) {
      for (const [holdId, hold] of holds) {
        if (Number(hold.createdAt ?? 0) >= cutoff) continue;
        holds.delete(holdId);
        this.#interactionHoldStats.expired += 1;
      }
      if (!holds.size) this.#interactionHolds.delete(tokenUuid);
    }
  }

  #isEnabled() {
    return game.settings.get(MODULE_ID, SETTINGS.MOVEMENT_ENABLED);
  }

  #captureDiagnostics() {
    return game.settings.get(MODULE_ID, SETTINGS.CAPTURE_DIAGNOSTICS);
  }

  #hasPotentialInterest(document, phase, operation, userId = game.user.id) {
    const metadata = operation?.[OPERATION_METADATA_KEY];
    if (metadata?.suppressAutomation === true) return false;
    // AE5E-generated movement is itself semantically meaningful. Always emit a
    // MovementTransaction for it so forced displacement can be distinguished by
    // consumers even when diagnostic capture is disabled.
    if (metadata?.generatedBy === MODULE_ID) return true;
    if (metadata?.externalMovementSemantics === true) return true;
    if (this.#captureDiagnostics()) return true;
    if (this.#relationships.involves(document.uuid) && game.user.id === userId) return true;
    return this.#registry.hasPotentialInterest(document, phase, { userId });
  }

  #resolveMovementContext(movement = {}) {
    // Foundry assigns a new movement.id when it continues through an explicit
    // checkpoint, while waypoint.subpathId remains tied to the original movement
    // instruction ID. Resolve semantic ownership by either identifier so every
    // continuation of an AE5E-generated route stays internal and recursion-safe.
    for (const key of movementContextKeys(movement)) {
      const context = this.#movementContexts.get(key);
      if (context) return context;
    }
    return null;
  }

  #withMovementContext(movement, operation = {}) {
    const context = this.#resolveMovementContext(movement);
    if (!context) return operation ?? {};

    const operationMetadata = operation?.[OPERATION_METADATA_KEY];
    return {
      ...(operation ?? {}),
      [OPERATION_METADATA_KEY]: {
        ...(operationMetadata && typeof operationMetadata === "object" ? operationMetadata : {}),
        ...duplicateSafely(context)
      }
    };
  }

  #onPreMoveToken(document, movement, operation) {
    if (!this.#isEnabled()) return;
    const interoperableOperation = this.#catMovement?.enrichOperation({ document, movement, operation }) ?? operation;
    const effectiveOperation = this.#withMovementContext(movement, interoperableOperation);

    // A short-lived interaction hold is stronger than an Active Effect movement
    // restriction. It prevents ANY new movement instruction from racing ahead of
    // an unresolved Region interaction, regardless of agency. The already-planned
    // movement which caused the interaction is allowed to continue only when its
    // behavior-scoped plan ID matches every active hold for this Token.
    const interactionHold = this.#evaluateInteractionHolds(document, effectiveOperation);
    if (interactionHold.blocked) {
      if (interactionHold.message) ui?.notifications?.warn?.(interactionHold.message);
      return false;
    }

    // Voluntary movement restriction is evaluated before the ordinary movement
    // interest fast-path. Native drag/keyboard movement often carries no AE5E
    // metadata and would otherwise exit before an Active Effect policy could be
    // enforced. Returning false at preMoveToken cleanly prevents the move from
    // committing, so no corrective snapback is normally required.
    const restriction = this.#voluntaryMovementRestriction.evaluate({
      document,
      movement,
      operation: effectiveOperation
    });
    if (restriction.blocked) {
      ui?.notifications?.warn?.(restriction.message);
      return false;
    }

    if (!this.#hasPotentialInterest(document, MOVEMENT_PHASES.BEFORE, effectiveOperation, game.user.id)) return;

    const transaction = MovementTransaction.fromTokenHook({
      document,
      movement,
      operation: effectiveOperation,
      phase: MOVEMENT_PHASES.BEFORE,
      user: game.user,
      accounting: this.#accounting
    });

    this.#pending.set(movement.id, transaction);
    const context = { document, movement, operation: effectiveOperation, service: this };

    if (this.#registry.dispatchSync(transaction, MOVEMENT_PHASES.BEFORE, context) === false) {
      this.#pending.delete(movement.id);
      return false;
    }

    if (Hooks.call(HOOKS.PRE_MOVEMENT_TRANSACTION, transaction, context) === false) {
      this.#pending.delete(movement.id);
      return false;
    }
  }

  #onMoveToken(document, movement, operation, user) {
    if (!this.#isEnabled()) return;

    const interoperableOperation = this.#catMovement?.enrichOperation({ document, movement, operation }) ?? operation;
    const effectiveOperation = this.#withMovementContext(movement, interoperableOperation);
    const wasPending = this.#pending.has(movement.id);
    if (!wasPending && !this.#hasPotentialInterest(document, MOVEMENT_PHASES.AFTER, effectiveOperation, user?.id)) return;

    const transaction = MovementTransaction.fromTokenHook({
      document,
      movement,
      operation: effectiveOperation,
      phase: MOVEMENT_PHASES.AFTER,
      user,
      accounting: this.#accounting
    });

    this.#pending.delete(movement.id);
    if (this.#captureDiagnostics()) this.#remember(transaction);

    const context = { document, movement, operation: effectiveOperation, user, service: this };
    queueMicrotask(() => {
      void this.#dispatchAfter(transaction, context);
    });
  }

  #onStopToken(document) {
    for (const [movementId, transaction] of this.#pending) {
      if (transaction.subjectUuid === document.uuid) this.#pending.delete(movementId);
    }
  }

  async #dispatchAfter(transaction, context) {
    const started = performance.now();
    await this.#registry.dispatch(transaction, MOVEMENT_PHASES.AFTER, context);
    Hooks.callAll(HOOKS.MOVEMENT_TRANSACTION, transaction, context);

    const elapsed = performance.now() - started;
    if (elapsed > 8) Logger.debug(`Movement transaction ${transaction.id} dispatched in ${elapsed.toFixed(2)}ms.`);
  }

  #remember(transaction) {
    this.#recent.push(transaction);
    if (this.#recent.length > MAX_RECENT_TRANSACTIONS) this.#recent.shift();
  }
}
