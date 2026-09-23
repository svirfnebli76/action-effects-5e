import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers/pixi-session-harness.mjs';
import { illuminationPhase, TARGET_PREVIEW_NOTICE_TEXT, TARGET_PREVIEW_NOTICE_COLOR } from '../scripts/crosshairs3d/renderers/shared.js';

for (const type of ['prism','cylinder','sphere','cone','line','free-line']) test(`${type}: retained PIXI objects, finite geometry at all pitch/yaw samples, immutable rules shape`, () => {
  const h = harness();
  const shape = h.geometry.normalizeShape({ type, length: 20, width: 5, height: 20, radius: 10 });
  const metrics = h.metrics.resolve();
  h.renderer.show({ shape, sourceVolume: h.tokens.resolve(h.source,{grid:metrics,coordinateSpace:'pixels'}),
    metrics,metricsService:h.metrics,geometry:h.geometry,options:{range:{max:60}},capabilities:{rotation:true,elevation:true,resize:type==='free-line'} });
  const count = h.records.graphics.length, textCount = h.records.texts.length;
  for(const yaw of [0,45,90,180,270,359]) for(const pitch of [-90,-70,-50,0,50,60,70,90]) {
    const next=h.geometry.normalizeShape({...shape,yaw,pitch,origin:{x:20,y:20,z:pitch<0?-5:5}});
    const before=JSON.stringify(next),d=h.geometry.direction(next);
    const terminal={x:next.origin.x+d.x*20,y:next.origin.y+d.y*20,z:next.origin.z+d.z*20};
    h.renderer.update({shape:next,point:next.origin,yaw,pitch,arcPitch:pitch,terminal,endpoint:terminal,length:20},'ELEVATE');
    for(const t of [0,550,1400,2200,2700,3000,3450]) h.renderer.frame(t);
    assert.equal(JSON.stringify(next),before);
    assert.equal(h.records.graphics.length,count);assert.equal(h.records.texts.length,textCount);
  }
  h.renderer.clear(); assert.equal(canvas.interface.children.length,0);
});

for(const type of ['prism','cylinder']) test(`${type}: animated layer never fills faces or redraws dashed hidden geometry`,()=>{
  const h=harness(),shape=h.geometry.normalizeShape({type,length:20,width:20,height:20,radius:10});
  const metrics=h.metrics.resolve();
  h.renderer.show({shape,sourceVolume:h.tokens.resolve(h.source,{grid:metrics,coordinateSpace:'pixels'}),metrics,metricsService:h.metrics,
    geometry:h.geometry,options:{range:{max:60}},capabilities:{elevation:true,rotation:type==='prism'}});
  h.renderer.update({shape,point:shape.origin,yaw:0},'MOVE');
  // The root contains the base drawing, light lines, marker, then text.
  const [drawing,light]=canvas.interface.children[0].children[0].children;
  const staticCommands=JSON.stringify(drawing.commands);
  assert.ok(drawing.commands.filter(c=>c[0]==='moveTo').length>10,'hidden dash segments remain in static geometry');
  for(const t of [200,1400,2199,2200,2700,3000]) {
    h.renderer.frame(t);
    assert.ok(!light.commands.some(c=>c[0]==='beginFill'),'illumination has no face fill');
    assert.equal(JSON.stringify(drawing.commands),staticCommands,'animation cannot brighten static dashed lines');
  }
  h.renderer.frame(3499);assert.equal(light.commands.length,0);
  h.renderer.clear();
});

test('source line glow advances from source to terminal, holds, then fades without fill',()=>{
  const h=harness(),shape=h.geometry.normalizeShape({type:'line',length:60,width:5,yaw:0,pitch:0});
  const metrics=h.metrics.resolve();
  h.renderer.show({shape,sourceVolume:h.tokens.resolve(h.source,{grid:metrics,coordinateSpace:'pixels'}),metrics,metricsService:h.metrics,
    geometry:h.geometry,options:{range:{max:60}},capabilities:{elevation:true,rotation:true}});
  h.renderer.update({shape,point:shape.origin,yaw:0,arcPitch:0,endpoint:{x:60,y:0,z:0}},'MOVE');
  const glow=canvas.interface.children[0].children[0].children[1];
  h.renderer.frame(1100);
  const tips=glow.commands.filter(c=>c[0]==='lineTo');assert.ok(tips.length>0);
  assert.ok(tips.every(c=>Math.abs(c[1]-600)<1e-6));
  assert.ok(!glow.commands.some(c=>c[0]==='beginFill'));
  h.renderer.frame(2200);assert.ok(glow.commands.filter(c=>c[0]==='drawPolygon').length===2);
  h.renderer.frame(3000);assert.ok(glow.commands.filter(c=>c[0]==='lineStyle').every(c=>c[3]<0.6));
  h.renderer.frame(3400);assert.equal(glow.commands.length,0);h.renderer.clear();
});

test('sphere tracer begins at the nearest caster corner and ends at the snapped sphere center',()=>{
  const h=harness(),shape=h.geometry.normalizeShape({type:'sphere',origin:{x:2.5,y:2.5,z:0},radius:10});
  const metrics=h.metrics.resolve();
  h.renderer.show({shape,sourceVolume:h.tokens.resolve(h.source,{grid:metrics,coordinateSpace:'pixels'}),metrics,metricsService:h.metrics,
    geometry:h.geometry,options:{range:{max:60}},capabilities:{elevation:true}});
  h.renderer.update({shape:{...shape,origin:{x:20,y:20,z:0}},point:{x:20,y:20,z:0}},'MOVE');
  const hasCornerTracer=h.records.graphics.some(graphics=>graphics.commands.some((command,index,commands)=>
    command[0]==='moveTo' && command[1]===100 && command[2]===100
      && commands[index+1]?.[0]==='lineTo' && commands[index+1][1]===400 && commands[index+1][2]===400));
  assert.equal(hasCornerTracer,true);
  h.renderer.clear();
});

test('illumination timing uses cumulative spread, hold and unified fade',()=>{
  assert.deepEqual(illuminationPhase(1100),{progress:.5,alpha:1});
  assert.deepEqual(illuminationPhase(2600),{progress:1,alpha:1});
  assert.deepEqual(illuminationPhase(3100),{progress:1,alpha:.5});
  assert.deepEqual(illuminationPhase(3400),{progress:1,alpha:0});
  assert.deepEqual(illuminationPhase(3500),{progress:0,alpha:1});
});


for (const type of ['prism','cylinder','sphere','cone','line','free-line']) {
  for (const propagationMode of ['none','direct','spread']) {
    test(`${type}: target-preview notice follows ${propagationMode} propagation`, () => {
      const h = harness();
      const shape = h.geometry.normalizeShape({ type, length: 20, width: 5, height: 20, radius: 10 });
      const metrics = h.metrics.resolve();
      h.renderer.show({
        shape,
        sourceVolume: h.tokens.resolve(h.source, { grid: metrics, coordinateSpace: 'pixels' }),
        metrics,
        metricsService: h.metrics,
        geometry: h.geometry,
        options: { range: { max: 60 } },
        capabilities: { rotation: true, elevation: true, resize: type === 'free-line' },
        propagationMode
      });
      const direction = ['cone','line'].includes(type) ? h.geometry.direction(shape) : null;
      const endpoint = direction ? {
        x: shape.origin.x + direction.x * shape.length,
        y: shape.origin.y + direction.y * shape.length,
        z: shape.origin.z + direction.z * shape.length
      } : null;
      h.renderer.update({
        shape,
        point: shape.origin,
        yaw: shape.yaw ?? 0,
        pitch: shape.pitch ?? 0,
        arcPitch: shape.pitch ?? 0,
        length: shape.length,
        terminal: endpoint,
        endpoint
      }, 'MOVE');
      const notices = h.records.texts.filter(label => label.text === TARGET_PREVIEW_NOTICE_TEXT);
      assert.equal(notices.length, propagationMode === 'none' ? 0 : 1);
      if (notices.length) {
        assert.equal(notices[0].style.fontSize, 16);
        assert.equal(String(notices[0].style.fill).toLowerCase(), TARGET_PREVIEW_NOTICE_COLOR);
      }
      h.renderer.clear();
    });
  }
}

test('renderer partial initialization error cleans its complete root',()=>{
  const h=harness();assert.throws(()=>h.renderer.show({shape:{type:'unknown'}}));
  assert.equal(canvas.interface.children.length,0);
});

test('cone renderer has no source tracer presentation', async () => {
  const fs = await import('node:fs/promises');
  const source = await fs.readFile(new URL('../scripts/crosshairs3d/renderers/cone-renderer.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /drawSourceTracer|TRACER_COLOR|TRACER_CHEVRON/);
});
