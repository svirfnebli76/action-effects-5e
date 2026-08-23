import test from "node:test";
import assert from "node:assert/strict";

class FakeUsers extends Map {
  [Symbol.iterator]() { return this.values(); }
  find(predicate) { return [...this.values()].find(predicate); }
}

function makeHooks() {
  let counter = 0;
  const events = new Map();
  return {
    on(name, handler) {
      const id = ++counter;
      if (!events.has(name)) events.set(name, new Map());
      events.get(name).set(id, handler);
      return id;
    },
    off(name, id) { events.get(name)?.delete(id); },
    callAll(name, ...args) {
      for (const handler of events.get(name)?.values() ?? []) handler(...args);
    }
  };
}

class FakeSocket {
  constructor({ hangingUserId = null } = {}) {
    this.handlers = new Map();
    this.calls = [];
    this.hangingUserId = hangingUserId;
  }

  register(name, handler) {
    this.handlers.set(name, handler);
  }

  async executeAsUser(name, userId, payload) {
    this.calls.push({ name, userId, payload: structuredClone(payload) });
    if (userId === this.hangingUserId) return new Promise(() => {});
    const handler = this.handlers.get(name);
    if (!handler) throw new Error(`Missing fake handler ${name}`);
    const prior = game.user;
    game.user = game.users.get(userId);
    try {
      return await handler(payload);
    } finally {
      game.user = prior;
    }
  }
}

function setupGame({ currentUserId = "gm", playerActive = true } = {}) {
  const users = new FakeUsers();
  const gm = { id: "gm", name: "GM", active: true, isGM: true, isActiveGM: true };
  const player = { id: "player", name: "Player", active: playerActive, isGM: false };
  const initiator = { id: "initiator", name: "Initiator", active: true, isGM: false };
  users.set(gm.id, gm);
  users.set(player.id, player);
  users.set(initiator.id, initiator);
  users.activeGM = gm;
  globalThis.game = { users, user: users.get(currentUserId) };
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 } };
  globalThis.Hooks = makeHooks();
  return { users, gm, player, initiator };
}

function makeActor({ playerId = "player" } = {}) {
  return {
    uuid: "Actor.target",
    testUserPermission(user, level) {
      return level === 3 && user?.id === playerId;
    }
  };
}

function makeToken(actor) {
  return {
    document: {
      uuid: "Scene.scene.Token.target",
      actor,
      testUserPermission: actor.testUserPermission.bind(actor)
    }
  };
}

function makeSelectionIndicator({ select = "str" } = {}) {
  const calls = [];
  return {
    calls,
    async waitForDialog(options) {
      calls.push(options);
      const button = options.config.buttons.find(entry => {
        if (select == null) return entry.action === "cancel";
        return entry.callback?.() === select;
      });
      if (!button) return null;
      return button.callback();
    }
  };
}

const { ChoicePromptService } = await import("../scripts/ui/choice-prompt-service.js");
const { SELECTION_INDICATOR_ROLES } = await import("../scripts/core/constants.js");

test("choice prompt validates unique serializable choices", () => {
  setupGame();
  const socket = new FakeSocket();
  const service = new ChoicePromptService({
    socket,
    selectionIndicator: makeSelectionIndicator(),
    authority: { getPrimaryGm: () => game.users.get("gm") }
  });

  assert.equal(service.validateRequest({
    title: "Shove Saving Throw",
    prompt: "Choose the ability.",
    choices: [{ id: "str", label: "Strength" }, { id: "dex", label: "Dexterity" }]
  }).valid, true);
  assert.equal(service.validateRequest({
    title: "Shove Saving Throw",
    prompt: "Choose the ability.",
    choices: [{ id: "str", label: "Strength" }, { id: "str", label: "Dexterity" }]
  }).reason, "duplicate-choice-id");
});

test("choice prompt routes to an active non-GM owner and returns only the choice id", async () => {
  setupGame({ currentUserId: "gm", playerActive: true });
  const socket = new FakeSocket();
  const selectionIndicator = makeSelectionIndicator({ select: "str" });
  const service = new ChoicePromptService({
    socket,
    selectionIndicator,
    authority: { getPrimaryGm: () => game.users.get("gm") }
  });
  const actor = makeActor();
  const token = makeToken(actor);

  const choice = await service.choose({
    actor,
    token,
    title: "Shove Saving Throw",
    prompt: "Choose the ability you would like to use for this saving throw.",
    choices: [
      { id: "str", label: "Strength", detail: "+2" },
      { id: "dex", label: "Dexterity", detail: "+3" }
    ]
  });

  assert.equal(choice, "str");
  assert.equal(socket.calls[0].userId, "player");
  assert.deepEqual(Object.keys(socket.calls[0].payload).includes("actor"), false);
  assert.deepEqual(Object.keys(socket.calls[0].payload).includes("token"), false);
  assert.equal(selectionIndicator.calls[0].tokenUuid, "Scene.scene.Token.target");
  assert.equal(selectionIndicator.calls[0].role, SELECTION_INDICATOR_ROLES.RESPONDER);
  assert.equal(selectionIndicator.calls[0].notifyUserId, "player");
  assert.equal(service.getStats().playerControllers, 1);
  assert.equal(service.getStats().remotePrompts, 1);
});

test("choice prompt falls back to the active GM when the actor owner is offline", async () => {
  setupGame({ currentUserId: "initiator", playerActive: false });
  const socket = new FakeSocket();
  const selectionIndicator = makeSelectionIndicator({ select: "dex" });
  const service = new ChoicePromptService({
    socket,
    selectionIndicator,
    authority: { getPrimaryGm: () => game.users.get("gm") }
  });
  const actor = makeActor();
  const token = makeToken(actor);

  const controller = await service.resolveController({ actor, token });
  assert.equal(controller.userId, "gm");
  assert.equal(controller.reason, "gm-fallback");

  const choice = await service.choose({
    actor,
    token,
    title: "Shove Saving Throw",
    prompt: "Choose Strength or Dexterity.",
    choices: [
      { id: "str", label: "Strength" },
      { id: "dex", label: "Dexterity" }
    ]
  });

  assert.equal(choice, "dex");
  assert.equal(socket.calls[0].userId, "gm");
  assert.equal(service.getStats().gmFallbacks, 1);
});

test("choice prompt reroutes an interrupted remote player prompt to the active GM", async () => {
  const { player } = setupGame({ currentUserId: "initiator", playerActive: true });
  const socket = new FakeSocket({ hangingUserId: "player" });
  const selectionIndicator = makeSelectionIndicator({ select: "str" });
  const service = new ChoicePromptService({
    socket,
    selectionIndicator,
    authority: { getPrimaryGm: () => game.users.get("gm") }
  });
  const actor = makeActor();
  const token = makeToken(actor);

  const pending = service.choose({
    actor,
    token,
    title: "Shove Saving Throw",
    prompt: "Choose Strength or Dexterity.",
    choices: [{ id: "str", label: "Strength" }, { id: "dex", label: "Dexterity" }]
  });

  await new Promise(resolve => setTimeout(resolve, 0));
  player.active = false;
  Hooks.callAll("userConnected", player, false);
  const choice = await pending;

  assert.equal(choice, "str");
  assert.deepEqual(socket.calls.map(call => call.userId), ["player", "gm"]);
  assert.equal(service.getStats().disconnectReroutes, 1);
});
