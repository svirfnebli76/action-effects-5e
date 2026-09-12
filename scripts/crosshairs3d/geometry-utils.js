export const CROSSHAIR_3D_EPSILON = 1e-7;

export function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function degreesToRadians(value) {
  return finiteNumber(value) * Math.PI / 180;
}

export function normalizeDegrees(value) {
  let degrees = finiteNumber(value) % 360;
  if (degrees < 0) degrees += 360;
  return degrees;
}

export function vec3(x = 0, y = 0, z = 0) {
  return { x: finiteNumber(x), y: finiteNumber(y), z: finiteNumber(z) };
}

export function add3(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function subtract3(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale3(value, scalar) {
  return { x: value.x * scalar, y: value.y * scalar, z: value.z * scalar };
}

export function dot3(a, b) {
  return (a.x * b.x) + (a.y * b.y) + (a.z * b.z);
}

export function cross3(a, b) {
  return {
    x: (a.y * b.z) - (a.z * b.y),
    y: (a.z * b.x) - (a.x * b.z),
    z: (a.x * b.y) - (a.y * b.x)
  };
}

export function magnitude3(value) {
  return Math.hypot(value.x, value.y, value.z);
}

export function normalize3(value, fallback = { x: 1, y: 0, z: 0 }) {
  const magnitude = magnitude3(value);
  if (magnitude <= CROSSHAIR_3D_EPSILON) return { ...fallback };
  return scale3(value, 1 / magnitude);
}

export function distance3(a, b) {
  return magnitude3(subtract3(a, b));
}

export function directionFromYawPitch(yaw = 0, pitch = 0) {
  const yawRadians = degreesToRadians(yaw);
  const pitchRadians = degreesToRadians(pitch);
  const horizontal = Math.cos(pitchRadians);
  return normalize3({
    x: horizontal * Math.cos(yawRadians),
    y: horizontal * Math.sin(yawRadians),
    z: Math.sin(pitchRadians)
  });
}

/**
 * Deterministic zero-roll basis for a pitched square Ray.
 * widthAxis remains horizontal and is driven by yaw. heightAxis is derived
 * from direction × widthAxis. Stored yaw therefore remains meaningful at a
 * vertical pitch rather than becoming mathematically undefined.
 */
export function zeroRollBasis(yaw = 0, pitch = 0) {
  const direction = directionFromYawPitch(yaw, pitch);
  const yawRadians = degreesToRadians(yaw);
  const widthAxis = normalize3({
    x: -Math.sin(yawRadians),
    y: Math.cos(yawRadians),
    z: 0
  }, { x: 0, y: 1, z: 0 });
  const heightAxis = normalize3(cross3(direction, widthAxis), { x: 0, y: 0, z: 1 });
  return { direction, widthAxis, heightAxis };
}

export function polygonArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    twiceArea += (current.x * next.y) - (next.x * current.y);
  }
  return Math.abs(twiceArea) / 2;
}

function clipPolygon(points, inside, intersect) {
  if (!points.length) return [];
  const output = [];
  let previous = points.at(-1);
  let previousInside = inside(previous);
  for (const current of points) {
    const currentInside = inside(current);
    if (currentInside) {
      if (!previousInside) output.push(intersect(previous, current));
      output.push(current);
    } else if (previousInside) {
      output.push(intersect(previous, current));
    }
    previous = current;
    previousInside = currentInside;
  }
  return output;
}

export function clipPolygonToRect(points, rect, epsilon = CROSSHAIR_3D_EPSILON) {
  const { minX, maxX, minY, maxY } = rect;
  let polygon = [...points];

  const vertical = boundary => (a, b) => {
    const dx = b.x - a.x;
    const t = Math.abs(dx) <= epsilon ? 0 : (boundary - a.x) / dx;
    return { x: boundary, y: a.y + ((b.y - a.y) * t) };
  };
  const horizontal = boundary => (a, b) => {
    const dy = b.y - a.y;
    const t = Math.abs(dy) <= epsilon ? 0 : (boundary - a.y) / dy;
    return { x: a.x + ((b.x - a.x) * t), y: boundary };
  };

  polygon = clipPolygon(polygon, p => p.x >= minX - epsilon, vertical(minX));
  polygon = clipPolygon(polygon, p => p.x <= maxX + epsilon, vertical(maxX));
  polygon = clipPolygon(polygon, p => p.y >= minY - epsilon, horizontal(minY));
  polygon = clipPolygon(polygon, p => p.y <= maxY + epsilon, horizontal(maxY));
  return polygon;
}

export function convexHull(points, epsilon = CROSSHAIR_3D_EPSILON) {
  const unique = [];
  for (const point of points ?? []) {
    if (!unique.some(existing => Math.abs(existing.x - point.x) <= epsilon && Math.abs(existing.y - point.y) <= epsilon)) {
      unique.push({ x: point.x, y: point.y });
    }
  }
  if (unique.length <= 2) return unique;
  unique.sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => ((a.x - o.x) * (b.y - o.y)) - ((a.y - o.y) * (b.x - o.x));
  const lower = [];
  for (const point of unique) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), point) <= epsilon) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (let index = unique.length - 1; index >= 0; index -= 1) {
    const point = unique[index];
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), point) <= epsilon) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

export function rectArea(rect) {
  return Math.max(0, rect.maxX - rect.minX) * Math.max(0, rect.maxY - rect.minY);
}

export function simpsonIntegrate(fn, a, b, { tolerance = 1e-8, maxDepth = 12 } = {}) {
  if (!(b > a)) return 0;
  const simpson = (left, right, fLeft, fMid, fRight) => (right - left) * (fLeft + (4 * fMid) + fRight) / 6;
  const recurse = (left, right, fLeft, fMid, fRight, estimate, depth) => {
    const mid = (left + right) / 2;
    const leftMid = (left + mid) / 2;
    const rightMid = (mid + right) / 2;
    const fLeftMid = fn(leftMid);
    const fRightMid = fn(rightMid);
    const leftEstimate = simpson(left, mid, fLeft, fLeftMid, fMid);
    const rightEstimate = simpson(mid, right, fMid, fRightMid, fRight);
    const delta = leftEstimate + rightEstimate - estimate;
    if (depth <= 0 || Math.abs(delta) <= 15 * tolerance) {
      return leftEstimate + rightEstimate + (delta / 15);
    }
    return recurse(left, mid, fLeft, fLeftMid, fMid, leftEstimate, depth - 1)
      + recurse(mid, right, fMid, fRightMid, fRight, rightEstimate, depth - 1);
  };
  const mid = (a + b) / 2;
  const fA = fn(a);
  const fMid = fn(mid);
  const fB = fn(b);
  return recurse(a, b, fA, fMid, fB, simpson(a, b, fA, fMid, fB), maxDepth);
}

export function circleRectIntersectionArea(circle, rect, options = {}) {
  const radius = Math.max(0, finiteNumber(circle.radius));
  if (radius <= CROSSHAIR_3D_EPSILON) return 0;
  const minX = Math.max(rect.minX, circle.x - radius);
  const maxX = Math.min(rect.maxX, circle.x + radius);
  if (!(maxX > minX)) return 0;
  const verticalLength = x => {
    const dx = x - circle.x;
    const inside = Math.max(0, (radius * radius) - (dx * dx));
    const half = Math.sqrt(inside);
    const low = Math.max(rect.minY, circle.y - half);
    const high = Math.min(rect.maxY, circle.y + half);
    return Math.max(0, high - low);
  };
  return simpsonIntegrate(verticalLength, minX, maxX, options);
}

export function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
