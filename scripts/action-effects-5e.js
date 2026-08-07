import { MODULE_ID, HOOKS } from "./core/constants.js";
import { Logger } from "./core/logger.js";
import { registerSettings } from "./core/settings.js";
import { DependencyService } from "./core/dependencies.js";
import { CompatibilityService } from "./core/compatibility.js";
import { SocketService } from "./core/socket-service.js";
import { MovementRegistry } from "./movement/movement-registry.js";
import { MovementService } from "./movement/movement-service.js";
import { RelationshipService } from "./relationships/relationship-service.js";
import { TestHarness } from "./dev/test-harness.js";
import { ActionEffects5eApi } from "./api.js";

const dependencies = new DependencyService();
const compatibility = new CompatibilityService();
const socket = new SocketService();
const movementRegistry = new MovementRegistry();
const relationships = new RelationshipService({ socket });
const movement = new MovementService({ registry: movementRegistry, relationships });
const tests = new TestHarness({ dependencies, compatibility, movement, relationships, socket });
const api = new ActionEffects5eApi({
  dependencies,
  compatibility,
  movement,
  relationships,
  tests,
  socket
});

// Socketlib recommends registering for its ready hook while module scripts are
// evaluated, before Foundry begins dispatching init callbacks. Required
// dependencies can otherwise emit socketlib.ready before our own init callback.
socket.initialize();

Hooks.once("init", () => {
  Logger.log("Initializing module foundation.");
  registerSettings();

  const module = game.modules.get(MODULE_ID);
  if (module) module.api = api;
});

Hooks.once("setup", () => {
  compatibility.refresh();
});

Hooks.once("ready", async () => {
  const status = dependencies.validate({ notify: true });
  if (!status.healthy) {
    Logger.error("Foundation services were not started because required dependencies are unavailable.");
    return;
  }

  await relationships.initialize();
  movement.initialize();
  compatibility.refresh();

  Logger.info("Foundation ready. Console API:", `game.modules.get("${MODULE_ID}").api`);
  Hooks.callAll(HOOKS.READY, api);
});
