import assert from "node:assert/strict";
import test from "node:test";
import { MetamagicTurnCastingService } from "../scripts/metamagic/turn-casting-service.js";
import { CASTING_PHASES } from "../scripts/casting/casting-phase-service.js";

function actor(uuid = "Actor.sorc", metamagic = true) {
  return {
    uuid,
    hasMetamagic: metamagic,
    flags: {},
    async update(changes) {
      const state = changes["flags.action-effects-5e.metamagic.turnCasting"];
      this.flags["action-effects-5e"] ??= {};
      this.flags["action-effects-5e"].metamagic ??= {};
      this.flags["action-effects-5e"].metamagic.turnCasting = structuredClone(state);
    }
  };
}

function token(uuid, owner) { return { uuid, actor: owner }; }

function combat(id, entries, { round = 1, turn = 0 } = {}) {
  const turns = entries.map((entry, index) => ({
    id: entry.id ?? "c" + index,
    actor: entry.actor,
    token: entry.token
  }));
  return {
    id,
    uuid: "Combat." + id,
    started: true,
    round,
    turn,
    turns,
    combatants: turns,
    get combatant() { return turns[this.turn] ?? null; }
  };
}

function make({ metamagic = true } = {}) {
  const caster = actor("Actor.sorc", metamagic);
  const casterToken = token("Scene.s.Token.sorc", caster);
  const enemy = actor("Actor.enemy", false);
  const enemyToken = token("Scene.s.Token.enemy", enemy);
  const currentCombat = combat("combat", [
    { id: "sorc", actor: caster, token: casterToken },
    { id: "enemy", actor: enemy, token: enemyToken }
  ]);
  const phases = {
    registration: null,
    register(id, config) {
      this.registration = { id, config };
      return () => { this.registration = null; };
    }
  };
  const service = new MetamagicTurnCastingService({
    phases,
    declarations: { hasBase: subject => subject?.hasMetamagic === true }
  });
  globalThis.game = { combat: currentCombat, combats: [currentCombat] };
  service.initialize();
  return { service, phases, caster, casterToken, enemy, enemyToken, combat: currentCombat };
}

function envelope(f, {
  activation = "action",
  baseLevel = 1,
  castLevel = baseLevel,
  itemType = "spell",
  tokenValue = f.casterToken,
  id = "cast",
  automationOnly = false,
  child = false
} = {}) {
  const item = { uuid: f.caster.uuid + ".Item." + id, type: itemType, system: { level: baseLevel } };
  const activity = {
    id: "activity-" + id,
    item,
    activation: { type: activation },
    midiProperties: { automationOnly }
  };
  const workflow = {
    id,
    actor: f.caster,
    item,
    activity,
    token: tokenValue ? { document: tokenValue } : null,
    castData: { castLevel }
  };
  if (child) workflow.workflowOptions = { ae5eChildContext: { schema: 1 } };
  return {
    phase: CASTING_PHASES.POST_TARGETING,
    eventId: "event-" + id,
    workflow,
    actor: f.caster,
    activity,
    item,
    facts: {
      casterActorUuid: f.caster.uuid,
      casterTokenUuid: tokenValue?.uuid ?? null,
      sourceItemUuid: item.uuid,
      sourceActivityId: activity.id,
      activationType: activation,
      baseSpellLevel: baseLevel,
      castLevel
    }
  };
}

test("registers only for post-targeting and ignores actors without Metamagic", async () => {
  const f = make({ metamagic: false });
  assert.equal(f.phases.registration.id, "metamagic-turn-casting");
  assert.deepEqual(f.phases.registration.config.phases, [CASTING_PHASES.POST_TARGETING]);
  await f.service.observe(envelope(f));
  assert.equal(f.caster.flags["action-effects-5e"], undefined);
});

test("snapshot is fixed-size and level1PlusCast remains latched", async () => {
  const f = make();
  for (let i = 0; i < 120; i++) {
    const activation = ["action", "bonus", "reaction"][i % 3];
    await f.service.observe(envelope(f, { activation, baseLevel: i === 0 ? 2 : 0, id: "cast-" + i }));
  }
  const state = f.service.get(f.caster, { workflow: envelope(f).workflow });
  assert.equal(state.level1PlusCast, true);
  assert.deepEqual(Object.keys(state.casts).sort(), ["action", "bonus", "reaction"]);
  assert.equal(JSON.stringify(state).includes("cast-0"), false);
});

test("stale turn state reads empty and the next committed cast replaces it", async () => {
  const f = make();
  await f.service.observe(envelope(f, { baseLevel: 2, id: "old" }));
  f.combat.round = 2;
  assert.equal(f.service.get(f.caster, { workflow: envelope(f).workflow }), null);
  await f.service.observe(envelope(f, { baseLevel: 0, id: "new" }));
  const state = f.service.get(f.caster, { workflow: envelope(f).workflow });
  assert.equal(state.round, 2);
  assert.equal(state.level1PlusCast, false);
  assert.equal(state.casts.action.castingId, "new");
});

test("persisted actor state survives service recreation", async () => {
  const f = make();
  await f.service.observe(envelope(f, { baseLevel: 2, id: "persisted" }));
  const recreated = new MetamagicTurnCastingService({
    phases: { register() { return () => {}; } },
    declarations: { hasBase: () => true }
  });
  assert.equal(recreated.get(f.caster, { workflow: envelope(f).workflow }).casts.action.castingId, "persisted");
});

test("off-turn Reaction is keyed to the active enemy turn", async () => {
  const f = make();
  f.combat.turn = 1;
  await f.service.observe(envelope(f, { activation: "reaction", baseLevel: 1, id: "shield" }));
  const state = f.service.get(f.caster, { workflow: envelope(f, { activation: "reaction" }).workflow });
  assert.equal(state.turn, 1);
  assert.equal(state.combatantId, "enemy");
  assert.equal(state.casts.reaction.castingId, "shield");
});

test("workflow token resolves multi-combat identity and never falls back to another token of the same Actor", async () => {
  const caster = actor();
  const tokenA = token("Scene.a.Token.sorc", caster);
  const tokenB = token("Scene.b.Token.sorc", caster);
  const outside = token("Scene.c.Token.sorc", caster);
  const one = combat("one", [{ id: "a", actor: caster, token: tokenA }]);
  const two = combat("two", [{ id: "b", actor: caster, token: tokenB }]);
  const phases = { register() { return () => {}; } };
  const service = new MetamagicTurnCastingService({ phases, declarations: { hasBase: () => true } });
  globalThis.game = { combat: one, combats: [one, two] };
  const f = { caster, casterToken: tokenB };
  await service.observe(envelope(f, { tokenValue: tokenB, id: "scene-b" }));
  assert.equal(service.get(caster, { workflow: envelope(f, { tokenValue: tokenB }).workflow }).combatId, "two");

  caster.flags = {};
  const outsideEnvelope = envelope({ caster, casterToken: outside }, { tokenValue: outside, id: "outside" });
  await service.observe(outsideEnvelope);
  assert.equal(caster.flags["action-effects-5e"], undefined);
});

test("actor-only ambiguity fails open, while one plausible combat is allowed", async () => {
  const caster = actor();
  const one = combat("one", [{ id: "a", actor: caster, token: token("Scene.a.Token.a", caster) }]);
  const two = combat("two", [{ id: "b", actor: caster, token: token("Scene.b.Token.b", caster) }]);
  const phases = { register() { return () => {}; } };
  const service = new MetamagicTurnCastingService({ phases, declarations: { hasBase: () => true } });
  const f = { caster, casterToken: null };
  const e = envelope(f, { tokenValue: null, id: "actor-only" });
  e.facts.casterTokenUuid = null;
  e.workflow.token = null;

  globalThis.game = { combat: one, combats: [one, two] };
  await service.observe(e);
  assert.equal(caster.flags["action-effects-5e"], undefined);

  globalThis.game = { combat: one, combats: [one] };
  await service.observe(e);
  assert.equal(caster.flags["action-effects-5e"].metamagic.turnCasting.combatId, "one");
});

test("automation-only, AE5E child and non-spell workflows do not create casting state", async () => {
  const f = make();
  await f.service.observe(envelope(f, { automationOnly: true, id: "automation" }));
  await f.service.observe(envelope(f, { child: true, id: "child" }));
  await f.service.observe(envelope(f, { itemType: "feat", id: "feat" }));
  assert.equal(f.caster.flags["action-effects-5e"], undefined);
});
