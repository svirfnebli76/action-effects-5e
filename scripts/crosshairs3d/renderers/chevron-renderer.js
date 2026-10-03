import { createInstructionPanel } from "./chevron-instructions.js";
import { updateTextResolution } from "./shared.js";
import { chevronElevationChanges } from "../chevron-path-service.js";

const display = value => String(Number(value.toFixed(2)));
const same = (a, b) => a.x === b.x && a.y === b.y && a.elevation === b.elevation;
const mix = (from, to, t) => {
  const channel = shift => Math.round(((from >> shift) & 255) + (((to >> shift) & 255) - ((from >> shift) & 255)) * t);
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
};

/** Session-owned PIXI presentation; no measurement, input, targeting, or document mutation. */
export function createRenderer({ parent, metrics, options }) {
  const root = new PIXI.Container();
  root.eventMode = "none";
  root.name = "ae5e-chevron-indicator";
  parent.addChild(root);
  const drawing = new PIXI.Graphics();
  const indicator = new PIXI.Container();
  const textRoot = new PIXI.Container();
  root.addChild(drawing, indicator, textRoot);
  const size = metrics.size;
  const shape = [
    [-0.14, -0.525], [0, -0.445], [0.14, -0.525],
    [0.14, -0.385], [0, -0.305], [-0.14, -0.385]
  ].flatMap(([x, y]) => [x * size, y * size]);
  const arms = Array.from({ length: 4 }, (_, index) => {
    const arm = new PIXI.Graphics();
    arm.rotation = index * Math.PI / 2;
    indicator.addChild(arm);
    return arm;
  });
  let panel = null;
  const instructionOptions = options.movement?.instructions;
  let labels = [], lastPalette = null;
  const started = performance.now();
  const units = globalThis.canvas.scene.grid.units || "units";

  function label(text, point, offset, above, red = false) {
    const object = new PIXI.Text(text, new PIXI.TextStyle({
      fontFamily: "Arial", fontSize: 16, fontWeight: "bold",
      fill: red ? 0xFF4D4D : 0xFFFFFF, stroke: 0x000000, strokeThickness: 2
    }));
    object.resolution = 2;
    object.roundPixels = true;
    object.anchor.set(0.5, above ? 1 : 0);
    object.position.set(point.x, point.y + offset);
    object.eventMode = "none";
    textRoot.addChild(object);
    labels.push(object);
  }
  function drawSegment(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    drawing.lineStyle(3, 0x4A4A4A, 0.80);
    if (length < 1e-7) {
      if (a.elevation !== b.elevation) drawing.drawCircle(b.x, b.y, size * 0.16);
      return;
    }
    const ux = dx / length, uy = dy / length;
    drawing.moveTo(a.x, a.y).lineTo(b.x, b.y);
    const count = Math.floor(length / 70);
    for (let i = 1; i <= count; i++) {
      const t = i / (count + 1), x = a.x + dx * t, y = a.y + dy * t;
      const bx = x - ux * 7, by = y - uy * 7;
      drawing.moveTo(bx - uy * 7 * 0.55, by + ux * 7 * 0.55);
      drawing.lineTo(x, y).lineTo(bx + uy * 7 * 0.55, by - ux * 7 * 0.55);
    }
  }
  return {
    update(revision) {
      const { origin, cursor, waypoints, distance, max, valid } = revision;
      if (options.movement?.enabled && instructionOptions !== false) {
        panel ??= createInstructionPanel(root, origin, size, options.movement.opportunityAttackImmunity === true);
        panel.update(cursor);
      }
      indicator.position.set(cursor.x, cursor.y);
      const delta = cursor.elevation - origin.elevation;
      const ratio = Math.round(Math.min(1, Math.abs(delta) / max) * 32) / 32;
      const below = delta < -1e-7;
      const edge = below || !valid ? 0xFF4D4D : 0x7FEFEF;
      const fill = below ? mix(0xFF4D4D, 0x000000, 0.65 * ratio)
        : !valid ? 0xFF4D4D : mix(0x388E8E, 0xFFFFFF, 0.70 * ratio);
      const palette = `${edge}:${fill}`;
      if (palette !== lastPalette) {
        lastPalette = palette;
        for (const arm of arms) {
          arm.clear().lineStyle(6, edge, 0.12).drawPolygon(shape);
          arm.lineStyle(2.25, edge, 0.92).beginFill(fill, 0.55).drawPolygon(shape).endFill();
        }
      }
      drawing.clear();
      const path = [origin, ...waypoints, cursor];
      for (let i = 1; i < path.length; i++) drawSegment(path[i - 1], path[i]);
      for (const object of labels) { textRoot.removeChild(object); object.destroy(); }
      labels = [];
      for (const { point, change } of chevronElevationChanges(origin, waypoints)) {
        if (!same(point, cursor)) label(`${change > 0 ? "↑" : "↓"}${display(Math.abs(change))} ${units}`, point, -12, true);
      }
      if (delta) label(`Elevation ${delta > 0 ? "+" : ""}${display(delta)} ${units}`, cursor, -size * 0.62, true);
      label(`${display(revision.cost ?? distance)}/${display(max)} ${units}`, cursor, size * 0.62, false, !valid);
      updateTextResolution(labels);
    },
    frame(now) {
      panel?.frame();
      const pulse = (Math.sin((now - started) / 1300 * Math.PI * 2) + 1) / 2;
      indicator.alpha = 0.82 + pulse * 0.18;
      const offset = (pulse - 0.5) * size * 0.024;
      arms.forEach((arm, i) => arm.position.set(Math.sin(i * Math.PI / 2) * offset, -Math.cos(i * Math.PI / 2) * offset));
      updateTextResolution(labels);
    },
    clear() {
      panel?.destroy();
      panel = null;
      root.parent?.removeChild(root);
      root.destroy({ children: true });
      labels = [];
    }
  };
}
