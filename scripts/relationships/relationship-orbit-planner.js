const EPSILON = 1e-6;

const POSITIVE_RING = Object.freeze([
  Object.freeze({ dx: -1, dy: 0, slot: "W" }),
  Object.freeze({ dx: -1, dy: -1, slot: "NW" }),
  Object.freeze({ dx: 0, dy: -1, slot: "N" }),
  Object.freeze({ dx: 1, dy: -1, slot: "NE" }),
  Object.freeze({ dx: 1, dy: 0, slot: "E" }),
  Object.freeze({ dx: 1, dy: 1, slot: "SE" }),
  Object.freeze({ dx: 0, dy: 1, slot: "S" }),
  Object.freeze({ dx: -1, dy: 1, slot: "SW" })
]);

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function tokenSize(token, field) {
  return finiteNumber(token?.[field], 1);
}

function nearlyEqual(a, b, tolerance) {
  return Math.abs(Number(a) - Number(b)) <= tolerance;
}

export class RelationshipOrbitPlanner {
  static get ring() {
    return POSITIVE_RING;
  }

  static assertSupported({ leader, follower, grid }) {
    if (!leader || !follower) throw new Error("Relationship orbit requires a leader and follower token.");
    if (!grid || grid.isGridless === true || grid.isSquare === false) {
      throw new Error("Relationship orbit currently requires a square Scene grid.");
    }

    const size = finiteNumber(grid.size);
    if (!(size > 0)) throw new Error("Relationship orbit could not determine the Scene grid size.");

    if (Math.abs(tokenSize(leader, "width") - 1) > EPSILON || Math.abs(tokenSize(leader, "height") - 1) > EPSILON) {
      throw new Error("Relationship orbit currently supports only a 1×1 leader token.");
    }
    if (Math.abs(tokenSize(follower, "width") - 1) > EPSILON || Math.abs(tokenSize(follower, "height") - 1) > EPSILON) {
      throw new Error("Relationship orbit currently supports only a 1×1 follower token.");
    }

    return size;
  }

  static getSlot({ leader, follower, grid }) {
    const size = this.assertSupported({ leader, follower, grid });
    const tolerance = Math.max(0.5, size * 0.01);
    const dxPixels = Number(follower.x) - Number(leader.x);
    const dyPixels = Number(follower.y) - Number(leader.y);

    const index = POSITIVE_RING.findIndex(({ dx, dy }) => (
      nearlyEqual(dxPixels, dx * size, tolerance)
      && nearlyEqual(dyPixels, dy * size, tolerance)
    ));

    if (index < 0) {
      throw new Error("The follower must occupy one of the eight grid spaces adjacent to the leader before orbital rotation can begin.");
    }

    return {
      index,
      slot: POSITIVE_RING[index].slot,
      size
    };
  }

  static buildWaypoints({ leader, follower, grid, direction, steps = 1 }) {
    const stepDirection = Math.sign(Number(direction));
    const stepCount = Math.trunc(Math.abs(Number(steps)));
    if (!stepDirection) throw new Error("Relationship orbit direction must be +1 or -1.");
    if (!(stepCount >= 1 && stepCount <= POSITIVE_RING.length)) {
      throw new Error(`Relationship orbit supports between 1 and ${POSITIVE_RING.length} steps per rotation update.`);
    }

    const { index: startIndex, size } = this.getSlot({ leader, follower, grid });
    const elevation = finiteNumber(follower.elevation, 0);
    const waypoints = [];

    for (let step = 1; step <= stepCount; step += 1) {
      const index = (startIndex + (stepDirection * step) + POSITIVE_RING.length * 2) % POSITIVE_RING.length;
      const offset = POSITIVE_RING[index];
      waypoints.push({
        x: Math.round(Number(leader.x) + (offset.dx * size)),
        y: Math.round(Number(leader.y) + (offset.dy * size)),
        elevation,
        checkpoint: true,
        explicit: true
      });
    }

    return waypoints;
  }

  static normalizeRotation(value) {
    const number = finiteNumber(value, 0);
    return ((number % 360) + 360) % 360;
  }

  static signedRotationDelta(before, after) {
    const start = this.normalizeRotation(before);
    const end = this.normalizeRotation(after);
    let delta = ((end - start + 540) % 360) - 180;
    // Preserve a positive 180 when the raw change was positive. Wheel rotation
    // should never need this branch, but it removes the only sign ambiguity.
    if (delta === -180 && Number(after) - Number(before) > 0) delta = 180;
    return delta;
  }

  static positionsEqual(a, b, tolerance = 0.01) {
    return nearlyEqual(a?.x, b?.x, tolerance)
      && nearlyEqual(a?.y, b?.y, tolerance)
      && nearlyEqual(finiteNumber(a?.elevation, 0), finiteNumber(b?.elevation, 0), tolerance);
  }
}
