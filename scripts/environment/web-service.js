import {
  ANIMATION_AUTOMATED_ANIMATIONS_POLICIES,
  ANIMATION_FLAG_KEY,
  ENVIRONMENT_BEHAVIOR_TYPES,
  ENVIRONMENT_CAPABILITIES,
  MODULE_ID,
  MOVEMENT_AGENCIES,
  OPERATION_METADATA_KEY,
  ONGOING_ACTION_EFFECT_FLAG,
  SELECTION_INDICATOR_ROLES,
  WEB_ACTIVITY_REFERENCES,
  WEB_BURN_SECONDS,
  WEB_BURN_TIMER_HANDLER,
  WEB_CELL_SIZE_FEET,
  WEB_EFFECT_ROLE,
  WEB_FLAG_KEY,
  WEB_PROFILE_ID,
  WEB_SCHEMA_VERSION,
  WEB_SIZE_FEET
} from "../core/constants.js";
import { Logger } from "../core/logger.js";
import { duplicateSafely, nowIso, randomId } from "../core/utils.js";

function clone(value) {
  return duplicateSafely(value);
}

function replacement(value) {
  return typeof globalThis._replace === "function" ? globalThis._replace(value) : value;
}

function asArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return [...value];
  if (typeof value.values === "function") return [...value.values()];
  return [value];
}

function getProperty(object, path) {
  if (globalThis.foundry?.utils?.getProperty) return foundry.utils.getProperty(object, path);
  return String(path).split(".").reduce((value, part) => value?.[part], object);
}

function setProperty(object, path, value) {
  if (globalThis.foundry?.utils?.setProperty) return foundry.utils.setProperty(object, path, value);
  const parts = String(path).split(".");
  const leaf = parts.pop();
  let current = object;
  for (const part of parts) current = current[part] ??= {};
  current[leaf] = value;
  return true;
}

function uuidOf(value) {
  return value?.uuid ?? value?.document?.uuid ?? value?.object?.document?.uuid ?? null;
}

function gridPixelsForFeet(scene, feet) {
  const gridSize = Number(scene?.grid?.size ?? scene?.dimensions?.size ?? globalThis.canvas?.grid?.size ?? 100) || 100;
  const gridDistance = Number(scene?.grid?.distance ?? scene?.dimensions?.distance ?? globalThis.canvas?.scene?.grid?.distance ?? 5) || 5;
  return Number(feet) * gridSize / gridDistance;
}

function regionOfBehavior(behavior) {
  return behavior?.region ?? behavior?.parent ?? behavior?.system?.behavior?.parent ?? null;
}

function activityOutcomeFailed(result, tokenUuid) {
  const target = String(tokenUuid ?? "");
  if ((result?.failedSaves ?? []).includes(target)) return true;
  if ((result?.saves ?? []).includes(target)) return false;
  return null;
}

function coreMovementDifficulties(multiplier = 2) {
  const models = globalThis.CONFIG?.RegionBehavior?.dataModels ?? {};
  const model = models.modifyMovementCost ?? null;
  let fields = null;
  try { fields = model?.defineSchema?.()?.difficulties?.fields ?? null; } catch { fields = null; }
  let actions = Object.keys(fields ?? {});
  if (!actions.length) {
    actions = Object.entries(globalThis.CONFIG?.Token?.movement?.actions ?? {})
      .filter(([, config]) => typeof config?.deriveTerrainDifficulty !== "function")
      .map(([action]) => action);
  }
  // D&D5e always exposes walk, but retain a conservative last-resort source
  // so a partially initialized test/client does not generate an empty schema.
  if (!actions.length && globalThis.CONFIG?.Token?.movement?.defaultAction) {
    actions = [String(globalThis.CONFIG.Token.movement.defaultAction)];
  }
  const difficulty = Math.max(0, Math.min(5, Number(multiplier) || 2));
  return Object.fromEntries(actions.map(action => [action, difficulty]));
}

/**
 * Production controller for the 2024 Web spell.
 *
 * - one persistent Region per cast
 * - native D&D5e Web difficult terrain behavior
 * - AE5E Web RegionBehavior for entry/turn/exit rules
 * - AE5E Flammable profile with 5-foot cell state and one-round burn timers
 * - source-Item ActiveEffect template cloning for Restrained by Web
 */
export class WebService {
  #socket;
  #authority;
  #regions;
  #geometry;
  #profiles;
  #mutations;
  #timing;
  #activities;
  #ongoingEffects;
  #selectionIndicator;
  #crosshairs;
  #initialized = false;
  #unregisterProfile = null;
  #unregisterTimer = null;
  #hooks = [];
  #stats = {
    createRequests: 0,
    created: 0,
    regionEvents: 0,
    saves: 0,
    saveFailures: 0,
    restraintsApplied: 0,
    restraintsRemoved: 0,
    fireExposures: 0,
    cellsIgnited: 0,
    cellsBurnedAway: 0,
    burnDamageUses: 0,
    routedEvents: 0,
    concentrationBindings: 0,
    concentrationBindingMisses: 0,
    placements: 0,
    placementCancellations: 0,
    liveTargetUpdates: 0,
    castAnimations: 0,
    visualRenders: 0,
    visualCleanups: 0,
    errors: 0
  };

  constructor({ socket, authority, regions, geometry, profiles, mutations, timing, activities, ongoingEffects, selectionIndicator, crosshairs = null }) {
    this.#socket = socket;
    this.#authority = authority;
    this.#regions = regions;
    this.#geometry = geometry;
    this.#profiles = profiles;
    this.#mutations = mutations;
    this.#timing = timing;
    this.#activities = activities;
    this.#ongoingEffects = ongoingEffects;
    this.#selectionIndicator = selectionIndicator;
    this.#crosshairs = crosshairs;
    socket.register("web.regionEvent", payload => this.#processRegionEvent(payload));
    socket.register("web.removeRestraints", regionUuid => this.#removeRegionRestraintsAsAuthority(regionUuid));
  }

  initialize() {
    if (this.#initialized) return this.getStats();
    this.#initialized = true;
    this.#unregisterProfile = this.#profiles.register(ENVIRONMENT_CAPABILITIES.FLAMMABLE, WEB_PROFILE_ID, {
      label: "Web (2024)",
      metadata: { builtin: true, spell: "web", rules: "2024" },
      react: context => this.#reactToFire(context)
    });
    this.#unregisterTimer = this.#timing.registerHandler(WEB_BURN_TIMER_HANDLER, context => this.#burnAwayTimer(context));

    if (globalThis.Hooks?.on) {
      this.#hooks.push(["updateRegion", Hooks.on("updateRegion", (region, changed) => {
        if (!this.#isPrimary() || !this.isWebRegion(region) || !("shapes" in (changed ?? {}))) return;
        const mode = this.getRegionData(region)?.visual?.mode ?? "premium";
        void this.renderPersistentVisual(region, { mode }).catch(error => Logger.warn("Web visual refresh failed after Region geometry changed.", error));
      })]);
      this.#hooks.push(["deleteRegion", Hooks.on("deleteRegion", region => {
        if (!this.isWebRegion(region)) return;
        void this.cleanupVisual(region);
        if (this.#isPrimary()) void this.#removeRegionRestraintsAsAuthority(region.uuid).catch(error => Logger.warn("Web restraint cleanup failed after Region deletion.", error));
      })]);
    }
    return this.getStats();
  }

  isWebRegion(region) {
    return Boolean(getProperty(region, `flags.${MODULE_ID}.${WEB_FLAG_KEY}`));
  }

  getRegionData(region) {
    const data = getProperty(region, `flags.${MODULE_ID}.${WEB_FLAG_KEY}`) ?? null;
    return data ? clone(data) : null;
  }

  /**
   * Build Web's movement-cost behavior for the active D&D5e generation.
   * D&D5e 6.0+ supplies its semantic `difficultTerrain` subtype, which can be
   * tagged as `web`. D&D5e 5.3.x does not register that subtype, so AE5E
   * falls back to Foundry v14 core `modifyMovementCost` at 2x.
   */
  buildDifficultTerrainBehavior({ multiplier = 2 } = {}) {
    const models = globalThis.CONFIG?.RegionBehavior?.dataModels ?? {};
    if (models.difficultTerrain) {
      return {
        name: "Web — Difficult Terrain",
        type: "difficultTerrain",
        system: { magical: true, types: ["web"], ignoredDispositions: [] }
      };
    }
    if (models.modifyMovementCost) {
      const difficulties = coreMovementDifficulties(multiplier);
      if (!Object.keys(difficulties).length) return null;
      return {
        name: "Web — Difficult Terrain",
        type: "modifyMovementCost",
        system: { difficulties }
      };
    }
    return null;
  }

  async create({
    scene = null,
    center,
    sourceItemUuid,
    casterActorUuid,
    casterTokenUuid = null,
    instanceId = null,
    saveActivity = WEB_ACTIVITY_REFERENCES.SAVE,
    burnDamageActivity = WEB_ACTIVITY_REFERENCES.BURN_DAMAGE,
    restrainedEffectRole = WEB_EFFECT_ROLE,
    sizeFeet = WEB_SIZE_FEET,
    cellSizeFeet = WEB_CELL_SIZE_FEET,
    visualMode = "premium",
    name = "Web"
  } = {}) {
    this.#stats.createRequests += 1;
    scene = typeof scene === "string" ? await globalThis.fromUuid?.(scene) : scene ?? globalThis.canvas?.scene ?? null;
    if (!scene || scene.documentName !== "Scene") return { created: false, reason: "scene-unavailable" };
    const x = Number(center?.x);
    const y = Number(center?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { created: false, reason: "invalid-center" };
    if (!String(sourceItemUuid ?? "").trim()) return { created: false, reason: "missing-source-item" };
    if (!String(casterActorUuid ?? "").trim()) return { created: false, reason: "missing-caster-actor" };

    const resolvedInstanceId = String(instanceId ?? randomId()).trim();
    const sizePx = gridPixelsForFeet(scene, sizeFeet);
    const topLeft = { x: x - sizePx / 2, y: y - sizePx / 2 };
    const webData = {
      schemaVersion: WEB_SCHEMA_VERSION,
      instanceId: resolvedInstanceId,
      sourceItemUuid,
      casterActorUuid,
      casterTokenUuid: casterTokenUuid ?? null,
      createdAt: nowIso(),
      center: { x, y, elevation: Number.isFinite(Number(center?.elevation)) ? Number(center.elevation) : null },
      sizeFeet: Number(sizeFeet),
      cellSizeFeet: Number(cellSizeFeet),
      state: { turnGates: {} },
      visual: {
        effectName: `${MODULE_ID}.web.${resolvedInstanceId}.persistent`,
        mode: String(visualMode ?? "premium").trim().toLowerCase()
      }
    };

    const terrainBehavior = this.buildDifficultTerrainBehavior();
    if (!terrainBehavior) return { created: false, reason: "difficult-terrain-behavior-unavailable" };

    const regionData = {
      name,
      color: "#d8d1b0",
      locked: true,
      shapes: [this.#geometry.createRectangle({ x: topLeft.x, y: topLeft.y, width: sizePx, height: sizePx })],
      behaviors: [
        terrainBehavior,
        {
          name: "AE5E — Web",
          type: ENVIRONMENT_BEHAVIOR_TYPES.WEB,
          system: {
            events: [
              globalThis.CONST?.REGION_EVENTS?.TOKEN_MOVE_IN ?? "tokenMoveIn",
              globalThis.CONST?.REGION_EVENTS?.TOKEN_ENTER ?? "tokenEnter",
              globalThis.CONST?.REGION_EVENTS?.TOKEN_EXIT ?? "tokenExit",
              globalThis.CONST?.REGION_EVENTS?.TOKEN_TURN_START ?? "tokenTurnStart"
            ],
            instanceId: resolvedInstanceId,
            sourceItemUuid,
            casterActorUuid,
            casterTokenUuid: casterTokenUuid ?? "",
            saveActivity,
            burnDamageActivity,
            restrainedEffectRole,
            sizeFeet: Number(sizeFeet),
            cellSizeFeet: Number(cellSizeFeet)
          }
        },
        {
          name: "AE5E — Flammable",
          type: ENVIRONMENT_BEHAVIOR_TYPES.FLAMMABLE,
          system: { profileId: WEB_PROFILE_ID, priority: 0 }
        }
      ],
      flags: { [MODULE_ID]: { [WEB_FLAG_KEY]: webData } }
    };

    const result = await this.#regions.create(regionData, {
      scene,
      metadata: { type: "web", instanceId: resolvedInstanceId, sourceItemUuid, casterActorUuid }
    });
    let concentration = { bound: false, reason: "region-not-created" };
    if (result?.created) {
      this.#stats.created += 1;
      concentration = await this.bindConcentration({
        regionUuid: result.regionUuid,
        casterActorUuid,
        sourceItemUuid
      });
    }
    return { ...result, instanceId: resolvedInstanceId, effectName: webData.visual.effectName, sizePx, concentration };
  }

  /**
   * Show Web's decoupled placement UI. The functional crosshair is only an
   * invisible anchor/range controller; targeting and the Eskie square both use
   * the same explicit fixed 20-foot footprint.
   */
  async placeCast({
    casterToken = null,
    sourceItem = null,
    rangeFeet = 60,
    sizeFeet = WEB_SIZE_FEET,
    visualMode = "premium",
    label = "Web | Select the center of the 20-foot cube. Press Esc to cancel."
  } = {}) {
    this.#stats.placements += 1;
    const token = await this.#resolveToken(casterToken);
    const item = await this.#resolveDocument(sourceItem);
    const scene = token?.document?.parent ?? token?.parent ?? globalThis.canvas?.scene ?? null;
    if (!token || !scene) return { placed: false, cancelled: false, reason: "caster-token-unavailable" };
    if (!this.#crosshairs?.show) return { placed: false, cancelled: false, reason: "crosshair-service-unavailable" };

    const originalTargetIds = this.#currentTargetIds();
    const gridDistance = Number(scene?.grid?.distance ?? scene?.dimensions?.distance ?? 5) || 5;
    const sizeGridUnits = Number(sizeFeet) / gridDistance;
    const callbacks = {};
    const callbackKeys = globalThis.Sequencer?.Crosshair?.CALLBACKS ?? {};
    const updateLiveTargets = async crosshair => {
      const center = this.#crosshairAnchor(crosshair);
      if (!center) return;
      const targets = this.#tokensInFixedSquare(scene, center, sizeFeet);
      this.#setTargetIds(targets.map(target => target.id));
      this.#stats.liveTargetUpdates += 1;
    };
    if (callbackKeys.SHOW) callbacks[callbackKeys.SHOW] = updateLiveTargets;
    if (callbackKeys.MOVE) callbacks[callbackKeys.MOVE] = updateLiveTargets;
    if (callbackKeys.PLACED) callbacks[callbackKeys.PLACED] = updateLiveTargets;
    if (callbackKeys.CANCEL) callbacks[callbackKeys.CANCEL] = async () => this.#setTargetIds(originalTargetIds);

    const vertexSnap = globalThis.CONST?.GRID_SNAPPING_MODES?.VERTEX ?? 1;
    const requestedVisualMode = String(visualMode ?? "premium").trim().toLowerCase();
    const visual = requestedVisualMode === "premium" ? {
      shape: "rectangle",
      style: "fantasy_01",
      color: "white",
      base: "full",
      size: { width: Number(sizeFeet), height: Number(sizeFeet) },
      sizeStrategy: "exact",
      sizeGridUnits,
      scaleToObject: false,
      belowTokens: true,
      opacity: 1
    } : null;

    let result;
    try {
      result = await this.#crosshairs.show({
        source: token,
        type: "circle",
        location: token,
        distance: 0.1,
        limitMaxRange: Number(rangeFeet),
        placement: {
          snap: { position: vertexSnap, resolution: 1 },
          lockManualRotation: true,
          label: { text: String(label ?? "") },
          location: { showRange: true, displayRangePoly: true }
        },
        appearance: {
          icon: { texture: item?.img ?? token?.document?.texture?.src ?? "", borderVisible: true }
        },
        visual,
        callbacks,
        collectTargets: false,
        nativeFallback: requestedVisualMode !== "premium"
      });
    } catch (error) {
      this.#setTargetIds(originalTargetIds);
      this.#stats.errors += 1;
      throw error;
    }

    if (result?.cancelled || !result?.position) {
      this.#stats.placementCancellations += 1;
      this.#setTargetIds(originalTargetIds);
      return {
        placed: false,
        cancelled: true,
        reason: "cancelled",
        originalTargetIds
      };
    }

    const center = this.#crosshairAnchor(result.position);
    if (!center) {
      this.#setTargetIds(originalTargetIds);
      return { placed: false, cancelled: false, reason: "placement-center-unavailable", originalTargetIds };
    }
    const authoritativeTargets = this.#tokensInFixedSquare(scene, center, sizeFeet);
    this.#setTargetIds(authoritativeTargets.map(target => target.id));

    return {
      placed: true,
      cancelled: false,
      center: {
        x: center.x,
        y: center.y,
        elevation: center.elevation !== null && center.elevation !== undefined && Number.isFinite(Number(center.elevation))
          ? Number(center.elevation)
          : null
      },
      targetTokenUuids: authoritativeTargets.map(target => target.document?.uuid ?? target.uuid).filter(Boolean),
      targetIds: authoritativeTargets.map(target => target.id),
      originalTargetIds,
      rangeFeet: Number(rangeFeet),
      sizeFeet: Number(sizeFeet),
      visualMode: requestedVisualMode,
      crosshairMode: result.mode ?? null,
      crosshairVisual: result.visual ?? null
    };
  }

  restorePlacementTargets(placementOrIds = null) {
    const ids = Array.isArray(placementOrIds)
      ? placementOrIds
      : placementOrIds?.originalTargetIds ?? [];
    this.#setTargetIds(ids);
    return { restored: true, targetIds: [...ids] };
  }

  /**
   * Commit a confirmed placement after the normal spell workflow has created
   * concentration. Region creation remains authoritative; animation failure is
   * presentation-only and never rolls back valid game state.
   */
  async commitCast({
    placement,
    sourceItemUuid,
    casterActorUuid,
    casterTokenUuid = null,
    visualMode = null,
    name = "Web"
  } = {}) {
    if (!placement?.placed || !placement?.center) return { created: false, reason: "placement-unavailable" };
    try {
      const created = await this.create({
        center: placement.center,
        sourceItemUuid,
        casterActorUuid,
        casterTokenUuid,
        sizeFeet: placement.sizeFeet ?? WEB_SIZE_FEET,
        visualMode: visualMode ?? placement.visualMode ?? "premium",
        name
      });
      if (!created?.created) return created;
      if (created?.concentration?.bound !== true) {
        let cleanup = { deleted: false, reason: "not-attempted" };
        try { cleanup = await this.#regions.delete(created.regionUuid); } catch (error) {
          cleanup = { deleted: false, reason: "cleanup-failed", error: error?.message ?? String(error) };
        }
        return {
          ...created,
          created: false,
          reason: "concentration-binding-failed",
          cleanup
        };
      }
      let animation = { played: false, reason: "not-attempted" };
      try {
        animation = await this.playCastAnimation({
          regionOrUuid: created.regionUuid,
          casterToken: casterTokenUuid,
          mode: visualMode ?? placement.visualMode ?? "premium"
        });
      } catch (error) {
        this.#stats.errors += 1;
        Logger.warn("Web Region was created, but the casting animation failed.", error);
        animation = { played: false, reason: "animation-failed", error: error?.message ?? String(error) };
      }
      return { ...created, animation };
    } finally {
      this.restorePlacementTargets(placement);
    }
  }

  /** Play Eskie's Premium Web casting design, adapted to a Region-first result. */
  async playCastAnimation({ regionOrUuid, casterToken = null, mode = "premium" } = {}) {
    let region = typeof regionOrUuid === "string" ? null : regionOrUuid;
    if (!region && typeof regionOrUuid === "string") {
      try { region = await globalThis.fromUuid?.(regionOrUuid); } catch { region = null; }
    }
    if (!region || !this.isWebRegion(region)) return { played: false, reason: "web-region-unavailable" };
    const normalizedMode = String(mode ?? "premium").trim().toLowerCase();
    if (["none", "off", "disabled"].includes(normalizedMode)) return { played: false, reason: "visual-disabled" };
    if (normalizedMode !== "premium") return { played: false, reason: "unsupported-visual-mode", mode: normalizedMode };
    if (!globalThis.Sequence || !globalThis.Sequencer?.EffectManager) return { played: false, reason: "sequencer-unavailable" };

    const token = await this.#resolveToken(casterToken);
    if (!token) return { played: false, reason: "caster-token-unavailable" };
    const data = this.getRegionData(region);
    const center = { x: Number(data?.center?.x), y: Number(data?.center?.y) };
    if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) return { played: false, reason: "web-center-unavailable" };
    const gridDistance = Number(region?.parent?.grid?.distance ?? globalThis.canvas?.scene?.grid?.distance ?? 5) || 5;
    const sizeGridUnits = Number(data?.sizeFeet ?? WEB_SIZE_FEET) / gridDistance;
    const instanceId = data?.instanceId ?? region.id;
    const castingName = `${MODULE_ID}.web.${instanceId}.casting`;
    const persistentName = data?.visual?.effectName ?? `${MODULE_ID}.web.${instanceId}.persistent`;

    try { await globalThis.Sequencer.EffectManager.endEffects({ name: castingName }); } catch { /* best effort */ }
    try { await globalThis.Sequencer.EffectManager.endEffects({ name: persistentName }); } catch { /* best effort */ }

    const sequence = new globalThis.Sequence();
    sequence
      .effect()
        .name(castingName)
        .file("eskie.casting.arcane.01.side.loop.yellow")
        .attachTo(token)
        .rotateTowards(center)
        .scaleToObject(1.25)
        .spriteOffset({ x: -0.15 }, { gridUnits: true })
        .persist()
      .effect()
        .name(castingName)
        .file("eskie.casting.arcane.01.center.loop.yellow")
        .atLocation(center)
        .size(1.75, { gridUnits: true })
        .belowTokens()
        .zIndex(1.1)
        .persist()
      .effect()
        .file("jb2a.magic_signs.circle.02.conjuration.complete.dark_yellow")
        .atLocation(center)
        .size(3.5, { gridUnits: true })
        .fadeIn(600)
        .opacity(1)
        .rotateIn(180, 600, { ease: "easeOutCubic" })
        .scaleIn(0, 600, { ease: "easeOutCubic" })
        .belowTokens()
        .fadeOut(500)
        .duration(3000)
      .effect()
        .file("jb2a.magic_signs.circle.02.conjuration.complete.dark_yellow")
        .atLocation(center)
        .size(3.5, { gridUnits: true })
        .fadeIn(600, { delay: 2500 })
        .fadeOut(1000)
        .opacity(0.5)
        .rotateIn(180, 600, { ease: "easeOutCubic" })
        .scaleIn(0, 600, { ease: "easeOutCubic" })
        .belowTokens()
        .filter("ColorMatrix", { brightness: 0 })
        .duration(4000)
      .effect()
        .file("jb2a.markers.light_orb.loop.white")
        .atLocation(center)
        .scaleIn(0, 1500, { ease: "easeOutCubic" })
        .fadeIn(500)
        .duration(2500)
        .belowTokens()
        .zIndex(2)
        .size(2, { gridUnits: true })
      .effect()
        .file("jb2a.shield_themed.above.eldritch_web.01.dark_green")
        .atLocation(center)
        .scaleIn(0, 1500, { ease: "easeOutCubic" })
        .fadeIn(500)
        .duration(2500)
        .belowTokens()
        .zIndex(2.1)
        .size(0.9, { gridUnits: true })
        .opacity(0.5)
        .filter("ColorMatrix", { brightness: 0, saturate: -1 })
      .wait(2250)
      .effect()
        .delay(250)
        .file("jb2a.impact.004.yellow")
        .atLocation(center)
        .size(sizeGridUnits * 0.8, { gridUnits: true })
        .scaleIn(0, 200, { ease: "easeOutCubic" })
        .filter("ColorMatrix", { saturate: -1 })
      .thenDo(() => globalThis.Sequencer?.EffectManager?.endEffects?.({ name: castingName }))
      .effect()
        .name(persistentName)
        .file("blfx.spell.template.square.nature.web.1.color1")
        .atLocation(center)
        .size(sizeGridUnits, { gridUnits: true })
        .mask(region)
        .tieToDocuments(region)
        .persist()
        .zIndex(1)
      .effect()
        .name(persistentName)
        .file("blfx.spell.template.square.nature.web.2.color1")
        .atLocation(center)
        .size(sizeGridUnits, { gridUnits: true })
        .mask(region)
        .tieToDocuments(region)
        .persist()
        .opacity(0.5)
        .zIndex(1)
        .belowTokens();

    await sequence.play();
    this.#stats.castAnimations += 1;
    this.#stats.visualRenders += 1;
    return { played: true, mode: normalizedMode, castingName, effectName: persistentName };
  }

  /**
   * Attach the Web Region to the concentration ActiveEffect through Midi-QOL's
   * public dependent-document API.  This keeps concentration ownership in the
   * normal D&D5e/Midi lifecycle: when concentration ends, the Region is
   * deleted and AE5E's Region-deletion cleanup removes Web restraints/visuals.
   */
  async bindConcentration({ regionUuid, casterActorUuid, sourceItemUuid } = {}) {
    let region = null;
    let actor = null;
    let item = null;
    try { region = await globalThis.fromUuid?.(regionUuid); } catch { region = null; }
    try { actor = await globalThis.fromUuid?.(casterActorUuid); } catch { actor = null; }
    try { item = await globalThis.fromUuid?.(sourceItemUuid); } catch { item = null; }

    if (!region || !this.isWebRegion(region)) {
      this.#stats.concentrationBindingMisses += 1;
      return { bound: false, reason: "web-region-unavailable" };
    }
    if (!actor || actor.documentName !== "Actor") {
      this.#stats.concentrationBindingMisses += 1;
      return { bound: false, reason: "caster-actor-unavailable" };
    }
    if (!item || item.documentName !== "Item") {
      this.#stats.concentrationBindingMisses += 1;
      return { bound: false, reason: "source-item-unavailable" };
    }

    const addDependent = globalThis.MidiQOL?.addConcentrationDependent;
    if (typeof addDependent !== "function") {
      this.#stats.concentrationBindingMisses += 1;
      return { bound: false, reason: "midi-concentration-api-unavailable" };
    }

    try {
      const result = await addDependent(actor, region, item);
      const live = await globalThis.fromUuid?.(region.uuid) ?? region;
      const dependentOn = live?.getFlag?.("dnd5e", "dependentOn")
        ?? getProperty(live, "flags.dnd5e.dependentOn")
        ?? null;
      if (!dependentOn) {
        this.#stats.concentrationBindingMisses += 1;
        return { bound: false, reason: "concentration-effect-not-found", result: result ?? null };
      }
      this.#stats.concentrationBindings += 1;
      return { bound: true, dependentOn, result: result ?? null };
    } catch (error) {
      this.#stats.errors += 1;
      Logger.warn("Web Region was created, but concentration dependency binding failed.", error);
      return { bound: false, reason: "concentration-binding-failed", error: error?.message ?? String(error) };
    }
  }

  /** Called directly by the native Web RegionBehavior on every client. */
  async handleRegionEvent(behavior, event) {
    this.#stats.regionEvents += 1;
    if (!event?.user?.isSelf) return { handled: false, reason: "not-event-originator" };
    const token = event?.data?.token ?? null;
    if (!token?.uuid) return { handled: false, reason: "token-unavailable" };
    const eventName = String(event?.name ?? event?.type ?? "");
    const moveIn = eventName === (globalThis.CONST?.REGION_EVENTS?.TOKEN_MOVE_IN ?? "tokenMoveIn");

    let resume = null;
    if (moveIn && typeof token.pauseMovement === "function") {
      try { resume = token.pauseMovement(); } catch { resume = null; }
    }

    const movement = event?.data?.movement ?? token?.movement ?? null;
    const metadata = token?.movement?.updateOptions?.[OPERATION_METADATA_KEY]
      ?? movement?.updateOptions?.[OPERATION_METADATA_KEY]
      ?? null;
    const payload = {
      behaviorUuid: behavior?.uuid ?? null,
      eventName,
      tokenUuid: token.uuid,
      movementId: movement?.id ?? null,
      movementMethod: movement?.method ?? null,
      movementAgency: metadata?.agency ?? null,
      eventUserId: event?.user?.id ?? globalThis.game?.user?.id ?? null
    };

    try {
      const result = await this.#routeRegionEvent(payload);
      if (moveIn && result?.stopMovement === true && typeof token.stopMovement === "function") {
        try { token.stopMovement(); } catch { /* fail open below */ }
        return result;
      }
      if (resume) await resume();
      return result;
    } catch (error) {
      this.#stats.errors += 1;
      if (resume) {
        try { await resume(); } catch { /* fail open */ }
      }
      Logger.error("AE5E Web Region event failed", error);
      throw error;
    }
  }

  /**
   * Render the persistent Premium Web layers against the authoritative Region.
   * Sequencer 4.2.x supports Region masks; using the Region as the mask keeps
   * presentation downstream of gameplay geometry, including carved holes.
   */
  async renderPersistentVisual(regionOrUuid, { mode = "premium" } = {}) {
    let region = typeof regionOrUuid === "string" ? null : regionOrUuid;
    if (!region && typeof regionOrUuid === "string") {
      try { region = await globalThis.fromUuid?.(regionOrUuid); } catch { region = null; }
    }
    if (!region || !this.isWebRegion(region)) return { rendered: false, reason: "web-region-unavailable" };
    const normalizedMode = String(mode ?? "premium").trim().toLowerCase();
    if (["none", "off", "disabled"].includes(normalizedMode)) return { rendered: false, reason: "visual-disabled" };
    if (normalizedMode !== "premium") return { rendered: false, reason: "unsupported-visual-mode", mode: normalizedMode };
    if (!globalThis.Sequence || !globalThis.Sequencer?.EffectManager) return { rendered: false, reason: "sequencer-unavailable" };

    const data = this.getRegionData(region);
    const gridDistance = Number(region?.parent?.grid?.distance ?? globalThis.canvas?.scene?.grid?.distance ?? 5) || 5;
    const sizeGridUnits = Number(data?.sizeFeet ?? WEB_SIZE_FEET) / gridDistance;
    const effectName = data?.visual?.effectName ?? `${MODULE_ID}.web.${data?.instanceId ?? region.id}.persistent`;
    try { await globalThis.Sequencer.EffectManager.endEffects({ name: effectName }); } catch { /* best effort */ }

    const sequence = new globalThis.Sequence();
    sequence
      .effect()
        .name(effectName)
        .file("blfx.spell.template.square.nature.web.1.color1")
        .atLocation(region)
        .size(sizeGridUnits, { gridUnits: true })
        .mask(region)
        .tieToDocuments(region)
        .persist()
        .zIndex(1)
      .effect()
        .name(effectName)
        .file("blfx.spell.template.square.nature.web.2.color1")
        .atLocation(region)
        .size(sizeGridUnits, { gridUnits: true })
        .mask(region)
        .tieToDocuments(region)
        .persist()
        .opacity(0.5)
        .zIndex(1)
        .belowTokens();
    await sequence.play();
    this.#stats.visualRenders += 1;
    return { rendered: true, effectName, mode: normalizedMode };
  }

  async cleanupVisual(regionOrUuid) {
    let region = typeof regionOrUuid === "string" ? null : regionOrUuid;
    if (!region && typeof regionOrUuid === "string") {
      try { region = await globalThis.fromUuid?.(regionOrUuid); } catch { region = null; }
    }
    const data = this.getRegionData(region);
    const gridDistance = Number(region?.parent?.grid?.distance ?? globalThis.canvas?.scene?.grid?.distance ?? 5) || 5;
    const sizeGridUnits = Number(data?.sizeFeet ?? WEB_SIZE_FEET) / gridDistance;
    const effectName = data?.visual?.effectName ?? (data?.instanceId ? `${MODULE_ID}.web.${data.instanceId}.persistent` : null);
    if (!effectName) return { cleaned: false, reason: "no-effect-name" };
    try {
      await globalThis.Sequencer?.EffectManager?.endEffects?.({ name: effectName });
      this.#stats.visualCleanups += 1;
      return { cleaned: true, effectName };
    } catch {
      return { cleaned: false, reason: "sequencer-unavailable", effectName };
    }
  }

  async validateSourceItem(itemOrUuid) {
    let item = typeof itemOrUuid === "string" ? null : itemOrUuid;
    if (!item && typeof itemOrUuid === "string") {
      try { item = await globalThis.fromUuid?.(itemOrUuid); } catch { item = null; }
    }
    const checks = [];
    const record = (name, passed, details = null) => checks.push({ name, passed: Boolean(passed), details });
    const activityField = (activity, path, fallback = undefined) => {
      const direct = getProperty(activity, path);
      if (direct !== undefined) return direct;
      const nested = getProperty(activity, `system.${path}`);
      return nested !== undefined ? nested : fallback;
    };
    const noConsumption = activity => {
      const targets = asArray(activityField(activity, "consumption.targets", []));
      const spellSlot = activityField(activity, "consumption.spellSlot", false);
      return targets.length === 0 && spellSlot !== true;
    };
    const noAppliedEffects = activity => asArray(activityField(activity, "effects", [])).length === 0;

    if (!item || item.documentName !== "Item") {
      record("Web source Item resolves", false, itemOrUuid ?? null);
      return { passed: false, checks, itemUuid: null };
    }

    record("Web source Item resolves", true, item.uuid);
    record("Source Item is a spell", item.type === "spell", item.type);
    record("Web uses the 2024 ruleset", String(item.system?.source?.rules ?? "") === "2024", item.system?.source?.rules ?? null);
    record("Web identifier is 'web'", String(item.system?.identifier ?? "").trim().toLowerCase() === "web", item.system?.identifier ?? null);
    record("Web is a 2nd-level Conjuration spell", Number(item.system?.level) === 2 && String(item.system?.school ?? "") === "con", { level: item.system?.level ?? null, school: item.system?.school ?? null });
    record("Web has a 1 Action casting time", String(item.system?.activation?.type ?? "") === "action", item.system?.activation ?? null);
    record("Web duration is 1 hour", Number(item.system?.duration?.value) === 1 && String(item.system?.duration?.units ?? "") === "hour", item.system?.duration ?? null);

    const properties = new Set(asArray(item.system?.properties));
    record("Web is configured as Concentration", properties.has("concentration"), [...properties]);
    record("Web has Verbal, Somatic, and Material components", ["vocal", "somatic", "material"].every(value => properties.has(value)), [...properties]);
    record("Web range is 60 feet", Number(item.system?.range?.value) === 60 && String(item.system?.range?.units ?? "") === "ft", item.system?.range ?? null);
    record("Web descriptive target is a 20-foot cube", String(item.system?.target?.template?.type ?? "") === "cube" && Number(item.system?.target?.template?.size) === 20, item.system?.target?.template ?? null);

    const cast = this.#findActivity(item, WEB_ACTIVITY_REFERENCES.CAST);
    const save = this.#findActivity(item, WEB_ACTIVITY_REFERENCES.SAVE);
    const escape = this.#findActivity(item, WEB_ACTIVITY_REFERENCES.ESCAPE);
    const burn = this.#findActivity(item, WEB_ACTIVITY_REFERENCES.BURN_DAMAGE);

    record("Cast Web Activity exists and is Utility", cast?.type === "utility", cast?.type ?? null);
    record("Cast Web suppresses the native target/template prompt", Boolean(cast) && activityField(cast, "target.prompt", false) !== true, activityField(cast, "target", null));
    record("Cast Web applies no source effects directly", Boolean(cast) && noAppliedEffects(cast), activityField(cast, "effects", null));

    record("Web Save Activity exists and is a Save", save?.type === "save", save?.type ?? null);
    const rawSaveAbility = activityField(save, "save.ability", null);
    const saveAbilities = new Set(asArray(rawSaveAbility));
    if (!saveAbilities.size && typeof rawSaveAbility === "string") saveAbilities.add(rawSaveAbility);
    record("Web Save uses Dexterity", saveAbilities.has("dex"), [...saveAbilities]);
    const saveDcCalculation = String(activityField(save, "save.dc.calculation", "") ?? "");
    record("Web Save uses the caster's spell save DC", saveDcCalculation === "spellcasting", { calculation: saveDcCalculation, formula: activityField(save, "save.dc.formula", "") });
    record("Web Save has no damage or automatic effects", asArray(activityField(save, "damage.parts", [])).length === 0 && noAppliedEffects(save), {
      damageParts: asArray(activityField(save, "damage.parts", [])).length,
      effects: asArray(activityField(save, "effects", [])).length
    });
    record("Web Save does not consume another spell slot or resource", Boolean(save) && noConsumption(save), activityField(save, "consumption", null));

    record("Escape Web Activity exists and is a Check", escape?.type === "check", escape?.type ?? null);
    const escapeAbility = String(activityField(escape, "check.ability", "") ?? "");
    const escapeAssociated = new Set(asArray(activityField(escape, "check.associated", [])));
    record("Escape Web uses Strength (Athletics)", escapeAbility === "str" && escapeAssociated.has("ath"), { ability: escapeAbility, associated: [...escapeAssociated] });
    record("Escape Web is an Action", String(activityField(escape, "activation.type", "")) === "action", activityField(escape, "activation", null));
    record("Escape Web has no damage or automatic effects", asArray(activityField(escape, "damage.parts", [])).length === 0 && noAppliedEffects(escape), {
      damageParts: asArray(activityField(escape, "damage.parts", [])).length,
      effects: asArray(activityField(escape, "effects", [])).length
    });
    record("Escape Web does not consume a spell slot or resource", Boolean(escape) && noConsumption(escape), activityField(escape, "consumption", null));

    record("Burning Web Damage Activity exists and is Damage", burn?.type === "damage", burn?.type ?? null);
    const damageParts = asArray(activityField(burn, "damage.parts", []));
    const fireParts = damageParts.filter(part => new Set(asArray(part?.types)).has("fire") || String(part?.type ?? "") === "fire");
    const firePart = fireParts[0] ?? null;
    const is2d4 = Boolean(firePart && Number(firePart.number) === 2 && Number(firePart.denomination) === 4);
    record("Burning Web Damage is exactly one 2d4 Fire damage part", damageParts.length === 1 && fireParts.length === 1 && is2d4, damageParts);
    record("Burning Web Damage has no save or automatic effects", asArray(activityField(burn, "save.ability", [])).length === 0 && noAppliedEffects(burn), {
      saveAbility: activityField(burn, "save.ability", null),
      effects: asArray(activityField(burn, "effects", [])).length
    });
    record("Burning Web Damage does not consume another spell slot or resource", Boolean(burn) && noConsumption(burn), activityField(burn, "consumption", null));

    const template = [...(item.effects ?? [])].find(effect => {
      const effectRole = getProperty(effect, `flags.${MODULE_ID}.${WEB_FLAG_KEY}.role`);
      return effectRole === WEB_EFFECT_ROLE || String(effect?.name ?? "").trim().toLowerCase() === "restrained by web";
    }) ?? null;
    record("Transfer-disabled Restrained by Web source Active Effect exists", Boolean(template) && template.transfer !== true, template?.toObject?.(false) ?? template);
    const statuses = new Set(asArray(template?.statuses));
    record("Restrained by Web source effect carries the Restrained status", statuses.has("restrained"), [...statuses]);

    const aaPolicy = getProperty(item, `flags.${MODULE_ID}.${ANIMATION_FLAG_KEY}.automatedAnimations`);
    record("Automated Animations is explicitly suppressed through AE5E ownership", aaPolicy === ANIMATION_AUTOMATED_ANIMATIONS_POLICIES.SUPPRESS, aaPolicy ?? null);

    return {
      passed: checks.every(check => check.passed),
      checks,
      itemUuid: item.uuid,
      activities: {
        cast: cast?.uuid ?? cast?.id ?? null,
        save: save?.uuid ?? save?.id ?? null,
        escape: escape?.uuid ?? escape?.id ?? null,
        burnDamage: burn?.uuid ?? burn?.id ?? null
      }
    };
  }

  getStats() {
    return Object.freeze({ ...this.#stats, initialized: this.#initialized });
  }

  async #routeRegionEvent(payload) {
    const primary = this.#authority?.getPrimaryGm?.()
      ?? [...(globalThis.game?.users ?? [])].find(user => user?.active && user?.isGM)
      ?? null;
    if (!primary) return { handled: false, reason: "no-active-gm" };
    if (globalThis.game?.user?.id === primary.id) return this.#processRegionEvent(payload);
    this.#stats.routedEvents += 1;
    return this.#socket.executeAsUser("web.regionEvent", primary.id, payload);
  }

  async #processRegionEvent(payload) {
    if (!this.#isPrimary()) return { handled: false, reason: "not-primary-gm" };
    let behavior = null;
    let token = null;
    try { behavior = await globalThis.fromUuid?.(payload?.behaviorUuid); } catch { behavior = null; }
    try { token = await globalThis.fromUuid?.(payload?.tokenUuid); } catch { token = null; }
    const region = regionOfBehavior(behavior);
    if (!behavior || !region || !token) return { handled: false, reason: "document-unavailable" };

    const enter = globalThis.CONST?.REGION_EVENTS?.TOKEN_ENTER ?? "tokenEnter";
    const moveIn = globalThis.CONST?.REGION_EVENTS?.TOKEN_MOVE_IN ?? "tokenMoveIn";
    const exit = globalThis.CONST?.REGION_EVENTS?.TOKEN_EXIT ?? "tokenExit";
    const turnStart = globalThis.CONST?.REGION_EVENTS?.TOKEN_TURN_START ?? "tokenTurnStart";
    const eventName = payload?.eventName;

    if (eventName === exit) {
      const removed = await this.#removeRestraint(region, token);
      return { handled: true, eventName, restraintRemoved: removed };
    }

    if (eventName === turnStart) {
      const damage = await this.#applyBurningDamageIfNeeded(region, behavior, token);
      const save = await this.#saveIfNeeded(region, behavior, token, { eventName, movementId: null });
      return { handled: true, eventName, damage, save, stopMovement: false };
    }

    if (eventName === enter && !payload?.movementId) {
      // Region creation/boundary changes can cause TOKEN_ENTER with no movement.
      // Web 2024 has no immediate cast-time save, so do not treat that as entry.
      return { handled: false, reason: "nonmovement-enter" };
    }

    if (eventName === moveIn || eventName === enter) {
      const save = await this.#saveIfNeeded(region, behavior, token, {
        eventName,
        movementId: payload?.movementId ?? null
      });
      const failed = save?.failed === true;
      const stopMovement = failed && this.#movementIsVoluntary(payload);
      return { handled: true, eventName, save, stopMovement };
    }

    return { handled: false, reason: "unsupported-event", eventName };
  }

  async #saveIfNeeded(region, behavior, token, { eventName, movementId }) {
    if (this.#hasMatchingRestraint(region, token)) return { attempted: false, reason: "already-restrained" };
    const gateKey = this.#turnGateKey(token, movementId);
    const state = await this.#readAndClaimTurnGate(region, token.uuid, gateKey);
    if (!state.claimed) return { attempted: false, reason: "already-checked-this-turn", gateKey };

    const system = behavior?.system ?? {};
    const activityReference = String(system.saveActivity ?? WEB_ACTIVITY_REFERENCES.SAVE);
    const result = await this.#activities.execute({
      itemUuid: system.sourceItemUuid,
      activityReference,
      targetTokenUuids: [token.uuid],
      idempotencyKey: `web-save:${region.uuid}:${token.uuid}:${gateKey}`,
      options: {}
    });
    this.#stats.saves += 1;
    const failed = activityOutcomeFailed(result, token.uuid);
    if (failed === true) {
      this.#stats.saveFailures += 1;
      await this.#applyRestraint(region, behavior, token);
    }
    return { attempted: true, failed, result, eventName, gateKey };
  }

  async #applyRestraint(region, behavior, token) {
    const actor = token?.actor ?? token?.object?.actor ?? null;
    if (!actor?.createEmbeddedDocuments) return false;
    if (this.#hasMatchingRestraint(region, token)) return false;

    const sourceItem = await globalThis.fromUuid?.(behavior?.system?.sourceItemUuid);
    if (!sourceItem || sourceItem.documentName !== "Item") throw new Error("Web source Item is unavailable while applying Restrained by Web.");
    const role = String(behavior?.system?.restrainedEffectRole ?? WEB_EFFECT_ROLE);
    const template = [...(sourceItem.effects ?? [])].find(effect => {
      const effectRole = getProperty(effect, `flags.${MODULE_ID}.${WEB_FLAG_KEY}.role`);
      return effectRole === role || String(effect?.name ?? "").toLowerCase() === "restrained by web";
    }) ?? null;
    if (!template) throw new Error("Web requires a Transfer-disabled source Active Effect template named 'Restrained by Web'.");

    const data = template.toObject?.(false) ?? clone(template);
    delete data._id;
    data.disabled = false;
    data.transfer = false;
    data.origin = sourceItem.uuid;
    const caster = await globalThis.fromUuid?.(behavior?.system?.casterActorUuid);
    const saveActivity = this.#findActivity(sourceItem, behavior?.system?.saveActivity ?? WEB_ACTIVITY_REFERENCES.SAVE);
    const saveDc = Number(
      saveActivity?.save?.dc?.value
      ?? saveActivity?.system?.save?.dc?.value
      ?? caster?.system?.attributes?.spell?.dc
      ?? NaN
    );
    setProperty(data, `flags.${MODULE_ID}.${WEB_FLAG_KEY}`, {
      role: "runtime-restraint",
      regionUuid: region.uuid,
      behaviorUuid: behavior.uuid,
      instanceId: behavior?.system?.instanceId ?? this.getRegionData(region)?.instanceId ?? null,
      sourceItemUuid: sourceItem.uuid,
      saveDc: Number.isFinite(saveDc) ? saveDc : null,
      appliedAt: nowIso()
    });

    // Restrained blocks voluntary movement but must not block forced/compelled
    // movement. AE5E's shared movement policy already makes that distinction.
    const movementRestrictionPath = `flags.${MODULE_ID}.movement.voluntaryRestriction`;
    if (!getProperty(data, movementRestrictionPath)) {
      setProperty(data, movementRestrictionPath, {
        enabled: true,
        message: "You are Restrained by Web and cannot move voluntarily.",
        priority: 50
      });
    }

    // The editable source template can already contain ongoingAction settings.
    // If the user left them absent, derive an Escape Web grant from the source
    // Item's Escape Web Activity using AE5E's generic activity-derived grant.
    const ongoingPath = `flags.${MODULE_ID}.${ONGOING_ACTION_EFFECT_FLAG}`;
    if (!getProperty(data, ongoingPath)) {
      setProperty(data, ongoingPath, {
        enabled: true,
        sourceActivity: {
          activityReference: WEB_ACTIVITY_REFERENCES.ESCAPE,
          itemName: "Web — Escape",
          itemImg: sourceItem.img ?? data.img ?? null,
          activityPatch: Number.isFinite(saveDc) ? {
            "check.dc.calculation": "",
            "check.dc.formula": String(saveDc)
          } : {}
        },
        removeEffectOnSuccess: true,
        indicatorRole: SELECTION_INDICATOR_ROLES.ORIGINATOR
      });
    }

    const [created] = await actor.createEmbeddedDocuments("ActiveEffect", [data], { ae5eWebRestraint: true });
    if (created) {
      this.#stats.restraintsApplied += 1;
      try { await this.#ongoingEffects?.ensureGrant?.(created); } catch (error) { Logger.warn("Web restraint applied, but Escape Web grant creation failed.", error); }
      return true;
    }
    return false;
  }

  async #removeRestraint(region, token) {
    const actor = token?.actor ?? token?.object?.actor ?? null;
    if (!actor?.deleteEmbeddedDocuments) return false;
    const ids = [...(actor.effects ?? [])]
      .filter(effect => getProperty(effect, `flags.${MODULE_ID}.${WEB_FLAG_KEY}.regionUuid`) === region.uuid)
      .map(effect => effect.id)
      .filter(Boolean);
    if (!ids.length) return false;
    await actor.deleteEmbeddedDocuments("ActiveEffect", ids, { ae5eWebExit: true });
    this.#stats.restraintsRemoved += ids.length;
    return true;
  }

  #hasMatchingRestraint(region, token) {
    const actor = token?.actor ?? token?.object?.actor ?? null;
    return [...(actor?.effects ?? [])].some(effect => !effect.disabled
      && getProperty(effect, `flags.${MODULE_ID}.${WEB_FLAG_KEY}.regionUuid`) === region.uuid);
  }

  async #applyBurningDamageIfNeeded(region, behavior, token) {
    const flammable = [...(region?.behaviors ?? [])].find(entry => entry.type === ENVIRONMENT_BEHAVIOR_TYPES.FLAMMABLE) ?? null;
    const state = flammable ? this.#mutations.getState(region, flammable) ?? {} : {};
    const burningCells = Object.values(state?.burningCells ?? {});
    if (!burningCells.length) return { applied: false, reason: "no-burning-cells" };
    const footprint = this.tokenFootprint(token);
    if (!footprint) return { applied: false, reason: "token-footprint-unavailable" };
    const intersects = burningCells.some(cell => cell?.shape && this.#geometry.intersects(footprint, {
      ae5eEnvironmentGeometry: 1,
      source: "web-burning-cell",
      sceneUuid: region?.parent?.uuid ?? null,
      shapes: [cell.shape]
    }));
    if (!intersects) return { applied: false, reason: "not-in-burning-cell" };

    const activityReference = String(behavior?.system?.burnDamageActivity ?? WEB_ACTIVITY_REFERENCES.BURN_DAMAGE);
    const turnKey = this.#turnGateKey(token, null);
    const result = await this.#activities.execute({
      itemUuid: behavior?.system?.sourceItemUuid,
      activityReference,
      targetTokenUuids: [token.uuid],
      idempotencyKey: `web-burn-damage:${region.uuid}:${token.uuid}:${turnKey}`,
      options: {}
    });
    this.#stats.burnDamageUses += 1;
    return { applied: result?.executed === true, result };
  }

  tokenFootprint(token) {
    const document = token?.document ?? token;
    const scene = document?.parent ?? globalThis.canvas?.scene ?? null;
    if (!document || !scene) return null;
    const gridSize = Number(scene?.grid?.size ?? scene?.dimensions?.size ?? globalThis.canvas?.grid?.size ?? 100) || 100;
    const x = Number(document.x);
    const y = Number(document.y);
    const width = Number(document.width ?? 1) * gridSize;
    const height = Number(document.height ?? 1) * gridSize;
    if (![x, y, width, height].every(Number.isFinite)) return null;
    return this.#geometry.normalize({
      ae5eEnvironmentGeometry: 1,
      source: "token-footprint",
      sceneUuid: scene.uuid,
      elevation: Number.isFinite(Number(document.elevation)) ? { bottom: Number(document.elevation), top: Number(document.elevation) } : null,
      shapes: [this.#geometry.createRectangle({ x, y, width, height })]
    });
  }

  async #reactToFire({ event, region, behavior, currentState }) {
    this.#stats.fireExposures += 1;
    const cells = this.#webCells(region);
    if (!cells.length) return { handled: false, reason: "web-grid-unavailable" };
    const burningCells = clone(currentState?.burningCells ?? {});
    const burnedCells = clone(currentState?.burnedCells ?? {});
    const scheduleTimers = [];
    let ignited = 0;

    for (const cell of cells) {
      if (burnedCells[cell.id] || burningCells[cell.id]) continue;
      const cellGeometry = this.#geometry.normalize({
        ae5eEnvironmentGeometry: 1,
        source: "web-cell",
        sceneUuid: region?.parent?.uuid ?? null,
        shapes: [cell.shape]
      });
      if (!this.#geometry.intersects(event.geometry, cellGeometry)) continue;
      const timerId = `web-burn:${behavior.id ?? behavior._id}:${cell.id}`;
      burningCells[cell.id] = {
        id: cell.id,
        shape: clone(cell.shape),
        ignitedAt: nowIso(),
        timerId,
        sourceEventId: event.id
      };
      scheduleTimers.push({
        id: timerId,
        handlerId: WEB_BURN_TIMER_HANDLER,
        due: this.#burnDue(),
        behaviorId: behavior.id ?? behavior._id,
        capabilityId: ENVIRONMENT_CAPABILITIES.FLAMMABLE,
        profileId: WEB_PROFILE_ID,
        payload: { cellId: cell.id }
      });
      ignited += 1;
    }

    if (!ignited) return { handled: false, reason: "no-new-web-cells" };
    this.#stats.cellsIgnited += ignited;
    return {
      handled: true,
      state: {
        ...currentState,
        status: "burning",
        burningCells,
        burnedCells,
        lastIgnitedAt: nowIso(),
        lastFireEventId: event.id
      },
      scheduleTimers
    };
  }

  async #burnAwayTimer({ region, behavior, timer }) {
    const cellId = timer?.payload?.cellId ?? null;
    if (!cellId || !behavior) return { handled: true, reason: "missing-cell" };
    const currentState = this.#mutations.getState(region, behavior) ?? {};
    const burningCells = clone(currentState?.burningCells ?? {});
    const cell = burningCells[cellId];
    if (!cell?.shape) return { handled: true, reason: "cell-already-resolved" };
    delete burningCells[cellId];
    const burnedCells = clone(currentState?.burnedCells ?? {});
    burnedCells[cellId] = { id: cellId, burnedAt: nowIso(), shape: clone(cell.shape) };
    this.#stats.cellsBurnedAway += 1;
    return {
      handled: true,
      state: {
        ...currentState,
        status: Object.keys(burningCells).length ? "burning" : "stable",
        burningCells,
        burnedCells,
        lastBurnedCell: cellId,
        lastBurnedAt: nowIso()
      },
      addHoles: [cell.shape]
    };
  }

  #webCells(region) {
    const web = this.getRegionData(region);
    const sizeFeet = Number(web?.sizeFeet ?? WEB_SIZE_FEET);
    const cellFeet = Number(web?.cellSizeFeet ?? WEB_CELL_SIZE_FEET);
    const centerX = Number(web?.center?.x);
    const centerY = Number(web?.center?.y);
    const scene = region?.parent ?? globalThis.canvas?.scene ?? null;
    if (![sizeFeet, cellFeet, centerX, centerY].every(Number.isFinite) || !scene || cellFeet <= 0 || sizeFeet <= 0) return [];
    const count = Math.max(1, Math.round(sizeFeet / cellFeet));
    const sizePx = gridPixelsForFeet(scene, sizeFeet);
    const cellPx = sizePx / count;
    const left = centerX - sizePx / 2;
    const top = centerY - sizePx / 2;
    const cells = [];
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        const id = `${col},${row}`;
        cells.push({ id, col, row, shape: this.#geometry.createRectangle({ x: left + col * cellPx, y: top + row * cellPx, width: cellPx, height: cellPx }) });
      }
    }
    return cells;
  }

  #burnDue() {
    const combat = globalThis.game?.combat ?? null;
    if (combat?.started && Number.isFinite(Number(combat.round)) && Number.isFinite(Number(combat.turn))) {
      return { combat: { combatUuid: combat.uuid, round: Number(combat.round) + 1, turn: Number(combat.turn) } };
    }
    return { realTimeMs: Date.now() + WEB_BURN_SECONDS * 1000 };
  }

  #turnGateKey(token, movementId) {
    const combat = globalThis.game?.combat ?? null;
    if (combat?.started && Number.isFinite(Number(combat.round)) && Number.isFinite(Number(combat.turn))) {
      return `${combat.uuid}:${combat.round}:${combat.turn}`;
    }
    return movementId ? `movement:${movementId}` : `outside:${token?.uuid ?? "token"}:${Date.now()}`;
  }

  async #readAndClaimTurnGate(region, tokenUuid, gateKey) {
    const web = this.getRegionData(region) ?? {};
    const state = clone(web.state ?? {});
    state.turnGates ??= {};
    if (state.turnGates[tokenUuid] === gateKey) return { claimed: false, state };
    state.turnGates[tokenUuid] = gateKey;
    // Bound persistent gate history by token, not by turn count.
    web.state = state;
    await region.update({ [`flags.${MODULE_ID}.${WEB_FLAG_KEY}`]: replacement(web) }, { ae5eWebState: true });
    return { claimed: true, state };
  }



  async #resolveDocument(value) {
    if (!value) return null;
    if (typeof value !== "string") return value?.document ?? value;
    try { return await globalThis.fromUuid?.(value) ?? null; } catch { return null; }
  }

  async #resolveToken(value) {
    if (!value) return null;
    if (typeof value !== "string") {
      if (value?.documentName === "Token") return value.object ?? globalThis.canvas?.tokens?.get?.(value.id) ?? value;
      return value?.object ?? value;
    }
    let document = null;
    try { document = await globalThis.fromUuid?.(value); } catch { document = null; }
    if (document?.documentName === "Token") return document.object ?? globalThis.canvas?.tokens?.get?.(document.id) ?? document;
    const id = String(value).split(".").pop();
    return globalThis.canvas?.tokens?.get?.(id) ?? null;
  }

  #crosshairAnchor(crosshair) {
    const source = crosshair?.document ?? crosshair ?? null;
    if (!source) return null;
    const x = Number(source.x ?? source.position?.x ?? source.center?.x);
    const y = Number(source.y ?? source.position?.y ?? source.center?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const elevation = Number(source.elevation ?? source.position?.elevation);
    return { x, y, elevation: Number.isFinite(elevation) ? elevation : null, direction: Number(source.direction ?? 0) || 0 };
  }

  #tokensInFixedSquare(scene, center, sizeFeet) {
    const sizePx = gridPixelsForFeet(scene, sizeFeet);
    const half = sizePx / 2;
    const left = center.x - half;
    const right = center.x + half;
    const top = center.y - half;
    const bottom = center.y + half;
    const tokens = [...(globalThis.canvas?.tokens?.placeables ?? [])];
    return tokens.filter(token => {
      if (!globalThis.game?.user?.isGM && (token?.document?.hidden || token?.isVisible === false)) return false;
      const c = this.#tokenCenter(token, scene);
      return c && c.x >= left && c.x <= right && c.y >= top && c.y <= bottom;
    });
  }

  #tokenCenter(token, scene) {
    const directX = Number(token?.center?.x);
    const directY = Number(token?.center?.y);
    if (Number.isFinite(directX) && Number.isFinite(directY)) return { x: directX, y: directY };
    const document = token?.document ?? token;
    const gridSize = Number(scene?.grid?.size ?? scene?.dimensions?.size ?? globalThis.canvas?.grid?.size ?? 100) || 100;
    const x = Number(document?.x);
    const y = Number(document?.y);
    const width = Number(document?.width ?? 1) * gridSize;
    const height = Number(document?.height ?? 1) * gridSize;
    if (![x, y, width, height].every(Number.isFinite)) return null;
    return { x: x + width / 2, y: y + height / 2 };
  }

  #currentTargetIds() {
    const targets = globalThis.game?.user?.targets;
    if (Array.isArray(targets?.ids)) return [...targets.ids];
    return [...(targets ?? [])].map(token => token?.id ?? token?.document?.id).filter(Boolean);
  }

  #setTargetIds(ids = []) {
    const unique = [...new Set(asArray(ids).map(String).filter(Boolean))];
    const user = globalThis.game?.user ?? null;
    if (typeof user?.updateTokenTargets === "function") {
      user.updateTokenTargets(unique);
      return unique;
    }
    const targetSet = user?.targets;
    if (targetSet?.clear) targetSet.clear();
    const byId = new Map([...(globalThis.canvas?.tokens?.placeables ?? [])].map(token => [token.id, token]));
    for (const id of unique) targetSet?.add?.(byId.get(id));
    return unique;
  }

  #findActivity(item, reference) {
    const activities = item?.system?.activities;
    if (!activities) return null;
    const ref = String(reference ?? "").trim();
    if (ref && typeof activities.get === "function") {
      const direct = activities.get(ref);
      if (direct) return direct;
    }
    const entries = asArray(activities).length
      ? asArray(activities)
      : (typeof activities.values === "function" ? [...activities.values()] : Object.values(activities ?? {}));
    const normalized = ref.toLowerCase();
    return entries.find(activity => {
      const id = String(activity?.id ?? activity?._id ?? "").toLowerCase();
      const identifier = String(activity?.identifier ?? activity?.system?.identifier ?? "").toLowerCase();
      const name = String(activity?.name ?? "").trim().toLowerCase();
      return id === normalized || identifier === normalized || name === normalized;
    }) ?? null;
  }

  #movementIsVoluntary(payload) {
    const agency = payload?.movementAgency;
    if ([MOVEMENT_AGENCIES.FORCED, MOVEMENT_AGENCIES.COMPELLED, MOVEMENT_AGENCIES.PASSENGER, MOVEMENT_AGENCIES.ADMINISTRATIVE].includes(agency)) return false;
    if (agency === MOVEMENT_AGENCIES.VOLUNTARY) return true;
    return ["dragging", "keyboard", "hud", "config"].includes(String(payload?.movementMethod ?? ""));
  }

  async #removeRegionRestraintsAsAuthority(regionUuid) {
    if (!this.#isPrimary()) return { removed: 0, reason: "not-primary-gm" };
    let removed = 0;
    for (const actor of [...(globalThis.game?.actors ?? [])]) {
      const ids = [...(actor?.effects ?? [])]
        .filter(effect => getProperty(effect, `flags.${MODULE_ID}.${WEB_FLAG_KEY}.regionUuid`) === regionUuid)
        .map(effect => effect.id)
        .filter(Boolean);
      if (!ids.length || !actor?.deleteEmbeddedDocuments) continue;
      await actor.deleteEmbeddedDocuments("ActiveEffect", ids, { ae5eWebRegionCleanup: true });
      removed += ids.length;
    }
    this.#stats.restraintsRemoved += removed;
    return { removed };
  }

  #isPrimary() {
    const primary = this.#authority?.getPrimaryGm?.() ?? null;
    if (primary) return Boolean(globalThis.game?.user?.isGM && globalThis.game.user.id === primary.id);
    return Boolean(globalThis.game?.user?.isGM);
  }
}
