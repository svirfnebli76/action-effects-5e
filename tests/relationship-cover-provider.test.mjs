import test from "node:test";
import assert from "node:assert/strict";

import {
  RELATIONSHIP_CONSTRAINT_STATES,
  RELATIONSHIP_COVER_PROVIDERS
} from "../scripts/core/constants.js";
import { RelationshipCoverProviderService } from "../scripts/relationships/relationship-cover-provider-service.js";

let selected = RELATIONSHIP_COVER_PROVIDERS.SIMPLE_COVER;
let simpleCalls = 0;
let levelsCalls = 0;
let simpleThrows = false;
let simpleOptions = null;

const modules = new Map([
  ["simplecover5e", {
    active: true,
    api: {
      async getCover(options) {
        simpleCalls += 1;
        simpleOptions = options;
        if (simpleThrows) throw new Error("simple failed");
        return { cover: "total", bonus: 99 };
      }
    }
  }],
  ["levelsautocover", {
    active: true,
    api: {
      async computeCover() {
        levelsCalls += 1;
        return { percent: 100, tier: { id: "total" } };
      }
    }
  }]
]);

globalThis.game = { modules };
globalThis.MidiQOL = { configSettings: () => ({ optionalRules: { coverCalculation: selected } }) };
globalThis.CONFIG = {
  Canvas: {
    polygonBackends: {
      sight: { testCollision: () => false }
    }
  }
};

const scene = { grid: { size: 100, distance: 5 } };
const leader = { x: 0, y: 0, elevation: 0, width: 1, height: 1 };
const follower = { x: 100, y: 0, elevation: 0, width: 1, height: 1 };

test("Midi's live cover selection is authoritative when both cover modules are installed", async () => {
  const service = new RelationshipCoverProviderService();
  simpleCalls = 0;
  levelsCalls = 0;
  selected = RELATIONSHIP_COVER_PROVIDERS.SIMPLE_COVER;
  const first = await service.evaluate({ provider: "midi", scene, leader, follower });
  assert.equal(first.state, RELATIONSHIP_CONSTRAINT_STATES.BROKEN);
  assert.equal(first.resolvedProvider, RELATIONSHIP_COVER_PROVIDERS.SIMPLE_COVER);
  assert.equal(simpleCalls, 1);
  assert.equal(levelsCalls, 0);
  assert.equal(simpleOptions.losCheck, false, "line of sight must remain an independent relationship constraint");

  selected = RELATIONSHIP_COVER_PROVIDERS.LEVELS_AUTO_COVER;
  const second = await service.evaluate({ provider: "midi", scene, leader, follower });
  assert.equal(second.state, RELATIONSHIP_CONSTRAINT_STATES.BROKEN);
  assert.equal(second.resolvedProvider, RELATIONSHIP_COVER_PROVIDERS.LEVELS_AUTO_COVER);
  assert.equal(simpleCalls, 1);
  assert.equal(levelsCalls, 1, "the provider is resolved again for each evaluation");
});

test("Foundry line-of-sight evaluation is independent from the configured cover provider", async () => {
  const service = new RelationshipCoverProviderService();
  const backend = globalThis.CONFIG.Canvas.polygonBackends.sight;
  const original = backend.testCollision;
  try {
    backend.testCollision = () => true;
    const blocked = await service.evaluateLineOfSight({ scene, leader, follower });
    assert.equal(blocked.state, RELATIONSHIP_CONSTRAINT_STATES.BROKEN);
    assert.equal(blocked.reason, "line-of-sight-blocked");
    assert.equal(blocked.lineOfSight, false);
    assert.equal(blocked.provider, RELATIONSHIP_COVER_PROVIDERS.FOUNDRY);

    backend.testCollision = () => false;
    const clear = await service.evaluateLineOfSight({ scene, leader, follower });
    assert.equal(clear.state, RELATIONSHIP_CONSTRAINT_STATES.CLEAR);
    assert.equal(clear.reason, "line-of-sight-clear");
    assert.equal(clear.lineOfSight, true);
  } finally {
    backend.testCollision = original;
  }
});

test("a failed selected provider falls back to Foundry geometry, never the other cover module", async () => {
  const service = new RelationshipCoverProviderService();
  simpleCalls = 0;
  levelsCalls = 0;
  selected = RELATIONSHIP_COVER_PROVIDERS.SIMPLE_COVER;
  simpleThrows = true;
  try {
    const result = await service.evaluate({ provider: "midi", scene, leader, follower });
    assert.equal(result.state, RELATIONSHIP_CONSTRAINT_STATES.CLEAR);
    assert.equal(result.resolvedProvider, RELATIONSHIP_COVER_PROVIDERS.SIMPLE_COVER);
    assert.equal(result.fallbackProvider, RELATIONSHIP_COVER_PROVIDERS.FOUNDRY);
    assert.equal(simpleCalls, 1);
    assert.equal(levelsCalls, 0);
  } finally {
    simpleThrows = false;
  }
});
