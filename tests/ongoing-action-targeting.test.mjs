import test from "node:test";
import assert from "node:assert/strict";

import {
  MODULE_ID,
  ONGOING_ACTION_ECONOMY_TYPES,
  ONGOING_ACTION_EFFECT_FLAG,
  ONGOING_ACTION_ITEM_FLAG
} from "../scripts/core/constants.js";
import { OngoingEffectService } from "../scripts/ongoing-effects/ongoing-effect-service.js";

const documents = new Map();
globalThis.fromUuid = async uuid => documents.get(uuid) ?? null;
globalThis.foundry = {
  utils: {
    deepClone: value => structuredClone(value),
    getProperty: (object, path) => path.split(".").reduce((value, part) => value?.[part], object),
    setProperty(object, path, value) {
      const parts = path.split(".");
      const leaf = parts.pop();
      let current = object;
      for (const part of parts) current = current[part] ??= {};
      current[leaf] = value;
      return true;
    }
  },
  applications: { api: {} }
};
globalThis.CONFIG = {
  DND5E: {
    activityActivationTypes: {
      bonus: { group: "DND5E.ACTIVATION.Category.Standard" }
    }
  }
};
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 } };
globalThis.canvas = { ready: false };
globalThis.ui = { notifications: { info() {} } };

function fixture() {
  const calls = { targets: null, used: 0, checked: 0, prompts: [] };
  const actor = {
    uuid: "Actor.caster",
    statuses: new Set(),
    getActiveTokens: () => []
  };
  const activity = {
    id: "ongoing-damage",
    uuid: "Actor.caster.Item.helper.Activity.ongoing-damage",
    activation: { type: "bonus", value: 1 },
    canUse: true
  };
  const activities = new Map([[activity.id, activity]]);
  const effect = {
    id: "effect",
    uuid: "Actor.caster.ActiveEffect.effect",
    parent: actor,
    name: "Ongoing Link",
    flags: {
      [MODULE_ID]: {
        [ONGOING_ACTION_EFFECT_FLAG]: {
          enabled: true,
          sourceActivity: { activityReference: "ongoing-damage" },
          activityIdentifier: activity.id,
          targetTokenUuids: ["Scene.test.Token.target"],
          indicatorTokenUuid: "Scene.test.Token.caster",
          requiredRelationshipId: "relationship-live",
          actionEconomy: {
            type: ONGOING_ACTION_ECONOMY_TYPES.BONUS_ACTION,
            requireAvailable: true,
            markUsed: true
          },
          timing: "turnStart"
        }
      }
    },
    getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
  };
  const item = {
    id: "helper",
    uuid: "Actor.caster.Item.helper",
    actor,
    parent: actor,
    name: "Apply Ongoing Damage",
    system: { activities },
    flags: {
      [MODULE_ID]: {
        [ONGOING_ACTION_ITEM_FLAG]: {
          sourceEffectUuid: effect.uuid,
          activityIdentifier: activity.id
        }
      }
    },
    getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
  };
  activity.item = item;
  const targetObject = { id: "target-placeable" };
  const target = {
    documentName: "Token",
    uuid: "Scene.test.Token.target",
    object: targetObject
  };
  const indicatorObject = { id: "caster-placeable" };
  const indicator = {
    documentName: "Token",
    uuid: "Scene.test.Token.caster",
    object: indicatorObject
  };
  documents.set(effect.uuid, effect);
  documents.set(item.uuid, item);
  documents.set(target.uuid, target);
  documents.set(indicator.uuid, indicator);

  const socket = {
    register() {},
    async executeAsUser(_name, _userId, payload) {
      calls.prompts.push(payload);
      return { prompted: true };
    }
  };
  const catSpell = {
    getStatus: () => ({ active: true, capabilities: { completeActivityUse: true } }),
    async completeActivityUse(_activity, targets) {
      calls.targets = targets;
      return { id: "workflow" };
    }
  };
  const relationships = { get: id => id === "relationship-live" ? { id } : null };
  globalThis.game = {
    user: { id: "gm", isGM: true },
    users: [{ id: "gm", isGM: true, active: true }],
    modules: new Map(),
    settings: { get: () => false }
  };
  game.users.activeGM = game.users[0];
  globalThis.MidiQOL = {
    hasUsedBonusAction() { calls.checked += 1; return false; },
    async setBonusActionUsed() { calls.used += 1; }
  };

  const service = new OngoingEffectService({
    socket,
    authority: { getPrimaryGm: () => ({ id: "gm" }), isPrimary: () => true },
    catSpell,
    selectionIndicator: null,
    relationships
  });
  return { service, actor, activity, effect, item, targetObject, calls };
}

test("ongoing actions revalidate relationship, explicit target, and Bonus Action immediately before execution", async () => {
  const f = fixture();
  const result = await f.service.executeGrantedItem(f.item, f.effect, { claimKey: "turn-1" });
  assert.equal(result.executed, true);
  assert.equal(result.via, "cat");
  assert.deepEqual([...f.calls.targets], [f.targetObject]);
  assert.ok(f.calls.checked >= 1);
  assert.equal(f.calls.used, 1);
});

test("an already-used Bonus Action blocks execution without targeting or marking it again", async () => {
  const f = fixture();
  MidiQOL.hasUsedBonusAction = () => true;
  const result = await f.service.executeGrantedItem(f.item, f.effect, { claimKey: "turn-2" });
  assert.equal(result.executed, false);
  assert.equal(result.reason, "activity-unusable");
  assert.equal(result.usability.reason, "bonus-action-used");
  assert.equal(f.calls.targets, null);
  assert.equal(f.calls.used, 0);
});

test("turn prompts carry the explicit selection-indicator token UUID", async () => {
  const f = fixture();
  await f.service.promptForEffect(f.effect, f.item, { combat: { id: "combat", round: 1, turn: 0 } });
  assert.equal(f.calls.prompts.length, 1);
  assert.equal(f.calls.prompts[0].indicatorTokenUuid, "Scene.test.Token.caster");
});

test("turn-start prompts wait for Midi to clear the previous turn's Bonus Action marker", async () => {
  const f = fixture();
  f.effect.flags[MODULE_ID][ONGOING_ACTION_EFFECT_FLAG].suppressPromptWhenUnusable = true;
  let bonusActionUsed = true;
  MidiQOL.hasUsedBonusAction = () => {
    f.calls.checked += 1;
    return bonusActionUsed;
  };
  const reset = globalThis.setTimeout(() => { bonusActionUsed = false; }, 20);

  const result = await f.service.promptForEffect(f.effect, f.item, {
    combat: { id: "combat", round: 2, turn: 0 }
  });
  globalThis.clearTimeout(reset);

  assert.equal(result.prompted, true);
  assert.equal(f.calls.prompts.length, 1);
  assert.ok(f.calls.checked >= 2);
});

test("ongoing-action config validates reusable targeting and action-economy fields", () => {
  const f = fixture();
  const base = { sourceActivity: { activityReference: "action" } };
  assert.equal(f.service.validateConfig({ ...base, targetTokenUuids: ["bad"] }).reason, "invalid-target-token-uuids");
  assert.equal(f.service.validateConfig({ ...base, indicatorTokenUuid: "bad" }).reason, "invalid-indicator-token-uuid");
  assert.equal(f.service.validateConfig({ ...base, actionEconomy: { type: "action" } }).reason, "invalid-action-economy-type");
  assert.equal(f.service.validateConfig({
    ...base,
    targetTokenUuids: ["Scene.test.Token.target"],
    indicatorTokenUuid: "Scene.test.Token.caster",
    requiredRelationshipId: "relationship-live",
    actionEconomy: { type: "bonusAction", requireAvailable: true, markUsed: true }
  }).valid, true);
});
