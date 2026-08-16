import {
  MODULE_ID,
  MOVEMENT_AGENCIES,
  MOVEMENT_GEOMETRY_CHANNELS,
  MOVEMENT_PHASES,
  MOVEMENT_RESOURCES,
  NONHOSTILE_ENDPOINT_GRACE_MS,
  PATH_TYPES
} from "../core/constants.js";
import { duplicateSafely, randomId } from "../core/utils.js";
import { Logger } from "../core/logger.js";

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positionsEqual(a, b) {
  return Math.abs(finiteNumber(a?.x, 0) - finiteNumber(b?.x, 0)) <= 0.01
    && Math.abs(finiteNumber(a?.y, 0) - finiteNumber(b?.y, 0)) <= 0.01
    && Math.abs(finiteNumber(a?.elevation, 0) - finiteNumber(b?.elevation, 0)) <= 0.01;
}

export class NonhostileEndpointGraceService {
  #movement;
  #accounting;
  #obstructions;
  #movementExecutor;
  #pending = new Map();
  #consumerUnregister = new Map();

  constructor({ movement, accounting = null, obstructions, movementExecutor = null }) {
    this.#movement = movement;
    this.#accounting = accounting;
    this.#obstructions = obstructions;
    this.#movementExecutor = movementExecutor;
  }

  getStats() {
    return {
      pending: this.#pending.size,
      subjects: [...this.#pending.keys()]
    };
  }

  clearAll(reason = "clear-all") {
    for (const subjectUuid of [...this.#pending.keys()]) this.clear(subjectUuid, reason);
  }

  clear(subjectUuid, reason = "clear") {
    if (!subjectUuid) return false;
    const entry = this.#pending.get(subjectUuid);
    if (!entry) return false;
    if (entry.timeoutId) clearTimeout(entry.timeoutId);
    this.#pending.delete(subjectUuid);
    this.#consumerUnregister.get(subjectUuid)?.();
    this.#consumerUnregister.delete(subjectUuid);
    Logger.debug("Cleared displacement nonhostile endpoint grace state", { subjectUuid, reason });
    return true;
  }

  schedule({
    scene,
    subjectToken,
    sourceUuid = null,
    requestingUserId = null,
    displacementId = null,
    overlapPosition,
    rollbackPosition,
    occupantUuids = [],
    graceMs = NONHOSTILE_ENDPOINT_GRACE_MS
  } = {}) {
    if (!game.user?.isGM) throw new Error("Nonhostile endpoint grace must be scheduled by a GM client.");
    if (!(subjectToken instanceof foundry.documents.TokenDocument)) {
      throw new Error("Nonhostile endpoint grace requires a TokenDocument subject.");
    }
    if (!scene || scene.id !== subjectToken.parent?.id) {
      throw new Error("Nonhostile endpoint grace requires the subject's Scene.");
    }

    this.clear(subjectToken.uuid, "replaced");
    const serial = randomId(16);
    const normalizedGrace = Math.max(1, finiteNumber(graceMs, NONHOSTILE_ENDPOINT_GRACE_MS));
    const entry = {
      serial,
      sceneId: scene.id,
      subjectUuid: subjectToken.uuid,
      sourceUuid,
      requestingUserId,
      displacementId,
      overlapPosition: duplicateSafely(overlapPosition),
      rollbackPosition: duplicateSafely(rollbackPosition),
      occupantUuids: [...new Set(occupantUuids.filter(Boolean))],
      graceMs: normalizedGrace,
      timeoutId: null
    };

    const consumerId = `${MODULE_ID}.displacement-grace.${subjectToken.id}.${serial}`;
    const watchedTokenUuids = [subjectToken.uuid, ...entry.occupantUuids];
    const unregister = this.#movement.registerConsumer({
      id: consumerId,
      phases: [MOVEMENT_PHASES.AFTER],
      priority: 10_000,
      tokenUuids: watchedTokenUuids,
      execution: "primaryGM",
      handler: (transaction) => {
        const active = this.#pending.get(subjectToken.uuid);
        if (!active || active.serial !== serial) return;
        if (transaction?.metadata?.displacementGraceRollback === true) return;

        const document = scene.tokens.get(subjectToken.id);
        if (!document || !positionsEqual(active.overlapPosition, document)) {
          this.clear(subjectToken.uuid, "subject-left-overlap");
          return;
        }

        // A creature which caused the endpoint conflict may move away during
        // the grace window. Recheck immediately so resolved overlaps do not
        // retain a stale timer until expiry. If another creature still occupies
        // the endpoint, the grace remains active.
        if (transaction?.subjectUuid !== subjectToken.uuid) {
          const remaining = this.#obstructions.endpointConflicts({
            scene,
            subjectToken: document,
            position: active.overlapPosition,
            geometryChannel: MOVEMENT_GEOMETRY_CHANNELS.DISPLACED_BODY
          });
          if (!remaining.length) this.clear(subjectToken.uuid, "occupant-left-overlap");
        }
      }
    });
    this.#consumerUnregister.set(subjectToken.uuid, unregister);

    entry.timeoutId = setTimeout(() => {
      void this.#expire(subjectToken.uuid, serial).catch((error) => {
        const active = this.#pending.get(subjectToken.uuid);
        if (active?.serial === serial) this.clear(subjectToken.uuid, "expiry-error");
        Logger.error("Displacement endpoint-grace expiry failed.", error);
        ui?.notifications?.error?.("AE5E | Could not resolve an occupied forced-movement endpoint. See console.");
      });
    }, normalizedGrace);
    this.#pending.set(subjectToken.uuid, entry);

    Logger.debug("Displaced token entered a nonhostile occupied endpoint grace window", {
      subjectUuid: subjectToken.uuid,
      displacementId,
      graceMs: normalizedGrace,
      occupantUuids: entry.occupantUuids
    });
    return duplicateSafely({ ...entry, timeoutId: null });
  }

  async #expire(subjectUuid, serial) {
    const entry = this.#pending.get(subjectUuid);
    if (!entry || entry.serial !== serial) return;
    const scene = game.scenes.get(entry.sceneId);
    const subject = await fromUuid(entry.subjectUuid);
    if (!scene || !(subject instanceof foundry.documents.TokenDocument)) {
      this.clear(subjectUuid, "subject-unavailable");
      return;
    }
    if (!positionsEqual(entry.overlapPosition, subject)) {
      this.clear(subjectUuid, "subject-left-overlap");
      return;
    }

    // Any creature still occupying the endpoint makes the grace unresolved.
    // A disposition change from nonhostile to hostile during the grace window
    // must not accidentally legalize an existing overlap.
    const conflicts = this.#obstructions.endpointConflicts({
      scene,
      subjectToken: subject,
      position: entry.overlapPosition,
      geometryChannel: MOVEMENT_GEOMETRY_CHANNELS.DISPLACED_BODY
    });
    if (!conflicts.length) {
      this.clear(subjectUuid, "overlap-cleared");
      return;
    }

    this.clear(subjectUuid, "grace-expired");
    const movementMode = globalThis.CONFIG?.Token?.movement?.defaultAction ?? "walk";
    this.#accounting?.ensureRegistered?.();
    const action = this.#accounting?.noCostActionId ?? movementMode;
    const movementId = randomId(16);
    const options = {
      method: "api",
      animate: false,
      showRuler: false,
      pan: false,
      autoRotate: false,
      constrainOptions: {
        ignoreWalls: true,
        ignoreCost: true,
        ignoreTokens: true
      },
      ...this.#movement.createOperationOptions({
        transactionId: `${MODULE_ID}-displacement-grace-rollback-${randomId(16)}`,
        pathType: PATH_TYPES.REPOSITION,
        agency: MOVEMENT_AGENCIES.ADMINISTRATIVE,
        resource: MOVEMENT_RESOURCES.NONE,
        movementMode,
        nativeMovementAction: action,
        sourceUuid: entry.sourceUuid,
        initiatorUuid: entry.sourceUuid,
        requestingUserId: entry.requestingUserId,
        displacementId: entry.displacementId,
        displacementGraceRollback: true,
        generatedBy: MODULE_ID,
        internal: true,
        suppressAutomation: true
      })
    };
    const releaseContext = this.#movement.registerMovementContext(movementId, options);
    let completed = false;
    try {
      const rollbackWaypoint = {
        x: finiteNumber(entry.rollbackPosition?.x, subject.x),
        y: finiteNumber(entry.rollbackPosition?.y, subject.y),
        elevation: finiteNumber(entry.rollbackPosition?.elevation, subject.elevation),
        action,
        checkpoint: true,
        explicit: true
      };
      const executionOptions = {
        ...options,
        id: movementId
      };
      completed = this.#movementExecutor?.moveToken
        ? await this.#movementExecutor.moveToken(subject, [rollbackWaypoint], executionOptions)
        : await subject.move(rollbackWaypoint, executionOptions);
    } finally {
      releaseContext();
    }

    const restored = positionsEqual(scene.tokens.get(subject.id) ?? subject, entry.rollbackPosition);
    Logger.debug("Displacement nonhostile endpoint grace expired", {
      subjectUuid,
      displacementId: entry.displacementId,
      restoredPosition: entry.rollbackPosition,
      completed,
      restored
    });
    if (!restored) {
      ui?.notifications?.warn?.("AE5E | Forced-movement endpoint rollback did not reach the last clear position. See console.");
    }
  }
}
