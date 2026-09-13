import { Logger } from "../core/logger.js";
import { CROSSHAIR_3D_SHAPES } from "./geometry-service.js";
import { finiteNumber } from "./geometry-utils.js";

const DEFAULT_COLOR = "#7fefef";
const DEFAULT_TRACER_COLOR = "#4A4A4A";
const PITCH_EPSILON = 1e-6;

function randomId() {
  try {
    return globalThis.foundry?.utils?.randomID?.(12) ?? crypto.randomUUID();
  } catch (_error) {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function visualShapeFor(shape) {
  switch (shape.type) {
    case CROSSHAIR_3D_SHAPES.SPHERE:
    case CROSSHAIR_3D_SHAPES.CYLINDER:
      return "circle";
    case CROSSHAIR_3D_SHAPES.PRISM:
    case CROSSHAIR_3D_SHAPES.LINE:
      return "rectangle";
    case CROSSHAIR_3D_SHAPES.CONE:
      return Math.abs(finiteNumber(shape.pitch)) <= PITCH_EPSILON ? "cone" : null;
    case CROSSHAIR_3D_SHAPES.RAY:
      return "ray";
    default:
      return null;
  }
}

function requestedSizeFor(shape) {
  switch (shape.type) {
    case CROSSHAIR_3D_SHAPES.SPHERE:
    case CROSSHAIR_3D_SHAPES.CYLINDER:
      return shape.radius * 2;
    case CROSSHAIR_3D_SHAPES.CONE:
      return shape.length;
    case CROSSHAIR_3D_SHAPES.RAY:
      return shape.length;
    case CROSSHAIR_3D_SHAPES.PRISM:
      return { width: shape.length, height: shape.width };
    case CROSSHAIR_3D_SHAPES.LINE:
      return { width: shape.length, height: shape.width };
    default:
      return null;
  }
}

function projectedRayLength(shape) {
  const pitch = (finiteNumber(shape.pitch) * Math.PI) / 180;
  return Math.max(shape.width, Math.abs(shape.length * Math.cos(pitch)) + Math.abs(shape.width * Math.sin(pitch)));
}

function sizeDataFor(shape, metrics) {
  const gridDistance = finiteNumber(metrics?.distance, 5);
  const toGrid = value => finiteNumber(value) / gridDistance;
  switch (shape.type) {
    case CROSSHAIR_3D_SHAPES.SPHERE:
    case CROSSHAIR_3D_SHAPES.CYLINDER: {
      const diameter = toGrid(shape.radius * 2);
      return { width: diameter, height: diameter, gridUnits: true };
    }
    case CROSSHAIR_3D_SHAPES.CONE: {
      // Eskie's authored cone files are square presentation assets whose authored
      // size corresponds to the cone's centerline length. Pitched cones never use
      // the flat artwork; the AE5E 3D guide takes over instead.
      const extent = toGrid(shape.length);
      return { width: extent, height: extent, gridUnits: true };
    }
    case CROSSHAIR_3D_SHAPES.RAY:
      return { width: toGrid(projectedRayLength(shape)), height: toGrid(shape.width), gridUnits: true };
    case CROSSHAIR_3D_SHAPES.PRISM:
    case CROSSHAIR_3D_SHAPES.LINE:
      return { width: toGrid(shape.length), height: toGrid(shape.width), gridUnits: true };
    default:
      return null;
  }
}

/**
 * Supplemental Eskie artwork for accepted Action Effects 3D Crosshairs states.
 *
 * The invisible Sequencer Crosshair remains the input carrier. This service owns
 * a separate named persistent CanvasEffect which is updated only after AE5E has
 * accepted a placement revision, so raw cursor motion never becomes authoritative
 * artwork. The retained AE5E PIXI guide remains the rules-geometry fallback.
 */
export class Crosshair3dPlacementVisualService {
  #crosshairs;
  #metrics;
  #sessions = new Map();

  constructor({ crosshairs, metrics }) {
    this.#crosshairs = crosshairs;
    this.#metrics = metrics;
  }

  createSession(options = {}) {
    const id = options.id ?? randomId();
    const state = {
      id,
      effectName: `action-effects-5e.crosshair3d.accepted.${id}`,
      tracerName: `action-effects-5e.crosshair3d.tracer.${id}`,
      active: false,
      tracerActive: false,
      visualShape: null,
      file: null,
      resolution: null,
      effectId: null,
      tracerEffectId: null,
      updateSerial: 0,
      closed: false,
      options
    };
    this.#sessions.set(id, state);
    return state;
  }

  async update(state, shapeInput, options = {}) {
    if (!state || state.closed) return Object.freeze({ artwork: false, guide: true, reason: "closed" });
    const shape = shapeInput;
    const tracer = await this.#updateTracer(state, shape, options);
    const visualShape = visualShapeFor(shape);
    if (!visualShape) {
      await this.#endEffect(state);
      return Object.freeze({ artwork: false, guide: true, tracer, reason: "3d-guide-required" });
    }

    const request = {
      shape: visualShape,
      style: options.style ?? state.options.style ?? "fantasy_01",
      base: options.base ?? state.options.base ?? "full",
      color: options.color ?? state.options.color ?? DEFAULT_COLOR,
      size: options.size ?? requestedSizeFor(shape),
      sizeStrategy: options.sizeStrategy ?? state.options.sizeStrategy ?? "nearest"
    };
    const resolution = this.#crosshairs?.resolveAsset?.(request) ?? null;
    if (!resolution?.file || resolution.nativeFallback) {
      await this.#endEffect(state);
      return Object.freeze({ artwork: false, guide: true, tracer, reason: resolution?.reason ?? "asset-unavailable", resolution });
    }

    const metrics = this.#metrics.resolve();
    const pixel = this.#metrics.distanceToPixels(shape.origin, metrics);
    const size = sizeDataFor(shape, metrics);
    const yaw = finiteNumber(shape.yaw, 0) + finiteNumber(options.rotationOffset ?? state.options.rotationOffset, 0);
    const serial = ++state.updateSerial;

    try {
      if (!state.active || state.file !== resolution.file || state.visualShape !== visualShape) {
        await this.#endEffect(state);
        if (state.closed || serial !== state.updateSerial) return Object.freeze({ artwork: false, guide: true, tracer, reason: "stale-start" });
        const sequence = new globalThis.Sequence();
        let section = sequence
          .effect()
            .name(state.effectName)
            .file(resolution.file)
            .atLocation({ x: pixel.x, y: pixel.y })
            .elevation(shape.origin.z, { absolute: true })
            .rotate(yaw)
            .opacity(Number(options.opacity ?? state.options.opacity ?? 0.8))
            .locally()
            .persist();
        if (size && typeof section.size === "function") {
          section = section.size({ width: size.width, height: size.height }, { gridUnits: true });
        }
        if (resolution.tint && typeof section.tint === "function") section = section.tint(resolution.tint);
        if ((options.belowTokens ?? state.options.belowTokens) !== false && typeof section.belowTokens === "function") section = section.belowTokens();
        await sequence.play();
        state.active = true;
        state.file = resolution.file;
        state.visualShape = visualShape;
        state.resolution = resolution;
        state.effectId = this.#findEffect(state)?.id ?? null;
      } else {
        const updated = await this.#updateEffectInPlace(state, { pixel, yaw, elevation: shape.origin.z, size });
        if (!updated) {
          await this.#endEffect(state);
          return Object.freeze({ artwork: false, guide: true, tracer, reason: "in-place-update-unavailable", resolution });
        }
      }
      return Object.freeze({ artwork: true, guide: false, tracer, reason: "eskie", resolution });
    } catch (error) {
      Logger.warn("Action Effects 3D Crosshairs could not update accepted-state Eskie artwork; using AE5E guide fallback.", error);
      await this.#endEffect(state);
      return Object.freeze({ artwork: false, guide: true, tracer, reason: "visual-update-error", resolution });
    }
  }

  async clear(state) {
    if (!state || state.closed) return;
    state.closed = true;
    state.updateSerial += 1;
    await this.#endEffect(state);
    await this.#endTracer(state);
    this.#sessions.delete(state.id);
  }

  getStats() {
    return Object.freeze({
      sessions: this.#sessions.size,
      activeEffects: [...this.#sessions.values()].filter(session => session.active).length,
      activeTracers: [...this.#sessions.values()].filter(session => session.tracerActive).length
    });
  }

  async #updateTracer(state, shape, options = {}) {
    if ((options.tracer ?? state.options.tracer) === false || !state.options.source) {
      await this.#endTracer(state);
      return false;
    }

    const tracerColor = options.tracerColor ?? state.options.tracerColor ?? DEFAULT_TRACER_COLOR;
    const resolution = this.#crosshairs?.resolveAsset?.({
      shape: "line",
      style: options.tracerStyle ?? state.options.tracerStyle ?? "generic_01",
      size: options.tracerSize ?? state.options.tracerSize ?? "90ft",
      color: tracerColor,
      tint: tracerColor,
      sizeStrategy: "nearest"
    }) ?? null;
    if (!resolution?.file || resolution.nativeFallback) {
      await this.#endTracer(state);
      return false;
    }

    const metrics = this.#metrics.resolve();
    const pixel = this.#metrics.distanceToPixels(shape.origin, metrics);
    const target = { x: pixel.x, y: pixel.y };

    try {
      if (!state.tracerActive) {
        const sequence = new globalThis.Sequence();
        let section = sequence
          .effect()
            .name(state.tracerName)
            .file(resolution.file)
            .attachTo(state.options.source)
            .stretchTo(target, { attachTo: true })
            .opacity(Number(options.tracerOpacity ?? state.options.tracerOpacity ?? 0.8))
            .locally()
            .persist();
        if (resolution.tint && typeof section.tint === "function") section = section.tint(resolution.tint);
        if (typeof section.belowTokens === "function") section = section.belowTokens();
        await sequence.play();
        state.tracerActive = true;
        state.tracerEffectId = this.#findNamedEffect(state.tracerName, state.tracerEffectId)?.id ?? null;
        return true;
      }

      const effect = this.#findNamedEffect(state.tracerName, state.tracerEffectId);
      if (!effect?.data || typeof effect._transformSprite !== "function") {
        await this.#endTracer(state);
        return false;
      }
      effect.data.target = target;
      effect._target = target;
      if (effect._cachedTargetData) effect._cachedTargetData.position = target;
      await effect._transformSprite();
      state.tracerEffectId = effect.id ?? state.tracerEffectId;
      return true;
    } catch (error) {
      Logger.debug("Could not update the Action Effects 3D Crosshairs source tracer in place.", error);
      await this.#endTracer(state);
      return false;
    }
  }

  #findNamedEffect(name, effectId = null) {
    const manager = globalThis.Sequencer?.EffectManager;
    if (typeof manager?.getEffects !== "function") return null;
    try {
      const effects = manager.getEffects({ name }) ?? [];
      if (effectId) return effects.find(effect => effect?.id === effectId) ?? effects[0] ?? null;
      return effects[0] ?? null;
    } catch (_error) {
      return null;
    }
  }

  #findEffect(state) {
    return this.#findNamedEffect(state.effectName, state.effectId);
  }

  async #updateEffectInPlace(state, { pixel, yaw, elevation, size }) {
    const effect = this.#findEffect(state);
    if (!effect?.data || typeof effect._transformSprite !== "function") return false;

    // Sequencer 4.2.x EffectManager.updateEffects() intentionally reinitializes
    // CanvasEffect media. That is correct for document-like persistent updates,
    // but causes a visible one-frame-or-longer blink during interactive placement.
    // The Checkpoint 2 artwork is local and session-owned, so update only the
    // existing CanvasEffect transform data and re-run its transform pass without
    // destroying/recreating the sprite or restarting its WebM playback.
    const source = { x: pixel.x, y: pixel.y };
    effect.data.source = source;
    effect._source = source;
    if (effect._cachedSourceData) effect._cachedSourceData.position = source;
    effect.data.angle = yaw;
    effect._customAngle = yaw;
    effect.data.elevation = { elevation, absolute: true };
    if ("elevation" in effect) effect.elevation = elevation;
    if (size) effect.data.size = { width: size.width, height: size.height, gridUnits: true };

    await effect._transformSprite();
    state.effectId = effect.id ?? state.effectId;
    return true;
  }

  async #endTracer(state) {
    if (!state?.tracerActive) return;
    try {
      await globalThis.Sequencer?.EffectManager?.endEffects?.({ name: state.tracerName });
    } catch (error) {
      Logger.debug("Could not end 3D Crosshairs source tracer cleanly.", error);
    }
    state.tracerActive = false;
    state.tracerEffectId = null;
  }

  async #endEffect(state) {
    if (!state?.active) return;
    try {
      await globalThis.Sequencer?.EffectManager?.endEffects?.({ name: state.effectName });
    } catch (error) {
      Logger.debug("Could not end accepted-state 3D Crosshairs artwork cleanly.", error);
    }
    state.active = false;
    state.file = null;
    state.visualShape = null;
    state.resolution = null;
    state.effectId = null;
  }
}
