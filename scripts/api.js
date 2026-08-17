import {
  ATTACHMENT_MODES,
  COLLISION_POLICIES,
  DISPLACEMENT_DESTINATION_STATES,
  DISPLACEMENT_DIRECTION_CONSTRAINTS,
  DISPLACEMENT_TYPES,
  HOOKS,
  MODULE_ID,
  MODULE_VERSION,
  MOVEMENT_ACTION_IDS,
  MOVEMENT_AGENCIES,
  MOVEMENT_GEOMETRY_CHANNELS,
  MOVEMENT_PHASES,
  MOVEMENT_RESOURCES,
  NONHOSTILE_ENDPOINT_GRACE_MS,
  PATH_TYPES,
  RELATIONSHIP_COORDINATION_POLICIES,
  RELATIONSHIP_FORCED_LEADER_MOVEMENT_POLICIES,
  RELATIONSHIP_GEOMETRY_CHANNELS,
  RELATIONSHIP_LINK_OBSTRUCTION_POLICIES,
  RELATIONSHIP_NONHOSTILE_ENDPOINT_GRACE_MS,
  RELATIONSHIP_NONHOSTILE_ENDPOINT_POLICIES,
  RELATIONSHIP_ORBIT_QUANTUM_DEGREES,
  RELATIONSHIP_ROTATION_POLICIES,
  RELATIVE_TOKEN_RELATIONSHIPS,
  RELATIONSHIP_TYPES,
  REACTION_TRIGGERS,
  REACTION_TRANSACTION_STATES,
  REACTION_RESPONSES,
  REACTION_SOURCE_RESULTS,
  SME_PHASES,
  SME_MODIFIER_MODES,
  SME_SESSION_STATES,
  SME_FLAG_SCOPE,
  SME_FLAG_KEY,
  SME_WORKFLOW_STATE_PATH,
  SELECTION_INDICATOR_EFFECT_NAME,
  SELECTION_INDICATOR_FALLBACK_ASSET,
  SELECTION_INDICATOR_FALLBACK_SCALE,
  SELECTION_INDICATOR_PREFERRED_ASSET,
  SELECTION_INDICATOR_PREFERRED_SCALE,
  SELECTION_INDICATOR_PREFERRED_TINT,
  SELECTION_INDICATOR_PRESENTATIONS,
  SELECTION_INDICATOR_ROLES,
  SELECTION_INDICATOR_ROLE_PRIORITY,
  SELECTION_INDICATOR_SOUND_ASSET,
  SELECTION_INDICATOR_SOUND_VOLUME,
  SELECTION_INDICATOR_CORNER_OFFSET_FACTOR,
  SELECTION_INDICATOR_SCALE,
  TELEPORT_POLICIES
} from "./core/constants.js";
import {
  ESKIE_CROSSHAIR_COLORS,
  ESKIE_CROSSHAIR_DEFAULTS,
  ESKIE_CROSSHAIR_SEMANTICS,
  ESKIE_CROSSHAIR_SHAPES,
  ESKIE_FREE_MODULE_ID,
  ESKIE_PREMIUM_MODULE_ID,
  ESKIE_TINT_APPROXIMATIONS,
  SEQUENCER_MODULE_ID
} from "./crosshairs/eskie-crosshair-catalog.js";

export class ActionEffects5eApi {
  constructor({
    dependencies,
    compatibility,
    movement,
    movementAccounting,
    catMovement,
    catSpell,
    spellModifierRegistry,
    spellModifierDiscovery,
    spellModifierChoices,
    spellModifiers,
    spellModifierEvents,
    relationships,
    relationshipMovement,
    relationshipRotation,
    relativeRelationships,
    relationshipLinkObstructions,
    displacement,
    selectionIndicator,
    externalPromptBridge,
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
  }) {
    this.version = MODULE_VERSION;

    this.constants = Object.freeze({
      MODULE_ID,
      HOOKS,
      MOVEMENT_PHASES,
      PATH_TYPES,
      MOVEMENT_ACTION_IDS,
      MOVEMENT_AGENCIES,
      MOVEMENT_RESOURCES,
      MOVEMENT_GEOMETRY_CHANNELS,
      DISPLACEMENT_TYPES,
      DISPLACEMENT_DIRECTION_CONSTRAINTS,
      DISPLACEMENT_DESTINATION_STATES,
      NONHOSTILE_ENDPOINT_GRACE_MS,
      RELATIONSHIP_TYPES,
      RELATIONSHIP_COORDINATION_POLICIES,
      RELATIONSHIP_FORCED_LEADER_MOVEMENT_POLICIES,
      RELATIONSHIP_ROTATION_POLICIES,
      RELATIONSHIP_GEOMETRY_CHANNELS,
      RELATIONSHIP_LINK_OBSTRUCTION_POLICIES,
      RELATIVE_TOKEN_RELATIONSHIPS,
      RELATIONSHIP_NONHOSTILE_ENDPOINT_POLICIES,
      RELATIONSHIP_NONHOSTILE_ENDPOINT_GRACE_MS,
      RELATIONSHIP_ORBIT_QUANTUM_DEGREES,
      ATTACHMENT_MODES,
      TELEPORT_POLICIES,
      COLLISION_POLICIES,
      REACTION_TRIGGERS,
      REACTION_TRANSACTION_STATES,
      REACTION_RESPONSES,
      REACTION_SOURCE_RESULTS,
      SME_PHASES,
      SME_MODIFIER_MODES,
      SME_SESSION_STATES,
      SME_FLAG_SCOPE,
      SME_FLAG_KEY,
      SME_WORKFLOW_STATE_PATH,
      ESKIE_PREMIUM_MODULE_ID,
      ESKIE_FREE_MODULE_ID,
      SEQUENCER_MODULE_ID,
      ESKIE_CROSSHAIR_SHAPES,
      ESKIE_CROSSHAIR_COLORS,
      ESKIE_CROSSHAIR_DEFAULTS,
      ESKIE_CROSSHAIR_SEMANTICS,
      ESKIE_TINT_APPROXIMATIONS,
      SELECTION_INDICATOR_PREFERRED_ASSET,
      SELECTION_INDICATOR_PREFERRED_TINT,
      SELECTION_INDICATOR_FALLBACK_ASSET,
      SELECTION_INDICATOR_SOUND_ASSET,
      SELECTION_INDICATOR_SOUND_VOLUME,
      SELECTION_INDICATOR_PREFERRED_SCALE,
      SELECTION_INDICATOR_FALLBACK_SCALE,
      SELECTION_INDICATOR_CORNER_OFFSET_FACTOR,
      SELECTION_INDICATOR_SCALE,
      SELECTION_INDICATOR_EFFECT_NAME,
      SELECTION_INDICATOR_ROLES,
      SELECTION_INDICATOR_ROLE_PRIORITY,
      SELECTION_INDICATOR_PRESENTATIONS
    });

    this.dependencies = Object.freeze({
      getStatus: () => dependencies.getStatus(),
      validate: (options) => dependencies.validate(options)
    });

    this.compatibility = Object.freeze({
      getStatus: () => compatibility.getStatus(),
      refresh: () => compatibility.refresh(),
      getPreferredController: (options) => compatibility.getPreferredController(options)
    });

    this.interoperability = Object.freeze({
      cat: Object.freeze({
        getStatus: () => catMovement.getStatus(),
        getStats: () => catMovement.getStats(),
        spell: Object.freeze({
          getStatus: () => catSpell.getStatus(),
          getStats: () => catSpell.getStats()
        })
      })
    });

    const smeApi = Object.freeze({
      registerModifier: (id, config) => spellModifiers.registerModifier(id, config),
      unregisterModifier: (id) => spellModifiers.unregisterModifier(id),
      discover: (options) => spellModifiers.discover(options),
      processPhase: (phase, workflow, options) => spellModifiers.processPhase(phase, workflow, options),
      processMidiPhase: (phase, workflow, options) => spellModifierEvents.processMidiPhase(phase, workflow, options),
      getRegistration: (source) => spellModifierDiscovery.getRegistration(source),
      getSession: (subject) => spellModifiers.getSession(subject),
      getRecentSessions: () => spellModifiers.getRecentSessions(),
      rollbackSession: (subject, options) => spellModifiers.rollbackSession(subject, options),
      clearSession: (subject, options) => spellModifiers.clearSession(subject, options),
      getStats: () => spellModifiers.getStats(),
      getRegistryStats: () => spellModifierRegistry.getStats(),
      getChoiceStats: () => spellModifierChoices.getStats(),
      getEventAdapterStats: () => spellModifierEvents.getStats(),
      getCatStatus: () => catSpell.getStatus()
    });
    this.sme = smeApi;
    this.spellModifiers = smeApi;

    this.movement = Object.freeze({
      registerConsumer: (config) => movement.registerConsumer(config),
      unregisterConsumer: (id) => movement.unregisterConsumer(id),
      createOperationOptions: (metadata) => movement.createOperationOptions(metadata),
      getRecentTransactions: () => movement.getRecentTransactions(),
      getHistorySnapshot: (subject) => movementAccounting.getHistorySnapshot(subject),
      getHistoryCost: (subject) => movementAccounting.getHistoryCost(subject),
      getNoCostActionId: () => movementAccounting.noCostActionId,
      registerFinalCostModifier: (id, config) => movementAccounting.registerFinalCostModifier(id, config),
      unregisterFinalCostModifier: (id) => movementAccounting.unregisterFinalCostModifier(id),
      applyNoCostToWaypoints: (waypoints, options) => movementAccounting.applyNoCostToWaypoints(waypoints, options),
      getAccountingStats: () => movementAccounting.getStats(),
      getStats: () => movement.getStats()
    });

    this.displacement = Object.freeze({
      request: (options) => displacement.request(options),
      push: (options) => displacement.push(options),
      pull: (options) => displacement.pull(options),
      getCandidates: (options) => displacement.getCandidates(options),
      clearSelection: () => displacement.clearSelection(),
      clearEndpointGrace: (subjectUuid) => displacement.clearEndpointGrace(subjectUuid),
      getRecentResults: () => displacement.getRecentResults(),
      getStats: () => displacement.getStats()
    });

    this.selection = Object.freeze({
      acquire: (options) => selectionIndicator.acquire(options),
      release: (leaseOrId) => selectionIndicator.release(leaseOrId),
      withIndicator: (options, interaction) => selectionIndicator.withIndicator(options, interaction),
      waitForDialog: (options) => selectionIndicator.waitForDialog(options),
      clearAll: () => selectionIndicator.clearAll(),
      getStats: () => selectionIndicator.getStats()
    });

    this.externalPrompts = Object.freeze({
      registerAdapter: (config) => externalPromptBridge.registerAdapter(config),
      unregisterAdapter: (id) => externalPromptBridge.unregisterAdapter(id),
      trackApplication: (options) => externalPromptBridge.trackApplication(options),
      clearAll: () => externalPromptBridge.clearAll(),
      getStats: () => externalPromptBridge.getStats()
    });

    this.crosshairs = Object.freeze({
      getEskieStatus: () => crosshairs.getEskieStatus(),
      getShapeInfo: (shape) => crosshairs.getShapeInfo(shape),
      getCatalog: (options) => crosshairs.getCatalog(options),
      resolveAsset: (request, options) => crosshairs.resolveAsset(request, options),
      show: (options) => crosshairs.show(options),
      getStats: () => crosshairs.getStats()
    });

    this.reactions = Object.freeze({
      registerHandler: (id, config) => reactionRegistry.registerHandler(id, config),
      unregisterHandler: (id) => reactionRegistry.unregisterHandler(id),
      process: (context, options) => reactionBroker.process(context, options),
      requestManual: (transactionId, reason) => reactionBroker.requestManual(transactionId, reason),
      getTransaction: (transactionId) => reactionBroker.getTransaction(transactionId),
      getRecentTransactions: () => reactionBroker.getRecentTransactions(),
      getStats: () => reactionBroker.getStats(),
      getAuthorityStatus: () => reactionAuthority.getStatus(),
      refreshAuthority: () => reactionAuthority.refreshLedger(),
      getDialogStats: () => reactionDialogs.getStats(),
      getEventAdapterStats: () => reactionEvents.getStats(),
      getRegistration: (activity, item) => reactionDiscovery.getActivityRegistration(activity, item),
      previewOrder: (opportunities, options) => reactionOrdering.order(opportunities, options)
    });

    this.relationships = Object.freeze({
      create: (data) => relationships.create(data),
      remove: (id) => relationships.remove(id),
      updateGeometry: (id, changes) => relationships.updateGeometry(id, changes),
      get: (id) => relationships.get(id),
      getForLeader: (uuid) => relationships.getForLeader(uuid),
      getForFollower: (uuid) => relationships.getForFollower(uuid),
      list: (filter) => relationships.list(filter),
      moveGroup: (request) => relationshipMovement.moveGroup(request),
      waitForMovementSettled: async (options) => {
        await relationshipRotation.waitForSettled(options);
        return relationshipMovement.waitForMovementSettled(options);
      },
      getRotationStats: () => relationshipRotation.getStats(),
      getStats: () => relationships.getStats(),
      getMovementStats: () => relationshipMovement.getStats(),
      resolveRelativeRelationship: (referenceToken, otherToken, options = {}) => relativeRelationships.resolve({
        referenceToken,
        otherToken,
        geometryChannel: options.geometryChannel ?? null
      }),
      resolveRelativeRelationshipForGeometry: (options = {}) => relativeRelationships.resolveForGeometry(options),
      inspectGrappleLinkAtPosition: (options = {}) => relationshipLinkObstructions.inspectAtPosition(options),
      inspectGrappleLinkSweep: (options = {}) => relationshipLinkObstructions.inspectSweep(options)
    });

    this.tests = Object.freeze({
      runCrosshairFoundationTest: (options) => tests.runCrosshairFoundationTest(options),
      runCrosshairInteractiveTest: (options) => tests.runCrosshairInteractiveTest(options),
      runSpellModifierEngineFoundationTest: (options) => tests.runSpellModifierEngineFoundationTest(options),
      runSpellModifierEngineLiveActivitySubstitutionTest: (options) => tests.runSpellModifierEngineLiveActivitySubstitutionTest(options),
      runFoundationSmokeTest: (options) => tests.runFoundationSmokeTest(options),
      runMovementAccountingTest: (options) => tests.runMovementAccountingTest(options),
      runCatMovementInteroperabilityTest: (options) => tests.runCatMovementInteroperabilityTest(options),
      setupReactionBrokerTestScene: (options) => tests.setupReactionBrokerTestScene(options),
      runReactionBrokerFoundationTest: (options) => tests.runReactionBrokerFoundationTest(options),
      runReactionBrokerInteractiveTest: (options) => tests.runReactionBrokerInteractiveTest(options),
      runReactionBrokerMidiWorkflowGateTest: (options) => tests.runReactionBrokerMidiWorkflowGateTest(options),
      runReactionBrokerMultiplayerTest: (options) => tests.runReactionBrokerMultiplayerTest(options),
      runReactionBrokerNoGmTest: () => tests.runReactionBrokerNoGmTest(),
      clearReactionBrokerTestState: (options) => tests.clearReactionBrokerTestState(options),
      inspectReactionBroker: () => tests.inspectReactionBroker(),
      runSelectionIndicatorTest: () => tests.runSelectionIndicatorTest(),
      runSelectionIndicatorRolePairTest: () => tests.runSelectionIndicatorRolePairTest(),
      runExternalPromptBridgeTest: () => tests.runExternalPromptBridgeTest(),
      runExternalPromptIsolationTest: () => tests.runExternalPromptIsolationTest(),
      createTestRelationshipFromControlledTokens: () => tests.createTestRelationshipFromControlledTokens(),
      createGrappleMovementTestRelationshipFromControlledTokens: (options) => tests.createGrappleMovementTestRelationshipFromControlledTokens(options),
      removeTestRelationships: () => tests.removeTestRelationships(),
      inspectControlledRelationship: () => tests.inspectControlledRelationship(),
      inspectRelationshipGeometry: (options) => tests.inspectRelationshipGeometry(options),
      inspectOrbitShell: (options) => tests.inspectOrbitShell(options),
      validateRelationshipGeometry: (options) => tests.validateRelationshipGeometry(options),
      showOrbitDebug: (options) => tests.showOrbitDebug(options),
      clearOrbitDebug: () => tests.clearOrbitDebug(),
      orbitClockwise: (options) => tests.orbitClockwise(options),
      orbitCounterclockwise: (options) => tests.orbitCounterclockwise(options),
      runFollowerBodyDispositionMatrix: (options) => tests.runFollowerBodyDispositionMatrix(options),
      previewDisplacementFromControlledTokens: (options) => tests.previewDisplacementFromControlledTokens(options),
      runShoveDestinationGeometryTest: (options) => tests.runShoveDestinationGeometryTest(options),
      runDisplacementFoundationTest: (options) => tests.runDisplacementFoundationTest(options),
      runGrappleLinkObstructionTest: (options) => tests.runGrappleLinkObstructionTest(options)
    });

    this.socket = Object.freeze({
      isReady: () => socket.ready
    });

    Object.freeze(this);
  }
}
