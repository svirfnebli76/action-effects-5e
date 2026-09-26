import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { RegionCellStateService } from "../scripts/regions/region-cell-state-service.js";
import { RegionOccupancyService } from "../scripts/regions/region-occupancy-service.js";
import { RegionCellAttachmentService } from "../scripts/regions/region-cell-attachment-service.js";
import { MODULE_ID, REGION_CELL_FLAG } from "../scripts/core/constants.js";

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

function fixture() {
  globalThis.foundry = { utils: { deepClone: value => structuredClone(value), getProperty, setProperty, randomID: (length = 16) => "r".repeat(length) } };
  const gm = { id: "gm", isGM: true, active: true };
  globalThis.game = { user: gm, users: [gm] };
  const handlers = new Map();
  const socket = {
    ready: true,
    register(name, handler) { handlers.set(name, handler); },
    async executeAsUser(name, _userId, payload) { return handlers.get(name)(payload); }
  };
  const authority = { getPrimaryGm: () => gm, getStatus: () => ({ primaryGmUserId: "gm" }) };
  const regionsAuthority = { isOwned: region => Boolean(region?.flags?.[MODULE_ID]?.authorityRegion) };
  const cells = new RegionCellStateService({ socket, authority, regions: regionsAuthority });
  const occupancy = new RegionOccupancyService({ cells });
  const attachments = new RegionCellAttachmentService({ cells, occupancy });
  const documents = new Map();
  globalThis.fromUuid = async uuid => documents.get(uuid) ?? null;
  globalThis.fromUuidSync = uuid => documents.get(uuid) ?? null;

  const scene = {
    id: "scene",
    uuid: "Scene.scene",
    documentName: "Scene",
    grid: { size: 100, distance: 5 },
    tokens: new Map(),
    regions: []
  };
  let updateCount = 0;
  const region = {
    id: "region",
    uuid: "Scene.scene.Region.region",
    documentName: "Region",
    parent: scene,
    flags: { [MODULE_ID]: { authorityRegion: { test: true } } },
    tokens: new Set(),
    getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
    async update(changes) {
      updateCount += 1;
      for (const [path, value] of Object.entries(changes)) setProperty(this, path, structuredClone(value));
      return this;
    },
    async unsetFlag(scope, key) { delete this.flags?.[scope]?.[key]; return this; }
  };
  scene.regions.push(region);
  documents.set(region.uuid, region);

  const makeToken = ({ id, x = 0, y = 0, elevation = 0, width = 1, height = 1, depth = 1, rotation = 0 } = {}) => {
    const token = {
      id,
      uuid: `Scene.scene.Token.${id}`,
      documentName: "Token",
      parent: scene,
      x, y, elevation, width, height, depth, rotation,
      regions: new Set(),
      attachments: { regions: new Set() }
    };
    scene.tokens.set(id, token);
    documents.set(token.uuid, token);
    return token;
  };

  return { cells, occupancy, attachments, documents, scene, region, makeToken, getUpdateCount: () => updateCount };
}

function cellConfig(frame = { type: "static", origin: { x: 0, y: 0, elevation: 0 }, rotation: 0 }) {
  return {
    bounds: { min: { x: 0, y: 0, z: 0 }, size: { x: 4, y: 4, z: 4 } },
    defaultState: "ACTIVE",
    frame
  };
}

function activeCount(cells, region) {
  return cells.enumerateCells(region, { states: "ACTIVE" }).length;
}

function activeComponents(cells, region) {
  const active = new Set(cells.enumerateCells(region, { states: "ACTIVE" }).map(c => c.key));
  let groups = 0;
  const neighbors = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  while (active.size) {
    groups += 1;
    const first = active.values().next().value;
    active.delete(first);
    const queue = [first];
    while (queue.length) {
      const [x,y,z] = queue.shift().split(",").map(Number);
      for (const [dx,dy,dz] of neighbors) {
        const key = `${x+dx},${y+dy},${z+dz}`;
        if (!active.delete(key)) continue;
        queue.push(key);
      }
    }
  }
  return groups;
}


test("live attachment hook evaluates pending changes when updateToken document still exposes the old transform", async () => {
  const f = fixture();
  const source = f.makeToken({ id: "source", x: 0, y: 0, rotation: 0 });
  const target = f.makeToken({ id: "target", x: 200, y: 50, elevation: 0 });
  await f.cells.configure(f.region, {
    bounds: { min: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 } },
    defaultState: "ACTIVE",
    frame: { type: "token", sourceTokenUuid: source.uuid, offset: { x: 0, y: 0, z: 0 } }
  });
  source.attachments.regions.add(f.region);

  const handlers = new Map();
  const emitted = [];
  const previousHooks = globalThis.Hooks;
  globalThis.Hooks = {
    on(name, fn) {
      const list = handlers.get(name) ?? [];
      list.push(fn);
      handlers.set(name, list);
      return fn;
    },
    off(name, fn) {
      const list = handlers.get(name) ?? [];
      handlers.set(name, list.filter(candidate => candidate !== fn));
    },
    callAll(name, ...args) {
      emitted.push({ name, args });
      for (const fn of handlers.get(name) ?? []) fn(...args);
    }
  };

  try {
    f.attachments.initialize();
    assert.equal(f.occupancy.testTokenAt(f.region, target), false);

    const changes = { x: 150 };
    const options = {};
    const userId = globalThis.game.user.id;
    for (const fn of handlers.get("preUpdateToken") ?? []) fn(source, changes, options, userId);

    // Reproduce Foundry v14 live behavior: updateToken fires while the Document
    // still exposes the old x=0 transform and the accepted x=150 exists only
    // in the changes object.
    assert.equal(source.x, 0);
    for (const fn of handlers.get("updateToken") ?? []) fn(source, changes, options, userId);

    const transition = emitted
      .filter(entry => entry.name === `${MODULE_ID}.regionCellOccupancyTransition`)
      .map(entry => entry.args[0])
      .find(entry => entry.tokenUuid === target.uuid);

    assert.ok(transition, "pending changes should produce a cell occupancy transition");
    assert.equal(transition.type, "enter");
    assert.equal(transition.beforeInside, false);
    assert.equal(transition.inside, true);
    assert.equal(transition.sourceTransformBefore.x, 0);
    assert.equal(transition.sourceTransformAfter.x, 150);
    assert.equal(source.x, 0, "test Document remains stale to mirror the live Foundry hook timing");
    assert.equal(f.attachments.getStats().pendingSnapshots, 0);
  } finally {
    f.attachments.shutdown();
    globalThis.Hooks = previousHooks;
  }
});

test("attached cell volume detects stationary Tokens swept in and out by source translation without rewriting cells", async () => {
  const f = fixture();
  const source = f.makeToken({ id: "source", x: 0, y: 0 });
  const target = f.makeToken({ id: "target", x: 200, y: 50 });
  await f.cells.configure(f.region, {
    bounds: { min: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 } },
    defaultState: "ACTIVE",
    frame: { type: "token", sourceTokenUuid: source.uuid, offset: { x: 0, y: 0, z: 0 } }
  });
  source.attachments.regions.add(f.region);
  const persisted = structuredClone(f.cells.getConfig(f.region).cells);
  const before = f.attachments.captureSourceState(source);
  assert.equal(f.occupancy.testTokenAt(f.region, target), false);
  source.x = 150;
  const entered = f.attachments.compareSourceState(source, before, { emit: false });
  assert.deepEqual(entered.transitions.map(t => [t.type, t.tokenUuid]), [["enter", target.uuid]]);
  assert.deepEqual(f.cells.getConfig(f.region).cells, persisted);

  const middle = f.attachments.captureSourceState(source);
  source.x = 350;
  const exited = f.attachments.compareSourceState(source, middle, { emit: false });
  assert.deepEqual(exited.transitions.map(t => [t.type, t.tokenUuid]), [["exit", target.uuid]]);
});

test("attached cell frame responds independently to elevation and rotation across multiple stationary Tokens", async () => {
  const f = fixture();
  const source = f.makeToken({ id: "source", x: 0, y: 0, elevation: 0, rotation: 0 });
  const east = f.makeToken({ id: "east", x: 150, y: 50, elevation: 0 });
  const south = f.makeToken({ id: "south", x: -50, y: 150, elevation: 0 });
  const high = f.makeToken({ id: "high", x: 150, y: 50, elevation: 10 });
  await f.cells.configure(f.region, {
    bounds: { min: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 1, z: 1 } },
    defaultState: "GONE",
    cells: { "1,0,0": "ACTIVE" },
    frame: { type: "token", sourceTokenUuid: source.uuid, offset: { x: 0, y: 0, z: 0 } }
  });
  source.attachments.regions.add(f.region);
  assert.equal(f.occupancy.testTokenAt(f.region, east), true);
  assert.equal(f.occupancy.testTokenAt(f.region, south), false);
  assert.equal(f.occupancy.testTokenAt(f.region, high), false);

  const rotationSnapshot = f.attachments.captureSourceState(source);
  source.rotation = 90;
  const rotation = f.attachments.compareSourceState(source, rotationSnapshot, { emit: false });
  assert.ok(rotation.transitions.some(t => t.tokenUuid === east.uuid && t.type === "exit"));
  assert.ok(rotation.transitions.some(t => t.tokenUuid === south.uuid && t.type === "enter"));

  const elevationSnapshot = f.attachments.captureSourceState(source);
  source.elevation = 10;
  const elevation = f.attachments.compareSourceState(source, elevationSnapshot, { emit: false });
  assert.ok(elevation.transitions.some(t => t.tokenUuid === south.uuid && t.type === "exit"));
});

test("same XY at different elevations and multi-Token queries remain independent", async () => {
  const f = fixture();
  await f.cells.configure(f.region, cellConfig());
  const low = f.makeToken({ id: "low", x: 0, y: 0, elevation: 0 });
  const mid = f.makeToken({ id: "mid", x: 0, y: 0, elevation: 5 });
  const high = f.makeToken({ id: "high", x: 0, y: 0, elevation: 25 });
  await f.cells.setCellState(f.region, { x: 0, y: 0, z: 1 }, "GONE");
  assert.equal(f.occupancy.testTokenAt(f.region, low), true);
  assert.equal(f.occupancy.testTokenAt(f.region, mid), false);
  assert.equal(f.occupancy.testTokenAt(f.region, high), false);
  assert.equal(f.cells.getCellState(f.region, { x: 0, y: 0, z: 1 }), "GONE", "queries never rewrite shared state");
});

test("4x4x4 state destruction supports holes, passages, tunnels, disconnected groups, burning, and all-GONE", async () => {
  const f = fixture();
  await f.cells.configure(f.region, cellConfig());
  const regionIdentity = f.region.uuid;
  assert.equal(activeCount(f.cells, f.region), 64);

  await f.cells.setCellState(f.region, { x: 1, y: 1, z: 1 }, "GONE");
  assert.equal(activeCount(f.cells, f.region), 63);
  await f.cells.setCellState(f.region, { x: 1, y: 1, z: 1 }, "ACTIVE");
  assert.equal(activeCount(f.cells, f.region), 64);

  const horizontal = [0,1,2,3].map(x => ({ cell: { x, y: 1, z: 1 }, state: "GONE" }));
  await f.cells.setCellStates(f.region, horizontal);
  assert.equal(activeCount(f.cells, f.region), 60, "horizontal passage removes only four cells");
  await f.cells.setCellStates(f.region, horizontal.map(u => ({ ...u, state: "ACTIVE" })));

  const vertical = [0,1,2,3].map(z => ({ cell: { x: 2, y: 2, z }, state: "GONE" }));
  await f.cells.setCellStates(f.region, vertical);
  assert.equal(activeCount(f.cells, f.region), 60, "vertical passage removes only four cells");
  await f.cells.setCellStates(f.region, vertical.map(u => ({ ...u, state: "ACTIVE" })));

  const plane = [];
  for (let y=0; y<4; y++) for (let z=0; z<4; z++) plane.push({ cell: { x: 1, y, z }, state: "GONE" });
  await f.cells.setCellStates(f.region, plane);
  assert.equal(activeComponents(f.cells, f.region), 2, "removed plane splits active volume into disconnected groups");
  await f.cells.setCellStates(f.region, plane.map(u => ({ ...u, state: "ACTIVE" })));

  await f.cells.setCellState(f.region, { x: 3, y: 3, z: 3 }, "BURNING");
  assert.equal(f.cells.summarizeStates(f.region).BURNING, 1);
  await f.cells.setCellState(f.region, { x: 3, y: 3, z: 3 }, "GONE");

  const allGone = [];
  for (let x=0; x<4; x++) for (let y=0; y<4; y++) for (let z=0; z<4; z++) allGone.push({ cell: {x,y,z}, state: "GONE" });
  await f.cells.setCellStates(f.region, allGone);
  const summary = f.cells.summarizeStates(f.region);
  assert.deepEqual(summary, { GONE: 64 });
  assert.equal(f.region.uuid, regionIdentity, "dynamic destruction does not recreate the Region");
  assert.ok(f.getUpdateCount() >= 1, "state mutations persist through Region flag updates");
});

test("concurrent state writes serialize without losing independent cell mutations", async () => {
  const f = fixture();
  await f.cells.configure(f.region, cellConfig());
  await Promise.all([
    f.cells.setCellState(f.region, { x: 0, y: 0, z: 0 }, "GONE"),
    f.cells.setCellState(f.region, { x: 3, y: 3, z: 3 }, "BURNING")
  ]);
  assert.equal(f.cells.getCellState(f.region, { x: 0, y: 0, z: 0 }), "GONE");
  assert.equal(f.cells.getCellState(f.region, { x: 3, y: 3, z: 3 }), "BURNING");
  assert.equal(f.cells.getStats().pendingWriteQueues, 0);
});

test("flag persistence survives service recreation and deleted/missing sources fail closed", async () => {
  const f = fixture();
  const source = f.makeToken({ id: "source" });
  await f.cells.configure(f.region, cellConfig({ type: "token", sourceTokenUuid: source.uuid, offset: { x: 0, y: 0, z: 0 } }));
  await f.cells.setCellState(f.region, { x: 1, y: 1, z: 1 }, "GONE");

  const handlers = new Map();
  const socket = { ready: true, register(n,h){handlers.set(n,h);}, executeAsUser(n,_u,p){ return handlers.get(n)(p); } };
  const authority = { getPrimaryGm: () => game.user, getStatus: () => ({ primaryGmUserId: game.user.id }) };
  const reloaded = new RegionCellStateService({ socket, authority, regions: { isOwned: () => true } });
  assert.equal(reloaded.getCellState(f.region, { x: 1, y: 1, z: 1 }), "GONE", "Region flag is sufficient to reconstruct state after reload");

  f.scene.tokens.delete(source.id);
  f.documents.delete(source.uuid);
  const target = f.makeToken({ id: "target", x: 0, y: 0 });
  const missing = reloaded.intersectsToken(f.region, target);
  assert.equal(missing.intersects, false);
  assert.equal(missing.reason, "cell-frame-unavailable");

  f.documents.delete(f.region.uuid);
  const staleWrite = await reloaded.setCellState(f.region.uuid, { x: 0, y: 0, z: 0 }, "GONE");
  assert.equal(staleWrite.updated, false);
  assert.equal(staleWrite.reason, "region-unavailable");
});

test("4x4x4 containment lookup remains inexpensive under repeated multi-token load", async () => {
  const f = fixture();
  await f.cells.configure(f.region, cellConfig());
  const tokens = [];
  for (let i=0; i<20; i++) tokens.push(f.makeToken({ id: `t${i}`, x: (i%4)*100, y: (Math.floor(i/4)%4)*100, elevation: (i%4)*5 }));
  const iterations = 10_000;
  const start = performance.now();
  let hits = 0;
  for (let i=0; i<iterations; i++) if (f.occupancy.testTokenAt(f.region, tokens[i % tokens.length])) hits += 1;
  const elapsedMs = performance.now() - start;
  assert.ok(hits > 0);
  assert.ok(elapsedMs < 5000, `10k occupancy queries took ${elapsedMs.toFixed(1)}ms`);
});

test("attachment hook lifecycle emits one generic occupancy transition and prunes pending state", async () => {
  const f = fixture();
  const source = f.makeToken({ id: "source", x: 0, y: 0 });
  const target = f.makeToken({ id: "target", x: 200, y: 50 });
  await f.cells.configure(f.region, {
    bounds: { min: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 } },
    defaultState: "ACTIVE",
    frame: { type: "token", sourceTokenUuid: source.uuid, offset: { x: 0, y: 0, z: 0 } }
  });
  source.attachments.regions.add(f.region);

  const hooks = new Map();
  const emitted = [];
  globalThis.Hooks = {
    on(name, fn) { const id = Symbol(name); hooks.set(id, { name, fn }); return id; },
    off(_name, id) { hooks.delete(id); },
    callAll(name, ...args) {
      if (name === `${MODULE_ID}.regionCellOccupancyTransition`) emitted.push(args[0]);
      for (const { name: registered, fn } of hooks.values()) if (registered === name) fn(...args);
    }
  };
  const call = (name, ...args) => {
    for (const { name: registered, fn } of [...hooks.values()]) if (registered === name) fn(...args);
  };

  f.attachments.initialize();
  const changes = { x: 150 };
  const options = {};
  call("preUpdateToken", source, changes, options, game.user.id);
  source.x = 150;
  call("updateToken", source, changes, options, game.user.id);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].type, "enter");
  assert.equal(emitted[0].tokenUuid, target.uuid);
  assert.equal(f.attachments.getStats().pendingSnapshots, 0);
  f.attachments.shutdown();
});

test("3x3 Token fallback depth spans three Z cells and native attachment is required when Foundry attachment metadata exists", async () => {
  const f = fixture();
  const source = f.makeToken({ id: "source", x: 0, y: 0 });
  await f.cells.configure(f.region, {
    bounds: { min: { x: 0, y: 0, z: 0 }, size: { x: 4, y: 4, z: 4 } },
    defaultState: "GONE",
    cells: { "3,3,2": "ACTIVE" },
    frame: { type: "token", sourceTokenUuid: source.uuid, offset: { x: 0, y: 0, z: 0 } }
  });
  const huge = f.makeToken({ id: "huge", x: 150, y: 150, elevation: 0, width: 3, height: 3, depth: undefined });
  delete huge.depth;
  assert.equal(f.occupancy.testTokenAt(f.region, huge), true, "3x3 square-token fallback depth reaches local z=2");
  assert.deepEqual(f.attachments.regionsForSource(source), [], "token-local frame alone must not impersonate a native attachment");
  source.attachments.regions.add(f.region);
  assert.equal(f.attachments.regionsForSource(source).length, 1);

  // Foundry v14 compatibility: some attachment paths expose ownership on the
  // Region document itself rather than through TokenDocument.attachments.
  source.attachments = undefined;
  f.region.attachment = { token: source.id };
  assert.equal(f.attachments.regionsForSource(source).length, 1, "RegionDocument.attachment.token is accepted as native attachment evidence");
  f.region.attachment = null;
  assert.deepEqual(f.attachments.regionsForSource(source), [], "token-local frame alone remains insufficient when Region attachment metadata is absent");
});
