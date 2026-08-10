import {
  MOVEMENT_GEOMETRY_CHANNELS,
  RELATIVE_TOKEN_RELATIONSHIPS
} from "../core/constants.js";
import { duplicateSafely } from "../core/utils.js";
import { Logger } from "../core/logger.js";

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export class MovementObstructionService {
  #relativeRelationships;

  constructor({ relativeRelationships }) {
    this.#relativeRelationships = relativeRelationships;
  }

  tokenBoundsAt(token, position, gridSize) {
    const x = finiteNumber(position?.x, finiteNumber(token?.x, 0));
    const y = finiteNumber(position?.y, finiteNumber(token?.y, 0));
    const width = Math.max(0, finiteNumber(token?.width, 1)) * gridSize;
    const height = Math.max(0, finiteNumber(token?.height, 1)) * gridSize;
    return { left: x, top: y, right: x + width, bottom: y + height };
  }

  boundsOverlap(a, b) {
    return a.left < b.right - 0.01
      && a.right > b.left + 0.01
      && a.top < b.bottom - 0.01
      && a.bottom > b.top + 0.01;
  }

  inspectBodyAtPosition({ scene, subjectToken, position, geometryChannel = MOVEMENT_GEOMETRY_CHANNELS.DISPLACED_BODY }) {
    if (!scene?.tokens || !subjectToken || !position) {
      return { conflicts: [], hostile: [], nonhostile: [] };
    }
    const gridSize = finiteNumber(scene.grid?.size);
    if (!(gridSize > 0)) return { conflicts: [], hostile: [], nonhostile: [] };

    const subjectBounds = this.tokenBoundsAt(subjectToken, position, gridSize);
    const subjectElevation = finiteNumber(position.elevation, finiteNumber(subjectToken.elevation, 0));
    const conflicts = [];

    for (const candidate of scene.tokens) {
      if (!(candidate instanceof foundry.documents.TokenDocument)) continue;
      if (candidate.uuid === subjectToken.uuid) continue;
      if (Math.abs(finiteNumber(candidate.elevation, 0) - subjectElevation) > 0.01) continue;
      if (!this.boundsOverlap(subjectBounds, this.tokenBoundsAt(candidate, candidate, gridSize))) continue;

      const resolution = this.#relativeRelationships.resolve({
        referenceToken: subjectToken,
        otherToken: candidate,
        geometryChannel
      });
      conflicts.push({
        ...duplicateSafely(resolution),
        blockerUuid: candidate.uuid,
        blockerName: candidate.name ?? null,
        position: duplicateSafely(position)
      });
    }

    return {
      conflicts,
      hostile: conflicts.filter((entry) => entry.relationship === RELATIVE_TOKEN_RELATIONSHIPS.HOSTILE),
      nonhostile: conflicts.filter((entry) => entry.relationship === RELATIVE_TOKEN_RELATIONSHIPS.NONHOSTILE)
    };
  }

  /**
   * Evaluate an already-generated discrete square-grid body path. Each position
   * is one forced-displacement step. A hard obstruction truncates the movement
   * at the immediately preceding legal position. Nonhostile bodies never block
   * transit, but a nonhostile occupant at the resulting endpoint is returned so
   * the caller can start an endpoint grace window.
   */
  evaluateDiscreteBodyPath({
    scene,
    subjectToken,
    positions = [],
    gridDistance,
    geometryChannel = MOVEMENT_GEOMETRY_CHANNELS.DISPLACED_BODY
  } = {}) {
    if (!(subjectToken instanceof foundry.documents.TokenDocument)) {
      throw new Error("Body obstruction evaluation requires a TokenDocument subject.");
    }
    if (!scene || subjectToken.parent?.id !== scene.id) {
      throw new Error("Body obstruction evaluation requires the subject and Scene to match.");
    }
    if (!Array.isArray(positions) || !positions.length) {
      throw new Error("Body obstruction evaluation requires at least one displacement position.");
    }

    const origin = {
      x: finiteNumber(subjectToken.x, 0),
      y: finiteNumber(subjectToken.y, 0),
      elevation: finiteNumber(subjectToken.elevation, 0)
    };
    const distancePerStep = finiteNumber(gridDistance, finiteNumber(scene.grid?.distance, 0));
    const placeable = subjectToken.object;
    const legalPositions = [];
    const conflicts = [];
    const allowedNonhostileUuids = new Set();
    let hardBlock = null;
    let previous = origin;

    for (let index = 0; index < positions.length; index += 1) {
      const position = {
        x: finiteNumber(positions[index]?.x, previous.x),
        y: finiteNumber(positions[index]?.y, previous.y),
        elevation: finiteNumber(positions[index]?.elevation, previous.elevation),
        step: finiteNumber(positions[index]?.step, index + 1),
        distance: finiteNumber(positions[index]?.distance, (index + 1) * distancePerStep)
      };

      if (!placeable?.constrainMovementPath) {
        hardBlock = {
          type: "environment",
          reasonCode: "preflight-unavailable",
          geometryChannel,
          step: index + 1,
          position: duplicateSafely(position),
          conflicts: []
        };
        break;
      }

      // AE5E owns creature-space semantics for the displaced body. Ask the
      // public Foundry constraint pipeline to evaluate only environment/walls.
      const [, environmentConstrained] = placeable.constrainMovementPath(
        [previous, position],
        {
          preview: false,
          ignoreWalls: false,
          ignoreCost: true,
          ignoreTokens: true,
          maxCost: Infinity,
          maxDistance: Infinity
        }
      );
      if (environmentConstrained === true) {
        hardBlock = {
          type: "environment",
          reasonCode: "environment-obstruction",
          geometryChannel,
          step: index + 1,
          position: duplicateSafely(position),
          conflicts: []
        };
        break;
      }

      const occupancy = this.inspectBodyAtPosition({
        scene,
        subjectToken,
        position,
        geometryChannel
      });
      const stepConflicts = occupancy.conflicts.map((entry) => ({
        ...duplicateSafely(entry),
        step: index + 1
      }));
      conflicts.push(...stepConflicts);

      if (occupancy.hostile.length) {
        hardBlock = {
          type: "creature",
          reasonCode: "hostile-creature",
          geometryChannel,
          step: index + 1,
          position: duplicateSafely(position),
          conflicts: stepConflicts.filter((entry) => entry.relationship === RELATIVE_TOKEN_RELATIONSHIPS.HOSTILE)
        };
        break;
      }

      for (const entry of occupancy.nonhostile) {
        if (entry.blockerUuid) allowedNonhostileUuids.add(entry.blockerUuid);
      }
      legalPositions.push(position);
      previous = position;
    }

    const lastLegalPosition = legalPositions.at(-1) ?? origin;
    const endpoint = this.inspectBodyAtPosition({
      scene,
      subjectToken,
      position: lastLegalPosition,
      geometryChannel
    });
    for (const entry of endpoint.nonhostile) {
      if (entry.blockerUuid) allowedNonhostileUuids.add(entry.blockerUuid);
    }

    const completedSteps = legalPositions.length;
    const requestedSteps = positions.length;
    const actualDistance = completedSteps * distancePerStep;
    const requestedDistance = requestedSteps * distancePerStep;

    return {
      geometryChannel,
      origin: duplicateSafely(origin),
      requestedSteps,
      completedSteps,
      requestedDistance,
      actualDistance,
      completedRequestedDistance: completedSteps === requestedSteps,
      hardBlock: duplicateSafely(hardBlock),
      legalPositions: duplicateSafely(legalPositions),
      lastLegalPosition: duplicateSafely(lastLegalPosition),
      conflicts: duplicateSafely(conflicts),
      endpointConflicts: duplicateSafely(endpoint.nonhostile),
      allowedNonhostileUuids: [...allowedNonhostileUuids]
    };
  }

  endpointConflicts({ scene, subjectToken, position, geometryChannel = MOVEMENT_GEOMETRY_CHANNELS.DISPLACED_BODY }) {
    try {
      return this.inspectBodyAtPosition({ scene, subjectToken, position, geometryChannel }).conflicts;
    } catch (error) {
      Logger.debug("Could not inspect an endpoint conflict.", error);
      return [];
    }
  }

  endpointNonhostileConflicts({ scene, subjectToken, position, geometryChannel = MOVEMENT_GEOMETRY_CHANNELS.DISPLACED_BODY }) {
    try {
      return this.inspectBodyAtPosition({ scene, subjectToken, position, geometryChannel }).nonhostile;
    } catch (error) {
      Logger.debug("Could not inspect a nonhostile endpoint conflict.", error);
      return [];
    }
  }
}
