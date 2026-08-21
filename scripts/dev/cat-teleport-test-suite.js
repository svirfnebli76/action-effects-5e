import {
  ATTACHMENT_MODES,
  COLLISION_POLICIES,
  MODULE_ID,
  MOVEMENT_PHASES,
  PATH_TYPES,
  RELATIONSHIP_COORDINATION_POLICIES,
  RELATIONSHIP_FORCED_LEADER_MOVEMENT_POLICIES,
  RELATIONSHIP_TYPES,
  TELEPORT_POLICIES
} from "../core/constants.js";
import { Logger } from "../core/logger.js";

export class CatTeleportTestSuite {
  #movement;
  #catMovement;
  #relationships;

  constructor({ movement, catMovement, relationships }) {
    this.#movement = movement;
    this.#catMovement = catMovement;
    this.#relationships = relationships;
  }

  async runLiveLifecycleTest({ notify = true } = {}) {
    if (!canvas?.ready) throw new Error("A Scene canvas must be active.");
    if (!game.user?.isGM) throw new Error("The CAT teleport compatibility test requires a GM user.");

    const cat = globalThis.cat;
    const MovementEvent = cat?.lib?.Events?.MovementEvent;
    const catMoveToken = cat?.utils?.tokenUtils?.moveToken;
    const status = this.#catMovement.getStatus();
    if (!status.active || typeof MovementEvent !== "function" || typeof catMoveToken !== "function") {
      throw new Error("CAT must be active and expose MovementEvent plus tokenUtils.moveToken() for this test.");
    }
    if (!status.teleportLifecycle?.wrapperRegistered) {
      throw new Error("AE5E CAT teleport lifecycle compatibility is not armed. Check the console for the libWrapper registration warning.");
    }

    const checks = [];
    const record = (name, passed, details = null) => {
      const entry = { name, passed: Boolean(passed), details };
      checks.push(entry);
      console[entry.passed ? "log" : "error"](
        `%c${entry.passed ? "PASS" : "FAIL"}%c  ${name}`,
        `font-size:14px;font-weight:bold;color:${entry.passed ? "#18cc46" : "#ff5555"}`,
        "color:inherit",
        details ?? ""
      );
      return entry;
    };
    const banner = (text, color = "#18cc46", size = 22) => console.log(
      `%c${text}`,
      `font-size:${size}px;font-weight:bold;color:${color}`
    );
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const approx = (a, b) => Math.abs(Number(a) - Number(b)) <= 0.01;
    const waitUntil = async (predicate, timeoutMs = 2_000, pollMs = 25) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() <= deadline) {
        if (predicate()) return true;
        await sleep(pollMs);
      }
      return Boolean(predicate());
    };

    const scene = canvas.scene;
    const grid = Number(canvas.grid?.size ?? scene?.grid?.size ?? 100);
    const gridDistance = Number(scene?.grid?.distance) > 0 ? Number(scene.grid.distance) : 5;
    if (!(grid > 0) || Number(scene.width) < grid * 3 || Number(scene.height) < grid * 3) {
      throw new Error("The active Scene must have room for a small three-cell CAT teleport fixture.");
    }

    const maxX = Math.max(0, Number(scene.width) - grid);
    const maxY = Math.max(0, Number(scene.height) - grid);
    const baseX = Math.max(grid, Math.min(Math.floor(Number(scene.width) / (2 * grid)) * grid, maxX - grid));
    const baseY = Math.max(grid, Math.min(Math.floor(Number(scene.height) / (2 * grid)) * grid, maxY - grid));
    const xDirection = baseX + grid <= maxX ? 1 : -1;
    const yDirection = baseY + grid <= maxY ? 1 : -1;
    const followerStart = { x: baseX, y: baseY, elevation: 0 };
    const followerEnd = { x: baseX + (xDirection * grid), y: baseY, elevation: 0 };
    const leaderStart = { x: baseX, y: baseY + (yDirection * grid), elevation: 0 };

    let leaderActor = null;
    let followerActor = null;
    let leader = null;
    let follower = null;
    let relationship = null;
    let unregister = null;
    const transactions = { before: null, after: null };
    let resolveAfter;
    const afterTransaction = new Promise((resolve) => { resolveAfter = resolve; });
    const statsBefore = this.#catMovement.getStats();

    banner("AE5E 0.4.1.8 — CAT TELEPORT COMPATIBILITY");

    try {
      record("CAT teleport lifecycle wrapper is registered", status.teleportLifecycle.wrapperRegistered === true, status.teleportLifecycle);
      record("CAT semantic socket handlers are registered", status.teleportLifecycle.socketHandlersRegistered === true, status.teleportLifecycle);
      const actions = globalThis.CONFIG?.Token?.movement?.actions;
      const displaceAction = actions?.get?.("displace") ?? actions?.displace ?? null;
      record("CAT physical displace action is available", Boolean(displaceAction), displaceAction);

      leaderActor = await Actor.create({
        name: "AE5E CAT Teleport Test — Grappler",
        type: "character"
      }, { renderSheet: false });
      followerActor = await Actor.create({
        name: "AE5E CAT Teleport Test — Entangled Creature",
        type: "character"
      }, { renderSheet: false });

      await followerActor.createEmbeddedDocuments("ActiveEffect", [{
        name: "AE5E CAT Teleport Test — Cannot Move",
        img: "icons/svg/net.svg",
        disabled: false,
        flags: {
          [MODULE_ID]: {
            movement: {
              voluntaryRestriction: {
                enabled: true,
                priority: 100,
                message: "AE5E CAT teleport test voluntary movement restriction"
              }
            }
          }
        }
      }]);

      [leader] = await scene.createEmbeddedDocuments("Token", [{
        name: "AE5E CAT Teleport Test — Grappler",
        actorId: leaderActor.id,
        x: leaderStart.x,
        y: leaderStart.y,
        elevation: leaderStart.elevation,
        width: 1,
        height: 1
      }]);
      [follower] = await scene.createEmbeddedDocuments("Token", [{
        name: "AE5E CAT Teleport Test — Entangled Creature",
        actorId: followerActor.id,
        x: followerStart.x,
        y: followerStart.y,
        elevation: followerStart.elevation,
        width: 1,
        height: 1
      }]);

      relationship = await this.#relationships.create({
        type: RELATIONSHIP_TYPES.GRAPPLE,
        attachmentMode: ATTACHMENT_MODES.GRAPPLE_FOLLOWER,
        leaderUuid: leader.uuid,
        followerUuid: follower.uuid,
        followerCanSelfMove: false,
        followElevation: true,
        followRotation: false,
        teleportPolicy: TELEPORT_POLICIES.DETACH,
        collisionPolicy: COLLISION_POLICIES.STOP_GROUP,
        coordinationPolicy: RELATIONSHIP_COORDINATION_POLICIES.COORDINATED,
        forcedLeaderMovementPolicy: RELATIONSHIP_FORCED_LEADER_MOVEMENT_POLICIES.INDEPENDENT,
        breakDistance: gridDistance,
        coordinationDistance: gridDistance,
        metadata: { createdByCatTeleportTest: true }
      });

      const restriction = this.#movement.getVoluntaryMovementRestriction(follower);
      record("Voluntary-movement restriction is active on the teleporting creature", restriction?.enabled === true, restriction);
      record("Grapple relationship fixture was created", Boolean(relationship?.id), relationship);

      unregister = this.#movement.registerConsumer({
        id: `${MODULE_ID}.cat-teleport-live.${foundry.utils.randomID(8)}`,
        phases: [MOVEMENT_PHASES.BEFORE, MOVEMENT_PHASES.AFTER],
        tokenUuids: [follower.uuid],
        execution: "initiator",
        priority: 30_000,
        handler: (transaction) => {
          if (transaction.phase === MOVEMENT_PHASES.BEFORE) transactions.before = transaction;
          if (transaction.phase === MOVEMENT_PHASES.AFTER) {
            transactions.after = transaction;
            resolveAfter(transaction);
          }
        }
      });

      const destination = { ...followerEnd };
      const preResult = await new MovementEvent(follower, "preTeleport", {
        destination,
        teleport: true,
        action: "displace"
      }).run();
      record("CAT preTeleport lifecycle did not cancel the fixture", !preResult, preResult);

      await catMoveToken(follower, [{
        ...destination,
        action: "displace",
        explicit: true,
        checkpoint: true
      }], {
        method: "api",
        animate: false,
        pan: false,
        showRuler: false,
        constrainOptions: { ignoreWalls: true, ignoreCost: true, ignoreTokens: true }
      });

      await new MovementEvent(follower, "postTeleport", {
        destination,
        teleport: true,
        action: "displace"
      }).run();

      await Promise.race([afterTransaction, sleep(1_500)]);
      await waitUntil(() => !this.#relationships.get(relationship.id), 2_000);

      record("Restricted creature completed the CAT teleport instead of being movement-blocked",
        approx(follower.x, followerEnd.x) && approx(follower.y, followerEnd.y),
        { expected: followerEnd, actual: { x: follower.x, y: follower.y, elevation: follower.elevation } });
      record("preMoveToken transaction was classified as teleport",
        transactions.before?.pathType === PATH_TYPES.TELEPORT,
        transactions.before?.toJSON?.() ?? null);
      record("moveToken transaction was classified as teleport",
        transactions.after?.pathType === PATH_TYPES.TELEPORT,
        transactions.after?.toJSON?.() ?? null);
      record("CAT teleport semantic metadata survived the movement transaction",
        transactions.after?.metadata?.catTeleport === true
          && transactions.after?.metadata?.interoperabilityProvider === "cat"
          && transactions.after?.metadata?.nativeMovementAction === "displace",
        transactions.after?.metadata ?? null);
      record("Existing grapple teleport policy detached the relationship",
        !this.#relationships.get(relationship.id),
        { relationshipId: relationship.id });

      const statsAfter = this.#catMovement.getStats();
      record("CAT adapter recognized exactly one new external teleport",
        statsAfter.recognizedExternalTeleports === statsBefore.recognizedExternalTeleports + 1,
        { before: statsBefore.recognizedExternalTeleports, after: statsAfter.recognizedExternalTeleports });
      record("CAT teleport context cleaned up after postTeleport",
        statsAfter.status.teleportLifecycle.pendingContexts === 0,
        statsAfter.status.teleportLifecycle);
    } finally {
      try { unregister?.(); } catch {}
      if (relationship?.id && this.#relationships.get(relationship.id)) {
        try { await this.#relationships.remove(relationship.id); } catch {}
      }
      if (leader?.id && scene.tokens.get(leader.id)) {
        try { await scene.deleteEmbeddedDocuments("Token", [leader.id]); } catch {}
      }
      if (follower?.id && scene.tokens.get(follower.id)) {
        try { await scene.deleteEmbeddedDocuments("Token", [follower.id]); } catch {}
      }
      if (leaderActor?.id && game.actors.get(leaderActor.id)) {
        try { await leaderActor.delete(); } catch {}
      }
      if (followerActor?.id && game.actors.get(followerActor.id)) {
        try { await followerActor.delete(); } catch {}
      }
    }

    record("Disposable grapple Token cleaned up", !leader || !scene.tokens.get(leader.id));
    record("Disposable teleporting Token cleaned up", !follower || !scene.tokens.get(follower.id));
    record("Disposable Actors cleaned up",
      (!leaderActor || !game.actors.get(leaderActor.id)) && (!followerActor || !game.actors.get(followerActor.id)));

    const passed = checks.every((check) => check.passed);
    const report = {
      result: passed ? "PASS" : "FAIL",
      version: "0.4.1.8",
      environment: {
        foundry: game.version,
        dnd5e: game.system.version,
        cat: game.modules.get("cat")?.version ?? null
      },
      summary: {
        passed: checks.filter((check) => check.passed).length,
        failed: checks.filter((check) => !check.passed).length,
        total: checks.length
      },
      checks,
      adapterBefore: statsBefore,
      adapterAfter: this.#catMovement.getStats()
    };

    banner(
      `AE5E 0.4.1.8 CAT TELEPORT — ${report.summary.passed}/${report.summary.total} PASSED`,
      passed ? "#18cc46" : "#ff5555",
      25
    );
    Logger.info("AE5E 0.4.1.8 CAT teleport compatibility test", report);
    console.log(report);
    if (notify && ui?.notifications) {
      ui.notifications[passed ? "info" : "warn"](
        passed
          ? "AE5E 0.4.1.8 CAT teleport compatibility test passed. See console for details."
          : "AE5E 0.4.1.8 CAT teleport compatibility test found a problem. See console for details."
      );
    }
    return report;
  }
}
