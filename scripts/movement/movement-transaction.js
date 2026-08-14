import {
  MODULE_ID,
  MOVEMENT_AGENCIES,
  MOVEMENT_RESOURCES,
  OPERATION_METADATA_KEY,
  PATH_TYPES,
  SUBJECT_TYPES
} from "../core/constants.js";
import { duplicateSafely, nowIso, randomId } from "../core/utils.js";

function getOperationMetadata(operation = {}) {
  const metadata = operation?.[OPERATION_METADATA_KEY];
  return metadata && typeof metadata === "object" ? metadata : {};
}

function isTeleportAction(action) {
  if (!action) return false;
  const actions = globalThis.CONFIG?.Token?.movement?.actions;
  const config = actions?.get?.(action) ?? actions?.[action];
  return config?.teleport === true;
}


function movementActionCandidates(movement) {
  return [
    movement?.destination?.action,
    movement?.action,
    ...(Array.isArray(movement?.passed?.waypoints) ? movement.passed.waypoints.map((point) => point?.action) : []),
    ...(Array.isArray(movement?.pending?.waypoints) ? movement.pending.waypoints.map((point) => point?.action) : []),
    ...(Array.isArray(movement?.waypoints) ? movement.waypoints.map((point) => point?.action) : []),
    ...(Array.isArray(movement?.history?.unrecorded?.waypoints) ? movement.history.unrecorded.waypoints.map((point) => point?.action) : []),
    ...(Array.isArray(movement?.history?.recorded?.waypoints) ? movement.history.recorded.waypoints.map((point) => point?.action) : []),
    ...(Array.isArray(movement?.history?.path) ? movement.history.path.map((point) => point?.action) : [])
  ].filter(Boolean);
}

function movementUsesTeleportAction(movement) {
  return movementActionCandidates(movement).some((action) => isTeleportAction(action));
}

function inferMovementMode(movement, metadata) {
  if (metadata.movementMode) return metadata.movementMode;
  const candidates = movementActionCandidates(movement);
  return candidates.length ? candidates.at(-1) : null;
}

function operationHasOwnTeleportFlag(operation) {
  if (!operation || typeof operation !== "object") return false;
  // Foundry v14 exposes DatabaseUpdateOperation#teleport as a deprecated prototype
  // accessor. Reading operation.teleport emits a compatibility warning and that
  // accessor is scheduled for removal in Foundry v15. Only honor an explicit own
  // data property supplied by an external caller; normal Foundry movement is
  // classified from moveToken movement data and the movement action instead.
  const descriptor = Object.getOwnPropertyDescriptor(operation, "teleport");
  return descriptor?.value === true;
}

function inferPathType(movement, operation, metadata) {
  if (metadata.pathType) return metadata.pathType;
  if (operationHasOwnTeleportFlag(operation) || metadata.teleport === true) return PATH_TYPES.TELEPORT;

  const method = String(movement?.method ?? "").toLowerCase();
  if (method.includes("teleport")) return PATH_TYPES.TELEPORT;
  if (method.includes("fall")) return PATH_TYPES.FALL;
  if (movementUsesTeleportAction(movement)) return PATH_TYPES.TELEPORT;
  if (metadata.administrative === true) return PATH_TYPES.REPOSITION;
  return PATH_TYPES.TRAVERSE;
}

function inferAgency(metadata, subjectUuid) {
  if (metadata.relationshipMovement === true && metadata.leaderUuid && subjectUuid !== metadata.leaderUuid) {
    return MOVEMENT_AGENCIES.PASSENGER;
  }
  if (metadata.agency) return metadata.agency;
  if (metadata.administrative === true) return MOVEMENT_AGENCIES.ADMINISTRATIVE;
  return MOVEMENT_AGENCIES.UNKNOWN;
}

function inferResource(metadata, subjectUuid) {
  if (metadata.relationshipMovement === true && metadata.leaderUuid && subjectUuid !== metadata.leaderUuid) {
    return MOVEMENT_RESOURCES.NONE;
  }
  return metadata.resource ?? MOVEMENT_RESOURCES.UNKNOWN;
}

function inferSubpathId(movement) {
  const candidates = [
    movement?.subpathId,
    movement?.origin?.subpathId,
    movement?.destination?.subpathId,
    ...(Array.isArray(movement?.passed?.waypoints) ? movement.passed.waypoints.map((point) => point?.subpathId) : []),
    ...(Array.isArray(movement?.pending?.waypoints) ? movement.pending.waypoints.map((point) => point?.subpathId) : []),
    ...(Array.isArray(movement?.history?.unrecorded?.waypoints) ? movement.history.unrecorded.waypoints.map((point) => point?.subpathId) : []),
    ...(Array.isArray(movement?.history?.recorded?.waypoints) ? movement.history.recorded.waypoints.map((point) => point?.subpathId) : [])
  ];
  return candidates.find((value) => typeof value === "string" && value.length) ?? null;
}

function extractWaypoints(movement) {
  const passed = Array.isArray(movement?.passed?.waypoints) ? movement.passed.waypoints : [];
  const pending = Array.isArray(movement?.pending?.waypoints) ? movement.pending.waypoints : [];
  if (passed.length || pending.length) {
    const combined = [...passed, ...pending];
    return duplicateSafely(combined.filter((point, index) => {
      if (!index) return true;
      const previous = combined[index - 1];
      return point?.x !== previous?.x
        || point?.y !== previous?.y
        || point?.elevation !== previous?.elevation;
    }));
  }

  const candidates = [
    movement?.waypoints,
    movement?.history?.unrecorded?.waypoints,
    movement?.history?.recorded?.waypoints,
    movement?.history?.path
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length) return duplicateSafely(candidate);
  }

  const points = [];
  if (movement?.origin) points.push(duplicateSafely(movement.origin));
  if (movement?.destination) points.push(duplicateSafely(movement.destination));
  return points;
}

export class MovementTransaction {
  constructor(data) {
    Object.assign(this, data);
    if (this.origin && typeof this.origin === "object") Object.freeze(this.origin);
    if (this.destination && typeof this.destination === "object") Object.freeze(this.destination);
    if (Array.isArray(this.relationshipIds)) Object.freeze(this.relationshipIds);
    if (this.nativeMovement && typeof this.nativeMovement === "object") Object.freeze(this.nativeMovement);
    Object.freeze(this.metadata);
    Object.freeze(this.path);
    Object.freeze(this);
  }

  static fromTokenHook({
    document,
    movement,
    operation = {},
    phase,
    user = game.user,
    accounting = null
  }) {
    const metadata = getOperationMetadata(operation);
    const movementId = movement?.id ?? metadata.transactionId ?? randomId();
    const transactionId = metadata.transactionId ?? `${MODULE_ID}-${movementId}`;
    const nativeMovement = accounting?.getHistorySummary?.(document, movement) ?? null;

    return new MovementTransaction({
      id: transactionId,
      movementId,
      subpathId: inferSubpathId(movement),
      phase,
      subjectType: SUBJECT_TYPES.TOKEN,
      subjectUuid: document.uuid,
      sceneId: document.parent?.id ?? null,
      tokenId: document.id,
      actorUuid: document.actor?.uuid ?? null,
      origin: duplicateSafely(movement?.origin ?? {
        x: document.x,
        y: document.y,
        elevation: document.elevation
      }),
      destination: duplicateSafely(movement?.destination ?? {
        x: document.x,
        y: document.y,
        elevation: document.elevation
      }),
      path: extractWaypoints(movement),
      pathType: inferPathType(movement, operation, metadata),
      agency: inferAgency(metadata, document.uuid),
      resource: inferResource(metadata, document.uuid),
      movementMode: inferMovementMode(movement, metadata),
      nativeMovement: nativeMovement ? duplicateSafely(nativeMovement) : null,
      movementCostConsumed: phase === "after" ? nativeMovement?.movementCost ?? null : null,
      sourceUuid: metadata.sourceUuid ?? null,
      initiatorUuid: metadata.initiatorUuid ?? null,
      leaderUuid: metadata.leaderUuid ?? null,
      relationshipId: metadata.relationshipId ?? null,
      relationshipIds: duplicateSafely(metadata.relationshipIds ?? []),
      displacementId: metadata.displacementId ?? null,
      displacementType: metadata.displacementType ?? null,
      directionConstraint: metadata.directionConstraint ?? null,
      displacementDirection: metadata.displacementDirection ?? null,
      requestedDistance: metadata.requestedDistance ?? null,
      actualDistance: metadata.actualDistance ?? null,
      requestingUserId: metadata.requestingUserId ?? null,
      generatedBy: metadata.generatedBy ?? null,
      internal: metadata.internal === true,
      suppressAutomation: metadata.suppressAutomation === true,
      method: movement?.method ?? null,
      constrained: movement?.constrained ?? null,
      userId: user?.id ?? operation?.userId ?? null,
      createdAt: nowIso(),
      metadata: duplicateSafely(metadata) ?? {}
    });
  }

  static synthetic({
    subjectUuid = "Synthetic.Token",
    sceneId = "synthetic-scene",
    tokenId = "synthetic-token",
    phase = "after",
    origin = { x: 0, y: 0, elevation: 0 },
    destination = { x: 100, y: 0, elevation: 0 },
    pathType = PATH_TYPES.TRAVERSE,
    agency = MOVEMENT_AGENCIES.VOLUNTARY,
    resource = MOVEMENT_RESOURCES.MOVEMENT,
    metadata = {}
  } = {}) {
    return new MovementTransaction({
      id: `${MODULE_ID}-synthetic-${randomId()}`,
      movementId: `synthetic-${randomId()}`,
      subpathId: null,
      phase,
      subjectType: SUBJECT_TYPES.TOKEN,
      subjectUuid,
      sceneId,
      tokenId,
      actorUuid: null,
      origin: duplicateSafely(origin),
      destination: duplicateSafely(destination),
      path: Object.freeze([duplicateSafely(origin), duplicateSafely(destination)]),
      pathType,
      agency,
      resource,
      movementMode: "walk",
      nativeMovement: null,
      movementCostConsumed: null,
      sourceUuid: null,
      initiatorUuid: null,
      leaderUuid: null,
      relationshipId: null,
      relationshipIds: [],
      displacementId: null,
      displacementType: null,
      directionConstraint: null,
      displacementDirection: null,
      requestedDistance: null,
      actualDistance: null,
      requestingUserId: null,
      generatedBy: MODULE_ID,
      internal: false,
      suppressAutomation: false,
      method: "synthetic",
      constrained: false,
      userId: game?.user?.id ?? null,
      createdAt: nowIso(),
      metadata: duplicateSafely(metadata) ?? {}
    });
  }

  toJSON() {
    return {
      ...this,
      path: duplicateSafely(this.path),
      metadata: duplicateSafely(this.metadata)
    };
  }
}
