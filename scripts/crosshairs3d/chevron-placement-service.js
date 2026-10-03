import { MODULE_ID, SETTINGS } from "../core/constants.js";
import { Logger } from "../core/logger.js";
import { validateChevronOptions, assertChevronGrid, measureChevronPath, measureChevronMovement } from "./chevron-path-service.js";

const same = (a, b) => a.x === b.x && a.y === b.y && a.elevation === b.elevation;
const stop = event => { event.preventDefault?.(); event.stopImmediatePropagation?.(); event.stopPropagation?.(); };
const frozenPoints = points => Object.freeze(points.map(point => Object.freeze({ ...point })));

/** Called only through the suite's shared placement gate. Returns a route; never moves a Token. */
export class Crosshair3dChevronPlacementService {
  #metrics; #renderer; #active = null;
  constructor({ metrics, renderer }) { this.#metrics = metrics; this.#renderer = renderer; }
  cancel() { this.#active?.finish(null); }

  async show(options) {
    if (this.#active) throw new Error("Chevron placement is already active.");
    const config = validateChevronOptions(options);
    const canvas = globalThis.canvas;
    if (!canvas?.ready) throw new Error("Chevron placement requires an active Scene canvas.");
    const source = options.source?.object ?? options.source?.document?.object ?? options.source;
    if (!source?.document) throw new Error("Chevron placement requires a source Token.");
    if (!canvas.grid?.isSquare || typeof canvas.grid.getCenterPoint !== "function") {
      throw new Error("Chevron placement currently requires a square-grid Scene.");
    }
    if (config.movement) {
      if (typeof source.createTerrainMovementPath !== "function" || typeof source.measureMovementPath !== "function") {
        throw new Error("Chevron movement cost requires native Token terrain and measurement APIs.");
      }
      const action = globalThis.CONFIG?.Token?.movement?.actions?.[config.movement.action];
      if (!action || action.measure === false || action.teleport ||
          (typeof action.canSelect === "function" && !action.canSelect(source.document))) {
        throw new Error("Chevron movement action must be selectable, measured, and non-teleporting.");
      }
    }
    const doc = source.document, metrics = this.#metrics.resolve();
    if (config.mode === "path" && (doc.width !== 1 || doc.height !== 1)) {
      throw new Error("Chevron waypoint paths currently require a one-square Token.");
    }
    const origin = { x: doc.x + doc.width * metrics.size / 2,
      y: doc.y + doc.height * metrics.size / 2, elevation: Number(doc.elevation) };
    if (!Object.values(origin).every(Number.isFinite)) throw new Error("Invalid Chevron source coordinates.");
    if (config.metric === "grid") assertChevronGrid(canvas.grid, origin, metrics.size, metrics.distance);
    const elevationStep = Number(options.controls?.elevationStep ?? metrics.distance);
    const view = canvas.app.renderer.view ?? canvas.app.renderer.canvas;
    const ticker = canvas.app.ticker;
    const scene = canvas.scene;
    const listeners = [], hooks = [];
    let cursor = { ...canvas.grid.getCenterPoint(origin), elevation: origin.elevation };
    const waypoints = [];
    let closed = false, locked = false, gesture = null, revision = null, key = null;
    let pointer = null, cameraKey = null, cameraQuietUntil = 0, tick = null;
    let resolveDone, rejectDone;
    const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
    const session = { finish: (result, error = null) => {
      if (closed) return;
      closed = true;
      // Suppress trailing click/contextmenu in this pointer event cycle before cleanup.
      globalThis.setTimeout(() => error ? rejectDone(error) : resolveDone(result), 0);
    } };
    this.#active = session;
    const listen = (target, type, fn) => {
      const handler = event => { try { fn(event); } catch (error) { session.finish(null, error); } };
      const capture = { capture: true, passive: false };
      target.addEventListener(type, handler, capture);
      listeners.push([target, type, handler, capture]);
    };
    const hook = (name, fn) => {
      const guarded = (...args) => { try { fn(...args); } catch (error) { session.finish(null, error); } };
      hooks.push([name, globalThis.Hooks.on(name, guarded)]);
    };
    const pointFromEvent = event => {
      const bounds = view.getBoundingClientRect(), screen = canvas.app.renderer.screen;
      const world = canvas.stage.toLocal(new PIXI.Point(
        (event.clientX - bounds.left) * screen.width / bounds.width,
        (event.clientY - bounds.top) * screen.height / bounds.height));
      return { ...canvas.grid.getCenterPoint(world), elevation: cursor.elevation };
    };
    const measure = points => {
      const distance = measureChevronPath(points, { ...metrics, grid: canvas.grid, metric: config.metric });
      const movement = config.movement ? measureChevronMovement(points, {
        source, size: metrics.size, action: config.movement.action
      }) : {};
      return { distance, ...movement };
    };
    const publish = () => {
      if (closed) return;
      const points = [origin, ...waypoints, cursor], nextKey = JSON.stringify(points);
      if (nextKey === key) return;
      const measured = measure(points), used = measured.cost ?? measured.distance;
      key = nextKey;
      revision = Object.freeze({ origin: Object.freeze({ ...origin }), cursor: Object.freeze({ ...cursor }),
        waypoints: frozenPoints(waypoints), ...measured, max: config.max,
        remaining: Math.max(0, config.max - used), valid: used <= config.max + 1e-6,
        mode: config.mode, metric: config.metric });
      this.#renderer.update(revision, "MOVE");
      if (typeof options.onRevision === "function") {
        try { Promise.resolve(options.onRevision(revision)).catch(error => Logger.warn(`Chevron onRevision failed: ${error.message}`)); }
        catch (error) { Logger.warn(`Chevron onRevision failed: ${error.message}`); }
      }
    };
    const snap = event => {
      const next = pointFromEvent(event);
      if (!same(next, cursor)) { cursor = next; publish(); }
    };
    try {
      this.#renderer.show({ shape: { type: "chevron" }, metrics, options,
        capabilities: { elevation: config.elevation } });
      publish();
      listen(globalThis.window, "pointermove", event => {
        if (closed || event.target !== view) return;
        pointer = { clientX: event.clientX, clientY: event.clientY };
        if (locked && event.ctrlKey) { stop(event); return; }
        locked = false;
        if (performance.now() >= cameraQuietUntil) snap(event);
        stop(event);
      });
      listen(globalThis.window, "wheel", event => {
        if (closed || event.target !== view) return;
        if (!event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey) {
          cameraQuietUntil = performance.now() + 200;
          return;
        }
        stop(event);
        if (!config.elevation || !event.ctrlKey || event.shiftKey || event.altKey || event.metaKey || !event.deltaY) return;
        let reverse = true;
        try {
          const value = globalThis.game?.settings?.get?.(MODULE_ID, SETTINGS.CROSSHAIR_3D_REVERSE_ELEVATION_WHEEL);
          if (typeof value === "boolean") reverse = value;
        } catch { /* match the suite's default */ }
        locked = true;
        cursor = { ...cursor, elevation: cursor.elevation + (event.deltaY < 0 ? 1 : -1) * (reverse ? -1 : 1) * elevationStep };
        publish();
      });
      for (const type of ["keydown", "keyup"]) listen(globalThis.window, type, event => {
        if (closed || event.target?.closest?.("input,textarea,select,[contenteditable='true']")) return;
        if (event.key === "Escape") { stop(event); if (type === "keydown") session.finish(null); }
        else if (["Control", "Shift", "Alt", "AltGraph", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
          stop(event);
          if (event.key === "Control" && type === "keyup") locked = false;
        }
      });
      listen(globalThis.window, "pointerdown", event => {
        if (closed || event.target !== view || ![0, 2].includes(event.button)) return;
        stop(event);
        gesture = { id: event.pointerId, button: event.button, started: performance.now() };
      });
      listen(globalThis.window, "pointerup", event => {
        if (!gesture || gesture.id !== event.pointerId || gesture.button !== event.button) return;
        stop(event);
        gesture = null;
        if (closed) return;
        if (event.target !== view) return; // A release over the sidebar does not confirm a canvas point.
        pointer = { clientX: event.clientX, clientY: event.clientY };
        if (event.button === 2) {
          if (config.mode !== "path" || !waypoints.length) session.finish(null);
          else {
            waypoints.pop();
            cursor = { ...cursor, elevation: (waypoints.at(-1) ?? origin).elevation };
            publish();
          }
          return;
        }
        if (event.shiftKey || event.altKey || event.metaKey) return;
        if (!locked) snap(event);
        publish();
        if (!revision.valid) {
          globalThis.ui?.notifications?.warn?.(`That placement exceeds the ${config.max} ${scene.grid.units || "units"} limit.`);
          return;
        }
        if (config.mode === "path" && !same(cursor, waypoints.at(-1) ?? origin)) waypoints.push({ ...cursor });
        if (config.mode === "path" && event.ctrlKey) publish();
        else {
          const finalPoints = config.mode === "path" ? waypoints : [{ ...cursor }];
          const finalMeasurement = measure([origin, ...finalPoints]);
          if ((finalMeasurement.cost ?? finalMeasurement.distance) > config.max + 1e-6) throw new Error("Confirmed Chevron path exceeds its limit.");
          session.finish({ points: finalPoints.map(point => ({ ...point })), ...finalMeasurement });
        }
      });
      for (const type of ["mousedown", "mouseup", "click", "dblclick", "contextmenu"]) {
        listen(globalThis.window, type, event => { if (event.target === view) stop(event); });
      }
      listen(globalThis.window, "pointercancel", () => session.finish(null));
      listen(globalThis.window, "blur", event => { if (event.target === globalThis.window) session.finish(null); });
      if (options.signal) {
        if (options.signal.aborted) session.finish(null);
        else listen(options.signal, "abort", () => session.finish(null));
      }
      hook("canvasTearDown", () => session.finish(null));
      for (const name of ["updateToken", "deleteToken"]) hook(name, document => {
        if (document.id === doc.id && document.parent?.id === scene.id) session.finish(null);
      });
      if (config.movement) {
        const refreshCost = () => { key = null; publish(); };
        for (const name of ["createRegion", "updateRegion", "deleteRegion", "createRegionBehavior", "updateRegionBehavior", "deleteRegionBehavior"]) {
          hook(name, document => {
            const parentScene = document.documentName === "RegionBehavior" ? document.parent?.parent : document.parent;
            if (parentScene?.id === scene.id) refreshCost();
          });
        }
        hook("updateActor", actor => { if (actor.id === source.actor?.id) refreshCost(); });
      }
      tick = () => {
        try {
          if (closed) return;
          if (!canvas.ready || canvas.scene !== scene || source.destroyed) return session.finish(null);
          const stage = canvas.stage;
          const camera = [stage.position.x, stage.position.y, stage.pivot.x, stage.pivot.y, stage.scale.x, stage.scale.y].join("|");
          if (cameraKey !== null && cameraKey !== camera) cameraQuietUntil = performance.now() + 200;
          cameraKey = camera;
          if (pointer && !locked && performance.now() >= cameraQuietUntil) snap(pointer);
          if (gesture && performance.now() - gesture.started > 5000) session.finish(null);
          this.#renderer.frame(performance.now());
        } catch (error) { session.finish(null, error); }
      };
      ticker.add(tick, null, globalThis.PIXI.UPDATE_PRIORITY?.HIGH ?? 25);
      const confirmed = await done;
      if (confirmed === null) return Object.freeze({ cancelled: true, mode: config.mode, waypoints: Object.freeze([]), pixelWaypoints: Object.freeze([]) });
      const canonicalOrigin = this.#metrics.pixelsToDistance(origin, metrics);
      const canonicalPoints = frozenPoints(confirmed.points.map(point => this.#metrics.pixelsToDistance(point, metrics)));
      const pixelWaypoints = frozenPoints(confirmed.points);
      const destination = canonicalPoints.at(-1) ?? canonicalOrigin;
      return Object.freeze({ cancelled: false, mode: config.mode, metric: config.metric,
        origin: canonicalOrigin, waypoints: canonicalPoints, pixelWaypoints, placementPoint: destination,
        destination, pixelDestination: Object.freeze({ ...(confirmed.points.at(-1) ?? origin) }),
        distance: confirmed.distance,
        ...(config.movement ? { cost: confirmed.cost, movementDistance: confirmed.movementDistance,
          movementAction: confirmed.movementAction } : {}),
        max: config.max, remaining: Math.max(0, config.max - (confirmed.cost ?? confirmed.distance)),
        sourceUuid: doc.uuid, sceneId: scene.id,
        targetIds: Object.freeze([]), targets: Object.freeze([]), propagation: null, persistentRegion: null });
    } finally {
      const safely = fn => { try { fn(); } catch (error) { Logger.warn(`Chevron cleanup failed: ${error.message}`); } };
      closed = true;
      for (const [target, type, handler, capture] of listeners) safely(() => target.removeEventListener(type, handler, capture));
      for (const [name, id] of hooks) safely(() => globalThis.Hooks.off(name, id));
      if (tick) safely(() => ticker.remove(tick));
      safely(() => this.#renderer.clear());
      if (this.#active === session) this.#active = null;
    }
  }
}
