import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatCardAdapter, itemPresentation } from '../scripts/chat/chat-card-adapter.js';
const M = 'action-effects-5e';
class ForcedDeletion {}
globalThis.foundry = { data: { operators: { ForcedDeletion } } };
test('activity overrides Item presentation; disabled activity does not inherit enabled Item', () => {
  const parent = {schema:1,enabled:true,layout:'<div data-ae5e-slot="header"></div>'};
  const activity = { item:{flags:{[M]:{chatCard:parent}}}, flags:{} };
  assert.equal(itemPresentation(activity).layout,parent.layout);
  activity.flags[M]={chatCard:{schema:1,enabled:false}};
  assert.equal(itemPresentation(activity),null);
  activity.flags[M].chatCard={...parent,layout:'<section data-ae5e-slot="header"></section>',saveStyle:'target',hideCompletedControls:true};
  assert.equal(itemPresentation(activity).saveStyle,'target');
  assert.equal(itemPresentation(activity).hideCompletedControls,true);
  activity.flags[M].chatCard.schema=99;
  assert.equal(itemPresentation(activity),null);
});
test('message resolution uses explicit ChatMessage or the owning workflow, never arbitrary parent lookup', () => {
  const adapter=new ChatCardAdapter();const message={documentName:'ChatMessage',id:'M'};
  globalThis.game={messages:new Map([['M',message]])};
  assert.equal(adapter.message(message),message);
  assert.equal(adapter.message({chatCard:message}),message);
  assert.equal(adapter.message({itemCardId:'M'}),message);
  assert.equal(adapter.message({workflowOptions:{triggeringWorkflowId:'M'}}),undefined);
});
test('contribution paths reject dotted and prototype keys before attempting document writes', async () => {
  const adapter=new ChatCardAdapter();
  for(const id of ['bad.path','__proto__','constructor','prototype','', 'x'.repeat(161)]) {
    await assert.rejects(adapter.upsertContribution({}, {id,html:'<p>text</p>'}));
    await assert.rejects(adapter.removeContribution({},id));
  }
});
test('removal requires ownership and touches only the selected contribution', async () => {
  const adapter=new ChatCardAdapter();const updates=[];
  const message={documentName:'ChatMessage',id:'M',isOwner:false,async update(patch){updates.push(patch);}};
  assert.equal((await adapter.removeContribution(message,'distant')).updated,false);
  message.isOwner=true;
  await adapter.removeContribution(message,'distant');
  assert.deepEqual(updates,[{[`flags.${M}.chatCard.contributions.distant`]:new ForcedDeletion()}]);
});
test('v14 contribution deletion preserves sibling contributions and layout flags', async () => {
  const contributions = { distant: { html: '<p>Distant</p>' }, empowered: { html: '<p>Empowered</p>' } };
  const flags = { schema: 1, enabled: true, layout: '<div data-ae5e-slot="header"></div>', contributions };
  const before = structuredClone(flags);
  const message = { documentName: 'ChatMessage', id: 'M', isOwner: true, async update(patch) {
    for (const [path, operator] of Object.entries(patch)) {
      assert.ok(operator instanceof ForcedDeletion);
      assert.ok(!path.includes('-='));
      const id = path.slice(`flags.${M}.chatCard.contributions.`.length);
      delete contributions[id];
    }
  } };
  const adapter = new ChatCardAdapter();
  await adapter.removeContribution(message, 'distant');
  assert.deepEqual(flags, { ...before, contributions: { empowered: before.contributions.empowered } });
  await adapter.removeContribution(message, 'distant');
  assert.deepEqual(flags, { ...before, contributions: { empowered: before.contributions.empowered } });
});
test('same-client writes serialize and recover after a failed document update', async () => {
  const adapter=new ChatCardAdapter();const order=[];let n=0;
  const message={documentName:'ChatMessage',id:'M',isOwner:true,async update(patch){const current=++n;order.push(current);await new Promise(r=>setTimeout(r,5));if(current===1)throw Error('write failed');order.push(-current);}};
  const results=await Promise.allSettled([adapter.removeContribution(message,'first'),adapter.removeContribution(message,'second')]);
  assert.equal(results[0].status,'rejected');assert.equal(results[1].status,'fulfilled');assert.deepEqual(order,[1,2,-2]);
});
test('adapter registers once; unconfigured usage creation leaves existing flags alone', () => {
  const hooks=new Map();let count=0;
  globalThis.Hooks={on:(name,fn)=>{count++;hooks.set(name,fn);}};
  const adapter=new ChatCardAdapter();adapter.initialize();adapter.initialize();
  assert.equal(count,2);
  const config={data:{flags:{other:{value:1}}}};
  hooks.get('dnd5e.preCreateUsageMessage')({flags:{}},config);
  assert.deepEqual(config,{data:{flags:{other:{value:1}}}});
});
