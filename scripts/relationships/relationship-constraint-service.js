import {
  HOOKS,
  MODULE_ID,
  MOVEMENT_PHASES,
  RELATIONSHIP_CLASSES,
  RELATIONSHIP_CONSTRAINT_STATES,
  RELATIONSHIP_CONSTRAINT_TYPES
} from "../core/constants.js";
import { duplicateSafely } from "../core/utils.js";
import { Logger } from "../core/logger.js";
import { isObservationalRelationship } from "./relationship-class.js";

const CONSUMER_PREFIX = `${MODULE_ID}.relationship-constraints`;
const POSITION_KEYS = new Set(["x", "y", "elevation", "width", "height"]);

function finitePosition(point, fallback = {}) {
  return {
    x: Number.isFinite(Number(point?.x)) ? Number(point.x) : Number(fallback?.x ?? 0),
    y: Number.isFinite(Number(point?.y)) ? Number(point.y) : Number(fallback?.y ?? 0),
    elevation: Number.isFinite(Number(point?.elevation)) ? Number(point.elevation) : Number(fallback?.elevation ?? 0)
  };
}

function samePoint(a, b) {
  return Math.abs(a.x - b.x) < 1e-6
    && Math.abs(a.y - b.y) < 1e-6
    && Math.abs(a.elevation - b.elevation) < 1e-6;
}

export class RelationshipConstraintService {
  #relationships;
  #movement;
  #distanceProviders;
  #coverProviders;
  #initialized = false;
  #consumerRemovers = new Map();
  #hooks = [];
  #queuedScenes = new Set();
  #stats = {
    evaluations: 0,
    movementEvaluations: 0,
    geometryEvaluations: 0,
    broken: 0,
    unknown: 0,
    removals: 0,
    lastResult: null
  };

  constructor({ relationships, movement, distanceProviders, coverProviders }) {
    this.#relationships = relationships;
    this.#movement = movement;
    this.#distanceProviders = distanceProviders;
    this.#coverProviders = coverProviders;
  }

  initialize() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#listen(HOOKS.RELATIONSHIP_CREATED, (relationship) => this.#onRelationshipChanged(relationship));
    this.#listen(HOOKS.RELATIONSHIP_UPDATED, (relationship) => this.#onRelationshipChanged(relationship));
    this.#listen(HOOKS.RELATIONSHIP_REMOVED, () => this.#reconcileConsumers());
    this.#listen(HOOKS.RELATIONSHIPS_REINDEXED, () => this.#reconcileConsumers());

    for (const hook of ["createWall", "updateWall", "deleteWall", "createRegion", "updateRegion", "deleteRegion", "createRegionBehavior", "updateRegionBehavior", "deleteRegionBehavior", "createLevel", "updateLevel", "deleteLevel"]) {
      this.#listen(hook, (document) => this.#queueSceneEvaluation(document?.parent?.id ?? document?.scene?.id ?? null));
    }
    this.#listen("updateToken", (document, changes = {}) => {
      if (![...POSITION_KEYS].some((key) => Object.prototype.hasOwnProperty.call(changes, key))) return;
      this.#queueTokenEvaluation(document?.uuid);
    });
    for (const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
      this.#listen(hook, (effect) => this.#queueActorEvaluation(effect?.parent?.actor ?? effect?.parent));
    }
    this.#listen("canvasReady", (canvas) => this.#queueSceneEvaluation(canvas?.scene?.id ?? globalThis.canvas?.scene?.id ?? null));
    this.#reconcileConsumers();
  }

  shutdown() {
    for (const remove of this.#consumerRemovers.values()) remove();
    this.#consumerRemovers.clear();
    for (const [hook, id] of this.#hooks) Hooks.off(hook, id);
    this.#hooks.length = 0;
    this.#queuedScenes.clear();
    this.#initialized = false;
  }

  getStats() {
    return {
      initialized: this.#initialized,
      consumers: this.#consumerRemovers.size,
      ...duplicateSafely(this.#stats)
    };
  }

  async evaluateRelationship(relationshipOrId, { movingTokenUuid = null, route = null } = {}) {
    const relationship = typeof relationshipOrId === "string"
      ? this.#relationships.get(relationshipOrId)
      : duplicateSafely(relationshipOrId);
    if (!relationship || !isObservationalRelationship(relationship)) {
      return { state: RELATIONSHIP_CONSTRAINT_STATES.UNKNOWN, reason: "not-observational", relationshipId: relationship?.id ?? null };
    }

    let leader = null;
    let follower = null;
    try {
      leader = await fromUuid(relationship.leaderUuid);
      follower = await fromUuid(relationship.followerUuid);
    } catch { /* unavailable result below */ }
    if (!leader || !follower || leader.parent?.id !== follower.parent?.id) {
      return { state: RELATIONSHIP_CONSTRAINT_STATES.UNKNOWN, reason: "participant-unavailable", relationshipId: relationship.id };
    }

    const scene = leader.parent;
    const samples = movingTokenUuid && Array.isArray(route) && route.length
      ? this.#sampleRoute(route, scene)
      : [null];
    const results = [];

    for (const constraint of relationship.constraints ?? []) {
      const constraintSamples = constraint.evaluateRoute === false ? [samples.at(-1)] : samples;
      let constraintResult = null;
      for (const sample of constraintSamples) {
        const leaderPosition = movingTokenUuid === relationship.leaderUuid ? sample : null;
        const followerPosition = movingTokenUuid === relationship.followerUuid ? sample : null;
        constraintResult = await this.#evaluateConstraint({
          constraint,
          relationship,
          scene,
          leader,
          follower,
          leaderPosition,
          followerPosition
        });
        if (constraintResult.state === RELATIONSHIP_CONSTRAINT_STATES.BROKEN) break;
      }
      results.push(constraintResult ?? {
        constraintId: constraint.id,
        state: RELATIONSHIP_CONSTRAINT_STATES.UNKNOWN,
        reason: "constraint-not-evaluated"
      });
      if (constraintResult?.state === RELATIONSHIP_CONSTRAINT_STATES.BROKEN) break;
    }

    const state = results.some((result) => result.state === RELATIONSHIP_CONSTRAINT_STATES.BROKEN)
      ? RELATIONSHIP_CONSTRAINT_STATES.BROKEN
      : (results.some((result) => result.state === RELATIONSHIP_CONSTRAINT_STATES.UNKNOWN)
          ? RELATIONSHIP_CONSTRAINT_STATES.UNKNOWN
          : RELATIONSHIP_CONSTRAINT_STATES.CLEAR);
    const result = {
      state,
      relationshipId: relationship.id,
      relationshipClass: RELATIONSHIP_CLASSES.OBSERVATIONAL,
      evaluatedRoute: samples.length > 1,
      sampleCount: samples.length,
      constraints: results
    };
    this.#stats.evaluations += 1;
    if (state === RELATIONSHIP_CONSTRAINT_STATES.BROKEN) this.#stats.broken += 1;
    if (state === RELATIONSHIP_CONSTRAINT_STATES.UNKNOWN) this.#stats.unknown += 1;
    this.#stats.lastResult = duplicateSafely(result);
    return result;
  }

  async evaluateForToken(tokenUuid, { route = null, removeBroken = false } = {}) {
    if (!tokenUuid) return [];
    const byId = new Map();
    for (const relationship of [
      ...this.#relationships.getForLeader(tokenUuid),
      ...this.#relationships.getForFollower(tokenUuid)
    ]) {
      if (isObservationalRelationship(relationship)) byId.set(relationship.id, relationship);
    }
    const results = [];
    const broken = [];
    for (const relationship of byId.values()) {
      const result = await this.evaluateRelationship(relationship, { movingTokenUuid: tokenUuid, route });
      results.push(result);
      if (result.state === RELATIONSHIP_CONSTRAINT_STATES.BROKEN) broken.push(result);
    }
    if (removeBroken && broken.length && this.#isAuthority()) {
      this.#stats.removals += await this.#removeBroken(broken);
    }
    return results;
  }

  async evaluateScene(sceneId, { removeBroken = false } = {}) {
    if (!sceneId) return [];
    const results = [];
    const broken = [];
    for (const relationship of this.#relationships.list({
      sceneId,
      relationshipClass: RELATIONSHIP_CLASSES.OBSERVATIONAL
    })) {
      const result = await this.evaluateRelationship(relationship);
      results.push(result);
      if (result.state === RELATIONSHIP_CONSTRAINT_STATES.BROKEN) broken.push(result);
    }
    if (removeBroken && broken.length && this.#isAuthority()) {
      this.#stats.removals += await this.#removeBroken(broken);
    }
    return results;
  }

  async #evaluateConstraint({ constraint, scene, leader, follower, leaderPosition, followerPosition }) {
    if (constraint.type === RELATIONSHIP_CONSTRAINT_TYPES.MAXIMUM_DISTANCE) {
      const measurement = await this.#distanceProviders.measure({
        provider: constraint.provider,
        scene,
        leader,
        follower,
        leaderPosition,
        followerPosition
      });
      if (measurement.state === RELATIONSHIP_CONSTRAINT_STATES.UNKNOWN) {
        return { constraintId: constraint.id, type: constraint.type, ...measurement };
      }
      const broken = measurement.distance > constraint.maximum + 1e-6;
      return {
        constraintId: constraint.id,
        type: constraint.type,
        ...measurement,
        state: broken ? RELATIONSHIP_CONSTRAINT_STATES.BROKEN : RELATIONSHIP_CONSTRAINT_STATES.CLEAR,
        reason: broken ? "maximum-distance-exceeded" : "within-maximum-distance",
        maximum: constraint.maximum
      };
    }

    if (constraint.type === RELATIONSHIP_CONSTRAINT_TYPES.COVER) {
      const cover = await this.#coverProviders.evaluate({
        provider: constraint.provider,
        threshold: constraint.threshold,
        scene,
        leader,
        follower,
        leaderPosition,
        followerPosition
      });
      return { constraintId: constraint.id, type: constraint.type, threshold: constraint.threshold, ...cover };
    }

    if (constraint.type === RELATIONSHIP_CONSTRAINT_TYPES.LINE_OF_SIGHT) {
      const sight = await this.#coverProviders.evaluateLineOfSight({
        scene,
        leader,
        follower,
        leaderPosition,
        followerPosition
      });
      return { constraintId: constraint.id, type: constraint.type, ...sight };
    }

    if (constraint.type === RELATIONSHIP_CONSTRAINT_TYPES.STATUS) {
      const token = constraint.participant === "leader" ? leader : follower;
      const activeStatuses = token?.actor?.statuses;
      if (!activeStatuses || typeof activeStatuses.has !== "function") {
        return {
          constraintId: constraint.id,
          type: constraint.type,
          state: RELATIONSHIP_CONSTRAINT_STATES.UNKNOWN,
          reason: "participant-status-unavailable",
          participant: constraint.participant
        };
      }
      const status = constraint.statuses.find(candidate => activeStatuses.has(candidate)) ?? null;
      return {
        constraintId: constraint.id,
        type: constraint.type,
        state: status ? RELATIONSHIP_CONSTRAINT_STATES.BROKEN : RELATIONSHIP_CONSTRAINT_STATES.CLEAR,
        reason: status ? "participant-status-matched" : "participant-status-clear",
        participant: constraint.participant,
        status,
        statuses: [...constraint.statuses]
      };
    }

    return {
      constraintId: constraint.id,
      type: constraint.type,
      state: RELATIONSHIP_CONSTRAINT_STATES.UNKNOWN,
      reason: "unsupported-constraint"
    };
  }

  async #handleMovement(transaction) {
    if (transaction.phase !== MOVEMENT_PHASES.AFTER) return true;
    const route = [transaction.origin, ...(transaction.path ?? []), transaction.destination].filter(Boolean);
    this.#stats.movementEvaluations += 1;
    await this.evaluateForToken(transaction.subjectUuid, { route, removeBroken: true });
    return true;
  }

  #sampleRoute(route, scene) {
    const normalized = [];
    for (const point of route) {
      const next = finitePosition(point, normalized.at(-1));
      if (!normalized.length || !samePoint(normalized.at(-1), next)) normalized.push(next);
    }
    if (normalized.length < 2) return normalized.length ? normalized : [null];

    const sampled = [normalized[0]];
    const stepSize = Math.max(1, Number(scene?.grid?.size ?? globalThis.canvas?.grid?.size ?? 100) / 2);
    for (let index = 1; index < normalized.length; index += 1) {
      const from = normalized[index - 1];
      const to = normalized[index];
      const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / stepSize));
      for (let step = 1; step <= steps; step += 1) {
        const ratio = step / steps;
        sampled.push({
          x: from.x + ((to.x - from.x) * ratio),
          y: from.y + ((to.y - from.y) * ratio),
          elevation: from.elevation + ((to.elevation - from.elevation) * ratio)
        });
      }
    }
    return sampled;
  }

  #reconcileConsumers() {
    const involved = new Set();
    for (const relationship of this.#relationships.list({ relationshipClass: RELATIONSHIP_CLASSES.OBSERVATIONAL })) {
      involved.add(relationship.leaderUuid);
      involved.add(relationship.followerUuid);
    }
    for (const [tokenUuid, remove] of this.#consumerRemovers) {
      if (involved.has(tokenUuid)) continue;
      remove();
      this.#consumerRemovers.delete(tokenUuid);
    }
    for (const tokenUuid of involved) {
      if (this.#consumerRemovers.has(tokenUuid)) continue;
      const remove = this.#movement.registerConsumer({
        id: `${CONSUMER_PREFIX}.${tokenUuid}`,
        phases: [MOVEMENT_PHASES.AFTER],
        priority: 9_500,
        tokenUuids: [tokenUuid],
        execution: "primaryGM",
        handler: this.#handleMovement.bind(this)
      });
      this.#consumerRemovers.set(tokenUuid, remove);
    }
  }

  #queueSceneEvaluation(sceneId) {
    if (!sceneId || !this.#isAuthority() || this.#queuedScenes.has(sceneId)) return;
    this.#queuedScenes.add(sceneId);
    globalThis.setTimeout(() => {
      this.#queuedScenes.delete(sceneId);
      this.#stats.geometryEvaluations += 1;
      void this.evaluateScene(sceneId, { removeBroken: true }).catch((error) => {
        Logger.warn("Relationship constraint geometry evaluation failed open.", error);
      });
    }, 0);
  }

  #onRelationshipChanged(relationship) {
    this.#reconcileConsumers();
    if (!isObservationalRelationship(relationship) || !this.#isAuthority()) return;
    globalThis.setTimeout(() => {
      void this.evaluateRelationship(relationship).then(async (result) => {
        if (result.state !== RELATIONSHIP_CONSTRAINT_STATES.BROKEN) return;
        this.#stats.removals += await this.#removeBroken([result]);
      }).catch((error) => {
        Logger.warn("Initial relationship constraint evaluation failed open.", error);
      });
    }, 0);
  }

  #queueTokenEvaluation(tokenUuid) {
    if (!tokenUuid || !this.#isAuthority()) return;
    globalThis.setTimeout(() => {
      void this.evaluateForToken(tokenUuid, { removeBroken: true }).catch((error) => {
        Logger.warn("Relationship constraint token evaluation failed open.", error);
      });
    }, 0);
  }

  #queueActorEvaluation(actor) {
    const actorUuid = actor?.uuid ?? null;
    if (!actorUuid || !this.#isAuthority()) return;
    globalThis.setTimeout(() => {
      void (async () => {
        const tokenUuids = new Set();
        for (const relationship of this.#relationships.list({
          relationshipClass: RELATIONSHIP_CLASSES.OBSERVATIONAL
        })) {
          for (const uuid of [relationship.leaderUuid, relationship.followerUuid]) {
            let token = null;
            try { token = await fromUuid(uuid); } catch { /* unavailable */ }
            if (token?.actor?.uuid === actorUuid) tokenUuids.add(uuid);
          }
        }
        for (const tokenUuid of tokenUuids) {
          await this.evaluateForToken(tokenUuid, { removeBroken: true });
        }
      })().catch((error) => {
        Logger.warn("Relationship status constraint evaluation failed open.", error);
      });
    }, 0);
  }

  async #removeBroken(results) {
    let removed = 0;
    for (const result of results) {
      const failure = result?.constraints?.find(entry => entry?.state === RELATIONSHIP_CONSTRAINT_STATES.BROKEN)
        ?? result;
      removed += await this.#relationships.removeManyAsGM([result.relationshipId], {
        reason: failure?.reason ?? "constraint-broken",
        details: duplicateSafely(failure ?? {})
      });
    }
    return removed;
  }

  #listen(hook, handler) {
    this.#hooks.push([hook, Hooks.on(hook, handler)]);
  }

  #isAuthority() {
    if (!globalThis.game?.user?.isGM) return false;
    const primary = game.users?.activeGM ?? game.users?.find?.((user) => user?.active && user?.isGM);
    return !primary || primary.id === game.user.id;
  }
}
