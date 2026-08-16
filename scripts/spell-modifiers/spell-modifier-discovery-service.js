import {
  MODULE_ID,
  SME_FLAG_KEY,
  SME_FLAG_SCOPE,
  SME_MODIFIER_MODES
} from "../core/constants.js";
import { Logger } from "../core/logger.js";
import { duplicateSafely } from "../core/utils.js";

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function sourceUuid(source) {
  return source?.uuid ?? source?.document?.uuid ?? null;
}

function sourceName(source) {
  return source?.name ?? source?.document?.name ?? "Spell Modifier";
}

function sourceImg(source, actor) {
  return source?.img ?? actor?.img ?? null;
}

/** Discover modifier declarations attached to the caster Actor/Items/Effects. */
export class SpellModifierDiscoveryService {
  #registry;

  constructor({ registry }) {
    this.#registry = registry;
  }

  async discover(context, session, { syntheticRegistrations = [] } = {}) {
    if (!context?.facts?.isSpell) return [];
    const actor = context.actor;
    if (!actor) return [];

    const declarations = [
      ...this.#sourceDeclarations(actor, actor),
      ...[...(actor.items ?? [])].flatMap(item => this.#sourceDeclarations(item, actor)),
      ...[...(actor.effects ?? [])]
        .filter(effect => effect?.disabled !== true && effect?.isSuppressed !== true)
        .flatMap(effect => this.#sourceDeclarations(effect, actor)),
      ...asArray(syntheticRegistrations).map((registration, index) => ({
        source: actor,
        actor,
        registration: { ...registration, __syntheticIndex: index }
      }))
    ];

    const offers = [];
    for (const declaration of declarations) {
      const built = await this.#offersForDeclaration(context, session, declaration);
      offers.push(...built);
    }

    return offers.sort((a, b) => (
      (Number(b.priority) - Number(a.priority))
      || String(a.label).localeCompare(String(b.label))
      || String(a.id).localeCompare(String(b.id))
    ));
  }

  getRegistration(source) {
    return this.#readRegistrations(source);
  }

  async #offersForDeclaration(context, session, { source, actor, registration }) {
    if (!registration || registration.enabled === false) return [];
    const modifierId = typeof registration.handler === "string" ? registration.handler : null;
    if (!modifierId) return [];
    const handler = this.#registry.get(modifierId);
    if (!handler) return [];
    if (!handler.phases.includes(context.phase)) return [];
    if (registration.phases != null && !asArray(registration.phases).map(String).includes(context.phase)) return [];

    const missingCapability = handler.requiresCapabilities.find(capability => context.capabilities?.[capability] !== true);
    if (missingCapability) return [];

    const baseKey = `${sourceUuid(source) ?? actor?.uuid ?? "actor"}:${modifierId}`;
    const oncePerCast = registration.oncePerCast !== undefined
      ? registration.oncePerCast !== false
      : handler.oncePerCast;
    if (oncePerCast && session?.hasApplied(baseKey)) return [];

    const conflictGroup = this.#stringOrNull(registration.conflictGroup) ?? handler.conflictGroup;
    if (conflictGroup && session?.hasConflictGroup(conflictGroup)) return [];

    let eligible = false;
    try {
      const result = await handler.eligibility({
        context,
        session,
        actor,
        source,
        registration,
        handler
      });
      eligible = typeof result === "object" ? result?.eligible !== false : Boolean(result);
    } catch (error) {
      Logger.warn(`SME eligibility failed for '${modifierId}'.`, error);
      return [];
    }
    if (!eligible) return [];

    let options = null;
    if (handler.options) {
      try {
        options = await handler.options({
          context,
          session,
          actor,
          source,
          registration,
          handler
        });
      } catch (error) {
        Logger.warn(`SME options failed for '${modifierId}'.`, error);
        return [];
      }
    }

    const normalizedOptions = Array.isArray(options) && options.length
      ? options
      : [{ id: "default", label: registration.label ?? handler.label, data: null }];

    const sourceId = sourceUuid(source) ?? actor?.uuid ?? "actor";
    const implicitSelectionGroup = normalizedOptions.length > 1 && !handler.allowMultipleOptions
      ? `${sourceId}:${modifierId}`
      : null;

    return normalizedOptions.map((option, index) => {
      const optionId = String(option?.id ?? index);
      const key = `${sourceId}:${modifierId}`;
      const mode = Object.values(SME_MODIFIER_MODES).includes(registration.mode)
        ? registration.mode
        : handler.mode;
      return {
        id: `${sourceId}:${modifierId}:${optionId}`,
        key,
        modifierId,
        handler,
        source,
        actor,
        registration,
        optionId,
        optionData: option?.data ?? null,
        label: option?.label ?? registration.label ?? handler.label,
        description: option?.description ?? registration.description ?? null,
        img: option?.img ?? registration.img ?? sourceImg(source, actor),
        mode,
        priority: Number.isFinite(Number(registration.priority)) ? Number(registration.priority) : handler.priority,
        conflictGroup: this.#stringOrNull(option?.conflictGroup) ?? conflictGroup,
        selectionGroup: this.#stringOrNull(option?.selectionGroup) ?? implicitSelectionGroup,
        oncePerCast
      };
    });
  }

  #sourceDeclarations(source, actor) {
    return this.#readRegistrations(source).map(registration => ({ source, actor, registration }));
  }

  #readRegistrations(source) {
    let raw = null;
    try { raw = source?.getFlag?.(SME_FLAG_SCOPE, SME_FLAG_KEY) ?? null; } catch { /* DataModel-like source */ }
    raw ??= source?.flags?.[SME_FLAG_SCOPE]?.[SME_FLAG_KEY] ?? null;
    raw ??= source?.flags?.[MODULE_ID]?.spellModifiers ?? null;
    if (!raw) return [];

    const clone = value => duplicateSafely(value);
    if (Array.isArray(raw)) return raw.filter(value => value && typeof value === "object").map(clone);
    if (typeof raw !== "object") return [];
    if (typeof raw.handler === "string") return [clone(raw)];

    // Also support a keyed object for modules which prefer one flag object with
    // multiple modifier declarations. Clone declarations so handler code cannot
    // accidentally mutate a live document's flag object in memory.
    return Object.values(raw)
      .filter(value => value && typeof value === "object" && typeof value.handler === "string")
      .map(clone);
  }

  #stringOrNull(value) {
    return typeof value === "string" && value.length ? value : null;
  }
}
