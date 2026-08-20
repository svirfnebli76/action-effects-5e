import assert from "node:assert/strict";
import test from "node:test";

import { AnimationOwnershipService } from "../scripts/animations/animation-ownership-service.js";
import { AutomatedAnimationsAdapter } from "../scripts/integrations/automated-animations-adapter.js";
import { MODULE_ID } from "../scripts/core/constants.js";

function actor(id) {
  return { documentName: "Actor", id, uuid: `Actor.${id}`, effects: [] };
}

function effect({ id, name, parent = null, statuses = [], suppress = false, origin = null } = {}) {
  return {
    documentName: "ActiveEffect",
    id,
    uuid: parent ? `${parent.uuid}.ActiveEffect.${id}` : `ActiveEffect.${id}`,
    name,
    parent,
    statuses: new Set(statuses),
    origin,
    flags: suppress ? {
      [MODULE_ID]: {
        animation: { automatedAnimations: "suppress" }
      }
    } : {}
  };
}

test("animation ownership suppresses an explicitly flagged Active Effect", () => {
  const service = new AnimationOwnershipService();
  const entangled = effect({ id: "entangled", name: "Entangled", suppress: true });
  const decision = service.resolveAutomatedAnimationsPolicySync(entangled);
  assert.equal(decision.suppress, true);
  assert.equal(decision.policy, "suppress");
  assert.equal(decision.relation, "explicit");
});

test("child status inherits suppression only from a same-actor suppressing status owner", () => {
  const service = new AnimationOwnershipService();
  const target = actor("target");
  const entangled = effect({ id: "entangled", name: "Entangled", parent: target, statuses: ["restrained"], suppress: true });
  const restrained = effect({ id: "restrained", name: "Restrained", parent: target, statuses: ["restrained"] });
  target.effects = [entangled, restrained];

  const inherited = service.resolveAutomatedAnimationsPolicySync({ item: restrained, activeEffect: true, token: { actor: target } });
  assert.equal(inherited.suppress, true);
  assert.equal(inherited.relation, "status-owner");
  assert.deepEqual(inherited.inheritedByStatuses, ["restrained"]);

  const other = actor("other");
  const unrelatedRestrained = effect({ id: "other-restrained", name: "Restrained", parent: other, statuses: ["restrained"] });
  other.effects = [unrelatedRestrained];
  const unrelated = service.resolveAutomatedAnimationsPolicySync({ item: unrelatedRestrained, token: { actor: other } });
  assert.equal(unrelated.suppress, false);
});

test("AA-cloned child status can recover its live Actor by UUID", () => {
  const service = new AnimationOwnershipService();
  const target = actor("uuid-recovery");
  const entangled = effect({ id: "entangled-live", name: "Entangled", parent: target, statuses: ["restrained"], suppress: true });
  const restrained = effect({ id: "restrained-live", name: "Restrained", parent: target, statuses: ["restrained"] });
  target.effects = [entangled, restrained];

  // Model the AA workflow-start payload after deep cloning: the ActiveEffect
  // retains serializable data and UUID, but not its live Actor parent.
  const clonedRestrained = {
    documentName: "ActiveEffect",
    id: restrained.id,
    uuid: restrained.uuid,
    name: restrained.name,
    statuses: ["restrained"],
    flags: {}
  };

  const previousFromUuidSync = globalThis.fromUuidSync;
  globalThis.fromUuidSync = (uuid) => uuid === restrained.uuid ? restrained : null;
  try {
    const decision = service.resolveAutomatedAnimationsPolicySync({ item: clonedRestrained, activeEffect: true });
    assert.equal(decision.suppress, true);
    assert.equal(decision.relation, "status-owner");
    assert.deepEqual(decision.inheritedByStatuses, ["restrained"]);
  } finally {
    globalThis.fromUuidSync = previousFromUuidSync;
  }
});

test("Item-owned effect templates inherit animation ownership from their source Item", () => {
  const service = new AnimationOwnershipService();
  const item = {
    documentName: "Item",
    id: "item",
    uuid: "Item.item",
    flags: { [MODULE_ID]: { animation: { automatedAnimations: "suppress" } } }
  };
  const template = effect({ id: "template", name: "Entangled" });
  template.parent = item;

  const decision = service.resolveAutomatedAnimationsPolicySync(template);
  assert.equal(decision.suppress, true);
  assert.equal(decision.relation, "parent-item");
});

test("AA adapter uses 7.0.22 deferrals for asynchronous UUID-origin ownership", async () => {
  const service = new AnimationOwnershipService();
  const adapter = new AutomatedAnimationsAdapter({ ownership: service });
  const owner = effect({ id: "owner", name: "Owner", suppress: true });
  const child = effect({ id: "child", name: "Child", origin: owner.uuid });

  const previousFromUuid = globalThis.fromUuid;
  const previousFromUuidSync = globalThis.fromUuidSync;
  globalThis.fromUuidSync = undefined;
  globalThis.fromUuid = async (uuid) => uuid === owner.uuid ? owner : null;

  try {
    const data = { item: child, activeEffect: true };
    const result = adapter.processWorkflowStart(data, null);
    assert.ok(result instanceof Promise);
    assert.equal(data.stopWorkflow, undefined);
    assert.equal(data.deferrals.length, 1);
    await Promise.allSettled(data.deferrals);
    assert.equal(data.stopWorkflow, true);
    assert.equal(data.actionEffects5e.animationOwnership.relation, "origin");
  } finally {
    globalThis.fromUuid = previousFromUuid;
    globalThis.fromUuidSync = previousFromUuidSync;
  }
});

test("inheritance helper stamps effective Item-owned policy without replacing other flags", () => {
  const service = new AnimationOwnershipService();
  const ownerItem = {
    documentName: "Item",
    id: "owner-item",
    uuid: "Item.owner-item",
    flags: { [MODULE_ID]: { animation: { automatedAnimations: "suppress" } } }
  };
  const template = effect({ id: "owner-template", name: "Owner Template" });
  template.parent = ownerItem;
  const data = { flags: { other: { keep: true } } };

  service.inheritAutomatedAnimationsPolicy(template, data);
  assert.equal(data.flags.other.keep, true);
  assert.equal(data.flags[MODULE_ID].animation.automatedAnimations, "suppress");
});
