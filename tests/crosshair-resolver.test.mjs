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

test("independent Eskie rectangle visual uses explicit fixed grid size instead of scaleToObject", async () => {
  const previousGame = globalThis.game;
  const previousSequencer = globalThis.Sequencer;
  const previousSequence = globalThis.Sequence;
  const calls = [];
  const crosshair = { document: { x: 100, y: 100 } };
  const callbacks = { SHOW: "show", MOVE: "move" };

  class FakeEffectSection {
    name(value) { calls.push(["name", value]); return this; }
    file(value) { calls.push(["file", value]); return this; }
    attachTo(value) { calls.push(["attachTo", value]); return this; }
    size(value, options) { calls.push(["size", value, options]); return this; }
    scaleToObject(value) { calls.push(["scaleToObject", value]); return this; }
    opacity(value) { calls.push(["opacity", value]); return this; }
    locally() { calls.push(["locally"]); return this; }
    persist() { calls.push(["persist"]); return this; }
    belowTokens() { calls.push(["belowTokens"]); return this; }
    tint(value) { calls.push(["tint", value]); return this; }
  }
  class FakeSequence {
    effect() { return new FakeEffectSection(); }
    async play() { calls.push(["play"]); return true; }
  }

  globalThis.game = {
    modules: new Map([
      ["eskie-effects", { active: true, version: "test" }],
      ["eskie-effects-free", { active: false, version: null }],
      ["sequencer", { active: true, version: "4.2.3" }]
    ])
  };
  globalThis.Sequence = FakeSequence;
  globalThis.Sequencer = {
    Crosshair: {
      CALLBACKS: callbacks,
      async show(_config, suppliedCallbacks) {
        await suppliedCallbacks[callbacks.SHOW]?.(crosshair);
        return { x: 100, y: 100 };
      },
      async collect() { return []; }
    },
    EffectManager: { async endEffects() {} }
  };

  try {
    const service = new CrosshairService();
    const result = await service.show({
      source: { document: { x: 0, y: 0 } },
      type: "rect",
      distance: Math.sqrt(800),
      placement: { snap: { position: 240 } },
      visual: {
        shape: "rectangle",
        style: "fantasy_01",
        color: "white",
        base: "full",
        size: "20x20ft",
        sizeStrategy: "exact",
        sizeGridUnits: 4
      },
      collectTargets: false
    });
    assert.equal(result.cancelled, false);
    assert.equal(calls.some(call => call[0] === "size" && call[1] === 4 && call[2]?.gridUnits === true), true);
    assert.equal(calls.some(call => call[0] === "scaleToObject"), false);
  } finally {
    globalThis.game = previousGame;
    globalThis.Sequencer = previousSequencer;
    globalThis.Sequence = previousSequence;
  }
});
