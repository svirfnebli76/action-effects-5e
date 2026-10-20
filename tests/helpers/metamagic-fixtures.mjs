import assert from "node:assert/strict";
import fs from "node:fs";
import { fixture as declarationsFixture, envelope } from "./declaration-fixtures.mjs";
import { MetamagicDeclarationService } from "../../scripts/metamagic/declaration-service.js";
import { MetamagicCastingService } from "../../scripts/metamagic/casting-service.js";
import { CatDeclarationMacroAdapter, declarationActorPass } from "../../scripts/integrations/cat-declaration-macro-adapter.js";

export const scope = "action-effects-5e";
export const copy = value => structuredClone(value);
export const definitions = JSON.parse(fs.readFileSync(new URL("../../examples/metamagic-development-3/declarations.json", import.meta.url)));
export const broker = fs.readFileSync(new URL("../../examples/metamagic-development-3/base-broker.js", import.meta.url), "utf8");
export const distant = fs.readFileSync(new URL("../../examples/metamagic-development-3/distant-spell.js", import.meta.url), "utf8");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
let nextId = 0;
globalThis.foundry = { utils: { randomID: () => `cast${++nextId}`, deepClone: copy } };
globalThis.ui = { notifications: { error() {}, warn() {} } };
globalThis.game = { user: { id: "gm", isGM: true }, settings: { get: () => false }, modules: new Map() };

class Items extends Map { [Symbol.iterator]() { return this.values(); } }
function setPath(subject, path, value) {
  const keys = path.split(".");
  const leaf = keys.pop();
  for (const key of keys) subject = subject[key] ??= {};
  subject[leaf] = copy(value);
}
export function setup({ range = { value: 30, units: "ft", override: false }, available = 4, uuid = "Actor.caster", ac5e = null, sourceBacked = false } = {}) {
  const { collections, registry } = declarationsFixture({ ac5e });
  const actor = { uuid, isOwner: true, items: new Items() };
  const writes = [];
  const add = (id, records, system = {}) => {
    const item = { id, uuid: `${uuid}.Item.${id}`, actor, name: id, type: "feat", system,
      flags: records ? { [scope]: { metamagic: envelope(copy(records)) } } : {},
      async update(updates) { writes.push(updates); for (const [path, value] of Object.entries(updates)) setPath(this, path, value); } };
    actor.items.set(id, item);
    return item;
  };
  const install = (item, name, kind, script) => {
    item.flags.cat ??= {};
    item.flags.cat.embeddedMacros = [{ name, event: "called", pass: declarationActorPass(kind), macros: [{ priority: 50, macro: script }] }];
  };
  const main = add("main", [definitions.base]);
  install(main, "Metamagic Broker", "broker", broker);
  const option = add("option", [definitions.distant]);
  install(option, "Distant Spell", "option", distant);
  const pool = add("pool", null, { identifier: "sorcery-points", uses: { value: available, spent: 7 - available, max: 7 } });
  const original = add("spell", null, { range: copy(range) });
  original.type = "spell";
  function activityClone(from = null) {
    if (sourceBacked) {
      // Native use/scaling works from the parent Item source, not detached live Activity fields.
      const data = copy(from?.item._source ?? { flags: original.flags, system: { range: copy(range),
        activities: { activity: { range: copy(range), consumption: { targets: [] } } } } });
      const spell = { id: original.id, uuid: original.uuid, actor, type: "spell", _source: data,
        updateSource(updates) {
          for (const [path, value] of Object.entries(updates)) setPath(data, path, value);
          hydrateItem();
        }, prepareFinalAttributes() {
          for (const activity of this.system.activities) activity.prepareFinalData();
        } };
      const hydrateItem = () => {
        spell.flags = copy(data.flags);
        spell.system = { range: copy(data.system.range), activities: new Items() };
        for (const [id, raw] of Object.entries(data.system.activities)) {
          // D&D5e RangeField.value is a FormulaField (a StringField), then
          // prepareFinalData evaluates it to the live numeric distance.
          if (raw.range.value != null) raw.range.value = String(raw.range.value);
          const source = copy(raw);
          const activity = { id, actor, item: spell, _source: source,
            updateSource(updates) {
              for (const [path, value] of Object.entries(updates)) setPath(source, path, value);
              if (source.range.value != null) source.range.value = String(source.range.value);
              hydrateActivity();
            }, prepareFinalData() {
              hydrateActivity();
              if (["ft", "mi", "m", "km"].includes(this.range.units)) this.range.value = Number(this.range.value);
              else this.range.value = null;
            } };
          const hydrateActivity = () => {
            activity.range = copy(source.range.override ? source.range : { ...spell.system.range, override: false });
            activity.consumption = copy(source.consumption);
          };
          hydrateActivity();
          spell.system.activities.set(id, activity);
        }
      };
      hydrateItem();
      spell.prepareFinalAttributes();
      return spell.system.activities.get("activity");
    }
    const spell = { id: original.id, uuid: original.uuid, actor, type: "spell", flags: copy(from?.item.flags ?? original.flags),
      updateSource(updates) { for (const [path, value] of Object.entries(updates)) setPath(this, path, value); } };
    return { id: "activity", actor, item: spell, range: copy(from?.range ?? range),
      consumption: copy(from?.consumption ?? { targets: [] }),
      updateSource(updates) { for (const [path, value] of Object.entries(updates)) setPath(this, path, value); } };
  }
  const activity = activityClone();
  const workflow = { id: "Activity.mutable", actor, item: activity.item, activity, userId: null,
    token: { document: { uuid: "Scene.scene.Token.caster" } }, targets: new Set() };
  const calls = [];
  const prompts = [];
  let chooser = async () => "distant-spell";
  // Models CAT 0.1.2's documented Called dispatcher and native script scope,
  // including its error-catching behavior. This is not a live Foundry test.
  const cat = { utils: { automationUtils: { async calledEvent(pass, caster, options) {
    game.modules.set(scope, { api });
    calls.push({ pass, kind: options.data.kind, phase: options.data.phase });
    assert.equal(options.canOverlap, true);
    assert.equal(options.multiResult, true);
    const results = [];
    for (const document of caster.items) for (const macro of document.flags.cat?.embeddedMacros ?? []) {
      if (macro.event !== "called" || macro.pass !== `actor${pass[0].toUpperCase()}${pass.slice(1)}`) continue;
      for (const config of macro.macros) {
        try {
          const result = await new AsyncFunction("data", "document", "macroName", "game", config.macro)(options.data, document, macro.name, game);
          if (result) results.push(result);
        } catch { /* CAT logs macro exceptions and continues. */ }
      }
    }
    return results;
  } } } };
  const declarations = new MetamagicDeclarationService({ collections });
  const executors = new CatDeclarationMacroAdapter({ catAccessor: () => cat });
  const cards = [];
  const service = new MetamagicCastingService({ declarations, executors,
    cards: { async upsertContribution(subject, contribution) { cards.push(copy(contribution)); return { updated: true }; } } });
  const api = { prompts: { async choose(request) { prompts.push(request); return chooser(request); } },
    metamagic: { getCasting: workflow => service.get(workflow) } };
  const consume = () => {
    assert.equal(service.prepareNative(activity), true);
    const usage = { consume: false };
    assert.equal(service.prepareConsumption(activity, usage), true);
    const charge = activity.consumption.targets.at(-1);
    const amount = charge ? Number(charge.value) : 0;
    const updates = { item: amount ? [{ _id: pool.id, "system.uses.spent": pool.system.uses.spent + amount }] : [], delete: [] };
    assert.equal(service.validateConsumption(activity, updates), true);
    pool.system.uses.spent += amount;
    pool.system.uses.value -= amount;
    service.recordConsumption(activity, { data: { system: { deltas: { item: { [pool.id]: [{ keyPath: "system.uses.spent", delta: amount }] } } } } });
    return amount;
  };
  return { actor, add, main, option, pool, original, activity, activityClone, workflow, cards, service, declarations, executors, collections, registry,
    calls, prompts, writes, install, consume, setChooser(fn) { chooser = fn; } };
}

// This models the native target->proposed update->delta contract. It is not a live Foundry test.
export function nativeConsumption(fixture, activity, usage = { consume: false }) {
  const { service, pool } = fixture;
  assert.equal(service.prepareNative(activity), true);
  assert.equal(service.prepareConsumption(activity, usage), true);
  const updates = { item: [], delete: [] };
  const charge = activity.consumption.targets[usage.consume?.resources?.[0]];
  if (charge) updates.item.push({ _id: pool.id, "system.uses.spent": pool.system.uses.spent + Number(charge.value) });
  assert.equal(service.validateConsumption(activity, updates), true);
  const delta = charge ? Number(charge.value) : 0;
  pool.system.uses.spent += delta;
  pool.system.uses.value -= delta;
  const message = { data: { system: { deltas: { item: { [pool.id]: [{ keyPath: "system.uses.spent", delta }] } } } } };
  service.recordConsumption(activity, message);
  return { updates, message, delta, usage };
}
