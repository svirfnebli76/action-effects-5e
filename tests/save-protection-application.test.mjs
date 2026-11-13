import assert from "node:assert/strict";
import test from "node:test";
import { SaveProtectionApplicationService } from "../scripts/save-protection/application-service.js";

let nextId = 0;
globalThis.foundry = { utils: { randomID: () => `save-claim-${++nextId}` } };

const token = id => ({ document: { uuid: `Scene.test.Token.${id}` } });
const request = (...tokens) => ({
  tokenUuids: tokens.map(entry => entry.document.uuid),
  automaticSuccess: true,
  superSaver: true
});

function workflow() {
  const friend = token("friend");
  const enemy = token("enemy");
  return {
    friend,
    enemy,
    subject: {
      id: "Workflow.save",
      targets: new Set([friend, enemy]),
      hitTargets: new Set([friend, enemy]),
      superSavers: new Set(),
      checkSculptOrCarefulSpells() { return false; }
    }
  };
}

test("independent save-protection claims compose and rollback without removing another feature", () => {
  const service = new SaveProtectionApplicationService();
  const { subject, friend, enemy } = workflow();
  const first = service.install(subject, request(friend), { label: "Sculpt Spells" });
  const second = service.install(subject, request(friend, enemy), { label: "Careful Spell" });

  assert.equal(subject.checkSculptOrCarefulSpells(friend), true);
  assert.equal(subject.checkSculptOrCarefulSpells(enemy), true);
  assert.equal(subject.superSavers.has(friend), true);
  assert.equal(subject.superSavers.has(enemy), true);

  assert.equal(service.rollback(subject, second), true);
  assert.equal(subject.checkSculptOrCarefulSpells(friend), true);
  assert.equal(subject.checkSculptOrCarefulSpells(enemy), false);
  assert.equal(subject.superSavers.has(friend), true);
  assert.equal(subject.superSavers.has(enemy), false);

  assert.equal(service.rollback(subject, first), true);
  assert.equal(subject.checkSculptOrCarefulSpells(friend), false);
  assert.equal(subject.superSavers.has(friend), false);
});

test("post-save restoration removes the workflow override but preserves super-saver damage state", () => {
  const service = new SaveProtectionApplicationService();
  const { subject, friend } = workflow();
  service.install(subject, request(friend));
  assert.equal(service.restore(subject), true);
  assert.equal(subject.checkSculptOrCarefulSpells(friend), false);
  assert.equal(subject.superSavers.has(friend), true);
  assert.equal(service.restore(subject), false);
});

test("validation rejects unsupported semantics and creatures outside finalized affected targets", () => {
  const service = new SaveProtectionApplicationService();
  const { subject, friend } = workflow();
  assert.throws(() => service.validate(subject, {
    ...request(friend),
    automaticSuccess: false
  }), /unsupported save-protection semantics/i);
  assert.throws(() => service.validate(subject, {
    tokenUuids: ["Scene.test.Token.missing"],
    automaticSuccess: true,
    superSaver: true
  }), /outside the finalized affected targets/i);
});

test("cleanup hooks restore an installed override idempotently", () => {
  const handlers = new Map();
  const previousHooks = globalThis.Hooks;
  globalThis.Hooks = {
    on(name, callback) { handlers.set(name, callback); return name; },
    off(name) { handlers.delete(name); }
  };
  try {
    const service = new SaveProtectionApplicationService();
    service.initialize();
    service.initialize();
    assert.deepEqual([...handlers.keys()], [
      "midi-qol.postCheckSaves",
      "midi-qol.RollComplete",
      "midi-qol.premades.postRollFinished"
    ]);
    const { subject, friend } = workflow();
    service.install(subject, request(friend));
    assert.equal(handlers.get("midi-qol.postCheckSaves")(subject), undefined);
    assert.equal(subject.checkSculptOrCarefulSpells(friend), false);
    assert.equal(handlers.get("midi-qol.RollComplete")(subject), undefined);
    assert.equal(handlers.get("midi-qol.premades.postRollFinished")(subject), undefined);
    service.shutdown();
    assert.equal(handlers.size, 0);
  } finally {
    globalThis.Hooks = previousHooks;
  }
});
