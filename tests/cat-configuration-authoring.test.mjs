import test from "node:test";
import assert from "node:assert/strict";
import {
  CAT_CONFIGURATION_SCHEMA_FLAG,
  CAT_CONFIGURATION_TYPES,
  CatConfigurationAuthoringService,
  parseCatConfigurationText,
  validateCatConfigurationData
} from "../scripts/authoring/cat-configuration-authoring-service.js";

function makeItem({ pack = "action-effects-5e.spells-level-2", isGM = true } = {}) {
  const item = {
    id: "item-1",
    uuid: "Compendium.action-effects-5e.spells-level-2.Item.item-1",
    documentName: "Item",
    name: "Misty Step",
    type: "spell",
    pack,
    system: { identifier: "misty-step", source: { rules: "2014" } },
    flags: {
      cat: {
        automation: { source: "action-effects-5e", version: "1.0.0" },
        config: { playAnimation: false }
      },
      "action-effects-5e": {}
    },
    async update(changes) {
      for (const [path, value] of Object.entries(changes)) {
        const keys = path.split(".");
        let target = this;
        while (keys.length > 1) {
          const key = keys.shift();
          target[key] ??= {};
          target = target[key];
        }
        target[keys[0]] = value;
      }
      return this;
    }
  };
  return { item, user: { isGM } };
}

function makeService(item, user = { isGM: true }, packs = new Map()) {
  return new CatConfigurationAuthoringService({
    fromUuidAccessor: async uuid => uuid === item?.uuid ? item : null,
    packsAccessor: () => packs,
    userAccessor: () => user
  });
}

const SAMPLE = {
  playAnimation: {
    label: "Play Animations",
    hint: "Play the AE5E visual animation.",
    type: "checkbox",
    default: true,
    category: "animation"
  }
};

test("CAT configuration editor accepts JSON-safe CAT schemas", () => {
  const result = validateCatConfigurationData(SAMPLE);
  assert.equal(result.valid, true);
  assert.equal(result.optionCount, 1);
  assert.equal(CAT_CONFIGURATION_TYPES.includes("checkbox"), true);
  assert.equal(CAT_CONFIGURATION_SCHEMA_FLAG, "flags.action-effects-5e.cat.configSchema");
});

test("CAT configuration parser rejects malformed JSON and invalid descriptors", () => {
  assert.equal(parseCatConfigurationText(JSON.stringify(SAMPLE)).valid, true);
  assert.equal(parseCatConfigurationText('{"playAnimation":').valid, false);
  assert.equal(validateCatConfigurationData({ probe: { type: "banana", default: true } }).valid, false);
  assert.equal(validateCatConfigurationData({ playAnimation: { type: "checkbox", default: "yes" } }).valid, false);
  assert.equal(validateCatConfigurationData({ mode: { type: "select", default: "one" } }).valid, false);
});

test("select and multi-select options must use static JSON option arrays", () => {
  const result = validateCatConfigurationData({
    mode: {
      label: "Mode",
      type: "select",
      default: "one",
      options: [
        { value: "one", label: "One" },
        { value: "two", label: "Two" }
      ]
    },
    targets: {
      label: "Targets",
      type: "select-many",
      default: ["one"],
      options: [{ value: "one", label: "One" }]
    }
  });
  assert.equal(result.valid, true);
  assert.equal(result.optionCount, 2);
});

test("configuration authoring writes only AE5E schema data and preserves CAT preferences", async () => {
  const { item, user } = makeItem();
  const transitions = [];
  const pack = {
    collection: item.pack,
    metadata: { id: item.pack, type: "Item" },
    locked: true,
    async configure({ locked }) {
      this.locked = Boolean(locked);
      transitions.push(this.locked);
    }
  };
  const service = makeService(item, user, new Map([[item.pack, pack]]));

  const beforePreference = JSON.stringify(item.flags.cat.config);
  const result = await service.setConfiguration(item, SAMPLE);
  assert.equal(result.validation.valid, true);
  assert.deepEqual(item.flags["action-effects-5e"].cat.configSchema, SAMPLE);
  assert.equal(JSON.stringify(item.flags.cat.config), beforePreference);
  assert.deepEqual(transitions, [false, true]);
  assert.equal(pack.locked, true);
});

test("configuration authoring is GM-only and public-pack-only", async () => {
  const playerFixture = makeItem({ isGM: false });
  const playerService = makeService(playerFixture.item, playerFixture.user);
  await assert.rejects(() => playerService.setConfiguration(playerFixture.item, SAMPLE), /requires a GM user/);

  const foreign = makeItem({ pack: "dnd5e.spells" });
  const gmService = makeService(foreign.item, foreign.user);
  await assert.rejects(() => gmService.setConfiguration(foreign.item, SAMPLE), /approved AE5E public compendiums/);
});
