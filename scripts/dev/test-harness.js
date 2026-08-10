import {
  ATTACHMENT_MODES,
  COLLISION_POLICIES,
  DISPLACEMENT_DIRECTION_CONSTRAINTS,
  DISPLACEMENT_TYPES,
  MODULE_ID,
  MOVEMENT_AGENCIES,
  MOVEMENT_PHASES,
  RELATIONSHIP_COORDINATION_POLICIES,
  RELATIONSHIP_FORCED_LEADER_MOVEMENT_POLICIES,
  RELATIONSHIP_GEOMETRY_CHANNELS,
  RELATIONSHIP_ROTATION_POLICIES,
  RELATIVE_TOKEN_RELATIONSHIPS,
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
  #relativeRelationships;
  #displacement;
  #socket;
  #orbitOverlay = new OrbitDebugOverlay();

  constructor({ dependencies, compatibility, movement, relationships, relationshipMovement, relationshipRotation, relativeRelationships, displacement, socket }) {
    this.#dependencies = dependencies;
    this.#compatibility = compatibility;
    this.#movement = movement;
    this.#relationships = relationships;
    this.#relationshipMovement = relationshipMovement;
    this.#relationshipRotation = relationshipRotation;
    this.#relativeRelationships = relativeRelationships;
    this.#displacement = displacement;
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
    record("Displacement service", this.#displacement.getStats().initialized, this.#displacement.getStats());
    record("Socketlib registration", this.#socket.ready, { ready: this.#socket.ready });

    const passed = checks.every((check) => check.passed);
    const result = {
      passed,
      checks,
      movement: this.#movement.getStats(),
      relationships: this.#relationships.getStats(),
      relationshipMovement: this.#relationshipMovement.getStats(),
      relationshipRotation: this.#relationshipRotation.getStats(),
      displacement: this.#displacement.getStats(),
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

  async runFollowerBodyDispositionMatrix({ restoreOnPass = true, graceBufferMs = 700 } = {}) {
    if (!canvas?.ready) throw new Error("A Scene canvas must be active.");
    if (!game.user?.isGM) throw new Error("The follower-body disposition matrix requires a GM user.");

    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const banner = (text, color = "#7ddcff", size = 24) => {
      console.log(`%c${text}`, `font-size:${size}px;font-weight:bold;color:${color};`);
    };
    const angleDifference = (a, b) => Math.abs((((Number(a) - Number(b)) + 540) % 360) - 180);
    const D = globalThis.CONST?.TOKEN_DISPOSITIONS;
    if (!D) throw new Error("Foundry token disposition constants are unavailable.");

    // First validate the centralized resolver itself inside Foundry. This is a
    // synthetic Token-like matrix, so it does not touch the Scene. Neutral and
    // Secret must be universally nonhostile whether they are the reference or
    // the other participant. Friendly/Hostile are opposite sides.
    const resolverFixtures = [
      { name: "Friendly", uuid: "AE5E.Test.Friendly", disposition: D.FRIENDLY },
      { name: "Hostile", uuid: "AE5E.Test.Hostile", disposition: D.HOSTILE },
      { name: "Neutral", uuid: "AE5E.Test.Neutral", disposition: D.NEUTRAL },
      { name: "Secret", uuid: "AE5E.Test.Secret", disposition: D.SECRET }
    ];
    const resolverMatrix = [];
    for (const reference of resolverFixtures) {
      for (const other of resolverFixtures) {
        const expected = (reference.disposition === D.NEUTRAL
          || reference.disposition === D.SECRET
          || other.disposition === D.NEUTRAL
          || other.disposition === D.SECRET
          || reference.disposition === other.disposition)
          ? RELATIVE_TOKEN_RELATIONSHIPS.NONHOSTILE
          : RELATIVE_TOKEN_RELATIONSHIPS.HOSTILE;
        const resolved = this.#relativeRelationships.resolve({ referenceToken: reference, otherToken: other });
        resolverMatrix.push({
          reference: reference.name,
          other: other.name,
          expected,
          actual: resolved.relationship,
          reasonCode: resolved.reasonCode,
          passed: resolved.relationship === expected
        });
      }
    }

    const geometryLeader = { uuid: "AE5E.Test.GeometryLeader", disposition: D.HOSTILE };
    const geometryFollower = { uuid: "AE5E.Test.GeometryFollower", disposition: D.FRIENDLY };
    const geometryOther = { uuid: "AE5E.Test.GeometryOther", disposition: D.HOSTILE };
    const followerBodyReference = this.#relativeRelationships.resolveForGeometry({
      geometryChannel: RELATIONSHIP_GEOMETRY_CHANNELS.FOLLOWER_BODY,
      leaderToken: geometryLeader,
      followerToken: geometryFollower,
      otherToken: geometryOther
    });
    const grappleLinkReference = this.#relativeRelationships.resolveForGeometry({
      geometryChannel: RELATIONSHIP_GEOMETRY_CHANNELS.GRAPPLE_LINK,
      leaderToken: geometryLeader,
      followerToken: geometryFollower,
      otherToken: geometryOther
    });
    const geometryChannelChecks = {
      followerBodyUsesFollower: followerBodyReference.referenceUuid === geometryFollower.uuid,
      followerBodyIsHostileHere: followerBodyReference.relationship === RELATIVE_TOKEN_RELATIONSHIPS.HOSTILE,
      grappleLinkUsesLeader: grappleLinkReference.referenceUuid === geometryLeader.uuid,
      grappleLinkIsNonhostileHere: grappleLinkReference.relationship === RELATIVE_TOKEN_RELATIONSHIPS.NONHOSTILE
    };
    const resolverMatrixPassed = resolverMatrix.every((entry) => entry.passed)
      && Object.values(geometryChannelChecks).every(Boolean);

    banner(
      resolverMatrixPassed
        ? "AE5E RELATIVE-RELATIONSHIP RESOLVER — PASS"
        : "AE5E RELATIVE-RELATIONSHIP RESOLVER — FAIL",
      resolverMatrixPassed ? "#5cff8d" : "#ff5c5c",
      24
    );
    if (!resolverMatrixPassed) {
      console.table(resolverMatrix);
      const report = {
        result: "FAIL",
        stage: "relative-relationship-resolver",
        resolverMatrix,
        geometryChannelChecks,
        followerBodyReference,
        grappleLinkReference
      };
      console.log(JSON.stringify(report, null, 2));
      ui?.notifications?.error?.("AE5E | Relative-relationship resolver matrix FAILED.");
      return report;
    }

    const names = ["Leader", "Follower", "Ally", "Enemy", "Neutral", "Secret"];
    const tokens = {};
    for (const name of names) {
      const matches = canvas.tokens.placeables.filter((token) => token.document.name === name);
      if (matches.length !== 1) {
        throw new Error(`Expected exactly one '${name}' token on the active Scene; found ${matches.length}.`);
      }
      tokens[name] = matches[0].document;
    }

    const snapshots = Object.fromEntries(names.map((name) => {
      const token = tokens[name];
      return [name, {
        _id: token.id,
        x: token.x,
        y: token.y,
        width: token.width,
        height: token.height,
        rotation: token.rotation,
        elevation: token.elevation,
        disposition: token.disposition
      }];
    }));

    const movementActions = globalThis.CONFIG?.Token?.movement?.actions;
    const movementActionEntries = movementActions?.entries
      ? [...movementActions.entries()]
      : Object.entries(movementActions ?? {});
    const fixtureTeleportAction = movementActionEntries.find(([, config]) => config?.teleport === true)?.[0] ?? null;
    if (!fixtureTeleportAction) {
      throw new Error("Follower-body matrix requires a Foundry movement action whose CONFIG.Token.movement action has teleport=true for deterministic fixture placement.");
    }

    const fixtureMove = async (token, { x, y, elevation = 0 }) => {
      const current = canvas.scene.tokens.get(token.id);
      if (current.x === x && current.y === y && Number(current.elevation ?? 0) === Number(elevation)) return current;
      const completed = await current.move({
        x,
        y,
        elevation,
        action: fixtureTeleportAction,
        explicit: true,
        checkpoint: true
      }, {
        method: "api",
        animate: false,
        showRuler: false,
        pan: false,
        autoRotate: false,
        constrainOptions: { ignoreWalls: true, ignoreCost: true, ignoreTokens: true },
        ...this.#movement.createOperationOptions({
          pathType: "reposition",
          agency: "administrative",
          resource: "none",
          movementMode: fixtureTeleportAction,
          administrative: true,
          generatedBy: MODULE_ID,
          internal: true,
          suppressAutomation: true,
          testFixture: true
        })
      });
      await wait(75);
      const after = canvas.scene.tokens.get(token.id);
      if (after.x !== x || after.y !== y || Number(after.elevation ?? 0) !== Number(elevation)) {
        throw new Error(`FIXTURE FAIL | ${token.name} expected (${x},${y},${elevation}); actual (${after.x},${after.y},${after.elevation}); moveCompleted=${completed}.`);
      }
      return after;
    };

    const base = { x: 2200, y: 2800 };
    const followerStart = { x: 2300, y: 2800 };
    const parking = {
      Ally: { x: 3400, y: 2400 },
      Enemy: { x: 3600, y: 2400 },
      Neutral: { x: 3400, y: 2600 },
      Secret: { x: 3600, y: 2600 }
    };

    const cases = [
      {
        id: 1,
        label: "HOSTILE Leader / FRIENDLY Follower -> Hostile Ally",
        leaderDisposition: D.HOSTILE,
        followerDisposition: D.FRIENDLY,
        obstacle: "Ally",
        expected: "hard"
      },
      {
        id: 2,
        label: "HOSTILE Leader / FRIENDLY Follower -> Friendly Enemy",
        leaderDisposition: D.HOSTILE,
        followerDisposition: D.FRIENDLY,
        obstacle: "Enemy",
        expected: "soft"
      },
      {
        id: 3,
        label: "HOSTILE Leader / FRIENDLY Follower -> Neutral",
        leaderDisposition: D.HOSTILE,
        followerDisposition: D.FRIENDLY,
        obstacle: "Neutral",
        expected: "soft"
      },
      {
        id: 4,
        label: "HOSTILE Leader / FRIENDLY Follower -> Secret",
        leaderDisposition: D.HOSTILE,
        followerDisposition: D.FRIENDLY,
        obstacle: "Secret",
        expected: "soft"
      },
      {
        id: 5,
        label: "FRIENDLY Leader / HOSTILE Follower -> Hostile Ally",
        leaderDisposition: D.FRIENDLY,
        followerDisposition: D.HOSTILE,
        obstacle: "Ally",
        expected: "soft"
      },
      {
        id: 6,
        label: "FRIENDLY Leader / HOSTILE Follower -> Friendly Enemy",
        leaderDisposition: D.FRIENDLY,
        followerDisposition: D.HOSTILE,
        obstacle: "Enemy",
        expected: "hard"
      },
      {
        id: 7,
        label: "FRIENDLY Leader / HOSTILE Follower -> Neutral",
        leaderDisposition: D.FRIENDLY,
        followerDisposition: D.HOSTILE,
        obstacle: "Neutral",
        expected: "soft"
      },
      {
        id: 8,
        label: "FRIENDLY Leader / HOSTILE Follower -> Secret",
        leaderDisposition: D.FRIENDLY,
        followerDisposition: D.HOSTILE,
        obstacle: "Secret",
        expected: "soft"
      }
    ];

    const removeHarnessRelationships = async () => {
      const relationships = this.#relationships.list({ sceneId: canvas.scene.id, type: RELATIONSHIP_TYPES.TEST })
        .filter((relationship) => relationship.metadata?.createdByTestHarness === true);
      for (const relationship of relationships) await this.#relationships.remove(relationship.id);
    };

    const ensureNoUnrelatedParticipantRelationships = () => {
      const participantUuids = new Set([tokens.Leader.uuid, tokens.Follower.uuid]);
      const conflicts = this.#relationships.list({ sceneId: canvas.scene.id }).filter((relationship) => (
        participantUuids.has(relationship.leaderUuid) || participantUuids.has(relationship.followerUuid)
      ) && !(relationship.type === RELATIONSHIP_TYPES.TEST && relationship.metadata?.createdByTestHarness === true));
      if (conflicts.length) {
        throw new Error(`Leader/Follower participate in ${conflicts.length} non-test relationship(s). Remove those relationships before running this matrix.`);
      }
    };

    const setupCase = async (testCase) => {
      await removeHarnessRelationships();
      await wait(100);

      await canvas.scene.updateEmbeddedDocuments("Token", [
        {
          _id: tokens.Leader.id,
          width: 1,
          height: 1,
          rotation: 15,
          disposition: testCase.leaderDisposition
        },
        {
          _id: tokens.Follower.id,
          width: 1,
          height: 1,
          rotation: 0,
          disposition: testCase.followerDisposition
        },
        {
          _id: tokens.Ally.id,
          width: 1,
          height: 1,
          rotation: 0,
          disposition: D.HOSTILE
        },
        {
          _id: tokens.Enemy.id,
          width: 1,
          height: 1,
          rotation: 0,
          disposition: D.FRIENDLY
        },
        {
          _id: tokens.Neutral.id,
          width: 1,
          height: 1,
          rotation: 0,
          disposition: D.NEUTRAL
        },
        {
          _id: tokens.Secret.id,
          width: 1,
          height: 1,
          rotation: 0,
          disposition: D.SECRET
        }
      ], {
        animate: false,
        ae5eDiagnosticSetup: true
      });
      await wait(75);

      await fixtureMove(canvas.scene.tokens.get(tokens.Leader.id), { ...base, elevation: 0 });
      await fixtureMove(canvas.scene.tokens.get(tokens.Follower.id), { ...followerStart, elevation: 0 });
      for (const [name, position] of Object.entries(parking)) {
        await fixtureMove(canvas.scene.tokens.get(tokens[name].id), { ...position, elevation: 0 });
      }
      await wait(75);

      const leader = canvas.scene.tokens.get(tokens.Leader.id);
      const follower = canvas.scene.tokens.get(tokens.Follower.id);
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
        breakDistance: 5,
        coordinationDistance: 5,
        metadata: {
          createdByTestHarness: true,
          grappleMovementFixture: true,
          followerBodyDispositionMatrix: true,
          caseId: testCase.id
        }
      });
      await wait(125);

      const plan = RelationshipGeometryService.planOrbitStep({
        scene: canvas.scene,
        leader,
        follower,
        relationship,
        direction: 1
      });
      let obstacle = canvas.scene.tokens.get(tokens[testCase.obstacle].id);
      obstacle = await fixtureMove(obstacle, {
        x: plan.target.x,
        y: plan.target.y,
        elevation: 0
      });
      await wait(100);

      const fixtureChecks = {
        obstacleX: obstacle.x === plan.target.x,
        obstacleY: obstacle.y === plan.target.y,
        obstacleElevation: Number(obstacle.elevation ?? 0) === 0,
        leaderX: leader.x === base.x,
        leaderY: leader.y === base.y,
        followerX: follower.x === followerStart.x,
        followerY: follower.y === followerStart.y
      };
      for (const otherName of ["Ally", "Enemy", "Neutral", "Secret"]) {
        if (otherName === testCase.obstacle) continue;
        const other = canvas.scene.tokens.get(tokens[otherName].id);
        fixtureChecks[`${otherName}NotAtEndpoint`] = !(other.x === plan.target.x && other.y === plan.target.y);
      }
      if (!Object.values(fixtureChecks).every(Boolean)) {
        throw new Error(`CASE ${testCase.id} | FIXTURE FAIL: ${JSON.stringify(fixtureChecks)}`);
      }

      const resolver = this.#relativeRelationships.resolveForGeometry({
        geometryChannel: RELATIONSHIP_GEOMETRY_CHANNELS.FOLLOWER_BODY,
        leaderToken: leader,
        followerToken: follower,
        otherToken: obstacle
      });

      return { relationship, leader, follower, obstacle, plan, resolver, fixtureChecks };
    };

    ensureNoUnrelatedParticipantRelationships();
    banner("AE5E 0.3.25 FOLLOWER-BODY DISPOSITION MATRIX", "#7ddcff", 30);
    banner("8 AUTOMATIC FOUNDRY CASES", "#ffcc66", 19);

    const results = [];
    let failure = null;

    for (const testCase of cases) {
      banner(`CASE ${testCase.id} OF 8 — ${testCase.label}`, "#7ddcff", 20);
      banner(`EXPECTED: ${testCase.expected.toUpperCase()}`, testCase.expected === "hard" ? "#ffcc66" : "#c18cff", 17);

      const fixture = await setupCase(testCase);
      const expectedRelationship = testCase.expected === "hard"
        ? RELATIVE_TOKEN_RELATIONSHIPS.HOSTILE
        : RELATIVE_TOKEN_RELATIONSHIPS.NONHOSTILE;
      const start = {
        follower: { x: fixture.follower.x, y: fixture.follower.y },
        leaderRotation: fixture.leader.rotation,
        orbitIndex: fixture.plan.current.index
      };

      const directResult = await this.#relationshipRotation.requestOrbitStep({
        relationshipId: fixture.relationship.id,
        direction: 1
      });
      await this.#relationshipRotation.waitForSettled({ leaderUuid: fixture.leader.uuid });
      await wait(175);

      const immediateLeader = canvas.scene.tokens.get(tokens.Leader.id);
      const immediateFollower = canvas.scene.tokens.get(tokens.Follower.id);
      const immediateStats = this.#relationshipRotation.getStats();
      const decision = immediateStats.lastDecision;
      const pending = immediateStats.pendingNonhostileOverlaps ?? immediateStats.pendingAlliedOverlaps ?? 0;

      if (testCase.expected === "hard") {
        const checks = {
          resolverHostile: fixture.resolver.relationship === expectedRelationship,
          resolverReferenceFollower: fixture.resolver.referenceUuid === fixture.follower.uuid,
          resolverGeometryFollowerBody: fixture.resolver.geometryChannel === RELATIONSHIP_GEOMETRY_CHANNELS.FOLLOWER_BODY,
          resultNotCompleted: directResult?.completed !== true,
          decisionNotCompleted: decision?.completed !== true,
          hostileReason: decision?.obstruction?.reasonCode === "hostile-creature",
          obstructionFollowerBody: decision?.obstruction?.geometryChannel === RELATIONSHIP_GEOMETRY_CHANNELS.FOLLOWER_BODY,
          followerStayedX: immediateFollower.x === start.follower.x,
          followerStayedY: immediateFollower.y === start.follower.y,
          leaderRotationRestored: angleDifference(immediateLeader.rotation, start.leaderRotation) < 0.001,
          noPendingGrace: pending === 0,
          queuesClear: (immediateStats.pendingEvents ?? 0) === 0
            && (immediateStats.processingRelationships ?? 0) === 0
            && (immediateStats.activeGmRequests ?? 0) === 0
        };
        const passed = Object.values(checks).every(Boolean);
        const result = {
          case: testCase.id,
          label: testCase.label,
          expected: "hard",
          passed,
          resolver: fixture.resolver,
          fixtureChecks: fixture.fixtureChecks,
          checks,
          directResult,
          lastDecision: decision
        };
        results.push(result);
        if (!passed) {
          failure = result;
          banner(`CASE ${testCase.id} — FAIL`, "#ff5c5c", 28);
          console.error(result);
          break;
        }
        banner(`CASE ${testCase.id} — PASS | HARD BLOCK`, "#5cff8d", 21);
        continue;
      }

      const immediateChecks = {
        resolverNonhostile: fixture.resolver.relationship === expectedRelationship,
        resolverReferenceFollower: fixture.resolver.referenceUuid === fixture.follower.uuid,
        resolverGeometryFollowerBody: fixture.resolver.geometryChannel === RELATIONSHIP_GEOMETRY_CHANNELS.FOLLOWER_BODY,
        resultCompleted: directResult?.completed === true,
        decisionCompleted: decision?.completed === true,
        followerReachedX: immediateFollower.x === fixture.plan.target.x,
        followerReachedY: immediateFollower.y === fixture.plan.target.y,
        pendingGrace: pending >= 1,
        endpointConflictRecorded: Array.isArray(decision?.followerBody?.endpointConflicts)
          && decision.followerBody.endpointConflicts.some((entry) => entry.otherUuid === fixture.obstacle.uuid
            && entry.relationship === RELATIVE_TOKEN_RELATIONSHIPS.NONHOSTILE),
        queuesOtherwiseClear: (immediateStats.pendingEvents ?? 0) === 0
          && (immediateStats.processingRelationships ?? 0) === 0
          && (immediateStats.activeGmRequests ?? 0) === 0
      };
      if (!Object.values(immediateChecks).every(Boolean)) {
        const result = {
          case: testCase.id,
          label: testCase.label,
          expected: "soft",
          stage: "entry",
          passed: false,
          resolver: fixture.resolver,
          fixtureChecks: fixture.fixtureChecks,
          immediateChecks,
          directResult,
          lastDecision: decision
        };
        results.push(result);
        failure = result;
        banner(`CASE ${testCase.id} — FAIL DURING SOFT ENTRY`, "#ff5c5c", 28);
        console.error(result);
        break;
      }

      banner(`CASE ${testCase.id} — SOFT CONFLICT / GRACE ACTIVE`, "#c18cff", 19);
      const configuredGrace = Number(fixture.relationship.nonhostileEndpointGraceMs ?? fixture.relationship.alliedEndpointGraceMs ?? 3500);
      await wait(Math.max(1, configuredGrace) + Math.max(250, Number(graceBufferMs) || 700));
      await this.#relationshipRotation.waitForSettled({ leaderUuid: fixture.leader.uuid });
      await wait(100);

      const finalLeader = canvas.scene.tokens.get(tokens.Leader.id);
      const finalFollower = canvas.scene.tokens.get(tokens.Follower.id);
      const finalStats = this.#relationshipRotation.getStats();
      const finalPending = finalStats.pendingNonhostileOverlaps ?? finalStats.pendingAlliedOverlaps ?? 0;
      const rollbackChecks = {
        followerRolledBackX: finalFollower.x === start.follower.x,
        followerRolledBackY: finalFollower.y === start.follower.y,
        leaderRotationRolledBack: angleDifference(finalLeader.rotation, start.leaderRotation) < 0.001,
        graceCleared: finalPending === 0,
        queuesClear: (finalStats.pendingEvents ?? 0) === 0
          && (finalStats.processingRelationships ?? 0) === 0
          && (finalStats.activeGmRequests ?? 0) === 0
      };
      const passed = Object.values(rollbackChecks).every(Boolean);
      const result = {
        case: testCase.id,
        label: testCase.label,
        expected: "soft",
        passed,
        resolver: fixture.resolver,
        fixtureChecks: fixture.fixtureChecks,
        immediateChecks,
        rollbackChecks,
        directResult,
        lastDecision: decision
      };
      results.push(result);
      if (!passed) {
        failure = result;
        banner(`CASE ${testCase.id} — FAIL DURING GRACE ROLLBACK`, "#ff5c5c", 28);
        console.error(result);
        break;
      }
      banner(`CASE ${testCase.id} — PASS | SOFT → ROLLBACK`, "#5cff8d", 21);
    }

    const passed = failure === null && results.length === cases.length && results.every((entry) => entry.passed === true);
    const summary = results.map((entry) => ({
      case: entry.case,
      scenario: entry.label,
      expected: entry.expected,
      result: entry.passed ? "PASS" : "FAIL"
    }));

    if (passed) {
      await removeHarnessRelationships();
      await wait(100);
      if (restoreOnPass) {
        await canvas.scene.updateEmbeddedDocuments("Token", Object.values(snapshots).map((snapshot) => ({
          _id: snapshot._id,
          width: snapshot.width,
          height: snapshot.height,
          rotation: snapshot.rotation,
          disposition: snapshot.disposition
        })), {
          animate: false,
          ae5eDiagnosticRestore: true
        });
        for (const snapshot of Object.values(snapshots)) {
          await fixtureMove(canvas.scene.tokens.get(snapshot._id), {
            x: snapshot.x,
            y: snapshot.y,
            elevation: snapshot.elevation
          });
        }
      }
      canvas.tokens.releaseAll();
      banner("AE5E FOLLOWER-BODY DISPOSITION MATRIX — PASS", "#5cff8d", 30);
      banner("8 / 8 CASES PASSED", "#5cff8d", 22);
      console.table(summary);
    } else {
      banner("AE5E FOLLOWER-BODY DISPOSITION MATRIX — FAIL", "#ff5c5c", 30);
      if (failure) banner(`FAILED CASE ${failure.case}: ${failure.label}`, "#ffcc66", 20);
      console.log("The failing Foundry fixture and test relationship were intentionally left in place for inspection.");
      console.table(summary);
    }

    const stats = this.#relationshipRotation.getStats();
    const report = {
      result: passed ? "PASS" : "FAIL",
      resolverMatrixPassed,
      resolverMatrix,
      geometryChannelChecks,
      casesPlanned: cases.length,
      casesCompleted: results.length,
      failure,
      runtime: {
        pendingEvents: stats.pendingEvents,
        processingRelationships: stats.processingRelationships,
        activeGmRequests: stats.activeGmRequests,
        pendingNonhostileOverlaps: stats.pendingNonhostileOverlaps,
        pendingAlliedOverlaps: stats.pendingAlliedOverlaps
      },
      summary,
      results
    };

    console.log("%cAE5E FOLLOWER-BODY DISPOSITION MATRIX — FULL RESULT", "font-size:20px;font-weight:bold;color:#7ddcff;");
    console.log(JSON.stringify(report, null, 2));
    ui?.notifications?.[passed ? "info" : "error"]?.(
      passed
        ? "AE5E | Follower-body disposition matrix PASSED."
        : "AE5E | Follower-body disposition matrix FAILED."
    );
    return report;
  }

  async previewDisplacementFromControlledTokens({
    type = DISPLACEMENT_TYPES.PUSH,
    directionConstraint = DISPLACEMENT_DIRECTION_CONSTRAINTS.AWAY,
    distance = null
  } = {}) {
    const [source, target] = this.#controlledPair();
    const gridDistance = Number(canvas.scene?.grid?.distance ?? 5);
    return this.#displacement.request({
      sourceUuid: source.uuid,
      targetUuid: target.uuid,
      type,
      directionConstraint,
      distance: Number.isFinite(Number(distance)) && Number(distance) > 0 ? Number(distance) : gridDistance
    });
  }

  async runDisplacementFoundationTest({ restoreOnPass = true, graceBufferMs = 700 } = {}) {
    if (!canvas?.ready) throw new Error("A Scene canvas must be active.");
    if (!game.user?.isGM) throw new Error("The displacement foundation test requires a GM user.");

    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const banner = (text, color = "#7ddcff", size = 24) => {
      console.log(`%c${text}`, `font-size:${size}px;font-weight:bold;color:${color};`);
    };
    const D = globalThis.CONST?.TOKEN_DISPOSITIONS;
    if (!D) throw new Error("Foundry token disposition constants are unavailable.");

    const names = ["Leader", "Follower", "Ally", "Enemy", "Neutral", "Secret"];
    const tokens = {};
    for (const name of names) {
      const matches = canvas.tokens.placeables.filter((token) => token.document.name === name);
      if (matches.length !== 1) {
        throw new Error(`Expected exactly one '${name}' token on the active Scene; found ${matches.length}.`);
      }
      tokens[name] = matches[0].document;
    }

    const snapshots = Object.fromEntries(names.map((name) => {
      const token = tokens[name];
      return [name, {
        _id: token.id,
        x: token.x,
        y: token.y,
        width: token.width,
        height: token.height,
        rotation: token.rotation,
        elevation: token.elevation,
        disposition: token.disposition
      }];
    }));

    const removeHarnessRelationships = async () => {
      const relationships = this.#relationships.list({ sceneId: canvas.scene.id, type: RELATIONSHIP_TYPES.TEST })
        .filter((relationship) => relationship.metadata?.createdByTestHarness === true);
      for (const relationship of relationships) await this.#relationships.remove(relationship.id);
    };

    const ensureNoUnrelatedParticipantRelationships = () => {
      const participantUuids = new Set([tokens.Leader.uuid, tokens.Follower.uuid]);
      const conflicts = this.#relationships.list({ sceneId: canvas.scene.id }).filter((relationship) => (
        participantUuids.has(relationship.leaderUuid) || participantUuids.has(relationship.followerUuid)
      ) && !(relationship.type === RELATIONSHIP_TYPES.TEST && relationship.metadata?.createdByTestHarness === true));
      if (conflicts.length) {
        throw new Error(`Leader/Follower participate in ${conflicts.length} non-test relationship(s). Remove those relationships before running the displacement foundation test.`);
      }
    };

    const movementActions = globalThis.CONFIG?.Token?.movement?.actions;
    const entries = movementActions?.entries
      ? [...movementActions.entries()]
      : Object.entries(movementActions ?? {});
    const teleportAction = entries.find(([, config]) => config?.teleport === true)?.[0] ?? null;
    if (!teleportAction) {
      throw new Error("AE5E displacement test requires a Foundry movement action whose CONFIG.Token.movement action has teleport=true for deterministic fixture placement.");
    }

    const removeDiagnosticWalls = async () => {
      const ids = canvas.scene.walls
        .filter((wall) => wall.getFlag(MODULE_ID, "displacementDiagnosticWall") === true)
        .map((wall) => wall.id);
      if (ids.length) await canvas.scene.deleteEmbeddedDocuments("Wall", ids);
    };

    const fixtureMove = async (token, { x, y, elevation = 0 }) => {
      const current = canvas.scene.tokens.get(token.id);
      if (current.x === x && current.y === y && Number(current.elevation ?? 0) === Number(elevation)) return current;
      const completed = await current.move({
        x,
        y,
        elevation,
        action: teleportAction,
        explicit: true,
        checkpoint: true
      }, {
        method: "api",
        animate: false,
        showRuler: false,
        pan: false,
        autoRotate: false,
        constrainOptions: { ignoreWalls: true, ignoreCost: true, ignoreTokens: true },
        ...this.#movement.createOperationOptions({
          pathType: "reposition",
          agency: "administrative",
          resource: "none",
          movementMode: teleportAction,
          administrative: true,
          generatedBy: MODULE_ID,
          internal: true,
          suppressAutomation: true,
          testFixture: true
        })
      });
      await wait(75);
      const after = canvas.scene.tokens.get(token.id);
      if (after.x !== x || after.y !== y || Number(after.elevation ?? 0) !== Number(elevation)) {
        throw new Error(`FIXTURE FAIL | ${token.name} expected (${x},${y},${elevation}); actual (${after.x},${after.y},${after.elevation}); moveCompleted=${completed}.`);
      }
      return after;
    };

    const basePositions = {
      Leader: { x: 2200, y: 2800, elevation: 0 },
      Follower: { x: 2300, y: 2800, elevation: 0 },
      Ally: { x: 3400, y: 2400, elevation: 0 },
      Enemy: { x: 3600, y: 2400, elevation: 0 },
      Neutral: { x: 3400, y: 2600, elevation: 0 },
      Secret: { x: 3600, y: 2600, elevation: 0 }
    };

    const parkAll = async () => {
      for (const [name, position] of Object.entries(basePositions)) {
        await fixtureMove(canvas.scene.tokens.get(tokens[name].id), position);
      }
    };

    const configure = async ({ leaderDisposition = D.HOSTILE, followerDisposition = D.FRIENDLY, leaderSize = 1 } = {}) => {
      this.#displacement.clearEndpointGrace(tokens.Follower.uuid);
      await removeDiagnosticWalls();
      await canvas.scene.updateEmbeddedDocuments("Token", [
        { _id: tokens.Leader.id, width: leaderSize, height: leaderSize, rotation: 0, disposition: leaderDisposition },
        { _id: tokens.Follower.id, width: 1, height: 1, rotation: 0, disposition: followerDisposition },
        { _id: tokens.Ally.id, width: 1, height: 1, rotation: 0, disposition: D.HOSTILE },
        { _id: tokens.Enemy.id, width: 1, height: 1, rotation: 0, disposition: D.FRIENDLY },
        { _id: tokens.Neutral.id, width: 1, height: 1, rotation: 0, disposition: D.NEUTRAL },
        { _id: tokens.Secret.id, width: 1, height: 1, rotation: 0, disposition: D.SECRET }
      ], {
        animate: false,
        ae5eDisplacementTestSetup: true
      });
      await parkAll();
      if (leaderSize === 2) await fixtureMove(canvas.scene.tokens.get(tokens.Leader.id), { x: 2100, y: 2800, elevation: 0 });
      if (leaderSize === 3) await fixtureMove(canvas.scene.tokens.get(tokens.Leader.id), { x: 2000, y: 2800, elevation: 0 });
      await wait(75);
    };

    const candidateKeys = async (options) => {
      const plan = await this.#displacement.getCandidates({
        sourceUuid: tokens.Leader.uuid,
        targetUuid: tokens.Follower.uuid,
        distance: 5,
        ...options
      });
      return { plan, keys: plan.candidates.map((candidate) => candidate.key) };
    };

    const sameKeys = (actual, expected) => actual.length === expected.length
      && actual.every((key) => expected.includes(key));

    const results = [];
    let failure = null;
    let passed = false;

    try {
      banner("AE5E 0.3.25 — DISPLACEMENT FOUNDATION", "#7ddcff", 30);
      banner("DIRECTION GEOMETRY + FORCED METADATA + COLLISION + GRACE", "#ffcc66", 18);
      ensureNoUnrelatedParticipantRelationships();
      await removeHarnessRelationships();
      await removeDiagnosticWalls();

      // --------------------------------------------------------
      // Direction semantics: 1x1 source directly west of target.
      // --------------------------------------------------------
      await configure({ leaderDisposition: D.HOSTILE, followerDisposition: D.FRIENDLY, leaderSize: 1 });
      const pushAway = await candidateKeys({
        type: DISPLACEMENT_TYPES.PUSH,
        directionConstraint: DISPLACEMENT_DIRECTION_CONSTRAINTS.AWAY
      });
      const pushStraight = await candidateKeys({
        type: DISPLACEMENT_TYPES.PUSH,
        directionConstraint: DISPLACEMENT_DIRECTION_CONSTRAINTS.STRAIGHT_AWAY
      });
      const pullToward = await candidateKeys({
        type: DISPLACEMENT_TYPES.PULL,
        directionConstraint: DISPLACEMENT_DIRECTION_CONSTRAINTS.TOWARD
      });
      const pullStraight = await candidateKeys({
        type: DISPLACEMENT_TYPES.PULL,
        directionConstraint: DISPLACEMENT_DIRECTION_CONSTRAINTS.STRAIGHT_TOWARD
      });

      const directionChecks = {
        pushAwayThree: sameKeys(pushAway.keys, ["NE", "E", "SE"]),
        pushStraightEast: sameKeys(pushStraight.keys, ["E"]),
        pullTowardThree: sameKeys(pullToward.keys, ["NW", "W", "SW"]),
        pullStraightWest: sameKeys(pullStraight.keys, ["W"])
      };
      results.push({ name: "1x1 direction semantics", passed: Object.values(directionChecks).every(Boolean), checks: directionChecks });
      if (!results.at(-1).passed) throw new Error("1x1 direction semantic checks failed.");
      banner("1x1 AWAY / STRAIGHT_AWAY / TOWARD / STRAIGHT_TOWARD — PASS", "#5cff8d", 20);

      // --------------------------------------------------------
      // Large-source center-relative geometry.
      // --------------------------------------------------------
      await configure({ leaderDisposition: D.HOSTILE, followerDisposition: D.FRIENDLY, leaderSize: 2 });
      const large2 = await candidateKeys({
        type: DISPLACEMENT_TYPES.PUSH,
        directionConstraint: DISPLACEMENT_DIRECTION_CONSTRAINTS.AWAY
      });
      await configure({ leaderDisposition: D.HOSTILE, followerDisposition: D.FRIENDLY, leaderSize: 3 });
      const large3 = await candidateKeys({
        type: DISPLACEMENT_TYPES.PUSH,
        directionConstraint: DISPLACEMENT_DIRECTION_CONSTRAINTS.AWAY
      });
      const largeChecks = {
        source2x2FourDirections: sameKeys(large2.keys, ["N", "NE", "E", "SE"]),
        source3x3FourDirections: sameKeys(large3.keys, ["N", "NE", "E", "SE"])
      };
      results.push({ name: "large-source center-relative geometry", passed: Object.values(largeChecks).every(Boolean), checks: largeChecks });
      if (!results.at(-1).passed) throw new Error("Large-source center-relative direction checks failed.");
      banner("2x2 / 3x3 SOURCE CENTER-RELATIVE DIRECTION GEOMETRY — PASS", "#5cff8d", 20);

      // --------------------------------------------------------
      // Pull execution uses the same forced-displacement body pipeline.
      // Keep one clear grid space between Source and Target so a 5-ft
      // STRAIGHT_TOWARD pull can end adjacent to the Source. Then prove
      // a hostile body in that destination blocks the pull.
      // --------------------------------------------------------
      await configure({ leaderDisposition: D.HOSTILE, followerDisposition: D.FRIENDLY, leaderSize: 1 });
      await fixtureMove(canvas.scene.tokens.get(tokens.Leader.id), { x: 2100, y: 2800, elevation: 0 });
      const clearPull = await this.#displacement.pull({
        sourceUuid: tokens.Leader.uuid,
        targetUuid: tokens.Follower.uuid,
        distance: 5,
        directionConstraint: DISPLACEMENT_DIRECTION_CONSTRAINTS.STRAIGHT_TOWARD,
        directionKey: "W"
      });
      await wait(175);
      const clearPullFollower = canvas.scene.tokens.get(tokens.Follower.id);
      const clearPullPosition = { x: clearPullFollower.x, y: clearPullFollower.y };

      await configure({ leaderDisposition: D.HOSTILE, followerDisposition: D.FRIENDLY, leaderSize: 1 });
      await fixtureMove(canvas.scene.tokens.get(tokens.Leader.id), { x: 2100, y: 2800, elevation: 0 });
      await fixtureMove(canvas.scene.tokens.get(tokens.Ally.id), { x: 2200, y: 2800, elevation: 0 });
      const blockedPull = await this.#displacement.pull({
        sourceUuid: tokens.Leader.uuid,
        targetUuid: tokens.Follower.uuid,
        distance: 5,
        directionConstraint: DISPLACEMENT_DIRECTION_CONSTRAINTS.STRAIGHT_TOWARD,
        directionKey: "W"
      });
      const blockedPullFollower = canvas.scene.tokens.get(tokens.Follower.id);
      const pullExecutionChecks = {
        clearCompleted: clearPull?.completed === true,
        clearTypePull: clearPull?.type === DISPLACEMENT_TYPES.PULL,
        clearDirectionWest: clearPull?.directionKey === "W",
        clearFullDistance: clearPull?.fullDistance === true && clearPull?.actualDistance === 5,
        clearEndedAdjacent: clearPullPosition.x === 2200 && clearPullPosition.y === 2800,
        hostileBlocked: blockedPull?.blocked === true,
        hostileStayed: blockedPullFollower.x === 2300 && blockedPullFollower.y === 2800,
        noGrace: this.#displacement.getStats().endpointGrace.pending === 0
      };
      results.push({
        name: "pull execution and hostile collision",
        passed: Object.values(pullExecutionChecks).every(Boolean),
        checks: pullExecutionChecks,
        clearResult: clearPull,
        blockedResult: blockedPull
      });
      if (!results.at(-1).passed) throw new Error("Pull execution/collision checks failed.");
      banner("PULL EXECUTION + HOSTILE COLLISION — PASS", "#5cff8d", 20);

      // --------------------------------------------------------
      // Hostile relative to TARGET must hard-block. Leader is
      // Hostile too, proving Source disposition is not the body reference.
      // --------------------------------------------------------
      await configure({ leaderDisposition: D.HOSTILE, followerDisposition: D.FRIENDLY, leaderSize: 1 });
      await fixtureMove(canvas.scene.tokens.get(tokens.Ally.id), { x: 2400, y: 2800, elevation: 0 });
      const hard = await this.#displacement.push({
        sourceUuid: tokens.Leader.uuid,
        targetUuid: tokens.Follower.uuid,
        distance: 5,
        directionConstraint: DISPLACEMENT_DIRECTION_CONSTRAINTS.STRAIGHT_AWAY,
        directionKey: "E"
      });
      const hardFollower = canvas.scene.tokens.get(tokens.Follower.id);
      const hardChecks = {
        blocked: hard?.blocked === true,
        followerStayed: hardFollower.x === 2300 && hardFollower.y === 2800,
        noGrace: this.#displacement.getStats().endpointGrace.pending === 0
      };
      results.push({ name: "target-relative hostile hard block", passed: Object.values(hardChecks).every(Boolean), checks: hardChecks, result: hard });
      if (!results.at(-1).passed) throw new Error("Target-relative hostile hard-block checks failed.");
      banner("HOSTILE RELATIVE TO DISPLACED TARGET — HARD BLOCK PASS", "#5cff8d", 20);

      // --------------------------------------------------------
      // Friendly relative to TARGET: move into space, classify as
      // FORCED, start default 3.5s grace, then roll back one step.
      // --------------------------------------------------------
      await configure({ leaderDisposition: D.HOSTILE, followerDisposition: D.FRIENDLY, leaderSize: 1 });
      await fixtureMove(canvas.scene.tokens.get(tokens.Enemy.id), { x: 2500, y: 2800, elevation: 0 });
      let captured = null;
      const unregisterCapture = this.#movement.registerConsumer({
        id: `${MODULE_ID}.tests.displacement-capture.${Date.now()}`,
        phases: [MOVEMENT_PHASES.AFTER],
        tokenUuids: [tokens.Follower.uuid],
        execution: "primaryGM",
        priority: 20_000,
        once: true,
        handler: (transaction) => { captured = transaction; }
      });
      let soft;
      try {
        soft = await this.#displacement.push({
          sourceUuid: tokens.Leader.uuid,
          targetUuid: tokens.Follower.uuid,
          distance: 10,
          directionConstraint: DISPLACEMENT_DIRECTION_CONSTRAINTS.STRAIGHT_AWAY,
          directionKey: "E"
        });
        await wait(175);
      } finally {
        unregisterCapture();
      }
      const softImmediate = canvas.scene.tokens.get(tokens.Follower.id);
      const softImmediateChecks = {
        completed: soft?.completed === true,
        requestedTenFeet: soft?.requestedDistance === 10,
        actualTenFeet: soft?.actualDistance === 10 && soft?.fullDistance === true && soft?.partial === false,
        reachedEndpoint: softImmediate.x === 2500 && softImmediate.y === 2800,
        graceStarted: soft?.graceStarted === true && this.#displacement.getStats().endpointGrace.pending === 1,
        transactionCaptured: Boolean(captured),
        agencyForced: captured?.agency === MOVEMENT_AGENCIES.FORCED,
        displacementType: captured?.displacementType === DISPLACEMENT_TYPES.PUSH,
        directionConstraint: captured?.directionConstraint === DISPLACEMENT_DIRECTION_CONSTRAINTS.STRAIGHT_AWAY,
        directionEast: captured?.displacementDirection === "E",
        transactionRequestedTenFeet: captured?.requestedDistance === 10,
        transactionActualTenFeet: captured?.actualDistance === 10,
        sourceRecorded: captured?.sourceUuid === tokens.Leader.uuid,
        targetRecorded: captured?.subjectUuid === tokens.Follower.uuid
      };
      if (!Object.values(softImmediateChecks).every(Boolean)) {
        const failedChecks = Object.entries(softImmediateChecks)
          .filter(([, passed]) => !passed)
          .map(([name]) => name);
        console.error("AE5E displacement soft-entry failed checks:", failedChecks);
        console.table(Object.entries(softImmediateChecks).map(([check, passed]) => ({ check, passed })));
        console.log("AE5E displacement soft-entry result:", soft);
        console.log("AE5E captured forced movement transaction:", captured?.toJSON?.() ?? captured);
        results.push({ name: "forced metadata and soft entry", passed: false, failedChecks, checks: softImmediateChecks, result: soft, transaction: captured?.toJSON?.() ?? captured });
        throw new Error(`Forced displacement metadata/soft-entry checks failed: ${failedChecks.join(", ") || "unknown"}.`);
      }
      banner("FORCED TRANSACTION + NONHOSTILE ENDPOINT GRACE — PASS", "#5cff8d", 20);
      await wait(3500 + Math.max(250, Number(graceBufferMs) || 700));
      const softFinal = canvas.scene.tokens.get(tokens.Follower.id);
      const softRollbackChecks = {
        rolledBackToLastClearStep: softFinal.x === 2400 && softFinal.y === 2800,
        graceCleared: this.#displacement.getStats().endpointGrace.pending === 0
      };
      results.push({ name: "forced metadata and soft grace rollback", passed: Object.values(softRollbackChecks).every(Boolean), checks: { ...softImmediateChecks, ...softRollbackChecks }, result: soft, transaction: captured?.toJSON?.() ?? captured });
      if (!results.at(-1).passed) throw new Error("Displacement endpoint grace rollback failed.");
      banner("3.5s NONHOSTILE GRACE → LAST CLEAR DISPLACEMENT STEP — PASS", "#5cff8d", 20);

      // --------------------------------------------------------
      // If the creature causing the soft endpoint conflict moves away
      // during grace, the pending rollback must clear immediately.
      // --------------------------------------------------------
      await configure({ leaderDisposition: D.HOSTILE, followerDisposition: D.FRIENDLY, leaderSize: 1 });
      await fixtureMove(canvas.scene.tokens.get(tokens.Enemy.id), { x: 2400, y: 2800, elevation: 0 });
      const graceClearPush = await this.#displacement.push({
        sourceUuid: tokens.Leader.uuid,
        targetUuid: tokens.Follower.uuid,
        distance: 5,
        directionConstraint: DISPLACEMENT_DIRECTION_CONSTRAINTS.STRAIGHT_AWAY,
        directionKey: "E"
      });
      await wait(175);
      const graceBeforeOccupantMove = this.#displacement.getStats().endpointGrace.pending;
      const normalAction = globalThis.CONFIG?.Token?.movement?.defaultAction ?? "walk";
      const enemyDocument = canvas.scene.tokens.get(tokens.Enemy.id);
      await enemyDocument.move({
        x: 2500,
        y: 2800,
        elevation: 0,
        action: normalAction,
        explicit: true,
        checkpoint: true
      }, {
        method: "api",
        animate: false,
        showRuler: false,
        pan: false,
        autoRotate: false,
        constrainOptions: { ignoreWalls: false, ignoreCost: true, ignoreTokens: false }
      });
      await wait(225);
      const enemyAfterLeaving = canvas.scene.tokens.get(tokens.Enemy.id);
      const followerAfterOccupantLeaves = canvas.scene.tokens.get(tokens.Follower.id);
      const occupantLeavesChecks = {
        pushReachedSoftEndpoint: graceClearPush?.completed === true
          && followerAfterOccupantLeaves.x === 2400
          && followerAfterOccupantLeaves.y === 2800,
        graceWasActive: graceBeforeOccupantMove === 1,
        occupantMovedAway: enemyAfterLeaving.x === 2500 && enemyAfterLeaving.y === 2800,
        graceClearedImmediately: this.#displacement.getStats().endpointGrace.pending === 0,
        displacedTargetStayedPut: followerAfterOccupantLeaves.x === 2400 && followerAfterOccupantLeaves.y === 2800
      };
      results.push({
        name: "endpoint grace clears when occupant leaves",
        passed: Object.values(occupantLeavesChecks).every(Boolean),
        checks: occupantLeavesChecks,
        result: graceClearPush
      });
      if (!results.at(-1).passed) throw new Error("Displacement endpoint grace did not clear when the occupant moved away.");
      banner("NONHOSTILE OCCUPANT LEAVES → GRACE CLEARS — PASS", "#5cff8d", 20);

      // --------------------------------------------------------
      // Neutral/Secret candidate endpoints must be soft conflicts.
      // --------------------------------------------------------
      await configure({ leaderDisposition: D.HOSTILE, followerDisposition: D.FRIENDLY, leaderSize: 1 });
      await fixtureMove(canvas.scene.tokens.get(tokens.Neutral.id), { x: 2400, y: 2800, elevation: 0 });
      const neutralPlan = await this.#displacement.getCandidates({
        sourceUuid: tokens.Leader.uuid,
        targetUuid: tokens.Follower.uuid,
        type: DISPLACEMENT_TYPES.PUSH,
        directionConstraint: DISPLACEMENT_DIRECTION_CONSTRAINTS.STRAIGHT_AWAY,
        distance: 5
      });
      await fixtureMove(canvas.scene.tokens.get(tokens.Neutral.id), basePositions.Neutral);
      await fixtureMove(canvas.scene.tokens.get(tokens.Secret.id), { x: 2400, y: 2800, elevation: 0 });
      const secretPlan = await this.#displacement.getCandidates({
        sourceUuid: tokens.Leader.uuid,
        targetUuid: tokens.Follower.uuid,
        type: DISPLACEMENT_TYPES.PUSH,
        directionConstraint: DISPLACEMENT_DIRECTION_CONSTRAINTS.STRAIGHT_AWAY,
        distance: 5
      });
      const neutralCandidate = neutralPlan.candidates.find((candidate) => candidate.key === "E");
      const secretCandidate = secretPlan.candidates.find((candidate) => candidate.key === "E");
      const neutralSecretChecks = {
        neutralSoft: neutralCandidate?.softConflict === true && neutralCandidate?.selectable === true,
        secretSoft: secretCandidate?.softConflict === true && secretCandidate?.selectable === true
      };
      results.push({ name: "Neutral and Secret soft occupancy", passed: Object.values(neutralSecretChecks).every(Boolean), checks: neutralSecretChecks });
      if (!results.at(-1).passed) throw new Error("Neutral/Secret displacement occupancy checks failed.");
      banner("NEUTRAL / SECRET DISPLACED-BODY OCCUPANCY — PASS", "#5cff8d", 20);

      // --------------------------------------------------------
      // Nonhostile transit: pass through one friendly occupied grid
      // space and end clear. This exercises the D&D5e blocking hook.
      // --------------------------------------------------------
      await configure({ leaderDisposition: D.HOSTILE, followerDisposition: D.FRIENDLY, leaderSize: 1 });
      await fixtureMove(canvas.scene.tokens.get(tokens.Enemy.id), { x: 2400, y: 2800, elevation: 0 });
      const through = await this.#displacement.push({
        sourceUuid: tokens.Leader.uuid,
        targetUuid: tokens.Follower.uuid,
        distance: 10,
        directionConstraint: DISPLACEMENT_DIRECTION_CONSTRAINTS.STRAIGHT_AWAY,
        directionKey: "E"
      });
      await wait(175);
      const throughFollower = canvas.scene.tokens.get(tokens.Follower.id);
      const throughChecks = {
        completed: through?.completed === true,
        fullDistance: through?.fullDistance === true,
        reachedSecondStep: throughFollower.x === 2500 && throughFollower.y === 2800,
        noEndpointGrace: this.#displacement.getStats().endpointGrace.pending === 0
      };
      results.push({ name: "nonhostile transit pass-through", passed: Object.values(throughChecks).every(Boolean), checks: throughChecks, result: through });
      if (!results.at(-1).passed) throw new Error("Nonhostile transit pass-through failed.");
      banner("NONHOSTILE TRANSIT PASS-THROUGH — PASS", "#5cff8d", 20);

      // --------------------------------------------------------
      // Wall partial stop: requested 10 ft, first 5 ft clear, second
      // step hard-blocked by a diagnostic movement wall.
      // --------------------------------------------------------
      await configure({ leaderDisposition: D.HOSTILE, followerDisposition: D.FRIENDLY, leaderSize: 1 });
      const createdWalls = await canvas.scene.createEmbeddedDocuments("Wall", [{
        c: [2550, 2600, 2550, 3100],
        flags: { [MODULE_ID]: { displacementDiagnosticWall: true } }
      }]);
      await wait(125);
      const wallPlan = await this.#displacement.getCandidates({
        sourceUuid: tokens.Leader.uuid,
        targetUuid: tokens.Follower.uuid,
        type: DISPLACEMENT_TYPES.PUSH,
        directionConstraint: DISPLACEMENT_DIRECTION_CONSTRAINTS.STRAIGHT_AWAY,
        distance: 10
      });
      const wallCandidate = wallPlan.candidates.find((candidate) => candidate.key === "E");
      const wallPreChecks = {
        candidateExists: Boolean(wallCandidate),
        selectable: wallCandidate?.selectable === true,
        partial: wallCandidate?.partial === true,
        movedFive: wallCandidate?.actualDistance === 5,
        wallReason: wallCandidate?.obstruction?.reasonCode === "environment-obstruction"
      };
      if (!Object.values(wallPreChecks).every(Boolean)) {
        results.push({ name: "wall partial-stop planning", passed: false, checks: wallPreChecks, candidate: wallCandidate });
        throw new Error("Wall partial-stop planning failed.");
      }
      const wallResult = await this.#displacement.push({
        sourceUuid: tokens.Leader.uuid,
        targetUuid: tokens.Follower.uuid,
        distance: 10,
        directionConstraint: DISPLACEMENT_DIRECTION_CONSTRAINTS.STRAIGHT_AWAY,
        directionKey: "E"
      });
      await wait(175);
      const wallFollower = canvas.scene.tokens.get(tokens.Follower.id);
      const wallChecks = {
        ...wallPreChecks,
        movementCompleted: wallResult?.completed === true,
        resultPartial: wallResult?.partial === true && wallResult?.fullDistance === false,
        stoppedAtFive: wallFollower.x === 2400 && wallFollower.y === 2800
      };
      results.push({ name: "wall partial stop", passed: Object.values(wallChecks).every(Boolean), checks: wallChecks, result: wallResult, wallIds: createdWalls.map((wall) => wall.id) });
      if (!results.at(-1).passed) throw new Error("Wall partial-stop execution failed.");
      banner("WALL PARTIAL STOP — PASS", "#5cff8d", 20);

      await removeDiagnosticWalls();
      this.#displacement.clearEndpointGrace(tokens.Follower.uuid);
      passed = results.every((entry) => entry.passed === true);
    } catch (error) {
      failure = { message: error?.message ?? String(error), stack: error?.stack ?? null };
      passed = false;
    }

    const summary = results.map((entry, index) => ({
      case: index + 1,
      test: entry.name,
      result: entry.passed ? "PASS" : "FAIL"
    }));

    if (passed) {
      banner("AE5E 0.3.25 DISPLACEMENT FOUNDATION — PASS", "#5cff8d", 30);
      console.table(summary);
      if (restoreOnPass) {
        await removeHarnessRelationships();
        await removeDiagnosticWalls();
        this.#displacement.clearEndpointGrace(tokens.Follower.uuid);
        await canvas.scene.updateEmbeddedDocuments("Token", Object.values(snapshots).map((snapshot) => ({
          _id: snapshot._id,
          width: snapshot.width,
          height: snapshot.height,
          rotation: snapshot.rotation,
          disposition: snapshot.disposition
        })), { animate: false, ae5eDisplacementTestRestore: true });
        for (const snapshot of Object.values(snapshots)) {
          await fixtureMove(canvas.scene.tokens.get(snapshot._id), {
            x: snapshot.x,
            y: snapshot.y,
            elevation: snapshot.elevation
          });
        }
        canvas.tokens.releaseAll();
        banner("PASS CLEANUP COMPLETE — ORIGINAL TOKEN STATES RESTORED", "#5cff8d", 18);
      }
    } else {
      banner("AE5E 0.3.25 DISPLACEMENT FOUNDATION — FAIL", "#ff5c5c", 30);
      if (failure) console.error("FAILURE", failure);
      console.table(summary);
      console.log("The failing Foundry fixture was intentionally left in place for inspection.");
    }

    const report = {
      result: passed ? "PASS" : "FAIL",
      failure,
      teleportFixtureAction: teleportAction,
      casesCompleted: results.length,
      summary,
      results,
      displacementStats: this.#displacement.getStats(),
      movementStats: this.#movement.getStats()
    };
    console.log("%cAE5E 0.3.25 DISPLACEMENT FOUNDATION — FULL RESULT", "font-size:20px;font-weight:bold;color:#7ddcff;");
    console.log(JSON.stringify(report, null, 2));
    ui?.notifications?.[passed ? "info" : "error"]?.(
      passed
        ? "AE5E | Displacement foundation test PASSED."
        : "AE5E | Displacement foundation test FAILED."
    );
    return report;
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
