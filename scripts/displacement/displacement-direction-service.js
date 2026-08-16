import {
  DISPLACEMENT_DIRECTION_CONSTRAINTS,
  DISPLACEMENT_TYPES
} from "../core/constants.js";
import { duplicateSafely } from "../core/utils.js";

const EPSILON = 1e-6;

const SQUARE_DIRECTIONS = Object.freeze([
  Object.freeze({ key: "N", dx: 0, dy: -1 }),
  Object.freeze({ key: "NE", dx: 1, dy: -1 }),
  Object.freeze({ key: "E", dx: 1, dy: 0 }),
  Object.freeze({ key: "SE", dx: 1, dy: 1 }),
  Object.freeze({ key: "S", dx: 0, dy: 1 }),
  Object.freeze({ key: "SW", dx: -1, dy: 1 }),
  Object.freeze({ key: "W", dx: -1, dy: 0 }),
  Object.freeze({ key: "NW", dx: -1, dy: -1 })
]);

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeVector(vector) {
  const x = finiteNumber(vector?.x, 0);
  const y = finiteNumber(vector?.y, 0);
  const magnitude = Math.hypot(x, y);
  if (!(magnitude > EPSILON)) return null;
  return { x: x / magnitude, y: y / magnitude, magnitude };
}

function normalizeDirection(direction) {
  const magnitude = Math.hypot(direction.dx, direction.dy);
  return {
    ...direction,
    nx: direction.dx / magnitude,
    ny: direction.dy / magnitude
  };
}

function tokenCenter(token, gridSize) {
  const x = finiteNumber(token?.x, 0);
  const y = finiteNumber(token?.y, 0);
  const width = Math.max(EPSILON, finiteNumber(token?.width, 1)) * gridSize;
  const height = Math.max(EPSILON, finiteNumber(token?.height, 1)) * gridSize;
  return { x: x + (width / 2), y: y + (height / 2) };
}

function validateDirectionConstraint(value) {
  if (!Object.values(DISPLACEMENT_DIRECTION_CONSTRAINTS).includes(value)) {
    throw new Error(`Unsupported displacement direction constraint '${value}'.`);
  }
  return value;
}

function validateType(value) {
  if (!Object.values(DISPLACEMENT_TYPES).includes(value)) {
    throw new Error(`Unsupported displacement type '${value}'.`);
  }
  return value;
}

function validateTypeConstraintPair(type, directionConstraint) {
  const valid = type === DISPLACEMENT_TYPES.PUSH
    ? [DISPLACEMENT_DIRECTION_CONSTRAINTS.AWAY, DISPLACEMENT_DIRECTION_CONSTRAINTS.STRAIGHT_AWAY]
    : [DISPLACEMENT_DIRECTION_CONSTRAINTS.STRAIGHT_TOWARD];
  if (!valid.includes(directionConstraint)) {
    throw new Error(`Displacement type '${type}' cannot use direction constraint '${directionConstraint}'.`);
  }
}

function getGridMetrics({ scene, distance = null } = {}) {
  const gridSize = finiteNumber(scene?.grid?.size);
  const gridDistance = finiteNumber(scene?.grid?.distance);
  if (!(gridSize > 0) || !(gridDistance > 0)) {
    throw new Error("Displacement currently requires a Scene with a square grid size and positive grid distance.");
  }

  if (distance === null || distance === undefined) {
    return { gridSize, gridDistance, steps: null, requestedDistance: null };
  }

  const requestedDistance = finiteNumber(distance);
  if (!(requestedDistance > 0)) throw new Error("Displacement distance must be greater than 0.");

  const rawSteps = requestedDistance / gridDistance;
  const steps = Math.round(rawSteps);
  if (!(steps >= 1) || Math.abs(rawSteps - steps) > EPSILON) {
    throw new Error(`Displacement distance ${requestedDistance} must be a whole multiple of the Scene grid distance ${gridDistance}.`);
  }

  return { gridSize, gridDistance, steps, requestedDistance };
}

export class DisplacementDirectionService {
  get squareDirections() {
    return SQUARE_DIRECTIONS.map((entry) => ({ ...entry }));
  }

  /**
   * Calculate the semantic direction vector from the center of the Source's
   * full footprint to the center of the Target's full footprint.
   */
  getReferenceVector({ scene, sourceToken, targetToken, type, directionConstraint }) {
    validateType(type);
    validateDirectionConstraint(directionConstraint);
    validateTypeConstraintPair(type, directionConstraint);
    const gridSize = finiteNumber(scene?.grid?.size);
    if (!(gridSize > 0)) throw new Error("The active Scene does not provide a usable grid size.");

    const sourceCenter = tokenCenter(sourceToken, gridSize);
    const targetCenter = tokenCenter(targetToken, gridSize);
    const away = normalizeVector({
      x: targetCenter.x - sourceCenter.x,
      y: targetCenter.y - sourceCenter.y
    });
    if (!away) {
      throw new Error("Push/Pull direction is undefined because Source and Target footprint centers coincide.");
    }

    const toward = directionConstraint === DISPLACEMENT_DIRECTION_CONSTRAINTS.STRAIGHT_TOWARD;
    const semantic = toward
      ? { x: -away.x, y: -away.y, magnitude: away.magnitude }
      : away;

    return {
      type,
      directionConstraint,
      sourceCenter,
      targetCenter,
      awayVector: { x: away.x, y: away.y },
      semanticVector: { x: semantic.x, y: semantic.y }
    };
  }

  /**
   * Return the selectable square-grid directions for AWAY and the best-aligned
   * direction(s) for STRAIGHT_AWAY / STRAIGHT_TOWARD. Pull is intentionally
   * STRAIGHT_TOWARD-only and never exposes a free-choice TOWARD fan.
   *
   * A direction qualifies as away when its normalized movement vector has a
   * positive dot product with the semantic center-to-center vector.
   */
  getAllowedSquareDirections({ scene, sourceToken, targetToken, type, directionConstraint }) {
    validateType(type);
    validateDirectionConstraint(directionConstraint);
    validateTypeConstraintPair(type, directionConstraint);

    const reference = this.getReferenceVector({ scene, sourceToken, targetToken, type, directionConstraint });
    const semantic = reference.semanticVector;
    const scored = SQUARE_DIRECTIONS.map(normalizeDirection).map((direction) => ({
      key: direction.key,
      dx: direction.dx,
      dy: direction.dy,
      alignment: (direction.nx * semantic.x) + (direction.ny * semantic.y)
    }));

    const positive = scored.filter((direction) => direction.alignment > EPSILON);
    const straight = directionConstraint === DISPLACEMENT_DIRECTION_CONSTRAINTS.STRAIGHT_AWAY
      || directionConstraint === DISPLACEMENT_DIRECTION_CONSTRAINTS.STRAIGHT_TOWARD;

    let directions = positive;
    if (straight && positive.length) {
      const best = Math.max(...positive.map((direction) => direction.alignment));
      directions = positive.filter((direction) => Math.abs(direction.alignment - best) <= EPSILON);

      // Pull is a direct-line operation, not a destination-choice operation.
      // Exact square-grid alignment ties are resolved deterministically so the
      // puller is never shown a selector. The ordering comes from the stable
      // SQUARE_DIRECTIONS list above.
      if (type === DISPLACEMENT_TYPES.PULL && directions.length > 1) {
        directions = [directions[0]];
      }
    }

    return {
      type,
      directionConstraint,
      ...duplicateSafely(reference),
      directions: directions.map((direction) => ({ ...direction }))
    };
  }

  getStepMetrics({ scene, distance }) {
    return { ...getGridMetrics({ scene, distance }) };
  }

  /**
   * Build a discrete path whose direction may change at each grid step. This
   * is used by AWAY Push planning. The allowed direction fan is determined
   * once from the original Source/Target geometry; this method only translates
   * an already-approved sequence of direction keys into concrete waypoints.
   */
  buildPathPositions({ scene, targetToken, directionKeys = [] }) {
    if (!Array.isArray(directionKeys) || !directionKeys.length) {
      throw new Error("A displacement path requires at least one square-grid direction.");
    }

    const { gridSize, gridDistance } = getGridMetrics({ scene });
    const origin = {
      x: finiteNumber(targetToken?.x, 0),
      y: finiteNumber(targetToken?.y, 0),
      elevation: finiteNumber(targetToken?.elevation, 0)
    };

    let x = origin.x;
    let y = origin.y;
    const directions = [];
    const positions = [];

    for (let index = 0; index < directionKeys.length; index += 1) {
      const key = typeof directionKeys[index] === "string"
        ? directionKeys[index]
        : directionKeys[index]?.key;
      const known = SQUARE_DIRECTIONS.find((entry) => entry.key === key);
      if (!known) throw new Error(`Unknown displacement direction '${key ?? ""}'.`);

      x += known.dx * gridSize;
      y += known.dy * gridSize;
      directions.push({ ...known });
      positions.push({
        x,
        y,
        elevation: origin.elevation,
        step: index + 1,
        distance: (index + 1) * gridDistance,
        directionKey: known.key
      });
    }

    return {
      origin,
      directions,
      directionKeys: directions.map((direction) => direction.key),
      requestedDistance: directions.length * gridDistance,
      gridDistance,
      gridSize,
      steps: directions.length,
      positions
    };
  }

  buildStepPositions({ scene, targetToken, distance, direction }) {
    const metrics = getGridMetrics({ scene, distance });
    const known = SQUARE_DIRECTIONS.find((entry) => entry.key === direction?.key);
    if (!known) throw new Error(`Unknown displacement direction '${direction?.key ?? ""}'.`);

    const path = this.buildPathPositions({
      scene,
      targetToken,
      directionKeys: Array.from({ length: metrics.steps }, () => known.key)
    });

    return {
      ...path,
      direction: { ...known },
      requestedDistance: metrics.requestedDistance
    };
  }
}
