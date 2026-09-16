import { Logger } from "../core/logger.js";
import { MODULE_ID, SETTINGS } from "../core/constants.js";
import { CROSSHAIR_3D_SHAPES } from "./geometry-service.js";
import { finiteNumber, normalizeDegrees } from "./geometry-utils.js";

function tokenIds(tokens) {
  return Array.from(tokens ?? []).map(token => token?.id ?? token?.document?.id).filter(Boolean);
}

function unique(values) {
  return [...new Set(values)];
}

function sameIds(a, b) {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((id, index) => id === right[index]);
}

function sourceTokenOf(value) {
  return value?.object ?? value?.document?.object ?? value ?? null;
}

function shapeFunctionalType(type) {
  switch (type) {
    case CROSSHAIR_3D_SHAPES.SPHERE:
    case CROSSHAIR_3D_SHAPES.CYLINDER: return "circle";
    case CROSSHAIR_3D_SHAPES.CONE: return "cone";
    case CROSSHAIR_3D_SHAPES.RAY: return "ray";
    case CROSSHAIR_3D_SHAPES.PRISM:
    case CROSSHAIR_3D_SHAPES.LINE: return "ray";
    default: return "circle";
  }
}

function defaultCapabilities(type) {
  return Object.freeze({
    elevation: true,
    rotation: [CROSSHAIR_3D_SHAPES.PRISM, CROSSHAIR_3D_SHAPES.CONE, CROSSHAIR_3D_SHAPES.RAY, CROSSHAIR_3D_SHAPES.LINE].includes(type),
    los: false
  });
}

export class Crosshair3dPlacementSessionService {
  #crosshairs;
  #geometry;
  #cells;
  #tokens;
  #range;
  #revisions;
  #targeting;
  #metrics;
  #surfaces;
  #overlay;
  #elevationGauge;
  #guide;
  #visuals;
  #active = null;
  #stats = { sessions: 0, confirmed: 0, cancelled: 0, errors: 0, revisions: 0, targetRecalculations: 0, staleDiscards: 0, wheelEvents: 0 };

  constructor({ crosshairs, geometry, cells, tokens, range, revisions, targeting, metrics, surfaces, overlay, elevationGauge = null, guide, visuals = null }) {
    this.#crosshairs = crosshairs;
    this.#geometry = geometry;
    this.#cells = cells;
    this.#tokens = tokens;
    this.#range = range;
    this.#revisions = revisions;
    this.#targeting = targeting;
    this.#metrics = metrics;
    this.#surfaces = surfaces;
    this.#overlay = overlay;
    this.#elevationGauge = elevationGauge;
    this.#guide = guide;
    this.#visuals = visuals;
  }

  async show(options = {}) {
    if (this.#active) throw new Error("Only one local Action Effects 3D Crosshairs placement session may be active at a time.");
    if (!globalThis.canvas?.ready) throw new Error("Action Effects 3D Crosshairs requires an active Scene canvas.");
    if (!globalThis.Sequencer?.Crosshair?.show) throw new Error("Action Effects 3D Crosshairs requires Sequencer Crosshair.show().");

    const source = sourceTokenOf(options.source);
    if (!source?.document) throw new Error("Action Effects 3D Crosshairs requires a source Token.");
    const baseShape = this.#geometry.normalizeShape(options.shape ?? {});
    const metrics = this.#metrics.resolve();
    const capabilities = Object.freeze({ ...defaultCapabilities(baseShape.type), ...(options.capabilities ?? {}) });
    const self = options.self === true || options.originMode === "self" || [CROSSHAIR_3D_SHAPES.CONE, CROSSHAIR_3D_SHAPES.RAY].includes(baseShape.type) && options.remote !== true;
    const originalTargetIds = tokenIds(globalThis.game?.user?.targets);
    const sourceVolume = this.#tokens.resolve(source, { grid: metrics, coordinateSpace: "pixels" });
    const initialHeadingYaw = normalizeDegrees(baseShape.yaw ?? source.document.rotation ?? 0);
    const initialArcPitch = finiteNumber(baseShape.pitch);
    const initialOrientation = this.#canonicalSelfOrientation(initialHeadingYaw, initialArcPitch);
    const initialYaw = self ? initialOrientation.yaw : initialHeadingYaw;
    const initialPitch = self ? initialOrientation.pitch : finiteNumber(baseShape.pitch);
    const initialApex = self ? this.#resolveSelfApex(source, initialYaw, initialPitch, metrics, sourceVolume) : null;
    const initialPoint = self ? initialApex : { ...baseShape.origin };
    const initialState = this.#revisions.create({
      point: initialPoint,
      yaw: initialYaw,
      pitch: initialPitch,
      headingYaw: initialHeadingYaw,
      arcPitch: initialArcPitch,
      endpointZ: self && [CROSSHAIR_3D_SHAPES.CONE, CROSSHAIR_3D_SHAPES.RAY].includes(baseShape.type)
        ? initialPoint.z + (Math.sin((initialPitch * Math.PI) / 180) * baseShape.length)
        : null,
      selectedAbsoluteZ: initialPoint.z,
      elevationPhase: null,
      elevationRadius: null,
      manualElevation: false,
      shape: baseShape,
      targets: Object.freeze([]),
      valid: true
    });

    const session = {
      id: globalThis.foundry?.utils?.randomID?.(12) ?? `${Date.now()}-${Math.random()}`,
      options,
      source,
      sourceVolume,
      metrics,
      baseShape,
      capabilities,
      self,
      originalTargetIds,
      current: initialState,
      intent: {
        point: initialPoint,
        yaw: initialYaw,
        headingYaw: initialHeadingYaw,
        pitch: initialPitch,
        arcPitch: initialArcPitch,
        endpointZ: initialState.endpointZ,
        selectedAbsoluteZ: initialPoint.z,
        elevationPhase: null,
        elevationRadius: null,
        manualElevation: false
      },
      requestedSerial: 0,
      resolvedSerial: 0,
      pending: null,
      resolving: false,
      closed: false,
      carrier: null,
      listeners: [],
      modifier: { shift: false, ctrl: false },
      carrierSuppressionUntil: 0,
      mode: "MOVE",
      lastTargetIds: [...originalTargetIds],
      elevationArc: null,
      finalBarrier: Promise.resolve(),
      result: null,
      visualState: this.#visuals?.createSession?.({ id: globalThis.foundry?.utils?.randomID?.(12), ...(options.visual ?? {}), source }) ?? null
    };
    this.#active = session;
    this.#stats.sessions += 1;

    const hints = [];
    if (capabilities.rotation) hints.push("Hold Shift + Mousewheel to Rotate");
    if (capabilities.elevation) hints.push("Hold Ctrl + Mousewheel to Elevate/Lower");
    hints.push("Right Click to Cancel");
    this.#overlay.show({ mode: "MOVE", hints });
    this.#elevationGauge?.show?.({ enabled: capabilities.elevation });
    this.#guide.show();
    this.#installInput(session);

    try {
      const result = await this.#showFunctionalCrosshair(session);
      if (!result || result.cancelled || !result.position) {
        this.#stats.cancelled += 1;
        await this.#replaceUserTargets(session.originalTargetIds);
        return Object.freeze({ cancelled: true, revision: session.current, targets: Object.freeze([]), shape: session.current.shape });
      }

      await session.finalBarrier;
      await this.#requestResolution(session, { carrier: result.position, reason: "final-confirm", force: true });
      await session.finalBarrier;
      if (!session.current?.valid) {
        await this.#replaceUserTargets(session.originalTargetIds);
        this.#stats.cancelled += 1;
        return Object.freeze({ cancelled: true, invalid: true, revision: session.current, targets: Object.freeze([]), shape: session.current.shape });
      }
      this.#stats.confirmed += 1;
      const targets = Object.freeze([...(session.current.targets ?? [])]);
      return Object.freeze({
        cancelled: false,
        revision: session.current,
        shape: session.current.shape,
        targets,
        targetIds: Object.freeze(tokenIds(targets)),
        targetUuids: Object.freeze(targets.map(token => token?.document?.uuid ?? token?.uuid).filter(Boolean)),
        placementPoint: Object.freeze({ ...session.current.point }),
        yaw: session.current.yaw,
        pitch: session.current.pitch
      });
    } catch (error) {
      this.#stats.errors += 1;
      await this.#replaceUserTargets(session.originalTargetIds);
      Logger.error("Action Effects 3D Crosshairs placement failed.", error);
      throw error;
    } finally {
      await this.#cleanup(session);
    }
  }

  getStats() {
    return Object.freeze({ ...this.#stats, active: Boolean(this.#active), activeSessionId: this.#active?.id ?? null });
  }

  async #showFunctionalCrosshair(session) {
    const callbacks = globalThis.Sequencer.Crosshair.CALLBACKS ?? {};
    const callbackConfig = {};
    const request = crosshair => {
      if (Date.now() < session.carrierSuppressionUntil) return session.current;
      return this.#requestResolution(session, { carrier: crosshair, reason: "move" });
    };
    if (callbacks.SHOW) callbackConfig[callbacks.SHOW] = async crosshair => {
      session.carrier = crosshair;
      await request(crosshair);
    };
    if (callbacks.MOVE) callbackConfig[callbacks.MOVE] = request;
    if (callbacks.MOUSE_MOVE) callbackConfig[callbacks.MOUSE_MOVE] = crosshair => {
      if (session.mode !== "MOVE") this.#syncCarrierToRevision(session, crosshair, session.current);
    };
    if (callbacks.PLACED) callbackConfig[callbacks.PLACED] = async crosshair => {
      // A rapid wheel burst may still be resolving when the click arrives. Let
      // the newest requested manipulation publish first so the invisible carrier
      // is synchronized to that authoritative state before final reconciliation.
      await session.finalBarrier;
      await this.#requestResolution(session, { carrier: crosshair, reason: "placed-callback", force: true });
      await session.finalBarrier;
      return session.current?.valid === false ? false : undefined;
    };

    const shape = session.baseShape;
    const projectedDistance = this.#projectedDistance(shape.length ?? shape.radius ?? Math.max(shape.width ?? 0, shape.length ?? 0), shape.pitch ?? 0, session.metrics.distance);
    const location = session.self
      ? { obj: session.source, lockToEdge: true, lockToEdgeDirection: false }
      : {};
    if (session.capabilities.los && session.self) {
      location.wallBehavior = globalThis.Sequencer.Crosshair.PLACEMENT_RESTRICTIONS?.LINE_OF_SIGHT;
    }

    const crosshairConfig = {
      t: shapeFunctionalType(shape.type),
      distance: Math.max(session.metrics.distance, finiteNumber(projectedDistance, session.metrics.distance)),
      width: finiteNumber(shape.width, session.metrics.distance),
      borderAlpha: 0,
      fillAlpha: 0,
      gridHighlight: false,
      location,
      snap: { resolution: 8, direction: 5 }
    };
    return globalThis.Sequencer.Crosshair.show(crosshairConfig, callbackConfig).then(position => ({ position, cancelled: !position }));
  }

  #installInput(session) {
    const window = globalThis.window;
    if (!window?.addEventListener) return;
    const setMode = next => {
      session.mode = next;
      this.#overlay.update({ mode: next });

      if (next === "ELEVATE" && session.capabilities.elevation) {
        if (!session.self) this.#ensureRemoteElevationArc(session, session.current?.point ?? session.intent?.point);
        this.#elevationGauge?.update?.(this.#elevationGaugeState(session, session.current));
      } else {
        this.#elevationGauge?.update?.({ visible: false });
      }
    };
    const updateMode = () => {
      const next = session.modifier.ctrl && session.modifier.shift ? "MOVE" : session.modifier.ctrl ? "ELEVATE" : session.modifier.shift ? "ROTATE" : "MOVE";
      setMode(next);
    };
    // Alt has no Action Effects 3D Crosshairs function. On Windows/Chromium,
    // allowing Alt to reach the host menu/focus machinery can disturb later
    // modifier keyup delivery. During an active placement session AE5E therefore
    // suppresses Alt itself at the capture stage instead of trying to reconstruct
    // modifier state afterward. Ctrl/Shift keyboard events and wheel events remain
    // authoritative; ordinary pointer movement never changes placement mode.
    const suppressAlt = event => {
      if (event?.key !== "Alt") return false;
      event.preventDefault?.();
      event.stopPropagation?.();
      event.stopImmediatePropagation?.();
      return true;
    };
    const syncModifiers = (event, keyIsDown = null) => {
      let shift = Boolean(event?.shiftKey);
      let ctrl = Boolean(event?.ctrlKey);
      if (event?.key === "Shift" && keyIsDown !== null) shift = keyIsDown;
      if (event?.key === "Control" && keyIsDown !== null) ctrl = keyIsDown;
      const changed = shift !== session.modifier.shift || ctrl !== session.modifier.ctrl;
      session.modifier.shift = shift;
      session.modifier.ctrl = ctrl;
      return changed;
    };
    const keydown = event => {
      if (suppressAlt(event)) return;
      syncModifiers(event, true);
      updateMode();
    };
    const keyup = event => {
      if (suppressAlt(event)) return;
      syncModifiers(event, false);
      updateMode();
    };
    const blur = () => {
      session.modifier.shift = false;
      session.modifier.ctrl = false;
      updateMode();
    };
    const wheel = event => {
      if (session.closed) return;
      // Wheel modifier flags describe the physical state for this exact input.
      // Resynchronize before deciding whether AE5E should intercept the wheel.
      if (syncModifiers(event)) updateMode();
      const modified = session.modifier.shift || session.modifier.ctrl;
      if (!modified) return;
      event.preventDefault?.();
      event.stopPropagation?.();
      event.stopImmediatePropagation?.();
      this.#stats.wheelEvents += 1;
      if (session.modifier.shift && session.modifier.ctrl) {
        setMode("MOVE");
        return;
      }
      const step = event.deltaY < 0 ? 1 : -1;
      if (session.modifier.shift && session.capabilities.rotation) {
        setMode("ROTATE");
        const headingYaw = normalizeDegrees(finiteNumber(session.intent.headingYaw, session.intent.yaw) + (step * 5));
        const orientation = session.self
          ? this.#canonicalSelfOrientation(headingYaw, session.intent.arcPitch)
          : { yaw: headingYaw, pitch: session.intent.pitch };
        Object.assign(session.intent, { headingYaw, yaw: orientation.yaw, pitch: orientation.pitch });
        this.#requestResolution(session, { statePatch: { headingYaw, yaw: orientation.yaw, pitch: orientation.pitch }, reason: "wheel-rotate", force: true });
        return;
      }
      if (session.modifier.ctrl && session.capabilities.elevation) {
        setMode("ELEVATE");
        const elevationStep = this.#reverseElevationWheelEnabled() ? -step : step;
        this.#requestElevationStep(session, elevationStep);
      }
    };
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("keyup", keyup, true);
    window.addEventListener("blur", blur, true);
    window.addEventListener("wheel", wheel, { capture: true, passive: false });
    session.listeners.push(
      ["keydown", keydown, true],
      ["keyup", keyup, true],
      ["blur", blur, true],
      ["wheel", wheel, { capture: true }]
    );
  }

  #ensureRemoteElevationArc(session, pointInput = null) {
    if (session.elevationArc) return session.elevationArc;
    const state = session.intent;
    const point = pointInput ?? state?.point;
    if (!point) return null;

    const anchor = this.#range.nearestPointOnVolume(session.sourceVolume, point);
    const radius = this.#range.distanceBetweenPoints(anchor, point);
    const dx = finiteNumber(point.x) - finiteNumber(anchor.x);
    const dy = finiteNumber(point.y) - finiteNumber(anchor.y);
    const horizontal = Math.hypot(dx, dy);
    const unit = horizontal > 1e-9
      ? { x: dx / horizontal, y: dy / horizontal }
      : { x: Math.cos((finiteNumber(state?.yaw) * Math.PI) / 180), y: Math.sin((finiteNumber(state?.yaw) * Math.PI) / 180) };
    const phase = radius > 1e-9
      ? normalizeDegrees((Math.atan2(finiteNumber(point.z) - finiteNumber(anchor.z), horizontal) * 180) / Math.PI)
      : 0;
    session.elevationArc = { anchor, radius, unit, phase };
    return session.elevationArc;
  }

  #requestElevationStep(session, step) {
    const state = session.intent;
    if (session.self && [CROSSHAIR_3D_SHAPES.CONE, CROSSHAIR_3D_SHAPES.RAY].includes(session.baseShape.type)) {
      const length = session.baseShape.length;
      const arcPitch = this.#stepArcPitch(finiteNumber(state.arcPitch, state.pitch), step, length, session.metrics.distance);
      const headingYaw = finiteNumber(state.headingYaw, state.yaw);
      const orientation = this.#canonicalSelfOrientation(headingYaw, arcPitch);
      const point = this.#resolveSelfApex(session.source, orientation.yaw, orientation.pitch, session.metrics, session.sourceVolume);
      const endpointZ = point.z + (Math.sin((orientation.pitch * Math.PI) / 180) * length);
      Object.assign(session.intent, {
        point,
        headingYaw,
        yaw: orientation.yaw,
        pitch: orientation.pitch,
        arcPitch,
        endpointZ,
        manualElevation: true
      });
      this.#requestResolution(session, {
        statePatch: { point, headingYaw, yaw: orientation.yaw, pitch: orientation.pitch, arcPitch, endpointZ, manualElevation: true },
        reason: "wheel-pitch",
        force: true
      });
      return;
    }

    const arc = this.#ensureRemoteElevationArc(session, state.point);
    if (!arc || arc.radius <= 1e-9) return;
    const snapped = this.#stepRemoteElevationSnap(arc.phase, step, arc.anchor.z, arc.radius, session.metrics.distance);
    const phase = snapped.phase;
    arc.phase = phase;
    const radians = (phase * Math.PI) / 180;
    const horizontalMagnitude = Math.sqrt(Math.max(0, (arc.radius * arc.radius) - ((snapped.z - arc.anchor.z) ** 2)));
    const signedHorizontal = Math.cos(radians) < 0 ? -horizontalMagnitude : horizontalMagnitude;
    const z = snapped.z;
    const point = {
      x: arc.anchor.x + (arc.unit.x * signedHorizontal),
      y: arc.anchor.y + (arc.unit.y * signedHorizontal),
      z
    };
    Object.assign(session.intent, { point, selectedAbsoluteZ: z, elevationPhase: phase, elevationRadius: arc.radius, manualElevation: true });
    this.#requestResolution(session, {
      statePatch: { point, selectedAbsoluteZ: z, elevationPhase: phase, elevationRadius: arc.radius, manualElevation: true },
      reason: "wheel-elevate",
      force: true
    });
  }

  async #requestResolution(session, request = {}) {
    if (session.closed) return null;
    const serial = ++session.requestedSerial;
    session.pending = { ...request, serial };
    const barrier = this.#drain(session);
    session.finalBarrier = barrier;
    return barrier;
  }

  async #drain(session) {
    if (session.resolving) return session.finalBarrier;
    session.resolving = true;
    try {
      while (session.pending && !session.closed) {
        const request = session.pending;
        session.pending = null;
        const resolved = await this.#resolveRequest(session, request);
        if (request.serial < session.requestedSerial && session.pending) {
          this.#stats.staleDiscards += 1;
          continue;
        }
        if (!resolved) continue;
        session.current = resolved;
        session.resolvedSerial = request.serial;
        await this.#publish(session, resolved);
      }
    } finally {
      session.resolving = false;
    }
    return session.current;
  }

  async #resolveRequest(session, request) {
    const previous = session.current;
    let patch = { ...(request.statePatch ?? {}) };
    const carrier = request.carrier?.document ?? request.carrier;
    const intended = session.intent;

    if (carrier && session.mode === "MOVE" && !request.statePatch?.point) {
      if (session.self && [CROSSHAIR_3D_SHAPES.CONE, CROSSHAIR_3D_SHAPES.RAY].includes(session.baseShape.type)) {
        const effectiveYaw = normalizeDegrees(carrier.direction ?? intended.yaw);
        const flipped = Math.abs(finiteNumber(intended.arcPitch, intended.pitch)) > 90;
        const headingYaw = normalizeDegrees(effectiveYaw - (flipped ? 180 : 0));
        const orientation = this.#canonicalSelfOrientation(headingYaw, intended.arcPitch);
        patch.headingYaw = headingYaw;
        patch.yaw = orientation.yaw;
        patch.pitch = orientation.pitch;
        patch.point = this.#resolveSelfApex(session.source, patch.yaw, patch.pitch, session.metrics, session.sourceVolume);
        Object.assign(session.intent, { headingYaw, yaw: patch.yaw, pitch: patch.pitch, point: patch.point });
      } else {
        const pixelPoint = { x: finiteNumber(carrier.x), y: finiteNumber(carrier.y) };
        const point = this.#resolveRemoteMovePoint(session, pixelPoint, previous.point.z);
        patch.point = point;
        patch.selectedAbsoluteZ = intended.manualElevation ? intended.selectedAbsoluteZ : point.z;
        patch.elevationPhase = null;
        patch.elevationRadius = null;
        patch.yaw = normalizeDegrees(intended.yaw);
        Object.assign(session.intent, { point: patch.point, selectedAbsoluteZ: patch.selectedAbsoluteZ, elevationPhase: null, elevationRadius: null, yaw: patch.yaw });
        session.elevationArc = null;
      }
    }

    const merged = {
      point: patch.point ?? intended.point,
      headingYaw: normalizeDegrees(patch.headingYaw ?? intended.headingYaw ?? patch.yaw ?? intended.yaw),
      yaw: normalizeDegrees(patch.yaw ?? intended.yaw),
      pitch: finiteNumber(patch.pitch ?? intended.pitch),
      arcPitch: finiteNumber(patch.arcPitch ?? intended.arcPitch ?? patch.pitch ?? intended.pitch),
      endpointZ: patch.endpointZ ?? intended.endpointZ,
      selectedAbsoluteZ: patch.selectedAbsoluteZ ?? intended.selectedAbsoluteZ,
      elevationPhase: patch.elevationPhase ?? intended.elevationPhase ?? null,
      elevationRadius: patch.elevationRadius ?? intended.elevationRadius ?? null,
      manualElevation: patch.manualElevation ?? intended.manualElevation
    };
    if (session.self && [CROSSHAIR_3D_SHAPES.CONE, CROSSHAIR_3D_SHAPES.RAY].includes(session.baseShape.type)) {
      const orientation = this.#canonicalSelfOrientation(merged.headingYaw, merged.arcPitch);
      merged.yaw = orientation.yaw;
      merged.pitch = orientation.pitch;
      merged.point = this.#resolveSelfApex(session.source, merged.yaw, merged.pitch, session.metrics, session.sourceVolume);
      merged.endpointZ = merged.point.z + (Math.sin((merged.pitch * Math.PI) / 180) * session.baseShape.length);
    }
    Object.assign(session.intent, merged);

    const shape = this.#shapeForState(session.baseShape, merged);
    const valid = this.#validateLos(session, merged.point);
    let targets = previous.targets;
    if (valid) {
      targets = await this.#collectTargets(session, shape);
      this.#stats.targetRecalculations += 1;
    } else targets = Object.freeze([]);

    const revised = this.#revisions.revise(previous, { ...merged, shape, valid, targets, reason: request.reason ?? "revision" });
    this.#stats.revisions += 1;
    return revised;
  }

  #shapeForState(base, state) {
    const common = { ...base, origin: state.point };
    if ([CROSSHAIR_3D_SHAPES.PRISM, CROSSHAIR_3D_SHAPES.LINE].includes(base.type)) common.yaw = state.yaw;
    if ([CROSSHAIR_3D_SHAPES.CONE, CROSSHAIR_3D_SHAPES.RAY].includes(base.type)) { common.yaw = state.yaw; common.pitch = state.pitch; }
    return this.#geometry.normalizeShape(common);
  }

  #resolveRemoteMovePoint(session, pixelPoint, fallbackElevation) {
    const max = finiteNumber(session.options.range?.max ?? session.options.maxRange, Infinity);
    const pointAt = (pixel) => {
      const surface = this.#surfaces.resolveAt({ x: pixel.x, y: pixel.y, fallbackElevation });
      const z = session.intent.manualElevation
        ? Math.max(finiteNumber(session.intent.selectedAbsoluteZ, surface.elevation), surface.elevation)
        : surface.elevation;
      return this.#metrics.pixelsToDistance({ x: pixel.x, y: pixel.y, elevation: z }, session.metrics);
    };

    const requested = pointAt(pixelPoint);
    if (!Number.isFinite(max) || max <= 0 || this.#range.distanceFromVolumeToPoint(session.sourceVolume, requested) <= max) return requested;

    // Range is true XYZ, but MOVE remains constrained to the currently selected
    // Z plane (or the physical surface when it rises above that plane). Find
    // the farthest legal XY point along the requested horizontal direction and
    // re-resolve the surface at each probe so snapping/range cannot disagree.
    const anchor = this.#range.nearestPointOnVolume(session.sourceVolume, requested);
    const anchorPixel = this.#metrics.distanceToPixels(anchor, session.metrics);
    let low = 0;
    let high = 1;
    let best = pointAt({ x: anchorPixel.x, y: anchorPixel.y });
    if (this.#range.distanceFromVolumeToPoint(session.sourceVolume, best) > max) {
      // A manually selected Z plane can theoretically become illegal if Scene
      // geometry changes underneath it. Fail closed at the current accepted
      // point rather than silently altering the selected Z.
      return session.current?.point ?? requested;
    }
    for (let i = 0; i < 24; i += 1) {
      const t = (low + high) / 2;
      const probePixel = {
        x: anchorPixel.x + ((pixelPoint.x - anchorPixel.x) * t),
        y: anchorPixel.y + ((pixelPoint.y - anchorPixel.y) * t)
      };
      const probe = pointAt(probePixel);
      if (this.#range.distanceFromVolumeToPoint(session.sourceVolume, probe) <= max) {
        low = t;
        best = probe;
      } else high = t;
    }
    return best;
  }

  #validateLos(session, point) {
    if (!session.capabilities.los) return true;
    const pixel = this.#metrics.distanceToPixels(point, session.metrics);
    const vision = session.source?.vision;
    if (typeof vision?.testPoint !== "function") return true;
    try { return Boolean(vision.testPoint({ x: pixel.x, y: pixel.y, elevation: point.z })); }
    catch (_error) { return false; }
  }

  async #collectTargets(session, shape) {
    const candidates = Array.from(globalThis.canvas?.tokens?.placeables ?? []);
    const result = [];
    for (const token of candidates) {
      if (!token?.actor || token.id === session.source.id && session.options.includeSource !== true) continue;
      if (typeof globalThis.MidiQOL?.isTargetable === "function" && !globalThis.MidiQOL.isTargetable(token)) continue;
      if (typeof session.options.targetFilter === "function" && !(await session.options.targetFilter(token, { shape, sessionId: session.id }))) continue;
      const volume = this.#tokens.resolve(token, { grid: session.metrics, coordinateSpace: "pixels" });
      if (!volume) continue;
      if (this.#targeting.testVolume(shape, volume, { grid: session.metrics.grid })) result.push(token);
    }
    return Object.freeze(result);
  }

  async #publish(session, revision) {
    const visualResult = session.visualState && this.#visuals
      ? await this.#visuals.update(session.visualState, revision.shape, session.options.visual ?? {})
      : { artwork: false, guide: true };

    const targetIds = tokenIds(revision.targets);
    if (!sameIds(targetIds, session.lastTargetIds)) {
      await this.#replaceUserTargets(targetIds);
      session.lastTargetIds = [...targetIds];
    }

    if (visualResult.guide !== false) this.#guide.update(revision.shape, { color: session.options.guideColor ?? 0x7fefef });
    else this.#guide.clearDrawing?.();

    const pixel = this.#metrics.distanceToPixels(revision.point, session.metrics);
    this.#overlay.update({
      mode: session.mode,
      elevation: revision.point.z,
      originElevation: session.sourceVolume?.bottom,
      point: pixel,
      gridSize: session.metrics.size,
      footprintRadiusPx: this.#overlayFootprintRadiusPixels(revision.shape, session.metrics)
    });
    this.#elevationGauge?.update?.(this.#elevationGaugeState(session, revision));
    this.#syncCarrierToRevision(session, session.carrier, revision);
    if (typeof session.options.onRevision === "function") {
      try { session.options.onRevision(revision); } catch (error) { Logger.warn("3D Crosshairs onRevision callback failed.", error); }
    }
  }

  #elevationGaugeState(session, revision) {
    const point = revision?.point ?? session.intent?.point ?? { x: 0, y: 0, z: 0 };
    const configuredRange = finiteNumber(session.options?.range?.max ?? session.options?.maxRange, NaN);

    // Self Cone/Ray uses the spell/effect endpoint as B. The apex remains A,
    // while the pitch arc supplies the side-view angle.
    if (session.self && [CROSSHAIR_3D_SHAPES.CONE, CROSSHAIR_3D_SHAPES.RAY].includes(session.baseShape.type)) {
      const distance = Math.max(0, finiteNumber(session.baseShape.length));
      const endpointZ = finiteNumber(revision?.endpointZ, point.z);
      const elevationDelta = endpointZ - finiteNumber(point.z);
      return Object.freeze({
        distance,
        maxRange: Number.isFinite(configuredRange) && configuredRange > 0 ? configuredRange : distance,
        angle: normalizeDegrees(revision?.arcPitch ?? revision?.pitch),
        elevationDelta,
        belowOrigin: endpointZ < finiteNumber(point.z),
        visible: Boolean(session.capabilities?.elevation) && session.mode === "ELEVATE"
      });
    }

    // Remote placements use the same nearest-point source anchor that owns the
    // retained construction circle and true-3D range measurement. While the
    // user is actively travelling the elevation circle, elevationPhase keeps
    // the far-side (181-359 degree) half of the side view unambiguous.
    const anchor = session.elevationArc?.anchor ?? this.#range.nearestPointOnVolume(session.sourceVolume, point);
    const distance = this.#range.distanceBetweenPoints(anchor, point);
    const dx = finiteNumber(point.x) - finiteNumber(anchor.x);
    const dy = finiteNumber(point.y) - finiteNumber(anchor.y);
    const horizontal = Math.hypot(dx, dy);
    const fallbackAngle = normalizeDegrees((Math.atan2(finiteNumber(point.z) - finiteNumber(anchor.z), horizontal) * 180) / Math.PI);
    const revisionPhase = revision?.elevationPhase;
    const retainedPhase = session.elevationArc?.phase;
    const angle = revisionPhase !== null && revisionPhase !== undefined && Number.isFinite(Number(revisionPhase))
      ? normalizeDegrees(revisionPhase)
      : retainedPhase !== null && retainedPhase !== undefined && Number.isFinite(Number(retainedPhase))
        ? normalizeDegrees(retainedPhase)
        : fallbackAngle;
    const elevationDelta = finiteNumber(point.z) - finiteNumber(anchor.z);
    return Object.freeze({
      distance,
      maxRange: Number.isFinite(configuredRange) && configuredRange > 0 ? configuredRange : Math.max(distance, session.metrics?.distance ?? 5),
      angle,
      elevationDelta,
      belowOrigin: elevationDelta < 0,
      visible: Boolean(session.capabilities?.elevation) && session.mode === "ELEVATE"
    });
  }

  #syncCarrierToRevision(session, carrierInput, revision) {
    const carrier = carrierInput ?? session.carrier;
    if (!carrier || !revision) return;
    const pixel = this.#metrics.distanceToPixels(revision.point, session.metrics);
    const projected = [CROSSHAIR_3D_SHAPES.CONE, CROSSHAIR_3D_SHAPES.RAY].includes(session.baseShape.type)
      ? this.#projectedDistance(session.baseShape.length, revision.pitch, session.metrics.distance)
      : null;
    const update = { x: pixel.x, y: pixel.y, direction: revision.yaw, elevation: revision.point.z };
    if (projected !== null) update.distance = projected;
    try {
      session.carrierSuppressionUntil = Date.now() + 60;
      carrier.updateCrosshair?.(update);
      carrier.document?.updateSource?.(update);
      carrier.refresh?.();
    } catch (error) {
      Logger.debug("Could not fully synchronize Sequencer crosshair carrier to accepted 3D revision.", error);
    }
  }

  #reverseElevationWheelEnabled() {
    try {
      const value = globalThis.game?.settings?.get?.(MODULE_ID, SETTINGS.CROSSHAIR_3D_REVERSE_ELEVATION_WHEEL);
      return typeof value === "boolean" ? value : true;
    } catch (_error) {
      return true;
    }
  }

  #overlayFootprintRadiusPixels(shape, metrics) {
    const toPixels = distance => (Math.max(0, finiteNumber(distance)) / Math.max(1e-9, finiteNumber(metrics?.distance, 5))) * Math.max(1, finiteNumber(metrics?.size, 100));
    switch (shape?.type) {
      case CROSSHAIR_3D_SHAPES.SPHERE:
      case CROSSHAIR_3D_SHAPES.CYLINDER:
        return toPixels(shape.radius);
      case CROSSHAIR_3D_SHAPES.PRISM:
        return toPixels(Math.hypot(finiteNumber(shape.width), finiteNumber(shape.length)) / 2);
      case CROSSHAIR_3D_SHAPES.LINE:
      case CROSSHAIR_3D_SHAPES.RAY:
        return toPixels(Math.max(finiteNumber(shape.width) / 2, finiteNumber(metrics?.distance, 5) / 2));
      case CROSSHAIR_3D_SHAPES.CONE:
        return toPixels(finiteNumber(metrics?.distance, 5) / 2);
      default:
        return Math.max(1, finiteNumber(metrics?.size, 100) / 2);
    }
  }

  #canonicalSelfOrientation(headingYaw, arcPitch) {
    const arc = Math.max(-180, Math.min(180, finiteNumber(arcPitch)));
    const heading = normalizeDegrees(headingYaw);
    if (arc > 90) return { yaw: normalizeDegrees(heading + 180), pitch: 180 - arc, flipped: true };
    if (arc < -90) return { yaw: normalizeDegrees(heading + 180), pitch: -180 - arc, flipped: true };
    return { yaw: heading, pitch: arc, flipped: false };
  }

  #stepRemoteElevationSnap(currentInput, step, anchorZInput, radiusInput, distanceInput) {
    const radius = Math.max(1e-9, finiteNumber(radiusInput));
    const distance = Math.max(0, finiteNumber(distanceInput));
    const anchorZ = finiteNumber(anchorZInput);
    const current = normalizeDegrees(currentInput);
    const direction = Math.sign(step);
    if (!direction || distance <= 0) {
      return { phase: current, z: anchorZ + (radius * Math.sin((current * Math.PI) / 180)) };
    }

    // In ELEVATE mode the vertical axis is authoritative for snapping. Each
    // accepted wheel notch advances to the next horizontal Scene-grid plane
    // encountered while travelling around the retained construction circle.
    // XY is then solved continuously from the circle instead of being snapped
    // to a map-grid square. This keeps world Z exactly on grid-distance values
    // (for example 0, 5, 10, 15 on a 5-ft Scene) regardless of circle radius.
    const minZ = anchorZ - radius;
    const maxZ = anchorZ + radius;
    const firstLevel = Math.ceil((minZ - 1e-9) / distance);
    const lastLevel = Math.floor((maxZ + 1e-9) / distance);
    const candidates = [];
    const addCandidate = (phase, z) => {
      const normalized = normalizeDegrees(phase);
      if (candidates.some(candidate => Math.abs((((candidate.phase - normalized + 540) % 360) - 180)) < 1e-7)) return;
      candidates.push({ phase: normalized, z });
    };

    for (let level = firstLevel; level <= lastLevel; level += 1) {
      const z = level * distance;
      const ratio = Math.max(-1, Math.min(1, (z - anchorZ) / radius));
      const alpha = (Math.asin(ratio) * 180) / Math.PI;
      addCandidate(alpha, z);
      addCandidate(180 - alpha, z);
    }

    let best = null;
    for (const candidate of candidates) {
      const delta = direction > 0
        ? (candidate.phase - current + 360) % 360
        : (current - candidate.phase + 360) % 360;
      if (delta <= 1e-7) continue;
      if (!best || delta < best.delta) best = { ...candidate, delta };
    }

    if (!best) {
      return { phase: current, z: anchorZ + (radius * Math.sin((current * Math.PI) / 180)) };
    }
    return { phase: best.phase, z: best.z };
  }

  #stepArcPitch(currentInput, step, lengthInput, distanceInput) {
    const length = Math.max(1e-9, finiteNumber(lengthInput));
    const distance = Math.max(0, finiteNumber(distanceInput));
    const current = Math.max(-180, Math.min(180, finiteNumber(currentInput)));
    if (!step || distance <= 0) return current;
    const dz = length * Math.sin((current * Math.PI) / 180);
    const ratioToDegrees = value => (Math.asin(Math.max(-1, Math.min(1, value / length))) * 180) / Math.PI;
    const epsilon = 1e-7;

    if (step > 0) {
      if (current >= 180 - epsilon) return 180;
      if (current >= 90 - epsilon) {
        const nextDz = Math.max(0, dz - distance);
        return Math.min(180, 180 - ratioToDegrees(nextDz));
      }
      if (current < -90 - epsilon) {
        const nextDz = Math.max(-length, dz - distance);
        return Math.min(-90, -180 - ratioToDegrees(nextDz));
      }
      const nextDz = Math.min(length, dz + distance);
      return ratioToDegrees(nextDz);
    }

    if (current <= -180 + epsilon) return -180;
    if (current <= -90 + epsilon) {
      const nextDz = Math.min(0, dz + distance);
      return Math.max(-180, -180 - ratioToDegrees(nextDz));
    }
    if (current > 90 + epsilon) {
      const nextDz = Math.min(length, dz + distance);
      return Math.max(90, 180 - ratioToDegrees(nextDz));
    }
    const nextDz = Math.max(-length, dz - distance);
    return ratioToDegrees(nextDz);
  }

  #resolveSelfApex(source, yaw, pitch, metrics, sourceVolume) {
    const document = source.document;
    const x0 = finiteNumber(document.x), y0 = finiteNumber(document.y);
    const widthPx = finiteNumber(document.width, 1) * metrics.size;
    const heightPx = finiteNumber(document.height, 1) * metrics.size;
    const cx = x0 + widthPx / 2, cy = y0 + heightPx / 2;
    const r = (normalizeDegrees(yaw) * Math.PI) / 180;
    const dx = Math.cos(r), dy = Math.sin(r);
    const tx = Math.abs(dx) > 1e-9 ? (widthPx / 2) / Math.abs(dx) : Infinity;
    const ty = Math.abs(dy) > 1e-9 ? (heightPx / 2) / Math.abs(dy) : Infinity;
    const t = Math.min(tx, ty);
    let x = cx + dx * t, y = cy + dy * t;
    // Legal source-boundary apex: snap the free boundary coordinate to a grid intersection.
    if (tx < ty) y = y0 + Math.round((y - y0) / metrics.size) * metrics.size;
    else if (ty < tx) x = x0 + Math.round((x - x0) / metrics.size) * metrics.size;
    else { x = dx >= 0 ? x0 + widthPx : x0; y = dy >= 0 ? y0 + heightPx : y0; }
    x = Math.max(x0, Math.min(x0 + widthPx, x));
    y = Math.max(y0, Math.min(y0 + heightPx, y));
    const z = finiteNumber(pitch) < 0 ? sourceVolume.top : sourceVolume.bottom;
    return this.#metrics.pixelsToDistance({ x, y, elevation: z }, metrics);
  }

  #projectedDistance(length, pitch, gridDistance) {
    const horizontal = Math.abs(finiteNumber(length) * Math.cos((finiteNumber(pitch) * Math.PI) / 180));
    return Math.max(finiteNumber(gridDistance, 5), horizontal);
  }

  async #replaceUserTargets(ids) {
    const normalized = unique(ids);
    try { globalThis.canvas?.tokens?.setTargets?.(normalized); } catch (error) { Logger.warn("Could not update live 3D Crosshairs targets.", error); }
    return normalized;
  }

  async #cleanup(session) {
    if (session.closed) return;
    session.closed = true;
    for (const [type, listener, options] of session.listeners) {
      try { globalThis.window?.removeEventListener?.(type, listener, options); } catch (_error) { /* noop */ }
    }
    session.listeners.length = 0;
    this.#overlay.clear();
    this.#elevationGauge?.clear?.();
    this.#guide.clear();
    if (session.visualState && this.#visuals) await this.#visuals.clear(session.visualState);
    if (this.#active === session) this.#active = null;
  }
}
