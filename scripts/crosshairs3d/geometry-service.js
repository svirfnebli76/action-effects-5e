import {
  CROSSHAIR_3D_EPSILON,
  add3,
  circleRectIntersectionArea,
  clipPolygonToRect,
  convexHull,
  cross3,
  deepFreeze,
  degreesToRadians,
  directionFromYawPitch,
  dot3,
  finiteNumber,
  normalize3,
  normalizeDegrees,
  polygonArea,
  scale3,
  subtract3,
  zeroRollBasis
} from "./geometry-utils.js";

export const CROSSHAIR_3D_SHAPES = Object.freeze({
  PRISM: "prism",
  CYLINDER: "cylinder",
  SPHERE: "sphere",
  CONE: "cone",
  LINE: "line",
  FREE_LINE: "free-line"
});

const SHAPE_ALIASES = Object.freeze({
  cube: CROSSHAIR_3D_SHAPES.PRISM,
  rect: CROSSHAIR_3D_SHAPES.PRISM,
  rectangle: CROSSHAIR_3D_SHAPES.PRISM,
  prism: CROSSHAIR_3D_SHAPES.PRISM,
  cylinder: CROSSHAIR_3D_SHAPES.CYLINDER,
  circle: CROSSHAIR_3D_SHAPES.CYLINDER,
  sphere: CROSSHAIR_3D_SHAPES.SPHERE,
  cone: CROSSHAIR_3D_SHAPES.CONE,
  line: CROSSHAIR_3D_SHAPES.LINE,
  "free-line": CROSSHAIR_3D_SHAPES.FREE_LINE
});

function positive(value, label, fallback = null) {
  const number = finiteNumber(value, fallback);
  if (!(number > 0)) throw new RangeError(`${label} must be a positive number.`);
  return number;
}

function point(value = {}) {
  return {
    x: finiteNumber(value.x),
    y: finiteNumber(value.y),
    z: finiteNumber(value.z ?? value.elevation)
  };
}

function rotatedRectangle(center, width, length, yaw) {
  const halfWidth = width / 2;
  const halfLength = length / 2;
  const radians = degreesToRadians(yaw);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [
    { x: -halfLength, y: -halfWidth },
    { x: halfLength, y: -halfWidth },
    { x: halfLength, y: halfWidth },
    { x: -halfLength, y: halfWidth }
  ].map(local => ({
    x: center.x + (local.x * cos) - (local.y * sin),
    y: center.y + (local.x * sin) + (local.y * cos)
  }));
}

function aabbFromPoints(points) {
  return points.reduce((bounds, current) => ({
    minX: Math.min(bounds.minX, current.x),
    maxX: Math.max(bounds.maxX, current.x),
    minY: Math.min(bounds.minY, current.y),
    maxY: Math.max(bounds.maxY, current.y),
    minZ: Math.min(bounds.minZ, current.z),
    maxZ: Math.max(bounds.maxZ, current.z)
  }), {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY
  });
}

function lineVertices(shape) {
  const { direction, widthAxis, heightAxis } = zeroRollBasis(shape.yaw, shape.pitch);
  const half = shape.width / 2;
  const terminal = add3(shape.origin, scale3(direction, shape.length));
  const vertices = [];
  for (const center of [shape.origin, terminal]) {
    for (const a of [-1, 1]) {
      for (const b of [-1, 1]) {
        vertices.push(add3(center, add3(scale3(widthAxis, half * a), scale3(heightAxis, half * b))));
      }
    }
  }
  return vertices;
}

const PRISM_EDGES = Object.freeze([
  [0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6], [3, 7],
  [4, 5], [4, 6], [5, 7], [6, 7]
]);

function horizontalSectionOfConvexPrism(vertices, z, epsilon = CROSSHAIR_3D_EPSILON) {
  const points = [];
  const push = candidate => {
    if (!points.some(existing => Math.abs(existing.x - candidate.x) <= epsilon && Math.abs(existing.y - candidate.y) <= epsilon)) {
      points.push({ x: candidate.x, y: candidate.y });
    }
  };
  for (const [aIndex, bIndex] of PRISM_EDGES) {
    const a = vertices[aIndex];
    const b = vertices[bIndex];
    const da = a.z - z;
    const db = b.z - z;
    if (Math.abs(da) <= epsilon) push(a);
    if (Math.abs(db) <= epsilon) push(b);
    if ((da < -epsilon && db > epsilon) || (da > epsilon && db < -epsilon)) {
      const t = (z - a.z) / (b.z - a.z);
      push({
        x: a.x + ((b.x - a.x) * t),
        y: a.y + ((b.y - a.y) * t)
      });
    }
  }
  return convexHull(points, epsilon);
}

export class Crosshair3dGeometryService {
  normalizeShape(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new TypeError("Action Effects 3D Crosshairs shape must be an object.");
    }
    const requestedType = String(input.type ?? input.shape ?? "").trim().toLowerCase();
    const type = SHAPE_ALIASES[requestedType] ?? null;
    if (!type) throw new RangeError(`Unsupported Action Effects 3D Crosshairs shape '${requestedType || "(empty)"}'.`);
    const origin = point(input.origin ?? input.center ?? input.start ?? {});
    const yaw = normalizeDegrees(input.yaw ?? input.direction ?? 0);
    const pitch = Math.max(-90, Math.min(90, finiteNumber(input.pitch)));

    let normalized;
    switch (type) {
      case CROSSHAIR_3D_SHAPES.PRISM:
        normalized = {
          type,
          origin,
          width: positive(input.width ?? input.size ?? input.length, "Prism width"),
          length: positive(input.length ?? input.depth ?? input.size ?? input.width, "Prism length"),
          height: positive(input.height ?? input.size ?? input.width, "Prism height"),
          yaw
        };
        break;
      case CROSSHAIR_3D_SHAPES.CYLINDER:
        normalized = {
          type,
          origin,
          radius: positive(input.radius ?? (finiteNumber(input.diameter, 0) / 2), "Cylinder radius"),
          height: positive(input.height ?? input.depth, "Cylinder height")
        };
        break;
      case CROSSHAIR_3D_SHAPES.SPHERE:
        normalized = { type, origin, radius: positive(input.radius ?? (finiteNumber(input.diameter, 0) / 2), "Sphere radius") };
        break;
      case CROSSHAIR_3D_SHAPES.CONE:
        normalized = { type, origin, length: positive(input.length ?? input.distance, "Cone length"), yaw, pitch };
        break;
      case CROSSHAIR_3D_SHAPES.LINE:
        normalized = {
          type,
          origin,
          length: positive(input.length ?? input.distance, "Line length"),
          width: positive(input.width, "Line width"),
          yaw,
          pitch
        };
        break;
      case CROSSHAIR_3D_SHAPES.FREE_LINE:
        normalized = {
          type,
          origin,
          length: positive(input.length ?? input.distance, "Line length"),
          width: positive(input.width, "Line width"),
          height: positive(input.height ?? input.depth, "Line height"),
          yaw
        };
        break;
      default:
        throw new RangeError(`Unsupported Action Effects 3D Crosshairs shape '${type}'.`);
    }
    return deepFreeze(normalized);
  }

  direction(shapeOrYaw, pitch = 0) {
    if (typeof shapeOrYaw === "object") return directionFromYawPitch(shapeOrYaw.yaw ?? 0, shapeOrYaw.pitch ?? 0);
    return directionFromYawPitch(shapeOrYaw, pitch);
  }

  lineBasis(shapeOrYaw, pitch = 0) {
    if (typeof shapeOrYaw === "object") return zeroRollBasis(shapeOrYaw.yaw ?? 0, shapeOrYaw.pitch ?? 0);
    return zeroRollBasis(shapeOrYaw, pitch);
  }

  getBounds(shapeInput) {
    const shape = this.normalizeShape(shapeInput);
    switch (shape.type) {
      case CROSSHAIR_3D_SHAPES.PRISM: {
        const corners = rotatedRectangle(shape.origin, shape.width, shape.length, shape.yaw);
        const minX = Math.min(...corners.map(p => p.x));
        const maxX = Math.max(...corners.map(p => p.x));
        const minY = Math.min(...corners.map(p => p.y));
        const maxY = Math.max(...corners.map(p => p.y));
        return { minX, maxX, minY, maxY, minZ: shape.origin.z, maxZ: shape.origin.z + shape.height };
      }
      case CROSSHAIR_3D_SHAPES.CYLINDER:
        return {
          minX: shape.origin.x - shape.radius,
          maxX: shape.origin.x + shape.radius,
          minY: shape.origin.y - shape.radius,
          maxY: shape.origin.y + shape.radius,
          minZ: shape.origin.z,
          maxZ: shape.origin.z + shape.height
        };
      case CROSSHAIR_3D_SHAPES.SPHERE:
        return {
          minX: shape.origin.x - shape.radius,
          maxX: shape.origin.x + shape.radius,
          minY: shape.origin.y - shape.radius,
          maxY: shape.origin.y + shape.radius,
          minZ: shape.origin.z - shape.radius,
          maxZ: shape.origin.z + shape.radius
        };
      case CROSSHAIR_3D_SHAPES.CONE: {
        const direction = this.direction(shape);
        const center = add3(shape.origin, scale3(direction, shape.length));
        const radius = shape.length / 2;
        const extent = axis => radius * Math.sqrt(Math.max(0, 1 - (direction[axis] * direction[axis])));
        return {
          minX: Math.min(shape.origin.x, center.x - extent("x")),
          maxX: Math.max(shape.origin.x, center.x + extent("x")),
          minY: Math.min(shape.origin.y, center.y - extent("y")),
          maxY: Math.max(shape.origin.y, center.y + extent("y")),
          minZ: Math.min(shape.origin.z, center.z - extent("z")),
          maxZ: Math.max(shape.origin.z, center.z + extent("z"))
        };
      }
      case CROSSHAIR_3D_SHAPES.LINE:
        return aabbFromPoints(lineVertices(shape));
      case CROSSHAIR_3D_SHAPES.FREE_LINE: {
        const radians = degreesToRadians(shape.yaw);
        const direction = { x: Math.cos(radians), y: Math.sin(radians) };
        const lateral = { x: -direction.y, y: direction.x };
        const start = shape.origin;
        const end = { x: start.x + (direction.x * shape.length), y: start.y + (direction.y * shape.length), z: start.z };
        const half = shape.width / 2;
        const points = [start, end].flatMap(center => [-1, 1].map(sign => ({
          x: center.x + (lateral.x * half * sign),
          y: center.y + (lateral.y * half * sign),
          z: center.z
        })));
        const bounds = aabbFromPoints(points);
        bounds.minZ = shape.origin.z;
        bounds.maxZ = shape.origin.z + shape.height;
        return bounds;
      }
      default:
        throw new RangeError(`Unsupported shape '${shape.type}'.`);
    }
  }

  containsPoint(shapeInput, pointInput, { includeBoundary = true, epsilon = CROSSHAIR_3D_EPSILON } = {}) {
    const shape = this.normalizeShape(shapeInput);
    const p = point(pointInput);
    const compareLow = value => includeBoundary ? value >= -epsilon : value > epsilon;
    const compareHigh = (value, max) => includeBoundary ? value <= max + epsilon : value < max - epsilon;

    switch (shape.type) {
      case CROSSHAIR_3D_SHAPES.PRISM: {
        const radians = degreesToRadians(-shape.yaw);
        const dx = p.x - shape.origin.x;
        const dy = p.y - shape.origin.y;
        const localX = (dx * Math.cos(radians)) - (dy * Math.sin(radians));
        const localY = (dx * Math.sin(radians)) + (dy * Math.cos(radians));
        return Math.abs(localX) <= (shape.length / 2) + epsilon
          && Math.abs(localY) <= (shape.width / 2) + epsilon
          && compareLow(p.z - shape.origin.z)
          && compareHigh(p.z - shape.origin.z, shape.height);
      }
      case CROSSHAIR_3D_SHAPES.CYLINDER: {
        const dx = p.x - shape.origin.x;
        const dy = p.y - shape.origin.y;
        return (dx * dx) + (dy * dy) <= (shape.radius * shape.radius) + epsilon
          && compareLow(p.z - shape.origin.z)
          && compareHigh(p.z - shape.origin.z, shape.height);
      }
      case CROSSHAIR_3D_SHAPES.SPHERE: {
        const delta = subtract3(p, shape.origin);
        return dot3(delta, delta) <= (shape.radius * shape.radius) + epsilon;
      }
      case CROSSHAIR_3D_SHAPES.CONE: {
        const direction = this.direction(shape);
        const delta = subtract3(p, shape.origin);
        const s = dot3(delta, direction);
        if (!compareLow(s) || !compareHigh(s, shape.length)) return false;
        const radialSquared = Math.max(0, dot3(delta, delta) - (s * s));
        const radius = s / 2;
        return radialSquared <= (radius * radius) + epsilon;
      }
      case CROSSHAIR_3D_SHAPES.LINE: {
        const { direction, widthAxis, heightAxis } = this.lineBasis(shape);
        const delta = subtract3(p, shape.origin);
        const s = dot3(delta, direction);
        const half = shape.width / 2;
        return compareLow(s)
          && compareHigh(s, shape.length)
          && Math.abs(dot3(delta, widthAxis)) <= half + epsilon
          && Math.abs(dot3(delta, heightAxis)) <= half + epsilon;
      }
      case CROSSHAIR_3D_SHAPES.FREE_LINE: {
        const radians = degreesToRadians(shape.yaw);
        const dx = p.x - shape.origin.x;
        const dy = p.y - shape.origin.y;
        const along = (dx * Math.cos(radians)) + (dy * Math.sin(radians));
        const lateral = (-dx * Math.sin(radians)) + (dy * Math.cos(radians));
        return compareLow(along)
          && compareHigh(along, shape.length)
          && Math.abs(lateral) <= (shape.width / 2) + epsilon
          && compareLow(p.z - shape.origin.z)
          && compareHigh(p.z - shape.origin.z, shape.height);
      }
      default:
        return false;
    }
  }

  xyCoverageAtZ(shapeInput, rect, z, options = {}) {
    const shape = this.normalizeShape(shapeInput);
    const cellArea = Math.max(0, (rect.maxX - rect.minX) * (rect.maxY - rect.minY));
    if (cellArea <= CROSSHAIR_3D_EPSILON) return 0;
    const epsilon = options.epsilon ?? CROSSHAIR_3D_EPSILON;

    if (z < this.getBounds(shape).minZ - epsilon || z > this.getBounds(shape).maxZ + epsilon) return 0;

    switch (shape.type) {
      case CROSSHAIR_3D_SHAPES.PRISM: {
        if (z < shape.origin.z - epsilon || z > shape.origin.z + shape.height + epsilon) return 0;
        const polygon = rotatedRectangle(shape.origin, shape.width, shape.length, shape.yaw);
        return polygonArea(clipPolygonToRect(polygon, rect, epsilon)) / cellArea;
      }
      case CROSSHAIR_3D_SHAPES.CYLINDER: {
        if (z < shape.origin.z - epsilon || z > shape.origin.z + shape.height + epsilon) return 0;
        return circleRectIntersectionArea({ x: shape.origin.x, y: shape.origin.y, radius: shape.radius }, rect, options) / cellArea;
      }
      case CROSSHAIR_3D_SHAPES.SPHERE: {
        const dz = z - shape.origin.z;
        if (Math.abs(dz) > shape.radius + epsilon) return 0;
        const radius = Math.sqrt(Math.max(0, (shape.radius * shape.radius) - (dz * dz)));
        if (radius <= epsilon) return 0;
        return circleRectIntersectionArea({ x: shape.origin.x, y: shape.origin.y, radius }, rect, options) / cellArea;
      }
      case CROSSHAIR_3D_SHAPES.LINE: {
        const section = horizontalSectionOfConvexPrism(lineVertices(shape), z, epsilon);
        if (section.length < 3) return 0;
        return polygonArea(clipPolygonToRect(section, rect, epsilon)) / cellArea;
      }
      case CROSSHAIR_3D_SHAPES.FREE_LINE: {
        if (z < shape.origin.z - epsilon || z > shape.origin.z + shape.height + epsilon) return 0;
        const radians = degreesToRadians(shape.yaw);
        const direction = { x: Math.cos(radians), y: Math.sin(radians) };
        const center = {
          x: shape.origin.x + (direction.x * shape.length / 2),
          y: shape.origin.y + (direction.y * shape.length / 2)
        };
        const polygon = rotatedRectangle(center, shape.width, shape.length, shape.yaw);
        return polygonArea(clipPolygonToRect(polygon, rect, epsilon)) / cellArea;
      }
      case CROSSHAIR_3D_SHAPES.CONE:
        return this.#sampleCoverage(shape, rect, z, options);
      default:
        return 0;
    }
  }

  #sampleCoverage(shape, rect, z, options = {}) {
    const levels = options.sampleLevels ?? [12, 24, 48];
    const thresholdHint = Number.isFinite(Number(options.thresholdHint)) ? Number(options.thresholdHint) : null;
    let previous = null;
    for (const resolution of levels) {
      let inside = 0;
      const total = resolution * resolution;
      const stepX = (rect.maxX - rect.minX) / resolution;
      const stepY = (rect.maxY - rect.minY) / resolution;
      for (let ix = 0; ix < resolution; ix += 1) {
        const x = rect.minX + ((ix + 0.5) * stepX);
        for (let iy = 0; iy < resolution; iy += 1) {
          const y = rect.minY + ((iy + 0.5) * stepY);
          if (this.containsPoint(shape, { x, y, z }, { includeBoundary: true })) inside += 1;
        }
      }
      const coverage = inside / total;
      if (thresholdHint !== null && Math.abs(coverage - thresholdHint) > (2 / resolution)) return coverage;
      if (previous !== null && Math.abs(previous - coverage) <= (1 / total)) return coverage;
      previous = coverage;
    }
    return previous ?? 0;
  }
}
