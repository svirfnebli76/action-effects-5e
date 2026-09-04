import assert from "node:assert/strict";
import test from "node:test";
import { WebItemValidator } from "../scripts/dev/web-item-validator.js";

function activity({ id, name, type, system = {} }) {
  return { id, uuid: `Item.web.Activity.${id}`, name, type, system };
}

function makeFixture({ saveOverride = true, savePrompt = false, burnOverride = true, castOverride = true } = {}) {
  const cast = activity({
    id: "cast-web",
    name: "Cast Web",
    type: "utility",
    system: {
      target: { override: castOverride, prompt: false },
      effects: []
    }
  });
  const save = activity({
    id: "web-save",
    name: "Web Save",
    type: "save",
    system: {
      target: { override: saveOverride, prompt: savePrompt },
      save: { ability: ["dex"], dc: { calculation: "spellcasting", formula: "" } },
      damage: { parts: [] },
      effects: [],
      consumption: { spellSlot: false, targets: [] }
    }
  });
  const burn = activity({
    id: "burning-web-damage",
    name: "Burning Web Damage",
    type: "damage",
    system: {
      target: { override: burnOverride, prompt: false },
      damage: { parts: [{ number: 2, denomination: 4, types: ["fire"] }] },
      save: { ability: [] },
      effects: [],
      consumption: { spellSlot: false, targets: [] }
    }
  });
  const restrained = {
    id: "restrained-by-web",
    uuid: "Item.web.ActiveEffect.restrained",
    documentName: "ActiveEffect",
    name: "Restrained by Web",
    transfer: false,
    statuses: new Set(["restrained"])
  };
  const item = {
    id: "web",
    uuid: "Item.web",
    documentName: "Item",
    type: "spell",
    flags: { "action-effects-5e": { animation: { automatedAnimations: "suppress" } } },
    effects: [restrained],
    system: {
      identifier: "web",
      source: { rules: "2024" },
      level: 2,
      school: "con",
      activation: { type: "action" },
      duration: { value: 1, units: "hour" },
      properties: new Set(["concentration", "vocal", "somatic", "material"]),
      range: { value: 60, units: "ft" },
      target: { template: { type: "cube", size: 20 } },
      activities: new Map([[cast.id, cast], [save.id, save], [burn.id, burn]])
    }
  };
  const escape = activity({
    id: "escape-web",
    name: "Escape Web",
    type: "check",
    system: {
      activation: { type: "action" },
      check: { ability: "str", associated: ["ath"] },
      damage: { parts: [] },
      effects: [],
      consumption: { spellSlot: true, targets: [] }
    }
  });
  const helper = {
    id: "escape-web-item",
    uuid: "Compendium.ae5e.admin.Item.escape",
    documentName: "Item",
    type: "feat",
    system: { activities: new Map([[escape.id, escape]]) }
  };
  return { item, helper };
}

async function validateFixture(options = {}) {
  const { item, helper } = makeFixture(options);
  const previous = globalThis.fromUuid;
  globalThis.fromUuid = async uuid => uuid === helper.uuid ? helper : null;
  try {
    return await new WebItemValidator().validate({ item, escapeTemplateUuid: helper.uuid });
  } finally {
    globalThis.fromUuid = previous;
  }
}

test("dev-only Web validator accepts the current source-Item authoring contract", async () => {
  const result = await validateFixture();
  assert.equal(result.passed, true, result.checks.filter(check => !check.passed).map(check => check.name).join("; "));
  assert.equal(result.activities.save, "Item.web.Activity.web-save");
  assert.equal(result.activities.escapeTemplate, "Compendium.ae5e.admin.Item.escape");
});

test("Web validator requires target.override=true and prompt=false on automation-only Activities", async () => {
  for (const variant of [
    { saveOverride: false },
    { savePrompt: true },
    { burnOverride: false },
    { castOverride: false }
  ]) {
    const result = await validateFixture(variant);
    assert.equal(result.passed, false);
    assert.ok(result.checks.some(check => !check.passed && /overrides parent targeting/.test(check.name)));
  }
});

test("Web validator requires an explicit authoritative external Escape Web helper", async () => {
  const { item } = makeFixture();
  const result = await new WebItemValidator().validate({ item, escapeTemplateUuid: null });
  assert.equal(result.passed, false);
  assert.equal(result.checks.find(check => check.name === "Authoritative Escape Web helper UUID is supplied")?.passed, false);
  assert.equal(result.checks.some(check => /Legacy Escape Web/.test(check.name)), false);
});
