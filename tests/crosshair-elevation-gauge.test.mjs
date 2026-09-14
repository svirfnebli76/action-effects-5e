import test from "node:test";
import assert from "node:assert/strict";

import {
  CrosshairElevationGaugeService,
  CROSSHAIR_ELEVATION_GAUGE_PRESENTATION
} from "../scripts/crosshairs3d/crosshair-elevation-gauge-service.js";

function transformable(target) {
  target.position = { x: 0, y: 0, set: (x, y) => { target.position.x = x; target.position.y = y; } };
  target.scale = { x: 1, y: 1, set: (x, y = x) => { target.scale.x = x; target.scale.y = y; } };
}

class FakeTextStyle {
  constructor(style = {}) { Object.assign(this, style); }
}

class FakeText {
  constructor(text = "") {
    this._text = String(text);
    this.style = { fontSize: 16, fill: "#000000" };
    this.visible = true;
    this.anchor = { x: 0, y: 0, set: (x, y) => { this.anchor.x = x; this.anchor.y = y; } };
    transformable(this);
  }
  get text() { return this._text; }
  set text(value) { this._text = String(value); }
  destroy() { this.destroyed = true; }
}

class FakeGraphics {
  constructor() { this.calls = []; this.visible = true; }
  clear() { this.calls.push(["clear"]); return this; }
  moveTo(x, y) { this.calls.push(["moveTo", x, y]); return this; }
  lineTo(x, y) { this.calls.push(["lineTo", x, y]); return this; }
  stroke(style) { this.calls.push(["stroke", style]); return this; }
  circle(x, y, radius) { this.calls.push(["circle", x, y, radius]); return this; }
  fill(style) { this.calls.push(["fill", style]); return this; }
  destroy() { this.destroyed = true; }
}

class FakeContainer {
  constructor() {
    this.children = [];
    this.visible = true;
    transformable(this);
  }
  addChild(child) { child.parent = this; this.children.push(child); return child; }
  removeChild(child) { const index = this.children.indexOf(child); if (index >= 0) this.children.splice(index, 1); child.parent = null; }
  destroy() { this.destroyed = true; }
}

function findRecursive(root, name) {
  if (!root) return null;
  if (root.name === name) return root;
  for (const child of root.children ?? []) {
    const result = findRecursive(child, name);
    if (result) return result;
  }
  return null;
}

test("Crosshair Elevation Gauge is a fixed-size screen-space PIXI side view with live AB/elevation data", () => {
  const children = [];
  const parent = {
    worldTransform: { a: 2, b: 0, c: 0, d: 2 },
    toLocal: ({ x, y }) => ({ x: x / 2, y: y / 2 }),
    addChild(child) { child.parent = this; children.push(child); return child; },
    removeChild(child) { const index = children.indexOf(child); if (index >= 0) children.splice(index, 1); child.parent = null; }
  };
  const tickerCallbacks = new Set();
  const ticker = {
    add(callback) { tickerCallbacks.add(callback); },
    remove(callback) { tickerCallbacks.delete(callback); }
  };

  const previousCanvas = globalThis.canvas;
  const previousPIXI = globalThis.PIXI;
  const previousWindow = globalThis.window;
  try {
    globalThis.PIXI = { Container: FakeContainer, Graphics: FakeGraphics, Text: FakeText, TextStyle: FakeTextStyle };
    globalThis.window = { innerWidth: 1920, innerHeight: 1080 };
    globalThis.canvas = {
      interface: parent,
      app: { ticker, renderer: { screen: { width: 1920, height: 1080 } } }
    };

    const gauge = new CrosshairElevationGaugeService();
    assert.equal(gauge.show({ enabled: true }), true);
    assert.equal(children.length, 1);
    assert.equal(tickerCallbacks.size, 1, "screen-space anchoring stays live across pan/zoom transforms");

    const container = children[0];
    assert.equal(container.name, "action-effects-5e-crosshair-elevation-gauge");
    assert.deepEqual([container.position.x, container.position.y], [160, 137.5], "320x275 screen target is converted into the scaled parent coordinate space");
    assert.deepEqual([container.scale.x, container.scale.y], [0.5, 0.5], "parent zoom is cancelled so the gauge retains its physical pixel size");
    assert.equal(CROSSHAIR_ELEVATION_GAUGE_PRESENTATION.diameterPx, 276);
    assert.equal(CROSSHAIR_ELEVATION_GAUGE_PRESENTATION.targetCenterX, 320);
    assert.equal(CROSSHAIR_ELEVATION_GAUGE_PRESENTATION.targetCenterY, 275);
    assert.equal(CROSSHAIR_ELEVATION_GAUGE_PRESENTATION.rangePaddingFactor, 1.10);

    const title = findRecursive(container, "action-effects-5e-crosshair-elevation-gauge-title");
    const elevation = findRecursive(container, "action-effects-5e-crosshair-elevation-gauge-elevation");
    const distance = findRecursive(container, "action-effects-5e-crosshair-elevation-gauge-distance");
    const staticGraphics = findRecursive(container, "action-effects-5e-crosshair-elevation-gauge-static");
    const dynamic = findRecursive(container, "action-effects-5e-crosshair-elevation-gauge-dynamic");
    assert.equal(title?.text, "SIDE VIEW");
    assert.ok(elevation && distance && staticGraphics && dynamic);
    assert.equal(CROSSHAIR_ELEVATION_GAUGE_PRESENTATION.tickIncrementDegrees, 5);
    assert.equal(CROSSHAIR_ELEVATION_GAUGE_PRESENTATION.backgroundColor, 0x484848);
    assert.equal(CROSSHAIR_ELEVATION_GAUGE_PRESENTATION.backgroundAlpha, 0.50);
    assert.ok(
      staticGraphics.calls.some(([type, style]) => type === "fill" && style?.color === 0x484848 && style?.alpha === 0.50),
      "gauge circle has the requested #484848 50% background fill"
    );
    const staticStrokes = staticGraphics.calls.filter(([type]) => type === "stroke");
    assert.ok(staticStrokes.length >= 74, "5-degree circumference ticks produce at least 72 tick strokes plus the dial outlines");

    gauge.update({ distance: 50, maxRange: 60, angle: 45, elevationDelta: 35, belowOrigin: false });
    assert.equal(container.visible, true);
    assert.equal(elevation.text, "+35 ft");
    assert.equal(elevation.style.fill, "#FFFFFF");
    assert.equal(distance.text, "50 ft");
    assert.equal(elevation.position.y < 0, true, "upper-half destination puts its elevation label above B");
    assert.ok(dynamic.calls.some(([type]) => type === "lineTo"), "AB radial line is drawn on the retained dynamic graphics object");

    gauge.update({ distance: 50, maxRange: 60, angle: 225, elevationDelta: -15, belowOrigin: true });
    assert.equal(elevation.text, "-15 ft");
    assert.equal(elevation.style.fill, "#FF3B30", "negative/below-origin gauge elevation is red");
    assert.equal(elevation.position.y > 0, true, "181-359 degree destination puts its elevation label below B");

    gauge.clear();
    assert.equal(children.length, 0, "gauge cleanup removes its retained PIXI container");
    assert.equal(tickerCallbacks.size, 0, "gauge cleanup removes its screen-anchor ticker callback");
  } finally {
    globalThis.canvas = previousCanvas;
    globalThis.PIXI = previousPIXI;
    globalThis.window = previousWindow;
  }
});
