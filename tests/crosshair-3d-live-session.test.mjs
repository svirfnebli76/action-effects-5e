import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers/pixi-session-harness.mjs';
import { Crosshair3dPropagationModeService } from '../scripts/crosshairs3d/propagation-mode-service.js';

const shapes = [
  { type: 'sphere', radius: 10 }, { type: 'prism', length: 20, width: 20, height: 20 },
  { type: 'cylinder', radius: 10, height: 20 }, { type: 'cone', length: 15 },
  { type: 'line', length: 60, width: 5 }, { type: 'free-line', length: 60, width: 5, height: 20 }
];
for (const shape of shapes) test(`${shape.type}: real geometry and renderer confirm without Sequencer, clean all resources`, async () => {
  const h = harness();
  const p = h.service.show({ source: h.source, shape, range: { max: 120, policy: 'endpoints' } });
  await h.flush(); h.dispatch('pointermove'); await h.flush();
  await h.tick(1000); await h.confirm(); const result = await p;
  assert.equal(result.cancelled, false);
  assert.equal(result.shape.type, shape.type);
  assert.deepEqual([...game.user.targets].map(t => t.id), result.targetIds);
  assert.ok(h.clean()); assert.equal(h.service.getStats().active, false);
});

test('rapid wheel burst preserves every notch and final confirm waits for newest async targeting', async () => {
  const h = harness(); let release;
  const gate = new Promise(r => { release = r; }); let calls = 0;
  const p = h.service.show({ source: h.source, shape: shapes[0], targetFilter: async () => { if (++calls === 1) await gate; return true; } });
  await h.flush();
  for (let i = 0; i < 7; i++) h.dispatch('wheel', { ctrlKey: true, deltaY: -1 });
  h.dispatch('pointermove', { ctrlKey: true }); await h.confirm();
  release(); await h.flush(); const result = await p;
  assert.equal(result.placementPoint.z, 35);
  assert.equal(result.revision.serial, 9); // initial, seven wheels, final
  assert.ok(h.service.getStats().staleDiscards >= 1);
  assert.ok(h.clean());
});

test('cancellation during async filter prevents late publication and restores original targets', async () => {
  const h = harness(); let release; const gate = new Promise(r => release = r);
  const p = h.service.show({ source: h.source, shape: shapes[0], targetFilter: () => gate });
  await h.flush(); h.dispatch('keydown', { key: 'Escape' });
  assert.equal((await p).cancelled, true);
  release(true); await h.flush();
  assert.deepEqual([...game.user.targets].map(t => t.id), ['outside']); assert.ok(h.clean());
});

test('source cone has continuous apex, no wheel rotation, 1/5-grid short-cone increments', async () => {
  const h = harness(); const revisions = [];
  const p = h.service.show({ source: h.source, shape: shapes[3], onRevision: r => revisions.push(r) });
  await h.flush(); h.dispatch('pointermove', { clientX: 800, clientY: 130 }); await h.flush();
  const before = revisions.at(-1); assert.ok(before.point.y > 0 && before.point.y < 5);
  h.dispatch('wheel', { shiftKey: true, deltaY: -1 }); await h.flush(); assert.equal(revisions.at(-1).yaw, before.yaw);
  h.dispatch('wheel', { ctrlKey: true, deltaY: -1 }); await h.flush();
  assert.ok(Math.abs(revisions.at(-1).terminal.z - revisions.at(-1).point.z - 1) < 1e-8);
  await h.confirm(); await p; assert.ok(h.clean());
});

test('source-driven line aims with the mouse and has no Rotate mode', async () => {
  const h = harness(); let revision;
  const p = h.service.show({ source: h.source, shape: shapes[4], onRevision: value => revision = value });
  await h.flush();
  h.dispatch('pointermove', { clientX: 800, clientY: 130 }); await h.flush();
  const aimedYaw = revision.yaw;
  h.dispatch('wheel', { shiftKey: true, deltaY: -1 }); await h.flush();
  assert.equal(revision.yaw, aimedYaw);
  assert.ok(!h.records.texts.some(text => text.text === 'SHIFT'));
  h.service.cancel(); await p;
});

for (const length of [25, 26, 50, 51]) test(`cone ${length} ft elevation tier`, async () => {
  const h = harness(); const p = h.service.show({ source: h.source, shape: { type: 'cone', length } });
  await h.flush(); h.dispatch('pointermove'); h.dispatch('wheel', { ctrlKey: true, deltaY: -1 }); await h.flush();
  await h.confirm(); const r = await p;
  assert.ok(Math.abs(r.revision.terminal.z - r.placementPoint.z - (length <= 25 ? 1 : 5)) < 1e-7);
});

test('cone crosses both vertical poles and wraps pitch with fixed centerline length', async () => {
  const h = harness(); let r;
  const p = h.service.show({ source: h.source, shape: { type: 'cone', length: 15 }, onRevision: v => r = v });
  await h.flush(); let above = false, flipped = false, below = false, wrapped = false, last = 0;
  for (let i = 0; i < 65; i++) {
    h.dispatch('wheel', { ctrlKey: true, deltaY: -1 }); await h.flush();
    above ||= Math.abs(r.pitch - 90) < 1e-8; below ||= Math.abs(r.pitch + 90) < 1e-8;
    flipped ||= r.arcPitch > 90 && r.arcPitch < 270;
    wrapped ||= last > 300 && r.arcPitch < 20; last = r.arcPitch;
    assert.ok(Math.abs(Math.hypot(r.terminal.x-r.point.x, r.terminal.y-r.point.y, r.terminal.z-r.point.z)-15)<1e-8);
  }
  assert.ok(above && below && flipped && wrapped);
  h.service.cancel(); await p; assert.ok(h.clean());
});

test('remote selected Z persists through mouse movement and modifier release does not move placement', async () => {
  const h = harness(); let r;
  const p = h.service.show({ source: h.source, shape: shapes[2], onRevision: v => r = v });
  await h.flush(); h.dispatch('pointermove'); await h.flush();
  h.dispatch('wheel', { ctrlKey: true, deltaY: 1 }); await h.flush();
  const point = { ...r.point };
  h.dispatch('keyup', { key: 'Control' }); h.dispatch('pointermove'); await h.flush();
  assert.deepEqual(r.point, point);
  h.dispatch('pointermove', { clientX: 250 }); await h.flush();
  assert.equal(r.point.z, -5); assert.notEqual(r.point.x, point.x);
  h.service.cancel(); await p;
});

test('sphere placement snaps XY to a full cell center and Z to complete grid units', async () => {
  const h = harness({ ground: 2.6 }); let r;
  const p = h.service.show({ source: h.source, shape: { type: 'sphere', radius: 10, origin: { x: 2.5, y: 2.5, z: 2.6 } }, onRevision: value => r = value });
  await h.flush();
  assert.deepEqual(r.point, { x: 2.5, y: 2.5, z: 5 });
  h.dispatch('pointermove', { clientX: 200, clientY: 200 }); await h.flush();
  assert.deepEqual(r.point, { x: 12.5, y: 12.5, z: 5 });
  h.dispatch('wheel', { ctrlKey: true, deltaY: -1 }); await h.flush();
  assert.equal(r.point.z, 10);
  h.service.cancel(); await p; assert.ok(h.clean());
});

test('sphere placement rejects a radius that is not a whole Scene grid unit', async () => {
  const h = harness();
  await assert.rejects(
    h.service.show({ source: h.source, shape: { type: 'sphere', radius: 7.5 } }),
    /whole number of Scene grid units/
  );
  assert.ok(h.clean());
});

test('sphere range uses the nearest caster corner and never leaves its snapped cell center', async () => {
  const h = harness(); let r;
  const p = h.service.show({ source: h.source, shape: { type: 'sphere', radius: 10 }, range: { max: 7.6 }, onRevision: value => r = value });
  await h.flush();
  const initial = { ...r.point };
  h.dispatch('pointermove', { clientX: 200, clientY: 50 }); await h.flush();
  assert.deepEqual(r.point, initial, 'the 7.906-ft corner distance exceeds the 7.6-ft range');
  assert.equal((r.point.x / 5) % 1, 0.5);
  assert.equal((r.point.y / 5) % 1, 0.5);
  h.service.cancel(); await p; assert.ok(h.clean());
});

test('range clamps remote MOVE in XYZ and rejects elevation outside range', async () => {
  const h = harness(); let r;
  const p = h.service.show({ source: h.source, shape: shapes[0], range: { max: 10 }, onRevision: v => r = v });
  await h.flush(); h.dispatch('pointermove', { clientX: 1200, clientY: 50 }); await h.flush();
  assert.ok(h.range.distanceFromVolumeToPoint(h.tokens.resolve(h.source, { grid: h.metrics.resolve(), coordinateSpace: 'pixels' }), r.point) <= 10 + 1e-8);
  for(let i=0;i<20;i++) h.dispatch('wheel',{ctrlKey:true,deltaY:-1}); await h.flush();
  assert.ok(r.point.z <= 15); h.service.cancel(); await p;
});

test('free line rotate/resize/elevate obey endpoint range and preserve geometry origin', async () => {
  const h = harness(); let r;
  const p = h.service.show({ source: h.source, shape: shapes[5], range: { max: 40, policy: 'endpoints' }, onRevision: v => r = v });
  await h.flush(); h.dispatch('wheel', { altKey: true, deltaY: 1 }); await h.flush();
  assert.equal(r.length, 55);
  h.dispatch('wheel', { shiftKey: true, deltaY: -1 }); await h.flush(); assert.equal(r.yaw, 5);
  h.dispatch('wheel', { ctrlKey: true, deltaY: -1 }); await h.flush(); assert.equal(r.point.z, 5);
  assert.ok(Math.abs(Math.hypot(r.shape.origin.x-r.point.x,r.shape.origin.y-r.point.y)-27.5)<1e-8);
  h.service.cancel(); await p;
});

for (const ending of ['pointercancel', 'canvasTearDown', 'source-update', 'right-click']) test(`${ending}: cancellation cleanup`, async () => {
  const h = harness(); const p = h.service.show({ source: h.source, shape: shapes[0] }); await h.flush();
  if(ending==='canvasTearDown') h.hook(ending);
  else if(ending==='source-update') h.hook('updateToken',h.source.document);
  else if(ending==='right-click') { h.dispatch('pointerdown',{button:2});h.dispatch('pointerup',{button:2});await h.tick(160); }
  else h.dispatch(ending);
  assert.equal((await p).cancelled,true); assert.ok(h.clean());
});

test('dialog control blur is ignored while a true window blur cancels and cleans up', async () => {
  const h = harness();
  const p = h.service.show({ source: h.source, shape: shapes[0] });
  await h.flush();

  h.dispatch('blur', { target: { tagName: 'BUTTON' } });
  await h.flush();
  assert.equal(h.service.getStats().active, true, 'closing launcher focus must not cancel placement');

  h.dispatch('blur', { target: globalThis.window });
  assert.equal((await p).cancelled, true);
  assert.ok(h.clean());
});

test('renderer failure after initial setup releases singleton and restores targets', async () => {
  const h = harness({ renderer: { show() {}, update() { throw new Error('render failed'); }, frame() {}, clear() {} } });
  await assert.rejects(h.service.show({ source: h.source, shape: shapes[0] }), /render failed/);
  assert.ok(h.clean()); assert.equal(h.service.getStats().active,false);
  assert.deepEqual([...game.user.targets].map(t=>t.id), ['outside']);
});

test('unmodified wheel reaches native zoom; modified input outside canvas is untouched', async () => {
  const h = harness(); const p = h.service.show({ source: h.source, shape: shapes[0] }); await h.flush();
  assert.equal(h.dispatch('wheel',{deltaY:1}).prevented,undefined);
  assert.equal(h.dispatch('wheel',{target:{},ctrlKey:true,deltaY:1}).prevented,undefined);
  assert.equal(h.dispatch('wheel',{ctrlKey:true,shiftKey:true,deltaY:1}).prevented,true);
  h.service.cancel(); await p;
});

test('square and circle use shallow geometry; cube retains full height', async () => {
  for(const [shape,height,type] of [[{type:'square',size:20},5,'prism'],[{type:'circle',radius:10},5,'cylinder'],[{type:'cube',size:20},20,'prism']]) {
    const h=harness();const p=h.service.show({source:h.source,shape});await h.flush();h.dispatch('pointermove');await h.confirm();
    const r=await p;assert.equal(r.shape.height,height);assert.equal(r.shape.type,type);
  }
});

test('free-line elevation takes whole steps and reversal does not inherit a fractional boundary',async()=>{
  const h=harness();let r;
  const p=h.service.show({source:h.source,shape:{type:'free-line',length:10,width:5,height:5},range:{max:11,policy:'endpoints'},onRevision:v=>r=v});
  await h.flush();for(let i=0;i<8;i++) { h.dispatch('wheel',{ctrlKey:true,deltaY:-1});await h.flush(); }
  assert.equal(r.point.z,15);
  h.dispatch('wheel',{ctrlKey:true,deltaY:1});await h.flush();assert.equal(r.point.z,10);
  h.service.cancel();await p;
});


test('resolved propagation mode is passed to the PIXI renderer for target-preview UX', async () => {
  for (const mode of ['none','direct','spread']) {
    let shownMode = null;
    const renderer = {
      show(context) { shownMode = context.propagationMode; },
      update() {},
      frame() {},
      clear() {}
    };
    const h = harness({
      renderer,
      placementDependencies: {
        propagationModes: { resolve: () => ({ mode, source: 'test' }) }
      }
    });
    const promise = h.service.show({ source: h.source, shape: shapes[0] });
    await h.flush();
    assert.equal(shownMode, mode);
    h.service.cancel();
    await promise;
  }
});

test('capability disabling hides unsupported instructions and prevents manipulation',async()=>{
  const h=harness();let r;
  const p=h.service.show({source:h.source,shape:shapes[1],capabilities:{rotation:false,elevation:false},onRevision:v=>r=v});
  await h.flush();const before=r;
  h.dispatch('wheel',{ctrlKey:true,deltaY:-1});h.dispatch('wheel',{shiftKey:true,deltaY:-1});await h.flush();
  assert.equal(r,before);assert.ok(!h.records.texts.some(t=>t.text==='CTRL'||t.text==='SHIFT'));
  h.service.cancel();await p;
});

test('optional LOS constrains MOVE and fails closed without a native visibility test',async()=>{
  const h=harness();let r;h.source.vision={testPoint:p=>p.x<=300};
  const p=h.service.show({source:h.source,shape:shapes[0],capabilities:{los:true},onRevision:v=>r=v});
  await h.flush();h.dispatch('pointermove',{clientX:700,clientY:50});await h.flush();
  assert.ok(r.point.x*20<=300+1e-6);h.service.cancel();await p;
  delete h.source.vision;
  await assert.rejects(h.service.show({source:h.source,shape:shapes[0],capabilities:{los:true}}),/visibility/);
});

test('Sequencer being enabled has no effect on placement; its animation API is untouched',async()=>{
  const h=harness();let calls=0;globalThis.Sequencer={Crosshair:{show(){calls++;throw Error('legacy');}},EffectManager:{sentinel:true}};
  const original=globalThis.Sequencer;
  const p=h.service.show({source:h.source,shape:shapes[0]});await h.flush();h.dispatch('pointermove');await h.confirm();await p;
  assert.equal(calls,0);assert.equal(globalThis.Sequencer,original);assert.equal(original.EffectManager.sentinel,true);
});

test('a second session cannot steal an active session; token changes refresh targeting',async()=>{
  const h=harness();let count=0;
  const p=h.service.show({source:h.source,shape:shapes[0],onRevision:()=>count++});await h.flush();
  await assert.rejects(h.service.show({source:h.source,shape:shapes[0]}),/Only one/);
  h.hook('updateToken',h.inside.document);await h.flush();assert.equal(count,2);
  h.service.cancel();await p;assert.ok(h.clean());
});

test('final confirmation publishes propagated cells, targets from them, and persists exactly once', async () => {
  const calls = { propagation: 0, persistence: 0 };
  const h = harness({ placementDependencies: {
    propagationModes: { resolve: () => ({ mode: 'direct', source: 'override' }) },
    propagationEnvironment: { create: () => ({ adapter: true }) },
    propagation: { async resolve({ shape, grid, mode, environment }) {
      calls.propagation += 1;
      assert.equal(mode, 'direct');
      assert.equal(environment.adapter, true);
      return Object.freeze({ mode, shape, grid, origin: shape.origin, support: 'continuous-primitive',
        cells: Object.freeze([{ x: 1, y: 1, z: 0 }]), stats: Object.freeze({ affectedCells: 1 }) });
    } },
    persistentAreas: { async create({ propagation }) {
      calls.persistence += 1;
      assert.equal(propagation.cells.length, 1);
      return Object.freeze({ created: true, regionUuid: 'Scene.test.Region.persisted' });
    } }
  } });
  const promise = h.service.show({ source: h.source,
    shape: { type: 'prism', length: 10, width: 10, height: 5 }, range: { max: 120 },
    propagation: { override: 'direct' }, persistent: { enabled: true } });
  await h.flush();
  h.dispatch('pointermove');
  await h.flush();
  await h.confirm();
  const result = await promise;
  assert.equal(result.cancelled, false);
  assert.equal(result.propagation.mode, 'direct');
  assert.deepEqual(result.targetIds, ['inside']);
  assert.equal(result.persistentRegion.regionUuid, 'Scene.test.Region.persisted');
  assert.ok(calls.propagation >= 1);
  assert.equal(calls.persistence, 1);
});

test('cancelling propagated placement creates no persistent Region', async () => {
  let creations = 0;
  const h = harness({ placementDependencies: {
    propagationModes: { resolve: () => ({ mode: 'none', source: 'item-default' }) },
    propagation: { async resolve({ shape, grid }) {
      return { mode: 'none', shape, grid, origin: shape.origin, support: 'continuous-primitive', cells: [] };
    } },
    persistentAreas: { async create() { creations += 1; return { created: true }; } }
  } });
  const promise = h.service.show({ source: h.source,
    shape: { type: 'prism', length: 10, width: 10, height: 5 },
    persistent: { enabled: true } });
  await h.flush();
  h.dispatch('pointercancel');
  const result = await promise;
  assert.equal(result.cancelled, true);
  assert.equal(creations, 0);
});

test('presentation advances immediately while delayed propagation remains authoritative and stale results never publish', async () => {
  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const updates = [];
  const resolved = [];
  let propagationCalls = 0;
  const renderer = {
    show() {},
    update(revision, mode) { updates.push({ revision, mode }); },
    frame() {},
    clear() {}
  };
  const h = harness({ renderer, placementDependencies: {
    propagationModes: { resolve: () => ({ mode: 'direct', source: 'test' }) },
    propagationEnvironment: { create: () => ({ test: true }) },
    propagation: { async resolve({ shape, grid, mode }) {
      propagationCalls += 1;
      if (propagationCalls === 1) await firstGate;
      return Object.freeze({ mode, shape, grid, origin: shape.origin, support: 'continuous-primitive',
        cells: Object.freeze(propagationCalls === 1 ? [{ x: 1, y: 1, z: 0 }] : []) });
    } }
  } });

  const promise = h.service.show({ source: h.source, shape: { type: 'sphere', radius: 10 },
    propagation: { override: 'direct' }, onRevision: revision => resolved.push(revision) });
  await h.flush();

  assert.equal(propagationCalls, 1, 'initial authoritative propagation should be in flight');
  assert.equal(updates.at(-1).revision.serial, 1, 'initial geometry must already be presented');
  assert.equal(h.service.getStats().activeResolvedSerial, -1);

  const before = { ...updates.at(-1).revision.point };
  h.dispatch('pointermove', { clientX: 500, clientY: 200 });
  const newestPresentation = updates.at(-1).revision;
  assert.equal(newestPresentation.serial, 2, 'new visual intent must present synchronously');
  assert.notDeepEqual(newestPresentation.point, before);
  assert.equal(h.service.getStats().activePresentationSerial, 2);
  assert.deepEqual([...game.user.targets].map(token => token.id), ['outside'], 'targets must not follow unresolved visual intent');

  releaseFirst();
  await new Promise(resolve => setTimeout(resolve, 40));
  await h.flush();
  assert.equal(propagationCalls, 2, 'only the newest stable request should run after the stale calculation');
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].serial, 2);
  assert.ok(h.service.getStats().staleDiscards >= 1);
  assert.ok(!h.history.some(ids => ids.includes('inside')), 'stale propagation targets must never be published');

  h.service.cancel();
  await promise;
  assert.ok(h.clean());
});

test('confirmation waits for propagation of the exact final presentation and persistence receives those cells', async () => {
  let releaseInitial, releaseFinal;
  const initialGate = new Promise(resolve => { releaseInitial = resolve; });
  const finalGate = new Promise(resolve => { releaseFinal = resolve; });
  const updates = [];
  const persistence = [];
  let propagationCalls = 0;
  const renderer = {
    show() {},
    update(revision, mode) { updates.push({ revision, mode }); },
    frame() {},
    clear() {}
  };
  const h = harness({ renderer, placementDependencies: {
    propagationModes: { resolve: () => ({ mode: 'spread', source: 'test' }) },
    propagationEnvironment: { create: () => ({ test: true }) },
    propagation: { async resolve({ shape, grid, mode }) {
      propagationCalls += 1;
      if (propagationCalls === 1) await initialGate;
      else if (propagationCalls === 2) await finalGate;
      const cells = propagationCalls === 2 ? [{ x: 1, y: 1, z: 0 }] : [{ x: 99, y: 99, z: 0 }];
      return Object.freeze({ mode, shape, grid, origin: shape.origin, support: 'continuous-primitive', cells: Object.freeze(cells) });
    } },
    persistentAreas: { async create(args) {
      persistence.push(args);
      return Object.freeze({ created: true, regionUuid: 'Scene.test.Region.final' });
    } }
  } });

  let settled = false;
  const promise = h.service.show({ source: h.source,
    shape: { type: 'sphere', radius: 10 }, propagation: { override: 'spread' }, persistent: { enabled: true } });
  promise.finally(() => { settled = true; });
  await h.flush();
  h.dispatch('pointermove', { clientX: 500, clientY: 300 });
  await h.confirm();

  const finalPresentation = updates.at(-1).revision;
  assert.equal(finalPresentation.reason, 'final-confirm');
  assert.equal(finalPresentation.serial, 3);
  assert.equal(settled, false, 'confirmation must not finish while older propagation is still running');

  releaseInitial();
  await h.flush();
  assert.equal(propagationCalls, 2, 'final-confirm propagation should start after the stale request completes');
  assert.equal(settled, false, 'confirmation must wait for final-confirm propagation itself');

  releaseFinal();
  await h.flush();
  const result = await promise;
  assert.equal(result.cancelled, false);
  assert.equal(result.revision.serial, finalPresentation.serial);
  assert.deepEqual(result.placementPoint, finalPresentation.point);
  assert.deepEqual(result.propagation.cells, [{ x: 1, y: 1, z: 0 }]);
  assert.deepEqual(result.targetIds, ['inside']);
  assert.equal(persistence.length, 1);
  assert.deepEqual(persistence[0].propagation.cells, result.propagation.cells);
  assert.deepEqual(persistence[0].propagation.shape.origin, finalPresentation.shape.origin);
  assert.equal(result.persistentRegion.regionUuid, 'Scene.test.Region.final');
  assert.ok(h.clean());
});

test('cancellation invalidates delayed propagation without late target publication', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const h = harness({ placementDependencies: {
    propagationModes: { resolve: () => ({ mode: 'direct', source: 'test' }) },
    propagationEnvironment: { create: () => ({ test: true }) },
    propagation: { async resolve({ shape, grid, mode }) {
      await gate;
      return { mode, shape, grid, origin: shape.origin, support: 'continuous-primitive', cells: [{ x: 1, y: 1, z: 0 }] };
    } }
  } });
  const promise = h.service.show({ source: h.source, shape: { type: 'sphere', radius: 10 }, propagation: { override: 'direct' } });
  await h.flush();
  h.dispatch('pointercancel');
  const result = await promise;
  assert.equal(result.cancelled, true);
  assert.deepEqual([...game.user.targets].map(token => token.id), ['outside']);
  const historyLength = h.history.length;
  release();
  await h.flush();
  assert.equal(h.history.length, historyLength, 'late propagation completion must not publish targets after cancellation');
  assert.ok(h.clean());
});

test('propagation rejection closes the session and restores state after immediate presentation', async () => {
  const updates = [];
  const renderer = { show() {}, update(revision) { updates.push(revision); }, frame() {}, clear() {} };
  const h = harness({ renderer, placementDependencies: {
    propagationModes: { resolve: () => ({ mode: 'direct', source: 'test' }) },
    propagationEnvironment: { create: () => ({ test: true }) },
    propagation: { async resolve() { throw new Error('propagation failed'); } }
  } });
  await assert.rejects(
    h.service.show({ source: h.source, shape: { type: 'sphere', radius: 10 }, propagation: { override: 'direct' } }),
    /propagation failed/
  );
  assert.equal(updates.length, 1, 'the inexpensive presentation should occur before propagation rejects');
  assert.deepEqual([...game.user.targets].map(token => token.id), ['outside']);
  assert.equal(h.service.getStats().errors, 1);
  assert.ok(h.clean());
});

test('cooperative propagation yields to pointer input, aborts stale work, and resolves only the newest presentation', async () => {
  const updates = [];
  const resolved = [];
  let propagationCalls = 0;
  const renderer = {
    show() {},
    update(revision, mode) { updates.push({ revision, mode }); },
    frame() {},
    clear() {}
  };
  const h = harness({ renderer, placementDependencies: {
    propagationModes: { resolve: () => ({ mode: 'direct', source: 'test' }) },
    propagationEnvironment: { create: args => ({ cooperate: args.cooperate, signal: args.signal }) },
    propagation: { async resolve({ shape, grid, mode, environment, signal }) {
      propagationCalls += 1;
      if (propagationCalls === 1) {
        await environment.cooperate();
        if (signal.aborted) {
          const error = new Error('Propagation cancelled.');
          error.name = 'AbortError';
          throw error;
        }
      }
      return Object.freeze({ mode, shape, grid, origin: shape.origin, support: 'continuous-primitive',
        cells: Object.freeze(propagationCalls === 1 ? [{ x: 99, y: 99, z: 0 }] : []) });
    } }
  } });

  const promise = h.service.show({ source: h.source, shape: { type: 'sphere', radius: 10 },
    propagation: { override: 'direct' }, onRevision: revision => resolved.push(revision) });

  setTimeout(() => h.dispatch('pointermove', { clientX: 500, clientY: 250 }), 0);
  await new Promise(resolve => setTimeout(resolve, 60));
  await h.flush();

  assert.ok(updates.some(entry => entry.revision.serial === 2), 'pointer input should present while propagation is cooperatively yielded');
  assert.equal(propagationCalls, 2, 'stale propagation should terminate and the newest quiet request should resolve');
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].serial, 2);
  assert.ok(h.service.getStats().staleDiscards >= 1);

  h.service.cancel();
  await promise;
  assert.ok(h.clean());
});


test('rapid Direct pointer movement coalesces before physical propagation starts', async () => {
  let propagationCalls = 0;
  const resolved = [];
  const h = harness({ placementDependencies: {
    propagationModes: { resolve: () => ({ mode: 'direct', source: 'test' }) },
    propagationEnvironment: { create: () => ({ test: true }) },
    propagation: { async resolve({ shape, grid, mode }) {
      propagationCalls += 1;
      return Object.freeze({ mode, shape, grid, origin: shape.origin, support: 'continuous-primitive', cells: Object.freeze([]) });
    } }
  } });

  const promise = h.service.show({ source: h.source, shape: { type: 'sphere', radius: 10 },
    propagation: { override: 'direct' }, onRevision: revision => resolved.push(revision) });
  await h.flush();
  assert.equal(propagationCalls, 1, 'initial placement should still resolve immediately');

  for (let i = 0; i < 20; i += 1) {
    h.dispatch('pointermove', { clientX: 400 + i, clientY: 250 });
    await new Promise(resolve => setTimeout(resolve, 2));
  }

  assert.equal(propagationCalls, 1, 'rapid movement should not start obsolete physical calculations');
  assert.ok(h.service.getStats().coalescedRequests >= 1);
  const deadline = Date.now() + 250;
  while (propagationCalls < 2 && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 5));
    await h.flush();
  }
  assert.equal(propagationCalls, 2, 'the newest stable presentation should resolve once after the quiet window');
  assert.equal(resolved.at(-1).serial, h.service.getStats().activeResolvedSerial);

  h.service.cancel();
  await promise;
  assert.ok(h.clean());
});

test('raw Cone Spread placement is rejected before renderer setup or session activation', async () => {
  let rendererShows = 0;
  const renderer = {
    show() { rendererShows += 1; },
    update() {},
    frame() {},
    clear() {}
  };
  const h = harness({
    renderer,
    placementDependencies: { propagationModes: new Crosshair3dPropagationModeService() }
  });
  await assert.rejects(
    h.service.show({
      source: h.source,
      shape: { type: 'cone', length: 15 },
      propagation: { itemDefault: 'spread' }
    }),
    /Cone does not support Spread propagation/
  );
  assert.equal(rendererShows, 0);
  assert.equal(h.service.getStats().active, false);
  assert.ok(h.clean());
});
