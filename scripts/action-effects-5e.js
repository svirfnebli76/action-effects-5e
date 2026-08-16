import { MODULE_ID, HOOKS } from "./core/constants.js";
import { Logger } from "./core/logger.js";
import { registerSettings } from "./core/settings.js";
import { DependencyService } from "./core/dependencies.js";
import { CompatibilityService } from "./core/compatibility.js";
import { SocketService } from "./core/socket-service.js";
import { MovementRegistry } from "./movement/movement-registry.js";
import { MovementAccountingService } from "./movement/movement-accounting-service.js";
import { MovementService } from "./movement/movement-service.js";
import { CatMovementAdapter } from "./integrations/cat-movement-adapter.js";
import { RelationshipService } from "./relationships/relationship-service.js";
import { RelationshipMovementService } from "./relationships/relationship-movement-service.js";
import { RelationshipRotationService } from "./relationships/relationship-rotation-service.js";
import { RelationshipLinkObstructionService } from "./relationships/relationship-link-obstruction-service.js";
import { RelativeTokenRelationshipService } from "./relationships/relative-token-relationship-service.js";
import { DisplacementDirectionService } from "./displacement/displacement-direction-service.js";
import { MovementObstructionService } from "./displacement/movement-obstruction-service.js";
import { DisplacementPlanner } from "./displacement/displacement-planner.js";
import { DisplacementDestinationOverlay } from "./displacement/displacement-destination-overlay.js";
import { NonhostileEndpointGraceService } from "./displacement/nonhostile-endpoint-grace-service.js";
import { DisplacementService } from "./displacement/displacement-service.js";
import { SelectionIndicatorService } from "./ui/selection-indicator-service.js";
import { ExternalPromptBridgeService } from "./ui/external-prompt-bridge-service.js";
import { ReactionRegistry } from "./reactions/reaction-registry.js";
import { ReactionAuthorityService } from "./reactions/reaction-authority-service.js";
import { ReactionDiscoveryService } from "./reactions/reaction-discovery-service.js";
import { ReactionOrderingService } from "./reactions/reaction-ordering-service.js";
import { ReactionDialogService } from "./reactions/reaction-dialog-service.js";
import { ReactionBroker } from "./reactions/reaction-broker.js";
import { ReactionEventAdapter } from "./reactions/reaction-event-adapter.js";
import { TestHarness } from "./dev/test-harness.js";
import { ActionEffects5eApi } from "./api.js";

const dependencies = new DependencyService();
const compatibility = new CompatibilityService();
const socket = new SocketService();
const movementRegistry = new MovementRegistry();
const movementAccounting = new MovementAccountingService();
const catMovement = new CatMovementAdapter();
const relationships = new RelationshipService({ socket });
const relativeRelationships = new RelativeTokenRelationshipService();
const movement = new MovementService({ registry: movementRegistry, relationships, accounting: movementAccounting, catMovement });
const displacementDirections = new DisplacementDirectionService();
const movementObstructions = new MovementObstructionService({ relativeRelationships });
const displacementPlanner = new DisplacementPlanner({
  directions: displacementDirections,
  obstructions: movementObstructions
});
const displacementOverlay = new DisplacementDestinationOverlay();
const displacementGrace = new NonhostileEndpointGraceService({
  movement,
  accounting: movementAccounting,
  obstructions: movementObstructions,
  movementExecutor: catMovement
});
const selectionIndicator = new SelectionIndicatorService();
const externalPromptBridge = new ExternalPromptBridgeService({ selectionIndicator });
const reactionRegistry = new ReactionRegistry();
const reactionAuthority = new ReactionAuthorityService({ socket });
const reactionDiscovery = new ReactionDiscoveryService({ registry: reactionRegistry, authority: reactionAuthority });
const reactionOrdering = new ReactionOrderingService();
const reactionDialogs = new ReactionDialogService({ socket, selectionIndicator });
const reactionBroker = new ReactionBroker({
  registry: reactionRegistry,
  discovery: reactionDiscovery,
  ordering: reactionOrdering,
  authority: reactionAuthority,
  dialogs: reactionDialogs,
  socket
});
const reactionEvents = new ReactionEventAdapter({ broker: reactionBroker, registry: reactionRegistry, authority: reactionAuthority });
const displacement = new DisplacementService({
  socket,
  movement,
  accounting: movementAccounting,
  planner: displacementPlanner,
  overlay: displacementOverlay,
  grace: displacementGrace,
  selectionIndicator,
  movementExecutor: catMovement
});
const relationshipLinkObstructions = new RelationshipLinkObstructionService({ relativeRelationships });
const relationshipMovement = new RelationshipMovementService({
  socket,
  relationships,
  movement,
  accounting: movementAccounting
});
const relationshipRotation = new RelationshipRotationService({
  socket,
  relationships,
  movement,
  accounting: movementAccounting,
  relativeRelationships,
  linkObstructions: relationshipLinkObstructions
});
const tests = new TestHarness({
  dependencies,
  compatibility,
  movement,
  movementAccounting,
  catMovement,
  relationships,
  relationshipMovement,
  relationshipRotation,
  relativeRelationships,
  relationshipLinkObstructions,
  displacement,
  selectionIndicator,
  externalPromptBridge,
  reactionRegistry,
  reactionAuthority,
  reactionDiscovery,
  reactionOrdering,
  reactionDialogs,
  reactionBroker,
  reactionEvents,
  socket
});
const api = new ActionEffects5eApi({
  dependencies,
  compatibility,
  movement,
  movementAccounting,
  catMovement,
  relationships,
  relationshipMovement,
  relationshipRotation,
  relativeRelationships,
  relationshipLinkObstructions,
  displacement,
  selectionIndicator,
  externalPromptBridge,
  reactionRegistry,
  reactionAuthority,
  reactionDiscovery,
  reactionOrdering,
  reactionDialogs,
  reactionBroker,
  reactionEvents,
  tests,
  socket
});

// Register before Foundry begins init so Socketlib cannot emit its ready hook first.
socket.initialize();

Hooks.once("init", () => {
  Logger.log("Initializing module foundation.");
  registerSettings();
  movementAccounting.initialize();

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

  movementAccounting.ensureRegistered();
  await relationships.initialize();
  relationshipMovement.initialize();
  relationshipRotation.initialize();
  movement.initialize();
  displacement.initialize();
  await selectionIndicator.initialize();
  externalPromptBridge.initialize();
  await reactionAuthority.initialize();
  reactionEvents.initialize();
  compatibility.refresh();

  Logger.info("Foundation ready. Console API:", `game.modules.get("${MODULE_ID}").api`);
  Hooks.callAll(HOOKS.READY, api);
});
