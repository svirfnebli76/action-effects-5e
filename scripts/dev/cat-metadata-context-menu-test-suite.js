import { MODULE_VERSION } from "../core/constants.js";
import {
  CAT_INTERNAL_PACK_IDS,
  CAT_PUBLIC_AUTOMATION_PACK_IDS
} from "../authoring/cat-metadata-authoring-service.js";
import { CAT_METADATA_CONTEXT_LABEL, CAT_OPTIONS_CONTEXT_LABEL } from "../authoring/cat-metadata-context-menu-service.js";

export class CatMetadataContextMenuTestSuite {
  #contextMenu;
  #authoring;
  #configurationAuthoring;

  constructor({ contextMenu, authoring, configurationAuthoring }) {
    this.#contextMenu = contextMenu;
    this.#authoring = authoring;
    this.#configurationAuthoring = configurationAuthoring;
  }

  async runLiveTest({
    notify = true,
    packId = "action-effects-5e.spells-level-2",
    identifier = "misty-step"
  } = {}) {
    if (!globalThis.game?.user?.isGM) {
      throw new Error("The CAT metadata context-menu acceptance test requires a GM user.");
    }

    const checks = [];
    const record = (name, passed, details = null) => checks.push({ name, passed: Boolean(passed), details });

    try {
      const status = this.#contextMenu.getStatus();
      record("Runtime version is v0.4.3.1", MODULE_VERSION === "0.4.3.1", { moduleVersion: MODULE_VERSION });
      record("Compendium context wrapper initialized", status.initialized === true && status.wrapperRegistered === true && status.lastError === null, status);
      record("Context option label is Edit Item Version", status.contextLabel === CAT_METADATA_CONTEXT_LABEL && CAT_METADATA_CONTEXT_LABEL === "Edit Item Version", status);
      record("Options context label is Edit Item Options", status.optionsContextLabel === CAT_OPTIONS_CONTEXT_LABEL && CAT_OPTIONS_CONTEXT_LABEL === "Edit Item Options", status);
      record("Context editor is GM-only", status.gmOnly === true, status);
      record("Approved public pack is eligible", this.#contextMenu.isEligiblePack(packId) === true, { packId });
      record("AE5E Administrative is not eligible", this.#contextMenu.isEligiblePack("action-effects-5e.ae5e-administrative") === false
        && CAT_INTERNAL_PACK_IDS.includes("action-effects-5e.ae5e-administrative")
        && !CAT_PUBLIC_AUTOMATION_PACK_IDS.includes("action-effects-5e.ae5e-administrative"), {
        publicPacks: CAT_PUBLIC_AUTOMATION_PACK_IDS,
        internalPacks: CAT_INTERNAL_PACK_IDS
      });
      record("Foreign compendium is not eligible", this.#contextMenu.isEligiblePack("dnd5e.spells") === false);

      const pack = game.packs.get(packId);
      if (!pack) throw new Error(`Could not find ${packId}.`);
      const index = await pack.getIndex({ fields: ["name", "type", "system.identifier", "system.source.rules", "flags.cat.automation.source", "flags.cat.automation.version"] });
      const entry = [...index].find(document => document.system?.identifier === identifier);
      if (!entry) throw new Error(`Could not find identifier '${identifier}' in ${packId}.`);
      const canonical = await pack.getDocument(entry._id);
      if (!canonical) throw new Error("Canonical test Item could not be loaded.");

      const draft = this.#contextMenu.getDraft(canonical);
      record("Editor draft auto-populates Item name/type", draft.name === canonical.name && draft.type === canonical.type, draft);
      record("Editor draft auto-populates identifier", draft.identifier === canonical.system?.identifier, draft);
      record("Editor draft auto-populates ruleset", draft.rules === canonical.system?.source?.rules, draft);
      record("Editor draft auto-populates existing version", draft.version === (canonical.flags?.cat?.automation?.version ?? "1.0.0"), draft);
      record("Automation provider is supplied by AE5E", draft.sourceId === "action-effects-5e" && draft.sourceLabel === "Action Effects 5E", draft);

      const scratchSpellDraft = this.#contextMenu.getDraft({
        documentName: "Item",
        name: "Entangle",
        type: "spell",
        pack: "action-effects-5e.spells-level-1",
        system: { identifier: "spell", source: { rules: "2024" } },
        flags: { cat: { automation: {} } }
      });
      record("First-use generic spell identifier is replaced with a name-derived identifier",
        scratchSpellDraft.identifier === "entangle"
          && scratchSpellDraft.rules === "2024"
          && scratchSpellDraft.alreadyPublished === false,
        scratchSpellDraft);

      const base = [{ label: "Core Option" }];
      const publicApp = { collection: pack };
      const extended = this.#contextMenu.extendContextOptions(publicApp, base);
      record("Approved compendium receives both AE5E authoring context options", extended.length === base.length + 2
        && extended.filter(option => option?.ae5eCatMetadata === true).length === 1
        && extended.filter(option => option?.ae5eCatOptions === true).length === 1
        && extended.some(option => option?.label === "Edit Item Version")
        && extended.some(option => option?.label === "Edit Item Options"), extended.map(option => ({
          label: option.label,
          ae5eCatMetadata: option.ae5eCatMetadata ?? false,
          ae5eCatOptions: option.ae5eCatOptions ?? false
        })));

      const optionsDraft = this.#contextMenu.getOptionsDraft(canonical);
      record("Options editor draft is JSON-backed and preserves CAT preference separation",
        optionsDraft.name === canonical.name
          && typeof optionsDraft.configurationText === "string"
          && optionsDraft.valid === true
          && this.#configurationAuthoring.getStatus().preferenceFlag === "flags.cat.config.*",
        optionsDraft);

      const internalPack = game.packs.get("action-effects-5e.ae5e-administrative");
      const internalOptions = this.#contextMenu.extendContextOptions({ collection: internalPack }, base);
      record("Administrative compendium receives no AE5E authoring options", internalOptions.length === base.length
        && internalOptions.every(option => option?.ae5eCatMetadata !== true && option?.ae5eCatOptions !== true));

      const authoringStatus = this.#authoring.getStatus();
      record("Editor uses accepted CAT metadata authoring contract", authoringStatus.source === "action-effects-5e"
        && authoringStatus.versionFormat === "SemVer"
        && authoringStatus.requiredItemMetadata.includes("system.identifier")
        && authoringStatus.requiredItemMetadata.includes("system.source.rules"), authoringStatus);
    } catch (error) {
      record("Live context-menu execution completed without error", false, {
        message: error?.message ?? String(error),
        stack: error?.stack ?? null
      });
    }

    const passed = checks.every(check => check.passed);
    const count = checks.filter(check => check.passed).length;
    const result = {
      passed,
      passedCount: count,
      total: checks.length,
      checks,
      contextMenu: this.#contextMenu.getStatus(),
      stats: this.#contextMenu.getStats(),
      safety: {
        compendiumModified: false,
        editorOpened: false,
        testIsReadOnly: true
      }
    };

    console.group(`AE5E ${MODULE_VERSION} — CAT METADATA CONTEXT MENU — ${passed ? "PASS" : "FAIL"}`);
    console.table(checks.map((check, index) => ({ case: index + 1, test: check.name, result: check.passed ? "PASS" : "FAIL" })));
    console.log("Full result:", result);
    console.groupEnd();
    console.log(
      `%cAE5E ${MODULE_VERSION} — CAT METADATA CONTEXT MENU — ${passed ? "PASS" : "FAIL"}`,
      `font-size:24px;font-weight:bold;color:${passed ? "#5cff8d" : "#ff5c5c"};`
    );

    if (notify && globalThis.ui?.notifications) {
      const message = `AE5E CAT Metadata Context Menu: ${count}/${checks.length} ${passed ? "PASS" : "FAIL"}`;
      if (passed) ui.notifications.info(message);
      else ui.notifications.error(message);
    }

    return result;
  }
}
