/** Common presentation utilities; no input listeners or targeting side effects. */
export const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
export function controlHints(capabilities) {
  const parts = [];
  const add = (key, action) => {
    if (parts.length) parts.push([", ", false]);
    parts.push([key, true], [action, false]);
  };
  if (capabilities.rotation) add("SHIFT", " to Rotate");
  if (capabilities.elevation) add("CTRL", " to Elevate");
  if (capabilities.resize) add("ALT", " to Alter Length");
  return parts;
}
export function updateTextResolution(labels) {
  const canvas = globalThis.canvas;
  const zoom = Math.max(Math.abs(canvas.stage.scale.x), Math.abs(canvas.stage.scale.y));
  const resolution = Math.min(8, Math.max(2, Math.ceil(zoom * (canvas.app.renderer.resolution || 1) * 1.5)));
  let changed = false;
  for (const label of labels) {
    if (label.resolution !== resolution) { label.resolution = resolution; changed = true; }
  }
  return changed;
}
/** Cumulative travel, full hold, unified fade, then restart. */
export function illuminationPhase(elapsed, spread = 2200, hold = 650, fade = 500, pause = 150) {
  const duration = spread + hold + fade + pause;
  const time = ((elapsed % duration) + duration) % duration;
  if (time < spread) return { progress: time / spread, alpha: 1 };
  if (time < spread + hold) return { progress: 1, alpha: 1 };
  if (time < spread + hold + fade) return { progress: 1, alpha: 1 - (time - spread - hold) / fade };
  return { progress: 1, alpha: 0 };
}
