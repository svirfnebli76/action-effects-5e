import assert from "node:assert/strict";
import test from "node:test";
import { registerSaveProtectionFamily } from "../scripts/declarations/save-protection-family.js";
import { DeclarationFamilyRegistry } from "../scripts/declarations/family-registry.js";
import { DeclarationCollectionService } from "../scripts/declarations/collection-service.js";
import { SaveProtectionDeclarationService } from "../scripts/save-protection/declaration-service.js";
import { SaveProtectionApplicationService } from "../scripts/save-protection/application-service.js";
import { SaveProtectionFeatureService } from "../scripts/save-protection/feature-service.js";
import { CASTING_PHASES } from "../scripts/casting/casting-phase-service.js";
import { CatDeclarationMacroAdapter, declarationActorPass } from "../scripts/integrations/cat-declaration-macro-adapter.js";

globalThis.foundry = { utils: {
  randomID: () => "feature-save-claim",
  deepClone: value => structuredClone(value)
} };
globalThis.game = { user: { id: "player" } };
globalThis.ui = { notifications: { error() {} } };

const declaration = {
  id: "sculpt-spells",
  type: "feature",
  phase: CASTING_PHASES.SAVES_READY,
  priority: 10,
  execution: { interface: "cat-embedded", name: "Sculpt Spells" }
};

function fixture() {
  const registry = new DeclarationFamilyRegistry();
  registerSaveProtectionFamily(registry);
  const collections = new DeclarationCollectionService({ registry });
  class Items extends Map { [Symbol.iterator]() { return this.values(); } }
  const actor = { uuid: "Actor.evoker", isOwner: true, items: new Items() };
  const feature = {
    id: "sculpt",
    uuid: "Actor.evoker.Item.sculpt",
    actor,
    name: "Sculpt Spells",
    flags: { "action-effects-5e": { saveProtection: {
      version: 1,
      declarations: [structuredClone(declaration)]
    } } }
  };
  actor.items.set(feature.id, feature);
  const protectedToken = { document: { uuid: "Scene.test.Token.friend" } };
  const spell = { id: "spell", type: "spell", system: { school: "evo" } };
  const activity = { id: "save", item: spell, actor };
  const workflow = {
    id: "Workflow.fireball",
    actor,
    activity,
    item: spell,
    userId: "player",
    targets: new Set([protectedToken]),
    hitTargets: new Set([protectedToken]),
    superSavers: new Set(),
    checkSculptOrCarefulSpells() { return false; }
  };
  let handler;
  const phases = {
    register(id, config) {
      assert.equal(id, "save-protection-features");
      handler = config.handler;
      return () => { handler = null; };
    }
  };
  const calls = [];
  const executors = {
    async execute(request) {
      calls.push({ kind: request.kind, phase: request.phase, family: request.family });
      if (request.phase === "offer") return { eligible: true };
      if (request.phase === "select") return {
        outcome: "confirm",
        payload: { protectedTokenUuids: [protectedToken.document.uuid] }
      };
      if (request.phase === "apply") return { saveProtection: {
        tokenUuids: request.context.payload.protectedTokenUuids,
        automaticSuccess: true,
        superSaver: true
      } };
      throw new Error("unexpected phase");
    },
    async notify(request) { calls.push({ kind: request.kind, phase: request.phase, family: request.family }); }
  };
  const declarations = new SaveProtectionDeclarationService({ collections });
  const applications = new SaveProtectionApplicationService();
  const service = new SaveProtectionFeatureService({ phases, declarations, executors, applications });
  return { registry, actor, feature, protectedToken, activity, workflow, service, applications, calls,
    getHandler: () => handler };
}

test("save-protection declaration family remains feature-generic and validates CAT ownership", () => {
  const f = fixture();
  assert.equal(f.registry.validateRecord("save-protection", declaration).valid, true);
  const invalid = structuredClone(declaration);
  invalid.execution.interface = "midi-on-use";
  assert.equal(f.registry.validateRecord("save-protection", invalid).valid, false);
  const compiled = new SaveProtectionDeclarationService({
    collections: new DeclarationCollectionService({ registry: f.registry })
  }).compile(f.actor);
  assert.equal(compiled.ready, true);
  assert.equal(compiled.features[0].id, "sculpt-spells");
});

test("CAT feature declarations use one dedicated actor Called-event pass", async () => {
  const f = fixture();
  f.feature.flags.cat = { embeddedMacros: [{
    name: "Sculpt Spells",
    event: "called",
    pass: declarationActorPass("feature"),
    macros: [{ priority: 50, macro: "return true;" }]
  }] };
  const cat = { utils: { automationUtils: { async calledEvent(pass, actor, options) {
    assert.equal(pass, "ae5eDeclarationFeature");
    assert.equal(actor, f.actor);
    options.data.respond(f.feature, "Sculpt Spells", { eligible: true });
  } } } };
  const adapter = new CatDeclarationMacroAdapter({ catAccessor: () => cat });
  const response = await adapter.execute({
    actor: f.actor,
    sourceUuid: f.feature.uuid,
    identity: JSON.stringify([f.feature.uuid, "save-protection", "sculpt-spells"]),
    family: "save-protection",
    declaration,
    kind: "feature",
    phase: "offer",
    context: { actor: f.actor, workflow: f.workflow }
  });
  assert.deepEqual(response, { eligible: true });
});

test("a CAT-owned feature is offered, selected, applied, and armed at saves-ready", async () => {
  const f = fixture();
  f.service.initialize();
  const handler = f.getHandler();
  assert.equal(typeof handler, "function");
  assert.equal(await handler({
    phase: CASTING_PHASES.SAVES_READY,
    workflow: f.workflow,
    actor: f.actor,
    activity: f.activity,
    item: f.activity.item
  }), true);
  assert.deepEqual(f.calls, [
    { kind: "feature", phase: "offer", family: "save-protection" },
    { kind: "feature", phase: "select", family: "save-protection" },
    { kind: "feature", phase: "apply", family: "save-protection" },
    { kind: "feature", phase: "applied", family: "save-protection" }
  ]);
  assert.equal(f.workflow.checkSculptOrCarefulSpells(f.protectedToken), true);
  assert.equal(f.workflow.superSavers.has(f.protectedToken), true);
  assert.equal(f.service.getRecent()[0].featureId, "sculpt-spells");
  f.service.shutdown();
  assert.equal(f.getHandler(), null);
});

test("ordinary attack spells, overtime repeats, and actors without declarations remain untouched", async () => {
  const f = fixture();
  const base = {
    phase: CASTING_PHASES.SAVES_READY,
    workflow: f.workflow,
    actor: f.actor,
    activity: f.activity,
    item: f.activity.item
  };
  assert.equal(await f.service.process({ ...base, item: { type: "weapon" } }), true);
  f.workflow.workflowOptions = { overTimeEffectUuid: "ActiveEffect.repeat" };
  assert.equal(await f.service.process(base), true);
  delete f.workflow.workflowOptions;
  f.actor.items.clear();
  assert.equal(await f.service.process(base), true);
  assert.deepEqual(f.calls, []);
});
