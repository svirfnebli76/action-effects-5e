import test from "node:test";
import assert from "node:assert/strict";

import { Crosshair3dGeometryService } from "../scripts/crosshairs3d/geometry-service.js";
import { Crosshair3dPlacementGuideService } from "../scripts/crosshairs3d/placement-guide-service.js";

function installPixiStub() {
  const records = { strokes: [], fills: [], texts: [] };

  class Container {
    constructor() { this.children = []; this.parent = null; this.position = { set() {} }; }
    addChild(child) { child.parent = this; this.children.push(child); return child; }
    removeChild(child) { this.children = this.children.filter(entry => entry !== child); child.parent = null; }
    destroy() { this.destroyed = true; }
  }

  class Graphics {
    clear() { records.strokes.length = 0; records.fills.length = 0; return this; }
    poly() { return this; }
    circle() { return this; }
    fill(options) { records.fills.push({ ...options }); return this; }
    stroke(options) { records.strokes.push({ ...options }); return this; }
    moveTo() { return this; }
    lineTo() { return this; }
  }

  class TextStyle {
    constructor(style) { Object.assign(this, structuredClone(style)); }
  }

  class Text {
    constructor(text = "") {
      this.text = typeof text === "string" ? text : String(text?.text ?? "");
      this.style = {};
      this.position = { x: 0, y: 0, set: (x, y) => { this.position.x = x; this.position.y = y; } };
      this.anchor = { set() {} };
      this.visible = true;
      records.texts.push(this);
    }
  }

  const parent = new Container();
  globalThis.PIXI = { Container, Graphics, Text, TextStyle };
  globalThis.canvas = { interface: parent };
  return { records, parent };
}

function metrics() {
  return {
    resolve: () => ({ size: 100, distance: 5, originX: 0, originY: 0 }),
    distanceToPixels: point => ({ x: point.x * 20, y: point.y * 20, elevation: point.z })
  };
}

test("retained Cone guide renders the accepted teal silhouette, contour depths, endpoint, and absolute elevation", () => {
  const { records, parent } = installPixiStub();
  const service = new Crosshair3dPlacementGuideService({ geometry: new Crosshair3dGeometryService(), metrics: metrics() });
  assert.equal(service.show(), true);

  service.update({ type: "cone", origin: { x: 0, y: 0, z: 5 }, length: 15, yaw: 0, pitch: 0 });

  assert.equal(parent.children.length, 1, "one retained guide container owns all Cone presentation objects");
  assert.equal(records.texts.length, 1, "the endpoint label is retained instead of recreated on every revision");
  assert.equal(records.texts[0].text, "5 ft");
  assert.equal(records.texts[0].visible, true);
  assert.ok(records.strokes.some(stroke => stroke.color === 0x7fefef && stroke.width === 2.25), "approved teal silhouette is rendered");
  assert.ok(records.strokes.some(stroke => stroke.color === 0x000000 && stroke.width === 4.5), "approved black under-outline is rendered");
  assert.ok(records.strokes.some(stroke => stroke.color === 0x7fefef && stroke.width === 1.875), "flat circular terminal face uses the approved outline");

  service.clear();
  assert.equal(parent.children.length, 0, "guide cleanup removes the complete retained presentation");
});

test("downward Cone turns red and uses darker, higher-contrast internal grid lines", () => {
  const { records } = installPixiStub();
  const service = new Crosshair3dPlacementGuideService({ geometry: new Crosshair3dGeometryService(), metrics: metrics() });
  service.show();
  service.update({ type: "cone", origin: { x: 0, y: 0, z: 5 }, length: 15, yaw: 0, pitch: -30 });

  assert.equal(records.texts[0].text, "-2.5 ft");
  assert.equal(records.texts[0].style.fill, "#FF4D4D");
  assert.ok(records.strokes.some(stroke => stroke.color === 0xFF4D4D && stroke.width === 2.25), "downward silhouette is red");
  assert.ok(records.strokes.some(stroke => stroke.color === 0x921F27 && stroke.alpha === 0.82), "downward generator lines use the approved dark red contrast");
  assert.ok(records.strokes.some(stroke => stroke.color === 0x921F27 && stroke.alpha === 0.78), "downward contour lines use the approved dark red contrast");
});

test("non-Cone guide updates hide the Cone endpoint elevation label", () => {
  const { records } = installPixiStub();
  const service = new Crosshair3dPlacementGuideService({ geometry: new Crosshair3dGeometryService(), metrics: metrics() });
  service.show();
  service.update({ type: "cone", origin: { x: 0, y: 0, z: 0 }, length: 15, yaw: 0, pitch: 20 });
  service.update({ type: "sphere", origin: { x: 0, y: 0, z: 0 }, radius: 10 });
  assert.equal(records.texts[0].visible, false);
});
