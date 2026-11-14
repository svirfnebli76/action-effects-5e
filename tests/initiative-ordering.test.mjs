import assert from "node:assert/strict";
import test from "node:test";

import { InitiativeOrderingService } from "../scripts/initiative/ordering-service.js";

const MODULE_ID = "action-effects-5e";
const link = (leaderCombatantId, order) => ({
  version: 1,
  relation: "after",
  leaderCombatantId,
  batchId: "batch",
  order,
  source: "summon"
});
const combatant = (id, initiative, initiativeLink = null) => ({
  id,
  initiative,
  flags: initiativeLink ? { [MODULE_ID]: { initiativeLink } } : {}
});
const combat = entries => ({ combatants: new Map(entries.map(entry => [entry.id, entry])) });
const native = (left, right) =>
  Number(right.initiative ?? -Infinity) - Number(left.initiative ?? -Infinity)
  || String(left.id).localeCompare(String(right.id));
const sortedIds = entries => {
  const encounter = combat(entries);
  const service = new InitiativeOrderingService();
  return [...entries].sort((left, right) => service.compare(encounter, left, right, native)).map(entry => entry.id);
};

test("same-initiative followers remain immediately after their leader in placement order", () => {
  const caster = combatant("B-caster", 18);
  const first = combatant("A-first", 18, link(caster.id, 0));
  const second = combatant("C-second", 18, link(caster.id, 1));
  const unrelated = combatant("Z-unrelated", 18);
  assert.deepEqual(sortedIds([second, unrelated, first, caster]), [
    "B-caster", "A-first", "C-second", "Z-unrelated"
  ]);
});

test("nested followers stay inside the leader block before later siblings", () => {
  const caster = combatant("caster", 20);
  const first = combatant("first", 20, link(caster.id, 0));
  const child = combatant("child", 20, link(first.id, 0));
  const second = combatant("second", 20, link(caster.id, 1));
  assert.deepEqual(sortedIds([second, child, caster, first]), ["caster", "first", "child", "second"]);
});

test("different root blocks retain native initiative and tie ordering", () => {
  const earlyRoot = combatant("A-root", 15);
  const earlyFollower = combatant("Z-follower", 15, link(earlyRoot.id, 0));
  const laterRoot = combatant("B-root", 15);
  assert.deepEqual(sortedIds([laterRoot, earlyFollower, earlyRoot]), ["A-root", "Z-follower", "B-root"]);
});

test("missing leaders and cycles fall back to native ordering", () => {
  const orphan = combatant("A-orphan", 10, link("missing", 0));
  const normal = combatant("B-normal", 10);
  assert.deepEqual(sortedIds([normal, orphan]), ["A-orphan", "B-normal"]);

  const first = combatant("A-cycle", 12, link("B-cycle", 0));
  const second = combatant("B-cycle", 12, link("A-cycle", 0));
  assert.deepEqual(sortedIds([second, first]), ["A-cycle", "B-cycle"]);
});
