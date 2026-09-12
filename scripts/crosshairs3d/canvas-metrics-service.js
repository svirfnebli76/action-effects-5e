import { finiteNumber } from "./geometry-utils.js";

export class Crosshair3dCanvasMetricsService {
  resolve(canvasObject = globalThis.canvas) {
    if (!canvasObject?.ready) throw new Error("Action Effects 3D Crosshairs requires an active Scene canvas.");
    const size = finiteNumber(canvasObject.scene?.grid?.size ?? canvasObject.grid?.size, 0);
    const distance = finiteNumber(canvasObject.scene?.grid?.distance ?? canvasObject.dimensions?.distance, 0);
    if (!(size > 0) || !(distance > 0)) throw new Error("Action Effects 3D Crosshairs requires a gridded Scene with positive grid size and distance.");
    const rect = canvasObject.dimensions?.sceneRect ?? { x: 0, y: 0 };
    return Object.freeze({
      size,
      distance,
      originX: finiteNumber(rect.x),
      originY: finiteNumber(rect.y),
      grid: Object.freeze({
        distance,
        origin: Object.freeze({ x: 0, y: 0, z: 0 })
      })
    });
  }

  pixelsToDistance(point, metrics = this.resolve()) {
    return Object.freeze({
      x: ((finiteNumber(point?.x) - metrics.originX) / metrics.size) * metrics.distance,
      y: ((finiteNumber(point?.y) - metrics.originY) / metrics.size) * metrics.distance,
      z: finiteNumber(point?.z ?? point?.elevation)
    });
  }

  distanceToPixels(point, metrics = this.resolve()) {
    return Object.freeze({
      x: metrics.originX + ((finiteNumber(point?.x) / metrics.distance) * metrics.size),
      y: metrics.originY + ((finiteNumber(point?.y) / metrics.distance) * metrics.size),
      elevation: finiteNumber(point?.z ?? point?.elevation)
    });
  }
}
