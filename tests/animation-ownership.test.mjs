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

test("transient suppression claim matches only the requested Item Activity", () => {
  const service = new AnimationOwnershipService();
  const item = { documentName: "Item", id: "unarmed", uuid: "Actor.hero.Item.unarmed", name: "Unarmed Strike" };
  const attack = { id: "attack", uuid: `${item.uuid}.Activity.attack`, name: "Attack", parent: item };
  const shove = { id: "shove", uuid: `${item.uuid}.Activity.shove`, name: "Shove", parent: item };

  const claim = service.claimAutomatedAnimationsSuppression({ item, activity: attack, reason: "Unarmed Strike Attack" });
  try {
    const matching = service.resolveAutomatedAnimationsPolicySync({
      item: { documentName: "Item", id: item.id, uuid: item.uuid, name: item.name },
      activity: { id: attack.id, uuid: attack.uuid, name: attack.name }
    });
    assert.equal(matching.suppress, true);
    assert.equal(matching.relation, "transient-workflow");
    assert.equal(matching.claimId, claim.id);
    assert.equal(matching.reason, "Unarmed Strike Attack");

    const sibling = service.resolveAutomatedAnimationsPolicySync({
      item: { documentName: "Item", id: item.id, uuid: item.uuid, name: item.name },
      activity: { id: shove.id, uuid: shove.uuid, name: shove.name }
    });
    assert.equal(sibling.suppress, false);
  } finally {
    claim.release();
  }

  assert.equal(service.getStats().activeTransientClaims, 0);
});

test("transient suppression does not persist flags onto Item or Activity documents", () => {
  const service = new AnimationOwnershipService();
  const item = { documentName: "Item", id: "plain-item", uuid: "Actor.hero.Item.plain-item", flags: { keep: true } };
  const activity = { id: "plain-activity", uuid: `${item.uuid}.Activity.plain-activity`, parent: item, flags: { keep: true } };

  const claim = service.claimAutomatedAnimationsSuppression({ item, activity });
  claim.release();

  assert.deepEqual(item.flags, { keep: true });
  assert.deepEqual(activity.flags, { keep: true });
});

test("withAutomatedAnimationsSuppressed cleans up after success and failure", async () => {
  const service = new AnimationOwnershipService();
  const item = { documentName: "Item", id: "scope-item", uuid: "Actor.hero.Item.scope-item" };
  const activity = { id: "scope-activity", uuid: `${item.uuid}.Activity.scope-activity`, parent: item };

  const value = await service.withAutomatedAnimationsSuppressed({ item, activity }, async () => {
    assert.equal(service.getStats().activeTransientClaims, 1);
    return 42;
  });
  assert.equal(value, 42);
  assert.equal(service.getStats().activeTransientClaims, 0);

  await assert.rejects(
    service.withAutomatedAnimationsSuppressed({ item, activity }, async () => {
      assert.equal(service.getStats().activeTransientClaims, 1);
      throw new Error("expected failure");
    }),
    /expected failure/
  );
  assert.equal(service.getStats().activeTransientClaims, 0);
});

test("AA adapter suppresses a matching transient workflow without requiring persistent flags", () => {
  const service = new AnimationOwnershipService();
  const adapter = new AutomatedAnimationsAdapter({ ownership: service });
  const item = { documentName: "Item", id: "runtime-item", uuid: "Actor.hero.Item.runtime-item", name: "Runtime Item", flags: {} };
  const activity = { id: "runtime-activity", uuid: `${item.uuid}.Activity.runtime-activity`, name: "Runtime Activity", parent: item, flags: {} };

  const claim = service.claimAutomatedAnimationsSuppression({ item, activity, reason: "runtime test" });
  try {
    const data = {
      item: { documentName: "Item", id: item.id, uuid: item.uuid, name: item.name, flags: {} },
      activity: { id: activity.id, uuid: activity.uuid, name: activity.name, flags: {} }
    };
    const result = adapter.processWorkflowStart(data, null);
    assert.equal(result.suppress, true);
    assert.equal(data.stopWorkflow, true);
    assert.equal(data.actionEffects5e.animationOwnership.relation, "transient-workflow");
    assert.equal(data.actionEffects5e.animationOwnership.claimId, claim.id);
    assert.equal(data.actionEffects5e.animationOwnership.transient, true);
  } finally {
    claim.release();
  }
});

test("AA adapter can match transient workflow identity supplied by animationData context", () => {
  const service = new AnimationOwnershipService();
  const adapter = new AutomatedAnimationsAdapter({ ownership: service });
  const item = { documentName: "Item", id: "context-item", uuid: "Actor.hero.Item.context-item" };
  const activity = { id: "context-activity", uuid: `${item.uuid}.Activity.context-activity`, parent: item };

  const claim = service.claimAutomatedAnimationsSuppression({ item, activity });
  try {
    const data = {};
    const animationData = {
      item: { documentName: "Item", id: item.id, uuid: item.uuid },
      activity: { id: activity.id, uuid: activity.uuid }
    };
    adapter.processWorkflowStart(data, animationData);
    assert.equal(data.stopWorkflow, true);
    assert.equal(data.actionEffects5e.animationOwnership.relation, "transient-workflow");
  } finally {
    claim.release();
  }
});
