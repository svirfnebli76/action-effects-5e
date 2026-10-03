import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers/pixi-session-harness.mjs';
import { Crosshair3dIntegrationService } from '../scripts/crosshairs3d/integration-service.js';
import { Crosshair3dPropagationModeService } from '../scripts/crosshairs3d/propagation-mode-service.js';
import { measureChevronPath } from '../scripts/crosshairs3d/chevron-path-service.js';

function setup(options = {}) {
  const h = harness(options);
  canvas.grid.getCenterPoint = ({ x, y }) => ({ x: (Math.floor(x / 100) + .5) * 100, y: (Math.floor(y / 100) + .5) * 100 });
  h.measurements = 0;
  canvas.grid.measurePath = points => {
    h.measurements++;
    let distance = 0;
    for (let i = 1; i < points.length; i++) distance += Math.max(Math.abs(points[i].x - points[i - 1].x), Math.abs(points[i].y - points[i - 1].y)) / 100 * 5;
    return { distance };
  };
  return h;
}
const options = h => ({ source: h.source, shape: { type: 'chevron' }, placement: { mode: 'path' }, range: { max: 50 } });
async function click(h, extra = {}) {
  h.dispatch('pointerdown', extra);
  h.dispatch('pointerup', extra);
  await new Promise(resolve => setTimeout(resolve, 0));
  await h.flush();
}

test('Chevron confirms an L route in canonical units and pixels without moving or retargeting', async () => {
  const h = setup(), start = { ...h.source.document };
  const p = h.service.show(options(h));
  h.dispatch('pointermove', { clientX: 250, clientY: 50 });
  await click(h, { clientX: 250, clientY: 50, ctrlKey: true });
  h.dispatch('pointermove', { clientX: 250, clientY: 250 });
  await click(h, { clientX: 250, clientY: 250 });
  const result = await p;
  assert.equal(result.cancelled, false);
  assert.deepEqual(result.waypoints, [{ x: 12.5, y: 2.5, z: 0 }, { x: 12.5, y: 12.5, z: 0 }]);
  assert.deepEqual(result.pixelWaypoints, [{ x: 250, y: 50, elevation: 0 }, { x: 250, y: 250, elevation: 0 }]);
  assert.equal(result.distance, 20);
  assert.equal(result.remaining, 30);
  assert.deepEqual(h.source.document, start);
  assert.deepEqual([...game.user.targets].map(t => t.id), ['outside']);
  assert.equal(h.history.length, 0);
  assert.ok(Object.isFrozen(result.waypoints[0]));
  assert.ok(h.clean());
});

test('equal-cost diagonal travel counts each square once; pure vertical travel also costs movement', () => {
  setup();
  const origin = { x: 50, y: 50, elevation: 0 };
  const measure = points => measureChevronPath(points, { grid: canvas.grid, size: 100, distance: 5 });
  assert.equal(measure([origin, { x: 850, y: 850, elevation: 0 }]), 40);
  assert.equal(measure([origin, { x: 150, y: 150, elevation: 5 }]), 5);
  assert.equal(measure([origin, { ...origin, elevation: 10 }]), 10);
  assert.equal(measure([origin, { x: 150, y: 50, elevation: 10 }]), 10);
});

test('over-limit destination and waypoints cannot confirm; a shorter route can still finish', async () => {
  const h = setup(); let revision;
  const p = h.service.show({ ...options(h), range: { max: 20 }, onRevision: r => { revision = r; } });
  await click(h, { clientX: 550, clientY: 550, ctrlKey: true });
  assert.equal(revision.distance, 25);
  assert.equal(revision.valid, false);
  assert.equal(revision.waypoints.length, 0);
  await click(h, { clientX: 550, clientY: 550 });
  assert.equal(h.service.getStats().active, true);
  await click(h, { clientX: 450, clientY: 450 });
  assert.equal((await p).distance, 20);
  assert.ok(h.clean());
});

test('pointer changes within a square and animation frames never recalculate path distance', async () => {
  const h = setup(); let revisions = 0;
  const p = h.service.show({ ...options(h), onRevision: () => revisions++ });
  h.dispatch('pointermove', { clientX: 210, clientY: 210 });
  const count = h.measurements, revisionCount = revisions;
  for (let i = 0; i < 20; i++) { h.dispatch('pointermove', { clientX: 211 + i, clientY: 211 + i }); await h.tick(); }
  assert.equal(h.measurements, count);
  assert.equal(revisions, revisionCount);
  h.service.cancel(); await p;
  assert.ok(h.clean());
});

test('right-click removes one waypoint, restores height, then cancels only when empty', async () => {
  const h = setup(); let revision;
  const p = h.service.show({ ...options(h), onRevision: r => { revision = r; } });
  h.dispatch('wheel', { ctrlKey: true, deltaY: -1 });
  await click(h, { ctrlKey: true }); // vertical waypoint
  h.dispatch('keyup', { key: 'Control' });
  await click(h, { clientX: 250, clientY: 50, ctrlKey: true });
  assert.equal(revision.waypoints.length, 2);
  await click(h, { button: 2 });
  assert.equal(revision.waypoints.length, 1);
  assert.equal(revision.cursor.elevation, 5);
  await click(h, { button: 2 });
  assert.equal(revision.waypoints.length, 0);
  assert.equal(revision.cursor.elevation, 0);
  assert.equal(h.service.getStats().active, true);
  await click(h, { button: 2 });
  assert.equal((await p).cancelled, true);
  assert.ok(h.clean());
});

test('elevation markers appear only at changes and labels keep high-resolution 16px/2px styling', async () => {
  const h = setup();
  const p = h.service.show(options(h));
  h.dispatch('wheel', { ctrlKey: true, deltaY: -1 });
  await click(h, { ctrlKey: true });
  h.dispatch('keyup', { key: 'Control' });
  await click(h, { clientX: 250, clientY: 50, ctrlKey: true });
  h.dispatch('pointermove', { clientX: 350, clientY: 50 });
  const labels = h.records.texts.filter(t => !t.destroyed);
  assert.equal(labels.filter(t => t.text === '↑5 ft').length, 1);
  assert.equal(labels.filter(t => t.text === 'Elevation +5 ft').length, 1);
  for (const label of labels) {
    assert.equal(label.style.fontSize, 16);
    assert.equal(label.style.strokeThickness, 2);
    assert.ok(label.resolution >= 2);
    assert.equal(label.roundPixels, true);
  }
  h.dispatch('wheel', { ctrlKey: true, deltaY: 1 });
  h.dispatch('wheel', { ctrlKey: true, deltaY: 1 });
  const palettes = h.records.graphics.flatMap(g => g.commands).filter(c => c[0] === 'beginFill');
  assert.ok(palettes.some(c => c[1] !== 0x388E8E));
  h.service.cancel(); await p;
  assert.ok(h.clean());
});

for (const ending of ['Escape', 'pointercancel', 'canvasTearDown', 'source-update', 'source-delete', 'window-blur', 'abort', 'api']) {
  test(`Chevron ${ending}: cancellation cleans input, ticker, PIXI, and shared guard`, async () => {
    const h = setup(), abort = new AbortController();
    const p = h.service.show({ ...options(h), signal: abort.signal });
    if (ending === 'Escape') h.dispatch('keydown', { key: 'Escape' });
    else if (ending === 'canvasTearDown') h.hook(ending);
    else if (ending === 'source-update' || ending === 'source-delete') h.hook(ending === 'source-update' ? 'updateToken' : 'deleteToken', h.source.document);
    else if (ending === 'window-blur') h.dispatch('blur', { target: window });
    else if (ending === 'abort') abort.abort();
    else if (ending === 'api') h.service.cancel();
    else h.dispatch(ending);
    assert.equal((await p).cancelled, true);
    assert.equal(h.service.getStats().active, false);
    assert.equal(h.history.length, 0);
    assert.ok(h.clean());
  });
}

test('shared guard prevents overlaps between Chevron and all existing shapes in both directions', async () => {
  const h = setup();
  let p = h.service.show(options(h));
  await assert.rejects(h.service.show({ source: h.source, shape: { type: 'sphere', radius: 10 } }), /Only one/);
  h.service.cancel(); await p;
  p = h.service.show({ source: h.source, shape: { type: 'sphere', radius: 10 } });
  await assert.rejects(h.service.show(options(h)), /Only one/);
  h.service.cancel(); await p;
  assert.ok(h.clean());
});

test('point mode uses Euclidean range by default and Ctrl click confirms rather than adding waypoints', async () => {
  const h = setup();
  const p = h.service.show({ source: h.source, shape: { type: 'chevron' }, range: { max: 50 } });
  await click(h, { clientX: 350, clientY: 450, ctrlKey: true });
  const r = await p;
  assert.equal(r.mode, 'point');
  assert.equal(r.metric, 'euclidean');
  assert.equal(r.distance, 25);
  assert.equal(r.waypoints.length, 1);
  assert.ok(h.clean());
});

test('square snapping honors native grid offsets and published coordinates honor scene origin', async () => {
  const h = setup();
  canvas.dimensions.sceneRect = { x: 100, y: 200 };
  canvas.grid.getCenterPoint = ({ x, y }) => ({ x: Math.floor((x - 25) / 100) * 100 + 75, y: Math.floor((y - 25) / 100) * 100 + 75 });
  const p = h.service.show({ source: h.source, shape: { type: 'chevron' }, range: { max: 50 } });
  await click(h, { clientX: 270, clientY: 270 });
  const r = await p;
  assert.deepEqual(r.pixelDestination, { x: 275, y: 275, elevation: 0 });
  assert.deepEqual(r.destination, { x: 8.75, y: 3.75, z: 0 });
  assert.ok(h.clean());
});

test('configured Chevron works from stored Item data and rejects incompatible features before rendering', async () => {
  const h = setup({ placementDependencies: { propagationModes: new Crosshair3dPropagationModeService() } });
  const integration = new Crosshair3dIntegrationService({ placement: h.service, propagationModes: new Crosshair3dPropagationModeService() });
  const configuration = { schemaVersion: 1, shape: { type: 'chevron' }, placement: { mode: 'path' }, range: { max: 50 } };
  const item = { uuid: 'Actor.test.Item.test', flags: { 'action-effects-5e': { crosshairs3d: configuration } } };
  const p = integration.show({ source: h.source, item, readCat: false });
  await h.flush();
  await click(h, { clientX: 250, clientY: 50 });
  const r = await p;
  assert.equal(r.distance, 10);
  assert.equal(r.provenance.itemUuid, item.uuid);
  assert.equal(r.provenance.propagation.mode, 'none');
  for (const overrides of [
    { persistent: { enabled: true } }, { propagation: { mode: 'direct' } },
    { capabilities: { rotation: true } }, { placement: { mode: 'source' } }, { range: { metric: 'bogus' } }
  ]) await assert.rejects(integration.show({ source: h.source, configuration, overrides, readCat: false }), /Invalid/);
  await assert.rejects(integration.resolve({ configuration, catOptions: { propagation: 'spread' } }), /None propagation/);
  assert.deepEqual(integration.getCatPropagationConfig('chevron').options.map(o => o.value), ['default', 'none']);
  assert.ok(h.clean());
});

test('renderer failure cleans a partially initialized PIXI tree and releases the shared session', async () => {
  const h = setup();
  const Text = PIXI.Text;
  PIXI.Text = class { constructor() { throw new Error('text allocation failed'); } };
  await assert.rejects(h.service.show(options(h)), /text allocation failed/);
  PIXI.Text = Text;
  assert.equal(h.service.getStats().active, false);
  assert.ok(h.clean());
  const p = h.service.show(options(h)); h.service.cancel(); await p;
  assert.ok(h.clean());
});

test('non-equal grid diagonals fail closed, while Euclidean point selection stays available', async () => {
  const h = setup();
  canvas.grid.measurePath = () => ({ distance: 7.07 });
  await assert.rejects(h.service.show(options(h)), /equal-cost diagonals/);
  assert.ok(h.clean());
  const p = h.service.show({ source: h.source, shape: { type: 'chevron' } });
  h.service.cancel(); await p;
  assert.ok(h.clean());
});

for (const reverse of [false, true]) test(`Chevron elevation honors reverse-wheel setting ${reverse}`, async () => {
  const h = setup({ reverse }); let revision;
  const p = h.service.show({ ...options(h), onRevision: r => { revision = r; } });
  h.dispatch('wheel', { ctrlKey: true, deltaY: -1 });
  assert.equal(revision.cursor.elevation, reverse ? -5 : 5);
  h.dispatch('pointermove', { ctrlKey: true, clientX: 950, clientY: 950 });
  assert.equal(revision.cursor.x, 50);
  h.dispatch('keyup', { key: 'Control' });
  h.dispatch('pointermove', { clientX: 250, clientY: 50 });
  assert.equal(revision.cursor.x, 250);
  assert.equal(revision.cursor.elevation, reverse ? -5 : 5);
  h.service.cancel(); await p;
  assert.ok(h.clean());
});

test('disabled elevation ignores wheel; modifier combinations never rotate the Token or adjust height', async () => {
  const h = setup(); let revision;
  const p = h.service.show({ ...options(h), capabilities: { elevation: false }, onRevision: r => { revision = r; } });
  for (const modifiers of [{ ctrlKey: true }, { shiftKey: true }, { ctrlKey: true, shiftKey: true }]) {
    const e = h.dispatch('wheel', { ...modifiers, deltaY: -1 });
    assert.equal(e.prevented, true);
  }
  assert.equal(revision.cursor.elevation, 0);
  h.service.cancel(); await p;
  assert.ok(h.clean());
});

test('raw Chevron rejects propagation, persistence, and invalid limits before a session is stranded', async () => {
  const h = setup({ placementDependencies: { propagationModes: new Crosshair3dPropagationModeService() } });
  for (const extra of [{ propagation: { mode: 'direct' } }, { propagation: { override: 'spread' } },
    { persistent: { enabled: true } }, { range: { max: 0 } }, { controls: { elevationStep: -5 } }]) {
    await assert.rejects(h.service.show({ ...options(h), ...extra }));
    assert.equal(h.service.getStats().active, false);
    assert.ok(h.clean());
  }
});

function setupMovement(cost = distance => distance + (distance >= 40 ? 10 : 0)) {
  const h = setup();
  globalThis.CONFIG = { Token: { movement: { actions: { walk: { measure: true, teleport: false, canSelect: () => true } } } } };
  h.costCalls = 0;
  h.source.createTerrainMovementPath = (points, options) => {
    assert.equal(options.preview, true);
    assert.equal(points[0].x, 0);
    assert.equal(points[0].y, 0);
    assert.ok(points.every(point => point.action === 'walk'));
    return points;
  };
  h.source.measureMovementPath = (points, options) => {
    assert.equal(options.preview, true); h.costCalls++;
    const distance = canvas.grid.measurePath(points).distance;
    return { distance, cost: cost(distance) };
  };
  return h;
}
const movementOptions = h => ({ ...options(h), movement: { enabled: true, action: 'walk' } });

test('movement counter and confirmation use cost while preserving physical distance', async () => {
  const h = setupMovement(); let revision;
  const p = h.service.show({ ...movementOptions(h), onRevision: r => { revision = r; } });
  await click(h, { clientX: 950, clientY: 50, ctrlKey: true });
  assert.equal(revision.distance, 45); assert.equal(revision.cost, 55);
  assert.equal(revision.valid, false); assert.equal(revision.waypoints.length, 0);
  await click(h, { clientX: 950, clientY: 50 });
  assert.equal(h.service.getStats().active, true);
  h.dispatch('pointermove', { clientX: 850, clientY: 50 });
  assert.equal(revision.distance, 40); assert.equal(revision.cost, 50);
  assert.equal(revision.remaining, 0); assert.equal(revision.valid, true);
  assert.ok(h.records.texts.some(t => !t.destroyed && t.text === '50/50 ft'));
  await click(h, { clientX: 850, clientY: 50 });
  const r = await p;
  assert.equal(r.distance, 40); assert.equal(r.cost, 50);
  assert.equal(r.movementDistance, 40); assert.equal(r.movementAction, 'walk');
  assert.equal(r.remaining, 0); assert.ok(h.clean());
});

test('movement cost recomputes on square changes and Region changes, never on pulse frames', async () => {
  const h = setupMovement(); let revision;
  const p = h.service.show({ ...movementOptions(h), onRevision: r => { revision = r; } });
  h.dispatch('pointermove', { clientX: 810, clientY: 50 });
  const before = h.costCalls;
  for (let i = 0; i < 10; i++) { h.dispatch('pointermove', { clientX: 811 + i, clientY: 50 }); await h.tick(); }
  assert.equal(h.costCalls, before);
  h.source.measureMovementPath = () => ({ distance: 40, cost: 60 });
  h.hook('updateRegion', { documentName: 'Region', parent: canvas.scene });
  assert.equal(revision.cost, 60); assert.equal(revision.valid, false);
  h.service.cancel(); await p; assert.ok(h.clean());
});

test('infinite native costs block placement and malformed measurements clean the session', async () => {
  let h = setupMovement(distance => distance ? Infinity : 0);
  let p = h.service.show(movementOptions(h));
  await click(h, { clientX: 250, clientY: 50 });
  assert.equal(h.service.getStats().active, true);
  h.service.cancel(); await p; assert.ok(h.clean());
  h = setupMovement();
  h.source.measureMovementPath = () => ({ distance: 0, cost: NaN });
  await assert.rejects(h.service.show(movementOptions(h)), /Invalid native/);
  assert.ok(h.clean());
});

test('invalid movement options fail before opening placement', async () => {
  const h = setupMovement();
  for (const extra of [
    { movement: { enabled: true, action: 'missing' } },
    { movement: { enabled: true } },
    { movement: { enabled: 'yes', action: 'walk' } },
    { movement: { enabled: true, action: 'walk' }, range: { max: 50, metric: 'euclidean' } }
  ]) { await assert.rejects(h.service.show({ ...options(h), ...extra })); assert.ok(h.clean()); }
  delete h.source.createTerrainMovementPath;
  await assert.rejects(h.service.show(movementOptions(h)), /native Token/);
  assert.ok(h.clean());
});
