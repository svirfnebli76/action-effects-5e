import {
  RELATIONSHIP_GEOMETRY_CHANNELS,
  RELATIVE_TOKEN_RELATIONSHIPS
} from "../core/constants.js";
import { duplicateSafely } from "../core/utils.js";
import { Logger } from "../core/logger.js";
import { RelationshipGeometryService } from "./relationship-geometry-service.js";

const EPSILON = 1e-6;

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Physical link obstruction geometry for relationship types such as Grapple.
 *
 * The link is represented by the portion of the leader-center -> follower-center
 * ray which lies outside both token footprints. Third-party creature tests use
 * their full token rectangle (slightly padded for a non-zero-width link), not
 * their center point. During movement the link is sampled through the swept
 * transition, which approximates the fan swept by the appendage/tether while
 * remaining deterministic and inexpensive on a square grid.
 */
export class RelationshipLinkObstructionService {
  #relativeRelationships;

  constructor({ relativeRelationships }) {
    this.#relativeRelationships = relativeRelationships;
  }

  linkSegment({ scene, leader, follower, followerPosition = follower, leaderPosition = leader } = {}) {
    if (!scene?.grid || !leader || !follower) return null;
    const grid = scene.grid;
    const leaderBounds = RelationshipGeometryService.tokenBounds(leader, grid, leaderPosition);
    const followerBounds = RelationshipGeometryService.tokenBounds(follower, grid, followerPosition);
    const leaderCenter = RelationshipGeometryService.tokenCenter(leader, grid, leaderPosition);
    const followerCenter = RelationshipGeometryService.tokenCenter(follower, grid, followerPosition);

    const start = this.#rayExitPoint(leaderBounds, leaderCenter, followerCenter);
    const end = this.#rayExitPoint(followerBounds, followerCenter, leaderCenter);
    if (!start || !end) return null;

    return {
      start: {
        x: start.x,
        y: start.y,
        elevation: finiteNumber(leaderCenter.elevation, finiteNumber(leader.elevation, 0))
      },
      end: {
        x: end.x,
        y: end.y,
        elevation: finiteNumber(followerCenter.elevation, finiteNumber(follower.elevation, 0))
      },
      lengthPixels: Math.hypot(end.x - start.x, end.y - start.y)
    };
  }

  inspectAtPosition({ scene, leader, follower, followerPosition = follower } = {}) {
    const geometryChannel = RELATIONSHIP_GEOMETRY_CHANNELS.GRAPPLE_LINK;
    const segment = this.linkSegment({ scene, leader, follower, followerPosition });
    if (!segment || segment.lengthPixels <= EPSILON) {
      return {
        geometryChannel,
        segment: duplicateSafely(segment),
        wallBlocked: false,
        wallCheckAvailable: true,
        conflicts: [],
        hostile: [],
        nonhostile: []
      };
    }

    const wall = this.#testWallCollision({ scene, leader, segment });
    const conflicts = this.#tokenConflicts({ scene, leader, follower, followerPosition, segment });
    return {
      geometryChannel,
      segment: duplicateSafely(segment),
      wallBlocked: wall.blocked,
      wallCheckAvailable: wall.available,
      wallReasonCode: wall.reasonCode,
      wallCollision: duplicateSafely(wall.collision),
      conflicts: duplicateSafely(conflicts),
      hostile: duplicateSafely(conflicts.filter((entry) => entry.relationship === RELATIVE_TOKEN_RELATIONSHIPS.HOSTILE)),
      nonhostile: duplicateSafely(conflicts.filter((entry) => entry.relationship === RELATIVE_TOKEN_RELATIONSHIPS.NONHOSTILE))
    };
  }

  inspectSweep({ scene, leader, follower, fromPosition = follower, toPosition } = {}) {
    const geometryChannel = RELATIONSHIP_GEOMETRY_CHANNELS.GRAPPLE_LINK;
    if (!toPosition) {
      return {
        blocked: true,
        geometryChannel,
        reasonCode: "missing-link-destination",
        wallBlocked: false,
        conflicts: [],
        hostile: [],
        nonhostile: [],
        samples: []
      };
    }

    const gridSize = Math.max(1, finiteNumber(scene?.grid?.size, 100));
    const dx = finiteNumber(toPosition.x, finiteNumber(follower.x, 0)) - finiteNumber(fromPosition.x, finiteNumber(follower.x, 0));
    const dy = finiteNumber(toPosition.y, finiteNumber(follower.y, 0)) - finiteNumber(fromPosition.y, finiteNumber(follower.y, 0));
    const pixelDistance = Math.hypot(dx, dy);
    // At least eight samples per grid-space transition, capped for safety.
    const sampleCount = clamp(Math.ceil(pixelDistance / Math.max(gridSize / 8, 1)), 1, 32);
    const conflictsByKey = new Map();
    const samples = [];
    let wallBlocked = false;
    let wallReasonCode = null;
    let wallCheckAvailable = true;

    for (let index = 0; index <= sampleCount; index += 1) {
      const t = sampleCount ? index / sampleCount : 1;
      const position = {
        x: finiteNumber(fromPosition.x, follower.x) + (dx * t),
        y: finiteNumber(fromPosition.y, follower.y) + (dy * t),
        elevation: finiteNumber(toPosition.elevation, finiteNumber(follower.elevation, 0))
      };
      const inspection = this.inspectAtPosition({ scene, leader, follower, followerPosition: position });
      samples.push({
        t,
        position: duplicateSafely(position),
        segment: duplicateSafely(inspection.segment),
        wallBlocked: inspection.wallBlocked,
        conflicts: duplicateSafely(inspection.conflicts)
      });
      if (inspection.wallBlocked) {
        wallBlocked = true;
        wallReasonCode = inspection.wallReasonCode ?? "grapple-link-wall";
      }
      if (inspection.wallCheckAvailable === false) wallCheckAvailable = false;
      for (const entry of inspection.conflicts) {
        const key = `${entry.otherUuid ?? entry.blockerUuid ?? "unknown"}|${entry.relationship}|${entry.reasonCode}`;
        if (!conflictsByKey.has(key)) {
          conflictsByKey.set(key, {
            ...duplicateSafely(entry),
            firstSampleT: t,
            firstSamplePosition: duplicateSafely(position)
          });
        }
      }
    }

    const conflicts = [...conflictsByKey.values()];
    const hostile = conflicts.filter((entry) => entry.relationship === RELATIVE_TOKEN_RELATIONSHIPS.HOSTILE);
    const nonhostile = conflicts.filter((entry) => entry.relationship === RELATIVE_TOKEN_RELATIONSHIPS.NONHOSTILE);
    const blocked = wallBlocked || hostile.length > 0 || wallCheckAvailable === false;
    let reasonCode = "clear";
    if (wallCheckAvailable === false) reasonCode = "grapple-link-wall-preflight-unavailable";
    else if (wallBlocked) reasonCode = wallReasonCode ?? "grapple-link-wall";
    else if (hostile.length) reasonCode = "hostile-creature";
    else if (nonhostile.length) reasonCode = "nonhostile-creature";

    return {
      blocked,
      geometryChannel,
      reasonCode,
      wallBlocked,
      wallCheckAvailable,
      conflicts: duplicateSafely(conflicts),
      hostile: duplicateSafely(hostile),
      nonhostile: duplicateSafely(nonhostile),
      samples: duplicateSafely(samples)
    };
  }

  #rayExitPoint(bounds, origin, destination) {
    const dx = destination.x - origin.x;
    const dy = destination.y - origin.y;
    if (Math.abs(dx) <= EPSILON && Math.abs(dy) <= EPSILON) return { x: origin.x, y: origin.y };

    const tx = Math.abs(dx) <= EPSILON
      ? Infinity
      : ((dx > 0 ? bounds.right : bounds.left) - origin.x) / dx;
    const ty = Math.abs(dy) <= EPSILON
      ? Infinity
      : ((dy > 0 ? bounds.bottom : bounds.top) - origin.y) / dy;
    const positive = [tx, ty].filter((value) => Number.isFinite(value) && value >= 0);
    const t = positive.length ? Math.min(...positive) : 0;
    return { x: origin.x + (dx * t), y: origin.y + (dy * t) };
  }

  #tokenConflicts({ scene, leader, follower, followerPosition, segment }) {
    const conflicts = [];
    const gridSize = Math.max(1, finiteNumber(scene?.grid?.size, 100));
    const linkPadding = Math.max(2, gridSize * 0.04);
    const elevation = finiteNumber(followerPosition?.elevation, finiteNumber(follower.elevation, 0));

    for (const candidate of scene.tokens ?? []) {
      if (!(candidate instanceof foundry.documents.TokenDocument)) continue;
      if (candidate.uuid === leader.uuid || candidate.uuid === follower.uuid) continue;
      if (Math.abs(finiteNumber(candidate.elevation, 0) - elevation) > 0.01) continue;
      const bounds = RelationshipGeometryService.tokenBounds(candidate, scene.grid, candidate);
      const padded = {
        left: bounds.left - linkPadding,
        right: bounds.right + linkPadding,
        top: bounds.top - linkPadding,
        bottom: bounds.bottom + linkPadding
      };
      if (!this.#segmentIntersectsRect(segment.start, segment.end, padded)) continue;

      const resolution = this.#relativeRelationships.resolveForGeometry({
        geometryChannel: RELATIONSHIP_GEOMETRY_CHANNELS.GRAPPLE_LINK,
        leaderToken: leader,
        followerToken: follower,
        otherToken: candidate
      });
      conflicts.push({
        ...duplicateSafely(resolution),
        blockerUuid: candidate.uuid,
        blockerName: candidate.name ?? null,
        segment: duplicateSafely(segment)
      });
    }
    return conflicts;
  }

  #segmentIntersectsRect(a, b, rect) {
    // Liang-Barsky segment / AABB clipping.
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const p = [-dx, dx, -dy, dy];
    const q = [a.x - rect.left, rect.right - a.x, a.y - rect.top, rect.bottom - a.y];
    let u1 = 0;
    let u2 = 1;
    for (let i = 0; i < 4; i += 1) {
      if (Math.abs(p[i]) <= EPSILON) {
        if (q[i] < 0) return false;
        continue;
      }
      const t = q[i] / p[i];
      if (p[i] < 0) u1 = Math.max(u1, t);
      else u2 = Math.min(u2, t);
      if (u1 - u2 > EPSILON) return false;
    }
    return true;
  }

  #testWallCollision({ scene, leader, segment }) {
    const backend = globalThis.CONFIG?.Canvas?.polygonBackends?.move;
    if (!backend?.testCollision) {
      return {
        available: false,
        blocked: true,
        reasonCode: "grapple-link-wall-preflight-unavailable",
        collision: null
      };
    }
    try {
      const origin = {
        x: segment.start.x,
        y: segment.start.y,
        elevation: segment.start.elevation
      };
      const destination = {
        x: segment.end.x,
        y: segment.end.y,
        elevation: segment.end.elevation
      };
      const collision = backend.testCollision(origin, destination, {
        type: "move",
        mode: "any",
        source: leader.object ?? null,
        level: scene?.levels?.active ?? undefined
      });
      return {
        available: true,
        blocked: collision === true,
        reasonCode: collision === true ? "grapple-link-wall" : "clear",
        collision
      };
    } catch (error) {
      Logger.warn("Could not evaluate Grapple-link wall collision; failing closed.", error);
      return {
        available: false,
        blocked: true,
        reasonCode: "grapple-link-wall-preflight-unavailable",
        collision: null
      };
    }
  }
}
