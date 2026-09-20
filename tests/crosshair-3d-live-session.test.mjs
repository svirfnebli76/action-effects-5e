import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers/pixi-session-harness.mjs';

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
