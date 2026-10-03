await (async () => {
  const TAG = "AE5E | Chevron Movement Cost Acceptance";
  const VERSION = "0.4.5.16";
  const LIMIT = 50;
  const ACTION = "walk";

  function report(label, data) {
    const json = JSON.stringify(data, (key, value) =>
      typeof value === "number" && !Number.isFinite(value) ? String(value) : value, 2);
    const count = Math.max(1, Math.ceil(json.length / 1600));
    for (let i = 0; i < count; i++) {
      console.log(`${TAG} | ${label} | Part ${i + 1}/${count}\n` +
        json.slice(i * 1600, (i + 1) * 1600));
    }
  }

  try {
    const module = game.modules.get("action-effects-5e");
    const api = module?.api?.crosshairs3d;
    if (!module?.active || module.version !== VERSION ||
        typeof api?.chevron?.showPath !== "function") {
      throw new Error(`Install AE5E ${VERSION} and reload Foundry first.`);
    }
    if (!canvas.ready || !canvas.grid.isSquare) throw new Error("Open a square-grid Scene first.");
    const selected = Array.from(canvas.tokens?.controlled ?? []);
    if (selected.length !== 1) throw new Error("Select exactly one token.");
    const source = selected[0];
    const doc = source.document;
    if (doc.width !== 1 || doc.height !== 1) throw new Error("Use a one-square token.");
    const scene = canvas.scene;
    const size = canvas.grid.size;
    const start = { x: doc.x, y: doc.y, elevation: doc.elevation, level: doc.level };
    const mapper = game.modules.get("terrainmapper");
    report("Environment", {
      ae5eVersion: module.version, foundryVersion: game.version,
      systemVersion: game.system.version, tokenUuid: doc.uuid,
      action: ACTION, limit: LIMIT,
      terrainMapperActive: !!mapper?.active,
      start
    });
    ui.notifications.info(
      "Plot the difficult-terrain route. The counter now shows movement cost. " +
      "Ctrl + click: waypoint. Click: confirm. Escape: cancel."
    );
    const result = await api.chevron.showPath({
      source,
      range: { max: LIMIT, metric: "grid" },
      movement: { enabled: true, action: ACTION },
      capabilities: { elevation: true },
      onRevision: revision => report("Live Cost", {
        cursor: revision.cursor,
        distance: revision.distance,
        nativeMovementDistance: revision.movementDistance,
        cost: revision.cost, max: revision.max,
        remaining: revision.remaining, valid: revision.valid,
        movementAction: revision.movementAction
      })
    });
    report("Placement Result", result);
    const tokenUnchanged = canvas.scene === scene &&
      Object.entries(start).every(([key, value]) => doc[key] === value);
    if (!tokenUnchanged) throw new Error("The Scene or token position changed during the test.");
    if (result.cancelled) {
      report("Cancelled", { tokenUnchanged });
      return;
    }
    const centres = [{ x: start.x + size / 2, y: start.y + size / 2,
      elevation: start.elevation }, ...result.pixelWaypoints];
    const requested = centres.map(point => ({
      x: point.x - size / 2, y: point.y - size / 2,
      elevation: point.elevation, action: ACTION,
      width: doc.width, height: doc.height, depth: doc.depth,
      shape: doc.shape, level: doc.level,
      explicit: true, checkpoint: true, snapped: true, intermediate: false
    }));
    const path = source.createTerrainMovementPath(requested, { preview: true });
    const measured = source.measureMovementPath(path, { preview: true });
    report("Native Terrain Path", path.map(point => ({ ...point,
      terrain: point.terrain?.toObject?.() ?? point.terrain ?? null })));
    const verified = Number.isFinite(result.cost) && result.cost <= LIMIT + 1e-6 &&
      Math.abs(result.cost - measured.cost) < 1e-6 &&
      Math.abs(result.movementDistance - measured.distance) < 1e-6 &&
      Math.abs(result.remaining - Math.max(0, LIMIT - measured.cost)) < 1e-6;
    report("Verification", {
      chevronDistance: result.distance,
      chevronCost: result.cost,
      nativeDistance: measured.distance,
      nativeCost: measured.cost,
      remaining: result.remaining,
      expectedCounter: `${result.cost}/${LIMIT} ${scene.grid.units}`,
      tokenUnchanged, verified,
      note: "Placement only; movement and movement consumption are not executed."
    });
    if (!verified) throw new Error("Chevron cost does not match native measurement.");
    report("Session Cleanup", api.getStats());
    ui.notifications.info("Chevron movement cost verified. Token unchanged.");
  } catch (error) {
    report("Error", { name: error.name, message: error.message, stack: error.stack ?? null });
    ui.notifications.warn(error.message);
  }
})();
