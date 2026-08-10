import {
  DISPLACEMENT_DESTINATION_STATES,
  MOVEMENT_GEOMETRY_CHANNELS
} from "../core/constants.js";
import { duplicateSafely } from "../core/utils.js";

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export class DisplacementPlanner {
  #directions;
  #obstructions;

  constructor({ directions, obstructions }) {
    this.#directions = directions;
    this.#obstructions = obstructions;
  }

  buildCandidates({ scene, sourceToken, targetToken, type, directionConstraint, distance }) {
    const directionPlan = this.#directions.getAllowedSquareDirections({
      scene,
      sourceToken,
      targetToken,
      type,
      directionConstraint
    });

    const candidates = directionPlan.directions.map((direction) => {
      const steps = this.#directions.buildStepPositions({
        scene,
        targetToken,
        distance,
        direction
      });
      const obstruction = this.#obstructions.evaluateDiscreteBodyPath({
        scene,
        subjectToken: targetToken,
        positions: steps.positions,
        gridDistance: steps.gridDistance,
        geometryChannel: MOVEMENT_GEOMETRY_CHANNELS.DISPLACED_BODY
      });

      let state = DISPLACEMENT_DESTINATION_STATES.CLEAR;
      if (obstruction.completedSteps === 0 && obstruction.hardBlock) {
        state = DISPLACEMENT_DESTINATION_STATES.BLOCKED;
      } else if (obstruction.hardBlock) {
        // A partial destination may also be a nonhostile occupied endpoint.
        // Keep the visual/result state PARTIAL while softConflict independently
        // records that endpoint grace is required.
        state = DISPLACEMENT_DESTINATION_STATES.PARTIAL;
      } else if (obstruction.endpointConflicts.length) {
        state = DISPLACEMENT_DESTINATION_STATES.SOFT_CONFLICT;
      }

      // If the final legal step is nonhostile-occupied, grace expiry should
      // return to the most recent *clear* position in this displacement, not
      // simply the previous grid step (which may itself have been occupied
      // during allowed nonhostile transit).
      let graceRollbackPosition = obstruction.lastLegalPosition;
      if (obstruction.endpointConflicts.length) {
        const occupiedLegalSteps = new Set(
          obstruction.conflicts
            .map((entry) => Number(entry?.step))
            .filter((step) => Number.isFinite(step))
        );
        graceRollbackPosition = obstruction.origin;
        for (const position of obstruction.legalPositions.slice(0, -1)) {
          if (!occupiedLegalSteps.has(Number(position.step))) {
            graceRollbackPosition = position;
          }
        }
      }

      return {
        key: direction.key,
        direction: duplicateSafely(direction),
        state,
        selectable: obstruction.completedSteps > 0,
        partial: Boolean(obstruction.hardBlock && obstruction.completedSteps > 0),
        softConflict: obstruction.endpointConflicts.length > 0,
        requestedDistance: finiteNumber(distance, obstruction.requestedDistance),
        actualDistance: obstruction.actualDistance,
        requestedDestination: duplicateSafely(steps.positions.at(-1)),
        destination: duplicateSafely(obstruction.lastLegalPosition),
        graceRollbackPosition: duplicateSafely(graceRollbackPosition),
        path: duplicateSafely(obstruction.legalPositions),
        obstruction: duplicateSafely(obstruction.hardBlock),
        conflicts: duplicateSafely(obstruction.conflicts),
        endpointConflicts: duplicateSafely(obstruction.endpointConflicts),
        allowedNonhostileUuids: duplicateSafely(obstruction.allowedNonhostileUuids)
      };
    });

    return {
      sceneId: scene.id,
      sourceUuid: sourceToken.uuid,
      targetUuid: targetToken.uuid,
      type,
      directionConstraint,
      requestedDistance: finiteNumber(distance, 0),
      reference: {
        sourceCenter: duplicateSafely(directionPlan.sourceCenter),
        targetCenter: duplicateSafely(directionPlan.targetCenter),
        awayVector: duplicateSafely(directionPlan.awayVector),
        semanticVector: duplicateSafely(directionPlan.semanticVector)
      },
      candidates
    };
  }
}
