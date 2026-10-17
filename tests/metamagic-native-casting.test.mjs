import assert from "node:assert/strict";
import test from "node:test";
import { MetamagicCastingService } from "../scripts/metamagic/casting-service.js";
import { scope, setup, nativeConsumption, definitions } from "./helpers/metamagic-fixtures.mjs";

test("numeric Distant selection, one native debit, stable casting identity and receipt", async () => {
  const f = setup();
  const source = JSON.stringify({ flags: f.original.flags, system: f.original.system });
  await f.service.begin(f.workflow);
  assert.equal(f.workflow.activity.range.value, 60);
  assert.equal(f.pool.system.uses.value, 4, "selection alone must not debit");
  const castingId = f.service.get(f.workflow).castingId;
  f.workflow.id = "ChatMessage.mutable";
  const native = f.activityClone(f.workflow.activity);
  const { message, usage } = nativeConsumption(f, native);
  assert.equal(usage.consume.spellSlot, false, "a no-slot casting still pays the modifier without adding a slot debit");
  assert.equal(f.pool.system.uses.value, 3);
  assert.equal(message.data.flags[scope].castingReceipt.castingId, castingId);
  assert.equal(f.service.prepareConsumption(native, usage), false, "a selected transaction cannot be charged again");
  await f.service.commit(f.workflow);
  await f.service.commit(f.workflow);
  await f.service.complete(f.workflow);
  await f.service.complete(f.workflow);
  assert.equal(f.service.get(castingId).state, "completed");
  assert.equal(f.cards.length, 2);
  assert.equal(f.cards[0].data.cost, 1);
  assert.equal(JSON.stringify({ flags: f.original.flags, system: f.original.system }), source);
});

test("Touch becomes 30 feet on a casting copy; later ordinary casting stays Touch", async () => {
  const f = setup({ range: { units: "touch", value: null, override: false } });
  await f.service.begin(f.workflow);
  assert.equal(f.workflow.activity.range.units, "ft");
  assert.equal(f.workflow.activity.range.value, 30);
  const later = { ...f.workflow, activity: f.activityClone() };
  later.item = later.activity.item;
  f.setChooser(async () => null);
  await f.service.begin(later);
  assert.equal(later.activity.range.units, "touch");
  assert.equal(f.pool.system.uses.value, 4);
});

test("native pre-write veto/cancel leaves pool intact, native deltas own post-card refund", async () => {
  const f = setup();
  await f.service.begin(f.workflow);
  const native = f.activityClone(f.workflow.activity);
  assert.equal(f.pool.system.uses.value, 4);
  const { delta } = nativeConsumption(f, native);
  // Installed Midi range/target rejection calls Activity.refund(message.system.deltas).
  // Applying that native delta restores points without any AE5E refund call.
  f.pool.system.uses.spent -= delta;
  f.pool.system.uses.value += delta;
  assert.equal(f.pool.system.uses.value, 4);
  assert.equal(f.service.get(f.workflow).refundOwner, "native-activity");
});

test("no selection and no declarations preserve ordinary casting", async () => {
  const f = setup();
  f.setChooser(async () => null);
  await f.service.begin(f.workflow);
  assert.equal(f.workflow.activity.range.value, 30);
  f.actor.items.delete("main");
  await f.service.begin({ ...f.workflow, activity: f.activityClone() });
  assert.equal(f.pool.system.uses.value, 4);
});

test("source documents and other coordinator calls cannot be mutated", async () => {
  const f = setup();
  const result = await f.service.begin(f.workflow, { initiatorUserId: "other" });
  assert.equal(result, true);
  assert.equal(f.service.get(f.workflow), null);
  f.workflow.activity.item = f.original;
  f.original.updateSource = () => assert.fail("canonical source mutation");
  await assert.rejects(f.service.begin(f.workflow), /Casting-local/);
});

test("ownership and ambiguous continuation are rejected without consumption", async () => {
  const f = setup();
  f.actor.isOwner = false;
  await assert.rejects(f.service.begin(f.workflow), /own/);
  f.actor.isOwner = true;
  await assert.rejects(f.service.begin(f.workflow, { parentCastingId: "arbitrary" }), /Continuation/);
  assert.equal(f.pool.system.uses.value, 4);
});

test("same resource in base or linked consumption requires explicit adapter", async () => {
  for (const linked of [false, true]) {
    const f = setup();
    await f.service.begin(f.workflow);
    const native = f.activityClone(f.workflow.activity);
    const target = { type: "itemUses", target: f.pool.id, value: "1" };
    if (linked) native.getLinkedActivity = () => ({ consumption: { targets: [target] } });
    else native.consumption.targets.push(target);
    assert.equal(f.service.prepareConsumption(native, { consume: true, cause: { activity: "linked" } }), false);
    assert.equal(f.pool.system.uses.value, 4);
  }
});

test("tampered native consumption plans fail before writes", async () => {
  const f = setup();
  await f.service.begin(f.workflow);
  const native = f.activityClone(f.workflow.activity);
  f.service.prepareConsumption(native, { consume: true });
  assert.equal(f.service.validateConsumption(native, { item: [], delete: [] }), false);
  assert.equal(f.service.validateConsumption(native, { item: [{ _id: "pool", "system.uses.spent": 99 }], delete: [] }), false);
});

test("misses, successful saves and late aborted flags do not trigger refunds", async () => {
  const f = setup();
  await f.service.begin(f.workflow);
  nativeConsumption(f, f.activityClone(f.workflow.activity));
  await f.service.commit(f.workflow);
  f.workflow.aborted = true;
  f.workflow.hitTargets = new Set();
  f.workflow.saves = new Set(["successful"]);
  await f.service.complete(f.workflow);
  assert.equal(f.pool.system.uses.value, 3);
  assert.equal(f.service.get(f.workflow).state, "completed");
});

test("unconfirmed native debit does not become a committed result", async () => {
  const f = setup();
  await f.service.begin(f.workflow);
  assert.equal(await f.service.commit(f.workflow), false);
  await f.service.complete(f.workflow);
  assert.equal(f.service.get(f.workflow).state, "unconfirmed");
  assert.equal(f.pool.system.uses.value, 4);
});

test("target and roll event identity distinguish unlinked tokens sharing an Actor", () => {
  const f = setup();
  const a = f.service.eventIdentity("cast", { phase: "save", targetActorUuid: "Actor.shared", targetTokenUuid: "Scene.s.Token.a", rollId: "r1" });
  assert.notEqual(a, f.service.eventIdentity("cast", { phase: "save", targetActorUuid: "Actor.shared", targetTokenUuid: "Scene.s.Token.b", rollId: "r1" }));
  assert.notEqual(a, f.service.eventIdentity("cast", { phase: "save", targetActorUuid: "Actor.shared", targetTokenUuid: "Scene.s.Token.a", rollId: "r2" }));
});

test("inactive base declaration leaves ordinary casting untouched", async () => {
  const f = setup();
  f.main.flags[scope].metamagic.declarations[0].activation = { equipped: true };
  f.setChooser(() => assert.fail("inactive base offered a choice"));
  await f.service.begin(f.workflow);
  assert.equal(f.service.get(f.workflow), null);
});

test("native consumption target cannot be deselected in the spell configuration", async () => {
  const f = setup();
  await f.service.begin(f.workflow);
  const native = f.activityClone(f.workflow.activity);
  const usage = { consume: { action: true, resources: [] } };
  const message = { hasConsumption: false };
  assert.equal(f.service.prepareConsumption(native, usage, message), true);
  assert.equal(usage.consume.action, true);
  assert.deepEqual(usage.consume.resources, [0]);
  assert.equal(message.hasConsumption, true);
  assert.equal(f.service.prepareConsumption(native, usage, message), true);
  assert.equal(native.consumption.targets.length, 1, "repeated preparation must not append another charge");
});

test("free selected options retain a native consumption confirmation without a new pool debit", async () => {
  const f = setup({ available: 0 });
  f.add("discount", [definitions.discount]);
  await f.service.begin(f.workflow);
  const native = f.activityClone(f.workflow.activity);
  assert.equal(f.service.prepareConsumption(native, { consume: false }), true);
  assert.equal(native.consumption.targets.length, 0);
  assert.equal(f.service.validateConsumption(native, { item: [], delete: [] }), true);
  f.service.recordConsumption(native, { data: {} });
  assert.equal(await f.service.commit(f.workflow), true);
  assert.equal(f.service.get(f.workflow).totalCost, 0);
  assert.equal(f.pool.system.uses.value, 0);
});

test("cast snapshot survives option deletion and presentation failure cannot undo a cast", async () => {
  const f = setup();
  const service = new MetamagicCastingService({ declarations: f.declarations,
    executors: f.executors,
    cards: { upsertContribution: async () => { throw new Error("card unavailable"); } } });
  await service.begin(f.workflow);
  const native = f.activityClone(f.workflow.activity);
  const fixture = { ...f, service };
  nativeConsumption(fixture, native);
  f.actor.items.delete("option");
  await service.commit(f.workflow);
  await service.complete(f.workflow);
  assert.equal(service.get(f.workflow).selected[0].id, "distant-spell");
  assert.equal(service.get(f.workflow).state, "completed");
  assert.equal(service.get(f.workflow).presentation.reason, "card unavailable");
  assert.equal(f.pool.system.uses.value, 3);
});

test("runtime hook wiring is idempotent and synchronous vetoes remain synchronous", async () => {
  const handlers = new Map();
  const previous = globalThis.Hooks;
  globalThis.Hooks = {
    on(name, callback) { handlers.set(name, callback); return name; },
    off(name) { handlers.delete(name); }
  };
  try {
    const f = setup();
    f.service.initialize();
    f.service.initialize();
    assert.equal(handlers.size, 9);
    await f.service.begin(f.workflow);
    const native = f.activityClone(f.workflow.activity);
    assert.equal(handlers.get("dnd5e.preUseActivity")(native), true);
    assert.equal(handlers.get("dnd5e.preActivityConsumption")(native, { consume: false }, {}), true);
    assert.equal(handlers.get("dnd5e.activityConsumption")(native, {}, {}, { item: [], delete: [] }), false);
    f.service.shutdown();
    assert.equal(handlers.size, 0);
  } finally { globalThis.Hooks = previous; }
});

test("orphaned/cross-client cast markers cannot gain a free paid modifier", async () => {
  const f = setup();
  await f.service.begin(f.workflow);
  const native = f.activityClone(f.workflow.activity);
  native.item.flags[scope].casting.initiatorUserId = "other-user";
  assert.equal(f.service.prepareNative(native), false);
  assert.equal(f.service.prepareConsumption(native, { consume: true }), false);
  assert.equal(f.service.validateConsumption(native, { item: [] }), false);
  delete native.item.flags[scope].casting;
  assert.equal(f.service.prepareNative(native), true);
});

test("grant removal while native configuration is open stops before payment", async () => {
  const f = setup();
  await f.service.begin(f.workflow);
  f.actor.items.delete("option");
  assert.equal(f.service.prepareConsumption(f.activityClone(f.workflow.activity), { consume: true }), false);
  assert.equal(f.pool.system.uses.value, 4);
});

test("Midi hook envelopes normalize workflow/config/usage transports from Stage 0", async () => {
  const handlers = new Map();
  const previous = globalThis.Hooks;
  globalThis.Hooks = { on(name, callback) { handlers.set(name, callback); return name; }, off() {} };
  try {
    const f = setup();
    const seen = [];
    f.service.begin = async workflow => { seen.push(workflow); return true; };
    f.service.commit = async workflow => { seen.push(workflow); return true; };
    f.service.complete = async workflow => { seen.push(workflow); return true; };
    f.service.initialize();
    await handlers.get("midi-qol.preTargetingV2")({}, { config: { workflow: f.workflow } });
    await handlers.get("midi-qol.premades.postPreambleComplete")({ workflow: f.workflow });
    await handlers.get("midi-qol.RollComplete")({ usage: { workflow: f.workflow } });
    await handlers.get("midi-qol.premades.postRollFinished")(f.workflow);
    assert.deepEqual(seen, [f.workflow, f.workflow, f.workflow, f.workflow]);
  } finally { globalThis.Hooks = previous; }
});

test("Distant range survives parent Item re-preparation, native cloning and scaling", async () => {
  const f = setup({ sourceBacked: true });
  await f.service.begin(f.workflow);
  const castItem = f.workflow.activity.item;
  assert.equal(castItem._source.system.activities.activity.range.value, "60");
  assert.equal(castItem.system.activities.get("activity").range.value, 60);
  const native = f.activityClone(f.workflow.activity);
  assert.equal(native.range.value, 60, "native use must clone the selected range from parent source");
  assert.equal(f.service.prepareNative(native), true);
  native.item.updateSource({ "flags.dnd5e.scaling": 1 });
  native.item.prepareFinalAttributes(); // Native _prepareUsageScaling finalizes after the flag update.
  const scaled = native.item.system.activities.get("activity");
  assert.equal(scaled.range.value, 60, "native scaling must not restore the ordinary range");
  const { delta } = nativeConsumption(f, scaled);
  assert.equal(delta, 1);
  assert.equal(scaled.item.system.activities.get("activity").range.value, 60, "adding payment must retain range");
  assert.equal(f.workflow.activity.range.value, 60, "Midi's original Activity receiver must also retain range");
  assert.equal(f.original.system.range.value, 30);
  assert.equal(f.activityClone().range.value, 30, "later ordinary casting starts from canonical source");
});

test("Touch range survives native Item cloning without modifying the canonical spell", async () => {
  const f = setup({ sourceBacked: true, range: { value: null, units: "touch", override: false } });
  await f.service.begin(f.workflow);
  const native = f.activityClone(f.workflow.activity);
  assert.equal(native.range.units, "ft");
  assert.equal(native.range.value, 30);
  assert.equal(native.range.override, true);
  assert.equal(native.item.system.range.units, "ft");
  assert.equal(native.item.system.range.value, 30, "Touch also needs a numeric casting-local fallback");
  assert.equal(f.original.system.range.units, "touch");
});

test("casting-local Item preparation restores the native Actor flag even on failure", async () => {
  const f = setup({ sourceBacked: true });
  f.actor._embeddedPreparation = false;
  let prepared = 0;
  const originalPrepare = f.workflow.activity.item.prepareFinalAttributes.bind(f.workflow.activity.item);
  f.workflow.activity.item.prepareFinalAttributes = () => { prepared++; originalPrepare(); };
  await f.service.begin(f.workflow);
  assert.equal(f.actor._embeddedPreparation, false);
  assert.equal(prepared, 1);
  const g = setup();
  g.workflow.activity.item.updateSource = () => { assert.equal(g.actor._embeddedPreparation, true); throw new Error("rejected source update"); };
  await assert.rejects(g.service.begin(g.workflow), /rejected source update/);
  assert.equal(Object.hasOwn(g.actor, "_embeddedPreparation"), false);
  assert.equal(g.pool.system.uses.value, 4);
});

test("lost Activity range rejects the native payment plan and remains visible in diagnostics", async () => {
  const f = setup();
  await f.service.begin(f.workflow);
  const native = f.activityClone(f.workflow.activity);
  f.service.prepareConsumption(native, { consume: true });
  native.range.value = 30;
  assert.equal(f.service.validateConsumption(native, { item: [{ _id: "pool", "system.uses.spent": 4 }], delete: [] }), false);
  const report = f.service.recent()[0];
  assert.equal(report.runtimeRevision, "activity-source-bridge-4");
  assert.equal(report.activityChecks.at(-1).receiver["range.value"], 30);
  assert.equal(report.activityChecks.at(-1).expected["range.value"], 60);
  assert.equal(f.pool.system.uses.value, 4);
});

test("native FormulaField source remains a string while original and rebuilt receivers are numeric", async () => {
  const f = setup({ sourceBacked: true });
  await f.service.begin(f.workflow);
  const snapshot = f.service.get(f.workflow).activityChecks.at(-1);
  assert.equal(snapshot.parentSource["range.value"], "60");
  for (const key of ["receiver", "prepared", "workflow"]) assert.equal(snapshot[key]["range.value"], 60, key);
  assert.equal(f.workflow.activity.item._source.system.activities.activity.range.value, "60");
  assert.equal(f.pool.system.uses.value, 4, "preparation does not spend points");
  assert.equal(f.original.system.range.value, 30);
});

test("post-use range metadata loss uses the selected casting-local parent range", async () => {
  // Midi 14.6.2 utils.ts activityRanges: without own.override, Item range wins.
  const midiNormalRange = activity => activity.range.override
    ? activity.range.value || activity.range.reach || 0
    : Number(activity.item.system.range?.value) || activity.range.value || activity.range.reach || 0;
  const f = setup({ sourceBacked: true });
  await f.service.begin(f.workflow);
  const native = f.activityClone(f.workflow.activity);
  nativeConsumption(f, native);
  f.workflow.activity = native; // Midi's native hook points the workflow at this receiver.
  delete native.range.override; // Exact post-use shape in the supplied live diagnostic.
  assert.equal(native.range.value, 60);
  assert.equal(midiNormalRange(native), 60, "the Stage 0 parent fallback must already hold the selected range");
  // Revision 3's attempted re-preparation failed on the held receiver: its
  // override stayed absent and its value fell back to the parent. Model that
  // observed boundary, rather than assuming updateSource restores live metadata.
  let detachedPreparations = 0;
  const finalize = native.prepareFinalData.bind(native);
  native.prepareFinalData = () => {
    detachedPreparations++;
    finalize();
    delete native.range.override;
    native.range.value = Number(native.item.system.range.value);
  };
  assert.equal(f.service.observeNative(native), true);
  assert.equal(midiNormalRange(native), 60);
  assert.equal(native.range.override, undefined);
  assert.equal(native._source.range.override, true);
  assert.equal(detachedPreparations, 0, "do not reprepare a mechanically correct post-use receiver to restore metadata");
  assert.equal(native.consumption.targets.length, 1);
  assert.equal(f.pool.system.uses.value, 3, "restoring metadata must not debit again");
  assert.equal(f.service.get(f.workflow).nativeDebit.amount, 1);
  assert.equal(f.original.system.range.value, 30);
  assert.equal(midiNormalRange(f.activityClone()), 30, "an unrelated later cast keeps ordinary range");
});

test("post-use restoration failure remains unconfirmed without inventing a refund or charging again", async () => {
  const f = setup({ sourceBacked: true });
  await f.service.begin(f.workflow);
  const native = f.activityClone(f.workflow.activity);
  nativeConsumption(f, native);
  f.workflow.activity = native;
  delete native.range.override;
  native.range.value = 30;
  native.item.updateSource = () => { throw new Error("post-use preparation unavailable"); };
  assert.equal(f.service.observeNative(native), false);
  assert.equal(await f.service.commit(f.workflow), false);
  await f.service.complete(f.workflow);
  assert.equal(f.service.get(f.workflow).state, "unconfirmed");
  assert.equal(f.pool.system.uses.value, 3);
  assert.equal(f.service.get(f.workflow).nativeDebit.amount, 1);
  assert.equal(f.original.system.range.value, 30);
});

test("missing post-use override is not accepted with an incorrect parent fallback or lost source intent", async () => {
  for (const problem of ["parent-value", "parent-units", "source-override"]) {
    const f = setup({ sourceBacked: true });
    await f.service.begin(f.workflow);
    const native = f.activityClone(f.workflow.activity);
    nativeConsumption(f, native);
    f.workflow.activity = native;
    delete native.range.override;
    if (problem === "parent-value") native.item.system.range.value = 30;
    if (problem === "parent-units") native.item.system.range.units = "touch";
    if (problem === "source-override") delete native._source.range.override;
    native.item.updateSource = () => { throw new Error("restoration unavailable"); };
    assert.equal(f.service.observeNative(native), false, problem);
    assert.equal(await f.service.commit(f.workflow), false, problem);
    assert.equal(f.pool.system.uses.value, 3, "no second debit or speculative refund");
    assert.equal(f.original.system.range.value, 30);
  }
});
