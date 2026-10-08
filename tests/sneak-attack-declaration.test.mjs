import test from "node:test";
import assert from "node:assert/strict";

import {
  MODULE_ID,
  SNEAK_ATTACK_DECLARATION_KEY,
  SNEAK_ATTACK_DECLARATION_SCHEMA_VERSION,
  SNEAK_ATTACK_USAGE_FLAG,
  SNEAK_ATTACK_TRANSACTION_STATES
} from "../scripts/core/constants.js";
import { CatAutomationProviderAdapter } from "../scripts/integrations/cat-automation-provider-adapter.js";
import { SneakAttackDeclarationParser } from "../scripts/sneak-attack/declaration-parser.js";
import { SneakAttackDaeDeclarationService } from "../scripts/sneak-attack/dae-declaration-service.js";
import { SneakAttackDeclarationService } from "../scripts/sneak-attack/declaration-service.js";
import { SneakAttackTransaction } from "../scripts/sneak-attack/transaction.js";

function makeItem(id, { identifier = id, provider = MODULE_ID, name = id } = {}) {
  return {
    id,
    uuid: `Actor.rogue.Item.${id}`,
    documentName: "Item",
    name,
    identifier,
    system: { identifier },
    provider
  };
}

function makeEffect(id, values, { disabled = false, isSuppressed = false, active = true } = {}) {
  return {
    id,
    uuid: `Actor.rogue.ActiveEffect.${id}`,
    name: `Effect ${id}`,
    disabled,
    isSuppressed,
    active,
    system: { changes: values.map((value, index) => ({
      key: SNEAK_ATTACK_DECLARATION_KEY,
      type: "custom",
      phase: "final",
      priority: index,
      value
    })) }
  };
}

function makeFixture({ providerForItem = item => item.provider } = {}) {
  const autoFields = [];
  const itemByEffect = new Map();
  const daeApi = {
    addAutoFields(fields) { autoFields.push(...fields); },
    async resolveItemFromEffect(effect) { return itemByEffect.get(effect) ?? null; }
  };
  const config = { ActiveEffect: { changeTypes: {} } };
  const dae = new SneakAttackDaeDeclarationService({
    daeAccessor: () => daeApi,
    moduleAccessor: () => ({ active: true, version: "14.0.13" })
  });
  const parser = new SneakAttackDeclarationParser();
  const catApi = {
    utils: {
      automationUtils: {
        getCurrentAutomation(item) {
          const source = providerForItem(item);
          return source ? { source, identifier: item.identifier, version: "1.0.0" } : null;
        }
      }
    }
  };
  const catAutomation = new CatAutomationProviderAdapter({
    catAccessor: () => catApi,
    moduleAccessor: () => ({ active: true, version: "0.0.8" })
  });
  const service = new SneakAttackDeclarationService({ dae, parser, catAutomation });
  return { service, dae, parser, catAutomation, itemByEffect, autoFields, config };
}

test("Sneak Attack parser preserves quoted, parenthesized, and escaped delimiters while normalizing known scalar fields", () => {
  const parser = new SneakAttackDeclarationParser();
  const result = parser.parse(
    'schema=1; type=option; id=trip; level=5; cost=1; consume=false; condition="actor.items.some(i => i.name === \'A;B\')"; note=left\\;right; expr=(a;b=c)'
  );

  assert.equal(result.ok, true);
  assert.equal(result.declaration.schema, 1);
  assert.equal(result.declaration.level, 5);
  assert.equal(result.declaration.cost, 1);
  assert.equal(result.declaration.consume, false);
  assert.equal(result.declaration.condition, "actor.items.some(i => i.name === 'A;B')");
  assert.equal(result.declaration.note, "left;right");
  assert.equal(result.declaration.expr, "(a;b=c)");
});

test("Sneak Attack parser fails safely on malformed structure and repeated fields", () => {
  const parser = new SneakAttackDeclarationParser();

  const quote = parser.parse('type=option; id="trip');
  assert.equal(quote.ok, false);
  assert.equal(quote.diagnostics[0].code, "unbalanced-quote");

  const paren = parser.parse("type=option; condition=(actor.level > 3");
  assert.equal(paren.ok, false);
  assert.equal(paren.diagnostics[0].code, "unbalanced-parentheses");

  const duplicate = parser.parse("type=option; id=trip; id=other");
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.diagnostics.some(entry => entry.code === "duplicate-field"), true);
});

test("DAE declaration integration registers the declaration field once without registering a change type", () => {
  const { service, autoFields, config } = makeFixture();
  const previous = globalThis.CONFIG;
  globalThis.CONFIG = config;
  Object.freeze(config.ActiveEffect.changeTypes);
  try {
    const status = service.initialize();
    assert.equal(status.changeType, "custom");
    assert.equal(status.daeAutoFieldRegistered, true);
    assert.equal(status.lastError, null);
    service.initialize();
    assert.deepEqual(autoFields, [SNEAK_ATTACK_DECLARATION_KEY]);
    assert.deepEqual(config.ActiveEffect.changeTypes, {});
  } finally {
    if (previous === undefined) delete globalThis.CONFIG;
    else globalThis.CONFIG = previous;
  }
});

test("v14 scanner uses system.changes exclusively and never reads legacy mode or the deprecated changes accessor", () => {
  const { dae } = makeFixture();
  const effect = makeEffect("v14", ["schema=1;type=option;id=trip"]);
  Object.defineProperty(effect, "changes", { get() { throw new Error("Deprecated changes accessed"); } });
  Object.defineProperty(effect.system.changes[0], "mode", { get() { throw new Error("Legacy mode accessed"); } });
  const records = dae.scanActor({ appliedEffects: [effect] });
  assert.equal(records.length, 1);
  assert.equal(records[0].snapshot.change.type, "custom");
  assert.equal(records[0].snapshot.change.phase, "final");
  assert.equal("mode" in records[0].snapshot.change, false);
  assert.deepEqual(dae.scanActor({ appliedEffects: [{ changes: effect.system.changes }] }), []);
});

test("v14 scanner rejects non-custom, missing, numeric, and abandoned AE5E types without a mode fallback", async () => {
  const { service, itemByEffect } = makeFixture();
  for (const type of ["add", "multiply", "override", "upgrade", "downgrade", "AE5E",
    "action-effects-5e.ae5e", "action-effects-5e.sneakAttackDeclaration", "Custom", 0, null, undefined]) {
    const effect = makeEffect("rejected", ["schema=1;type=option;id=trip"]);
    const change = effect.system.changes[0];
    if (type === undefined) delete change.type;
    else change.type = type;
    change.mode = 0;
    itemByEffect.set(effect, makeItem("cunning-strike"));
    const result = await service.compileActor({ appliedEffects: [effect] });
    assert.equal(result.summary.scanned, 0, String(type));
    assert.deepEqual(result.declarations, [], String(type));
  }
  const wrongKey = makeEffect("wrong-key", ["schema=1;type=option;id=trip"]);
  wrongKey.system.changes[0].key = "flags.action-effects-5e.other";
  assert.deepEqual(service.scanActor({ appliedEffects: [wrongKey] }), []);
});

test("Custom Cunning Strike Trip, Poison, and Withdraw retain provenance and Improved Cunning Strike enforces max-selections=2", async () => {
  const { service, itemByEffect } = makeFixture();
  const cunning = makeEffect("cunning-strike", [
    "schema=1;type=option;id=trip;level=5;order=10;cost=1;executor=activity;activity=trip;target=sneakTarget",
    "schema=1;type=option;id=poison;level=5;order=20;cost=1;executor=activity;activity=poison;target=sneakTarget",
    "schema=1;type=option;id=withdraw;level=5;order=30;cost=1;executor=activity;activity=withdraw;target=subjectToken"
  ]);
  const improved = makeEffect("improved-cunning-strike", [
    "schema=1;type=rule;id=max-selections;level=11;value=2"
  ]);
  itemByEffect.set(cunning, makeItem("cunning-strike"));
  itemByEffect.set(improved, makeItem("improved-cunning-strike"));
  const actor = { uuid: "Actor.rogue", appliedEffects: [improved, cunning] };
  const result = await service.compileActor(actor);
  assert.equal(result.ok, true);
  assert.deepEqual(result.declarations.map(entry => entry.declaration.id),
    ["trip", "poison", "withdraw", "max-selections"]);
  for (const entry of result.declarations.slice(0, 3)) {
    assert.equal(entry.declaration.activity, entry.declaration.id);
    assert.equal(entry.declaration.cost, 1);
    assert.equal(entry.provenance.sourceItemIdentifier, "cunning-strike");
    assert.equal(entry.transport.change.type, "custom");
  }
  assert.equal(result.declarations[2].declaration.target, "subjectToken");
  assert.equal(result.declarations[3].provenance.sourceItemIdentifier, "improved-cunning-strike");
  assert.equal(result.declarations[3].declaration.value, "2");
  const transaction = new SneakAttackTransaction({
    id: "v14-regression", actor, sneakTargetUuid: "Scene.scene.Token.target",
    declarations: result.declarations, totalDice: 6
  });
  for (const pair of [["trip", "poison"], ["trip", "withdraw"], ["poison", "withdraw"]]) {
    const selected = transaction.setSelections(pair);
    assert.equal(selected.updated, true);
    assert.deepEqual(selected.transaction.selectedDeclarationIds, pair);
    assert.deepEqual(selected.transaction.dice, { total: 6, spent: 2, remaining: 4 });
  }
  const before = transaction.toJSON();
  const three = transaction.setSelections(["trip", "poison", "withdraw"]);
  assert.equal(three.updated, false);
  assert.equal(three.reason, "max-selections-exceeded");
  assert.deepEqual(transaction.toJSON(), before);
});

test("declaration-owned selection limits reject invalid values and retain ordinary Cunning Strike's one-option limit", () => {
  const options = ["trip", "poison", "withdraw"].map(id => ({ declaration: { type: "option", id, cost: 1 } }));
  for (const value of ["1", "0", "garbage", "", "-1", "1.5", null, false, Infinity, 9007199254740992]) {
    const transaction = new SneakAttackTransaction({
      id: "limit", actorUuid: "Actor.rogue", sneakTargetUuid: "Token.target", totalDice: 6,
      declarations: [...options, { declaration: { type: "rule", id: "max-selections", value } }]
    });
    const result = transaction.setSelections(["trip", "withdraw"]);
    assert.equal(result.updated, false);
    assert.equal(result.reason, ["1", "0"].includes(value) ? "max-selections-exceeded" : "invalid-max-selections");
    assert.deepEqual(transaction.selectedDeclarationIds, []);
    if (value === "1") assert.equal(transaction.setSelections(["trip"]).updated, true);
  }
});

test("DAE scanner preserves individual same-key declarations and ignores inapplicable effects", () => {
  const { dae } = makeFixture();
  const active = makeEffect("active", ["type=option; id=one", "type=option; id=two"]);
  const disabled = makeEffect("disabled", ["type=option; id=three"], { disabled: true });
  const suppressed = makeEffect("suppressed", ["type=option; id=four"], { isSuppressed: true });
  const expired = makeEffect("expired", ["type=option; id=five"], { active: false });
  const actor = {
    id: "rogue",
    uuid: "Actor.rogue",
    name: "Rogue",
    appliedEffects: [active, disabled, suppressed, expired]
  };

  const records = dae.scanActor(actor);
  assert.equal(records.length, 2);
  assert.deepEqual(records.map(record => record.value), ["type=option; id=one", "type=option; id=two"]);
  assert.deepEqual(records.map(record => record.effect), [active, active]);
  assert.deepEqual(records.map(record => record.changeIndex), [0, 1]);
});

test("DAE provenance resolution fails closed when its origin-chain resolver is unavailable", async () => {
  const dae = new SneakAttackDaeDeclarationService({
    daeAccessor: () => ({ addAutoFields() {} }),
    moduleAccessor: () => ({ active: true, version: "14.0.13" })
  });

  const result = await dae.resolveSourceItem({ id: "effect" }, { id: "actor" });
  assert.deepEqual(result, {
    resolved: false,
    item: null,
    reason: "dae-origin-resolver-unavailable"
  });
});

test("CAT provider adapter reads the current provider without mutating Item configuration", () => {
  let calls = 0;
  const item = makeItem("cunning");
  const catAutomation = new CatAutomationProviderAdapter({
    catAccessor: () => ({
      utils: {
        automationUtils: {
          getCurrentAutomation(subject) {
            calls += 1;
            assert.equal(subject, item);
            return { source: MODULE_ID, identifier: "cunning-strike" };
          }
        }
      }
    }),
    moduleAccessor: () => ({ active: true, version: "0.0.8" })
  });

  const result = catAutomation.getProviderState(item);
  assert.equal(result.matchesExpectedSource, true);
  assert.equal(result.source, MODULE_ID);
  assert.equal(calls, 1);
});

test("declaration compiler resolves DAE provenance, validates AE5E CAT ownership, preserves unknown fields, and sorts by feature level/order", async () => {
  const { service, itemByEffect } = makeFixture();
  const high = makeEffect("high", ["schema=1; type=rule; id=max-selections; level=11; order=20; value=2; futureField=preserved"]);
  const low = makeEffect("low", ["type=option; id=trip; level=5; order=10; cost=1; executor=activity; activity=trip"]);
  itemByEffect.set(high, makeItem("improved-cunning"));
  itemByEffect.set(low, makeItem("cunning"));
  const actor = { id: "rogue", uuid: "Actor.rogue", name: "Rogue", appliedEffects: [high, low] };

  const result = await service.compileActor(actor);
  assert.equal(result.ok, true);
  assert.deepEqual(result.declarations.map(entry => entry.declaration.id), ["trip", "max-selections"]);
  assert.equal(result.declarations[1].declaration.futureField, "preserved");
  assert.equal(result.declarations[0].provenance.sourceItemIdentifier, "cunning");
  assert.equal(result.declarations[0].provenance.catSource, MODULE_ID);
  assert.equal(result.summary.scanned, 2);
  assert.equal(result.summary.accepted, 2);
  assert.equal(result.summary.rejected, 0);
});

test("declaration compiler rejects foreign CAT providers instead of mixing automation families", async () => {
  const { service, itemByEffect } = makeFixture();
  const effect = makeEffect("foreign", ["type=option; id=trip; level=5"]);
  itemByEffect.set(effect, makeItem("foreign-item", { provider: "chris-premades" }));
  const actor = { id: "rogue", uuid: "Actor.rogue", name: "Rogue", appliedEffects: [effect] };

  const result = await service.compileActor(actor);
  assert.equal(result.ok, false);
  assert.equal(result.declarations.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.diagnostics[0].code, "cat-provider-family-mismatch");
  assert.equal(result.diagnostics[0].catProvider, "chris-premades");
});

test("declaration compiler rejects ambiguous semantic IDs rather than guessing", async () => {
  const { service, itemByEffect } = makeFixture();
  const first = makeEffect("first", ["type=option; id=trip; level=5"]);
  const second = makeEffect("second", ["type=option; id=trip; level=6"]);
  itemByEffect.set(first, makeItem("one"));
  itemByEffect.set(second, makeItem("two"));
  const actor = { id: "rogue", uuid: "Actor.rogue", name: "Rogue", appliedEffects: [first, second] };

  const result = await service.compileActor(actor);
  assert.equal(result.ok, false);
  assert.equal(result.declarations.length, 0);
  assert.equal(result.diagnostics.filter(entry => entry.code === "duplicate-declaration-id").length, 2);
});

test("declaration compiler rejects option modifiers whose referenced option is absent", async () => {
  const { service, itemByEffect } = makeFixture();
  const effect = makeEffect("modifier", ["type=optionModifier; id=envenom; modifies=poison; level=13"]);
  itemByEffect.set(effect, makeItem("modifier-item"));
  const actor = { id: "rogue", uuid: "Actor.rogue", name: "Rogue", appliedEffects: [effect] };

  const result = await service.compileActor(actor);
  assert.equal(result.ok, false);
  assert.equal(result.declarations.length, 0);
  assert.equal(result.diagnostics[0].code, "missing-modified-option");
});

test("declaration compiler rejects unsupported schema/type and invalid generic numeric fields", async () => {
  const { service, itemByEffect } = makeFixture();
  const effect = makeEffect("invalid", [`schema=${SNEAK_ATTACK_DECLARATION_SCHEMA_VERSION + 1}; type=featureSpecificThing; id=x; level=-1`]);
  itemByEffect.set(effect, makeItem("invalid-item"));
  const actor = { id: "rogue", uuid: "Actor.rogue", name: "Rogue", appliedEffects: [effect] };

  const result = await service.compileActor(actor);
  const codes = new Set(result.diagnostics.map(entry => entry.code));
  assert.equal(result.ok, false);
  assert.equal(codes.has("unsupported-declaration-schema"), true);
  assert.equal(codes.has("unsupported-declaration-type"), true);
  assert.equal(codes.has("invalid-level"), true);
});

test("public AE5E API contract can expose Phase-A declaration diagnostics without feature-specific rules", async () => {
  const { ActionEffects5eApi } = await import("../scripts/api.js");
  const stub = new Proxy({}, {
    get(_target, property) {
      if (property === "getStatus") return () => ({ ok: true });
      if (property === "getStats") return () => ({ ok: true });
      return (...args) => ({ property, args });
    }
  });
  const declarations = {
    parse: value => ({ ok: true, declaration: { id: value } }),
    scanActor: actor => [actor],
    resolveProvenance: async () => ({ resolved: true }),
    compileActor: async actor => ({ ok: true, actor, declarations: [] }),
    getStatus: () => ({ schemaVersion: 1 }),
    getStats: () => ({ compileCalls: 0 })
  };
  const catProvider = {
    getCurrentAutomation: item => ({ item }),
    getProviderState: item => ({ item, matchesExpectedSource: true }),
    getStatus: () => ({ active: true }),
    getStats: () => ({})
  };

  const api = new ActionEffects5eApi({
    dependencies: stub,
    compatibility: stub,
    movement: stub,
    movementAccounting: stub,
    movementSpending: stub,
    catMovement: stub,
    catSpell: stub,
    catAutomationRegistry: stub,
    catAutomationProvider: catProvider,
    catMetadataAuthoring: stub,
    catConfigurationAuthoring: stub,
    catMetadataContextMenu: stub,
    animationOwnership: stub,
    automatedAnimations: stub,
    spellModifierRegistry: stub,
    spellModifierDiscovery: stub,
    spellModifierChoices: stub,
    spellModifiers: stub,
    spellModifierEvents: stub,
    ongoingEffects: stub,
    activities: stub,
    ac5eEligibility: {
      evaluateCondition: request => ({ ok: true, eligible: true, request }),
      buildSandbox: request => ({ ok: true, sandbox: request }),
      getStatus: () => ({ active: true }),
      getStats: () => ({})
    },
    sneakAttackDeclarations: declarations,
    sneakAttackEligibility: {
      evaluate: (entry, context) => ({ ok: true, eligible: true, entry, context }),
      evaluateAll: entries => ({ ok: true, eligible: entries, ineligible: [] }),
      getStatus: () => ({ active: true }),
      getStats: () => ({})
    },
    sneakAttackActivities: {
      resolve: (entry, options) => ({ resolved: true, entry, options }),
      resolveSemanticTargets: target => ({ resolved: true, targetUuids: [target] }),
      execute: async () => ({ executed: true }),
      getStatus: () => ({ active: true }),
      getStats: () => ({})
    },
    sneakAttackTurns: {
      resolveTurn: combat => ({ key: combat?.id ?? "turn" }),
      inspect: () => ({ ok: true, available: true }),
      isAvailable: () => true,
      commit: async () => ({ committed: true }),
      getStatus: () => ({ outsideCombatPolicy: "untracked" }),
      getStats: () => ({})
    },
    sneakAttackTransactions: {
      create: request => ({ created: true, request }),
      setSelections: () => ({ updated: true }),
      recordChildOutcome: () => ({ recorded: true }),
      canCommit: () => ({ available: true }),
      commitOnOk: async () => ({ committed: true }),
      decline: () => ({ declined: true }),
      get: id => ({ id }),
      getRecent: () => [],
      getStatus: () => ({ activeTransactions: 0 }),
      getStats: () => ({})
    },
    sneakAttackDamage: {
      inject: async () => ({ injected: true }),
      injectForTransaction: async () => ({ injected: true, transactionId: "tx" }),
      getStatus: () => ({ bonusDamageAvailable: true }),
      getStats: () => ({})
    },
    regions: stub,
    regionCells: stub,
    regionOccupancy: stub,
    regionCellMovementCosts: stub,
    regionCellAttachments: stub,
    environment: stub,
    environmentGeometry: stub,
    environmentBehaviors: stub,
    persistentAreaEvents: stub,
    persistentAreaEntryInterruption: stub,
    persistentAreaLifecycle: stub,
    environmentCapabilities: stub,
    environmentProfiles: stub,
    environmentIndex: stub,
    environmentMutations: stub,
    environmentTiming: stub,
    flammability: stub,
    midiEnvironment: stub,
    relationships: stub,
    relationshipLifecycle: stub,
    relationshipMovement: stub,
    relationshipRotation: stub,
    relativeRelationships: stub,
    relationshipLinkObstructions: stub,
    displacement: stub,
    displacementBatch: stub,
    selectionIndicator: stub,
    externalPromptBridge: stub,
    choicePrompts: stub,
    crosshairs3dGeometry: stub,
    crosshairs3dCells: stub,
    crosshairs3dTokens: stub,
    crosshairs3dRange: stub,
    crosshairs3dRevisions: stub,
    crosshairs3dPropagationModes: stub,
    crosshairs3dPropagation: stub,
    crosshairs3dPropagationEnvironment: stub,
    crosshairs3dPersistentAreas: stub,
    crosshairs3dAttachedPropagation: stub,
    crosshairs3dTargeting: stub,
    crosshairs3dPlacement: stub,
    crosshairs3dIntegration: stub,
    reactionRegistry: stub,
    reactionAuthority: stub,
    reactionDiscovery: stub,
    reactionOrdering: stub,
    reactionDialogs: stub,
    reactionBroker: stub,
    reactionEvents: stub,
    tests: stub,
    socket: stub
  });

  assert.equal(api.constants.SNEAK_ATTACK_DECLARATION_KEY, SNEAK_ATTACK_DECLARATION_KEY);
  assert.equal("AE5E_CHANGE_TYPE" in api.constants, false);
  assert.equal("SNEAK_ATTACK_CHANGE_TYPE" in api.constants, false);
  assert.equal(api.constants.SNEAK_ATTACK_USAGE_FLAG, SNEAK_ATTACK_USAGE_FLAG);
  assert.equal(api.constants.SNEAK_ATTACK_TRANSACTION_STATES.OPEN, SNEAK_ATTACK_TRANSACTION_STATES.OPEN);
  assert.equal(api.sneakAttack.declarations.parse("trip").declaration.id, "trip");
  assert.deepEqual(await api.sneakAttack.declarations.compileActor({ id: "rogue" }), {
    ok: true,
    actor: { id: "rogue" },
    declarations: []
  });
  assert.equal(api.interoperability.cat.provider.getStatus().active, true);
  assert.equal(api.interoperability.ac5e.getStatus().active, true);
  assert.equal(api.sneakAttack.eligibility.evaluate({ declaration: { id: "trip" } }, {}).eligible, true);
  assert.equal(api.sneakAttack.activities.resolve({ declaration: { activity: "trip" } }, {}).resolved, true);
  assert.equal((await api.sneakAttack.activities.execute({}, {})).executed, true);
  assert.equal(api.sneakAttack.turns.isAvailable({}), true);
  assert.equal((await api.sneakAttack.turns.commit({}, { transactionId: "tx" })).committed, true);
  assert.equal(api.sneakAttack.transactions.create({}).created, true);
  assert.equal((await api.sneakAttack.transactions.commitOnOk("tx")).committed, true);
  assert.equal((await api.sneakAttack.damage.inject({}, { formula: "1d6" })).injected, true);
  assert.equal((await api.sneakAttack.damage.injectForTransaction({}, { id: "tx" }, { formula: "1d6" })).transactionId, "tx");
  assert.equal(api.sneakAttack.damage.getStatus().bonusDamageAvailable, true);
});
