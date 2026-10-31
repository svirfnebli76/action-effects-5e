import { MODULE_ID } from "./constants.js";
import { Logger } from "./logger.js";

const ARGON_MODULE_ID = "enhancedcombathud";
const ARGON_TARGET_PICKER_SETTING = "rangepicker";
const ARGON_TARGET_PICKER_ID = "enhancedcombathud.rangepicker";

export class StartupCompatibilityService {
  #checked = false;
  #promptOpen = false;
  #status = Object.freeze({
    checked: false,
    prompted: false,
    changed: false,
    lastReason: null
  });

  getStatus() {
    return { ...this.#status };
  }

  async run() {
    if (this.#checked) return this.#result("already-checked");
    this.#checked = true;

    const argon = globalThis.game?.modules?.get?.(ARGON_MODULE_ID);
    if (!argon?.active) return this.#result("argon-inactive");

    const settings = globalThis.game?.settings;
    const registration = settings?.settings?.get?.(ARGON_TARGET_PICKER_ID);
    if (!registration) return this.#result("setting-unavailable");

    if (registration.scope && registration.scope !== "world") {
      Logger.warn("Argon Target Picker was expected to be a world setting; startup check skipped.");
      return this.#result("unexpected-setting-scope");
    }

    let enabled;
    try {
      enabled = settings.get(ARGON_MODULE_ID, ARGON_TARGET_PICKER_SETTING) === true;
    } catch (error) {
      Logger.warn("Could not read Argon's Target Picker setting; startup check skipped.", error);
      return this.#result("setting-read-failed");
    }

    if (!enabled) return this.#result("already-disabled");
    if (!globalThis.game?.user?.isGM) return this.#result("not-gm");
    if (this.#promptOpen) return this.#result("prompt-already-open");

    this.#promptOpen = true;
    let accepted = false;
    try {
      accepted = await this.#promptArgonTargetPicker();
    } catch (error) {
      Logger.warn("Could not show the Argon Target Picker compatibility prompt.", error);
      return this.#result("prompt-failed");
    } finally {
      this.#promptOpen = false;
    }

    if (!accepted) return this.#result("declined", { prompted: true });

    try {
      // Another GM may have changed the shared world setting while this prompt
      // was open. Re-read before writing and avoid a redundant mutation.
      if (settings.get(ARGON_MODULE_ID, ARGON_TARGET_PICKER_SETTING) !== true) {
        return this.#result("already-disabled", { prompted: true });
      }

      await settings.set(ARGON_MODULE_ID, ARGON_TARGET_PICKER_SETTING, false);
      globalThis.ui?.notifications?.info?.("AE5E | Argon Target Picker disabled.");
      Logger.info("Startup compatibility check disabled Argon's Target Picker with GM approval.");
      return this.#result("disabled", { prompted: true, changed: true });
    } catch (error) {
      Logger.warn("Could not disable Argon's Target Picker after approval.", error);
      globalThis.ui?.notifications?.error?.(
        "AE5E | Argon Target Picker could not be disabled. Please turn it off manually in Argon - Combat HUD (CORE) settings."
      );
      return this.#result("setting-write-failed", { prompted: true });
    }
  }

  #result(lastReason, overrides = {}) {
    this.#status = Object.freeze({
      checked: true,
      prompted: overrides.prompted ?? this.#status.prompted,
      changed: overrides.changed ?? this.#status.changed,
      lastReason
    });
    return { ...this.#status };
  }

  async #promptArgonTargetPicker() {
    const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
    if (!DialogV2) throw new Error("Foundry DialogV2 is unavailable.");

    const content = [
      '<div class="ae5e-startup-compatibility-check">',
      "<p>Action Effects 5E uses advanced automation and custom targeting workflows to make gameplay significantly easier and more user friendly.</p>",
      "<p>A compatibility issue was detected with one setting in another active module. You do <strong>not</strong> need to disable that module, but AE5E recommends changing the following setting:</p>",
      "<p><strong>Module:</strong> Argon - Combat HUD (CORE)<br>",
      "<strong>Setting:</strong> Target Picker<br>",
      "<strong>Required:</strong> Off</p>",
      "<p>Argon's Target Picker provides a preliminary targeting step before an activity is used. When Midi-QOL and advanced automation packages such as Action Effects 5E, Chris's Premades, or Gambit's Premades manage targeting themselves, Argon's additional Target Picker can create duplicate or conflicting targeting workflows.</p>",
      "<p>Would you like Action Effects 5E to disable Argon's Target Picker now?</p>",
      "</div>"
    ].join("");

    let settled = false;
    let resolveResult;
    const resultPromise = new Promise(resolve => {
      resolveResult = resolve;
    });

    const finish = value => {
      if (settled) return;
      settled = true;
      resolveResult?.(value === true);
      resolveResult = null;
    };

    const dialog = new DialogV2({
      window: { title: "Action Effects 5E Start-up Checks" },
      position: { width: 560 },
      classes: [MODULE_ID + "-owned-dialog", "ae5e-startup-compatibility-dialog"],
      content,
      buttons: [
        {
          action: "disable-target-picker",
          label: "Disable Target Picker",
          callback: () => true
        },
        {
          action: "cancel",
          label: "Cancel",
          callback: () => false
        }
      ],
      submit: response => finish(response === true),
      modal: true
    });

    dialog.addEventListener?.("close", () => finish(false));

    try {
      await dialog.render({ force: true });
      return await resultPromise;
    } catch (error) {
      finish(false);
      throw error;
    }
  }
}
