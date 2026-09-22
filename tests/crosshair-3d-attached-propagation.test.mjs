import test from "node:test";
import assert from "node:assert/strict";

import { Crosshair3dAttachedPropagationService } from "../scripts/crosshairs3d/attached-propagation-service.js";
import { MODULE_ID, REGION_CELL_FLAG } from "../scripts/core/constants.js";

const metrics = Object.freeze({ size: 100, distance: 5, originX: 0, originY: 0,
  grid: Object.freeze({ distance: 5, origin: Object.freeze({ x: 0, y: 0, z: 0 }) }) });

function fixture({ mode = "direct", fail = false } = {}) {
  const gm = { id: "gm", isGM: true, active: true };
  globalThis.game = { user: gm, users: [gm] };
  globalThis.foundry = { utils: { deepClone: value => structuredClone(value), randomID: () => "request" } };
  const hooks = new Map();
  globalThis.Hooks = {
    on(name, fn) { if (!hooks.has(name)) hooks.set(name, new Set()); hooks.get(name).add(fn); return fn; },
    off(name, fn) { hooks.get(name)?.delete(fn); }
  };
  const scene = { id: "scene", uuid: "Scene.scene", regions: [], tokens: new Map() };
  const source = { id: "source", uuid: "Scene.scene.Token.source", parent: scene,
    x: 0, y: 0, elevation: 0, rotation: 0, width: 1, height: 1 };
  scene.tokens.set(source.id, source);
  const metadata = {
    schemaVersion: 1,
    propagation: mode,
    support: "chart-cell",
    shape: { type: "sphere", origin: { x: 5, y: 5, z: 0 }, radius: 5 },
    origin: { x: 5, y: 5, z: 0 },
    connectors: [],
    sourceTokenUuid: source.uuid,
    sourceTransform: { x: 0, y: 0, elevation: 0, rotation: 0, width: 1, height: 1 },
    attached: true
  };
  const config = { bounds: { min: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 } },
    defaultState: "INACTIVE", cells: { "1,1,0": "ACTIVE" },
    frame: { type: "token", sourceTokenUuid: source.uuid, offset: { x: 0, y: 0, z: 0 }, rotationOffset: 0 } };
  const region = { id: "region", uuid: "Scene.scene.Region.region", documentName: "Region", parent: scene,
    name: "Attached", color: "#ffffff", locked: true, visibility: 0, behaviors: [],
    flags: { [MODULE_ID]: { crosshair3dPersistentArea: metadata, [REGION_CELL_FLAG]: config } },
    getFlag(scope, key) { return this.flags?.[scope]?.[key]; } };
  scene.regions.push(region);
  globalThis.canvas = { ready: true, scene, tokens: { get: id => scene.tokens.get(id)?.object ?? null } };
  globalThis.fromUuid = async uuid => uuid === source.uuid ? source : uuid === region.uuid ? region : null;
  const updates = [];
  const regions = { async updateCrosshair3d(_region, changes) { updates.push(changes); return { updated: true }; } };
  const propagationCalls = [];
  const propagation = { async resolve(options) {
    propagationCalls.push(options);
    if (fail) throw new Error("synthetic obstruction failure");
    return { mode: options.mode, shape: options.shape, origin: options.origin, support: "chart-cell",
      cells: [{ x: 2, y: 1, z: 0 }] };
  } };
  const environment = { create: () => ({ directCoverage() {} }) };
  const regionCells = {
    getConfig: () => config,
    buildRegionFlag: input => structuredClone(input)
  };
  const persistentAreas = { build({ propagation: result, source: nextSource }) {
    const nextMetadata = { ...metadata, shape: result.shape, origin: result.origin,
      sourceTransform: { x: nextSource.x, y: nextSource.y, elevation: nextSource.elevation,
        rotation: nextSource.rotation, width: nextSource.width, height: nextSource.height } };
    return { config: { ...config, cells: { "2,1,0": "ACTIVE" } }, regionData: {
      shapes: [{ type: "rectangle", x: 200, y: 100, width: 100, height: 100 }],
      elevation: { bottom: 0, top: 5 }, flags: { [MODULE_ID]: { crosshair3dPersistentArea: nextMetadata } }
    } };
  } };
  const service = new Crosshair3dAttachedPropagationService({
    authority: { getPrimaryGm: () => gm }, regions, regionCells, propagation, environment,
    persistentAreas, metricsService: { resolve: () => metrics }
  });
  const emit = (name, ...args) => { for (const fn of hooks.get(name) ?? []) fn(...args); };
  const flush = async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 130));
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  };
  return { service, scene, source, region, metadata, config, updates, propagationCalls, emit, flush };
}

test("attached Direct re-resolves from the transformed source and rebases exact cells", async () => {
  const f = fixture();
  const moved = { ...f.source, x: 100, elevation: 5, rotation: 90 };
  const result = await f.service.resolveRegion(f.region, { source: moved, reason: "test-transform" });
  assert.equal(result.resolved, true);
  assert.equal(f.propagationCalls.length, 1);
  const call = f.propagationCalls[0];
  assert.equal(call.mode, "direct");
  assert.ok(Math.abs(call.shape.origin.x - 5) < 1e-8);
  assert.ok(Math.abs(call.shape.origin.y - 5) < 1e-8);
  assert.equal(call.shape.origin.z, 5);
  assert.deepEqual(call.origin, call.shape.origin);
  assert.equal(f.updates.length, 1);
  assert.deepEqual(f.updates[0][`flags.${MODULE_ID}.${REGION_CELL_FLAG}`].cells, { "2,1,0": "ACTIVE" });
  assert.equal(f.updates[0][`flags.${MODULE_ID}.crosshair3dPersistentArea`].lastReason, "test-transform");
});

test("source and environment hooks queue Direct/Spread but never re-resolve None", async () => {
  const direct = fixture();
  direct.service.initialize();
  direct.emit("updateToken", direct.source, { x: 100 });
  await direct.flush();
  assert.equal(direct.propagationCalls.length, 1);
  direct.emit("updateWall", { parent: direct.scene });
  await direct.flush();
  assert.equal(direct.propagationCalls.length, 2);
  direct.service.shutdown();

  const none = fixture({ mode: "none" });
  none.service.initialize();
  none.emit("updateToken", none.source, { x: 100 });
  none.emit("updateWall", { parent: none.scene });
  await none.flush();
  assert.equal(none.propagationCalls.length, 0);
  assert.equal(none.updates.length, 0);
  none.service.shutdown();
});

test("Wall hooks wait for Foundry's collision geometry to settle before re-resolving", async () => {
  const priorFrame = globalThis.requestAnimationFrame;
  const frames = [];
  globalThis.requestAnimationFrame = callback => {
    frames.push(callback);
    return frames.length;
  };
  try {
    const f = fixture();
    f.service.initialize();
    f.emit("createWall", { parent: f.scene });
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    assert.equal(f.propagationCalls.length, 0, "the Wall hook must not resolve immediately");
    assert.equal(frames.length, 1);

    frames.shift()(performance.now());
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    assert.equal(f.propagationCalls.length, 0, "one animation frame is not considered settled");
    assert.equal(frames.length, 1);

    frames.shift()(performance.now());
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    assert.equal(f.propagationCalls.length, 1, "resolution runs after two animation frames");
    assert.equal(f.service.getStats().pending, 0);
    f.service.shutdown();
  } finally {
    if (priorFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = priorFrame;
  }
});

test("attached propagation fails closed by replacing active overrides with an inactive configuration", async () => {
  const f = fixture({ fail: true });
  const result = await f.service.resolveRegion(f.region, { source: f.source });
  assert.equal(result.resolved, false);
  assert.equal(result.deactivated, undefined, "outer failure result reports resolution-error");
  assert.equal(f.updates.length, 1);
  const config = f.updates[0][`flags.${MODULE_ID}.${REGION_CELL_FLAG}`];
  assert.equal(config.defaultState, "INACTIVE");
  assert.deepEqual(config.cells, {});
  assert.equal(f.service.getStats().errors, 1);
  assert.equal(f.service.getStats().deactivated, 1);
});

test("non-primary clients never queue or write attached propagation", async () => {
  const f = fixture();
  globalThis.game.user = { id: "player", isGM: false, active: true };
  const result = await f.service.resolveRegion(f.region, { source: f.source });
  assert.deepEqual(result, { resolved: false, reason: "not-primary-gm" });
  assert.equal(f.updates.length, 0);
});
