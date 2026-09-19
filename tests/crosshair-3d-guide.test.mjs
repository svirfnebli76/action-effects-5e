import test from "node:test";
import assert from "node:assert/strict";

import { Crosshair3dGeometryService } from "../scripts/crosshairs3d/geometry-service.js";
import { Crosshair3dCellRasterizerService } from "../scripts/crosshairs3d/cell-rasterizer-service.js";
import { Crosshair3dPlacementGuideService } from "../scripts/crosshairs3d/placement-guide-service.js";

function installPixiStub() {
  const records = { strokes: [], fills: [], texts: [], polygons: [] };

  class Container {
    constructor() { this.children = []; this.parent = null; this.position = { set() {} }; }
    addChild(child) { child.parent = this; this.children.push(child); return child; }
    removeChild(child) { this.children = this.children.filter(entry => entry !== child); child.parent = null; }
    destroy() { this.destroyed = true; }
  }

  class Graphics {
    clear() { records.strokes.length = 0; records.fills.length = 0; records.polygons.length = 0; return this; }
    poly(points) { records.polygons.push(points); return this; }
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

test("Line filleted visual retains 3.5-ft vertical footprint and white endpoint text", () => {
  const { records, parent } = installPixiStub();
  const service = new Crosshair3dPlacementGuideService({ geometry: new Crosshair3dGeometryService(), metrics: metrics() });
  service.show();
  for (const pitch of [90, -90]) {
    service.update({ type: "line", origin: { x: 5, y: 5, z: 5 }, length: 20, width: 5, yaw: 0, pitch });
    const polygon = records.polygons[0];
    const xs = polygon.filter((_, i) => i % 2 === 0);
    const ys = polygon.filter((_, i) => i % 2 === 1);
    assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 70) < 1e-8);
    assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - 70) < 1e-8);
    assert.equal(polygon.length, 88, "44 perimeter vertices describe rounded corners, not a square cap");
    assert.equal(records.texts[0].text, pitch > 0 ? "25 ft" : "-15 ft");
    assert.equal(records.texts[0].style.fill, "#FFFFFF");
    assert.equal(records.texts.length, 1);
    assert.ok(records.strokes.some(stroke => stroke.color === (pitch > 0 ? 0x7fefef : 0xFF4D4D)));
  }
  service.clear();
  assert.equal(parent.children.length, 0);
});

test("filleted presentation never changes rules width, occupied cells, or terminal elevation", () => {
  const { records } = installPixiStub();
  const geometry = new Crosshair3dGeometryService();
  const cells = new Crosshair3dCellRasterizerService({ geometry });
  const service = new Crosshair3dPlacementGuideService({ geometry, metrics: metrics() });
  service.show();
  for (const width of [0.5, 5, 10]) {
    for (const pitch of [-90, -30, 0, 30, 90]) {
      const shape = geometry.normalizeShape({ type: "line", origin: { x: 0, y: 2.5, z: 5 }, width, length: 20, yaw: 37, pitch });
      const before = cells.rasterize(shape, { grid: { distance: 5 } }).cells;
      service.update(shape);
      assert.equal(shape.width, width);
      assert.deepEqual(cells.rasterize(shape, { grid: { distance: 5 } }).cells, before);
      assert.ok(records.polygons.every(polygon => polygon.every(Number.isFinite)));
      assert.equal(records.texts[0].style.fill, "#FFFFFF");
      assert.ok(records.fills.length > 0, "tube remains visible at every tested pitch");
    }
  }
  service.clear();
});

test("Line uses the approved 0.17-grid fillet with flat end planes", () => {
  const { records } = installPixiStub();
  const service = new Crosshair3dPlacementGuideService({ geometry: new Crosshair3dGeometryService(), metrics: metrics() });
  service.show();
  service.update({ type: "line", origin: { x: 0, y: 0, z: 0 }, width: 5, length: 20, yaw: 0, pitch: 90 });
  // At vertical, the first rendered polygon is the flat terminal cap.
  const cap = records.polygons[0];
  assert.ok(Math.abs(cap[0] + 18) < 1e-8, "corner inset is (1.75 - 0.85) ft");
  assert.ok(Math.abs(cap[1] - 35) < 1e-8, "outer half-width is 1.75 ft");
  assert.ok(Math.abs(Math.hypot(cap[10] + 18, cap[11] - 18) - 17) < 1e-8, "arc radius is 0.85 ft / 17 pixels");
  service.clear();
});

test("retained Cone guide renders the accepted teal silhouette, contour depths, endpoint, and absolute elevation", () => {
  const { records, parent } = installPixiStub();
  const service = new Crosshair3dPlacementGuideService({ geometry: new Crosshair3dGeometryService(), metrics: metrics() });
  assert.equal(service.show(), true);

  service.update({ type: "cone", origin: { x: 0, y: 0, z: 5 }, length: 15, yaw: 0, pitch: 0 });

  assert.equal(parent.children.length, 1, "one retained guide container owns all Cone presentation objects");
  assert.equal(records.texts.length, 1, "the endpoint label is retained instead of recreated on every revision");
  assert.equal(records.texts[0].text, "5 ft");
  assert.equal(records.texts[0].visible, true);
  assert.equal(records.texts[0].style.fill, "#FFFFFF");
  assert.ok(records.strokes.some(stroke => stroke.color === 0x7fefef && stroke.width === 2.25), "approved teal silhouette is rendered");
  assert.ok(records.strokes.some(stroke => stroke.color === 0x000000 && stroke.width === 4.5), "approved black under-outline is rendered");
  assert.ok(records.strokes.some(stroke => stroke.color === 0x7fefef && stroke.width === 1.875), "flat circular terminal face uses the approved outline");

  service.clear();
  assert.equal(parent.children.length, 0, "guide cleanup removes the complete retained presentation");
});

test("downward Cone turns red with darker grid lines while its elevation text remains white", () => {
  const { records } = installPixiStub();
  const service = new Crosshair3dPlacementGuideService({ geometry: new Crosshair3dGeometryService(), metrics: metrics() });
  service.show();
  service.update({ type: "cone", origin: { x: 0, y: 0, z: 5 }, length: 15, yaw: 0, pitch: -30 });

  assert.equal(records.texts[0].text, "-2.5 ft");
  assert.equal(records.texts[0].style.fill, "#FFFFFF");
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

test("free Line dimension label follows orientation with upright text and perpendicular offset", () => {
  const { records } = installPixiStub();
  const service = new Crosshair3dPlacementGuideService({ geometry: new Crosshair3dGeometryService(), metrics: metrics() });
  service.show();
  for (const yaw of [0, 40, 90, 140, 180, 220, 270, 320]) {
    service.update({ type: "free-line", length: 20, width: 5, height: 10, yaw, origin: { x: 0, y: 0, z: 0 } });
    const label = records.texts[0];
    const a = yaw * Math.PI / 180;
    assert.ok(Math.abs(label.rotation) <= Math.PI/2);
    assert.ok(Math.abs(Math.sin(label.rotation-a)) < 1e-8);
    const dx = label.position.x - 200*Math.cos(a), dy = label.position.y - 200*Math.sin(a);
    assert.ok(Math.abs(dx*Math.cos(a)+dy*Math.sin(a)) < 1e-8);
    assert.ok(Math.abs(Math.hypot(dx,dy)-25) < 1e-8);
  }
  service.update({ type: "line", length: 20, width: 5, yaw: 0, pitch: 0 });
  assert.equal(records.texts[0].rotation, 0);
});
