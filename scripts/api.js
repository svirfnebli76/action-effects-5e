import {
  ATTACHMENT_MODES,
  COLLISION_POLICIES,
  HOOKS,
  MODULE_ID,
  MODULE_VERSION,
  MOVEMENT_AGENCIES,
  MOVEMENT_PHASES,
  MOVEMENT_RESOURCES,
  PATH_TYPES,
  RELATIONSHIP_TYPES,
  TELEPORT_POLICIES
} from "./core/constants.js";

export class ActionEffects5eApi {
  constructor({
    dependencies,
    compatibility,
    movement,
    relationships,
    relationshipMovement,
    tests,
    socket
  }) {
    this.version = MODULE_VERSION;

    this.constants = Object.freeze({
      MODULE_ID,
      HOOKS,
      MOVEMENT_PHASES,
      PATH_TYPES,
      MOVEMENT_AGENCIES,
      MOVEMENT_RESOURCES,
      RELATIONSHIP_TYPES,
      ATTACHMENT_MODES,
      TELEPORT_POLICIES,
      COLLISION_POLICIES
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

    this.movement = Object.freeze({
      registerConsumer: (config) => movement.registerConsumer(config),
      unregisterConsumer: (id) => movement.unregisterConsumer(id),
      createOperationOptions: (metadata) => movement.createOperationOptions(metadata),
      getRecentTransactions: () => movement.getRecentTransactions(),
      getStats: () => movement.getStats()
    });

    this.relationships = Object.freeze({
      create: (data) => relationships.create(data),
      remove: (id) => relationships.remove(id),
      get: (id) => relationships.get(id),
      getForLeader: (uuid) => relationships.getForLeader(uuid),
      getForFollower: (uuid) => relationships.getForFollower(uuid),
      list: (filter) => relationships.list(filter),
      getStats: () => relationships.getStats(),
      getMovementStats: () => relationshipMovement.getStats()
    });

    this.tests = Object.freeze({
      runFoundationSmokeTest: (options) => tests.runFoundationSmokeTest(options),
      createTestRelationshipFromControlledTokens: () => tests.createTestRelationshipFromControlledTokens(),
      removeTestRelationships: () => tests.removeTestRelationships(),
      inspectControlledRelationship: () => tests.inspectControlledRelationship()
    });

    this.socket = Object.freeze({
      isReady: () => socket.ready
    });

    Object.freeze(this);
  }
}
