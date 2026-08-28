import {
  DISPLACEMENT_DESTINATION_STATES,
  DISPLACEMENT_DIRECTION_CONSTRAINTS,
  MOVEMENT_GEOMETRY_CHANNELS
} from "../core/constants.js";
import { duplicateSafely } from "../core/utils.js";

const MAX_ROUTE_VARIANTS_PER_ENDPOINT = 256;

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positionKey(position) {
  return `${Math.round(finiteNumber(position?.x, 0) * 1000) / 1000}:${Math.round(finiteNumber(position?.y, 0) * 1000) / 1000}`;
}

function relativeEndpointKey({ origin, destination, gridSize }) {
  const dx = Math.round((finiteNumber(destination?.x, 0) - finiteNumber(origin?.x, 0)) / gridSize);
  const dy = Math.round((finiteNumber(destination?.y, 0) - finiteNumber(origin?.y, 0)) / gridSize);
  return { key: `away:${dx}:${dy}`, dx, dy };
}

function repeatedDirectionKey(directionKeys = []) {
  if (!directionKeys.length) return null;
  return directionKeys.every((key) => key === directionKeys[0]) ? directionKeys[0] : null;
}

function routeLexicalKey(directionKeys = []) {
  return directionKeys.join(">");
}

export class DisplacementPlanner {
  #directions;
  #obstructions;

  constructor({ directions, obstructions }) {
    this.#directions = directions;
    this.#obstructions = obstructions;
  }

  buildCandidates({
    scene,
    sourceToken,
    targetToken,
    type,
    directionConstraint,
    distance,
    tokenCollisionPolicy = "relationship",
    ignoredTokenUuids = []
  }) {
    const directionPlan = this.#directions.getAllowedSquareDirections({
      scene,
      sourceToken,
      targetToken,
      type,
      directionConstraint
    });

    const candidates = directionConstraint === DISPLACEMENT_DIRECTION_CONSTRAINTS.AWAY
      ? this.#buildAwayCandidates({ scene, targetToken, directionPlan, distance, tokenCollisionPolicy, ignoredTokenUuids })
      : directionPlan.directions.map((direction) => {
        const steps = this.#directions.buildStepPositions({
          scene,
          targetToken,
          distance,
          direction
        });
        return this.#evaluateRoute({
          scene,
          targetToken,
          route: steps,
          maximumDistance: finiteNumber(distance, steps.requestedDistance),
          key: direction.key,
          direction,
          tokenCollisionPolicy,
          ignoredTokenUuids
        });
      });

    return {
      sceneId: scene.id,
      sourceUuid: sourceToken.uuid,
      targetUuid: targetToken.uuid,
      type,
      directionConstraint,
      requestedDistance: finiteNumber(distance, 0),
      maximumDistance: finiteNumber(distance, 0),
      reference: {
        sourceCenter: duplicateSafely(directionPlan.sourceCenter),
        targetCenter: duplicateSafely(directionPlan.targetCenter),
        awayVector: duplicateSafely(directionPlan.awayVector),
        semanticVector: duplicateSafely(directionPlan.semanticVector),
        allowedDirectionKeys: directionPlan.directions.map((direction) => direction.key)
      },
      candidates
    };
  }

  #buildAwayCandidates({ scene, targetToken, directionPlan, distance, tokenCollisionPolicy, ignoredTokenUuids }) {
    const metrics = this.#directions.getStepMetrics({ scene, distance });
    const allowedDirections = directionPlan.directions.map((direction) => ({ ...direction }));
    if (!allowedDirections.length) return [];

    // Build every endpoint reachable in 1..N steps while keeping the original
    // Source->Target AWAY fan fixed. For a given endpoint, retain only paths of
    // the minimum number of steps needed to reach it. This prevents artificial
    // loops from turning a nearby endpoint into a longer-distance shove choice.
    const endpointGroups = new Map();
    let frontier = [{ offsetX: 0, offsetY: 0, directionKeys: [] }];

    for (let step = 1; step <= metrics.steps; step += 1) {
      const nextByEndpoint = new Map();

      for (const route of frontier) {
        for (const direction of allowedDirections) {
          const next = {
            offsetX: route.offsetX + direction.dx,
            offsetY: route.offsetY + direction.dy,
            directionKeys: [...route.directionKeys, direction.key]
          };
          const key = `${next.offsetX}:${next.offsetY}`;
          const bucket = nextByEndpoint.get(key) ?? [];
          if (bucket.length < MAX_ROUTE_VARIANTS_PER_ENDPOINT) bucket.push(next);
          nextByEndpoint.set(key, bucket);
        }
      }

      for (const [key, routes] of nextByEndpoint.entries()) {
        if (!endpointGroups.has(key)) {
          endpointGroups.set(key, {
            minimumSteps: step,
            routes: routes.map((route) => [...route.directionKeys]),
            offsetX: routes[0]?.offsetX ?? 0,
            offsetY: routes[0]?.offsetY ?? 0
          });
        }
      }

      frontier = [...nextByEndpoint.values()].flat();
    }

    const candidates = [];
    for (const group of endpointGroups.values()) {
      const evaluations = group.routes.map((directionKeys) => {
        const route = this.#directions.buildPathPositions({ scene, targetToken, directionKeys });
        const relative = relativeEndpointKey({
          origin: route.origin,
          destination: route.positions.at(-1),
          gridSize: route.gridSize
        });
        return this.#evaluateRoute({
          scene,
          targetToken,
          route,
          maximumDistance: metrics.requestedDistance,
          key: group.minimumSteps === 1 ? directionKeys[0] : relative.key,
          direction: repeatedDirectionKey(directionKeys)
            ? allowedDirections.find((entry) => entry.key === repeatedDirectionKey(directionKeys)) ?? null
            : null,
          tokenCollisionPolicy,
          ignoredTokenUuids
        });
      });

      evaluations.sort((a, b) => this.#compareRouteEvaluations(a, b));
      const chosen = evaluations[0];
      if (!chosen) continue;

      chosen.routeAlternatives = evaluations.map((entry) => ({
        pathKey: entry.pathKey,
        directionPath: duplicateSafely(entry.directionPath),
        state: entry.state,
        selectable: entry.selectable,
        partial: entry.partial,
        requestedDistance: entry.requestedDistance,
        actualDistance: entry.actualDistance,
        requestedDestination: duplicateSafely(entry.requestedDestination),
        destination: duplicateSafely(entry.destination),
        obstruction: duplicateSafely(entry.obstruction)
      }));
      chosen.routeAlternativeCount = evaluations.length;
      candidates.push(chosen);
    }

    // A longer requested endpoint can truncate to a physical endpoint which is
    // already offered as an intentional shorter AWAY choice. Keep the shorter,
    // fully-reachable choice in the selector and discard the redundant partial
    // handle. STRAIGHT_* planning keeps its established partial-stop behavior.
    const byPhysicalDestination = new Map();
    for (const candidate of candidates) {
      const dedupePosition = candidate.selectable ? candidate.destination : candidate.requestedDestination;
      const key = positionKey(dedupePosition);
      const incumbent = byPhysicalDestination.get(key);
      if (!incumbent) {
        byPhysicalDestination.set(key, candidate);
        continue;
      }

      const incumbentFull = incumbent.partial !== true && incumbent.selectable === true;
      const candidateFull = candidate.partial !== true && candidate.selectable === true;
      if (candidateFull && !incumbentFull) {
        byPhysicalDestination.set(key, candidate);
        continue;
      }
      if (candidateFull === incumbentFull && candidate.requestedDistance < incumbent.requestedDistance) {
        byPhysicalDestination.set(key, candidate);
      }
    }

    return [...byPhysicalDestination.values()].sort((a, b) => {
      if (a.requestedDistance !== b.requestedDistance) return a.requestedDistance - b.requestedDistance;
      const ay = finiteNumber(a.requestedDestination?.y, 0);
      const by = finiteNumber(b.requestedDestination?.y, 0);
      if (ay !== by) return ay - by;
      return finiteNumber(a.requestedDestination?.x, 0) - finiteNumber(b.requestedDestination?.x, 0);
    });
  }

  #compareRouteEvaluations(a, b) {
    const aFull = a.selectable === true && a.partial !== true;
    const bFull = b.selectable === true && b.partial !== true;
    if (aFull !== bFull) return aFull ? -1 : 1;
    if (a.actualDistance !== b.actualDistance) return b.actualDistance - a.actualDistance;

    const aEndpointConflicts = a.endpointConflicts?.length ?? 0;
    const bEndpointConflicts = b.endpointConflicts?.length ?? 0;
    if (aEndpointConflicts !== bEndpointConflicts) return aEndpointConflicts - bEndpointConflicts;

    const aConflicts = a.conflicts?.length ?? 0;
    const bConflicts = b.conflicts?.length ?? 0;
    if (aConflicts !== bConflicts) return aConflicts - bConflicts;

    return String(a.pathKey ?? "").localeCompare(String(b.pathKey ?? ""));
  }

  #evaluateRoute({
    scene,
    targetToken,
    route,
    maximumDistance,
    key,
    direction = null,
    tokenCollisionPolicy = "relationship",
    ignoredTokenUuids = []
  }) {
    const obstruction = this.#obstructions.evaluateDiscreteBodyPath({
      scene,
      subjectToken: targetToken,
      positions: route.positions,
      gridDistance: route.gridDistance,
      geometryChannel: MOVEMENT_GEOMETRY_CHANNELS.DISPLACED_BODY,
      tokenCollisionPolicy,
      ignoredTokenUuids
    });

    let state = DISPLACEMENT_DESTINATION_STATES.CLEAR;
    if (obstruction.completedSteps === 0 && obstruction.hardBlock) {
      state = DISPLACEMENT_DESTINATION_STATES.BLOCKED;
    } else if (obstruction.hardBlock) {
      state = DISPLACEMENT_DESTINATION_STATES.PARTIAL;
    } else if (obstruction.endpointConflicts.length) {
      state = DISPLACEMENT_DESTINATION_STATES.SOFT_CONFLICT;
    }

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

    const directionPath = route.directionKeys ?? route.directions?.map((entry) => entry.key) ?? [];
    const singleDirectionKey = repeatedDirectionKey(directionPath);

    return {
      key,
      directionKey: singleDirectionKey,
      direction: duplicateSafely(direction ?? (singleDirectionKey ? { key: singleDirectionKey } : null)),
      directionPath: duplicateSafely(directionPath),
      pathKey: routeLexicalKey(directionPath),
      state,
      selectable: obstruction.completedSteps > 0,
      partial: Boolean(obstruction.hardBlock && obstruction.completedSteps > 0),
      softConflict: obstruction.endpointConflicts.length > 0,
      maximumDistance: finiteNumber(maximumDistance, obstruction.requestedDistance),
      requestedDistance: obstruction.requestedDistance,
      actualDistance: obstruction.actualDistance,
      requestedDestination: duplicateSafely(route.positions.at(-1)),
      destination: duplicateSafely(obstruction.lastLegalPosition),
      graceRollbackPosition: duplicateSafely(graceRollbackPosition),
      path: duplicateSafely(obstruction.legalPositions),
      obstruction: duplicateSafely(obstruction.hardBlock),
      conflicts: duplicateSafely(obstruction.conflicts),
      endpointConflicts: duplicateSafely(obstruction.endpointConflicts),
      allowedNonhostileUuids: duplicateSafely(obstruction.allowedNonhostileUuids),
      routeAlternatives: [],
      routeAlternativeCount: 1
    };
  }
}
