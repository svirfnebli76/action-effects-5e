import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { RegionCellStateService } from "../scripts/regions/region-cell-state-service.js";
import { RegionOccupancyService } from "../scripts/regions/region-occupancy-service.js";
import {
  MODULE_ID,
  REGION_CELL_FLAG,
  REGION_CELL_SCHEMA_VERSION,
  REGION_CELL_STATES
} from "../scripts/core/constants.js";

function getProperty(object, path) {
  return String(path).split(".").reduce((value, part) => value?.[part], object);
}

function setProperty(object, path, value) {
  const parts = String(path).split(".");
  const leaf = parts.pop();
  let current = object;
  for (const part of parts) current = current[part] ??= {};
  current[leaf] = value;
  return true;
}

function mergeProperty(object, path, value) {
  const existing = getProperty(object, path);
  if (
    existing && value &&
    typeof existing === "object" && typeof value === "object" &&
    !Array.isArray(existing) && !Array.isArray(value)
  ) {
    for (const [key, entry] of Object.entries(value)) {
      mergeProperty(existing, key, entry);
    }
    return true;
  }
  return setProperty(object, path, structuredClone(value));
}

function makeFixture() {
  globalThis.foundry = {
    utils: {
      deepClone: value => structuredClone(value),
      getProperty,
      setProperty
    }
  };

  const gm = { id: "gm", isGM: true, active: true };
  globalThis.game = { user: gm, users: [gm] };

  const registered = new Map();
  const socket = {
    ready: true,
    register(name, handler) { registered.set(name, handler); },
    async executeAsUser(name, _userId, payload) { return registered.get(name)(payload); },
    getRegisteredNames() { return [...registered.keys()]; }
  };
  const authority = { getPrimaryGm: () => gm, getStatus: () => ({ primaryGmUserId: gm.id }) };
  const regions = { isOwned: region => Boolean(region?.flags?.[MODULE_ID]?.authorityRegion) };
  const service = new RegionCellStateService({ socket, authority, regions });

  const documents = new Map();
  globalThis.fromUuid = async uuid => documents.get(uuid) ?? null;
  globalThis.fromUuidSync = uuid => documents.get(uuid) ?? null;

  const scene = {
    id: "scene",
    uuid: "Scene.scene",
    documentName: "Scene",
    grid: { size: 100, distance: 5 },
    tokens: new Map()
  };
  const region = {
    id: "region",
    uuid: "Scene.scene.Region.region",
    documentName: "Region",
    parent: scene,
    flags: { [MODULE_ID]: { authorityRegion: { test: true } } },
    getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
    async update(changes) {
      // Match Foundry v14 ObjectField semantics: object updates recursively
      // merge and do not remove keys omitted from the incoming object.
      for (const [path, value] of Object.entries(changes)) mergeProperty(this, path, value);
      return this;
    },
    async unsetFlag(scope, key) {
      if (this.flags?.[scope]) delete this.flags[scope][key];
      return this;
    }
  };
  documents.set(region.uuid, region);

  return { service, socket, authority, regions, documents, scene, region };
}

function webConfig(overrides = {}) {
  return {
    bounds: { min: { x: 0, y: 0, z: 0 }, size: { x: 4, y: 4, z: 4 } },
    defaultState: REGION_CELL_STATES.ACTIVE,
    frame: { type: "static", origin: { x: 0, y: 0, elevation: 0 }, rotation: 0 },
    ...overrides
  };
}

function token({ x = 0, y = 0, elevation = 0, width = 1, height = 1, depth } = {}) {
  const result = { x, y, elevation, width, height, uuid: `Scene.scene.Token.${Math.random()}` };
  if (depth !== undefined) result.depth = depth;
  return result;
}

test("Region cell production services are generic and contain no Web spell rules", async () => {
  const files = [
    new URL("../scripts/regions/region-cell-state-service.js", import.meta.url),
    new URL("../scripts/regions/region-occupancy-service.js", import.meta.url)
  ];
  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    for (const forbidden of ["Restrained by Web", "Escape Web", "Web Save", "Burning Web Damage", "WEB_FLAG_KEY"]) {
      assert.equal(source.includes(forbidden), false, `generic Region-cell source must not contain '${forbidden}'`);
    }
  }
});

test("Region cell config models a 4x4x4 volume with sparse state overrides", () => {
  const { service } = makeFixture();
  const config = service.normalizeConfig(webConfig({ cells: { "1,1,1": "GONE", "2,2,2": "BURNING" } }));
  assert.equal(config.schemaVersion, REGION_CELL_SCHEMA_VERSION);
  assert.deepEqual(config.bounds.size, { x: 4, y: 4, z: 4 });
  assert.equal(config.defaultState, "ACTIVE");
  assert.equal(Object.keys(config.cells).length, 2);
  assert.equal(service.getCellStateFromConfig(config, { x: 0, y: 0, z: 0 }), "ACTIVE");
  assert.equal(service.getCellStateFromConfig(config, { x: 1, y: 1, z: 1 }), "GONE");
  assert.equal(service.getCellStateFromConfig(config, { x: 2, y: 2, z: 2 }), "BURNING");
  assert.equal(service.getCellStateFromConfig(config, { x: 4, y: 0, z: 0 }), null);
  assert.equal(service.enumerateCells(config).length, 64);
  assert.equal(service.enumerateCells(config, { states: "ACTIVE" }).length, 62);
});

test("Region cell state persistence is GM-authoritative, sparse, batchable, and clearable", async () => {
  const { service, socket, region } = makeFixture();
  assert.deepEqual(socket.getRegisteredNames().sort(), ["regionCells.clear", "regionCells.configure", "regionCells.setStates"]);

  const configured = await service.configure(region, webConfig());
  assert.equal(configured.configured, true);
  assert.equal(region.flags[MODULE_ID][REGION_CELL_FLAG].defaultState, "ACTIVE");

  const changed = await service.setCellStates(region, [
    { cell: { x: 1, y: 1, z: 1 }, state: "GONE" },
    { cell: { x: 2, y: 1, z: 1 }, state: "BURNING" },
    { cell: { x: 9, y: 9, z: 9 }, state: "GONE" }
  ]);
  assert.equal(changed.updated, true);
  assert.equal(changed.changed, 2);
  assert.equal(changed.ignored.length, 1);
  assert.equal(service.getCellState(region, { x: 1, y: 1, z: 1 }), "GONE");
  assert.equal(Object.keys(service.getConfig(region).cells).length, 2);

  const restored = await service.setCellState(region, { x: 1, y: 1, z: 1 }, "ACTIVE");
  assert.equal(restored.changed, 1);
  assert.equal(service.getCellState(region, { x: 1, y: 1, z: 1 }), "ACTIVE");
  assert.equal(Object.hasOwn(service.getConfig(region).cells, "1,1,1"), false, "restoring default state removes sparse override");

  const cleared = await service.clear(region);
  assert.equal(cleared.cleared, true);
  assert.equal(service.isConfigured(region), false);
});

test("Region cell configuration replaces a shrinking mask instead of merging stale cells", async () => {
  const { service, region } = makeFixture();
  const originalCells = Object.fromEntries(
    Array.from({ length: 28 }, (_, index) => [`${index},0,0`, "ACTIVE"])
  );
  const blockedCells = Object.fromEntries(
    Array.from({ length: 14 }, (_, index) => [`${index},0,0`, "ACTIVE"])
  );

  await service.configure(region, {
    bounds: { min: { x: 0, y: 0, z: 0 }, size: { x: 28, y: 1, z: 1 } },
    defaultState: "INACTIVE",
    cells: originalCells
  });
  await service.configure(region, {
    bounds: { min: { x: 0, y: 0, z: 0 }, size: { x: 28, y: 1, z: 1 } },
    defaultState: "INACTIVE",
    cells: blockedCells
  });

  const stored = service.getConfig(region);
  assert.equal(Object.keys(stored.cells).length, 14);
  assert.equal(Object.hasOwn(stored.cells, "27,0,0"), false);
});

test("Region cell static local/world transform round-trips translation, elevation, and rotation", () => {
  const { service, region } = makeFixture();
  region.flags[MODULE_ID][REGION_CELL_FLAG] = service.normalizeConfig(webConfig({
    frame: { type: "static", origin: { x: 300, y: 500, elevation: 20 }, rotation: 90 }
  }));

  const world = service.localToWorldPoint(region, { x: 1, y: 2, z: 3 });
  assert.ok(Math.abs(world.x - 100) < 1e-8);
  assert.ok(Math.abs(world.y - 600) < 1e-8);
  assert.equal(world.elevation, 35);

  const local = service.worldToLocalPoint(region, world);
  assert.ok(Math.abs(local.x - 1) < 1e-8);
  assert.ok(Math.abs(local.y - 2) < 1e-8);
  assert.ok(Math.abs(local.z - 3) < 1e-8);
});

test("Token-local Region cell frame follows source translation, elevation, and rotation without rewriting cells", () => {
  const { service, region, documents, scene } = makeFixture();
  const source = token({ x: 100, y: 200, elevation: 10, width: 2, height: 2, depth: 2 });
  source.uuid = "Scene.scene.Token.source";
  source.rotation = 0;
  scene.tokens.set("source", source);
  documents.set(source.uuid, source);
  region.flags[MODULE_ID][REGION_CELL_FLAG] = service.normalizeConfig(webConfig({
    frame: { type: "token", sourceTokenUuid: source.uuid, offset: { x: 1, y: 0, z: 1 }, rotationOffset: 0 },
    cells: { "1,1,1": "GONE" }
  }));

  const before = service.resolveFrame(region);
  assert.deepEqual(before.origin, { x: 300, y: 300, elevation: 15 });
  assert.equal(before.rotation, 0);
  const persistedBefore = structuredClone(service.getConfig(region).cells);

  source.x += 300;
  source.elevation += 10;
  source.rotation = 90;
  const after = service.resolveFrame(region);
  assert.ok(Math.abs(after.origin.x - 500) < 1e-8);
  assert.ok(Math.abs(after.origin.y - 400) < 1e-8);
  assert.equal(after.origin.elevation, 25);
  assert.equal(after.rotation, 90);
  assert.deepEqual(service.getConfig(region).cells, persistedBefore, "source movement must not rewrite local cell state");
});

test("Region cell containment requires positive XY and Z overlap and respects inactive holes", () => {
  const { service, region } = makeFixture();
  region.flags[MODULE_ID][REGION_CELL_FLAG] = service.normalizeConfig({
    ...webConfig(),
    cells: { "1,0,0": "GONE", "0,0,1": "GONE" }
  });

  assert.equal(service.intersectsToken(region, token({ x: 0, y: 0, elevation: 0, depth: 1 })).intersects, true);
  assert.equal(service.intersectsToken(region, token({ x: 100, y: 0, elevation: 0, depth: 1 })).intersects, false, "GONE cell must not count");
  assert.equal(service.intersectsToken(region, token({ x: 100, y: 0, elevation: 0, depth: 1 }), { states: "GONE" }).intersects, true);

  assert.equal(service.intersectsToken(region, token({ x: 400, y: 0, elevation: 0, depth: 1 })).intersects, false, "exact XY face contact outside volume is zero overlap");
  assert.equal(service.intersectsToken(region, token({ x: 399.999, y: 0, elevation: 0, depth: 1 })).intersects, true, "positive fractional XY overlap counts");

  assert.equal(service.intersectsToken(region, token({ x: 0, y: 0, elevation: 20, depth: 1 })).intersects, false, "exact top-face contact is zero Z overlap");
  assert.equal(service.intersectsToken(region, token({ x: 0, y: 0, elevation: 19.999, depth: 1 })).intersects, true, "positive fractional Z overlap counts");
});



test("Token-local 225-degree frame treats exact translated face contact as zero overlap", () => {
  const { service, region, documents, scene } = makeFixture();
  const source = token({ x: 100, y: 200, elevation: 0, width: 1, height: 1, depth: 1 });
  source.uuid = "Scene.scene.Token.rotated-source";
  source.rotation = 225;
  scene.tokens.set("rotated-source", source);
  documents.set(source.uuid, source);

  region.flags[MODULE_ID][REGION_CELL_FLAG] = service.normalizeConfig({
    bounds: { min: { x: 0, y: 0, z: 0 }, size: { x: 3, y: 1, z: 1 } },
    defaultState: "GONE",
    cells: { "2,0,0": "ACTIVE" },
    frame: {
      type: "token",
      sourceTokenUuid: source.uuid,
      offset: { x: -0.5, y: -0.5, z: 0 },
      rotationOffset: -225
    }
  });

  const movedSource = { ...source, x: source.x + scene.grid.size };
  const movedCell = service.getCellWorldVolume(region, { x: 2, y: 0, z: 0 }, { sourceToken: movedSource });
  const center = movedCell.polygon.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
  center.x /= movedCell.polygon.length;
  center.y /= movedCell.polygon.length;

  const target = token({
    x: center.x - (scene.grid.size / 2),
    y: center.y - (scene.grid.size / 2),
    elevation: 0,
    width: 1,
    height: 1,
    depth: 1
  });

  const before = service.intersectsToken(region, target);
  assert.equal(before.intersects, false, "exact face contact before source translation must not count even after rotated token-local transforms");

  source.x += scene.grid.size;
  const after = service.intersectsToken(region, target);
  assert.equal(after.intersects, true, "the same target must overlap after the source translates one grid space");
});

test("Large rectangular Tokens can overlap active and inactive cells simultaneously", () => {
  const { service, region } = makeFixture();
  region.flags[MODULE_ID][REGION_CELL_FLAG] = service.normalizeConfig({
    bounds: { min: { x: 0, y: 0, z: 0 }, size: { x: 3, y: 3, z: 3 } },
    defaultState: "GONE",
    cells: { "2,2,0": "ACTIVE" },
    frame: { type: "static", origin: { x: 0, y: 0, elevation: 0 }, rotation: 0 }
  });

  const result = service.intersectsToken(region, token({ x: 100, y: 100, elevation: 0, width: 2, height: 2, depth: 2 }));
  assert.equal(result.intersects, true);
  assert.deepEqual(result.cells.map(cell => cell.key), ["2,2,0"]);
});

test("Rotated Region cells use exact positive polygon overlap rather than axis-aligned proxy bounds", () => {
  const { service, region } = makeFixture();
  region.flags[MODULE_ID][REGION_CELL_FLAG] = service.normalizeConfig({
    bounds: { min: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 } },
    defaultState: "ACTIVE",
    frame: { type: "static", origin: { x: 200, y: 200, elevation: 0 }, rotation: 45 }
  });

  const inside = service.intersectsToken(region, token({ x: 190, y: 250, elevation: 0, width: 0.2, height: 0.2, depth: 1 }));
  assert.equal(inside.intersects, true);
  const outside = service.intersectsToken(region, token({ x: 135, y: 210, elevation: 0, width: 0.05, height: 0.05, depth: 1 }));
  assert.equal(outside.intersects, false);
});

test("RegionOccupancyService delegates only configured Regions to AE5E cells and preserves native fallback", () => {
  const { service, region } = makeFixture();
  const occupancy = new RegionOccupancyService({ cells: service });
  const nativeToken = {
    uuid: "Scene.scene.Token.native",
    testInsideRegion(receivedRegion, position) {
      assert.equal(receivedRegion, region);
      return position?.x === 123;
    }
  };
  assert.equal(occupancy.testTokenAt(region, nativeToken, { x: 123 }), true);
  assert.equal(occupancy.getStats().nativeQueries, 1);

  region.flags[MODULE_ID][REGION_CELL_FLAG] = service.normalizeConfig(webConfig());
  const cellToken = token({ x: 0, y: 0, elevation: 0, depth: 1 });
  cellToken.testInsideRegion = () => { throw new Error("native containment must not run for cell-backed Region"); };
  assert.equal(occupancy.testTokenAt(region, cellToken), true);
  assert.equal(occupancy.getStats().cellQueries, 1);
});

test("Concurrent cell mutations serialize per Region so sparse overrides are not lost", async () => {
  const { service, region } = makeFixture();
  await service.configure(region, webConfig());
  await Promise.all([
    service.setCellState(region, { x: 0, y: 0, z: 0 }, "GONE"),
    service.setCellState(region, { x: 3, y: 3, z: 3 }, "BURNING")
  ]);
  const config = service.getConfig(region);
  assert.equal(config.cells["0,0,0"], "GONE");
  assert.equal(config.cells["3,3,3"], "BURNING");
  assert.equal(service.getStats().pendingWriteQueues, 0);
});

test("Token vertical depth honors explicit native values and only falls back when depth is missing", () => {
  const { service, region } = makeFixture();
  region.flags[MODULE_ID][REGION_CELL_FLAG] = service.normalizeConfig({
    bounds: { min: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 3 } },
    defaultState: "GONE",
    cells: { "0,0,1": "ACTIVE" },
    frame: { type: "static", origin: { x: 0, y: 0, elevation: 0 }, rotation: 0 }
  });

  const explicitShort = service.intersectsToken(region, token({ x: 0, y: 0, elevation: 0, width: 1, height: 1, depth: 0.5 }));
  assert.equal(explicitShort.intersects, false, "explicit half-grid depth must not be replaced by footprint fallback");

  const missingDepth = service.intersectsToken(region, token({ x: 0, y: 0, elevation: 0, width: 2, height: 2 }));
  assert.equal(missingDepth.intersects, true, "missing 2x2 square-token depth falls back to 2 grid units");
});

test("Region-cell foundation is wired through module startup, public API, and console tests", async () => {
  const mainSource = await fs.readFile(new URL("../scripts/action-effects-5e.js", import.meta.url), "utf8");
  const apiSource = await fs.readFile(new URL("../scripts/api.js", import.meta.url), "utf8");
  const harnessSource = await fs.readFile(new URL("../scripts/dev/test-harness.js", import.meta.url), "utf8");
  assert.match(mainSource, /new RegionCellStateService/);
  assert.match(mainSource, /new RegionOccupancyService/);
  assert.match(apiSource, /cells:\s*Object\.freeze/);
  assert.match(apiSource, /occupancy:\s*Object\.freeze/);
  assert.match(apiSource, /runRegionCellFoundationTest/);
  assert.match(apiSource, /runRegionCellContainmentTest/);
  assert.match(harnessSource, /new RegionCellTestSuite/);
});
