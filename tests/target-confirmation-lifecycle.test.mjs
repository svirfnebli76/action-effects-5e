import test from 'node:test';
import assert from 'node:assert/strict';
import { TargetConfirmationAdapter, enforceTargetWindowWidth } from '../scripts/ui/target-confirmation-adapter.js';

function fakeStyle() {
  const styles = new Map();
  return {
    setProperty: (k, v, priority = '') => styles.set(k, {v:String(v),priority}),
    getPropertyValue: k => styles.get(k)?.v ?? '',
    getPropertyPriority: k => styles.get(k)?.priority ?? '',
    removeProperty: k => styles.delete(k),
    [Symbol.iterator]: function* () { yield* styles.keys(); }
  };
}
function fakeElement(tag = 'div') {
  const children = [];
  const cls = new Set();
  const e = {
    tagName: tag.toUpperCase(), className: '', style: fakeStyle(), isConnected: true,
    childNodes: children, children, parentElement: null, dataset: {},
    classList: {
      add: (...v) => v.forEach(n => cls.add(n)), remove: (...v) => v.forEach(n => cls.delete(n)),
      contains: n => cls.has(n), [Symbol.iterator]: function* () { yield* cls; },
      toggle: (n,flag) => { if(flag)cls.add(n);else cls.delete(n); }
    },
    appendChild(el) { children.push(el);el.parentElement=this;return el; },
    append(...nodes) { for(const node of nodes){const i=children.indexOf(node);if(i>=0)children.splice(i,1); this.appendChild(node);} },
    insertBefore(el,before) { const i=children.indexOf(before);if(i<0)return this.appendChild(el);children.splice(i,0,el);el.parentElement=this;return el; },
    remove() { this.isConnected=false; const p=this.parentElement; if(p){const i=p.children.indexOf(this);if(i>=0)p.children.splice(i,1);} },
    insertAdjacentElement(_where,child) {this.afterInserted=child;child.isConnected=true; },
    addEventListener(){}, removeEventListener(){}, setAttribute(){}, removeAttribute(){},
    querySelector(){return null;},querySelectorAll(){return [];},
    getBoundingClientRect(){return {width:Number.parseFloat(this.style.getPropertyValue('width'))||300};},
    closest(){return null;}
  };
  Object.defineProperty(e,'firstChild',{get(){return children[0]??null;}});
  return e;
}
function harness({ indicator = null, deferred = null } = {}) {
  const hooks = new Map();
  globalThis.Hooks={on(name,cb){hooks.set(name,cb);return hooks.size;}};
  globalThis.game={user:{id:'u1',isGM:true,targets:new Set()}};
  globalThis.CONST={TOKEN_DISPOSITIONS:{HOSTILE:-1,NEUTRAL:0,FRIENDLY:1,SECRET:-2}};
  globalThis.document={createElement:fakeElement,createTextNode(s){return {nodeType:3,textContent:s}}};
  const actor={id:'a',isOwner:true};
  const token={actor,document:{uuid:'Scene.test.Token.test'}};
  globalThis.canvas={tokens:{controlled:[token]}};
  const item={id:'charm'};
  const workflow={actor,activity:{item}};
  const root=fakeElement('section');
  const form=fakeElement('form');
  const list=fakeElement('section');
  form.appendChild(list);
  const title=fakeElement('h2');title.textContent='Target Confirmation';
  const footer=fakeElement('footer');
  function btn(action,label){const b=fakeElement('button');b.dataset.action=action;b.appendChild({nodeType:3,textContent:label,parentElement:b});footer.appendChild(b);return b;}
  const roll=btn('roll','Roll'), cancel=btn('cancel','Cancel'), clear=btn('clearTargets','Clear');
  root.appendChild(title);root.appendChild(form);root.appendChild(footer);
  root.querySelector=(q)=>q==='form'?form:q==='.window-title'?title:q==='.ae5e-target-counter'?list.afterInserted?.children?.[0]??null:q.includes('[data-action="roll"]')?roll:q.includes('[data-action="cancel"]')?cancel:q.includes('[data-action="clearTargets"]')?clear:null;
  root.querySelectorAll=q=>q.includes('.midi-qol-box')?[]:[];
  form.querySelector=q=>q==='.midi-qol-target-confirmation-list'?list:null;
  form.closest=q=>q==='.application'?root:null;
  const app={data:{actor,activity:{item},maxTargets:3},element:root,position:{width:300},setPosition({width}){this.position.width=width;this.positionCalls.push(width);},positionCalls:[],constructor:{name:'TargetConfirmationDialog'}};
  const service=new TargetConfirmationAdapter({selectionIndicator:indicator});
  service.initialize();
  const id=service.arm({workflow,actor,item,appearance:{windowWidth:500},indicator:true});
  return {service,id,hooks,app,root,token,roll,cancel,clear};
}
const flush=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();await Promise.resolve();};

test('width helper overrides Midi native width and clamps to the viewport',()=>{
  const root=fakeElement(),positionCalls=[];
  const app={position:{width:300},setPosition({width}){this.position.width=width;positionCalls.push(width)}};
  assert.equal(enforceTargetWindowWidth(app,root,500,1000),500);
  assert.equal(root.style.getPropertyValue('width'),'500px');
  assert.equal(root.style.getPropertyPriority('width'),'important');
  assert.equal(app.position.width,500);
  assert.equal(enforceTargetWindowWidth(app,root,500,1000),500);
  assert.deepEqual(positionCalls,[500]);
  app.position.width=300;root.style.setProperty('width','300px');
  assert.equal(enforceTargetWindowWidth(app,root,500,1000),500);
  assert.deepEqual(positionCalls,[500,500]);
  assert.equal(enforceTargetWindowWidth(app,root,500,420),396);
  assert.equal(root.style.getPropertyValue('width'),'396px');
});

test('dialog rerenders retain 500px and acquire only one green, silent originator lease',async()=>{
  const calls={acquire:[],release:[]};
  const indicator={async acquire(options){calls.acquire.push(options);return {id:'lease1'};}, async release(lease){calls.release.push(lease);}};
  const {hooks,app,root,service}=harness({indicator});
  hooks.get('renderApplicationV2')(app);
  await flush();
  assert.equal(root.style.getPropertyValue('width'),'500px');
  assert.equal(app.position.width,500);
  assert.equal(calls.acquire.length,1);
  assert.equal(calls.acquire[0].role,'originator');
  assert.equal(calls.acquire[0].playSound,false);
  assert.equal(calls.acquire[0].token.document.uuid,'Scene.test.Token.test');
  app.position.width=300;root.style.setProperty('width','300px');
  hooks.get('renderApplicationV2')(app);
  await flush();
  assert.equal(root.style.getPropertyValue('width'),'500px');
  assert.equal(app.position.width,500);
  assert.equal(calls.acquire.length,1);
  hooks.get('closeApplicationV2')(app);
  await flush();
  assert.equal(calls.release.length,1);
  assert.equal(calls.release[0].id,'lease1');
  assert.equal(service.getStatus().active,0);
});

test('window closing before Sequencer acquire finishes releases the late lease',async()=>{
  let releaseAcquire;
  const pending=new Promise(resolve=>{releaseAcquire=resolve;});
  const calls={release:[]};
  const indicator={acquire:()=>pending,async release(lease){calls.release.push(lease);}};
  const {hooks,app}=harness({indicator});
  hooks.get('renderApplicationV2')(app);
  await flush();
  hooks.get('closeApplicationV2')(app);
  releaseAcquire({id:'late-lease'});
  await flush();
  assert.deepEqual(calls.release.map(x=>x.id),['late-lease']);
});
