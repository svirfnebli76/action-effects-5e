await (async () => {
  const TAG = "Withdraw | Stage 6 | AE5E Integration";
  let MOVEMENT_LIMIT = 0;
  const MOVEMENT_ACTION = "walk";
  const MS_PER_GRID_UNIT = 250 / (1.3 * 1.15);
  const RAMP_GRID_UNITS = 1;
  const TRAIL_TURN_MS = 60;
  const RUN_KEY = "__ae5eWithdrawStage1Runner";
  let run = null;
  let source = null;
  let manager = null;
  let activeMotion = null;
  let sequencePromise = null;
  let playbackError = null;
  let effectPrefix = null;
  let effectSceneId = null;
  const ownedEffectNames = new Set();
  let trailName = null;
  let completed = false;
  let immunityActor = null;
  let immunityId = null;
  let immunityBefore = null;
  let immunityTransaction = null;
  let immunityConfirmed = false;
  const waypointSmokeNames = new Set();
  const waypointSmokeJobs = [];

  const FILES = {
    smoke: "eskie.smoke.03.black",
    flash: "eskie.buff.one_shot.simple.blue",
    wind: "jb2a.wind_stream.200.white",
    trail: "eskie.trail.token.generic.02.black"
  };

  function report(label, data) {
    const json = JSON.stringify(data, (key, value) =>
      typeof value === "number" && !Number.isFinite(value) ? String(value) : value, 2);
    const count = Math.max(1, Math.ceil(json.length / 1600));
    for (let i = 0; i < count; i++) {
      console.log(`${TAG} | ${label} | Part ${i + 1}/${count}\n` +
        json.slice(i * 1600, (i + 1) * 1600));
    }
  }

  const immunityValue = actor => actor?.flags?.["gambits-premades"]?.oaImmunity;
  let protectionLease = null;
  async function removeOwnedImmunity() {
    if (!protectionLease) return;
    const result = await protectionLease.dispose();
    report("OA Immunity Cleanup", result);
    protectionLease = null;
    immunityId = null;
    immunityConfirmed = false;
  }
  const position = document => ({
    x: Number(document.x),
    y: Number(document.y),
    elevation: Number(document.elevation)
  });
  const same = (a, b) =>
    a.x === b.x && a.y === b.y && a.elevation === b.elevation;
  const pause = () => new Promise(resolve => setTimeout(resolve, 16));

  async function waitFor(label, predicate, timeout, validate) {
    const deadline = performance.now() + timeout;
    while (true) {
      validate();
      if (playbackError) throw playbackError;
      if (predicate()) return;
      if (performance.now() >= deadline) {
        throw new Error(`Timed out waiting for ${label}.`);
      }
      await pause();
    }
  }

  try {
    if (globalThis[RUN_KEY]) throw new Error("A waypoint movement test is already running.");
    if (!canvas.ready || !canvas.grid.isSquare) throw new Error("Open a square-grid Scene first.");
    if (!(MS_PER_GRID_UNIT > 0 && RAMP_GRID_UNITS > 0)) throw new Error("Use positive movement and timing settings.");

    const ae5e = game.modules.get("action-effects-5e");
    const crosshairs = ae5e?.api?.crosshairs3d;
    if (!ae5e?.active || ae5e.version !== "0.4.5.18" ||
        typeof crosshairs?.chevron?.showPath !== "function" ||
        typeof ae5e.api?.movement?.beginOpportunityAttackImmunity !== "function") {
      throw new Error("Install AE5E 0.4.5.18 and reload Foundry first.");
    }
    const sequencer = game.modules.get("sequencer");
    manager = globalThis.Sequencer?.MotionManager;
    if (!sequencer?.active || typeof globalThis.Sequence !== "function" ||
        typeof manager?.getDisplacement !== "function" ||
        typeof manager?.endMotions !== "function") {
      throw new Error("This test requires Sequencer with the Motion API enabled.");
    }

    const selected = Array.from(canvas.tokens?.controlled ?? []);
    if (selected.length !== 1) throw new Error("Select exactly one token.");
    source = selected[0];
    const document = source.document;
    if (document.width !== 1 || document.height !== 1) throw new Error("Use a one-square token for this test.");
    const accounting = ae5e.api?.movement;
    if (typeof accounting?.getNoCostActionId !== "function" ||
        typeof accounting?.getHistoryCost !== "function" ||
        typeof accounting?.getHistorySnapshot !== "function" ||
        typeof accounting?.createOperationOptions !== "function" ||
        typeof document.move !== "function") {
      throw new Error("AE5E movement accounting and Foundry movement APIs are required.");
    }
    const readSpeed = () => {
      const movement = source.actor?.system?.attributes?.movement;
      const speed = Number(movement?.speed ?? movement?.walk);
      if (!Number.isFinite(speed) || speed < 0) throw new Error("Invalid prepared actor Speed.");
      if (movement.units !== canvas.scene.grid.units) {
        throw new Error("Actor and Scene movement units must match for this test.");
      }
      return speed;
    };
    const actorSpeed = readSpeed();
    MOVEMENT_LIMIT = Math.floor(actorSpeed / 2);
    if (!MOVEMENT_LIMIT) {
      report("No Withdraw Allowance", { actorSpeed, allowance: MOVEMENT_LIMIT });
      ui.notifications.info("Current Speed provides no Withdraw movement.");
      return;
    }
    const noCostAction = accounting.getNoCostActionId();
    const normalCostBefore = accounting.getHistoryCost(source);
    const historyBefore = accounting.getHistorySnapshot(source);
    report("Withdraw Allowance", {
      actorSpeed, units: canvas.scene.grid.units,
      allowance: MOVEMENT_LIMIT, action: MOVEMENT_ACTION,
      ordinaryMovementCostBefore: normalCostBefore,
      historyBefore, nativeHandoffAction: noCostAction,
      note: "Withdraw has a separate half-Speed allowance; terrain cost uses that allowance."
    });
    const handoff = async data => {
      const finished = await document.move({ ...data, action: noCostAction }, {
        animate: false, showRuler: false, pan: false, autoRotate: false,
        ...accounting.createOperationOptions({
          pathType: "traverse", agency: "voluntary", resource: "none",
          movementMode: MOVEMENT_ACTION, nativeMovementAction: noCostAction,
          sourceUuid: document.uuid, initiatorUuid: document.uuid,
          requestingUserId: game.user.id
        })
      });
      if (!finished) throw new Error("Foundry prevented or interrupted the movement handoff.");
    };
    if (manager.getDisplacement(source) !== null) {
      throw new Error("Use a token with no other active Motion for this isolated test.");
    }
    const probe = new Sequence();
    if (typeof probe.motion !== "function") throw new Error("This Sequencer build has no .motion() section.");
    const section = probe.motion(source);
    if (typeof section.moveBy !== "function" || typeof section.persistUntilUpdate !== "function") {
      throw new Error("This Sequencer build lacks the required Motion handoff methods.");
    }

    const effectManager = Sequencer.EffectManager;
    if (typeof effectManager?.endEffects !== "function" ||
        typeof effectManager?.getEffects !== "function" ||
        typeof Sequencer.Database?.getEntry !== "function" ||
        typeof Sequencer.Preloader?.preload !== "function") {
      throw new Error("Sequencer effect, database, and preload APIs are required.");
    }
    const availability = Object.fromEntries(Object.entries(FILES).map(([key, file]) =>
      [key, { file, available: !!Sequencer.Database.getEntry(file, { softFail: true }) }]));
    report("Effect Assets", availability);
    const missing = Object.values(availability).filter(entry => !entry.available);
    if (missing.length) throw new Error(
      "Missing animation assets: " + missing.map(entry => entry.file).join(", ")
    );

    run = { tokenUuid: document.uuid };
    globalThis[RUN_KEY] = run;
    await source.movementAnimationPromise;
    const scene = canvas.scene;
    const gridSize = canvas.grid.size;
    const start = position(document);
    let expectedDocument = { ...start };
    const validate = expected => {
      if (!canvas.ready || canvas.scene !== scene || source.destroyed ||
          !same(position(document), expected)) {
        throw new Error("Movement interrupted: the Scene or token position changed.");
      }
      if (immunityConfirmed && immunityId) {
        protectionLease.assertActive();
        const effect = immunityActor.effects.get(immunityId);
        if (!effect || effect.disabled || effect.isSuppressed || !immunityValue(immunityActor)) {
          throw new Error("Withdraw's temporary OA immunity ended before movement completed.");
        }
      }
    };

    report("Start", {
      ae5eVersion: ae5e.version,
      sequencerVersion: sequencer.version,
      tokenUuid: document.uuid,
      start,
      movementLimit: MOVEMENT_LIMIT,
      movementAction: MOVEMENT_ACTION,
      terrainMapperActive: !!game.modules.get("terrainmapper")?.active,
      millisecondsPerGridUnit: MS_PER_GRID_UNIT,
      rampGridUnits: RAMP_GRID_UNITS,
      testMode: "Continuous XY Motion; elevation updates at waypoint times; final XY handoff"
    });
    ui.notifications.info(
      "Ctrl + click: waypoint. Click: move. Ctrl + wheel: elevation. " +
      "Right-click: undo. Escape: cancel."
    );
    const placement = await crosshairs.chevron.showPath({
        source,
        range: { max: MOVEMENT_LIMIT, metric: "grid" },
        movement: { enabled: true, action: MOVEMENT_ACTION, opportunityAttackImmunity: true },
        capabilities: { elevation: true },
        onRevision: revision => {
          report("Live Movement Cost", {
            cursor: revision.cursor, distance: revision.distance,
            movementDistance: revision.movementDistance,
            cost: revision.cost, max: revision.max,
            remaining: revision.remaining, valid: revision.valid,
            movementAction: revision.movementAction
          });
        }
      });
    report("Placement", placement);
    if (placement.cancelled) return;
    validate(start);
    if (placement.sourceUuid !== document.uuid || placement.sceneId !== scene.id ||
        !Number.isFinite(placement.distance) || placement.distance < 0 ||
        !Number.isFinite(placement.cost) || placement.cost < 0 ||
        placement.cost > MOVEMENT_LIMIT + 1e-6 ||
        placement.movementAction !== MOVEMENT_ACTION ||
        !Array.isArray(placement.pixelWaypoints)) {
      throw new Error("AE5E returned an invalid route.");
    }
    if (manager.getDisplacement(source) !== null) {
      throw new Error("Another Motion started while the route was being planned.");
    }

    const destinations = placement.pixelWaypoints.map(point => {
      if (![point.x, point.y, point.elevation].every(Number.isFinite)) throw new Error("Invalid waypoint coordinates.");
      return { x: point.x - gridSize / 2, y: point.y - gridSize / 2, elevation: point.elevation };
    });
    // Recheck native cost before playback, including after asset loading.
    const verifyCost = label => {
      validate(start);
      if (readSpeed() !== actorSpeed) throw new Error("Speed changed. Plot Withdraw again.");
      if (Math.abs(accounting.getHistoryCost(source) - normalCostBefore) > 1e-6) {
        throw new Error("Ordinary movement expenditure changed while planning Withdraw.");
      }
      const route = [start, ...destinations].filter((point, index, all) =>
        !index || !same(point, all[index - 1]));
      const requested = route.map(point => ({
        ...point, action: MOVEMENT_ACTION,
        width: document.width, height: document.height, depth: document.depth,
        shape: document.shape, level: document.level,
        explicit: true, checkpoint: true, snapped: true, intermediate: false
      }));
      const path = source.createTerrainMovementPath(requested, { preview: true });
      const measured = source.measureMovementPath(path, { preview: true });
      const verified = Number.isFinite(measured.cost) && measured.cost >= 0 &&
        measured.cost <= MOVEMENT_LIMIT + 1e-6 &&
        Math.abs(measured.cost - placement.cost) < 1e-6 &&
        Math.abs(measured.distance - placement.movementDistance) < 1e-6;
      report(label, {
        action: MOVEMENT_ACTION, distance: measured.distance, cost: measured.cost,
        placementCost: placement.cost, max: MOVEMENT_LIMIT,
        remaining: MOVEMENT_LIMIT - measured.cost, verified,
        path: path.map(point => ({ ...point,
          terrain: point.terrain?.toObject?.() ?? point.terrain ?? null }))
      });
      if (!verified) throw new Error("Route cost changed or exceeds the limit. Plot the route again.");
    };
    verifyCost("Route Cost Verification");
    const visiblePosition = () => source.mesh?.position ? {
      x: Number(source.mesh.position.x),
      y: Number(source.mesh.position.y)
    } : null;
    // Build one track: accelerate, cruise through waypoints, then decelerate.
    const points = [{ x: 0, y: 0, elevation: start.elevation }];
    const unitDistance = Number(scene.grid.distance);
    if (!(unitDistance > 0)) throw new Error("Invalid Scene grid distance.");
    for (const destination of destinations) {
      const point = {
        x: destination.x - start.x, y: destination.y - start.y,
        elevation: destination.elevation
      };
      const previous = points[points.length - 1];
      if (point.x !== previous.x || point.y !== previous.y ||
          point.elevation !== previous.elevation) points.push(point);
    }
    if (points.length === 1) {
      report("No Movement", { start, remainingMotion: manager.getDisplacement(source) });
      ui.notifications.info("No movement selected.");
      return;
    }
    const distances = [0];
    for (let i = 1; i < points.length; i++) {
      distances.push(distances[i - 1] + Math.max(
        Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y),
        Math.abs(points[i].elevation - points[i - 1].elevation) / unitDistance * gridSize
      ));
    }
    const length = distances[distances.length - 1];
    // Clip ramps to the first/last legs so no intermediate waypoint stops.
    const ramp = Math.min(gridSize * RAMP_GRID_UNITS, length / 2,
      distances[1], length - distances[distances.length - 2]);
    const speed = gridSize / MS_PER_GRID_UNIT;
    const cuts = [...new Set([...distances, ramp, length - ramp])]
      .sort((a, b) => a - b);
    const pointAt = distance => {
      let i = 1;
      while (i < distances.length - 1 && distances[i] < distance) i++;
      const fraction = (distance - distances[i - 1]) /
        (distances[i] - distances[i - 1]);
      return {
        x: points[i - 1].x + (points[i].x - points[i - 1].x) * fraction,
        y: points[i - 1].y + (points[i].y - points[i - 1].y) * fraction
      };
    };
    const frames = [{ v: { x: 0, y: 0 } }];
    for (let i = 1; i < cuts.length; i++) {
      const accelerating = i === 1;
      const decelerating = i === cuts.length - 1;
      frames.push({
        v: pointAt(cuts[i]),
        duration: (cuts[i] - cuts[i - 1]) / speed *
          (accelerating || decelerating ? 2 : 1),
        ease: accelerating ? "easeInQuad" : decelerating ? "easeOutQuad" : "linear"
      });
    }
    const duration = frames.slice(1).reduce((total, frame) => total + frame.duration, 0);
    const destination = destinations[destinations.length - 1];
    const offset = points[points.length - 1];
    report("Continuous Motion Plan", {
      start, destination, originalWaypoints: destinations,
      keyframes: frames, durationMs: duration,
      timingPathPixels: length, rampPixels: ramp,
      cruisePixelsPerSecond: speed * 1000,
      rangeDistance: placement.distance,
      rangeCost: placement.cost,
      remaining: placement.remaining,
      movementAction: MOVEMENT_ACTION,
      timingMetric: "Maximum of horizontal pixel length and converted vertical distance per leg",
      rangeMetric: "Native terrain-aware movement cost",
      documentUpdates: "Elevation at waypoint times; XY once at the end"
    });

    ui.notifications.info("Loading movement effects...");
    await Sequencer.Preloader.preload(Object.values(FILES));
    validate(expectedDocument);
    if (manager.getDisplacement(source) !== null) {
      throw new Error("Another Motion started while effects were loading.");
    }
    verifyCost("Playback Cost Verification");
    // Grant immunity only after confirmation, validation, and asset loading.
    immunityActor = source.actor;
    if (!immunityActor || typeof immunityActor.createEmbeddedDocuments !== "function") {
      throw new Error("The selected token needs an actor that can receive Active Effects.");
    }
    const cunningStrike = Array.from(immunityActor.items ?? [])
      .find(item => item.system?.identifier === "cunning-strike");
    protectionLease = await ae5e.api.movement.beginOpportunityAttackImmunity(document, {
      origin: cunningStrike?.uuid ?? document.uuid,
      name: "AE5E Withdraw — Temporary OA Immunity",
      validate: () => validate(expectedDocument)
    });
    immunityBefore = protectionLease.before;
    immunityId = protectionLease.effectId;
    immunityTransaction = protectionLease.transactionId;
    immunityConfirmed = true;
    report("OA Immunity Active", { ...protectionLease,
      assertActive: undefined, dispose: undefined,
      preparedValue: immunityValue(immunityActor), verified: true,
      protectionStatus: ae5e.api.movement.getProtectionStatus()
    });
    validate(expectedDocument);
    effectPrefix = `AE5E Withdraw FX ${foundry.utils.randomID()}`;
    effectSceneId = scene.id;
    const named = suffix => {
      const name = `${effectPrefix} ${suffix}`;
      ownedEffectNames.add(name);
      return name;
    };
    const startup = new Sequence()
      .effect()
        .name(named("Smoke"))
        .file(FILES.smoke)
        .atLocation(source)
        .scaleToObject(2)
        .belowTokens()
        .opacity(0.5)
        .tint("#696969")
      .effect()
        .name(named("Flash"))
        .file(FILES.flash)
        .attachTo(source)
        .scaleToObject(1)
        .filter("ColorMatrix", { saturate: -1, brightness: 2 })
        .opacity(1)
      .effect()
        .name(named("Wind"))
        .file(FILES.wind)
        .attachTo(source)
        .scaleToObject(1.15, { considerTokenScale: true })
        .fadeIn(150)
        .fadeOut(300)
        .mask()
        .playbackRate(1.5)
        .rotate(90)
        .persist()
        .opacity(0.5);
    await startup.play();

    // One trail survives every waypoint; only its rotation changes.
    const legAngles = points.slice(1).map((point, i) => {
      const dx = point.x - points[i].x;
      const dy = point.y - points[i].y;
      return dx || dy ? Math.atan2(dy, dx) * 180 / Math.PI : null;
    });
    const firstAngle = legAngles.find(angle => angle !== null);
    let trailEffect = null;
    if (firstAngle !== undefined) {
      const visible = visiblePosition() ?? source.center;
      const radians = firstAngle * Math.PI / 180;
      const aimPoint = {
        x: visible.x + Math.cos(radians) * gridSize * 4,
        y: visible.y + Math.sin(radians) * gridSize * 4
      };
      trailName = named("Trail");
      new Sequence()
        .effect()
          .name(trailName)
          .file(FILES.trail)
          .attachTo(source)
          .rotateTowards(aimPoint, { attachTo: false })
          .scaleToObject(1.5, { considerTokenScale: true })
          .spriteOffset({ x: -1.5, y: 0 }, { gridUnits: true })
          .opacity(1)
          .filter("ColorMatrix", { saturate: 3 })
          .persist()
          .timeRange(250, 750)
          .fadeOut(50, { ease: "easeOutQuint" })
        .play().catch(error => { playbackError = error; });
      await waitFor("trail startup", () => {
        trailEffect = effectManager.getEffects({ name: trailName, sceneId: scene.id })[0];
        return trailEffect?.ready && Number.isFinite(trailEffect.rotationContainer?.rotation);
      }, 5000, () => validate(expectedDocument));
      if (typeof trailEffect.addAnimatedProperties !== "function") {
        throw new Error("This Sequencer build lacks live effect property animation.");
      }
      report("Trail Started", { name: trailName, firstAngle, aimPoint,
        spriteOffsetGridUnits: { x: -1.5, y: 0 },
        behavior: "One continuous trail; scheduled rotation at waypoints" });
    }
    validate(expectedDocument);
    activeMotion = {
      name: `AE5E Withdraw Continuous ${foundry.utils.randomID()}`,
      sceneId: scene.id
    };
    let settled = false;
    sequencePromise = new Sequence()
      .motion(source)
        .name(activeMotion.name)
        .moveBy(frames, { ease: "linear", return: false })
        .persistUntilUpdate()
        .waitUntilFinished()
      .play();
    sequencePromise.then(
      () => { settled = true; },
      error => { playbackError = error; settled = true; }
    );

    // Anchor the waypoint clock after Motion becomes active.
    await waitFor("Motion startup", () => manager.getDisplacement(source) !== null,
      5000, () => validate(expectedDocument));
    const startedAt = performance.now();
    const waypointTimes = distances.slice(1).map(distance => {
      const cutIndex = cuts.indexOf(distance);
      return frames.slice(1, cutIndex + 1).reduce((sum, frame) => sum + frame.duration, 0);
    });
    if (trailEffect) {
      let travelAngle = firstAngle;
      let renderedAngle = trailEffect.rotationContainer.rotation * 180 / Math.PI;
      const animations = [];
      const turns = [];
      for (let i = 1; i < legAngles.length; i++) {
        const nextAngle = legAngles[i];
        if (nextAngle === null) continue;
        const delta = ((nextAngle - travelAngle + 540) % 360) - 180;
        if (Math.abs(delta) > 1e-6) {
          const turnDuration = Math.min(TRAIL_TURN_MS,
            (waypointTimes[i] - waypointTimes[i - 1]) / 2);
          const from = renderedAngle;
          renderedAngle += delta;
          animations.push(["rotationContainer", "rotation", {
            from, to: renderedAngle,
            duration: turnDuration,
            delay: Math.max(0, waypointTimes[i - 1] -
              (performance.now() - startedAt)),
            ease: "easeOutQuad", absolute: true
          }]);
          turns.push({ waypoint: i, scheduledMs: waypointTimes[i - 1],
            fromDegrees: from, toDegrees: renderedAngle,
            turnDegrees: delta, durationMs: turnDuration });
        }
        travelAngle = nextAngle;
      }
      // Schedule all turns once; no effect creation or socket call at each turn.
      if (animations.length) {
        await trailEffect.addAnimatedProperties({ animations });
      }
      report("Trail Rotation Schedule", { name: trailName, turns,
        note: "Shortest-angle turns on the same effect; no waypoint fade or restart." });
    }
    report("Elevation Schedule", {
      waypoints: points.slice(1).map((point, i) => ({
        index: i + 1, timeMs: waypointTimes[i],
        x: start.x + point.x, y: start.y + point.y, elevation: point.elevation
      })),
      note: "Waypoint clock starts on first observed active Motion; polling resolution is about 16ms."
    });
    for (let i = 0; i < waypointTimes.length; i++) {
      await waitFor(`waypoint ${i + 1} time`, () => {
        if (manager.getDisplacement(source) === null) {
          throw new Error("Motion ended before its waypoint schedule completed.");
        }
        return performance.now() - startedAt >= waypointTimes[i];
      }, duration + 5000, () => validate(expectedDocument));
      const point = points[i + 1];
      const previousElevation = expectedDocument.elevation;
      if (point.elevation !== previousElevation) {
        validate(expectedDocument);
        await handoff({ elevation: point.elevation });
        expectedDocument = { ...expectedDocument, elevation: point.elevation };
        validate(expectedDocument);
      }
      if (i < waypointTimes.length - 1) {
        const smokeName = named(`Smoke Waypoint ${i + 1}`);
        waypointSmokeNames.add(smokeName);
        // Snapshot the exact waypoint centre; do not follow the token afterward.
        const smokePoint = {
          x: start.x + point.x + gridSize / 2,
          y: start.y + point.y + gridSize / 2
        };
        const smokeJob = new Sequence()
          .effect()
            .name(smokeName)
            .file(FILES.smoke)
            .atLocation(smokePoint)
            .size({ width: gridSize * 2, height: gridSize * 2 })
            .belowTokens()
            .opacity(0.5)
            .tint("#696969")
            .waitUntilFinished()
          .play().catch(error => { playbackError = error; });
        waypointSmokeJobs.push(smokeJob);
        report(`Waypoint ${i + 1} | Smoke`, { name: smokeName,
          position: smokePoint, elevation: point.elevation,
          widthPixels: gridSize * 2, heightPixels: gridSize * 2 });
      }

      report(`Waypoint ${i + 1}/${waypointTimes.length} | Elevation`, {
        scheduledMs: waypointTimes[i], elapsedMs: performance.now() - startedAt,
        previousElevation, expectedElevation: point.elevation,
        actualElevation: document.elevation,
        verified: Number(document.elevation) === point.elevation,
        documentXYHeldAtStart: document.x === start.x && document.y === start.y,
        visualPosition: visiblePosition(), displacement: manager.getDisplacement(source)
      });
    }
    // Persistence holds the final appearance until its XY document handoff.
    let stableSamples = 0;
    await waitFor("the complete visual route", () => {
      const displacement = manager.getDisplacement(source);
      const reached = displacement &&
        Math.abs(displacement.deltaX - offset.x) <= 0.05 &&
        Math.abs(displacement.deltaY - offset.y) <= 0.05;
      // The time guard also handles a route that passes its endpoint earlier.
      stableSamples = reached && performance.now() - startedAt >= duration
        ? stableSamples + 1 : 0;
      return stableSamples >= 2;
    }, duration + 5000, () => validate(expectedDocument));

    const visualBefore = visiblePosition();
    report("Visual Endpoint", {
      visualPosition: visualBefore,
      documentPosition: position(document),
      documentXYHeldAtStart: document.x === start.x && document.y === start.y,
      displacement: manager.getDisplacement(source),
      expectedDisplacement: { deltaX: offset.x, deltaY: offset.y }
    });
    if (start.x === destination.x && start.y === destination.y) {
      // An XY-closed or vertical-only path needs explicit Motion cleanup.
      manager.endMotions(source, { ...activeMotion, settle: 0 });
    } else {
      await handoff({ ...destination });
    }
    await waitFor("Motion handoff cleanup", () =>
      manager.getDisplacement(source) === null && settled,
      3000, () => validate(destination));
    await sequencePromise;
    const visualAfter = visiblePosition();
    report("Visual Continuity", {
      before: visualBefore, after: visualAfter,
      discontinuityPixels: visualBefore && visualAfter
        ? Math.hypot(visualAfter.x - visualBefore.x, visualAfter.y - visualBefore.y)
        : null
    });
    sequencePromise = null;
    activeMotion = null;
    validate(destination);
    await removeOwnedImmunity();
    report("Handoff Verified", {
      expected: destination, actual: position(document),
      verified: same(position(document), destination),
      remainingMotion: manager.getDisplacement(source)
    });

    const normalCostAfter = accounting.getHistoryCost(source);
    const ordinaryMovementPreserved = Math.abs(normalCostAfter - normalCostBefore) < 1e-6;
    report("Movement Accounting", {
      allowance: MOVEMENT_LIMIT, allowanceUsed: placement.cost,
      unusedAllowance: MOVEMENT_LIMIT - placement.cost,
      ordinaryMovementCostBefore: normalCostBefore,
      ordinaryMovementCostAfter: normalCostAfter,
      ordinaryMovementPreserved,
      historyAfter: accounting.getHistorySnapshot(source),
      note: "Unused Withdraw allowance expires with this execution. No ordinary movement is spent."
    });
    if (!ordinaryMovementPreserved) throw new Error("Ordinary movement cost changed during Withdraw; inspect the accounting log.");
    report("Complete", {
      tokenUuid: document.uuid,
      finalPosition: position(document),
      waypointsCompleted: destinations.length,
      totalDistance: placement.distance,
      movementCost: placement.cost,
      remainingAllowance: placement.remaining,
      movementAction: MOVEMENT_ACTION,
      withdrawAllowanceUsed: placement.cost,
      ordinaryMovementConsumed: false,
      remainingMotion: manager.getDisplacement(source)
    });
    completed = true;
    ui.notifications.info(destinations.length ? "Withdraw scoped immunity test completed." : "No movement selected.");
  } catch (error) {
    report("Error", { name: error.name, message: error.message, stack: error.stack ?? null });
    ui.notifications.warn(error.message);
  } finally {
    if (activeMotion && source && manager) {
      try {
        const ended = manager.endMotions(source, { ...activeMotion, settle: 0 });
        report("Owned Motion Cleanup", { ...activeMotion, ended });
      } catch (error) {
        report("Cleanup Error", { message: error.message });
      }
    }
    // Always end immunity before waiting for residual visual effects.
    try {
      await removeOwnedImmunity();
    } catch (error) {
      report("OA Immunity Cleanup Error", {
        message: error.message, stack: error.stack ?? null,
        actorUuid: immunityActor?.uuid ?? null, effectId: immunityId,
        transactionId: immunityTransaction,
        remainingOwnedEffect: immunityId
          ? immunityActor?.effects?.get(immunityId)?.toObject?.() ?? null : null
      });
      ui.notifications.error("Withdraw immunity cleanup needs attention; see console and actor effects.");
    }
    const cleanupNames = [
      ...(trailName ? [trailName] : []),
      ...Array.from(ownedEffectNames).filter(name => name !== trailName)
    ];
    for (const name of cleanupNames) {
      // Successful waypoint smoke finishes naturally; Motion and trails are done.
      if (completed && waypointSmokeNames.has(name)) continue;
      try {
        await Sequencer.EffectManager.endEffects({ name, sceneId: effectSceneId });
        report("Owned Effect Cleanup", {
          name,
          remaining: Sequencer.EffectManager.getEffects({ name, sceneId: effectSceneId }).length
        });
      } catch (error) {
        report("Effect Cleanup Error", { name, message: error.message });
      }
    }
    await Promise.all(waypointSmokeJobs);
    if (playbackError && completed) {
      report("Smoke Playback Error", { message: playbackError.message });
    }
    if (run && globalThis[RUN_KEY] === run) delete globalThis[RUN_KEY];
  }
})();
