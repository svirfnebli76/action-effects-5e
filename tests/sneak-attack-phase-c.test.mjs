import assert from "node:assert/strict";
import test from "node:test";

let randomCounter = 0;
globalThis.foundry = {
  utils: {
    deepClone: value => structuredClone(value),
    randomID: (length = 16) => String(++randomCounter).padStart(length, "0")
  }
};

import {
  MODULE_ID,
  SNEAK_ATTACK_USAGE_FLAG,
  SNEAK_ATTACK_TRANSACTION_STATES
} from "../scripts/core/constants.js";
import { SneakAttackTurnTrackerService } from "../scripts/sneak-attack/turn-tracker-service.js";
import { SneakAttackTransactionService } from "../scripts/sneak-attack/transaction-service.js";

class FakeActor {
  constructor(uuid = "Actor.rogue") {
    this.uuid = uuid;
    this.flags = {};
    this.setFlagCalls = 0;
  }

  getFlag(scope, key) {
    return this.flags?.[scope]?.[key] ?? null;
  }

  async setFlag(scope, key, value) {
    this.flags[scope] ??= {};
    this.flags[scope][key] = structuredClone(value);
    this.setFlagCalls += 1;
    return value;
  }
}

function combatFixture({ id = "combat-1", round = 1, turn = 0, combatantId = "rogue-turn", actorUuid = "Actor.rogue" } = {}) {
  return {
    id,
    uuid: `Combat.${id}`,
    started: true,
    round,
    turn,
    combatant: {
      id: combatantId,
      actor: { uuid: actorUuid },
      token: { uuid: `Scene.scene.Token.${combatantId}` }
    }
  };
}

function setTurn(combat, { round = combat.round, turn, combatantId, actorUuid }) {
  combat.round = round;
  combat.turn = turn;
  combat.combatant = {
    id: combatantId,
    actor: { uuid: actorUuid },
    token: { uuid: `Scene.scene.Token.${combatantId}` }
  };
}

function optionEntry(id, cost = undefined) {
  return {
    declaration: {
      type: "option",
      id,
      ...(cost === undefined ? {} : { cost })
    },
    provenance: {
      sourceItemIdentifier: `fixture-${id}`,
      sourceItem: { uuid: `Actor.rogue.Item.${id}` }
    }
  };
}

test("Sneak Attack turn keys include combat, round, turn index, and active combatant identity", () => {
  const turns = new SneakAttackTurnTrackerService();
  const combat = combatFixture();

  const first = turns.resolveTurn(combat);
  assert.equal(first.key, "combat-1:1:0:rogue-turn");
  assert.equal(first.combatId, "combat-1");
  assert.equal(first.round, 1);
  assert.equal(first.turn, 0);
  assert.equal(first.combatantId, "rogue-turn");

  setTurn(combat, { turn: 1, combatantId: "enemy-turn", actorUuid: "Actor.enemy" });
  const offTurn = turns.resolveTurn(combat);
  assert.equal(offTurn.key, "combat-1:1:1:enemy-turn");
  assert.notEqual(offTurn.key, first.key);

  setTurn(combat, { round: 2, turn: 0, combatantId: "rogue-turn", actorUuid: "Actor.rogue" });
  const nextRound = turns.resolveTurn(combat);
  assert.equal(nextRound.key, "combat-1:2:0:rogue-turn");
  assert.notEqual(nextRound.key, first.key);
});

test("Sneak Attack usage is once per actual combat turn, including off-turn attacks and round rollover", async () => {
  const turns = new SneakAttackTurnTrackerService();
  const actor = new FakeActor();
  const combat = combatFixture();
  const ownTurn = turns.resolveTurn(combat);

  const first = await turns.commit(actor, { transactionId: "tx-own-1", combat, expectedTurnKey: ownTurn.key });
  assert.equal(first.committed, true);
  assert.equal(first.tracked, true);
  assert.equal(first.duplicate, false);
  assert.equal(turns.inspect(actor, { combat }).available, false);

  const duplicateSameTransaction = await turns.commit(actor, { transactionId: "tx-own-1", combat, expectedTurnKey: ownTurn.key });
  assert.equal(duplicateSameTransaction.committed, true);
  assert.equal(duplicateSameTransaction.duplicate, true);

  const secondOwnAttack = await turns.commit(actor, { transactionId: "tx-own-2", combat, expectedTurnKey: ownTurn.key });
  assert.equal(secondOwnAttack.committed, false);
  assert.equal(secondOwnAttack.reason, "already-committed-this-turn");

  setTurn(combat, { turn: 1, combatantId: "enemy-a", actorUuid: "Actor.enemy-a" });
  const enemyTurn = turns.resolveTurn(combat);
  assert.equal(turns.inspect(actor, { combat }).available, true);

  const reaction = await turns.commit(actor, { transactionId: "tx-reaction-1", combat, expectedTurnKey: enemyTurn.key });
  assert.equal(reaction.committed, true);
  assert.equal(reaction.usage.combatantId, "enemy-a");

  const secondReaction = await turns.commit(actor, { transactionId: "tx-reaction-2", combat, expectedTurnKey: enemyTurn.key });
  assert.equal(secondReaction.committed, false);
  assert.equal(secondReaction.reason, "already-committed-this-turn");

  setTurn(combat, { turn: 2, combatantId: "enemy-b", actorUuid: "Actor.enemy-b" });
  assert.equal(turns.inspect(actor, { combat }).available, true);

  setTurn(combat, { round: 2, turn: 0, combatantId: "rogue-turn", actorUuid: "Actor.rogue" });
  assert.equal(turns.inspect(actor, { combat }).available, true);
});

test("outside combat Sneak Attack commitments are intentionally untracked", async () => {
  const turns = new SneakAttackTurnTrackerService();
  const actor = new FakeActor();

  const state = turns.inspect(actor, { combat: null });
  assert.equal(state.ok, true);
  assert.equal(state.available, true);
  assert.equal(state.tracked, false);
  assert.equal(state.reason, "outside-combat-untracked");

  const commit = await turns.commit(actor, { transactionId: "tx-noncombat", combat: null, expectedTurnKey: null });
  assert.equal(commit.committed, true);
  assert.equal(commit.tracked, false);
  assert.equal(commit.reason, "outside-combat-untracked");
  assert.equal(actor.setFlagCalls, 0);
  assert.equal(actor.getFlag(MODULE_ID, SNEAK_ATTACK_USAGE_FLAG), null);
});

test("transaction state stores target, selections, remaining dice, and child outcomes", () => {
  const turns = new SneakAttackTurnTrackerService();
  const transactions = new SneakAttackTransactionService({ turns });
  const actor = new FakeActor();
  const sourceToken = { uuid: "Scene.scene.Token.rogue", actor };
  const target = { uuid: "Scene.scene.Token.target" };
  const combat = combatFixture();
  const declarations = [optionEntry("trip", 1), optionEntry("withdraw", 1), optionEntry("free")];

  const created = transactions.create({
    actor,
    subjectToken: sourceToken,
    sneakTarget: target,
    parentWorkflow: { id: "parent-1", activity: { uuid: "Item.weapon.Activity.attack" } },
    declarations,
    totalDice: 4,
    combat
  });

  assert.equal(created.created, true);
  assert.equal(created.transaction.sneakTargetUuid, target.uuid);
  assert.equal(created.transaction.parentWorkflowId, "parent-1");
  assert.equal(created.transaction.parentActivityUuid, "Item.weapon.Activity.attack");
  assert.equal(created.transaction.turnKey, "combat-1:1:0:rogue-turn");
  assert.equal(created.transaction.dice.remaining, 4);

  const selected = transactions.setSelections(created.transaction.id, ["trip", "withdraw"], { totalDice: 4 });
  assert.equal(selected.updated, true);
  assert.deepEqual(selected.transaction.selectedDeclarationIds, ["trip", "withdraw"]);
  assert.deepEqual(selected.transaction.dice, { total: 4, spent: 2, remaining: 2 });

  const tooExpensive = transactions.setSelections(created.transaction.id, ["trip", "withdraw"], { totalDice: 1 });
  assert.equal(tooExpensive.updated, false);
  assert.equal(tooExpensive.reason, "insufficient-dice");

  const child = transactions.recordChildOutcome(created.transaction.id, "trip", {
    executed: true,
    failedSaves: ["Actor.target"]
  });
  assert.equal(child.recorded, true);
  assert.equal(child.transaction.childResults.length, 1);
  assert.deepEqual(child.transaction.childResults[0].outcome.failedSaves, ["Actor.target"]);
});

test("Do Not Use closes a transaction without consuming the combat-turn usage", async () => {
  const turns = new SneakAttackTurnTrackerService();
  const transactions = new SneakAttackTransactionService({ turns });
  const actor = new FakeActor();
  const combat = combatFixture();

  const created = transactions.create({ actor, sneakTargetUuid: "Scene.scene.Token.target", combat });
  const declined = transactions.decline(created.transaction.id);
  assert.equal(declined.declined, true);
  assert.equal(declined.transaction.state, SNEAK_ATTACK_TRANSACTION_STATES.DECLINED);
  assert.equal(actor.getFlag(MODULE_ID, SNEAK_ATTACK_USAGE_FLAG), null);
  assert.equal(turns.inspect(actor, { combat }).available, true);

  const lateOk = await transactions.commitOnOk(created.transaction.id, { combat });
  assert.equal(lateOk.committed, false);
  assert.equal(lateOk.reason, "transaction-not-open");
  assert.equal(actor.getFlag(MODULE_ID, SNEAK_ATTACK_USAGE_FLAG), null);
});

test("OK commits immediately and blocks a second Sneak Attack transaction on the same turn", async () => {
  const turns = new SneakAttackTurnTrackerService();
  const transactions = new SneakAttackTransactionService({ turns });
  const actor = new FakeActor();
  const combat = combatFixture();

  const first = transactions.create({ actor, sneakTargetUuid: "Scene.scene.Token.target-a", combat });
  assert.equal(first.transaction.availabilityAtCreation.available, true);
  const committed = await transactions.commitOnOk(first.transaction.id, { combat });
  assert.equal(committed.committed, true);
  assert.equal(committed.transaction.state, SNEAK_ATTACK_TRANSACTION_STATES.COMMITTED);
  assert.equal(committed.usage.tracked, true);
  assert.equal(actor.getFlag(MODULE_ID, SNEAK_ATTACK_USAGE_FLAG).transactionId, first.transaction.id);

  const doubleOk = await transactions.commitOnOk(first.transaction.id, { combat });
  assert.equal(doubleOk.committed, true);
  assert.equal(doubleOk.duplicate, true);

  const second = transactions.create({ actor, sneakTargetUuid: "Scene.scene.Token.target-b", combat });
  assert.equal(second.transaction.availabilityAtCreation.available, false);
  const blocked = await transactions.commitOnOk(second.transaction.id, { combat });
  assert.equal(blocked.committed, false);
  assert.equal(blocked.reason, "already-committed-this-turn");
  assert.equal(blocked.transaction.state, SNEAK_ATTACK_TRANSACTION_STATES.BLOCKED);
});

test("a transaction cannot commit after the authoritative combat turn changes while its dialog is open", async () => {
  const turns = new SneakAttackTurnTrackerService();
  const transactions = new SneakAttackTransactionService({ turns });
  const actor = new FakeActor();
  const combat = combatFixture();

  const created = transactions.create({ actor, sneakTargetUuid: "Scene.scene.Token.target", combat });
  assert.equal(created.transaction.turnKey, "combat-1:1:0:rogue-turn");

  setTurn(combat, { turn: 1, combatantId: "enemy-a", actorUuid: "Actor.enemy-a" });
  const result = await transactions.commitOnOk(created.transaction.id, { combat });
  assert.equal(result.committed, false);
  assert.equal(result.reason, "turn-changed");
  assert.equal(result.transaction.state, SNEAK_ATTACK_TRANSACTION_STATES.BLOCKED);
  assert.equal(actor.getFlag(MODULE_ID, SNEAK_ATTACK_USAGE_FLAG), null);
});

test("a new transaction can commit again on the next creature turn after an earlier turn was spent", async () => {
  const turns = new SneakAttackTurnTrackerService();
  const transactions = new SneakAttackTransactionService({ turns });
  const actor = new FakeActor();
  const combat = combatFixture();

  const own = transactions.create({ actor, sneakTargetUuid: "Scene.scene.Token.a", combat });
  assert.equal((await transactions.commitOnOk(own.transaction.id, { combat })).committed, true);

  setTurn(combat, { turn: 1, combatantId: "enemy-a", actorUuid: "Actor.enemy-a" });
  const reaction = transactions.create({ actor, sneakTargetUuid: "Scene.scene.Token.b", combat });
  assert.equal(reaction.transaction.availabilityAtCreation.available, true);
  const committedReaction = await transactions.commitOnOk(reaction.transaction.id, { combat });
  assert.equal(committedReaction.committed, true);
  assert.equal(committedReaction.usage.usage.combatantId, "enemy-a");
  assert.equal(transactions.getRecent().length, 2);
});
