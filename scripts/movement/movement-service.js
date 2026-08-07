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

export class MovementService {
  #registry;
  #relationships;
  #initialized = false;
  #pending = new Map();
  #recent = [];
  #hookIds = [];

  constructor({ registry, relationships }) {
    this.#registry = registry;
    this.#relationships = relationships;
  }

  initialize() {
    if (this.#initialized) return;
    this.#initialized = true;

    this.#hookIds.push(Hooks.on("preMoveToken", this.#onPreMoveToken.bind(this)));
    this.#hookIds.push(Hooks.on("moveToken", this.#onMoveToken.bind(this)));
    this.#hookIds.push(Hooks.on("stopToken", this.#onStopToken.bind(this)));

    Logger.info("Movement service initialized with one pre-move and one post-move listener.");
  }

  shutdown() {
    if (!this.#initialized) return;
    Hooks.off("preMoveToken", this.#hookIds[0]);
    Hooks.off("moveToken", this.#hookIds[1]);
    Hooks.off("stopToken", this.#hookIds[2]);
    this.#hookIds = [];
    this.#pending.clear();
    this.#initialized = false;
  }

  registerConsumer(config) {
    return this.#registry.register(config);
  }

  unregisterConsumer(id) {
    return this.#registry.unregister(id);
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

  async dispatchSyntheticForTesting(transaction) {
    await this.#registry.dispatch(transaction, MOVEMENT_PHASES.AFTER, { synthetic: true, service: this });
  }

  getStats() {
    return {
      initialized: this.#initialized,
      pendingTransactions: this.#pending.size,
      recentTransactions: this.#recent.length,
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
    if (operation?.[OPERATION_METADATA_KEY]?.suppressAutomation === true) return false;
    if (this.#captureDiagnostics()) return true;
    if (this.#relationships.involves(document.uuid) && game.user.id === userId) return true;
    return this.#registry.hasPotentialInterest(document, phase, { userId });
  }

  #onPreMoveToken(document, movement, operation) {
    if (!this.#isEnabled()) return;
    if (!this.#hasPotentialInterest(document, MOVEMENT_PHASES.BEFORE, operation, game.user.id)) return;

    const transaction = MovementTransaction.fromTokenHook({
      document,
      movement,
      operation,
      phase: MOVEMENT_PHASES.BEFORE,
      user: game.user
    });

    this.#pending.set(movement.id, transaction);
    const context = { document, movement, operation, service: this };

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

    const wasPending = this.#pending.has(movement.id);
    if (!wasPending && !this.#hasPotentialInterest(document, MOVEMENT_PHASES.AFTER, operation, user?.id)) return;

    const transaction = MovementTransaction.fromTokenHook({
      document,
      movement,
      operation,
      phase: MOVEMENT_PHASES.AFTER,
      user
    });

    this.#pending.delete(movement.id);
    if (this.#captureDiagnostics()) this.#remember(transaction);

    const context = { document, movement, operation, user, service: this };
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
