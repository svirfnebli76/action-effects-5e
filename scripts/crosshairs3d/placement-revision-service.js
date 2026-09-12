import { deepFreeze } from "./geometry-utils.js";

function clone(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object") return value;
  if (globalThis.structuredClone) return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function copyField(key, value) {
  // Live Foundry Token/Placeable references deliberately remain shallow in the
  // targets array. Freezing or structured-cloning Placeables would corrupt the
  // canvas object graph. The array itself is immutable.
  if (key === "targets") return Object.freeze([...(value ?? [])]);
  return deepFreeze(clone(value));
}

/**
 * Immutable monotonic placement revision record.
 *
 * Checkpoint 1 used requested/resolved/geometry/targets/metadata. Checkpoint 2
 * deliberately generalizes the record so the live session can also carry
 * point/yaw/pitch/shape/valid state without creating a second revision model.
 */
export class Crosshair3dPlacementRevisionService {
  create(state = {}) {
    const record = { revision: 0 };
    for (const [key, value] of Object.entries(state ?? {})) {
      if (key === "revision") continue;
      record[key] = copyField(key, value);
    }
    record.targets ??= Object.freeze([]);
    return Object.freeze(record);
  }

  revise(previous, patch = {}) {
    if (!previous || !Number.isInteger(previous.revision)) throw new TypeError("A valid placement revision is required.");
    const record = { revision: previous.revision + 1 };
    const keys = new Set([...Object.keys(previous), ...Object.keys(patch ?? {})]);
    keys.delete("revision");
    for (const key of keys) {
      const value = Object.hasOwn(patch, key) ? patch[key] : previous[key];
      record[key] = copyField(key, value);
    }
    record.targets ??= Object.freeze([]);
    return Object.freeze(record);
  }

  isCurrent(candidate, current) {
    return Number.isInteger(candidate?.revision)
      && Number.isInteger(current?.revision)
      && candidate.revision === current.revision;
  }
}
