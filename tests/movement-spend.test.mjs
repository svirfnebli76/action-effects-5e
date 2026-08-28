import test from "node:test";
import assert from "node:assert/strict";

let idCounter = 0;

class FakeTokenDocument {
  constructor({ uuid = "Scene.scene.Token.token", ownerIds = ["gm"], shouldRecordMovementHistory = true } = {}) {
    this.uuid = uuid;
    this.id = uuid.split(".").at(-1);
    this.x = 100;
    this.y = 200;
    this.elevation = 0;
    this.width = 1;
    this.height = 1;
    this.depth = 1;
    this.shape = "rectangle";
    this.level = "";
    this.movementAction = "walk";
    this.movementHistory = [];
    this.ownerIds = new Set(ownerIds);
    this.updateCalls = [];
    this.shouldRecordMovementHistory = shouldRecordMovementHistory;
    this.clearCalls = 0;
  }


  _shouldRecordMovementHistory() {
    return this.shouldRecordMovementHistory;
  }

  async clearMovementHistory() {
    this.clearCalls += 1;
    this.movementHistory = [];
    return this;
  }

  getCompleteMovementPath([point]) {
    return [{
      x: point.x,
      y: point.y,
      elevation: point.elevation,
      width: this.width,
      height: this.height,
      depth: this.depth,
      shape: this.shape,
      level: this.level,
      action: point.action ?? "walk",
      checkpoint: point.checkpoint ?? false,
      explicit: point.explicit ?? false,
      intermediate: false,
      snapped: point.snapped ?? false,
      terrain: null
    }];
  }

  async update(changes, options = {}) {
    this.updateCalls.push({
      changes: structuredClone(changes ?? {}),
      options: structuredClone(options ?? {})
    });

    // Mirror Foundry v14 TokenDocument#preUpdateMovement: direct history
    // writes are stripped unless the operation uses the explicit undo gate.
    if (Array.isArray(changes?._movementHistory) && options?.isUndo === true) {
      this.movementHistory = structuredClone(changes._movementHistory);
    }
    return this;
  }

  testUserPermission(user) {
    return Boolean(user?.isGM || this.ownerIds.has(user?.id));
  }
}

class FakeSocket {
  constructor(gm) {
    this.gm = gm;
    this.handlers = new Map();
    this.ready = true;
  }

  register(name, handler) {
    this.handlers.set(name, handler);
  }

  async executeAsGM(name, payload) {
    const prior = game.user;
    game.user = this.gm;
    try {
      return await this.handlers.get(name)(payload);
    } finally {
      game.user = prior;
    }
  }
}

class FakeUsers extends Map {}

const gm = { id: "gm", isGM: true, active: true };
const player = { id: "player", isGM: false, active: true };
const outsider = { id: "outsider", isGM: false, active: true };
const users = new FakeUsers([[gm.id, gm], [player.id, player], [outsider.id, outsider]]);
users.activeGM = gm;

globalThis.foundry = {
  documents: { TokenDocument: FakeTokenDocument },
  utils: {
    deepClone: (value) => structuredClone(value),
    randomID: (length = 16) => String(++idCounter).padStart(length, "0")
  }
};

globalThis.CONFIG = {
  Token: { movement: { defaultAction: "walk" } }
};

globalThis.CONST = {
  DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 },
  TOKEN_SHAPES: { RECTANGLE: "rectangle" }
};

globalThis.game = {
  user: gm,
  users,
  settings: { get: () => false }
};

const { MovementSpendService } = await import("../scripts/movement/movement-spend-service.js");

function makeAccounting() {
  return {
    getHistorySnapshot(document) {
      return structuredClone(document.movementHistory);
    },
    getHistoryCost(document) {
      return document.movementHistory.reduce((total, waypoint) => total + Number(waypoint?.cost ?? 0), 0);
    }
  };
}

function createFixture({ ownerIds = ["gm", "player"], shouldRecordMovementHistory = true } = {}) {
  const document = new FakeTokenDocument({ ownerIds, shouldRecordMovementHistory });
  const documents = new Map([[document.uuid, document]]);
  const socket = new FakeSocket(gm);
  const service = new MovementSpendService({
    socket,
    accounting: makeAccounting(),
    resolver: async (uuid) => documents.get(uuid) ?? null
  });
  return { document, socket, service };
}

test("non-positional spend records exact cost without changing token position and rollback restores history", async () => {
  game.user = gm;
  const { document, service } = createFixture();
  document.movementHistory = [{
    x: 100, y: 200, elevation: 0, width: 1, height: 1, depth: 1, shape: "rectangle", level: "",
    action: "walk", checkpoint: true, explicit: true, intermediate: false, snapped: true, terrain: null,
    cost: 10, movementId: "existing00000001", subpathId: "existing00000001", userId: "gm"
  }];
  const before = structuredClone(document.movementHistory);
  const position = { x: document.x, y: document.y, elevation: document.elevation };

  const receipt = await service.spend(document, 15, { reason: "stand-from-prone" });

  assert.equal(receipt.amount, 15);
  assert.equal(receipt.beforeCost, 10);
  assert.equal(receipt.afterCost, 25);
  assert.equal(document.movementHistory.reduce((sum, entry) => sum + entry.cost, 0), 25);
  assert.deepEqual({ x: document.x, y: document.y, elevation: document.elevation }, position);
  assert.equal(document.movementHistory.at(-1).movementId, receipt.movementId);
  assert.equal(document.movementHistory.at(-1).cost, 15);
  assert.equal(document.updateCalls.at(-1)?.options?.isUndo, true);
  assert.equal(document.updateCalls.at(-1)?.options?.diff, false);
  assert.equal(document.updateCalls.at(-1)?.options?.animate, false);

  const rollback = await service.rollbackSpend(receipt);
  assert.equal(rollback.rolledBack, true);
  assert.equal(document.updateCalls.at(-1)?.options?.isUndo, true);
  assert.deepEqual(document.movementHistory, before);
  assert.deepEqual({ x: document.x, y: document.y, elevation: document.elevation }, position);
});

test("rollback removes only its receipt and preserves later native movement history", async () => {
  game.user = gm;
  const { document, service } = createFixture();
  const receipt = await service.spend(document, 15, { reason: "stand-from-prone" });
  document.movementHistory.push({
    x: 200, y: 200, elevation: 0, width: 1, height: 1, depth: 1, shape: "rectangle", level: "",
    action: "walk", checkpoint: true, explicit: true, intermediate: false, snapped: true, terrain: null,
    cost: 5, movementId: "later00000000001", subpathId: "later00000000001", userId: "gm"
  });

  const rollback = await service.rollbackSpend(receipt);
  assert.equal(rollback.rolledBack, true);
  assert.equal(document.movementHistory.length, 1);
  assert.equal(document.movementHistory[0].movementId, "later00000000001");
  assert.equal(document.movementHistory[0].cost, 5);
});

test("player-owned token spending routes to GM authority using serializable data", async () => {
  const { document, service } = createFixture({ ownerIds: ["gm", "player"] });
  game.user = player;

  const receipt = await service.spend(document, 15, { reason: "player-stand" });

  assert.equal(receipt.requestedByUserId, "player");
  assert.equal(document.movementHistory.at(-1).cost, 15);
  assert.equal(service.getStats().routedToGm, 1);

  const rollback = await service.rollbackSpend(receipt);
  assert.equal(rollback.rolledBack, true);
  assert.equal(service.getStats().routedToGm, 2);
  assert.equal(document.movementHistory.length, 0);
});

test("GM authority rejects a player who does not own the token", async () => {
  const { document, service } = createFixture({ ownerIds: ["gm", "player"] });
  game.user = outsider;

  await assert.rejects(
    () => service.spend(document, 15, { reason: "unauthorized" }),
    /does not own the Token/
  );
  assert.equal(document.movementHistory.length, 0);
  assert.equal(service.getStats().permissionDenied, 1);
});

test("receipt rollback is idempotent after the charge has already been removed", async () => {
  game.user = gm;
  const { document, service } = createFixture();
  const receipt = await service.spend(document, 15);
  assert.equal((await service.rollbackSpend(receipt)).rolledBack, true);

  const second = await service.rollbackSpend(receipt);
  assert.equal(second.rolledBack, false);
  assert.equal(second.reason, "receipt-not-present");
  assert.equal(document.movementHistory.length, 0);
});


test("Foundry-style ordinary history updates are stripped by the fixture", async () => {
  game.user = gm;
  const { document } = createFixture();
  await document.update({
    _movementHistory: [{ cost: 15, movementId: "ordinary00000001" }]
  });
  assert.equal(document.movementHistory.length, 0);
});


test("ledger reconciliation re-anchors stale active-turn history while preserving spent movement", async () => {
  game.user = gm;
  const { document, service } = createFixture({ shouldRecordMovementHistory: true });
  document.x = 300;
  document.y = 400;
  document.movementHistory = [{
    x: 100, y: 200, elevation: 0, width: 1, height: 1, depth: 1, shape: "rectangle", level: "",
    action: "walk", checkpoint: true, explicit: true, intermediate: false, snapped: true, terrain: null,
    cost: 20, movementId: "stale00000000001", subpathId: "stale00000000001", userId: "player"
  }];

  const result = await service.reconcileLedgerAsAuthority(document, {
    requestedByUserId: "player",
    reason: "grapple-start"
  });

  assert.equal(result.reconciled, true);
  assert.equal(result.reason, "reanchored-preserving-cost");
  assert.equal(result.preservedCost, 20);
  assert.equal(document.clearCalls, 1);
  assert.equal(document.movementHistory.length, 1);
  assert.deepEqual(
    { x: document.movementHistory[0].x, y: document.movementHistory[0].y, elevation: document.movementHistory[0].elevation },
    { x: 300, y: 400, elevation: 0 }
  );
  assert.equal(document.movementHistory[0].cost, 20);
  assert.equal(service.getStats().reconciliationsCommitted, 1);
});

test("ledger reconciliation clears stale history outside active movement recording without preserving old cost", async () => {
  game.user = gm;
  const { document, service } = createFixture({ shouldRecordMovementHistory: false });
  document.x = 300;
  document.y = 400;
  document.movementHistory = [{
    x: 100, y: 200, elevation: 0, width: 1, height: 1, depth: 1, shape: "rectangle", level: "",
    action: "walk", checkpoint: true, explicit: true, intermediate: false, snapped: true, terrain: null,
    cost: 70, movementId: "stale00000000002", subpathId: "stale00000000002", userId: "player"
  }];

  const result = await service.reconcileLedgerAsAuthority(document, { requestedByUserId: "player" });

  assert.equal(result.reconciled, true);
  assert.equal(result.reason, "cleared-stale-history");
  assert.equal(result.preservedCost, 0);
  assert.equal(document.clearCalls, 1);
  assert.deepEqual(document.movementHistory, []);
});

test("strict ledger reconciliation clears aligned history while movement recording is inactive", async () => {
  game.user = gm;
  const { document, service } = createFixture({ shouldRecordMovementHistory: false });
  document.movementHistory = [{
    x: document.x, y: document.y, elevation: document.elevation, width: 1, height: 1, depth: 1, shape: "rectangle", level: "",
    action: "action-effects-5e.no-cost", checkpoint: true, explicit: true, intermediate: false, snapped: true, terrain: null,
    cost: 5, movementId: "alignedsynthetic01", subpathId: "alignedsynthetic01", userId: "player"
  }];

  const result = await service.reconcileLedgerAsAuthority(document, {
    requestedByUserId: "player",
    reason: "grapple-translation",
    clearInactiveHistory: true
  });

  assert.equal(result.reconciled, true);
  assert.equal(result.reason, "cleared-inactive-history");
  assert.equal(result.preservedCost, 0);
  assert.equal(document.clearCalls, 1);
  assert.deepEqual(document.movementHistory, []);
});

test("ledger reconciliation leaves healthy history untouched", async () => {
  game.user = gm;
  const { document, service } = createFixture({ shouldRecordMovementHistory: true });
  document.movementHistory = [{
    x: document.x, y: document.y, elevation: document.elevation, width: 1, height: 1, depth: 1, shape: "rectangle", level: "",
    action: "walk", checkpoint: true, explicit: true, intermediate: false, snapped: true, terrain: null,
    cost: 10, movementId: "healthy000000001", subpathId: "healthy000000001", userId: "player"
  }];

  const result = await service.reconcileLedgerAsAuthority(document, { requestedByUserId: "player" });

  assert.equal(result.reconciled, false);
  assert.equal(result.reason, "already-aligned");
  assert.equal(document.clearCalls, 0);
  assert.equal(document.movementHistory[0].cost, 10);
});
