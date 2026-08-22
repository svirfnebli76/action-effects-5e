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

function stringOrNull(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function identityDescriptor(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const string = stringOrNull(value);
    if (!string) return null;
    return {
      reference: string,
      uuid: string.includes(".") ? string : null,
      id: string.includes(".") ? null : string,
      identifier: null
    };
  }
  if (typeof value !== "object") return null;

  const uuid = stringOrNull(value.uuid ?? value.document?.uuid);
  const id = stringOrNull(value.id ?? value._id ?? value.document?.id ?? value.document?._id);
  const identifier = stringOrNull(value.identifier ?? value.system?.identifier ?? value.document?.identifier ?? value.document?.system?.identifier);
  if (!uuid && !id && !identifier) return null;
  return { reference: null, uuid, id, identifier };
}

function identityMatches(expected, actual) {
  if (!expected || !actual) return false;

  if (expected.uuid && actual.uuid) return expected.uuid === actual.uuid;
  if (expected.reference && actual.uuid) return expected.reference === actual.uuid;
  if (expected.uuid && actual.reference) return expected.uuid === actual.reference;
  if (expected.reference && actual.reference) return expected.reference === actual.reference;

  if (expected.id && actual.id) return expected.id === actual.id;
  if (expected.identifier && actual.identifier) return expected.identifier === actual.identifier;
  return false;
}

function activityParentItem(activity) {
  if (!activity || typeof activity !== "object") return null;
  if (isItemDocument(activity.item)) return activity.item;
  if (isItemDocument(activity.parent)) return activity.parent;
  return activity.item ?? activity.parent ?? null;
}

function workflowActivity(data) {
  if (!data || typeof data !== "object") return null;
  return data.activity
    ?? data.workflow?.activity
    ?? data.midiWorkflow?.activity
    ?? data.activityUuid
    ?? data.activityUUID
    ?? null;
}

function workflowItem(data) {
  if (!data || typeof data !== "object") return null;
  const activity = workflowActivity(data);
  return data.item
    ?? data.workflow?.item
    ?? data.midiWorkflow?.item
    ?? activityParentItem(activity)
    ?? data.itemUuid
    ?? data.itemUUID
    ?? null;
}

export class AnimationOwnershipService {
  #transientClaims = new Map();
  #transientClaimSequence = 0;
  #stats = {
    resolutions: 0,
    suppressions: 0,
    directSuppressions: 0,
    originSuppressions: 0,
    statusSuppressions: 0,
    transientSuppressions: 0,
    inheritedStamps: 0,
    transientClaimsCreated: 0,
    transientClaimsReleased: 0
  };

  getExplicitAutomatedAnimationsPolicy(document) {
    return explicitPolicy(document);
  }

  getStatusIds(document) {
    return Array.from(statusIds(document));
  }

  claimAutomatedAnimationsSuppression({ item = null, activity = null, reason = null } = {}) {
    const resolvedItem = item ?? activityParentItem(activity);
    const itemIdentity = identityDescriptor(resolvedItem);
    const activityIdentity = identityDescriptor(activity);

    if (!itemIdentity && !activityIdentity) {
      throw new TypeError("Animation ownership transient suppression requires an Item or Activity with a stable UUID/ID.");
    }
    if (activity && !activityIdentity) {
      throw new TypeError("Animation ownership transient Activity suppression requires a stable Activity UUID/ID.");
    }
    if (resolvedItem && !itemIdentity) {
      throw new TypeError("Animation ownership transient Item suppression requires a stable Item UUID/ID.");
    }

    const id = `aa-claim-${Date.now().toString(36)}-${(++this.#transientClaimSequence).toString(36)}`;
    const claim = {
      id,
      policy: ANIMATION_AUTOMATED_ANIMATIONS_POLICIES.SUPPRESS,
      item: resolvedItem,
      activity,
      itemIdentity,
      activityIdentity,
      reason: stringOrNull(reason),
      createdAt: Date.now()
    };

    this.#transientClaims.set(id, claim);
    this.#stats.transientClaimsCreated += 1;

    return Object.freeze({
      id,
      policy: claim.policy,
      reason: claim.reason,
      itemUuid: itemIdentity?.uuid ?? null,
      itemId: itemIdentity?.id ?? null,
      activityUuid: activityIdentity?.uuid ?? null,
      activityId: activityIdentity?.id ?? null,
      release: () => this.releaseAutomatedAnimationsSuppression(id)
    });
  }

  releaseAutomatedAnimationsSuppression(claimOrId) {
    const id = typeof claimOrId === "string" ? claimOrId : claimOrId?.id;
    if (!id || !this.#transientClaims.delete(id)) return false;
    this.#stats.transientClaimsReleased += 1;
    return true;
  }

  async withAutomatedAnimationsSuppressed(scope, callback) {
    if (typeof callback !== "function") {
      throw new TypeError("withAutomatedAnimationsSuppressed requires a callback function.");
    }

    const claim = this.claimAutomatedAnimationsSuppression(scope);
    try {
      return await callback(claim);
    } finally {
      claim.release();
    }
  }

  getActiveAutomatedAnimationsSuppressions() {
    return Array.from(this.#transientClaims.values()).map((claim) => ({
      id: claim.id,
      policy: claim.policy,
      reason: claim.reason,
      itemUuid: claim.itemIdentity?.uuid ?? null,
      itemId: claim.itemIdentity?.id ?? null,
      activityUuid: claim.activityIdentity?.uuid ?? null,
      activityId: claim.activityIdentity?.id ?? null,
      createdAt: claim.createdAt
    }));
  }

  resolveAutomatedAnimationsPolicySync(subject, { context = null } = {}) {
    this.#stats.resolutions += 1;
    const data = this.#normalizeContext(subject, context);

    const transientDecision = this.#resolveTransientClaim(data);
    if (transientDecision) return this.#record(transientDecision);

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

    const transientDecision = this.#resolveTransientClaim(data);
    if (transientDecision) return this.#record(transientDecision);

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
    return {
      ...this.#stats,
      activeTransientClaims: this.#transientClaims.size
    };
  }

  #normalizeContext(subject, context) {
    const looksLikeDocument = subject && typeof subject === "object" && (
      Object.hasOwn(subject, "documentName")
      || Object.hasOwn(subject, "uuid")
      || Object.hasOwn(subject, "id")
      || Object.hasOwn(subject, "_id")
    );
    const looksLikeAaData = subject && typeof subject === "object" && (
      Object.hasOwn(subject, "item")
      || Object.hasOwn(subject, "activity")
      || Object.hasOwn(subject, "activeEffect")
      || Object.hasOwn(subject, "workflow")
      || (context && !looksLikeDocument)
    );

    const subjectData = looksLikeAaData ? subject : { item: subject };
    if (!context || typeof context !== "object") return subjectData;

    return {
      ...context,
      ...subjectData,
      item: subjectData.item ?? context.item ?? (!looksLikeAaData ? subject : null),
      activity: subjectData.activity ?? context.activity ?? null,
      workflow: subjectData.workflow ?? context.workflow ?? null,
      token: subjectData.token ?? context.token ?? null,
      actor: subjectData.actor ?? context.actor ?? null,
      targets: subjectData.targets ?? context.targets ?? null
    };
  }

  #primaryCandidates(data) {
    const candidates = [];
    const activity = workflowActivity(data);
    const item = workflowItem(data);
    if (activity && typeof activity === "object") candidates.push(activity);
    if (item && typeof item === "object" && !candidates.includes(item)) candidates.push(item);
    return candidates;
  }

  #resolveTransientClaim(data) {
    if (!this.#transientClaims.size) return null;

    const activity = workflowActivity(data);
    const item = workflowItem(data);
    const activityIdentity = identityDescriptor(activity);
    const itemIdentity = identityDescriptor(item);
    const claims = Array.from(this.#transientClaims.values()).reverse();

    for (const claim of claims) {
      if (claim.activityIdentity && !identityMatches(claim.activityIdentity, activityIdentity)) continue;
      if (claim.itemIdentity && !identityMatches(claim.itemIdentity, itemIdentity)) continue;

      const source = claim.activity ?? claim.item ?? null;
      return {
        policy: claim.policy,
        suppress: true,
        relation: "transient-workflow",
        source,
        sourceUuid: documentIdentity(source),
        sourceLabel: documentLabel(source),
        transient: true,
        claimId: claim.id,
        reason: claim.reason
      };
    }

    return null;
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
    if (decision.relation === "transient-workflow") this.#stats.transientSuppressions += 1;
    else if (decision.relation === "status-owner") this.#stats.statusSuppressions += 1;
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
