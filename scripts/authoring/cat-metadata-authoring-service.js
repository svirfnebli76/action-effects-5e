import { MODULE_ID } from "../core/constants.js";

const CAT_AUTOMATION_SOURCE_ID = MODULE_ID;

export const CAT_AUTOMATION_SOURCE_FLAG = "flags.cat.automation.source";
export const CAT_AUTOMATION_VERSION_FLAG = "flags.cat.automation.version";

export const CAT_PUBLIC_AUTOMATION_PACK_IDS = Object.freeze([
  `${MODULE_ID}.spells-cantrips`,
  `${MODULE_ID}.spells-level-1`,
  `${MODULE_ID}.spells-level-2`,
  `${MODULE_ID}.spells-level-3`,
  `${MODULE_ID}.spells-level-4`,
  `${MODULE_ID}.spells-level-5`,
  `${MODULE_ID}.spells-level-6`,
  `${MODULE_ID}.spells-level-7`,
  `${MODULE_ID}.spells-level-8`,
  `${MODULE_ID}.spells-level-9`,
  `${MODULE_ID}.actions-common`
]);

export const CAT_INTERNAL_PACK_IDS = Object.freeze([
  `${MODULE_ID}.ae5e-administrative`
]);

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function defaultFromUuid(uuid) {
  if (typeof globalThis.fromUuid !== "function") return null;
  return globalThis.fromUuid(uuid);
}

function defaultPacksAccessor() {
  return globalThis.game?.packs ?? null;
}

function defaultUserAccessor() {
  return globalThis.game?.user ?? null;
}

function collectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return [...collection];
  if (typeof collection.values === "function") {
    try { return [...collection.values()]; } catch { /* fall through */ }
  }
  if (typeof collection[Symbol.iterator] === "function") {
    try { return [...collection]; } catch { /* fall through */ }
  }
  return [];
}

function packId(pack) {
  return pack?.collection ?? pack?.metadata?.id ?? null;
}

function packLabel(pack) {
  return pack?.metadata?.label ?? pack?.title ?? packId(pack) ?? "Unknown Pack";
}

export function isValidAutomationVersion(value) {
  return typeof value === "string" && SEMVER_PATTERN.test(value.trim());
}

export class CatMetadataAuthoringService {
  #fromUuid;
  #packsAccessor;
  #userAccessor;
  #stats = {
    metadataWrites: 0,
    metadataWriteErrors: 0,
    compendiumUnlocks: 0,
    compendiumRelocks: 0,
    itemAudits: 0,
    packAudits: 0,
    publicPackAudits: 0
  };

  constructor({
    fromUuidAccessor = defaultFromUuid,
    packsAccessor = defaultPacksAccessor,
    userAccessor = defaultUserAccessor
  } = {}) {
    this.#fromUuid = typeof fromUuidAccessor === "function" ? fromUuidAccessor : defaultFromUuid;
    this.#packsAccessor = typeof packsAccessor === "function" ? packsAccessor : defaultPacksAccessor;
    this.#userAccessor = typeof userAccessor === "function" ? userAccessor : defaultUserAccessor;
  }

  isValidVersion(value) {
    return isValidAutomationVersion(value);
  }

  validateItem(document) {
    const errors = [];
    const identifier = String(document?.system?.identifier ?? "").trim();
    const rules = String(document?.system?.source?.rules ?? "").trim();
    const type = document?.type ?? null;

    if (!document || document.documentName !== "Item") errors.push("Target must be an Item document.");
    if (!identifier) errors.push("Missing system.identifier.");
    if (rules !== "2014" && rules !== "2024") errors.push("system.source.rules must be 2014 or 2024.");
    if (!type) errors.push("Missing Item type.");

    return {
      valid: errors.length === 0,
      identifier,
      rules,
      type,
      errors
    };
  }

  auditDocument(document) {
    const core = this.validateItem(document);
    const source = document?.flags?.cat?.automation?.source ?? null;
    const version = document?.flags?.cat?.automation?.version ?? null;
    const issues = [...core.errors];

    if (source !== CAT_AUTOMATION_SOURCE_ID) {
      issues.push(
        source
          ? `Unexpected CAT automation source: ${source}.`
          : `Missing ${CAT_AUTOMATION_SOURCE_FLAG}.`
      );
    }

    if (!isValidAutomationVersion(version)) {
      issues.push(
        version
          ? `Invalid CAT automation version: ${version}.`
          : `Missing ${CAT_AUTOMATION_VERSION_FLAG}.`
      );
    }

    return {
      id: document?.id ?? null,
      uuid: document?.uuid ?? null,
      name: document?.name ?? null,
      identifier: core.identifier,
      rules: core.rules,
      type: core.type,
      source,
      version,
      valid: issues.length === 0,
      issues
    };
  }

  async auditItem(documentOrUuid) {
    const document = await this.#resolveItem(documentOrUuid);
    this.#stats.itemAudits += 1;
    return this.auditDocument(document);
  }

  async setMetadata(documentOrUuid, { version, identifier = undefined, rules = undefined } = {}) {
    this.#assertGm();
    const document = await this.#resolveItem(documentOrUuid);

    const normalizedIdentifier = String(identifier ?? document?.system?.identifier ?? "").trim();
    const normalizedRules = String(rules ?? document?.system?.source?.rules ?? "").trim();
    const normalizedVersion = String(version ?? "").trim();
    const prospective = {
      documentName: "Item",
      type: document?.type ?? null,
      system: {
        identifier: normalizedIdentifier,
        source: { rules: normalizedRules }
      }
    };
    const core = this.validateItem(prospective);
    if (!core.valid) {
      throw new Error(`Item metadata validation failed: ${core.errors.join(" ")}`);
    }

    if (!isValidAutomationVersion(normalizedVersion)) {
      throw new Error(`Invalid automation version "${normalizedVersion}". Expected SemVer such as 1.0.0.`);
    }

    const currentSource = document?.flags?.cat?.automation?.source ?? null;
    if (currentSource && currentSource !== CAT_AUTOMATION_SOURCE_ID) {
      throw new Error(`Refusing to replace CAT automation source "${currentSource}" with "${CAT_AUTOMATION_SOURCE_ID}".`);
    }

    if (typeof document.update !== "function") {
      throw new Error("Target Item cannot be updated.");
    }

    const changes = {
      [CAT_AUTOMATION_SOURCE_FLAG]: CAT_AUTOMATION_SOURCE_ID,
      [CAT_AUTOMATION_VERSION_FLAG]: normalizedVersion
    };
    if (document.system?.identifier !== normalizedIdentifier) changes["system.identifier"] = normalizedIdentifier;
    if (document.system?.source?.rules !== normalizedRules) changes["system.source.rules"] = normalizedRules;

    const pack = document.pack ? this.#resolvePack(document.pack) : null;
    const wasLocked = Boolean(pack?.locked);
    let unlocked = false;

    try {
      if (wasLocked) {
        if (typeof pack?.configure !== "function") {
          throw new Error(`Compendium pack "${document.pack}" is locked and cannot be temporarily unlocked for metadata authoring.`);
        }
        await pack.configure({ locked: false });
        unlocked = true;
        this.#stats.compendiumUnlocks += 1;
      }

      await document.update(changes);
      this.#stats.metadataWrites += 1;
    } catch (error) {
      this.#stats.metadataWriteErrors += 1;
      throw error;
    } finally {
      if (wasLocked && unlocked) {
        try {
          await pack.configure({ locked: true });
          this.#stats.compendiumRelocks += 1;
        } catch (error) {
          this.#stats.metadataWriteErrors += 1;
          throw new Error(`CAT metadata was written, but AE5E could not re-lock compendium "${document.pack}": ${error?.message ?? String(error)}`);
        }
      }
    }

    return {
      document,
      metadata: {
        source: document.flags?.cat?.automation?.source ?? null,
        version: document.flags?.cat?.automation?.version ?? null,
        identifier: document.system?.identifier ?? null,
        rules: document.system?.source?.rules ?? null,
        type: document.type ?? null
      },
      audit: this.auditDocument(document)
    };
  }

  async auditPack(packOrId) {
    const pack = this.#resolvePack(packOrId);
    if (!pack) throw new Error(`Compendium pack "${String(packOrId ?? "")}" was not found.`);
    if (pack?.metadata?.type && pack.metadata.type !== "Item") {
      throw new Error(`Compendium pack "${packId(pack)}" is not an Item pack.`);
    }
    if (typeof pack.getDocuments !== "function") {
      throw new Error(`Compendium pack "${packId(pack)}" cannot provide documents.`);
    }

    const documents = await pack.getDocuments();
    const items = collectionValues(documents).map(document => this.auditDocument(document));
    this.#stats.packAudits += 1;

    return {
      pack: packId(pack),
      label: packLabel(pack),
      total: items.length,
      valid: items.filter(entry => entry.valid).length,
      invalid: items.filter(entry => !entry.valid).length,
      items
    };
  }

  async auditPublicPacks({ packIds = CAT_PUBLIC_AUTOMATION_PACK_IDS } = {}) {
    const reports = [];
    const missingPacks = [];

    for (const id of packIds) {
      const pack = this.#resolvePack(id);
      if (!pack) {
        missingPacks.push(id);
        continue;
      }
      reports.push(await this.auditPack(pack));
    }

    const items = reports.flatMap(report => report.items.map(item => ({ ...item, pack: report.pack, packLabel: report.label })));
    this.#stats.publicPackAudits += 1;

    return {
      packIds: [...packIds],
      excludedInternalPacks: [...CAT_INTERNAL_PACK_IDS],
      packsAudited: reports.length,
      missingPacks,
      total: items.length,
      valid: items.filter(entry => entry.valid).length,
      invalid: items.filter(entry => !entry.valid).length,
      reports,
      items
    };
  }

  getStatus() {
    return {
      source: CAT_AUTOMATION_SOURCE_ID,
      versionFormat: "SemVer",
      requiredItemMetadata: ["system.identifier", "system.source.rules", "type"],
      sourceFlag: CAT_AUTOMATION_SOURCE_FLAG,
      versionFlag: CAT_AUTOMATION_VERSION_FLAG,
      publicPacks: [...CAT_PUBLIC_AUTOMATION_PACK_IDS],
      excludedInternalPacks: [...CAT_INTERNAL_PACK_IDS]
    };
  }

  getStats() {
    return {
      ...this.#stats,
      status: this.getStatus()
    };
  }

  async #resolveItem(documentOrUuid) {
    let document = documentOrUuid;
    if (typeof documentOrUuid === "string") document = await this.#fromUuid(documentOrUuid);
    if (!document || document.documentName !== "Item") {
      throw new Error("Target must resolve to an Item document.");
    }
    return document;
  }

  #resolvePack(packOrId) {
    if (packOrId && typeof packOrId === "object" && typeof packOrId.getDocuments === "function") return packOrId;
    const id = String(packOrId ?? "").trim();
    if (!id) return null;
    const packs = this.#packsAccessor();
    return packs?.get?.(id) ?? collectionValues(packs).find(pack => packId(pack) === id) ?? null;
  }

  #assertGm() {
    const user = this.#userAccessor();
    if (!user?.isGM) throw new Error("AE5E CAT metadata authoring requires a GM user.");
  }
}
