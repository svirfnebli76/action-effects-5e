import { ENVIRONMENT_FLAG_KEY, ENVIRONMENT_SCHEMA_VERSION, MODULE_ID } from "../core/constants.js";
import { duplicateSafely, nowIso, randomId } from "../core/utils.js";

function stableShapeKey(shape) {
  const normalized = { ...shape };
  delete normalized._id;
  return JSON.stringify(normalized);
}

/** Applies all reactions for one Region in one Foundry document update. */
export class EnvironmentMutationService {
  #stats = { regionUpdates: 0, stateWrites: 0, holeAdds: 0, timerWrites: 0, timerCancels: 0, noops: 0, errors: 0 };

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
        if (existingShapeKeys.has(key)) continue;
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
    if (stateChanged || timerChanged) update[`flags.${MODULE_ID}.${ENVIRONMENT_FLAG_KEY}`] = environment;
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
