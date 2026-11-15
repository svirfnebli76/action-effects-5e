import { MODULE_ID } from "../core/constants.js";
import { Logger } from "../core/logger.js";
import { COMPENDIUM_DATA_DOCUMENT_TYPES } from "./compendium-data-service.js";

export const COMPENDIUM_DATA_CONTEXT_WRAPPER_TARGET =
  "foundry.applications.sidebar.apps.Compendium.prototype._getEntryContextOptions";
export const COMPENDIUM_EXPORT_CONTEXT_LABEL = "Export Data";
export const COMPENDIUM_IMPORT_CONTEXT_LABEL = "Import Data";

function defaultGameAccessor() {
  return globalThis.game ?? null;
}

function defaultLibWrapperAccessor() {
  return globalThis.libWrapper ?? null;
}

function normalizeElement(target) {
  if (!target) return null;
  const HTMLElementClass = globalThis.HTMLElement;
  if (!HTMLElementClass) return target?.[0] ?? target?.element ?? target ?? null;
  if (target instanceof HTMLElementClass) return target;
  if (target?.[0] instanceof HTMLElementClass) return target[0];
  return target?.element instanceof HTMLElementClass ? target.element : null;
}

function escapeHtml(value) {
  const text = String(value ?? "");
  const escape = globalThis.foundry?.utils?.escapeHTML;
  if (typeof escape === "function") return escape(text);
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fileText(file) {
  if (typeof file?.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Could not read the selected JSON file.")));
    reader.readAsText(file);
  });
}

function selectJsonFile() {
  return new Promise(resolve => {
    const input = globalThis.document?.createElement?.("input");
    if (!input) return resolve(null);
    input.type = "file";
    input.accept = ".json,application/json";
    input.style.display = "none";
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      input.remove?.();
      resolve(value);
    };
    input.addEventListener("change", () => finish(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => finish(null), { once: true });
    globalThis.document?.body?.append?.(input);
    input.click();
  });
}

export class CompendiumDataContextMenuService {
  #dataService;
  #gameAccessor;
  #libWrapperAccessor;
  #selectFile;
  #initialized = false;
  #wrapperRegistered = false;
  #wrapperId = null;
  #lastError = null;
  #stats = {
    initializeCalls: 0,
    duplicateInitializeCalls: 0,
    wrapperRegistrations: 0,
    wrapperRegistrationErrors: 0,
    contextMenusExtended: 0,
    exportClicks: 0,
    importClicks: 0,
    importCancels: 0,
    blockedImports: 0
  };

  constructor({
    dataService,
    gameAccessor = defaultGameAccessor,
    libWrapperAccessor = defaultLibWrapperAccessor,
    selectFileAccessor = selectJsonFile
  } = {}) {
    if (!dataService) throw new Error("CompendiumDataContextMenuService requires a compendium data service.");
    this.#dataService = dataService;
    this.#gameAccessor = typeof gameAccessor === "function" ? gameAccessor : defaultGameAccessor;
    this.#libWrapperAccessor = typeof libWrapperAccessor === "function" ? libWrapperAccessor : defaultLibWrapperAccessor;
    this.#selectFile = typeof selectFileAccessor === "function" ? selectFileAccessor : selectJsonFile;
  }

  initialize() {
    this.#stats.initializeCalls += 1;
    if (this.#initialized) {
      this.#stats.duplicateInitializeCalls += 1;
      return this.getStatus();
    }
    this.#initialized = true;
    const libWrapper = this.#libWrapperAccessor();
    if (typeof libWrapper?.register !== "function") {
      this.#recordWrapperError(new Error("libWrapper is unavailable; AE5E compendium data context options could not be installed."));
      return this.getStatus();
    }

    try {
      const service = this;
      this.#wrapperId = libWrapper.register(
        MODULE_ID,
        COMPENDIUM_DATA_CONTEXT_WRAPPER_TARGET,
        function ae5eCompendiumDataContextWrapper(wrapped, ...args) {
          return service.extendContextOptions(this, wrapped(...args));
        },
        "WRAPPER"
      );
      this.#wrapperRegistered = true;
      this.#stats.wrapperRegistrations += 1;
      Logger.info("Compendium Actor/Item data context menu initialized.");
    } catch (error) {
      this.#recordWrapperError(error);
    }
    return this.getStatus();
  }

  isEligiblePack(pack) {
    return Boolean(
      this.#gameAccessor()?.user?.isGM
      && COMPENDIUM_DATA_DOCUMENT_TYPES.includes(pack?.metadata?.type ?? pack?.documentName)
    );
  }

  extendContextOptions(app, baseOptions = []) {
    const options = Array.isArray(baseOptions) ? [...baseOptions] : [];
    if (!this.isEligiblePack(app?.collection)) return options;
    let added = false;
    if (!options.some(option => option?.ae5eExportData === true)) {
      options.push({
        ae5eExportData: true,
        label: COMPENDIUM_EXPORT_CONTEXT_LABEL,
        icon: "fa-solid fa-file-export",
        visible: () => this.isEligiblePack(app?.collection),
        onClick: async (_event, target) => this.exportFromContext(app, target)
      });
      added = true;
    }
    if (!options.some(option => option?.ae5eImportData === true)) {
      options.push({
        ae5eImportData: true,
        label: COMPENDIUM_IMPORT_CONTEXT_LABEL,
        icon: "fa-solid fa-file-import",
        visible: () => this.isEligiblePack(app?.collection),
        onClick: async (_event, target) => this.importFromContext(app, target)
      });
      added = true;
    }
    if (added) this.#stats.contextMenusExtended += 1;
    return options;
  }

  async exportFromContext(app, target) {
    try {
      const document = await this.#resolveContextDocument(app, target);
      const result = this.#dataService.exportDocument(document);
      this.#stats.exportClicks += 1;
      globalThis.ui?.notifications?.info?.(`Exported ${document.documentName} data for ${document.name}.`);
      return result;
    } catch (error) {
      globalThis.ui?.notifications?.error?.(`AE5E export failed: ${error?.message ?? String(error)}`);
      throw error;
    }
  }

  async importFromContext(app, target) {
    try {
      const document = await this.#resolveContextDocument(app, target);
      const pack = app?.collection;
      if (pack?.locked) throw new Error(`Unlock compendium "${pack.metadata?.label ?? pack.collection}" before importing data.`);
      const file = await this.#selectFile();
      if (!file) {
        this.#stats.importCancels += 1;
        return { imported: false, cancelled: true };
      }
      if (Number(file.size ?? 0) > 25 * 1024 * 1024) throw new Error("The selected JSON file exceeds AE5E's 25 MB import limit.");
      const prepared = await this.#dataService.prepareImport(document, await fileText(file));
      this.#stats.importClicks += 1;
      const accepted = await this.#showPreview(document, prepared.report);
      if (!accepted) {
        this.#stats.importCancels += 1;
        if (!prepared.report.valid) this.#stats.blockedImports += 1;
        return { imported: false, cancelled: true, prepared };
      }
      const result = await this.#dataService.commitImport(prepared);
      globalThis.ui?.notifications?.info?.(`Imported ${document.documentName} data for ${document.name}; UUID preserved.`);
      return { imported: true, cancelled: false, prepared, result };
    } catch (error) {
      globalThis.ui?.notifications?.error?.(`AE5E import failed: ${error?.message ?? String(error)}`);
      throw error;
    }
  }

  getStatus() {
    return {
      initialized: this.#initialized,
      wrapperRegistered: this.#wrapperRegistered,
      wrapperId: this.#wrapperId,
      wrapperTarget: COMPENDIUM_DATA_CONTEXT_WRAPPER_TARGET,
      exportLabel: COMPENDIUM_EXPORT_CONTEXT_LABEL,
      importLabel: COMPENDIUM_IMPORT_CONTEXT_LABEL,
      gmOnly: true,
      documentTypes: [...COMPENDIUM_DATA_DOCUMENT_TYPES],
      lastError: this.#lastError ? { name: this.#lastError.name, message: this.#lastError.message } : null
    };
  }

  getStats() {
    return { ...this.#stats, status: this.getStatus() };
  }

  async #resolveContextDocument(app, target) {
    if (!this.#gameAccessor()?.user?.isGM) throw new Error("AE5E compendium data tools require a GM user.");
    const pack = app?.collection ?? null;
    if (!this.isEligiblePack(pack)) throw new Error("AE5E compendium data tools support Actor and Item compendiums only.");
    const element = normalizeElement(target);
    const row = element?.closest?.("[data-entry-id],[data-document-id]") ?? element;
    const entryId = element?.dataset?.entryId
      ?? element?.dataset?.documentId
      ?? row?.dataset?.entryId
      ?? row?.dataset?.documentId
      ?? null;
    if (!entryId) throw new Error("Could not determine the selected compendium entry id.");
    if (typeof pack?.getDocument !== "function") throw new Error("The selected compendium cannot provide documents.");
    const document = await pack.getDocument(entryId);
    if (!document) throw new Error("The selected compendium entry could not be loaded.");
    return document;
  }

  async #showPreview(document, report) {
    const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
    if (!DialogV2) throw new Error("Foundry DialogV2 is unavailable; the import preview cannot open.");
    const blocked = !report.valid;
    const content = this.#previewHtml(document, report);
    let settled = false;
    let resolveResult;
    const result = new Promise(resolve => { resolveResult = resolve; });
    const finish = value => {
      if (settled) return;
      settled = true;
      resolveResult(Boolean(value));
    };
    const buttons = blocked
      ? [{ action: "close", label: "Close", callback: () => false }]
      : [
          { action: "cancel", label: "Cancel", callback: () => false },
          { action: "import", label: "Import Data", icon: "fa-solid fa-file-import", callback: () => true }
        ];
    const dialog = new DialogV2({
      window: { title: `${blocked ? "Import Blocked" : "Confirm Import"} — ${document.name}` },
      position: { width: 680 },
      classes: [`${MODULE_ID}-owned-dialog`, "ae5e-compendium-data-preview-dialog"],
      content,
      buttons,
      submit: response => finish(response === true),
      modal: true
    });
    dialog.addEventListener?.("close", () => finish(false));
    await dialog.render({ force: true });
    return result;
  }

  #previewHtml(document, report) {
    const list = (title, records, formatter, kind) => {
      if (!records.length) return "";
      return `<section class="ae5e-data-preview-section" data-kind="${kind}"><h3>${escapeHtml(title)}</h3><ul>${records.map(record => `<li>${escapeHtml(formatter(record))}</li>`).join("")}</ul></section>`;
    };
    return `
      <div class="ae5e-compendium-data-preview">
        <p><strong>${escapeHtml(document.name)}</strong> (${escapeHtml(document.documentName)}: ${escapeHtml(document.type)})</p>
        <p class="ae5e-data-preview-identity"><i class="fa-solid fa-shield-halved"></i> The existing compendium, root ID, UUID, folder, sort position, ownership, and subtype will be preserved.</p>
        <div class="ae5e-data-preview-counts">
          <span>Retained <strong>${report.summary.retained}</strong></span>
          <span>Added <strong>${report.summary.added}</strong></span>
          <span>Removed <strong>${report.summary.removed}</strong></span>
          <span>Warnings <strong>${report.summary.warnings}</strong></span>
        </div>
        ${report.deletionsRequireConfirmation ? '<p class="ae5e-data-preview-deletion"><i class="fa-solid fa-triangle-exclamation"></i> Continuing explicitly confirms the nested deletions listed below.</p>' : ""}
        ${list("Blocking problems", report.errors, value => value, "error")}
        ${list("Warnings", report.warnings, value => value, "warning")}
        ${list("Added structures", report.added, value => `${value.kind}: ${value.id} (${value.path})`, "added")}
        ${list("Removed structures", report.removed, value => `${value.kind}: ${value.id} (${value.path})`, "removed")}
        ${report.valid ? "" : '<p class="ae5e-data-preview-blocked">No data has been changed. Correct the JSON and try again.</p>'}
      </div>
    `;
  }

  #recordWrapperError(error) {
    this.#stats.wrapperRegistrationErrors += 1;
    this.#lastError = error instanceof Error ? error : new Error(String(error));
    this.#wrapperRegistered = false;
    this.#wrapperId = null;
    Logger.error("Could not register AE5E compendium data context options.", this.#lastError);
  }
}
