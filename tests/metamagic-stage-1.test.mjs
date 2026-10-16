import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { MetamagicDeclarationService } from "../scripts/metamagic/declaration-service.js";
import { MetamagicCastingService } from "../scripts/metamagic/casting-service.js";
import { distantSpell } from "../examples/metamagic-stage-1/distant-spell.mjs";

const scope = "action-effects-5e";
const examples = JSON.parse(fs.readFileSync(new URL("../examples/metamagic-stage-1/declarations.json", import.meta.url)));
const copy = value => structuredClone(value);
let counter = 0;
globalThis.foundry = { utils: { randomID: () => `cast${++counter}`, deepClone: copy } };
globalThis.game = { user: { id: "gm", isGM: true }, settings: { get: () => false } };
globalThis.ui = { notifications: { error() {} } };

class Collection extends Map {
  [Symbol.iterator]() { return this.values(); }
}
function setPath(object, path, value) {
  const keys = path.split(".");
  const leaf = keys.pop();
  for (const key of keys) object = object[key] ??= {};
  object[leaf] = copy(value);
}
function item(actor, id, declaration, system = {}) {
  const result = { id, uuid: `${actor.uuid}.Item.${id}`, name: id, type: "feat", actor,
    system, flags: declaration ? { [scope]: { metamagic: copy(declaration) } } : {},
    async update(updates) { for (const [path, value] of Object.entries(updates)) setPath(this, path, value); } };
  actor.items.set(id, result);
  return result;
}

function setup({ range = { value: 30, units: "ft", override: false }, available = 4, resolve = null, sourceBacked = false } = {}) {
  const actor = { uuid: "Actor.caster", isOwner: true, items: new Collection() };
  const main = item(actor, "main", examples.main);
  const option = item(actor, "option", examples.distant);
  const pool = item(actor, "pool", null, { identifier: "sorcery-points", uses: { spent: 7 - available, max: 7, value: available } });
  const original = item(actor, "spell", null, { range: copy(range) });
  original.type = "spell";
  function activityClone(from = null) {
    if (sourceBacked) {
      // Native use/scaling works from the parent Item source, not detached live Activity fields.
      const data = copy(from?.item._source ?? { flags: original.flags, system: { range,
        activities: { activity: { range, consumption: { targets: [] } } } } });
      const spell = { id: original.id, uuid: original.uuid, actor, type: "spell", _source: data,
        updateSource(updates) {
          for (const [path, value] of Object.entries(updates)) setPath(data, path, value);
          hydrateItem();
        }, prepareFinalAttributes() {
          for (const activity of this.system.activities) activity.prepareFinalData();
        } };
      const hydrateItem = () => {
        spell.flags = copy(data.flags);
        spell.system = { range: copy(data.system.range), activities: new Collection() };
        for (const [id, raw] of Object.entries(data.system.activities)) {
          // D&D5e RangeField.value is a FormulaField (a StringField), then
          // prepareFinalData evaluates it to the live numeric distance.
          if (raw.range.value != null) raw.range.value = String(raw.range.value);
          const source = copy(raw);
          const activity = { id, actor, item: spell, _source: source,
            updateSource(updates) {
              for (const [path, value] of Object.entries(updates)) setPath(source, path, value);
              if (source.range.value != null) source.range.value = String(source.range.value);
              hydrateActivity();
            }, prepareFinalData() {
              hydrateActivity();
              if (["ft", "mi", "m", "km"].includes(this.range.units)) this.range.value = Number(this.range.value);
              else this.range.value = null;
            } };
          const hydrateActivity = () => {
            activity.range = copy(source.range.override ? source.range : { ...spell.system.range, override: false });
            activity.consumption = copy(source.consumption);
          };
          hydrateActivity();
          spell.system.activities.set(id, activity);
        }
      };
      hydrateItem();
      spell.prepareFinalAttributes();
      return spell.system.activities.get("activity");
    }
    const spell = { id: original.id, uuid: original.uuid, actor, type: "spell", flags: copy(from?.item.flags ?? original.flags),
      updateSource(updates) { for (const [path, value] of Object.entries(updates)) setPath(this, path, value); } };
    return { id: "activity", actor, item: spell, range: copy(from?.range ?? range),
      consumption: copy(from?.consumption ?? { targets: [] }),
      updateSource(updates) { for (const [path, value] of Object.entries(updates)) setPath(this, path, value); } };
  }
  const activity = activityClone();
  const workflow = { id: "Activity.mutable", actor, item: activity.item, activity, userId: null,
    token: { document: { uuid: "Scene.scene.Token.caster" } }, targets: new Set() };
  const declarations = new MetamagicDeclarationService();
  const cards = [];
  const service = new MetamagicCastingService({ declarations, prompts: { choose: async () => null },
    cards: { async upsertContribution(subject, contribution) { cards.push(copy(contribution)); return { updated: true }; } },
    resolve: resolve ?? (async () => ({ documentName: "Macro", type: "script", canExecute: true, execute: distantSpell })) });
  return { actor, main, option, pool, original, workflow, declarations, service, activityClone, cards };
}

const chooseDistant = async () => ["distant-spell"];

// This models the native target->proposed update->delta contract. It is not a live Foundry test.
function nativeConsumption(fixture, activity, usage = { consume: false }) {
  const { service, pool } = fixture;
  assert.equal(service.prepareNative(activity), true);
  assert.equal(service.prepareConsumption(activity, usage), true);
  const updates = { item: [], delete: [] };
  const charge = activity.consumption.targets[usage.consume.resources[0]];
  if (charge) updates.item.push({ _id: pool.id, "system.uses.spent": pool.system.uses.spent + Number(charge.value) });
  assert.equal(service.validateConsumption(activity, updates), true);
  const delta = charge ? Number(charge.value) : 0;
  pool.system.uses.spent += delta;
  pool.system.uses.value -= delta;
  const message = { data: { system: { deltas: { item: { [pool.id]: [{ keyPath: "system.uses.spent", delta }] } } } } };
  service.recordConsumption(activity, message);
  return { updates, message, delta, usage };
}

test("all five required declarations validate, including equipment and combination providers", () => {
  const f = setup();
  for (const declaration of Object.values(examples)) assert.deepEqual(f.declarations.read({ flags: { [scope]: { metamagic: declaration } } }).errors, []);
  const result = f.declarations.compile(f.actor);
  assert.equal(result.ready, true);
  assert.equal(result.resourceUuid, f.pool.uuid);
  assert.equal(result.options[0].cost, 1);
  assert.deepEqual(result.options[0].provenance, [{ kind: "learned", sourceUuid: f.main.uuid }]);
});

test("grant activation and removal reconcile without changing embedded identities", async () => {
  const f = setup();
  await f.declarations.learn(f.actor, []);
  const ring = item(f.actor, "ring", examples.ringGrantingDistant, { equipped: true, attuned: true });
  assert.equal(f.declarations.compile(f.actor).options[0].provenance[0].kind, "granted");
  ring.system.attuned = false;
  assert.equal(f.declarations.compile(f.actor).options.length, 0);
  ring.system.attuned = true;
  f.actor.items.delete(ring.id);
  assert.equal(f.declarations.compile(f.actor).options.length, 0);
  assert.equal(f.actor.items.get("option"), f.option);
  assert.equal(f.actor.items.get("pool"), f.pool);
});

test("choice capacity, combinations and zero-cost explanations remain declaration-owned", () => {
  const f = setup();
  item(f.actor, "choice", examples.ringAddingChoice, { equipped: true, attuned: true });
  item(f.actor, "two", examples.featureAllowingTwo);
  item(f.actor, "discount", { ...examples.costAdjustmentExample, enabled: true });
  const result = f.declarations.compile(f.actor);
  assert.equal(result.optionChoices, 3);
  assert.equal(result.selectionLimit, 2);
  assert.equal(result.options[0].cost, 0);
  assert.equal(result.options[0].adjustments[0].label, "Example one-point reduction");
});

test("ambiguous pools and duplicate option definitions never silently choose one", () => {
  const f = setup();
  item(f.actor, "otherpool", null, { identifier: "sorcery-points" });
  assert.equal(f.declarations.compile(f.actor).ready, false);
  f.main.flags[scope].metamagic.resource.itemId = f.pool.id;
  assert.equal(f.declarations.compile(f.actor).ready, true);
  item(f.actor, "otheroption", examples.distant);
  assert.equal(f.declarations.compile(f.actor).options.length, 0);
});

test("unknown schemas and malformed prices or limits are rejected", () => {
  const f = setup();
  for (const declaration of [{ ...examples.distant, version: 2 }, { ...examples.distant, cost: -1 },
    { ...examples.main, selectionLimit: 0 }, { ...examples.main, learnedOptions: ["distant-spell", "distant-spell"] },
    { ...examples.ringGrantingDistant, activation: { attuned: "yes" } }]) {
    assert.equal(f.declarations.read({ flags: { [scope]: { metamagic: declaration } } }).declaration, null);
  }
});

test("learn/unlearn preserves Item IDs and rejects missing definitions or capacity overflow", async () => {
  const f = setup();
  await assert.rejects(f.declarations.learn(f.actor, ["missing"]), /active definition/);
  await assert.rejects(f.declarations.learn(f.actor, ["a", "b", "c"]), /capacity/);
  await f.declarations.learn(f.actor, []);
  await f.declarations.learn(f.actor, ["distant-spell"]);
  assert.equal(f.actor.items.get("main"), f.main);
  assert.equal(f.actor.items.size, 4);
});

test("numeric Distant selection, one native debit, stable casting identity and receipt", async () => {
  const f = setup();
  const source = JSON.stringify({ flags: f.original.flags, system: f.original.system });
  await f.service.begin(f.workflow, { chooser: chooseDistant });
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
  await f.service.begin(f.workflow, { chooser: chooseDistant });
  assert.equal(f.workflow.activity.range.units, "ft");
  assert.equal(f.workflow.activity.range.value, 30);
  const later = { ...f.workflow, activity: f.activityClone() };
  later.item = later.activity.item;
  await f.service.begin(later, { chooser: async () => [] });
  assert.equal(later.activity.range.units, "touch");
  assert.equal(f.pool.system.uses.value, 4);
});

test("native pre-write veto/cancel leaves pool intact, native deltas own post-card refund", async () => {
  const f = setup();
  await f.service.begin(f.workflow, { chooser: chooseDistant });
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
  await f.service.begin(f.workflow, { chooser: async () => [] });
  assert.equal(f.workflow.activity.range.value, 30);
  f.actor.items.delete("main");
  await f.service.begin({ ...f.workflow, activity: f.activityClone() });
  assert.equal(f.pool.system.uses.value, 4);
});

test("unaffordable or ineligible offers explain why and cannot be forced into selection", async () => {
  const f = setup({ available: 0 });
  await assert.rejects(f.service.begin(f.workflow, { chooser: async ({ offers }) => {
    assert.match(offers[0].reason, /Not enough/);
    assert.equal(offers[0].disabled, true);
    return ["distant-spell"];
  } }), /Invalid modifier/);
  const self = setup({ range: { units: "self", value: null } });
  await assert.rejects(self.service.begin(self.workflow, { chooser: chooseDistant }), /Invalid modifier/);
});

test("source documents and other coordinator calls cannot be mutated", async () => {
  const f = setup();
  const result = await f.service.begin(f.workflow, { initiatorUserId: "other", chooser: chooseDistant });
  assert.equal(result, true);
  assert.equal(f.service.get(f.workflow), null);
  f.workflow.activity.item = f.original;
  f.original.updateSource = () => assert.fail("canonical source mutation");
  await assert.rejects(f.service.begin(f.workflow, { chooser: chooseDistant }), /Casting-local/);
});

test("ownership and ambiguous continuation are rejected without consumption", async () => {
  const f = setup();
  f.actor.isOwner = false;
  await assert.rejects(f.service.begin(f.workflow, { chooser: chooseDistant }), /own/);
  f.actor.isOwner = true;
  await assert.rejects(f.service.begin(f.workflow, { parentCastingId: "arbitrary" }), /Continuation/);
  assert.equal(f.pool.system.uses.value, 4);
});

test("grant changes or resource depletion during selection are revalidated", async () => {
  const f = setup();
  await assert.rejects(f.service.begin(f.workflow, { chooser: async () => {
    f.main.flags[scope].metamagic.learnedOptions = [];
    return ["distant-spell"];
  } }), /option changed/);
  assert.equal(f.workflow.activity.range.value, 30);
  const g = setup();
  await g.service.begin(g.workflow, { chooser: chooseDistant });
  g.pool.system.uses.value = 0;
  const native = g.activityClone(g.workflow.activity);
  assert.equal(g.service.prepareConsumption(native, { consume: true }), false);
});

test("same resource in base or linked consumption requires explicit adapter", async () => {
  for (const linked of [false, true]) {
    const f = setup();
    await f.service.begin(f.workflow, { chooser: chooseDistant });
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
  await f.service.begin(f.workflow, { chooser: chooseDistant });
  const native = f.activityClone(f.workflow.activity);
  f.service.prepareConsumption(native, { consume: true });
  assert.equal(f.service.validateConsumption(native, { item: [], delete: [] }), false);
  assert.equal(f.service.validateConsumption(native, { item: [{ _id: "pool", "system.uses.spent": 99 }], delete: [] }), false);
});

test("a new Item-declared option is discovered and executed without a runtime catalogue edit", async () => {
  const calls = [];
  const f = setup({ resolve: async uuid => ({ documentName: "Macro", type: "script", execute: async ({ phase }) => {
    calls.push({ uuid, phase });
    return phase === "offer" ? { eligible: true } : { activityUpdates: { "range.override": true, "range.value": 90 } };
  } }) });
  const declaration = { ...copy(examples.distant), id: "new-declared-option", cost: 2, execution: { macroUuid: "Macro.new" } };
  item(f.actor, "new", declaration);
  await f.declarations.learn(f.actor, ["new-declared-option"]);
  await f.service.begin(f.workflow, { chooser: async () => ["new-declared-option"] });
  assert.equal(f.workflow.activity.range.value, 90);
  assert.equal(f.service.get(f.workflow).totalCost, 2);
  assert.equal(calls.at(-1).uuid, "Macro.new");
});

test("combination limits and aggregate affordability are enforced", async () => {
  const make = available => {
    const f = setup({ available });
    item(f.actor, "new", { ...copy(examples.distant), id: "second-option" });
    f.main.flags[scope].metamagic.learnedOptions.push("second-option");
    return f;
  };
  const f = make(4);
  await assert.rejects(f.service.begin(f.workflow, { chooser: async () => ["distant-spell", "second-option"] }), /Invalid modifier/);
  const g = make(1);
  item(g.actor, "two", examples.featureAllowingTwo);
  // Non-conflicting Item executables isolate aggregate payment from range-update conflicts.
  g.option.flags[scope].metamagic.execution.macroUuid = "Macro.first";
  const h = new MetamagicCastingService({ declarations: g.declarations, resolve: async uuid => ({ documentName: "Macro", type: "script",
    execute: async ({ phase }) => phase === "offer" ? { eligible: true } : { activityUpdates: { [uuid === "Macro.first" ? "range.value" : "range.units"]: uuid === "Macro.first" ? 60 : "ft" } } }) });
  await assert.rejects(h.begin(g.workflow, { chooser: async () => ["distant-spell", "second-option"] }), /Combined option cost/);
  assert.equal(g.pool.system.uses.value, 1);
});

test("concurrent duplicate entry hooks share one selection and one casting id", async () => {
  const f = setup();
  let calls = 0;
  const chooser = async () => { calls++; return ["distant-spell"]; };
  await Promise.all([f.service.begin(f.workflow, { chooser }), f.service.begin(f.workflow, { chooser })]);
  assert.equal(calls, 1);
});

test("misses, successful saves and late aborted flags do not trigger refunds", async () => {
  const f = setup();
  await f.service.begin(f.workflow, { chooser: chooseDistant });
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
  await f.service.begin(f.workflow, { chooser: chooseDistant });
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

test("disabled main declaration leaves ordinary casting untouched", async () => {
  const f = setup();
  f.main.flags[scope].metamagic.enabled = false;
  await f.service.begin(f.workflow, { chooser: () => assert.fail("disabled main offered a choice") });
  assert.equal(f.service.get(f.workflow), null);
});

test("native consumption target cannot be deselected in the spell configuration", async () => {
  const f = setup();
  await f.service.begin(f.workflow, { chooser: chooseDistant });
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
  item(f.actor, "discount", { ...copy(examples.costAdjustmentExample), enabled: true });
  await f.service.begin(f.workflow, { chooser: chooseDistant });
  const native = f.activityClone(f.workflow.activity);
  assert.equal(f.service.prepareConsumption(native, { consume: false }), true);
  assert.equal(native.consumption.targets.length, 0);
  assert.equal(f.service.validateConsumption(native, { item: [], delete: [] }), true);
  f.service.recordConsumption(native, { data: {} });
  assert.equal(await f.service.commit(f.workflow), true);
  assert.equal(f.service.get(f.workflow).totalCost, 0);
  assert.equal(f.pool.system.uses.value, 0);
});

test("world Macro command forwards the Item rule scope and handles numerical units", async () => {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const command = new AsyncFunction("scope", `return await (${distantSpell.toString()})(scope);`);
  for (const [units, value, expected] of [["ft", 5, 10], ["m", 3, 6], ["mi", 1, 2], ["km", 1, 2]]) {
    const result = await command({ phase: "prepare", declaration: copy(examples.distant), context: { activity: { range: { units, value } } } });
    assert.equal(result.activityUpdates["range.value"], expected);
  }
  const result = await command({ phase: "offer", declaration: copy(examples.distant), context: { activity: { range: { units: "ft", value: 4 } } } });
  assert.equal(result.eligible, false);
});

test("cast snapshot survives option deletion and presentation failure cannot undo a cast", async () => {
  const f = setup();
  const service = new MetamagicCastingService({ declarations: f.declarations,
    resolve: async () => ({ documentName: "Macro", type: "script", execute: distantSpell }),
    cards: { upsertContribution: async () => { throw new Error("card unavailable"); } } });
  await service.begin(f.workflow, { chooser: chooseDistant });
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
    await f.service.begin(f.workflow, { chooser: chooseDistant });
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
  await f.service.begin(f.workflow, { chooser: chooseDistant });
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
  await f.service.begin(f.workflow, { chooser: chooseDistant });
  f.main.flags[scope].metamagic.learnedOptions = [];
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
  await f.service.begin(f.workflow, { chooser: chooseDistant });
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
  await f.service.begin(f.workflow, { chooser: chooseDistant });
  const native = f.activityClone(f.workflow.activity);
  assert.equal(native.range.units, "ft");
  assert.equal(native.range.value, 30);
  assert.equal(native.range.override, true);
  assert.equal(f.original.system.range.units, "touch");
});

test("casting-local Item preparation restores the native Actor flag even on failure", async () => {
  const f = setup({ sourceBacked: true });
  f.actor._embeddedPreparation = false;
  let prepared = 0;
  const originalPrepare = f.workflow.activity.item.prepareFinalAttributes.bind(f.workflow.activity.item);
  f.workflow.activity.item.prepareFinalAttributes = () => { prepared++; originalPrepare(); };
  await f.service.begin(f.workflow, { chooser: chooseDistant });
  assert.equal(f.actor._embeddedPreparation, false);
  assert.equal(prepared, 1);
  const g = setup();
  g.workflow.activity.item.updateSource = () => { assert.equal(g.actor._embeddedPreparation, true); throw new Error("rejected source update"); };
  await assert.rejects(g.service.begin(g.workflow, { chooser: chooseDistant }), /rejected source update/);
  assert.equal(Object.hasOwn(g.actor, "_embeddedPreparation"), false);
  assert.equal(g.pool.system.uses.value, 4);
});

test("lost Activity range rejects the native payment plan and remains visible in diagnostics", async () => {
  const f = setup();
  await f.service.begin(f.workflow, { chooser: chooseDistant });
  const native = f.activityClone(f.workflow.activity);
  f.service.prepareConsumption(native, { consume: true });
  native.range.value = 30;
  assert.equal(f.service.validateConsumption(native, { item: [{ _id: "pool", "system.uses.spent": 4 }], delete: [] }), false);
  const report = f.service.recent()[0];
  assert.equal(report.runtimeRevision, "activity-source-bridge-2");
  assert.equal(report.activityChecks.at(-1).receiver["range.value"], 30);
  assert.equal(report.activityChecks.at(-1).expected["range.value"], 60);
  assert.equal(f.pool.system.uses.value, 4);
});

test("native FormulaField source remains a string while original and rebuilt receivers are numeric", async () => {
  const f = setup({ sourceBacked: true });
  await f.service.begin(f.workflow, { chooser: chooseDistant });
  const snapshot = f.service.get(f.workflow).activityChecks.at(-1);
  assert.equal(snapshot.parentSource["range.value"], "60");
  for (const key of ["receiver", "prepared", "workflow"]) assert.equal(snapshot[key]["range.value"], 60, key);
  assert.equal(f.workflow.activity.item._source.system.activities.activity.range.value, "60");
  assert.equal(f.pool.system.uses.value, 4, "preparation does not spend points");
  assert.equal(f.original.system.range.value, 30);
});
