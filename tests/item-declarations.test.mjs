import test from "node:test";
import assert from "node:assert/strict";
import { fixture, envelope, option } from "./helpers/declaration-fixtures.mjs";
import { parseDeclarationJson } from "../scripts/declarations/json-data.js";

test("registry rejects duplicate families/storage and freezes schema/template ownership", () => {
  const { registry } = fixture();
  const definition = { id: "other", label: "Other", flagPath: "flags.action-effects-5e.future", schema: {}, validate: () => [] };
  assert.throws(() => registry.register(definition), /already registered/);
  assert.throws(() => registry.register({ ...definition, flagPath: "flags.someone.other" }), /dedicated AE5E flag/);
  assert.throws(() => registry.get("metamagic").templates[0].record.id = "changed", TypeError);
  registry.registerConsumer("future", "test", (entries, context) => ({ entries, context }));
  assert.deepEqual(registry.consume("future", "test", [{ family: "future" }, { family: "metamagic" }], 42), { entries: [{ family: "future" }], context: 42 });
});

test("zero/one/many collections and families preserve complete source identity", () => {
  const { item, collections } = fixture();
  assert.equal(collections.discover([item]).entries.length, 0);
  item.flags["action-effects-5e"].metamagic = envelope([option()]);
  assert.equal(collections.discover([item]).entries.length, 1);
  item.flags["action-effects-5e"].metamagic.declarations.push(option("second"));
  item.flags["action-effects-5e"].future = envelope([{ id: "distance" }, { id: "more" }]);
  const entries = collections.discover([item, item]).entries;
  assert.equal(entries.length, 4);
  assert.equal(new Set(entries.map(entry => entry.identity)).size, 4);
  assert.equal(entries[0].sourceItemUuid, item.uuid);
  assert.deepEqual(JSON.parse(entries[0].identity), [item.uuid, "metamagic", "distance"]);
});

test("bad/duplicate records reject a collection; unknown families remain untouched", () => {
  const { item, collections } = fixture();
  item.flags["action-effects-5e"].metamagic = envelope([option(), option()]);
  item.flags["action-effects-5e"].unknown = envelope([{ id: "untouched" }]);
  const before = JSON.stringify(item);
  const result = collections.discover([item]);
  assert.equal(result.entries.length, 0);
  assert.match(result.diagnostics.map(entry => entry.message).join(" "), /duplicate declaration id.*Unknown declaration family/);
  assert.equal(JSON.stringify(item), before);
  for (const record of [null, { ...option(), enabled: true }, { ...option(), family: "future" },
    { ...option(), execution: { macroUuid: "Macro.old" } }]) {
    item.flags["action-effects-5e"].metamagic = envelope([record]);
    assert.equal(collections.read(item, "metamagic").valid, false);
  }
});

test("all duplicate JSON keys, including escaped keys and nested objects, are rejected", () => {
  for (const text of ['{"id":"a","id":"b"}', '{"id":"a","\\u0069d":"b"}',
    '{"id":"a","settings":{"x":1,"x":2}}', '{"id":"a","array":[{"x":1,"x":2}]}', '{"__proto__":{}}']) {
    assert.equal(parseDeclarationJson(text).valid, false, text);
  }
  assert.equal(parseDeclarationJson('{"id":"a","condition":"hasItem(actorUuid, \\"kit\\")","settings":{},"list":[]}').valid, true);
});

test("activation and conditions reuse AC5E with declaration provenance", () => {
  const calls = [];
  const { item, collections } = fixture({ ac5e: { evaluateCondition(request) { calls.push(request); return { ok: true, eligible: false }; } } });
  item.flags["action-effects-5e"].future = envelope([{ id: "gear", activation: { equipped: true, attuned: true }, condition: 'hasItem(actorUuid, "kit")' }]);
  let entry = collections.discover([item]).entries[0];
  assert.equal(collections.evaluate(entry, { subjectToken: "source", context: { transactionId: "cast" } }).eligible, false);
  assert.equal(calls[0].expression, entry.declaration.condition);
  assert.equal(calls[0].context.declarationIdentity, entry.identity);
  assert.equal(calls[0].context.transactionId, "cast");
  item.system.attuned = false;
  entry = collections.discover([item]).entries[0];
  assert.equal(collections.evaluate(entry).reason, "activation-requirements");
  assert.equal(calls.length, 1);
});

test("multiple grants produce one option with all origins; competing definitions are diagnosed", () => {
  const { item, collections } = fixture();
  item.flags["action-effects-5e"].future = envelope([{ id: "definition" }, { id: "learned" }, { id: "ring" }]);
  const [definition, learned, ring] = collections.discover([item]).entries;
  const grants = [{ key: "choice", entry: learned, kind: "learned" }, { key: "choice", entry: ring, kind: "granted" }];
  const request = { definitions: [{ key: "choice", entry: definition }], grants: [...grants, grants[0]] };
  const resolved = collections.resolveGrants(request);
  assert.equal(resolved.options.length, 1);
  assert.equal(resolved.options[0].provenance.length, 2);
  assert.equal(resolved.options[0].provenance[1].declarationId, "ring");
  request.definitions.push({ key: "choice", entry: learned });
  assert.equal(collections.resolveGrants(request).options.length, 0);
  assert.match(collections.resolveGrants(request).diagnostics[0].message, /ambiguous/);
});

test("legacy singleton is preserved; explicit registered migration produces a review draft only", () => {
  const { item, collections, registry, writes } = fixture();
  item.flags["action-effects-5e"].metamagic = { ...option(), version: 1, family: "metamagic", enabled: true };
  const before = JSON.stringify(item);
  assert.equal(collections.read(item, "metamagic").blocked, true);
  assert.throws(() => collections.migrate(item, "metamagic"), /No explicit migration/);
  registry.register({ id: "migratable", label: "Migration test", flagPath: "flags.action-effects-5e.migratable", schema: {},
    validate: () => [], migrate: old => envelope([{ id: old.id }]) });
  item.flags["action-effects-5e"].migratable = { id: "old" };
  assert.deepEqual(collections.migrate(item, "migratable"), envelope([{ id: "old" }]));
  delete item.flags["action-effects-5e"].migratable;
  assert.equal(JSON.stringify(item), before);
  assert.equal(writes.length, 0);
});
