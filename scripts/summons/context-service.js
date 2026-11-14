import {
  HOOKS,
  MODULE_ID,
  SUMMON_CONTEXT_FLAG,
  SUMMON_CONTEXT_SCHEMA_VERSION
} from "../core/constants.js";
import { Logger } from "../core/logger.js";
import { duplicateSafely, randomId } from "../core/utils.js";

const positiveInteger = value => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};

const optionLevel = options => [
  options?.spellLevel,
  options?.slotLevel,
  options?.level,
  options?.scaling?.level,
  options?.config?.spell?.slotLevel
].map(positiveInteger).find(value => value !== null) ?? null;

const nativeTokenLevel = tokenData => positiveInteger(
  tokenData?.delta?.flags?.dnd5e?.summon?.level
    ?? tokenData?.actorData?.flags?.dnd5e?.summon?.level
);

export function resolveSummonCastLevel(activity, options = {}, tokenData = null) {
  const baseLevel = positiveInteger(activity?.item?.system?.level) ?? 0;
  const castLevel = nativeTokenLevel(tokenData)
    ?? positiveInteger(activity?.relevantLevel)
    ?? optionLevel(options)
    ?? baseLevel;
  return { baseLevel, castLevel };
}

function usageToken(activity) {
  try {
    return activity?.getUsageToken?.() ?? activity?.actor?.token ?? null;
  } catch {
    return activity?.actor?.token ?? null;
  }
}

function profileLabel(profile) {
  const value = profile?.name ?? profile?.label ?? profile?.identifier ?? null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function buildSummonContext({
  activity,
  profile,
  options = {},
  declaration,
  batchId,
  placementOrder,
  tokenData = null
}) {
  const token = usageToken(activity);
  const { baseLevel, castLevel } = resolveSummonCastLevel(activity, options, tokenData);
  return {
    version: SUMMON_CONTEXT_SCHEMA_VERSION,
    summonerActorUuid: activity?.actor?.uuid ?? activity?.item?.actor?.uuid ?? null,
    summonerTokenUuid: token?.document?.uuid ?? token?.uuid ?? null,
    sourceItemUuid: activity?.item?.uuid ?? null,
    sourceActivityUuid: activity?.uuid ?? null,
    declarationId: declaration?.id ?? null,
    castLevel,
    baseLevel,
    batchId,
    placementOrder,
    initiativeMode: declaration?.initiative?.mode ?? null,
    profileId: profile?._id ?? profile?.id ?? null,
    profileLabel: profileLabel(profile),
    createdByUserId: globalThis.game?.user?.id ?? null
  };
}

export function stampSummonContext(tokenData, context) {
  if (!tokenData || typeof tokenData !== "object") return tokenData;
  tokenData.flags ??= {};
  tokenData.flags[MODULE_ID] ??= {};
  tokenData.flags[MODULE_ID][SUMMON_CONTEXT_FLAG] = duplicateSafely(context);
  return tokenData;
}

export function getSummonContext(subject) {
  const document = subject?.document ?? subject;
  const context = document?.getFlag?.(MODULE_ID, SUMMON_CONTEXT_FLAG)
    ?? document?.flags?.[MODULE_ID]?.[SUMMON_CONTEXT_FLAG]
    ?? null;
  return context ? duplicateSafely(context) : null;
}

/**
 * Captures D&D5e Summon Activity data before token creation and forwards the
 * completed batch to the GM-authoritative initiative coordinator.
 */
export class SummonContextService {
  #declarations;
  #initiative;
  #initialized = false;
  #sessionsByOptions = new WeakMap();
  #sessionsByActivity = new WeakMap();
  #stats = {
    sessions: 0,
    tokensStamped: 0,
    batchesForwarded: 0,
    invalidDeclarations: 0
  };

  constructor({ declarations, initiative }) {
    this.#declarations = declarations;
    this.#initiative = initiative;
  }

  initialize() {
    if (this.#initialized) return;
    this.#initialized = true;
    Hooks.on("dnd5e.preSummon", (activity, profile, options) => {
      this.#begin(activity, profile, options);
    });
    Hooks.on("dnd5e.summonToken", (activity, profile, tokenData, options) => {
      this.#stamp(activity, profile, tokenData, options);
    });
    Hooks.on("dnd5e.postSummon", (activity, profile, tokens, options) => {
      this.#complete(activity, profile, tokens, options)
        .catch(error => Logger.warn("Summon context finalization failed.", error));
    });
  }

  getContext(subject) {
    return getSummonContext(subject);
  }

  getStats() {
    return { initialized: this.#initialized, ...this.#stats };
  }

  #begin(activity, profile, options) {
    const result = this.#declarations.read(activity?.item);
    if (!result.valid) {
      this.#stats.invalidDeclarations += 1;
      Logger.warn(`Summon declaration ignored for '${activity?.item?.name ?? "unknown Item"}': ${result.issues.join(" ")}`);
      return this.#remember(activity, options, { enabled: false });
    }
    if (!result.enabled) return this.#remember(activity, options, { enabled: false });
    const session = {
      enabled: true,
      activity,
      profile,
      options,
      declaration: result.declaration,
      batchId: randomId(),
      nextPlacementOrder: 0
    };
    this.#remember(activity, options, session);
    this.#stats.sessions += 1;
    return session;
  }

  #remember(activity, options, session) {
    if (options && typeof options === "object") this.#sessionsByOptions.set(options, session);
    if (activity && typeof activity === "object") this.#sessionsByActivity.set(activity, session);
    return session;
  }

  #session(activity, profile, options) {
    if (options && typeof options === "object") {
      const session = this.#sessionsByOptions.get(options);
      if (session) return session;
    }
    if (activity && typeof activity === "object") {
      const session = this.#sessionsByActivity.get(activity);
      if (session) return session;
    }
    return this.#begin(activity, profile, options);
  }

  #stamp(activity, profile, tokenData, options) {
    const session = this.#session(activity, profile, options);
    if (!session?.enabled) return;
    const context = buildSummonContext({
      activity,
      profile,
      options,
      declaration: session.declaration,
      batchId: session.batchId,
      placementOrder: session.nextPlacementOrder++,
      tokenData
    });
    stampSummonContext(tokenData, context);
    this.#stats.tokensStamped += 1;
  }

  async #complete(activity, profile, tokens, options) {
    const session = this.#session(activity, profile, options);
    if (options && typeof options === "object") this.#sessionsByOptions.delete(options);
    if (activity && typeof activity === "object") this.#sessionsByActivity.delete(activity);
    if (!session?.enabled || !Array.isArray(tokens) || !tokens.length) return;

    const entries = tokens.map((token, index) => {
      const existing = getSummonContext(token);
      const nativeLevel = positiveInteger(token?.actor?.flags?.dnd5e?.summon?.level)
        ?? positiveInteger(token?.actor?.getFlag?.("dnd5e", "summon")?.level);
      const context = existing ?? buildSummonContext({
        activity,
        profile,
        options,
        declaration: session.declaration,
        batchId: session.batchId,
        placementOrder: index
      });
      if (nativeLevel !== null) context.castLevel = nativeLevel;
      return { tokenUuid: token?.document?.uuid ?? token?.uuid ?? null, context };
    }).filter(entry => entry.tokenUuid);

    if (!entries.length) return;
    await this.#initiative.attachSummons(entries);
    this.#stats.batchesForwarded += 1;
    Hooks.callAll(HOOKS.SUMMON_CONTEXT_CREATED, {
      batchId: session.batchId,
      sourceActivityUuid: activity?.uuid ?? null,
      tokenUuids: entries.map(entry => entry.tokenUuid)
    });
  }
}
