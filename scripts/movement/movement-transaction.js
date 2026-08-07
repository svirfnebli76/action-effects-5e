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

function inferPathType(movement, operation, metadata) {
  if (metadata.pathType) return metadata.pathType;
  if (operation?.teleport === true || metadata.teleport === true) return PATH_TYPES.TELEPORT;

  const method = String(movement?.method ?? "").toLowerCase();
  if (method.includes("teleport")) return PATH_TYPES.TELEPORT;
  if (method.includes("fall")) return PATH_TYPES.FALL;
  if (isTeleportAction(movement?.destination?.action) || isTeleportAction(movement?.action)) return PATH_TYPES.TELEPORT;
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
    Object.freeze(this.metadata);
    Object.freeze(this.path);
    Object.freeze(this);
  }

  static fromTokenHook({
    document,
    movement,
    operation = {},
    phase,
    user = game.user
  }) {
    const metadata = getOperationMetadata(operation);
    const movementId = movement?.id ?? metadata.transactionId ?? randomId();
    const transactionId = metadata.transactionId ?? `${MODULE_ID}-${movementId}`;

    return new MovementTransaction({
      id: transactionId,
      movementId,
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
      movementMode: metadata.movementMode ?? movement?.destination?.action ?? movement?.action ?? null,
      sourceUuid: metadata.sourceUuid ?? null,
      initiatorUuid: metadata.initiatorUuid ?? null,
      leaderUuid: metadata.leaderUuid ?? null,
      relationshipId: metadata.relationshipId ?? null,
      relationshipIds: duplicateSafely(metadata.relationshipIds ?? []),
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
      sourceUuid: null,
      initiatorUuid: null,
      leaderUuid: null,
      relationshipId: null,
      relationshipIds: [],
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
