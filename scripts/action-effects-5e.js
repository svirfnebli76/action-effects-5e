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
import { CatAutomationRegistry } from "./integrations/cat-automation-registry.js";
import { CatMetadataAuthoringService, isValidAutomationVersion } from "./authoring/cat-metadata-authoring-service.js";
import { CatConfigurationAuthoringService } from "./authoring/cat-configuration-authoring-service.js";
import { CatMetadataContextMenuService } from "./authoring/cat-metadata-context-menu-service.js";
import { AnimationOwnershipService } from "./animations/animation-ownership-service.js";
import { AutomatedAnimationsAdapter } from "./integrations/automated-animations-adapter.js";
import { RelationshipService } from "./relationships/relationship-service.js";
import { RelationshipLifecycleService } from "./relationships/relationship-lifecycle-service.js";
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
import { BatchDisplacementService } from "./displacement/batch-displacement-service.js";
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
import { ActivityExecutionService } from "./activities/activity-execution-service.js";
import { RegionAuthorityService } from "./regions/region-authority-service.js";
import { EnvironmentProfileRegistry } from "./environment/environment-profile-registry.js";
import { EnvironmentCapabilityRegistry } from "./environment/environment-capability-registry.js";
import { EnvironmentGeometryService } from "./environment/environment-geometry-service.js";
import { EnvironmentRegionBehaviorRegistry } from "./environment/environment-region-behavior-registry.js";
import { EnvironmentRegionIndex } from "./environment/environment-region-index.js";
import { EnvironmentMutationService } from "./environment/environment-mutation-service.js";
import { EnvironmentTimingService } from "./environment/environment-timing-service.js";
import { FlammabilityService } from "./environment/flammability-service.js";
import { EnvironmentalInteractionService } from "./environment/environmental-interaction-service.js";
import { MidiEnvironmentAdapter } from "./environment/midi-environment-adapter.js";
import { WebService } from "./environment/web-service.js";
import { WebRegionBehaviorType } from "./environment/web-region-behavior-type.js";
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
const catAutomationRegistry = new CatAutomationRegistry();
const catMetadataAuthoring = new CatMetadataAuthoringService();
const catConfigurationAuthoring = new CatConfigurationAuthoringService();
const catMetadataContextMenu = new CatMetadataContextMenuService({
  authoring: catMetadataAuthoring,
  configurationAuthoring: catConfigurationAuthoring,
  registry: catAutomationRegistry
});
const animationOwnership = new AnimationOwnershipService();
const automatedAnimations = new AutomatedAnimationsAdapter({ ownership: animationOwnership });
const relationshipLifecycle = new RelationshipLifecycleService({ relationshipsAccessor: () => relationships });
const relationships = new RelationshipService({ socket, lifecycle: relationshipLifecycle, spending: movementSpending });
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
const activities = new ActivityExecutionService({ socket, authority: reactionAuthority, catSpell });
const regions = new RegionAuthorityService({ socket, authority: reactionAuthority });
const environmentProfiles = new EnvironmentProfileRegistry();
const environmentCapabilities = new EnvironmentCapabilityRegistry();
const environmentGeometry = new EnvironmentGeometryService();
const environmentBehaviors = new EnvironmentRegionBehaviorRegistry();
const environmentIndex = new EnvironmentRegionIndex({ capabilities: environmentCapabilities, geometry: environmentGeometry });
const environmentMutations = new EnvironmentMutationService();
const environmentTiming = new EnvironmentTimingService({ authority: reactionAuthority, mutations: environmentMutations });
const flammability = new FlammabilityService({ profiles: environmentProfiles, mutations: environmentMutations });
environmentCapabilities.register({
  id: "flammable",
  behaviorType: "action-effects-5e.flammable",
  eventTypes: ["fire"],
  handler: context => flammability.handle(context)
});
const environment = new EnvironmentalInteractionService({
  socket,
  authority: reactionAuthority,
  capabilities: environmentCapabilities,
  profiles: environmentProfiles,
  geometry: environmentGeometry,
  index: environmentIndex,
  mutations: environmentMutations
});
const midiEnvironment = new MidiEnvironmentAdapter({ environment, geometry: environmentGeometry });
const web = new WebService({
  socket,
  authority: reactionAuthority,
  regions,
  geometry: environmentGeometry,
  profiles: environmentProfiles,
  mutations: environmentMutations,
  timing: environmentTiming,
  activities,
  ongoingEffects,
  selectionIndicator,
  crosshairs
});
WebRegionBehaviorType.configure(web);
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
const displacementBatch = new BatchDisplacementService({
  socket,
  movement,
  accounting: movementAccounting,
  planner: displacementPlanner
});
const relationshipLinkObstructions = new RelationshipLinkObstructionService({ relativeRelationships });
const relationshipMovement = new RelationshipMovementService({
  socket,
  relationships,
  movement,
  accounting: movementAccounting,
  spending: movementSpending,
  obstructions: movementObstructions
});
const relationshipRotation = new RelationshipRotationService({
  socket,
  relationships,
  movement,
  accounting: movementAccounting,
  spending: movementSpending,
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
  catAutomationRegistry,
  catMetadataAuthoring,
  catConfigurationAuthoring,
  catMetadataContextMenu,
  animationOwnership,
  automatedAnimations,
  spellModifierRegistry,
  spellModifierDiscovery,
  spellModifierChoices,
  spellModifiers,
  spellModifierEvents,
  ongoingEffects,
  activities,
  regions,
  environment,
  environmentGeometry,
  environmentBehaviors,
  environmentCapabilities,
  environmentProfiles,
  environmentIndex,
  environmentMutations,
  environmentTiming,
  flammability,
  midiEnvironment,
  web,
  relationships,
  relationshipLifecycle,
  relationshipMovement,
  relationshipRotation,
  relativeRelationships,
  relationshipLinkObstructions,
  displacement,
  displacementBatch,
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

const ACCEPTED_CAT_METADATA_BOOTSTRAP = Object.freeze([
  Object.freeze({
    uuid: "Compendium.action-effects-5e.spells-level-2.Item.pLcoNw3VnVbgzGU8",
    identifier: "misty-step",
    version: "1.0.0"
  }),
  Object.freeze({
    uuid: "Compendium.action-effects-5e.spells-level-1.Item.TW2x3hkgAbWG2HwY",
    identifier: "entangle",
    rules: "2024",
    version: "1.0.0"
  })
]);

async function bootstrapAcceptedCatMetadata() {
  if (!globalThis.game?.user?.isGM) return { skipped: true, reason: "not-gm", changed: 0 };

  let changed = 0;
  for (const entry of ACCEPTED_CAT_METADATA_BOOTSTRAP) {
    try {
      const document = await globalThis.fromUuid?.(entry.uuid);
      if (!document || document.documentName !== "Item") {
        Logger.warn(`Could not resolve accepted CAT metadata bootstrap Item '${entry.uuid}'.`);
        continue;
      }

      const source = document.flags?.cat?.automation?.source ?? null;
      const version = document.flags?.cat?.automation?.version ?? null;
      if (source === MODULE_ID && isValidAutomationVersion(version)) continue;
      if (source && source !== MODULE_ID) {
        Logger.warn(`Accepted CAT metadata bootstrap skipped '${entry.identifier}' because it is owned by provider '${source}'.`);
        continue;
      }

      await catMetadataAuthoring.setMetadata(document, {
        version: entry.version,
        identifier: entry.identifier,
        ...(entry.rules ? { rules: entry.rules } : {})
      });
      changed += 1;
      Logger.info(`Restored accepted CAT metadata for '${entry.identifier}' at automation version ${entry.version}.`);
    } catch (error) {
      Logger.error(`Could not restore accepted CAT metadata for '${entry.identifier}'.`, error);
    }
  }

  return { skipped: false, changed };
}
const api = new ActionEffects5eApi({
  dependencies,
  compatibility,
  movement,
  movementAccounting,
  movementSpending,
  catMovement,
  catSpell,
  catAutomationRegistry,
  catMetadataAuthoring,
  catConfigurationAuthoring,
  catMetadataContextMenu,
  animationOwnership,
  automatedAnimations,
  spellModifierRegistry,
  spellModifierDiscovery,
  spellModifierChoices,
  spellModifiers,
  spellModifierEvents,
  ongoingEffects,
  activities,
  regions,
  environment,
  environmentGeometry,
  environmentBehaviors,
  environmentCapabilities,
  environmentProfiles,
  environmentIndex,
  environmentMutations,
  environmentTiming,
  flammability,
  midiEnvironment,
  web,
  relationships,
  relationshipLifecycle,
  relationshipMovement,
  relationshipRotation,
  relativeRelationships,
  relationshipLinkObstructions,
  displacement,
  displacementBatch,
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
  catAutomationRegistry.initialize();
  catMetadataContextMenu.initialize();
  movementAccounting.initialize();
  environmentBehaviors.initialize();

  const module = game.modules.get(MODULE_ID);
  if (module) module.api = api;
});

Hooks.once("setup", () => {
  compatibility.refresh();
});

Hooks.once("ready", async () => {
  const catMetadataBootstrap = await bootstrapAcceptedCatMetadata();
  if (catMetadataBootstrap.changed > 0) {
    const registration = catAutomationRegistry.getStatus();
    if (registration.catReadyObserved && registration.source?.registered) {
      try {
        await catAutomationRegistry.refreshPublicCompendiums();
      } catch (error) {
        Logger.warn("Accepted CAT metadata was restored, but public-compendium registration could not be refreshed immediately.", error);
      }
    }
  }

  const status = dependencies.validate({ notify: true });
  if (!status.healthy) {
    Logger.error("Foundation services were not started because required dependencies are unavailable.");
    return;
  }

  movementAccounting.ensureRegistered();
  catMovement.initialize();
  await relationships.initialize();
  await relationshipLifecycle.initialize();
  relationshipMovement.initialize();
  relationshipRotation.initialize();
  movement.initialize();
  displacement.initialize();
  await selectionIndicator.initialize();
  externalPromptBridge.initialize();
  await reactionAuthority.initialize();
  environmentTiming.initialize();
  environment.initialize();
  midiEnvironment.initialize();
  web.initialize();
  automatedAnimations.initialize();
  reactionEvents.initialize();
  spellModifierEvents.initialize();
  ongoingEffects.initialize();
  compatibility.refresh();

  Logger.info("Foundation ready. Console API:", `game.modules.get("${MODULE_ID}").api`);
  Hooks.callAll(HOOKS.READY, api);
});
