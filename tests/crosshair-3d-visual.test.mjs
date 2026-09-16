import test from "node:test";
import assert from "node:assert/strict";

import { Crosshair3dPlacementVisualService } from "../scripts/crosshairs3d/placement-visual-service.js";

function installSequencerStub() {
  const calls = { starts: [], transforms: [], destructiveUpdates: [], ends: [] };
  const activeEffects = new Map();
  class EffectBuilder {
    constructor() { this.data = {}; }
    name(v) { this.data.name = v; return this; }
    file(v) { this.data.file = v; return this; }
    atLocation(v) { this.data.source = v; return this; }
    attachTo(v, options = {}) { this.data.source = v; this.data.attachTo = { active: true, ...options }; return this; }
    stretchTo(v, options = {}) { this.data.target = v; this.data.stretchTo = { ...options }; return this; }
    elevation(v, options) { this.data.elevation = { elevation: v, ...options }; return this; }
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
    async play() {
      const data = structuredClone(this.builder.data);
      calls.starts.push(structuredClone(data));
      const initialRadians = ((data.angle ?? 0) * Math.PI) / 180;
      const effect = {
        id: `effect-${data.name}`,
        data,
        _source: data.source,
        _cachedSourceData: { position: data.source },
        _target: data.target,
        _cachedTargetData: { position: data.target },
        _customAngle: data.angle ?? 0,
        elevation: data.elevation?.elevation ?? 0,
        // Model Sequencer 4.2.3: creation-time `.rotate()` writes the actual
        // visual rotation to spriteContainer, while `_transformSprite()` does
        // not re-apply later changes to data.angle.
        spriteContainer: { rotation: -Math.atan2(Math.sin(initialRadians), Math.cos(initialRadians)) },
        async _transformSprite() {
          calls.transforms.push({
            id: this.id,
            source: structuredClone(this.data.source),
            angle: this.data.angle,
            target: structuredClone(this.data.target),
            elevation: structuredClone(this.data.elevation),
            size: structuredClone(this.data.size),
            visualRotation: this.spriteContainer.rotation
          });
        }
      };
      activeEffects.set(data.name, effect);
    }
  }
  globalThis.Sequence = SequenceStub;
  globalThis.Sequencer = {
    EffectManager: {
      getEffects({ name }) {
        const effect = activeEffects.get(name);
        return effect ? [effect] : [];
      },
      async updateEffects(filter, updates) {
        calls.destructiveUpdates.push({ filter: structuredClone(filter), updates: structuredClone(updates) });
      },
      async endEffects(filter) {
        calls.ends.push(structuredClone(filter));
        if (filter?.name) activeEffects.delete(filter.name);
      }
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
    resolveAsset: ({ shape, tint, color }) => ({
      file: `modules/eskie/${shape}.webm`,
      nativeFallback: false,
      tint: tint ?? color ?? "#7fefef",
      reason: "test"
    })
  };
}

test("accepted-state Eskie artwork starts once and transforms the same live sprite in place", async () => {
  const calls = installSequencerStub();
  const service = new Crosshair3dPlacementVisualService({ crosshairs: crosshairs(), metrics: metrics() });
  const state = service.createSession({ id: "one", source: { id: "source-token" } });
  const shape = { type: "prism", origin: { x: 5, y: 10, z: 15 }, length: 10, width: 5, height: 5, yaw: 20 };
  const first = await service.update(state, shape);
  const second = await service.update(state, { ...shape, origin: { x: 10, y: 10, z: 20 }, yaw: 25 });
  assert.equal(first.artwork, true);
  assert.equal(second.artwork, true);
  const artworkStarts = calls.starts.filter(entry => entry.name === "action-effects-5e.crosshair3d.accepted.one");
  const tracerStarts = calls.starts.filter(entry => entry.name === "action-effects-5e.crosshair3d.tracer.one");
  const artworkTransforms = calls.transforms.filter(entry => entry.id === "effect-action-effects-5e.crosshair3d.accepted.one");
  const tracerTransforms = calls.transforms.filter(entry => entry.id === "effect-action-effects-5e.crosshair3d.tracer.one");
  assert.equal(artworkStarts.length, 1, "one retained visual is started");
  assert.equal(tracerStarts.length, 1, "one retained source tracer is started");
  assert.equal(artworkTransforms.length, 1, "the retained CanvasEffect is transformed without media reinitialization");
  assert.equal(tracerTransforms.length, 1, "the retained tracer endpoint transforms in place");
  assert.equal(calls.destructiveUpdates.length, 0, "Sequencer updateEffects is not used during interactive movement");
  assert.deepEqual(artworkTransforms[0].source, { x: 200, y: 200 });
  assert.equal(artworkTransforms[0].angle, 25);
  const liveArtwork = globalThis.Sequencer.EffectManager.getEffects({ name: "action-effects-5e.crosshair3d.accepted.one" })[0];
  const expectedRadians = -(25 * Math.PI / 180);
  assert.ok(Math.abs(liveArtwork.spriteContainer.rotation - expectedRadians) < 1e-12, "retained visual sprite rotates to the accepted yaw");
  assert.deepEqual(tracerStarts[0].target, { x: 100, y: 200 });
  assert.deepEqual(tracerTransforms[0].target, { x: 200, y: 200 });
  assert.equal(tracerStarts[0].opacity, 0.8);
  assert.equal(tracerStarts[0].tint, "#4A4A4A");
  await service.clear(state);
  assert.deepEqual(
    calls.ends.slice(-2).map(entry => entry.name).sort(),
    ["action-effects-5e.crosshair3d.accepted.one", "action-effects-5e.crosshair3d.tracer.one"].sort()
  );
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
