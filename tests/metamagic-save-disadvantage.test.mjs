import test from "node:test";
import assert from "node:assert/strict";
import { setup, scope } from "./helpers/metamagic-fixtures.mjs";
import { SaveDisadvantageService } from "../scripts/metamagic/save-disadvantage-service.js";

const saveKey = "flags.automated-conditions-5e.save.disadvantage";
const target = id => ({
  id,
  document: { id, uuid: `Scene.test.Token.${id}`, disposition: -1 },
  actor: { uuid: `Actor.${id}`, effects: [] }
});
const modifiers = workflow => globalThis.cat.utils.workflowUtils.getWorkflowProperty(workflow, "rollModifiers") ?? {};

function catUtils() {
  const state = new WeakMap();
  return {
    getWorkflowProperty(workflow, key) { return state.get(workflow)?.[key]; },
    setWorkflowProperty(workflow, key, value) { state.set(workflow, { ...state.get(workflow), [key]: value }); },
    grantRollModifier(workflow, type, id, identifier, display) {
      const values = this.getWorkflowProperty(workflow, "rollModifiers") ?? {};
      (values[id] ??= []).push({ type, identifier, display });
      this.setWorkflowProperty(workflow, "rollModifiers", values);
    }
  };
}

function fixture() {
  const f = setup({ available: 4 });
  game.modules.set("automated-conditions-5e", { active: true });
  globalThis.cat = { utils: { workflowUtils: catUtils() } };
  const chosen = target("chosen");
  const other = target("other");
  f.workflow.targets = f.workflow.hitTargets = new Set([chosen, other]);
  f.workflow.itemCardUuid = "ChatMessage.cast";
  f.activity.type = "save";
  f.activity.save = { ability: new Set(["wis"]) };
  f.main.flags.cat.embeddedMacros[0].macros[0].macro = [
    'if (data.phase !== "begin") return;',
    'return data.respond(document, macroName, await data.context.begin(document, async ({phase, offers}) =>',
    'phase === "saves-ready" && offers.some(o => o.id === "save-disadvantage-probe" && !o.disabled)',
    '? {outcome:"confirm", selectedIds:["save-disadvantage-probe"]} : {outcome:"decline"}));'
  ].join("\n");
  const option = f.add("save-disadvantage", [{
    id: "save-disadvantage-probe",
    type: "option",
    cost: 2,
    selectionCost: 1,
    tooltip: "Choose one affected target.",
    phases: ["saves-ready"],
    acquisition: "learned",
    execution: { interface: "cat-embedded", name: "Save Disadvantage Probe" }
  }]);
  option.name = "Save Disadvantage Probe";
  f.install(option, "Save Disadvantage Probe", "option", [
    'if (document.uuid !== data.sourceItemUuid || macroName !== data.execution.name) return;',
    'if (data.phase === "offer") return data.respond(document, macroName, {eligible:true});',
    'if (data.phase === "select") return data.respond(document, macroName, {outcome:"confirm",payload:{targetTokenUuid:"Scene.test.Token.chosen"}});',
    'if (data.phase === "apply") return data.respond(document, macroName, {saveDisadvantage:{tokenUuids:[data.context.payload.targetTokenUuid],persistence:"ac5e-itemLimited",label:"Save Disadvantage"}});'
  ].join("\n"));
  const documents = new Map();
  globalThis.fromUuid = async uuid => documents.get(uuid) ?? null;
  return { ...f, chosen, other, documents };
}

function effect(f, id, { actor = f.chosen.actor, message = "ChatMessage.cast",
  activity = `${f.original.uuid}.Activity.activity` } = {}) {
  const value = {
    uuid: `${actor.uuid}.ActiveEffect.${id}`,
    parent: actor,
    isOwner: true,
    changes: [],
    flags: {},
    origin: activity,
    system: { origin: { activity, message } },
    async update(updates) {
      if (updates.changes) this.changes = structuredClone(updates.changes);
      const key = `flags.${scope}.saveDisadvantage`;
      if (updates[key]) this.flags[scope] = { saveDisadvantage: structuredClone(updates[key]) };
    }
  };
  actor.effects.push(value);
  f.documents.set(value.uuid, value);
  return value;
}

test("late declarative application gives ordinary disadvantage only to the selected target", async () => {
  const f = fixture();
  await f.service.begin(f.workflow);
  await f.service.late(f.workflow);
  assert.equal(f.pool.system.uses.value, 2);
  assert.equal(modifiers(f.workflow).chosen[0].type, "dis");
  assert.equal(modifiers(f.workflow).chosen[0].display, "Save Disadvantage");
  assert.equal(modifiers(f.workflow).other, undefined);
});

test("modifier application failure removes its partial change and restores the late debit", async () => {
  const f = fixture();
  const utils = cat.utils.workflowUtils;
  const grant = utils.grantRollModifier;
  utils.grantRollModifier = function(...args) {
    grant.apply(this, args);
    throw new Error("injected application failure");
  };
  await f.service.begin(f.workflow);
  await assert.rejects(f.service.late(f.workflow));
  assert.equal(f.pool.system.uses.value, 4);
  assert.deepEqual(modifiers(f.workflow).chosen, []);
  assert.equal(f.service.get(f.workflow).lateRefundStatus, "refunded-after-application-failure");
});

test("only the selected target's new effect receives AC5E itemLimited and AE5E metadata", async () => {
  const f = fixture();
  const existing = effect(f, "existing");
  await f.service.begin(f.workflow);
  await f.service.late(f.workflow);
  const selected = effect(f, "selected");
  const other = effect(f, "other", { actor: f.other.actor });
  const wrongCast = effect(f, "wrong-cast", { message: "ChatMessage.other" });
  await f.service.complete(f.workflow);
  assert.deepEqual(selected.changes, [{
    key: saveKey,
    type: "custom",
    value: "itemLimited; name=Save Disadvantage"
  }]);
  assert.equal(selected.flags[scope].saveDisadvantage.optionId, "save-disadvantage-probe");
  assert.equal(selected.flags[scope].saveDisadvantage.targetActorUuid, f.chosen.actor.uuid);
  for (const excluded of [existing, other, wrongCast]) assert.equal(excluded.flags[scope], undefined);
});

test("ActivityOverTime bridge uses only its exact stamped effect and target", async () => {
  const f = fixture();
  await f.service.begin(f.workflow);
  await f.service.late(f.workflow);
  const ongoing = effect(f, "ongoing");
  await f.service.complete(f.workflow);
  const repeat = {
    actor: f.chosen.actor,
    item: { id: f.original.id, uuid: `${f.chosen.actor.uuid}.Item.${f.original.id}` },
    activity: { id: "repeat-save" },
    hitTargets: new Set([f.chosen, f.other]),
    workflowOptions: { overTimeEffectUuid: ongoing.uuid }
  };
  const service = new SaveDisadvantageService();
  await service.prepareOverTime(repeat);
  assert.equal(modifiers(repeat).chosen[0].type, "dis");
  assert.equal(modifiers(repeat).other, undefined);

  const unrelated = { ...repeat, workflowOptions: { overTimeEffectUuid: "Actor.chosen.ActiveEffect.other" } };
  await service.prepareOverTime(unrelated);
  assert.deepEqual(modifiers(unrelated), {});
});
