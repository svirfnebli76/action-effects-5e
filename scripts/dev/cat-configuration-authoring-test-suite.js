import { MODULE_ID, MODULE_VERSION } from "../core/constants.js";
import { CAT_CONFIGURATION_SCHEMA_FLAG } from "../authoring/cat-configuration-authoring-service.js";

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export class CatConfigurationAuthoringTestSuite {
  #configurationAuthoring;
  #contextMenu;
  #registry;

  constructor({ configurationAuthoring, contextMenu, registry }) {
    this.#configurationAuthoring = configurationAuthoring;
    this.#contextMenu = contextMenu;
    this.#registry = registry;
  }

  async runLiveTest({
    notify = true,
    packId = "action-effects-5e.spells-level-2",
    identifier = "misty-step"
  } = {}) {
    if (!globalThis.game?.user?.isGM) {
      throw new Error("The CAT configuration authoring acceptance test requires a GM user.");
    }

    const checks = [];
    const record = (name, passed, details = null) => checks.push({ name, passed: Boolean(passed), details });

    try {
      const status = this.#configurationAuthoring.getStatus();
      const contextStatus = this.#contextMenu.getStatus();
      record("Runtime version is v0.4.3.0", MODULE_VERSION === "0.4.3.0", { moduleVersion: MODULE_VERSION });
      record("CAT configuration schema has a dedicated AE5E authoring flag", status.schemaFlag === CAT_CONFIGURATION_SCHEMA_FLAG
        && CAT_CONFIGURATION_SCHEMA_FLAG === "flags.action-effects-5e.cat.configSchema", status);
      record("CAT user preference storage remains separate", status.preferenceFlag === "flags.cat.config.*", status);
      record("Editor supports core CAT configuration field types", status.supportedTypes.includes("checkbox")
        && status.supportedTypes.includes("number")
        && status.supportedTypes.includes("text")
        && status.supportedTypes.includes("select")
        && status.supportedTypes.includes("select-many"), status.supportedTypes);
      record("Edit Item Options context command is installed", contextStatus.optionsContextLabel === "Edit Item Options"
        && contextStatus.wrapperRegistered === true
        && contextStatus.lastError === null, contextStatus);

      const sample = {
        playAnimation: {
          label: "Play Animations",
          hint: "Play the AE5E visual animation.",
          type: "checkbox",
          default: true,
          category: "animation"
        }
      };
      const validation = this.#configurationAuthoring.validate(sample);
      record("Checkbox configuration data validates", validation.valid === true && validation.optionCount === 1, validation);

      const parsed = this.#configurationAuthoring.parse(JSON.stringify(sample, null, 2));
      record("JSON editor payload parses without translation", parsed.valid === true
        && parsed.data?.playAnimation?.type === "checkbox"
        && parsed.data?.playAnimation?.default === true, parsed);

      const badJson = this.#configurationAuthoring.parse('{"playAnimation":');
      record("Malformed JSON is rejected safely", badJson.valid === false && badJson.issues.some(issue => issue.includes("Invalid JSON")), badJson);

      const emptySchema = this.#configurationAuthoring.parse("{}");
      record("Empty JSON object validates as an explicit no-options schema", emptySchema.valid === true
        && emptySchema.optionCount === 0
        && Object.keys(emptySchema.data ?? {}).length === 0, emptySchema);

      const badType = this.#configurationAuthoring.validate({ probe: { type: "banana", default: true } });
      record("Unsupported CAT configuration types are rejected", badType.valid === false, badType);

      const select = this.#configurationAuthoring.validate({
        mode: {
          label: "Mode",
          type: "select",
          default: "one",
          options: [
            { value: "one", label: "One" },
            { value: "two", label: "Two" }
          ]
        }
      });
      record("Static CAT select choices validate", select.valid === true, select);

      const pack = game.packs.get(packId);
      if (!pack) throw new Error(`Could not find ${packId}.`);
      record("Approved AE5E public pack is eligible for options authoring", this.#contextMenu.isEligiblePack(pack) === true, { packId });

      const index = await pack.getIndex({
        fields: [
          "name",
          "type",
          "system.identifier",
          "system.source.rules",
          "flags.cat.automation.source",
          "flags.cat.automation.version",
          CAT_CONFIGURATION_SCHEMA_FLAG
        ]
      });
      const entry = [...index].find(document => document.system?.identifier === identifier);
      if (!entry) throw new Error(`Could not find identifier '${identifier}' in ${packId}.`);
      const canonical = await pack.getDocument(entry._id);
      if (!canonical) throw new Error("Canonical CAT configuration test Item could not be loaded.");

      const draft = this.#contextMenu.getOptionsDraft(canonical);
      record("Options editor draft reflects canonical Item identity", draft.name === canonical.name
        && draft.identifier === canonical.system?.identifier
        && draft.rules === canonical.system?.source?.rules, draft);
      record("Options editor draft is valid JSON", this.#configurationAuthoring.parse(draft.configurationText).valid === true, draft.configurationText);

      const stored = this.#configurationAuthoring.getConfiguration(canonical);
      const storedValidation = this.#configurationAuthoring.validate(stored);
      record("Canonical stored configuration is valid", storedValidation.valid === true, storedValidation);

      const liveRegistry = globalThis.cat?.lib?.constants?.automations;
      const registered = liveRegistry?.getAutomationByIdentifier?.(canonical.system?.identifier, {
        source: MODULE_ID,
        rules: canonical.system?.source?.rules,
        type: canonical.type
      });
      record("CAT registry resolves the canonical AE5E automation", Boolean(registered), registered ?? null);

      const storedCount = Object.keys(stored).length;
      const registeredConfig = registered?.config ?? {};
      record("CAT registry configuration matches canonical Item configuration", stableJson(registeredConfig) === stableJson(stored), {
        stored,
        registeredConfig,
        storedCount
      });

      const registryStatus = this.#registry.getStatus();
      const packRegistration = registryStatus.publicRegistration?.registeredPacks?.find(packEntry => packEntry.id === packId) ?? null;
      record("AE5E public registration reports configuration counts", Boolean(packRegistration)
        && Number.isFinite(packRegistration.configurable)
        && Number.isFinite(packRegistration.configurationOptions), packRegistration);
    } catch (error) {
      record("Live CAT configuration authoring execution completed without error", false, {
        message: error?.message ?? String(error),
        stack: error?.stack ?? null
      });
    }

    const passed = checks.every(check => check.passed);
    const passedCount = checks.filter(check => check.passed).length;
    const result = {
      passed,
      passedCount,
      total: checks.length,
      checks,
      configurationAuthoring: this.#configurationAuthoring.getStatus(),
      contextMenu: this.#contextMenu.getStatus(),
      registration: this.#registry.getStatus(),
      safety: {
        compendiumModified: false,
        editorOpened: false,
        testIsReadOnly: true
      }
    };

    console.group(`AE5E ${MODULE_VERSION} — CAT CONFIGURATION AUTHORING — ${passed ? "PASS" : "FAIL"}`);
    console.table(checks.map((check, index) => ({ case: index + 1, test: check.name, result: check.passed ? "PASS" : "FAIL" })));
    console.log("Full result:", result);
    console.groupEnd();
    console.log(
      `%cAE5E ${MODULE_VERSION} — CAT CONFIGURATION AUTHORING — ${passed ? "PASS" : "FAIL"}`,
      `font-size:24px;font-weight:bold;color:${passed ? "#5cff8d" : "#ff5c5c"};`
    );

    if (notify && globalThis.ui?.notifications) {
      const message = `AE5E CAT Configuration Authoring: ${passedCount}/${checks.length} ${passed ? "PASS" : "FAIL"}`;
      if (passed) ui.notifications.info(message);
      else ui.notifications.error(message);
    }

    return result;
  }
}
