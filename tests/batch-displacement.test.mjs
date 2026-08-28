import test from "node:test";
import assert from "node:assert/strict";

class TokenDocument {}
globalThis.foundry = {
  documents: { TokenDocument },
  utils: {
    randomID: (length = 16) => "x".repeat(length),
    deepClone: (value) => structuredClone(value)
  }
};
globalThis.CONFIG = { Token: { movement: { defaultAction: "walk" } } };
globalThis.CONST = { GRID_TYPES: { SQUARE: 1 } };
globalThis.Hooks = { callAll: () => {} };

const gm = { id: "gm", active: true, isGM: true };
globalThis.game = { user: gm, users: new Map([[gm.id, gm]]) };

const documents = new Map();
globalThis.fromUuid = async (uuid) => documents.get(uuid) ?? null;

const { BatchDisplacementService } = await import("../scripts/displacement/batch-displacement-service.js");

test("batch push plans all targets and commits one Scene.moveTokens operation", async () => {
  const moveCalls = [];
  const scene = {
    id: "scene",
    grid: { type: 1, size: 100, distance: 5 },
    tokens: [],
    async moveTokens(instructions, options) {
      moveCalls.push({ instructions, options });
      return Object.fromEntries(Object.keys(instructions).map((id) => [id, true]));
    }
  };
  scene.tokens.get = (id) => scene.tokens.find((token) => token.id === id);
  const makeToken = (id, x, y) => {
    const token = new TokenDocument();
    Object.assign(token, {
      id,
      uuid: `Scene.scene.Token.${id}`,
      x,
      y,
      elevation: 0,
      width: 1,
      height: 1,
      parent: scene,
      object: {},
      actor: { testUserPermission: () => true }
    });
    documents.set(token.uuid, token);
    scene.tokens.push(token);
    return token;
  };
  const source = makeToken("source", 0, 0);
  const first = makeToken("first", 100, 0);
  const second = makeToken("second", 100, 300);
  globalThis.canvas = { ready: true, scene };

  const handlers = new Map();
  const socket = {
    register: (name, handler) => handlers.set(name, handler),
    executeAsGM: (name, payload) => handlers.get(name)(payload)
  };
  const movement = {
    createOperationOptions: (metadata) => ({ actionEffects5e: metadata }),
    registerMovementContext: () => () => {}
  };
  const accounting = {
    noCostActionId: "action-effects-5e.no-cost",
    ensureRegistered: () => {},
    applyNoCostToInstruction: () => {}
  };
  const planner = {
    buildCandidates: ({ targetToken }) => ({
      candidates: [{
        key: `destination-${targetToken.id}`,
        pathKey: "E>E",
        selectable: true,
        requestedDistance: 10,
        actualDistance: 10,
        directionKey: "E",
        directionPath: ["E", "E"],
        path: [
          { x: targetToken.x + 100, y: targetToken.y, elevation: 0 },
          { x: targetToken.x + 200, y: targetToken.y, elevation: 0 }
        ],
        destination: { x: targetToken.x + 200, y: targetToken.y, elevation: 0 }
      }]
    })
  };
  const service = new BatchDisplacementService({ socket, movement, accounting, planner });
  const result = await service.push({
    sourceUuid: source.uuid,
    targetUuids: [first.uuid, second.uuid],
    distance: 10
  });

  assert.equal(result.completed, true);
  assert.equal(result.movedCount, 2);
  assert.equal(moveCalls.length, 1);
  assert.deepEqual(new Set(Object.keys(moveCalls[0].instructions)), new Set([first.id, second.id]));
  assert.equal(moveCalls[0].options.actionEffects5e.agency, "forced");
  assert.equal(moveCalls[0].options.actionEffects5e.resource, "none");
  assert.equal(moveCalls[0].options.constrainOptions.ignoreTokens, true);
});
