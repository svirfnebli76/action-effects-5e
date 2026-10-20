import assert from "node:assert/strict";
import test from "node:test";
import { setup, definitions, broker, distant } from "./helpers/metamagic-fixtures.mjs";

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
  await f.service.recordConsumption(f.activity, {});
  assert.deepEqual(lines(info), [
    "[AE5E] Metamagic - Symaali Skorswaldt used Metamagic",
    "[AE5E] Metamagic - Distant Spell used by Symaali Skorswaldt",
    "[AE5E] Metamagic - Distant Spell consumed 1 Sorcery Point from Symaali Skorswaldt"
  ]);
  const firstDebit = f.service.get(f.workflow).nativeDebit;
  await f.service.recordConsumption(f.activity, { data: { system: { deltas: "duplicate" } } });
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
  await f.service.recordConsumption(f.activity, {});
  assert.equal(lines(info).at(-1), "[AE5E] Metamagic - Distant Spell consumed 0 Sorcery Points from Symaali Skorswaldt");
  assert.equal(f.pool.system.uses.value, 0);
});

test("console errors cannot interrupt casting or native consumption", async context => {
  const f = setup();
  context.mock.method(console, "info", () => { throw new Error("console unavailable"); });
  await f.service.begin(f.workflow);
  assert.equal(f.consume(), 1);
  await f.service.recordConsumption(f.activity, {});
  await f.service.commit(f.workflow);
  assert.equal(f.service.get(f.workflow).state, "committed");
  assert.equal(f.pool.system.uses.value, 3);
});

test("Item macros can replace their console wording without a runtime change", async context => {
  const f = setup();
  const info = capture(context, f);
  f.install(f.main, "Metamagic Broker", "broker", broker.replace("used Metamagic`", "printed a custom broker note`"));
  f.install(f.option, "Distant Spell", "option", distant
    .replace("${macroName} used by", "${macroName} custom use for")
    .replace("${macroName} consumed", "${macroName} custom payment of"));
  f.option.flags["action-effects-5e"].metamagic.declarations[0].cost = 2;
  await f.service.begin(f.workflow);
  assert.equal(f.consume(), 2);
  await f.service.recordConsumption(f.activity, {});
  assert.deepEqual(lines(info), [
    "[AE5E] Metamagic - Symaali Skorswaldt printed a custom broker note",
    "[AE5E] Metamagic - Distant Spell custom use for Symaali Skorswaldt",
    "[AE5E] Metamagic - Distant Spell custom payment of 2 Sorcery Points from Symaali Skorswaldt"
  ]);
});

test("Items may ignore lifecycle notifications and the runtime supplies no fallback messages", async context => {
  const f = setup();
  const info = capture(context, f);
  f.install(f.main, "Metamagic Broker", "broker", `
    if (data.phase !== "begin") return;
    return data.respond(document, macroName,
      await data.context.begin(document, async () => ["distant-spell"]));
  `);
  f.install(f.option, "Distant Spell", "option", `
    if (data.phase === "offer") return data.respond(document, macroName, { eligible: true });
    if (data.phase === "prepare") return data.respond(document, macroName,
      { activityUpdates: { "range.override": true, "range.units": "ft", "range.value": 60 } });
  `);
  await f.service.begin(f.workflow);
  assert.equal(f.consume(), 1);
  await f.service.recordConsumption(f.activity, {});
  await f.service.commit(f.workflow);
  assert.deepEqual(lines(info), []);
  assert.equal(f.activity.range.value, 60);
  assert.equal(f.service.get(f.workflow).state, "committed");
});

test("a failed lifecycle recipient cannot undo native payment or suppress the other recipient", async context => {
  const f = setup();
  const info = capture(context, f);
  context.mock.method(console, "warn", () => {});
  const notify = f.executors.notify.bind(f.executors);
  f.executors.notify = request => {
    if (request.kind === "broker") throw new Error("notification unavailable");
    return notify(request);
  };
  await f.service.begin(f.workflow);
  assert.equal(f.consume(), 1);
  await f.service.recordConsumption(f.activity, {});
  await f.service.commit(f.workflow);
  assert.deepEqual(lines(info), [
    "[AE5E] Metamagic - Distant Spell used by Symaali Skorswaldt",
    "[AE5E] Metamagic - Distant Spell consumed 1 Sorcery Point from Symaali Skorswaldt"
  ]);
  assert.equal(f.service.get(f.workflow).state, "committed");
  assert.equal(f.pool.system.uses.value, 3);
});

test("lifecycle data distinguishes aggregate payment from each option's allocated amount", async context => {
  const f = setup();
  capture(context, f);
  f.workflow.received = [];
  f.main.flags["action-effects-5e"].metamagic.declarations[0].selectionLimit = 2;
  const script = `
    if (document.uuid !== data.sourceItemUuid || macroName !== data.execution.name) return;
    if (data.phase === "consumed") {
      data.context.workflow.received.push({ kind: data.kind,
        amount: data.context.consumption.amount,
        totalAmount: data.context.consumption.totalAmount,
        sourceItemUuid: data.sourceItemUuid });
      return;
    }
    if (data.phase === "begin") return data.respond(document, macroName,
      await data.context.begin(document, async () => ["distant-spell", "second-option"]));
    if (data.phase === "offer") return data.respond(document, macroName, { eligible: true });
    if (data.phase === "prepare") return data.respond(document, macroName,
      { activityUpdates: { "duration.value": 2 } });
  `;
  const second = f.add("second", [{ ...definitions.distant, id: "second-option", cost: 2,
    execution: { interface: "cat-embedded", name: "Second Option" } }]);
  f.install(f.main, "Metamagic Broker", "broker", script);
  f.install(second, "Second Option", "option", script);
  await f.service.begin(f.workflow);
  assert.equal(f.consume(), 3);
  await f.service.recordConsumption(f.activity, {});
  assert.deepEqual(f.workflow.received, [
    { kind: "broker", amount: 3, totalAmount: 3, sourceItemUuid: f.main.uuid },
    { kind: "option", amount: 2, totalAmount: 3, sourceItemUuid: second.uuid }
  ]);
  assert.equal(f.calls.filter(call => call.phase === "consumed").length, 3);
  assert.equal(f.pool.system.uses.value, 1);
});
