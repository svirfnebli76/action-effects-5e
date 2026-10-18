import assert from "node:assert/strict";
import test from "node:test";
import { setup, definitions } from "./helpers/metamagic-fixtures.mjs";

function capture(context, fixture) {
  fixture.actor.name = "Symaali Skorswaldt";
  fixture.option.name = "Metamagic - Distant Spell";
  return context.mock.method(console, "info", () => {});
}
const lines = mock => mock.mock.calls.map(call => call.arguments[0]);

test("continuing without an option logs one non-use note for the actor", async context => {
  const f = setup();
  const info = capture(context, f);
  f.setChooser(async () => "__finish");
  await Promise.all([f.service.begin(f.workflow), f.service.begin(f.workflow)]);
  assert.deepEqual(lines(info), ["[AE5E] Metamagic - Symaali Skorswaldt did not use Metamagic"]);
  assert.equal(f.pool.system.uses.value, 4);
});

test("closing the chooser logs non-use without a usage or consumption note", async context => {
  const f = setup();
  const info = capture(context, f);
  f.setChooser(async () => null);
  await f.service.begin(f.workflow);
  assert.deepEqual(lines(info), ["[AE5E] Metamagic - Symaali Skorswaldt did not use Metamagic"]);
});

test("usage and actual option cost log once after native consumption, including a resolved miss", async context => {
  const f = setup();
  const info = capture(context, f);
  await f.service.begin(f.workflow);
  assert.deepEqual(lines(info), [], "selection alone is not payment");
  f.consume();
  assert.deepEqual(lines(info), [
    "[AE5E] Metamagic - Symaali Skorswaldt used Metamagic",
    "[AE5E] Metamagic - Distant Spell used by Symaali Skorswaldt",
    "[AE5E] Metamagic - Distant Spell consumed 1 Sorcery Point from Symaali Skorswaldt"
  ]);
  const firstDebit = f.service.get(f.workflow).nativeDebit;
  f.service.recordConsumption(f.activity, { data: { system: { deltas: "duplicate" } } });
  f.workflow.hitTargets = new Set();
  await f.service.commit(f.workflow);
  await f.service.complete(f.workflow);
  assert.equal(info.mock.callCount(), 3);
  assert.deepEqual(f.service.get(f.workflow).nativeDebit, firstDebit);
  assert.equal(f.pool.system.uses.value, 3);
});

test("cancelled-before-payment or unaffordable casts do not claim a use or point debit", async context => {
  const f = setup();
  const info = capture(context, f);
  await f.service.begin(f.workflow);
  assert.equal(f.service.prepareNative(f.activity), true);
  assert.deepEqual(lines(info), [], "native configuration may still be cancelled");
  f.pool.system.uses.value = 0;
  assert.equal(f.service.prepareConsumption(f.activity, { consume: false }), false);
  assert.deepEqual(lines(info), []);
});

test("free-price providers log zero rather than the option's unadjusted price", async context => {
  const f = setup({ available: 0 });
  const info = capture(context, f);
  f.add("discount", [definitions.discount]);
  await f.service.begin(f.workflow);
  assert.deepEqual(lines(info), []);
  assert.equal(f.consume(), 0);
  assert.equal(lines(info).at(-1), "[AE5E] Metamagic - Distant Spell consumed 0 Sorcery Points from Symaali Skorswaldt");
  assert.equal(f.pool.system.uses.value, 0);
});

test("console errors cannot interrupt casting or native consumption", async context => {
  const f = setup();
  context.mock.method(console, "info", () => { throw new Error("console unavailable"); });
  await f.service.begin(f.workflow);
  assert.equal(f.consume(), 1);
  await f.service.commit(f.workflow);
  assert.equal(f.service.get(f.workflow).state, "committed");
  assert.equal(f.pool.system.uses.value, 3);
});
