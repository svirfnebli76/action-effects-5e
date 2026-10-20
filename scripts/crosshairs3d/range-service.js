import { clamp, distance3, finiteNumber } from "./geometry-utils.js";

export const CROSSHAIR_RANGE_METRICS = Object.freeze({ GRID: "grid", EUCLIDEAN: "euclidean" });
function measuredDistance(a, b, metric = "euclidean") {
  if (metric === "euclidean") return distance3(a, b);
  if (metric === "grid") return Math.max(
    Math.abs(finiteNumber(a?.x) - finiteNumber(b?.x)),
    Math.abs(finiteNumber(a?.y) - finiteNumber(b?.y)),
    Math.abs(finiteNumber(a?.z ?? a?.elevation) - finiteNumber(b?.z ?? b?.elevation))
  );
  throw new TypeError(`Unsupported 3D range metric: ${String(metric)}`);
}
export class Crosshair3dRangeService {
  distanceBetweenPoints(a, b, metric = "euclidean") {
    return measuredDistance(a, b, metric);
  }

  nearestPointOnVolume(volume, point) {
    if (!volume) throw new TypeError("Source volume is required.");
    return {
      x: clamp(finiteNumber(point?.x), volume.minX, volume.maxX),
      y: clamp(finiteNumber(point?.y), volume.minY, volume.maxY),
      z: clamp(finiteNumber(point?.z ?? point?.elevation), volume.bottom, volume.top)
    };
  }

  distanceFromVolumeToPoint(volume, point, metric = "euclidean") {
    return measuredDistance(this.nearestPointOnVolume(volume, point), {
      x: finiteNumber(point?.x),
      y: finiteNumber(point?.y),
      z: finiteNumber(point?.z ?? point?.elevation)
    }, metric);
  }

  nearestCornerOnVolume(volume, point, metric = "euclidean") {
    if (!volume) throw new TypeError("Source volume is required.");
    const target = {
      x: finiteNumber(point?.x),
      y: finiteNumber(point?.y),
      z: finiteNumber(point?.z ?? point?.elevation)
    };
    const corners = [];
    for (const z of [volume.bottom, volume.top]) {
      for (const y of [volume.minY, volume.maxY]) {
        for (const x of [volume.minX, volume.maxX]) corners.push({ x, y, z });
      }
    }
    return corners.reduce((best, corner) => {
      const distance = measuredDistance(corner, target, metric);
      return !best || distance < best.distance ? { ...corner, distance } : best;
    }, null);
  }

  distanceFromVolumeCornerToPoint(volume, point, metric = "euclidean") {
    return this.nearestCornerOnVolume(volume, point, metric).distance;
  }

  clampPointFromOrigin(origin, requested, maxDistance, metric = "euclidean") {
    const limit = Math.max(0, finiteNumber(maxDistance));
    const distance = measuredDistance(origin, requested, metric);
    if (distance <= limit || distance === 0) return { ...requested, distance, clamped: false };
    const factor = limit / distance;
    return {
      x: origin.x + ((requested.x - origin.x) * factor),
      y: origin.y + ((requested.y - origin.y) * factor),
      z: origin.z + ((requested.z - origin.z) * factor),
      distance: limit,
      requestedDistance: distance,
      clamped: true
    };
  }
}
