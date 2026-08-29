import test from "node:test";
import assert from "node:assert/strict";
import { ActionEffects5eApi } from "../scripts/api.js";

function serviceStub() {
  return new Proxy({}, {
    get(target, property) {
      if (property in target) return target[property];
      if (property === "ready") return true;
      return (...args) => ({ property, args });
    }
  });
}

test("public AE5E API exposes the CAT metadata context-menu live test", () => {
  const service = serviceStub();
  const tests = serviceStub();
  const expected = { passed: true, marker: "context-menu" };
  tests.runCatMetadataContextMenuTest = () => expected;
  tests.runCatConfigurationAuthoringTest = () => ({ passed: true, marker: "config-authoring" });

  const api = new ActionEffects5eApi({
    dependencies: service,
    compatibility: service,
    movement: service,
    movementAccounting: service,
    movementSpending: service,
    catMovement: service,
    catSpell: service,
    catAutomationRegistry: service,
    catMetadataAuthoring: service,
    catConfigurationAuthoring: service,
    catMetadataContextMenu: service,
    animationOwnership: service,
    automatedAnimations: service,
    spellModifierRegistry: service,
    spellModifierDiscovery: service,
    spellModifierChoices: service,
    spellModifiers: service,
    spellModifierEvents: service,
    ongoingEffects: service,
    regions: service,
    relationships: service,
    relationshipLifecycle: service,
    relationshipMovement: service,
    relationshipRotation: service,
    relativeRelationships: service,
    relationshipLinkObstructions: service,
    displacement: service,
    displacementBatch: service,
    selectionIndicator: service,
    externalPromptBridge: service,
    choicePrompts: service,
    crosshairs: service,
    reactionRegistry: service,
    reactionAuthority: service,
    reactionDiscovery: service,
    reactionOrdering: service,
    reactionDialogs: service,
    reactionBroker: service,
    reactionEvents: service,
    tests,
    socket: service
  });

  assert.equal(typeof api.tests.runCatMetadataContextMenuTest, "function");
  assert.deepEqual(api.tests.runCatMetadataContextMenuTest(), expected);
  assert.equal(typeof api.tests.runCatConfigurationAuthoringTest, "function");
  assert.equal(typeof api.authoring.cat.openOptionsEditor, "function");
  assert.equal(typeof api.authoring.cat.validateConfigurationData, "function");
  assert.equal(typeof api.authoring.cat.setConfigurationData, "function");
});
