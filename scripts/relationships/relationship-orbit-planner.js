import { RelationshipGeometryService } from "./relationship-geometry-service.js";

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nearlyEqual(a, b, tolerance) {
  return Math.abs(Number(a) - Number(b)) <= tolerance;
}

/**
 * Thin orbit-planning facade retained so the rotation service and external
 * consumers do not need to know how the geometry layer enumerates footprints.
 * v0.3.23 changes the atomic orbit unit from a fixed 45-degree quantum to one
 * adjacent legal shell position. The corresponding leader angle is derived
 * from the actual bearing change between those two positions.
 */
export class RelationshipOrbitPlanner {
  static getSlot({ leader, follower, grid, relationship = null, scene = null }) {
    const resolvedScene = scene ?? leader?.parent ?? { grid };
    const shell = RelationshipGeometryService.generateOrbitShell({
      scene: resolvedScene,
      leader,
      follower,
      relationship
    });
    const current = RelationshipGeometryService.findOrbitPosition({ shell, follower });
    if (!current || current.approximate === true) {
      throw new Error("The follower is not on the relationship's current orbit shell.");
    }
    return { ...current, shellSize: shell.length };
  }

  static buildStep({ scene = null, leader, follower, grid = null, relationship = null, direction }) {
    const resolvedScene = scene ?? leader?.parent ?? { grid };
    return RelationshipGeometryService.planOrbitStep({
      scene: resolvedScene,
      leader,
      follower,
      relationship,
      direction
    });
  }

  static buildWaypoints({ scene = null, leader, follower, grid = null, relationship = null, direction, steps = 1 }) {
    const count = Math.trunc(Math.abs(Number(steps)));
    const sign = Math.sign(Number(direction));
    if (!sign) throw new Error("Relationship orbit direction must be +1 or -1.");
    if (!(count >= 1)) throw new Error("Relationship orbit requires at least one shell step.");

    const resolvedScene = scene ?? leader?.parent ?? { grid };
    let virtualFollower = {
      x: Number(follower.x),
      y: Number(follower.y),
      elevation: finiteNumber(follower.elevation, 0),
      width: finiteNumber(follower.width, 1),
      height: finiteNumber(follower.height, 1)
    };
    const waypoints = [];
    for (let index = 0; index < count; index += 1) {
      const plan = RelationshipGeometryService.planOrbitStep({
        scene: resolvedScene,
        leader,
        follower: virtualFollower,
        relationship,
        direction: sign
      });
      const waypoint = {
        x: plan.target.x,
        y: plan.target.y,
        elevation: finiteNumber(follower.elevation, 0),
        checkpoint: true,
        explicit: true
      };
      waypoints.push(waypoint);
      virtualFollower = { ...virtualFollower, ...waypoint };
    }
    return waypoints;
  }

  static normalizeRotation(value) {
    return RelationshipGeometryService.normalizeRotation(value);
  }

  static signedRotationDelta(before, after) {
    return RelationshipGeometryService.signedRotationDelta(before, after);
  }

  static positionsEqual(a, b, tolerance = 0.01) {
    return nearlyEqual(a?.x, b?.x, tolerance)
      && nearlyEqual(a?.y, b?.y, tolerance)
      && nearlyEqual(finiteNumber(a?.elevation, 0), finiteNumber(b?.elevation, 0), tolerance);
  }
}
