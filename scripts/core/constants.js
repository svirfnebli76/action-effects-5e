export const MODULE_ID = "action-effects-5e";
export const MODULE_TITLE = "Action Effects 5E";
export const MODULE_VERSION = "0.3.25";

export const REQUIRED_MODULES = Object.freeze([
  "midi-qol",
  "dae",
  "socketlib",
  "lib-wrapper"
]);

export const COMPATIBILITY_MODULES = Object.freeze({
  CPR: "chris-premades",
  GPS: "gambits-premades"
});

export const SETTINGS = Object.freeze({
  MOVEMENT_ENABLED: "movementEnabled",
  DEBUG_LOGGING: "debugLogging",
  CAPTURE_DIAGNOSTICS: "captureMovementDiagnostics",
  OVERLAP_POLICY: "overlapPolicy"
});

export const OVERLAP_POLICIES = Object.freeze({
  AUTO_SAFE: "auto-safe",
  PREFER_AE5E: "prefer-ae5e",
  PREFER_EXTERNAL: "prefer-external",
  MANUAL: "manual"
});

export const OPERATION_METADATA_KEY = "actionEffects5e";
export const SCENE_RELATIONSHIPS_FLAG = "relationships";
export const MAX_RECENT_TRANSACTIONS = 50;

export const MOVEMENT_PHASES = Object.freeze({
  BEFORE: "before",
  AFTER: "after"
});

export const SUBJECT_TYPES = Object.freeze({
  TOKEN: "token",
  REGION: "region",
  GROUP: "group"
});

export const PATH_TYPES = Object.freeze({
  TRAVERSE: "traverse",
  TELEPORT: "teleport",
  FALL: "fall",
  REPOSITION: "reposition"
});

export const MOVEMENT_AGENCIES = Object.freeze({
  VOLUNTARY: "voluntary",
  COMPELLED: "compelled",
  FORCED: "forced",
  PASSENGER: "passenger",
  ADMINISTRATIVE: "administrative",
  UNKNOWN: "unknown"
});

export const MOVEMENT_RESOURCES = Object.freeze({
  MOVEMENT: "movement",
  ACTION: "action",
  BONUS_ACTION: "bonusAction",
  REACTION: "reaction",
  NONE: "none",
  UNKNOWN: "unknown"
});

export const DISPLACEMENT_TYPES = Object.freeze({
  PUSH: "push",
  PULL: "pull"
});

export const DISPLACEMENT_DIRECTION_CONSTRAINTS = Object.freeze({
  AWAY: "away",
  STRAIGHT_AWAY: "straight-away",
  STRAIGHT_TOWARD: "straight-toward"
});

export const DISPLACEMENT_DESTINATION_STATES = Object.freeze({
  CLEAR: "clear",
  SOFT_CONFLICT: "soft-conflict",
  PARTIAL: "partial",
  BLOCKED: "blocked"
});

export const MOVEMENT_GEOMETRY_CHANNELS = Object.freeze({
  DISPLACED_BODY: "displaced-body"
});

export const NONHOSTILE_ENDPOINT_GRACE_MS = 3_500;

export const RELATIONSHIP_TYPES = Object.freeze({
  GRAPPLE: "grapple",
  MOUNT: "mount",
  PASSENGER: "passenger",
  CARRIED: "carried",
  TETHER: "tether",
  ATTACHED_EFFECT: "attachedEffect",
  TEST: "test"
});

export const ATTACHMENT_MODES = Object.freeze({
  RIGID_OFFSET: "rigidOffset",
  ADJACENT_FOLLOWER: "adjacentFollower",
  GRAPPLE_FOLLOWER: "grappleFollower",
  PASSENGER: "passenger",
  ANCHORED_FOLLOWER: "anchoredFollower"
});

export const TELEPORT_POLICIES = Object.freeze({
  DETACH: "detach",
  FOLLOW: "follow",
  BLOCK: "block"
});

export const COLLISION_POLICIES = Object.freeze({
  STOP_GROUP: "stopGroup",
  DETACH: "detach"
});

export const RELATIONSHIP_COORDINATION_POLICIES = Object.freeze({
  COORDINATED: "coordinated",
  POST_SYNC: "postSync"
});

export const RELATIONSHIP_FORCED_LEADER_MOVEMENT_POLICIES = Object.freeze({
  FOLLOW: "follow",
  INDEPENDENT: "independent"
});

export const RELATIONSHIP_ROTATION_POLICIES = Object.freeze({
  NONE: "none",
  ORBIT_FOLLOWER: "orbitFollower"
});

export const RELATIONSHIP_GEOMETRY_CHANNELS = Object.freeze({
  FOLLOWER_BODY: "follower-body",
  GRAPPLE_LINK: "grapple-link"
});

export const RELATIVE_TOKEN_RELATIONSHIPS = Object.freeze({
  HOSTILE: "hostile",
  NONHOSTILE: "nonhostile"
});

export const RELATIONSHIP_NONHOSTILE_ENDPOINT_POLICIES = Object.freeze({
  ALLOW: "allow",
  GRACE: "grace"
});
export const RELATIONSHIP_NONHOSTILE_ENDPOINT_GRACE_MS = NONHOSTILE_ENDPOINT_GRACE_MS;

// Backward-compatible aliases retained for persisted v0.3.21-v0.3.23
// relationships and integrations which still use the former allied naming.
export const RELATIONSHIP_ALLIED_ENDPOINT_POLICIES = RELATIONSHIP_NONHOSTILE_ENDPOINT_POLICIES;
export const RELATIONSHIP_ALLIED_ENDPOINT_GRACE_MS = RELATIONSHIP_NONHOSTILE_ENDPOINT_GRACE_MS;

// Retained for compatibility with integrations which imported the old v0.3.22
// constant. v0.3.23+ no longer uses a fixed angular quantum for orbit control.
export const RELATIONSHIP_ORBIT_QUANTUM_DEGREES = 45;

export const HOOKS = Object.freeze({
  READY: `${MODULE_ID}.ready`,
  PRE_MOVEMENT_TRANSACTION: `${MODULE_ID}.preMovementTransaction`,
  MOVEMENT_TRANSACTION: `${MODULE_ID}.movementTransaction`,
  DISPLACEMENT_RESOLVED: `${MODULE_ID}.displacementResolved`,
  RELATIONSHIP_CREATED: `${MODULE_ID}.relationshipCreated`,
  RELATIONSHIP_UPDATED: `${MODULE_ID}.relationshipUpdated`,
  RELATIONSHIP_REMOVED: `${MODULE_ID}.relationshipRemoved`,
  RELATIONSHIPS_REINDEXED: `${MODULE_ID}.relationshipsReindexed`
});
