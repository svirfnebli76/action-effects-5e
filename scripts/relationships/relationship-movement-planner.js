import { ATTACHMENT_MODES, PATH_TYPES } from "../core/constants.js";
import { duplicateSafely } from "../core/utils.js";

const MAX_WAYPOINTS = 100;
const POSITION_FIELDS = Object.freeze([
  "x",
  "y",
  "elevation",
  "action",
  "checkpoint",
  "explicit",
  "snapped",
  "level",
  "shape"
]);

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positionsEqual(a, b) {
  return finiteNumber(a?.x) === finiteNumber(b?.x)
    && finiteNumber(a?.y) === finiteNumber(b?.y)
    && finiteNumber(a?.elevation, 0) === finiteNumber(b?.elevation, 0);
}

function sanitizeWaypoint(waypoint = {}) {
  const clean = {};
  for (const field of POSITION_FIELDS) {
    const value = waypoint[field];
    if (value !== undefined && value !== null) clean[field] = duplicateSafely(value);
  }

  clean.x = finiteNumber(clean.x);
  clean.y = finiteNumber(clean.y);
  if (clean.x === null || clean.y === null) throw new Error("Every movement waypoint requires finite x and y coordinates.");

  if (clean.elevation !== undefined) {
    clean.elevation = finiteNumber(clean.elevation);
    if (clean.elevation === null) throw new Error("Movement waypoint elevation must be finite.");
  }

  return clean;
}

function copyWaypointFields(source, target, { includeCheckpoint = true } = {}) {
  const fields = ["action", "explicit", "snapped", "level", "shape"];
  if (includeCheckpoint) fields.push("checkpoint");
  for (const field of fields) {
    if (source?.[field] !== undefined) target[field] = duplicateSafely(source[field]);
  }
  return target;
}

export class RelationshipMovementPlanner {
  static extractWaypoints(movement = {}) {
    const candidate = Array.isArray(movement?.pending?.waypoints) && movement.pending.waypoints.length
      ? movement.pending.waypoints
      : [movement?.destination].filter(Boolean);

    if (!candidate.length) throw new Error("The intercepted token movement did not contain a destination.");
    if (candidate.length > MAX_WAYPOINTS) throw new Error(`Relationship movement is limited to ${MAX_WAYPOINTS} waypoints.`);

    const origin = this.sanitizePosition(movement.origin, "movement origin");
    const waypoints = candidate.map((waypoint) => sanitizeWaypoint(waypoint));
    if (waypoints.length > 1 && positionsEqual(waypoints[0], origin)) waypoints.shift();
    if (!waypoints.length) waypoints.push(this.sanitizePosition(movement.destination, "movement destination"));
    return this.ensureTerminalCheckpoint(waypoints);
  }

  static sanitizeWaypoints(waypoints) {
    if (!Array.isArray(waypoints) || !waypoints.length) throw new Error("The movement path is empty.");
    if (waypoints.length > MAX_WAYPOINTS) throw new Error(`Relationship movement is limited to ${MAX_WAYPOINTS} waypoints.`);
    return this.ensureTerminalCheckpoint(waypoints.map((waypoint) => sanitizeWaypoint(waypoint)));
  }

  static ensureTerminalCheckpoint(waypoints) {
    if (!Array.isArray(waypoints) || !waypoints.length) throw new Error("The movement path is empty.");
    // Foundry 14.365 live testing showed programmatic Scene.moveTokens paths can
    // resolve false unless the terminal waypoint is explicitly a checkpoint.
    // Preserve all intermediate checkpoint state and normalize only the last point.
    const normalized = waypoints.map((waypoint) => duplicateSafely(waypoint));
    normalized[normalized.length - 1].checkpoint = true;
    return normalized;
  }

  static extractTransactionWaypoints(transaction = {}) {
    const origin = this.sanitizePosition(transaction.origin, "transaction origin");
    const candidate = Array.isArray(transaction.path) && transaction.path.length
      ? transaction.path
      : [transaction.destination].filter(Boolean);
    const waypoints = this.sanitizeWaypoints(candidate);
    if (waypoints.length > 1 && positionsEqual(waypoints[0], origin)) waypoints.shift();
    if (!waypoints.length) waypoints.push(this.sanitizePosition(transaction.destination, "transaction destination"));
    return waypoints;
  }

  static sanitizePosition(position, label = "position") {
    const x = finiteNumber(position?.x);
    const y = finiteNumber(position?.y);
    const elevation = finiteNumber(position?.elevation, 0);
    if (x === null || y === null || elevation === null) throw new Error(`The ${label} is invalid.`);
    return { x, y, elevation };
  }

  static translateWaypoints({ leader, follower, relationship, waypoints, pathType = PATH_TYPES.TRAVERSE, grid = null }) {
    const leaderOrigin = this.sanitizePosition(leader, "leader position");
    const followerOrigin = this.sanitizePosition(follower, "follower position");
    const cleanWaypoints = this.sanitizeWaypoints(waypoints);

    switch (relationship.attachmentMode) {
      case ATTACHMENT_MODES.ADJACENT_FOLLOWER:
        // A trailing/dragged follower occupies each space just vacated by the
        // leader. For L0 -> L1 -> L2, the follower path is L0 -> L1 and ends
        // one leader waypoint behind. Teleport-follow is intentionally exempt:
        // a follower that teleports with its leader preserves its prior offset.
        if (pathType !== PATH_TYPES.TELEPORT) {
          return this.#buildTrailingWaypoints({
            leaderOrigin,
            followerOrigin,
            relationship,
            leaderWaypoints: cleanWaypoints,
            grid
          });
        }
        return this.#translateRigidOffset({ leaderOrigin, followerOrigin, relationship, waypoints: cleanWaypoints });

      case ATTACHMENT_MODES.RIGID_OFFSET:
      case ATTACHMENT_MODES.ANCHORED_FOLLOWER:
      case ATTACHMENT_MODES.PASSENGER:
        return this.#translateRigidOffset({ leaderOrigin, followerOrigin, relationship, waypoints: cleanWaypoints });

      default:
        throw new Error(`Unsupported attachment mode '${relationship.attachmentMode}'.`);
    }
  }

  static #buildTrailingWaypoints({ leaderOrigin, followerOrigin, relationship, leaderWaypoints, grid }) {
    const expandedLeaderPositions = this.#expandLeaderGridPath({
      leaderOrigin,
      leaderWaypoints,
      grid
    });
    const priorLeaderPositions = expandedLeaderPositions.slice(0, -1);
    if (!priorLeaderPositions.length) priorLeaderPositions.push(leaderOrigin);
    if (priorLeaderPositions.length > MAX_WAYPOINTS) {
      throw new Error(`Relationship movement is limited to ${MAX_WAYPOINTS} translated grid steps.`);
    }

    const trailingWaypoints = priorLeaderPositions.map((position) => {
      const trailing = {
        x: Math.round(position.x),
        y: Math.round(position.y),
        elevation: relationship.followElevation !== false
          ? finiteNumber(position.elevation, leaderOrigin.elevation)
          : followerOrigin.elevation
      };
      copyWaypointFields(position, trailing);
      return trailing;
    });

    return this.ensureTerminalCheckpoint(trailingWaypoints);
  }

  static #expandLeaderGridPath({ leaderOrigin, leaderWaypoints, grid }) {
    const fallback = [leaderOrigin, ...leaderWaypoints].map((point) => duplicateSafely(point));
    if (!grid || grid.isGridless === true) return fallback;
    if (typeof grid.getDirectPath !== "function" || typeof grid.getTopLeftPoint !== "function") return fallback;

    // Grid expansion is used only when the leader route stays on a constant
    // elevation and each declared endpoint is aligned to a grid-space top-left.
    // Otherwise preserving the exact Foundry waypoints is safer than snapping an
    // off-grid or vertical route to a different path.
    const declared = [leaderOrigin, ...leaderWaypoints];
    const sameElevation = declared.every((point) => (
      finiteNumber(point.elevation, leaderOrigin.elevation) === leaderOrigin.elevation
    ));
    if (!sameElevation) return fallback;

    try {
      for (const point of declared) {
        const topLeft = grid.getTopLeftPoint({ x: point.x, y: point.y });
        if (!topLeft || Math.round(topLeft.x) !== Math.round(point.x) || Math.round(topLeft.y) !== Math.round(point.y)) {
          return fallback;
        }
      }

      const expanded = [duplicateSafely(leaderOrigin)];
      let segmentStart = leaderOrigin;
      for (const waypoint of leaderWaypoints) {
        const offsets = grid.getDirectPath([
          { x: segmentStart.x, y: segmentStart.y },
          { x: waypoint.x, y: waypoint.y }
        ]);
        if (!Array.isArray(offsets) || !offsets.length) return fallback;

        const segmentPoints = offsets.map((offset) => grid.getTopLeftPoint(offset));
        if (!segmentPoints.every((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y))) return fallback;

        for (let index = 0; index < segmentPoints.length; index += 1) {
          const point = segmentPoints[index];
          const isSegmentEndpoint = index === segmentPoints.length - 1;
          const expandedPoint = {
            x: Math.round(point.x),
            y: Math.round(point.y),
            elevation: finiteNumber(waypoint.elevation, leaderOrigin.elevation)
          };
          copyWaypointFields(waypoint, expandedPoint, { includeCheckpoint: isSegmentEndpoint });

          if (!positionsEqual(expanded.at(-1), expandedPoint)) expanded.push(expandedPoint);
          else if (isSegmentEndpoint) copyWaypointFields(waypoint, expanded[expanded.length - 1]);
        }
        segmentStart = waypoint;
      }

      const expectedDestination = leaderWaypoints.at(-1);
      if (!positionsEqual(expanded.at(-1), expectedDestination)) return fallback;
      return expanded;
    } catch {
      return fallback;
    }
  }

  static #translateRigidOffset({ leaderOrigin, followerOrigin, relationship, waypoints }) {
    const dx = followerOrigin.x - leaderOrigin.x;
    const dy = followerOrigin.y - leaderOrigin.y;
    const de = followerOrigin.elevation - leaderOrigin.elevation;

    const translatedWaypoints = waypoints.map((waypoint) => {
      const translated = {
        x: Math.round(waypoint.x + dx),
        y: Math.round(waypoint.y + dy)
      };

      if (relationship.followElevation !== false) {
        translated.elevation = finiteNumber(waypoint.elevation, leaderOrigin.elevation) + de;
      } else {
        translated.elevation = followerOrigin.elevation;
      }

      copyWaypointFields(waypoint, translated);
      return translated;
    });

    return this.ensureTerminalCheckpoint(translatedWaypoints);
  }

  static buildInstructions({ leader, followers, waypoints, pathType = PATH_TYPES.TRAVERSE, grid = null }) {
    const leaderWaypoints = this.ensureTerminalCheckpoint(waypoints);
    const instructions = {
      [leader.id]: {
        waypoints: leaderWaypoints,
        method: "api",
        showRuler: false
      }
    };

    for (const { token, relationship } of followers) {
      instructions[token.id] = {
        waypoints: this.translateWaypoints({
          leader,
          follower: token,
          relationship,
          waypoints: leaderWaypoints,
          pathType,
          grid
        }),
        method: "api",
        showRuler: false
      };
    }

    return instructions;
  }

  static finalWaypoint(waypoints) {
    return waypoints.at(-1) ?? null;
  }

  static positionsEqual(a, b) {
    return positionsEqual(a, b);
  }
}
