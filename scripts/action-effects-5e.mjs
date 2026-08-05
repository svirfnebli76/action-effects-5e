/**
 * Action Effects 5e
 * Main module entry point.
 */

const MODULE_ID = "action-effects-5e";

/**
 * Runs during Foundry's initialization process.
 *
 * This is where Action Effects 5e will eventually register settings,
 * movement actions, hooks, document classes, and its public API.
 */
Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing`);

  const module = game.modules.get(MODULE_ID);

  if (!module) {
    console.error(`${MODULE_ID} | Unable to locate the module package.`);
    return;
  }

  /**
   * Public API exposed to item macros and other modules.
   *
   * This is intentionally minimal for the first startup test.
   */
  module.api = {
    get moduleId() {
      return MODULE_ID;
    },

    get version() {
      return game.modules.get(MODULE_ID)?.version ?? "unknown";
    }
  };

  console.log(`${MODULE_ID} | Public API registered`, module.api);
});

/**
 * Runs after Foundry, the D&D5e system, modules, users, scenes,
 * actors, and other world data are ready.
 */
Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | Ready`);

  // Display the startup confirmation only to a GM.
  if (game.user?.isGM) {
    ui.notifications.info("Action Effects 5e loaded successfully.");
  }
});