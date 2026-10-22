import test from 'node:test';
import assert from 'node:assert/strict';
import { CastingLocalTargetScalingService, validateTargetScalingContext } from '../scripts/casting/casting-local-target-scaling-service.js';

function fixture() {
  const callbacks = new Map();
  globalThis.Hooks = { on: (name, fn) => { callbacks.set(name, fn); return callbacks.size; } };
  globalThis.game = { user: { id: 'user1' } };
  const sourceAffects = { count: 1 };
  const original = { id: 'activity1', target: { affects: sourceAffects } };
  const item = { id: 'spell1', system: { activities: new Map([['activity1', original]]) } };
  const actor = { id: 'actor1', isOwner: true, items: new Map([['spell1', item]]) };
  item.actor = actor;
  const workflow = { actor, activity: { id: 'activity1', item } };
  const clonedItem = { id: item.id, actor };
  const casting = { id: 'activity1', item: clonedItem, target: { affects: { count: 2 } } };
  return { callbacks, sourceAffects, original, item, actor, workflow, casting };
}

test('scales a cloned casting Activity exactly once after native upcasting', () => {
  const f = fixture();
  const service = new CastingLocalTargetScalingService();
  service.initialize();
  service.arm({ workflow: f.workflow, bonusTargets: 1 });
  const usage = { spell: { slot: 'spell2' }, scaling: 1 };
  f.callbacks.get('dnd5e.preActivityConsumption')(f.casting, usage);
  assert.equal(f.casting.target.affects.count, 3);
  assert.equal(f.sourceAffects.count, 1);
  f.callbacks.get('dnd5e.preActivityConsumption')(f.casting, usage);
  assert.equal(f.casting.target.affects.count, 3);
  assert.equal(service.getStatus().pending, 0);
  assert.equal(service.getStatus().stats.applied, 1);
});

test('supports first-level native target count without changing slot level', () => {
  const f = fixture();
  f.casting.target.affects.count = 1;
  const service = new CastingLocalTargetScalingService();
  service.initialize();
  service.arm({ workflow: f.workflow });
  const usage = { spell: { slot: 'spell1' }, scaling: 0 };
  f.callbacks.get('dnd5e.preActivityConsumption')(f.casting, usage);
  assert.equal(f.casting.target.affects.count, 2);
  assert.equal(usage.spell.slot, 'spell1');
  assert.equal(usage.scaling, 0);
});

test('rejects modification to original embedded Activity and cannot overwrite source Item', () => {
  const f = fixture();
  const request = { item: f.item, activityId: f.original.id, actorId: f.actor.id, bonusTargets: 1 };
  const check = validateTargetScalingContext(request, { ...f.original, item: f.item }, { spell: { slot: 'spell2' } });
  assert.equal(check.valid, false);
  assert.equal(check.reason, 'activity-not-isolated');
  assert.equal(f.sourceAffects.count, 1);
});

test('an unrelated Item consumption does not claim a pending request', () => {
  const f = fixture();
  const service = new CastingLocalTargetScalingService();
  service.initialize();
  service.arm({ workflow: f.workflow });
  f.callbacks.get('dnd5e.preActivityConsumption')({
    ...f.casting, item: { id: 'anotherSpell', actor: f.actor }
  }, { spell: { slot: 'spell2' }, scaling: 1 });
  assert.equal(service.getStatus().pending, 1);
  assert.equal(f.casting.target.affects.count, 2);
});

test('an invalid count is rejected and consumed without mutation', () => {
  const f = fixture();
  f.casting.target.affects.count = 'variable';
  const request = { item: f.item, activityId: f.casting.id, actorId: f.actor.id, bonusTargets: 1 };
  const result = validateTargetScalingContext(request, f.casting, { spell: { slot: 'spell2' } });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'invalid-native-count');
});

test('a new workflow cancels stale scaling for the same Item', () => {
  const f = fixture();
  const service = new CastingLocalTargetScalingService();
  service.initialize();
  service.arm({ workflow: f.workflow });
  f.callbacks.get('midi-qol.preTargetingV2')({ actor: f.actor, activity: { id: 'activity1', item: f.item } });
  assert.equal(service.getStatus().pending, 0);
  assert.equal(service.getStatus().stats.canceled, 1);
});

test('manual cancellation releases an unused request', () => {
  const f = fixture();
  const service = new CastingLocalTargetScalingService();
  const id = service.arm({ workflow: f.workflow });
  assert.equal(service.cancel(id), true);
  assert.equal(service.cancel(id), false);
  assert.equal(service.getStatus().pending, 0);
});


test('fail-closed validation returns false from the D&D5e pre-consumption hook', () => {
  const f = fixture();
  f.casting.target.affects.count = 'bad';
  globalThis.ui = { notifications: { error: () => {} } };
  const service = new CastingLocalTargetScalingService();
  service.initialize();
  service.arm({ workflow: f.workflow });
  const result = f.callbacks.get('dnd5e.preActivityConsumption')(f.casting, { spell: { slot: 'spell2' } });
  assert.equal(result, false);
  assert.equal(service.getStatus().stats.rejected, 1);
  assert.equal(f.sourceAffects.count, 1);
});
