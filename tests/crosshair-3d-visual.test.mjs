import test from "node:test";
import assert from "node:assert/strict";

import { Crosshair3dPlacementVisualService } from "../scripts/crosshairs3d/placement-visual-service.js";

function installSequencerStub() {
  const calls = { starts: [], updates: [], ends: [] };
  class EffectBuilder {
    constructor() { this.data = {}; }
    name(v) { this.data.name = v; return this; }
    file(v) { this.data.file = v; return this; }
    atLocation(v) { this.data.source = v; return this; }
    elevation(v, options) { this.data.elevation = { value: v, options }; return this; }
    rotate(v) { this.data.angle = v; return this; }
    opacity(v) { this.data.opacity = v; return this; }
    locally() { this.data.local = true; return this; }
    persist() { this.data.persist = true; return this; }
    size(v, options) { this.data.size = { ...v, ...options }; return this; }
    tint(v) { this.data.tint = v; return this; }
    belowTokens() { this.data.belowTokens = true; return this; }
  }
  class SequenceStub {
    constructor() { this.builder = new EffectBuilder(); }
    effect() { return this.builder; }
    async play() { calls.starts.push(structuredClone(this.builder.data)); }
  }
  globalThis.Sequence = SequenceStub;
  globalThis.Sequencer = {
    EffectManager: {
      async updateEffects(filter, updates) { calls.updates.push({ filter: structuredClone(filter), updates: structuredClone(updates) }); },
      async endEffects(filter) { calls.ends.push(structuredClone(filter)); }
    }
  };
  globalThis.foundry = { utils: { randomID: () => "visual-test" } };
  return calls;
}

function metrics() {
  return {
    resolve: () => ({ size: 100, distance: 5, originX: 0, originY: 0 }),
    distanceToPixels: p => ({ x: p.x * 20, y: p.y * 20, elevation: p.z })
  };
}

function crosshairs() {
  return {
    resolveAsset: ({ shape }) => ({ file: `modules/eskie/${shape}.webm`, nativeFallback: false, tint: "#7fefef", reason: "test" })
  };
}

test("accepted-state Eskie artwork starts once and is subsequently updated by name", async () => {
  const calls = installSequencerStub();
  const service = new Crosshair3dPlacementVisualService({ crosshairs: crosshairs(), metrics: metrics() });
  const state = service.createSession({ id: "one" });
  const shape = { type: "prism", origin: { x: 5, y: 10, z: 15 }, length: 10, width: 5, height: 5, yaw: 20 };
  const first = await service.update(state, shape);
  const second = await service.update(state, { ...shape, origin: { x: 10, y: 10, z: 20 }, yaw: 25 });
  assert.equal(first.artwork, true);
  assert.equal(second.artwork, true);
  assert.equal(calls.starts.length, 1, "one retained visual is started");
  assert.equal(calls.updates.length, 1, "the retained effect is updated instead of recreated");
  assert.equal(calls.updates[0].filter.name, "action-effects-5e.crosshair3d.accepted.one");
  assert.deepEqual(calls.updates[0].updates.source, { x: 200, y: 200 });
  assert.equal(calls.updates[0].updates.angle, 25);
  await service.clear(state);
  assert.equal(calls.ends.at(-1).name, "action-effects-5e.crosshair3d.accepted.one");
});

test("pitched Cone suppresses flat Eskie artwork and requests the AE5E 3D guide", async () => {
  const calls = installSequencerStub();
  const service = new Crosshair3dPlacementVisualService({ crosshairs: crosshairs(), metrics: metrics() });
  const state = service.createSession({ id: "cone" });
  const horizontal = await service.update(state, { type: "cone", origin: { x: 0, y: 0, z: 0 }, length: 15, yaw: 0, pitch: 0 });
  assert.equal(horizontal.artwork, true);
  assert.equal(calls.starts.length, 1);
  const pitched = await service.update(state, { type: "cone", origin: { x: 0, y: 0, z: 0 }, length: 15, yaw: 0, pitch: 30 });
  assert.equal(pitched.artwork, false);
  assert.equal(pitched.guide, true);
  assert.equal(calls.ends.length >= 1, true, "flat Cone artwork ends when pitch becomes non-zero");
});
