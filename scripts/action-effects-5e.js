import { MODULE_ID, HOOKS } from "./core/constants.js";
import { Logger } from "./core/logger.js";
import { registerSettings } from "./core/settings.js";
import { DependencyService } from "./core/dependencies.js";
import { CompatibilityService } from "./core/compatibility.js";
import { SocketService } from "./core/socket-service.js";
import { MovementRegistry } from "./movement/movement-registry.js";
import { MovementService } from "./movement/movement-service.js";
import { RelationshipService } from "./relationships/relationship-service.js";
import { RelationshipMovementService } from "./relationships/relationship-movement-service.js";
import { RelationshipRotationService } from "./relationships/relationship-rotation-service.js";
import { RelativeTokenRelationshipService } from "./relationships/relative-token-relationship-service.js";
import { TestHarness } from "./dev/test-harness.js";
import { ActionEffects5eApi } from "./api.js";

const dependencies = new DependencyService();
const compatibility = new CompatibilityService();
const socket = new SocketService();
const movementRegistry = new MovementRegistry();
const relationships = new RelationshipService({ socket });
const relativeRelationships = new RelativeTokenRelationshipService();
const movement = new MovementService({ registry: movementRegistry, relationships });
const relationshipMovement = new RelationshipMovementService({
  socket,
  relationships,
  movement
});
const relationshipRotation = new RelationshipRotationService({
  socket,
  relationships,
  movement,
  relativeRelationships
});
const tests = new TestHarness({
  dependencies,
  compatibility,
  movement,
  relationships,
  relationshipMovement,
  relationshipRotation,
  relativeRelationships,
  socket
});
const api = new ActionEffects5eApi({
  dependencies,
  compatibility,
  movement,
  relationships,
  relationshipMovement,
  relationshipRotation,
  relativeRelationships,
  tests,
  socket
});

// Register before Foundry begins init so Socketlib cannot emit its ready hook first.
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
  relationshipMovement.initialize();
  relationshipRotation.initialize();
  movement.initialize();
  compatibility.refresh();

  Logger.info("Foundation ready. Console API:", `game.modules.get("${MODULE_ID}").api`);
  Hooks.callAll(HOOKS.READY, api);
});
