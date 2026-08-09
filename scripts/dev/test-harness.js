import {
  ATTACHMENT_MODES,
  COLLISION_POLICIES,
  MODULE_ID,
  MOVEMENT_PHASES,
  RELATIONSHIP_COORDINATION_POLICIES,
  RELATIONSHIP_FORCED_LEADER_MOVEMENT_POLICIES,
  RELATIONSHIP_ROTATION_POLICIES,
  RELATIONSHIP_TYPES,
  TELEPORT_POLICIES
} from "../core/constants.js";
import { Logger } from "../core/logger.js";
import { MovementTransaction } from "../movement/movement-transaction.js";
import { RelationshipGeometryService } from "../relationships/relationship-geometry-service.js";
import { OrbitDebugOverlay } from "./orbit-debug-overlay.js";

export class TestHarness {
  #dependencies;
  #compatibility;
  #movement;
  #relationships;
  #relationshipMovement;
  #relationshipRotation;
  #socket;
  #orbitOverlay = new OrbitDebugOverlay();

  constructor({ dependencies, compatibility, movement, relationships, relationshipMovement, relationshipRotation, socket }) {
    this.#dependencies = dependencies;
    this.#compatibility = compatibility;
    this.#movement = movement;
    this.#relationships = relationships;
    this.#relationshipMovement = relationshipMovement;
    this.#relationshipRotation = relationshipRotation;
    this.#socket = socket;
  }

  async runFoundationSmokeTest({ notify = true } = {}) {
    const checks = [];
    const record = (name, passed, details = null) => checks.push({ name, passed: Boolean(passed), details });

    const dependencyStatus = this.#dependencies.validate({ notify: false });
    record("Required dependencies", dependencyStatus.healthy, dependencyStatus);
    const compatibilityStatus = this.#compatibility.refresh();
    record("Compatibility detection", true, compatibilityStatus);

    const consumerId = `${MODULE_ID}.tests.synthetic-consumer`;
    const consumersBefore = this.#movement.getStats().registry.consumers;
    let syntheticReceived = false;
    const unregister = this.#movement.registerConsumer({
      id: consumerId,
      phases: [MOVEMENT_PHASES.AFTER],
      priority: 9999,
      handler: (transaction) => { syntheticReceived = transaction.method === "synthetic"; },
      once: true
    });
    try {
      const transaction = MovementTransaction.synthetic();
      await this.#movement.dispatchSyntheticForTesting(transaction);
      record("Synthetic movement dispatch", syntheticReceived, transaction.toJSON());
    } finally {
      unregister();
    }

    record("Movement registry cleanup", this.#movement.getStats().registry.consumers === consumersBefore, {
      consumersBefore,
      consumersAfter: this.#movement.getStats().registry.consumers
    });
    record("Relationship indexes", this.#relationships.getStats().relationships >= 0, this.#relationships.getStats());
    record("Relationship movement service", this.#relationshipMovement.getStats().initialized, this.#relationshipMovement.getStats());
    record("Relationship rotation service", this.#relationshipRotation.getStats().initialized, this.#relationshipRotation.getStats());
    record("Socketlib registration", this.#socket.ready, { ready: this.#socket.ready });

    const passed = checks.every((check) => check.passed);
    const result = {
      passed,
      checks,
      movement: this.#movement.getStats(),
      relationships: this.#relationships.getStats(),
      relationshipMovement: this.#relationshipMovement.getStats(),
      relationshipRotation: this.#relationshipRotation.getStats(),
      compatibility: compatibilityStatus
    };
    Logger.info("Foundation smoke test", result);
    if (notify && ui?.notifications) {
      ui.notifications[passed ? "info" : "warn"](
        passed
          ? "Action Effects 5E foundation smoke test passed. See the console for details."
          : "Action Effects 5E foundation smoke test found a problem. See the console for details."
      );
    }
    return result;
  }

  async createTestRelationshipFromControlledTokens() {
    const [leader, follower] = this.#controlledPair();
    const relationship = await this.#relationships.create({
      type: RELATIONSHIP_TYPES.TEST,
      attachmentMode: ATTACHMENT_MODES.ADJACENT_FOLLOWER,
      leaderUuid: leader.uuid,
      followerUuid: follower.uuid,
      followerCanSelfMove: false,
      followElevation: true,
      followRotation: false,
      teleportPolicy: TELEPORT_POLICIES.DETACH,
      collisionPolicy: COLLISION_POLICIES.STOP_GROUP,
      coordinationPolicy: RELATIONSHIP_COORDINATION_POLICIES.COORDINATED,
      rotationPolicy: RELATIONSHIP_ROTATION_POLICIES.ORBIT_FOLLOWER,
      metadata: { createdByTestHarness: true }
    });
    this.#leaveLeaderControlled(leader);
    ui.notifications.info(`Created test relationship ${relationship.id}. The leader remains controlled; move it to test coordinated following.`);
    return relationship;
  }

  async createGrappleMovementTestRelationshipFromControlledTokens(options = {}) {
    const [leader, follower] = this.#controlledPair();
    const scene = leader.parent;
    const gridDistance = Number(scene?.grid?.distance);
    const defaultDistance = Number.isFinite(gridDistance) && gridDistance > 0 ? gridDistance : 5;
    const currentPlanarDistance = RelationshipGeometryService.planarDistance({ scene, leader, follower });
    const breakDistance = Number.isFinite(Number(options.breakDistance)) && Number(options.breakDistance) >= 0
      ? Number(options.breakDistance)
      : defaultDistance;
    const coordinationDistance = Number.isFinite(Number(options.coordinationDistance)) && Number(options.coordinationDistance) >= 0
      ? Number(options.coordinationDistance)
      : (Number.isFinite(currentPlanarDistance) && currentPlanarDistance > 0 ? currentPlanarDistance : defaultDistance);

    if (coordinationDistance > breakDistance + 1e-6) {
      throw new Error(`The test coordination distance (${coordinationDistance}) cannot exceed breakDistance (${breakDistance}).`);
    }
    if (Number.isFinite(currentPlanarDistance) && currentPlanarDistance > breakDistance + 1e-6) {
      throw new Error(`The controlled tokens are currently ${currentPlanarDistance} distance units apart, beyond breakDistance ${breakDistance}.`);
    }
    if (Object.prototype.hasOwnProperty.call(options, "coordinationDistance")
      && Number.isFinite(currentPlanarDistance)
      && currentPlanarDistance > 1e-6
      && Math.abs(currentPlanarDistance - coordinationDistance) > 1e-6) {
      throw new Error(`The controlled tokens are currently ${currentPlanarDistance} distance units apart; place them on the requested ${coordinationDistance}-unit coordination band first.`);
    }

    const relationship = await this.#relationships.create({
      type: RELATIONSHIP_TYPES.TEST,
      attachmentMode: ATTACHMENT_MODES.GRAPPLE_FOLLOWER,
      leaderUuid: leader.uuid,
      followerUuid: follower.uuid,
      followerCanSelfMove: false,
      followElevation: true,
      followRotation: false,
      teleportPolicy: TELEPORT_POLICIES.DETACH,
      collisionPolicy: COLLISION_POLICIES.STOP_GROUP,
      coordinationPolicy: RELATIONSHIP_COORDINATION_POLICIES.COORDINATED,
      forcedLeaderMovementPolicy: RELATIONSHIP_FORCED_LEADER_MOVEMENT_POLICIES.INDEPENDENT,
      rotationPolicy: RELATIONSHIP_ROTATION_POLICIES.ORBIT_FOLLOWER,
      breakDistance,
      coordinationDistance,
      metadata: {
        createdByTestHarness: true,
        grappleMovementFixture: true,
        requestedTestOptions: { breakDistance, coordinationDistance }
      }
    });

    this.#leaveLeaderControlled(leader);
    ui.notifications.info(
      `Created grapple-like test relationship ${relationship.id} with break distance ${breakDistance} and coordination distance ${coordinationDistance}.`
    );
    return relationship;
  }

  async removeTestRelationships() {
    this.#orbitOverlay.clear();
    const tests = this.#relationships.list({ type: RELATIONSHIP_TYPES.TEST })
      .filter((relationship) => relationship.metadata?.createdByTestHarness === true);
    const results = [];
    for (const relationship of tests) {
      results.push({ id: relationship.id, removed: await this.#relationships.remove(relationship.id) });
    }
    ui.notifications.info(`Removed ${results.filter((entry) => entry.removed).length} test relationship(s).`);
    return results;
  }

  inspectControlledRelationship() {
    if (!canvas?.ready) throw new Error("A Scene canvas must be active.");
    const controlled = canvas.tokens.controlled.map((token) => token.document);
    if (controlled.length !== 1) throw new Error("Control exactly one token to inspect its relationships.");
    const token = controlled[0];
    const result = {
      tokenUuid: token.uuid,
      asLeader: this.#relationships.getForLeader(token.uuid),
      asFollower: this.#relationships.getForFollower(token.uuid),
      movement: this.#relationshipMovement.getStats(),
      rotation: this.#relationshipRotation.getStats()
    };
    Logger.info("Controlled token relationship inspection", result);
    return result;
  }

  async inspectRelationshipGeometry(options = {}) {
    const resolved = await this.#resolveRelationshipTokens(options);
    const { relationship, scene, leader, follower } = resolved;
    const shell = RelationshipGeometryService.generateOrbitShell({ scene, leader, follower, relationship });
    const current = RelationshipGeometryService.findOrbitPosition({ shell, follower });
    const clockwise = RelationshipGeometryService.planOrbitStep({ scene, leader, follower, relationship, direction: 1 });
    const counterclockwise = RelationshipGeometryService.planOrbitStep({ scene, leader, follower, relationship, direction: -1 });
    const result = {
      relationshipId: relationship.id,
      leader: this.#tokenGeometry(leader),
      follower: this.#tokenGeometry(follower),
      breakDistance: relationship.breakDistance ?? null,
      coordinationDistance: RelationshipGeometryService.coordinationDistance({ scene, relationship, leader, follower }),
      currentFollowerBearing: current?.bearing ?? null,
      currentOrbitIndex: current?.index ?? null,
      shellPositions: shell.length,
      clockwiseCandidate: clockwise.target,
      clockwiseDelta: clockwise.angularDelta,
      counterclockwiseCandidate: counterclockwise.target,
      counterclockwiseDelta: counterclockwise.angularDelta,
      rotationDiagnostics: this.#relationshipRotation.getDiagnostics(relationship.id)
    };
    Logger.info("Relationship geometry inspection", result);
    return result;
  }

  async inspectOrbitShell(options = {}) {
    const { relationship, scene, leader, follower } = await this.#resolveRelationshipTokens(options);
    const shell = RelationshipGeometryService.generateOrbitShell({ scene, leader, follower, relationship });
    const result = shell.map((position) => ({
      index: position.index,
      x: position.x,
      y: position.y,
      bearing: position.bearing,
      distance: position.distance
    }));
    Logger.info("Relationship orbit shell", { relationshipId: relationship.id, positions: result });
    return result;
  }

  async validateRelationshipGeometry(options = {}) {
    const { relationship, scene, leader, follower } = await this.#resolveRelationshipTokens(options);
    const result = RelationshipGeometryService.validateOrbitShell({ scene, leader, follower, relationship });
    Logger.info("Relationship geometry validation", { relationshipId: relationship.id, ...result });
    ui?.notifications?.[result.passed ? "info" : "warn"]?.(
      result.passed
        ? `Relationship geometry validation passed (${result.shellSize} orbit positions).`
        : "Relationship geometry validation found a problem. See the console for details."
    );
    return result;
  }

  async showOrbitDebug(options = {}) {
    const { relationship, scene, leader, follower } = await this.#resolveRelationshipTokens(options);
    const shell = RelationshipGeometryService.generateOrbitShell({ scene, leader, follower, relationship });
    const current = RelationshipGeometryService.findOrbitPosition({ shell, follower });
    return this.#orbitOverlay.show({ shell, currentIndex: current?.index ?? null, leader, follower, grid: scene.grid });
  }

  clearOrbitDebug() {
    return this.#orbitOverlay.clear();
  }

  async orbitClockwise(options = {}) {
    const { relationship } = await this.#resolveRelationshipTokens(options);
    return this.#relationshipRotation.requestOrbitStep({ relationshipId: relationship.id, direction: 1 });
  }

  async orbitCounterclockwise(options = {}) {
    const { relationship } = await this.#resolveRelationshipTokens(options);
    return this.#relationshipRotation.requestOrbitStep({ relationshipId: relationship.id, direction: -1 });
  }

  #controlledPair() {
    if (!canvas?.ready) throw new Error("A Scene canvas must be active.");
    const controlled = canvas.tokens.controlled.map((token) => token.document);
    if (controlled.length !== 2) throw new Error("Control exactly two tokens: leader first, then follower.");
    return controlled;
  }

  #leaveLeaderControlled(leader) {
    for (const token of canvas.tokens.controlled) token.release();
    leader.object?.control?.({ releaseOthers: true });
  }

  async #resolveRelationshipTokens({ relationshipId = null } = {}) {
    if (!canvas?.ready) throw new Error("A Scene canvas must be active.");
    let relationship = relationshipId ? this.#relationships.get(relationshipId) : null;
    if (!relationship) {
      const controlled = canvas.tokens.controlled.map((token) => token.document);
      if (controlled.length === 1) {
        relationship = this.#relationships.getForLeader(controlled[0].uuid)[0]
          ?? this.#relationships.getForFollower(controlled[0].uuid)[0]
          ?? null;
      }
    }
    if (!relationship) relationship = this.#relationships.list({ sceneId: canvas.scene.id })[0] ?? null;
    if (!relationship) throw new Error("No relationship could be resolved on the active Scene.");

    const scene = game.scenes.get(relationship.sceneId);
    const leader = await fromUuid(relationship.leaderUuid);
    const follower = await fromUuid(relationship.followerUuid);
    if (!scene || !(leader instanceof foundry.documents.TokenDocument) || !(follower instanceof foundry.documents.TokenDocument)) {
      throw new Error("The relationship Scene or tokens are unavailable.");
    }
    return { relationship, scene, leader, follower };
  }

  #tokenGeometry(token) {
    return {
      uuid: token.uuid,
      name: token.name ?? null,
      x: token.x,
      y: token.y,
      elevation: token.elevation,
      width: token.width,
      height: token.height,
      rotation: token.rotation
    };
  }
}
