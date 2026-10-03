import test from 'node:test';
import assert from 'node:assert/strict';
import { MovementProtectionService, OA_IMMUNITY_KEY } from '../scripts/movement/movement-protection-service.js';
import { createInstructionPanel } from '../scripts/crosshairs3d/renderers/chevron-instructions.js';
import { harness } from './helpers/pixi-session-harness.mjs';
import { validateChevronOptions } from '../scripts/crosshairs3d/chevron-path-service.js';

function setup({ existing = false, stored = false, creationFailure = false, deletionFailure = false } = {}) {
  let id = 0, wrapper, registrations = 0, deletions = 0;
  globalThis.foundry = { utils: { randomID: () => `id${++id}` } };
  globalThis.libWrapper = { register(packageId, target, fn, type) {
    assert.equal(packageId, 'action-effects-5e'); assert.equal(type, 'MIXED');
    assert.equal(target, 'CONFIG.ActiveEffect.documentClass.prototype._displayScrollingStatus');
    registrations++; wrapper = fn; return 1;
  }};
  const effects = new Map();
  const actor = { uuid: 'Actor.a', effects, flags: {}, _source: { flags: stored ? { 'gambits-premades': { oaImmunity: true } } : {} } };
  function prepare() {
    actor.flags = structuredClone(actor._source.flags);
    for (const effect of effects.values()) if (!effect.disabled && !effect.isSuppressed) {
      actor.flags['gambits-premades'] = { oaImmunity: '1' };
    }
  }
  if (existing) effects.set('other', { id: 'other', name: 'Existing', flags: {}, system: { changes: [{ key: OA_IMMUNITY_KEY, type: 'override', value: '1' }] } });
  prepare();
  actor.createEmbeddedDocuments = async (type, data, options) => {
    assert.equal(type, 'ActiveEffect'); assert.equal(options.keepId, true);
    const source = data[0];
    const effect = { ...source, id: source._id, toObject: () => structuredClone(source) };
    effects.set(effect.id, effect); prepare();
    if (creationFailure) throw new Error('creation failed after insertion');
    return [effect];
  };
  actor.deleteEmbeddedDocuments = async (type, ids) => {
    if (deletionFailure) throw new Error('deletion failed');
    for (const id of ids) { assert.notEqual(id, 'other'); effects.delete(id); deletions++; }
    prepare();
  };
  const service = new MovementProtectionService(); service.initialize(); service.initialize();
  return { service, actor, effects, token: { uuid: 'Scene.s.Token.t', actor }, wrapper: (...args) => wrapper(...args),
    invoke: (effect, wrapped, ...args) => wrapper.call(effect, wrapped, ...args), stats: () => ({ registrations, deletions }) };
}

test('module initializes its narrow scrolling wrapper once and delegates all unrelated labels', async () => {
  const h = setup(), lease = await h.service.begin(h.token);
  let calls = 0;
  const wrapped = (...args) => { calls++; return args; };
  for (const enabled of [true, false]) assert.equal(h.invoke(h.effects.get(lease.effectId), wrapped, enabled), undefined);
  assert.deepEqual(h.invoke({ id: 'unrelated', flags: {} }, wrapped, false), [false]);
  assert.deepEqual(h.invoke({ ...h.effects.get(lease.effectId), id: 'other' }, wrapped, true), [true]);
  assert.equal(calls, 2); assert.equal(h.stats().registrations, 1);
  await lease.dispose();
});

test('callback has active immunity and cleanup preserves stored and pre-existing immunity', async () => {
  for (const options of [{}, { existing: true }, { stored: true }]) {
    const h = setup(options), before = structuredClone(h.actor._source);
    const result = await h.service.withImmunity(h.token, {}, async lease => {
      lease.assertActive(); assert.ok(h.actor.flags['gambits-premades'].oaImmunity); return 42;
    });
    assert.equal(result, 42); assert.equal(h.effects.size, options.existing ? 1 : 0);
    assert.equal(!!h.actor.flags['gambits-premades']?.oaImmunity, !!(options.existing || options.stored));
    assert.deepEqual(h.actor._source, before);
  }
});

test('overlapping leases remove only their own effects and dispose is idempotent', async () => {
  const h = setup();
  const first = await h.service.begin(h.token), second = await h.service.begin(h.token);
  await first.dispose(); second.assertActive(); await first.dispose();
  assert.equal(h.effects.size, 1); await second.dispose(); assert.equal(h.effects.size, 0);
  assert.equal(h.stats().deletions, 2);
});

test('callback and partial creation failures clean up owned immunity', async () => {
  const h = setup();
  await assert.rejects(h.service.withImmunity(h.token, {}, async () => { throw new Error('motion failed'); }), /motion failed/);
  assert.equal(h.effects.size, 0);
  const partial = setup({ creationFailure: true });
  await assert.rejects(partial.service.begin(partial.token), /creation failed/);
  assert.equal(partial.effects.size, 0);
});

test('ownership changes prevent deleting another effect and suppression invalidates a live lease', async () => {
  const h = setup(), lease = await h.service.begin(h.token), effect = h.effects.get(lease.effectId);
  effect.disabled = true; assert.throws(() => lease.assertActive(), /immunity ended/); effect.disabled = false;
  effect.flags['action-effects-5e'].movementProtection.transactionId = 'other';
  await assert.rejects(lease.dispose(), /ownership mismatch/); assert.equal(h.effects.size, 1);
});

test('cleanup failures remain visible alongside callback failures', async () => {
  const h = setup({ deletionFailure: true });
  await assert.rejects(h.service.withImmunity(h.token, {}, async () => { throw new Error('motion failed'); }), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors.map(e => e.message), ['motion failed', 'deletion failed']); return true;
  });
});

test('unavailable module wrapper fails before creating any immunity', async () => {
  const h = setup(); globalThis.libWrapper = undefined;
  const service = new MovementProtectionService(); service.initialize();
  assert.equal(service.getStatus().scrollingWrapperRegistered, false);
  await assert.rejects(service.begin(h.token), /unavailable/); assert.equal(h.effects.size, 0);
});

test('instruction panel has exact clearance on the opposite side, stable same-Y positioning, and cleanup', () => {
  harness(); canvas.grid.size = 100;
  const parent = new PIXI.Container(), origin = { x: 50, y: 50 };
  const panel = createInstructionPanel(parent, origin, 100, true), root = parent.children[0];
  const rectangle = root.children[0].commands.find(command => command[0] === 'drawRoundedRect');
  const height = rectangle[4];
  assert.equal(root.position.y, 250);
  panel.update({ y: 75 }); assert.equal(root.position.y + height, -150);
  panel.update({ y: 50 }); assert.equal(root.position.y + height, -150);
  panel.update({ y: 25 }); assert.equal(root.position.y, 250);
  const texts = root.children.slice(1).flatMap(row => row.children);
  assert.equal(texts.find(text => text.text === 'IMMUNE').style.fontStyle, 'italic');
  assert.ok(texts.every(text => text.style.fontSize === 20 && !text.style.strokeThickness));
  panel.destroy(); panel.destroy(); assert.equal(parent.children.length, 0);
});

test('ordinary movement panels omit immunity notice and invalid display policies fail validation', () => {
  const h = harness(); canvas.grid.size = 100;
  const panel = createInstructionPanel(canvas.stage, { x: 50, y: 50 }, 100, false);
  assert.equal(h.records.texts.some(text => text.text === 'IMMUNE'), false); panel.destroy();
  assert.throws(() => validateChevronOptions({ movement: { opportunityAttackImmunity: true } }), /requires movement/);
  assert.throws(() => validateChevronOptions({ movement: { instructions: 'yes' } }), /must be true or false/);
});
