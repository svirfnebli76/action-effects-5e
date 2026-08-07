import {
  ATTACHMENT_MODES,
  COLLISION_POLICIES,
  MODULE_ID,
  MOVEMENT_PHASES,
  RELATIONSHIP_TYPES,
  TELEPORT_POLICIES
} from "../core/constants.js";
import { Logger } from "../core/logger.js";
import { MovementTransaction } from "../movement/movement-transaction.js";

export class TestHarness {
  #dependencies;
  #compatibility;
  #movement;
  #relationships;
  #relationshipMovement;
  #socket;

  constructor({ dependencies, compatibility, movement, relationships, relationshipMovement, socket }) {
    this.#dependencies = dependencies;
    this.#compatibility = compatibility;
    this.#movement = movement;
    this.#relationships = relationships;
    this.#relationshipMovement = relationshipMovement;
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
      handler: (transaction) => {
        syntheticReceived = transaction.method === "synthetic";
      },
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
    record("Socketlib registration", this.#socket.ready, { ready: this.#socket.ready });

    const passed = checks.every((check) => check.passed);
    const result = {
      passed,
      checks,
      movement: this.#movement.getStats(),
      relationships: this.#relationships.getStats(),
      relationshipMovement: this.#relationshipMovement.getStats(),
      compatibility: compatibilityStatus
    };

    Logger.info("Foundation smoke test", result);
    if (notify && ui?.notifications) {
      const message = passed
        ? "Action Effects 5E foundation smoke test passed. See the console for details."
        : "Action Effects 5E foundation smoke test found a problem. See the console for details.";
      ui.notifications[passed ? "info" : "warn"](message);
    }

    return result;
  }

  async createTestRelationshipFromControlledTokens() {
    if (!canvas?.ready) throw new Error("A Scene canvas must be active.");
    const controlled = canvas.tokens.controlled.map((token) => token.document);
    if (controlled.length !== 2) throw new Error("Control exactly two tokens: leader first, then follower.");

    const [leader, follower] = controlled;
    const relationship = await this.#relationships.create({
      type: RELATIONSHIP_TYPES.TEST,
      attachmentMode: ATTACHMENT_MODES.RIGID_OFFSET,
      leaderUuid: leader.uuid,
      followerUuid: follower.uuid,
      followerCanSelfMove: false,
      followElevation: true,
      followRotation: false,
      teleportPolicy: TELEPORT_POLICIES.DETACH,
      collisionPolicy: COLLISION_POLICIES.STOP_GROUP,
      metadata: { createdByTestHarness: true }
    });

    for (const token of canvas.tokens.controlled) token.release();
    leader.object?.control?.({ releaseOthers: true });

    ui.notifications.info(`Created test relationship ${relationship.id}. The leader remains controlled; move it to test coordinated following.`);
    return relationship;
  }

  async removeTestRelationships() {
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
      movement: this.#relationshipMovement.getStats()
    };
    Logger.info("Controlled token relationship inspection", result);
    return result;
  }
}
