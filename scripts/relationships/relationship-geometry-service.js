import { RelationshipDistance } from "./relationship-distance.js";

const EPSILON = 1e-6;
const MAX_SHELL_POSITIONS = 2_048;

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nearlyEqual(a, b, tolerance = EPSILON) {
  return Math.abs(Number(a) - Number(b)) <= tolerance;
}

function normalizeDegrees(value) {
  const number = finiteNumber(value, 0);
  return ((number % 360) + 360) % 360;
}

function angularDistance(a, b) {
  const delta = Math.abs(normalizeDegrees(a) - normalizeDegrees(b));
  return Math.min(delta, 360 - delta);
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

/**
 * Geometry primitives shared by relationship movement, orbit planning and the
 * development harness. The service intentionally reasons from actual Token
 * width/height rather than creature-size labels so unusual or resized tokens
 * remain geometrically valid.
 */
export class RelationshipGeometryService {
  static normalizeRotation(value) {
    return normalizeDegrees(value);
  }

  static signedRotationDelta(before, after) {
    const start = normalizeDegrees(before);
    const end = normalizeDegrees(after);
    let delta = ((end - start + 540) % 360) - 180;
    if (delta === -180 && Number(after) - Number(before) > 0) delta = 180;
    return delta;
  }

  static directedBearingDelta(before, after, direction) {
    const start = normalizeDegrees(before);
    const end = normalizeDegrees(after);
    const sign = Math.sign(Number(direction));
    if (!sign) throw new Error("Orbit direction must be clockwise (+1) or counterclockwise (-1).");
    if (sign > 0) {
      const delta = positiveModulo(end - start, 360);
      return delta <= EPSILON ? 360 : delta;
    }
    const delta = positiveModulo(start - end, 360);
    return delta <= EPSILON ? -360 : -delta;
  }

  static assertSquareGrid(grid) {
    if (!grid || grid.isGridless === true || grid.isSquare === false) {
      throw new Error("Relationship orbit currently requires a square Scene grid.");
    }
    const size = finiteNumber(grid.size ?? grid.sizeX);
    const distance = finiteNumber(grid.distance);
    if (!(size > 0)) throw new Error("Relationship geometry could not determine the Scene grid size.");
    if (!(distance > 0)) throw new Error("Relationship geometry could not determine the Scene grid distance.");
    return { size, distance };
  }

  static tokenDimensions(token, grid) {
    const { size } = this.assertSquareGrid(grid);
    const widthUnits = Math.max(finiteNumber(token?.width, 1), 0.001);
    const heightUnits = Math.max(finiteNumber(token?.height, 1), 0.001);
    return {
      widthUnits,
      heightUnits,
      widthPixels: widthUnits * size,
      heightPixels: heightUnits * size
    };
  }

  static tokenBounds(token, grid, position = token) {
    const dimensions = this.tokenDimensions(token, grid);
    const x = finiteNumber(position?.x, finiteNumber(token?.x, 0));
    const y = finiteNumber(position?.y, finiteNumber(token?.y, 0));
    return {
      x,
      y,
      left: x,
      top: y,
      right: x + dimensions.widthPixels,
      bottom: y + dimensions.heightPixels,
      width: dimensions.widthPixels,
      height: dimensions.heightPixels,
      ...dimensions
    };
  }

  static tokenCenter(token, grid, position = token) {
    const bounds = this.tokenBounds(token, grid, position);
    return {
      x: bounds.left + (bounds.width / 2),
      y: bounds.top + (bounds.height / 2),
      elevation: finiteNumber(position?.elevation, finiteNumber(token?.elevation, 0))
    };
  }

  static bearingBetweenTokens({ leader, follower, grid, followerPosition = follower, leaderPosition = leader } = {}) {
    const a = this.tokenCenter(leader, grid, leaderPosition);
    const b = this.tokenCenter(follower, grid, followerPosition);
    const radians = Math.atan2(b.y - a.y, b.x - a.x);
    return normalizeDegrees(radians * 180 / Math.PI);
  }

  static boundsOverlap(a, b, tolerance = 0.01) {
    return a.left < b.right - tolerance
      && a.right > b.left + tolerance
      && a.top < b.bottom - tolerance
      && a.bottom > b.top + tolerance;
  }

  static planarDistance({ scene, leader, follower } = {}) {
    return RelationshipDistance.measurePlanar({ scene, leader, follower });
  }

  static coordinationDistance({ scene, relationship, leader, follower } = {}) {
    const configured = finiteNumber(relationship?.coordinationDistance);
    if (configured !== null && configured >= 0) return configured;
    const measured = this.planarDistance({ scene, leader, follower });
    if (Number.isFinite(measured) && measured >= 0) return measured;
    const breakDistance = finiteNumber(relationship?.breakDistance);
    if (breakDistance !== null && breakDistance >= 0) return breakDistance;
    return finiteNumber(scene?.grid?.distance, 5);
  }

  /**
   * Return a conservative anchor quantum for legal snapped candidate positions.
   * Standard 1x1+ tokens use one full grid space. Fractional token dimensions
   * (notably 0.5x0.5 Tiny tokens) opt into a fractional quantum so their real
   * Foundry anchor alignment is not discarded.
   */
  static anchorQuantum({ leader, follower, grid } = {}) {
    const { size } = this.assertSquareGrid(grid);
    const dimensions = [
      finiteNumber(leader?.width, 1),
      finiteNumber(leader?.height, 1),
      finiteNumber(follower?.width, 1),
      finiteNumber(follower?.height, 1)
    ].filter((value) => value > 0);

    let factor = 1;
    for (const value of dimensions) {
      const roundedHalf = Math.round(value * 2) / 2;
      if (!nearlyEqual(value, Math.round(value), 1e-6) && nearlyEqual(value, roundedHalf, 1e-6)) factor = Math.min(factor, 0.5);
      if (value < 1) factor = Math.min(factor, Math.max(0.25, value));
    }
    return size * factor;
  }

  static generateOrbitShell({ scene, leader, follower, relationship = null, coordinationDistance = null } = {}) {
    const grid = scene?.grid;
    const { size, distance: gridDistance } = this.assertSquareGrid(grid);
    if (!leader || !follower) throw new Error("Relationship orbit requires a leader and follower token.");

    const targetDistance = coordinationDistance ?? this.coordinationDistance({ scene, relationship, leader, follower });
    if (!Number.isFinite(Number(targetDistance)) || Number(targetDistance) < gridDistance - EPSILON) {
      throw new Error(`Relationship orbit requires a coordination distance of at least one grid distance (${gridDistance}).`);
    }

    const desiredDistance = Number(targetDistance);
    const quantum = this.anchorQuantum({ leader, follower, grid });
    const leaderBounds = this.tokenBounds(leader, grid);
    const followerBounds = this.tokenBounds(follower, grid);

    // D&D grid reach is measured between occupied spaces: adjacent token spaces
    // are 5 feet apart even though their pixel bounds touch. Therefore a 5-foot
    // coordination shell has zero empty-space gap, a 10-foot shell has one empty
    // grid space, a 15-foot shell has two, and so on. Expanding the leader by
    // that gap and the follower footprint is the rectangular Minkowski shell
    // needed for arbitrary token sizes.
    const gapPixels = Math.max(0, ((desiredDistance / gridDistance) - 1) * size);
    const westX = leaderBounds.left - gapPixels - followerBounds.width;
    const eastX = leaderBounds.right + gapPixels;
    const northY = leaderBounds.top - gapPixels - followerBounds.height;
    const southY = leaderBounds.bottom + gapPixels;

    const axisValues = (start, end) => {
      const values = [];
      const span = end - start;
      const count = Math.max(0, Math.floor((span + EPSILON) / quantum));
      if (count + 2 > MAX_SHELL_POSITIONS) throw new Error("The requested relationship orbit shell contains too many legal positions.");
      for (let index = 0; index <= count; index += 1) {
        values.push(Math.round((start + (index * quantum)) * 1e6) / 1e6);
      }
      if (!nearlyEqual(values.at(-1), end, 1e-5)) values.push(Math.round(end * 1e6) / 1e6);
      return values;
    };

    const xs = axisValues(westX, eastX);
    const ys = axisValues(northY, southY);
    const raw = [];
    // Clockwise perimeter traversal in screen coordinates: NW -> NE -> SE -> SW -> NW.
    for (const x of xs) raw.push({ x, y: northY });
    for (const y of ys.slice(1)) raw.push({ x: eastX, y });
    for (const x of xs.slice(0, -1).reverse()) raw.push({ x, y: southY });
    for (const y of ys.slice(1, -1).reverse()) raw.push({ x: westX, y });

    if (!raw.length || raw.length > MAX_SHELL_POSITIONS) {
      throw new Error("The requested relationship orbit shell contains an invalid number of positions.");
    }

    const seen = new Set();
    const positions = [];
    for (const candidate of raw) {
      const x = Math.round(Number(candidate.x) * 1e6) / 1e6;
      const y = Math.round(Number(candidate.y) * 1e6) / 1e6;
      const key = `${x}|${y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const position = { x, y, elevation: finiteNumber(follower.elevation, 0) };
      const bearing = this.bearingBetweenTokens({ leader, follower, grid, followerPosition: position });
      const leaderCenter = this.tokenCenter(leader, grid);
      const followerCenter = this.tokenCenter(follower, grid, position);
      const radiusPixels = Math.hypot(followerCenter.x - leaderCenter.x, followerCenter.y - leaderCenter.y);
      const virtualFollower = {
        x,
        y,
        elevation: position.elevation,
        width: finiteNumber(follower?.width, 1),
        height: finiteNumber(follower?.height, 1)
      };
      const measured = RelationshipDistance.measurePlanar({ scene, leader, follower: virtualFollower });
      positions.push({ ...position, bearing, radiusPixels, distance: measured });
    }

    return positions.map((position, index) => ({ ...position, index }));
  }

  static findOrbitPosition({ shell, follower, tolerance = 0.5 } = {}) {
    if (!Array.isArray(shell) || !shell.length) throw new Error("An orbit shell is required.");
    const exact = shell.find((position) => (
      nearlyEqual(position.x, follower?.x, tolerance)
      && nearlyEqual(position.y, follower?.y, tolerance)
    ));
    if (exact) return exact;

    // Off-shell positions can occur after external movement before the
    // relationship is re-anchored. Return the nearest physical candidate only
    // for diagnostics/planning; callers may still reject it as stale.
    let nearest = null;
    let nearestDistance = Infinity;
    for (const position of shell) {
      const distance = Math.hypot(Number(position.x) - Number(follower?.x ?? 0), Number(position.y) - Number(follower?.y ?? 0));
      if (distance < nearestDistance) {
        nearest = position;
        nearestDistance = distance;
      }
    }
    return nearest ? { ...nearest, approximate: true, anchorErrorPixels: nearestDistance } : null;
  }

  static planOrbitStep({ scene, leader, follower, relationship, direction } = {}) {
    const sign = Math.sign(Number(direction));
    if (!sign) throw new Error("Relationship orbit direction must be +1 or -1.");
    const coordinationDistance = this.coordinationDistance({ scene, relationship, leader, follower });
    const shell = this.generateOrbitShell({ scene, leader, follower, relationship, coordinationDistance });
    const current = this.findOrbitPosition({ shell, follower });
    if (!current || current.approximate === true) {
      throw new Error("The follower is not on the relationship's current orbit shell. Re-anchor the relationship before orbital rotation.");
    }

    const targetIndex = positiveModulo(current.index + sign, shell.length);
    const target = shell[targetIndex];
    const angularDelta = this.directedBearingDelta(current.bearing, target.bearing, sign);
    if (Math.abs(angularDelta) >= 360 - EPSILON && shell.length > 1) {
      throw new Error("The generated relationship orbit shell contains an ambiguous zero-angle step.");
    }

    return {
      direction: sign,
      coordinationDistance,
      shellSize: shell.length,
      current: { ...current },
      target: { ...target },
      angularDelta,
      shell
    };
  }

  static selectTrailingPosition({
    scene,
    leader,
    follower,
    relationship,
    leaderPosition,
    followerPosition,
    movementVector,
    coordinationDistance = null
  } = {}) {
    const grid = scene?.grid;
    this.assertSquareGrid(grid);
    const dx = finiteNumber(movementVector?.dx, 0);
    const dy = finiteNumber(movementVector?.dy, 0);
    if (Math.abs(dx) <= EPSILON && Math.abs(dy) <= EPSILON) return null;

    const virtualLeader = {
      x: finiteNumber(leaderPosition?.x, finiteNumber(leader?.x, 0)),
      y: finiteNumber(leaderPosition?.y, finiteNumber(leader?.y, 0)),
      elevation: finiteNumber(leaderPosition?.elevation, finiteNumber(leader?.elevation, 0)),
      width: finiteNumber(leader?.width, 1),
      height: finiteNumber(leader?.height, 1)
    };
    const virtualFollower = {
      x: finiteNumber(followerPosition?.x, finiteNumber(follower?.x, 0)),
      y: finiteNumber(followerPosition?.y, finiteNumber(follower?.y, 0)),
      elevation: finiteNumber(followerPosition?.elevation, finiteNumber(follower?.elevation, 0)),
      width: finiteNumber(follower?.width, 1),
      height: finiteNumber(follower?.height, 1)
    };
    const targetDistance = coordinationDistance ?? this.coordinationDistance({
      scene,
      relationship,
      leader: virtualLeader,
      follower: virtualFollower
    });
    const shell = this.generateOrbitShell({
      scene,
      leader: virtualLeader,
      follower: virtualFollower,
      relationship,
      coordinationDistance: targetDistance
    });

    const forwardBearing = normalizeDegrees(Math.atan2(dy, dx) * 180 / Math.PI);
    const rearBearing = normalizeDegrees(forwardBearing + 180);
    const followerCenter = this.tokenCenter(follower, grid, followerPosition);

    const ranked = shell.map((candidate) => {
      const center = this.tokenCenter(follower, grid, candidate);
      return {
        candidate,
        angularError: angularDistance(candidate.bearing, rearBearing),
        displacement: Math.hypot(center.x - followerCenter.x, center.y - followerCenter.y)
      };
    }).sort((a, b) => (
      a.angularError - b.angularError
      || a.displacement - b.displacement
      || a.candidate.index - b.candidate.index
    ));

    return ranked[0]?.candidate ? {
      ...ranked[0].candidate,
      desiredBearing: rearBearing,
      angularError: ranked[0].angularError
    } : null;
  }

  static validateOrbitShell({ scene, leader, follower, relationship } = {}) {
    const coordinationDistance = this.coordinationDistance({ scene, relationship, leader, follower });
    const shell = this.generateOrbitShell({ scene, leader, follower, relationship, coordinationDistance });
    const current = this.findOrbitPosition({ shell, follower });
    const checks = [];
    const record = (name, passed, details = null) => checks.push({ name, passed: Boolean(passed), details });

    const keys = shell.map((position) => `${position.x}|${position.y}`);
    record("Shell contains positions", shell.length > 0, { count: shell.length });
    record("Shell contains no duplicate anchors", new Set(keys).size === keys.length);
    record("Current follower belongs to shell", Boolean(current && current.approximate !== true), current ?? null);

    const tolerance = Math.max(1e-4, Number(scene?.grid?.distance ?? 5) * 1e-4);
    const distancesValid = shell.every((position) => !Number.isFinite(Number(position.distance)) || Number(position.distance) <= coordinationDistance + tolerance);
    record("Every shell position remains within the nominal coordination reach", distancesValid, { coordinationDistance });

    const leaderBounds = this.tokenBounds(leader, scene.grid);
    const noOverlap = shell.every((position) => !this.boundsOverlap(leaderBounds, this.tokenBounds(follower, scene.grid, position)));
    record("No shell position overlaps the leader footprint", noOverlap);

    let clockwise = 0;
    let counterclockwise = 0;
    if (shell.length > 1) {
      for (let index = 0; index < shell.length; index += 1) {
        const next = shell[(index + 1) % shell.length];
        const previous = shell[(index - 1 + shell.length) % shell.length];
        clockwise += this.directedBearingDelta(shell[index].bearing, next.bearing, 1);
        counterclockwise += this.directedBearingDelta(shell[index].bearing, previous.bearing, -1);
      }
    }
    record("Clockwise shell circuit totals 360 degrees", shell.length === 1 || nearlyEqual(clockwise, 360, 1e-4), { clockwise });
    record("Counterclockwise shell circuit totals -360 degrees", shell.length === 1 || nearlyEqual(counterclockwise, -360, 1e-4), { counterclockwise });

    const inverse = shell.length <= 1 || shell.every((position, index) => {
      const cw = shell[(index + 1) % shell.length];
      const back = shell[(cw.index - 1 + shell.length) % shell.length];
      return back.index === position.index;
    });
    record("Clockwise and counterclockwise traversal are exact inverses", inverse);

    return {
      passed: checks.every((check) => check.passed),
      coordinationDistance,
      shellSize: shell.length,
      current,
      checks,
      shell
    };
  }
}
