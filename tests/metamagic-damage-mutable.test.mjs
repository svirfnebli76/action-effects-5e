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
