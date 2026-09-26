import { MODULE_ID, REGION_CELL_STATES } from "../core/constants.js";
import { randomId } from "../core/utils.js";

function finiteNonnegative(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function normalizeMultiplier(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) throw new RangeError("Region-cell movement cost multiplier must be at least 1.");
  return number;
}

/**
 * Generic cell-aware movement-cost adapter.
 *
 * Foundry v14 measures square/hex movement as adjacent grid-space steps. AE5E
 * therefore classifies each complete snapped Token waypoint using the full Token
 * volume, then assigns a temporary movement-action cost wrapper only to steps
 * whose settled destination overlaps one of the caller-selected cell states.
 *
 * This deliberately does not use animation-frame swept-volume overlap and never
 * writes TokenDocument.movementHistory directly. The Item/rules layer chooses the
 * costly states and multiplier (for example ACTIVE + 2x); this service contains
 * no Item-specific meaning.
 */
export class RegionCellMovementCostService {
  #occupancy;
  #accounting;
  #stats = {
    classifiedInstructions: 0,
    classifiedWaypoints: 0,
    costlyWaypoints: 0,
    modifierRegistrations: 0,
    modifierReleases: 0,
    errors: 0,
    lastClassification: null
  };

  constructor({ occupancy, accounting }) {
    this.#occupancy = occupancy;
    this.#accounting = accounting;
  }

  getStats() {
    return { ...this.#stats };
  }

  classifyInstruction({ region, token, instruction, states = [REGION_CELL_STATES.ACTIVE] } = {}) {
    if (!region || !token || !instruction) throw new TypeError("Cell-aware movement cost requires region, token, and instruction.");
    const points = Array.isArray(instruction.waypoints) && instruction.waypoints.length
      ? instruction.waypoints
      : [instruction.destination].filter(Boolean);
    const classified = points.map((point, index) => ({
      index,
      point,
      costly: this.#occupancy.testTokenAt(region, token, point, { states }) === true
    }));
    this.#stats.classifiedInstructions += 1;
    this.#stats.classifiedWaypoints += classified.length;
    this.#stats.costlyWaypoints += classified.filter(entry => entry.costly).length;
    this.#stats.lastClassification = {
      regionUuid: region?.uuid ?? null,
      tokenUuid: token?.uuid ?? token?.document?.uuid ?? null,
      waypointCount: classified.length,
      costlyIndexes: classified.filter(entry => entry.costly).map(entry => entry.index)
    };
    return classified;
  }

  measureStep({ region, token, to, states = [REGION_CELL_STATES.ACTIVE], multiplier = 2, nativeCost = 0 } = {}) {
    const resolvedMultiplier = normalizeMultiplier(multiplier);
    const native = finiteNonnegative(nativeCost);
    const costly = this.#occupancy.testTokenAt(region, token, to, { states }) === true;
    return {
      costly,
      multiplier: resolvedMultiplier,
      nativeCost: native,
      adjustedCost: costly ? native * resolvedMultiplier : native
    };
  }

  applyToInstruction({
    region,
    token,
    instruction,
    states = [REGION_CELL_STATES.ACTIVE],
    multiplier = 2,
    id = null,
    label = "Action Effects 5E — Cell-aware movement cost"
  } = {}) {
    const resolvedMultiplier = normalizeMultiplier(multiplier);
    if (!region || !token || !instruction) throw new TypeError("Cell-aware movement cost requires region, token, and instruction.");
    if (!this.#occupancy.isCellBacked(region)) return () => {};
    const points = Array.isArray(instruction.waypoints) && instruction.waypoints.length
      ? instruction.waypoints
      : [instruction.destination].filter(Boolean);
    if (!points.length) return () => {};

    const classification = this.classifyInstruction({ region, token, instruction, states });
    if (!classification.some(entry => entry.costly)) return () => {};

    this.#accounting.ensureRegistered?.();
    const fallbackAction = globalThis.CONFIG?.Token?.movement?.defaultAction ?? "walk";
    const registrations = new Map();
    let inheritedBaseAction = fallbackAction;
    try {
      for (const entry of classification) {
        const point = entry.point;
        const explicitBaseAction = point?.action ?? inheritedBaseAction ?? fallbackAction;
        const baseAction = explicitBaseAction;
        inheritedBaseAction = baseAction;

        if (!entry.costly) {
          // Explicitly restore the underlying action after a costly step. Foundry
          // waypoints inherit actions, so leaving this undefined would leak the
          // cell-cost modifier into a subsequent GONE/INACTIVE step.
          point.action = baseAction;
          continue;
        }

        if (!registrations.has(baseAction)) {
          const logicalId = `${id ?? `${MODULE_ID}-region-cell-cost-${randomId(12)}`}-${registrations.size + 1}`;
          const slot = this.#accounting.registerFinalCostModifier(logicalId, {
            label,
            baseAction,
            canSelect: false,
            modifier: ({ nativeCost }) => finiteNonnegative(nativeCost) * resolvedMultiplier
          });
          registrations.set(baseAction, slot);
          this.#stats.modifierRegistrations += 1;
        }
        point.action = registrations.get(baseAction);
      }
    } catch (error) {
      this.#stats.errors += 1;
      for (const slot of registrations.values()) this.#accounting.unregisterFinalCostModifier(slot);
      throw error;
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const slot of registrations.values()) {
        this.#accounting.unregisterFinalCostModifier(slot);
        this.#stats.modifierReleases += 1;
      }
    };
  }
}
