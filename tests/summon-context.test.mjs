import assert from "node:assert/strict";
import test from "node:test";

globalThis.foundry = {
  utils: {
    duplicate: value => structuredClone(value),
    randomID: () => "random"
  }
};

const {
  buildSummonContext,
  getSummonContext,
  resolveSummonCastLevel,
  stampSummonContext
} = await import("../scripts/summons/context-service.js");

test("native D&D summon level on token data has highest priority", () => {
  const activity = { relevantLevel: 4, item: { system: { level: 3 } } };
  const tokenData = { delta: { flags: { dnd5e: { summon: { level: 6 } } } } };
  assert.deepEqual(resolveSummonCastLevel(activity, { spellLevel: 5 }, tokenData), {
    baseLevel: 3,
    castLevel: 6
  });
});

test("context captures provenance, cast level, batch, and placement order", () => {
  globalThis.game = { user: { id: "user" } };
  const activity = {
    uuid: "Actor.a.Item.i.Activity.summon",
    relevantLevel: 5,
    actor: { uuid: "Actor.a" },
    item: { uuid: "Actor.a.Item.i", system: { level: 3 } },
    getUsageToken: () => ({ document: { uuid: "Scene.s.Token.caster" } })
  };
  const context = buildSummonContext({
    activity,
    profile: { _id: "mirthful", name: "Mirthful" },
    declaration: { id: "summon-fey", initiative: { mode: "after-summoner" } },
    batchId: "batch",
    placementOrder: 1
  });
  assert.equal(context.castLevel, 5);
  assert.equal(context.baseLevel, 3);
  assert.equal(context.summonerTokenUuid, "Scene.s.Token.caster");
  assert.equal(context.profileId, "mirthful");
  assert.equal(context.batchId, "batch");
  assert.equal(context.placementOrder, 1);
});

test("token-data stamping is readable without a Foundry document instance", () => {
  const tokenData = {};
  const context = { version: 1, castLevel: 4 };
  stampSummonContext(tokenData, context);
  assert.deepEqual(getSummonContext(tokenData), context);
});
