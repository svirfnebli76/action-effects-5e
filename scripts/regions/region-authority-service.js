import { MODULE_ID, REGION_AUTHORITY_FLAG } from "../core/constants.js";
import { Logger } from "../core/logger.js";

function duplicate(value) {
  if (globalThis.foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
  if (globalThis.structuredClone) return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function setProperty(object, path, value) {
  if (globalThis.foundry?.utils?.setProperty) return foundry.utils.setProperty(object, path, value);
  const parts = String(path).split(".");
  const leaf = parts.pop();
  let current = object;
  for (const part of parts) current = current[part] ??= {};
  current[leaf] = value;
  return true;
}

function getProperty(object, path) {
  if (globalThis.foundry?.utils?.getProperty) return foundry.utils.getProperty(object, path);
  return String(path).split(".").reduce((value, part) => value?.[part], object);
}

function randomId() {
  if (globalThis.foundry?.utils?.randomID) return foundry.utils.randomID();
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Generic authority bridge for Scene Region documents.
 *
 * Placement/geometry remains the caller's responsibility. This service only
 * persists and removes AE5E-owned Region documents through the primary active
 * GM so Item macros do not need their own Socketlib handlers.
 */
export class RegionAuthorityService {
  #socket;
  #authority;
  #stats = {
    createRequests: 0,
    deleteRequests: 0,
    created: 0,
    deleted: 0,
    routedToGm: 0,
    errors: 0,
    lastEvent: null
  };

  constructor({ socket, authority }) {
    this.#socket = socket;
    this.#authority = authority;

    socket.register("regions.create", (payload) => this.#createAsAuthority(payload));
    socket.register("regions.delete", (payload) => this.#deleteAsAuthority(payload));
  }

  getStats() {
    return {
      ...this.#stats,
      socketReady: this.#socket.ready,
      authority: this.#authority?.getStatus?.() ?? null
    };
  }

  /**
   * Build Foundry core's native Modify Movement Cost RegionBehavior. AE5E does
   * not calculate terrain cost; it only prepares the core behavior data.
   */
  buildMovementCostBehavior({ multiplier = 1, name = "AE5E — Movement Cost" } = {}) {
    const model = globalThis.CONFIG?.RegionBehavior?.dataModels?.modifyMovementCost ?? null;
    if (!model) return { built: false, reason: "modify-movement-cost-unavailable", behavior: null };

    let fields = null;
    try { fields = model.defineSchema?.()?.difficulties?.fields ?? null; } catch { fields = null; }
    let actions = Object.keys(fields ?? {});
    if (!actions.length) {
      actions = Object.entries(globalThis.CONFIG?.Token?.movement?.actions ?? {})
        .filter(([, config]) => typeof config?.deriveTerrainDifficulty !== "function")
        .map(([action]) => action);
    }
    if (!actions.length && globalThis.CONFIG?.Token?.movement?.defaultAction) {
      actions = [String(globalThis.CONFIG.Token.movement.defaultAction)];
    }
    if (!actions.length) return { built: false, reason: "movement-actions-unavailable", behavior: null };

    const difficulty = Math.max(0, Math.min(5, Number(multiplier) || 1));
    return {
      built: true,
      behavior: {
        name: String(name ?? "AE5E — Movement Cost").trim() || "AE5E — Movement Cost",
        type: "modifyMovementCost",
        system: { difficulties: Object.fromEntries(actions.map(action => [action, difficulty])) }
      }
    };
  }

  /**
   * Create an AE5E-owned Region in a Scene through GM authority.
   * @param {object} regionData Raw Foundry Region document data.
   * @param {object} options
   * @param {Scene|string|null} options.scene Scene document or Scene UUID. Defaults to canvas.scene.
   * @param {object|null} options.metadata Optional serializable ownership/lifecycle metadata stamped on the Region.
   */
  async create(regionData, { scene = null, metadata = null } = {}) {
    this.#stats.createRequests += 1;
    const sceneUuid = this.#sceneUuid(scene);
    if (!sceneUuid) return { created: false, reason: "scene-unavailable" };
    if (!regionData || typeof regionData !== "object" || Array.isArray(regionData)) {
      return { created: false, reason: "invalid-region-data" };
    }
    if (!Array.isArray(regionData.shapes) || regionData.shapes.length === 0) {
      return { created: false, reason: "missing-shapes" };
    }

    const payload = {
      sceneUuid,
      regionData: duplicate(regionData),
      metadata: metadata && typeof metadata === "object" ? duplicate(metadata) : null,
      requestId: randomId(),
      requestedByUserId: globalThis.game?.user?.id ?? null
    };

    try {
      return await this.#executeAsAuthority("regions.create", payload, () => this.#createAsAuthority(payload));
    } catch (error) {
      this.#stats.errors += 1;
      this.#record("create-error", { sceneUuid, message: error?.message ?? String(error) });
      throw error;
    }
  }

  /**
   * Delete a Region previously created through this service.
   * Arbitrary/unowned Region deletion is intentionally rejected.
   */
  async delete(regionOrUuid) {
    this.#stats.deleteRequests += 1;
    const regionUuid = typeof regionOrUuid === "string" ? regionOrUuid : regionOrUuid?.uuid ?? null;
    if (!regionUuid || !String(regionUuid).includes(".Region.")) {
      return { deleted: false, reason: "invalid-region-uuid" };
    }

    const payload = {
      regionUuid,
      requestedByUserId: globalThis.game?.user?.id ?? null
    };

    try {
      return await this.#executeAsAuthority("regions.delete", payload, () => this.#deleteAsAuthority(payload));
    } catch (error) {
      this.#stats.errors += 1;
      this.#record("delete-error", { regionUuid, message: error?.message ?? String(error) });
      throw error;
    }
  }

  isOwned(region) {
    return Boolean(getProperty(region, `flags.${MODULE_ID}.${REGION_AUTHORITY_FLAG}`));
  }

  getOwnership(region) {
    const value = getProperty(region, `flags.${MODULE_ID}.${REGION_AUTHORITY_FLAG}`) ?? null;
    return value ? duplicate(value) : null;
  }

  async #createAsAuthority(payload) {
    this.#assertAuthority();
    const scene = await fromUuid(payload?.sceneUuid);
    if (!scene || scene.documentName !== "Scene") return { created: false, reason: "scene-unavailable" };

    const data = duplicate(payload?.regionData ?? {});
    delete data._id;
    data.name = String(data.name ?? "AE5E Region").trim() || "AE5E Region";
    setProperty(data, `flags.${MODULE_ID}.${REGION_AUTHORITY_FLAG}`, {
      requestId: payload?.requestId ?? randomId(),
      requestedByUserId: payload?.requestedByUserId ?? null,
      createdByUserId: globalThis.game?.user?.id ?? null,
      createdAt: new Date().toISOString(),
      metadata: payload?.metadata ?? null
    });

    let region = null;
    if (typeof scene.createEmbeddedDocuments === "function") {
      [region] = await scene.createEmbeddedDocuments("Region", [data], { ae5eRegionAuthority: true });
    } else {
      const RegionDocument = globalThis.CONFIG?.Region?.documentClass;
      if (!RegionDocument?.create) throw new Error("Foundry Region document creation API is unavailable.");
      region = await RegionDocument.create(data, { parent: scene, ae5eRegionAuthority: true });
    }
    if (!region) return { created: false, reason: "creation-prevented" };

    this.#stats.created += 1;
    const result = {
      created: true,
      regionUuid: region.uuid,
      regionId: region.id,
      sceneUuid: scene.uuid,
      name: region.name,
      requestId: payload?.requestId ?? null
    };
    this.#record("created", result);
    return result;
  }

  async #deleteAsAuthority(payload) {
    this.#assertAuthority();
    const region = await fromUuid(payload?.regionUuid);
    if (!region) return { deleted: false, reason: "already-absent", regionUuid: payload?.regionUuid ?? null };
    if (region.documentName !== "Region") return { deleted: false, reason: "not-a-region" };
    if (!this.isOwned(region)) return { deleted: false, reason: "not-ae5e-owned", regionUuid: region.uuid };

    const scene = region.parent;
    if (!scene?.deleteEmbeddedDocuments) return { deleted: false, reason: "scene-unavailable", regionUuid: region.uuid };
    const regionUuid = region.uuid;
    await scene.deleteEmbeddedDocuments("Region", [region.id], { ae5eRegionAuthority: true });
    this.#stats.deleted += 1;
    const result = { deleted: true, regionUuid, sceneUuid: scene.uuid };
    this.#record("deleted", result);
    return result;
  }

  async #executeAsAuthority(socketName, payload, localHandler) {
    const primary = this.#authority?.getPrimaryGm?.() ?? null;
    const fallback = [...(globalThis.game?.users ?? [])].find(user => user?.active && user?.isGM) ?? null;
    const authority = primary ?? fallback;
    if (!authority) return { created: false, deleted: false, reason: "no-active-gm" };

    if (globalThis.game?.user?.id === authority.id) return localHandler();
    this.#stats.routedToGm += 1;
    return this.#socket.executeAsUser(socketName, authority.id, payload);
  }

  #assertAuthority() {
    if (!globalThis.game?.user?.isGM) throw new Error("AE5E Region authority operation must execute on a GM client.");
    const primary = this.#authority?.getPrimaryGm?.() ?? null;
    if (primary && globalThis.game?.user?.id !== primary.id) {
      throw new Error("AE5E Region authority operation reached a non-primary GM client.");
    }
  }

  #sceneUuid(scene) {
    if (typeof scene === "string") return scene;
    if (scene?.uuid) return scene.uuid;
    return globalThis.canvas?.scene?.uuid ?? null;
  }

  #record(type, details) {
    this.#stats.lastEvent = { at: new Date().toISOString(), type, details };
    Logger.debug?.("Region authority", this.#stats.lastEvent);
  }
}
