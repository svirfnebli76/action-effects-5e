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

test("source-bound Line keeps source Z fixed through positive and negative pitch", async () => {
  for (const pitch of [-90, -30, 0, 30, 90]) {
    const h = harness();
    h.source.document.elevation = 5;
    const result = await h.service.show({ source: h.source, placement: { mode: "source" },
      shape: { type: "line", length: 20, width: 5, yaw: 0, pitch } });
    assert.equal(result.cancelled, false);
    assert.equal(result.placementPoint.z, 5);
    const shape = h.guideEvents.filter(entry => typeof entry === "object").at(-1);
    assert.equal(shape.length, 20);
    assert.equal(shape.origin.z, 5);
    assert.equal(shape.pitch, pitch);
    const hud = h.overlayEvents.filter(([type]) => type === "update").at(-1)[1];
    assert.equal(hud.fixedHud, true);
    assert.equal(hud.elevationVisible, false);
    assert.equal(h.window.count("wheel"), 0);
  }
});

test("Line anchor is continuous across all cardinal headings for small and large sources", async () => {
  for (const width of [1, 2]) {
    for (const cardinal of [0, 90, 180, 270]) {
      let previous;
      for (const offset of [-2.5, 0, 2.5]) {
        const h = harness({ onShow: ({ carrier }) => { carrier.direction = carrier.document.direction = cardinal + offset; } });
        h.source.document.width = width;
        const result = await h.service.show({ source: h.source,
          shape: { type: "line", length: 20, width: 5, yaw: cardinal + offset, pitch: 0 } });
        const p = result.placementPoint;
        if (previous) assert.ok(Math.hypot(p.x-previous.x, p.y-previous.y) < 0.5, "no grid-sized anchor jump");
        if (offset === 0 && cardinal === 180) {
          assert.ok(Math.abs(p.x) < 1e-8);
          assert.ok(Math.abs(p.y - 2.5) < 1e-8, "west begins at the left-face midpoint");
        }
        previous = p;
      }
    }
  }
});

test("west target stays affected on both sides of the exact west wheel tick", async () => {
  for (const yaw of [175, 177.5, 180, 182.5, 185]) {
    const h = harness({ onShow: ({ carrier }) => { carrier.direction = carrier.document.direction = yaw; } });
    Object.assign(h.inside.document, { x: -300, y: 0 });
    Object.assign(h.inside, { x: -300, y: 0 });
    const result = await h.service.show({ source: h.source,
      shape: { type: "line", length: 20, width: 5, yaw, pitch: 0 } });
    assert.ok(result.targetIds.includes("inside"), `west target at ${yaw} degrees`);
    assert.equal(result.shape.width, 5, "rules width remains unchanged");
  }
});

test("Alt recovery survives missing Alt/Ctrl keyup without disturbing held modifiers or leaking listeners", async () => {
  for (const type of ["sphere", "prism", "cone", "line"]) {
    let h;
    h = harness({ onShow: ({ window }) => {
      const mode = () => h.overlayEvents.filter(([kind, data]) => kind === "update" && data.mode).at(-1)[1].mode;
      const pointer = extra => window.dispatch("pointermove", { isTrusted: true, ctrlKey: false, shiftKey: false, altKey: false, ...extra });
      window.dispatch("keydown", { key: "Alt", altKey: true });
      pointer({}); // Must not disarm before the subsequent modifier cycle.
      window.dispatch("keydown", { key: "Control", ctrlKey: true });
      assert.equal(mode(), "ELEVATE");
      pointer({ isTrusted: false });
      assert.equal(mode(), "ELEVATE", "synthetic input cannot recover");
      pointer({ ctrlKey: true });
      assert.equal(mode(), "ELEVATE", "held Ctrl is preserved");
      pointer({ altKey: true });
      assert.equal(mode(), "ELEVATE", "Alt-held input cannot recover");
      pointer({}); // No Ctrl keyup has arrived.
      assert.equal(mode(), "MOVE");
      window.dispatch("keydown", { key: "Control", ctrlKey: true });
      pointer({});
      assert.equal(mode(), "ELEVATE", "ordinary pointer input is inert after recovery");
      window.dispatch("keyup", { key: "Control", ctrlKey: false });
      window.dispatch("keydown", { key: "Alt", altKey: true });
      window.dispatch("keydown", { key: "Shift", shiftKey: true });
      pointer({ shiftKey: true });
      assert.equal(mode(), "ROTATE");
      pointer({});
      assert.equal(mode(), "MOVE", "missing Shift release also recovers");
    }});
    await h.service.show({ source: h.source,
      shape: { type, radius: 10, length: 20, width: 5, height: 5 },
      capabilities: { elevation: true, rotation: true } });
    for (const event of ["keydown", "keyup", "pointermove", "pointerdown", "wheel", "blur"]) assert.equal(h.window.count(event), 0);
  }
});

test("old ray API and deferred free placement fail before session side effects", async () => {
  for (const options of [
    { shape: { type: "ray", length: 20, width: 5 } },
    { shape: { type: "free-line", length: 20, width: 5 } },
    { shape: { type: "line", length: 20, width: 5 }, placement: { mode: "free" } },
    { shape: { type: "line", length: 20, width: 5 }, remote: true }
  ]) {
    const h = harness();
    await assert.rejects(h.service.show({ source: h.source, ...options }));
    assert.equal(h.targetHistory.length, 0);
    assert.equal(h.window.count("wheel"), 0);
    assert.equal(h.crosshairConfigs.length, 0);
  }
});

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



test("placement control hints are capability-conditional and ordered rotation, elevation, cancel", async () => {
  const sphere = harness();
  await sphere.service.show({
    source: sphere.source,
    remote: true,
    shape: { type: "sphere", origin: { x: 0, y: 0, z: 0 }, radius: 5 },
    capabilities: { rotation: false, elevation: true, los: false }
  });
  const sphereShow = sphere.overlayEvents.find(([type]) => type === "show")?.[1];
  assert.deepEqual(sphereShow?.hints, [
    "Hold Ctrl+Mousewheel to change Elevation",
    "Hold Ctrl+Shift+Mousewheel to Orbit Elevation",
    "Right Click to Cancel"
  ], "Sphere advertises direct elevation and orbital elevation but omits unavailable rotation");

  const prism = harness();
  await prism.service.show({
    source: prism.source,
    remote: true,
    shape: { type: "prism", origin: { x: 0, y: 0, z: 0 }, width: 5, length: 10, height: 5, yaw: 0 },
    capabilities: { rotation: true, elevation: true, los: false }
  });
  const prismShow = prism.overlayEvents.find(([type]) => type === "show")?.[1];
  assert.deepEqual(prismShow?.hints, [
    "Hold Shift+Mousewheel to change Rotation",
    "Hold Ctrl+Mousewheel to change Elevation",
    "Hold Ctrl+Shift+Mousewheel to Orbit Elevation",
    "Right Click to Cancel"
  ], "rotation-capable rigid placements list rotation, direct elevation, orbit, then cancel");
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
  assert.equal(h.crosshairConfigs[0]?.snap?.direction, 5, "MOVE-mode yaw retains the five-degree compatibility default");
});

test("controls.rotationStep configures the accepted per-placement Shift-wheel increment", async () => {
  const h = harness({
    onShow: ({ window }) => window.dispatch("wheel", { shiftKey: true, ctrlKey: false, deltaY: -100 })
  });
  const result = await h.service.show({
    source: h.source,
    remote: true,
    shape: { type: "prism", origin: { x: 0, y: 0, z: 0 }, width: 5, length: 10, height: 5, yaw: 0 },
    controls: { rotationStep: 2.5 },
    capabilities: { rotation: true, elevation: true, los: false }
  });
  assert.equal(result.yaw, 2.5);
  assert.equal(h.crosshairConfigs[0]?.snap?.direction, 2.5, "the same per-placement increment configures MOVE-mode yaw snapping");
});

test("Crosshair Elevation Gauge initializes before the first wheel notch in direct ELEVATE and remains available in ORBIT", async () => {
  const h = harness({
    carrierPosition: { x: 300, y: 100 },
    surfaces: { resolveAt: () => ({ elevation: 10, surface: null, source: "test" }) },
    onShow: ({ window }) => {
      window.dispatch("keydown", { key: "Control", ctrlKey: true, shiftKey: false });
      window.dispatch("keydown", { key: "Shift", ctrlKey: true, shiftKey: true });
      window.dispatch("keyup", { key: "Shift", ctrlKey: true, shiftKey: false });
      window.dispatch("keyup", { key: "Control", ctrlKey: false, shiftKey: false });
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
  assert.equal(h.service.getStats().wheelEvents, 0, "entering ELEVATE or ORBIT does not require a wheel notch");
  const updates = h.elevationGaugeEvents.filter(([type]) => type === "update").map(([, data]) => data);
  const visible = updates.filter(data => data?.visible === true);
  assert.ok(visible.length >= 3, "Ctrl ELEVATE, Ctrl+Shift ORBIT, and return-to-ELEVATE each publish a visible gauge reading");
  assert.ok(visible[0].angle > 0 && visible[0].angle < 90, "direct ELEVATE derives the initial side-view angle before any wheel movement");
  assert.ok(Number.isFinite(visible[0].distance) && visible[0].distance > 0, "direct ELEVATE immediately supplies the A→B distance");
  assert.equal(updates.at(-1)?.visible, false, "returning to MOVE hides the gauge");
});


test("Alt is capture-suppressed during placement and cannot disturb a Ctrl ELEVATE cycle", async () => {
  const altCalls = { down: { prevent: 0, stop: 0, immediate: 0 }, up: { prevent: 0, stop: 0, immediate: 0 } };
  const altEvent = (phase, extra = {}) => ({
    key: "Alt",
    altKey: phase === "down",
    preventDefault: () => { altCalls[phase].prevent += 1; },
    stopPropagation: () => { altCalls[phase].stop += 1; },
    stopImmediatePropagation: () => { altCalls[phase].immediate += 1; },
    ...extra
  });
  const h = harness({
    onShow: ({ window }) => {
      window.dispatch("keydown", { key: "Control", ctrlKey: true, shiftKey: false, altKey: false });
      window.dispatch("keydown", altEvent("down", { ctrlKey: true }));
      window.dispatch("keyup", altEvent("up", { ctrlKey: true, altKey: false }));
      window.dispatch("keyup", { key: "Control", ctrlKey: false, shiftKey: false, altKey: false });
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
  assert.deepEqual(altCalls.down, { prevent: 1, stop: 1, immediate: 1 }, "Alt keydown is fully suppressed at capture");
  assert.deepEqual(altCalls.up, { prevent: 1, stop: 1, immediate: 1 }, "Alt keyup is fully suppressed at capture");
  const modes = h.overlayEvents.filter(([type]) => type === "update").map(([, data]) => data?.mode).filter(Boolean);
  assert.ok(modes.includes("ELEVATE"), "Ctrl still enters ELEVATE");
  assert.equal(modes.at(-1), "MOVE", "Ctrl release returns normally to MOVE after Alt was suppressed");
  const gaugeUpdates = h.elevationGaugeEvents.filter(([type]) => type === "update").map(([, data]) => data);
  assert.equal(gaugeUpdates.at(-1)?.visible, false, "gauge hides when Ctrl release returns to MOVE");
});

test("a brief Alt press before ELEVATE cannot poison the later Ctrl release", async () => {
  const h = harness({
    onShow: ({ window }) => {
      window.dispatch("keydown", { key: "Alt", ctrlKey: false, shiftKey: false, altKey: true });
      window.dispatch("keyup", { key: "Alt", ctrlKey: false, shiftKey: false, altKey: false });
      window.dispatch("keydown", { key: "Control", ctrlKey: true, shiftKey: false, altKey: false });
      window.dispatch("keyup", { key: "Control", ctrlKey: false, shiftKey: false, altKey: false });
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
  assert.ok(elevateIndex >= 0, "Ctrl enters ELEVATE after the earlier Alt press");
  assert.equal(modes.at(-1), "MOVE", "Ctrl release exits ELEVATE normally after the earlier Alt press");
  const gaugeUpdates = h.elevationGaugeEvents.filter(([type]) => type === "update").map(([, data]) => data);
  assert.equal(gaugeUpdates.at(-1)?.visible, false, "gauge hides after the normal Ctrl release");
});

test("pointer activity remains non-authoritative and cannot flicker a Ctrl+Shift ORBIT gauge", async () => {
  let pointerListenerCount = null;
  let modeEventsBeforePointer = null;
  let modeEventsAfterPointer = null;
  let gaugeEventsBeforePointer = null;
  let gaugeEventsAfterPointer = null;
  let h;
  h = harness({
    onShow: ({ window }) => {
      pointerListenerCount = window.count("pointermove") + window.count("pointerdown");
      window.dispatch("keydown", { key: "Control", ctrlKey: true, shiftKey: false, altKey: false });
      window.dispatch("keydown", { key: "Shift", ctrlKey: true, shiftKey: true, altKey: false });
      modeEventsBeforePointer = h.overlayEvents.length;
      gaugeEventsBeforePointer = h.elevationGaugeEvents.length;
      window.dispatch("pointermove", { isTrusted: true, ctrlKey: false, shiftKey: false, altKey: false });
      window.dispatch("pointerdown", { isTrusted: true, ctrlKey: false, shiftKey: false, altKey: false });
      modeEventsAfterPointer = h.overlayEvents.length;
      gaugeEventsAfterPointer = h.elevationGaugeEvents.length;
      window.dispatch("keyup", { key: "Shift", ctrlKey: true, shiftKey: false, altKey: false });
      window.dispatch("keyup", { key: "Control", ctrlKey: false, shiftKey: false, altKey: false });
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
  assert.equal(pointerListenerCount, 2, "session-scoped pointer recovery is installed but inert until Alt");
  assert.equal(modeEventsAfterPointer, modeEventsBeforePointer, "pointer activity cannot publish a mode transition while Ctrl+Shift is held");
  assert.equal(gaugeEventsAfterPointer, gaugeEventsBeforePointer, "pointer activity cannot hide/rebuild the ORBIT gauge");
  const modes = h.overlayEvents.filter(([type]) => type === "update").map(([, data]) => data?.mode).filter(Boolean);
  assert.ok(modes.includes("ORBIT"), "Ctrl+Shift enters ORBIT");
  assert.equal(modes.at(-1), "MOVE", "modifier release remains the normal route back to MOVE");
  const gaugeUpdates = h.elevationGaugeEvents.filter(([type]) => type === "update").map(([, data]) => data);
  assert.ok(gaugeUpdates.some(data => data?.visible === true), "gauge becomes visible in ORBIT");
  assert.equal(gaugeUpdates.at(-1)?.visible, false, "modifier release hides the gauge");
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

test("remote rigid Ctrl-wheel translates only Z by one Scene grid unit", async () => {
  const revisions = [];
  const h = harness({
    carrierPosition: { x: 300, y: 100 },
    onShow: async ({ window }) => {
      window.dispatch("wheel", { shiftKey: false, ctrlKey: true, deltaY: -100 });
      await new Promise(resolve => setTimeout(resolve, 0));
      window.dispatch("wheel", { shiftKey: false, ctrlKey: true, deltaY: -100 });
      await new Promise(resolve => setTimeout(resolve, 0));
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

  const elevated = revisions.filter(revision => revision.reason === "wheel-elevate");
  assert.equal(elevated.length, 2);
  assert.deepEqual(elevated.map(revision => revision.point.z), [5, 10]);
  assert.ok(elevated.every(revision => revision.point.x === 15 && revision.point.y === 5), "direct elevation preserves exact authoritative X/Y");
  assert.equal(result.placementPoint.z, 10);
  const gaugeUpdates = h.elevationGaugeEvents.filter(([type]) => type === "update").map(([, data]) => data);
  const visibleGaugeUpdates = gaugeUpdates.filter(data => data?.visible === true);
  assert.ok(visibleGaugeUpdates.length >= 2, "direct elevation keeps the Crosshair Elevation Gauge visible while Z changes");
  assert.equal(visibleGaugeUpdates.at(-1)?.maxRange, 60, "direct elevation gauge retains the configured true-3D range scale");
  assert.ok(visibleGaugeUpdates.at(-1)?.elevationDelta > 0, "direct elevation gauge reports the final positive destination elevation");
});

test("remote rigid Ctrl-wheel rejects a whole grid step that would exceed true 3D range", async () => {
  const revisions = [];
  const h = harness({
    carrierPosition: { x: 300, y: 100 },
    onShow: async ({ window }) => {
      window.dispatch("wheel", { shiftKey: false, ctrlKey: true, deltaY: -100 });
      await new Promise(resolve => setTimeout(resolve, 0));
      window.dispatch("wheel", { shiftKey: false, ctrlKey: true, deltaY: -100 });
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  });
  const result = await h.service.show({
    source: h.source,
    remote: true,
    shape: { type: "prism", origin: { x: 0, y: 0, z: 0 }, width: 5, length: 10, height: 5, yaw: 0 },
    range: { max: 10 },
    capabilities: { elevation: true, rotation: true, los: false },
    onRevision: revision => revisions.push(revision)
  });

  const elevated = revisions.filter(revision => revision.reason === "wheel-elevate");
  assert.equal(elevated.length, 1, "only the in-range grid step becomes an accepted revision");
  assert.deepEqual(elevated.map(revision => revision.point.z), [5]);
  assert.equal(result.placementPoint.x, 15);
  assert.equal(result.placementPoint.y, 5);
  assert.equal(result.placementPoint.z, 5, "the rejected notch leaves the last legal XYZ unchanged");
  assert.equal(h.service.getStats().wheelEvents, 2, "both physical wheel inputs are observed even though one requested move is rejected");
});

test("rapid remote rigid Ctrl-wheel input preserves every legal vertical grid step", async () => {
  const h = harness({
    carrierPosition: { x: 300, y: 100 },
    onShow: ({ window }) => {
      window.dispatch("wheel", { shiftKey: false, ctrlKey: true, deltaY: -100 });
      window.dispatch("wheel", { shiftKey: false, ctrlKey: true, deltaY: -100 });
      window.dispatch("wheel", { shiftKey: false, ctrlKey: true, deltaY: -100 });
      window.dispatch("wheel", { shiftKey: false, ctrlKey: true, deltaY: -100 });
    }
  });
  const result = await h.service.show({
    source: h.source,
    remote: true,
    shape: { type: "prism", origin: { x: 0, y: 0, z: 0 }, width: 5, length: 10, height: 5, yaw: 0 },
    range: { max: 60 },
    capabilities: { elevation: true, rotation: true, los: false }
  });

  assert.equal(result.placementPoint.x, 15);
  assert.equal(result.placementPoint.y, 5);
  assert.equal(result.placementPoint.z, 20, "four rapid accepted notches preserve four complete 5-ft Z steps");
  assert.equal(h.service.getStats().wheelEvents, 4);
});

test("Self Line Ctrl-wheel changes pitch while preserving fixed centerline length", async () => {
  const h = harness({
    onShow: ({ window }) => window.dispatch("wheel", { shiftKey: false, ctrlKey: true, deltaY: -100 })
  });
  const result = await h.service.show({
    source: h.source,
    self: true,
    shape: { type: "line", origin: { x: 0, y: 0, z: 0 }, length: 20, width: 5, yaw: 0, pitch: 0 },
    capabilities: { rotation: true, elevation: true, los: false }
  });
  assert.equal(Math.round(result.pitch * 1000) / 1000, Math.round((Math.asin(5 / 20) * 180 / Math.PI) * 1000) / 1000);
  assert.equal(result.shape.length, 20);
});

test("per-placement controls.elevationStep changes self Cone endpoint height without changing centerline length", async () => {
  const h = harness({
    onShow: ({ window }) => window.dispatch("wheel", { shiftKey: false, ctrlKey: true, deltaY: -100 })
  });
  const result = await h.service.show({
    source: h.source,
    self: true,
    shape: { type: "cone", origin: { x: 0, y: 0, z: 0 }, length: 15, yaw: 0, pitch: 0 },
    controls: { elevationStep: 2.5 },
    capabilities: { rotation: true, elevation: true, los: false }
  });

  const expectedPitch = (Math.asin(2.5 / 15) * 180) / Math.PI;
  assert.equal(Math.round(result.pitch * 1000) / 1000, Math.round(expectedPitch * 1000) / 1000);
  assert.equal(Math.round((result.revision.endpointZ - result.placementPoint.z) * 1000) / 1000, 2.5);
  assert.equal(result.shape.length, 15, "custom endpoint-height stepping never changes authoritative Cone length");
});

test("per-placement controls.elevationStep scales cleanly for a long self Cone", async () => {
  const h = harness({
    onShow: ({ window }) => window.dispatch("wheel", { shiftKey: false, ctrlKey: true, deltaY: -100 })
  });
  const result = await h.service.show({
    source: h.source,
    self: true,
    shape: { type: "cone", origin: { x: 0, y: 0, z: 0 }, length: 100, yaw: 0, pitch: 0 },
    controls: { elevationStep: 10 },
    capabilities: { rotation: true, elevation: true, los: false }
  });

  assert.equal(Math.round((result.revision.endpointZ - result.placementPoint.z) * 1000) / 1000, 10);
  assert.equal(result.shape.length, 100);
});

test("per-placement controls.elevationStep also governs remote direct elevation", async () => {
  const h = harness({
    carrierPosition: { x: 300, y: 100 },
    onShow: ({ window }) => {
      window.dispatch("wheel", { shiftKey: false, ctrlKey: true, deltaY: -100 });
      window.dispatch("wheel", { shiftKey: false, ctrlKey: true, deltaY: -100 });
    }
  });
  const result = await h.service.show({
    source: h.source,
    remote: true,
    shape: { type: "prism", origin: { x: 0, y: 0, z: 0 }, width: 5, length: 10, height: 5, yaw: 0 },
    range: { max: 60 },
    controls: { elevationStep: 2.5 },
    capabilities: { elevation: true, rotation: true, los: false }
  });

  assert.equal(result.placementPoint.z, 5, "two rapid notches preserve two complete custom 2.5-ft steps");
});

test("Self Cone and Line keep their existing Ctrl pitch path and do not expose remote ORBIT", async () => {
  const h = harness({
    onShow: ({ window }) => {
      window.dispatch("wheel", { shiftKey: true, ctrlKey: true, deltaY: -100 });
      window.dispatch("wheel", { shiftKey: false, ctrlKey: true, deltaY: -100 });
    }
  });
  const result = await h.service.show({
    source: h.source,
    self: true,
    shape: { type: "cone", origin: { x: 0, y: 0, z: 0 }, length: 15, yaw: 0, pitch: 0 },
    capabilities: { rotation: true, elevation: true, los: false }
  });

  const show = h.overlayEvents.find(([type]) => type === "show")?.[1];
  assert.deepEqual(show?.hints, [
    "Hold Shift+Mousewheel to change Rotation",
    "Hold Ctrl+Mousewheel to change Elevation",
    "Right Click to Cancel"
  ], "self Cone retains its existing controls without the remote ORBIT instruction");
  assert.equal(Math.round(result.pitch * 1000) / 1000, Math.round((Math.asin(5 / 15) * 180 / Math.PI) * 1000) / 1000, "only the ordinary Ctrl notch changes self Cone pitch");
  assert.equal(result.revision.reason, "final-confirm");
  const modes = h.overlayEvents.filter(([type]) => type === "update").map(([, data]) => data?.mode).filter(Boolean);
  assert.equal(modes.includes("ORBIT"), false, "Ctrl+Shift remains non-operative for self Cone/Line");
});

test("Self Cone pitch remains cyclic beyond one complete 360-degree elevation revolution", async () => {
  const h = harness({
    onShow: ({ window }) => {
      // A 10-ft centerline with 5-ft endpoint-height stepping visits eight
      // accepted phases per revolution. The ninth notch must begin turn two.
      for (let index = 0; index < 9; index += 1) {
        window.dispatch("wheel", { shiftKey: false, ctrlKey: true, deltaY: -100 });
      }
    }
  });
  const result = await h.service.show({
    source: h.source,
    self: true,
    shape: { type: "cone", origin: { x: 0, y: 0, z: 0 }, length: 10, yaw: 0, pitch: 0 },
    capabilities: { rotation: true, elevation: true, los: false }
  });

  assert.equal(h.service.getStats().wheelEvents, 9);
  assert.equal(Math.round(result.revision.arcPitch), 30, "the ninth notch advances into a second revolution instead of stopping at 180 degrees");
  assert.equal(Math.round(result.pitch), 30);
  assert.equal(Math.round(result.yaw), 0);
  assert.equal(Math.round((result.revision.endpointZ - result.placementPoint.z) * 1000) / 1000, 5);
});

test("Self Cone uses a fixed viewport HUD and suppresses duplicate apex elevation text", async () => {
  const h = harness();
  const result = await h.service.show({
    source: h.source,
    self: true,
    shape: { type: "cone", origin: { x: 0, y: 0, z: 0 }, length: 15, yaw: 0, pitch: 0 },
    capabilities: { rotation: true, elevation: true, los: false }
  });

  assert.equal(result.cancelled, false);
  const shownOverlay = h.overlayEvents.find(([type]) => type === "show");
  const acceptedOverlay = h.overlayEvents.find(([type, data]) => type === "update" && data?.footprintRadiusPx);
  assert.equal(shownOverlay?.[1]?.fixedHud, true, "Cone requests a fixed screen-space control HUD at session start");
  assert.equal(acceptedOverlay?.[1]?.fixedHud, true, "every accepted Cone revision retains the fixed HUD anchor");
  assert.equal(acceptedOverlay?.[1]?.elevationVisible, false, "terminal-center label replaces the overlapping generic apex elevation label");
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
    controls: { rotationStep: 2.5 },
    capabilities: { rotation: true, elevation: true, los: false }
  });
  assert.equal(result.yaw, 7.5, "three rapid notches preserve every configured 2.5 degree increment");
});

test("remote ORBIT snaps Z to Scene grid planes while XY remains continuous on the construction circle", async () => {
  const revisions = [];
  const h = harness({
    carrierPosition: { x: 300, y: 100 },
    onShow: async ({ window }) => {
      for (let i = 0; i < 4; i += 1) {
        window.dispatch("wheel", { shiftKey: true, ctrlKey: true, deltaY: -100 });
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
  const elevated = revisions.filter(revision => revision.reason === "wheel-orbit");
  assert.equal(elevated.length, 4);
  assert.deepEqual(elevated.map(revision => revision.point.z), [5, 10, 5, 0]);
  for (const revision of elevated) {
    assert.ok(Math.abs(revision.point.z / 5 - Math.round(revision.point.z / 5)) < 1e-9, "every accepted elevation lies exactly on a 5-ft Scene grid plane");
  }
  assert.ok(
    elevated.some(revision => Math.abs(revision.point.x / 5 - Math.round(revision.point.x / 5)) > 1e-3),
    "ORBIT solves XY continuously instead of forcing the construction circle onto map-grid XY coordinates"
  );
  assert.equal(h.service.getStats().wheelEvents, 4);
  assert.ok(h.elevationGaugeEvents.some(([type, data]) => type === "show" && data?.enabled === true), "elevation-capable placement creates the Crosshair Elevation Gauge");
  assert.ok(h.elevationGaugeEvents.some(([type, data]) => type === "update" && data?.maxRange === 60 && Number.isFinite(data?.distance)), "gauge receives authoritative range-scaled side-view state");
  assert.equal(h.elevationGaugeEvents.at(-1)?.[0], "clear", "gauge cleans up with the placement session");
});

test("remote ORBIT stays grid-Z snapped across an unsnapped zenith", async () => {
  const revisions = [];
  const h = harness({
    carrierPosition: { x: 616.854, y: 100 },
    onShow: async ({ window }) => {
      for (let i = 0; i < 7; i += 1) {
        window.dispatch("wheel", { shiftKey: true, ctrlKey: true, deltaY: -100 });
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
  const elevated = revisions.filter(revision => revision.reason === "wheel-orbit");
  assert.deepEqual(elevated.map(revision => revision.point.z), [5, 10, 15, 20, 25, 25, 20]);
  assert.ok(
    elevated[5].elevationPhase > 90,
    "when zenith lies between Z grid planes, the next notch reaches the matching snapped plane on the far side rather than publishing an unsnapped pole elevation"
  );
});

test("remote ORBIT wraps backward from phase zero instead of clamping", async () => {
  const h = harness({
    carrierPosition: { x: 400, y: 100 },
    onShow: ({ window }) => window.dispatch("wheel", { shiftKey: true, ctrlKey: true, deltaY: 100 })
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

test("remote ORBIT remains cyclic across repeated full-circle travel and modifier release/re-entry", async () => {
  const h = harness({
    onShow: ({ window }) => {
      for (let i = 0; i < 8; i += 1) {
        window.dispatch("keydown", { key: "Control", ctrlKey: true, shiftKey: false });
        window.dispatch("keydown", { key: "Shift", ctrlKey: true, shiftKey: true });
        window.dispatch("wheel", { shiftKey: true, ctrlKey: true, deltaY: -100 });
        window.dispatch("keyup", { key: "Shift", ctrlKey: true, shiftKey: false });
        window.dispatch("keyup", { key: "Control", ctrlKey: false, shiftKey: false });
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

test("Self Cone/ Line pitch crosses vertical by handing the apex to the opposite source boundary", async () => {
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
    shape: { type: "line", origin: { x: 0, y: 0, z: 0 }, length: 10, width: 5, yaw: 0, pitch: 0 },
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

const freeLineOptions = source => ({ source,
  shape: { type: "free-line", length: 20, width: 5, height: 10 },
  range: { max: 120, policy: "endpoints" }
});

test("free Line wheel burst preserves midpoint, resizes, rotates and elevates before confirmation", async () => {
  const h = harness({ onShow: ({ window }) => {
    window.dispatch("wheel", { deltaY: 125, shiftKey: true });
    window.dispatch("wheel", { deltaY: -125 });
    window.dispatch("wheel", { deltaY: -125, ctrlKey: true });
    window.dispatch("wheel", { deltaY: -125, ctrlKey: true, shiftKey: true });
  } });
  const result = await h.service.show(freeLineOptions(h.source));
  assert.equal(result.cancelled, false);
  assert.equal(result.shape.length, 15);
  assert.equal(result.shape.yaw, 5);
  assert.equal(result.shape.height, 10);
  assert.equal(result.shape.width, 5);
  assert.equal(result.shape.origin.z, 5);
  const angle = result.shape.yaw * Math.PI / 180;
  assert.ok(Math.abs(result.shape.origin.x + Math.cos(angle)*7.5 - result.placementPoint.x) < 1e-8);
  assert.ok(Math.abs(result.shape.origin.y + Math.sin(angle)*7.5 - result.placementPoint.y) < 1e-8);
  assert.equal(h.window.count("wheel"), 0);
});

test("free Line starts at maximum length and wheel resize respects both limits", async () => {
  const h = harness({ onShow: ({ window }) => {
    for (let i=0; i<10; i++) window.dispatch("wheel", { deltaY: -125, shiftKey: true });
  } });
  const result = await h.service.show(freeLineOptions(h.source));
  assert.equal(result.shape.length, 20);
  assert.equal(h.guideEvents.find(e => typeof e === "object").length, 20);
  const h2 = harness({ onShow: ({ window }) => {
    for (let i=0; i<10; i++) window.dispatch("wheel", { deltaY: 125, shiftKey: true });
  } });
  assert.equal((await h2.service.show(freeLineOptions(h2.source))).shape.length, 5);
});

test("free Line endpoint range clamps far movement while center policy allows endpoints beyond range", async () => {
  for (const policy of ["center", "origin", "endpoints"]) {
    const h = harness({ carrierPosition: { x: 2000, y: 50 } });
    const options = freeLineOptions(h.source);
    options.range = { max: 15, policy };
    const result = await h.service.show(options);
    const range = new Crosshair3dRangeService();
    const volume = { minX: 0, maxX: 5, minY: 0, maxY: 5, bottom: 0, top: 5 };
    const start = result.shape.origin;
    const end = { ...start, x: start.x + result.shape.length };
    const points = policy === "center" ? [result.placementPoint] : policy === "origin" ? [start] : [start, end];
    for (const p of points) assert.ok(range.distanceFromVolumeToPoint(volume, p) <= 15.000001);
    if (policy !== "endpoints") assert.ok(range.distanceFromVolumeToPoint(volume, end) > 15);
  }
});

test("free Line elevation clamps both ends in XYZ and disabled controls do nothing", async () => {
  const h = harness({ onShow: ({ window }) => {
    for (let i=0; i<20; i++) window.dispatch("wheel", { deltaY: -125, ctrlKey: true });
  } });
  const options = freeLineOptions(h.source);
  options.range.max = 20;
  const result = await h.service.show(options);
  assert.ok(result.placementPoint.z > 5 && result.placementPoint.z < 25);
  assert.equal(result.shape.origin.z, result.placementPoint.z);
  const h2 = harness({ onShow: ({ window }) => {
    window.dispatch("wheel", { deltaY: 125, shiftKey: true });
    window.dispatch("wheel", { deltaY: -125 });
    window.dispatch("wheel", { deltaY: -125, ctrlKey: true });
  } });
  const second = await h2.service.show({ ...freeLineOptions(h2.source), capabilities: { rotation: false, resize: false, elevation: false } });
  assert.equal(second.shape.length, 20);
  assert.equal(second.shape.yaw, 0);
  assert.equal(second.shape.origin.z, 0);
});

test("free Line rejects impossible full length before installing listeners", async () => {
  const h = harness();
  await assert.rejects(h.service.show({ ...freeLineOptions(h.source), range: { max: 1, policy: "endpoints" } }), /cannot fit/);
  assert.equal(h.window.count("wheel"), 0);
  assert.equal(h.overlayEvents.length, 0);
});
