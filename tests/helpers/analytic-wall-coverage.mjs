// Independent analytic oracle for infinite-height wall segments at x=wallX.
// Only fixtures wholly behind that plane are supported. No production geometry
// or propagation code is used to calculate the shadow intersection area.
function clip(polygon, signedDistance) {
  const out = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const da = signedDistance(a), db = signedDistance(b);
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

function area(polygon) {
  return Math.abs(polygon.reduce((sum, a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    return sum + a.x * b.y - b.x * a.y;
  }, 0)) / 2;
}

export function wallCoverage({ world, origin }, wallX, intervals) {
  if (!(wallX > origin.x)) throw new Error("Fixture wall must be right of the origin.");
  const rect = [{ x: world.minX, y: world.minY }, { x: world.maxX, y: world.minY },
    { x: world.maxX, y: world.maxY }, { x: world.minX, y: world.maxY }];
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i][0] < sorted[i - 1][1]) throw new Error("Fixture intervals must not overlap.");
  }
  let blockedArea = 0;
  for (const [low, high] of sorted) {
    if (!(high > low)) throw new Error("Invalid wall interval.");
    const lowSlope = (low - origin.y) / (wallX - origin.x);
    const highSlope = (high - origin.y) / (wallX - origin.x);
    let shadow = clip(rect, p => p.x - wallX);
    shadow = clip(shadow, p => p.y - origin.y - lowSlope * (p.x - origin.x));
    shadow = clip(shadow, p => highSlope * (p.x - origin.x) - (p.y - origin.y));
    blockedArea += area(shadow);
  }
  return Math.max(0, Math.min(1, 1 - blockedArea / area(rect)));
}
