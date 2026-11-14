import assert from "node:assert/strict";
import test from "node:test";

import { SummonDeclarationService } from "../scripts/summons/declaration-service.js";

test("an absent summon declaration leaves the Item unautomated", () => {
  const service = new SummonDeclarationService({
    collections: { read: () => ({ valid: true, absent: true, issues: [], records: [] }) }
  });
  assert.equal(service.read({}).enabled, false);
});

test("exactly one valid summon declaration enables infrastructure", () => {
  const declaration = { id: "summon-fey", type: "summon", initiative: { mode: "after-summoner" } };
  const service = new SummonDeclarationService({
    collections: { read: () => ({ valid: true, absent: false, issues: [], records: [declaration] }) }
  });
  const result = service.read({});
  assert.equal(result.valid, true);
  assert.equal(result.enabled, true);
  assert.deepEqual(result.declaration, declaration);
});

test("multiple summon declarations are rejected instead of guessed", () => {
  const service = new SummonDeclarationService({
    collections: { read: () => ({ valid: true, absent: false, issues: [], records: [{}, {}] }) }
  });
  const result = service.read({});
  assert.equal(result.valid, false);
  assert.equal(result.enabled, false);
  assert.match(result.issues[0], /exactly one/i);
});
