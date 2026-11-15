import test from "node:test";
import assert from "node:assert/strict";
import {
  CompendiumDataContextMenuService,
  COMPENDIUM_DATA_CONTEXT_WRAPPER_TARGET,
  COMPENDIUM_EXPORT_CONTEXT_LABEL,
  COMPENDIUM_IMPORT_CONTEXT_LABEL
} from "../scripts/authoring/compendium-data-context-menu-service.js";

function makeService({ isGM = true } = {}) {
  const registrations = [];
  const dataService = {
    exportDocument(document) { return { document }; },
    async prepareImport() { return { report: { valid: true } }; },
    async commitImport() { return {}; },
    getStatus() { return {}; },
    getStats() { return {}; }
  };
  const libWrapper = {
    register(moduleId, target, fn, type) {
      registrations.push({ moduleId, target, fn, type });
      return 77;
    }
  };
  const service = new CompendiumDataContextMenuService({
    dataService,
    gameAccessor: () => ({ user: { isGM } }),
    libWrapperAccessor: () => libWrapper,
    selectFileAccessor: async () => null
  });
  return { service, registrations, dataService };
}

function pack(type, { locked = false } = {}) {
  return { collection: `test.${type.toLowerCase()}`, metadata: { type, label: `${type} Pack` }, locked };
}

test("compendium data context service registers one Foundry v14 wrapper", () => {
  const { service, registrations } = makeService();
  service.initialize();
  service.initialize();
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].moduleId, "action-effects-5e");
  assert.equal(registrations[0].target, COMPENDIUM_DATA_CONTEXT_WRAPPER_TARGET);
  assert.equal(registrations[0].type, "WRAPPER");
  assert.equal(service.getStats().duplicateInitializeCalls, 1);
});

test("compendium data context service can share AE5E's existing wrapper without a duplicate registration", () => {
  const { service, registrations } = makeService();
  const first = service.initialize({ sharedWrapperId: 42 });
  const second = service.initialize({ sharedWrapperId: 77 });

  assert.equal(first.wrapperRegistered, true);
  assert.equal(first.sharedWrapper, true);
  assert.equal(first.wrapperId, 42);
  assert.equal(second.wrapperId, 42);
  assert.equal(registrations.length, 0);
  assert.equal(service.getStats().sharedWrapperBindings, 1);
  assert.equal(service.getStats().duplicateInitializeCalls, 1);
});

test("GM sees Import Data and Export Data on Actor and Item entries only", () => {
  const { service } = makeService({ isGM: true });
  const base = [{ label: "Base" }];
  for (const type of ["Actor", "Item"]) {
    const options = service.extendContextOptions({ collection: pack(type) }, base);
    assert.equal(options.length, 3);
    assert.equal(options[1].label, COMPENDIUM_EXPORT_CONTEXT_LABEL);
    assert.equal(options[2].label, COMPENDIUM_IMPORT_CONTEXT_LABEL);
  }
  assert.equal(service.extendContextOptions({ collection: pack("JournalEntry") }, base).length, 1);
  assert.equal(makeService({ isGM: false }).service.extendContextOptions({ collection: pack("Item") }, base).length, 1);
});

test("locked packs retain Export Data and Import Data context entries", () => {
  const { service } = makeService();
  const options = service.extendContextOptions({ collection: pack("Actor", { locked: true }) }, []);
  assert.deepEqual(options.map(option => option.label), [COMPENDIUM_EXPORT_CONTEXT_LABEL, COMPENDIUM_IMPORT_CONTEXT_LABEL]);
});

test("duplicate wrappers do not add duplicate AE5E data options", () => {
  const { service } = makeService();
  const existing = [
    { ae5eExportData: true, label: COMPENDIUM_EXPORT_CONTEXT_LABEL },
    { ae5eImportData: true, label: COMPENDIUM_IMPORT_CONTEXT_LABEL }
  ];
  assert.equal(service.extendContextOptions({ collection: pack("Item") }, existing).length, 2);
});
