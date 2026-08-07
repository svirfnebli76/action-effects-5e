import { ATTACHMENT_MODES } from "../core/constants.js";
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
    return waypoints;
  }

  static sanitizeWaypoints(waypoints) {
    if (!Array.isArray(waypoints) || !waypoints.length) throw new Error("The movement path is empty.");
    if (waypoints.length > MAX_WAYPOINTS) throw new Error(`Relationship movement is limited to ${MAX_WAYPOINTS} waypoints.`);
    return waypoints.map((waypoint) => sanitizeWaypoint(waypoint));
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

  static translateWaypoints({ leader, follower, relationship, waypoints }) {
    const leaderOrigin = this.sanitizePosition(leader, "leader position");
    const followerOrigin = this.sanitizePosition(follower, "follower position");
    const dx = followerOrigin.x - leaderOrigin.x;
    const dy = followerOrigin.y - leaderOrigin.y;
    const de = followerOrigin.elevation - leaderOrigin.elevation;

    switch (relationship.attachmentMode) {
      case ATTACHMENT_MODES.RIGID_OFFSET:
      case ATTACHMENT_MODES.ADJACENT_FOLLOWER:
      case ATTACHMENT_MODES.ANCHORED_FOLLOWER:
      case ATTACHMENT_MODES.PASSENGER:
        break;
      default:
        throw new Error(`Unsupported attachment mode '${relationship.attachmentMode}'.`);
    }

    return waypoints.map((waypoint) => {
      const translated = {
        x: Math.round(waypoint.x + dx),
        y: Math.round(waypoint.y + dy)
      };

      if (relationship.followElevation !== false) {
        translated.elevation = finiteNumber(waypoint.elevation, leaderOrigin.elevation) + de;
      } else {
        translated.elevation = followerOrigin.elevation;
      }

      for (const field of ["action", "checkpoint", "explicit", "snapped", "level", "shape"]) {
        if (waypoint[field] !== undefined) translated[field] = duplicateSafely(waypoint[field]);
      }
      return translated;
    });
  }

  static buildInstructions({ leader, followers, waypoints }) {
    const instructions = {
      [leader.id]: {
        waypoints: duplicateSafely(waypoints),
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
          waypoints
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
