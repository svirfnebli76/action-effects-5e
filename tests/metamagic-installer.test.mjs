import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../examples/metamagic-stage-1/install.js", import.meta.url), "utf8");
const definitions = JSON.parse(fs.readFileSync(new URL("../examples/metamagic-stage-1/declarations.json", import.meta.url)));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function harness(prefix = "", responseOk = true) {
  const requested = [];
  const writes = [];
  const pool = { id: "pool", uuid: "Actor.test.Item.pool", system: { identifier: "sorcery-points", uses: { value: 4 } } };
  const actor = { uuid: "Actor.test", items: [pool], async createEmbeddedDocuments(type, data) {
    writes.push({ type, data });
    return data.map((item, index) => ({ ...item, uuid: `Actor.test.Item.${index}` }));
  } };
  const game = { user: { isGM: true }, modules: new Map([["action-effects-5e", { api: { metamagic: { reconcile: () => ({ ready: true }) } } }]]), macros: [] };
  const run = new AsyncFunction("game", "canvas", "foundry", "location", "fetch", "importModule", "Macro", "console",
    source.replace('await import(assetUrl("distant-spell.mjs"))', 'await importModule(assetUrl("distant-spell.mjs"))'));
  return { requested, writes, execute: () => run(game, { tokens: { controlled: [{ actor }] } },
    { utils: { getRoute: path => `${prefix}/${path}`.replace(/\/$/, "") } },
    { origin: "https://dnd.example.test" },
    async url => { requested.push(url); return { ok: responseOk, status: responseOk ? 200 : 404, json: async () => structuredClone(definitions) }; },
    async url => { requested.push(url); return { distantSpell: async function () {} }; },
    { async create(data) { writes.push({ type: "Macro", data }); return { uuid: "Macro.test", async delete() {} }; } },
    { log() {} }) };
}

for (const prefix of ["", "/foundry"]) {
  test(`installer resolves complete asset paths with route prefix '${prefix}'`, async () => {
    const h = harness(prefix);
    await h.execute();
    assert.deepEqual(h.requested, [
      `https://dnd.example.test${prefix}/modules/action-effects-5e/examples/metamagic-stage-1/declarations.json`,
      `https://dnd.example.test${prefix}/modules/action-effects-5e/examples/metamagic-stage-1/distant-spell.mjs`
    ]);
    assert.equal(h.writes.length, 2);
    const items = h.writes.find(write => write.type === "Item").data;
    assert.equal(items.length, 2);
    assert.equal(items[0].flags["action-effects-5e"].metamagic.resource.itemId, "pool");
    assert.equal(items[1].flags["action-effects-5e"].metamagic.execution.macroUuid, "Macro.test");
  });
}

test("asset failure rejects the awaited installer before any world writes", async () => {
  const h = harness("", false);
  await assert.rejects(h.execute(), /Declaration fixture download failed \(404\)/);
  assert.deepEqual(h.writes, []);
});
