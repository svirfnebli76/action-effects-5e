import { MOVEMENT_PHASES } from "../core/constants.js";
import { asArray } from "../core/utils.js";
import { Logger } from "../core/logger.js";

export class MovementRegistry {
  #consumers = new Map();
  #byToken = new Map();
  #byScene = new Map();
  #wildcard = new Set();

  register({
    id,
    phases = [MOVEMENT_PHASES.AFTER],
    priority = 0,
    tokenUuids = [],
    sceneIds = [],
    predicate = null,
    handler,
    once = false,
    execution = "initiator"
  }) {
    if (typeof id !== "string" || !id.length) throw new TypeError("Movement consumer id must be a non-empty string.");
    if (this.#consumers.has(id)) throw new Error(`Movement consumer '${id}' is already registered.`);
    if (typeof handler !== "function") throw new TypeError(`Movement consumer '${id}' requires a handler function.`);
    if (predicate !== null && typeof predicate !== "function") throw new TypeError(`Movement consumer '${id}' predicate must be a function.`);
    if (!["initiator", "primaryGM", "all"].includes(execution)) {
      throw new Error(`Movement consumer '${id}' has unsupported execution scope '${execution}'.`);
    }

    const normalizedPhases = new Set(asArray(phases));
    for (const phase of normalizedPhases) {
      if (!Object.values(MOVEMENT_PHASES).includes(phase)) {
        throw new Error(`Movement consumer '${id}' has unsupported phase '${phase}'.`);
      }
    }

    const consumer = Object.freeze({
      id,
      phases: normalizedPhases,
      priority: Number(priority) || 0,
      tokenUuids: new Set(asArray(tokenUuids).filter(Boolean)),
      sceneIds: new Set(asArray(sceneIds).filter(Boolean)),
      predicate,
      handler,
      once: Boolean(once),
      execution
    });

    this.#consumers.set(id, consumer);
    this.#indexConsumer(consumer);
    Logger.debug(`Registered movement consumer '${id}'.`);

    return () => this.unregister(id);
  }

  unregister(id) {
    const consumer = this.#consumers.get(id);
    if (!consumer) return false;

    this.#consumers.delete(id);
    this.#unindexConsumer(consumer);
    Logger.debug(`Unregistered movement consumer '${id}'.`);
    return true;
  }

  clear() {
    this.#consumers.clear();
    this.#byToken.clear();
    this.#byScene.clear();
    this.#wildcard.clear();
  }

  hasPotentialInterest(document, phase, { userId = game.user.id } = {}) {
    if (!document) return false;
    const tokenUuid = document.uuid;
    const sceneId = document.parent?.id;

    return this.#hasPhase(this.#wildcard, phase, userId)
      || this.#hasPhase(this.#byToken.get(tokenUuid), phase, userId)
      || this.#hasPhase(this.#byScene.get(sceneId), phase, userId);
  }

  getMatching(transaction, phase) {
    const ids = new Set([
      ...this.#wildcard,
      ...(this.#byToken.get(transaction.subjectUuid) ?? []),
      ...(this.#byScene.get(transaction.sceneId) ?? [])
    ]);

    return [...ids]
      .map((id) => this.#consumers.get(id))
      .filter((consumer) => consumer?.phases.has(phase))
      .filter((consumer) => this.#shouldExecute(consumer, transaction.userId))
      .filter((consumer) => {
        if (!consumer.predicate) return true;
        try {
          return consumer.predicate(transaction) !== false;
        } catch (error) {
          Logger.error(`Movement consumer '${consumer.id}' predicate failed.`, error);
          return false;
        }
      })
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  }

  dispatchSync(transaction, phase, context = {}) {
    for (const consumer of this.getMatching(transaction, phase)) {
      try {
        const result = consumer.handler(transaction, context);
        if (consumer.once) this.unregister(consumer.id);
        if (result === false) return false;
      } catch (error) {
        Logger.error(`Movement consumer '${consumer.id}' failed during '${phase}'.`, error);
      }
    }
    return true;
  }

  async dispatch(transaction, phase, context = {}) {
    for (const consumer of this.getMatching(transaction, phase)) {
      try {
        await consumer.handler(transaction, context);
        if (consumer.once) this.unregister(consumer.id);
      } catch (error) {
        Logger.error(`Movement consumer '${consumer.id}' failed during '${phase}'.`, error);
      }
    }
  }

  getStats() {
    return {
      consumers: this.#consumers.size,
      wildcardConsumers: this.#wildcard.size,
      tokenIndexes: this.#byToken.size,
      sceneIndexes: this.#byScene.size
    };
  }

  #indexConsumer(consumer) {
    const hasSpecificTargets = consumer.tokenUuids.size || consumer.sceneIds.size;
    if (!hasSpecificTargets) this.#wildcard.add(consumer.id);

    for (const uuid of consumer.tokenUuids) this.#addToIndex(this.#byToken, uuid, consumer.id);
    for (const sceneId of consumer.sceneIds) this.#addToIndex(this.#byScene, sceneId, consumer.id);
  }

  #unindexConsumer(consumer) {
    this.#wildcard.delete(consumer.id);
    for (const uuid of consumer.tokenUuids) this.#removeFromIndex(this.#byToken, uuid, consumer.id);
    for (const sceneId of consumer.sceneIds) this.#removeFromIndex(this.#byScene, sceneId, consumer.id);
  }

  #hasPhase(ids, phase, userId) {
    if (!ids?.size) return false;
    for (const id of ids) {
      const consumer = this.#consumers.get(id);
      if (consumer?.phases.has(phase) && this.#shouldExecute(consumer, userId)) return true;
    }
    return false;
  }

  #shouldExecute(consumer, userId) {
    switch (consumer.execution) {
      case "all":
        return true;
      case "primaryGM": {
        const activeGm = game.users?.activeGM
          ?? game.users?.find?.((user) => user.active && user.isGM);
        return Boolean(game.user?.isGM && activeGm?.id === game.user.id);
      }
      case "initiator":
      default:
        return game.user?.id === userId;
    }
  }

  #addToIndex(index, key, id) {
    if (!index.has(key)) index.set(key, new Set());
    index.get(key).add(id);
  }

  #removeFromIndex(index, key, id) {
    const set = index.get(key);
    if (!set) return;
    set.delete(id);
    if (!set.size) index.delete(key);
  }
}
