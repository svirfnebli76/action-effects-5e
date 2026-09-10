import { HOOKS, OPERATION_METADATA_KEY } from "../core/constants.js";
import { Logger } from "../core/logger.js";
import { randomId } from "../core/utils.js";

const SOURCE_TRANSFORM_FIELDS = Object.freeze(["x", "y", "elevation", "rotation", "width", "height"]);

function asArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return [...value];
  if (typeof value.values === "function") return [...value.values()];
  return [value];
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object ?? {}, key);
}

function duplicate(value) {
  if (globalThis.foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
  if (globalThis.structuredClone) return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

/**
 * Tracks exact AE5E cell occupancy when a source Token carries a native Region.
 *
 * Native Foundry Region attachment owns broad-shell translation/rotation. AE5E's
 * Region-local cell frame follows the same source Token independently. This
 * service compares logical ACTIVE-cell occupancy before and after source Token
 * transforms so stationary Tokens can be detected as swept into/out of exact
 * cell-backed volume even when their own Token documents never move.
 *
 * The service deliberately emits a generic AE5E hook rather than fabricating a
 * native Region event. Item/persistent-area policy can decide what an enter/exit
 * means. Shared Region cell state is never rewritten per target.
 */
export class RegionCellAttachmentService {
  #cells;
  #occupancy;
  #initialized = false;
  #hookIds = [];
  #pending = new Map();
  #stats = {
    snapshots: 0,
    comparisons: 0,
    sourceUpdatesObserved: 0,
    regionsObserved: 0,
    tokenEvaluations: 0,
    transitions: 0,
    entered: 0,
    exited: 0,
    staleSnapshots: 0,
    sourceDeletes: 0,
    regionDeletes: 0,
    errors: 0,
    lastTransition: null
  };

  constructor({ cells, occupancy }) {
    this.#cells = cells;
    this.#occupancy = occupancy;
  }

  initialize() {
    if (this.#initialized || !globalThis.Hooks?.on) return;
    this.#initialized = true;
    this.#hookIds.push(["preUpdateToken", Hooks.on("preUpdateToken", this.#onPreUpdateToken.bind(this))]);
    this.#hookIds.push(["updateToken", Hooks.on("updateToken", this.#onUpdateToken.bind(this))]);
    this.#hookIds.push(["deleteToken", Hooks.on("deleteToken", this.#onDeleteToken.bind(this))]);
    this.#hookIds.push(["deleteRegion", Hooks.on("deleteRegion", this.#onDeleteRegion.bind(this))]);
    this.#hookIds.push(["canvasReady", Hooks.on("canvasReady", () => this.clearPending("canvas-ready"))]);
    Logger.info("Region cell attachment service ready.");
  }

  shutdown() {
    if (!this.#initialized) return;
    for (const [name, id] of this.#hookIds) Hooks.off?.(name, id);
    this.#hookIds = [];
    this.#initialized = false;
    this.clearPending("shutdown");
  }

  getStats() {
    return Object.freeze({
      ...this.#stats,
      initialized: this.#initialized,
      pendingSnapshots: this.#pending.size
    });
  }

  clearPending(_reason = "manual") {
    this.#pending.clear();
  }

  /** Return native-attached, cell-backed Regions whose logical frame follows source. */
  regionsForSource(source) {
    if (!source?.uuid) return [];
    const found = new Map();

    const nativeAttachments = source?.attachments?.regions;
    if (nativeAttachments != null) {
      // Foundry v14.365 exposes a readonly TokenDocument.attachments.regions set.
      // Treat it as authoritative when available.
      for (const region of asArray(nativeAttachments)) {
        if (!region?.uuid || !this.#cells.isConfigured(region)) continue;
        const config = this.#cells.getConfig(region);
        if (config?.frame?.type !== "token" || config.frame.sourceTokenUuid !== source.uuid) continue;
        found.set(region.uuid, region);
      }
    } else {
      // Compatibility path for v14 builds where attachment ownership is exposed
      // primarily on RegionDocument.attachment.token. A token-local cell frame
      // alone is never enough to impersonate a native Foundry attachment.
      for (const region of asArray(source?.parent?.regions)) {
        if (!region?.uuid || found.has(region.uuid) || !this.#cells.isConfigured(region)) continue;
        if (!this.#regionIsNativelyAttachedToSource(region, source)) continue;
        const config = this.#cells.getConfig(region);
        if (config?.frame?.type !== "token" || config.frame.sourceTokenUuid !== source.uuid) continue;
        found.set(region.uuid, region);
      }
    }

    return [...found.values()];
  }

  /** Capture logical occupancy while the source Token is still at its old transform. */
  captureSourceState(source, { tokens = null } = {}) {
    const regions = this.regionsForSource(source);
    const sceneTokens = tokens ? asArray(tokens) : asArray(source?.parent?.tokens);
    const records = [];

    for (const region of regions) {
      const tokenStates = [];
      for (const token of sceneTokens) {
        if (!token?.uuid) continue;
        try {
          const inside = this.#occupancy.testTokenAt(region, token, null, { sourceToken: source });
          tokenStates.push({ token, tokenUuid: token.uuid, inside, nativeInside: this.#nativeInside(region, token) });
          this.#stats.tokenEvaluations += 1;
        } catch (error) {
          this.#stats.errors += 1;
          tokenStates.push({ token, tokenUuid: token.uuid, inside: false, nativeInside: this.#nativeInside(region, token), error: error?.message ?? String(error) });
        }
      }
      records.push({ region, regionUuid: region.uuid, tokenStates });
    }

    this.#stats.snapshots += 1;
    this.#stats.regionsObserved += records.length;
    return {
      source,
      sourceUuid: source?.uuid ?? null,
      capturedAt: Date.now(),
      sourceTransform: this.#sourceTransform(source),
      records
    };
  }

  /** Compare a prior snapshot against the source Token's current transform. */
  compareSourceState(source, snapshot, { emit = true, sourceToken = null } = {}) {
    this.#stats.comparisons += 1;
    if (!snapshot || snapshot.sourceUuid !== source?.uuid) {
      return { compared: false, reason: "snapshot-source-mismatch", transitions: [] };
    }

    const evaluationSource = sourceToken ?? source;
    const transitions = [];
    for (const record of snapshot.records ?? []) {
      const region = record.region;
      if (!region || !this.#cells.isConfigured(region)) continue;
      for (const before of record.tokenStates ?? []) {
        const token = before.token;
        if (!token?.uuid) continue;
        try {
          const inside = this.#occupancy.testTokenAt(region, token, null, { sourceToken: evaluationSource });
          this.#stats.tokenEvaluations += 1;
          if (inside === before.inside) continue;
          const transition = {
            type: inside ? "enter" : "exit",
            sourceTokenUuid: source.uuid,
            regionUuid: region.uuid,
            tokenUuid: token.uuid,
            source,
            region,
            token,
            beforeInside: Boolean(before.inside),
            inside: Boolean(inside),
            nativeBeforeInside: before.nativeInside,
            nativeInside: this.#nativeInside(region, token),
            sourceTransformBefore: duplicate(snapshot.sourceTransform),
            sourceTransformAfter: this.#sourceTransform(evaluationSource),
            detectedBy: "region-cell-attachment"
          };
          transitions.push(transition);
          this.#stats.transitions += 1;
          if (inside) this.#stats.entered += 1;
          else this.#stats.exited += 1;
          this.#stats.lastTransition = {
            type: transition.type,
            sourceTokenUuid: transition.sourceTokenUuid,
            regionUuid: transition.regionUuid,
            tokenUuid: transition.tokenUuid
          };
          if (emit) globalThis.Hooks?.callAll?.(HOOKS.REGION_CELL_OCCUPANCY_TRANSITION, transition);
        } catch (error) {
          this.#stats.errors += 1;
          Logger.warn("Region cell attachment occupancy comparison failed.", error);
        }
      }
    }

    return {
      compared: true,
      reason: "source-transform-compared",
      sourceTokenUuid: source.uuid,
      transitions,
      sourceTransformBefore: duplicate(snapshot.sourceTransform),
      sourceTransformAfter: this.#sourceTransform(evaluationSource)
    };
  }

  #onPreUpdateToken(document, changes, options = {}, userId = null) {
    if (!this.#isToken(document) || !this.#hasSourceTransformChange(changes)) return;
    if (userId && globalThis.game?.user?.id && userId !== game.user.id) return;
    const regions = this.regionsForSource(document);
    if (!regions.length) return;

    const requestId = `${document.uuid}:${randomId(12)}`;
    const metadata = options[OPERATION_METADATA_KEY] && typeof options[OPERATION_METADATA_KEY] === "object"
      ? { ...options[OPERATION_METADATA_KEY] }
      : {};
    metadata.regionCellAttachmentRequestId = requestId;
    options[OPERATION_METADATA_KEY] = metadata;
    this.#pending.set(requestId, this.captureSourceState(document));
    this.#stats.sourceUpdatesObserved += 1;

    // Fail-safe pruning only. Successful updates remove the snapshot immediately.
    const timer = globalThis.setTimeout?.(() => {
      if (!this.#pending.has(requestId)) return;
      this.#pending.delete(requestId);
      this.#stats.staleSnapshots += 1;
    }, 10_000);
    timer?.unref?.();
  }

  #onUpdateToken(document, changes, options = {}, userId = null) {
    if (!this.#isToken(document) || !this.#hasSourceTransformChange(changes)) return;
    if (userId && globalThis.game?.user?.id && userId !== game.user.id) return;
    const requestId = options?.[OPERATION_METADATA_KEY]?.regionCellAttachmentRequestId ?? null;
    if (!requestId) return;
    const snapshot = this.#pending.get(requestId);
    if (!snapshot) return;
    this.#pending.delete(requestId);
    const sourceToken = this.#sourceWithPendingChanges(document, snapshot, changes);
    this.compareSourceState(document, snapshot, { emit: true, sourceToken });
  }

  #onDeleteToken(document) {
    if (!this.#isToken(document)) return;
    this.#stats.sourceDeletes += 1;
    for (const [key, snapshot] of this.#pending.entries()) {
      if (snapshot?.sourceUuid === document.uuid) this.#pending.delete(key);
    }
  }

  #onDeleteRegion(region) {
    if (!region?.uuid) return;
    this.#stats.regionDeletes += 1;
    for (const [key, snapshot] of this.#pending.entries()) {
      snapshot.records = (snapshot.records ?? []).filter(record => record?.regionUuid !== region.uuid);
      if (!snapshot.records.length) this.#pending.delete(key);
    }
  }

  #hasSourceTransformChange(changes) {
    return SOURCE_TRANSFORM_FIELDS.some(field => hasOwn(changes, field));
  }

  #sourceTransform(source) {
    return {
      x: Number(source?.x ?? source?._source?.x ?? 0),
      y: Number(source?.y ?? source?._source?.y ?? 0),
      elevation: Number(source?.elevation ?? source?._source?.elevation ?? 0),
      rotation: Number(source?.rotation ?? source?._source?.rotation ?? 0),
      width: Number(source?.width ?? source?._source?.width ?? 1),
      height: Number(source?.height ?? source?._source?.height ?? 1)
    };
  }

  #sourceWithPendingChanges(source, snapshot, changes) {
    const before = snapshot?.sourceTransform ?? this.#sourceTransform(source);
    return {
      uuid: source?.uuid ?? snapshot?.sourceUuid ?? null,
      id: source?.id ?? null,
      documentName: source?.documentName ?? "Token",
      parent: source?.parent ?? null,
      x: hasOwn(changes, "x") ? Number(changes.x) : before.x,
      y: hasOwn(changes, "y") ? Number(changes.y) : before.y,
      elevation: hasOwn(changes, "elevation") ? Number(changes.elevation) : before.elevation,
      rotation: hasOwn(changes, "rotation") ? Number(changes.rotation) : before.rotation,
      width: hasOwn(changes, "width") ? Number(changes.width) : before.width,
      height: hasOwn(changes, "height") ? Number(changes.height) : before.height
    };
  }

  #regionIsNativelyAttachedToSource(region, source) {
    const candidate = region?.attachment?.token
      ?? region?._source?.attachment?.token
      ?? region?.attachedToken
      ?? null;
    if (!candidate || !source?.uuid) return false;
    if (typeof candidate === "string") {
      return candidate === source.id || candidate === source.uuid;
    }
    return candidate === source
      || candidate?.uuid === source.uuid
      || (candidate?.id && candidate.id === source.id);
  }

  #nativeInside(region, token) {
    try {
      if (token?.regions?.has) return token.regions.has(region);
      if (region?.tokens?.has) return region.tokens.has(token);
    } catch { /* diagnostic only */ }
    return null;
  }

  #isToken(document) {
    const TokenDocument = globalThis.foundry?.documents?.TokenDocument;
    if (TokenDocument && document instanceof TokenDocument) return true;
    return document?.documentName === "Token" || String(document?.uuid ?? "").includes(".Token.");
  }
}
