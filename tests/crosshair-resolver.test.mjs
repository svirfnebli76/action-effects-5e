import assert from "node:assert/strict";
import test from "node:test";

import { CrosshairService } from "../scripts/crosshairs/crosshair-service.js";

function resolve(request, status = { premium: true, free: true }) {
  return new CrosshairService().resolveAsset(request, { status });
}

test("custom hex color uses premium white artwork plus tint instead of being mistaken for native white", () => {
  const result = resolve({
    shape: "circle",
    style: "fantasy_01",
    base: "no_base",
    size: 30,
    sizeStrategy: "exact",
    color: "#8FD8FF"
  });

  assert.equal(result.source, "premium");
  assert.equal(result.tint, "#8FD8FF");
  assert.equal(result.reason, "premium-white-tinted");
  assert.equal(result.fallback, true);
  assert.equal(result.nativeFallback, false);
  assert.ok(result.file.endsWith("Crosshair_Circle_Fantasy_01_White_NoBase_30ft.webm"));
});

test("custom hex tint also works when premium is the only Eskie source", () => {
  const result = resolve({
    shape: "circle",
    style: "fantasy_01",
    base: "no_base",
    size: 30,
    sizeStrategy: "exact",
    color: "#8FD8FF"
  }, { premium: true, free: false });

  assert.equal(result.source, "premium");
  assert.equal(result.tint, "#8FD8FF");
  assert.equal(result.reason, "premium-white-tinted");
});

test("authored premium named colors still use native recolors without tint", () => {
  const result = resolve({
    shape: "circle",
    style: "fantasy_01",
    size: 30,
    color: "red"
  });

  assert.equal(result.source, "premium");
  assert.equal(result.tint, null);
  assert.equal(result.reason, "native-premium-color");
  assert.equal(result.fallback, false);
  assert.ok(result.file.endsWith("Crosshair_Circle_Fantasy_01_Red_30ft.webm"));
});

test("an actual white request still resolves as native premium white without tint", () => {
  const result = resolve({
    shape: "circle",
    style: "fantasy_01",
    base: "no_base",
    size: 30,
    sizeStrategy: "exact",
    color: "white"
  });

  assert.equal(result.source, "premium");
  assert.equal(result.tint, null);
  assert.equal(result.reason, "native-premium-color");
  assert.equal(result.fallback, false);
  assert.ok(result.file.endsWith("Crosshair_Circle_Fantasy_01_White_NoBase_30ft.webm"));
});
