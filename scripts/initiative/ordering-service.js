import {
  INITIATIVE_LINK_FLAG,
  INITIATIVE_LINK_SCHEMA_VERSION,
  MODULE_ID
} from "../core/constants.js";

const combatantsOf = combat => {
  const collection = combat?.combatants;
  if (!collection) return [];
  if (typeof collection.values === "function") return [...collection.values()];
  return Array.isArray(collection) ? [...collection] : [...collection];
};

const linkOf = combatant => combatant?.getFlag?.(MODULE_ID, INITIATIVE_LINK_FLAG)
  ?? combatant?.flags?.[MODULE_ID]?.[INITIATIVE_LINK_FLAG]
  ?? null;

const orderOf = link => Number.isSafeInteger(link?.order) && link.order >= 0
  ? link.order
  : Number.MAX_SAFE_INTEGER;

const comparePaths = (left, right) => {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
};

/** Pure ordering logic used by the narrow Combat comparator wrapper. */
export class InitiativeOrderingService {
  describe(combat, combatant) {
    const byId = new Map(combatantsOf(combat).map(entry => [entry.id, entry]));
    if (combatant?.id && !byId.has(combatant.id)) byId.set(combatant.id, combatant);
    const seen = new Set();
    const path = [];
    let current = combatant;
    let managed = false;

    while (current) {
      if (!current.id || seen.has(current.id)) {
        return { managed: false, valid: false, reason: "cycle", root: combatant, rootId: combatant?.id ?? null, path: [] };
      }
      seen.add(current.id);
      const link = linkOf(current);
      if (!link) {
        return {
          managed,
          valid: true,
          reason: null,
          root: current,
          rootId: current.id,
          path
        };
      }
      if (link.version !== INITIATIVE_LINK_SCHEMA_VERSION || typeof link.leaderCombatantId !== "string") {
        return { managed: false, valid: false, reason: "invalid-link", root: combatant, rootId: combatant?.id ?? null, path: [] };
      }
      const leader = byId.get(link.leaderCombatantId);
      if (!leader) {
        return { managed: false, valid: false, reason: "missing-leader", root: combatant, rootId: combatant?.id ?? null, path: [] };
      }
      managed = true;
      path.unshift(orderOf(link));
      current = leader;
    }

    return { managed: false, valid: false, reason: "missing-root", root: combatant, rootId: combatant?.id ?? null, path: [] };
  }

  compare(combat, leftCombatant, rightCombatant, nativeCompare) {
    const native = typeof nativeCompare === "function"
      ? nativeCompare
      : ((left, right) => String(left?.id ?? "").localeCompare(String(right?.id ?? "")));
    const left = this.describe(combat, leftCombatant);
    const right = this.describe(combat, rightCombatant);

    if (!left.managed && !right.managed) return native(leftCombatant, rightCombatant);
    if (left.valid && right.valid && left.rootId === right.rootId) {
      const pathComparison = comparePaths(left.path, right.path);
      if (pathComparison) return pathComparison;
      return String(leftCombatant?.id ?? "").localeCompare(String(rightCombatant?.id ?? ""));
    }

    const rootComparison = native(left.root, right.root);
    if (rootComparison) return rootComparison;
    const rootIdComparison = String(left.rootId ?? "").localeCompare(String(right.rootId ?? ""));
    if (rootIdComparison) return rootIdComparison;
    return native(leftCombatant, rightCombatant);
  }

  inspect(combat) {
    return combatantsOf(combat).map(combatant => ({
      combatantId: combatant.id,
      initiative: combatant.initiative ?? null,
      link: linkOf(combatant),
      ...this.describe(combat, combatant)
    })).map(entry => ({
      ...entry,
      root: undefined,
      rootCombatantId: entry.rootId
    }));
  }
}
