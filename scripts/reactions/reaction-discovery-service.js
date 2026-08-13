import {
  MODULE_ID,
  REACTION_FLAG_KEY,
  REACTION_FLAG_SCOPE
} from "../core/constants.js";
import { Logger } from "../core/logger.js";
import { randomId } from "../core/utils.js";

/** Discover Activity-registered reactions on tokens represented in the Scene. */
export class ReactionDiscoveryService {
  #registry;
  #authority;

  constructor({ registry, authority }) {
    this.#registry = registry;
    this.#authority = authority;
  }

  async discover(context, { scene = globalThis.canvas?.scene ?? null, tokenDocuments = null } = {}) {
    if (!context || !this.#registry.hasTrigger(context.trigger)) return [];
    const tokens = tokenDocuments ?? this.#sceneTokens(scene);
    const opportunities = [];

    for (const tokenDocument of tokens) {
      const opportunity = await this.discoverForToken(context, tokenDocument);
      if (opportunity?.offers?.length) opportunities.push(opportunity);
    }
    return opportunities;
  }

  async discoverForToken(context, tokenDocument) {
    const actor = tokenDocument?.actor ?? tokenDocument?.object?.actor ?? null;
    if (!actor) return null;

    const offers = [];

    // Foundry-only development harness support. These offers exist only in an
    // explicitly synthetic AE5E test context and never touch Actor/Item data.
    // This lets multiplayer and transaction tests exercise the real Broker,
    // socket, dialog, ordering, and authority paths without requiring a real
    // Counterspell implementation in v0.3.28.
    if (context?.data?.ae5eTest === true) {
      const specs = context.data.syntheticOffers?.[tokenDocument?.uuid] ?? [];
      for (const [index, spec] of specs.entries()) {
        const handler = this.#registry.get(spec?.handler);
        if (!handler || handler.trigger !== context.trigger) continue;
        let eligible = false;
        try {
          eligible = Boolean(await handler.eligibility({ context, actor, token: tokenDocument, item: null, activity: null, registration: spec }));
        } catch (error) {
          Logger.warn(`Synthetic reaction eligibility failed for '${spec?.handler}'.`, error);
        }
        if (!eligible) continue;
        offers.push({
          id: `${tokenDocument.uuid}:ae5e-test:${spec.handler}:${index}`,
          reactorActorUuid: actor.uuid ?? null,
          reactorTokenUuid: tokenDocument.uuid ?? null,
          activityUuid: null,
          activityId: null,
          itemUuid: null,
          handler: spec.handler,
          trigger: context.trigger,
          label: spec.label ?? handler.label ?? spec.handler,
          img: spec.img ?? actor.img ?? null,
          activity: null,
          item: null,
          actor,
          tokenDocument
        });
      }
    }

    for (const item of actor.items ?? []) {
      for (const activity of this.#activities(item)) {
        const registration = this.#registration(activity, item);
        if (!registration?.enabled || registration.trigger !== context.trigger || !registration.handler) continue;

        const handler = this.#registry.get(registration.handler);
        if (!handler || handler.trigger !== context.trigger) continue;

        let eligible = false;
        try {
          eligible = Boolean(await handler.eligibility({ context, actor, token: tokenDocument, item, activity, registration }));
        } catch (error) {
          Logger.warn(`Reaction eligibility failed for '${registration.handler}'.`, error);
          eligible = false;
        }
        if (!eligible) continue;

        offers.push(this.#offer({ context, actor, tokenDocument, item, activity, registration, handler }));
      }
    }

    if (!offers.length) return null;
    const controllerUserId = this.#controllerUserId(actor);
    if (!controllerUserId) return null;

    return {
      id: randomId(),
      reactorActorUuid: actor.uuid ?? null,
      reactorTokenUuid: tokenDocument.uuid ?? tokenDocument.document?.uuid ?? null,
      reactorName: tokenDocument.name ?? actor.name ?? "Reactor",
      controllerUserId,
      offers,
      actor,
      tokenDocument
    };
  }

  async revalidate(context, frozenOpportunity) {
    const token = await this.#resolveToken(frozenOpportunity?.reactorTokenUuid);
    if (!token) return null;
    return this.discoverForToken(context, token);
  }

  getActivityRegistration(activity, item = null) {
    return this.#registration(activity, item);
  }

  #offer({ actor, tokenDocument, item, activity, registration, handler }) {
    const activityUuid = activity?.uuid
      ?? (item?.uuid && activity?.id ? `${item.uuid}.Activity.${activity.id}` : null);
    return {
      id: `${activityUuid ?? item?.uuid ?? actor?.uuid ?? randomId()}:${registration.handler}`,
      reactorActorUuid: actor?.uuid ?? null,
      reactorTokenUuid: tokenDocument?.uuid ?? null,
      activityUuid,
      activityId: activity?.id ?? null,
      itemUuid: item?.uuid ?? null,
      handler: registration.handler,
      trigger: registration.trigger,
      label: registration.label ?? activity?.name ?? item?.name ?? handler.label ?? registration.handler,
      img: activity?.img ?? item?.img ?? actor?.img ?? null,
      // Local document references are intentionally omitted by transaction
      // serialization but let the source coordinator execute a handler without
      // doing a second UUID lookup.
      activity,
      item,
      actor,
      tokenDocument
    };
  }

  #registration(activity, item) {
    let value = null;
    try {
      value = activity?.getFlag?.(REACTION_FLAG_SCOPE, REACTION_FLAG_KEY) ?? null;
    } catch {
      // Activity-like DataModels may expose flags without Document#getFlag.
    }
    value ??= activity?.flags?.[REACTION_FLAG_SCOPE]?.[REACTION_FLAG_KEY] ?? null;

    // Compatibility fallback for worlds/system versions where Activity flags
    // are stored on the parent Item keyed by Activity ID.
    value ??= item?.flags?.[MODULE_ID]?.reactions?.[activity?.id] ?? null;

    if (!value || typeof value !== "object") return null;
    return {
      enabled: value.enabled !== false,
      trigger: typeof value.trigger === "string" ? value.trigger : null,
      handler: typeof value.handler === "string" ? value.handler : null,
      label: typeof value.label === "string" ? value.label : null
    };
  }

  #activities(item) {
    const activities = item?.system?.activities;
    if (!activities) return [];
    if (typeof activities.values === "function") return [...activities.values()];
    if (Array.isArray(activities)) return activities;
    if (typeof activities[Symbol.iterator] === "function") return [...activities];
    if (typeof activities === "object") return Object.values(activities);
    return [];
  }

  #controllerUserId(actor) {
    const activePlayers = [...(game?.users ?? [])]
      .filter(user => user?.active && !user?.isGM)
      .filter(user => {
        try {
          const owner = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
          return actor?.testUserPermission?.(user, owner) ?? false;
        } catch {
          return false;
        }
      });
    if (activePlayers.length) return activePlayers[0].id;
    return this.#authority.getPrimaryGm()?.id ?? null;
  }

  #sceneTokens(scene) {
    const collection = scene?.tokens;
    if (!collection) return [];
    if (typeof collection.values === "function") return [...collection.values()];
    return [...collection];
  }

  async #resolveToken(uuid) {
    if (!uuid) return null;
    const canvasToken = globalThis.canvas?.tokens?.placeables?.find(token => token?.document?.uuid === uuid);
    if (canvasToken?.document) return canvasToken.document;
    try {
      const resolved = await globalThis.fromUuid?.(uuid);
      return resolved?.document ?? resolved ?? null;
    } catch {
      return null;
    }
  }
}
