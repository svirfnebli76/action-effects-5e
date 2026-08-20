import {
  ANIMATION_AUTOMATED_ANIMATIONS_POLICIES,
  ANIMATION_FLAG_KEY,
  MODULE_ID
} from "../core/constants.js";

function makeEffect({ id, name, actor = null, statuses = [], suppress = false, origin = null } = {}) {
  return {
    documentName: "ActiveEffect",
    id,
    uuid: actor ? `${actor.uuid}.ActiveEffect.${id}` : `ActiveEffect.${id}`,
    name,
    parent: actor,
    statuses: new Set(statuses),
    origin,
    flags: suppress ? {
      [MODULE_ID]: {
        [ANIMATION_FLAG_KEY]: {
          automatedAnimations: ANIMATION_AUTOMATED_ANIMATIONS_POLICIES.SUPPRESS
        }
      }
    } : {}
  };
}

function makeActor(id) {
  return {
    documentName: "Actor",
    id,
    uuid: `Actor.${id}`,
    effects: []
  };
}

export class AnimationOwnershipTestSuite {
  #ownership;
  #automatedAnimations;

  constructor({ ownership, automatedAnimations }) {
    this.#ownership = ownership;
    this.#automatedAnimations = automatedAnimations;
  }

  async runFoundationTest({ notify = true } = {}) {
    const checks = [];
    const record = (name, passed, details = null) => checks.push({ name, passed: Boolean(passed), details });

    const ownerActor = makeActor("animation-owner-test");
    const entangled = makeEffect({
      id: "entangled",
      name: "Entangled",
      actor: ownerActor,
      statuses: ["restrained"],
      suppress: true
    });
    const restrained = makeEffect({
      id: "restrained",
      name: "Restrained",
      actor: ownerActor,
      statuses: ["restrained"]
    });
    ownerActor.effects = [entangled, restrained];

    const direct = this.#ownership.resolveAutomatedAnimationsPolicySync(entangled);
    record("Direct suppress flag is recognized", direct.suppress && direct.relation === "explicit", direct);

    const childStatus = this.#ownership.resolveAutomatedAnimationsPolicySync({
      item: restrained,
      activeEffect: true,
      token: { actor: ownerActor }
    });
    record(
      "Child Restrained status inherits Entangled suppression",
      childStatus.suppress && childStatus.relation === "status-owner" && childStatus.inheritedByStatuses?.includes("restrained"),
      childStatus
    );

    const unrelatedActor = makeActor("animation-unrelated-test");
    const unrelatedRestrained = makeEffect({
      id: "restrained-unrelated",
      name: "Restrained",
      actor: unrelatedActor,
      statuses: ["restrained"]
    });
    unrelatedActor.effects = [unrelatedRestrained];
    const unrelated = this.#ownership.resolveAutomatedAnimationsPolicySync({
      item: unrelatedRestrained,
      activeEffect: true,
      token: { actor: unrelatedActor }
    });
    record("Unrelated Restrained status remains available to AA", !unrelated.suppress, unrelated);

    const originChild = makeEffect({
      id: "origin-child",
      name: "Origin Child",
      actor: ownerActor,
      origin: entangled
    });
    const originDecision = this.#ownership.resolveAutomatedAnimationsPolicySync(originChild);
    record("Object origin chain inherits suppression", originDecision.suppress && originDecision.relation === "origin", originDecision);

    const templateItem = {
      documentName: "Item",
      id: "template-item",
      uuid: "Item.template-item",
      name: "Template Item",
      flags: entangled.flags
    };
    const templateEffect = makeEffect({ id: "template-effect", name: "Template Effect" });
    templateEffect.parent = templateItem;
    const parentDecision = this.#ownership.resolveAutomatedAnimationsPolicySync(templateEffect);
    record("Item-owned Active Effect inherits Item policy", parentDecision.suppress && parentDecision.relation === "parent-item", parentDecision);

    const childData = { name: "Stamped Child", flags: {} };
    this.#ownership.inheritAutomatedAnimationsPolicy(templateEffect, childData);
    record(
      "Inheritance helper stamps effective Item-owned policy",
      childData.flags?.[MODULE_ID]?.[ANIMATION_FLAG_KEY]?.automatedAnimations === ANIMATION_AUTOMATED_ANIMATIONS_POLICIES.SUPPRESS,
      childData.flags
    );

    const directWorkflow = { item: entangled, activeEffect: true };
    this.#automatedAnimations.processWorkflowStart(directWorkflow, null);
    record("AA workflow is stopped immediately for explicit suppression", directWorkflow.stopWorkflow === true, directWorkflow.actionEffects5e);

    const childWorkflow = {
      item: restrained,
      activeEffect: true,
      token: { actor: ownerActor }
    };
    this.#automatedAnimations.processWorkflowStart(childWorkflow, null);
    record(
      "AA workflow is stopped immediately for inherited child status suppression",
      childWorkflow.stopWorkflow === true && childWorkflow.actionEffects5e?.animationOwnership?.relation === "status-owner",
      childWorkflow.actionEffects5e
    );

    const normalWorkflow = { item: unrelatedRestrained, activeEffect: true, token: { actor: unrelatedActor } };
    this.#automatedAnimations.processWorkflowStart(normalWorkflow, null);
    if (Array.isArray(normalWorkflow.deferrals)) await Promise.allSettled(normalWorkflow.deferrals);
    record("AA workflow is not stopped when no ownership rule applies", normalWorkflow.stopWorkflow !== true, normalWorkflow);

    const passed = checks.every((check) => check.passed);
    const result = {
      passed,
      checks,
      ownership: this.#ownership.getStats(),
      automatedAnimations: this.#automatedAnimations.getStats()
    };

    console.groupCollapsed(`AE5E animation ownership foundation: ${passed ? "PASS" : "FAIL"}`);
    console.table(checks.map(({ name, passed }) => ({ check: name, result: passed ? "PASS" : "FAIL" })));
    console.log(result);
    console.groupEnd();
    console.log(`%cAE5E 0.4.1.5 — ANIMATION OWNERSHIP FOUNDATION — ${passed ? "PASS" : "FAIL"}`, `font-size:24px;font-weight:bold;color:${passed ? "#5cff8d" : "#ff5c5c"};`);

    if (notify && globalThis.ui?.notifications) {
      const message = `AE5E animation ownership foundation: ${checks.filter((check) => check.passed).length}/${checks.length} ${passed ? "PASS" : "FAIL"}`;
      if (passed) ui.notifications.info(message);
      else ui.notifications.error(message);
    }

    return result;
  }
}
