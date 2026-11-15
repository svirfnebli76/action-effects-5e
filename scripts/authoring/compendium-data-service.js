import { MODULE_ID } from "../core/constants.js";

export const COMPENDIUM_DATA_FORMAT = `${MODULE_ID}.compendium-document`;
export const COMPENDIUM_DATA_FORMAT_VERSION = 1;
export const COMPENDIUM_DATA_DOCUMENT_TYPES = Object.freeze(["Actor", "Item"]);

const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9]{16}$/;
const MAX_IMPORT_CHARACTERS = 25 * 1024 * 1024;
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const FULL_UUID_PATTERN = /(?:Compendium\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|Actor\.[A-Za-z0-9]{16}|Item\.[A-Za-z0-9]{16}|Scene\.[A-Za-z0-9]{16})(?:\.(?:Actor|Item|ActiveEffect|Activity|Token)\.[A-Za-z0-9]{16})*/g;
const RELATIVE_UUID_PATTERN = /\.(?:Item|ActiveEffect|Activity)\.([A-Za-z0-9]{16})/g;
const ACTIVITY_PATH_PATTERN = /system\.activities\.([A-Za-z0-9]{16})/g;
const REPLACEMENT_OPTIONS = Object.freeze({
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

function defaultGameAccessor() {
  return globalThis.game ?? null;
}

function defaultFromUuid(uuid) {
  if (typeof globalThis.fromUuid !== "function") return null;
  return globalThis.fromUuid(uuid);
}

function cloneData(value) {
  const clone = globalThis.foundry?.utils?.deepClone;
  if (typeof clone === "function") return clone(value);
  if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function sourceData(document) {
  if (typeof document?.toObject === "function") return cloneData(document.toObject());
  if (document?._source) return cloneData(document._source);
  return cloneData(document);
}

function entries(value) {
  if (Array.isArray(value)) return value.map((entry, index) => [String(index), entry]);
  if (value && typeof value === "object") return Object.entries(value);
  return [];
}

function values(value) {
  return entries(value).map(([, entry]) => entry);
}

function stringId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function pathText(parts) {
  return parts.join(".");
}

function semanticKey(value) {
  if (!value || typeof value !== "object") return "";
  return [
    value.type ?? "",
    value.system?.identifier ?? value.identifier ?? "",
    value.name ?? ""
  ].map(part => String(part).trim().toLowerCase()).join("|");
}

function pushIdentity(state, { kind, value, path, scope, mappingKey = null }) {
  const id = stringId(value?._id);
  if (!id) {
    state.errors.push(`${kind} at ${pathText(path)} is missing an _id.`);
    return null;
  }
  if (!DOCUMENT_ID_PATTERN.test(id)) {
    state.errors.push(`${kind} at ${pathText(path)} has invalid _id "${id}"; expected 16 letters or numbers.`);
  }
  if (mappingKey && mappingKey !== id) {
    state.errors.push(`${kind} mapping key "${mappingKey}" does not match its _id "${id}" at ${pathText(path)}.`);
  }

  const key = `${scope}|${kind}|${id}`;
  if (state.byKey.has(key)) {
    state.errors.push(`Duplicate ${kind} _id "${id}" in ${scope}.`);
  }
  const node = { key, kind, id, path: pathText(path), scope, semantic: semanticKey(value), value };
  state.byKey.set(key, node);
  state.nodes.push(node);
  return node;
}

function collectEffect(state, effect, path, scope) {
  const effectNode = pushIdentity(state, { kind: "Active Effect", value: effect, path, scope });
  const effectScope = `${scope}/ActiveEffect:${effectNode?.id ?? pathText(path)}`;
  for (const [index, change] of entries(effect?.changes)) {
    pushIdentity(state, {
      kind: "Effect Change",
      value: change,
      path: [...path, "changes", index],
      scope: effectScope
    });
  }
}

function collectActivityChildren(state, activity, path, scope) {
  const visit = (value, currentPath, parentKey = "") => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if ((key === "behaviors" || key === "profiles") && Array.isArray(child)) {
        const kind = key === "behaviors" ? "Activity Behavior" : "Activity Profile";
        child.forEach((entry, index) => pushIdentity(state, {
          kind,
          value: entry,
          path: [...currentPath, key, String(index)],
          scope
        }));
        continue;
      }
      // `effects` beneath an Activity contains references to Item effects, not
      // independently-owned ActiveEffect documents.
      if (key === "effects" && parentKey !== "") continue;
      visit(child, [...currentPath, key], key);
    }
  };
  visit(activity, path);
}

function collectAdvancements(state, item, path, scope) {
  const advancement = item?.system?.advancement;
  for (const [key, value] of entries(advancement)) {
    const mappingKey = Array.isArray(advancement) ? null : key;
    pushIdentity(state, {
      kind: "Advancement",
      value,
      path: [...path, "system", "advancement", key],
      scope,
      mappingKey
    });
  }
}

function collectItem(state, item, path, scope, { embedded = false } = {}) {
  let itemScope = scope;
  if (embedded) {
    const itemNode = pushIdentity(state, { kind: "Embedded Item", value: item, path, scope });
    itemScope = `${scope}/Item:${itemNode?.id ?? pathText(path)}`;
  }

  for (const [index, effect] of entries(item?.effects)) {
    collectEffect(state, effect, [...path, "effects", index], itemScope);
  }

  const activities = item?.system?.activities;
  for (const [key, activity] of entries(activities)) {
    const mappingKey = Array.isArray(activities) ? null : key;
    const activityPath = [...path, "system", "activities", key];
    const activityNode = pushIdentity(state, {
      kind: "Activity",
      value: activity,
      path: activityPath,
      scope: itemScope,
      mappingKey
    });
    collectActivityChildren(
      state,
      activity,
      activityPath,
      `${itemScope}/Activity:${activityNode?.id ?? key}`
    );
  }
  collectAdvancements(state, item, path, itemScope);
}

function collectIdentity(documentName, data) {
  const state = { nodes: [], byKey: new Map(), errors: [] };
  const scope = documentName === "Actor" ? "Actor:root" : "Item:root";
  if (documentName === "Actor") {
    for (const [index, effect] of entries(data?.effects)) {
      collectEffect(state, effect, ["effects", index], scope);
    }
    for (const [index, item] of entries(data?.items)) {
      collectItem(state, item, ["items", index], scope, { embedded: true });
    }
  } else {
    collectItem(state, data, [], scope);
  }
  return state;
}

function itemActivityIds(item) {
  return new Set(values(item?.system?.activities).map(activity => stringId(activity?._id)).filter(Boolean));
}

function itemEffectIds(item) {
  return new Set(values(item?.effects).map(effect => stringId(effect?._id)).filter(Boolean));
}

function addReferenceError(report, message) {
  if (!report.errors.includes(message)) report.errors.push(message);
}

function checkItemReferences(item, path, report, actorItemIds = null) {
  const activities = values(item?.system?.activities);
  const activityIds = itemActivityIds(item);
  const effectIds = itemEffectIds(item);
  const itemPath = pathText(path) || "Item";

  for (const activity of activities) {
    const activityId = stringId(activity?._id) ?? "unknown";
    for (const reference of values(activity?.effects)) {
      const localId = stringId(reference?._id);
      if (localId && !effectIds.has(localId)) {
        addReferenceError(report, `Activity ${activityId} at ${itemPath} references missing local Active Effect ${localId}.`);
      }
    }

    const forwardId = stringId(activity?.activity?.id);
    if (forwardId && !activityIds.has(forwardId)) {
      addReferenceError(report, `Activity ${activityId} at ${itemPath} forwards to missing Activity ${forwardId}.`);
    }

    const riderActivities = activity?.riders?.activity;
    for (const id of Array.isArray(riderActivities) ? riderActivities : []) {
      if (stringId(id) && !activityIds.has(id)) {
        addReferenceError(report, `Activity ${activityId} at ${itemPath} references missing rider Activity ${id}.`);
      }
    }
    const riderEffects = activity?.riders?.effect;
    for (const id of Array.isArray(riderEffects) ? riderEffects : []) {
      if (stringId(id) && !effectIds.has(id)) {
        addReferenceError(report, `Activity ${activityId} at ${itemPath} references missing rider Active Effect ${id}.`);
      }
    }
  }

  for (const effect of values(item?.effects)) {
    for (const change of values(effect?.changes)) {
      for (const text of [change?.key, change?.value]) {
        if (typeof text !== "string") continue;
        for (const match of text.matchAll(ACTIVITY_PATH_PATTERN)) {
          if (!activityIds.has(match[1])) {
            addReferenceError(report, `Active Effect ${effect?._id ?? "unknown"} at ${itemPath} targets missing Activity ${match[1]}.`);
          }
        }
      }
    }
  }

  const flagRiders = item?.flags?.dnd5e?.riders;
  for (const id of Array.isArray(flagRiders?.activity) ? flagRiders.activity : []) {
    if (stringId(id) && !activityIds.has(id)) {
      addReferenceError(report, `${itemPath} flags reference missing rider Activity ${id}.`);
    }
  }
  for (const id of Array.isArray(flagRiders?.effect) ? flagRiders.effect : []) {
    if (stringId(id) && !effectIds.has(id)) {
      addReferenceError(report, `${itemPath} flags reference missing rider Active Effect ${id}.`);
    }
  }

  const container = stringId(item?.system?.container);
  if (container && actorItemIds && !actorItemIds.has(container)) {
    addReferenceError(report, `${itemPath} references missing container Item ${container}.`);
  }
}

function checkActorReferences(actor, report) {
  const items = values(actor?.items);
  const itemIds = new Set(items.map(item => stringId(item?._id)).filter(Boolean));
  const itemsById = new Map(items.map(item => [stringId(item?._id), item]).filter(([id]) => id));

  items.forEach((item, index) => checkItemReferences(item, ["items", String(index)], report, itemIds));

  for (const field of ["background", "originalClass"]) {
    const id = stringId(actor?.system?.details?.[field]);
    if (id && DOCUMENT_ID_PATTERN.test(id) && !itemIds.has(id)) {
      addReferenceError(report, `Actor system.details.${field} references missing embedded Item ${id}.`);
    }
  }

  for (const favorite of Array.isArray(actor?.system?.favorites) ? actor.system.favorites : []) {
    const id = stringId(favorite?.id);
    if (!id) continue;
    const itemMatch = id.match(/(?:^|\.)Item\.([A-Za-z0-9]{16})/);
    if (itemMatch && !itemIds.has(itemMatch[1])) {
      addReferenceError(report, `Actor favorite references missing embedded Item ${itemMatch[1]}.`);
      continue;
    }
    const activityMatch = id.match(/\.Activity\.([A-Za-z0-9]{16})/);
    if (itemMatch && activityMatch) {
      const item = itemsById.get(itemMatch[1]);
      if (item && !itemActivityIds(item).has(activityMatch[1])) {
        addReferenceError(report, `Actor favorite references missing Activity ${activityMatch[1]} on Item ${itemMatch[1]}.`);
      }
    }
  }
}

function checkGenericLocalReferences(documentName, data, identity, report, targetUuid = null) {
  const defined = {
    Item: new Set(identity.nodes.filter(node => node.kind === "Embedded Item").map(node => node.id)),
    Activity: new Set(identity.nodes.filter(node => node.kind === "Activity").map(node => node.id)),
    ActiveEffect: new Set(identity.nodes.filter(node => node.kind === "Active Effect").map(node => node.id)),
    Behavior: new Set(identity.nodes.filter(node => node.kind === "Activity Behavior").map(node => node.id)),
    Profile: new Set(identity.nodes.filter(node => node.kind === "Activity Profile").map(node => node.id)),
    Advancement: new Set(identity.nodes.filter(node => node.kind === "Advancement").map(node => node.id)),
    Actor: new Set()
  };
  if (documentName === "Item" && stringId(data?._id)) defined.Item.add(data._id);
  if (documentName === "Actor" && stringId(data?._id)) defined.Actor.add(data._id);

  const requireRawId = (value, kind, path) => {
    const id = stringId(value);
    if (!id || !DOCUMENT_ID_PATTERN.test(id)) return;
    if (!defined[kind]?.has(id)) addReferenceError(report, `${path} references missing ${kind} ${id}.`);
  };

  const validateSegments = (text, path) => {
    const segmentPattern = /(?:^|\.)(Item|Activity|ActiveEffect)\.([A-Za-z0-9]{16})/g;
    for (const match of text.matchAll(segmentPattern)) {
      const [, kind, id] = match;
      if (!defined[kind]?.has(id)) {
        addReferenceError(report, `Local UUID at ${path} references missing ${kind} ${id}.`);
      }
    }
  };

  walkStrings(data, (text, path) => {
    for (const relative of text.matchAll(RELATIVE_UUID_PATTERN)) {
      const full = relative[0];
      const kind = full.startsWith(".Item.") ? "Item" : full.startsWith(".Activity.") ? "Activity" : "ActiveEffect";
      if (!defined[kind]?.has(relative[1])) {
        addReferenceError(report, `Relative UUID at ${path} references missing ${kind} ${relative[1]}.`);
      }
    }
    const origin = path.match(/\.system\.origin\.(actor|activity|behavior|effect|item|profile)$/);
    if (origin) {
      const kind = {
        actor: "Actor",
        activity: "Activity",
        behavior: "Behavior",
        effect: "ActiveEffect",
        item: "Item",
        profile: "Profile"
      }[origin[1]];
      requireRawId(text, kind, path);
    }

    if (path.endsWith("flags.dnd5e.dependentOn")) requireRawId(text, "ActiveEffect", path);
    if (path.endsWith("flags.dnd5e.advancementRoot") || path.endsWith("flags.dnd5e.advancementOrigin")) {
      const ids = text.match(/[A-Za-z0-9]{16}/g) ?? [];
      if (ids.length >= 1) requireRawId(ids[0], "Item", path);
      if (ids.length >= 2) requireRawId(ids[1], "Advancement", path);
    }

    if (!targetUuid) return;
    for (const match of text.matchAll(FULL_UUID_PATTERN)) {
      if (match[0] === targetUuid || !match[0].startsWith(`${targetUuid}.`)) continue;
      validateSegments(match[0].slice(targetUuid.length), path);
    }
  });
}

function walkStrings(value, callback, path = []) {
  if (typeof value === "string") {
    callback(value, pathText(path));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) walkStrings(child, callback, [...path, key]);
}

function collectExternalUuids(data) {
  const uuids = new Map();
  walkStrings(data, (text, path) => {
    for (const match of text.matchAll(FULL_UUID_PATTERN)) {
      const uuid = match[0];
      const paths = uuids.get(uuid) ?? new Set();
      paths.add(path);
      uuids.set(uuid, paths);
    }
  });
  return uuids;
}

function removedIdReferences(data, removed) {
  const references = [];
  if (!removed.length) return references;
  walkStrings(data, (text, path) => {
    for (const node of removed) {
      if (!text.includes(node.id)) continue;
      references.push({ id: node.id, kind: node.kind, path, text });
    }
  });
  return references;
}

function compareIdentifiers(documentName, current, incoming) {
  const changes = [];
  const compare = (before, after, path) => {
    const oldValue = String(before?.system?.identifier ?? "").trim();
    const newValue = String(after?.system?.identifier ?? "").trim();
    if (oldValue !== newValue) changes.push({ path, before: oldValue, after: newValue });
  };
  if (documentName === "Item") {
    compare(current, incoming, "system.identifier");
    return changes;
  }

  const beforeItems = new Map(values(current?.items).map(item => [item?._id, item]));
  for (const item of values(incoming?.items)) {
    const before = beforeItems.get(item?._id);
    if (before) compare(before, item, `items.${item._id}.system.identifier`);
  }
  return changes;
}

function replacementPairs(removed, added) {
  const used = new Set();
  const pairs = [];
  for (const oldNode of removed) {
    if (!oldNode.semantic) continue;
    const index = added.findIndex((newNode, candidateIndex) => (
      !used.has(candidateIndex)
      && newNode.kind === oldNode.kind
      && newNode.scope === oldNode.scope
      && newNode.semantic === oldNode.semantic
    ));
    if (index < 0) continue;
    used.add(index);
    pairs.push({ kind: oldNode.kind, scope: oldNode.scope, before: oldNode.id, after: added[index].id, semantic: oldNode.semantic });
  }
  return pairs;
}

function protectedRoot(current, incoming) {
  const output = cloneData(incoming);
  output._id = current._id;
  output.folder = cloneData(current.folder ?? null);
  output.sort = current.sort ?? 0;
  output.ownership = cloneData(current.ownership ?? {});

  const currentStats = current._stats ?? {};
  const importedStats = output._stats ?? {};
  output._stats = {
    ...importedStats,
    createdTime: currentStats.createdTime ?? importedStats.createdTime ?? null,
    compendiumSource: currentStats.compendiumSource ?? null,
    duplicateSource: currentStats.duplicateSource ?? null
  };
  return output;
}

function parsePayload(payload) {
  if (typeof payload === "string" && payload.length > MAX_IMPORT_CHARACTERS) {
    throw new Error("The selected JSON data exceeds AE5E's 25 MB import limit.");
  }
  const parsed = typeof payload === "string" ? JSON.parse(payload) : cloneData(payload);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The selected JSON file does not contain a document object.");
  }
  const assertSafeKeys = (value, path = []) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (UNSAFE_KEYS.has(key)) throw new Error(`Unsafe JSON key "${key}" at ${pathText([...path, key])}.`);
      assertSafeKeys(child, [...path, key]);
    }
  };
  assertSafeKeys(parsed);

  if (parsed._ae5e?.format === COMPENDIUM_DATA_FORMAT) {
    if (parsed._ae5e.version !== COMPENDIUM_DATA_FORMAT_VERSION) {
      throw new Error(`Unsupported AE5E compendium data format version ${String(parsed._ae5e.version)}.`);
    }
    if (!parsed.document || typeof parsed.document !== "object" || Array.isArray(parsed.document)) {
      throw new Error("The AE5E export does not contain a valid document payload.");
    }
    return { metadata: cloneData(parsed._ae5e), document: cloneData(parsed.document), wrapped: true };
  }
  return { metadata: null, document: parsed, wrapped: false };
}

function safeFilename(value) {
  return String(value ?? "document")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "document";
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function comparableDocumentData(data) {
  const comparable = cloneData(data);
  delete comparable._stats;
  return comparable;
}

export class CompendiumDataService {
  #gameAccessor;
  #fromUuid;
  #saveData;
  #stats = {
    exports: 0,
    exportErrors: 0,
    importPreviews: 0,
    imports: 0,
    importErrors: 0,
    rollbacks: 0,
    rollbackErrors: 0,
    blockedImports: 0
  };

  constructor({
    gameAccessor = defaultGameAccessor,
    fromUuidAccessor = defaultFromUuid,
    saveDataAccessor = null
  } = {}) {
    this.#gameAccessor = typeof gameAccessor === "function" ? gameAccessor : defaultGameAccessor;
    this.#fromUuid = typeof fromUuidAccessor === "function" ? fromUuidAccessor : defaultFromUuid;
    this.#saveData = typeof saveDataAccessor === "function" ? saveDataAccessor : null;
  }

  createExport(document) {
    this.#assertGm();
    this.#assertSupportedDocument(document);
    const data = sourceData(document);
    if (!data?._stats) throw new Error("The document has no _stats data and cannot be exported safely.");
    const pack = document.pack ?? null;
    if (!pack) throw new Error("AE5E compendium data export requires a document stored in a compendium.");

    const payload = {
      _ae5e: {
        format: COMPENDIUM_DATA_FORMAT,
        version: COMPENDIUM_DATA_FORMAT_VERSION,
        documentName: document.documentName,
        sourceUuid: document.uuid ?? null,
        sourcePack: pack,
        sourceId: document.id ?? data._id ?? null,
        sourceModifiedTime: data._stats?.modifiedTime ?? null,
        exportedAt: Date.now()
      },
      document: data
    };
    const filename = `${safeFilename(document.documentName)}-${safeFilename(document.name)}-${safeFilename(document.id)}.json`;
    return { payload, text: JSON.stringify(payload, null, 2), filename };
  }

  exportDocument(document) {
    try {
      const result = this.createExport(document);
      const save = this.#saveData
        ?? globalThis.foundry?.utils?.saveDataToFile
        ?? globalThis.saveDataToFile;
      if (typeof save !== "function") throw new Error("Foundry's file download service is unavailable.");
      save(result.text, "application/json", result.filename);
      this.#stats.exports += 1;
      return result;
    } catch (error) {
      this.#stats.exportErrors += 1;
      throw error;
    }
  }

  audit(documentName, current, incoming, { metadata = null } = {}) {
    if (!COMPENDIUM_DATA_DOCUMENT_TYPES.includes(documentName)) {
      throw new Error(`Unsupported compendium document type "${String(documentName)}".`);
    }
    const currentIdentity = collectIdentity(documentName, current);
    const incomingIdentity = collectIdentity(documentName, incoming);
    const errors = [...incomingIdentity.errors];
    const warnings = [];

    const added = incomingIdentity.nodes.filter(node => !currentIdentity.byKey.has(node.key));
    const removed = currentIdentity.nodes.filter(node => !incomingIdentity.byKey.has(node.key));
    const retained = incomingIdentity.nodes.filter(node => currentIdentity.byKey.has(node.key));
    const replacements = replacementPairs(removed, added);
    for (const replacement of replacements) {
      errors.push(`${replacement.kind} appears to have changed _id from ${replacement.before} to ${replacement.after}. Restore the existing _id or create a genuinely new entry.`);
    }

    const references = { errors: [] };
    if (documentName === "Actor") checkActorReferences(incoming, references);
    else checkItemReferences(incoming, [], references);
    checkGenericLocalReferences(documentName, incoming, incomingIdentity, references, metadata?.targetUuid ?? null);
    errors.push(...references.errors);

    const identifierChanges = compareIdentifiers(documentName, current, incoming);
    identifierChanges.forEach(change => warnings.push(
      `${change.path} changes from "${change.before || "(blank)"}" to "${change.after || "(blank)"}".`
    ));

    const lingeringRemovedReferences = removedIdReferences(incoming, removed);
    lingeringRemovedReferences.forEach(reference => warnings.push(
      `Removed ${reference.kind} ID ${reference.id} still appears in ${reference.path}; review this module or macro reference.`
    ));

    const stale = metadata?.sourceModifiedTime != null
      && current?._stats?.modifiedTime != null
      && Number(metadata.sourceModifiedTime) !== Number(current._stats.modifiedTime);
    if (stale) warnings.push("The selected compendium entry changed after this file was exported.");

    if (metadata?.sourceUuid && metadata.sourceUuid !== metadata.targetUuid) {
      warnings.push(`This file was exported from ${metadata.sourceUuid}, not the currently selected entry ${metadata.targetUuid}.`);
    }

    return {
      valid: errors.length === 0,
      errors: [...new Set(errors)],
      warnings: [...new Set(warnings)],
      added,
      removed,
      retained,
      replacements,
      identifierChanges,
      lingeringRemovedReferences,
      stale,
      deletionsRequireConfirmation: removed.length > 0,
      summary: {
        added: added.length,
        removed: removed.length,
        retained: retained.length,
        replacements: replacements.length,
        identifierChanges: identifierChanges.length,
        errors: new Set(errors).size,
        warnings: new Set(warnings).size
      }
    };
  }

  async prepareImport(target, payload) {
    this.#assertGm();
    this.#assertSupportedDocument(target);
    if (!target.pack) throw new Error("AE5E compendium data import requires a document stored in a compendium.");
    const pack = this.#resolvePack(target.pack);
    if (!pack) throw new Error(`Compendium pack "${target.pack}" is unavailable.`);
    if (pack.locked) throw new Error(`Unlock compendium "${pack.metadata?.label ?? target.pack}" before importing data.`);

    const parsed = parsePayload(payload);
    if (parsed.metadata?.documentName && parsed.metadata.documentName !== target.documentName) {
      throw new Error(`Cannot import ${parsed.metadata.documentName} data over a ${target.documentName}.`);
    }
    if (!parsed.document._stats) {
      throw new Error("The imported document is missing _stats and cannot be migrated safely.");
    }
    if (parsed.document.type !== target.type) {
      throw new Error(`Subtype mismatch: the selected ${target.documentName} is "${target.type}", but the imported data is "${parsed.document.type}".`);
    }

    const DocumentClass = target.constructor;
    if (typeof DocumentClass?.fromImport !== "function") {
      throw new Error(`${target.documentName}.fromImport is unavailable; the JSON cannot be migrated safely.`);
    }
    const migrated = await DocumentClass.fromImport(cloneData(parsed.document), { pack: target.pack });
    const migratedData = sourceData(migrated);
    if (migratedData.type !== target.type) {
      throw new Error(`Migrated subtype mismatch: expected "${target.type}" but received "${migratedData.type}".`);
    }

    const before = sourceData(target);
    let candidateData = protectedRoot(before, migratedData);
    const candidateDocument = this.#constructDocument(DocumentClass, candidateData, target.pack);
    candidateData = sourceData(candidateDocument);
    const report = this.audit(target.documentName, before, candidateData, {
      metadata: {
        ...parsed.metadata,
        targetUuid: target.uuid ?? null
      }
    });

    const externalWarnings = await this.#externalReferenceWarnings(candidateData, target.uuid, target.documentName);
    report.warnings.push(...externalWarnings);
    report.warnings = [...new Set(report.warnings)];
    report.summary.warnings = report.warnings.length;
    report.valid = report.errors.length === 0;

    this.#stats.importPreviews += 1;
    if (!report.valid) this.#stats.blockedImports += 1;
    return {
      target,
      pack,
      before,
      candidateData,
      candidateDocument,
      metadata: parsed.metadata,
      wrapped: parsed.wrapped,
      report
    };
  }

  async commitImport(prepared) {
    this.#assertGm();
    const { target, pack, before, candidateDocument, candidateData, report } = prepared ?? {};
    this.#assertSupportedDocument(target);
    if (!report?.valid) throw new Error("The import contains blocking identity or reference errors.");
    if (!pack || pack.locked) throw new Error("The compendium must remain unlocked while importing data.");
    if (typeof pack.importDocument !== "function") throw new Error("The compendium does not support document replacement.");

    let mutationAttempted = false;
    try {
      mutationAttempted = true;
      await pack.importDocument(candidateDocument, { ...REPLACEMENT_OPTIONS });
      const imported = await pack.getDocument(target.id);
      const verification = this.verifyImport(target, before, candidateData, imported, report);
      if (!verification.valid) throw new Error(`Post-import verification failed: ${verification.errors.join(" ")}`);
      this.#stats.imports += 1;
      return { imported, verification, report };
    } catch (error) {
      this.#stats.importErrors += 1;
      if (mutationAttempted) {
        try {
          const rollbackDocument = this.#constructDocument(target.constructor, before, target.pack);
          await pack.importDocument(rollbackDocument, { ...REPLACEMENT_OPTIONS });
          const restored = await pack.getDocument(target.id);
          const restoredData = sourceData(restored);
          if (restoredData._id !== before._id || restoredData.type !== before.type) {
            throw new Error("Rollback verification did not restore the original identity.");
          }
          this.#stats.rollbacks += 1;
        } catch (rollbackError) {
          this.#stats.rollbackErrors += 1;
          throw new Error(`Import failed (${error?.message ?? String(error)}) and rollback also failed (${rollbackError?.message ?? String(rollbackError)}).`);
        }
      }
      throw error;
    }
  }

  verifyImport(target, before, candidate, imported, report) {
    const errors = [];
    if (!imported) errors.push("The replaced document could not be reloaded.");
    const after = imported ? sourceData(imported) : null;
    if (after?._id !== before?._id) errors.push("The root _id changed.");
    if (imported?.uuid && target?.uuid && imported.uuid !== target.uuid) errors.push("The root UUID changed.");
    if (after?.type !== before?.type) errors.push("The document subtype changed.");
    if (JSON.stringify(after?.folder ?? null) !== JSON.stringify(before?.folder ?? null)) errors.push("The compendium folder changed.");
    if ((after?.sort ?? 0) !== (before?.sort ?? 0)) errors.push("The compendium sort position changed.");
    if (JSON.stringify(after?.ownership ?? {}) !== JSON.stringify(before?.ownership ?? {})) errors.push("The ownership data changed.");
    if (after?._stats?.createdTime !== before?._stats?.createdTime) errors.push("The creation timestamp changed.");
    if ((after?._stats?.compendiumSource ?? null) !== (before?._stats?.compendiumSource ?? null)) errors.push("The compendium source provenance changed.");
    if ((after?._stats?.duplicateSource ?? null) !== (before?._stats?.duplicateSource ?? null)) errors.push("The duplicate source provenance changed.");
    if (after && stableStringify(comparableDocumentData(after)) !== stableStringify(comparableDocumentData(candidate))) {
      errors.push("The persisted document does not match the validated import data.");
    }

    if (after) {
      const afterIdentity = collectIdentity(target.documentName, after);
      for (const node of report?.retained ?? []) {
        if (!afterIdentity.byKey.has(node.key)) errors.push(`Retained ${node.kind} ${node.id} was not preserved.`);
      }
      const referenceReport = { errors: [] };
      if (target.documentName === "Actor") checkActorReferences(after, referenceReport);
      else checkItemReferences(after, [], referenceReport);
      errors.push(...afterIdentity.errors, ...referenceReport.errors);
    }
    return { valid: errors.length === 0, errors: [...new Set(errors)], after };
  }

  getStatus() {
    return {
      format: COMPENDIUM_DATA_FORMAT,
      formatVersion: COMPENDIUM_DATA_FORMAT_VERSION,
      documentTypes: [...COMPENDIUM_DATA_DOCUMENT_TYPES],
      gmOnly: true,
      preservesRootIdentity: true,
      requiresUnlockedImportPack: true,
      supportsLockedPackExport: true
    };
  }

  getStats() {
    return { ...this.#stats, status: this.getStatus() };
  }

  #constructDocument(DocumentClass, data, pack) {
    if (typeof DocumentClass?.fromSource === "function") {
      return DocumentClass.fromSource(cloneData(data), { pack, strict: true });
    }
    return new DocumentClass(cloneData(data), { pack, strict: true });
  }

  async #externalReferenceWarnings(data, targetUuid, documentName) {
    const warnings = [];
    const uuids = collectExternalUuids(data);
    for (const [uuid, paths] of uuids) {
      if (uuid === targetUuid || (targetUuid && uuid.startsWith(`${targetUuid}.`))) continue;
      try {
        const resolved = await this.#fromUuid(uuid);
        if (!resolved) warnings.push(`External UUID ${uuid} could not be resolved (${[...paths].join(", ")}).`);
      } catch {
        warnings.push(`External UUID ${uuid} could not be resolved (${[...paths].join(", ")}).`);
      }
    }

    return [...new Set(warnings)];
  }

  #resolvePack(id) {
    const packs = this.#gameAccessor()?.packs;
    if (typeof packs?.get === "function") return packs.get(id) ?? null;
    return null;
  }

  #assertSupportedDocument(document) {
    if (!document || !COMPENDIUM_DATA_DOCUMENT_TYPES.includes(document.documentName)) {
      throw new Error("AE5E compendium data tools support Actor and Item documents only.");
    }
  }

  #assertGm() {
    if (!this.#gameAccessor()?.user?.isGM) throw new Error("AE5E compendium data tools require a GM user.");
  }
}
