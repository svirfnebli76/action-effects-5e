import {
  HOOKS,
  MAX_RECENT_TRANSACTIONS,
  MODULE_ID,
  MOVEMENT_PHASES,
  OPERATION_METADATA_KEY,
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
  #voluntaryMovementRestriction;
  #initialized = false;
  #pending = new Map();
  #recent = [];
  #hookIds = [];
  #movementContexts = new Map();

  constructor({ registry, relationships, accounting = null, catMovement = null, voluntaryMovementRestriction = null }) {
    this.#registry = registry;
    this.#relationships = relationships;
    this.#accounting = accounting;
    this.#catMovement = catMovement;
    this.#voluntaryMovementRestriction = voluntaryMovementRestriction ?? new VoluntaryMovementRestrictionPolicy();
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
    this.#initialized = false;
  }

  registerConsumer(config) {
    return this.#registry.register(config);
  }

  unregisterConsumer(id) {
    return this.#registry.unregister(id);
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

  async dispatchSyntheticForTesting(transaction) {
    await this.#registry.dispatch(transaction, MOVEMENT_PHASES.AFTER, { synthetic: true, service: this });
  }

  getStats() {
    return {
      initialized: this.#initialized,
      pendingTransactions: this.#pending.size,
      recentTransactions: this.#recent.length,
      movementContexts: this.#movementContexts.size,
      accounting: this.#accounting?.getStats?.() ?? null,
      voluntaryMovementRestriction: this.#voluntaryMovementRestriction.getStats(),
      registry: this.#registry.getStats()
    };
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

  #withMovementContext(movement, operation = {}) {
    // Foundry assigns a new movement.id when it continues through an explicit
    // checkpoint, while waypoint.subpathId remains tied to the original movement
    // instruction ID. Resolve semantic ownership by either identifier so every
    // continuation of an AE5E-generated route stays internal and recursion-safe.
    let context = null;
    for (const key of movementContextKeys(movement)) {
      context = this.#movementContexts.get(key);
      if (context) break;
    }
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
