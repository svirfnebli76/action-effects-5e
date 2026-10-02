await (async () => {
  const TAG = "AE5E | Chevron Indicator Acceptance";
  const VERSION = "0.4.5.15";
  const MODE = "path"; // "path" or "point".
  const LIMIT = 50;
  const MOVE_AFTER_CONFIRM = true; // Set false to test placement alone.

  function logFull(label, data) {
    const json = JSON.stringify(data, null, 2);
    const count = Math.ceil(json.length / 1600);
    for (let i = 0; i < count; i++) {
      console.log(`${TAG} | ${label} | Part ${i + 1}/${count}\n` +
        json.slice(i * 1600, (i + 1) * 1600));
    }
  }

  try {
    const module = game.modules.get("action-effects-5e");
    const crosshairs = module?.api?.crosshairs3d;
    if (!module?.active || module.version !== VERSION ||
        !crosshairs?.chevron?.showPath || !crosshairs?.chevron?.showPoint) {
      throw new Error(`Install AE5E ${VERSION} and reload Foundry first.`);
    }
    const controlled = canvas.tokens?.controlled ?? [];
    if (controlled.length !== 1) throw new Error("Select exactly one token.");
    const token = controlled[0];
    const doc = token.document;
    if (!canvas.grid.isSquare || doc.width !== 1 || doc.height !== 1) {
      throw new Error("Use a one-square token on a square-grid Scene for this test.");
    }
    await token.movementAnimationPromise;
    const start = { x: doc.x, y: doc.y, elevation: Number(doc.elevation) };
    const sceneId = canvas.scene.id;
    const half = canvas.grid.size / 2;
    const same = (a, b) => a.x === b.x && a.y === b.y && a.elevation === b.elevation;
    const position = () => ({ x: doc.x, y: doc.y, elevation: Number(doc.elevation) });
    ui.notifications.info(MODE === "path"
      ? "Ctrl + click: waypoint. Click: move. Ctrl + wheel: elevation. Right-click: undo. Escape: cancel."
      : "Click: destination. Ctrl + wheel: elevation. Right-click or Escape: cancel.");

    const result = await crosshairs.chevron[MODE === "path" ? "showPath" : "showPoint"]({
      source: token,
      range: { max: LIMIT, metric: MODE === "path" ? "grid" : "euclidean" },
      capabilities: { elevation: true }
    });
    logFull("Placement Result", result);
    logFull("Session Cleanup", crosshairs.getStats());
    if (result.cancelled) return;
    if (canvas.scene?.id !== sceneId || !same(position(), start)) {
      throw new Error("The source or Scene changed during placement. Run the test again.");
    }
    if (!MOVE_AFTER_CONFIRM) {
      ui.notifications.info("Chevron placement confirmed; see full console output.");
      return;
    }

    // Placement belongs to AE5E. Actual movement stays in this caller macro.
    let expected = start;
    for (let i = 0; i < result.pixelWaypoints.length; i++) {
      if (canvas.scene?.id !== sceneId || !same(position(), expected)) {
        throw new Error("Movement interrupted: the Scene or token position changed.");
      }
      const point = result.pixelWaypoints[i];
      const destination = {
        x: point.x - half,
        y: point.y - half,
        elevation: point.elevation
      };
      await doc.update(destination, { animate: true });
      await token.movementAnimationPromise;
      const actual = position();
      const verified = same(actual, destination);
      logFull(`Waypoint ${i + 1}/${result.pixelWaypoints.length}`, {
        expected: destination, actual, verified
      });
      if (!verified) throw new Error(`Movement stopped at waypoint ${i + 1}.`);
      expected = destination;
    }
    ui.notifications.info("AE5E Chevron route completed.");
  } catch (error) {
    logFull("Error", {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null
    });
    ui.notifications.warn(error.message);
  }
})();
