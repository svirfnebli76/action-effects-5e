import {
  ATTACHMENT_MODES,
  MOVEMENT_AGENCIES,
  MOVEMENT_RESOURCES,
  PATH_TYPES,
  RELATIONSHIP_MOVEMENT_COST_POLICIES,
  RELATIONSHIP_TYPES
} from "../core/constants.js";

const EPSILON = 1e-6;

function finiteNonnegative(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

/**
 * Central relationship movement-cost policy.
 *
 * Grapple gameplay in AE5E intentionally distinguishes translation from orbit:
 * - voluntary leader translation while carrying a grapple follower costs 2x
 *   the leader's normal Foundry/D&D5e movement cost;
 * - one follower orbit step spends normal measured movement on the leader;
 * - follower/passenger movement itself remains no-cost;
 * - forced, administrative, teleport, and non-movement-resource operations do
 *   not receive the grapple surcharge.
 */
export class RelationshipMovementCostPolicy {
  static resolvePolicy(relationship = {}) {
    if (Object.values(RELATIONSHIP_MOVEMENT_COST_POLICIES).includes(relationship?.movementCostPolicy)) {
      return relationship.movementCostPolicy;
    }
    return this.isGrappleLike(relationship)
      ? RELATIONSHIP_MOVEMENT_COST_POLICIES.GRAPPLE
      : RELATIONSHIP_MOVEMENT_COST_POLICIES.NONE;
  }

  static isGrappleLike(relationship = {}) {
    return relationship?.type === RELATIONSHIP_TYPES.GRAPPLE
      || relationship?.attachmentMode === ATTACHMENT_MODES.GRAPPLE_FOLLOWER;
  }

  static usesGrappleCosts(relationship = {}) {
    return this.resolvePolicy(relationship) === RELATIONSHIP_MOVEMENT_COST_POLICIES.GRAPPLE;
  }

  static shouldDoubleLeaderDrag({ relationships = [], pathType, agency, resource } = {}) {
    return pathType === PATH_TYPES.TRAVERSE
      && agency === MOVEMENT_AGENCIES.VOLUNTARY
      && resource === MOVEMENT_RESOURCES.MOVEMENT
      && relationships.some((relationship) => this.usesGrappleCosts(relationship));
  }

  static leaderDragMultiplier(options = {}) {
    return this.shouldDoubleLeaderDrag(options) ? 2 : 1;
  }

  static shouldChargeOrbit(relationship = {}) {
    return this.usesGrappleCosts(relationship);
  }

  static measureOrbitCost({ scene, follower, from = null, to = null } = {}) {
    const grid = scene?.grid;
    if (!grid || !follower || !to) return 0;

    const start = from ?? follower;
    const sizeX = finiteNonnegative(grid.sizeX ?? grid.size, 0);
    const sizeY = finiteNonnegative(grid.sizeY ?? grid.size, 0);
    const width = Math.max(finiteNonnegative(follower.width, 1), EPSILON);
    const height = Math.max(finiteNonnegative(follower.height, 1), EPSILON);
    const elevationBefore = Number.isFinite(Number(start?.elevation)) ? Number(start.elevation) : Number(follower.elevation ?? 0);
    const elevationAfter = Number.isFinite(Number(to?.elevation)) ? Number(to.elevation) : Number(follower.elevation ?? 0);

    const centerOffsetX = sizeX > 0 ? (width * sizeX / 2) : 0;
    const centerOffsetY = sizeY > 0 ? (height * sizeY / 2) : 0;
    const a = {
      x: Number(start?.x ?? follower.x ?? 0) + centerOffsetX,
      y: Number(start?.y ?? follower.y ?? 0) + centerOffsetY,
      elevation: elevationBefore
    };
    const b = {
      x: Number(to?.x ?? follower.x ?? 0) + centerOffsetX,
      y: Number(to?.y ?? follower.y ?? 0) + centerOffsetY,
      elevation: elevationAfter
    };

    try {
      const measured = Number(grid.measurePath?.([a, b])?.distance);
      if (Number.isFinite(measured) && measured >= 0) return measured;
    } catch (_error) {
      // Fall through to a conservative grid-distance fallback.
    }

    const pixels = Number(grid.size ?? grid.sizeX ?? 0);
    const distance = Number(grid.distance ?? 0);
    if (!(pixels > 0) || !(distance > 0)) return 0;
    const dx = Math.abs(b.x - a.x) / pixels * distance;
    const dy = Math.abs(b.y - a.y) / pixels * distance;
    const dz = Math.abs(b.elevation - a.elevation);
    return Math.max(dx, dy, dz);
  }
}
