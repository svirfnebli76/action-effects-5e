import test from "node:test";
import assert from "node:assert/strict";
import {
  CatMetadataContextMenuService,
  CAT_METADATA_CONTEXT_LABEL,
  CAT_OPTIONS_CONTEXT_LABEL,
  CAT_METADATA_CONTEXT_WRAPPER_TARGET
} from "../scripts/authoring/cat-metadata-context-menu-service.js";

function makeService({ isGM = true } = {}) {
  const registrations = [];
  const authoring = {
    isValidVersion: value => /^\d+\.\d+\.\d+$/.test(value),
    async setMetadata() { return { audit: { valid: true } }; }
  };
  const configurationAuthoring = {
    getConfiguration(document) { return document.flags?.["action-effects-5e"]?.cat?.configSchema ?? {}; },
    validate(data) { return { valid: true, optionCount: Object.keys(data ?? {}).length, issues: [] }; },
    parse(text) { try { const data = JSON.parse(text); return { valid: true, data, optionCount: Object.keys(data ?? {}).length, issues: [] }; } catch (error) { return { valid: false, data: null, optionCount: 0, issues: [error.message] }; } },
    async setConfiguration() { return { validation: { valid: true, optionCount: 0, issues: [] } }; },
    getStatus() { return { schemaFlag: "flags.action-effects-5e.cat.configSchema", preferenceFlag: "flags.cat.config.*" }; }
  };
  const registry = {
    async refreshPublicCompendiums() { return { publicRegistration: { registeredPacks: [], deferredPacks: [] } }; },
    getStatus() { return { publicRegistration: { registeredPacks: [], deferredPacks: [] } }; }
  };
  const libWrapper = {
    register(moduleId, target, fn, type) {
      registrations.push({ moduleId, target, fn, type });
      return 42;
    }
  };
  const service = new CatMetadataContextMenuService({
    authoring,
    configurationAuthoring,
    registry,
    gameAccessor: () => ({ user: { isGM } }),
    libWrapperAccessor: () => libWrapper,
    fromUuidAccessor: async () => null
  });
  return { service, registrations };
}

function makePack(id, type = "Item") {
  return { collection: id, metadata: { id, type } };
}

function makeItem(overrides = {}) {
  return {
    documentName: "Item",
    name: overrides.name ?? "Misty Step",
    type: overrides.type ?? "spell",
    pack: overrides.pack ?? "action-effects-5e.spells-level-2",
    system: {
      identifier: overrides.identifier ?? "misty-step",
      source: { rules: overrides.rules ?? "2014" }
    },
    flags: {
      cat: {
        automation: {
          ...(overrides.source !== undefined ? { source: overrides.source } : {}),
          ...(overrides.version !== undefined ? { version: overrides.version } : {})
        }
      }
    }
  };
}

test("CAT metadata context service registers the Foundry v14 Compendium wrapper once", () => {
  const { service, registrations } = makeService();
  const first = service.initialize();
  const second = service.initialize();
  assert.equal(first.wrapperRegistered, true);
  assert.equal(second.wrapperRegistered, true);
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].moduleId, "action-effects-5e");
  assert.equal(registrations[0].target, CAT_METADATA_CONTEXT_WRAPPER_TARGET);
  assert.equal(registrations[0].type, "WRAPPER");
});

test("context option appears only for GM in approved AE5E public compendiums", () => {
  const allowed = makePack("action-effects-5e.spells-level-2");
  const internal = makePack("action-effects-5e.ae5e-administrative");
  const foreign = makePack("dnd5e.spells");
  const { service } = makeService({ isGM: true });
  const base = [{ label: "Base" }];

  const allowedOptions = service.extendContextOptions({ collection: allowed }, base);
  assert.equal(allowedOptions.length, 3);
  assert.equal(allowedOptions[1].label, CAT_METADATA_CONTEXT_LABEL);
  assert.equal(allowedOptions[1].ae5eCatMetadata, true);
  assert.equal(allowedOptions[2].label, CAT_OPTIONS_CONTEXT_LABEL);
  assert.equal(allowedOptions[2].ae5eCatOptions, true);

  assert.equal(service.extendContextOptions({ collection: internal }, base).length, 1);
  assert.equal(service.extendContextOptions({ collection: foreign }, base).length, 1);

  const player = makeService({ isGM: false }).service;
  assert.equal(player.extendContextOptions({ collection: allowed }, base).length, 1);
});

test("first-use editor draft auto-populates Foundry fields and proposes version 1.0.0", () => {
  const { service } = makeService();
  const item = makeItem({ version: undefined, source: undefined });
  const draft = service.getDraft(item);
  assert.equal(draft.name, "Misty Step");
  assert.equal(draft.type, "spell");
  assert.equal(draft.identifier, "misty-step");
  assert.equal(draft.rules, "2014");
  assert.equal(draft.sourceId, "action-effects-5e");
  assert.equal(draft.sourceLabel, "Action Effects 5E");
  assert.equal(draft.version, "1.0.0");
  assert.equal(draft.alreadyPublished, false);
});

test("editor draft preserves existing automation version and proposes a safe first-use identifier", () => {
  const { service } = makeService();
  const existing = service.getDraft(makeItem({ source: "action-effects-5e", version: "2.3.4" }));
  assert.equal(existing.version, "2.3.4");
  assert.equal(existing.alreadyPublished, true);

  const missingIdentifier = service.getDraft(makeItem({ name: "Thunder Wave!", identifier: "" }));
  assert.equal(missingIdentifier.identifier, "thunder-wave");

  const genericScratchIdentifier = service.getDraft(makeItem({
    name: "Entangle",
    type: "spell",
    identifier: "spell",
    rules: "2024",
    source: undefined,
    version: undefined
  }));
  assert.equal(genericScratchIdentifier.identifier, "entangle");
  assert.equal(genericScratchIdentifier.rules, "2024");
  assert.equal(genericScratchIdentifier.alreadyPublished, false);

  const publishedGenericIdentifier = service.getDraft(makeItem({
    name: "Entangle",
    type: "spell",
    identifier: "spell",
    source: "action-effects-5e",
    version: "1.0.0"
  }));
  assert.equal(publishedGenericIdentifier.identifier, "spell");
});


test("options editor draft serializes stored configuration data without touching CAT preference flags", () => {
  const { service } = makeService();
  const item = makeItem({ source: "action-effects-5e", version: "1.0.0" });
  item.flags["action-effects-5e"] = { cat: { configSchema: {
    playAnimation: { label: "Play Animations", type: "checkbox", default: true, category: "animation" }
  } } };
  item.flags.cat.config = { playAnimation: false };

  const draft = service.getOptionsDraft(item);
  assert.equal(draft.optionCount, 1);
  assert.equal(draft.valid, true);
  assert.equal(JSON.parse(draft.configurationText).playAnimation.default, true);
  assert.equal(item.flags.cat.config.playAnimation, false);
});
