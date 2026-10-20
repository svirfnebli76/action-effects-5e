import assert from "node:assert/strict";
import test from "node:test";
import { CastingPhaseService, CASTING_PHASES } from "../scripts/casting/casting-phase-service.js";

function hooksFixture() {
  const handlers = new Map();
  globalThis.Hooks = {
    on(name, callback) { handlers.set(name, callback); return name; },
    off(name) { handlers.delete(name); }
  };
  return handlers;
}

function workflow() {
  const actor = { uuid: "Actor.caster" };
  const item = { uuid: "Actor.caster.Item.spell", type: "spell", system: { level: 3 }, flags: {} };
  const activity = { id: "cast", actor, item, activation: { type: "action" } };
  return {
    id: "Workflow.cast",
    actor,
    item,
    activity,
    token: { document: { uuid: "Scene.s.Token.caster" } },
    castData: { castLevel: 4 }
  };
}

test("casting phase hooks expose semantic phases and cancellation safety", async () => {
  const handlers = hooksFixture();
  globalThis.game = {
    user: { id: "gm" },
    combat: {
      id: "combat",
      round: 2,
      turn: 1,
      combatant: { id: "combatant", actor: { uuid: "Actor.caster" } }
    }
  };

  const service = new CastingPhaseService();
  const seen = [];
  service.register("probe", {
    handler: envelope => {
      seen.push(envelope);
      return false;
    }
  });
  service.initialize();

  assert.equal(handlers.size, 4);
  const w = workflow();
  assert.equal(await handlers.get("midi-qol.preTargetingV2")(w), false,
    "pre-cast is cancellation-safe");
  assert.equal(await handlers.get("midi-qol.premades.postPreambleComplete")(w), true,
    "later phases cannot unwind an already-progressed cast");
  assert.equal(await handlers.get("midi-qol.hitsChecked")(w), true);
  assert.equal(await handlers.get("midi-qol.preDamageRollComplete")(w), true);

  assert.deepEqual(seen.map(entry => entry.phase), [
    CASTING_PHASES.PRE_CAST,
    CASTING_PHASES.POST_TARGETING,
    CASTING_PHASES.ATTACK_RESOLVED,
    CASTING_PHASES.DAMAGE_MUTABLE
  ]);
  assert.equal(seen[0].cancelSafe, true);
  assert.equal(seen[1].cancelSafe, false);
  assert.equal(seen[0].facts.isCasterTurn, true);
  assert.equal(seen[0].facts.castLevel, 4);
  assert.equal(seen[0].facts.baseSpellLevel, 3);

  service.shutdown();
  assert.equal(handlers.size, 0);
});

test("phase consumers can subscribe narrowly and duplicate workflow phase delivery is ignored", async () => {
  hooksFixture();
  globalThis.game = { user: { id: "gm" }, combat: null };
  const service = new CastingPhaseService();
  const seen = [];
  service.register("miss-only", {
    phases: [CASTING_PHASES.ATTACK_RESOLVED],
    handler: envelope => { seen.push(envelope.eventId); return true; }
  });

  const w = workflow();
  await service.dispatch(CASTING_PHASES.PRE_CAST, w);
  await service.dispatch(CASTING_PHASES.ATTACK_RESOLVED, w, { eventId: "attack-1" });
  await service.dispatch(CASTING_PHASES.ATTACK_RESOLVED, w, { eventId: "attack-1" });
  await service.dispatch(CASTING_PHASES.ATTACK_RESOLVED, w, { eventId: "attack-2" });

  assert.deepEqual(seen, ["attack-1", "attack-2"]);
  assert.equal(service.getStats().deduped, 1);
  assert.throws(() => service.register("bad", {
    phases: ["feature-specific-phase"],
    handler() {}
  }), /unknown phase/);
});
