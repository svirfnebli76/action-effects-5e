import { CROSSHAIR_3D_SHAPES } from "./geometry-service.js";
import { degreesToRadians, finiteNumber } from "./geometry-utils.js";

function drawPolygon(graphics, points, { color, alpha = 0.14, width = 3 } = {}) {
  if (!points?.length) return;
  if (typeof graphics.poly === "function" && typeof graphics.fill === "function") {
    graphics.poly(points.flatMap(p => [p.x, p.y]));
    graphics.fill({ color, alpha });
    graphics.stroke({ color, alpha: 0.95, width });
    return;
  }
  graphics.lineStyle?.(width, color, 0.95);
  graphics.beginFill?.(color, alpha);
  graphics.moveTo?.(points[0].x, points[0].y);
  for (const point of points.slice(1)) graphics.lineTo?.(point.x, point.y);
  graphics.lineTo?.(points[0].x, points[0].y);
  graphics.endFill?.();
}

export class Crosshair3dPlacementGuideService {
  #geometry;
  #metrics;
  #container = null;
  #graphics = null;

  constructor({ geometry, metrics }) {
    this.#geometry = geometry;
    this.#metrics = metrics;
  }

  show() {
    this.clear();
    const PIXI = globalThis.PIXI;
    const parent = globalThis.canvas?.interface ?? globalThis.canvas?.controls ?? globalThis.canvas?.stage;
    if (!PIXI?.Container || !PIXI?.Graphics || !parent?.addChild) return false;
    const container = new PIXI.Container();
    container.name = "action-effects-5e-3d-crosshair-guide";
    container.eventMode = "none";
    const graphics = new PIXI.Graphics();
    graphics.eventMode = "none";
    container.addChild(graphics);
    parent.addChild(container);
    this.#container = container;
    this.#graphics = graphics;
    return true;
  }

  update(shapeInput, { color = 0x7fefef, alpha = 0.12 } = {}) {
    if (!this.#graphics) return;
    const shape = this.#geometry.normalizeShape(shapeInput);
    const metrics = this.#metrics.resolve();
    const toPixel = p => this.#metrics.distanceToPixels(p, metrics);
    const g = this.#graphics;
    g.clear?.();

    if ([CROSSHAIR_3D_SHAPES.SPHERE, CROSSHAIR_3D_SHAPES.CYLINDER].includes(shape.type)) {
      const c = toPixel(shape.origin);
      const radius = ((shape.radius / metrics.distance) * metrics.size);
      if (typeof g.circle === "function" && typeof g.fill === "function") {
        g.circle(c.x, c.y, radius).fill({ color, alpha }).stroke({ color, alpha: 0.95, width: 3 });
      } else {
        g.lineStyle?.(3, color, 0.95); g.beginFill?.(color, alpha); g.drawCircle?.(c.x, c.y, radius); g.endFill?.();
      }
      return;
    }

    if (shape.type === CROSSHAIR_3D_SHAPES.PRISM) {
      const radians = degreesToRadians(shape.yaw);
      const c = Math.cos(radians), s = Math.sin(radians);
      const hx = shape.length / 2, hy = shape.width / 2;
      const points = [[-hx,-hy],[hx,-hy],[hx,hy],[-hx,hy]].map(([x,y]) => toPixel({ x: shape.origin.x + x*c - y*s, y: shape.origin.y + x*s + y*c, z: shape.origin.z }));
      drawPolygon(g, points, { color, alpha });
      return;
    }

    if (shape.type === CROSSHAIR_3D_SHAPES.LINE) {
      const radians = degreesToRadians(shape.yaw);
      const d = { x: Math.cos(radians), y: Math.sin(radians) };
      const l = { x: -d.y, y: d.x };
      const h = shape.width / 2;
      const end = { x: shape.origin.x + d.x * shape.length, y: shape.origin.y + d.y * shape.length, z: shape.origin.z };
      const points = [
        { x: shape.origin.x + l.x*h, y: shape.origin.y + l.y*h, z: shape.origin.z },
        { x: end.x + l.x*h, y: end.y + l.y*h, z: shape.origin.z },
        { x: end.x - l.x*h, y: end.y - l.y*h, z: shape.origin.z },
        { x: shape.origin.x - l.x*h, y: shape.origin.y - l.y*h, z: shape.origin.z }
      ].map(toPixel);
      drawPolygon(g, points, { color, alpha });
      return;
    }

    if (shape.type === CROSSHAIR_3D_SHAPES.RAY) {
      const basis = this.#geometry.rayBasis(shape);
      const half = shape.width / 2;
      const end = {
        x: shape.origin.x + basis.direction.x * shape.length,
        y: shape.origin.y + basis.direction.y * shape.length,
        z: shape.origin.z + basis.direction.z * shape.length
      };
      const projected = [
        { x: shape.origin.x + basis.widthAxis.x*half, y: shape.origin.y + basis.widthAxis.y*half, z: shape.origin.z },
        { x: end.x + basis.widthAxis.x*half, y: end.y + basis.widthAxis.y*half, z: end.z },
        { x: end.x - basis.widthAxis.x*half, y: end.y - basis.widthAxis.y*half, z: end.z },
        { x: shape.origin.x - basis.widthAxis.x*half, y: shape.origin.y - basis.widthAxis.y*half, z: shape.origin.z }
      ].map(toPixel);
      drawPolygon(g, projected, { color, alpha });
      const endPixel = toPixel(end);
      const originPixel = toPixel(shape.origin);
      g.moveTo?.(originPixel.x, originPixel.y); g.lineTo?.(endPixel.x, endPixel.y); g.stroke?.({ color, alpha: 0.95, width: 2 });
      return;
    }

    if (shape.type === CROSSHAIR_3D_SHAPES.CONE) {
      const direction = this.#geometry.direction(shape);
      const center = {
        x: shape.origin.x + direction.x * shape.length,
        y: shape.origin.y + direction.y * shape.length,
        z: shape.origin.z + direction.z * shape.length
      };
      const apex = toPixel(shape.origin);
      const centerPixel = toPixel(center);
      const radius = shape.length / 2;
      // Project the terminal 3D circle to XY by sampling its deterministic local basis.
      const basis = this.#geometry.rayBasis({ yaw: shape.yaw, pitch: shape.pitch });
      const samples = [];
      for (let i = 0; i < 48; i += 1) {
        const t = (i / 48) * Math.PI * 2;
        const p = {
          x: center.x + radius * ((basis.widthAxis.x * Math.cos(t)) + (basis.heightAxis.x * Math.sin(t))),
          y: center.y + radius * ((basis.widthAxis.y * Math.cos(t)) + (basis.heightAxis.y * Math.sin(t))),
          z: center.z + radius * ((basis.widthAxis.z * Math.cos(t)) + (basis.heightAxis.z * Math.sin(t)))
        };
        samples.push(toPixel(p));
      }
      drawPolygon(g, samples, { color, alpha: Math.min(alpha, 0.08), width: 2 });
      g.moveTo?.(apex.x, apex.y); g.lineTo?.(centerPixel.x, centerPixel.y); g.stroke?.({ color, alpha: 0.95, width: 3 });
      for (const index of [0, 12, 24, 36]) {
        const p = samples[index]; g.moveTo?.(apex.x, apex.y); g.lineTo?.(p.x, p.y); g.stroke?.({ color, alpha: 0.55, width: 2 });
      }
    }
  }

  clearDrawing() {
    this.#graphics?.clear?.();
  }

  clear() {
    if (this.#container) {
      try { this.#container.parent?.removeChild?.(this.#container); this.#container.destroy?.({ children: true }); } catch (_error) { /* noop */ }
    }
    this.#container = null;
    this.#graphics = null;
  }
}
