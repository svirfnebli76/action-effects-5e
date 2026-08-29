import { MODULE_ID, MODULE_TITLE } from "../core/constants.js";
import { Logger } from "../core/logger.js";
import {
  CAT_PUBLIC_AUTOMATION_PACK_IDS,
  isValidAutomationVersion
} from "./cat-metadata-authoring-service.js";

export const CAT_METADATA_CONTEXT_WRAPPER_TARGET =
  "foundry.applications.sidebar.apps.Compendium.prototype._getEntryContextOptions";

export const CAT_METADATA_CONTEXT_LABEL = "Edit Item Version";

function defaultGameAccessor() {
  return globalThis.game ?? null;
}

function defaultLibWrapperAccessor() {
  return globalThis.libWrapper ?? null;
}

function defaultFromUuid(uuid) {
  if (typeof globalThis.fromUuid !== "function") return null;
  return globalThis.fromUuid(uuid);
}

function normalizeElement(target) {
  if (!target) return null;
  const HTMLElementClass = globalThis.HTMLElement;
  if (!HTMLElementClass) return target?.[0] ?? target?.element ?? target ?? null;
  if (target instanceof HTMLElementClass) return target;
  if (target?.[0] instanceof HTMLElementClass) return target[0];
  return target?.element instanceof HTMLElementClass ? target.element : null;
}

function packId(pack) {
  return pack?.collection ?? pack?.metadata?.id ?? null;
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

function slugifyIdentifier(name) {
  const slugify = globalThis.foundry?.utils?.slugify;
  if (typeof slugify === "function") {
    try {
      const value = slugify(String(name ?? ""), { strict: true });
      if (value) return value;
    } catch { /* fall through */ }
  }

  return String(name ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

/**
 * GM authoring UI for CAT automation metadata on AE5E public compendium Items.
 *
 * Foundry v14's Compendium application owns its entry context options through
 * `_getEntryContextOptions`. AE5E wraps that method with libWrapper and adds a
 * single GM-only option only when the open pack is one of AE5E's explicit
 * public CAT automation packs. World Items, foreign compendiums, and the AE5E
 * Administrative pack are never offered this authoring action.
 */
export class CatMetadataContextMenuService {
  #authoring;
  #registry;
  #gameAccessor;
  #libWrapperAccessor;
  #fromUuid;
  #publicPackIds;
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
    editorOpens: 0,
    saves: 0,
    saveErrors: 0,
    cancels: 0,
    registryRefreshes: 0,
    registryRefreshErrors: 0
  };

  constructor({
    authoring,
    registry = null,
    gameAccessor = defaultGameAccessor,
    libWrapperAccessor = defaultLibWrapperAccessor,
    fromUuidAccessor = defaultFromUuid,
    publicPackIds = CAT_PUBLIC_AUTOMATION_PACK_IDS
  } = {}) {
    if (!authoring) throw new Error("CatMetadataContextMenuService requires a CAT metadata authoring service.");
    this.#authoring = authoring;
    this.#registry = registry;
    this.#gameAccessor = typeof gameAccessor === "function" ? gameAccessor : defaultGameAccessor;
    this.#libWrapperAccessor = typeof libWrapperAccessor === "function" ? libWrapperAccessor : defaultLibWrapperAccessor;
    this.#fromUuid = typeof fromUuidAccessor === "function" ? fromUuidAccessor : defaultFromUuid;
    this.#publicPackIds = Object.freeze([...publicPackIds]);
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
      this.#recordWrapperError(new Error("libWrapper is unavailable; AE5E compendium Item version context menu could not be installed."));
      return this.getStatus();
    }

    const service = this;
    try {
      this.#wrapperId = libWrapper.register(
        MODULE_ID,
        CAT_METADATA_CONTEXT_WRAPPER_TARGET,
        function ae5eCatMetadataContextWrapper(wrapped, ...args) {
          const baseOptions = wrapped(...args);
          return service.extendContextOptions(this, baseOptions);
        },
        "WRAPPER"
      );
      this.#wrapperRegistered = true;
      this.#stats.wrapperRegistrations += 1;
      Logger.info("CAT metadata compendium context menu initialized.");
    } catch (error) {
      this.#recordWrapperError(error);
    }

    return this.getStatus();
  }

  isEligiblePack(packOrId) {
    const id = typeof packOrId === "string" ? packOrId : packId(packOrId);
    return Boolean(id) && this.#publicPackIds.includes(id);
  }

  getDraft(document) {
    if (!document || document.documentName !== "Item") {
      throw new Error("CAT metadata editor requires an Item document.");
    }

    const existingRules = String(document.system?.source?.rules ?? "").trim();
    const existingVersion = String(document.flags?.cat?.automation?.version ?? "").trim();
    const existingIdentifier = String(document.system?.identifier ?? "").trim();
    const source = document.flags?.cat?.automation?.source ?? null;

    return {
      name: document.name ?? "Unnamed Item",
      type: document.type ?? "",
      identifier: existingIdentifier || slugifyIdentifier(document.name),
      rules: existingRules === "2014" || existingRules === "2024" ? existingRules : "",
      source,
      sourceLabel: MODULE_TITLE,
      sourceId: MODULE_ID,
      version: isValidAutomationVersion(existingVersion) ? existingVersion : "1.0.0",
      alreadyPublished: source === MODULE_ID && isValidAutomationVersion(existingVersion),
      foreignProvider: Boolean(source && source !== MODULE_ID),
      pack: document.pack ?? null
    };
  }

  extendContextOptions(app, baseOptions = []) {
    const options = Array.isArray(baseOptions) ? [...baseOptions] : [];
    if (!this.#canOfferForApp(app)) return options;
    if (options.some(option => option?.ae5eCatMetadata === true)) return options;

    options.push({
      ae5eCatMetadata: true,
      label: CAT_METADATA_CONTEXT_LABEL,
      icon: "fa-solid fa-code-branch",
      visible: () => this.#canOfferForApp(app),
      onClick: async (_event, target) => this.openFromContext(app, target)
    });
    this.#stats.contextMenusExtended += 1;
    return options;
  }

  async openFromContext(app, target) {
    this.#assertGm();
    const pack = app?.collection ?? null;
    if (!this.isEligiblePack(pack)) {
      throw new Error("AE5E CAT metadata editing is only available in approved AE5E public compendiums.");
    }

    const element = normalizeElement(target);
    const entryId = element?.dataset?.entryId
      ?? element?.dataset?.documentId
      ?? element?.closest?.("[data-entry-id],[data-document-id]")?.dataset?.entryId
      ?? element?.closest?.("[data-entry-id],[data-document-id]")?.dataset?.documentId
      ?? null;
    if (!entryId) throw new Error("Could not determine the selected compendium Item id.");
    if (typeof pack?.getDocument !== "function") throw new Error("The selected compendium cannot provide Item documents.");

    const item = await pack.getDocument(entryId);
    if (!item) throw new Error("The selected compendium Item could not be loaded.");
    return this.openEditor(item);
  }

  async openEditor(documentOrUuid) {
    this.#assertGm();
    const document = typeof documentOrUuid === "string"
      ? await this.#fromUuid(documentOrUuid)
      : documentOrUuid;
    if (!document || document.documentName !== "Item") {
      throw new Error("CAT metadata editor requires an Item document.");
    }
    if (!this.isEligiblePack(document.pack)) {
      throw new Error("AE5E CAT metadata editing is only available for Items in approved AE5E public compendiums.");
    }

    const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
    if (!DialogV2) throw new Error("Foundry DialogV2 is unavailable; AE5E metadata editor cannot open.");

    this.#stats.editorOpens += 1;
    const draft = this.getDraft(document);
    let settled = false;
    let resolveEditor;
    const resultPromise = new Promise(resolve => { resolveEditor = resolve; });
    const finish = result => {
      if (settled) return;
      settled = true;
      resolveEditor(result);
    };

    const dialog = new DialogV2({
      window: { title: `Edit AE5E Automation Metadata — ${document.name}` },
      classes: [`${MODULE_ID}-owned-dialog`, "ae5e-cat-metadata-editor-dialog"],
      content: '<div class="ae5e-cat-metadata-editor-host"></div>',
      buttons: [{
        action: "ae5e-cat-metadata-host",
        label: "AE5E Metadata Editor Host",
        type: "button",
        disabled: true,
        style: { display: "none" }
      }],
      modal: false
    });

    dialog.addEventListener?.("close", () => {
      if (!settled) {
        this.#stats.cancels += 1;
        finish({ saved: false, cancelled: true, document });
      }
    });

    await dialog.render({ force: true });
    await new Promise(resolve => setTimeout(resolve, 0));
    const root = dialog.element?.querySelector?.(".ae5e-cat-metadata-editor-host")
      ?? dialog.element?.[0]?.querySelector?.(".ae5e-cat-metadata-editor-host")
      ?? null;
    if (!root) {
      try { await dialog.close(); } catch { /* noop */ }
      throw new Error("AE5E metadata editor rendered without its host element.");
    }

    root.innerHTML = this.#editorHtml(draft);
    const identifierInput = root.querySelector('[data-ae5e-cat-field="identifier"]');
    const rulesInput = root.querySelector('[data-ae5e-cat-field="rules"]');
    const versionInput = root.querySelector('[data-ae5e-cat-field="version"]');
    const status = root.querySelector('[data-ae5e-cat-status]');
    const save = root.querySelector('[data-ae5e-cat-action="save"]');
    const cancel = root.querySelector('[data-ae5e-cat-action="cancel"]');

    const showStatus = (message, kind = "info") => {
      if (!status) return;
      status.textContent = message;
      status.dataset.kind = kind;
    };

    const setBusy = busy => {
      if (save) save.disabled = busy;
      if (cancel) cancel.disabled = busy;
      if (identifierInput) identifierInput.disabled = busy;
      if (rulesInput) rulesInput.disabled = busy;
      if (versionInput) versionInput.disabled = busy;
    };

    cancel?.addEventListener("click", async event => {
      event.preventDefault();
      this.#stats.cancels += 1;
      finish({ saved: false, cancelled: true, document });
      try { await dialog.close(); } catch { /* noop */ }
    });

    save?.addEventListener("click", async event => {
      event.preventDefault();
      const identifier = String(identifierInput?.value ?? "").trim();
      const rules = String(rulesInput?.value ?? "").trim();
      const version = String(versionInput?.value ?? "").trim();

      if (!identifier) {
        showStatus("Identifier is required.", "error");
        identifierInput?.focus?.();
        return;
      }
      if (rules !== "2014" && rules !== "2024") {
        showStatus("Select either the 2014 or 2024 ruleset.", "error");
        rulesInput?.focus?.();
        return;
      }
      if (!this.#authoring.isValidVersion(version)) {
        showStatus("Automation Version must use SemVer, for example 1.0.0.", "error");
        versionInput?.focus?.();
        return;
      }

      setBusy(true);
      showStatus("Saving AE5E automation metadata…", "info");
      try {
        const saved = await this.#authoring.setMetadata(document, { identifier, rules, version });
        this.#stats.saves += 1;

        let registration = null;
        if (typeof this.#registry?.refreshPublicCompendiums === "function") {
          try {
            registration = await this.#registry.refreshPublicCompendiums();
            this.#stats.registryRefreshes += 1;
          } catch (error) {
            this.#stats.registryRefreshErrors += 1;
            Logger.warn("CAT metadata was saved, but AE5E could not refresh CAT public-compendium registration immediately.", error);
          }
        }

        const packStatus = registration?.publicRegistration ?? this.#registry?.getStatus?.()?.publicRegistration ?? null;
        const currentPackId = document.pack ?? null;
        const registered = packStatus?.registeredPacks?.some?.(entry => entry.id === currentPackId) ?? false;
        const deferred = packStatus?.deferredPacks?.find?.(entry => entry.id === currentPackId) ?? null;
        const suffix = registered
          ? " The pack is registered with CAT."
          : deferred
            ? ` The pack remains deferred (${deferred.invalid} Item${deferred.invalid === 1 ? "" : "s"} still need metadata).`
            : "";
        globalThis.ui?.notifications?.info?.(`Saved AE5E automation metadata for ${document.name}.${suffix}`);
        finish({ saved: true, cancelled: false, document, result: saved, registration });
        try { await dialog.close(); } catch { /* noop */ }
      } catch (error) {
        this.#stats.saveErrors += 1;
        showStatus(error?.message ?? String(error), "error");
        globalThis.ui?.notifications?.error?.(`AE5E metadata was not saved: ${error?.message ?? String(error)}`);
        setBusy(false);
      }
    });

    return resultPromise;
  }

  getStatus() {
    return {
      initialized: this.#initialized,
      wrapperRegistered: this.#wrapperRegistered,
      wrapperId: this.#wrapperId,
      wrapperTarget: CAT_METADATA_CONTEXT_WRAPPER_TARGET,
      contextLabel: CAT_METADATA_CONTEXT_LABEL,
      gmOnly: true,
      publicPacks: [...this.#publicPackIds],
      lastError: this.#lastError ? { name: this.#lastError.name, message: this.#lastError.message } : null
    };
  }

  getStats() {
    return { ...this.#stats, status: this.getStatus() };
  }

  #canOfferForApp(app) {
    const game = this.#gameAccessor();
    if (!game?.user?.isGM) return false;
    const pack = app?.collection ?? null;
    if (!this.isEligiblePack(pack)) return false;
    if (pack?.metadata?.type && pack.metadata.type !== "Item") return false;
    return true;
  }

  #assertGm() {
    const game = this.#gameAccessor();
    if (!game?.user?.isGM) throw new Error("AE5E CAT metadata editing requires a GM user.");
  }

  #recordWrapperError(error) {
    this.#stats.wrapperRegistrationErrors += 1;
    this.#lastError = error instanceof Error ? error : new Error(String(error));
    this.#wrapperRegistered = false;
    this.#wrapperId = null;
    Logger.error("Could not register AE5E CAT metadata compendium context menu.", this.#lastError);
  }

  #editorHtml(draft) {
    const rulesOptions = [
      '<option value="">Select ruleset…</option>',
      `<option value="2014"${draft.rules === "2014" ? " selected" : ""}>2014</option>`,
      `<option value="2024"${draft.rules === "2024" ? " selected" : ""}>2024</option>`
    ].join("");
    const statusText = draft.foreignProvider
      ? `Warning: this Item is currently owned by CAT provider “${escapeHtml(draft.source)}”. AE5E will not overwrite another provider.`
      : draft.alreadyPublished
        ? `CAT metadata valid. Current automation version: ${escapeHtml(draft.version)}.`
        : "Not yet published to CAT. Review the fields below, then save to publish AE5E metadata.";

    return `
      <form class="ae5e-cat-metadata-editor" autocomplete="off">
        <div class="ae5e-cat-metadata-summary">
          <i class="fa-solid fa-code-branch" aria-hidden="true"></i>
          <div>
            <strong>${escapeHtml(draft.name)}</strong>
            <div>AE5E automation authoring metadata</div>
          </div>
        </div>

        <div class="ae5e-cat-metadata-grid">
          <label>Item Name</label>
          <input type="text" value="${escapeHtml(draft.name)}" readonly>

          <label>Item Type</label>
          <input type="text" value="${escapeHtml(draft.type)}" readonly>

          <label for="ae5e-cat-identifier">Identifier</label>
          <input id="ae5e-cat-identifier" data-ae5e-cat-field="identifier" type="text" value="${escapeHtml(draft.identifier)}" spellcheck="false">

          <label for="ae5e-cat-rules">Ruleset</label>
          <select id="ae5e-cat-rules" data-ae5e-cat-field="rules">${rulesOptions}</select>

          <label>Automation Provider</label>
          <input type="text" value="${escapeHtml(`${MODULE_TITLE} (${MODULE_ID})`)}" readonly>

          <label for="ae5e-cat-version">Automation Version</label>
          <input id="ae5e-cat-version" data-ae5e-cat-field="version" type="text" value="${escapeHtml(draft.version)}" spellcheck="false" placeholder="1.0.0">
        </div>

        <div class="ae5e-cat-metadata-status" data-ae5e-cat-status data-kind="${draft.foreignProvider ? "error" : draft.alreadyPublished ? "success" : "info"}">${statusText}</div>

        <div class="ae5e-cat-metadata-actions">
          <button type="button" data-ae5e-cat-action="cancel"><i class="fa-solid fa-xmark"></i> Cancel</button>
          <button type="button" data-ae5e-cat-action="save"><i class="fa-solid fa-floppy-disk"></i> ${draft.alreadyPublished ? "Save" : "Publish"}</button>
        </div>
      </form>
    `;
  }
}
