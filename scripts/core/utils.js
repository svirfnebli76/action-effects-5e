export function duplicateSafely(value) {
  if (value === undefined) return undefined;
  try {
    return foundry.utils.deepClone(value);
  } catch {
    try {
      return structuredClone(value);
    } catch {
      return JSON.parse(JSON.stringify(value));
    }
  }
}

export function randomId(length = 16) {
  return foundry.utils.randomID(length);
}

export function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

export function nowIso() {
  return new Date().toISOString();
}
