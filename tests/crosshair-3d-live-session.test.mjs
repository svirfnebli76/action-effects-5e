import test from "node:test";
import assert from "node:assert/strict";

import { Crosshair3dGeometryService } from "../scripts/crosshairs3d/geometry-service.js";
import { Crosshair3dCellRasterizerService } from "../scripts/crosshairs3d/cell-rasterizer-service.js";
import { Crosshair3dTokenVolumeService } from "../scripts/crosshairs3d/token-volume-service.js";
import { Crosshair3dRangeService } from "../scripts/crosshairs3d/range-service.js";
import { Crosshair3dPlacementRevisionService } from "../scripts/crosshairs3d/placement-revision-service.js";
import { Crosshair3dTargetingGeometryService } from "../scripts/crosshairs3d/targeting-geometry-service.js";
import { Crosshair3dCanvasMetricsService } from "../scripts/crosshairs3d/canvas-metrics-service.js";
import { Crosshair3dSurfaceService } from "../scripts/crosshairs3d/surface-service.js";
import { Crosshair3dPlacementSessionService } from "../scripts/crosshairs3d/placement-session-service.js";

function token({ id, x, y, width = 1, height = 1, depth = 1, elevation = 0, actor = true } = {}) {
  const document = { id, uuid: `Scene.test.Token.${id}`, x, y, width, height, depth, elevation, rotation: 0 };
  return { id, x, y, width, height, depth, elevation, document, actor: actor ? { id: `Actor.${id}` } : null };
}

function fakeWindow() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) { const set = listeners.get(type) ?? new Set(); set.add(fn); listeners.set(type, set); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    dispatch(type, event = {}) { for (const fn of [...(listeners.get(type) ?? [])]) fn({ preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, ...event }); },
    count(type) { return listeners.get(type)?.size ?? 0; }
  };
}

function harness({ cancelled = false, onShow = null, surfaces: surfaceOverride = null, carrierPosition = null, reverseElevationWheel = false } = {}) {
  const geometry = new Crosshair3dGeometryService();
  const cells = new Crosshair3dCellRasterizerService({ geometry });
  const tokens = new Crosshair3dTokenVolumeService();
  const range = new Crosshair3dRangeService();
  const revisions = new Crosshair3dPlacementRevisionService();
  const targeting = new Crosshair3dTargetingGeometryService({ cells, tokens });
  const metrics = new Crosshair3dCanvasMetricsService();
  const overlayEvents = [];
  const elevationGaugeEvents = [];
  const guideEvents = [];
  const overlay = { show: data => overlayEvents.push(["show", data]), update: data => overlayEvents.push(["update", data]), clear: () => overlayEvents.push(["clear"]) };
  const elevationGauge = { show: data => elevationGaugeEvents.push(["show", data]), update: data => elevationGaugeEvents.push(["update", data]), clear: () => elevationGaugeEvents.push(["clear"]) };
  const guide = { show: () => true, update: shape => guideEvents.push(shape), clear: () => guideEvents.push("clear") };
  const surfaces = surfaceOverride ?? { resolveAt: ({ fallbackElevation = 0 }) => ({ elevation: fallbackElevation, surface: null, source: "test" }) };
  const source = token({ id: "source", x: 0, y: 0, elevation: 0 });
  const inside = token({ id: "inside", x: 100, y: 100, elevation: 0 });
  const outside = token({ id: "outside", x: 600, y: 600, elevation: 0 });
  const targetHistory = [];
  const crosshairConfigs = [];
  const window = fakeWindow();
  const carrierX = carrierPosition?.x ?? 150;
  const carrierY = carrierPosition?.y ?? 150;
  const carrier = {
    x: carrierX, y: carrierY, direction: 0, elevation: 0, distance: 10,
    document: { x: carrierX, y: carrierY, direction: 0, elevation: 0, updateSource(update) { Object.assign(this, update); Object.assign(carrier, update); } },
    updateCrosshair(update) { Object.assign(this, update); Object.assign(this.document, update); },
    refresh() {}
  };
  const CALLBACKS = { SHOW: "show", MOVE: "move", MOUSE_MOVE: "mouseMove", PLACED: "placed", CANCEL: "cancel" };
  globalThis.window = window;
  globalThis.canvas = {
    ready: true,
    scene: { grid: { size: 100, distance: 5 } },
    grid: { size: 100 },
    dimensions: { distance: 5, sceneRect: { x: 0, y: 0 } },
    tokens: { placeables: [source, inside, outside], setTargets(ids) { targetHistory.push([...ids]); } }
  };
  globalThis.game = { user: { targets: new Set() }, settings: { get: () => reverseElevationWheel } };
  globalThis.MidiQOL = { isTargetable: () => true };
  globalThis.Sequencer = {
    Crosshair: {
      CALLBACKS,
      PLACEMENT_RESTRICTIONS: { LINE_OF_SIGHT: "los" },
      async show(config, callbacks) {
        crosshairConfigs.push(config);
        await callbacks.show?.(carrier);
        await onShow?.({ carrier, callbacks, window });
        if (cancelled) return null;
        await callbacks.placed?.(carrier);
        return carrier;
      }
    }
  };
  globalThis.CONST = { GRID_SNAPPING_MODES: { CENTER: 1 } };
  globalThis.foundry = { utils: { randomID: () => "session-test" } };

  const service = new Crosshair3dPlacementSessionService({ crosshairs: {}, geometry, cells, tokens, range, revisions, targeting, metrics, surfaces, overlay, elevationGauge, guide });
  return { service, source, inside, outside, carrier, targetHistory, overlayEvents, elevationGaugeEvents, guideEvents, crosshairConfigs, window };
}

test("live 3D placement collects targets through the grid-cell rules and preserves confirmed targets", async () => {
  const h = harness();
  const result = await h.service.show({
    source: h.source,
    remote: true,
    shape: { type: "sphere", origin: { x: 0, y: 0, z: 0 }, radius: 7.5 },
    capabilities: { elevation: true, rotation: false, los: false }
  });
  assert.equal(result.cancelled, false);
  assert.deepEqual(result.targetIds, ["inside"]);
  assert.deepEqual(h.targetHistory.at(-1), ["inside"]);
  assert.equal(h.service.getStats().active, false);
  assert.equal(h.window.count("wheel"), 0, "wheel interception is cleaned up");
});

test("cancel restores the target set that existed before placement", async () => {
  const h = harness({ cancelled: true });
  globalThis.game.user.targets = new Set([{ id: "outside" }]);
  const result = await h.service.show({
    source: h.source,
    remote: true,
    shape: { type: "sphere", origin: { x: 0, y: 0, z: 0 }, radius: 7.5 }
  });
  assert.equal(result.cancelled, true);
  assert.deepEqual(h.targetHistory.at(-1), ["outside"]);
  assert.equal(h.window.count("wheel"), 0);
});

test("every accepted Shift-wheel increment rotates the authoritative revision by five degrees", async () => {
  const h = harness({
    onShow: ({ window }) => window.dispatch("wheel", { shiftKey: true, ctrlKey: false, deltaY: -100 })
  });
  const result = await h.service.show({
    source: h.source,
    remote: true,
    shape: { type: "prism", origin: { x: 0, y: 0, z: 0 }, width: 5, length: 10, height: 5, yaw: 0 },
    capabilities: { rotation: true, elevation: true, los: false }
  });
  assert.equal(result.yaw, 5);
  assert.equal(result.revision.revision > 0, true);
});

test("Crosshair Elevation Gauge is visible only in ELEVATE and publishes an immediate pre-wheel side-view reading", async () => {
  const h = harness({
    carrierPosition: { x: 300, y: 100 },
    surfaces: { resolveAt: () => ({ elevation: 10, surface: null, source: "test" }) },
    onShow: ({ window }) => {
      window.dispatch("keydown", { key: "Control" });
      window.dispatch("keyup", { key: "Control" });
      window.dispatch("keydown", { key: "Shift" });
      window.dispatch("keyup", { key: "Shift" });
    }
  });
  const result = await h.service.show({
    source: h.source,
    remote: true,
    shape: { type: "sphere", origin: { x: 0, y: 0, z: 0 }, radius: 5 },
    range: { max: 60 },
    capabilities: { rotation: true, elevation: true, los: false }
  });

  assert.equal(result.cancelled, false);
  assert.equal(h.service.getStats().wheelEvents, 0, "entering ELEVATE does not require a wheel notch");
  const updates = h.elevationGaugeEvents.filter(([type]) => type === "update").map(([, data]) => data);
  const immediateElevate = updates.find(data => data?.visible === true);
  assert.ok(immediateElevate, "Ctrl entry immediately publishes a visible gauge reading");
  assert.ok(immediateElevate.angle > 0 && immediateElevate.angle < 90, "initial side-view angle is derived before any Z movement");
  assert.ok(Number.isFinite(immediateElevate.distance) && immediateElevate.distance > 0, "initial A→B distance is available immediately");
  assert.ok(updates.some(data => data?.visible === false), "MOVE/ROTATE mode transitions explicitly hide the gauge");
});


test("Alt input cannot latch ELEVATE after a swallowed Ctrl keyup", async () => {
  const h = harness({
    carrierPosition: { x: 300, y: 100 },
    onShow: ({ window }) => {
      window.dispatch("keydown", { key: "Control", ctrlKey: true });
      window.dispatch("keydown", { key: "Alt", ctrlKey: true, altKey: true });
      // Reproduce the Electron/browser edge case: Ctrl is physically released
      // but its keyup is not delivered while Alt has altered focus/menu state.
      window.dispatch("keyup", { key: "Alt", ctrlKey: false, altKey: false });
    }
  });
  const result = await h.service.show({
    source: h.source,
    remote: true,
    shape: { type: "sphere", origin: { x: 0, y: 0, z: 0 }, radius: 5 },
    range: { max: 60 },
    capabilities: { rotation: true, elevation: true, los: false }
  });

  assert.equal(result.cancelled, false);
  const modes = h.overlayEvents.filter(([type]) => type === "update").map(([, data]) => data?.mode).filter(Boolean);
  assert.ok(modes.includes("ELEVATE"), "Ctrl still enters ELEVATE before Alt exposes the missed-keyup case");
  assert.equal(modes.at(-1), "MOVE", "Alt keyup resynchronizes physical modifier state and releases ELEVATE");
  const gaugeUpdates = h.elevationGaugeEvents.filter(([type]) => type === "update").map(([, data]) => data);
  assert.equal(gaugeUpdates.at(-1)?.visible, false, "gauge hides when the recovered mode returns to MOVE");
});

test("pointer movement cannot knock an active Ctrl-held session out of ELEVATE", async () => {
  const h = harness({
    onShow: ({ window }) => {
      window.dispatch("keydown", { key: "Control", ctrlKey: true });
      // Foundry/Sequencer may emit pointer activity without reliable modifier flags.
      // It must not redefine the keyboard-selected ELEVATE mode or hide the gauge.
      window.dispatch("pointermove", { isTrusted: true, ctrlKey: false, shiftKey: false, altKey: false });
      window.dispatch("pointermove", { isTrusted: true, ctrlKey: false, shiftKey: false, altKey: false });
    }
  });
  const result = await h.service.show({
    source: h.source,
    remote: true,
    shape: { type: "sphere", origin: { x: 0, y: 0, z: 0 }, radius: 5 },
    capabilities: { rotation: true, elevation: true, los: false }
  });

  assert.equal(result.cancelled, false);
  assert.equal(h.window.count("pointermove"), 0, "Alt-recovery pointer listener is cleaned up with the placement session");
  const modes = h.overlayEvents.filter(([type]) => type === "update").map(([, data]) => data?.mode).filter(Boolean);
  const elevateIndex = modes.indexOf("ELEVATE");
  assert.ok(elevateIndex >= 0, "Ctrl enters ELEVATE");
  assert.equal(modes.slice(elevateIndex).every(mode => mode === "ELEVATE"), true, "pointer movement cannot inject MOVE while Ctrl remains held");
  const gaugeUpdates = h.elevationGaugeEvents.filter(([type]) => type === "update").map(([, data]) => data);
  const visibleIndex = gaugeUpdates.findIndex(data => data?.visible === true);
  assert.ok(visibleIndex >= 0, "gauge becomes visible in ELEVATE");
  assert.equal(gaugeUpdates.slice(visibleIndex).every(data => data?.visible !== false), true, "pointer movement cannot flicker the gauge off during ELEVATE");
});

test("Alt recovery ignores synthetic pointer activity but trusted pointer input repairs a swallowed Ctrl release", async () => {
  const h = harness({
    onShow: ({ window }) => {
      window.dispatch("keydown", { key: "Control", ctrlKey: true });
      window.dispatch("keydown", { key: "Alt", ctrlKey: true, altKey: true });
      // Reproduce the live Electron case where Alt's own keyup still reports the
      // stale Ctrl latch and the real Ctrl keyup never reaches AE5E.
      window.dispatch("keyup", { key: "Alt", ctrlKey: true, altKey: false });
      // Foundry/Sequencer synthetic pointer activity must not repair or redefine
      // the mode; this is the v0.4.4.12 flicker regression boundary.
      window.dispatch("pointermove", { isTrusted: false, ctrlKey: false, shiftKey: false, altKey: false });
      // The next genuine physical pointer event may repair the stale latch.
      window.dispatch("pointermove", { isTrusted: true, ctrlKey: false, shiftKey: false, altKey: false });
    }
  });
  const result = await h.service.show({
    source: h.source,
    remote: true,
    shape: { type: "sphere", origin: { x: 0, y: 0, z: 0 }, radius: 5 },
    range: { max: 60 },
    capabilities: { rotation: true, elevation: true, los: false }
  });

  assert.equal(result.cancelled, false);
  const modes = h.overlayEvents.filter(([type]) => type === "update").map(([, data]) => data?.mode).filter(Boolean);
  const elevateIndex = modes.indexOf("ELEVATE");
  assert.ok(elevateIndex >= 0, "Ctrl enters ELEVATE before Alt interferes with keyup delivery");
  assert.equal(modes.at(-1), "MOVE", "trusted pointer recovery clears the stale Ctrl latch after Alt");
  const gaugeUpdates = h.elevationGaugeEvents.filter(([type]) => type === "update").map(([, data]) => data);
  assert.equal(gaugeUpdates.at(-1)?.visible, false, "gauge hides after trusted pointer recovery returns to MOVE");
});

test("trusted pointer recovery remains armed while a physical modifier is still held", async () => {
  let modesAfterHeldPointer = [];
  let gaugeAfterHeldPointer = [];
  let h;
  h = harness({
    onShow: ({ window }) => {
      window.dispatch("keydown", { key: "Control", ctrlKey: true });
      window.dispatch("keydown", { key: "Alt", ctrlKey: true, altKey: true });
      window.dispatch("keyup", { key: "Alt", ctrlKey: true, altKey: false });
      // Genuine mouse motion while Ctrl is still held must keep ELEVATE and keep
      // recovery armed for the later swallowed release.
      window.dispatch("pointermove", { isTrusted: true, ctrlKey: true, shiftKey: false, altKey: false });
      modesAfterHeldPointer = h.overlayEvents.filter(([type]) => type === "update").map(([, data]) => data?.mode).filter(Boolean);
      gaugeAfterHeldPointer = h.elevationGaugeEvents.filter(([type]) => type === "update").map(([, data]) => data);
      window.dispatch("pointermove", { isTrusted: true, ctrlKey: false, shiftKey: false, altKey: false });
    }
  });
  const result = await h.service.show({
    source: h.source,
    remote: true,
    shape: { type: "sphere", origin: { x: 0, y: 0, z: 0 }, radius: 5 },
    range: { max: 60 },
    capabilities: { rotation: true, elevation: true, los: false }
  });

  assert.equal(result.cancelled, false);
  assert.equal(modesAfterHeldPointer.at(-1), "ELEVATE", "trusted pointer motion while Ctrl remains held stays in ELEVATE");
  assert.notEqual(gaugeAfterHeldPointer.at(-1)?.visible, false, "trusted pointer motion while Ctrl remains held does not hide the gauge");
  const modes = h.overlayEvents.filter(([type]) => type === "update").map(([, data]) => data?.mode).filter(Boolean);
  assert.ok(modes.includes("ELEVATE"), "Ctrl enters ELEVATE");
  assert.equal(modes.at(-1), "MOVE", "later trusted pointer input still repairs the swallowed Ctrl release");
});

test("an unmodified wheel event is never captured by stale cached Ctrl state", async () => {
  const h = harness({
    onShow: ({ window }) => {
      window.dispatch("keydown", { key: "Control", ctrlKey: true });
      // No Ctrl keyup arrives; the wheel event itself says Ctrl is physically up.
      window.dispatch("wheel", { shiftKey: false, ctrlKey: false, altKey: false, deltaY: -100 });
    }
  });
  const result = await h.service.show({
    source: h.source,
    remote: true,
    shape: { type: "sphere", origin: { x: 0, y: 0, z: 0 }, radius: 5 },
    capabilities: { rotation: false, elevation: true, los: false }
  });

  assert.equal(result.cancelled, false);
  assert.equal(h.service.getStats().wheelEvents, 0, "AE5E does not intercept an unmodified wheel because an older Ctrl state was cached");
  assert.equal(result.placementPoint.z, 0, "stale Ctrl cannot apply an elevation step");
});

test("Self Ray Ctrl-wheel changes pitch while preserving fixed centerline length", async () => {
  const h = harness({
    onShow: ({ window }) => window.dispatch("wheel", { shiftKey: false, ctrlKey: true, deltaY: -100 })
  });
  const result = await h.service.show({
    source: h.source,
    self: true,
    shape: { type: "ray", origin: { x: 0, y: 0, z: 0 }, length: 20, width: 5, yaw: 0, pitch: 0 },
    capabilities: { rotation: true, elevation: true, los: false }
  });
  assert.equal(Math.round(result.pitch * 1000) / 1000, Math.round((Math.asin(5 / 20) * 180 / Math.PI) * 1000) / 1000);
  assert.equal(result.shape.length, 20);
});

test("ELEVATE mouse-wheel direction can be reversed by the client setting without changing Shift rotation", async () => {
  const h = harness({
    reverseElevationWheel: true,
    carrierPosition: { x: 300, y: 100 },
    onShow: ({ window }) => window.dispatch("wheel", { shiftKey: false, ctrlKey: true, deltaY: -100 })
  });
  const result = await h.service.show({
    source: h.source,
    remote: true,
    shape: { type: "sphere", origin: { x: 0, y: 0, z: 0 }, radius: 5 },
    range: { max: 60 },
    capabilities: { elevation: true, rotation: false, los: false }
  });

  assert.equal(result.cancelled, false);
  assert.equal(result.placementPoint.z, -5, "default reversed ELEVATE input sends an upward wheel notch toward the opposite construction-circle direction");
});

test("rapid wheel input preserves every accepted rotation notch while resolution coalesces", async () => {
  const h = harness({
    onShow: ({ window }) => {
      window.dispatch("wheel", { shiftKey: true, ctrlKey: false, deltaY: -100 });
      window.dispatch("wheel", { shiftKey: true, ctrlKey: false, deltaY: -100 });
      window.dispatch("wheel", { shiftKey: true, ctrlKey: false, deltaY: -100 });
    }
  });
  const result = await h.service.show({
    source: h.source,
    remote: true,
    shape: { type: "prism", origin: { x: 0, y: 0, z: 0 }, width: 5, length: 10, height: 5, yaw: 0 },
    capabilities: { rotation: true, elevation: true, los: false }
  });
  assert.equal(result.yaw, 15);
});

test("remote elevation snaps Z to Scene grid planes while XY remains continuous on the construction circle", async () => {
  const revisions = [];
  const h = harness({
    carrierPosition: { x: 300, y: 100 },
    onShow: async ({ window }) => {
      for (let i = 0; i < 4; i += 1) {
        window.dispatch("wheel", { shiftKey: false, ctrlKey: true, deltaY: -100 });
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
  });
  const result = await h.service.show({
    source: h.source,
    remote: true,
    shape: { type: "sphere", origin: { x: 0, y: 0, z: 0 }, radius: 5 },
    range: { max: 60 },
    capabilities: { elevation: true, rotation: false, los: false },
    onRevision: revision => revisions.push(revision)
  });

  assert.equal(result.cancelled, false);
  const elevated = revisions.filter(revision => revision.reason === "wheel-elevate");
  assert.equal(elevated.length, 4);
  assert.deepEqual(elevated.map(revision => revision.point.z), [5, 10, 5, 0]);
  for (const revision of elevated) {
    assert.ok(Math.abs(revision.point.z / 5 - Math.round(revision.point.z / 5)) < 1e-9, "every accepted elevation lies exactly on a 5-ft Scene grid plane");
  }
  assert.ok(
    elevated.some(revision => Math.abs(revision.point.x / 5 - Math.round(revision.point.x / 5)) > 1e-3),
    "ELEVATE solves XY continuously instead of forcing the construction circle onto map-grid XY coordinates"
  );
  assert.equal(h.service.getStats().wheelEvents, 4);
  assert.ok(h.elevationGaugeEvents.some(([type, data]) => type === "show" && data?.enabled === true), "elevation-capable placement creates the Crosshair Elevation Gauge");
  assert.ok(h.elevationGaugeEvents.some(([type, data]) => type === "update" && data?.maxRange === 60 && Number.isFinite(data?.distance)), "gauge receives authoritative range-scaled side-view state");
  assert.equal(h.elevationGaugeEvents.at(-1)?.[0], "clear", "gauge cleans up with the placement session");
});

test("remote elevation stays grid-Z snapped across an unsnapped zenith", async () => {
  const revisions = [];
  const h = harness({
    carrierPosition: { x: 616.854, y: 100 },
    onShow: async ({ window }) => {
      for (let i = 0; i < 7; i += 1) {
        window.dispatch("wheel", { shiftKey: false, ctrlKey: true, deltaY: -100 });
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
  });
  const result = await h.service.show({
    source: h.source,
    remote: true,
    shape: { type: "sphere", origin: { x: 0, y: 0, z: 0 }, radius: 5 },
    range: { max: 60 },
    capabilities: { elevation: true, rotation: false, los: false },
    onRevision: revision => revisions.push(revision)
  });

  assert.equal(result.cancelled, false);
  const elevated = revisions.filter(revision => revision.reason === "wheel-elevate");
  assert.deepEqual(elevated.map(revision => revision.point.z), [5, 10, 15, 20, 25, 25, 20]);
  assert.ok(
    elevated[5].elevationPhase > 90,
    "when zenith lies between Z grid planes, the next notch reaches the matching snapped plane on the far side rather than publishing an unsnapped pole elevation"
  );
});

test("remote elevation wraps backward from phase zero instead of clamping", async () => {
  const h = harness({
    carrierPosition: { x: 400, y: 100 },
    onShow: ({ window }) => window.dispatch("wheel", { shiftKey: false, ctrlKey: true, deltaY: 100 })
  });
  const result = await h.service.show({
    source: h.source,
    remote: true,
    shape: { type: "sphere", origin: { x: 0, y: 0, z: 0 }, radius: 5 },
    range: { max: 60 },
    capabilities: { elevation: true, rotation: false, los: false }
  });

  assert.equal(result.cancelled, false);
  assert.ok(result.revision.elevationPhase > 270 && result.revision.elevationPhase < 360, "negative travel wraps into the 270-360 degree quadrant");
  assert.ok(result.placementPoint.z < 0, "the first reverse notch moves below the starting plane instead of sticking at zero");
  const redOverlay = h.overlayEvents.find(([type, data]) => type === "update" && Number(data?.elevation) < Number(data?.originElevation));
  assert.ok(redOverlay, "accepted below-source elevation is explicitly identified to the overlay for red presentation");
  const negativeGauge = h.elevationGaugeEvents.find(([type, data]) => type === "update" && data?.belowOrigin === true);
  assert.ok(negativeGauge, "Crosshair Elevation Gauge receives the below-origin side-view state");
  assert.ok(negativeGauge[1].angle > 270 && negativeGauge[1].angle < 360, "gauge preserves the far-side/reverse construction angle instead of flattening it to a right-half-plane angle");
});

test("remote elevation remains cyclic across repeated full-circle travel and Ctrl release/re-entry", async () => {
  const h = harness({
    onShow: ({ window }) => {
      for (let i = 0; i < 8; i += 1) {
        window.dispatch("keydown", { key: "Control" });
        window.dispatch("wheel", { shiftKey: false, ctrlKey: true, deltaY: -100 });
        window.dispatch("keyup", { key: "Control", ctrlKey: false });
      }
    }
  });
  const result = await h.service.show({
    source: h.source,
    remote: true,
    shape: { type: "sphere", origin: { x: 0, y: 0, z: 0 }, radius: 5 },
    range: { max: 60 },
    capabilities: { elevation: true, rotation: false, los: false }
  });

  assert.equal(result.cancelled, false);
  assert.ok(result.revision.elevationPhase >= 0 && result.revision.elevationPhase < 360);
  assert.equal(h.service.getStats().wheelEvents, 8);
});

test("releasing Ctrl returns remote MOVE to the cursor position while preserving manual Z", async () => {
  const h = harness({
    carrierPosition: { x: 300, y: 100 },
    onShow: async ({ carrier, callbacks, window }) => {
      window.dispatch("keydown", { key: "Control" });
      window.dispatch("wheel", { shiftKey: false, ctrlKey: true, deltaY: -100 });
      await new Promise(resolve => setTimeout(resolve, 5));
      window.dispatch("keyup", { key: "Control", ctrlKey: false });
      await new Promise(resolve => setTimeout(resolve, 70));

      // Default Sequencer MOVE behavior is cursor-centered. After Ctrl release,
      // the next raw carrier position therefore becomes authoritative XY again,
      // while AE5E preserves the manually selected absolute Z.
      carrier.x = 320; carrier.document.x = 320;
      carrier.y = 100; carrier.document.y = 100;
      await callbacks.move?.(carrier);
    }
  });
  const revisions = [];
  const result = await h.service.show({
    source: h.source,
    remote: true,
    shape: { type: "sphere", origin: { x: 0, y: 0, z: 0 }, radius: 5 },
    range: { max: 60 },
    capabilities: { elevation: true, rotation: false, los: false },
    onRevision: revision => revisions.push(revision)
  });

  const elevated = revisions.find(revision => revision.reason === "wheel-elevate");
  const moved = revisions.find(revision => revision.reason === "move" && revision.revision > elevated.revision);
  assert.ok(elevated && moved);
  assert.ok(Math.abs(moved.point.x - 16) < 0.05, "MOVE reacquires the raw 320 px cursor-centered X position");
  assert.ok(Math.abs(moved.point.y - 5) < 0.05, "MOVE reacquires the raw 100 px cursor-centered Y position");
  assert.equal(moved.point.z, elevated.point.z, "manual Z remains preserved when MOVE snaps back under the cursor");
  assert.equal(result.cancelled, false);
});


test("functional Sequencer carrier does not own the click-to-confirm label", async () => {
  const h = harness();
  const result = await h.service.show({
    source: h.source,
    remote: true,
    shape: { type: "sphere", origin: { x: 0, y: 0, z: 0 }, radius: 5 },
    capabilities: { elevation: true, rotation: false, los: false }
  });

  assert.equal(result.cancelled, false);
  assert.equal(h.crosshairConfigs.length, 1);
  assert.equal(Object.hasOwn(h.crosshairConfigs[0], "label"), false, "raw cursor carrier cannot drag a Sequencer label outside the accepted boundary");
  assert.ok(h.overlayEvents.some(([type, data]) => type === "update" && data?.point), "AE5E overlay is updated from accepted authoritative revisions");
});

test("Self Cone/ Ray pitch crosses vertical by handing the apex to the opposite source boundary", async () => {
  const h = harness({
    onShow: ({ window }) => {
      window.dispatch("wheel", { shiftKey: false, ctrlKey: true, deltaY: -100 });
      window.dispatch("wheel", { shiftKey: false, ctrlKey: true, deltaY: -100 });
      window.dispatch("wheel", { shiftKey: false, ctrlKey: true, deltaY: -100 });
    }
  });
  const result = await h.service.show({
    source: h.source,
    self: true,
    shape: { type: "ray", origin: { x: 0, y: 0, z: 0 }, length: 10, width: 5, yaw: 0, pitch: 0 },
    capabilities: { rotation: true, elevation: true, los: false }
  });
  assert.equal(result.cancelled, false);
  assert.equal(Math.round(result.yaw), 180, "the authoritative horizontal direction flips after vertical");
  assert.equal(Math.round(result.pitch), 30, "the canonical pitch continues on the opposite side");
  assert.equal(Math.round(result.placementPoint.x * 1000) / 1000, 0, "the legal apex moves from east boundary to west boundary");
  assert.equal(Math.round(result.revision.endpointZ * 1000) / 1000, 5, "the endpoint remains on the fixed-length elevation arc");
});

test("surface resolution prefers a matching move surface on the current Foundry Level before higher surfaces elsewhere", () => {
  const service = new Crosshair3dSurfaceService();
  const currentLevel = { id: "middle" };
  const matchingSurface = elevation => ({
    elevation,
    region: { testPoint: () => true }
  });
  const middle = matchingSurface(10);
  const roof = matchingSurface(30);
  const scene = {
    getSurfaces({ level } = {}) {
      return level === currentLevel ? [middle] : [middle, roof];
    }
  };

  assert.deepEqual(
    service.resolveAt({ x: 100, y: 100, fallbackElevation: 0, scene, preferredLevel: currentLevel }),
    { elevation: 10, surface: middle, source: "foundry-level-surface" }
  );
  assert.deepEqual(
    service.resolveAt({ x: 100, y: 100, fallbackElevation: 0, scene, preferredLevel: null }),
    { elevation: 30, surface: roof, source: "foundry-surface" }
  );
});

test("remote MOVE preserves the manually selected absolute Z plane while true-3D range clamps XY", async () => {
  const h = harness({
    carrierPosition: { x: 300, y: 100 },
    onShow: async ({ window, carrier, callbacks }) => {
      window.dispatch("wheel", { shiftKey: false, ctrlKey: true, deltaY: -100 });
      carrier.x = 1000;
      carrier.document.x = 1000;
      await callbacks.move?.(carrier);
    }
  });
  const result = await h.service.show({
    source: h.source,
    remote: true,
    shape: { type: "sphere", origin: { x: 0, y: 0, z: 0 }, radius: 5 },
    range: { max: 15 },
    capabilities: { elevation: true, rotation: false, los: false }
  });

  assert.equal(result.cancelled, false);
  assert.equal(result.revision.manualElevation, true);
  assert.ok(result.placementPoint.z > 0, "manual elevation establishes an elevated absolute plane");
  assert.ok(
    Math.abs(result.placementPoint.z - result.revision.selectedAbsoluteZ) < 1e-6,
    "range clamping preserves the selected absolute Z plane on flat terrain"
  );
  assert.ok(
    h.service.getStats().targetRecalculations > 0,
    "the clamped revision remains a normal target-recalculated placement revision"
  );
});
