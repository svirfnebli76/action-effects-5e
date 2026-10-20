import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatCardAdapter, cardSectionPolicy, applyCardSections, CARD_SECTION_CLASSES }
  from '../scripts/chat/chat-card-adapter.js';
import { validateCatConfigurationData } from '../scripts/authoring/cat-configuration-authoring-service.js';

test('section snapshots reject incomplete or incorrectly typed values', () => {
  for (const value of [null, {}, { schema: 2 },
    { schema: 1, targeting: true, saves: true },
    { schema: 1, targeting: 'false', saves: true, damageApplication: true }]) {
    assert.equal(cardSectionPolicy(value), null);
  }
});

test('all eight combinations independently mark one content host and can be reset', () => {
  const active = new Set(['other-module']);
  const content = { classList: { toggle(name, enabled) {
    if (enabled) active.add(name); else active.delete(name);
  } } };
  for (let bits = 0; bits < 8; bits++) {
    const value = { schema: 1, targeting: Boolean(bits & 1), saves: Boolean(bits & 2),
      damageApplication: Boolean(bits & 4) };
    applyCardSections(content, value);
    for (const [key, name] of Object.entries(CARD_SECTION_CLASSES)) {
      assert.equal(active.has(name), Boolean(value[key]));
    }
    assert.equal(active.has('other-module'), true);
  }
  applyCardSections(content, null);
  assert.deepEqual([...active], ['other-module']);
});

test('native cards do not need a custom layout for snapshotted section rendering', () => {
  const active = new Set();
  const content = { classList: { toggle(name, enabled) {
    if (enabled) active.add(name); else active.delete(name);
  } } };
  const html = { querySelector(selector) {
    assert.equal(selector, '.message-content');
    return content;
  } };
  const message = { id: 'initial', isContentVisible: true, flags: {
    'action-effects-5e': { initialCardSections: {
      schema: 1, targeting: true, saves: false, damageApplication: true
    } }
  } };
  new ChatCardAdapter().render(message, html);
  assert.deepEqual([...active], ['ae5e-hide-initial-targeting', 'ae5e-hide-initial-damage-application']);
  // A separate results message with no policy receives no suppression classes.
  new ChatCardAdapter().render({ id: 'results', flags: {} }, html);
  assert.equal(active.size, 0);
});

test('section writes require ownership and retain unrelated message fields', async () => {
  const adapter = new ChatCardAdapter();
  const policy = { schema: 1, targeting: true, saves: false, damageApplication: true };
  const writes = [];
  const message = { documentName: 'ChatMessage', id: 'M', isOwner: false, flags: {},
    async update(patch) { writes.push(patch); } };
  assert.equal((await adapter.setSections(message, policy)).updated, false);
  assert.equal(writes.length, 0);
  message.isOwner = true;
  assert.equal((await adapter.setSections({ chatCard: message }, policy)).updated, true);
  assert.deepEqual(writes, [{ 'flags.action-effects-5e.initialCardSections': policy }]);
  message.flags = { 'action-effects-5e': { initialCardSections: structuredClone(policy) } };
  assert.equal((await adapter.setSections(message, policy)).reason, 'unchanged');
  assert.equal(writes.length, 1);
  await assert.rejects(adapter.setSections(message, { schema: 1, saves: true }));
});

test('CAT checkbox schema supports the three independent default-on options', () => {
  const schema = Object.fromEntries(['Targeting', 'Saves', 'DamageApplication'].map(name =>
    [`suppressInitial${name}`, { label: name, type: 'checkbox', default: true }]));
  const result = validateCatConfigurationData(schema);
  assert.equal(result.valid, true);
  assert.equal(result.optionCount, 3);
});
