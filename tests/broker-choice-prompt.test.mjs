import assert from "node:assert/strict";
import test from "node:test";
import { BrokerChoicePromptService } from "../scripts/ui/broker-choice-prompt-service.js";
import { SELECTION_INDICATOR_ROLES } from "../scripts/core/constants.js";

class FakeSocket {
  constructor(response = { outcome: "confirm", selectedIds: ["one"] }) {
    this.response = response;
    this.handlers = new Map();
    this.calls = [];
  }
  register(name, handler) { this.handlers.set(name, handler); }
  async executeAsUser(name, userId, payload) {
    this.calls.push({ name, userId, payload: structuredClone(payload) });
    return structuredClone(this.response);
  }
}

function setup(response) {
  const socket = new FakeSocket(response);
  globalThis.game = {
    user: { id: "gm", active: true, isGM: true },
    users: new Map([["gm", { id: "gm", active: true, isGM: true }]])
  };
  const controllerResolver = {
    async resolveController() {
      return { userId: "gm", actorUuid: "Actor.caster", tokenUuid: "Scene.s.Token.caster", isGM: true };
    }
  };
  const service = new BrokerChoicePromptService({
    socket,
    controllerResolver,
    selectionIndicator: null,
    authority: { getPrimaryGm: () => game.user }
  });
  return { service, socket };
}

test("generic broker request validates structured choice/status/resource data", () => {
  const { service } = setup();
  const request = {
    title: "Feature Broker",
    prompt: "Choose an option.",
    banner: "modules/example/banner.webp",
    role: SELECTION_INDICATOR_ROLES.ORIGINATOR,
    resource: { current: 4, max: 7, summary: "You have {remaining}/{max} uses remaining" },
    selectionCapacity: 2,
    closeOutcome: "abort",
    choices: [{
      id: "one",
      label: "Option One",
      description: "Item-owned description.",
      cost: 1,
      costLabel: "1 Resource",
      selectionCost: 1,
      advisories: ["Advisory"],
      reasons: []
    }]
  };
  assert.equal(service.validateRequest(request).valid, true);
  assert.equal(service.validateRequest({ ...request, closeOutcome: "cancel" }).reason, "invalid-close-outcome");
  assert.equal(service.validateRequest({ ...request, choices: [...request.choices, request.choices[0]] }).reason, "duplicate-choice-id");
  assert.equal(service.validateRequest({ ...request, resource: { current: 8, max: 7, summary: "bad" } }).reason, "invalid-resource");
});

test("generic broker returns explicit confirm/decline/abort outcomes without feature wording", async () => {
  for (const outcome of ["confirm", "decline", "abort"]) {
    const selectedIds = outcome === "confirm" ? ["one"] : [];
    const { service, socket } = setup({ outcome, selectedIds });
    const result = await service.choose({
      title: "Feature Broker",
      prompt: "Item-owned prompt.",
      choices: [{ id: "one", label: "Option One", cost: 1, costLabel: "1 Resource" }],
      resource: { current: 4, max: 7, summary: "{remaining}/{max}" },
      closeOutcome: "abort"
    });
    assert.equal(result.outcome, outcome);
    assert.deepEqual(result.selectedIds, selectedIds);
    assert.equal(socket.calls[0].name, "prompts.chooseBroker");
    assert.equal(socket.calls[0].payload.actor, undefined);
    assert.equal(socket.calls[0].payload.token, undefined);
  }
});

test("controller response cannot exceed declared generic resource or selection capacity", async () => {
  const request = {
    title: "Feature Broker",
    choices: [
      { id: "one", label: "One", cost: 1, selectionCost: 1 },
      { id: "two", label: "Two", cost: 2, selectionCost: 1 }
    ],
    resource: { current: 3, max: 3, summary: "{remaining}/{max}" }
  };

  {
    const { service } = setup({ outcome: "confirm", selectedIds: ["one", "two"] });
    await assert.rejects(service.choose({ ...request, selectionCapacity: 1 }), /capacity/);
  }
  {
    const { service } = setup({ outcome: "confirm", selectedIds: ["one", "two"] });
    await assert.rejects(service.choose({
      ...request,
      resource: { current: 2, max: 3, summary: "{remaining}/{max}" }
    }), /resource balance/);
  }
});
