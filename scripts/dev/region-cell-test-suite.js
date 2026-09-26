import {
  MODULE_ID,
  REGION_CELL_FLAG,
  REGION_CELL_STATES
} from "../core/constants.js";

function banner(label, passed) {
  console.log(
    `%cAE5E — ${label} — ${passed ? "PASS" : "FAIL"}`,
    `font-size:24px;font-weight:bold;color:${passed ? "#5cff8d" : "#ff5c5c"};`
  );
}


export function formatConsoleDetails(value) {
  if (value == null) return "—";
  if (typeof value === "string") return value;

  const seen = new WeakSet();
  try {
    return JSON.stringify(value, (_key, current) => {
      if (current instanceof Set) return [...current];
      if (current instanceof Map) return Object.fromEntries(current);
      if (!current || typeof current !== "object") return current;

      // Foundry Documents and our synthetic Document-like fixtures frequently
      // contain parent/attachment back-references. Preserve useful identity in
      // diagnostics without recursively serializing the full document graph.
      if (typeof current.uuid === "string" && (current.documentName || current.constructor?.name?.endsWith?.("Document"))) {
        return {
          documentName: current.documentName ?? current.constructor?.name ?? "Document",
          uuid: current.uuid
        };
      }

      if (seen.has(current)) return "[Circular]";
      seen.add(current);
      return current;
    });
  } catch (error) {
    return `[Unserializable: ${error?.message ?? String(error)}]`;
  }
}

function consoleRows(checks) {
  return checks.map(check => ({
    Check: check.name,
    Result: check.passed ? "PASS" : "FAIL",
    Details: formatConsoleDetails(check.details)
  }));
}

function syntheticRegion(service, config = null) {
  const region = {
    uuid: "Scene.synthetic.Region.region-cells",
    documentName: "Region",
    parent: { grid: { size: 100, distance: 5 }, tokens: new Map() },
    flags: { [MODULE_ID]: {} },
    getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
  };
  if (config) region.flags[MODULE_ID][REGION_CELL_FLAG] = service.normalizeConfig(config);
  return region;
}

function syntheticToken(data = {}) {
  return {
    uuid: "Scene.synthetic.Token.synthetic",
    x: data.x ?? 0,
    y: data.y ?? 0,
    elevation: data.elevation ?? 0,
    width: data.width ?? 1,
    height: data.height ?? 1,
    ...(Object.hasOwn(data, "depth") ? { depth: data.depth } : {})
  };
}

export class RegionCellTestSuite {
  #cells;
  #occupancy;
  #socket;
  #movementCosts;
  #attachments;
  #entryInterruption;

  constructor({ cells, occupancy, movementCosts = null, attachments = null, socket, persistentAreaEntryInterruption = null }) {
    this.#cells = cells;
    this.#occupancy = occupancy;
    this.#movementCosts = movementCosts;
    this.#attachments = attachments;
    this.#socket = socket;
    this.#entryInterruption = persistentAreaEntryInterruption;
  }

  runFoundationTest({ notify = true } = {}) {
    const checks = [];
    const record = (name, passed, details = null) => checks.push({ name, passed: Boolean(passed), details });
    const base = {
      bounds: { min: { x: 0, y: 0, z: 0 }, size: { x: 4, y: 4, z: 4 } },
      defaultState: REGION_CELL_STATES.ACTIVE,
      cells: { "1,1,1": "GONE", "2,2,2": "BURNING" },
      frame: { type: "static", origin: { x: 300, y: 500, elevation: 20 }, rotation: 90 }
    };
    const config = this.#cells.normalizeConfig(base);
    const registrations = this.#socket.getRegisteredNames?.() ?? [];

    record("Region-cell configure socket is registered", registrations.includes("regionCells.configure"), registrations);
    record("Region-cell batch state socket is registered", registrations.includes("regionCells.setStates"), registrations);
    record("Region-cell clear socket is registered", registrations.includes("regionCells.clear"), registrations);
    record("4x4x4 bounded volume enumerates 64 cells", this.#cells.enumerateCells(config).length === 64, this.#cells.enumerateCells(config).length);
    record("Default ACTIVE state remains sparse", Object.keys(config.cells).length === 2, config.cells);
    record("Arbitrary BURNING state survives normalization", this.#cells.getCellStateFromConfig(config, { x: 2, y: 2, z: 2 }) === "BURNING", config.cells);
    record("Outside-bounds lookup returns null", this.#cells.getCellStateFromConfig(config, { x: 4, y: 0, z: 0 }) === null);

    const region = syntheticRegion(this.#cells, base);
    const world = this.#cells.localToWorldPoint(region, { x: 1, y: 2, z: 3 });
    const local = this.#cells.worldToLocalPoint(region, world);
    record("Static translation/rotation/elevation transforms round-trip", Math.abs(local.x - 1) < 1e-8 && Math.abs(local.y - 2) < 1e-8 && Math.abs(local.z - 3) < 1e-8, { world, local });

    const source = syntheticToken({ x: 100, y: 200, elevation: 10, width: 2, height: 2, depth: 2 });
    source.uuid = "Scene.synthetic.Token.source";
    source.rotation = 0;
    const tokenFrameConfig = this.#cells.normalizeConfig({
      bounds: base.bounds,
      defaultState: "ACTIVE",
      cells: { "1,1,1": "GONE" },
      frame: { type: "token", sourceTokenUuid: source.uuid, offset: { x: 1, y: 0, z: 1 } }
    });
    const tokenRegion = syntheticRegion(this.#cells, tokenFrameConfig);
    const beforeCells = JSON.stringify(tokenFrameConfig.cells);
    const before = this.#cells.resolveFrame(tokenRegion, { config: tokenFrameConfig, sourceToken: source });
    source.x += 300;
    source.elevation += 10;
    source.rotation = 90;
    const after = this.#cells.resolveFrame(tokenRegion, { config: tokenFrameConfig, sourceToken: source });
    record("Token-local frame follows source translation", Math.abs(after.origin.x - before.origin.x) > 1, { before, after });
    record("Token-local frame follows source elevation", after.origin.elevation === before.origin.elevation + 10, { before, after });
    record("Token-local frame follows source rotation", after.rotation === 90, { before, after });
    record("Source motion does not rewrite local cell states", JSON.stringify(tokenFrameConfig.cells) === beforeCells, tokenFrameConfig.cells);

    const passed = checks.every(check => check.passed);
    const result = { passed, checks, stats: this.#cells.getStats() };
    banner("REGION CELL FOUNDATION", passed);
    console.table(consoleRows(checks));
    console.log(result);
    if (notify && globalThis.ui?.notifications) ui.notifications[passed ? "info" : "error"](`AE5E Region Cell Foundation ${passed ? "PASSED" : "FAILED"}. See console.`);
    return result;
  }

  runContainmentTest({ notify = true } = {}) {
    const checks = [];
    const record = (name, passed, details = null) => checks.push({ name, passed: Boolean(passed), details });
    const region = syntheticRegion(this.#cells, {
      bounds: { min: { x: 0, y: 0, z: 0 }, size: { x: 4, y: 4, z: 4 } },
      defaultState: "ACTIVE",
      cells: { "1,0,0": "GONE", "0,0,1": "GONE" },
      frame: { type: "static", origin: { x: 0, y: 0, elevation: 0 }, rotation: 0 }
    });

    const active = this.#cells.intersectsToken(region, syntheticToken({ x: 0, y: 0, elevation: 0, depth: 1 }));
    const gone = this.#cells.intersectsToken(region, syntheticToken({ x: 100, y: 0, elevation: 0, depth: 1 }));
    const goneQuery = this.#cells.intersectsToken(region, syntheticToken({ x: 100, y: 0, elevation: 0, depth: 1 }), { states: "GONE" });
    record("ACTIVE cell overlaps token", active.intersects, active.cells);
    record("GONE cell does not satisfy default ACTIVE query", !gone.intersects, gone.cells);
    record("Arbitrary state can be queried explicitly", goneQuery.intersects, goneQuery.cells);

    const face = this.#cells.intersectsToken(region, syntheticToken({ x: 400, y: 0, elevation: 0, depth: 1 }));
    const fractional = this.#cells.intersectsToken(region, syntheticToken({ x: 399.999, y: 0, elevation: 0, depth: 1 }));
    record("Exact XY face contact is excluded", !face.intersects, face.reason);
    record("Positive fractional XY overlap counts", fractional.intersects, fractional.cells);

    const verticalFace = this.#cells.intersectsToken(region, syntheticToken({ x: 0, y: 0, elevation: 20, depth: 1 }));
    const verticalFraction = this.#cells.intersectsToken(region, syntheticToken({ x: 0, y: 0, elevation: 19.999, depth: 1 }));
    record("Exact Z face contact is excluded", !verticalFace.intersects, verticalFace.reason);
    record("Positive fractional Z overlap counts", verticalFraction.intersects, verticalFraction.cells);

    const largeRegion = syntheticRegion(this.#cells, {
      bounds: { min: { x: 0, y: 0, z: 0 }, size: { x: 3, y: 3, z: 3 } },
      defaultState: "GONE",
      cells: { "2,2,0": "ACTIVE" },
      frame: { type: "static", origin: { x: 0, y: 0, elevation: 0 }, rotation: 0 }
    });
    const large = this.#cells.intersectsToken(largeRegion, syntheticToken({ x: 100, y: 100, elevation: 0, width: 2, height: 2, depth: 2 }));
    record("Large Token can overlap active and inactive cells simultaneously", large.intersects && large.cells.some(cell => cell.key === "2,2,0"), large.cells);

    const nativeRegion = syntheticRegion(this.#cells);
    const nativeToken = syntheticToken();
    nativeToken.testInsideRegion = (_region, position) => position?.x === 123;
    const native = this.#occupancy.inspectTokenAt(nativeRegion, nativeToken, { x: 123 });
    const cellBacked = this.#occupancy.inspectTokenAt(region, syntheticToken({ x: 0, y: 0, elevation: 0, depth: 1 }));
    record("Unconfigured Region preserves Foundry containment fallback", native.inside && native.source === "foundry", native);
    record("Configured Region uses AE5E cell occupancy", cellBacked.inside && cellBacked.source === "region-cells", { source: cellBacked.source, cells: cellBacked.result?.cells });

    const passed = checks.every(check => check.passed);
    const result = { passed, checks, cellStats: this.#cells.getStats(), occupancyStats: this.#occupancy.getStats() };
    banner("REGION CELL CONTAINMENT", passed);
    console.table(consoleRows(checks));
    console.log(result);
    if (notify && globalThis.ui?.notifications) ui.notifications[passed ? "info" : "error"](`AE5E Region Cell Containment ${passed ? "PASSED" : "FAILED"}. See console.`);
    return result;
  }

  runMovementTest({ notify = true } = {}) {
    const checks = [];
    const record = (name, passed, details = null) => checks.push({ name, passed: Boolean(passed), details });
    if (!this.#entryInterruption) {
      record("Persistent-area entry interruption service is available", false, null);
    } else {
      const scene = { id: "synthetic", grid: { size: 100, distance: 5 }, regions: [], tokens: new Map() };
      const region = syntheticRegion(this.#cells, {
        bounds: { min: { x: 0, y: 0, z: 0 }, size: { x: 4, y: 1, z: 1 } },
        defaultState: "GONE",
        cells: { "1,0,0": "ACTIVE", "3,0,0": "ACTIVE" },
        frame: { type: "static", origin: { x: 0, y: 0, elevation: 0 }, rotation: 0 }
      });
      region.parent = scene;
      const eventName = globalThis.CONST?.REGION_EVENTS?.TOKEN_MOVE_IN ?? "tokenMoveIn";
      region.behaviors = [{
        uuid: "Scene.synthetic.Region.region-cells.RegionBehavior.entry",
        type: `${MODULE_ID}.persistent-area`,
        disabled: false,
        system: {
          recipeJson: JSON.stringify({
            schemaVersion: 1,
            gates: {},
            handlers: { [eventName]: { movement: { entryInterruption: true, pause: true, stopOn: "failure" } } }
          })
        }
      }];
      scene.regions.push(region);
      const token = syntheticToken({ x: 0, y: 0, elevation: 0, depth: 1 });
      token.uuid = "Scene.synthetic.Token.cell-mover";
      token.id = "cell-mover";
      token.parent = scene;
      token.testInsideRegion = () => { throw new Error("native containment should not decide a cell-backed Region"); };
      token.getCompleteMovementPath = ([from, to]) => {
        const points = [{ ...from, snapped: true }];
        for (let x = Number(from.x) + 100; x <= Number(to.x); x += 100) points.push({ ...to, x, snapped: true });
        return points;
      };
      scene.tokens.set(token.id, token);
      const destination = { x: 300, y: 0, elevation: 0, snapped: true };
      const result = this.#entryInterruption.planMovement(token, {
        pending: { waypoints: [destination] },
        destination,
        method: "api"
      }, {
        origin: { x: 0, y: 0, elevation: 0, snapped: true },
        destination,
        movementId: "synthetic-cell-movement",
        pathType: "traverse",
        agency: "forced",
        resource: "movement"
      });
      record("Inactive→ACTIVE transition inside broad Region is planned", result.planned === true, result.reason);
      record("Burned tunnel creates two distinct ACTIVE entries", JSON.stringify(result.plan?.entries?.map(entry => entry.position.x)) === JSON.stringify([100, 300]), result.plan?.entries);
      record("GONE tunnel step is not an entry checkpoint", result.waypoints?.find(point => point.x === 200)?.checkpoint !== true, result.waypoints);
      record("Movement planning uses AE5E cells rather than native Region containment", this.#occupancy.getStats().cellQueries > 0, this.#occupancy.getStats());
    }

    const passed = checks.every(check => check.passed);
    const result = { passed, checks, occupancyStats: this.#occupancy.getStats(), entryStats: this.#entryInterruption?.getStats?.() ?? null };
    banner("REGION CELL MOVEMENT", passed);
    console.table(consoleRows(checks));
    console.log(result);
    if (notify && globalThis.ui?.notifications) ui.notifications[passed ? "info" : "error"](`AE5E Region Cell Movement ${passed ? "PASSED" : "FAILED"}. See console.`);
    return result;
  }

  runTerrainTest({ notify = true } = {}) {
    const checks = [];
    const record = (name, passed, details = null) => checks.push({ name, passed: Boolean(passed), details });
    if (!this.#movementCosts) {
      record("Region-cell movement-cost service is available", false, null);
    } else {
      const region = syntheticRegion(this.#cells, {
        bounds: { min: { x: 0, y: 0, z: 0 }, size: { x: 4, y: 1, z: 1 } },
        defaultState: "GONE",
        cells: { "1,0,0": "ACTIVE", "3,0,0": "ACTIVE" },
        frame: { type: "static", origin: { x: 0, y: 0, elevation: 0 }, rotation: 0 }
      });
      const token = syntheticToken({ x: 0, y: 0, elevation: 0, depth: 1 });
      token.uuid = "Scene.synthetic.Token.cell-terrain";
      const instruction = { waypoints: [
        { x: 100, y: 0, elevation: 0, snapped: true, action: globalThis.CONFIG?.Token?.movement?.defaultAction ?? "walk" },
        { x: 200, y: 0, elevation: 0, snapped: true },
        { x: 300, y: 0, elevation: 0, snapped: true }
      ] };
      const baseAction = instruction.waypoints[0].action;
      const release = this.#movementCosts.applyToInstruction({ region, token, instruction, states: ["ACTIVE"], multiplier: 2, id: "console-terrain-test" });
      const activeAction = instruction.waypoints[0].action;
      record("ACTIVE step receives temporary AE5E cost action", /^action-effects-5e\.cost-slot-\d+$/.test(String(activeAction)), instruction.waypoints);
      record("GONE step explicitly restores base movement action", instruction.waypoints[1].action === baseAction, instruction.waypoints);
      record("Later ACTIVE step reuses cell-cost action", instruction.waypoints[2].action === activeAction, instruction.waypoints);
      release();
      record("Temporary terrain modifier releases cleanly", this.#movementCosts.getStats().modifierReleases >= 1, this.#movementCosts.getStats());
    }

    const passed = checks.every(check => check.passed);
    const result = { passed, checks, stats: this.#movementCosts?.getStats?.() ?? null };
    banner("REGION CELL TERRAIN", passed);
    console.table(consoleRows(checks));
    console.log(result);
    if (notify && globalThis.ui?.notifications) ui.notifications[passed ? "info" : "error"](`AE5E Region Cell Terrain ${passed ? "PASSED" : "FAILED"}. See console.`);
    return result;
  }

  runAttachmentTest({ notify = true } = {}) {
    const checks = [];
    const record = (name, passed, details = null) => checks.push({ name, passed: Boolean(passed), details });
    if (!this.#attachments) {
      record("Region-cell attachment service is available", false);
    } else {
      const scene = { id: "synthetic", grid: { size: 100, distance: 5 }, regions: [], tokens: new Map() };
      const source = syntheticToken({ x: 0, y: 0, elevation: 0, depth: 1 });
      source.id = "source";
      source.uuid = "Scene.synthetic.Token.source";
      source.documentName = "Token";
      source.parent = scene;
      source.rotation = 0;
      source.regions = new Set();
      source.attachments = { regions: new Set() };
      const target = syntheticToken({ x: 200, y: 50, elevation: 0, depth: 1 });
      target.id = "target";
      target.uuid = "Scene.synthetic.Token.target";
      target.documentName = "Token";
      target.parent = scene;
      target.regions = new Set();
      const elevated = syntheticToken({ x: 200, y: 50, elevation: 10, depth: 1 });
      elevated.id = "elevated";
      elevated.uuid = "Scene.synthetic.Token.elevated";
      elevated.documentName = "Token";
      elevated.parent = scene;
      elevated.regions = new Set();
      scene.tokens.set(source.id, source);
      scene.tokens.set(target.id, target);
      scene.tokens.set(elevated.id, elevated);

      const region = syntheticRegion(this.#cells, {
        bounds: { min: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 } },
        defaultState: "ACTIVE",
        frame: { type: "token", sourceTokenUuid: source.uuid, offset: { x: 0, y: 0, z: 0 } }
      });
      region.parent = scene;
      region.tokens = new Set();
      scene.regions.push(region);
      source.attachments.regions.add(region);

      const beforeCells = JSON.stringify(this.#cells.getConfig(region).cells);
      const snapshot = this.#attachments.captureSourceState(source);
      record("Stationary target starts outside attached ACTIVE cell", !this.#occupancy.testTokenAt(region, target));
      source.x = 150;
      const moved = this.#attachments.compareSourceState(source, snapshot, { emit: false });
      record("Source translation sweeps stationary target into ACTIVE volume", moved.transitions.some(t => t.tokenUuid === target.uuid && t.type === "enter"), moved.transitions);
      record("Different-elevation target remains independently outside", !this.#occupancy.testTokenAt(region, elevated), this.#occupancy.inspectTokenAt(region, elevated));
      record("Attached source motion never rewrites local cell states", JSON.stringify(this.#cells.getConfig(region).cells) === beforeCells, this.#cells.getConfig(region).cells);

      const raisedSnapshot = this.#attachments.captureSourceState(source);
      source.elevation = 10;
      const raised = this.#attachments.compareSourceState(source, raisedSnapshot, { emit: false });
      record("Source elevation sweeps lower target out of ACTIVE volume", raised.transitions.some(t => t.tokenUuid === target.uuid && t.type === "exit"), raised.transitions);
      record("Source elevation can sweep elevated target into ACTIVE volume", raised.transitions.some(t => t.tokenUuid === elevated.uuid && t.type === "enter"), raised.transitions);
    }

    const passed = checks.every(check => check.passed);
    const result = { passed, checks, stats: this.#attachments?.getStats?.() ?? null };
    banner("REGION CELL ATTACHMENT", passed);
    console.table(consoleRows(checks));
    console.log(result);
    if (notify && globalThis.ui?.notifications) ui.notifications[passed ? "info" : "error"](`AE5E Region Cell Attachment ${passed ? "PASSED" : "FAILED"}. See console.`);
    return result;
  }

  runFullSuite({ notify = true } = {}) {
    const results = {
      foundation: this.runFoundationTest({ notify: false }),
      containment: this.runContainmentTest({ notify: false }),
      movement: this.runMovementTest({ notify: false }),
      terrain: this.runTerrainTest({ notify: false }),
      attachment: this.runAttachmentTest({ notify: false })
    };
    const passed = Object.values(results).every(result => result?.passed === true);
    const output = { passed, results };
    banner("REGION CELL FULL SUITE", passed);
    console.log(output);
    if (notify && globalThis.ui?.notifications) ui.notifications[passed ? "info" : "error"](`AE5E Region Cell Full Suite ${passed ? "PASSED" : "FAILED"}. See console.`);
    return output;

  }

}
