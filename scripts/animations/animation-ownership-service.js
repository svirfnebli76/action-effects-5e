import {
  ANIMATION_AUTOMATED_ANIMATIONS_POLICIES,
  ANIMATION_FLAG_KEY,
  MODULE_ID
} from "../core/constants.js";

const MAX_ORIGIN_DEPTH = 8;

function normalizePolicy(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return Object.values(ANIMATION_AUTOMATED_ANIMATIONS_POLICIES).includes(normalized) ? normalized : null;
}

function collectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (collection instanceof Set) return Array.from(collection);
  if (typeof collection.values === "function") {
    try {
      return Array.from(collection.values());
    } catch {
      // Fall through to generic iteration below.
    }
  }
  try {
    return Array.from(collection);
  } catch {
    return [];
  }
}

function documentIdentity(document) {
  if (!document || typeof document !== "object") return null;
  return document.uuid ?? document.id ?? document._id ?? null;
}

function documentLabel(document) {
  if (!document || typeof document !== "object") return "Unknown";
  return document.name ?? document.label ?? document.uuid ?? document.id ?? document.constructor?.name ?? "Unknown";
}

function isItemDocument(document) {
  if (!document || typeof document !== "object") return false;
  return document.documentName === "Item" || document.constructor?.name === "Item";
}

function isActorDocument(document) {
  if (!document || typeof document !== "object") return false;
  return document.documentName === "Actor" || document.constructor?.name === "Actor";
}

function readFlagRoot(document) {
  if (!document || typeof document !== "object") return null;
  return document.flags?.[MODULE_ID] ?? document._source?.flags?.[MODULE_ID] ?? null;
}

function explicitPolicy(document) {
  const root = readFlagRoot(document);
  return normalizePolicy(root?.[ANIMATION_FLAG_KEY]?.automatedAnimations);
}

function normalizeStatus(value) {
  if (value == null) return null;
  const normalized = String(value).trim().toLowerCase();
  return normalized || null;
}

function statusIds(document) {
  const result = new Set();
  if (!document || typeof document !== "object") return result;

  for (const status of collectionValues(document.statuses ?? document._source?.statuses)) {
    const normalized = normalizeStatus(status?.id ?? status);
    if (normalized) result.add(normalized);
  }

  const coreStatus = normalizeStatus(document.flags?.core?.statusId ?? document._source?.flags?.core?.statusId);
  if (coreStatus) result.add(coreStatus);

  const dndStatus = normalizeStatus(document.flags?.dnd5e?.statusId ?? document._source?.flags?.dnd5e?.statusId);
  if (dndStatus) result.add(dndStatus);

  if (result.size === 0) {
    const label = normalizeStatus(document.name ?? document.label);
    const configuredStatuses = globalThis.CONFIG?.statusEffects;
    if (label && Array.isArray(configuredStatuses)) {
      for (const configured of configuredStatuses) {
        const configuredId = normalizeStatus(configured?.id);
        const configuredName = normalizeStatus(configured?.name ?? configured?.label);
        if (label === configuredId || label === configuredName) {
          if (configuredId) result.add(configuredId);
        }
      }
    }
  }

  return result;
}

function intersectStatuses(left, right) {
  if (!left?.size || !right?.size) return [];
  return Array.from(left).filter((status) => right.has(status));
}

function actorFor(document, context = {}) {
  if (isActorDocument(document?.parent)) return document.parent;
  if (document?.actor && isActorDocument(document.actor)) return document.actor;
  if (document?.parent?.actor && isActorDocument(document.parent.actor)) return document.parent.actor;
  if (context?.token?.actor && isActorDocument(context.token.actor)) return context.token.actor;
  if (context?.actor && isActorDocument(context.actor)) return context.actor;

  for (const target of collectionValues(context?.targets)) {
    if (target?.actor && isActorDocument(target.actor)) return target.actor;
    if (target?.document?.actor && isActorDocument(target.document.actor)) return target.document.actor;
  }

  // Automated Animations deep-clones the workflow data before firing its
  // workflow-start hook. If that clone no longer carries an embedded-document
  // parent, recover the live document by UUID so status ownership can still be
  // resolved against the Actor's real ActiveEffect collection.
  const uuid = document?.uuid;
  if (uuid && typeof globalThis.fromUuidSync === "function") {
    try {
      const original = globalThis.fromUuidSync(uuid);
      if (original && original !== document) return actorFor(original, {});
    } catch {
      // Ignore a stale/unresolvable UUID and continue without an Actor.
    }
  }

  return null;
}

async function actorForAsync(document, context = {}) {
  const synchronous = actorFor(document, context);
  if (synchronous) return synchronous;
  const uuid = document?.uuid;
  if (!uuid || typeof globalThis.fromUuid !== "function") return null;
  try {
    const original = await globalThis.fromUuid(uuid);
    return original && original !== document ? actorFor(original, {}) : null;
  } catch {
    return null;
  }
}

function itemParentFor(document) {
  if (!document || typeof document !== "object") return null;
  if (isItemDocument(document.item)) return document.item;
  if (isItemDocument(document.parent)) return document.parent;
  return null;
}

function originReference(document) {
  if (!document || typeof document !== "object") return null;
  return document.origin ?? document._source?.origin ?? null;
}

function resolveUuidSync(uuid) {
  if (!uuid || typeof uuid !== "string") return null;
  try {
    if (typeof globalThis.fromUuidSync === "function") return globalThis.fromUuidSync(uuid) ?? null;
  } catch {
    return null;
  }
  return null;
}

async function resolveUuid(uuid) {
  const synchronous = resolveUuidSync(uuid);
  if (synchronous) return synchronous;
  if (!uuid || typeof uuid !== "string") return null;
  try {
    if (typeof globalThis.fromUuid === "function") return await globalThis.fromUuid(uuid);
  } catch {
    return null;
  }
  return null;
}

function directDecision(document, relation = "explicit") {
  const policy = explicitPolicy(document);
  if (!policy) return null;
  return {
    policy,
    suppress: policy === ANIMATION_AUTOMATED_ANIMATIONS_POLICIES.SUPPRESS,
    relation,
    source: document,
    sourceUuid: documentIdentity(document),
    sourceLabel: documentLabel(document)
  };
}

export class AnimationOwnershipService {
  #stats = {
    resolutions: 0,
    suppressions: 0,
    directSuppressions: 0,
    originSuppressions: 0,
    statusSuppressions: 0,
    inheritedStamps: 0
  };

  getExplicitAutomatedAnimationsPolicy(document) {
    return explicitPolicy(document);
  }

  getStatusIds(document) {
    return Array.from(statusIds(document));
  }

  resolveAutomatedAnimationsPolicySync(subject, { context = null } = {}) {
    this.#stats.resolutions += 1;
    const data = this.#normalizeContext(subject, context);
    const candidates = this.#primaryCandidates(data);

    for (const candidate of candidates) {
      const decision = this.#resolveDocumentChainSync(candidate, new Set(), 0);
      if (decision) return this.#record(decision);
    }

    const statusDecision = this.#resolveStatusOwnerSync(data.item, data);
    if (statusDecision) return this.#record(statusDecision);

    return this.#none();
  }

  async resolveAutomatedAnimationsPolicy(subject, { context = null } = {}) {
    this.#stats.resolutions += 1;
    const data = this.#normalizeContext(subject, context);
    const candidates = this.#primaryCandidates(data);

    for (const candidate of candidates) {
      const decision = await this.#resolveDocumentChain(candidate, new Set(), 0);
      if (decision) return this.#record(decision);
    }

    const statusDecision = await this.#resolveStatusOwner(data.item, data);
    if (statusDecision) return this.#record(statusDecision);

    return this.#none();
  }

  shouldSuppressAutomatedAnimationsSync(subject, options = {}) {
    return this.resolveAutomatedAnimationsPolicySync(subject, options).suppress;
  }

  async shouldSuppressAutomatedAnimations(subject, options = {}) {
    const decision = await this.resolveAutomatedAnimationsPolicy(subject, options);
    return decision.suppress;
  }

  stampAutomatedAnimationsPolicy(targetData, policy) {
    if (!targetData || typeof targetData !== "object") return targetData;
    const normalized = normalizePolicy(policy);
    if (!normalized) return targetData;

    targetData.flags ??= {};
    targetData.flags[MODULE_ID] ??= {};
    targetData.flags[MODULE_ID][ANIMATION_FLAG_KEY] ??= {};
    targetData.flags[MODULE_ID][ANIMATION_FLAG_KEY].automatedAnimations = normalized;
    return targetData;
  }

  inheritAutomatedAnimationsPolicy(source, targetData) {
    const decision = this.resolveAutomatedAnimationsPolicySync(source);
    if (!decision.policy) return targetData;
    this.#stats.inheritedStamps += 1;
    return this.stampAutomatedAnimationsPolicy(targetData, decision.policy);
  }

  getStats() {
    return { ...this.#stats };
  }

  #normalizeContext(subject, context) {
    if (context && typeof context === "object") {
      return { ...context, item: context.item ?? subject };
    }

    const looksLikeAaData = subject && typeof subject === "object" && (
      Object.hasOwn(subject, "item") || Object.hasOwn(subject, "activity") || Object.hasOwn(subject, "activeEffect")
    );
    if (looksLikeAaData) return subject;
    return { item: subject };
  }

  #primaryCandidates(data) {
    const candidates = [];
    if (data?.activity) candidates.push(data.activity);
    if (data?.item && !candidates.includes(data.item)) candidates.push(data.item);
    return candidates;
  }

  #resolveDocumentChainSync(document, visited, depth) {
    if (!document || typeof document !== "object" || depth > MAX_ORIGIN_DEPTH) return null;
    const identity = documentIdentity(document) ?? document;
    if (visited.has(identity)) return null;
    visited.add(identity);

    const own = directDecision(document, depth === 0 ? "explicit" : "origin");
    if (own) return own;

    const parentItem = itemParentFor(document);
    if (parentItem && parentItem !== document) {
      const parent = this.#resolveDocumentChainSync(parentItem, visited, depth + 1);
      if (parent) return { ...parent, relation: depth === 0 ? "parent-item" : parent.relation };
    }

    const origin = originReference(document);
    if (origin && typeof origin === "object") {
      const originDecision = this.#resolveDocumentChainSync(origin, visited, depth + 1);
      if (originDecision) return { ...originDecision, relation: "origin" };
    } else if (typeof origin === "string") {
      const originDocument = resolveUuidSync(origin);
      if (originDocument) {
        const originDecision = this.#resolveDocumentChainSync(originDocument, visited, depth + 1);
        if (originDecision) return { ...originDecision, relation: "origin" };
      }
    }

    return null;
  }

  async #resolveDocumentChain(document, visited, depth) {
    if (!document || typeof document !== "object" || depth > MAX_ORIGIN_DEPTH) return null;
    const identity = documentIdentity(document) ?? document;
    if (visited.has(identity)) return null;
    visited.add(identity);

    const own = directDecision(document, depth === 0 ? "explicit" : "origin");
    if (own) return own;

    const parentItem = itemParentFor(document);
    if (parentItem && parentItem !== document) {
      const parent = await this.#resolveDocumentChain(parentItem, visited, depth + 1);
      if (parent) return { ...parent, relation: depth === 0 ? "parent-item" : parent.relation };
    }

    const origin = originReference(document);
    const originDocument = typeof origin === "object" ? origin : await resolveUuid(origin);
    if (originDocument) {
      const originDecision = await this.#resolveDocumentChain(originDocument, visited, depth + 1);
      if (originDecision) return { ...originDecision, relation: "origin" };
    }

    return null;
  }

  #resolveStatusOwnerSync(subject, context) {
    const subjectStatuses = statusIds(subject);
    if (!subjectStatuses.size) return null;
    const actor = actorFor(subject, context);
    if (!actor) return null;

    for (const effect of collectionValues(actor.effects)) {
      if (!effect || effect === subject) continue;
      const sameIdentity = documentIdentity(effect) && documentIdentity(effect) === documentIdentity(subject);
      if (sameIdentity) continue;
      const sharedStatuses = intersectStatuses(subjectStatuses, statusIds(effect));
      if (!sharedStatuses.length) continue;

      const owner = this.#resolveDocumentChainSync(effect, new Set(), 0);
      if (owner?.suppress) {
        return {
          ...owner,
          relation: "status-owner",
          inheritedByStatuses: sharedStatuses,
          statusSubjectUuid: documentIdentity(subject),
          statusSubjectLabel: documentLabel(subject)
        };
      }
    }
    return null;
  }

  async #resolveStatusOwner(subject, context) {
    const subjectStatuses = statusIds(subject);
    if (!subjectStatuses.size) return null;
    const actor = await actorForAsync(subject, context);
    if (!actor) return null;

    for (const effect of collectionValues(actor.effects)) {
      if (!effect || effect === subject) continue;
      const sameIdentity = documentIdentity(effect) && documentIdentity(effect) === documentIdentity(subject);
      if (sameIdentity) continue;
      const sharedStatuses = intersectStatuses(subjectStatuses, statusIds(effect));
      if (!sharedStatuses.length) continue;

      const owner = await this.#resolveDocumentChain(effect, new Set(), 0);
      if (owner?.suppress) {
        return {
          ...owner,
          relation: "status-owner",
          inheritedByStatuses: sharedStatuses,
          statusSubjectUuid: documentIdentity(subject),
          statusSubjectLabel: documentLabel(subject)
        };
      }
    }
    return null;
  }

  #record(decision) {
    if (!decision?.suppress) return decision;
    this.#stats.suppressions += 1;
    if (decision.relation === "status-owner") this.#stats.statusSuppressions += 1;
    else if (decision.relation === "origin" || decision.relation === "parent-item") this.#stats.originSuppressions += 1;
    else this.#stats.directSuppressions += 1;
    return decision;
  }

  #none() {
    return {
      policy: null,
      suppress: false,
      relation: null,
      source: null,
      sourceUuid: null,
      sourceLabel: null
    };
  }
}
