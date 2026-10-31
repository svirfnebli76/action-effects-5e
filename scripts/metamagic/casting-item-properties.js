// Generic casting-local Item property validation for D&D5e spells.
// Option Items decide which components to omit; this bridge only constrains
// and verifies modifications to a detached spell's component-property list.
const COMPONENTS = new Set(["vocal", "somatic", "material"]);
const DERIVED_MAGIC = "mgc";

function entries(value) {
  if (Array.isArray(value)) return [...value];
  if (value instanceof Set) return [...value];
  return null;
}

function valid(entries) {
  return Array.isArray(entries)
    && entries.every(key => typeof key === "string" && Boolean(key.trim()))
    && new Set(entries).size === entries.length;
}

function sameSet(value, expected) {
  const actual = entries(value);
  return valid(actual) && actual.length === expected.length
    && actual.every(key => expected.includes(key));
}

/** Validate an option's proposed casting-local spell property update. */
export function validateSpellPropertyUpdate(sourceItem, proposed) {
  if (sourceItem?.type !== "spell") throw new Error("Spell component updates require an original spell Item.");
  const original = entries(sourceItem._source?.system?.properties
    ?? sourceItem.toObject?.()?.system?.properties
    ?? sourceItem.system?.properties);
  if (!valid(original) || !valid(proposed)) {
    throw new Error("Spell component updates require unique property identifiers in valid arrays.");
  }
  const requested = new Set(proposed);
  if (proposed.some(key => !original.includes(key))) {
    throw new Error("Casting-local spell property updates cannot add properties.");
  }
  if (original.some(key => !requested.has(key) && !COMPONENTS.has(key))) {
    throw new Error("Casting-local spell property updates may only remove component properties.");
  }
  if (JSON.stringify(original.filter(key => requested.has(key))) !== JSON.stringify(proposed)) {
    throw new Error("Casting-local spell property updates must preserve original property order.");
  }
  return true;
}

/** Compare persisted source and prepared Set, allowing only D&D5e's derived mgc. */
export function spellPropertyUpdateMatches(item, expected) {
  if (!valid(expected)) return false;
  const raw = item?._source?.system?.properties;
  if (raw !== undefined && !sameSet(raw, expected)) return false;
  const live = entries(item?.system?.properties);
  if (!valid(live)) return false;
  const effective = live.filter(key => key !== DERIVED_MAGIC || expected.includes(key));
  return sameSet(effective, expected);
}
