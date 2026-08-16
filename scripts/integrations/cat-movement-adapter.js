import {
  MODULE_ID,
  MOVEMENT_AGENCIES,
  MOVEMENT_RESOURCES,
  OPERATION_METADATA_KEY,
  PATH_TYPES
} from "../core/constants.js";
import { duplicateSafely } from "../core/utils.js";
import { Logger } from "../core/logger.js";

export const CAT_MODULE_ID = "cat";
export const CAT_FORCED_ACTION_ID = "catForce";

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

function actionConfig(actionId) {
  const actions = globalThis.CONFIG?.Token?.movement?.actions;
  return actions?.get?.(actionId) ?? actions?.[actionId] ?? null;
}

function defaultCatAccessor() {
  return globalThis.cat ?? null;
}

export class CatMovementAdapter {
  #catAccessor;
  #recognizedMovementIds = new Set();
  #stats = {
    executionAttempts: 0,
    catExecutions: 0,
    nativeFallbackExecutions: 0,
    executionErrors: 0,
    recognizedExternalMovements: 0
  };

  constructor({ catAccessor = defaultCatAccessor } = {}) {
    this.#catAccessor = typeof catAccessor === "function" ? catAccessor : defaultCatAccessor;
  }

  getStatus() {
    const module = globalThis.game?.modules?.get?.(CAT_MODULE_ID) ?? null;
    const cat = this.#catAccessor();
    const moveToken = cat?.utils?.tokenUtils?.moveToken;
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
      // CAT 0.0.6 intentionally defines catForce with measure:false. That is
      // useful CAT semantics, but it cannot replace AE5E's measured/zero-cost
      // action because AE5E needs physical traverse distance preserved.
      catForceSuitableForAe5eNoCostMovement: Boolean(forceAction) && forceAction.measure !== false,
      strategy: "CAT executes eligible single-token movement; AE5E owns movement semantics and accounting actions."
    };
  }

  getStats() {
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
   * Recognize CAT-origin movement that carries CAT's unique forced action.
   * Ordinary CAT walk movement is intentionally not guessed: once CAT delegates
   * a normal walk to Foundry it is indistinguishable from other API/native walk
   * movement unless the caller supplied its own semantic metadata.
   */
  enrichOperation({ movement, operation = {} } = {}) {
    const status = this.getStatus();
    if (!status.active || terminalMovementAction(movement) !== CAT_FORCED_ACTION_ID) return operation ?? {};

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
        while (this.#recognizedMovementIds.size > 100) {
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
    return operation?.[OPERATION_METADATA_KEY]?.interoperabilityProvider === CAT_MODULE_ID;
  }
}
