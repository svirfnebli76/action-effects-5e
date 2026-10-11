import assert from "node:assert/strict";
import test from "node:test";
import { ActivityCardService, effectOutcome, movementOutcome, saveOutcome } from "../scripts/chat/activity-card-service.js";

const MODULE = "action-effects-5e";
function fixture(data = {}) {
  const token = { document: { uuid: "Scene.S.Token.T", id: "T" }, actor: { statuses: new Set(), effects: [] } };
  const message = {
    id: "M", isOwner: true, flags: {}, speaker: { alias: "Source" },
    async setFlag(namespace, key, value) { this.flags[namespace] = { [key]: value }; },
    async unsetFlag(namespace, key) { delete this.flags[namespace][key]; }
  };
  const workflow = {
    id: "W", item: { uuid: "Actor.A.Item.I", img: "item.webp" },
    activity: { name: "Topple", flags: { [MODULE]: { activityCard: {
      schema: 1, enabled: true, title: "Example — Topple", kind: "save",
      status: "prone", nativeStatus: true, effectName: "Carrier", result: "Prone", ...data
    } } } },
    targets: new Set([token]), saves: new Set(), failedSaves: new Set([token]),
    saveDisplayData: [{ target: token, saveSymbol: "fa-xmark" }], chatCard: message,
    actor: { name: "Source" }, damageRolls: [], workflowOptions: {}
  };
  globalThis.game = { messages: new Map([["M", message]]) };
  globalThis.canvas = { scene: { grid: { units: "ft" } } };
  return { workflow, token, message };
}

test("initial failedSaves membership is not evidence of a completed save", () => {
  const { workflow, token } = fixture();
  workflow.saveDisplayData = [];
  assert.equal(saveOutcome(workflow, token), "unresolved");
  workflow.saveDisplayData = [{ target: token, saveSymbol: "fa-xmark" }];
  assert.equal(saveOutcome(workflow, token), "failed");
  workflow.saves.add(token);
  assert.equal(saveOutcome(workflow, token), "passed");
});

test("failed save alone does not confirm an effect; immunity requires actual status", () => {
  const data = { result: "Poisoned", status: "poisoned" };
  assert.equal(effectOutcome(null, { status: false, effects: [{ uuid: "E" }] }, data, "failed"), "Poisoned was not confirmed.");
  assert.equal(effectOutcome(null, { status: true, effects: [] }, data, "failed"), "Poisoned was not confirmed.");
  assert.equal(effectOutcome(null, { status: true, effects: [{ uuid: "E" }] }, data, "passed"), "Resisted this attempt.");
});

test("Topple confirms native prone even though its carrier was deleted", async () => {
  const service = new ActivityCardService();
  const { workflow, token, message } = fixture();
  await service.capture(workflow);
  token.actor.statuses.add("prone");
  const rolls = workflow.damageRolls;
  await service.complete(workflow);
  assert.equal(message.flags[MODULE].activityCard.targets[0].result, "Prone.");
  assert.equal(workflow.damageRolls, rolls);
  assert.deepEqual(token.actor.effects, []);
});

test("pre-existing prone is described without claiming a new application", async () => {
  const service = new ActivityCardService();
  const { workflow, token, message } = fixture();
  token.actor.statuses.add("prone");
  await service.capture(workflow);
  await service.complete(workflow);
  assert.equal(message.flags[MODULE].activityCard.targets[0].result, "Prone (already present).");
});

test("completion waits for async native prone, then snapshots it", async () => {
  const service = new ActivityCardService();
  const { workflow, token, message } = fixture();
  await service.capture(workflow);
  setTimeout(() => token.actor.statuses.add("prone"), 35);
  await service.complete(workflow);
  assert.equal(message.flags[MODULE].activityCard.targets[0].result, "Prone.");
});

test("save reroll invalidates the old snapshot while a new result is pending", async () => {
  const service = new ActivityCardService();
  const { workflow, token, message } = fixture();
  token.actor.statuses.add("prone");
  await service.complete(workflow);
  await service.capture(workflow);
  assert.equal(message.flags[MODULE].activityCard, undefined);
  workflow.saves.add(token);
  await service.complete(workflow);
  assert.equal(message.flags[MODULE].activityCard.targets[0].result, "Resisted this attempt.");
});

test("Stagger confirms the source effect; unrelated effects of the same name do not count", async () => {
  const service = new ActivityCardService();
  const { workflow, token, message } = fixture({ nativeStatus: false, status: undefined, effectName: "Staggered", result: "Staggered", duration: "until next turn ends" });
  token.actor.effects.push({ name: "Staggered", uuid: "Other", origin: "Actor.B.Item.Other", duration: {} });
  await service.capture(workflow);
  token.actor.effects.push({ name: "Staggered", uuid: "Right", origin: workflow.item.uuid, duration: {} });
  await service.complete(workflow);
  assert.equal(message.flags[MODULE].activityCard.targets[0].result, "Staggered — until next turn ends.");
});

test("unconfigured, aborted and unowned workflows leave the native card intact", async () => {
  const service = new ActivityCardService();
  const { workflow, message } = fixture();
  workflow.aborted = true;
  assert.equal((await service.complete(workflow)).updated, false);
  workflow.aborted = false;
  message.isOwner = false;
  assert.equal((await service.complete(workflow)).updated, false);
  message.isOwner = true;
  workflow.activity.flags = {};
  assert.equal((await service.complete(workflow)).updated, false);
  assert.deepEqual(message.flags, {});
});

test("movement presentation reports actual outcomes and uses caller-owned completion text", () => {
  assert.equal(movementOutcome({ status: "cancelled" }), "Movement cancelled.");
  assert.equal(movementOutcome({ status: "no-movement" }), "No movement taken.");
  assert.match(movementOutcome({ status: "failed" }), /did not complete/);
  assert.match(movementOutcome({ status: "completed", cost: 15, allowance: 20 }, "ft"), /15 \/ 20 ft/);
  assert.doesNotMatch(movementOutcome({ status: "completed", cost: 15, allowance: 20 }, "ft"), /opportunity/i);
  assert.match(movementOutcome({ status: "completed", cost: 15, allowance: 20 }, "ft", { completedText: "Caller-owned detail." }), /Caller-owned detail/);
  assert.doesNotMatch(movementOutcome({ status: "cancelled" }, "ft", { completedText: "Caller-owned detail." }), /Caller-owned detail/);
});

test("hooks register once; render failures cannot cancel a workflow", () => {
  const hooks = [];
  globalThis.Hooks = { on: (name, fn) => hooks.push([name, fn]) };
  const service = new ActivityCardService();
  service.initialize();
  service.initialize();
  assert.deepEqual(hooks.map(([name]) => name), ["midi-qol.preCheckSaves", "dnd5e.renderChatMessage"]);
});

test("explicit control completion does not hide an unresolved or unconfirmed effect", async () => {
  const service = new ActivityCardService();
  const { workflow, token, message } = fixture();
  workflow.saveDisplayData = [];
  await service.complete(workflow, { controlsResolved: true });
  assert.equal(message.flags[MODULE].activityCard.controlsResolved, false);
  workflow.saveDisplayData = [{ target: token, saveSymbol: "fa-xmark" }];
  await service.complete(workflow, { controlsResolved: true });
  assert.equal(message.flags[MODULE].activityCard.controlsResolved, false);
  token.actor.statuses.add("prone");
  await service.complete(workflow, { controlsResolved: true });
  assert.equal(message.flags[MODULE].activityCard.controlsResolved, true);
  await service.complete(workflow);
  assert.equal(message.flags[MODULE].activityCard.controlsResolved, false);
});
