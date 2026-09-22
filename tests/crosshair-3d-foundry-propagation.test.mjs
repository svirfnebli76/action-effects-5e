import test from "node:test";
import assert from "node:assert/strict";

import { Crosshair3dFoundryPropagationEnvironment } from "../scripts/crosshairs3d/foundry-propagation-environment.js";
import { Crosshair3dPersistentAreaService } from "../scripts/crosshairs3d/persistent-area-service.js";
import { Crosshair3dGeometryService } from "../scripts/crosshairs3d/geometry-service.js";
import { Crosshair3dCanvasMetricsService } from "../scripts/crosshairs3d/canvas-metrics-service.js";
import { RegionCellStateService } from "../scripts/regions/region-cell-state-service.js";
import { RegionAuthorityService } from "../scripts/regions/region-authority-service.js";
import { MODULE_ID, REGION_CELL_FLAG } from "../scripts/core/constants.js";

const metrics = Object.freeze({ size: 100, distance: 5, originX: 0, originY: 0,
  grid: Object.freeze({ distance: 5, origin: Object.freeze({ x: 0, y: 0, z: 0 }) }) });
const world = Object.freeze({ minX: 0, maxX: 5, minY: 0, maxY: 5, minZ: 0, maxZ: 5 });
const shape = Object.freeze({ type: "sphere", origin: { x: 2.5, y: 2.5, z: 0 }, radius: 5 });

function environment(options = {}) {
  return new Crosshair3dFoundryPropagationEnvironment({
    metricsService: new Crosshair3dCanvasMetricsService(),
    geometry: new Crosshair3dGeometryService(),
    ...options
  });
}

test("Foundry Direct adapter measures the full chart cell and accepts exactly half clear XY coverage", async () => {
  const adapter = environment({ xySamples: 4, zSlabs: 1 }).create({
    scene: {}, metrics,
    collision: (_from, to) => to.x >= 2.5
  });
  const evidence = await adapter.directCoverage({ shape, world, support: "chart-cell", origin: shape.origin });
  assert.equal(evidence.slabs.length, 1);
  assert.equal(evidence.slabs[0].xyCoverage, 0.5);
  assert.equal(evidence.slabs[0].zMax - evidence.slabs[0].zMin, 5);
});

test("Foundry Spread adapter uses the largest four-connected face opening", async () => {
  const adapter = environment({ faceSamples: 10 }).create({
    scene: {}, metrics,
    collision: (_from, to) => {
      const row = Math.floor(to.y / 0.5);
      const column = Math.floor(to.z / 0.5);
      return !((row === 0 && column < 6) || (row === 9 && column < 6));
    }
  });
  const evidence = await adapter.sharedFace({ world, grid: metrics.grid, axis: "x", sign: 1 });
  assert.equal(evidence.largestContiguousFraction, 0.06,
    "two disconnected six-percent openings must not be summed to twelve percent");
});

test("Foundry collision checks Surfaces globally and Walls only through each Level height interval", async () => {
  const wallCalls = [];
  const surfaceCalls = [];
  globalThis.CONFIG = { Canvas: { polygonBackends: { move: { testCollision(_a, _b, config) {
    wallCalls.push(config);
    return false;
  } } } } };
  const scene = {
    levels: { contents: [
      { id: "lower", elevation: { bottom: 0, top: 10 } },
      { id: "upper", elevation: { bottom: 10, top: 20 } }
    ] },
    testSurfaceCollision(_a, _b, config) { surfaceCalls.push(config); return false; }
  };
  const adapter = environment({ xySamples: 1, zSlabs: 1 }).create({ scene, metrics });
  await adapter.seedOpen({ world: { ...world, minZ: 10, maxZ: 30 }, origin: { x: -5, y: 2.5, z: 0 } });
  assert.equal(surfaceCalls.length, 1);
  assert.equal(Object.hasOwn(surfaceCalls[0], "level"), false, "Surfaces must not be filtered by viewed Level");
  assert.deepEqual(wallCalls.map(call => call.level.id), ["lower", "upper"]);
  assert.ok(wallCalls[0].tMax <= wallCalls[1].tMin + 1e-7);
});

function regionFixture() {
  const gm = { id: "gm", isGM: true, active: true };
  globalThis.game = { user: gm, users: [gm] };
  const socket = { ready: true, register() {}, executeAsUser() { throw new Error("unexpected socket route"); } };
  const authority = { getPrimaryGm: () => gm, getStatus: () => ({}) };
  const regions = { createCalls: [], async create(data, options) {
    this.createCalls.push({ data, options });
    return { created: true, regionUuid: "Scene.s.Region.r", regionId: "r", sceneUuid: "Scene.s" };
  } };
  const regionCells = new RegionCellStateService({ socket, authority, regions: { isOwned: () => true } });
  return { regions, regionCells };
}

test("persistent area is born with one broad shell and its exact inactive-default 3D cell flag", async () => {
  const { regions, regionCells } = regionFixture();
  const service = new Crosshair3dPersistentAreaService({ regions, regionCells,
    metricsService: new Crosshair3dCanvasMetricsService() });
  const propagation = { mode: "direct", support: "chart-cell", shape, origin: shape.origin,
    cells: [{ x: 1, y: 2, z: -1 }, { x: 2, y: 2, z: -1 }, { x: 2, y: 2, z: 0 }] };
  const result = await service.create({ propagation, scene: { uuid: "Scene.s" },
    source: { id: "source", document: { id: "source", uuid: "Scene.s.Token.source" } }, metrics,
    options: { name: "Test Area" } });
  assert.equal(result.created, true);
  assert.equal(regions.createCalls.length, 1);
  const { data, options } = regions.createCalls[0];
  assert.equal(data.shapes.length, 1);
  assert.deepEqual(data.elevation, { bottom: -5, top: 5 });
  assert.equal(data.shapes[0].width, 200);
  assert.equal(data.shapes[0].height, 100);
  const config = data.flags[MODULE_ID][REGION_CELL_FLAG];
  assert.equal(config.defaultState, "INACTIVE");
  assert.equal(Object.keys(config.cells).length, 3);
  assert.deepEqual(config.bounds, { min: { x: 1, y: 2, z: -1 }, size: { x: 2, y: 1, z: 2 } });
  assert.equal(options.requestId, result.operationId);
});

test("attached persistent cells begin in the Scene frame and follow the source as one rigid transform", () => {
  const { regions, regionCells } = regionFixture();
  const service = new Crosshair3dPersistentAreaService({ regions, regionCells,
    metricsService: new Crosshair3dCanvasMetricsService() });
  const source = { id: "source", uuid: "Scene.s.Token.source", x: 200, y: 300,
    width: 1, height: 1, elevation: 10, rotation: 90 };
  const built = service.build({ propagation: { mode: "none", support: "continuous-primitive", shape,
    origin: shape.origin, cells: [{ x: 0, y: 0, z: 0 }] }, scene: { uuid: "Scene.s" }, source,
    metrics, options: { attached: true } });
  const frame = built.config.frame;
  assert.equal(frame.type, "token");
  assert.equal(frame.sourceTokenUuid, source.uuid);
  const resolved = regionCells.resolveFrame(null, { config: built.config, grid: metrics, sourceToken: source });
  assert.ok(Math.abs(resolved.origin.x) < 1e-7);
  assert.ok(Math.abs(resolved.origin.y) < 1e-7);
  assert.ok(Math.abs(resolved.origin.elevation) < 1e-7);
  assert.ok(Math.abs(resolved.rotation) < 1e-7);
  assert.deepEqual(built.regionData.attachment, { token: source.id });
});

test("Region creation request IDs are idempotent across concurrent confirmation retries", async () => {
  const gm = { id: "gm", isGM: true, active: true };
  globalThis.game = { user: gm, users: [gm] };
  globalThis.foundry = { utils: {
    deepClone: value => structuredClone(value),
    setProperty(object, path, value) {
      const parts = path.split(".");
      const leaf = parts.pop();
      let cursor = object;
      for (const part of parts) cursor = cursor[part] ??= {};
      cursor[leaf] = value;
    },
    getProperty: (object, path) => path.split(".").reduce((value, part) => value?.[part], object)
  } };
  let creations = 0;
  const scene = { uuid: "Scene.s", documentName: "Scene", async createEmbeddedDocuments(_type, documents) {
    creations += 1;
    await Promise.resolve();
    return [{ id: "r", uuid: "Scene.s.Region.r", name: documents[0].name }];
  } };
  globalThis.fromUuid = async uuid => uuid === scene.uuid ? scene : null;
  const registered = new Map();
  const socket = { ready: true, register: (name, handler) => registered.set(name, handler),
    executeAsUser: (name, _id, payload) => registered.get(name)(payload) };
  const service = new RegionAuthorityService({ socket,
    authority: { getPrimaryGm: () => gm, getStatus: () => ({}) } });
  const input = { name: "Once", shapes: [{ type: "rectangle", x: 0, y: 0, width: 100, height: 100 }] };
  const [a, b] = await Promise.all([
    service.create(input, { scene, requestId: "same-operation" }),
    service.create(input, { scene, requestId: "same-operation" })
  ]);
  assert.equal(creations, 1);
  assert.deepEqual(a, b);
  assert.equal(a.requestId, "same-operation");
});
