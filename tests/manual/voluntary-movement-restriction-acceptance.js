await (async () => {
  const TEST = "AE5E 0.4.1.7 — VOLUNTARY MOVEMENT RESTRICTION ACCEPTANCE";
  const MODULE_ID = "action-effects-5e";
  const MESSAGE = "You are Entangled by Magical Vines, and are restrained. You cannot move";

  const banner = (text, ok = true) => console.log(
    `%c${text}`,
    [
      "font-size:26px",
      "font-weight:900",
      `color:${ok ? "#5cff8d" : "#ff5c5c"}`,
      "background:#111",
      "padding:8px 12px",
      "border-radius:6px"
    ].join(";")
  );

  const checks = [];
  const record = (name, passed, details = null) => {
    const entry = { name, passed: Boolean(passed), details };
    checks.push(entry);
    console.log(
      `%c${entry.passed ? "PASS" : "FAIL"}%c ${name}`,
      `font-weight:900;color:${entry.passed ? "#5cff8d" : "#ff5c5c"}`,
      "font-weight:normal;color:inherit",
      details ?? ""
    );
    return entry;
  };

  const samePosition = (a, b) =>
    Math.abs(Number(a?.x ?? 0) - Number(b?.x ?? 0)) <= 0.01
    && Math.abs(Number(a?.y ?? 0) - Number(b?.y ?? 0)) <= 0.01
    && Math.abs(Number(a?.elevation ?? 0) - Number(b?.elevation ?? 0)) <= 0.01;

  if (!game.user?.isGM) throw new Error(`${TEST} must be run as a GM.`);
  if (!canvas?.ready) throw new Error(`${TEST} requires an active Scene.`);
  if (canvas.tokens.controlled.length !== 1) {
    throw new Error(`${TEST} requires exactly ONE controlled token.`);
  }

  const module = game.modules.get(MODULE_ID);
  const ae5e = module?.api;
  if (!module?.active || !ae5e?.movement) {
    throw new Error("Action Effects 5E is not active or its movement API is unavailable.");
  }

  const controlled = canvas.tokens.controlled[0];
  const token = controlled.document ?? controlled;
  const actor = token.actor;
  if (!actor) throw new Error("The controlled token has no Actor.");

  const version = module.version ?? module.manifest?.version ?? ae5e.version ?? "unknown";
  const original = { x: token.x, y: token.y, elevation: token.elevation };
  let testEffect = null;

  const grid = Number(canvas.grid?.size ?? canvas.dimensions?.size ?? 0);
  if (!(grid > 0)) throw new Error("A positive scene grid size is required for this acceptance test.");

  const sceneX = Number(canvas.dimensions?.sceneX ?? 0);
  const sceneY = Number(canvas.dimensions?.sceneY ?? 0);
  const sceneWidth = Number(canvas.scene?.width ?? canvas.dimensions?.sceneWidth ?? canvas.dimensions?.width ?? 0);
  const sceneHeight = Number(canvas.scene?.height ?? canvas.dimensions?.sceneHeight ?? canvas.dimensions?.height ?? 0);
  const tokenWidthPx = Math.max(1, Number(token.width ?? 1)) * grid;
  const tokenHeightPx = Math.max(1, Number(token.height ?? 1)) * grid;
  const maxX = sceneX + sceneWidth - tokenWidthPx;
  const maxY = sceneY + sceneHeight - tokenHeightPx;

  const candidate = [
    { x: original.x + grid, y: original.y, elevation: original.elevation },
    { x: original.x - grid, y: original.y, elevation: original.elevation },
    { x: original.x, y: original.y + grid, elevation: original.elevation },
    { x: original.x, y: original.y - grid, elevation: original.elevation }
  ].find(p => p.x >= sceneX && p.x <= maxX && p.y >= sceneY && p.y <= maxY);

  if (!candidate) throw new Error("Could not find an adjacent in-bounds square for the live movement probe.");

  const actions = CONFIG?.Token?.movement?.actions;
  const actionEntries = actions?.entries ? [...actions.entries()] : Object.entries(actions ?? {});
  const teleportAction = actionEntries.find(([, config]) => config?.teleport === true)?.[0] ?? null;

  const moveOptions = {
    method: "api",
    animate: false,
    pan: false,
    showRuler: false,
    constrainOptions: {
      ignoreWalls: true,
      ignoreCost: true,
      ignoreTokens: true
    }
  };

  console.clear();
  console.group(TEST);
  banner(TEST);

  try {
    record("AE5E v0.4.1.7 is loaded", version === "0.4.1.7", { version });
    record(
      "Movement restriction API is exposed",
      typeof ae5e.movement.getVoluntaryMovementRestriction === "function"
        && typeof ae5e.movement.getVoluntaryMovementRestrictionFlagPath === "function"
        && typeof ae5e.movement.evaluateVoluntaryMovementRestriction === "function"
    );

    const created = await actor.createEmbeddedDocuments("ActiveEffect", [{
      name: "AE5E Test — Voluntary Movement Restricted",
      img: "icons/svg/net.svg",
      disabled: false,
      flags: {
        [MODULE_ID]: {
          movement: {
            voluntaryRestriction: {
              enabled: true,
              message: MESSAGE,
              priority: 1000
            }
          }
        }
      }
    }]);
    testEffect = created?.[0] ?? null;
    record("Temporary movement-restriction effect created", Boolean(testEffect), { effectUuid: testEffect?.uuid });

    const resolved = ae5e.movement.getVoluntaryMovementRestriction(token);
    record(
      "Actor-local restriction resolves with exact Entangle message",
      resolved?.enabled === true && resolved?.message === MESSAGE,
      resolved
    );
    record(
      "Public flag path is canonical",
      ae5e.movement.getVoluntaryMovementRestrictionFlagPath()
        === "flags.action-effects-5e.movement.voluntaryRestriction",
      { flagPath: ae5e.movement.getVoluntaryMovementRestrictionFlagPath() }
    );

    const evaluate = (metadata = null, action = "walk") => ae5e.movement.evaluateVoluntaryMovementRestriction({
      document: token,
      movement: {
        destination: { ...candidate, action },
        passed: { waypoints: [{ ...candidate, action }] }
      },
      operation: metadata
        ? { actionEffects5e: metadata }
        : {}
    });

    const ordinary = evaluate();
    record("Untagged/native walking classifies as blocked voluntary movement", ordinary?.blocked === true, ordinary);
    record("Denial uses the configured message", ordinary?.message === MESSAGE, { message: ordinary?.message });

    const forced = evaluate({ agency: "forced", pathType: "traverse", resource: "none" });
    record("Forced movement remains allowed", forced?.blocked === false && forced?.reason === "agency:forced", forced);

    const compelled = evaluate({ agency: "compelled", pathType: "traverse", resource: "none" });
    record("Compelled movement remains allowed", compelled?.blocked === false, compelled);

    const passenger = evaluate({ agency: "passenger", pathType: "traverse", resource: "none" });
    record("Passenger movement remains allowed", passenger?.blocked === false, passenger);

    const follower = evaluate({
      agency: "unknown",
      relationshipMovement: true,
      leaderUuid: "Scene.AE5E.Test.Token.Other"
    });
    record("Relationship/grapple follower movement remains allowed", follower?.blocked === false && follower?.reason === "relationship-follower", follower);

    const voluntaryLeader = evaluate({
      agency: "voluntary",
      relationshipMovement: true,
      leaderUuid: token.uuid,
      internal: true,
      generatedBy: MODULE_ID
    });
    record("Restricted relationship leader voluntary walking remains blocked", voluntaryLeader?.blocked === true, voluntaryLeader);

    const administrative = evaluate({ agency: "administrative", administrative: true, pathType: "reposition", resource: "none" });
    record("Administrative movement remains allowed", administrative?.blocked === false, administrative);

    if (teleportAction) {
      const teleported = evaluate(null, teleportAction);
      record("Registered Foundry teleport movement remains allowed", teleported?.blocked === false && teleported?.reason === "teleport", {
        teleportAction,
        decision: teleported
      });
    } else {
      record("Registered Foundry teleport movement remains allowed", true, { skipped: true, reason: "No teleport action registered in this environment." });
    }

    const beforeBlockedWalk = { x: token.x, y: token.y, elevation: token.elevation };
    const blockedMoveResult = await token.move({ ...candidate, action: "walk", explicit: true, checkpoint: true }, moveOptions);
    const afterBlockedWalk = { x: token.x, y: token.y, elevation: token.elevation };
    record(
      "Live ordinary walk is cancelled before position commits",
      samePosition(beforeBlockedWalk, afterBlockedWalk),
      { moveResult: blockedMoveResult, before: beforeBlockedWalk, after: afterBlockedWalk }
    );

    const forcedOptions = {
      ...moveOptions,
      ...ae5e.movement.createOperationOptions({
        pathType: "traverse",
        agency: "forced",
        resource: "none",
        movementMode: "walk",
        generatedBy: MODULE_ID,
        internal: true,
        suppressAutomation: true,
        testFixture: true
      })
    };
    const forcedMoveResult = await token.move({ ...candidate, action: "walk", explicit: true, checkpoint: true }, forcedOptions);
    const afterForcedMove = { x: token.x, y: token.y, elevation: token.elevation };
    record(
      "Live forced move passes through the same preMoveToken restriction hook",
      samePosition(candidate, afterForcedMove),
      { moveResult: forcedMoveResult, expected: candidate, actual: afterForcedMove }
    );

  } finally {
    if (!samePosition(original, { x: token.x, y: token.y, elevation: token.elevation })) {
      try {
        await token.update({ x: original.x, y: original.y, elevation: original.elevation }, { animate: false, diff: false });
      } catch (error) {
        console.error("AE5E movement restriction acceptance could not restore the token position.", error);
      }
    }
    if (testEffect && actor.effects?.get?.(testEffect.id)) {
      try { await actor.deleteEmbeddedDocuments("ActiveEffect", [testEffect.id]); }
      catch (error) { console.error("AE5E movement restriction acceptance could not remove its temporary effect.", error); }
    }
  }

  const passed = checks.every(check => check.passed);
  const summary = {
    result: passed ? "PASS" : "FAIL",
    version,
    passed: checks.filter(check => check.passed).length,
    failed: checks.filter(check => !check.passed).length,
    total: checks.length,
    checks,
    movementStats: ae5e.movement.getStats?.() ?? null
  };

  console.table(checks.map(check => ({ Check: check.name, Result: check.passed ? "PASS" : "FAIL" })));
  banner(`${TEST} — ${summary.passed}/${summary.total} PASS`, passed);
  console.log(summary);
  console.groupEnd();
  ui.notifications?.[passed ? "info" : "error"]?.(
    passed
      ? `AE5E v0.4.1.7 movement restriction acceptance passed (${summary.passed}/${summary.total}).`
      : `AE5E v0.4.1.7 movement restriction acceptance failed (${summary.passed}/${summary.total}). See console.`
  );
  return summary;
})();
