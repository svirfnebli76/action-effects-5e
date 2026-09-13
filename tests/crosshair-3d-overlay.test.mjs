import test from "node:test";
import assert from "node:assert/strict";

import { Crosshair3dPlacementOverlayService } from "../scripts/crosshairs3d/placement-overlay-service.js";

test("AE5E click-to-confirm text stays attached to the authoritative crosshair point", () => {
  const children = [];
  const parent = {
    addChild(child) { child.parent = this; children.push(child); return child; },
    removeChild(child) { const index = children.indexOf(child); if (index >= 0) children.splice(index, 1); child.parent = null; }
  };

  class FakeText {
    constructor({ text = "" } = {}) {
      this.text = text;
      this.visible = false;
      this.position = { x: 0, y: 0, set: (x, y) => { this.position.x = x; this.position.y = y; } };
      this.anchor = { set: (x, y) => { this.anchor.x = x; this.anchor.y = y; } };
      this.destroyed = false;
    }
    destroy() { this.destroyed = true; }
  }

  const previousCanvas = globalThis.canvas;
  const previousPIXI = globalThis.PIXI;
  const previousDocument = globalThis.document;
  try {
    globalThis.canvas = { interface: parent };
    globalThis.PIXI = { Text: FakeText };
    globalThis.document = undefined;

    const overlay = new Crosshair3dPlacementOverlayService();
    overlay.show({ mode: "MOVE", hints: [] });

    const confirm = children.find(child => child.name === "action-effects-5e-3d-crosshair-confirm");
    assert.ok(confirm, "AE5E owns a dedicated authoritative confirmation label");
    assert.equal(confirm.text, "Action Effects 3D Crosshairs — click to confirm");

    overlay.update({ elevation: 15, point: { x: 300, y: 400 }, gridSize: 100 });
    assert.equal(confirm.position.x, 300);
    assert.equal(confirm.position.y, 365);

    overlay.update({ elevation: 15, point: { x: 125, y: 250 }, gridSize: 100 });
    assert.equal(confirm.position.x, 125, "label follows accepted crosshair X, not raw cursor X");
    assert.equal(confirm.position.y, 215, "label follows accepted crosshair Y, not raw cursor Y");

    overlay.clear();
    assert.equal(children.length, 0, "overlay cleanup removes both authoritative texts");
  } finally {
    globalThis.canvas = previousCanvas;
    globalThis.PIXI = previousPIXI;
    globalThis.document = previousDocument;
  }
});
