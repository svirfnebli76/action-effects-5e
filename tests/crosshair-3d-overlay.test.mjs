import test from "node:test";
import assert from "node:assert/strict";

import {
  Crosshair3dPlacementOverlayService,
  CROSSHAIR_3D_OVERLAY_PRESENTATION
} from "../scripts/crosshairs3d/placement-overlay-service.js";

function displayPosition(target) {
  target.position = { x: 0, y: 0, set: (x, y) => { target.position.x = x; target.position.y = y; } };
}

class FakeText {
  constructor(text = "", style = {}) {
    // Deliberately model Foundry's classic PIXI.Text(text, style) signature.
    // Passing { text, style } as the first argument would become
    // "[object Object]", reproducing the v0.4.4.7 live bug.
    this._text = String(text);
    this.style = style;
    this.visible = false;
    this.anchor = { x: 0, y: 0, set: (x, y) => { this.anchor.x = x; this.anchor.y = y; } };
    this.destroyed = false;
    displayPosition(this);
  }
  get text() { return this._text; }
  set text(value) { this._text = String(value); }
  get width() { return Math.max(10, this._text.length * 9); }
  get height() { return Number(this.style?.fontSize ?? 16); }
  destroy() { this.destroyed = true; }
}

class FakeGraphics {
  constructor() { this.visible = true; this.calls = []; }
  clear() { this.calls.push(["clear"]); return this; }
  beginFill(color, alpha) { this.calls.push(["beginFill", color, alpha]); return this; }
  drawRoundedRect(x, y, width, height, radius) { this.calls.push(["drawRoundedRect", x, y, width, height, radius]); return this; }
  endFill() { this.calls.push(["endFill"]); return this; }
  destroy() { this.destroyed = true; }
}

class FakeContainer {
  constructor() {
    this.children = [];
    this.visible = true;
    displayPosition(this);
  }
  addChild(child) { child.parent = this; this.children.push(child); return child; }
  removeChild(child) { const index = this.children.indexOf(child); if (index >= 0) this.children.splice(index, 1); child.parent = null; }
  destroy() { this.destroyed = true; }
}

function installCanvas() {
  const children = [];
  const parent = {
    addChild(child) { child.parent = this; children.push(child); return child; },
    removeChild(child) { const index = children.indexOf(child); if (index >= 0) children.splice(index, 1); child.parent = null; }
  };
  return { parent, children };
}

test("AE5E crosshair overlay uses authoritative centered text and a moving mode badge", () => {
  const { parent, children } = installCanvas();

  const previousCanvas = globalThis.canvas;
  const previousPIXI = globalThis.PIXI;
  const previousDocument = globalThis.document;
  try {
    globalThis.canvas = { interface: parent };
    globalThis.PIXI = { Text: FakeText, Graphics: FakeGraphics, Container: FakeContainer };
    globalThis.document = undefined;

    const overlay = new Crosshair3dPlacementOverlayService();
    overlay.show({ mode: "MOVE", hints: [] });

    const elevation = children.find(child => child.name === "action-effects-5e-3d-crosshair-elevation");
    const confirm = children.find(child => child.name === "action-effects-5e-3d-crosshair-confirm");
    const mode = children.find(child => child.name === "action-effects-5e-3d-crosshair-mode");
    const modeText = mode?.children?.find(child => child.name === "action-effects-5e-3d-crosshair-mode-text");

    assert.ok(elevation, "AE5E owns a dedicated elevation readout");
    assert.ok(confirm, "AE5E owns a dedicated authoritative confirmation label");
    assert.ok(mode && modeText, "AE5E owns a mode badge that can move with the crosshair");

    assert.equal(confirm.text, "Action Effects 3D Crosshairs — click to confirm", "classic PIXI constructor never receives a text options object");
    assert.equal(elevation.style.fontSize, 20);
    assert.equal(elevation.style.fill, 0xffffff);
    assert.deepEqual([elevation.anchor.x, elevation.anchor.y], [0.5, 0.5], "elevation text is centered on the authoritative point before applying Y offset");
    assert.equal(CROSSHAIR_3D_OVERLAY_PRESENTATION.elevationOffsetPx, 20);

    overlay.update({ mode: "ELEVATE", elevation: 15, point: { x: 300, y: 400 }, gridSize: 100, footprintRadiusPx: 200 });
    assert.equal(elevation.text, "15 ft");
    assert.equal(elevation.position.x, 300);
    assert.equal(elevation.position.y, 420, "20 px text receives a 20 px downward offset from the true crosshair center");
    assert.equal(confirm.position.x, 300);
    assert.equal(confirm.position.y, 365);
    assert.equal(modeText.text, "ELEVATE");
    assert.equal(mode.position.x, 300);
    assert.equal(mode.position.y, 178, "mode badge sits above the crosshair footprint rather than at the top of the screen");

    overlay.update({ mode: "MOVE", elevation: 15, point: { x: 125, y: 250 }, gridSize: 100, footprintRadiusPx: 200 });
    assert.equal(confirm.position.x, 125, "label follows accepted crosshair X, not raw cursor X");
    assert.equal(confirm.position.y, 215, "label follows accepted crosshair Y, not raw cursor Y");
    assert.equal(mode.position.x, 125);
    assert.equal(mode.position.y, 28, "mode badge follows the accepted crosshair position");
    assert.equal(modeText.text, "MOVE");

    overlay.clear();
    assert.equal(children.length, 0, "overlay cleanup removes all authoritative text/badge objects");
  } finally {
    globalThis.canvas = previousCanvas;
    globalThis.PIXI = previousPIXI;
    globalThis.document = previousDocument;
  }
});
