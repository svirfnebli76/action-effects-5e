import assert from "node:assert/strict";
import test from "node:test";
import { CASTING_PHASES } from "../scripts/casting/casting-phase-service.js";
import { CatSpellAdapter } from "../scripts/integrations/cat-spell-adapter.js";
import { definitions, setup } from "./helpers/metamagic-fixtures.mjs";

const attackDeclaration = {
  ...structuredClone(definitions.distant),
  id: "attack-reroll-probe",
  phases: [CASTING_PHASES.ATTACK_RESOLVED],
  selectionCost: 0,
  execution: { interface: "cat-embedded", name: "Attack Reroll Probe" }
};

const brokerScript = [
  'if (data?.phase === "consumed") return data.respond(document, macroName, true);',
  'if (data?.phase !== "begin") return;',
  'const result = await data.context.begin(document, async ({phase}) => phase === "attack-resolved"',
  '  ? ({outcome:"confirm", selectedIds:["attack-reroll-probe"]})',
  '  : ({outcome:"decline", selectedIds:[]}));',
  'return data.respond(document, macroName, result);'
].join("\n");

const declineBrokerScript = brokerScript.replace(
  '? ({outcome:"confirm", selectedIds:["attack-reroll-probe"]})',
  '? ({outcome:"decline", selectedIds:[]})'
);

const stackingBrokerScript = [
  'if (data?.phase === "consumed") return data.respond(document, macroName, true);',
  'if (data?.phase !== "begin") return;',
  'const result = await data.context.begin(document, async ({phase}) => ({',
  '  outcome:"confirm", selectedIds:[phase === "attack-resolved" ? "attack-reroll-probe" : "distant-spell"]',
  '}));',
  'return data.respond(document, macroName, result);'
].join("\n");

const optionScript = [
  'if (document.uuid !== data.sourceItemUuid || macroName !== data.execution.name) return;',
  'if (data.phase === "offer") return data.respond(document, macroName, {',
  '  eligible:true, dicePreview:{label:"Attack roll:", dice:[{faces:20,value:7,color:"#7a66ef"}]}',
  '});',
  'if (data.phase === "select") return data.respond(document, macroName, {',
  '  outcome:"confirm", payload:{dieIndex:0,resultIndex:0}',
  '});',
  'if (data.phase === "apply") return data.respond(document, macroName, {',
  '  attackRollMutation:{operation:"reroll-die", dieIndex:data.context.payload.dieIndex, resultIndex:data.context.payload.resultIndex}',
  '});'
].join("\n");

function fakeDie(values, replacements, { keep = null, selected = 0 } = {}) {
  const results = values.map((result, index) => ({
    result,
    active: keep ? index === selected : true,
    ...(keep && index !== selected ? { discarded: true } : {}),
    hidden: true
  }));
  return {
    faces: 20,
    modifiers: keep ? [keep] : [],
    results,
    replacements: [...replacements],
    async roll() {
      const replacement = { result: this.replacements.shift(), active: true, hidden: false };
      this.results.push(replacement);
      return replacement;
    },
    async _evaluateModifiers() {
      if (!keep) return;
      const candidates = this.results.filter(result => result.rerolled !== true);
      const chosen = candidates.reduce((best, result) => {
        if (!best) return result;
        return keep === "kh"
          ? (result.result > best.result ? result : best)
          : (result.result < best.result ? result : best);
      }, null);
      for (const result of candidates) {
        result.active = result === chosen;
        if (result === chosen) delete result.discarded;
        else result.discarded = true;
      }
    }
  };
}

function fakeRoll(die, bonus = 8) {
  return {
    formula: `1d20 + ${bonus}`,
    dice: [die],
    _total: die.results.find(result => result.active !== false).result + bonus,
    get total() { return this._total; },
    _evaluateTotal() {
      return this.dice.flatMap(entry => entry.results)
        .filter(result => result.active !== false)
        .reduce((sum, result) => sum + result.result, bonus);
    }
  };
}

function attackFixture({
  values = [7],
  replacements = [12],
  keep = null,
  selected = 0,
  resultIndex = 0,
  broker = brokerScript,
  failCheck = false
} = {}) {
  const adapter = new CatSpellAdapter();
  const f = setup({ catSpell: adapter });
  f.main.flags.cat.embeddedMacros[0].macros[0].macro = broker;
  const option = f.add("attack", [attackDeclaration]);
  f.install(option, "Attack Reroll Probe", "option", optionScript.replace("resultIndex:0", `resultIndex:${resultIndex}`));
  f.setChooser(async () => null);
  const die = fakeDie(values, replacements, { keep, selected });
  const roll = fakeRoll(die);
  const target = { uuid: "Scene.scene.Token.target", actor: { uuid: "Actor.target" } };
  f.workflow.targets = new Set([target]);
  f.workflow.hitTargets = new Set();
  f.workflow.attackRoll = roll;
  f.workflow.attackTotal = roll.total;
  f.workflow.setAttackRollCalls = 0;
  f.workflow.checkHitsCalls = 0;
  f.workflow.setAttackRoll = async next => {
    f.workflow.setAttackRollCalls += 1;
    f.workflow.attackRoll = next;
    f.workflow.attackTotal = next.total;
  };
  f.workflow.checkHits = async options => {
    f.workflow.checkHitsCalls += 1;
    assert.equal(options.noTargetOnUseMacro, true);
    assert.equal(f.workflow.workflowOptions.noProvokeReaction, true);
    if (failCheck) throw new Error("hit reassessment failed");
    f.workflow.hitTargets = f.workflow.attackTotal >= 15 ? new Set([target]) : new Set();
  };
  return { ...f, adapter, option, die, roll, target };
}

test("attack-resolved broker rerolls one d20, preserves history, and reassesses the hit", async () => {
  const previousMidiQOL = globalThis.MidiQOL;
  let f;
  try {
    f = attackFixture();
    const presented = [];
    globalThis.MidiQOL = {
      async displayDSNForRoll(roll, type, _mode, _save, actor) {
        assert.equal(type, "attackRollD20");
        assert.equal(actor, f.actor);
        presented.push(roll.dice[0].results.filter(result => result.hidden !== true).map(result => result.result));
        for (const die of roll.dice) for (const result of die.results) result.hidden = true;
      }
    };
    await f.service.begin(f.workflow);
    const rollIdentity = f.roll;
    const dieIdentity = f.die;
    const original = f.die.results[0];

    await f.service.late(f.workflow, CASTING_PHASES.ATTACK_RESOLVED);

    assert.equal(f.workflow.attackRoll, rollIdentity);
    assert.equal(f.workflow.attackRoll.dice[0], dieIdentity);
    assert.deepEqual(f.die.results.map(result => result.result), [7, 12]);
    assert.deepEqual({ active: original.active, rerolled: original.rerolled }, { active: false, rerolled: true });
    assert.equal(f.roll.total, 20);
    assert.deepEqual([...f.workflow.hitTargets], [f.target]);
    assert.deepEqual(presented, [[12]]);
    assert.equal(f.pool.system.uses.value, 3);
    assert.equal(f.service.get(f.workflow).lateSelection.phase, CASTING_PHASES.ATTACK_RESOLVED);
    assert.equal(f.adapter.getStats().attackDieRerollCalls, 1);
  } finally {
    globalThis.MidiQOL = previousMidiQOL;
  }
});

test("attack-resolved offers preserve Item-owned structured dice previews", async () => {
  const f = attackFixture();
  await f.service.begin(f.workflow);
  const inspection = await f.service.inspectPhaseOffers(f.workflow, CASTING_PHASES.ATTACK_RESOLVED);
  assert.deepEqual(inspection.offers[0].dicePreview, {
    label: "Attack roll:",
    dice: [{ faces: 20, value: 7, color: "#7a66ef" }]
  });
});

test("advantage or disadvantage may reroll an inactive d20 and reapplies native keep modifiers", async () => {
  const previousMidiQOL = globalThis.MidiQOL;
  try {
    globalThis.MidiQOL = {
      async displayDSNForRoll(roll) {
        for (const die of roll.dice) for (const result of die.results) result.hidden = true;
      }
    };
    const f = attackFixture({ values: [16, 4], replacements: [19], keep: "kh", selected: 0, resultIndex: 1 });
    f.workflow.attackTotal = f.roll.total;
    await f.service.begin(f.workflow);

    await f.service.late(f.workflow, CASTING_PHASES.ATTACK_RESOLVED);

    assert.deepEqual(f.die.results.map(result => result.result), [16, 4, 19]);
    assert.equal(f.die.results[1].rerolled, true);
    assert.equal(f.die.results[1].active, false);
    assert.equal(f.die.results[0].active, false);
    assert.equal(f.die.results[2].active, true);
    assert.equal(f.roll.total, 27);
  } finally {
    globalThis.MidiQOL = previousMidiQOL;
  }
});

test("the same attack event is deduplicated, while a later attack may be offered after an earlier decline", async () => {
  const f = attackFixture({ broker: declineBrokerScript });
  await f.service.begin(f.workflow);

  await f.service.late(f.workflow, CASTING_PHASES.ATTACK_RESOLVED);
  await f.service.late(f.workflow, CASTING_PHASES.ATTACK_RESOLVED);
  assert.equal(f.calls.filter(call => call.kind === "broker" && call.phase === "begin").length, 2);

  const laterDie = fakeDie([5], [18]);
  f.workflow.attackRoll = fakeRoll(laterDie);
  f.workflow.attackTotal = f.workflow.attackRoll.total;
  await f.service.late(f.workflow, CASTING_PHASES.ATTACK_RESOLVED);
  assert.equal(f.calls.filter(call => call.kind === "broker" && call.phase === "begin").length, 3);
  assert.equal(f.pool.system.uses.value, 4);
});

test("after a late attack option is used it is not offered on a later attack in the same casting", async () => {
  const previousMidiQOL = globalThis.MidiQOL;
  try {
    globalThis.MidiQOL = {
      async displayDSNForRoll(roll) {
        for (const die of roll.dice) for (const result of die.results) result.hidden = true;
      }
    };
    const f = attackFixture();
    await f.service.begin(f.workflow);
    await f.service.late(f.workflow, CASTING_PHASES.ATTACK_RESOLVED);

    f.workflow.attackRoll = fakeRoll(fakeDie([3], [20]));
    f.workflow.attackTotal = f.workflow.attackRoll.total;
    await f.service.late(f.workflow, CASTING_PHASES.ATTACK_RESOLVED);

    assert.equal(f.calls.filter(call => call.kind === "broker" && call.phase === "begin").length, 2);
    assert.equal(f.pool.system.uses.value, 3);
  } finally {
    globalThis.MidiQOL = previousMidiQOL;
  }
});

test("a zero-selection-cost attack option remains available after one ordinary Metamagic selection", async () => {
  const previousMidiQOL = globalThis.MidiQOL;
  try {
    globalThis.MidiQOL = {
      async displayDSNForRoll(roll) {
        for (const die of roll.dice) for (const result of die.results) result.hidden = true;
      }
    };
    const f = attackFixture({ broker: stackingBrokerScript });
    await f.service.begin(f.workflow);
    assert.equal(f.consume(), 1);

    const preview = await f.service.inspectPhaseOffers(f.workflow, CASTING_PHASES.ATTACK_RESOLVED);
    assert.equal(preview.selectionUsed, 1);
    assert.equal(preview.selectionRemaining, 0);
    assert.equal(preview.offers.find(option => option.id === "attack-reroll-probe").disabled, false);

    await f.service.late(f.workflow, CASTING_PHASES.ATTACK_RESOLVED);
    assert.deepEqual(f.service.get(f.workflow).selected.map(option => option.id), [
      "distant-spell",
      "attack-reroll-probe"
    ]);
    assert.equal(f.pool.system.uses.value, 2);
  } finally {
    globalThis.MidiQOL = previousMidiQOL;
  }
});

test("invalid attack-die selection is rejected before payment", async () => {
  const f = attackFixture({ resultIndex: 99 });
  await f.service.begin(f.workflow);
  await assert.rejects(
    f.service.late(f.workflow, CASTING_PHASES.ATTACK_RESOLVED),
    /invalid attack-die selection/
  );
  assert.equal(f.pool.system.uses.value, 4);
  assert.deepEqual(f.die.results.map(result => result.result), [7]);
});

test("hit reassessment failure restores attack history, total, and payment", async () => {
  const f = attackFixture({ failCheck: true });
  const originalResults = [...f.die.results];
  await f.service.begin(f.workflow);

  await assert.rejects(
    f.service.late(f.workflow, CASTING_PHASES.ATTACK_RESOLVED),
    /Sorcery Points were restored.*hit reassessment failed/
  );

  assert.deepEqual(f.die.results, originalResults);
  assert.deepEqual(f.die.results.map(result => ({ ...result })), [
    { result: 7, active: true, hidden: true }
  ]);
  assert.equal(f.roll.total, 15);
  assert.equal(f.pool.system.uses.value, 4);
  assert.equal(f.service.get(f.workflow).lateRefundStatus, "refunded-after-application-failure");
});

test("hitsChecked pauses for attack-resolved options and fails open for ActivityOverTime", async () => {
  const handlers = new Map();
  const previousHooks = globalThis.Hooks;
  const previousMidiQOL = globalThis.MidiQOL;
  globalThis.Hooks = {
    on(name, callback) { handlers.set(name, callback); return name; },
    off(name) { handlers.delete(name); }
  };
  let f;
  try {
    globalThis.MidiQOL = {
      async displayDSNForRoll(roll) {
        for (const die of roll.dice) for (const result of die.results) result.hidden = true;
      }
    };
    f = attackFixture();
    f.service.initialize();
    await f.service.begin(f.workflow);
    assert.equal(await handlers.get("midi-qol.hitsChecked")(f.workflow), true);
    assert.equal(f.pool.system.uses.value, 3);

    const overTime = attackFixture();
    overTime.workflow.workflowOptions = { overTimeEffectUuid: "Actor.target.ActiveEffect.effect" };
    await overTime.service.begin(overTime.workflow);
    assert.equal(await handlers.get("midi-qol.hitsChecked")(overTime.workflow), true);
    assert.equal(overTime.pool.system.uses.value, 4);
  } finally {
    f?.service.shutdown();
    globalThis.Hooks = previousHooks;
    globalThis.MidiQOL = previousMidiQOL;
  }
});
