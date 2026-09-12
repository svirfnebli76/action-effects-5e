import { Logger } from "../core/logger.js";
import { CROSSHAIR_3D_SHAPES } from "./geometry-service.js";
import { finiteNumber } from "./geometry-utils.js";

const DEFAULT_COLOR = "#7fefef";
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
      active: false,
      visualShape: null,
      file: null,
      resolution: null,
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
    const visualShape = visualShapeFor(shape);
    if (!visualShape) {
      await this.#endEffect(state);
      return Object.freeze({ artwork: false, guide: true, reason: "3d-guide-required" });
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
      return Object.freeze({ artwork: false, guide: true, reason: resolution?.reason ?? "asset-unavailable", resolution });
    }

    const metrics = this.#metrics.resolve();
    const pixel = this.#metrics.distanceToPixels(shape.origin, metrics);
    const size = sizeDataFor(shape, metrics);
    const yaw = finiteNumber(shape.yaw, 0) + finiteNumber(options.rotationOffset ?? state.options.rotationOffset, 0);
    const serial = ++state.updateSerial;

    try {
      if (!state.active || state.file !== resolution.file || state.visualShape !== visualShape) {
        await this.#endEffect(state);
        if (state.closed || serial !== state.updateSerial) return Object.freeze({ artwork: false, guide: true, reason: "stale-start" });
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
      } else {
        const updates = {
          source: { x: pixel.x, y: pixel.y },
          angle: yaw,
          elevation: { elevation: shape.origin.z, absolute: true }
        };
        if (size) updates.size = size;
        await globalThis.Sequencer?.EffectManager?.updateEffects?.({ name: state.effectName }, updates);
      }
      return Object.freeze({ artwork: true, guide: false, reason: "eskie", resolution });
    } catch (error) {
      Logger.warn("Action Effects 3D Crosshairs could not update accepted-state Eskie artwork; using AE5E guide fallback.", error);
      await this.#endEffect(state);
      return Object.freeze({ artwork: false, guide: true, reason: "visual-update-error", resolution });
    }
  }

  async clear(state) {
    if (!state || state.closed) return;
    state.closed = true;
    state.updateSerial += 1;
    await this.#endEffect(state);
    this.#sessions.delete(state.id);
  }

  getStats() {
    return Object.freeze({ sessions: this.#sessions.size, activeEffects: [...this.#sessions.values()].filter(session => session.active).length });
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
  }
}
