import { freeLineEndpoints, freeLineWithinRange, constrainFreeLineChange } from "./free-line-placement.js";
import { Logger } from "../core/logger.js";
import { MODULE_ID, SETTINGS } from "../core/constants.js";
import { CROSSHAIR_3D_SHAPES } from "./geometry-service.js";
import { finiteNumber, normalizeDegrees } from "./geometry-utils.js";

const tokenIds = tokens => Array.from(tokens ?? [], token => token?.id ?? token?.document?.id).filter(Boolean);
const sameIds = (a, b) => [...a].sort().join("|") === [...b].sort().join("|");
const stop = event => { event.preventDefault?.(); event.stopPropagation?.(); event.stopImmediatePropagation?.(); };

/** Native pointer session. Intent is synchronous; resolved geometry/targets publish together. */
export class Crosshair3dPlacementSessionService {
  #geometry; #tokens; #range; #revisions; #targeting; #metrics; #surfaces; #renderer; #elevationGauge;
  #active = null;
  #stats = { sessions: 0, confirmed: 0, cancelled: 0, errors: 0, revisions: 0, targetRecalculations: 0, staleDiscards: 0, wheelEvents: 0 };
  constructor({ geometry, tokens, range, revisions, targeting, metrics, surfaces, renderer, elevationGauge = null }) {
    this.#geometry = geometry; this.#tokens = tokens; this.#range = range; this.#revisions = revisions;
    this.#targeting = targeting; this.#metrics = metrics; this.#surfaces = surfaces;
    this.#renderer = renderer; this.#elevationGauge = elevationGauge;
  }
  getStats() { return Object.freeze({ ...this.#stats, active: Boolean(this.#active), activeSessionId: this.#active?.id ?? null }); }
  cancel() { this.#active?.finish("cancelled"); }

  async show(options = {}) {
    if (this.#active) throw new Error("Only one local Action Effects 3D Crosshairs placement session may be active at a time.");
    const canvas = globalThis.canvas;
    if (!canvas?.ready) throw new Error("Action Effects 3D Crosshairs requires an active Scene canvas.");
    const source = options.source?.object ?? options.source?.document?.object ?? options.source;
    if (!source?.document) throw new Error("Action Effects 3D Crosshairs requires a source Token.");
    if (!canvas.tokens?.setTargets) throw new Error("Canvas targeting is unavailable.");
    const metrics = this.#metrics.resolve();
    const sourceVolume = this.#tokens.resolve(source, { grid: metrics, coordinateSpace: "pixels" });
    if (!sourceVolume) throw new Error("Could not resolve the source Token volume.");
    const input = { ...(options.shape ?? {}) };
    const requestedType = String(input.type ?? "").toLowerCase();
    if (requestedType === "square") { input.type = "prism"; input.length ??= input.size ?? input.width; input.width ??= input.length; input.height ??= metrics.distance; }
    if (requestedType === "cube") { input.length ??= input.size ?? input.width; input.width ??= input.length; input.height ??= input.length; }
    if (requestedType === "circle") input.height ??= metrics.distance;
    if (requestedType === "line" && (options.placement?.mode === "free" || options.remote === true)) {
      input.type = "free-line"; input.height ??= input.width ?? metrics.distance;
    }
    // Item dimensions take precedence; one Scene grid unit is the missing-dimension fallback.
    if (["prism", "rectangle", "rect", "cylinder", "free-line"].includes(input.type)) input.height ??= input.depth ?? metrics.distance;
    if (["line", "free-line"].includes(input.type)) input.width ??= metrics.distance;
    const baseShape = this.#geometry.normalizeShape(input);
    const freeLine = baseShape.type === "free-line";
    const self = ["cone", "line"].includes(baseShape.type);
    if (baseShape.type === "cone" && options.remote === true) throw new Error("Remote cone placement is not part of this checkpoint.");
    const max = Number(options.range?.max ?? options.maxRange ?? (self ? baseShape.length : 60));
    if (!(Number.isFinite(max) && max > 0)) throw new Error("range.max must be a positive finite number.");
    options = { ...options, range: { policy: freeLine ? "endpoints" : "origin", ...options.range, max } };
    if (freeLine && !["center", "origin", "endpoints"].includes(options.range.policy)) throw new Error("Freely placed Line requires range.policy: center, origin, or endpoints.");
    const allowedRotation = ["prism", "line", "free-line"].includes(baseShape.type);
    const capabilities = Object.freeze({
      elevation: options.capabilities?.elevation !== false,
      rotation: allowedRotation && options.capabilities?.rotation !== false,
      resize: freeLine && options.capabilities?.resize !== false,
      los: options.capabilities?.los === true
    });
    const headingYaw = normalizeDegrees(input.yaw ?? source.document.rotation ?? 0);
    const arcPitch = self ? normalizeDegrees(input.pitch ?? 0) : 0;
    const orientation = this.#canonicalSelfOrientation(headingYaw, arcPitch);
    const initialPoint = self ? this.#resolveSelfApex(source, orientation.yaw, orientation.pitch, metrics, sourceVolume, baseShape.type)
      : input.origin ? { ...baseShape.origin } : { x: (sourceVolume.minX + sourceVolume.maxX) / 2, y: (sourceVolume.minY + sourceVolume.maxY) / 2, z: sourceVolume.bottom };
    const intent = { point: initialPoint, yaw: self ? orientation.yaw : headingYaw, headingYaw,
      pitch: self ? orientation.pitch : 0, arcPitch, length: baseShape.length,
      manualElevation: false, selectedAbsoluteZ: initialPoint.z };
    const session = {
      id: globalThis.foundry?.utils?.randomID?.(12) ?? `${Date.now()}-${Math.random()}`,
      source, sourceVolume, scene: canvas.scene, metrics, baseShape, options, freeLine, self, capabilities, intent,
      originalTargetIds: tokenIds(globalThis.game?.user?.targets), current: this.#revisions.create({ ...intent, shape: baseShape, targets: [], valid: false }),
      mode: "MOVE", closed: false, finishing: false, settled: false, pending: null, drain: null,
      requestedSerial: 0, resolvedSerial: -1, listeners: [], hooks: [], tick: null, lastPointer: null,
      lastCamera: "", zoomUntil: 0, armed: false, gesture: null, lastTargetIds: tokenIds(globalThis.game?.user?.targets)
    };
    if (!self && !this.#validState(session, intent)) throw new Error("Initial placement does not fit within the configured range or visibility.");
    const done = new Promise(resolve => { session.finish = (status, error = null) => {
      if (session.settled) return;
      session.settled = true; session.closed = true; session.pending = null;
      resolve({ status, error });
    }; });
    this.#active = session;
    this.#stats.sessions++;
    try {
      this.#renderer.show({ shape: baseShape, sourceVolume, metrics, metricsService: this.#metrics,
        geometry: this.#geometry, options, capabilities });
      if (baseShape.type === "line") this.#elevationGauge?.show({ enabled: capabilities.elevation });
      this.#installInput(session);
      this.#enqueue(session, "initial");
      const outcome = await done;
      if (outcome.error) throw outcome.error;
      if (outcome.status !== "confirmed") {
        this.#stats.cancelled++;
        this.#restoreTargets(session);
        return Object.freeze({ cancelled: true, revision: session.current, targets: Object.freeze([]), shape: session.current.shape });
      }
      this.#stats.confirmed++;
      const revision = session.current;
      const targets = Object.freeze([...revision.targets]);
      return Object.freeze({ cancelled: false, revision, shape: revision.shape, targets,
        targetIds: Object.freeze(tokenIds(targets)), targetUuids: Object.freeze(targets.map(t => t.document?.uuid ?? t.uuid).filter(Boolean)),
        placementPoint: Object.freeze({ ...revision.point }), yaw: revision.yaw, pitch: revision.pitch,
        originLevelId: session.originLevelId ?? null });
    } catch (error) {
      session.closed = true;
      this.#stats.errors++;
      this.#restoreTargets(session);
      Logger.error("Action Effects 3D Crosshairs placement failed.", error);
      throw error;
    } finally { this.#cleanup(session); }
  }

  #enqueue(session, reason) {
    if (session.closed) return;
    session.pending = { serial: ++session.requestedSerial, reason, state: { ...session.intent, point: { ...session.intent.point } } };
    if (!session.drain) {
      // Assign the barrier before starting work, including synchronous filter callbacks.
      session.drain = Promise.resolve().then(() => this.#drain(session)).catch(error => session.finish("error", error)).finally(() => {
        session.drain = null;
        if (session.pending && !session.closed) this.#enqueue(session, session.pending.reason);
      });
    }
  }
  async #drain(session) {
    while (session.pending && !session.closed) {
      const request = session.pending; session.pending = null;
      const state = request.state;
      if (session.self) {
        const orientation = this.#canonicalSelfOrientation(state.headingYaw, state.arcPitch);
        Object.assign(state, orientation);
        state.point = this.#resolveSelfApex(session.source, state.yaw, state.pitch, session.metrics, session.sourceVolume, session.baseShape.type);
      }
      const shape = this.#shapeForState(session.baseShape, state);
      const direction = session.self ? this.#geometry.direction(shape) : null;
      const endpoint = direction ? { x: shape.origin.x + direction.x * shape.length,
        y: shape.origin.y + direction.y * shape.length, z: shape.origin.z + direction.z * shape.length } : null;
      const valid = this.#validState(session, state);
      const targets = valid ? await this.#collectTargets(session, shape) : Object.freeze([]);
      if (session.closed) return;
      if (request.serial !== session.requestedSerial) { this.#stats.staleDiscards++; continue; }
      const revision = this.#revisions.revise(session.current, { ...state, shape, endpoint, terminal: endpoint,
        endpointZ: endpoint?.z ?? null, targets, valid, serial: request.serial, reason: request.reason });
      this.#renderer.update(revision, session.mode);
      const ids = tokenIds(targets);
      if (!sameIds(ids, tokenIds(globalThis.game?.user?.targets))) this.#replaceUserTargets(ids);
      session.current = revision; session.resolvedSerial = request.serial; session.lastTargetIds = ids;
      this.#stats.revisions++; this.#stats.targetRecalculations++;
      this.#updateGauge(session);
      if (typeof session.options.onRevision === "function") {
        try { Promise.resolve(session.options.onRevision(revision)).catch(error => Logger.warn("3D Crosshairs onRevision callback failed.", error)); }
        catch (error) { Logger.warn("3D Crosshairs onRevision callback failed.", error); }
      }
    }
  }
  #updateGauge(session) {
    if (session.baseShape.type !== "line") return;
    const r = session.current;
    this.#elevationGauge?.update({ distance: r.shape.length, maxRange: r.shape.length, angle: r.arcPitch,
      elevationDelta: (r.endpoint?.z ?? r.point.z) - r.point.z,
      belowOrigin: r.endpoint?.z < r.point.z - 1e-7, visible: session.mode === "ELEVATE" });
  }
  async #confirm(session) {
    if (session.confirming || session.closed) return;
    session.confirming = true;
    this.#enqueue(session, "final-confirm");
    while (session.drain && !session.closed) await session.drain;
    if (session.closed) return;
    if (!session.current.valid || session.resolvedSerial !== session.requestedSerial) { session.finish("cancelled"); return; }
    session.finish("confirmed");
  }
  #validState(session, state) {
    if (session.self) return this.#validateLos(session, state.point);
    if (session.freeLine) return this.#freeLineValid(session, state);
    return this.#range.distanceFromVolumeToPoint(session.sourceVolume, state.point) <= session.options.range.max + 1e-8
      && this.#validateLos(session, state.point);
  }
  #accept(session, next, reason) {
    if (session.closed || session.finishing) return;
    if (!this.#validState(session, next)) return;
    session.intent = next;
    this.#enqueue(session, reason);
  }
  #installInput(session) {
    const canvas = globalThis.canvas, view = canvas.app.renderer.view ?? canvas.app.renderer.canvas;
    const guard = fn => (...args) => { try { return fn(...args); } catch (error) { session.finish("error", error); } };
    const listen = (type, fn, target = globalThis.window) => {
      const listener = guard(fn); const options = { capture: true, passive: false };
      target.addEventListener(type, listener, options); session.listeners.push([target, type, listener, options]);
    };
    const hook = (name, fn) => { session.hooks.push([name, globalThis.Hooks.on(name, guard(fn))]); };
    const onCanvas = event => event.target === view;
    const sync = (event, down = null) => {
      const m = { shift: Boolean(event.shiftKey), ctrl: Boolean(event.ctrlKey), alt: Boolean(event.altKey), meta: Boolean(event.metaKey) };
      if (down !== null) {
        if (event.key === "Shift") m.shift = down;
        if (event.key === "Control") m.ctrl = down;
        if (["Alt", "AltGraph"].includes(event.key)) m.alt = down;
      }
      const count = Object.values(m).filter(Boolean).length;
      const mode = count !== 1 ? "MOVE" : m.ctrl && session.capabilities.elevation ? "ELEVATE"
        : m.shift && session.capabilities.rotation ? "ROTATE" : m.alt && session.capabilities.resize ? "LENGTH" : "MOVE";
      if (mode !== session.mode) {
        session.mode = mode;
        if (session.current.valid) this.#renderer.update(session.current, mode);
        this.#updateGauge(session);
      }
      return { ...m, count };
    };
    const pointerWorld = event => {
      const bounds = view.getBoundingClientRect(), screen = canvas.app.renderer.screen;
      return canvas.stage.toLocal(new PIXI.Point((event.clientX - bounds.left) * screen.width / bounds.width,
        (event.clientY - bounds.top) * screen.height / bounds.height));
    };
    const move = (event, m) => {
      if (m.count || session.finishing) return;
      const world = pointerWorld(event), state = session.intent;
      if (session.self) {
        const doc = session.source.document;
        const dx = world.x - (doc.x + doc.width * session.metrics.size / 2);
        const dy = world.y - (doc.y + doc.height * session.metrics.size / 2);
        if (Math.hypot(dx, dy) < 1e-7) return;
        const effectiveYaw = normalizeDegrees(Math.atan2(dy, dx) * 180 / Math.PI);
        const flipped = this.#canonicalSelfOrientation(state.headingYaw, state.arcPitch).flipped;
        const headingYaw = normalizeDegrees(effectiveYaw - (session.baseShape.type === "cone" && flipped ? 180 : 0));
        const o = this.#canonicalSelfOrientation(headingYaw, state.arcPitch);
        this.#accept(session, { ...state, ...o, headingYaw,
          point: this.#resolveSelfApex(session.source, o.yaw, o.pitch, session.metrics, session.sourceVolume, session.baseShape.type) }, "move-aim");
      } else {
        const point = this.#resolveRemoteMovePoint(session, world, session.sourceVolume.bottom);
        this.#accept(session, { ...state, point, selectedAbsoluteZ: state.manualElevation ? state.selectedAbsoluteZ : point.z }, "move");
      }
    };
    listen("pointermove", event => {
      if (!onCanvas(event) || session.closed || session.finishing) return;
      session.armed = true;
      const m = sync(event);
      const changed = !session.lastPointer || event.clientX !== session.lastPointer.x || event.clientY !== session.lastPointer.y;
      session.lastPointer = { x: event.clientX, y: event.clientY };
      if (changed && performance.now() >= session.zoomUntil) move(event, m);
      stop(event);
    });
    listen("wheel", event => {
      if (!onCanvas(event) || session.closed) return;
      const m = sync(event);
      if (!m.count && !session.finishing) { session.zoomUntil = performance.now() + 200; return; }
      stop(event);
      if (session.finishing || m.count !== 1 || m.meta || !event.deltaY) return;
      this.#stats.wheelEvents++;
      const step = event.deltaY < 0 ? 1 : -1, from = session.intent;
      let next = { ...from, point: { ...from.point } }, yawDelta = 0;
      if (session.mode === "ELEVATE") {
        const direction = this.#reverseElevationWheelEnabled() ? -step : step;
        if (session.self) {
          next.arcPitch = this.#stepArcPitch(from.arcPitch, direction, session.baseShape.length, this.#elevationStep(session));
          const o = this.#canonicalSelfOrientation(from.headingYaw, next.arcPitch);
          Object.assign(next, o);
          next.point = this.#resolveSelfApex(session.source, o.yaw, o.pitch, session.metrics, session.sourceVolume, session.baseShape.type);
        } else {
          next.point.z += direction * this.#elevationStep(session);
          next.selectedAbsoluteZ = next.point.z; next.manualElevation = true;
        }
      } else if (session.mode === "ROTATE") {
        yawDelta = step * this.#rotationStep(session);
        if (session.self) {
          next.headingYaw = normalizeDegrees(from.headingYaw + yawDelta);
          const o = this.#canonicalSelfOrientation(next.headingYaw, from.arcPitch);
          Object.assign(next, o);
          next.point = this.#resolveSelfApex(session.source, o.yaw, o.pitch, session.metrics, session.sourceVolume, session.baseShape.type);
        } else next.yaw = normalizeDegrees(from.yaw + yawDelta);
      } else if (session.mode === "LENGTH") {
        const min = Math.min(session.baseShape.length, Math.max(0.001, finiteNumber(session.options.controls?.minLength, session.metrics.distance)));
        next.length = Math.max(min, Math.min(session.baseShape.length, from.length + step * Math.max(0.001, finiteNumber(session.options.controls?.lengthStep, session.metrics.distance))));
      } else return;
      if (session.freeLine && session.mode !== "ELEVATE") next = constrainFreeLineChange(from, next, state => this.#validState(session, state), yawDelta);
      this.#accept(session, next, `wheel-${session.mode.toLowerCase()}`);
    });
    for (const type of ["keydown", "keyup"]) listen(type, event => {
      if (session.closed || event.target?.closest?.("input,textarea,select,[contenteditable='true']")) return;
      sync(event, type === "keydown");
      if (event.key === "Escape") { stop(event); if (type === "keydown") session.finish("cancelled"); }
      else if (["Shift", "Control", "Alt", "AltGraph", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) stop(event);
    });
    listen("pointerdown", event => {
      if (!onCanvas(event) || session.closed || ![0, 2].includes(event.button)) return;
      stop(event);
      if (session.finishing || (!session.armed && event.button === 0)) return;
      // The last pointermove supplies aim; releasing a modifier never repositions it.
      sync(event); session.finishing = true;
      session.gesture = { button: event.button, id: event.pointerId, started: performance.now() };
    });
    listen("pointerup", event => {
      const g = session.gesture;
      if (!g || event.pointerId !== g.id || event.button !== g.button) return;
      stop(event); g.released = performance.now();
    });
    for (const type of ["mousedown", "mouseup", "click", "dblclick", "contextmenu"]) listen(type, event => { if (onCanvas(event) && !session.closed) stop(event); });
    listen("pointercancel", () => session.finish("cancelled"));
    listen("blur", () => session.finish("cancelled"));
    if (session.options.signal) {
      if (session.options.signal.aborted) session.finish("cancelled");
      else listen("abort", () => session.finish("cancelled"), session.options.signal);
    }
    session.originLevelId = canvas.level?.id ?? null;
    hook("canvasTearDown", () => session.finish("cancelled"));
    for (const name of ["updateToken", "deleteToken", "createToken"]) hook(name, document => {
      if (document.parent?.id !== session.scene.id) return;
      if (document.id === session.source.id) session.finish("cancelled");
      else this.#enqueue(session, "token-change");
    });
    session.tick = guard(() => {
      if (session.closed) return;
      if (!canvas.ready || canvas.scene !== session.scene || session.source.destroyed) return session.finish("cancelled");
      const now = performance.now(), stage = canvas.stage;
      const camera = [stage.position.x, stage.position.y, stage.pivot.x, stage.pivot.y, stage.scale.x, stage.scale.y].join("|");
      if (session.lastCamera && camera !== session.lastCamera) session.zoomUntil = now + 200;
      session.lastCamera = camera;
      this.#renderer.frame(now);
      const g = session.gesture;
      if (g?.released !== undefined && now - g.released >= 150) {
        if (g.button === 2) session.finish("cancelled");
        else this.#confirm(session).catch(error => session.finish("error", error));
      } else if (g && now - g.started > 5000) session.finish("cancelled");
    });
    canvas.app.ticker.add(session.tick, null, globalThis.PIXI.UPDATE_PRIORITY?.HIGH ?? 25);
  }
  #shapeForState(base, state) {
    const common = { ...base, origin: state.point };
    if (base.type === CROSSHAIR_3D_SHAPES.FREE_LINE) {
      common.length = state.length ?? base.length;
      common.origin = freeLineEndpoints({ ...state, length: common.length })[0];
    }
    if ([CROSSHAIR_3D_SHAPES.PRISM, CROSSHAIR_3D_SHAPES.FREE_LINE].includes(base.type)) common.yaw = state.yaw;
    if ([CROSSHAIR_3D_SHAPES.CONE, CROSSHAIR_3D_SHAPES.LINE].includes(base.type)) { common.yaw = state.yaw; common.pitch = state.pitch; }
    return this.#geometry.normalizeShape(common);
  }

  #freeLineValid(session, state) {
    return freeLineWithinRange(state, session.sourceVolume, session.options.range.max, session.options.range.policy, this.#range)
      && this.#validateLos(session, session.options.range.policy === "origin" ? freeLineEndpoints(state)[0] : state.point);
  }

  #validateLos(session, point) {
    if (!session.capabilities.los) return true;
    const pixel = this.#metrics.distanceToPixels(point, session.metrics);
    const vision = session.source?.vision;
    if (typeof vision?.testPoint !== "function") return false;
    try { return Boolean(vision.testPoint({ x: pixel.x, y: pixel.y, elevation: point.z })); }
    catch (_error) { return false; }
  }

  async #collectTargets(session, shape) {
    const candidates = Array.from(globalThis.canvas?.tokens?.placeables ?? []);
    const result = [];
    for (const token of candidates) {
      if (session.closed) break;
      if (!token?.actor || token.id === session.source.id && session.options.includeSource !== true) continue;
      if (typeof globalThis.MidiQOL?.isTargetable === "function" && !globalThis.MidiQOL.isTargetable(token)) continue;
      if (typeof session.options.targetFilter === "function" && !(await session.options.targetFilter(token, { shape, sessionId: session.id }))) continue;
      const volume = this.#tokens.resolve(token, { grid: session.metrics, coordinateSpace: "pixels" });
      if (!volume) continue;
      if (this.#targeting.testVolume(shape, volume, { grid: session.metrics.grid })) result.push(token);
    }
    return Object.freeze(result);
  }

  #reverseElevationWheelEnabled() {
    try {
      const value = globalThis.game?.settings?.get?.(MODULE_ID, SETTINGS.CROSSHAIR_3D_REVERSE_ELEVATION_WHEEL);
      return typeof value === "boolean" ? value : true;
    } catch (_error) {
      return true;
    }
  }

  #rotationStep(session) {
    const configured = finiteNumber(session.options?.controls?.rotationStep, NaN);
    if (Number.isFinite(configured) && configured > 0) return configured;
    return 5;
  }

  #canonicalSelfOrientation(headingYaw, arcPitch) {
    const arc = normalizeDegrees(arcPitch);
    const heading = normalizeDegrees(headingYaw);
    if (arc > 90 && arc < 270) return { yaw: normalizeDegrees(heading + 180), pitch: 180 - arc, flipped: true };
    if (arc >= 270) return { yaw: heading, pitch: arc - 360, flipped: false };
    return { yaw: heading, pitch: arc, flipped: false };
  }

  #stepArcPitch(currentInput, step, lengthInput, distanceInput) {
    const length = Math.max(1e-9, finiteNumber(lengthInput));
    const distance = Math.max(0, finiteNumber(distanceInput));
    const current = normalizeDegrees(currentInput);
    if (!step || distance <= 0) return current;
    const direction = Math.sign(step);
    const candidates = [];
    const addCandidate = (phase, z) => {
      const normalized = normalizeDegrees(phase);
      if (candidates.some(candidate => Math.abs((((candidate.phase - normalized + 540) % 360) - 180)) < 1e-7)) return;
      candidates.push({ phase: normalized, z });
    };

    // Endpoint height remains the snapped user intent. Always include both
    // vertical poles even when Cone length is not divisible by the requested
    // increment, so pitch can cross vertical without stalling or shortening.
    const firstLevel = Math.ceil((-length - 1e-9) / distance);
    const lastLevel = Math.floor((length + 1e-9) / distance);
    for (let level = firstLevel; level <= lastLevel; level += 1) {
      const z = Math.max(-length, Math.min(length, level * distance));
      const alpha = (Math.asin(Math.max(-1, Math.min(1, z / length))) * 180) / Math.PI;
      addCandidate(alpha, z);
      addCandidate(180 - alpha, z);
    }
    addCandidate(90, length);
    addCandidate(270, -length);

    let best = null;
    for (const candidate of candidates) {
      const delta = direction > 0
        ? (candidate.phase - current + 360) % 360
        : (current - candidate.phase + 360) % 360;
      if (delta <= 1e-7) continue;
      if (!best || delta < best.delta) best = { ...candidate, delta };
    }
    return best?.phase ?? current;
  }

  #resolveSelfApex(source, yaw, pitch, metrics, sourceVolume, shapeType) {
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
    // Source-bound Cone and Line both slide continuously along the perimeter.
    x = Math.max(x0, Math.min(x0 + widthPx, x));
    y = Math.max(y0, Math.min(y0 + heightPx, y));
    const z = shapeType === CROSSHAIR_3D_SHAPES.LINE
      ? sourceVolume.bottom
      : finiteNumber(pitch) < 0 ? sourceVolume.top : sourceVolume.bottom;
    return this.#metrics.pixelsToDistance({ x, y, elevation: z }, metrics);
  }


  #elevationStep(session) {
    const configured = Number(session.options.controls?.elevationStep);
    if (Number.isFinite(configured) && configured > 0) return configured;
    return session.metrics.distance * (session.baseShape.type === "cone" && session.baseShape.length <= 25 ? 1 / 5 : 1);
  }
  #resolveRemoteMovePoint(session, world, fallbackElevation) {
    const canvas = globalThis.canvas;
    const snapped = canvas.grid?.getSnappedPoint?.(world, {
      mode: globalThis.CONST?.GRID_SNAPPING_MODES?.CENTER, resolution: 8
    }) ?? world;
    const ground = this.#surfaces.resolveAt({ x: snapped.x, y: snapped.y, fallbackElevation });
    const from = session.intent;
    // Free-line retains its accepted surface clamp; other remote shapes retain selected absolute Z.
    const z = from.manualElevation ? session.freeLine ? Math.max(from.point.z, ground.elevation)
      : from.selectedAbsoluteZ : ground.elevation;
    const requested = this.#metrics.pixelsToDistance({ ...snapped, z }, session.metrics);
    if (session.freeLine) return constrainFreeLineChange(from, { ...from, point: requested }, state => this.#validState(session, state)).point;
    const valid = point => this.#validState(session, { ...from, point });
    if (valid(requested)) return requested;
    let low = 0, high = 1, best = { ...from.point };
    for (let i = 0; i < 32; i++) {
      const t = (low + high) / 2;
      const point = Object.fromEntries(["x", "y", "z"].map(axis => [axis, from.point[axis] + (requested[axis] - from.point[axis]) * t]));
      if (valid(point)) { low = t; best = point; } else high = t;
    }
    return best;
  }
  #replaceUserTargets(ids) {
    globalThis.canvas.tokens.setTargets([...new Set(ids)], { mode: "replace" });
  }
  #restoreTargets(session) {
    if (!globalThis.canvas?.ready || globalThis.canvas.scene !== session.scene) return;
    try { this.#replaceUserTargets(session.originalTargetIds.filter(id => globalThis.canvas.tokens.get(id))); }
    catch (error) { Logger.warn("Could not restore previous targets.", error); }
  }
  #cleanup(session) {
    session.closed = true; session.pending = null;
    const safely = fn => { try { fn(); } catch (error) { Logger.warn("3D Crosshairs cleanup failed.", error); } };
    if (session.tick) safely(() => globalThis.canvas.app.ticker.remove(session.tick));
    for (const [target, type, listener, options] of session.listeners) safely(() => target.removeEventListener(type, listener, options));
    for (const [name, id] of session.hooks) safely(() => globalThis.Hooks.off(name, id));
    safely(() => this.#elevationGauge?.clear());
    safely(() => this.#renderer.clear());
    if (this.#active === session) this.#active = null;
  }
}
