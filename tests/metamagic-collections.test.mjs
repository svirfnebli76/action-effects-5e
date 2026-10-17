import assert from "node:assert/strict";
import test from "node:test";
import { scope, copy, definitions, setup, distant } from "./helpers/metamagic-fixtures.mjs";
import { envelope } from "./helpers/declaration-fixtures.mjs";

test("owned option records populate the learned set without changing source Items or stored ids", async () => {
  const f = setup();
  const before = JSON.stringify([f.main.flags, f.option.flags]);
  const compiled = f.declarations.compile(f.actor);
  assert.equal(compiled.ready, true);
  assert.deepEqual(compiled.learnedOptions, ["distant-spell"]);
  assert.equal(compiled.options[0].provenance[0].sourceItemUuid, f.option.uuid);
  assert.equal(compiled.mainIdentity, JSON.stringify([f.main.uuid, "metamagic", "base"]));
  assert.equal(typeof f.declarations.learn, "undefined", "the manual learned-id write API is retired");
  f.main.flags[scope].metamagic.declarations[0].learnedOptions = ["stale-manual-id"];
  assert.deepEqual(f.declarations.compile(f.actor).learnedOptions, ["distant-spell"]);
  delete f.main.flags[scope].metamagic.declarations[0].learnedOptions;
  assert.equal(JSON.stringify([f.main.flags, f.option.flags]), before);
  f.actor.items.delete(f.option.id);
  assert.deepEqual(f.declarations.compile(f.actor).learnedOptions, []);
  assert.deepEqual(f.writes, []);
});

test("full synthetic source identity and multiple records and families survive compilation", () => {
  const f = setup({ uuid: "Scene.scene.Token.synthetic.Actor.caster" });
  f.main.flags[scope].metamagic.declarations.push(copy(definitions.extraChoice), copy(definitions.combination));
  f.main.flags[scope].future = envelope([{ id: "other-family", settings: {} }]);
  const compiled = f.declarations.compile(f.actor);
  assert.equal(compiled.ready, true);
  assert.equal(compiled.optionChoices, 3);
  assert.equal(compiled.selectionLimit, 2);
  assert.equal(compiled.options[0].identity, JSON.stringify([f.option.uuid, "metamagic", "distant-spell"]));
  assert.equal(compiled.providers.length, 2);
});

test("independent grant provenance coalesces, grant-only definitions stay inert without active grants", () => {
  const f = setup();
  const one = f.add("ring-one", [definitions.ringGrant], { equipped: true, attuned: true });
  const two = f.add("ring-two", [definitions.ringGrant], { equipped: true, attuned: true });
  assert.equal(f.declarations.compile(f.actor).options[0].provenance.length, 3);
  f.option.flags[scope].metamagic.declarations[0].acquisition = "grant-only";
  assert.deepEqual(f.declarations.compile(f.actor).learnedOptions, []);
  assert.equal(f.declarations.compile(f.actor).options[0].provenance.length, 2);
  one.system.attuned = false;
  two.system.equipped = false;
  assert.equal(f.declarations.compile(f.actor).options.length, 0);
});

test("capacity is enforced on the derived learned set; granted-only options do not consume choices", () => {
  const f = setup();
  f.main.flags[scope].metamagic.declarations[0].optionChoices = 0;
  assert.equal(f.declarations.compile(f.actor).ready, false);
  f.option.flags[scope].metamagic.declarations[0].acquisition = "grant-only";
  f.add("grant", [definitions.ringGrant], { equipped: true, attuned: true });
  assert.equal(f.declarations.compile(f.actor).ready, true);
});

test("casting conditions do not erase learned capacity, and ineligible granted definitions do not become missing definitions", () => {
  const f = setup({ ac5e: { evaluateCondition: () => ({ ok: true, eligible: false }) } });
  f.option.flags[scope].metamagic.declarations[0].condition = "false";
  let compiled = f.declarations.compile(f.actor);
  assert.deepEqual(compiled.learnedOptions, ["distant-spell"]);
  assert.equal(compiled.options.length, 0);
  assert.equal(compiled.ready, true);
  f.main.flags[scope].metamagic.declarations[0].optionChoices = 0;
  assert.equal(f.declarations.compile(f.actor).ready, false);
  f.option.flags[scope].metamagic.declarations[0].acquisition = "grant-only";
  f.add("ring", [definitions.ringGrant], { equipped: true, attuned: true });
  compiled = f.declarations.compile(f.actor);
  assert.equal(compiled.ready, true);
  assert.equal(compiled.options.length, 0);
});

test("ambiguous resource pools and missing granted definitions require correction", () => {
  const f = setup();
  f.add("other-pool", null, { identifier: "sorcery-points" });
  assert.equal(f.declarations.compile(f.actor).ready, false);
  f.main.flags[scope].metamagic.declarations[0].resource.itemId = f.pool.id;
  assert.equal(f.declarations.compile(f.actor).ready, true);
  f.add("invalid-grant", [{ id: "grant", type: "provider", grants: ["missing-option"] }]);
  assert.equal(f.declarations.compile(f.actor).ready, false);
});

test("competing definitions, duplicate ids and multiple active bases fail closed", () => {
  for (const mode of ["definition", "record", "base"]) {
    const f = setup();
    if (mode === "definition") f.add("duplicate", [definitions.distant]);
    if (mode === "record") f.option.flags[scope].metamagic.declarations.push(copy(definitions.distant));
    if (mode === "base") f.main.flags[scope].metamagic.declarations.push({ ...copy(definitions.base), id: "another-base" });
    const compiled = f.declarations.compile(f.actor);
    assert.equal(compiled.ready, false, mode);
    assert.ok(compiled.diagnostics.length, mode);
  }
});

test("new collection bases diagnose preserved legacy declarations without migration", async () => {
  const f = setup();
  const legacy = f.add("old-test", null);
  legacy.flags[scope] = { metamagic: { version: 1, family: "metamagic", type: "main", id: "legacy", enabled: true } };
  const before = JSON.stringify(legacy.flags);
  await assert.rejects(f.service.begin(f.workflow), /legacy|migration/);
  assert.equal(JSON.stringify(legacy.flags), before);
  assert.deepEqual(f.calls, []);
});

test("retired singleton test Items cannot start any Metamagic execution", async () => {
  const f = setup();
  f.main.flags[scope].metamagic = { version: 1, family: "metamagic", type: "main", id: "old-test", enabled: true };
  f.option.flags[scope].metamagic = { version: 1, family: "metamagic", type: "option", id: "distant-spell",
    execution: { macroUuid: "Macro.retired" } };
  assert.equal(await f.service.begin(f.workflow), true);
  assert.equal(f.service.get(f.workflow), null);
  assert.equal(f.declarations.read(f.main).valid, false);
  assert.deepEqual(f.calls, []);
  assert.equal(f.pool.system.uses.value, 4);
});

test("declaration activation and AC5E conditions use the casting context and record identity", async () => {
  const evaluations = [];
  let allowed = true;
  const f = setup({ ac5e: { evaluateCondition(request) {
    evaluations.push(request);
    return { ok: true, eligible: allowed };
  } } });
  f.option.flags[scope].metamagic.declarations[0].condition = "someItemOwnedCondition";
  assert.equal(await f.service.begin(f.workflow), true);
  assert.equal(evaluations[0].activity, f.activity);
  assert.equal(evaluations[0].subjectToken, f.workflow.token.document);
  assert.equal(evaluations[0].context.sourceItemUuid, f.option.uuid);
  allowed = false;
  assert.equal(f.service.prepareConsumption(f.activity, { consume: false }), false);
  assert.equal(f.pool.system.uses.value, 4);
});

test("ineligible base and absent base leave ordinary casts and standalone options alone", async () => {
  for (const mode of ["absent", "inactive", "condition"]) {
    const f = setup();
    if (mode === "absent") f.actor.items.delete(f.main.id);
    if (mode === "inactive") f.main.flags[scope].metamagic.declarations[0].activation = { equipped: true };
    if (mode === "condition") {
      f.main.flags[scope].metamagic.declarations[0].condition = "false";
      f.collections.ac5e = { evaluateCondition: () => ({ ok: true, eligible: false }) };
    }
    assert.equal(await f.service.begin(f.workflow), true, mode);
    assert.equal(f.service.get(f.workflow), null, mode);
    assert.deepEqual(f.calls, [], mode);
    assert.equal(f.activity.range.value, 30, mode);
  }
});

for (const [range, expected, units] of [
  [{ value: 30, units: "ft" }, 60, "ft"],
  [{ value: null, units: "touch" }, 30, "ft"],
  [{ value: 10, units: "m" }, 20, "m"],
  [{ value: 1, units: "mi" }, 2, "mi"],
  [{ value: 1, units: "km" }, 2, "km"]
]) test(`Item-owned broker/Distant modifies ${range.units}, preserves the source and pays once natively`, async () => {
  const f = setup({ range });
  const before = JSON.stringify([f.original.system, f.original.flags, f.main.flags, f.option.flags]);
  assert.equal(await f.service.begin(f.workflow), true);
  assert.equal(f.activity.range.value, expected);
  assert.equal(f.activity.range.units, units);
  assert.equal(f.activity.item.system.range.value, expected);
  assert.equal(f.pool.system.uses.value, 4);
  assert.deepEqual(f.calls.map(call => call.kind), ["broker", "option", "option", "option"]);
  assert.equal(f.prompts[0].controllerUserId, "gm");
  assert.equal(f.consume(), 1);
  assert.equal(f.service.prepareConsumption(f.activity, { consume: false }), false);
  assert.equal(f.pool.system.uses.value, 3);
  await f.service.commit(f.workflow);
  await f.service.complete(f.workflow);
  const receipt = f.service.get(f.workflow);
  assert.equal(receipt.state, "completed");
  assert.equal(receipt.mode, "collection");
  assert.equal(receipt.nativeDebit.owner, "native-activity");
  assert.equal(receipt.selected[0].identity, JSON.stringify([f.option.uuid, "metamagic", "distant-spell"]));
  assert.equal(JSON.stringify([f.original.system, f.original.flags, f.main.flags, f.option.flags]), before);
  assert.deepEqual(f.writes, []);
});

test("closing the Item-owned chooser preserves ordinary casting and never adds payment", async () => {
  const f = setup();
  f.setChooser(async () => null);
  assert.equal(await f.service.begin(f.workflow), true);
  assert.equal(f.service.get(f.workflow).state, "unmodified");
  assert.equal(f.activity.range.value, 30);
  assert.deepEqual(f.activity.consumption.targets, []);
  assert.equal(f.pool.system.uses.value, 4);
});

test("base with no learned or granted options opens no chooser", async () => {
  const f = setup();
  f.actor.items.delete(f.option.id);
  await f.service.begin(f.workflow);
  assert.equal(f.prompts.length, 0);
  assert.equal(f.service.get(f.workflow).state, "unmodified");
});

test("a missing option macro is explained as unavailable and cannot be forced into selection", async () => {
  const f = setup();
  delete f.option.flags.cat;
  f.setChooser(async request => {
    assert.equal(request.choices[0].disabled, true);
    assert.match(request.choices[0].detail, /Configure exactly one/);
    return "distant-spell";
  });
  await assert.rejects(f.service.begin(f.workflow), /Invalid modifier selection/);
  assert.equal(f.pool.system.uses.value, 4);
});

test("completed casts retain snapshot provenance after source removal and never request their own refund", async () => {
  const f = setup();
  await f.service.begin(f.workflow);
  f.consume();
  await f.service.commit(f.workflow);
  f.actor.items.delete(f.main.id);
  f.actor.items.delete(f.option.id);
  f.workflow.aborted = true;
  await f.service.complete(f.workflow);
  assert.equal(f.service.get(f.workflow).selected[0].sourceUuid, f.option.uuid);
  assert.equal(f.service.get(f.workflow).refundOwner, "native-activity");
  assert.equal(f.pool.system.uses.value, 3);
});

test("unaffordable, Self, Special and short ranges are disabled by the Item macro", async () => {
  for (const options of [{ available: 0 }, { range: { units: "self" } }, { range: { units: "spec" } }, { range: { value: 4, units: "ft" } }]) {
    const f = setup(options);
    f.setChooser(async request => { assert.equal(request.choices[0].disabled, true); return "__finish"; });
    assert.equal(await f.service.begin(f.workflow), true);
    assert.equal(f.service.get(f.workflow).state, "unmodified");
  }
});

test("declared price adjustments support a free Item-owned selection without a consumption target", async () => {
  const f = setup({ available: 0 });
  f.main.flags[scope].metamagic.declarations.push(copy(definitions.discount));
  assert.equal(await f.service.begin(f.workflow), true);
  assert.equal(f.service.get(f.workflow).totalCost, 0);
  assert.equal(f.consume(), 0);
  assert.equal(f.activity.consumption.targets.length, 0);
  assert.equal(f.pool.system.uses.value, 0);
});

test("stale option removal, base removal, price or grant source changes block before payment", async () => {
  for (const mode of ["option", "base", "price", "grant"]) {
    const f = setup();
    let ring;
    if (mode === "grant") {
      f.option.flags[scope].metamagic.declarations[0].acquisition = "grant-only";
      ring = f.add("ring", [definitions.ringGrant], { equipped: true, attuned: true });
    }
    f.setChooser(async () => {
      if (mode === "option") f.actor.items.delete(f.option.id);
      if (mode === "base") f.actor.items.delete(f.main.id);
      if (mode === "price") f.option.flags[scope].metamagic.declarations[0].cost = 2;
      if (mode === "grant") { f.actor.items.delete(ring.id); f.add("different-ring", [definitions.ringGrant], { equipped: true, attuned: true }); }
      return "distant-spell";
    });
    await assert.rejects(f.service.begin(f.workflow), /changed|review/, mode);
    assert.equal(f.activity.range.value, 30);
    assert.equal(f.pool.system.uses.value, 4);
  }
});

test("source replacement and lost capacity during the native dialog block the debit", async () => {
  for (const mode of ["option", "base", "capacity"]) {
    const f = setup();
    await f.service.begin(f.workflow);
    if (mode === "option") f.actor.items.delete(f.option.id);
    if (mode === "base") f.actor.items.delete(f.main.id);
    if (mode === "capacity") f.main.flags[scope].metamagic.declarations[0].optionChoices = 0;
    assert.equal(f.service.prepareConsumption(f.activity, { consume: false }), false, mode);
    assert.equal(f.pool.system.uses.value, 4, mode);
  }
});

test("concurrent lifecycle calls start the base broker and native transaction once", async () => {
  const f = setup();
  const results = await Promise.all([f.service.begin(f.workflow), f.service.begin(f.workflow)]);
  assert.deepEqual(results, [true, true]);
  assert.equal(f.calls.filter(call => call.kind === "broker").length, 1);
  assert.equal(f.prompts.length, 1);
  assert.equal(f.consume(), 1);
});

test("missing, duplicate, wrong-pass or unsupported broker macros produce explicit errors", async () => {
  for (const mode of ["missing", "duplicate", "pass", "interface"]) {
    const f = setup();
    if (mode === "missing") delete f.main.flags.cat;
    if (mode === "duplicate") f.main.flags.cat.embeddedMacros.push(copy(f.main.flags.cat.embeddedMacros[0]));
    if (mode === "pass") f.main.flags.cat.embeddedMacros[0].pass = "actorPreItemRoll";
    if (mode === "interface") f.main.flags[scope].metamagic.declarations[0].execution = { interface: "midi-on-use", name: "Other" };
    await assert.rejects(f.service.begin(f.workflow), /Configure exactly one|requires the CAT/, mode);
    assert.equal(f.activity.range.value, 30);
    assert.equal(f.pool.system.uses.value, 4);
  }
});

test("CAT-caught script failures and invalid/repeated responses cannot be treated as success", async () => {
  for (const script of ["throw new Error('failed');", "return true;",
    "data.respond(document, 'incorrect-name', true);",
    "data.respond(document, macroName, true); data.respond(document, macroName, true);"] ) {
    const f = setup();
    f.install(f.main, "Metamagic Broker", "broker", script);
    await assert.rejects(f.service.begin(f.workflow), /No unique response|did not complete/);
    assert.equal(f.pool.system.uses.value, 4);
  }
});

test("a broker that returns without awaiting its work cannot resume a rejected casting later", async () => {
  const f = setup();
  let release;
  f.workflow.chooserGate = new Promise(resolve => { release = resolve; });
  f.install(f.main, "Metamagic Broker", "broker", `
    data.context.workflow.pendingPreparation = data.context.begin(document, async () => {
      await data.context.workflow.chooserGate;
      return ["distant-spell"];
    });
    data.context.workflow.pendingPreparation.catch(() => {});
    return data.respond(document, macroName, true);
  `);
  await assert.rejects(f.service.begin(f.workflow), /did not complete/);
  release();
  await assert.rejects(f.workflow.pendingPreparation, /no longer active/);
  assert.equal(f.service.get(f.workflow).state, "rejected");
  assert.equal(f.activity.range.value, 30);
  assert.equal(f.pool.system.uses.value, 4);
});

test("additional option macros sharing a pass do not respond to another source request", async () => {
  const f = setup();
  const other = f.add("another-option", [{ ...copy(definitions.distant), id: "another-option" }]);
  f.install(other, "Distant Spell", "option", distant);
  await f.service.begin(f.workflow);
  assert.equal(f.service.get(f.workflow).selected.length, 1);
  assert.equal(f.service.get(f.workflow).selected[0].sourceUuid, f.option.uuid);
});

test("a new Item-defined option uses its own rules and cost without a runtime catalogue change", async () => {
  const f = setup();
  const declaration = f.option.flags[scope].metamagic.declarations[0];
  declaration.id = "another-modifier";
  declaration.cost = 2;
  declaration.rules.multiplier = 3;
  f.setChooser(async () => "another-modifier");
  await f.service.begin(f.workflow);
  assert.equal(f.activity.range.value, 90);
  assert.equal(f.service.get(f.workflow).selected[0].id, "another-modifier");
  assert.equal(f.consume(), 2);
});

test("the Item broker enforces combined affordability and the runtime rejects conflicting updates", async () => {
  for (const available of [1, 4]) {
    const f = setup({ available });
    const other = f.add("another-option", [{ ...copy(definitions.distant), id: "another-option" }]);
    const script = available === 1 ? distant.replace("{ activityUpdates: updates }", "{ activityUpdates: { 'duration.value': 2 } }") : distant;
    f.install(other, "Distant Spell", "option", script);
    f.main.flags[scope].metamagic.declarations.push(copy(definitions.combination));
    f.setChooser(async request => {
      const index = f.prompts.length;
      if (index === 2) assert.equal(request.choices[0].disabled, available === 1);
      return index === 1 ? "distant-spell" : "another-option";
    });
    await assert.rejects(f.service.begin(f.workflow), available === 1 ? /Combined option cost/ : /Conflicting/);
    assert.equal(f.pool.system.uses.value, available);
    assert.equal(f.activity.range.value, 30);
  }
});

test("point depletion during native configuration rejects the proposed debit", async () => {
  const f = setup();
  await f.service.begin(f.workflow);
  f.pool.system.uses.value = 0;
  assert.equal(f.service.prepareConsumption(f.activity, { consume: true }), false);
});

test("other clients and non-spells do not run the broker; canonical spell Items are protected", async () => {
  const f = setup();
  f.workflow.userId = "other-user";
  assert.equal(await f.service.begin(f.workflow), true);
  assert.deepEqual(f.calls, []);
  f.workflow.userId = "gm";
  f.activity.item = f.original;
  f.workflow.item = f.original;
  await assert.rejects(f.service.begin(f.workflow), /Casting-local/);
  assert.equal(f.pool.system.uses.value, 4);
});

test("family validation rejects unknown acquisition modes and standalone broker Macro UUIDs", () => {
  const f = setup();
  assert.equal(f.registry.validateRecord("metamagic", { ...definitions.distant, acquisition: "all-compendiums" }).valid, false);
  assert.equal(f.registry.validateRecord("metamagic", { ...definitions.base,
    execution: { interface: "cat-embedded", name: "Base", macroUuid: "Macro.world" } }).valid, false);
  assert.equal(f.declarations.read(f.main).records.length, 1);
});
