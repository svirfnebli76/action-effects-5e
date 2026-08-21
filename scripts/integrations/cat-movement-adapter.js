import {
  MODULE_ID,
  MOVEMENT_AGENCIES,
  MOVEMENT_RESOURCES,
  OPERATION_METADATA_KEY,
  PATH_TYPES
} from "../core/constants.js";
import { duplicateSafely, randomId } from "../core/utils.js";
import { Logger } from "../core/logger.js";

export const CAT_MODULE_ID = "cat";
export const CAT_FORCED_ACTION_ID = "catForce";
export const CAT_TELEPORT_MOVEMENT_MODE = "teleport";
export const CAT_TELEPORT_PRE_PASS = "preTeleport";
export const CAT_TELEPORT_POST_PASS = "postTeleport";

const CAT_MOVEMENT_EVENT_RUN_TARGET = "cat.lib.Events.MovementEvent.prototype.run";
const CAT_TELEPORT_CONTEXT_BEGIN_SOCKET = "interoperability.cat.teleport.begin";
const CAT_TELEPORT_CONTEXT_END_SOCKET = "interoperability.cat.teleport.end";
const CAT_TELEPORT_CONTEXT_TTL_MS = 120_000;
const MAX_RECOGNIZED_MOVEMENTS = 100;

function terminalMovementAction(movement = {}) {
  const collections = [
    movement?.passed?.waypoints,
    movement?.pending?.waypoints,
    movement?.waypoints,
    movement?.history?.unrecorded?.waypoints,
    movement?.history?.path
  ];
  const candidates = [movement?.destination?.action, movement?.action];
  for (const collection of collections) {
    if (Array.isArray(collection) && collection.length) candidates.push(collection.at(-1)?.action);
  }
  return candidates.find((action) => typeof action === "string" && action.length) ?? null;
}

function terminalMovementDestination(movement = {}) {
  const collections = [
    movement?.passed?.waypoints,
    movement?.waypoints,
    movement?.history?.unrecorded?.waypoints,
    movement?.history?.path
  ];
  const candidates = [movement?.destination];
  for (const collection of collections) {
    if (Array.isArray(collection) && collection.length) candidates.push(collection.at(-1));
  }
  return candidates.find((point) => Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y))) ?? null;
}

function actionConfig(actionId) {
  const actions = globalThis.CONFIG?.Token?.movement?.actions;
  return actions?.get?.(actionId) ?? actions?.[actionId] ?? null;
}

function defaultCatAccessor() {
  return globalThis.cat ?? null;
}

function sanitizePosition(position = null) {
  if (!position || !Number.isFinite(Number(position.x)) || !Number.isFinite(Number(position.y))) return null;
  const result = { x: Number(position.x), y: Number(position.y) };
  if (Number.isFinite(Number(position.elevation))) result.elevation = Number(position.elevation);
  return result;
}

function positionsMatch(a, b, tolerance = 0.01) {
  if (!a || !b) return false;
  if (Math.abs(Number(a.x) - Number(b.x)) > tolerance) return false;
  if (Math.abs(Number(a.y) - Number(b.y)) > tolerance) return false;
  if (Number.isFinite(Number(a.elevation)) && Number.isFinite(Number(b.elevation))) {
    if (Math.abs(Number(a.elevation) - Number(b.elevation)) > tolerance) return false;
  }
  return true;
}

function activeGmUserIdsExcludingCurrent() {
  const currentUserId = globalThis.game?.user?.id ?? null;
  const users = globalThis.game?.users;
  if (!users) return [];
  return [...users]
    .filter((user) => user?.active === true && user?.isGM === true && user.id !== currentUserId)
    .map((user) => user.id);
}

/**
 * CAT is an input/execution adapter only. AE5E retains movement semantics,
 * accounting, relationships, displacement, and restriction policy ownership.
 *
 * CAT's teleport helper currently announces preTeleport, performs the physical
 * move with the ordinary `displace` movement action, then announces postTeleport.
 * Since `displace` is not itself sufficient proof of teleportation, this adapter
 * observes CAT's semantic MovementEvent lifecycle and temporarily correlates the
 * token/destination with the Foundry movement hooks that AE5E already consumes.
 */
export class CatMovementAdapter {
  #catAccessor;
  #socket;
  #initialized = false;
  #wrapperRegistered = false;
  #wrapperId = null;
  #socketHandlersRegistered = false;
  #recognizedMovementIds = new Set();
  #recognizedTeleportMovements = new Map();
  #pendingTeleportContexts = new Map();
  #stats = {
    executionAttempts: 0,
    catExecutions: 0,
    nativeFallbackExecutions: 0,
    executionErrors: 0,
    recognizedExternalMovements: 0,
    recognizedExternalTeleports: 0,
    teleportLifecycleEvents: 0,
    teleportContextsStarted: 0,
    teleportContextsEnded: 0,
    teleportContextsBroadcast: 0,
    teleportContextSocketErrors: 0,
    teleportWrapperErrors: 0,
    cancelledTeleportsObserved: 0
  };

  constructor({ catAccessor = defaultCatAccessor, socket = null } = {}) {
    this.#catAccessor = typeof catAccessor === "function" ? catAccessor : defaultCatAccessor;
    this.#socket = socket;
  }

  initialize() {
    if (this.#initialized) return this.getStatus();
    this.#initialized = true;

    this.#registerSocketHandlers();
    this.#registerTeleportLifecycleWrapper();
    return this.getStatus();
  }

  shutdown() {
    if (this.#wrapperRegistered && this.#wrapperId !== null) {
      try {
        globalThis.libWrapper?.unregister?.(MODULE_ID, this.#wrapperId);
      } catch (error) {
        Logger.debug("Could not unregister CAT teleport lifecycle wrapper during shutdown.", error);
      }
    }
    this.#wrapperRegistered = false;
    this.#wrapperId = null;
    this.#pendingTeleportContexts.clear();
    this.#recognizedTeleportMovements.clear();
    this.#initialized = false;
  }

  getStatus() {
    const module = globalThis.game?.modules?.get?.(CAT_MODULE_ID) ?? null;
    const cat = this.#catAccessor();
    const moveToken = cat?.utils?.tokenUtils?.moveToken;
    const movementEventRun = cat?.lib?.Events?.MovementEvent?.prototype?.run;
    const forceAction = actionConfig(CAT_FORCED_ACTION_ID);

    return {
      installed: Boolean(module),
      active: Boolean(module?.active),
      version: module?.version ?? null,
      apiExposed: Boolean(cat),
      moveTokenAvailable: typeof moveToken === "function",
      executionAvailable: Boolean(module?.active) && typeof moveToken === "function",
      forcedAction: forceAction ? {
        id: CAT_FORCED_ACTION_ID,
        measure: forceAction.measure ?? null,
        teleport: forceAction.teleport ?? null,
        walls: forceAction.walls ?? null
      } : null,
      teleportLifecycle: {
        movementEventAvailable: typeof movementEventRun === "function",
        wrapperRegistered: this.#wrapperRegistered,
        socketHandlersRegistered: this.#socketHandlersRegistered,
        pendingContexts: this.#pendingTeleportContexts.size,
        recognizedMovements: this.#recognizedTeleportMovements.size,
        compatibilityAvailable: Boolean(module?.active) && this.#wrapperRegistered
      },
      // CAT intentionally defines catForce as unmeasured in characterized
      // versions. That is useful CAT semantics, but it cannot replace AE5E's
      // measured/zero-cost action because AE5E needs physical traverse distance.
      catForceSuitableForAe5eNoCostMovement: Boolean(forceAction) && forceAction.measure !== false,
      strategy: "CAT supplies execution and explicit teleport/forced-movement semantics; AE5E owns movement classification consequences, relationships, restrictions, and accounting."
    };
  }

  getStats() {
    this.#cleanupExpiredTeleportState();
    return {
      ...this.#stats,
      status: this.getStatus()
    };
  }

  /**
   * Low-level single-token movement facade.
   *
   * CAT is preferred only when it is active and exposes tokenUtils.moveToken.
   * If CAT is unavailable before execution begins, AE5E falls back to Foundry's
   * TokenDocument#move. An exception after CAT execution begins is never retried
   * natively because doing so could duplicate a partially completed movement.
   */
  async moveToken(token, waypoints, options = {}) {
    const document = token?.document ?? token;
    if (!document || typeof document.move !== "function") {
      throw new TypeError("CAT movement facade requires a TokenDocument or Token placeable.");
    }
    if (!Array.isArray(waypoints) || !waypoints.length) {
      throw new TypeError("CAT movement facade requires at least one waypoint.");
    }

    this.#stats.executionAttempts += 1;
    const status = this.getStatus();
    const moveToken = this.#catAccessor()?.utils?.tokenUtils?.moveToken;

    if (status.executionAvailable && typeof moveToken === "function") {
      this.#stats.catExecutions += 1;
      try {
        return await moveToken(document, waypoints, options);
      } catch (error) {
        this.#stats.executionErrors += 1;
        Logger.error("CAT movement execution failed. AE5E will not retry natively because movement may already have partially executed.", error);
        throw error;
      }
    }

    this.#stats.nativeFallbackExecutions += 1;
    return document.move(waypoints, options);
  }

  /**
   * Called by the narrow CAT MovementEvent.run wrapper after a semantic CAT
   * teleport lifecycle event has completed. This method is deliberately public
   * on the adapter for deterministic regression testing; it is not exposed as a
   * feature API to consumers.
   */
  async observeCatMovementEvent(event, { result = undefined } = {}) {
    if (event?.teleport !== true) return false;
    const pass = event?.pass;
    if (pass !== CAT_TELEPORT_PRE_PASS && pass !== CAT_TELEPORT_POST_PASS) return false;

    this.#stats.teleportLifecycleEvents += 1;
    this.#cleanupExpiredTeleportState();

    const tokenUuid = event?.token?.uuid ?? null;
    if (!tokenUuid) return false;

    if (pass === CAT_TELEPORT_PRE_PASS) {
      if (result) {
        this.#stats.cancelledTeleportsObserved += 1;
        await this.#endTeleportContext({ tokenUuid, broadcast: true });
        return true;
      }

      const context = {
        contextId: `${MODULE_ID}-cat-teleport-${randomId(16)}`,
        sourceUserId: globalThis.game?.user?.id ?? null,
        tokenUuid,
        sceneId: event?.token?.parent?.id ?? null,
        destination: sanitizePosition(event?.destination),
        startedAt: Date.now(),
        expiresAt: Date.now() + CAT_TELEPORT_CONTEXT_TTL_MS,
        recognizedWithoutMovementId: false
      };
      this.#storeTeleportContext(context);
      this.#stats.teleportContextsStarted += 1;
      await this.#broadcastTeleportContext(CAT_TELEPORT_CONTEXT_BEGIN_SOCKET, this.#serializeTeleportContext(context));
      return true;
    }

    await this.#endTeleportContext({
      tokenUuid,
      contextId: this.#pendingTeleportContexts.get(tokenUuid)?.contextId ?? null,
      broadcast: true
    });
    return true;
  }

  /**
   * Recognize CAT-origin movement. `catForce` is self-describing from its action;
   * CAT teleport is not, so teleport classification comes from the correlated
   * semantic lifecycle context installed by preTeleport.
   */
  enrichOperation({ document = null, movement, operation = {} } = {}) {
    const status = this.getStatus();
    if (!status.active) return operation ?? {};

    this.#cleanupExpiredTeleportState();
    const teleportContext = this.#resolveTeleportContext(document, movement);
    if (teleportContext) return this.#enrichTeleportOperation({ movement, operation, context: teleportContext });

    if (terminalMovementAction(movement) !== CAT_FORCED_ACTION_ID) return operation ?? {};

    const current = operation?.[OPERATION_METADATA_KEY];
    const metadata = current && typeof current === "object" && !Array.isArray(current)
      ? current
      : {};

    // Never overwrite richer semantics supplied by AE5E or another explicit
    // integration. Only fill the semantic facts that CAT's catForce action
    // itself guarantees.
    const enriched = {
      ...duplicateSafely(metadata),
      pathType: metadata.pathType ?? PATH_TYPES.TRAVERSE,
      agency: metadata.agency ?? MOVEMENT_AGENCIES.FORCED,
      resource: metadata.resource ?? MOVEMENT_RESOURCES.NONE,
      movementMode: metadata.movementMode ?? CAT_FORCED_ACTION_ID,
      nativeMovementAction: metadata.nativeMovementAction ?? CAT_FORCED_ACTION_ID,
      generatedBy: metadata.generatedBy ?? CAT_MODULE_ID,
      internal: metadata.internal === true,
      suppressAutomation: metadata.suppressAutomation === true,
      interoperabilityProvider: metadata.interoperabilityProvider ?? CAT_MODULE_ID,
      catMovement: true,
      catAction: CAT_FORCED_ACTION_ID,
      catActionMeasured: status.forcedAction?.measure === true,
      externalMovementSemantics: true
    };

    const movementId = movement?.id ?? null;
    if (!movementId || !this.#recognizedMovementIds.has(movementId)) {
      this.#stats.recognizedExternalMovements += 1;
      if (movementId) {
        this.#recognizedMovementIds.add(movementId);
        while (this.#recognizedMovementIds.size > MAX_RECOGNIZED_MOVEMENTS) {
          this.#recognizedMovementIds.delete(this.#recognizedMovementIds.values().next().value);
        }
      }
    }
    return {
      ...(operation ?? {}),
      [OPERATION_METADATA_KEY]: enriched
    };
  }

  isInteroperabilityOperation(operation = {}) {
    const metadata = operation?.[OPERATION_METADATA_KEY] ?? {};
    return metadata.interoperabilityProvider === CAT_MODULE_ID || metadata.catTeleport === true;
  }

  #registerSocketHandlers() {
    if (this.#socketHandlersRegistered || typeof this.#socket?.register !== "function") return;
    try {
      this.#socket.register(CAT_TELEPORT_CONTEXT_BEGIN_SOCKET, (payload) => this.#receiveTeleportContext(payload));
      this.#socket.register(CAT_TELEPORT_CONTEXT_END_SOCKET, (payload) => this.#receiveTeleportEnd(payload));
      this.#socketHandlersRegistered = true;
    } catch (error) {
      this.#stats.teleportContextSocketErrors += 1;
      Logger.warn("Could not register CAT teleport semantic socket handlers. Local CAT teleports remain detectable, but cross-client CAT teleport classification may be unavailable.", error);
    }
  }

  #registerTeleportLifecycleWrapper() {
    if (this.#wrapperRegistered) return;
    const status = this.getStatus();
    if (!status.active || !status.teleportLifecycle.movementEventAvailable) return;
    if (!globalThis.libWrapper?.register) {
      Logger.warn("CAT teleport semantics are available, but libWrapper is unavailable; CAT teleport compatibility could not be armed.");
      return;
    }

    const adapter = this;
    try {
      this.#wrapperId = globalThis.libWrapper.register(
        MODULE_ID,
        CAT_MOVEMENT_EVENT_RUN_TARGET,
        async function ae5eCatMovementEventRunWrapper(wrapped, ...args) {
          const isTeleportLifecycle = this?.teleport === true
            && (this?.pass === CAT_TELEPORT_PRE_PASS || this?.pass === CAT_TELEPORT_POST_PASS);
          if (!isTeleportLifecycle) return wrapped(...args);

          if (this.pass === CAT_TELEPORT_PRE_PASS) {
            const result = await wrapped(...args);
            try {
              await adapter.observeCatMovementEvent(this, { result });
            } catch (error) {
              adapter.#stats.teleportWrapperErrors += 1;
              Logger.warn("AE5E could not record CAT preTeleport semantics; CAT teleport execution will continue unchanged.", error);
            }
            return result;
          }

          try {
            return await wrapped(...args);
          } finally {
            try {
              await adapter.observeCatMovementEvent(this);
            } catch (error) {
              adapter.#stats.teleportWrapperErrors += 1;
              Logger.warn("AE5E could not clear CAT postTeleport semantics; stale context will expire automatically.", error);
            }
          }
        },
        "WRAPPER"
      );
      this.#wrapperRegistered = true;
      Logger.info("CAT teleport semantic lifecycle compatibility initialized.");
    } catch (error) {
      this.#stats.teleportWrapperErrors += 1;
      this.#wrapperRegistered = false;
      this.#wrapperId = null;
      Logger.warn("Could not register CAT teleport lifecycle compatibility wrapper. Existing AE5E movement behavior remains unchanged.", error);
    }
  }

  #serializeTeleportContext(context) {
    return {
      contextId: context.contextId,
      sourceUserId: context.sourceUserId,
      tokenUuid: context.tokenUuid,
      sceneId: context.sceneId,
      destination: context.destination ? duplicateSafely(context.destination) : null,
      startedAt: context.startedAt,
      expiresAt: context.expiresAt
    };
  }

  #storeTeleportContext(context) {
    if (!context?.contextId || !context?.tokenUuid) return false;
    this.#pendingTeleportContexts.set(context.tokenUuid, {
      ...context,
      destination: sanitizePosition(context.destination),
      startedAt: Number(context.startedAt) || Date.now(),
      expiresAt: Number(context.expiresAt) || (Date.now() + CAT_TELEPORT_CONTEXT_TTL_MS),
      recognizedWithoutMovementId: context.recognizedWithoutMovementId === true
    });
    return true;
  }

  #receiveTeleportContext(payload = {}) {
    this.#cleanupExpiredTeleportState();
    if (!payload || typeof payload !== "object") return false;
    if (typeof payload.contextId !== "string" || !payload.contextId.length) return false;
    if (typeof payload.tokenUuid !== "string" || !payload.tokenUuid.length) return false;
    const expiresAt = Number(payload.expiresAt);
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) return false;
    return this.#storeTeleportContext({
      contextId: payload.contextId,
      sourceUserId: typeof payload.sourceUserId === "string" ? payload.sourceUserId : null,
      tokenUuid: payload.tokenUuid,
      sceneId: typeof payload.sceneId === "string" ? payload.sceneId : null,
      destination: sanitizePosition(payload.destination),
      startedAt: Number(payload.startedAt) || Date.now(),
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + CAT_TELEPORT_CONTEXT_TTL_MS,
      recognizedWithoutMovementId: false
    });
  }

  #receiveTeleportEnd(payload = {}) {
    if (!payload || typeof payload !== "object") return false;
    const tokenUuid = typeof payload.tokenUuid === "string" ? payload.tokenUuid : null;
    const contextId = typeof payload.contextId === "string" ? payload.contextId : null;
    if (!tokenUuid) return false;
    const current = this.#pendingTeleportContexts.get(tokenUuid);
    if (!current) return true;
    if (contextId && current.contextId !== contextId) return false;
    this.#pendingTeleportContexts.delete(tokenUuid);
    this.#stats.teleportContextsEnded += 1;
    return true;
  }

  async #endTeleportContext({ tokenUuid, contextId = null, broadcast = false } = {}) {
    if (!tokenUuid) return false;
    const current = this.#pendingTeleportContexts.get(tokenUuid);
    const effectiveContextId = contextId ?? current?.contextId ?? null;
    const removed = this.#receiveTeleportEnd({ tokenUuid, contextId: effectiveContextId });
    if (broadcast) {
      await this.#broadcastTeleportContext(CAT_TELEPORT_CONTEXT_END_SOCKET, {
        tokenUuid,
        contextId: effectiveContextId
      });
    }
    return removed;
  }

  async #broadcastTeleportContext(socketName, payload) {
    if (globalThis.game?.user?.isGM === true) return;
    const recipientIds = activeGmUserIdsExcludingCurrent();
    if (!recipientIds.length) return;
    if (!this.#socket?.ready || typeof this.#socket?.executeForUsers !== "function") {
      this.#stats.teleportContextSocketErrors += 1;
      Logger.warn("AE5E could not socket CAT teleport semantics to the active GM because the Socketlib bridge is not ready.");
      return;
    }

    try {
      await this.#socket.executeForUsers(socketName, recipientIds, duplicateSafely(payload));
      this.#stats.teleportContextsBroadcast += 1;
    } catch (error) {
      this.#stats.teleportContextSocketErrors += 1;
      Logger.warn("AE5E could not socket CAT teleport semantics to the active GM; CAT teleport execution will continue unchanged.", error);
    }
  }

  #resolveTeleportContext(document, movement) {
    const movementId = movement?.id ?? null;
    if (movementId) {
      const recognized = this.#recognizedTeleportMovements.get(movementId);
      if (recognized) return recognized;
    }

    const tokenUuid = document?.uuid ?? null;
    if (!tokenUuid) return null;
    const pending = this.#pendingTeleportContexts.get(tokenUuid);
    if (!pending) return null;

    const destination = terminalMovementDestination(movement);
    // CAT's preTeleport event includes the exact destination subsequently passed
    // into moveToken. Requiring that destination when available prevents an
    // unrelated move of the same token during a pre-teleport animation window
    // from being mislabeled as teleportation.
    if (pending.destination && (!destination || !positionsMatch(pending.destination, destination))) return null;

    const recognized = {
      contextId: pending.contextId,
      tokenUuid,
      destination: pending.destination ? duplicateSafely(pending.destination) : sanitizePosition(destination),
      recognizedAt: Date.now(),
      expiresAt: Date.now() + CAT_TELEPORT_CONTEXT_TTL_MS
    };

    if (movementId) {
      this.#recognizedTeleportMovements.set(movementId, recognized);
      while (this.#recognizedTeleportMovements.size > MAX_RECOGNIZED_MOVEMENTS) {
        this.#recognizedTeleportMovements.delete(this.#recognizedTeleportMovements.keys().next().value);
      }
      this.#stats.recognizedExternalMovements += 1;
      this.#stats.recognizedExternalTeleports += 1;
    } else if (!pending.recognizedWithoutMovementId) {
      pending.recognizedWithoutMovementId = true;
      this.#stats.recognizedExternalMovements += 1;
      this.#stats.recognizedExternalTeleports += 1;
    }

    return recognized;
  }

  #enrichTeleportOperation({ movement, operation = {}, context }) {
    const current = operation?.[OPERATION_METADATA_KEY];
    const metadata = current && typeof current === "object" && !Array.isArray(current)
      ? current
      : {};
    const nativeAction = terminalMovementAction(movement);

    const enriched = {
      ...duplicateSafely(metadata),
      // CAT's semantic lifecycle is definitive evidence that this movement is a
      // teleport even though the physical Foundry action is currently `displace`.
      pathType: PATH_TYPES.TELEPORT,
      teleport: true,
      agency: metadata.agency ?? MOVEMENT_AGENCIES.UNKNOWN,
      resource: metadata.resource ?? MOVEMENT_RESOURCES.NONE,
      movementMode: metadata.movementMode ?? CAT_TELEPORT_MOVEMENT_MODE,
      nativeMovementAction: metadata.nativeMovementAction ?? nativeAction,
      generatedBy: metadata.generatedBy ?? CAT_MODULE_ID,
      internal: metadata.internal === true,
      suppressAutomation: metadata.suppressAutomation === true,
      interoperabilityProvider: metadata.interoperabilityProvider ?? CAT_MODULE_ID,
      catMovement: true,
      catTeleport: true,
      catTeleportContextId: context?.contextId ?? null,
      catAction: nativeAction,
      externalMovementSemantics: true
    };

    return {
      ...(operation ?? {}),
      [OPERATION_METADATA_KEY]: enriched
    };
  }

  #cleanupExpiredTeleportState() {
    const now = Date.now();
    for (const [tokenUuid, context] of this.#pendingTeleportContexts) {
      if (Number(context?.expiresAt) <= now) this.#pendingTeleportContexts.delete(tokenUuid);
    }
    for (const [movementId, context] of this.#recognizedTeleportMovements) {
      if (Number(context?.expiresAt) <= now) this.#recognizedTeleportMovements.delete(movementId);
    }
  }
}
