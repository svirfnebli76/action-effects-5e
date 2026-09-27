import assert from "node:assert/strict";
import test from "node:test";

import { CatSpellAdapter } from "../scripts/integrations/cat-spell-adapter.js";
import { SneakAttackParentDamageService } from "../scripts/sneak-attack/parent-damage-service.js";

function workflowFixture({
  id = "parent-workflow",
  isCritical = false,
  defaultDamageType = "psychic"
} = {}) {
  return {
    id,
    isCritical,
    defaultDamageType,
    activity: { id: "attack" },
    damageRolls: [
      {
        formula: "1d6",
        total: 4,
        options: { type: defaultDamageType }
      }
    ]
  };
}

function catStub({ throwOnce = false } = {}) {
  const calls = [];
  let shouldThrow = throwOnce;
  return {
    calls,
    getStatus: () => ({ active: true, capabilities: { bonusDamage: true } }),
    async bonusDamage(workflow, formula, options = {}) {
      calls.push({ workflow, formula, options: structuredClone(options) });
      if (shouldThrow) {
        shouldThrow = false;
        throw new Error("fixture CAT failure");
      }
      const finalFormula = workflow.isCritical && !options.ignoreCrit
        ? `critical(${formula})`
        : String(formula);
      workflow.damageRolls.push({
        formula: finalFormula,
        total: workflow.isCritical && !options.ignoreCrit ? 9 : 5,
        options: {
          type: options.damageType ?? workflow.defaultDamageType,
          cat: { source: options.source }
        }
      });
    }
  };
}

test("CAT spell adapter exposes and forwards workflowUtils.bonusDamage", async () => {
  const priorGame = globalThis.game;
  const priorCat = globalThis.cat;
  const calls = [];

  globalThis.game = {
    modules: new Map([["cat", { active: true, version: "0.0.8" }]])
  };
  globalThis.cat = {
    utils: {
      workflowUtils: {
        async bonusDamage(workflow, formula, options) {
          calls.push({ workflow, formula, options });
        }
      },
      activityUtils: {},
      itemUtils: {},
      rollUtils: {},
      documentUtils: {}
    }
  };

  try {
    const adapter = new CatSpellAdapter();
    assert.equal(adapter.getStatus().capabilities.bonusDamage, true);
    const workflow = workflowFixture();
    await adapter.bonusDamage(workflow, "2d6", { source: "fixture" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].workflow, workflow);
    assert.equal(calls[0].formula, "2d6");
    assert.deepEqual(calls[0].options, { source: "fixture" });
    assert.equal(adapter.getStats().bonusDamageCalls, 1);
  } finally {
    globalThis.game = priorGame;
    globalThis.cat = priorCat;
  }
});

test("parent damage service appends exactly one CAT bonus roll and inherits parent damage type by default", async () => {
  const cat = catStub();
  const service = new SneakAttackParentDamageService({ catSpell: cat });
  const workflow = workflowFixture({ defaultDamageType: "psychic" });

  const result = await service.inject(workflow, {
    formula: "2d6",
    source: "fixture-source"
  });

  assert.equal(result.injected, true);
  assert.equal(result.reason, null);
  assert.equal(result.beforeRollCount, 1);
  assert.equal(result.afterRollCount, 2);
  assert.equal(result.addedRollCount, 1);
  assert.equal(result.addedRoll.formula, "2d6");
  assert.equal(result.addedRoll.type, "psychic");
  assert.equal(result.addedRoll.source, "fixture-source");
  assert.equal(cat.calls.length, 1);
  assert.equal("damageType" in cat.calls[0].options, false, "default type inheritance must remain CAT-owned");
  assert.equal(service.getStats().injections, 1);
});

test("parent damage service delegates critical conversion and explicit damage type to CAT without calculating either", async () => {
  const cat = catStub();
  const service = new SneakAttackParentDamageService({ catSpell: cat });
  const workflow = workflowFixture({ isCritical: true, defaultDamageType: "psychic" });

  const result = await service.inject(workflow, {
    formula: "1d6",
    damageType: "poison",
    source: "fixture",
    ignoreCrit: false
  });

  assert.equal(result.injected, true);
  assert.equal(result.requestedFormula, "1d6");
  assert.equal(result.addedRoll.formula, "critical(1d6)");
  assert.equal(result.addedRoll.type, "poison");
  assert.equal(result.isCritical, true);
  assert.deepEqual(cat.calls[0].options, {
    ignoreCrit: false,
    damageType: "poison",
    source: "fixture"
  });
});

test("transaction-bound parent damage requires a committed matching parent workflow and deduplicates one transaction", async () => {
  const cat = catStub();
  const service = new SneakAttackParentDamageService({ catSpell: cat });
  const workflow = workflowFixture({ id: "parent-1" });
  const committed = {
    id: "tx-1",
    state: "committed",
    parentWorkflowId: "parent-1"
  };

  const first = await service.injectForTransaction(workflow, committed, { formula: "3d6" });
  assert.equal(first.injected, true);
  assert.equal(first.transactionId, "tx-1");
  assert.equal(first.idempotencyKey, "parent-1:tx-1");

  const duplicate = await service.injectForTransaction(workflow, committed, { formula: "3d6" });
  assert.equal(duplicate.injected, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.reason, "duplicate");
  assert.equal(cat.calls.length, 1);

  const wrongParent = await service.injectForTransaction(
    workflowFixture({ id: "different-parent" }),
    committed,
    { formula: "1d6" }
  );
  assert.equal(wrongParent.injected, false);
  assert.equal(wrongParent.reason, "parent-workflow-mismatch");

  const open = await service.injectForTransaction(workflow, {
    id: "tx-open",
    state: "open",
    parentWorkflowId: "parent-1"
  }, { formula: "1d6" });
  assert.equal(open.injected, false);
  assert.equal(open.reason, "transaction-not-committed");
  assert.equal(service.getStats().duplicates, 1);
});

test("parent damage CAT failures fail closed and release an untouched idempotency claim for retry", async () => {
  const cat = catStub({ throwOnce: true });
  const service = new SneakAttackParentDamageService({ catSpell: cat });
  const workflow = workflowFixture({ id: "parent-retry" });

  const failed = await service.inject(workflow, {
    formula: "1d6",
    transactionId: "tx-retry"
  });
  assert.equal(failed.injected, false);
  assert.equal(failed.reason, "cat-bonus-damage-error");
  assert.equal(failed.mutated, false);
  assert.equal(workflow.damageRolls.length, 1);

  const retry = await service.inject(workflow, {
    formula: "1d6",
    transactionId: "tx-retry"
  });
  assert.equal(retry.injected, true);
  assert.equal(workflow.damageRolls.length, 2);
  assert.equal(cat.calls.length, 2);
});

test("parent damage service rejects missing formulas, missing roll arrays, and unavailable CAT without mutating workflows", async () => {
  const cat = catStub();
  const service = new SneakAttackParentDamageService({ catSpell: cat });
  const workflow = workflowFixture();

  const blank = await service.inject(workflow, { formula: "   " });
  assert.equal(blank.injected, false);
  assert.equal(blank.reason, "formula-unavailable");

  const noRolls = await service.inject({ id: "parent", damageRolls: null }, { formula: "1d6" });
  assert.equal(noRolls.injected, false);
  assert.equal(noRolls.reason, "parent-damage-rolls-unavailable");

  const unavailable = new SneakAttackParentDamageService({
    catSpell: {
      getStatus: () => ({ active: false, capabilities: { bonusDamage: false } })
    }
  });
  const unavailableResult = await unavailable.inject(workflow, { formula: "1d6" });
  assert.equal(unavailableResult.injected, false);
  assert.equal(unavailableResult.reason, "cat-bonus-damage-unavailable");
  assert.equal(workflow.damageRolls.length, 1);
});
