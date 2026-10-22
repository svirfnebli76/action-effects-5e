import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TargetConfirmationAdapter,
  normalizeTargetConfirmationAppearance,
  visibleDisposition,
  allowedBannerPath,
  normalizeTargetInstructions
} from '../scripts/ui/target-confirmation-adapter.js';

test('presentation defaults follow the approved AE5E broker colors and sizing', () => {
  const appearance = normalizeTargetConfirmationAppearance();
  assert.equal(appearance.windowWidth, 500);
  assert.equal(appearance.maxHeight, 800);
  assert.equal(appearance.portraitSize, 48);
  assert.equal(appearance.ringWidth, 3);
  assert.equal(appearance.counter.fontSize, 13);
  assert.equal(appearance.reminder.fontSize, 12);
  assert.equal(appearance.colors.hostile, '#f05b5b');
  assert.equal(appearance.colors.neutral, '#ff9f1c');
  assert.equal(appearance.colors.friendly, '#18cc46');
});

test('individual Item appearance overrides merge safely', () => {
  const result = normalizeTargetConfirmationAppearance({
    portraitSize: 56,
    ringWidth: 5,
    counter: { fontSize: 15, fontWeight: 700 },
    instructions: { fontSize: 14 },
    colors: { hostile: '#AABBCC' }
  });
  assert.equal(result.portraitSize, 56);
  assert.equal(result.ringWidth, 5);
  assert.equal(result.counter.fontSize, 15);
  assert.equal(result.counter.fontWeight, 700);
  assert.equal(result.counter.align, 'center');
  assert.equal(result.instructions.fontWeight, 400);
  assert.equal(result.colors.hostile, '#AABBCC');
  assert.equal(result.colors.friendly, '#18cc46');
});

test('malformed/unsafe overrides cannot inject arbitrary CSS or sizes', () => {
  const result = normalizeTargetConfirmationAppearance({
    windowWidth: '9999px', portraitSize: -2, ringWidth: 999,
    instructions: { fontSize: '16px', fontWeight: 355 },
    colors: { hostile: 'red; background: url(https://bad)', secret: '#12345678' },
    unknownProperty: 'not supported'
  });
  assert.equal(result.windowWidth, 500);
  assert.equal(result.portraitSize, 48);
  assert.equal(result.ringWidth, 3);
  assert.equal(result.instructions.fontSize, 15);
  assert.equal(result.instructions.fontWeight, 400);
  assert.equal(result.colors.hostile, '#f05b5b');
  assert.equal(result.colors.secret, '#a668d8');
  assert.equal('unknownProperty' in result, false);
});

test('disposition rings are authoritative for GM and non-revealing for players', () => {
  assert.equal(visibleDisposition(-1), 'hostile');
  assert.equal(visibleDisposition(0), 'neutral');
  assert.equal(visibleDisposition(1), 'friendly');
  assert.equal(visibleDisposition(-2, { isGM: true }), 'secret');
  assert.equal(visibleDisposition(-2, { isGM: false }), 'unrevealed');
  assert.equal(visibleDisposition(null), 'unrevealed');
});

test('a configured native dialog request is scoped to one owned casting Item', () => {
  globalThis.game = { user: { id: 'u1', isGM: false } };
  const actor = { id: 'caster', isOwner: true };
  const item = { id: 'charm' };
  const workflow = { actor, activity: { item } };
  const adapter = new TargetConfirmationAdapter();
  const id = adapter.arm({
    actor, item, workflow,
    title: 'Twinned Spell Targeting',
    instructions: '**Shift-click**',
    reminder: '(You do not need to use ALL available Target slots)',
    validation: { minTargets: 1, enforceRange: true }
  });
  assert.equal(adapter.getStatus().pending, 1);
  assert.equal(adapter.cancel(id), true);
  assert.equal(adapter.getStatus().pending, 0);
  assert.equal(adapter.cancel(id), false);
  assert.throws(() => adapter.arm({ workflow, actor: { id: 'other', isOwner: true }, item }), /scoped/);
  assert.throws(() => adapter.arm({ workflow, actor: { id: 'caster', isOwner: false }, item }), /owned/);
});

test('a new workflow clears a pending request for the same actor and Item', () => {
  const callbacks = new Map();
  globalThis.Hooks = { on: (name, fn) => {
    callbacks.set(name, fn);
    return callbacks.size;
  }};
  globalThis.game = { user: { id: 'u1', isGM: false } };
  const actor = { id: 'caster', isOwner: true };
  const item = { id: 'charm' };
  const first = { actor, activity: { item } };
  const second = { actor, activity: { item } };
  const adapter = new TargetConfirmationAdapter();
  adapter.initialize();
  adapter.arm({ workflow: first });
  assert.equal(adapter.getStatus().pending, 1);
  callbacks.get('midi-qol.preTargetingV2')(second);
  assert.equal(adapter.getStatus().pending, 0);
});


test('banner path accepts the approved asset but rejects remote or traversal URLs', () => {
  assert.equal(allowedBannerPath('modules/action-effects-5e/assets/banners/feats/twinnedSpell.webp'),
    'modules/action-effects-5e/assets/banners/feats/twinnedSpell.webp');
  assert.equal(allowedBannerPath('javascript:alert(1)'), null);
  assert.equal(allowedBannerPath('https://example.com/evil.png'), null);
  assert.equal(allowedBannerPath('modules/action-effects-5e/../secrets.png'), null);
});

test('structured instructions retain exact Twinned text and safe tone markers', () => {
  const layout = normalizeTargetInstructions({
    description: 'Twinned Spell increases the number of creatures this spell can target',
    commands: [
      { label: 'SHIFT-CLICK', text: ' a token to add a Target', tone: 'positive' },
      { label: 'RIGHT-CLICK', text: ' a token to remove a Target', tone: 'negative' }
    ]
  });
  assert.equal(layout.commands.length, 2);
  assert.equal(layout.commands[0].label, 'SHIFT-CLICK');
  assert.equal(layout.commands[1].tone, 'negative');
  assert.equal(normalizeTargetInstructions({ description: 'bad', commands: [{label:'A',text:'B',tone:'<script>'}] }), null);
});
