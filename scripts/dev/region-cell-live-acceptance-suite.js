import {
  HOOKS,
  MODULE_ID,
  MOVEMENT_AGENCIES,
  MOVEMENT_PHASES,
  MOVEMENT_RESOURCES,
  PATH_TYPES,
  REGION_AUTHORITY_FLAG,
  REGION_CELL_STATES
} from "../core/constants.js";
import { duplicateSafely, randomId } from "../core/utils.js";

const MOVE_IN_EVENT = () => globalThis.CONST?.REGION_EVENTS?.TOKEN_MOVE_IN ?? "tokenMoveIn";
const EPSILON = 1e-7;

function asDocument(token) {
  return token?.document ?? token ?? null;
}

function selectedTokenDocument() {
  const controlled = globalThis.canvas?.tokens?.controlled ?? [];
  if (controlled.length !== 1) {
    throw new Error("Control exactly one 1x1 Token before running this live acceptance setup.");
  }
  return asDocument(controlled[0]);
}

function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sameNumber(a, b, epsilon = EPSILON) {
  return Math.abs(numeric(a) - numeric(b)) <= epsilon;
}

function movementMethod(transaction) {
  return String(transaction?.method ?? "unknown").trim().toLowerCase() || "unknown";
}

function safeDocumentIdentity(document) {
  if (!document) return null;
  return {
    documentName: document.documentName ?? document.constructor?.name ?? null,
    id: document.id ?? null,
    uuid: document.uuid ?? null,
    name: document.name ?? null
  };
}

function cloneTransform(token) {
  return {
    x: numeric(token?.x ?? token?._source?.x),
    y: numeric(token?.y ?? token?._source?.y),
    elevation: numeric(token?.elevation ?? token?._source?.elevation),
    rotation: numeric(token?.rotation ?? token?._source?.rotation),
    width: numeric(token?.width ?? token?._source?.width, 1),
    height: numeric(token?.height ?? token?._source?.height, 1),
    depth: token?.depth ?? token?._source?.depth ?? null
  };
}

function copyWaypoint(point) {
  if (!point) return null;
  const result = {
    x: numeric(point.x),
    y: numeric(point.y),
    elevation: numeric(point.elevation)
  };
  for (const key of ["action", "checkpoint", "explicit", "snapped", "subpathId", "width", "height", "depth", "shape", "level"]) {
    if (point[key] !== undefined && point[key] !== null) result[key] = duplicateSafely(point[key]);
  }
  return result;
}

function uniquePositions(points) {
  const result = [];
  for (const point of points ?? []) {
    const copy = copyWaypoint(point);
    if (!copy) continue;
    const previous = result.at(-1);
    if (previous && sameNumber(previous.x, copy.x) && sameNumber(previous.y, copy.y) && sameNumber(previous.elevation, copy.elevation)) continue;
    result.push(copy);
  }
  return result;
}

function summarizeTransitions(transitions) {
  return (transitions ?? []).map(entry => ({
    type: entry.type,
    tokenUuid: entry.tokenUuid,
    tokenName: entry.token?.name ?? null,
    beforeInside: entry.beforeInside,
    inside: entry.inside,
    nativeBeforeInside: entry.nativeBeforeInside,
    nativeInside: entry.nativeInside,
    sourceBefore: entry.sourceTransformBefore,
    sourceAfter: entry.sourceTransformAfter,
    detectedBy: entry.detectedBy
  }));
}

/**
 * Physical canvas acceptance harness for Region-local cell state.
 *
 * This suite deliberately creates only temporary Scene documents and registers
 * temporary diagnostic listeners. It never edits compendiums. Movement and
 * attachment fixtures are independent and can be cleaned separately.
 */
export class RegionCellLiveAcceptanceSuite {
  #regions;
  #cells;
  #occupancy;
  #movementCosts;
  #attachments;
  #movement;
  #persistentAreaEvents;
  #entryInterruption;
  #movementFixture = null;
  #attachmentFixture = null;

  constructor({ regions, cells, occupancy, movementCosts, attachments, movement, persistentAreaEvents, persistentAreaEntryInterruption }) {
    this.#regions = regions;
    this.#cells = cells;
    this.#occupancy = occupancy;
    this.#movementCosts = movementCosts;
    this.#attachments = attachments;
    this.#movement = movement;
    this.#persistentAreaEvents = persistentAreaEvents;
    this.#entryInterruption = persistentAreaEntryInterruption;
  }

  getStatus() {
    return {
      movement: this.#movementFixture ? this.#movementStatus(this.#movementFixture) : null,
      attachment: this.#attachmentFixture ? this.#attachmentStatus(this.#attachmentFixture) : null
    };
  }

  async setupMovementTest({ token = null, notify = true } = {}) {
    this.#assertLiveEnvironment();
    if (this.#movementFixture) await this.cleanupMovementTest({ restoreToken: true, notify: false });

    const subject = this.#resolveToken(token);
    this.#assertOneByOne(subject);
    const scene = subject.parent;
    const grid = this.#grid(scene);
    const origin = cloneTransform(subject);
    const eventName = MOVE_IN_EVENT();
    const fixtureId = `region-cell-live-movement-${randomId(12)}`;

    const behaviorBuild = this.#persistentAreaEvents?.buildBehavior?.({
      instanceId: fixtureId,
      name: "AE5E TEST — Region Cell Entry Probe",
      recipe: {
        schemaVersion: 1,
        gates: {},
        handlers: {
          [eventName]: {
            movement: { pause: true, entryInterruption: true }
          }
        }
      }
    });
    if (behaviorBuild?.built !== true) {
      throw new Error(`Could not build temporary persistent-area behavior: ${(behaviorBuild?.errors ?? [behaviorBuild?.reason]).filter(Boolean).join(", ")}`);
    }

    const create = await this.#regions.create({
      name: "AE5E TEST — Region Cell Movement Corridor",
      color: "#f59e0b",
      locked: true,
      elevation: { bottom: origin.elevation, top: origin.elevation + grid.distance },
      shapes: [{
        type: "rectangle",
        x: origin.x,
        y: origin.y,
        width: grid.size * 5,
        height: grid.size
      }],
      behaviors: [behaviorBuild.behavior]
    }, {
      scene,
      metadata: { testFixture: true, suite: "region-cell-live-acceptance", fixture: "movement", fixtureId }
    });
    if (create?.created !== true || !create.regionUuid) throw new Error(`Could not create movement corridor Region: ${create?.reason ?? "unknown"}`);

    let region = null;
    try { region = await globalThis.fromUuid(create.regionUuid); } catch { region = null; }
    if (!region) throw new Error("Movement corridor Region was created but could not be resolved.");

    const configured = await this.#cells.configure(region, {
      bounds: { min: { x: 0, y: 0, z: 0 }, size: { x: 5, y: 1, z: 1 } },
      defaultState: REGION_CELL_STATES.GONE ?? "GONE",
      cells: {
        "1,0,0": REGION_CELL_STATES.ACTIVE,
        "2,0,0": REGION_CELL_STATES.ACTIVE,
        "4,0,0": REGION_CELL_STATES.ACTIVE
      },
      frame: {
        type: "static",
        origin: { x: origin.x, y: origin.y, elevation: origin.elevation },
        rotation: 0
      }
    });
    if (configured?.configured !== true) {
      await this.#regions.delete(region).catch(() => undefined);
      throw new Error(`Could not configure movement corridor cells: ${configured?.reason ?? "unknown"}`);
    }

    const observations = [];
    const afterMovements = [];
    const observerId = `${MODULE_ID}.tests.region-cell-live-movement.${fixtureId}`;
    const startEntryStats = this.#entryInterruption?.getStats?.() ?? null;

    const unregisterBefore = this.#movement.registerConsumer({
      id: `${observerId}.before`,
      phases: [MOVEMENT_PHASES.BEFORE],
      priority: 30_000,
      tokenUuids: [subject.uuid],
      execution: "initiator",
      handler: (transaction, context) => {
        const internalReplay = transaction.generatedBy === MODULE_ID && transaction.internal === true;
        let plan = null;
        let classification = [];
        let measurement = null;
        let measurementError = null;

        if (!internalReplay) {
          try {
            plan = this.#entryInterruption?.planMovement?.(context.document, context.movement, transaction) ?? null;
            const route = uniquePositions(plan?.waypoints?.length ? plan.waypoints : transaction.path);
            if (route.length) {
              classification = this.#movementCosts.classifyInstruction({
                region,
                token: context.document,
                instruction: { waypoints: route.map(copyWaypoint) },
                states: [REGION_CELL_STATES.ACTIVE]
              });
              measurement = this.#measureCellAwarePath(context.document, transaction.origin, route, region);
            }
          } catch (error) {
            measurementError = error?.message ?? String(error);
          }
        }

        observations.push({
          at: new Date().toISOString(),
          transaction: transaction.toJSON?.() ?? duplicateSafely(transaction),
          internalReplay,
          plan: plan ? {
            planned: plan.planned,
            reason: plan.reason,
            entries: (plan.plan?.entries ?? []).map(entry => ({
              entryId: entry.entryId,
              regionUuid: entry.regionUuid,
              position: copyWaypoint(entry.position),
              sequence: entry.sequence
            })),
            waypoints: uniquePositions(plan.waypoints)
          } : null,
          costlyPositions: classification.filter(entry => entry.costly).map(entry => copyWaypoint(entry.point)),
          normalPositions: classification.filter(entry => !entry.costly).map(entry => copyWaypoint(entry.point)),
          measurement,
          measurementError
        });
      }
    });

    const unregisterAfter = this.#movement.registerConsumer({
      id: `${observerId}.after`,
      phases: [MOVEMENT_PHASES.AFTER],
      priority: -30_000,
      tokenUuids: [subject.uuid],
      execution: "initiator",
      handler: (transaction) => {
        afterMovements.push({
          at: new Date().toISOString(),
          transaction: transaction.toJSON?.() ?? duplicateSafely(transaction),
          tokenPosition: cloneTransform(subject)
        });
      }
    });

    this.#movementFixture = {
      fixtureId,
      sceneUuid: scene.uuid,
      tokenUuid: subject.uuid,
      regionUuid: region.uuid,
      origin,
      grid,
      observations,
      afterMovements,
      startEntryStats,
      unregisterBefore,
      unregisterAfter
    };

    const result = this.#movementStatus(this.#movementFixture);
    console.log("AE5E — REGION CELL LIVE MOVEMENT FIXTURE READY", result);
    if (notify) ui?.notifications?.info?.("AE5E Region Cell live movement fixture ready. Move the controlled Token as instructed, then run the report macro.");
    return result;
  }

  async resetMovementToken({ clearObservations = false, notify = true } = {}) {
    const fixture = this.#movementFixture;
    if (!fixture) throw new Error("No Region Cell live movement fixture is active.");
    const token = await this.#resolveUuid(fixture.tokenUuid);
    if (!token) throw new Error("Movement test Token no longer exists.");
    await this.#administrativeTokenUpdate(token, {
      x: fixture.origin.x,
      y: fixture.origin.y,
      elevation: fixture.origin.elevation,
      rotation: fixture.origin.rotation
    });
    if (clearObservations) {
      fixture.observations.length = 0;
      fixture.afterMovements.length = 0;
      fixture.startEntryStats = this.#entryInterruption?.getStats?.() ?? null;
    }
    const result = this.#movementStatus(fixture);
    if (notify) ui?.notifications?.info?.("AE5E Region Cell movement Token reset to the corridor start.");
    return result;
  }

  async reportMovementTest({ notify = true } = {}) {
    const fixture = this.#movementFixture;
    if (!fixture) throw new Error("No Region Cell live movement fixture is active.");
    const token = await this.#resolveUuid(fixture.tokenUuid);
    const region = await this.#resolveUuid(fixture.regionUuid);
    const currentEntryStats = this.#entryInterruption?.getStats?.() ?? null;
    const userObservations = fixture.observations.filter(entry => !entry.internalReplay);
    const methods = [...new Set(userObservations.map(entry => movementMethod(entry.transaction)))];
    const expectedEntries = [fixture.origin.x + fixture.grid.size, fixture.origin.x + (fixture.grid.size * 4)];
    const expectedCostly = [
      fixture.origin.x + fixture.grid.size,
      fixture.origin.x + (fixture.grid.size * 2),
      fixture.origin.x + (fixture.grid.size * 4)
    ];

    const longRoute = userObservations.find(entry => {
      const entries = entry.plan?.entries ?? [];
      return expectedEntries.every(x => entries.some(candidate => sameNumber(candidate.position?.x, x)));
    }) ?? null;

    const longCost = userObservations.find(entry => {
      const xs = entry.costlyPositions.map(point => point.x);
      return expectedCostly.every(x => xs.some(candidate => sameNumber(candidate, x)))
        && entry.normalPositions.some(point => sameNumber(point.x, fixture.origin.x + (fixture.grid.size * 3)));
    }) ?? null;

    const entryDelta = currentEntryStats && fixture.startEntryStats
      ? {
          plannedMovements: numeric(currentEntryStats.plannedMovements) - numeric(fixture.startEntryStats.plannedMovements),
          plannedEntries: numeric(currentEntryStats.plannedEntries) - numeric(fixture.startEntryStats.plannedEntries),
          cancelledOriginalMovements: numeric(currentEntryStats.cancelledOriginalMovements) - numeric(fixture.startEntryStats.cancelledOriginalMovements),
          replayedMovements: numeric(currentEntryStats.replayedMovements) - numeric(fixture.startEntryStats.replayedMovements),
          cellTransitionsInserted: numeric(currentEntryStats.cellTransitionsInserted) - numeric(fixture.startEntryStats.cellTransitionsInserted)
        }
      : null;

    const checks = [
      { name: "Movement fixture Region still exists and is cell-backed", passed: Boolean(region) && this.#occupancy.isCellBacked(region) },
      { name: "Physical Token movement was observed", passed: userObservations.length > 0 },
      { name: "GONE→ACTIVE→GONE→ACTIVE corridor produced both true ACTIVE entries", passed: Boolean(longRoute), details: longRoute?.plan?.entries ?? null },
      { name: "ACTIVE/GONE movement-cost classification matches the physical Foundry route", passed: Boolean(longCost), details: longCost ? { costly: longCost.costlyPositions, normal: longCost.normalPositions, measurement: longCost.measurement } : null },
      { name: "Production entry-interruption service planned/cancelled/replayed the physical route", passed: Boolean(entryDelta) && entryDelta.plannedEntries >= 2 && entryDelta.cancelledOriginalMovements >= 1 && entryDelta.replayedMovements >= 1, details: entryDelta },
      { name: "Drag movement was exercised", passed: methods.some(method => method.includes("drag")), details: methods },
      { name: "Keyboard movement was exercised", passed: methods.some(method => method.includes("keyboard")), details: methods }
    ];

    const passed = checks.every(check => check.passed);
    const result = {
      passed,
      checks,
      methods,
      entryDelta,
      token: safeDocumentIdentity(token),
      region: safeDocumentIdentity(region),
      observations: userObservations,
      afterMovements: fixture.afterMovements
    };
    this.#printResult("REGION CELL LIVE MOVEMENT", result, notify);
    return result;
  }

  async cleanupMovementTest({ restoreToken = true, notify = true } = {}) {
    const fixture = this.#movementFixture;
    if (!fixture) return { cleaned: true, reason: "no-active-movement-fixture" };
    this.#movementFixture = null;
    try { fixture.unregisterBefore?.(); } catch { /* noop */ }
    try { fixture.unregisterAfter?.(); } catch { /* noop */ }

    const token = await this.#resolveUuid(fixture.tokenUuid);
    if (restoreToken && token) {
      try {
        await this.#administrativeTokenUpdate(token, {
          x: fixture.origin.x,
          y: fixture.origin.y,
          elevation: fixture.origin.elevation,
          rotation: fixture.origin.rotation
        });
      } catch { /* best effort */ }
    }
    const region = await this.#resolveUuid(fixture.regionUuid);
    if (region) {
      try { await this.#regions.delete(region); }
      catch {
        try { await region.delete?.({ ae5eLiveAcceptanceCleanup: true }); } catch { /* best effort */ }
      }
    }
    const result = { cleaned: true, fixtureId: fixture.fixtureId, restoredToken: Boolean(restoreToken && token), regionRemoved: !(await this.#resolveUuid(fixture.regionUuid)) };
    if (notify) ui?.notifications?.info?.("AE5E Region Cell movement fixture cleaned up.");
    return result;
  }

  async setupAttachmentTest({ sourceToken = null, notify = true } = {}) {
    this.#assertLiveEnvironment();
    if (this.#attachmentFixture) await this.cleanupAttachmentTest({ restoreSource: true, notify: false });

    const source = this.#resolveToken(sourceToken);
    this.#assertOneByOne(source);
    const scene = source.parent;
    const grid = this.#grid(scene);
    const sourceOrigin = cloneTransform(source);
    const fixtureId = `region-cell-live-attachment-${randomId(12)}`;
    await this.#cleanupStaleAttachmentFixtureRegions(scene);

    const RegionDocument = globalThis.CONFIG?.Region?.documentClass;
    if (typeof RegionDocument?.createTokenEmanation !== "function") {
      throw new Error("Foundry v14 RegionDocument.createTokenEmanation API is unavailable.");
    }

    const authorityFlag = {
      requestId: fixtureId,
      requestedByUserId: game.user?.id ?? null,
      createdByUserId: game.user?.id ?? null,
      createdAt: new Date().toISOString(),
      metadata: { testFixture: true, suite: "region-cell-live-acceptance", fixture: "attachment", fixtureId }
    };
    const region = await RegionDocument.createTokenEmanation(source, 4, {
      name: "AE5E TEST — Attached Region Cell Volume",
      color: "#22c55e",
      locked: true,
      flags: { [MODULE_ID]: { [REGION_AUTHORITY_FLAG]: authorityFlag } }
    });
    if (!region?.uuid) throw new Error("Foundry did not create the native Token-attached Region.");

    const configured = await this.#cells.configure(region, {
      bounds: { min: { x: 0, y: 0, z: 0 }, size: { x: 3, y: 1, z: 3 } },
      defaultState: REGION_CELL_STATES.GONE ?? "GONE",
      cells: { "2,0,0": REGION_CELL_STATES.ACTIVE },
      frame: {
        type: "token",
        sourceTokenUuid: source.uuid,
        offset: { x: -0.5, y: -0.5, z: 0 },
        rotationOffset: -sourceOrigin.rotation
      }
    });
    if (configured?.configured !== true) {
      try { await region.delete?.({ ae5eLiveAcceptanceCleanup: true }); } catch { /* noop */ }
      throw new Error(`Could not configure attached Region cells: ${configured?.reason ?? "unknown"}`);
    }

    // The user's source Token may begin at any rotation. This fixture's logical
    // cell pattern is normalized with rotationOffset above so the initial ACTIVE
    // cell behaves as 0° local geometry regardless of the source's presentation.
    // Derive target positions from the actual transformed cell volumes rather
    // than assuming the source starts at 0°.
    const sourceAtTranslation = {
      uuid: source.uuid,
      x: sourceOrigin.x + grid.size,
      y: sourceOrigin.y,
      elevation: sourceOrigin.elevation,
      width: sourceOrigin.width,
      height: sourceOrigin.height,
      rotation: sourceOrigin.rotation
    };
    const translationVolume = this.#cells.getCellWorldVolume(region, { x: 2, y: 0, z: 0 }, {
      sourceToken: sourceAtTranslation
    });
    if (!translationVolume?.polygon?.length) throw new Error("Could not resolve the translated attached-cell target position.");
    const translationCenter = translationVolume.polygon.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
    translationCenter.x /= translationVolume.polygon.length;
    translationCenter.y /= translationVolume.polygon.length;
    const translationTargetPosition = {
      x: translationCenter.x - (grid.size / 2),
      y: translationCenter.y - (grid.size / 2),
      elevation: sourceOrigin.elevation
    };
    const elevatedTargetPosition = {
      ...translationTargetPosition,
      elevation: sourceOrigin.elevation + (grid.distance * 2)
    };
    const rotationVolume = this.#cells.getCellWorldVolume(region, { x: 2, y: 0, z: 0 }, {
      sourceToken: {
        uuid: source.uuid,
        x: sourceOrigin.x,
        y: sourceOrigin.y,
        elevation: sourceOrigin.elevation,
        width: sourceOrigin.width,
        height: sourceOrigin.height,
        rotation: sourceOrigin.rotation + 90
      }
    });
    if (!rotationVolume?.polygon?.length) throw new Error("Could not resolve the rotated attached-cell target position.");
    const rotationCenter = rotationVolume.polygon.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
    rotationCenter.x /= rotationVolume.polygon.length;
    rotationCenter.y /= rotationVolume.polygon.length;
    const rotationTargetPosition = {
      x: rotationCenter.x - (grid.size / 2),
      y: rotationCenter.y - (grid.size / 2),
      elevation: sourceOrigin.elevation
    };

    let targetDocuments;
    try {
      targetDocuments = await this.#createTemporaryTargets(source, [
        { name: "AE5E TEST — Translation Target (Low)", ...translationTargetPosition },
        { name: "AE5E TEST — Translation Target (High)", ...elevatedTargetPosition },
        { name: "AE5E TEST — Rotation Target", ...rotationTargetPosition }
      ]);
    } catch (error) {
      try { await this.#regions.delete(region); }
      catch {
        try { await region.delete?.({ ae5eLiveAcceptanceCleanup: true }); } catch { /* best effort */ }
      }
      throw error;
    }
    const [lowTarget, highTarget, rotationTarget] = targetDocuments;

    // A valid acceptance fixture must begin with all three stationary targets
    // outside the ACTIVE cell. Otherwise no later enter transition can be
    // interpreted unambiguously. This guards arbitrary source rotations and
    // future transform changes in the harness itself.
    const initiallyInside = [lowTarget, highTarget, rotationTarget].filter(token => this.#occupancy.testTokenAt(region, token));
    if (initiallyInside.length) {
      const ids = targetDocuments.map(token => token?.id).filter(Boolean);
      if (ids.length) await scene.deleteEmbeddedDocuments("Token", ids, { ae5eLiveAcceptanceCleanup: true }).catch(() => undefined);
      try { await this.#regions.delete(region); }
      catch { try { await region.delete?.({ ae5eLiveAcceptanceCleanup: true }); } catch { /* best effort */ } }
      throw new Error(`Attachment fixture geometry is ambiguous: ${initiallyInside.map(token => token.name).join(", ")} began inside the ACTIVE cell.`);
    }

    const transitions = [];
    const transitionHookId = Hooks.on(HOOKS.REGION_CELL_OCCUPANCY_TRANSITION, transition => {
      if (!this.#attachmentFixture || this.#attachmentFixture.fixtureId !== fixtureId) return;
      if (this.#attachmentFixture.resetting) return;
      if (transition?.regionUuid !== region.uuid || transition?.sourceTokenUuid !== source.uuid) return;
      transitions.push({ ...transition, observedAt: new Date().toISOString() });
      console.log("AE5E Region Cell live attachment transition:", transition);
    });

    this.#attachmentFixture = {
      fixtureId,
      sceneUuid: scene.uuid,
      sourceTokenUuid: source.uuid,
      regionUuid: region.uuid,
      sourceOrigin,
      grid,
      targetUuids: {
        low: lowTarget.uuid,
        high: highTarget.uuid,
        rotation: rotationTarget.uuid
      },
      targetPositions: {
        low: translationTargetPosition,
        high: elevatedTargetPosition,
        rotation: rotationTargetPosition
      },
      transitions,
      transitionHookId,
      resetting: false
    };

    const status = this.#attachmentStatus(this.#attachmentFixture);
    console.log("AE5E — REGION CELL LIVE ATTACHMENT FIXTURE READY", status);
    if (notify) ui?.notifications?.info?.("AE5E Region Cell attached-Region fixture ready. Move/raise/rotate the controlled source Token as instructed, then run the report macro.");
    return status;
  }

  async resetAttachmentSource({ clearTransitions = false, notify = true } = {}) {
    const fixture = this.#attachmentFixture;
    if (!fixture) throw new Error("No Region Cell live attachment fixture is active.");
    const source = await this.#resolveUuid(fixture.sourceTokenUuid);
    if (!source) throw new Error("Attachment source Token no longer exists.");
    fixture.resetting = true;
    try {
      await this.#administrativeTokenUpdate(source, {
        x: fixture.sourceOrigin.x,
        y: fixture.sourceOrigin.y,
        elevation: fixture.sourceOrigin.elevation,
        rotation: fixture.sourceOrigin.rotation
      });
    } finally {
      fixture.resetting = false;
    }
    if (clearTransitions) fixture.transitions.length = 0;
    const result = this.#attachmentStatus(fixture);
    if (notify) ui?.notifications?.info?.("AE5E Region Cell attachment source reset to its starting transform.");
    return result;
  }

  async reportAttachmentTest({ notify = true } = {}) {
    const fixture = this.#attachmentFixture;
    if (!fixture) throw new Error("No Region Cell live attachment fixture is active.");
    const source = await this.#resolveUuid(fixture.sourceTokenUuid);
    const region = await this.#resolveUuid(fixture.regionUuid);
    const low = await this.#resolveUuid(fixture.targetUuids.low);
    const high = await this.#resolveUuid(fixture.targetUuids.high);
    const rotation = await this.#resolveUuid(fixture.targetUuids.rotation);
    const recognized = source && region ? this.#attachments.regionsForSource(source).some(candidate => candidate?.uuid === region.uuid) : false;
    const transitions = fixture.transitions;

    const lowEnter = transitions.find(entry => entry.tokenUuid === fixture.targetUuids.low && entry.type === "enter");
    const lowExit = transitions.find(entry => entry.tokenUuid === fixture.targetUuids.low && entry.type === "exit");
    const highEnter = transitions.find(entry => entry.tokenUuid === fixture.targetUuids.high && entry.type === "enter");
    const rotationEnter = transitions.find(entry => entry.tokenUuid === fixture.targetUuids.rotation && entry.type === "enter"
      && !sameNumber(entry.sourceTransformAfter?.rotation, fixture.sourceOrigin.rotation));

    const checks = [
      { name: "Foundry native attachment is recognized by AE5E", passed: recognized, details: this.#attachmentIdentity(region, source) },
      { name: "Source translation swept the low stationary target into ACTIVE volume", passed: Boolean(lowEnter), details: lowEnter ? summarizeTransitions([lowEnter])[0] : null },
      { name: "Source elevation swept the low target back out", passed: Boolean(lowExit), details: lowExit ? summarizeTransitions([lowExit])[0] : null },
      { name: "Same-XY elevated target entered independently after source elevation changed", passed: Boolean(highEnter), details: highEnter ? summarizeTransitions([highEnter])[0] : null },
      { name: "Source rotation swept the rotation target into ACTIVE volume", passed: Boolean(rotationEnter), details: rotationEnter ? summarizeTransitions([rotationEnter])[0] : null },
      { name: "Local Region cell state remained unchanged throughout source transforms", passed: region ? this.#cells.getCellState(region, { x: 2, y: 0, z: 0 }) === REGION_CELL_STATES.ACTIVE : false },
      { name: "Temporary targets remain independent documents", passed: Boolean(low && high && rotation) && new Set([low.uuid, high.uuid, rotation.uuid]).size === 3 }
    ];

    const passed = checks.every(check => check.passed);
    const result = {
      passed,
      checks,
      source: safeDocumentIdentity(source),
      region: safeDocumentIdentity(region),
      targets: {
        low: safeDocumentIdentity(low),
        high: safeDocumentIdentity(high),
        rotation: safeDocumentIdentity(rotation)
      },
      transitions: summarizeTransitions(transitions),
      attachmentStats: this.#attachments.getStats()
    };
    this.#printResult("REGION CELL LIVE ATTACHMENT", result, notify);
    return result;
  }

  async cleanupAttachmentTest({ restoreSource = true, notify = true } = {}) {
    const fixture = this.#attachmentFixture;
    if (!fixture) return { cleaned: true, reason: "no-active-attachment-fixture" };
    this.#attachmentFixture = null;
    if (fixture.transitionHookId != null) {
      try { Hooks.off(HOOKS.REGION_CELL_OCCUPANCY_TRANSITION, fixture.transitionHookId); } catch { /* noop */ }
    }

    const source = await this.#resolveUuid(fixture.sourceTokenUuid);
    if (restoreSource && source) {
      try {
        await this.#administrativeTokenUpdate(source, {
          x: fixture.sourceOrigin.x,
          y: fixture.sourceOrigin.y,
          elevation: fixture.sourceOrigin.elevation,
          rotation: fixture.sourceOrigin.rotation
        });
      } catch { /* best effort */ }
    }

    const region = await this.#resolveUuid(fixture.regionUuid);
    if (region) {
      try { await this.#regions.delete(region); }
      catch {
        try { await region.delete?.({ ae5eLiveAcceptanceCleanup: true }); } catch { /* best effort */ }
      }
    }

    const targetIds = [];
    for (const uuid of Object.values(fixture.targetUuids ?? {})) {
      const token = await this.#resolveUuid(uuid);
      if (token?.id) targetIds.push(token.id);
    }
    const scene = globalThis.canvas?.scene?.uuid === fixture.sceneUuid ? canvas.scene : await this.#resolveUuid(fixture.sceneUuid);
    if (scene?.deleteEmbeddedDocuments && targetIds.length) {
      try { await scene.deleteEmbeddedDocuments("Token", targetIds, { ae5eLiveAcceptanceCleanup: true }); } catch { /* best effort */ }
    }

    const result = {
      cleaned: true,
      fixtureId: fixture.fixtureId,
      restoredSource: Boolean(restoreSource && source),
      regionRemoved: !(await this.#resolveUuid(fixture.regionUuid)),
      targetsRemoved: (await Promise.all(Object.values(fixture.targetUuids ?? {}).map(uuid => this.#resolveUuid(uuid)))).every(token => !token)
    };
    if (notify) ui?.notifications?.info?.("AE5E Region Cell attachment fixture cleaned up.");
    return result;
  }

  async cleanupAll(options = {}) {
    const movement = await this.cleanupMovementTest({ restoreToken: true, notify: false });
    const attachment = await this.cleanupAttachmentTest({ restoreSource: true, notify: false });
    const result = { cleaned: true, movement, attachment };
    if (options?.notify !== false) ui?.notifications?.info?.("AE5E Region Cell live acceptance fixtures cleaned up.");
    return result;
  }

  #movementStatus(fixture) {
    return {
      active: true,
      fixtureId: fixture.fixtureId,
      tokenUuid: fixture.tokenUuid,
      regionUuid: fixture.regionUuid,
      origin: duplicateSafely(fixture.origin),
      corridor: {
        direction: "east",
        cells: ["GONE", "ACTIVE", "ACTIVE", "GONE", "ACTIVE"],
        finalPosition: {
          x: fixture.origin.x + (fixture.grid.size * 4),
          y: fixture.origin.y,
          elevation: fixture.origin.elevation
        }
      },
      observedBeforeMovements: fixture.observations.length,
      observedAfterMovements: fixture.afterMovements.length
    };
  }

  #attachmentStatus(fixture) {
    return {
      active: true,
      fixtureId: fixture.fixtureId,
      sourceTokenUuid: fixture.sourceTokenUuid,
      regionUuid: fixture.regionUuid,
      sourceOrigin: duplicateSafely(fixture.sourceOrigin),
      targetUuids: duplicateSafely(fixture.targetUuids),
      targetPositions: duplicateSafely(fixture.targetPositions),
      instructions: {
        translation: `Move the source exactly 1 grid space east (${fixture.grid.distance} scene units).`,
        elevation: `Then raise the source exactly 2 grid units (${fixture.grid.distance * 2} scene units) without changing X/Y.`,
        rotation: "Reset the source with resetAttachmentSource(), then rotate it +90 degrees without changing X/Y/elevation."
      },
      observedTransitions: fixture.transitions.length
    };
  }

  #measureCellAwarePath(token, origin, route, region) {
    if (typeof token?.measureMovementPath !== "function") return { measured: false, reason: "measureMovementPath-unavailable" };
    const basePoints = uniquePositions([copyWaypoint(origin), ...route.map(copyWaypoint)]);
    if (basePoints.length < 2) return { measured: false, reason: "insufficient-waypoints" };

    let base = null;
    try { base = token.measureMovementPath(basePoints.map(copyWaypoint)); }
    catch (error) { return { measured: false, reason: "base-measurement-failed", message: error?.message ?? String(error) }; }

    const adjustedPoints = route.map(copyWaypoint);
    const release = this.#movementCosts.applyToInstruction({
      region,
      token,
      instruction: { waypoints: adjustedPoints },
      states: [REGION_CELL_STATES.ACTIVE],
      multiplier: 2,
      id: `region-cell-live-measure-${randomId(10)}`,
      label: "AE5E TEST — Region Cell Difficult Terrain"
    });
    try {
      const adjusted = token.measureMovementPath(uniquePositions([copyWaypoint(origin), ...adjustedPoints]));
      return {
        measured: true,
        base: { cost: base?.cost ?? null, distance: base?.distance ?? null, spaces: base?.spaces ?? null },
        adjusted: { cost: adjusted?.cost ?? null, distance: adjusted?.distance ?? null, spaces: adjusted?.spaces ?? null },
        actions: adjustedPoints.map(point => ({ x: point.x, y: point.y, elevation: point.elevation, action: point.action ?? null }))
      };
    } finally {
      try { release?.(); } catch { /* noop */ }
    }
  }

  #attachmentIdentity(region, source) {
    const regionToken = region?.attachment?.token ?? region?._source?.attachment?.token ?? region?.attachedToken ?? null;
    const tokenAttachments = source?.attachments?.regions;
    return {
      regionAttachmentToken: typeof regionToken === "object" ? safeDocumentIdentity(regionToken) : regionToken,
      tokenAttachmentUuids: tokenAttachments && typeof tokenAttachments.values === "function" ? [...tokenAttachments].map(candidate => candidate?.uuid ?? candidate?.id ?? null) : null
    };
  }

  async #cleanupStaleAttachmentFixtureRegions(scene) {
    const regions = Array.from(scene?.regions ?? []).filter(region => {
      const authority = region?.getFlag?.(MODULE_ID, REGION_AUTHORITY_FLAG)
        ?? region?.flags?.[MODULE_ID]?.[REGION_AUTHORITY_FLAG]
        ?? region?._source?.flags?.[MODULE_ID]?.[REGION_AUTHORITY_FLAG]
        ?? null;
      const metadata = authority?.metadata ?? {};
      return metadata?.testFixture === true
        && metadata?.suite === "region-cell-live-acceptance"
        && metadata?.fixture === "attachment";
    });
    for (const region of regions) {
      try { await this.#regions.delete(region); }
      catch {
        try { await region.delete?.({ ae5eLiveAcceptanceCleanup: true }); } catch { /* best effort */ }
      }
    }
    return regions.length;
  }

  async #createTemporaryTargets(source, placements) {
    const scene = source.parent;
    const sourceData = source.toObject?.(false) ?? source.toObject?.() ?? {};
    const sourceTexture = duplicateSafely(sourceData.texture ?? source.texture ?? {});
    const sourceWidth = numeric(sourceData.width ?? source.width, 1);
    const sourceHeight = numeric(sourceData.height ?? source.height, 1);
    const actorId = source?.actor?.id ?? sourceData.actorId ?? source?._source?.actorId ?? null;
    if (!actorId) {
      throw new Error("Use an Actor-backed 1x1 source Token for the attached-Region live acceptance test.");
    }
    const data = placements.map((placement, index) => ({
      name: placement.name ?? `AE5E TEST Target ${index + 1}`,
      // CAT and other Region consumers reasonably expect Scene Tokens to have an Actor.
      // Reuse the source Actor as three unlinked synthetic Tokens, while keeping the
      // fixture payload minimal so no source vision/detection-mode data is cloned.
      actorId,
      actorLink: false,
      x: placement.x,
      y: placement.y,
      elevation: placement.elevation,
      width: sourceWidth,
      height: sourceHeight,
      rotation: 0,
      locked: true,
      hidden: false,
      texture: sourceTexture,
      sight: { enabled: false },
      flags: {
        [MODULE_ID]: {
          regionCellLiveAcceptanceTarget: true
        }
      }
    }));
    const created = await scene.createEmbeddedDocuments("Token", data, { ae5eLiveAcceptanceFixture: true });
    if (!Array.isArray(created) || created.length !== placements.length) {
      const ids = (created ?? []).map(token => token?.id).filter(Boolean);
      if (ids.length) await scene.deleteEmbeddedDocuments("Token", ids, { ae5eLiveAcceptanceCleanup: true }).catch(() => undefined);
      throw new Error("Could not create all temporary attachment target Tokens.");
    }

    // Foundry/module document hooks may not preserve requested create order. Bind
    // the acceptance roles by their unique fixture names instead of assuming the
    // returned array is [low, high, rotation]. This is diagnostic-only plumbing;
    // production Region-cell occupancy is independent of Token creation order.
    const createdByName = new Map(created.map(token => [token?.name, token]));
    const ordered = placements.map(placement => createdByName.get(placement.name));
    if (ordered.some(token => !token)) {
      const ids = created.map(token => token?.id).filter(Boolean);
      if (ids.length) await scene.deleteEmbeddedDocuments("Token", ids, { ae5eLiveAcceptanceCleanup: true }).catch(() => undefined);
      throw new Error("Could not bind all temporary attachment target Tokens to their requested fixture roles.");
    }
    return ordered;
  }

  async #administrativeTokenUpdate(token, changes) {
    const operation = this.#movement.createOperationOptions({
      pathType: PATH_TYPES.REPOSITION,
      agency: MOVEMENT_AGENCIES.ADMINISTRATIVE,
      resource: MOVEMENT_RESOURCES.NONE,
      internal: true,
      suppressAutomation: true,
      administrative: true,
      sourceUuid: "AE5E.RegionCellLiveAcceptance"
    });
    return token.update(changes, { ...operation, animate: false, ae5eLiveAcceptanceReset: true });
  }

  #resolveToken(value) {
    const token = asDocument(value) ?? selectedTokenDocument();
    if (!token?.uuid || token.documentName !== "Token") throw new Error("A valid Scene Token is required.");
    if (token.parent?.uuid !== globalThis.canvas?.scene?.uuid) throw new Error("The selected Token must belong to the viewed Scene.");
    return token;
  }

  async #resolveUuid(uuid) {
    if (!uuid) return null;
    try { return await globalThis.fromUuid?.(uuid) ?? null; }
    catch { return null; }
  }

  #grid(scene) {
    const size = numeric(scene?.grid?.size ?? globalThis.canvas?.grid?.size, 0);
    const distance = numeric(scene?.grid?.distance ?? globalThis.canvas?.grid?.distance, 0);
    if (!(size > 0) || !(distance > 0)) throw new Error("A measured Scene grid is required.");
    const isSquare = globalThis.canvas?.grid?.isSquare ?? String(scene?.grid?.type ?? "").toLowerCase().includes("square");
    if (isSquare === false) throw new Error("The initial Region Cell live acceptance harness requires a square grid.");
    return { size, distance };
  }

  #assertOneByOne(token) {
    if (!sameNumber(token?.width, 1) || !sameNumber(token?.height, 1)) {
      throw new Error("Use a 1x1 Token for this focused live acceptance harness. Large-token geometry is already covered by the automated suite.");
    }
  }

  #assertLiveEnvironment() {
    if (!globalThis.game?.user?.isGM) throw new Error("Run the Region Cell live acceptance harness as a GM.");
    if (!globalThis.canvas?.scene) throw new Error("Activate a Scene before running the Region Cell live acceptance harness.");
    if (!globalThis.Hooks?.on || !globalThis.fromUuid) throw new Error("Foundry live APIs are unavailable.");
  }

  #printResult(label, result, notify) {
    const passed = result?.passed === true;
    console.log(`%cAE5E — ${label} — ${passed ? "PASS" : "INCOMPLETE / FAIL"}`, `font-size:22px;font-weight:bold;color:${passed ? "#5cff8d" : "#ffbf5c"};`);
    console.table((result?.checks ?? []).map(check => ({ Check: check.name, Result: check.passed ? "PASS" : "NOT YET / FAIL", Details: check.details ?? "—" })));
    console.log(result);
    if (notify) ui?.notifications?.[passed ? "info" : "warn"]?.(`AE5E ${label} ${passed ? "PASSED" : "is incomplete or failed"}. See console.`);
  }
}
