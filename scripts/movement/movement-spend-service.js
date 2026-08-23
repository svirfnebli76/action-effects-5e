import { duplicateSafely, randomId } from "../core/utils.js";
import { Logger } from "../core/logger.js";

const RECEIPT_VERSION = 1;
const EPSILON = 1e-6;
const SOCKET_SPEND = "movement.spend";
const SOCKET_ROLLBACK = "movement.rollbackSpend";

function finitePositive(value, label = "Movement spend") {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new TypeError(`${label} must be a finite number greater than 0.`);
  }
  return number;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cleanReason(value) {
  if (value == null) return null;
  const reason = String(value).trim();
  return reason.length ? reason.slice(0, 250) : null;
}

function tokenDocument(subject) {
  const candidate = subject?.document ?? subject;
  const TokenDocument = globalThis.foundry?.documents?.TokenDocument;
  if (TokenDocument && candidate instanceof TokenDocument) return candidate;
  if (candidate && typeof candidate === "object" && Array.isArray(candidate.movementHistory)) return candidate;
  return null;
}

function tokenUuid(subject) {
  return tokenDocument(subject)?.uuid ?? null;
}

function sameNumber(a, b) {
  return Math.abs(finiteNumber(a) - finiteNumber(b)) <= EPSILON;
}

function samePosition(a, b) {
  return sameNumber(a?.x, b?.x)
    && sameNumber(a?.y, b?.y)
    && sameNumber(a?.elevation, b?.elevation);
}

function receiptShape(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const version = Number(value.version);
  const id = String(value.id ?? "").trim();
  const movementId = String(value.movementId ?? id).trim();
  const subjectUuid = String(value.subjectUuid ?? value.tokenUuid ?? "").trim();
  const amount = Number(value.amount);
  if (version !== RECEIPT_VERSION || !id || !movementId || !subjectUuid || !Number.isFinite(amount) || amount <= 0) return null;
  return {
    version,
    id,
    movementId,
    subjectUuid,
    tokenUuid: subjectUuid,
    amount,
    reason: cleanReason(value.reason),
    requestedByUserId: value.requestedByUserId ? String(value.requestedByUserId) : null,
    createdAt: value.createdAt ? String(value.createdAt) : null,
    beforeCost: finiteNumber(value.beforeCost, 0),
    afterCost: finiteNumber(value.afterCost, finiteNumber(value.beforeCost, 0) + amount)
  };
}

function configuredDefaultAction() {
  return globalThis.CONFIG?.Token?.movement?.defaultAction ?? "walk";
}

/**
 * Authority-owned non-positional movement spending.
 *
 * Foundry v14 exposes TokenDocument.movementHistory, clearMovementHistory(),
 * movement execution, and movement rollback, but it does not expose a public
 * operation for charging movement without changing position. AE5E therefore
 * owns the narrow persistence bridge which appends one validated measured
 * waypoint to the Token's authoritative movement-history data field.
 *
 * Callers never write `_movementHistory` themselves. The public API is:
 *   await ae5e.movement.spend(token, 15, { reason: "stand-from-prone" });
 *   await ae5e.movement.rollbackSpend(receipt);
 *
 * Both operations route through the primary active GM when invoked by a
 * player. Only UUIDs, numbers, strings, and receipt data cross Socketlib.
 */
export class MovementSpendService {
  #socket;
  #accounting;
  #resolver;
  #locks = new Map();
  #stats = {
    spendRequests: 0,
    rollbackRequests: 0,
    spendsCommitted: 0,
    rollbacksCommitted: 0,
    routedToGm: 0,
    permissionDenied: 0,
    verificationFailures: 0,
    errors: 0,
    lastEvent: null
  };

  constructor({ socket, accounting, resolver = null }) {
    if (!socket) throw new TypeError("MovementSpendService requires the AE5E socket service.");
    if (!accounting) throw new TypeError("MovementSpendService requires the AE5E movement accounting service.");
    this.#socket = socket;
    this.#accounting = accounting;
    this.#resolver = resolver ?? (async (uuid) => globalThis.fromUuid?.(uuid));

    socket.register(SOCKET_SPEND, (payload) => this.#spendAsAuthority(payload));
    socket.register(SOCKET_ROLLBACK, (payload) => this.#rollbackAsAuthority(payload));
  }

  getStats() {
    return {
      ...this.#stats,
      socketReady: Boolean(this.#socket?.ready),
      socketHandlers: [SOCKET_SPEND, SOCKET_ROLLBACK],
      activeTokenLocks: this.#locks.size,
      receiptVersion: RECEIPT_VERSION
    };
  }

  async spend(subject, amount, { reason = null } = {}) {
    this.#stats.spendRequests += 1;
    const subjectUuid = tokenUuid(subject);
    if (!subjectUuid) throw new TypeError("Non-positional movement spending requires a TokenDocument or Token placeable with a UUID.");

    const normalizedAmount = finitePositive(amount);
    const payload = {
      subjectUuid,
      amount: normalizedAmount,
      reason: cleanReason(reason),
      requestedByUserId: globalThis.game?.user?.id ?? null,
      requestId: randomId(16)
    };

    try {
      if (!globalThis.game?.user?.isGM) this.#stats.routedToGm += 1;
      return await this.#socket.executeAsGM(SOCKET_SPEND, duplicateSafely(payload));
    } catch (error) {
      this.#stats.errors += 1;
      this.#record("spend-error", { subjectUuid, amount: normalizedAmount, message: error?.message ?? String(error) });
      throw error;
    }
  }

  async rollbackSpend(receipt) {
    this.#stats.rollbackRequests += 1;
    const normalized = receiptShape(receipt);
    if (!normalized) throw new TypeError("rollbackSpend requires an AE5E non-positional movement-spend receipt.");

    const payload = {
      receipt: normalized,
      requestedByUserId: globalThis.game?.user?.id ?? null
    };

    try {
      if (!globalThis.game?.user?.isGM) this.#stats.routedToGm += 1;
      return await this.#socket.executeAsGM(SOCKET_ROLLBACK, duplicateSafely(payload));
    } catch (error) {
      this.#stats.errors += 1;
      this.#record("rollback-error", { receiptId: normalized.id, subjectUuid: normalized.subjectUuid, message: error?.message ?? String(error) });
      throw error;
    }
  }

  async #spendAsAuthority(payload = {}) {
    this.#assertAuthority();
    const document = await this.#resolveToken(payload?.subjectUuid);
    this.#assertRequesterMayModify(document, payload?.requestedByUserId);
    const amount = finitePositive(payload?.amount);
    const reason = cleanReason(payload?.reason);

    return this.#withTokenLock(document.uuid, async () => {
      const beforeHistory = this.#accounting.getHistorySnapshot(document);
      const beforeCost = this.#accounting.getHistoryCost(document);
      const movementId = this.#uniqueMovementId(beforeHistory, payload?.requestId);
      const waypoint = this.#buildSpendWaypoint(document, {
        amount,
        movementId,
        userId: payload?.requestedByUserId ?? globalThis.game?.user?.id ?? ""
      });
      const nextHistory = [...beforeHistory, waypoint];

      await document.update({ _movementHistory: nextHistory }, {
        ae5eNonPositionalMovementSpend: true,
        ae5eMovementSpendId: movementId
      });

      const afterHistory = this.#accounting.getHistorySnapshot(document);
      const afterCost = this.#accounting.getHistoryCost(document);
      const committed = afterHistory.find((entry) => entry?.movementId === movementId);
      const expectedCost = beforeCost + amount;
      const verified = Boolean(committed)
        && sameNumber(committed.cost, amount)
        && samePosition(committed, document)
        && sameNumber(afterCost, expectedCost);

      if (!verified) {
        this.#stats.verificationFailures += 1;
        await this.#removeSpendWaypoint(document, movementId);
        throw new Error(
          `Foundry movement history did not record the requested ${amount} movement cost; the synthetic entry was rolled back.`
        );
      }

      const receipt = Object.freeze({
        version: RECEIPT_VERSION,
        id: movementId,
        movementId,
        subjectUuid: document.uuid,
        tokenUuid: document.uuid,
        amount,
        reason,
        requestedByUserId: payload?.requestedByUserId ?? null,
        createdAt: new Date().toISOString(),
        beforeCost,
        afterCost
      });

      this.#stats.spendsCommitted += 1;
      this.#record("spend", {
        receiptId: receipt.id,
        subjectUuid: receipt.subjectUuid,
        amount,
        beforeCost,
        afterCost,
        reason
      });
      return receipt;
    });
  }

  async #rollbackAsAuthority(payload = {}) {
    this.#assertAuthority();
    const receipt = receiptShape(payload?.receipt);
    if (!receipt) throw new TypeError("Invalid AE5E movement-spend receipt.");
    const document = await this.#resolveToken(receipt.subjectUuid);
    this.#assertRequesterMayModify(document, payload?.requestedByUserId);

    return this.#withTokenLock(document.uuid, async () => {
      const beforeHistory = this.#accounting.getHistorySnapshot(document);
      const index = beforeHistory.findIndex((entry) => entry?.movementId === receipt.movementId);
      if (index < 0) {
        return Object.freeze({
          rolledBack: false,
          reason: "receipt-not-present",
          receipt: duplicateSafely(receipt),
          beforeCost: this.#accounting.getHistoryCost(document),
          afterCost: this.#accounting.getHistoryCost(document)
        });
      }

      const target = beforeHistory[index];
      if (!sameNumber(target?.cost, receipt.amount)) {
        throw new Error("The recorded movement-spend entry no longer matches its receipt; rollback was refused.");
      }

      const beforeCost = this.#accounting.getHistoryCost(document);
      const nextHistory = beforeHistory.filter((_entry, entryIndex) => entryIndex !== index);
      await document.update({ _movementHistory: nextHistory }, {
        ae5eNonPositionalMovementRollback: true,
        ae5eMovementSpendId: receipt.movementId
      });

      const afterHistory = this.#accounting.getHistorySnapshot(document);
      const afterCost = this.#accounting.getHistoryCost(document);
      const expectedCost = Math.max(0, beforeCost - receipt.amount);
      const verified = !afterHistory.some((entry) => entry?.movementId === receipt.movementId)
        && sameNumber(afterCost, expectedCost);
      if (!verified) {
        this.#stats.verificationFailures += 1;
        throw new Error("Foundry movement history did not remove the requested movement-spend receipt cleanly.");
      }

      this.#stats.rollbacksCommitted += 1;
      this.#record("rollback", {
        receiptId: receipt.id,
        subjectUuid: receipt.subjectUuid,
        amount: receipt.amount,
        beforeCost,
        afterCost
      });
      return Object.freeze({
        rolledBack: true,
        reason: "rolled-back",
        receipt: duplicateSafely(receipt),
        beforeCost,
        afterCost
      });
    });
  }

  async #removeSpendWaypoint(document, movementId) {
    try {
      const history = this.#accounting.getHistorySnapshot(document);
      if (!history.some((entry) => entry?.movementId === movementId)) return false;
      await document.update({
        _movementHistory: history.filter((entry) => entry?.movementId !== movementId)
      }, {
        ae5eNonPositionalMovementRollback: true,
        ae5eMovementSpendId: movementId
      });
      return true;
    } catch (error) {
      Logger.error("Unable to clean up an unverified non-positional movement-spend entry.", error);
      return false;
    }
  }

  #buildSpendWaypoint(document, { amount, movementId, userId }) {
    const input = {
      x: finiteNumber(document.x, 0),
      y: finiteNumber(document.y, 0),
      elevation: finiteNumber(document.elevation, 0),
      checkpoint: true,
      explicit: false,
      snapped: false,
      action: document.movementAction ?? configuredDefaultAction()
    };

    let processed = null;
    try {
      const completed = document.getCompleteMovementPath?.([input]);
      if (Array.isArray(completed) && completed.length) processed = duplicateSafely(completed.at(-1));
    } catch (_error) {
      processed = null;
    }

    const previous = this.#accounting.getHistorySnapshot(document).at(-1) ?? {};
    const base = processed ?? {
      ...duplicateSafely(previous),
      x: input.x,
      y: input.y,
      elevation: input.elevation,
      width: finiteNumber(document.width, finiteNumber(previous.width, 1)),
      height: finiteNumber(document.height, finiteNumber(previous.height, 1)),
      depth: finiteNumber(document.depth, finiteNumber(previous.depth, 1)),
      shape: document.shape ?? previous.shape ?? globalThis.CONST?.TOKEN_SHAPES?.RECTANGLE ?? "rectangle",
      level: document.level ?? previous.level ?? "",
      action: input.action,
      checkpoint: true,
      explicit: false,
      intermediate: false,
      snapped: false,
      terrain: null
    };

    // Terrain DataModels are not socket-safe/raw update data. A non-positional
    // spend traverses no terrain, so the canonical value for this waypoint is null.
    return {
      ...base,
      x: input.x,
      y: input.y,
      elevation: input.elevation,
      action: input.action,
      checkpoint: true,
      explicit: false,
      intermediate: false,
      snapped: false,
      terrain: null,
      cost: amount,
      movementId,
      subpathId: movementId,
      userId: String(userId ?? "")
    };
  }

  #uniqueMovementId(history, preferred = null) {
    const existing = new Set((history ?? []).map((entry) => entry?.movementId).filter(Boolean));
    const preferredId = typeof preferred === "string" && /^[A-Za-z0-9]{16}$/.test(preferred) ? preferred : null;
    if (preferredId && !existing.has(preferredId)) return preferredId;
    let id;
    do id = randomId(16);
    while (existing.has(id));
    return id;
  }

  async #resolveToken(uuid) {
    if (!uuid || typeof uuid !== "string") throw new TypeError("A Token UUID is required.");
    const resolved = tokenDocument(await this.#resolver(uuid));
    if (!resolved || resolved.uuid !== uuid) throw new Error(`Unable to resolve Token '${uuid}'.`);
    if (typeof resolved.update !== "function") throw new Error(`Token '${uuid}' cannot persist movement history updates.`);
    return resolved;
  }

  #assertAuthority() {
    if (!globalThis.game?.user?.isGM) throw new Error("Non-positional movement spending must execute on an active GM client.");
  }

  #assertRequesterMayModify(document, userId) {
    const users = globalThis.game?.users;
    const requester = userId ? users?.get?.(userId) ?? null : globalThis.game?.user ?? null;
    if (!requester) {
      this.#stats.permissionDenied += 1;
      throw new Error("Unable to resolve the user requesting the movement-spend operation.");
    }
    if (requester.isGM) return;
    const ownerLevel = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
    let owns = false;
    try {
      owns = Boolean(document.testUserPermission?.(requester, ownerLevel));
    } catch (_error) {
      owns = false;
    }
    if (!owns) {
      this.#stats.permissionDenied += 1;
      throw new Error("The requesting user does not own the Token whose movement would be spent.");
    }
  }

  async #withTokenLock(subjectUuid, task) {
    const prior = this.#locks.get(subjectUuid) ?? Promise.resolve();
    const run = prior.catch(() => undefined).then(task);
    this.#locks.set(subjectUuid, run);
    try {
      return await run;
    } finally {
      if (this.#locks.get(subjectUuid) === run) this.#locks.delete(subjectUuid);
    }
  }

  #record(type, details) {
    this.#stats.lastEvent = {
      type,
      at: new Date().toISOString(),
      ...duplicateSafely(details)
    };
  }
}
