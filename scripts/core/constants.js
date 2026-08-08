export const MODULE_ID = "action-effects-5e";
export const MODULE_TITLE = "Action Effects 5E";
export const MODULE_VERSION = "0.2.6";

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

export const HOOKS = Object.freeze({
  READY: `${MODULE_ID}.ready`,
  PRE_MOVEMENT_TRANSACTION: `${MODULE_ID}.preMovementTransaction`,
  MOVEMENT_TRANSACTION: `${MODULE_ID}.movementTransaction`,
  RELATIONSHIP_CREATED: `${MODULE_ID}.relationshipCreated`,
  RELATIONSHIP_REMOVED: `${MODULE_ID}.relationshipRemoved`,
  RELATIONSHIPS_REINDEXED: `${MODULE_ID}.relationshipsReindexed`
});
