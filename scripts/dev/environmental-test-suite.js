import {
  ENVIRONMENT_BEHAVIOR_TYPES,
  ENVIRONMENT_CAPABILITIES,
  ENVIRONMENT_DELIVERY_MODES,
  ENVIRONMENT_EVENT_TYPES,
  ENVIRONMENT_FLAG_KEY,
  MODULE_ID
} from "../core/constants.js";

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function banner(name, passed) {
  console.log(
    `%cAE5E 0.4.3.1 — ${name} — ${passed ? "PASS" : "FAIL"}`,
    `font-size:24px;font-weight:bold;color:${passed ? "#5cff8d" : "#ff5c5c"};`
  );
}

function notifyResult(label, passed, notify) {
  if (!notify || !globalThis.ui?.notifications) return;
  ui.notifications[passed ? "info" : "error"](`AE5E ${label} ${passed ? "PASSED" : "FAILED"}. See console.`);
}

export class EnvironmentalTestSuite {
  #environment;
  #geometry;
  #behaviors;
  #capabilities;
  #profiles;
  #index;
  #mutations;
  #timing;
  #flammability;
  #midi;
  #regions;
  #socket;

  constructor({ environment, geometry, behaviors, capabilities, profiles, index, mutations, timing, flammability, midi, regions, socket }) {
    this.#environment = environment;
    this.#geometry = geometry;
    this.#behaviors = behaviors;
    this.#capabilities = capabilities;
    this.#profiles = profiles;
    this.#index = index;
    this.#mutations = mutations;
    this.#timing = timing;
    this.#flammability = flammability;
    this.#midi = midi;
    this.#regions = regions;
    this.#socket = socket;
  }

  async runAcceptanceTest({ notify = true, scene = null, iterations = 250, keepFixture = false } = {}) {
    const started = now();
    const suites = [];
    const run = async (name, callback) => {
      try {
        const result = await callback();
        suites.push({ name, passed: result?.passed === true, result });
      } catch (error) {
        suites.push({
          name,
          passed: false,
          result: {
            passed: false,
            error: {
              name: error?.name ?? "Error",
              message: error?.message ?? String(error),
              stack: error?.stack ?? null
            }
          }
        });
      }
    };

    await run("Foundation", () => this.runFoundationTest({ notify: false }));
    await run("Live lifecycle", () => this.runLiveLifecycleTest({ notify: false, scene, keepFixture }));
    await run("Performance", () => this.runPerformanceTest({ notify: false, scene, iterations }));

    const passed = suites.every(entry => entry.passed);
    const result = {
      passed,
      elapsedMs: now() - started,
      suites: suites.map(entry => ({
        name: entry.name,
        passed: entry.passed,
        checks: entry.result?.checks?.length ?? 0,
        failedChecks: (entry.result?.checks ?? []).filter(check => !check.passed).map(check => check.name),
        error: entry.result?.error ?? null
      })),
      results: Object.fromEntries(suites.map(entry => [entry.name, entry.result]))
    };

    banner("ENVIRONMENTAL AUTOMATED ACCEPTANCE", passed);
    console.table(result.suites.map(entry => ({
      Suite: entry.name,
      Result: entry.passed ? "PASS" : "FAIL",
      Checks: entry.checks,
      "Failed Checks": entry.failedChecks.join("; ") || "—",
      Error: entry.error?.message ?? "—"
    })));
    console.log(result);
    notifyResult("environmental automated acceptance", passed, notify);
    return result;
  }

  async runFoundationTest({ notify = true } = {}) {
    const checks = [];
    const record = (name, passed, details = null) => checks.push({ name, passed: Boolean(passed), details });

    const behavior = this.#behaviors.getStatus();
    const capability = this.#capabilities.get(ENVIRONMENT_CAPABILITIES.FLAMMABLE);
    const genericProfile = this.#profiles.get(ENVIRONMENT_CAPABILITIES.FLAMMABLE, "generic");
    const socketNames = this.#socket.getRegisteredNames?.() ?? [];

    record("AE5E — Flammable RegionBehavior subtype is registered", behavior.flammableRegistered === true, behavior);
    record("Flammable capability consumes fire events", capability?.eventTypes?.includes(ENVIRONMENT_EVENT_TYPES.FIRE) === true, capability);
    record("Generic Flammable material profile is registered", genericProfile?.profileId === "generic" && typeof genericProfile?.react === "function", genericProfile);
    record("Environmental authority socket handler is registered", socketNames.includes("environment.emit"), socketNames);
    record("Midi fire observer is initialized", this.#midi.getStats().initialized === true, this.#midi.getStats());
    record("Persistent environmental timing service is initialized without polling", this.#timing.getStats().initialized === true, this.#timing.getStats());

    const outer = this.#geometry.normalize({
      ae5eEnvironmentGeometry: 1,
      source: "foundation-test",
      shapes: [
        this.#geometry.createRectangle({ x: 0, y: 0, width: 200, height: 100 }),
        this.#geometry.createRectangle({ x: 50, y: 0, width: 50, height: 100, hole: true })
      ]
    });
    record("Region-native geometry includes positive area", this.#geometry.containsPoint(outer, { x: 25, y: 50 }) === true, outer);
    record("Region-native geometry subtracts hole shapes", this.#geometry.containsPoint(outer, { x: 75, y: 50 }) === false, outer);
    record("Point fire intersects surviving Region geometry", this.#geometry.intersects(this.#geometry.fromPoint({ x: 25, y: 50 }), outer) === true);
    record("Point fire does not intersect a carved Region hole", this.#geometry.intersects(this.#geometry.fromPoint({ x: 75, y: 50 }), outer) === false);

    const futureCapabilities = [
      ENVIRONMENT_CAPABILITIES.MELTABLE,
      ENVIRONMENT_CAPABILITIES.FREEZABLE,
      ENVIRONMENT_CAPABILITIES.DISPERSIBLE,
      ENVIRONMENT_CAPABILITIES.CORRODIBLE
    ];
    record("Environmental capability namespace reserves future reaction types", futureCapabilities.every(Boolean), futureCapabilities);

    const stats = this.#environment.getStats();
    record("Environmental service is event-driven and initialized", stats.initialized === true && typeof stats.localEarlyExits === "number", stats);

    const passed = checks.every(check => check.passed);
    const result = {
      passed,
      checks,
      behavior,
      environment: this.#environment.getStats(),
      flammability: this.#flammability.getStats(),
      timing: this.#timing.getStats(),
      midi: this.#midi.getStats()
    };
    banner("ENVIRONMENTAL FOUNDATION", passed);
    console.table(checks.map(check => ({ Check: check.name, Result: check.passed ? "PASS" : "FAIL" })));
    console.log(result);
    notifyResult("environmental foundation", passed, notify);
    return result;
  }

  async runLiveLifecycleTest({ notify = true, scene = null, keepFixture = false } = {}) {
    if (!globalThis.game?.user?.isGM) throw new Error("Run the Environmental live lifecycle test as a GM.");
    if (!this.#timing.getStats().primary) throw new Error("Run the Environmental live lifecycle test on AE5E's current primary GM client.");
    scene ??= globalThis.canvas?.scene ?? null;
    if (!scene) throw new Error("Activate a Scene before running the Environmental live lifecycle test.");

    const checks = [];
    const record = (name, passed, details = null) => checks.push({ name, passed: Boolean(passed), details });
    const gridSize = Number(scene.grid?.size ?? scene.dimensions?.size ?? globalThis.canvas?.grid?.size ?? 100) || 100;
    const sceneX = Number(scene.dimensions?.sceneX ?? 0) || 0;
    const sceneY = Number(scene.dimensions?.sceneY ?? 0) || 0;
    const x = sceneX + gridSize;
    const y = sceneY + gridSize;
    const profileId = `ae5e-test-carve-${Date.now()}`.toLowerCase();
    const timerId = `ae5e-test-timer-${Date.now()}`.toLowerCase();
    const timerHandlerId = `ae5e.test.environment.timer.${Date.now()}`;
    const hole = this.#geometry.createRectangle({ x, y, width: gridSize, height: gridSize, hole: true });
    let regionUuid = null;
    const unregisterTimerHandler = this.#timing.registerHandler(timerHandlerId, ({ timer }) => ({
      handled: true,
      state: { timerFired: true, timerPayload: timer?.payload?.marker ?? null }
    }));

    const unregisterProfile = this.#environment.registerProfile(ENVIRONMENT_CAPABILITIES.FLAMMABLE, profileId, {
      label: "AE5E Test Carve",
      metadata: { testFixture: true },
      react: ({ currentState }) => {
        const firstHit = Number(currentState?.lifecycleHits ?? 0) === 0;
        return {
          handled: true,
          state: { lifecycleHits: Number(currentState?.lifecycleHits ?? 0) + 1 },
          addHoles: [hole],
          scheduleTimers: firstHit ? [{
            id: timerId,
            handlerId: timerHandlerId,
            due: { realTimeMs: Date.now() + 30 },
            payload: { marker: "persistent-timer" }
          }] : []
        };
      }
    });

    try {
      const create = await this.#regions.create({
        name: "AE5E TEST — Environmental Region",
        color: "#ff6b35",
        locked: true,
        shapes: [this.#geometry.createRectangle({ x, y, width: gridSize * 2, height: gridSize })],
        behaviors: [{
          type: ENVIRONMENT_BEHAVIOR_TYPES.FLAMMABLE,
          system: { profileId, priority: 0 }
        }]
      }, {
        scene,
        metadata: { testFixture: true, suite: "environmental" }
      });
      regionUuid = create?.regionUuid ?? null;
      record("GM-authoritative environmental Region creation succeeds", create?.created === true && Boolean(regionUuid), create);

      let region = regionUuid ? await globalThis.fromUuid(regionUuid) : null;
      const behavior = [...(region?.behaviors ?? [])].find(entry => entry.type === ENVIRONMENT_BEHAVIOR_TYPES.FLAMMABLE) ?? null;
      record("Flammable RegionBehavior survives Foundry persistence", Boolean(behavior) && behavior?.system?.profileId === profileId, behavior?.toObject?.() ?? behavior);
      record("Environmental Region is indexed as a fire consumer", this.#environment.hasConsumers(ENVIRONMENT_EVENT_TYPES.FIRE, scene) === true, this.#index.getStats());

      const firstKey = `ae5e-env-live:${Date.now()}:first`;
      const first = await this.#environment.emitFire({
        geometry: this.#geometry.fromPoint({ x: x + gridSize / 2, y: y + gridSize / 2 }, { scene }),
        delivery: ENVIRONMENT_DELIVERY_MODES.MANUAL,
        scene,
        idempotencyKey: firstKey,
        source: { testFixture: true, suite: "environmental" }
      });
      record("Fire exposure is processed by the Flammable behavior", first?.processed === true && first?.reactions === 1 && first?.updates?.some(update => update.updated), first);

      region = await globalThis.fromUuid(regionUuid);
      const liveBehavior = [...(region?.behaviors ?? [])].find(entry => entry.type === ENVIRONMENT_BEHAVIOR_TYPES.FLAMMABLE) ?? behavior;
      const firstState = this.#mutations.getState(region, liveBehavior);
      const shapes = region?.toObject?.(false)?.shapes ?? [];
      record("Environmental reaction state persists on the Region", firstState?.lifecycleHits === 1 && firstState?.lastEventId === firstKey, firstState);
      record("One 5-foot section is carved as a Region hole in one mutation", shapes.length === 2 && shapes.some(shape => shape.hole === true), shapes);
      record("Timed environmental state is persisted on the Region", Boolean(region?.flags?.[MODULE_ID]?.[ENVIRONMENT_FLAG_KEY]?.timers?.[timerId]), region?.flags?.[MODULE_ID]?.[ENVIRONMENT_FLAG_KEY]?.timers ?? null);

      await new Promise(resolve => setTimeout(resolve, 50));
      await this.#timing.processDue({ regionUuids: [regionUuid] });
      region = await globalThis.fromUuid(regionUuid);
      const timedBehavior = [...(region?.behaviors ?? [])].find(entry => entry.type === ENVIRONMENT_BEHAVIOR_TYPES.FLAMMABLE) ?? liveBehavior;
      const timedState = this.#mutations.getState(region, timedBehavior);
      record("One-shot environmental timer fires through the registered handler", timedState?.timerFired === true && timedState?.timerPayload === "persistent-timer", timedState);
      record("Fired environmental timer removes its persistent timer record", !region?.flags?.[MODULE_ID]?.[ENVIRONMENT_FLAG_KEY]?.timers?.[timerId], region?.flags?.[MODULE_ID]?.[ENVIRONMENT_FLAG_KEY]?.timers ?? null);

      const duplicate = await this.#environment.emitFire({
        geometry: this.#geometry.fromPoint({ x: x + gridSize / 2, y: y + gridSize / 2 }, { scene }),
        delivery: ENVIRONMENT_DELIVERY_MODES.MANUAL,
        scene,
        idempotencyKey: firstKey,
        source: { testFixture: true, duplicate: true }
      });
      record("Duplicate environmental event is idempotently rejected", duplicate?.processed === false && duplicate?.reason === "duplicate", duplicate);

      const carved = await this.#environment.emitFire({
        geometry: this.#geometry.fromPoint({ x: x + gridSize / 2, y: y + gridSize / 2 }, { scene }),
        delivery: ENVIRONMENT_DELIVERY_MODES.MANUAL,
        scene,
        idempotencyKey: `${firstKey}:hole`,
        source: { testFixture: true, location: "carved-hole" }
      });
      record("Fire inside carved-out geometry no longer intersects the Region", carved?.processed === true && carved?.reactions === 0 && carved?.updates?.length === 0, carved);

      const survivingKey = `${firstKey}:surviving`;
      const surviving = await this.#environment.emitFire({
        geometry: this.#geometry.fromPoint({ x: x + gridSize * 1.5, y: y + gridSize / 2 }, { scene }),
        delivery: ENVIRONMENT_DELIVERY_MODES.MANUAL,
        scene,
        idempotencyKey: survivingKey,
        source: { testFixture: true, location: "surviving-area" }
      });
      region = await globalThis.fromUuid(regionUuid);
      const finalBehavior = [...(region?.behaviors ?? [])].find(entry => entry.type === ENVIRONMENT_BEHAVIOR_TYPES.FLAMMABLE) ?? liveBehavior;
      const finalState = this.#mutations.getState(region, finalBehavior);
      const finalShapes = region?.toObject?.(false)?.shapes ?? [];
      record("Surviving Region geometry continues reacting to fire", surviving?.reactions === 1 && finalState?.lifecycleHits === 2, { surviving, finalState });
      record("Repeated profile hole request is de-duplicated", finalShapes.length === 2, finalShapes);

      if (!keepFixture) {
        const remove = await this.#regions.delete(regionUuid);
        record("Environmental test Region cleans up through Region authority", remove?.deleted === true, remove);
        regionUuid = null;
      }
    } finally {
      try { unregisterProfile?.(); } catch { /* best effort */ }
      try { unregisterTimerHandler?.(); } catch { /* best effort */ }
      if (regionUuid && !keepFixture) {
        try { await this.#regions.delete(regionUuid); } catch { /* best effort */ }
      }
    }

    const passed = checks.every(check => check.passed);
    const result = {
      passed,
      checks,
      sceneUuid: scene.uuid,
      keptFixture: Boolean(regionUuid && keepFixture),
      environment: this.#environment.getStats(),
      index: this.#index.getStats(),
      mutations: this.#mutations.getStats(),
      timing: this.#timing.getStats()
    };
    banner("ENVIRONMENTAL LIVE LIFECYCLE", passed);
    console.table(checks.map(check => ({ Check: check.name, Result: check.passed ? "PASS" : "FAIL" })));
    console.log(result);
    notifyResult("environmental live lifecycle", passed, notify);
    return result;
  }

  async runPerformanceTest({ notify = true, scene = null, iterations = 250 } = {}) {
    if (!globalThis.game?.user?.isGM) throw new Error("Run the Environmental performance test as a GM.");
    if (!this.#timing.getStats().primary) throw new Error("Run the Environmental performance test on AE5E's current primary GM client.");
    scene ??= globalThis.canvas?.scene ?? null;
    if (!scene) throw new Error("Activate a Scene before running the Environmental performance test.");
    iterations = Math.max(25, Math.min(2_000, Number(iterations) || 250));

    const checks = [];
    const record = (name, passed, details = null) => checks.push({ name, passed: Boolean(passed), details });
    const gridSize = Number(scene.grid?.size ?? scene.dimensions?.size ?? globalThis.canvas?.grid?.size ?? 100) || 100;
    const sceneX = Number(scene.dimensions?.sceneX ?? 0) || 0;
    const sceneY = Number(scene.dimensions?.sceneY ?? 0) || 0;
    const x = sceneX + gridSize * 4;
    const y = sceneY + gridSize * 4;
    const profileId = `ae5e-test-perf-${Date.now()}`.toLowerCase();
    let regionUuid = null;

    const unregisterProfile = this.#environment.registerProfile(ENVIRONMENT_CAPABILITIES.FLAMMABLE, profileId, {
      label: "AE5E Performance No-op",
      metadata: { testFixture: true },
      react: () => ({ handled: false, reason: "performance-noop" })
    });

    try {
      const create = await this.#regions.create({
        name: "AE5E TEST — Environmental Performance",
        color: "#ff6b35",
        locked: true,
        shapes: [this.#geometry.createRectangle({ x, y, width: gridSize * 4, height: gridSize * 4 })],
        behaviors: [{ type: ENVIRONMENT_BEHAVIOR_TYPES.FLAMMABLE, system: { profileId, priority: 0 } }]
      }, { scene, metadata: { testFixture: true, suite: "environmental-performance" } });
      regionUuid = create?.regionUuid ?? null;
      record("Performance fixture Region is created", create?.created === true && Boolean(regionUuid), create);

      // Force one index build outside the timed cache-hit loop.
      this.#environment.hasConsumers(ENVIRONMENT_EVENT_TYPES.FIRE, scene);
      let started = now();
      for (let index = 0; index < iterations; index += 1) this.#environment.hasConsumers(ENVIRONMENT_EVENT_TYPES.FIRE, scene);
      const lookupMs = now() - started;
      const lookupAverageMs = lookupMs / iterations;

      const region = await globalThis.fromUuid(regionUuid);
      const regionGeometry = this.#geometry.fromRegion(region);
      const point = this.#geometry.fromPoint({ x: x + gridSize / 2, y: y + gridSize / 2 }, { scene });
      started = now();
      for (let index = 0; index < iterations * 4; index += 1) this.#geometry.intersects(point, regionGeometry);
      const intersectionMs = now() - started;
      const intersectionAverageMs = intersectionMs / (iterations * 4);

      const mutationBefore = this.#mutations.getStats().regionUpdates;
      started = now();
      for (let index = 0; index < iterations; index += 1) {
        await this.#environment.emitFire({
          geometry: point,
          delivery: ENVIRONMENT_DELIVERY_MODES.MANUAL,
          scene,
          idempotencyKey: `ae5e-perf:${Date.now()}:${index}`,
          source: { testFixture: true, performance: true }
        });
      }
      const eventMs = now() - started;
      const eventAverageMs = eventMs / iterations;
      const mutationAfter = this.#mutations.getStats().regionUpdates;

      const metrics = {
        iterations,
        consumerLookupAverageMs: lookupAverageMs,
        preciseIntersectionAverageMs: intersectionAverageMs,
        processedNoopEventAverageMs: eventAverageMs,
        regionUpdatesDuringNoopEvents: mutationAfter - mutationBefore
      };
      // Thresholds are intentionally looser than the engineering targets to
      // avoid failing on a temporarily busy browser while still catching a
      // genuine architecture regression such as polling or full-scene rescans.
      record("Cached environmental consumer lookup remains low-overhead", lookupAverageMs <= 5, metrics);
      record("Precise Region intersection remains low-overhead", intersectionAverageMs <= 5, metrics);
      record("Processed no-op fire event remains event-time work", eventAverageMs <= 25, metrics);
      record("No-op environmental reactions create no Region document writes", mutationAfter === mutationBefore, metrics);

      const remove = await this.#regions.delete(regionUuid);
      record("Performance fixture cleans up", remove?.deleted === true, remove);
      regionUuid = null;
    } finally {
      try { unregisterProfile?.(); } catch { /* best effort */ }
      if (regionUuid) {
        try { await this.#regions.delete(regionUuid); } catch { /* best effort */ }
      }
    }

    const passed = checks.every(check => check.passed);
    const result = { passed, checks, sceneUuid: scene.uuid, environment: this.#environment.getStats(), index: this.#index.getStats() };
    banner("ENVIRONMENTAL PERFORMANCE", passed);
    console.table(checks.map(check => ({ Check: check.name, Result: check.passed ? "PASS" : "FAIL", Details: check.details ? JSON.stringify(check.details) : "" })));
    console.log(result);
    notifyResult("environmental performance", passed, notify);
    return result;
  }
}
