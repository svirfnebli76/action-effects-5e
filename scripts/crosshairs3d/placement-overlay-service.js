import { finiteNumber } from "./geometry-utils.js";

const ROOT_ID = "action-effects-5e-3d-crosshair-overlay";

export class Crosshair3dPlacementOverlayService {
  #root = null;
  #elevationText = null;
  #confirmText = null;

  show({ mode = "MOVE", hints = [] } = {}) {
    this.clear();
    const doc = globalThis.document;
    if (doc?.body) {
      const root = doc.createElement("div");
      root.id = ROOT_ID;
      root.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:100000;font-family:var(--font-primary, sans-serif);text-shadow:0 1px 3px #000;";
      const modeEl = doc.createElement("div");
      modeEl.dataset.ae5e3d = "mode";
      modeEl.style.cssText = "position:absolute;top:12px;left:50%;transform:translateX(-50%);padding:5px 12px;border-radius:6px;background:rgba(0,0,0,.7);color:white;font-weight:700;letter-spacing:.08em;";
      modeEl.textContent = mode;
      const hintsEl = doc.createElement("div");
      hintsEl.dataset.ae5e3d = "hints";
      hintsEl.style.cssText = "position:absolute;bottom:18px;left:50%;transform:translateX(-50%);padding:6px 10px;border-radius:6px;background:rgba(0,0,0,.66);color:white;font-size:13px;white-space:nowrap;";
      hintsEl.textContent = hints.join("   •   ");
      root.append(modeEl, hintsEl);
      doc.body.appendChild(root);
      this.#root = root;
    }

    const PIXI = globalThis.PIXI;
    const parent = globalThis.canvas?.interface ?? globalThis.canvas?.controls;
    if (PIXI?.Text && parent?.addChild) {
      const text = new PIXI.Text({
        text: "",
        style: { fontFamily: "Arial", fontSize: 18, fill: 0xffffff, stroke: { color: 0x000000, width: 4 } }
      });
      text.name = "action-effects-5e-3d-crosshair-elevation";
      text.eventMode = "none";
      parent.addChild(text);
      this.#elevationText = text;

      const confirm = new PIXI.Text({
        text: "Action Effects 3D Crosshairs — click to confirm",
        style: { fontFamily: "Arial", fontSize: 18, fill: 0xffffff, stroke: { color: 0x000000, width: 4 } }
      });
      confirm.name = "action-effects-5e-3d-crosshair-confirm";
      confirm.eventMode = "none";
      confirm.anchor?.set?.(0.5, 0.5);
      parent.addChild(confirm);
      this.#confirmText = confirm;
    }
  }

  update({ mode = null, elevation = null, point = null, gridSize = null } = {}) {
    if (mode && this.#root) {
      const el = this.#root.querySelector?.('[data-ae5e3d="mode"]');
      if (el) el.textContent = mode;
    }
    if (point) {
      const offset = Math.max(1, finiteNumber(gridSize, 100));
      if (this.#elevationText) {
        this.#elevationText.text = `${this.#formatElevation(elevation)} ft`;
        this.#elevationText.position.set(finiteNumber(point.x), finiteNumber(point.y) + offset);
        this.#elevationText.visible = true;
      }
      if (this.#confirmText) {
        this.#confirmText.position.set(finiteNumber(point.x), finiteNumber(point.y) - (offset * 0.35));
        this.#confirmText.visible = true;
      }
    }
  }

  clear() {
    try { this.#root?.remove?.(); } catch (_error) { /* noop */ }
    this.#root = null;
    if (this.#elevationText) {
      try {
        this.#elevationText.parent?.removeChild?.(this.#elevationText);
        this.#elevationText.destroy?.();
      } catch (_error) { /* noop */ }
      this.#elevationText = null;
    }
    if (this.#confirmText) {
      try {
        this.#confirmText.parent?.removeChild?.(this.#confirmText);
        this.#confirmText.destroy?.();
      } catch (_error) { /* noop */ }
      this.#confirmText = null;
    }
  }

  #formatElevation(value) {
    const number = finiteNumber(value);
    return Number.isInteger(number) ? String(number) : number.toFixed(1).replace(/\.0$/, "");
  }
}
