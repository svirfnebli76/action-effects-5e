import { ENVIRONMENT_FLAG_KEY, ENVIRONMENT_SCHEMA_VERSION, MODULE_ID } from "../core/constants.js";
import { duplicateSafely, nowIso, randomId } from "../core/utils.js";

function number(value, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function stripIdentity(value) {
  if (!value || typeof value !== "object") return value;
  const copy = duplicateSafely(value);
  delete copy._id;
  delete copy.id;
  delete copy._index;
  return copy;
}

function shapeTypes() {
  const data = globalThis.foundry?.data;
  for (const model of [
    data?.RectangleShapeData,
    data?.CircleShapeData,
    data?.EllipseShapeData,
    data?.PolygonShapeData,
    data?.ConeShapeData,
    data?.BaseShapeData
  ]) {
    if (model?.TYPES) return model.TYPES;
  }
  return null;
}

function fallbackCanonicalShape(shape) {
  const raw = stripIdentity(shape?.toObject?.(false) ?? shape ?? {});
  const type = String(raw?.type ?? "").trim().toLowerCase();
  const base = { type, hole: Boolean(raw?.hole) };
  if (type === "rectangle") return {
    ...base,
    x: number(raw.x),
    y: number(raw.y),
    width: Math.abs(number(raw.width)),
    height: Math.abs(number(raw.height)),
    rotation: number(raw.rotation),
    anchorX: number(raw.anchorX),
    anchorY: number(raw.anchorY),
    gridBased: Boolean(raw.gridBased)
  };
  if (type === "circle") return {
    ...base,
    x: number(raw.x),
    y: number(raw.y),
    radius: Math.abs(number(raw.radius ?? raw.distance)),
    gridBased: Boolean(raw.gridBased)
  };
  if (type === "ellipse") return {
    ...base,
    x: number(raw.x),
    y: number(raw.y),
    radiusX: Math.abs(number(raw.radiusX)),
    radiusY: Math.abs(number(raw.radiusY)),
    rotation: number(raw.rotation),
    gridBased: Boolean(raw.gridBased)
  };
  if (type === "polygon") return {
    ...base,
    points: Array.from(raw.points ?? [], value => number(value))
  };
  if (type === "cone") return {
    ...base,
    x: number(raw.x),
    y: number(raw.y),
    radius: Math.abs(number(raw.radius ?? raw.distance)),
    angle: Math.abs(number(raw.angle, 90)),
    direction: number(raw.direction),
    gridBased: Boolean(raw.gridBased)
  };
  if (type === "ray" || type === "line") return {
    ...base,
    x: number(raw.x),
    y: number(raw.y),
    distance: Math.abs(number(raw.distance ?? raw.length)),
    width: Math.abs(number(raw.width)),
    direction: number(raw.direction),
    gridBased: Boolean(raw.gridBased)
  };
  return raw;
}

/**
 * Produce a stable semantic key for a Region shape.
 *
 * Foundry v14's Region shape DataModels clean source data by adding schema
 * defaults (for example rectangle anchor/grid fields). A profile normally
 * submits the concise source shape, while a persisted Region later returns the
 * cleaned form. Comparing raw JSON therefore mistakes the same hole for a new
 * shape. Prefer Foundry's own shape DataModel cleaner so both sides are
 * compared in the same canonical schema. The fallback keeps Node tests and
 * non-Foundry tooling deterministic.
 */
function stableShapeKey(shape) {
  const raw = stripIdentity(shape?.toObject?.(false) ?? shape ?? {});
  const type = String(raw?.type ?? "").trim().toLowerCase();
  const ShapeModel = shapeTypes()?.[type] ?? null;
  if (ShapeModel?.cleanData) {
    try {
      const cleaned = stripIdentity(ShapeModel.cleanData(duplicateSafely(raw)));
      return JSON.stringify(cleaned);
    } catch {
      // Fall through to AE5E's deterministic representation.
    }
  }
  return JSON.stringify(fallbackCanonicalShape(raw));
}

function replacement(value) {
  // Foundry v14 Document updates are partial by default. Use its supported
  // ForcedReplacement helper so deleted timer keys are actually removed from
  // TypedObject/object fields instead of being silently merged back in.
  return typeof globalThis._replace === "function" ? globalThis._replace(value) : value;
}

/** Applies all reactions for one Region in one Foundry document update. */
export class EnvironmentMutationService {
  #stats = {
    regionUpdates: 0,
    stateWrites: 0,
    holeAdds: 0,
    holeDedupes: 0,
    timerWrites: 0,
    timerCancels: 0,
    forcedFlagReplacements: 0,
    noops: 0,
    errors: 0
  };

  async apply(region, reactions, event) {
    const entries = (reactions ?? []).filter(entry => entry?.reaction?.handled !== false);
    if (!region || !entries.length) {
      this.#stats.noops += 1;
      return { updated: false, reason: "no-reactions" };
    }
    if (!globalThis.game?.user?.isGM) throw new Error("Environmental Region mutation must execute on a GM client.");

    const source = region.toObject?.(false) ?? region;
    const environment = duplicateSafely(source?.flags?.[MODULE_ID]?.[ENVIRONMENT_FLAG_KEY] ?? {});
    environment.schemaVersion = ENVIRONMENT_SCHEMA_VERSION;
    environment.states ??= {};
    environment.timers ??= {};
    let stateChanged = false;
    let timerChanged = false;
    let shapesChanged = false;
    let shapes = duplicateSafely(source?.shapes ?? []);
    const existingShapeKeys = new Set(shapes.map(stableShapeKey));

    for (const entry of entries) {
      const behaviorId = entry.behavior?.id ?? entry.behavior?._id;
      const reaction = entry.reaction ?? {};
      if (behaviorId && reaction.state && typeof reaction.state === "object") {
        const previous = environment.states[behaviorId] ?? {};
        environment.states[behaviorId] = {
          ...previous,
          ...duplicateSafely(reaction.state),
          capabilityId: entry.capability?.id ?? previous.capabilityId ?? null,
          profileId: entry.profile?.profileId ?? previous.profileId ?? null,
          updatedAt: nowIso(),
          lastEventId: event.id
        };
        stateChanged = true;
        this.#stats.stateWrites += 1;
      }

      for (const rawHole of reaction.addHoles ?? []) {
        const hole = { ...duplicateSafely(rawHole), hole: true };
        const key = stableShapeKey(hole);
        if (existingShapeKeys.has(key)) {
          this.#stats.holeDedupes += 1;
          continue;
        }
        shapes.push(hole);
        existingShapeKeys.add(key);
        shapesChanged = true;
        this.#stats.holeAdds += 1;
      }

      for (const timerId of reaction.cancelTimers ?? []) {
        const id = String(timerId ?? "").trim();
        if (!id || !(id in environment.timers)) continue;
        delete environment.timers[id];
        timerChanged = true;
        this.#stats.timerCancels += 1;
      }

      for (const rawTimer of reaction.scheduleTimers ?? []) {
        if (!rawTimer || typeof rawTimer !== "object") continue;
        const id = String(rawTimer.id ?? randomId()).trim();
        const handlerId = String(rawTimer.handlerId ?? "").trim();
        const due = rawTimer.due && typeof rawTimer.due === "object" ? duplicateSafely(rawTimer.due) : null;
        if (!id || !handlerId || !due) continue;
        environment.timers[id] = {
          id,
          handlerId,
          due,
          behaviorId: rawTimer.behaviorId ?? behaviorId ?? null,
          capabilityId: rawTimer.capabilityId ?? entry.capability?.id ?? null,
          profileId: rawTimer.profileId ?? entry.profile?.profileId ?? null,
          payload: rawTimer.payload && typeof rawTimer.payload === "object" ? duplicateSafely(rawTimer.payload) : null,
          createdAt: rawTimer.createdAt ?? nowIso(),
          lastEventId: event.id
        };
        timerChanged = true;
        this.#stats.timerWrites += 1;
      }

      if (Array.isArray(reaction.replaceShapes)) {
        shapes = duplicateSafely(reaction.replaceShapes);
        shapesChanged = true;
      }
    }

    if (!stateChanged && !timerChanged && !shapesChanged) {
      this.#stats.noops += 1;
      return { updated: false, reason: "reaction-noop" };
    }

    const update = {};
    if (stateChanged || timerChanged) {
      update[`flags.${MODULE_ID}.${ENVIRONMENT_FLAG_KEY}`] = replacement(environment);
      if (typeof globalThis._replace === "function") this.#stats.forcedFlagReplacements += 1;
    }
    if (shapesChanged) update.shapes = shapes;
    try {
      await region.update(update, {
        ae5eEnvironment: true,
        ae5eEnvironmentEventId: event.id,
        diff: true
      });
      this.#stats.regionUpdates += 1;
      return { updated: true, regionUuid: region.uuid, stateChanged, timerChanged, shapesChanged };
    } catch (error) {
      this.#stats.errors += 1;
      throw error;
    }
  }

  getState(region, behaviorOrId) {
    const id = typeof behaviorOrId === "string" ? behaviorOrId : behaviorOrId?.id ?? behaviorOrId?._id;
    if (!id) return null;
    const state = region?.flags?.[MODULE_ID]?.[ENVIRONMENT_FLAG_KEY]?.states?.[id] ?? null;
    return state ? duplicateSafely(state) : null;
  }

  getStats() {
    return Object.freeze({ ...this.#stats });
  }
}
