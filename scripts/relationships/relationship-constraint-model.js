import {
  RELATIONSHIP_CONSTRAINT_TYPES,
  RELATIONSHIP_COVER_PROVIDERS,
  RELATIONSHIP_COVER_THRESHOLDS,
  RELATIONSHIP_DISTANCE_PROVIDERS
} from "../core/constants.js";
import { duplicateSafely } from "../core/utils.js";

const VALID_COVER_PROVIDERS = new Set(Object.values(RELATIONSHIP_COVER_PROVIDERS));
const VALID_PARTICIPANTS = new Set(["leader", "follower"]);

function providerId(value, fallback, { knownOnly = false } = {}) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return fallback;
  if (knownOnly && !VALID_COVER_PROVIDERS.has(normalized)) {
    throw new Error(`Unsupported relationship cover provider '${normalized}'.`);
  }
  return normalized;
}

export function normalizeRelationshipConstraints(constraints = []) {
  if (constraints === null || constraints === undefined) return [];
  if (!Array.isArray(constraints)) throw new Error("Relationship constraints must be an array.");

  return constraints.map((source, index) => {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw new Error(`Relationship constraint ${index + 1} must be an object.`);
    }
    const type = source.type ?? source.kind;
    const common = {
      id: typeof source.id === "string" && source.id.trim() ? source.id.trim() : `constraint-${index + 1}`,
      type,
      evaluateRoute: source.evaluateRoute !== false,
      metadata: duplicateSafely(source.metadata ?? {})
    };

    if (type === RELATIONSHIP_CONSTRAINT_TYPES.MAXIMUM_DISTANCE) {
      const maximum = Number(source.maximum);
      if (!Number.isFinite(maximum) || maximum < 0) {
        throw new Error(`Relationship maximum-distance constraint '${common.id}' requires a non-negative maximum.`);
      }
      return Object.freeze({
        ...common,
        maximum,
        provider: providerId(source.provider, RELATIONSHIP_DISTANCE_PROVIDERS.CENTER_3D)
      });
    }

    if (type === RELATIONSHIP_CONSTRAINT_TYPES.COVER) {
      const threshold = source.threshold ?? RELATIONSHIP_COVER_THRESHOLDS.TOTAL;
      if (!Object.values(RELATIONSHIP_COVER_THRESHOLDS).includes(threshold)) {
        throw new Error(`Relationship cover constraint '${common.id}' has unsupported threshold '${threshold}'.`);
      }
      return Object.freeze({
        ...common,
        threshold,
        provider: providerId(source.provider, RELATIONSHIP_COVER_PROVIDERS.MIDI, { knownOnly: true })
      });
    }

    if (type === RELATIONSHIP_CONSTRAINT_TYPES.LINE_OF_SIGHT) {
      return Object.freeze({
        ...common,
        provider: RELATIONSHIP_COVER_PROVIDERS.FOUNDRY
      });
    }

    if (type === RELATIONSHIP_CONSTRAINT_TYPES.STATUS) {
      const participant = source.participant ?? "follower";
      if (!VALID_PARTICIPANTS.has(participant)) {
        throw new Error(`Relationship status constraint '${common.id}' has unsupported participant '${participant}'.`);
      }
      const statuses = Array.isArray(source.statuses)
        ? [...new Set(source.statuses.map(status => String(status).trim()).filter(Boolean))]
        : [];
      if (!statuses.length) {
        throw new Error(`Relationship status constraint '${common.id}' requires at least one status ID.`);
      }
      return Object.freeze({
        ...common,
        evaluateRoute: false,
        participant,
        statuses: Object.freeze(statuses)
      });
    }

    throw new Error(`Relationship constraint '${common.id}' has unsupported type '${type ?? "missing"}'.`);
  });
}
