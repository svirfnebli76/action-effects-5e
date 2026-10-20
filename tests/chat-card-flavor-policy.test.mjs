import test from "node:test";
import assert from "node:assert/strict";
import { cardSectionPolicy, applyCardSections, CARD_SECTION_CLASSES, ChatCardAdapter } from "../scripts/chat/chat-card-adapter.js";
test("legacy three-field policy remains unchanged",()=>{
  assert.deepEqual(cardSectionPolicy({schema:1,targeting:true,saves:false,damageApplication:true}),
    {schema:1,targeting:true,saves:false,damageApplication:true});
});
test("flavor hides independently and a legacy policy restores flavor",()=>{
  const classes=new Set();
  const host={classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name);}}};
  applyCardSections(host,cardSectionPolicy({schema:1,flavor:true,targeting:false,saves:false,damageApplication:false}));
  assert.deepEqual([...classes],[CARD_SECTION_CLASSES.flavor]);
  applyCardSections(host,cardSectionPolicy({schema:1,targeting:false,saves:false,damageApplication:false}));
  assert.equal(classes.size,0);
});
test("malformed flavor is rejected without advancing schema",()=>{
  assert.equal(cardSectionPolicy({schema:1,flavor:"true",targeting:false,saves:false,damageApplication:false}),null);
  assert.equal(cardSectionPolicy({schema:2,flavor:true,targeting:false,saves:false,damageApplication:false}),null);
});
test("setSections writes a change when optional flavor is turned off",async()=>{
  const changes=[];
  const m={documentName:"ChatMessage",id:"test",isOwner:true,
    flags:{"action-effects-5e":{initialCardSections:{schema:1,flavor:true,targeting:false,saves:false,damageApplication:false}}},
    async update(patch){changes.push(patch);} };
  const result=await new ChatCardAdapter().setSections(m,{schema:1,targeting:false,saves:false,damageApplication:false});
  assert.equal(result.updated,true);
  assert.equal(changes.length,1);
});