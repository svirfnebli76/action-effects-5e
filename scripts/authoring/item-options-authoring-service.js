import { MODULE_ID } from "../core/constants.js";
import { CAT_PUBLIC_AUTOMATION_PACK_IDS } from "./cat-metadata-authoring-service.js";
import { CAT_CONFIGURATION_SCHEMA_FLAG, validateCatConfigurationData } from "./cat-configuration-authoring-service.js";
import { clone, getPath, isObject, validId, parseDeclarationJson } from "../declarations/json-data.js";

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Object-valued Foundry updates merge. Explicitly remove authored keys that the
// editor deleted, including optional fields inside CAT control descriptors.
function addDeletions(previous, next, path, updates) {
  if (!isObject(previous) || !isObject(next)) return;
  for (const [key, value] of Object.entries(previous)) {
    if (!Object.hasOwn(next, key)) updates[`${path}.-=${key}`] = null;
    else addDeletions(value, next[key], `${path}.${key}`, updates);
  }
}

/** Draft rows have editor-local keys so duplicate/broken ids can still be repaired. */
export class ItemOptionsDraft {
  #next = 0;
  constructor({ document, collections, configurationAuthoring }) {
    this.document = document;
    this.collections = collections;
    this.configurationBaseline = clone(getPath(document, CAT_CONFIGURATION_SCHEMA_FLAG));
    this.configurationText = configurationAuthoring.getConfigurationText(document);
    this.initialConfigurationText = this.configurationText;
    this.families = collections.registry.list().map(family => {
      const read = collections.read(document, family.id);
      return { family, baseline: clone(getPath(document, family.flagPath)), blocked: Boolean(read.blocked),
        issues: read.issues, touched: false, rows: read.records.map(record => this.#row(record)) };
    });
  }

  #row(record) { return { key: `row-${++this.#next}`, text: JSON.stringify(record, null, 2) }; }
  group(id) {
    const group = this.families.find(group => group.family.id === id);
    if (!group) throw new Error("Unknown declaration family.");
    return group;
  }
  #editable(id) {
    const group = this.group(id);
    if (group.blocked) throw new Error("Existing legacy/unsupported collection is preserved; explicit migration is required.");
    return group;
  }
  #unique(group, id) {
    if (!validId(id) || group.rows.some(row => parseDeclarationJson(row.text).data?.id === id)) {
      throw new Error("Choose a new unique declaration id within this family.");
    }
  }
  add(familyId, id, templateId) {
    const group = this.#editable(familyId);
    this.#unique(group, id);
    const template = group.family.templates.find(template => template.id === templateId);
    if (!template) throw new Error("Choose a registered family template/role.");
    const row = this.#row({ ...clone(template.record), id });
    group.rows.push(row);
    group.touched = true;
    return row;
  }
  edit(familyId, key, text) {
    const group = this.#editable(familyId);
    const row = group.rows.find(row => row.key === key);
    if (!row) throw new Error("Declaration row no longer exists.");
    row.text = String(text);
    group.touched = true;
  }
  duplicate(familyId, key, id) {
    const group = this.#editable(familyId);
    this.#unique(group, id);
    const row = group.rows.find(row => row.key === key);
    if (!row) throw new Error("Declaration row no longer exists.");
    const parsed = parseDeclarationJson(row.text);
    if (!parsed.valid) throw new Error(parsed.issues.join(" "));
    const copy = this.#row({ ...parsed.data, id });
    group.rows.push(copy);
    group.touched = true;
    return copy;
  }
  remove(familyId, key) {
    const group = this.#editable(familyId);
    if (!group.rows.some(row => row.key === key)) throw new Error("Declaration row no longer exists.");
    group.rows = group.rows.filter(row => row.key !== key);
    group.touched = true;
  }
  validate() {
    const issues = [];
    const collections = [];
    for (const group of this.families) {
      if (group.blocked) continue; // read-only legacy data is never rewritten by this editor
      const declarations = [];
      const ids = new Set();
      group.rows.forEach((row, index) => {
        const parsed = parseDeclarationJson(row.text);
        const label = `${group.family.id}/${parsed.data?.id ?? `row ${index + 1}`}`;
        const messages = [...parsed.issues];
        if (parsed.valid) {
          messages.push(...this.collections.registry.validateRecord(group.family.id, parsed.data).issues);
          if (ids.has(parsed.data?.id)) messages.push("Duplicate declaration id.");
          ids.add(parsed.data?.id);
          declarations.push(parsed.data);
        }
        messages.forEach(message => issues.push(`${label}: ${message}`));
      });
      if (group.touched) collections.push({ group, envelope: { ...clone(group.baseline), version: group.family.version, declarations } });
    }
    const configurationChanged = this.configurationText !== this.initialConfigurationText;
    const configuration = parseDeclarationJson(this.configurationText);
    if (configurationChanged) {
      issues.push(...configuration.issues.map(message => `CAT Configuration: ${message}`));
      if (configuration.valid) issues.push(...validateCatConfigurationData(configuration.data).issues);
    }
    return { valid: !issues.length, issues, collections, configurationChanged, configuration: configuration.data };
  }
}

/** Saves validated CAT definitions and declaration arrays in one Item update. */
export class ItemOptionsAuthoringService {
  constructor({ collections, configurationAuthoring, userAccessor = () => globalThis.game?.user,
    packsAccessor = () => globalThis.game?.packs, publicPackIds = CAT_PUBLIC_AUTOMATION_PACK_IDS }) {
    this.collections = collections;
    this.configurationAuthoring = configurationAuthoring;
    this.userAccessor = userAccessor;
    this.packsAccessor = packsAccessor;
    this.publicPackIds = [...publicPackIds];
  }
  canEdit(item) {
    return Boolean(this.userAccessor()?.isGM && item?.documentName === "Item"
      && (!item.pack || this.publicPackIds.includes(item.pack)));
  }
  createDraft(document) {
    if (!this.canEdit(document)) throw new Error("Item Options requires a GM and a world/owned Item or an approved AE5E public compendium Item.");
    return new ItemOptionsDraft({ document, collections: this.collections, configurationAuthoring: this.configurationAuthoring });
  }
  async save(draft) {
    const document = draft.document;
    if (!this.canEdit(document)) throw new Error("Item Options authoring is unavailable for this user or Item.");
    const validation = draft.validate();
    if (!validation.valid) throw new Error(validation.issues.join("\n"));
    const updates = {};
    for (const { group, envelope } of validation.collections) {
      if (!same(getPath(document, group.family.flagPath), group.baseline)) throw new Error(`${group.family.id}: Item changed while editing. Reopen the editor before saving.`);
      updates[`${group.family.flagPath}.version`] = envelope.version;
      updates[`${group.family.flagPath}.declarations`] = clone(envelope.declarations);
    }
    if (validation.configurationChanged) {
      if (document.flags?.cat?.automation?.source && document.flags.cat.automation.source !== MODULE_ID) {
        throw new Error("AE5E will not replace another CAT provider's configuration.");
      }
      if (!same(getPath(document, CAT_CONFIGURATION_SCHEMA_FLAG), draft.configurationBaseline)) throw new Error("CAT Configuration changed while editing. Reopen the editor before saving.");
      const data = validation.configuration;
      if (!Object.keys(data).length) updates[`flags.${MODULE_ID}.cat.-=configSchema`] = null;
      else {
        updates[CAT_CONFIGURATION_SCHEMA_FLAG] = clone(data);
        addDeletions(draft.configurationBaseline, data, CAT_CONFIGURATION_SCHEMA_FLAG, updates);
      }
    }
    if (!Object.keys(updates).length) return { document, changed: false, validation };
    if (typeof document.update !== "function") throw new Error("Item cannot be updated.");
    const pack = document.pack ? this.packsAccessor()?.get?.(document.pack) : null;
    if (document.pack && !pack) throw new Error("Compendium is unavailable.");
    const wasLocked = Boolean(pack?.locked);
    let unlocked = false;
    let written = false;
    try {
      if (wasLocked) {
        if (!pack.configure) throw new Error("Compendium cannot be unlocked for authoring.");
        await pack.configure({ locked: false });
        unlocked = true;
      }
      await document.update(updates);
      written = true;
    } finally {
      if (unlocked) {
        try { await pack.configure({ locked: true }); }
        catch (error) { throw new Error(`Item ${written ? "was saved" : "save failed"}, but compendium could not be re-locked: ${error.message}`); }
      }
    }
    return { document, changed: true, validation };
  }
}
