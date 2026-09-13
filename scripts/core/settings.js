import {
  MODULE_ID,
  OVERLAP_POLICIES,
  SETTINGS
} from "./constants.js";

export function registerSettings() {
  game.settings.register(MODULE_ID, SETTINGS.MOVEMENT_ENABLED, {
    name: "ACTION_EFFECTS_5E.Settings.MovementEnabled.Name",
    hint: "ACTION_EFFECTS_5E.Settings.MovementEnabled.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true
  });

  game.settings.register(MODULE_ID, SETTINGS.OVERLAP_POLICY, {
    name: "ACTION_EFFECTS_5E.Settings.OverlapPolicy.Name",
    hint: "ACTION_EFFECTS_5E.Settings.OverlapPolicy.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      [OVERLAP_POLICIES.AUTO_SAFE]: "ACTION_EFFECTS_5E.Settings.OverlapPolicy.AutoSafe",
      [OVERLAP_POLICIES.PREFER_AE5E]: "ACTION_EFFECTS_5E.Settings.OverlapPolicy.PreferAE5E",
      [OVERLAP_POLICIES.PREFER_EXTERNAL]: "ACTION_EFFECTS_5E.Settings.OverlapPolicy.PreferExternal",
      [OVERLAP_POLICIES.MANUAL]: "ACTION_EFFECTS_5E.Settings.OverlapPolicy.Manual"
    },
    default: OVERLAP_POLICIES.AUTO_SAFE
  });

  game.settings.register(MODULE_ID, SETTINGS.DEBUG_LOGGING, {
    name: "ACTION_EFFECTS_5E.Settings.DebugLogging.Name",
    hint: "ACTION_EFFECTS_5E.Settings.DebugLogging.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, SETTINGS.CAPTURE_DIAGNOSTICS, {
    name: "ACTION_EFFECTS_5E.Settings.CaptureDiagnostics.Name",
    hint: "ACTION_EFFECTS_5E.Settings.CaptureDiagnostics.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, SETTINGS.CROSSHAIR_3D_REVERSE_ELEVATION_WHEEL, {
    name: "ACTION_EFFECTS_5E.Settings.Crosshair3dReverseElevationWheel.Name",
    hint: "ACTION_EFFECTS_5E.Settings.Crosshair3dReverseElevationWheel.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  installCrosshair3dSettingsHeading();

  // Hidden world-state used only to preserve deterministic GM connection order
  // for Reaction Broker authority election. It is not user configuration.
  game.settings.register(MODULE_ID, SETTINGS.REACTION_AUTHORITY_LEDGER, {
    scope: "world",
    config: false,
    type: Object,
    default: { sequence: 0, sessions: {} }
  });
}

function installCrosshair3dSettingsHeading() {
  const Hooks = globalThis.Hooks;
  if (!Hooks?.on) return;

  Hooks.on("renderSettingsConfig", (_app, html) => {
    const root = html?.[0] ?? html;
    if (!root?.querySelector) return;
    if (root.querySelector('[data-ae5e-settings-section="crosshairs3d"]')) return;

    const input = root.querySelector(`[name="${MODULE_ID}.${SETTINGS.CROSSHAIR_3D_REVERSE_ELEVATION_WHEEL}"]`);
    const group = input?.closest?.(".form-group");
    const doc = root.ownerDocument ?? globalThis.document;
    if (!group || !doc?.createElement) return;

    const heading = doc.createElement("h3");
    heading.dataset.ae5eSettingsSection = "crosshairs3d";
    heading.className = "ae5e-settings-section-heading";
    heading.textContent = globalThis.game?.i18n?.localize?.("ACTION_EFFECTS_5E.Settings.Crosshair3d.Section") ?? "3D Crosshair Settings";
    group.before(heading);
  });
}
