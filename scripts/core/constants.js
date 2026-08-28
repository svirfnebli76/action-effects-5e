export const MODULE_ID = "action-effects-5e";
export const MODULE_TITLE = "Action Effects 5E";
export const MODULE_VERSION = "0.4.1.21";

export const REQUIRED_MODULES = Object.freeze([
  "midi-qol",
  "dae",
  "socketlib",
  "lib-wrapper"
]);

export const COMPATIBILITY_MODULES = Object.freeze({
  CPR: "chris-premades",
  GPS: "gambits-premades",
  CAT: "cat"
});

export const ANIMATION_FLAG_KEY = "animation";
export const ANIMATION_AUTOMATED_ANIMATIONS_POLICIES = Object.freeze({
  SUPPRESS: "suppress"
});
export const AUTOMATED_ANIMATIONS_MODULE_ID = "autoanimations";
export const AUTOMATED_ANIMATIONS_WORKFLOW_START_HOOK = "AutomatedAnimations-WorkflowStart";

export const SETTINGS = Object.freeze({
  MOVEMENT_ENABLED: "movementEnabled",
  DEBUG_LOGGING: "debugLogging",
  CAPTURE_DIAGNOSTICS: "captureMovementDiagnostics",
  OVERLAP_POLICY: "overlapPolicy",
  REACTION_AUTHORITY_LEDGER: "reactionAuthorityLedger"
});

export const OVERLAP_POLICIES = Object.freeze({
  AUTO_SAFE: "auto-safe",
  PREFER_AE5E: "prefer-ae5e",
  PREFER_EXTERNAL: "prefer-external",
  MANUAL: "manual"
});

export const OPERATION_METADATA_KEY = "actionEffects5e";
export const SCENE_RELATIONSHIPS_FLAG = "relationships";
export const RELATIONSHIP_GRANT_FLAG = "relationshipGrant";
export const RELATIONSHIP_LIFECYCLE_SCHEMA_VERSION = 1;
export const MAX_RECENT_TRANSACTIONS = 50;

// Selection indicators are semantic: the color communicates why a user is
// currently being asked to make a choice. AE5E-owned waits explicitly choose
// ORIGINATOR or RESPONDER. Recognized third-party prompts use EXTERNAL.
export const SELECTION_INDICATOR_ROLES = Object.freeze({
  ORIGINATOR: "originator",
  RESPONDER: "responder",
  EXTERNAL: "external"
});

export const SELECTION_INDICATOR_ROLE_PRIORITY = Object.freeze({
  [SELECTION_INDICATOR_ROLES.ORIGINATOR]: 300,
  [SELECTION_INDICATOR_ROLES.RESPONDER]: 200,
  [SELECTION_INDICATOR_ROLES.EXTERNAL]: 100
});

// Use Eskie's physical WebM directly rather than its Sequencer database key.
// The database entry carries loop-marker metadata which intentionally holds on
// the final frame; the raw WebM itself loops seamlessly when persisted.
export const SELECTION_INDICATOR_PREFERRED_ASSET = "modules/eskie-effects/assets/UI/Ability_Check/D20/01/UI_Ability_Check_D20_01_Roll_Default_White.webm";
export const SELECTION_INDICATOR_FALLBACK_ASSET = "icons/vtt-512.png";

// Originator preserves the live-tested green presentation. Responder and
// External colors are intentionally centralized so they can be tuned without
// changing workflow code. Originator and responder prompts share the established
// private notification cue; external prompts remain silent until explicitly assigned.
export const SELECTION_INDICATOR_PRESENTATIONS = Object.freeze({
  [SELECTION_INDICATOR_ROLES.ORIGINATOR]: Object.freeze({
    tint: "#18cc46",
    soundAsset: "modules/action-effects-5e/assets/audio/ui/notification01.ogg",
    soundVolume: 1
  }),
  [SELECTION_INDICATOR_ROLES.RESPONDER]: Object.freeze({
    tint: "#ff9f1c",
    soundAsset: "modules/action-effects-5e/assets/audio/ui/notification01.ogg",
    soundVolume: 1
  }),
  [SELECTION_INDICATOR_ROLES.EXTERNAL]: Object.freeze({
    tint: "#2f9bff",
    soundAsset: null,
    soundVolume: 1
  })
});

// Backward-compatible aliases for the original v0.3.27 originator profile.
export const SELECTION_INDICATOR_PREFERRED_TINT = SELECTION_INDICATOR_PRESENTATIONS[SELECTION_INDICATOR_ROLES.ORIGINATOR].tint;
export const SELECTION_INDICATOR_SOUND_ASSET = SELECTION_INDICATOR_PRESENTATIONS[SELECTION_INDICATOR_ROLES.ORIGINATOR].soundAsset;
export const SELECTION_INDICATOR_SOUND_VOLUME = SELECTION_INDICATOR_PRESENTATIONS[SELECTION_INDICATOR_ROLES.ORIGINATOR].soundVolume;

// Asset-specific scaleToObject values. The Eskie d20 has substantial transparent
// padding in its source canvas, so its effect canvas must be larger than the
// desired visible die. The Foundry fallback icon has little/no equivalent
// padding and therefore stays close to the desired visible 28% footprint.
export const SELECTION_INDICATOR_PREFERRED_SCALE = 0.68;
export const SELECTION_INDICATOR_FALLBACK_SCALE = 0.28;
// Center-to-corner placement uses 0.5. Live validation showed the marker
// should sit one tenth of a token footprint inward from the top/right edges.
export const SELECTION_INDICATOR_CORNER_OFFSET_FACTOR = 0.40;
// Compatibility alias for the primary/preferred indicator scale.
export const SELECTION_INDICATOR_SCALE = SELECTION_INDICATOR_PREFERRED_SCALE;
export const SELECTION_INDICATOR_EFFECT_NAME = `${MODULE_ID}.selection-indicator`;




export const REGION_AUTHORITY_FLAG = "authorityRegion";

export const ONGOING_ACTION_EFFECT_FLAG = "ongoingAction";
export const ONGOING_ACTION_ITEM_FLAG = "ongoingActionGrant";
export const ONGOING_ACTION_PROMPT_TIMEOUT_MS = 10_000;
export const ONGOING_ACTION_TIMINGS = Object.freeze({
  TURN_START: "turnStart",
  TURN_END: "turnEnd"
});

export const SME_PHASES = Object.freeze({
  PRE_TARGETING: "preTargeting",
  TARGETING_COMPLETE: "targetingComplete",
  SAVES_COMPLETE: "savesComplete",
  BEFORE_DAMAGE_ROLL: "beforeDamageRoll",
  DAMAGE_ROLL_COMPLETE: "damageRollComplete",
  BEFORE_DAMAGE_APPLICATION: "beforeDamageApplication",
  WORKFLOW_COMPLETE: "workflowComplete"
});

export const SME_MODIFIER_MODES = Object.freeze({
  AUTOMATIC: "automatic",
  OPTIONAL: "optional"
});

export const SME_SESSION_STATES = Object.freeze({
  ACTIVE: "active",
  ABORTED: "aborted",
  COMPLETE: "complete",
  ROLLED_BACK: "rolledBack"
});

export const SME_FLAG_SCOPE = MODULE_ID;
export const SME_FLAG_KEY = "spellModifier";
export const SME_MAX_RECENT_SESSIONS = 50;
export const SME_WORKFLOW_STATE_PATH = "sme.actionEffects5e";

export const REACTION_TRIGGERS = Object.freeze({
  SPELL_CAST: "spellCast"
});

export const REACTION_TRANSACTION_STATES = Object.freeze({
  CREATED: "created",
  DISCOVERING: "discovering",
  WAITING: "waiting",
  ACTIVE: "active",
  RESOLVING: "resolving",
  WAITING_FOR_AUTHORITY: "waitingForAuthority",
  MANUAL: "manual",
  RESUME_SOURCE: "resumeSource",
  ABORT_SOURCE: "abortSource",
  COMPLETE: "complete"
});

export const REACTION_RESPONSES = Object.freeze({
  SELECTED: "selected",
  DECLINED: "declined",
  MANUAL: "manual",
  // Internal transport/recovery state only. This is never a player decision
  // and is never sent to the GM authority validator as a reaction response.
  INTERRUPTED: "interrupted"
});

export const REACTION_SOURCE_RESULTS = Object.freeze({
  RESUME: "resume",
  ABORT: "abort"
});

export const REACTION_FLAG_SCOPE = MODULE_ID;
export const REACTION_FLAG_KEY = "reaction";
export const REACTION_AUTHORITY_POLL_MS = 1000;
export const REACTION_AUTHORITY_GRACE_MS = 1500;
export const REACTION_MAX_RECENT_TRANSACTIONS = 50;
export const REACTION_TEST_HANDLER_PREFIX = `${MODULE_ID}.test.`;

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

// Hidden Foundry movement actions used only to express native accounting semantics.
// The no-cost action remains measured so distance/geometry/Regions still receive
// an ordinary traversed path while TokenDocument.movementHistory records cost 0.
export const MOVEMENT_ACTION_IDS = Object.freeze({
  NO_COST: `${MODULE_ID}.no-cost`
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

export const RELATIONSHIP_PARTICIPANTS = Object.freeze({
  LEADER: "leader",
  FOLLOWER: "follower"
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

export const RELATIONSHIP_MOVEMENT_COST_POLICIES = Object.freeze({
  NONE: "none",
  GRAPPLE: "grapple"
});

export const RELATIONSHIP_LINK_OBSTRUCTION_POLICIES = Object.freeze({
  NONE: "none",
  GRAPPLE: "grapple"
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
  RELATIONSHIPS_REINDEXED: `${MODULE_ID}.relationshipsReindexed`,
  REACTION_EVENT: `${MODULE_ID}.reactionEvent`,
  REACTION_TRANSACTION_CREATED: `${MODULE_ID}.reactionTransactionCreated`,
  REACTION_TRANSACTION_UPDATED: `${MODULE_ID}.reactionTransactionUpdated`,
  REACTION_TRANSACTION_COMPLETE: `${MODULE_ID}.reactionTransactionComplete`,
  REACTION_AUTHORITY_CHANGED: `${MODULE_ID}.reactionAuthorityChanged`,
  SPELL_MODIFIER_PHASE: `${MODULE_ID}.spellModifierPhase`,
  SPELL_MODIFIER_SESSION_CREATED: `${MODULE_ID}.spellModifierSessionCreated`,
  SPELL_MODIFIER_APPLIED: `${MODULE_ID}.spellModifierApplied`,
  SPELL_MODIFIER_SESSION_COMPLETE: `${MODULE_ID}.spellModifierSessionComplete`
});
