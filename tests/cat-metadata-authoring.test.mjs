import test from "node:test";
import assert from "node:assert/strict";
import {
  CAT_AUTOMATION_SOURCE_FLAG,
  CAT_AUTOMATION_VERSION_FLAG,
  CAT_INTERNAL_PACK_IDS,
  CAT_PUBLIC_AUTOMATION_PACK_IDS,
  CatMetadataAuthoringService,
  isValidAutomationVersion
} from "../scripts/authoring/cat-metadata-authoring-service.js";

function makeItem({
  id = "item-1",
  uuid = "Item.item-1",
  identifier = "misty-step",
  rules = "2014",
  type = "spell",
  source,
  version,
  isGM = true
} = {}) {
  const item = {
    id,
    uuid,
    name: "Misty Step",
    documentName: "Item",
    type,
    system: { identifier, source: { rules } },
    flags: {
      cat: {
        automation: {},
        config: { playAnimation: false }
      },
      "action-effects-5e": { probe: true }
    },
    effects: [{ id: "effect-1", name: "Probe" }],
    async update(changes) {
      for (const [path, value] of Object.entries(changes)) {
        const keys = path.split(".");
        let target = this;
        while (keys.length > 1) {
          const key = keys.shift();
          target[key] ??= {};
          target = target[key];
        }
        target[keys[0]] = value;
      }
      return this;
    }
  };
  if (source !== undefined) item.flags.cat.automation.source = source;
  if (version !== undefined) item.flags.cat.automation.version = version;
  return { item, user: { isGM } };
}

function makeService(item, user = { isGM: true }, packs = new Map()) {
  return new CatMetadataAuthoringService({
    fromUuidAccessor: async uuid => uuid === item?.uuid ? item : null,
    userAccessor: () => user,
    packsAccessor: () => packs
  });
}

test("CAT automation versions use strict SemVer", () => {
  assert.equal(isValidAutomationVersion("1.0.0"), true);
  assert.equal(isValidAutomationVersion("2.1.0-beta.1"), true);
  assert.equal(isValidAutomationVersion("1.0"), false);
  assert.equal(isValidAutomationVersion("01.0.0"), false);
  assert.equal(isValidAutomationVersion("banana"), false);
});

test("CAT authoring validates identifier, rules, type, source and version", () => {
  const { item, user } = makeItem();
  const service = makeService(item, user);
  assert.equal(service.validateItem(item).valid, true);
  const audit = service.auditDocument(item);
  assert.equal(audit.valid, false);
  assert.equal(audit.issues.includes(`Missing ${CAT_AUTOMATION_SOURCE_FLAG}.`), true);
  assert.equal(audit.issues.includes(`Missing ${CAT_AUTOMATION_VERSION_FLAG}.`), true);

  const invalid = makeItem({ identifier: "", rules: "banana", type: null }).item;
  const invalidAudit = service.auditDocument(invalid);
  assert.equal(invalidAudit.valid, false);
  assert.equal(invalidAudit.issues.some(issue => issue.includes("system.identifier")), true);
  assert.equal(invalidAudit.issues.some(issue => issue.includes("system.source.rules")), true);
  assert.equal(invalidAudit.issues.some(issue => issue.includes("Item type")), true);
});

test("CAT authoring stamps only source/version and preserves existing config", async () => {
  const { item, user } = makeItem();
  const service = makeService(item, user);
  const before = JSON.stringify({ system: item.system, config: item.flags.cat.config, ae5e: item.flags["action-effects-5e"], effects: item.effects });

  const result = await service.setMetadata(item, { version: "1.0.0" });
  assert.equal(result.audit.valid, true);
  assert.equal(item.flags.cat.automation.source, "action-effects-5e");
  assert.equal(item.flags.cat.automation.version, "1.0.0");
  assert.equal(JSON.stringify({ system: item.system, config: item.flags.cat.config, ae5e: item.flags["action-effects-5e"], effects: item.effects }), before);

  await service.setMetadata(item.uuid, { version: "1.0.1" });
  assert.equal(item.flags.cat.automation.version, "1.0.1");
  assert.equal(service.getStats().metadataWrites, 2);
});

test("CAT authoring rejects invalid versions and foreign CAT ownership", async () => {
  const { item, user } = makeItem({ source: "other-provider", version: "3.2.1" });
  const service = makeService(item, user);
  await assert.rejects(() => service.setMetadata(item, { version: "1.0.0" }), /Refusing to replace CAT automation source/);
  assert.equal(item.flags.cat.automation.source, "other-provider");
  assert.equal(item.flags.cat.automation.version, "3.2.1");

  const fixture = makeItem({ version: "1.0.0" });
  const ownService = makeService(fixture.item, fixture.user);
  await assert.rejects(() => ownService.setMetadata(fixture.item, { version: "1.0" }), /Invalid automation version/);
  assert.equal(fixture.item.flags.cat.automation.version, "1.0.0");
});

test("CAT metadata writes are GM-only", async () => {
  const { item } = makeItem();
  const service = makeService(item, { isGM: false });
  await assert.rejects(() => service.setMetadata(item, { version: "1.0.0" }), /requires a GM user/);
  assert.equal(item.flags.cat.automation.version, undefined);
});

test("pack audit reports invalid metadata and public allowlist excludes Administrative", async () => {
  const valid = makeItem({ id: "valid", uuid: "Item.valid", source: "action-effects-5e", version: "1.0.0" }).item;
  const invalid = makeItem({ id: "invalid", uuid: "Item.invalid" }).item;
  const pack = {
    collection: "action-effects-5e.spells-level-2",
    metadata: { id: "action-effects-5e.spells-level-2", label: "Level 2", type: "Item" },
    async getDocuments() { return [valid, invalid]; }
  };
  const packs = new Map([[pack.collection, pack]]);
  const service = makeService(valid, { isGM: true }, packs);
  const report = await service.auditPack(pack.collection);
  assert.equal(report.total, 2);
  assert.equal(report.valid, 1);
  assert.equal(report.invalid, 1);
  assert.equal(CAT_PUBLIC_AUTOMATION_PACK_IDS.includes("action-effects-5e.ae5e-administrative"), false);
  assert.equal(CAT_INTERNAL_PACK_IDS.includes("action-effects-5e.ae5e-administrative"), true);
});
