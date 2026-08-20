import {
  MODULE_ID,
  MOVEMENT_AGENCIES,
  OPERATION_METADATA_KEY,
  PATH_TYPES
} from "../core/constants.js";

export const VOLUNTARY_MOVEMENT_RESTRICTION_FLAG = "movement.voluntaryRestriction";
export const DEFAULT_VOLUNTARY_MOVEMENT_RESTRICTION_MESSAGE = "You cannot move.";

const NON_VOLUNTARY_AGENCIES = new Set([
  MOVEMENT_AGENCIES.COMPELLED,
  MOVEMENT_AGENCIES.FORCED,
  MOVEMENT_AGENCIES.PASSENGER,
  MOVEMENT_AGENCIES.ADMINISTRATIVE
]);

function asArray(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  try { return Array.from(collection); } catch { return []; }
}

function actorFromSubject(subject) {
  if (!subject) return null;
  if (subject.documentName === "Actor") return subject;
  if (subject.actor) return subject.actor;
  if (subject.document?.actor) return subject.document.actor;
  if (subject.object?.actor) return subject.object.actor;
  if (subject.effects) return subject;
  return null;
}

function rawRestriction(effect) {
  return effect?.flags?.[MODULE_ID]?.movement?.voluntaryRestriction;
}

function normalizeRestriction(effect) {
  const raw = rawRestriction(effect);
  if (raw === undefined || raw === null || raw === false) return null;

  let config = null;
  if (raw === true) config = {};
  else if (typeof raw === "string") config = { message: raw };
  else if (typeof raw === "object" && !Array.isArray(raw)) config = raw;
  else return null;

  if (config.enabled === false) return null;

  const message = String(config.message ?? "").trim()
    || DEFAULT_VOLUNTARY_MOVEMENT_RESTRICTION_MESSAGE;
  const priorityValue = Number(config.priority ?? 0);

  return Object.freeze({
    enabled: true,
    message,
    priority: Number.isFinite(priorityValue) ? priorityValue : 0,
    effectId: effect?.id ?? null,
    effectUuid: effect?.uuid ?? null,
    effectName: effect?.name ?? effect?.label ?? null
  });
}

function movementActionCandidates(movement, metadata = {}) {
  const candidates = [
    metadata?.movementMode,
    metadata?.nativeMovementAction,
    movement?.destination?.action,
    movement?.action
  ];

  const collections = [
    movement?.passed?.waypoints,
    movement?.pending?.waypoints,
    movement?.waypoints,
    movement?.history?.unrecorded?.waypoints,
    movement?.history?.path
  ];

  for (const collection of collections) {
    if (!Array.isArray(collection) || !collection.length) continue;
    candidates.push(collection.at(-1)?.action);
  }

  return [...new Set(candidates.filter(value => typeof value === "string" && value.length))];
}

function movementActionConfig(actionId) {
  const actions = globalThis.CONFIG?.Token?.movement?.actions;
  return actions?.get?.(actionId) ?? actions?.[actionId] ?? null;
}

function isTeleportMovement(movement, operation, metadata) {
  if (metadata?.teleport === true) return true;
  if (metadata?.pathType === PATH_TYPES.TELEPORT) return true;
  if (movement?.method === "teleport" || operation?.method === "teleport") return true;

  return movementActionCandidates(movement, metadata)
    .some(actionId => movementActionConfig(actionId)?.teleport === true);
}

function isRelationshipFollower(document, metadata) {
  if (!document?.uuid) return false;
  if (metadata?.relationshipRole === "follower" || metadata?.passenger === true) return true;
  if (metadata?.relationshipMovement !== true) return false;
  if (typeof metadata?.leaderUuid !== "string" || !metadata.leaderUuid.length) return false;
  return metadata.leaderUuid !== document.uuid;
}

export class VoluntaryMovementRestrictionPolicy {
  #stats = {
    evaluations: 0,
    restrictedSubjects: 0,
    blockedVoluntaryMovements: 0,
    allowedNonVoluntaryMovements: 0,
    lastDecision: null
  };

  getFlagPath() {
    return `flags.${MODULE_ID}.${VOLUNTARY_MOVEMENT_RESTRICTION_FLAG}`;
  }

  getStats() {
    return structuredCloneSafe(this.#stats);
  }

  resolve(subject) {
    const actor = actorFromSubject(subject);
    if (!actor) return null;

    const restrictions = asArray(actor.effects)
      .filter(effect => effect && effect.disabled !== true && effect.isSuppressed !== true && effect.active !== false)
      .map(effect => normalizeRestriction(effect))
      .filter(Boolean)
      .sort((a, b) => (b.priority - a.priority)
        || String(a.effectUuid ?? a.effectId ?? "").localeCompare(String(b.effectUuid ?? b.effectId ?? "")));

    return restrictions[0] ?? null;
  }

  classify({ document, movement, operation = {} } = {}) {
    const metadata = operation?.[OPERATION_METADATA_KEY] ?? {};
    const agency = metadata?.agency ?? MOVEMENT_AGENCIES.UNKNOWN;

    if (isTeleportMovement(movement, operation, metadata)) {
      return Object.freeze({ voluntary: false, allowed: true, reason: "teleport", agency });
    }

    if (metadata?.administrative === true || agency === MOVEMENT_AGENCIES.ADMINISTRATIVE) {
      return Object.freeze({ voluntary: false, allowed: true, reason: "administrative", agency });
    }

    if (isRelationshipFollower(document, metadata)) {
      return Object.freeze({ voluntary: false, allowed: true, reason: "relationship-follower", agency });
    }

    if (NON_VOLUNTARY_AGENCIES.has(agency)) {
      return Object.freeze({ voluntary: false, allowed: true, reason: `agency:${agency}`, agency });
    }

    // Explicit voluntary semantics and untagged/unknown ordinary movement are
    // both treated as voluntary. This is what makes native drag/keyboard walk
    // movement obey the Active Effect policy without requiring every caller to
    // know about AE5E.
    return Object.freeze({ voluntary: true, allowed: false, reason: `agency:${agency}`, agency });
  }

  evaluate({ document, movement, operation = {} } = {}) {
    this.#stats.evaluations += 1;

    const restriction = this.resolve(document);
    if (!restriction) {
      const result = Object.freeze({ blocked: false, restricted: false, reason: "unrestricted", restriction: null });
      this.#remember(result, document);
      return result;
    }

    this.#stats.restrictedSubjects += 1;
    const classification = this.classify({ document, movement, operation });

    if (!classification.voluntary) {
      this.#stats.allowedNonVoluntaryMovements += 1;
      const result = Object.freeze({
        blocked: false,
        restricted: true,
        reason: classification.reason,
        classification,
        restriction
      });
      this.#remember(result, document);
      return result;
    }

    this.#stats.blockedVoluntaryMovements += 1;
    const result = Object.freeze({
      blocked: true,
      restricted: true,
      reason: "voluntary-movement-restricted",
      classification,
      restriction,
      message: restriction.message
    });
    this.#remember(result, document);
    return result;
  }

  #remember(result, document) {
    this.#stats.lastDecision = {
      tokenUuid: document?.uuid ?? null,
      blocked: result.blocked === true,
      restricted: result.restricted === true,
      reason: result.reason ?? null,
      message: result.message ?? result.restriction?.message ?? null,
      effectUuid: result.restriction?.effectUuid ?? null
    };
  }
}

function structuredCloneSafe(value) {
  if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
