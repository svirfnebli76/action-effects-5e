import { freeLineEndpoints, freeLineRangeBoundary } from "../free-line-placement.js";
import { clamp01, controlHints, updateTextResolution } from "./shared.js";

// Rendering and text layout preserved from AE5E-Free-Line-Brighter-Edge-Pulse-Test-08.txt.
export function createRenderer(context) {
  const { shape, sourceVolume, metrics, metricsService, geometry, options, capabilities, parent } = context;
  const api = { geometry };
  const scene = globalThis.canvas.scene;
  const scale = metrics.size / metrics.distance;
  const unit = String(scene.grid.units || "ft");
  const RANGE = Number(options.range?.max ?? options.maxRange ?? 60);
  const toPixel = point => metricsService.distanceToPixels(point, metrics);
  const sourceCenterPixels = toPixel({ x: (sourceVolume.minX + sourceVolume.maxX) / 2,
    y: (sourceVolume.minY + sourceVolume.maxY) / 2, z: sourceVolume.bottom });
  let root, revision, mode = "MOVE", labelsDirty = false;
  const labels = [];
  const lightStartedAt = performance.now(), waveStartedAt = lightStartedAt, pulseStartedAt = lightStartedAt;
const MAX_LENGTH = shape.length, WIDTH = shape.width, HEIGHT = shape.height;
  const TEAL_LIGHTNESS_MIN = 0.00;
  const TEAL_LIGHTNESS_MAX = 0.70;
  const RED_DARKNESS_MIN = 0.00;
  const RED_DARKNESS_MAX = 0.65;

  // Accepted free-line palette and opacity settings.
  const TEAL_BASE_COLOR = 0x388E8E;
  const RED_BASE_COLOR = 0xFF4D4D;
  const GRADIENT_BANDS = 32;
  const GRADIENT_FILL_ALPHA = 0.55;

  // Shared PIXI tracer presentation from the accepted sphere crosshair.
  const TRACER_COLOR = 0x4A4A4A;
  const TRACER_ALPHA = 0.80;
  const TRACER_WIDTH = 3;
  const TRACER_CHEVRON_SIZE = 7;
  const TRACER_CHEVRON_SPACING = 70;

  // The complete line outline brightens and fades together.
  const EDGE_PULSE_DURATION_MS = 2000;
  const EDGE_PULSE_LIGHTEN = 0.65;
  const EDGE_PULSE_ALPHA_MAX = 0.65;
  const EDGE_PULSE_WIDTH = 3.5;


    const pixel = p => metricsService.distanceToPixels(p, metrics);
    const fmt = n => String(Math.round(n * 10) / 10);
    
    const mixColor = (from, to, amount) => {
      const t = clamp01(amount);
      const fr = (from >> 16) & 0xFF;
      const fg = (from >> 8) & 0xFF;
      const fb = from & 0xFF;
      const tr = (to >> 16) & 0xFF;
      const tg = (to >> 8) & 0xFF;
      const tb = to & 0xFF;
      const channel = (a, b) => Math.round(a + (b - a) * t);
      return (
        (channel(fr, tr) << 16) |
        (channel(fg, tg) << 8) |
        channel(fb, tb)
      );
    };
    const elevationColor = delta => {
      // The whole horizontal line has one elevation. Quantize only the
      // elevation percentage so the shared band setting remains meaningful.
      const rawRatio = clamp01(Math.abs(delta) / Math.max(RANGE, 1e-7));
      const ratio = Math.round(rawRatio * GRADIENT_BANDS) / GRADIENT_BANDS;
      if (delta < -1e-7) {
        const darkness = RED_DARKNESS_MIN +
          (RED_DARKNESS_MAX - RED_DARKNESS_MIN) * ratio;
        return mixColor(RED_BASE_COLOR, 0x000000, darkness);
      }
      const lightness = TEAL_LIGHTNESS_MIN +
        (TEAL_LIGHTNESS_MAX - TEAL_LIGHTNESS_MIN) * ratio;
      return mixColor(TEAL_BASE_COLOR, 0xFFFFFF, lightness);
    };

    root = new PIXI.Container();
    root.eventMode = "none";
    root.name = "ae5e-pixi-free-line-test";
    const drawing = new PIXI.Graphics();
    const edgePulse = new PIXI.Graphics();
    const textRoot = new PIXI.Container();
    edgePulse.alpha = 0;
    root.addChild(drawing, edgePulse, textRoot);
    parent.addChild(root);
    function text(value, bold = false) {
      const t = new PIXI.Text(value, new PIXI.TextStyle({
        fontFamily: "Arial", fontSize: 16, fontWeight: bold ? "700" : "400",
        fill: "#FFFFFF", stroke: "#000000", strokeThickness: 0,
        dropShadow: false, padding: 4
      }));
      t.anchor.set(0, 0.5);
      t.resolution = 2;
      t.eventMode = "none";
      labels.push(t);
      return t;
    }
    const header = new PIXI.Container(), badge = new PIXI.Graphics();
    const modeText = text("MOVE", true), dimensions = text("", true);
    header.addChild(badge, modeText, dimensions);
    const elevation = text("", true), instructions = new PIXI.Container();
    for (const [value, bold] of controlHints(capabilities)) { instructions.addChild(text(value, bold)); }
    textRoot.addChild(header, elevation, instructions);
    let lastResolution = 2;

    function drawSourceTracer(from, to) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.hypot(dx, dy);
      if (length < 1e-7) return;

      const direction = { x: dx / length, y: dy / length };
      const normal = { x: -direction.y, y: direction.x };

      drawing.lineStyle(TRACER_WIDTH, TRACER_COLOR, TRACER_ALPHA);
      drawing.moveTo(from.x, from.y);
      drawing.lineTo(to.x, to.y);

      const chevrons = Math.max(
        0,
        Math.floor(length / TRACER_CHEVRON_SPACING)
      );
      for (let index = 1; index <= chevrons; index++) {
        const t = index / (chevrons + 1);
        const point = {
          x: from.x + dx * t,
          y: from.y + dy * t
        };
        const back = {
          x: point.x - direction.x * TRACER_CHEVRON_SIZE,
          y: point.y - direction.y * TRACER_CHEVRON_SIZE
        };
        drawing.moveTo(
          back.x + normal.x * TRACER_CHEVRON_SIZE * 0.55,
          back.y + normal.y * TRACER_CHEVRON_SIZE * 0.55
        );
        drawing.lineTo(point.x, point.y);
        drawing.lineTo(
          back.x - normal.x * TRACER_CHEVRON_SIZE * 0.55,
          back.y - normal.y * TRACER_CHEVRON_SIZE * 0.55
        );
      }
    }

    function drawEdgePulse(corners, paletteColor) {
      const pulseColor = mixColor(
        paletteColor,
        0xFFFFFF,
        EDGE_PULSE_LIGHTEN
      );
      edgePulse.clear();
      edgePulse.lineStyle(
        EDGE_PULSE_WIDTH,
        pulseColor,
        1
      );
      edgePulse.drawPolygon(corners.flatMap(point => [point.x, point.y]));
    }

    function updateEdgePulse(now) {
      const phase = (now % EDGE_PULSE_DURATION_MS) /
        EDGE_PULSE_DURATION_MS;
      const wave = (
        Math.sin(phase * Math.PI * 2 - Math.PI / 2) + 1
      ) / 2;
      edgePulse.alpha = EDGE_PULSE_ALPHA_MAX * wave;
    }

    function render(redrawShape = true) {
      const s = revision;
      if (!s) return;
      // A freely placed line is horizontal, so its entire body receives the
      // color for its elevation percentage relative to the source and RANGE.
      const elevationDelta = s.point.z - sourceVolume.bottom;
      const belowSource = elevationDelta < -1e-7;
      const lineColor = elevationColor(elevationDelta);
      const edgeColor = belowSource ? RED_BASE_COLOR : TEAL_BASE_COLOR;
      if (redrawShape) {
      drawing.clear();
      const boundary = freeLineRangeBoundary(sourceVolume, RANGE, s.point.z).map(pixel);
      if (options.range?.showBoundary !== false && boundary.length) {
        drawing.lineStyle(1.5, 0x7fefef, 0.4);
        drawing.drawPolygon(boundary.flatMap(p => [p.x, p.y]));
      }
      const ends = freeLineEndpoints(s);
      const a = s.yaw * Math.PI / 180, h = WIDTH / 2;
      const side = { x: -Math.sin(a) * h, y: Math.cos(a) * h };
      const corners = [[0, 1], [1, 1], [1, -1], [0, -1]].map(([i, sign]) =>
        pixel({ x: ends[i].x + sign * side.x, y: ends[i].y + sign * side.y }));
      drawing.lineStyle(4.5, 0x000000, 0.40);
      drawing.beginFill(lineColor, GRADIENT_FILL_ALPHA);
      drawing.drawPolygon(corners.flatMap(p => [p.x, p.y]));
      drawing.endFill();

      drawing.lineStyle(2.25, edgeColor, 0.92);
      drawing.drawPolygon(corners.flatMap(p => [p.x, p.y]));

      drawSourceTracer(
        pixel({
          x: (sourceVolume.minX + sourceVolume.maxX) / 2,
          y: (sourceVolume.minY + sourceVolume.maxY) / 2,
          z: sourceVolume.bottom
        }),
        pixel(s.point)
      );

      drawEdgePulse(corners, edgeColor);

      for (const p of [...ends, s.point].map(pixel)) {
        drawing.lineStyle(3, 0x000000, 0.95);
        drawing.beginFill(lineColor, 0.8);
        drawing.drawCircle(p.x, p.y, 4);
        drawing.endFill();
      }
      }
      const center = pixel(s.point);
      textRoot.position.set(center.x, center.y);
      textRoot.rotation = ((((s.yaw + 90) % 180 + 180) % 180) - 90) * Math.PI / 180;
      modeText.text = mode;
      dimensions.text = `Length ${fmt(s.length)} ${unit} · Height ${HEIGHT} ${unit}`;
      const bw = modeText.width + 18;
      badge.clear().beginFill(0x202020, 0.92).drawRoundedRect(0, -14, bw, 28, 4).endFill();
      modeText.position.set(9, 0);
      dimensions.position.set(bw + 14, 0);
      header.pivot.x = (bw + 14 + dimensions.width) / 2;
      header.position.set(0, -WIDTH * scale / 2 - 20);
      elevation.text = `${fmt(s.point.z)} ${unit}`;
      elevation.position.set(18, 0);
      let x = 0;
      for (const label of instructions.children) { label.position.set(x, 0); x += label.width; }
      instructions.pivot.x = x / 2;
      instructions.position.set(0, WIDTH * scale / 2 + 20);
      labelsDirty = false;
    }


  return {
    update(next, nextMode) {
      revision = next;
      mode = nextMode;
      render(true);
    },
    frame(now) {
updateEdgePulse(now);
      if (updateTextResolution(labels)) render(false);
    },
    clear() { root?.parent?.removeChild(root); root?.destroy({ children: true }); }
  };
}
