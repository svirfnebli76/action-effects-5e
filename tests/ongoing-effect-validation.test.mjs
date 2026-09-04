import test from "node:test";
import assert from "node:assert/strict";

import { OngoingEffectService } from "../scripts/ongoing-effects/ongoing-effect-service.js";

function makeService() {
  const socket = { register() {} };
  return new OngoingEffectService({
    socket,
    authority: null,
    catSpell: null,
    selectionIndicator: null
  });
}

test("ongoing-effect config distinguishes invalid template UUID from missing grant source", () => {
  const service = makeService();

  assert.deepEqual(
    service.validateConfig({
      enabled: true,
      templateUuid: "Actor.bad.Item.bad"
    }),
    { valid: false, reason: "invalid-template-uuid" }
  );

  assert.deepEqual(
    service.validateConfig({ enabled: true }),
    { valid: false, reason: "missing-grant-source" }
  );

  assert.equal(
    service.validateConfig({
      enabled: true,
      templateUuid: "Compendium.action-effects-5e.ae5e-administrative.Item.escape"
    }).valid,
    true
  );

  assert.equal(
    service.validateConfig({
      enabled: true,
      sourceActivity: { activityReference: "escape" }
    }).valid,
    true
  );
});
