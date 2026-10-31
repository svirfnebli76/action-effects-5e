import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers/metamagic-fixtures.mjs";
import { validateSpellPropertyUpdate, spellPropertyUpdateMatches } from "../scripts/metamagic/casting-item-properties.js";

const PROPERTIES = ["vocal", "somatic", "material", "concentration", "ritual"];

function componentCasting(after, before = PROPERTIES) {
  const f = setup({ sourceBacked: true, spellProperties: before });
  f.option.flags.cat.embeddedMacros[0].macros[0].macro = `
if (data?.phase === "offer") return data.respond(document, macroName, { eligible: true });
if (data?.phase === "prepare") return data.respond(document, macroName, {
  itemUpdates: { "system.properties": ${JSON.stringify(after)} }
});
`;
  return f;
}

test("casting-local spell component removal preserves source, noncomponents, derived magic and native debit", async () => {
  const expected = ["material", "concentration", "ritual"];
  const f = componentCasting(expected);
  const original = [...f.original.system.properties];
  assert.equal(await f.service.begin(f.workflow), true);
  assert.deepEqual(f.original.system.properties, original);
  assert.deepEqual(f.workflow.activity.item._source.system.properties, expected);
  assert.deepEqual([...f.workflow.activity.item.system.properties], [...expected, "mgc"]);
  assert.equal(f.pool.system.uses.value, 4, "selection must not debit");
  assert.equal(f.consume(), 1, "native activity must debit exactly once");
  assert.equal(f.pool.system.uses.value, 3);
  assert.deepEqual(f.original.system.properties, original, "canonical source must remain unchanged");
  assert.deepEqual(f.activityClone().item._source.system.properties, original,
    "later ordinary casting must use original components");
});

test("no-op spell property update is allowed for options applicable without removable components", async () => {
  const f = componentCasting(["concentration"], ["concentration"]);
  assert.equal(await f.service.begin(f.workflow), true);
  assert.deepEqual(f.workflow.activity.item._source.system.properties, ["concentration"]);
  assert.equal(f.consume(), 1);
});

for (const [name, requested] of [
  ["unrelated property removal", ["vocal", "somatic", "material", "ritual"]],
  ["unrelated property insertion", [...PROPERTIES, "new-property"]],
  ["duplicate properties", ["material", "material", "concentration", "ritual"]],
  ["arbitrary reordering", ["somatic", "vocal", "material", "concentration", "ritual"]]
]) {
  test(`untrusted option cannot modify spell properties: ${name}`, async () => {
    const f = componentCasting(requested);
    await assert.rejects(f.service.begin(f.workflow), /spell propert|component|properties|property/i);
    assert.equal(f.pool.system.uses.value, 4);
    assert.deepEqual(f.original.system.properties, PROPERTIES);
  });
}

test("tampered live spell properties fail before native payment", async () => {
  const f = componentCasting(["material", "concentration", "ritual"]);
  assert.equal(await f.service.begin(f.workflow), true);
  assert.equal(f.service.prepareNative(f.activity), true);
  assert.equal(f.service.prepareConsumption(f.activity, { consume: true }), true);
  f.activity.item.system.properties.add("unexpected");
  const updates = { item: [{ _id: f.pool.id, "system.uses.spent": f.pool.system.uses.spent + 1 }], delete: [] };
  assert.equal(f.service.validateConsumption(f.activity, updates), false);
  assert.equal(f.pool.system.uses.value, 4);
});

test("generic component property helper enforces remove-only and normalizes prepared Sets", () => {
  const source = { type: "spell", _source: { system: { properties: PROPERTIES } } };
  assert.equal(validateSpellPropertyUpdate(source, ["material", "concentration", "ritual"]), true);
  assert.throws(() => validateSpellPropertyUpdate(source, ["material", "ritual"]), /only remove/);
  assert.equal(spellPropertyUpdateMatches({
    _source: { system: { properties: ["material", "concentration", "ritual"] } },
    system: { properties: new Set(["material", "concentration", "ritual", "mgc"]) }
  }, ["material", "concentration", "ritual"]), true);
});
