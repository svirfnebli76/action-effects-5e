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
}
