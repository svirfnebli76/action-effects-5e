import test from "node:test";
import assert from "node:assert/strict";

import {
  Crosshair3dPlacementOverlayService,
  CROSSHAIR_3D_OVERLAY_PRESENTATION
} from "../scripts/crosshairs3d/placement-overlay-service.js";

function displayPosition(target) {
  target.position = { x: 0, y: 0, set: (x, y) => { target.position.x = x; target.position.y = y; } };
}

class FakeTextStyle {
  constructor(style = {}) { Object.assign(this, style); }
}

class FakeText {
  constructor(text = "", _ignoredStyle = {}) {
    // Model the live Foundry behavior where constructor styling can be ignored
    // until the TextStyle is assigned explicitly after construction.
    this._text = String(text);
    this.style = { fontSize: 16, fill: "#000000" };
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

test("AE5E crosshair overlay keeps the accepted readout/mode and moves conditional control badges below the crosshair", () => {
  const { parent, children } = installCanvas();

  const previousCanvas = globalThis.canvas;
  const previousPIXI = globalThis.PIXI;
  try {
    globalThis.canvas = { interface: parent };
    globalThis.PIXI = { Text: FakeText, TextStyle: FakeTextStyle, Graphics: FakeGraphics, Container: FakeContainer };

    const overlay = new Crosshair3dPlacementOverlayService();
    overlay.show({
      mode: "MOVE",
      hints: [
        "Hold Shift+Mousewheel to change Rotation",
        "Hold Ctrl+Mousewheel to change Elevation",
        "Right Click to Cancel"
      ]
    });

    const elevation = children.find(child => child.name === "action-effects-5e-3d-crosshair-elevation");
    const confirm = children.find(child => child.name === "action-effects-5e-3d-crosshair-confirm");
    const mode = children.find(child => child.name === "action-effects-5e-3d-crosshair-mode");
    const modeText = mode?.children?.find(child => child.name === "action-effects-5e-3d-crosshair-mode-text");
    const hints = children.find(child => child.name === "action-effects-5e-3d-crosshair-hints");
    const hintTexts = hints?.children?.map(row => row.children.find(child => child.name?.includes("hint-text"))).filter(Boolean) ?? [];

    assert.ok(elevation, "AE5E owns a dedicated elevation readout");
    assert.equal(confirm, undefined, "the obsolete center click-to-confirm label is no longer created");
    assert.ok(mode && modeText, "AE5E owns a mode badge that moves with the crosshair");
    assert.ok(hints, "AE5E owns a retained crosshair-local instruction stack");
    assert.deepEqual(hintTexts.map(text => text.text), [
      "Hold Shift+Mousewheel to change Rotation",
      "Hold Ctrl+Mousewheel to change Elevation",
      "Right Click to Cancel"
    ], "control lines retain the locked rotation/elevation/cancel order and wording");

    assert.equal(elevation.style.fontSize, 22);
    assert.equal(elevation.style.fill, "#FFFFFF");
    assert.equal(modeText.style.fill, "#FFFFFF", "mode text receives explicit white TextStyle after construction");
    assert.equal(modeText.style.fontSize, 16);
    assert.ok(hintTexts.every(text => text.style.fill === "#FFFFFF"), "all control hints are white");
    assert.ok(hintTexts.every(text => text.style.fontWeight === "700"), "all control hints are bold");
    assert.ok(hintTexts.every(text => text.style.fontSize === modeText.style.fontSize), "control hints use exactly the MOVE badge font size");
    assert.deepEqual([elevation.anchor.x, elevation.anchor.y], [0.5, 0.5], "elevation text is centered on the authoritative point before applying Y offset");
    assert.equal(CROSSHAIR_3D_OVERLAY_PRESENTATION.elevationOffsetPx, 44);
    assert.equal(CROSSHAIR_3D_OVERLAY_PRESENTATION.hintFontSize, CROSSHAIR_3D_OVERLAY_PRESENTATION.modeFontSize);

    overlay.update({ mode: "ELEVATE", elevation: 15, originElevation: 0, point: { x: 300, y: 400 }, gridSize: 100, footprintRadiusPx: 200 });
    assert.equal(elevation.text, "15 ft");
    assert.equal(elevation.position.x, 300);
    assert.equal(elevation.position.y, 444, "22 px text receives a 44 px downward offset (2x text height) from the true crosshair center");
    assert.equal(modeText.text, "ELEVATE");
    assert.equal(mode.position.x, 300);
    assert.equal(mode.position.y, 178, "mode badge sits above the crosshair footprint rather than at the top of the screen");
    assert.equal(hints.position.x, 300);
    assert.equal(hints.position.y, 618, "instruction stack begins below the actual crosshair footprint plus the boundary margin");
    assert.deepEqual(hints.children.map(row => row.position.y), [14, 46, 78], "each instruction occupies its own vertically stacked badge row");
    assert.equal(elevation.style.fill, "#FFFFFF", "elevation at/above the source base remains white");

    overlay.update({ mode: "MOVE", elevation: 0, originElevation: 0, elevationVisible: false, point: { x: 300, y: 400 }, gridSize: 100, footprintRadiusPx: 200, footprintTopPx: 90, footprintBottomPx: 310 });
    assert.equal(mode.position.y, 288, "mode badge uses the exact projected top extent when supplied");
    assert.equal(hints.position.y, 728, "instruction stack uses the exact projected bottom extent when supplied");

    overlay.update({ mode: "ELEVATE", elevation: -5, originElevation: 0, point: { x: 300, y: 400 }, gridSize: 100, footprintRadiusPx: 200 });
    assert.equal(elevation.text, "-5 ft");
    assert.equal(elevation.style.fill, "#FF3B30", "elevation below the source base turns red");

    overlay.update({ mode: "ELEVATE", elevation: 0, originElevation: 0, elevationVisible: false, point: { x: 300, y: 400 }, gridSize: 100, footprintRadiusPx: 200 });
    assert.equal(elevation.visible, false, "shape-owned endpoint elevation can suppress the redundant generic origin label");

    overlay.update({ mode: "MOVE", elevation: 15, originElevation: 0, point: { x: 125, y: 250 }, gridSize: 100, footprintRadiusPx: 200 });
    assert.equal(elevation.visible, true, "generic elevation presentation returns for shapes that do not own an endpoint label");
    assert.equal(elevation.style.fill, "#FFFFFF", "returning above the source base restores white text");
    assert.equal(mode.position.x, 125);
    assert.equal(mode.position.y, 28, "mode badge follows the accepted crosshair position");
    assert.equal(modeText.text, "MOVE");
    assert.equal(hints.position.x, 125);
    assert.equal(hints.position.y, 468, "instruction stack follows the accepted crosshair instead of remaining at the screen bottom");

    overlay.clear();
    assert.equal(children.length, 0, "overlay cleanup removes elevation, mode, and instruction objects");
  } finally {
    globalThis.canvas = previousCanvas;
    globalThis.PIXI = previousPIXI;
  }
});

test("Cone HUD remains fixed at the top-center viewport anchor across yaw and pitch revisions", () => {
  const world = installCanvas();
  const hud = installCanvas();
  const previousCanvas = globalThis.canvas;
  const previousPIXI = globalThis.PIXI;
  try {
    globalThis.canvas = {
      interface: world.parent,
      app: { renderer: { screen: { width: 1200, height: 800 } }, stage: hud.parent }
    };
    globalThis.PIXI = { Text: FakeText, TextStyle: FakeTextStyle, Graphics: FakeGraphics, Container: FakeContainer };

    const overlay = new Crosshair3dPlacementOverlayService();
    overlay.show({
      mode: "MOVE",
      fixedHud: true,
      hints: [
        "Hold Shift+Mousewheel to change Rotation",
        "Hold Ctrl+Mousewheel to change Elevation",
        "Right Click to Cancel"
      ]
    });

    const mode = hud.children.find(child => child.name === "action-effects-5e-3d-crosshair-mode");
    const hints = hud.children.find(child => child.name === "action-effects-5e-3d-crosshair-hints");
    assert.ok(mode && hints, "fixed Cone controls render in the screen-space HUD parent");

    overlay.update({ mode: "ROTATE", point: { x: 100, y: 700 }, footprintTopPx: 500, footprintBottomPx: 20, fixedHud: true });
    assert.deepEqual([mode.position.x, mode.position.y], [600, CROSSHAIR_3D_OVERLAY_PRESENTATION.fixedHudModeYPx]);
    assert.deepEqual([hints.position.x, hints.position.y], [600, CROSSHAIR_3D_OVERLAY_PRESENTATION.fixedHudHintsYPx]);

    overlay.update({ mode: "ELEVATE", point: { x: 1100, y: 50 }, footprintTopPx: 10, footprintBottomPx: 600, fixedHud: true });
    assert.deepEqual([mode.position.x, mode.position.y], [600, CROSSHAIR_3D_OVERLAY_PRESENTATION.fixedHudModeYPx], "Cone mode never follows the rotating footprint");
    assert.deepEqual([hints.position.x, hints.position.y], [600, CROSSHAIR_3D_OVERLAY_PRESENTATION.fixedHudHintsYPx], "Cone instructions never follow the rotating footprint");

    overlay.clear();
    assert.equal(world.children.length, 0);
    assert.equal(hud.children.length, 0);
  } finally {
    globalThis.canvas = previousCanvas;
    globalThis.PIXI = previousPIXI;
  }
});

test("free Line elevation label rotates and offsets together, then resets for other shapes", () => {
  const { parent, children } = installCanvas();
  globalThis.canvas = { interface: parent };
  globalThis.PIXI = { Text: FakeText, TextStyle: FakeTextStyle, Graphics: FakeGraphics, Container: FakeContainer };
  const overlay = new Crosshair3dPlacementOverlayService();
  overlay.show();
  const text = children.find(child => child.name === "action-effects-5e-3d-crosshair-elevation");
  overlay.update({ point: { x: 100, y: 100 }, elevation: 15, labelRotation: Math.PI/4 });
  assert.equal(text.rotation, Math.PI/4);
  assert.ok(text.position.x < 100 && text.position.y > 100);
  assert.ok(Math.abs((100-text.position.x)-(text.position.y-100)) < 1e-8);
  overlay.update({ point: { x: 100, y: 100 }, elevation: 15 });
  assert.equal(text.rotation, 0);
  assert.equal(text.position.x, 100);
  overlay.clear();
});

test("free Line has plain rotating mode and instructions outside its width with no fixed badges", () => {
  const { parent, children } = installCanvas();
  globalThis.canvas = { interface: parent };
  globalThis.PIXI = { Text: FakeText, TextStyle: FakeTextStyle, Graphics: FakeGraphics, Container: FakeContainer };
  const overlay = new Crosshair3dPlacementOverlayService();
  const instructions = "Shift to Rotate, Ctrl to Elevate, Alt to Alter Length";
  overlay.show({ freeLineUI: true, hints: [instructions] });
  const mode = children.find(child => child.name === "action-effects-5e-3d-crosshair-mode");
  const hints = children.find(child => child.name === "action-effects-5e-3d-crosshair-instructions");
  assert.equal(children.length, 3, "elevation plus two plain labels only");
  for (const [state,title] of [["MOVE","Move"],["ROTATE","Rotate"],["ELEVATE","Elevate"],["LENGTH","Length"]]) {
    overlay.update({ mode: state, point: { x: 100, y: 200 }, lineHalfWidthPx: 50, labelRotation: Math.PI/4 });
    assert.equal(mode.text, title);
    assert.equal(hints.text, instructions);
    assert.equal(mode.rotation, Math.PI/4);
    assert.equal(hints.rotation, Math.PI/4);
    assert.ok(mode.position.x > 100 && mode.position.y < 200);
    assert.ok(hints.position.x < 100 && hints.position.y > 200);
    assert.ok(Math.abs(Math.hypot(mode.position.x-100, mode.position.y-200)-74) < 1e-8);
  }
  overlay.update({ mode: "MOVE" });
  assert.equal(mode.text, "Move", "mode updates without moving mouse");
  overlay.clear();
  assert.equal(children.length, 0);
});
