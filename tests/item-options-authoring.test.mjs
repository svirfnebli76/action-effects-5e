import test from "node:test";
import assert from "node:assert/strict";
import { fixture, envelope, option } from "./helpers/declaration-fixtures.mjs";

test("opening/canceling creates nothing; rows keep independent drafts and duplicate requires a fresh id", () => {
  const { authoring, item, writes } = fixture();
  const before = JSON.stringify(item);
  const draft = authoring.createDraft(item);
  const first = draft.add("future", "first", "example");
  draft.edit("future", first.key, '{"id":"first","settings":{"draft":true}}');
  const second = draft.add("future", "second", "example");
  assert.equal(JSON.parse(first.text).settings.draft, true);
  assert.notEqual(first.key, second.key);
  assert.throws(() => draft.duplicate("future", first.key, "second"), /unique/);
  const copy = draft.duplicate("future", first.key, "copy");
  assert.equal(JSON.parse(copy.text).settings.draft, true);
  assert.equal(JSON.stringify(item), before);
  assert.equal(writes.length, 0);
});

test("Save All validates all rows then writes arrays once, preserving unrelated flags, CAT preferences, envelope extras and unknown families", async () => {
  const { authoring, item, writes } = fixture();
  item.flags["action-effects-5e"].metamagic = { ...envelope([option()]), extra: "keep" };
  item.flags["action-effects-5e"].unknown = envelope([{ id: "keep" }]);
  const draft = authoring.createDraft(item);
  const row = draft.add("future", "one", "example");
  draft.edit("future", row.key, '{"id":"one","enabled":true}');
  await assert.rejects(() => authoring.save(draft), /future\/one.*enabled/);
  assert.equal(writes.length, 0);
  draft.edit("future", row.key, '{"id":"one","extra":{"keep":1}}');
  draft.configurationText = '{"choice":{"type":"checkbox","default":true}}';
  const saved = await authoring.save(draft);
  assert.equal(saved.changed, true);
  assert.equal(writes.length, 1);
  assert.deepEqual(item.flags["action-effects-5e"].future.declarations, [{ id: "one", extra: { keep: 1 } }]);
  assert.equal(item.flags["action-effects-5e"].metamagic.extra, "keep");
  assert.equal(item.flags["action-effects-5e"].unknown.declarations[0].id, "keep");
  assert.equal(item.flags["action-effects-5e"].unrelated.keep, true);
  assert.equal(item.flags.cat.config.choice, false);
  assert.equal(item.flags["action-effects-5e"].cat.configSchema.choice.default, true);
});

test("duplicate ids and malformed unselected records prevent any write, with family/id errors", async () => {
  const { authoring, item, writes } = fixture();
  const draft = authoring.createDraft(item);
  const first = draft.add("future", "first", "example");
  const second = draft.add("future", "second", "example");
  draft.edit("future", second.key, '{"id":"first"}');
  await assert.rejects(() => authoring.save(draft), /future\/first.*Duplicate/);
  draft.edit("future", second.key, '{"id":"broken",');
  await assert.rejects(() => authoring.save(draft), /future\/row 2.*Invalid JSON/);
  draft.edit("future", first.key, '{"id":"first","id":"changed"}');
  assert.match(draft.validate().issues.join(" "), /Duplicate JSON key/);
  assert.equal(writes.length, 0);
});

test("remove deletes one record; removing the last stores an empty versioned collection", async () => {
  const { authoring, item } = fixture();
  item.flags["action-effects-5e"].future = envelope([{ id: "one" }, { id: "two" }]);
  let draft = authoring.createDraft(item);
  draft.remove("future", draft.group("future").rows[0].key);
  await authoring.save(draft);
  assert.deepEqual(item.flags["action-effects-5e"].future, envelope([{ id: "two" }]));
  draft = authoring.createDraft(item);
  draft.remove("future", draft.group("future").rows[0].key);
  await authoring.save(draft);
  assert.deepEqual(item.flags["action-effects-5e"].future, envelope([]));
});

test("legacy declarations stay read-only and survive a CAT-only save", async () => {
  const { authoring, item } = fixture();
  const legacy = { version: 1, family: "metamagic", type: "main", id: "old", enabled: true };
  item.flags["action-effects-5e"].metamagic = legacy;
  const draft = authoring.createDraft(item);
  assert.throws(() => draft.add("metamagic", "new", "main"), /explicit migration/);
  draft.configurationText = '{"choice":{"type":"checkbox","default":true}}';
  await authoring.save(draft);
  assert.deepEqual(item.flags["action-effects-5e"].metamagic, legacy);
});

test("CAT edits remove deleted controls and descriptor fields under Foundry object merging", async () => {
  const { authoring, item } = fixture();
  item.flags["action-effects-5e"].cat = { other: "keep", configSchema: {
    retained: { type: "checkbox", default: true, hint: "remove this" },
    removed: { type: "text", default: "old" }
  } };
  let draft = authoring.createDraft(item);
  draft.configurationText = '{"retained":{"type":"checkbox","default":false}}';
  await authoring.save(draft);
  assert.deepEqual(item.flags["action-effects-5e"].cat.configSchema, { retained: { type: "checkbox", default: false } });
  draft = authoring.createDraft(item);
  draft.configurationText = "{}";
  await authoring.save(draft);
  assert.equal(item.flags["action-effects-5e"].cat.configSchema, undefined);
  assert.equal(item.flags["action-effects-5e"].cat.other, "keep");
});

test("authoring is GM-only, supports world/owned Items and excludes third-party/admin packs", () => {
  for (const pack of [null, "action-effects-5e.class-features"]) assert.equal(fixture({ pack }).authoring.canEdit(fixture({ pack }).item), true);
  for (const pack of ["dnd5e.items", "action-effects-5e.ae5e-administrative"]) {
    const { authoring, item } = fixture({ pack });
    assert.throws(() => authoring.createDraft(item), /approved AE5E/);
  }
  const { authoring, item } = fixture({ isGM: false });
  assert.throws(() => authoring.createDraft(item), /requires a GM/);
});

test("concurrent family edits cannot be overwritten; unrelated changes survive", async () => {
  const { authoring, item, writes } = fixture();
  const draft = authoring.createDraft(item);
  draft.add("future", "new", "example");
  item.flags["action-effects-5e"].future = envelope([{ id: "concurrent" }]);
  await assert.rejects(() => authoring.save(draft), /changed while editing/);
  assert.equal(writes.length, 0);
  const fresh = authoring.createDraft(item);
  fresh.add("future", "new", "example");
  item.flags["action-effects-5e"].unrelated.concurrent = true;
  await authoring.save(fresh);
  assert.equal(item.flags["action-effects-5e"].unrelated.concurrent, true);
});

test("pack relocks after success and failed updates; no-op saves never unlock it", async () => {
  const { authoring, item, packs } = fixture({ pack: "action-effects-5e.class-features" });
  const transitions = [];
  const pack = { locked: true, async configure({ locked }) { this.locked = locked; transitions.push(locked); } };
  packs.set(item.pack, pack);
  assert.equal((await authoring.save(authoring.createDraft(item))).changed, false);
  assert.deepEqual(transitions, []);
  const draft = authoring.createDraft(item);
  draft.add("future", "one", "example");
  await authoring.save(draft);
  assert.deepEqual(transitions, [false, true]);
  const broken = authoring.createDraft(item);
  broken.add("future", "two", "example");
  item.update = async () => { throw new Error("Write failed"); };
  await assert.rejects(() => authoring.save(broken), /Write failed/);
  assert.deepEqual(transitions, [false, true, false, true]);
});
