import assert from "node:assert/strict";
import test from "node:test";
import { CASTING_PHASES } from "../scripts/casting/casting-phase-service.js";
import { CatSpellAdapter } from "../scripts/integrations/cat-spell-adapter.js";
import { definitions, setup } from "./helpers/metamagic-fixtures.mjs";

const damageDeclaration = {
  ...structuredClone(definitions.distant),
  id: "damage-probe",
  phases: [CASTING_PHASES.DAMAGE_MUTABLE],
  execution: { interface: "cat-embedded", name: "Damage Probe" }
};

const brokerScript = [
  'if (data?.phase === "consumed") return data.respond(document, macroName, true);',
  'if (data?.phase !== "begin") return;',
  'const result = await data.context.begin(document, async ({phase}) => phase === "damage-mutable"',
  '  ? ({outcome:"confirm", selectedIds:["damage-probe"]})',
  '  : ({outcome:"decline", selectedIds:[]}));',
  'return data.respond(document, macroName, result);'
].join("\n");

const optionScript = [
  'if (document.uuid !== data.sourceItemUuid || macroName !== data.execution.name) return;',
  'if (data.phase === "offer") return data.respond(document, macroName, {eligible:true});',
  'if (data.phase === "select") return data.respond(document, macroName, {',
  '  outcome:"confirm", payload:{damageType:"cold", indexes:[0]}',
  '});',
  'if (data.phase === "apply") return data.respond(document, macroName, {',
  '  damageRollMutation:{operation:"retag", damageType:data.context.payload.damageType, indexes:data.context.payload.indexes}',
  '});'
].join("\n");

const rerollScript = [
  'if (document.uuid !== data.sourceItemUuid || macroName !== data.execution.name) return;',
  'if (data.phase === "offer") return data.respond(document, macroName, {eligible:true});',
  'if (data.phase === "select") return data.respond(document, macroName, {',
  '  outcome:"confirm", payload:{dice:[',
  '    {rollIndex:0, dieIndex:0, resultIndex:0},',
  '    {rollIndex:1, dieIndex:0, resultIndex:0}',
  '  ]}',
  '});',
  'if (data.phase === "apply") return data.respond(document, macroName, {',
  '  damageRollMutation:{operation:"reroll-dice", dice:data.context.payload.dice}',
  '});'
].join("\n");

function fakeDie(results, replacements, faces = 10) {
  return {
    faces,
    results: results.map(result => ({ result, active: true })),
    replacements: [...replacements],
    async roll() {
      const replacement = { result: this.replacements.shift(), active: true };
      this.results.push(replacement);
      return replacement;
    }
  };
}

function fakeRoll(dice, type) {
  return {
    formula: dice.map(die => `${die.results.length}d${die.faces}`).join(" + "),
    options: { type },
    dice,
    _total: dice.flatMap(die => die.results).reduce((sum, result) => sum + result.result, 0),
    get total() { return this._total; },
    _evaluateTotal() {
      return this.dice.flatMap(die => die.results)
        .filter(result => result.active !== false)
        .reduce((sum, result) => sum + result.result, 0);
    }
  };
}

function damageFixture({ failCommit = false } = {}) {
  const f = setup({ catSpell: new CatSpellAdapter() });
  f.main.flags.cat.embeddedMacros[0].macros[0].macro = brokerScript;
  const option = f.add("damage", [damageDeclaration]);
  f.install(option, "Damage Probe", "option", optionScript);
  f.setChooser(async () => null);
  const roll = { formula: "2d6[fire]", total: 7, options: { type: "fire" } };
  f.workflow.damageRolls = [roll];
  f.workflow.setDamageRolls = async rolls => {
    if (failCommit) throw new Error("damage commit failed");
    f.workflow.damageRolls = rolls;
  };
  return { ...f, roll };
}

function rerollFixture({ failCommit = false, script = rerollScript } = {}) {
  const f = setup({ catSpell: new CatSpellAdapter() });
  f.main.flags.cat.embeddedMacros[0].macros[0].macro = brokerScript;
  const option = f.add("damage", [damageDeclaration]);
  f.install(option, "Damage Probe", "option", script);
  f.setChooser(async () => null);
  const fire = fakeRoll([fakeDie([8, 2], [1])], "fire");
  const cold = fakeRoll([fakeDie([6], [4], 6)], "cold");
  f.workflow.damageRolls = [fire, cold];
  f.workflow.setDamageRolls = async rolls => {
    if (failCommit) throw new Error("damage commit failed");
    f.workflow.damageRolls = rolls;
  };
  return { ...f, fire, cold };
}

test("damage-mutable broker retags existing damage rolls without rerolling or double charging", async () => {
  const handlers = new Map();
  const previous = globalThis.Hooks;
  globalThis.Hooks = {
    on(name, callback) { handlers.set(name, callback); return name; },
    off(name) { handlers.delete(name); }
  };
  let f;
  try {
    f = damageFixture();
    f.service.initialize();
    await f.service.begin(f.workflow);
    await f.service.late(f.workflow, CASTING_PHASES.SAVES_READY);

    const rollIdentity = f.roll;
    const damageHook = handlers.get("midi-qol.preDamageRollComplete");
    assert.equal(await damageHook(f.workflow), true);
    assert.equal(await damageHook(f.workflow), true);

    const record = f.service.get(f.workflow);
    assert.equal(f.workflow.damageRolls[0], rollIdentity);
    assert.equal(f.roll.formula, "2d6[fire]");
    assert.equal(f.roll.total, 7);
    assert.equal(f.roll.options.type, "cold");
    assert.equal(f.pool.system.uses.value, 3);
    assert.equal(record.lateSelection.phase, CASTING_PHASES.DAMAGE_MUTABLE);
    assert.equal(record.lateSelections.length, 1);
    assert.deepEqual(record.selected.map(entry => entry.id), ["damage-probe"]);
    assert.equal(f.calls.filter(call => call.kind === "broker" && call.phase === "begin").length, 2);
  } finally {
    f?.service.shutdown();
    globalThis.Hooks = previous;
  }
});

test("invalid damage-mutable application is rejected before payment", async () => {
  const f = damageFixture();
  const option = f.actor.items.get("damage");
  f.install(option, "Damage Probe", "option", optionScript.replace('indexes:data.context.payload.indexes', 'indexes:[99]'));
  await f.service.begin(f.workflow);

  await assert.rejects(
    f.service.late(f.workflow, CASTING_PHASES.DAMAGE_MUTABLE),
    /invalid damage-roll indexes/
  );
  assert.equal(f.pool.system.uses.value, 4);
  assert.equal(f.roll.options.type, "fire");
});

test("damage roll commit failure restores the original type and late payment", async () => {
  const f = damageFixture({ failCommit: true });
  await f.service.begin(f.workflow);

  await assert.rejects(
    f.service.late(f.workflow, CASTING_PHASES.DAMAGE_MUTABLE),
    /Sorcery Points were restored.*damage commit failed/
  );
  assert.equal(f.pool.system.uses.value, 4);
  assert.equal(f.roll.options.type, "fire");
  assert.equal(f.service.get(f.workflow).lateRefundStatus, "refunded-after-application-failure");
});

test("damage-mutable broker rerolls only selected dice and preserves discarded result history", async () => {
  const f = rerollFixture();
  await f.service.begin(f.workflow);
  const fireIdentity = f.fire;
  const coldIdentity = f.cold;
  const originalFire = f.fire.dice[0].results[0];
  const originalCold = f.cold.dice[0].results[0];

  await f.service.late(f.workflow, CASTING_PHASES.DAMAGE_MUTABLE);

  assert.equal(f.workflow.damageRolls[0], fireIdentity);
  assert.equal(f.workflow.damageRolls[1], coldIdentity);
  assert.deepEqual(f.fire.dice[0].results.map(result => result.result), [8, 2, 1]);
  assert.deepEqual(f.cold.dice[0].results.map(result => result.result), [6, 4]);
  assert.deepEqual({ active: originalFire.active, rerolled: originalFire.rerolled }, { active: false, rerolled: true });
  assert.deepEqual({ active: originalCold.active, rerolled: originalCold.rerolled }, { active: false, rerolled: true });
  assert.equal(f.fire.total, 3);
  assert.equal(f.cold.total, 4);
  assert.equal(f.pool.system.uses.value, 3);
});

test("invalid selected damage die is rejected before payment", async () => {
  const f = rerollFixture({
    script: rerollScript.replace('{rollIndex:1, dieIndex:0, resultIndex:0}', '{rollIndex:1, dieIndex:0, resultIndex:99}')
  });
  await f.service.begin(f.workflow);

  await assert.rejects(
    f.service.late(f.workflow, CASTING_PHASES.DAMAGE_MUTABLE),
    /invalid damage-die selections/
  );
  assert.equal(f.pool.system.uses.value, 4);
  assert.deepEqual(f.fire.dice[0].results.map(result => result.result), [8, 2]);
  assert.equal(f.fire.total, 10);
});

test("damage die commit failure restores result identity, history, total, and late payment", async () => {
  const f = rerollFixture({ failCommit: true });
  const originalFireResults = [...f.fire.dice[0].results];
  const originalColdResults = [...f.cold.dice[0].results];
  await f.service.begin(f.workflow);

  await assert.rejects(
    f.service.late(f.workflow, CASTING_PHASES.DAMAGE_MUTABLE),
    /Sorcery Points were restored.*damage commit failed/
  );
  assert.deepEqual(f.fire.dice[0].results, originalFireResults);
  assert.deepEqual(f.cold.dice[0].results, originalColdResults);
  assert.deepEqual(f.fire.dice[0].results.map(result => ({ ...result })), [
    { result: 8, active: true },
    { result: 2, active: true }
  ]);
  assert.deepEqual(f.cold.dice[0].results.map(result => ({ ...result })), [{ result: 6, active: true }]);
  assert.equal(f.fire.total, 10);
  assert.equal(f.cold.total, 6);
  assert.equal(f.pool.system.uses.value, 4);
  assert.equal(f.service.get(f.workflow).lateRefundStatus, "refunded-after-application-failure");
});

test("zero-selection-cost late option remains available after an ordinary Metamagic selection", async () => {
  const f = setup({ catSpell: new CatSpellAdapter() });
  f.main.flags.cat.embeddedMacros[0].macros[0].macro = [
    'if (data?.phase === "consumed") return data.respond(document, macroName, true);',
    'if (data?.phase !== "begin") return;',
    'const result = await data.context.begin(document, async ({phase}) => phase === "damage-mutable"',
    '  ? ({outcome:"confirm", selectedIds:["damage-probe"]})',
    '  : ({outcome:"confirm", selectedIds:["distant-spell"]}));',
    'return data.respond(document, macroName, result);'
  ].join("\n");
  const damage = f.add("damage", [{ ...damageDeclaration, selectionCost: 0 }]);
  const blocked = f.add("blocked", [{
    ...damageDeclaration,
    id: "blocked-probe",
    execution: { interface: "cat-embedded", name: "Blocked Probe" }
  }]);
  f.add("extra-choice", [definitions.extraChoice]);
  f.install(damage, "Damage Probe", "option", optionScript);
  f.install(blocked, "Blocked Probe", "option", optionScript);
  const roll = { formula: "2d6[fire]", total: 7, options: { type: "fire" } };
  f.workflow.damageRolls = [roll];
  f.workflow.setDamageRolls = async rolls => { f.workflow.damageRolls = rolls; };
  await f.service.begin(f.workflow);
  assert.equal(f.consume(), 1);

  const preview = await f.service.inspectPhaseOffers(f.workflow, CASTING_PHASES.DAMAGE_MUTABLE);
  assert.equal(preview.selectionUsed, 1);
  assert.equal(preview.selectionRemaining, 0);
  assert.equal(preview.offers.find(option => option.id === "damage-probe").disabled, false);
  assert.equal(preview.offers.find(option => option.id === "blocked-probe").disabled, true);

  await f.service.late(f.workflow, CASTING_PHASES.DAMAGE_MUTABLE);
  assert.deepEqual(f.service.get(f.workflow).selected.map(option => option.id), ["distant-spell", "damage-probe"]);
  assert.equal(f.pool.system.uses.value, 2);
  assert.equal(roll.options.type, "cold");
});

test("late payment includes only options whose Item-owned selection confirms", async () => {
  const f = setup({ catSpell: new CatSpellAdapter() });
  f.main.flags.cat.embeddedMacros[0].macros[0].macro = [
    'if (data?.phase === "consumed") return data.respond(document, macroName, true);',
    'if (data?.phase !== "begin") return;',
    'const result = await data.context.begin(document, async ({phase}) => phase === "damage-mutable"',
    '  ? ({outcome:"confirm", selectedIds:["damage-probe","declined-probe"]})',
    '  : ({outcome:"decline", selectedIds:[]}));',
    'return data.respond(document, macroName, result);'
  ].join("\n");
  const damage = f.add("damage", [damageDeclaration]);
  const declined = f.add("declined", [{
    ...damageDeclaration,
    id: "declined-probe",
    selectionCost: 0,
    execution: { interface: "cat-embedded", name: "Declined Probe" }
  }]);
  f.add("extra-choice", [definitions.extraChoice]);
  f.install(damage, "Damage Probe", "option", optionScript);
  f.install(declined, "Declined Probe", "option", [
    'if (document.uuid !== data.sourceItemUuid || macroName !== data.execution.name) return;',
    'if (data.phase === "offer") return data.respond(document, macroName, {eligible:true});',
    'if (data.phase === "select") return data.respond(document, macroName, {outcome:"decline"});'
  ].join("\n"));
  const roll = { formula: "2d6[fire]", total: 7, options: { type: "fire" } };
  f.workflow.damageRolls = [roll];
  f.workflow.setDamageRolls = async rolls => { f.workflow.damageRolls = rolls; };
  f.setChooser(async () => null);
  await f.service.begin(f.workflow);

  await f.service.late(f.workflow, CASTING_PHASES.DAMAGE_MUTABLE);

  assert.deepEqual(f.service.get(f.workflow).selected.map(option => option.id), ["damage-probe"]);
  assert.equal(f.service.get(f.workflow).lateSelection.totalCost, 1);
  assert.equal(f.pool.system.uses.value, 3);
});

test("damage hook fails open for ActivityOverTime workflows without opening the broker", async () => {
  const handlers = new Map();
  const previous = globalThis.Hooks;
  globalThis.Hooks = {
    on(name, callback) { handlers.set(name, callback); return name; },
    off(name) { handlers.delete(name); }
  };
  try {
    const f = damageFixture();
    f.service.initialize();
    const overTime = { ...f.workflow, workflowOptions: { overTimeEffectUuid: "Actor.target.ActiveEffect.effect" } };
    assert.equal(await handlers.get("midi-qol.preDamageRollComplete")(overTime), true);
    assert.equal(f.calls.length, 0);
    assert.equal(f.pool.system.uses.value, 4);
  } finally {
    globalThis.Hooks = previous;
  }
});
