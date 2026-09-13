import { finiteNumber } from "./geometry-utils.js";

const ROOT_ID = "action-effects-5e-3d-crosshair-overlay";
const ELEVATION_FONT_SIZE = 20;
const CONFIRM_FONT_SIZE = 18;
const MODE_FONT_SIZE = 16;
const MODE_BOUNDARY_MARGIN = 22;
const CONFIRM_OFFSET_GRID_FACTOR = 0.35;

export class Crosshair3dPlacementOverlayService {
  #root = null;
  #elevationText = null;
  #confirmText = null;
  #modeContainer = null;
  #modeText = null;
  #modeBackground = null;

  show({ mode = "MOVE", hints = [] } = {}) {
    this.clear();
    const doc = globalThis.document;
    if (doc?.body) {
      const root = doc.createElement("div");
      root.id = ROOT_ID;
      root.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:100000;font-family:var(--font-primary, sans-serif);text-shadow:0 1px 3px #000;";
      const hintsEl = doc.createElement("div");
      hintsEl.dataset.ae5e3d = "hints";
      hintsEl.style.cssText = "position:absolute;bottom:18px;left:50%;transform:translateX(-50%);padding:6px 10px;border-radius:6px;background:rgba(0,0,0,.66);color:white;font-size:13px;white-space:nowrap;";
      hintsEl.textContent = hints.join("   •   ");
      root.append(hintsEl);
      doc.body.appendChild(root);
      this.#root = root;
    }

    const PIXI = globalThis.PIXI;
    const parent = globalThis.canvas?.interface ?? globalThis.canvas?.controls;
    if (!PIXI?.Text || !parent?.addChild) return;

    const elevation = this.#createText(PIXI, "", {
      fontFamily: "Arial",
      fontSize: ELEVATION_FONT_SIZE,
      fill: 0xffffff,
      fontWeight: "700",
      stroke: { color: 0x000000, width: 4 }
    });
    elevation.name = "action-effects-5e-3d-crosshair-elevation";
    elevation.eventMode = "none";
    elevation.anchor?.set?.(0.5, 0.5);
    elevation.visible = false;
    parent.addChild(elevation);
    this.#elevationText = elevation;

    const confirm = this.#createText(PIXI, "Action Effects 3D Crosshairs — click to confirm", {
      fontFamily: "Arial",
      fontSize: CONFIRM_FONT_SIZE,
      fill: 0xffffff,
      fontWeight: "600",
      stroke: { color: 0x000000, width: 4 }
    });
    confirm.name = "action-effects-5e-3d-crosshair-confirm";
    confirm.eventMode = "none";
    confirm.anchor?.set?.(0.5, 0.5);
    confirm.visible = false;
    parent.addChild(confirm);
    this.#confirmText = confirm;

    this.#createModeBadge(PIXI, parent, mode);
  }

  update({ mode = null, elevation = null, point = null, gridSize = null, footprintRadiusPx = null } = {}) {
    if (mode && this.#modeText) {
      this.#modeText.text = String(mode);
      this.#refreshModeBackground();
    }

    if (!point) return;

    const x = finiteNumber(point.x);
    const y = finiteNumber(point.y);
    const grid = Math.max(1, finiteNumber(gridSize, 100));

    if (this.#elevationText) {
      this.#elevationText.text = `${this.#formatElevation(elevation)} ft`;
      // Anchor the readout to the actual accepted crosshair center, then move
      // it down by exactly one text-size unit. This remains centered for both
      // odd- and even-grid-diameter crosshairs and never depends on a nearby
      // map-grid square center.
      this.#elevationText.position.set(x, y + ELEVATION_FONT_SIZE);
      this.#elevationText.visible = true;
    }

    if (this.#confirmText) {
      this.#confirmText.position.set(x, y - (grid * CONFIRM_OFFSET_GRID_FACTOR));
      this.#confirmText.visible = true;
    }

    if (this.#modeContainer) {
      const footprint = Math.max(0, finiteNumber(footprintRadiusPx, grid * 0.5));
      this.#modeContainer.position?.set?.(x, y - footprint - MODE_BOUNDARY_MARGIN);
      this.#modeContainer.visible = true;
    }
  }

  clear() {
    try { this.#root?.remove?.(); } catch (_error) { /* noop */ }
    this.#root = null;

    this.#removeDisplayObject(this.#elevationText);
    this.#removeDisplayObject(this.#confirmText);
    this.#removeDisplayObject(this.#modeContainer);

    this.#elevationText = null;
    this.#confirmText = null;
    this.#modeContainer = null;
    this.#modeText = null;
    this.#modeBackground = null;
  }

  #createText(PIXI, text, style) {
    // Foundry v14 currently exposes the classic PIXI.Text(text, style)
    // signature. Passing a v8-style { text, style } object here renders as
    // "[object Object]" on that runtime and also drops the intended style.
    // Assign text explicitly after construction as an additional compatibility
    // guard for runtimes which normalize the constructor differently.
    let display;
    try {
      display = new PIXI.Text(String(text ?? ""), style);
    } catch (_error) {
      display = new PIXI.Text({ text: String(text ?? ""), style });
    }
    display.text = String(text ?? "");
    return display;
  }

  #createModeBadge(PIXI, parent, mode) {
    const text = this.#createText(PIXI, mode, {
      fontFamily: "Arial",
      fontSize: MODE_FONT_SIZE,
      fill: 0xffffff,
      fontWeight: "700",
      letterSpacing: 1.25,
      stroke: { color: 0x000000, width: 2 }
    });
    text.name = "action-effects-5e-3d-crosshair-mode-text";
    text.eventMode = "none";
    text.anchor?.set?.(0.5, 0.5);

    if (PIXI.Container) {
      const container = new PIXI.Container();
      container.name = "action-effects-5e-3d-crosshair-mode";
      container.eventMode = "none";
      container.visible = false;

      if (PIXI.Graphics) {
        const background = new PIXI.Graphics();
        background.name = "action-effects-5e-3d-crosshair-mode-background";
        background.eventMode = "none";
        container.addChild(background);
        this.#modeBackground = background;
      }

      container.addChild(text);
      parent.addChild(container);
      this.#modeContainer = container;
      this.#modeText = text;
      this.#refreshModeBackground();
      return;
    }

    // Very old/minimal PIXI fallback: keep the moving mode text even if a
    // container/rounded background implementation is unavailable.
    text.name = "action-effects-5e-3d-crosshair-mode";
    text.visible = false;
    parent.addChild(text);
    this.#modeContainer = text;
    this.#modeText = text;
  }

  #refreshModeBackground() {
    const background = this.#modeBackground;
    const text = this.#modeText;
    if (!background || !text) return;

    const width = Math.max(48, finiteNumber(text.width, 48) + 24);
    const height = Math.max(28, finiteNumber(text.height, MODE_FONT_SIZE) + 10);
    const x = -width / 2;
    const y = -height / 2;

    try { background.clear?.(); } catch (_error) { /* noop */ }

    // PIXI v8-style Graphics API.
    if (typeof background.roundRect === "function" && typeof background.fill === "function") {
      try {
        background.roundRect(x, y, width, height, 6).fill({ color: 0x000000, alpha: 0.70 });
        return;
      } catch (_error) { /* fall through to classic API */ }
    }

    // Foundry v14 / classic PIXI Graphics API.
    try {
      background.beginFill?.(0x000000, 0.70);
      background.drawRoundedRect?.(x, y, width, height, 6);
      background.endFill?.();
    } catch (_error) { /* noop */ }
  }

  #removeDisplayObject(display) {
    if (!display) return;
    try {
      display.parent?.removeChild?.(display);
      display.destroy?.({ children: true });
    } catch (_error) { /* noop */ }
  }

  #formatElevation(value) {
    const number = finiteNumber(value);
    return Number.isInteger(number) ? String(number) : number.toFixed(1).replace(/\.0$/, "");
  }
}

export const CROSSHAIR_3D_OVERLAY_PRESENTATION = Object.freeze({
  elevationFontSize: ELEVATION_FONT_SIZE,
  confirmFontSize: CONFIRM_FONT_SIZE,
  modeFontSize: MODE_FONT_SIZE,
  elevationOffsetPx: ELEVATION_FONT_SIZE
});
