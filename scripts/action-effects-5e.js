import { MODULE_ID, HOOKS } from "./core/constants.js";
import { Logger } from "./core/logger.js";
import { registerSettings } from "./core/settings.js";
import { DependencyService } from "./core/dependencies.js";
import { CompatibilityService } from "./core/compatibility.js";
import { SocketService } from "./core/socket-service.js";
import { MovementRegistry } from "./movement/movement-registry.js";
import { MovementAccountingService } from "./movement/movement-accounting-service.js";
import { MovementSpendService } from "./movement/movement-spend-service.js";
import { MovementService } from "./movement/movement-service.js";
import { CatMovementAdapter } from "./integrations/cat-movement-adapter.js";
import { CatSpellAdapter } from "./integrations/cat-spell-adapter.js";
import { AnimationOwnershipService } from "./animations/animation-ownership-service.js";
import { AutomatedAnimationsAdapter } from "./integrations/automated-animations-adapter.js";
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
import { ChoicePromptService } from "./ui/choice-prompt-service.js";
import { CrosshairService } from "./crosshairs/crosshair-service.js";
import { ReactionRegistry } from "./reactions/reaction-registry.js";
import { ReactionAuthorityService } from "./reactions/reaction-authority-service.js";
import { ReactionDiscoveryService } from "./reactions/reaction-discovery-service.js";
import { ReactionOrderingService } from "./reactions/reaction-ordering-service.js";
import { ReactionDialogService } from "./reactions/reaction-dialog-service.js";
import { ReactionBroker } from "./reactions/reaction-broker.js";
import { ReactionEventAdapter } from "./reactions/reaction-event-adapter.js";
import { SpellModifierRegistry } from "./spell-modifiers/spell-modifier-registry.js";
import { SpellModifierDiscoveryService } from "./spell-modifiers/spell-modifier-discovery-service.js";
import { SpellModifierChoiceService } from "./spell-modifiers/spell-modifier-choice-service.js";
import { SpellModifierEngine } from "./spell-modifiers/spell-modifier-engine.js";
import { SpellModifierEventAdapter } from "./spell-modifiers/spell-modifier-event-adapter.js";
import { OngoingEffectService } from "./ongoing-effects/ongoing-effect-service.js";
import { RegionAuthorityService } from "./regions/region-authority-service.js";
import { TestHarness } from "./dev/test-harness.js";
import { ActionEffects5eApi } from "./api.js";

const dependencies = new DependencyService();
const compatibility = new CompatibilityService();
const socket = new SocketService();
const movementRegistry = new MovementRegistry();
const movementAccounting = new MovementAccountingService();
const movementSpending = new MovementSpendService({ socket, accounting: movementAccounting });
const catMovement = new CatMovementAdapter({ socket });
const catSpell = new CatSpellAdapter();
const animationOwnership = new AnimationOwnershipService();
const automatedAnimations = new AutomatedAnimationsAdapter({ ownership: animationOwnership });
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
const crosshairs = new CrosshairService();
const reactionRegistry = new ReactionRegistry();
const reactionAuthority = new ReactionAuthorityService({ socket });
const choicePrompts = new ChoicePromptService({ socket, selectionIndicator, authority: reactionAuthority });
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
const spellModifierRegistry = new SpellModifierRegistry();
const spellModifierDiscovery = new SpellModifierDiscoveryService({ registry: spellModifierRegistry });
const spellModifierChoices = new SpellModifierChoiceService({ socket, selectionIndicator });
const spellModifiers = new SpellModifierEngine({
  registry: spellModifierRegistry,
  discovery: spellModifierDiscovery,
  choices: spellModifierChoices,
  catSpell,
  authority: reactionAuthority
});
const spellModifierEvents = new SpellModifierEventAdapter({ engine: spellModifiers, authority: reactionAuthority });
const ongoingEffects = new OngoingEffectService({ socket, authority: reactionAuthority, catSpell, selectionIndicator });
const regions = new RegionAuthorityService({ socket, authority: reactionAuthority });
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
  movementSpending,
  catMovement,
  catSpell,
  animationOwnership,
  automatedAnimations,
  spellModifierRegistry,
  spellModifierDiscovery,
  spellModifierChoices,
  spellModifiers,
  spellModifierEvents,
  ongoingEffects,
  regions,
  relationships,
  relationshipMovement,
  relationshipRotation,
  relativeRelationships,
  relationshipLinkObstructions,
  displacement,
  displacementOverlay,
  selectionIndicator,
  externalPromptBridge,
  choicePrompts,
  crosshairs,
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
  movementSpending,
  catMovement,
  catSpell,
  animationOwnership,
  automatedAnimations,
  spellModifierRegistry,
  spellModifierDiscovery,
  spellModifierChoices,
  spellModifiers,
  spellModifierEvents,
  ongoingEffects,
  regions,
  relationships,
  relationshipMovement,
  relationshipRotation,
  relativeRelationships,
  relationshipLinkObstructions,
  displacement,
  selectionIndicator,
  externalPromptBridge,
  choicePrompts,
  crosshairs,
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
  catMovement.initialize();
  await relationships.initialize();
  relationshipMovement.initialize();
  relationshipRotation.initialize();
  movement.initialize();
  displacement.initialize();
  await selectionIndicator.initialize();
  externalPromptBridge.initialize();
  await reactionAuthority.initialize();
  automatedAnimations.initialize();
  reactionEvents.initialize();
  spellModifierEvents.initialize();
  ongoingEffects.initialize();
  compatibility.refresh();

  Logger.info("Foundation ready. Console API:", `game.modules.get("${MODULE_ID}").api`);
  Hooks.callAll(HOOKS.READY, api);
});
