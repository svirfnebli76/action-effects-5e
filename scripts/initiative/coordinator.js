import {
  HOOKS,
  INITIATIVE_LINK_FLAG,
  INITIATIVE_LINK_SCHEMA_VERSION,
  MODULE_ID,
  SUMMON_CONTEXT_FLAG,
  SUMMON_CONTEXT_SCHEMA_VERSION,
  SUMMON_INITIATIVE_MODES
} from "../core/constants.js";
import { Logger } from "../core/logger.js";

const SOCKET_ATTACH = "initiative.attachSummons";
const SOCKET_RECONCILE = "initiative.reconcile";
const UPDATE_OPTION = "ae5eInitiativeCoordinator";

const combatantsOf = combat => {
  const collection = combat?.combatants;
  if (!collection) return [];
  if (typeof collection.values === "function") return [...collection.values()];
  return Array.isArray(collection) ? [...collection] : [...collection];
};

const sceneIdOf = combat => combat?.scene?.id ?? combat?.scene?.uuid?.split(".").at(-1)
  ?? combat?.sceneId ?? combat?._source?.scene ?? null;

const contextOf = token => token?.getFlag?.(MODULE_ID, SUMMON_CONTEXT_FLAG)
  ?? token?.flags?.[MODULE_ID]?.[SUMMON_CONTEXT_FLAG]
  ?? null;

const linkOf = combatant => combatant?.getFlag?.(MODULE_ID, INITIATIVE_LINK_FLAG)
  ?? combatant?.flags?.[MODULE_ID]?.[INITIATIVE_LINK_FLAG]
  ?? null;

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

/**
 * GM-authoritative coordinator for exact-tie follower initiative.
 *
 * Numeric initiatives remain identical. A narrow comparator wrapper turns the
 * persisted leader links into contiguous, deterministic turn blocks.
 */
export class InitiativeCoordinator {
  #socket;
  #authority;
  #ordering;
  #declarations;
  #initialized = false;
  #queues = new Map();
  #pendingReconciles = new Map();
  #stats = {
    batchesAttached: 0,
    combatantsCreated: 0,
    combatantsLinked: 0,
    reconciliations: 0,
    initiativeRepairs: 0,
    comparatorCalls: 0
  };

  constructor({ socket, authority, ordering, declarations }) {
    this.#socket = socket;
    this.#authority = authority;
    this.#ordering = ordering;
    this.#declarations = declarations;
    socket.register(SOCKET_ATTACH, this.#attachSocket.bind(this));
    socket.register(SOCKET_RECONCILE, this.#reconcileSocket.bind(this));
  }

  initialize() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#registerComparator();
    Hooks.on("createCombatant", (combatant, options) => {
      if (options?.[UPDATE_OPTION] || !this.#isAuthority()) return;
      this.#scheduleReconcile(combatant?.combat);
      this.#schedulePendingForLeader(combatant);
    });
    Hooks.on("updateCombatant", (combatant, changes, options) => {
      if (options?.[UPDATE_OPTION] || !this.#isAuthority()) return;
      if (Object.hasOwn(changes ?? {}, "initiative")
        || Object.hasOwn(changes ?? {}, "group")
        || Object.keys(changes ?? {}).some(key => key.startsWith(`flags.${MODULE_ID}`))) {
        this.#scheduleReconcile(combatant?.combat);
      }
    });
    Hooks.on("deleteCombatant", (combatant, options) => {
      if (options?.[UPDATE_OPTION] || !this.#isAuthority()) return;
      this.#scheduleReconcile(combatant?.combat);
    });
    this.#authority.onChange(() => {
      if (this.#isAuthority()) this.#scanPendingCombats();
    });
    if (this.#isAuthority()) this.#scanPendingCombats();
  }

  async attachSummons(entries) {
    const normalized = (entries ?? []).filter(entry => entry?.tokenUuid && entry?.context);
    if (!normalized.length) return { attached: false, reason: "no-tokens" };
    const primary = this.#authority.getPrimaryGm();
    if (!primary) {
      Logger.warn("Summon initiative is pending because no AE5E GM authority is available.");
      return { attached: false, reason: "no-gm" };
    }
    return this.#socket.executeAsUser(SOCKET_ATTACH, primary.id, { entries: normalized });
  }

  async requestReconcile(combat) {
    const uuid = typeof combat === "string" ? combat : combat?.uuid;
    if (!uuid) throw new Error("A Combat document or UUID is required.");
    const primary = this.#authority.getPrimaryGm();
    if (!primary) return { reconciled: false, reason: "no-gm" };
    return this.#socket.executeAsUser(SOCKET_RECONCILE, primary.id, { combatUuid: uuid });
  }

  inspect(combat) {
    return this.#ordering.inspect(combat);
  }

  getStatus() {
    return {
      initialized: this.#initialized,
      authorityUserId: this.#authority.getPrimaryGm()?.id ?? null,
      localIsAuthority: this.#isAuthority(),
      queuedCombats: [...this.#queues.keys()],
      ...this.#stats
    };
  }

  #registerComparator() {
    const service = this;
    const target = "CONFIG.Combat.documentClass.prototype._sortCombatants";
    if (!globalThis.libWrapper?.register) {
      Logger.error("Exact summon initiative ordering is unavailable because libWrapper is not ready.");
      globalThis.ui?.notifications?.error?.("AE5E | Exact summon initiative ordering could not start.");
      return;
    }
    globalThis.libWrapper.register(MODULE_ID, target, function(wrapped, left, right) {
      service.#stats.comparatorCalls += 1;
      return service.#ordering.compare(this, left, right, (a, b) => wrapped(a, b));
    }, "WRAPPER");
  }

  #isAuthority() {
    return Boolean(globalThis.game?.user?.isGM && this.#authority.isPrimary());
  }

  async #attachSocket({ entries = [] } = {}) {
    if (!this.#isAuthority()) return { attached: false, reason: "not-authority" };
    const resolved = [];
    for (const entry of entries) {
      const token = await globalThis.fromUuid?.(entry.tokenUuid);
      if (token?.documentName !== "Token") continue;
      const validated = await this.#validatedContext(token);
      if (validated) resolved.push({ token, context: validated });
    }
    if (!resolved.length) return { attached: false, reason: "tokens-unavailable" };
    await this.#synchronizeTokenContexts(resolved);
    const combat = this.#findCombat(resolved);
    if (!combat) return { attached: false, pending: true, reason: "summoner-not-in-combat" };
    return this.#enqueue(combat, () => this.#attachToCombat(combat, resolved));
  }

  async #validatedContext(token) {
    const context = contextOf(token);
    if (context?.version !== SUMMON_CONTEXT_SCHEMA_VERSION
      || typeof context.summonerActorUuid !== "string"
      || typeof context.summonerTokenUuid !== "string"
      || typeof context.sourceItemUuid !== "string"
      || typeof context.sourceActivityUuid !== "string"
      || typeof context.batchId !== "string"
      || !Number.isSafeInteger(context.placementOrder)
      || context.placementOrder < 0
      || !Object.values(SUMMON_INITIATIVE_MODES).includes(context.initiativeMode)) return null;

    const [summonerToken, sourceItem] = await Promise.all([
      globalThis.fromUuid?.(context.summonerTokenUuid),
      globalThis.fromUuid?.(context.sourceItemUuid)
    ]);
    if (summonerToken?.documentName !== "Token"
      || summonerToken.parent?.id !== token.parent?.id
      || summonerToken.actor?.uuid !== context.summonerActorUuid
      || sourceItem?.documentName !== "Item") return null;

    const declaration = this.#declarations.read(sourceItem);
    if (!declaration.valid || !declaration.enabled
      || declaration.declaration?.id !== context.declarationId
      || declaration.declaration?.initiative?.mode !== context.initiativeMode) return null;

    const native = token.actor?.getFlag?.("dnd5e", "summon")
      ?? token.actor?.flags?.dnd5e?.summon
      ?? null;
    if (!native || native.origin !== context.sourceItemUuid
      || (native.activity && !context.sourceActivityUuid.endsWith(`.Activity.${native.activity}`))
      || (native.profile && context.profileId && native.profile !== context.profileId)) return null;

    const nativeLevel = Number(native.level);
    return {
      ...context,
      castLevel: Number.isSafeInteger(nativeLevel) && nativeLevel > 0 ? nativeLevel : context.castLevel
    };
  }

  async #reconcileSocket({ combatUuid } = {}) {
    if (!this.#isAuthority()) return { reconciled: false, reason: "not-authority" };
    const combat = await globalThis.fromUuid?.(combatUuid);
    if (combat?.documentName !== "Combat") return { reconciled: false, reason: "combat-unavailable" };
    return this.#enqueue(combat, () => this.#reconcile(combat));
  }

  #findCombat(entries) {
    const context = entries[0]?.context;
    const summonerTokenUuid = context?.summonerTokenUuid;
    const summonerTokenId = summonerTokenUuid?.split(".").at(-1) ?? null;
    const sceneId = entries[0]?.token?.parent?.id ?? null;
    if (!summonerTokenId || !sceneId) return null;
    const combats = [...(globalThis.game?.combats ?? [])]
      .filter(combat => sceneIdOf(combat) === sceneId);
    return combats.find(combat => combatantsOf(combat)
      .some(combatant => combatant.tokenId === summonerTokenId)) ?? null;
  }

  async #synchronizeTokenContexts(entries) {
    const byScene = new Map();
    for (const { token, context } of entries) {
      if (same(contextOf(token), context)) continue;
      const scene = token.parent;
      if (!scene?.updateEmbeddedDocuments) continue;
      const updates = byScene.get(scene) ?? [];
      updates.push({
        _id: token.id,
        [`flags.${MODULE_ID}.${SUMMON_CONTEXT_FLAG}`]: context
      });
      byScene.set(scene, updates);
    }
    for (const [scene, updates] of byScene) {
      await scene.updateEmbeddedDocuments("Token", updates, { [UPDATE_OPTION]: true });
    }
  }

  async #attachToCombat(combat, entries) {
    const ordered = [...entries].sort((left, right) =>
      String(left.context?.batchId ?? "").localeCompare(String(right.context?.batchId ?? ""))
      || Number(left.context?.placementOrder ?? 0) - Number(right.context?.placementOrder ?? 0));
    const creates = [];
    const updates = [];

    for (const { token, context } of ordered) {
      if (context?.initiativeMode !== SUMMON_INITIATIVE_MODES.AFTER_SUMMONER) continue;
      if (token.parent?.id !== sceneIdOf(combat)) continue;
      const summonerTokenId = context.summonerTokenUuid?.split(".").at(-1);
      const leader = combatantsOf(combat).find(combatant => combatant.tokenId === summonerTokenId);
      if (!leader) continue;
      const link = {
        version: INITIATIVE_LINK_SCHEMA_VERSION,
        relation: "after",
        leaderCombatantId: leader.id,
        batchId: context.batchId,
        order: Number.isSafeInteger(context.placementOrder) ? context.placementOrder : 0,
        source: "summon"
      };
      const existing = combatantsOf(combat).find(combatant => combatant.tokenId === token.id);
      if (existing) {
        updates.push({
          _id: existing.id,
          initiative: leader.initiative ?? null,
          group: null,
          [`flags.${MODULE_ID}.${INITIATIVE_LINK_FLAG}`]: link
        });
      } else {
        creates.push({
          tokenId: token.id,
          sceneId: token.parent.id,
          actorId: token.actorId ?? token.actor?.id ?? null,
          hidden: Boolean(token.hidden),
          initiative: leader.initiative ?? null,
          group: null,
          flags: { [MODULE_ID]: { [INITIATIVE_LINK_FLAG]: link } }
        });
      }
    }

    if (updates.length) {
      await combat.updateEmbeddedDocuments("Combatant", updates, { [UPDATE_OPTION]: true });
      this.#stats.combatantsLinked += updates.length;
    }
    if (creates.length) {
      await combat.createEmbeddedDocuments("Combatant", creates, { [UPDATE_OPTION]: true });
      this.#stats.combatantsCreated += creates.length;
      this.#stats.combatantsLinked += creates.length;
    }
    const reconciliation = await this.#reconcile(combat);
    this.#stats.batchesAttached += 1;
    Hooks.callAll(HOOKS.INITIATIVE_RECONCILED, {
      combatUuid: combat.uuid,
      reason: "summon-attached",
      created: creates.length,
      linked: updates.length,
      repaired: reconciliation.repaired ?? 0
    });
    return {
      attached: true,
      combatUuid: combat.uuid,
      created: creates.length,
      linked: updates.length,
      repaired: reconciliation.repaired ?? 0
    };
  }

  async #reconcile(combat) {
    const combatants = combatantsOf(combat);
    const updates = [];
    for (const combatant of combatants) {
      const link = linkOf(combatant);
      if (!link) continue;
      const description = this.#ordering.describe(combat, combatant);
      if (!description.valid || !description.managed) continue;
      const initiative = description.root?.initiative ?? null;
      if (combatant.initiative === initiative && !combatant.group) continue;
      updates.push({ _id: combatant.id, initiative, group: null });
    }
    if (updates.length) {
      await combat.updateEmbeddedDocuments("Combatant", updates, { [UPDATE_OPTION]: true });
      this.#stats.initiativeRepairs += updates.length;
    }
    this.#stats.reconciliations += 1;
    return { reconciled: true, combatUuid: combat.uuid, repaired: updates.length };
  }

  #scheduleReconcile(combat) {
    if (!combat?.id || this.#pendingReconciles.has(combat.id)) return;
    const timeout = globalThis.setTimeout(() => {
      this.#pendingReconciles.delete(combat.id);
      this.#enqueue(combat, () => this.#reconcile(combat))
        .catch(error => Logger.warn("Initiative reconciliation failed.", error));
    }, 0);
    this.#pendingReconciles.set(combat.id, timeout);
  }

  #schedulePendingForLeader(combatant) {
    const combat = combatant?.combat;
    const leaderTokenUuid = combatant?.token?.uuid;
    if (!combat?.id || !leaderTokenUuid) return;
    globalThis.setTimeout(() => {
      this.#enqueue(combat, async () => {
        const scene = combatant.token?.parent;
        const entries = [...(scene?.tokens ?? [])]
          .map(token => ({ token, context: contextOf(token) }))
          .filter(entry => entry.context?.initiativeMode === SUMMON_INITIATIVE_MODES.AFTER_SUMMONER
            && entry.context?.summonerTokenUuid === leaderTokenUuid);
        if (!entries.length) return { attached: false, reason: "no-pending-summons" };
        return this.#attachToCombat(combat, entries);
      }).catch(error => Logger.warn("Pending summon initiative attachment failed.", error));
    }, 0);
  }

  #scanPendingCombats() {
    for (const combat of globalThis.game?.combats ?? []) {
      this.#scheduleReconcile(combat);
      for (const combatant of combatantsOf(combat)) this.#schedulePendingForLeader(combatant);
    }
  }

  #enqueue(combat, operation) {
    const key = combat?.id ?? "unknown";
    const previous = this.#queues.get(key) ?? Promise.resolve();
    const current = previous.catch(() => null).then(operation);
    this.#queues.set(key, current);
    return current.finally(() => {
      if (this.#queues.get(key) === current) this.#queues.delete(key);
    });
  }
}
