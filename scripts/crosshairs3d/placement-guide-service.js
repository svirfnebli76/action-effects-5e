import { CROSSHAIR_3D_SHAPES } from "./geometry-service.js";
import { degreesToRadians, finiteNumber } from "./geometry-utils.js";

const CONE_NEGATIVE_COLOR = 0xFF4D4D;
const CONE_NEGATIVE_GRID_COLOR = 0x921F27;
const CONE_BODY_ALPHA = 0.135;
const CONE_TERMINAL_ALPHA = 0.09;
const CONE_UNDERLAY_ALPHA = 0.072;
const CONE_OUTLINE_WIDTH = 2.25;
const CONE_UNDER_OUTLINE_WIDTH = 4.5;
const CONE_TERMINAL_OUTLINE_WIDTH = 1.875;
const CONE_ENDPOINT_RADIUS = 6;
const CONE_CONTOUR_FRACTIONS = Object.freeze([0.20, 0.40, 0.60, 0.80]);
const CONE_GENERATOR_INDICES = Object.freeze([0, 8, 16, 24, 32, 40, 48, 56]);

function drawPolygon(graphics, points, {
  color,
  alpha = 0.14,
  width = 3,
  lineColor = color,
  lineAlpha = 0.95
} = {}) {
  if (!points?.length) return;
  if (typeof graphics.poly === "function" && typeof graphics.fill === "function") {
    graphics.poly(points.flatMap(point => [point.x, point.y]));
    if (alpha > 0) graphics.fill({ color, alpha });
    if (width > 0 && lineAlpha > 0) graphics.stroke({ color: lineColor, alpha: lineAlpha, width });
    return;
  }
  graphics.lineStyle?.(width, lineColor, lineAlpha);
  if (alpha > 0) graphics.beginFill?.(color, alpha);
  graphics.moveTo?.(points[0].x, points[0].y);
  for (const point of points.slice(1)) graphics.lineTo?.(point.x, point.y);
  graphics.lineTo?.(points[0].x, points[0].y);
  if (alpha > 0) graphics.endFill?.();
}

function drawLine(graphics, a, b, { color, alpha = 1, width = 2 } = {}) {
  if (typeof graphics.stroke === "function") {
    graphics.moveTo?.(a.x, a.y);
    graphics.lineTo?.(b.x, b.y);
    graphics.stroke({ color, alpha, width });
    return;
  }
  graphics.lineStyle?.(width, color, alpha);
  graphics.moveTo?.(a.x, a.y);
  graphics.lineTo?.(b.x, b.y);
}

function drawCircle(graphics, point, radius, {
  fillColor,
  fillAlpha = 1,
  lineColor = 0x000000,
  lineAlpha = 0.95,
  lineWidth = 3
} = {}) {
  if (typeof graphics.circle === "function" && typeof graphics.fill === "function") {
    graphics.circle(point.x, point.y, radius)
      .fill({ color: fillColor, alpha: fillAlpha })
      .stroke({ color: lineColor, alpha: lineAlpha, width: lineWidth });
    return;
  }
  graphics.lineStyle?.(lineWidth, lineColor, lineAlpha);
  graphics.beginFill?.(fillColor, fillAlpha);
  graphics.drawCircle?.(point.x, point.y, radius);
  graphics.endFill?.();
}

function convexHull(points) {
  const unique = [...new Map(points.map(point => [
    `${point.x.toFixed(5)},${point.y.toFixed(5)}`,
    point
  ])).values()].sort((a, b) => a.x - b.x || a.y - b.y);
  if (unique.length <= 2) return unique;
  const cross = (origin, a, b) => ((a.x - origin.x) * (b.y - origin.y)) - ((a.y - origin.y) * (b.x - origin.x));
  const lower = [];
  for (const point of unique) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (const point of [...unique].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function createText(PIXI, text, style) {
  const content = String(text ?? "");
  let display;
  try { display = new PIXI.Text(content); }
  catch (_error) { display = new PIXI.Text({ text: content }); }

  let resolvedStyle = style;
  if (PIXI.TextStyle) {
    try { resolvedStyle = new PIXI.TextStyle(style); }
    catch (_error) { /* direct style assignment below remains available */ }
  }
  try { display.style = resolvedStyle; }
  catch (_error) {
    try { Object.assign(display.style ?? {}, style); }
    catch (_nestedError) { /* noop */ }
  }
  display.text = content;
  return display;
}

function formatElevation(value) {
  const rounded = Math.round(finiteNumber(value) * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded} ft` : `${rounded.toFixed(1)} ft`;
}

export class Crosshair3dPlacementGuideService {
  #geometry;
  #metrics;
  #container = null;
  #graphics = null;
  #endpointText = null;

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

    let endpointText = null;
    if (PIXI.Text) {
      endpointText = createText(PIXI, "", {
        fontFamily: "Arial, sans-serif",
        fontSize: 18,
        fontWeight: "600",
        fill: "#FFFFFF",
        align: "center",
        stroke: { color: "#000000", width: 5 }
      });
      endpointText.name = "action-effects-5e-3d-crosshair-cone-endpoint-elevation";
      endpointText.eventMode = "none";
      endpointText.anchor?.set?.(0.5);
      endpointText.visible = false;
      container.addChild(endpointText);
    }

    parent.addChild(container);
    this.#container = container;
    this.#graphics = graphics;
    this.#endpointText = endpointText;
    return true;
  }

  update(shapeInput, { color = 0x7fefef, alpha = 0.12, rangeBoundary = null, rangePolicy = null } = {}) {
    if (!this.#graphics) return;
    const shape = this.#geometry.normalizeShape(shapeInput);
    const metrics = this.#metrics.resolve();
    const toPixel = point => this.#metrics.distanceToPixels(point, metrics);
    const graphics = this.#graphics;
    graphics.clear?.();
    if (this.#endpointText) this.#endpointText.visible = false;

    if (rangeBoundary?.length) drawPolygon(graphics, rangeBoundary.map(toPixel), {
      color, alpha: 0.015, lineAlpha: 0.22, width: 1.5
    });

    if ([CROSSHAIR_3D_SHAPES.SPHERE, CROSSHAIR_3D_SHAPES.CYLINDER].includes(shape.type)) {
      const center = toPixel(shape.origin);
      const radius = ((shape.radius / metrics.distance) * metrics.size);
      if (typeof graphics.circle === "function" && typeof graphics.fill === "function") {
        graphics.circle(center.x, center.y, radius).fill({ color, alpha }).stroke({ color, alpha: 0.95, width: 3 });
      } else {
        graphics.lineStyle?.(3, color, 0.95); graphics.beginFill?.(color, alpha); graphics.drawCircle?.(center.x, center.y, radius); graphics.endFill?.();
      }
      return;
    }

    if (shape.type === CROSSHAIR_3D_SHAPES.PRISM) {
      const radians = degreesToRadians(shape.yaw);
      const c = Math.cos(radians), s = Math.sin(radians);
      const hx = shape.length / 2, hy = shape.width / 2;
      const points = [[-hx,-hy],[hx,-hy],[hx,hy],[-hx,hy]].map(([x,y]) => toPixel({ x: shape.origin.x + x*c - y*s, y: shape.origin.y + x*s + y*c, z: shape.origin.z }));
      drawPolygon(graphics, points, { color, alpha });
      return;
    }

    if (shape.type === CROSSHAIR_3D_SHAPES.FREE_LINE) {
      const radians = degreesToRadians(shape.yaw);
      const direction = { x: Math.cos(radians), y: Math.sin(radians) };
      const lateral = { x: -direction.y, y: direction.x };
      const half = shape.width / 2;
      const end = { x: shape.origin.x + direction.x * shape.length, y: shape.origin.y + direction.y * shape.length, z: shape.origin.z };
      const points = [
        { x: shape.origin.x + lateral.x*half, y: shape.origin.y + lateral.y*half, z: shape.origin.z },
        { x: end.x + lateral.x*half, y: end.y + lateral.y*half, z: shape.origin.z },
        { x: end.x - lateral.x*half, y: end.y - lateral.y*half, z: shape.origin.z },
        { x: shape.origin.x - lateral.x*half, y: shape.origin.y - lateral.y*half, z: shape.origin.z }
      ].map(toPixel);
      drawPolygon(graphics, points, { color, alpha });
      const center = toPixel({ x: (shape.origin.x + end.x) / 2, y: (shape.origin.y + end.y) / 2, z: shape.origin.z });
      drawCircle(graphics, center, 4, { fillColor: color, fillAlpha: 0.8 });
      for (const endpoint of [shape.origin, end]) drawCircle(graphics, toPixel(endpoint), 4, { fillColor: color });
      if (rangePolicy === "origin") drawCircle(graphics, toPixel(shape.origin), 7, { fillColor: 0xffffff });
      if (this.#endpointText) {
        this.#endpointText.text = `Length ${formatElevation(shape.length)} · Height ${formatElevation(shape.height)}`;
        this.#endpointText.position?.set?.(center.x, center.y - 25);
        this.#endpointText.visible = true;
      }
      return;
    }

    if (shape.type === CROSSHAIR_3D_SHAPES.LINE) {
      const basis = this.#geometry.lineBasis(shape);
      // Presentation only: 5-ft rules width becomes the approved 3.5-ft tube.
      // Never pass this reduced/filleted cross-section to targeting geometry.
      const half = shape.width * 0.7 / 2;
      const fillet = Math.min(metrics.distance * 0.17, half * 0.95);
      const inset = half - fillet;
      const perimeter = [];
      for (let corner = 0; corner < 4; corner++) {
        const midpoint = degreesToRadians(corner * 90 + 45);
        const u = Math.sign(Math.cos(midpoint)) * inset;
        const v = Math.sign(Math.sin(midpoint)) * inset;
        for (let step = 0; step <= 10; step++) {
          const angle = degreesToRadians(corner * 90 + step * 9);
          perimeter.push({ u: u + fillet * Math.cos(angle), v: v + fillet * Math.sin(angle) });
        }
      }
      const end = {
        x: shape.origin.x + basis.direction.x * shape.length,
        y: shape.origin.y + basis.direction.y * shape.length,
        z: shape.origin.z + basis.direction.z * shape.length
      };
      // Extrude a rounded-square section, keeping both terminal planes flat.
      // Include the height axis so the vertical projection never collapses.
      const section = fraction => {
        const center = {
          x: shape.origin.x + basis.direction.x * shape.length * fraction,
          y: shape.origin.y + basis.direction.y * shape.length * fraction,
          z: shape.origin.z + basis.direction.z * shape.length * fraction
        };
        return perimeter.map(({ u, v }) => {
          const world = {
            x: center.x + u*basis.widthAxis.x + v*basis.heightAxis.x,
            y: center.y + u*basis.widthAxis.y + v*basis.heightAxis.y,
            z: center.z + u*basis.widthAxis.z + v*basis.heightAxis.z
          };
          return { ...toPixel(world), z: world.z };
        });
      };
      const near = section(0), far = section(1);
      const downward = end.z < shape.origin.z - 1e-7;
      const bodyColor = downward ? CONE_NEGATIVE_COLOR : color;
      const edgeColor = downward ? CONE_NEGATIVE_GRID_COLOR : 0x287878;
      const silhouette = convexHull([...near, ...far]);
      const shade = normal => {
        const t = 0.25 + 0.75 * Math.max(0, -0.35*normal.x - 0.45*normal.y + 0.82*normal.z);
        const low = downward ? [100, 24, 30] : [31, 100, 105];
        const high = downward ? [255, 158, 158] : [166, 255, 245];
        const rgb = low.map((value, i) => Math.round(value + (high[i] - value) * t));
        return (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
      };
      const faces = [];
      for (let i = 0; i < perimeter.length; i++) {
        const j = (i + 1) % perimeter.length;
        const du = perimeter[j].u - perimeter[i].u, dv = perimeter[j].v - perimeter[i].v;
        const magnitude = Math.hypot(du, dv);
        if (magnitude < 1e-8) continue;
        const normal = Object.fromEntries(["x", "y", "z"].map(axis => [axis,
          (dv*basis.widthAxis[axis] - du*basis.heightAxis[axis]) / magnitude]));
        if (normal.z > 1e-8) faces.push({ points: [near[i], near[j], far[j], far[i]], normal, alpha: 0.34 });
      }
      if (Math.abs(basis.direction.z) > 1e-8) {
        const sign = Math.sign(basis.direction.z);
        faces.push({ points: sign > 0 ? far : near,
          normal: Object.fromEntries(["x", "y", "z"].map(axis => [axis, sign*basis.direction[axis]])), alpha: 0.22 });
      }
      const meanZ = face => face.points.reduce((sum, point) => sum + point.z, 0) / face.points.length;
      faces.sort((a, b) => meanZ(a) - meanZ(b));
      for (const face of faces) drawPolygon(graphics, face.points, { color: shade(face.normal), alpha: face.alpha, width: 0 });
      drawPolygon(graphics, silhouette, { color: 0x000000, alpha: 0, lineAlpha: 0.4, width: CONE_UNDER_OUTLINE_WIDTH });
      drawPolygon(graphics, silhouette, { color: bodyColor, alpha: 0, lineAlpha: 0.9, width: CONE_OUTLINE_WIDTH });
      drawPolygon(graphics, near, { color: edgeColor, alpha: 0, lineAlpha: downward ? 0.8 : 0.3, width: 1.5 });
      drawPolygon(graphics, far, { color: bodyColor, alpha: 0, lineAlpha: downward ? 0.3 : 0.8, width: 1.5 });
      for (const i of [10, 11]) drawLine(graphics, near[i], far[i], {
        color: downward ? 0xffbaba : 0xc4fff7, alpha: 0.45, width: 1
      });
      const terminal = toPixel(end);
      drawCircle(graphics, terminal, CONE_ENDPOINT_RADIUS, { fillColor: bodyColor });
      if (this.#endpointText) {
        this.#endpointText.text = formatElevation(end.z);
        this.#endpointText.position?.set?.(terminal.x, terminal.y + 20);
        this.#endpointText.visible = true;
      }
      return;
    }

    if (shape.type === CROSSHAIR_3D_SHAPES.CONE) this.#drawCone(shape, { color, toPixel });
  }

  clearDrawing() {
    this.#graphics?.clear?.();
    if (this.#endpointText) this.#endpointText.visible = false;
  }

  clear() {
    if (this.#container) {
      try { this.#container.parent?.removeChild?.(this.#container); this.#container.destroy?.({ children: true }); } catch (_error) { /* noop */ }
    }
    this.#container = null;
    this.#graphics = null;
    this.#endpointText = null;
  }

  #drawCone(shape, { color, toPixel }) {
    const direction = this.#geometry.direction(shape);
    const basis = this.#geometry.lineBasis(shape);
    const endpoint = {
      x: shape.origin.x + direction.x * shape.length,
      y: shape.origin.y + direction.y * shape.length,
      z: shape.origin.z + direction.z * shape.length
    };
    const downward = endpoint.z < shape.origin.z - 1e-7;
    const coneColor = downward ? CONE_NEGATIVE_COLOR : color;
    const gridColor = downward ? CONE_NEGATIVE_GRID_COLOR : coneColor;
    const apex = toPixel(shape.origin);

    const projectedRing = (fraction, sampleCount = 64) => {
      const center = {
        x: shape.origin.x + direction.x * shape.length * fraction,
        y: shape.origin.y + direction.y * shape.length * fraction,
        z: shape.origin.z + direction.z * shape.length * fraction
      };
      const radius = (shape.length * fraction) / 2;
      const points = [];
      for (let index = 0; index < sampleCount; index += 1) {
        const angle = (index / sampleCount) * Math.PI * 2;
        points.push(toPixel({
          x: center.x + radius * ((basis.widthAxis.x * Math.cos(angle)) + (basis.heightAxis.x * Math.sin(angle))),
          y: center.y + radius * ((basis.widthAxis.y * Math.cos(angle)) + (basis.heightAxis.y * Math.sin(angle))),
          z: center.z + radius * ((basis.widthAxis.z * Math.cos(angle)) + (basis.heightAxis.z * Math.sin(angle)))
        }));
      }
      return { center: toPixel(center), points };
    };

    const terminal = projectedRing(1);
    const silhouette = convexHull([apex, ...terminal.points]);

    drawPolygon(this.#graphics, silhouette, {
      color: 0x000000,
      alpha: CONE_UNDERLAY_ALPHA,
      lineColor: 0x000000,
      lineAlpha: 0.82,
      width: CONE_UNDER_OUTLINE_WIDTH
    });
    drawPolygon(this.#graphics, silhouette, {
      color: coneColor,
      alpha: CONE_BODY_ALPHA,
      lineColor: coneColor,
      lineAlpha: 0.98,
      width: CONE_OUTLINE_WIDTH
    });

    for (const fraction of CONE_CONTOUR_FRACTIONS) {
      const ring = projectedRing(fraction, 48);
      drawPolygon(this.#graphics, ring.points, {
        color: coneColor,
        alpha: 0.0108 + (fraction * 0.0162),
        lineColor: gridColor,
        lineAlpha: downward ? 0.78 : 0.30,
        width: downward ? 1.75 : 1.25
      });
    }

    drawPolygon(this.#graphics, terminal.points, {
      color: coneColor,
      alpha: CONE_TERMINAL_ALPHA,
      lineColor: coneColor,
      lineAlpha: 0.98,
      width: CONE_TERMINAL_OUTLINE_WIDTH
    });

    for (const index of CONE_GENERATOR_INDICES) {
      drawLine(this.#graphics, apex, terminal.points[index], {
        color: gridColor,
        alpha: downward ? 0.82 : 0.42,
        width: downward ? 1.8 : 1.5
      });
    }
    drawLine(this.#graphics, apex, terminal.center, { color: 0x000000, alpha: 0.86, width: 5 });
    drawLine(this.#graphics, apex, terminal.center, { color: coneColor, alpha: 0.98, width: 2.5 });
    drawCircle(this.#graphics, terminal.center, CONE_ENDPOINT_RADIUS, {
      fillColor: coneColor,
      fillAlpha: 1,
      lineColor: 0x000000,
      lineAlpha: 0.95,
      lineWidth: 3
    });

    if (this.#endpointText) {
      this.#endpointText.text = formatElevation(endpoint.z);
      try { this.#endpointText.style.fill = "#FFFFFF"; }
      catch (_error) { /* style remains readable through its black stroke */ }
      this.#endpointText.position?.set?.(terminal.center.x, terminal.center.y + 20);
      this.#endpointText.visible = true;
    }

  }
}
