import assert from "node:assert/strict";
import test from "node:test";

import { Ac5eEligibilityAdapter } from "../scripts/integrations/ac5e-eligibility-adapter.js";
import { SneakAttackEligibilityService } from "../scripts/sneak-attack/eligibility-service.js";
import { SneakAttackActivityService } from "../scripts/sneak-attack/activity-service.js";
import { SneakAttackTurnTrackerService } from "../scripts/sneak-attack/turn-tracker-service.js";
import { SneakAttackTransactionService } from "../scripts/sneak-attack/transaction-service.js";

function activityCollection(values) {
  return new Map(values.map(activity => [activity.id, activity]));
}

function makeEntry({ condition, activity = "trip", activityType = "save", target = "sneakTarget", consume, configure } = {}) {
  const declaration = {
    type: "option",
    id: "fixture-option",
    executor: "activity",
    activity,
    activityType,
    target,
    ...(condition !== undefined ? { condition } : {}),
    ...(consume !== undefined ? { consume } : {}),
    ...(configure !== undefined ? { configure } : {})
  };
  return {
    declaration,
    provenance: {
      sourceItem: null,
      sourceItemIdentifier: "fixture-feature"
    }
  };
}

test("AC5E eligibility adapter uses evaluationData + safeEval condition mode and preserves AE5E context", () => {
  const subjectToken = { id: "rogue", actor: { name: "Rogue" } };
  const opponentToken = { id: "target", actor: { name: "Target" } };
  const activity = { id: "attack", item: { name: "Rapier" } };
  let evaluationArgs = null;
  let safeEvalArgs = null;

  const adapter = new Ac5eEligibilityAdapter({
    moduleAccessor: () => ({ active: true, version: "14.test" }),
    ac5eAccessor: () => ({
      evaluationData(args) {
        evaluationArgs = args;
        return { actor: args.subjectToken.actor, opponent: args.opponentToken.actor, hasAdvantage: true };
      },
      safeEval(args) {
        safeEvalArgs = args;
        return args.expression === "hasAdvantage" && args.sandbox.hasAdvantage === true;
      }
    })
  });

  const result = adapter.evaluateCondition({
    expression: "hasAdvantage",
    subjectToken,
    opponentToken,
    activity,
    context: { transactionId: "tx-1", declarationId: "trip" }
  });

  assert.equal(result.ok, true);
  assert.equal(result.eligible, true);
  assert.equal(evaluationArgs.subjectToken, subjectToken);
  assert.equal(evaluationArgs.opponentToken, opponentToken);
  assert.equal(evaluationArgs.options.activity, activity);
  assert.equal(safeEvalArgs.mode, "condition");
  assert.equal(safeEvalArgs.expression, "hasAdvantage");
  assert.equal(safeEvalArgs.sandbox.ae5e.transactionId, "tx-1");
  assert.equal(safeEvalArgs.debug, undefined, "boolean false must not be forwarded as AC5E debug metadata");
  assert.equal(adapter.getStats().trueResults, 1);
});

test("AC5E eligibility adapter normalizes AE5E boolean debug switches to AC5E metadata objects", () => {
  const seen = [];
  const adapter = new Ac5eEligibilityAdapter({
    moduleAccessor: () => ({ active: true, version: "14.533.18" }),
    ac5eAccessor: () => ({
      evaluationData: () => ({ actor: {} }),
      safeEval(args) {
        seen.push(args);
        let debug = args.debug;
        debug ??= {};
        debug.log = undefined;
        return args.expression === "true";
      }
    })
  });

  const defaultResult = adapter.evaluateCondition({ expression: "true" });
  const debugResult = adapter.evaluateCondition({ expression: "true", debug: true });

  assert.equal(defaultResult.ok, true);
  assert.equal(defaultResult.eligible, true);
  assert.equal(seen[0].debug, undefined);
  assert.equal(debugResult.ok, true);
  assert.equal(debugResult.eligible, true);
  assert.deepEqual(seen[1].debug, { log: undefined });
});

test("AC5E eligibility adapter fails closed when unavailable or evaluation throws", () => {
  const unavailable = new Ac5eEligibilityAdapter({
    moduleAccessor: () => ({ active: false, version: "14.test" }),
    ac5eAccessor: () => ({})
  });
  const missing = unavailable.evaluateCondition({ expression: "true" });
  assert.equal(missing.ok, false);
  assert.equal(missing.eligible, false);
  assert.equal(missing.reason, "ac5e-safe-eval-unavailable");

  const throwing = new Ac5eEligibilityAdapter({
    moduleAccessor: () => ({ active: true, version: "14.test" }),
    ac5eAccessor: () => ({
      evaluationData: () => ({ actor: {} }),
      safeEval: () => { throw new Error("bad expression"); }
    })
  });
  const errored = throwing.evaluateCondition({ expression: "bad(" });
  assert.equal(errored.ok, false);
  assert.equal(errored.eligible, false);
  assert.equal(errored.reason, "ac5e-condition-evaluation-error");
});

test("Sneak Attack eligibility service evaluates declaration conditions independently and leaves unconditional entries eligible", () => {
  const calls = [];
  const ac5e = {
    evaluateCondition(request) {
      calls.push(request);
      if (request.expression === "allow") return { ok: true, eligible: true, reason: null, result: true };
      if (request.expression === "deny") return { ok: true, eligible: false, reason: "condition-false", result: false };
      return { ok: false, eligible: false, reason: "ac5e-condition-evaluation-error", result: null };
    },
    getStatus: () => ({ active: true }),
    getStats: () => ({ evaluations: calls.length })
  };
  const service = new SneakAttackEligibilityService({ ac5e });
  const allow = makeEntry({ condition: "allow" });
  const deny = { ...makeEntry({ condition: "deny" }), declaration: { ...makeEntry({ condition: "deny" }).declaration, id: "deny" } };
  const unconditional = { ...makeEntry(), declaration: { ...makeEntry().declaration, id: "always" } };

  const context = {
    subjectToken: { id: "rogue" },
    opponentToken: { id: "target" },
    activity: { id: "weapon-attack", item: { id: "rapier" } },
    transaction: { id: "tx", sneakTargetUuid: "Scene.s.Token.target" },
    parentWorkflow: { id: "parent", activity: { uuid: "Item.rapier.Activity.attack" } }
  };
  const result = service.evaluateAll([allow, deny, unconditional], context);

  assert.equal(result.ok, true);
  assert.deepEqual(result.eligible.map(entry => entry.declaration.id), ["fixture-option", "always"]);
  assert.deepEqual(result.ineligible.map(entry => entry.declaration.id), ["deny"]);
  assert.equal(calls.length, 2, "unconditional declarations must not call AC5E");
  assert.equal(calls[0].context.transactionId, "tx");
  assert.equal(calls[0].context.sneakTargetUuid, "Scene.s.Token.target");
  assert.equal(calls[0].context.parentWorkflowId, "parent");
});

test("Sneak Attack activity resolver accepts only stable Activity identifiers and enforces type integrity", () => {
  const trip = { id: "abc", uuid: "Item.feature.Activity.abc", name: "Trip Display Name", identifier: "trip", type: "save" };
  const misleadingName = { id: "def", uuid: "Item.feature.Activity.def", name: "not-the-id", identifier: "other", type: "utility" };
  const item = {
    documentName: "Item",
    uuid: "Actor.rogue.Item.feature",
    system: { activities: activityCollection([trip, misleadingName]) }
  };
  const catSpell = { getActivityByIdentifier: () => null, getStatus: () => ({ active: true }) };
  const service = new SneakAttackActivityService({ activities: { getStats: () => ({}) }, catSpell });

  const good = service.resolve(item, { activityIdentifier: "trip", activityType: "save" });
  assert.equal(good.resolved, true);
  assert.equal(good.activity, trip);

  const noNameFallback = service.resolve(item, { activityIdentifier: "Trip Display Name" });
  assert.equal(noNameFallback.resolved, false);
  assert.equal(noNameFallback.reason, "activity-identifier-unavailable");

  const noIdFallback = service.resolve(item, { activityIdentifier: "abc" });
  assert.equal(noIdFallback.resolved, false);
  assert.equal(noIdFallback.reason, "activity-identifier-unavailable");

  const wrongType = service.resolve(item, { activityIdentifier: "trip", activityType: "damage" });
  assert.equal(wrongType.resolved, false);
  assert.equal(wrongType.reason, "activity-type-mismatch");
  assert.equal(wrongType.actualType, "save");
});

test("Sneak Attack activity resolver rejects ambiguous stable identifiers", () => {
  const a = { id: "a", uuid: "Item.feature.Activity.a", identifier: "trip", type: "save" };
  const b = { id: "b", uuid: "Item.feature.Activity.b", identifier: "trip", type: "save" };
  const item = { documentName: "Item", uuid: "Item.feature", system: { activities: activityCollection([a, b]) } };
  const service = new SneakAttackActivityService({ activities: { getStats: () => ({}) }, catSpell: { getStatus: () => ({}) } });
  const result = service.resolve(item, { activityIdentifier: "trip" });
  assert.equal(result.resolved, false);
  assert.equal(result.reason, "activity-identifier-ambiguous");
  assert.equal(result.matches.length, 2);
});

test("Sneak Attack activity semantic targets are explicit and transaction-bound", () => {
  const service = new SneakAttackActivityService({ activities: { getStats: () => ({}) }, catSpell: { getStatus: () => ({}) } });
  const parentWorkflow = {
    targets: new Set([{ uuid: "Token.one" }, { uuid: "Token.two" }]),
    hitTargets: new Set([{ uuid: "Token.two" }])
  };
  assert.deepEqual(service.resolveSemanticTargets("sneakTarget", { transaction: { sneakTargetUuid: "Token.sneak" } }).targetUuids, ["Token.sneak"]);
  assert.deepEqual(service.resolveSemanticTargets("sneakTarget", { transaction: { targetUuid: "Token.legacy" } }).targetUuids, ["Token.legacy"], "legacy transaction.targetUuid remains supported");
  assert.deepEqual(service.resolveSemanticTargets("self", { subjectToken: { document: { uuid: "Token.self" } } }).targetUuids, ["Token.self"]);
  assert.deepEqual(service.resolveSemanticTargets("parentTargets", { parentWorkflow }).targetUuids, ["Token.one", "Token.two"]);
  assert.deepEqual(service.resolveSemanticTargets("parentHitTargets", { parentWorkflow }).targetUuids, ["Token.two"]);
  assert.equal(service.resolveSemanticTargets("unknown", {}).resolved, false);
});

test("Sneak Attack activity execution translates resource/dialog policy, parent linkage, semantic target and transaction identity", async () => {
  const trip = { id: "trip-id", uuid: "Actor.rogue.Item.feature.Activity.trip-id", identifier: "trip", type: "save" };
  const item = {
    documentName: "Item",
    uuid: "Actor.rogue.Item.feature",
    system: { activities: activityCollection([trip]) }
  };
  const entry = makeEntry({ activity: "trip", activityType: "save", target: "sneakTarget", consume: false, configure: false });
  entry.provenance.sourceItem = item;
  let execution = null;
  const activities = {
    async execute(request) {
      execution = request;
      return {
        executed: true,
        workflowId: "child-workflow",
        failedSaves: ["Scene.test.Token.target"],
        damageList: []
      };
    },
    getStats: () => ({ executions: 1 })
  };
  const catSpell = { getActivityByIdentifier: () => trip, getStatus: () => ({ active: true }) };
  const service = new SneakAttackActivityService({ activities, catSpell });
  const outcome = await service.execute(entry, {
    transaction: { id: "tx-123", sneakTargetUuid: "Scene.test.Token.target" },
    parentWorkflow: { id: "parent-workflow", activity: { uuid: "Actor.rogue.Item.rapier.Activity.attack" } }
  });

  assert.equal(outcome.executed, true);
  assert.deepEqual(execution.targetTokenUuids, ["Scene.test.Token.target"]);
  assert.equal(execution.activityReference, "trip");
  assert.equal(execution.itemUuid, item.uuid);
  assert.equal(execution.idempotencyKey, "tx-123:fixture-option");
  assert.equal(execution.options.consumeUsage, false);
  assert.equal(execution.options.consumeResources, false);
  assert.equal(execution.options.spellSlot, false);
  assert.equal(execution.options.fast, undefined);
  assert.equal(execution.options.options.configureDialog, false);
  assert.equal(execution.options.options.workflowOptions.triggeringWorkflowId, "parent-workflow");
  assert.equal(execution.options.options.workflowOptions.triggeringActivityUuid, "Actor.rogue.Item.rapier.Activity.attack");
  assert.deepEqual(execution.options.options.workflowOptions.ae5eSneakAttack, {
    transactionId: "tx-123",
    declarationId: "fixture-option"
  });
  assert.equal(outcome.resolvedActivity.identifier, "trip");
  assert.equal(outcome.semanticTarget, "sneakTarget");
});


test("Phase C transaction snapshots feed Phase B eligibility and semantic targeting without aliases", () => {
  const turns = new SneakAttackTurnTrackerService();
  const transactions = new SneakAttackTransactionService({ turns });
  const actor = {
    uuid: "Actor.rogue",
    getFlag: () => null
  };
  const subjectToken = { uuid: "Scene.test.Token.rogue", actor };
  const targetUuid = "Scene.test.Token.target";
  const created = transactions.create({
    actor,
    subjectToken,
    sneakTargetUuid: targetUuid,
    combat: null,
    id: "tx-phase-e-contract"
  });

  assert.equal(created.created, true);
  assert.equal(created.transaction.sneakTargetUuid, targetUuid);
  assert.equal(created.transaction.targetUuid, undefined, "transaction model intentionally exposes sneakTargetUuid, not a synthetic targetUuid alias");

  const calls = [];
  const eligibility = new SneakAttackEligibilityService({
    ac5e: {
      evaluateCondition(request) {
        calls.push(request);
        return { ok: true, eligible: true, reason: null, result: true };
      },
      getStatus: () => ({ active: true }),
      getStats: () => ({})
    }
  });
  const entry = makeEntry({ condition: "allow" });
  const eligible = eligibility.evaluate(entry, {
    subjectToken,
    opponentToken: { uuid: targetUuid, actor: { uuid: "Actor.target" } },
    transaction: created.transaction
  });
  assert.equal(eligible.eligible, true);
  assert.equal(calls[0].context.sneakTargetUuid, targetUuid);

  const activities = new SneakAttackActivityService({
    activities: { getStats: () => ({}) },
    catSpell: { getStatus: () => ({}) }
  });
  const targetResolution = activities.resolveSemanticTargets("sneakTarget", {
    transaction: created.transaction
  });
  assert.equal(targetResolution.resolved, true);
  assert.deepEqual(targetResolution.targetUuids, [targetUuid]);
});
