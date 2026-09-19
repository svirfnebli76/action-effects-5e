/** Free-line interaction points are bottom-center; geometry origins remain starts. */
export function freeLineEndpoints(state) {
  const angle = state.yaw * Math.PI / 180;
  const dx = Math.cos(angle) * state.length / 2;
  const dy = Math.sin(angle) * state.length / 2;
  return [
    { x: state.point.x - dx, y: state.point.y - dy, z: state.point.z },
    { x: state.point.x + dx, y: state.point.y + dy, z: state.point.z }
  ];
}

export function freeLineRangePoints(state, policy) {
  if (policy === "center") return [state.point];
  const ends = freeLineEndpoints(state);
  return policy === "origin" ? [ends[0]] : ends;
}

export function freeLineWithinRange(state, volume, max, policy, range) {
  return freeLineRangePoints(state, policy).every(point => range.distanceFromVolumeToPoint(volume, point) <= max + 1e-8);
}

/** Stop at the first invalid portion of a manipulation, preserving center for yaw/length. */
export function constrainFreeLineChange(from, to, valid, yawDelta = 0) {
  const at = t => ({ ...to,
    point: Object.fromEntries(["x", "y", "z"].map(axis => [axis, from.point[axis] + (to.point[axis] - from.point[axis]) * t])),
    yaw: from.yaw + yawDelta * t,
    length: from.length + (to.length - from.length) * t
  });
  let low = 0;
  const samples = Math.max(1, Math.ceil(Math.abs(yawDelta)));
  for (let i = 1; i <= samples; i++) {
    const highSample = i / samples;
    if (valid(at(highSample))) { low = highSample; continue; }
    let high = highSample;
    for (let j = 0; j < 32; j++) {
      const mid = (low + high) / 2;
      if (valid(at(mid))) low = mid; else high = mid;
    }
    return at(low);
  }
  return at(1);
}

/** Horizontal slice of Euclidean range around the occupied source cuboid. */
export function freeLineRangeBoundary(volume, max, z) {
  const dz = Math.max(volume.bottom - z, 0, z - volume.top);
  if (dz > max) return [];
  const radius = Math.sqrt(Math.max(0, max * max - dz * dz));
  const points = [];
  const corners = [[volume.maxX, volume.maxY, 0], [volume.minX, volume.maxY, 90],
    [volume.minX, volume.minY, 180], [volume.maxX, volume.minY, 270]];
  for (const [x, y, start] of corners) {
    for (let i = 0; i <= 32; i++) {
      const a = (start + i * 90 / 32) * Math.PI / 180;
      points.push({ x: x + radius * Math.cos(a), y: y + radius * Math.sin(a), z });
    }
  }
  return points;
}
