import { finiteNumber } from "./geometry-utils.js";

const ELEVATION_FONT_SIZE = 22;
const ELEVATION_OFFSET_PX = ELEVATION_FONT_SIZE * 2;
const MODE_FONT_SIZE = 16;
const HINT_FONT_SIZE = MODE_FONT_SIZE;
const MODE_BOUNDARY_MARGIN = 22;
const HINT_BOUNDARY_MARGIN = 18;
const HINT_ROW_GAP = 4;

export class Crosshair3dPlacementOverlayService {
  #elevationText = null;
  #modeContainer = null;
  #modeText = null;
  #modeBackground = null;
  #hintsContainer = null;
  #hintRows = [];

  show({ mode = "MOVE", hints = [] } = {}) {
    this.clear();

    const PIXI = globalThis.PIXI;
    const parent = globalThis.canvas?.interface ?? globalThis.canvas?.controls;
    if (!PIXI?.Text || !parent?.addChild) return;

    const elevation = this.#createText(PIXI, "", {
      fontFamily: "Arial",
      fontSize: ELEVATION_FONT_SIZE,
      fill: "#FFFFFF",
      fontWeight: "700",
      stroke: { color: "#000000", width: 4 }
    });
    elevation.name = "action-effects-5e-3d-crosshair-elevation";
    elevation.eventMode = "none";
    elevation.anchor?.set?.(0.5, 0.5);
    elevation.visible = false;
    parent.addChild(elevation);
    this.#elevationText = elevation;

    this.#createModeBadge(PIXI, parent, mode);
    this.#createHintStack(PIXI, parent, hints);
  }

  update({ mode = null, elevation = null, originElevation = null, elevationVisible = true, point = null, gridSize = null, footprintRadiusPx = null, footprintTopPx = null, footprintBottomPx = null } = {}) {
    if (mode && this.#modeText) {
      this.#modeText.text = String(mode);
      this.#refreshModeBackground();
    }

    if (!point) return;

    const x = finiteNumber(point.x);
    const y = finiteNumber(point.y);
    const grid = Math.max(1, finiteNumber(gridSize, 100));
    const footprint = Math.max(0, finiteNumber(footprintRadiusPx, grid * 0.5));
    const hasFootprintTop = footprintTopPx !== null
      && footprintTopPx !== undefined
      && Number.isFinite(Number(footprintTopPx));
    const hasFootprintBottom = footprintBottomPx !== null
      && footprintBottomPx !== undefined
      && Number.isFinite(Number(footprintBottomPx));
    const footprintTop = hasFootprintTop ? Math.max(0, Number(footprintTopPx)) : footprint;
    const footprintBottom = hasFootprintBottom ? Math.max(0, Number(footprintBottomPx)) : footprint;

    if (this.#elevationText) {
      if (elevationVisible === false) this.#elevationText.visible = false;
      else {
        this.#elevationText.text = `${this.#formatElevation(elevation)} ft`;
        this.#setTextFill(this.#elevationText, finiteNumber(elevation) < finiteNumber(originElevation, elevation) ? "#FF3B30" : "#FFFFFF");
        // Anchor the readout to the actual accepted crosshair center, then move
        // it down by exactly two text-size units. This remains centered for both
        // odd- and even-grid-diameter crosshairs and never depends on a nearby
        // map-grid square center.
        this.#elevationText.position.set(x, y + ELEVATION_OFFSET_PX);
        this.#elevationText.visible = true;
      }
    }

    if (this.#modeContainer) {
      this.#modeContainer.position?.set?.(x, y - footprintTop - MODE_BOUNDARY_MARGIN);
      this.#modeContainer.visible = true;
    }

    if (this.#hintsContainer) {
      // Keep the instruction stack attached to the authoritative crosshair and
      // position it from the bottom edge of the actual placement footprint.
      // Each instruction owns its own compact dark badge so larger/smaller
      // crosshairs retain the same readable spacing.
      this.#hintsContainer.position?.set?.(x, y + footprintBottom + HINT_BOUNDARY_MARGIN);
      this.#hintsContainer.visible = this.#hintRows.length > 0;
    }
  }

  clear() {
    this.#removeDisplayObject(this.#elevationText);
    this.#removeDisplayObject(this.#modeContainer);
    this.#removeDisplayObject(this.#hintsContainer);

    this.#elevationText = null;
    this.#modeContainer = null;
    this.#modeText = null;
    this.#modeBackground = null;
    this.#hintsContainer = null;
    this.#hintRows = [];
  }

  #createText(PIXI, text, style) {
    // Foundry v14's PIXI Text compatibility layer accepts the text string but
    // can silently ignore the second constructor argument. Construct the
    // display first, then apply an explicit TextStyle (or direct style
    // assignment as a compatibility fallback).
    const content = String(text ?? "");
    let display;
    try {
      display = new PIXI.Text(content);
    } catch (_error) {
      display = new PIXI.Text({ text: content });
    }

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

  #setTextFill(display, fill) {
    if (!display) return;
    try { display.style.fill = fill; }
    catch (_error) {
      try { Object.assign(display.style ?? {}, { fill }); }
      catch (_nestedError) { /* noop */ }
    }
  }

  #createModeBadge(PIXI, parent, mode) {
    const text = this.#createText(PIXI, mode, {
      fontFamily: "Arial",
      fontSize: MODE_FONT_SIZE,
      fill: "#FFFFFF",
      fontWeight: "700",
      letterSpacing: 1.25,
      stroke: { color: "#000000", width: 2 }
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

  #createHintStack(PIXI, parent, hints) {
    const lines = Array.isArray(hints)
      ? hints.map(line => String(line ?? "").trim()).filter(Boolean)
      : [];
    if (!lines.length) return;

    if (!PIXI.Container) {
      // Minimal PIXI fallback: a single retained multiline text still follows
      // the crosshair. Normal Foundry v14 uses the individual badge path below.
      const text = this.#createText(PIXI, lines.join("\n"), {
        fontFamily: "Arial",
        fontSize: HINT_FONT_SIZE,
        fill: "#FFFFFF",
        fontWeight: "700",
        align: "center",
        stroke: { color: "#000000", width: 2 }
      });
      text.name = "action-effects-5e-3d-crosshair-hints";
      text.eventMode = "none";
      text.anchor?.set?.(0.5, 0);
      text.visible = false;
      parent.addChild(text);
      this.#hintsContainer = text;
      this.#hintRows = [{ container: text, text, background: null }];
      return;
    }

    const stack = new PIXI.Container();
    stack.name = "action-effects-5e-3d-crosshair-hints";
    stack.eventMode = "none";
    stack.visible = false;

    let cursorY = 0;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const row = new PIXI.Container();
      row.name = `action-effects-5e-3d-crosshair-hint-${index}`;
      row.eventMode = "none";

      const text = this.#createText(PIXI, line, {
        fontFamily: "Arial",
        fontSize: HINT_FONT_SIZE,
        fill: "#FFFFFF",
        fontWeight: "700",
        stroke: { color: "#000000", width: 2 }
      });
      text.name = `action-effects-5e-3d-crosshair-hint-text-${index}`;
      text.eventMode = "none";
      text.anchor?.set?.(0.5, 0.5);

      let background = null;
      if (PIXI.Graphics) {
        background = new PIXI.Graphics();
        background.name = `action-effects-5e-3d-crosshair-hint-background-${index}`;
        background.eventMode = "none";
        row.addChild(background);
      }
      row.addChild(text);

      const dimensions = this.#badgeDimensions(text, { minWidth: 48, minHeight: 28, horizontalPadding: 12, verticalPadding: 8 });
      this.#drawBadgeBackground(background, dimensions);
      row.position?.set?.(0, cursorY + (dimensions.height / 2));
      cursorY += dimensions.height + HINT_ROW_GAP;

      stack.addChild(row);
      this.#hintRows.push({ container: row, text, background });
    }

    parent.addChild(stack);
    this.#hintsContainer = stack;
  }

  #refreshModeBackground() {
    const background = this.#modeBackground;
    const text = this.#modeText;
    if (!background || !text) return;
    this.#drawBadgeBackground(background, this.#badgeDimensions(text, {
      minWidth: 48,
      minHeight: 28,
      horizontalPadding: 24,
      verticalPadding: 10
    }));
  }

  #badgeDimensions(text, { minWidth = 48, minHeight = 28, horizontalPadding = 24, verticalPadding = 10 } = {}) {
    const width = Math.max(minWidth, finiteNumber(text?.width, minWidth) + horizontalPadding);
    const height = Math.max(minHeight, finiteNumber(text?.height, MODE_FONT_SIZE) + verticalPadding);
    return { width, height };
  }

  #drawBadgeBackground(background, { width, height }) {
    if (!background) return;
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
  modeFontSize: MODE_FONT_SIZE,
  hintFontSize: HINT_FONT_SIZE,
  elevationOffsetPx: ELEVATION_OFFSET_PX,
  hintBoundaryMarginPx: HINT_BOUNDARY_MARGIN,
  hintRowGapPx: HINT_ROW_GAP
});
