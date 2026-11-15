import test from "node:test";
import assert from "node:assert/strict";
import {
  CompendiumDataService,
  COMPENDIUM_DATA_FORMAT,
  COMPENDIUM_DATA_FORMAT_VERSION
} from "../scripts/authoring/compendium-data-service.js";

const id = (prefix, number = 1) => `${prefix}${String(number).padStart(16 - prefix.length, "0")}`;
const ROOT_ID = id("ROOT", 1);
const ACTIVITY_ID = id("ACT", 1);
const EFFECT_ID = id("EFF", 1);
const CHANGE_ID = id("CHG", 1);
const ITEM_ID = id("ITM", 1);

function clone(value) {
  return structuredClone(value);
}

function itemData(overrides = {}) {
  const activityId = overrides.activityId ?? ACTIVITY_ID;
  const effectId = overrides.effectId ?? EFFECT_ID;
  return {
    _id: overrides._id ?? ROOT_ID,
    name: overrides.name ?? "Summon Fey",
    type: overrides.type ?? "spell",
    img: "icons/svg/book.svg",
    folder: overrides.folder ?? id("FOL", 1),
    sort: overrides.sort ?? 1200,
    ownership: overrides.ownership ?? { default: 0 },
    flags: overrides.flags ?? {},
    system: {
      identifier: overrides.identifier ?? "summon-fey",
      activities: {
        [activityId]: {
          _id: activityId,
          name: "Summon",
          type: "summon",
          effects: [{ _id: effectId }],
          profiles: [{ _id: id("PRO", 1), name: "Fuming", uuid: "Compendium.action-effects-5e.ae5e-summoned-creatures.Actor.FUMING0000000001" }]
        }
      },
      advancement: {}
    },
    effects: [{
      _id: effectId,
      name: "Concentration",
      changes: [{ _id: CHANGE_ID, key: `system.activities.${activityId}.activation.type`, value: "action" }]
    }],
    _stats: {
      coreVersion: "14.366",
      systemId: "dnd5e",
      systemVersion: "6.0.6",
      createdTime: overrides.createdTime ?? 100,
      modifiedTime: overrides.modifiedTime ?? 200,
      lastModifiedBy: id("USR", 1),
      compendiumSource: overrides.compendiumSource ?? null,
      duplicateSource: overrides.duplicateSource ?? null
    }
  };
}

function actorData(overrides = {}) {
  const embedded = itemData({
    _id: overrides.itemId ?? ITEM_ID,
    type: "feat",
    name: "Fey Step",
    identifier: "fey-step",
    folder: null,
    sort: 0,
    ownership: {}
  });
  embedded.system.container = overrides.container ?? "";
  return {
    _id: overrides._id ?? ROOT_ID,
    name: "Fuming Fey Spirit",
    type: overrides.type ?? "npc",
    folder: overrides.folder ?? id("FOL", 2),
    sort: overrides.sort ?? 400,
    ownership: overrides.ownership ?? { default: 0 },
    flags: {},
    system: { details: {}, favorites: [{ type: "item", id: `.Item.${embedded._id}.Activity.${ACTIVITY_ID}`, sort: 0 }] },
    prototypeToken: { name: "Fuming Fey Spirit" },
    items: [embedded],
    effects: [],
    _stats: {
      coreVersion: "14.366",
      systemId: "dnd5e",
      systemVersion: "6.0.6",
      createdTime: 300,
      modifiedTime: 400,
      lastModifiedBy: id("USR", 1),
      compendiumSource: null,
      duplicateSource: null
    }
  };
}

class MockItem {
  static fromImportCalls = [];
  static async fromImport(data, context) {
    this.fromImportCalls.push({ data: clone(data), context });
    const migrated = clone(data);
    migrated._stats.coreVersion = "14.370";
    migrated._stats.systemVersion = "6.0.6";
    return new MockItem(migrated, context);
  }
  static fromSource(data, context) { return new MockItem(data, context); }
  constructor(data, { pack = "action-effects-5e.spells-level-3" } = {}) {
    this._source = clone(data);
    this.pack = pack;
    this.documentName = "Item";
    this.id = data._id;
    this.name = data.name;
    this.type = data.type;
    this.uuid = `Compendium.${pack}.Item.${data._id}`;
  }
  toObject() { return clone(this._source); }
}

class MockActor {
  static fromImportCalls = [];
  static async fromImport(data, context) {
    this.fromImportCalls.push({ data: clone(data), context });
    const migrated = clone(data);
    migrated._stats.coreVersion = "14.370";
    return new MockActor(migrated, context);
  }
  static fromSource(data, context) { return new MockActor(data, context); }
  constructor(data, { pack = "action-effects-5e.ae5e-summoned-creatures" } = {}) {
    this._source = clone(data);
    this.pack = pack;
    this.documentName = "Actor";
    this.id = data._id;
    this.name = data.name;
    this.type = data.type;
    this.uuid = `Compendium.${pack}.Actor.${data._id}`;
  }
  toObject() { return clone(this._source); }
}

function makeHarness({ documentName = "Item", locked = false, corruptFirstImport = false } = {}) {
  const packId = documentName === "Actor"
    ? "action-effects-5e.ae5e-summoned-creatures"
    : "action-effects-5e.spells-level-3";
  const DocumentClass = documentName === "Actor" ? MockActor : MockItem;
  const data = documentName === "Actor" ? actorData() : itemData();
  let stored = new DocumentClass(data, { pack: packId });
  let importCount = 0;
  const importOptions = [];
  const pack = {
    collection: packId,
    metadata: { id: packId, label: "Test Pack", type: documentName },
    locked,
    async importDocument(document, options) {
      importCount += 1;
      importOptions.push(clone(options));
      const next = document.toObject();
      if (corruptFirstImport && importCount === 1) next.folder = id("BAD", 1);
      stored = new DocumentClass(next, { pack: packId });
      return stored;
    },
    async getDocument(entryId) { return entryId === stored.id ? stored : null; }
  };
  const game = { user: { isGM: true, id: id("USR", 1) }, packs: new Map([[packId, pack]]) };
  const unresolved = [];
  const service = new CompendiumDataService({
    gameAccessor: () => game,
    fromUuidAccessor: async uuid => {
      if (uuid.includes("FUMING")) return { uuid };
      unresolved.push(uuid);
      return null;
    }
  });
  return { service, pack, target: stored, get stored() { return stored; }, get importCount() { return importCount; }, importOptions, unresolved };
}

test("export creates a complete versioned envelope without changing document data", () => {
  const { service, target } = makeHarness();
  const result = service.createExport(target);
  assert.equal(result.payload._ae5e.format, COMPENDIUM_DATA_FORMAT);
  assert.equal(result.payload._ae5e.version, COMPENDIUM_DATA_FORMAT_VERSION);
  assert.equal(result.payload._ae5e.documentName, "Item");
  assert.equal(result.payload.document._id, ROOT_ID);
  assert.equal(result.payload.document._stats.coreVersion, "14.366");
  assert.match(result.filename, /Item-Summon-Fey/);
  assert.deepEqual(JSON.parse(result.text), result.payload);
});

test("audit preserves existing identities while allowing genuinely new activities and effects", () => {
  const { service } = makeHarness();
  const current = itemData();
  const incoming = clone(current);
  const newActivityId = id("ACT", 2);
  const newEffectId = id("EFF", 2);
  incoming.effects.push({ _id: newEffectId, name: "New Effect", changes: [{ _id: id("CHG", 2), key: "system.attributes.ac.bonus", value: "1" }] });
  incoming.system.activities[newActivityId] = { _id: newActivityId, name: "New Activity", type: "utility", effects: [{ _id: newEffectId }] };
  const report = service.audit("Item", current, incoming);
  assert.equal(report.valid, true);
  assert.equal(report.removed.length, 0);
  assert.equal(report.added.some(node => node.kind === "Activity" && node.id === newActivityId), true);
  assert.equal(report.added.some(node => node.kind === "Active Effect" && node.id === newEffectId), true);
});

test("audit blocks accidental activity and Active Effect ID replacement", () => {
  const { service } = makeHarness();
  const current = itemData();
  const incoming = itemData({ activityId: id("ACT", 9), effectId: id("EFF", 9) });
  const report = service.audit("Item", current, incoming);
  assert.equal(report.valid, false);
  assert.equal(report.replacements.some(entry => entry.kind === "Activity"), true);
  assert.equal(report.replacements.some(entry => entry.kind === "Active Effect"), true);
  assert.match(report.errors.join(" "), /changed _id/);
});

test("audit blocks dangling local references and reports identifier changes", () => {
  const { service } = makeHarness();
  const current = itemData();
  const incoming = clone(current);
  incoming.system.identifier = "summon-fey-repaired";
  incoming.system.activities[ACTIVITY_ID].effects[0]._id = id("EFF", 99);
  const report = service.audit("Item", current, incoming);
  assert.equal(report.valid, false);
  assert.match(report.errors.join(" "), /references missing local Active Effect/);
  assert.equal(report.identifierChanges.length, 1);
  assert.match(report.warnings.join(" "), /summon-fey-repaired/);
});

test("audit blocks dangling relative UUIDs hidden in flags or macro text", () => {
  const { service } = makeHarness();
  const current = itemData();
  const incoming = clone(current);
  incoming.flags.cat = { macro: `@UUID[.Activity.${id("ACT", 99)}]` };
  const report = service.audit("Item", current, incoming);
  assert.equal(report.valid, false);
  assert.match(report.errors.join(" "), /Relative UUID.*missing Activity/);
});

test("Actor audit recursively protects embedded Item identities and container references", () => {
  const { service } = makeHarness({ documentName: "Actor" });
  const current = actorData();
  const changedId = id("ITM", 2);
  const incoming = actorData({ itemId: changedId, container: id("ITM", 99) });
  const report = service.audit("Actor", current, incoming);
  assert.equal(report.valid, false);
  assert.equal(report.replacements.some(entry => entry.kind === "Embedded Item"), true);
  assert.match(report.errors.join(" "), /missing container Item/);
});

test("prepareImport migrates full data and forces protected destination identity fields", async () => {
  const harness = makeHarness();
  const exported = harness.service.createExport(harness.target).payload;
  exported.document._id = id("ROOT", 8);
  exported.document.folder = id("FOL", 9);
  exported.document.sort = 9999;
  exported.document.ownership = { default: 3 };
  exported.document._stats.createdTime = 999;
  exported.document.name = "Summon Fey Repaired";

  const prepared = await harness.service.prepareImport(harness.target, exported);
  assert.equal(MockItem.fromImportCalls.at(-1).data._id, id("ROOT", 8), "migration receives the unmodified source export");
  assert.equal(prepared.candidateData._id, ROOT_ID);
  assert.equal(prepared.candidateData.folder, itemData().folder);
  assert.equal(prepared.candidateData.sort, itemData().sort);
  assert.deepEqual(prepared.candidateData.ownership, itemData().ownership);
  assert.equal(prepared.candidateData._stats.createdTime, 100);
  assert.equal(prepared.candidateData._stats.coreVersion, "14.370");
  assert.equal(prepared.candidateData.name, "Summon Fey Repaired");
  assert.equal(prepared.report.valid, true);
});

test("prepareImport blocks subtype mismatch and locked compendium imports", async () => {
  const harness = makeHarness();
  const wrongType = harness.service.createExport(harness.target).payload;
  wrongType.document.type = "feat";
  await assert.rejects(() => harness.service.prepareImport(harness.target, wrongType), /Subtype mismatch/);

  const locked = makeHarness({ locked: true });
  const payload = locked.service.createExport(locked.target).payload;
  await assert.rejects(() => locked.service.prepareImport(locked.target, payload), /Unlock compendium/);
});

test("prepareImport rejects prototype-polluting JSON keys before migration", async () => {
  const harness = makeHarness();
  const payload = harness.service.createExport(harness.target).payload;
  const text = JSON.stringify(payload).replace('"flags":{}', '"flags":{"__proto__":{"polluted":true}}');
  await assert.rejects(() => harness.service.prepareImport(harness.target, text), /Unsafe JSON key/);
  assert.equal({}.polluted, undefined);
});

test("commitImport replaces in place and verifies root and retained nested IDs", async () => {
  const harness = makeHarness();
  const payload = harness.service.createExport(harness.target).payload;
  const newActivityId = id("ACT", 2);
  payload.document.system.activities[newActivityId] = { _id: newActivityId, name: "Fey Blade", type: "attack", effects: [] };
  const prepared = await harness.service.prepareImport(harness.target, payload);
  const result = await harness.service.commitImport(prepared);
  assert.equal(result.imported.id, ROOT_ID);
  assert.equal(result.imported.uuid, harness.target.uuid);
  assert.equal(result.verification.valid, true);
  assert.ok(harness.stored.toObject().system.activities[newActivityId]);
  assert.equal(harness.importCount, 1);
  assert.deepEqual(harness.importOptions[0], {
    keepId: true,
    keepEmbeddedIds: true,
    clearFlags: false,
    clearFolder: false,
    clearOwnership: false,
    clearSort: false,
    clearSource: false,
    clearState: false,
    dialog: false
  });
});

test("failed post-import verification restores the rollback snapshot", async () => {
  const harness = makeHarness({ corruptFirstImport: true });
  const original = harness.target.toObject();
  const payload = harness.service.createExport(harness.target).payload;
  payload.document.name = "Changed Name";
  const prepared = await harness.service.prepareImport(harness.target, payload);
  await assert.rejects(() => harness.service.commitImport(prepared), /Post-import verification failed/);
  assert.equal(harness.importCount, 2, "one replacement and one rollback are persisted");
  assert.deepEqual(harness.stored.toObject(), original);
  assert.equal(harness.service.getStats().rollbacks, 1);
});

test("non-GM users cannot export or prepare imports", async () => {
  const harness = makeHarness();
  const service = new CompendiumDataService({ gameAccessor: () => ({ user: { isGM: false }, packs: new Map() }) });
  assert.throws(() => service.createExport(harness.target), /require a GM/);
  await assert.rejects(() => service.prepareImport(harness.target, {}), /require a GM/);
});
