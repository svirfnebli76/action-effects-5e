import { clamp, distance3, finiteNumber } from "./geometry-utils.js";

export class Crosshair3dRangeService {
  distanceBetweenPoints(a, b) {
    return distance3(a, b);
  }

  nearestPointOnVolume(volume, point) {
    if (!volume) throw new TypeError("Source volume is required.");
    return {
      x: clamp(finiteNumber(point?.x), volume.minX, volume.maxX),
      y: clamp(finiteNumber(point?.y), volume.minY, volume.maxY),
      z: clamp(finiteNumber(point?.z ?? point?.elevation), volume.bottom, volume.top)
    };
  }

  distanceFromVolumeToPoint(volume, point) {
    return distance3(this.nearestPointOnVolume(volume, point), {
      x: finiteNumber(point?.x),
      y: finiteNumber(point?.y),
      z: finiteNumber(point?.z ?? point?.elevation)
    });
  }

  nearestCornerOnVolume(volume, point) {
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
      const distance = distance3(corner, target);
      return !best || distance < best.distance ? { ...corner, distance } : best;
    }, null);
  }

  distanceFromVolumeCornerToPoint(volume, point) {
    return this.nearestCornerOnVolume(volume, point).distance;
  }

  clampPointFromOrigin(origin, requested, maxDistance) {
    const limit = Math.max(0, finiteNumber(maxDistance));
    const distance = distance3(origin, requested);
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
