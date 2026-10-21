import assert from "node:assert/strict";
import test from "node:test";
import { BrokerChoicePromptService } from "../scripts/ui/broker-choice-prompt-service.js";

// Exercise the registered dialog handler, rather than mocking its final response.
// This intentionally models the Foundry constructor contract that caught the bug.
function setupDialog({ failRender = false } = {}) {
  const instances = [];
  const leases = [];
  const releases = [];
  class Dialog extends EventTarget {
    constructor(config) {
      super();
      if (!config.buttons?.length) throw new Error("You must define at least one entry in config.buttons");
      this.config = config;
      this.closed = false;
      this.submissions = 0;
      this.buttons = new Map(config.buttons.map(button => [button.action, {
        dataset: { action: button.action }, disabled: button.disabled === true,
        closest: () => ({ classList: { add() {} } })
      }]));
      const host = this.host = {
        html: "", rows: [],
        set innerHTML(html) {
          this.html = html;
          this.rows = [...html.matchAll(/<input type="checkbox" value="([^"]+)"([^>]*)>/g)].map(match => {
            const checkbox = new EventTarget();
            Object.assign(checkbox, {
              value: match[1], checked: match[2].includes(" checked"), disabled: match[2].includes(" disabled")
            });
            return { querySelector: () => checkbox };
          });
        },
        querySelectorAll() { return this.rows; }
      };
      this.styles = new Map();
      this.element = {
        style: {
          setProperty: (name, value) => this.styles.set(name, value)
        },
        querySelector: selector => selector.includes("host")
          ? host : this.buttons.get(selector.includes("confirm") ? "confirm" : "decline")
      };
      instances.push(this);
    }
    async render() { if (failRender) throw new Error("render failed"); }
    async _onSubmit(target, event) {
      this.submissions += 1;
      const button = this.config.buttons.find(entry => entry.action === target.dataset.action);
      const value = await button.callback(event, target, this);
      await this.config.submit(value, this);
      await this.close();
      return this;
    }
    async close() { this.closed = true; this.dispatchEvent(new Event("close")); }
    async press(action) { return this._onSubmit(this.buttons.get(action), {}); }
    toggle(id) {
      const checkbox = this.host.rows.map(row => row.querySelector()).find(input => input.value === id);
      if (checkbox.disabled) return;
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event("change"));
    }
  }
  globalThis.foundry = { applications: { api: { DialogV2: Dialog } } };
  globalThis.game = { user: { id: "gm", active: true, isGM: true } };
  const handlers = new Map();
  const service = new BrokerChoicePromptService({
    socket: {
      register(name, handler) { handlers.set(name, handler); },
      executeAsUser(name, userId, payload) { return handlers.get(name)(payload); }
    },
    controllerResolver: { async resolveController() { return { userId: "gm", isGM: true }; } },
    selectionIndicator: {
      async acquire(options) { const lease = { options }; leases.push(lease); return lease; },
      async release(lease) { releases.push(lease); }
    },
    authority: {}
  });
  async function open(overrides = {}) {
    const pending = service.choose({
      title: "Feature Broker", choices: [{ id: "one", label: "One", cost: 1 }],
      confirmLabel: "Apply", declineLabel: "Normal Casting", closeOutcome: "abort", ...overrides
    });
    await new Promise(resolve => setImmediate(resolve));
    return { pending, dialog: instances.at(-1) };
  }
  return { service, open, leases, releases };
}

test("dialog constructs with real actions; empty confirm cannot submit or close", async () => {
  const { open, releases } = setupDialog();
  const { pending, dialog } = await open();
  assert.deepEqual(dialog.config.buttons.map(button => [button.action, button.label]),
    [["confirm", "Apply"], ["decline", "Normal Casting"]]);
  assert.equal(dialog.buttons.get("confirm").disabled, true);
  assert.equal(dialog.config.buttons.some(button => button.default), false);
  assert.doesNotMatch(dialog.host.html, /<button/);
  await dialog.press("confirm");
  assert.equal(dialog.submissions, 0);
  assert.equal(dialog.closed, false);
  await dialog.press("decline");
  assert.equal((await pending).outcome, "decline");
  assert.equal(releases.length, 1);
});

test("checkbox selection enables confirm; native submission resolves once and releases indicator", async () => {
  const { open, leases, releases } = setupDialog();
  const { pending, dialog } = await open();
  dialog.toggle("one");
  assert.equal(dialog.buttons.get("confirm").disabled, false);
  await dialog.press("confirm");
  assert.deepEqual(await pending, { outcome: "confirm", selectedIds: ["one"], controllerUserId: "gm" });
  await dialog.press("decline");
  assert.equal(dialog.submissions, 1);
  assert.equal(dialog.closed, true);
  assert.deepEqual(releases, leases);
});

test("unchecking the final selection disables confirm again", async () => {
  const { open } = setupDialog();
  const { pending, dialog } = await open();
  dialog.toggle("one");
  dialog.toggle("one");
  assert.equal(dialog.buttons.get("confirm").disabled, true);
  await dialog.press("confirm");
  assert.equal(dialog.closed, false);
  await dialog.close();
  assert.equal((await pending).outcome, "abort");
});

test("all disabled options still allow Normal Casting", async () => {
  const { open } = setupDialog();
  const { pending, dialog } = await open({ choices: [{ id: "one", label: "One", disabled: true }] });
  dialog.toggle("one");
  assert.equal(dialog.buttons.get("confirm").disabled, true);
  await dialog.press("decline");
  assert.deepEqual((await pending).selectedIds, []);
  assert.equal((await pending).outcome, "decline");
});

test("Normal Casting discards checked choices", async () => {
  const { open } = setupDialog();
  const { pending, dialog } = await open();
  dialog.toggle("one");
  await dialog.press("decline");
  assert.deepEqual(await pending, { outcome: "decline", selectedIds: [], controllerUserId: "gm" });
});

test("window dismissal preserves each phase's close outcome and releases indicator", async () => {
  for (const closeOutcome of ["abort", "decline"]) {
    const { open, releases } = setupDialog();
    const { pending, dialog } = await open({ closeOutcome });
    dialog.toggle("one");
    await dialog.close();
    assert.deepEqual(await pending, { outcome: closeOutcome, selectedIds: [], controllerUserId: "gm" });
    assert.equal(releases.length, 1);
  }
});

test("projected balance and selection capacity disable further choices until deselected", async () => {
  const { open } = setupDialog();
  const { pending, dialog } = await open({
    choices: [{ id: "one", label: "One", cost: 1 }, { id: "two", label: "Two", cost: 2 }],
    selectionCapacity: 1, resource: { current: 2, max: 4, summary: "{remaining}/{max}" }
  });
  dialog.toggle("one");
  assert.ok(dialog.host.html.includes(">1/4</div>"));
  assert.equal(dialog.host.rows[1].querySelector().disabled, true);
  dialog.toggle("one");
  assert.equal(dialog.host.rows[1].querySelector().disabled, false);
  dialog.toggle("two");
  await dialog.press("confirm");
  assert.deepEqual((await pending).selectedIds, ["two"]);
});

test("render failure releases the indicator and propagates the error", async () => {
  const { service, leases, releases } = setupDialog({ failRender: true });
  await assert.rejects(service.choose({ title: "Feature", choices: [{ id: "one", label: "One" }] }), /render failed/);
  assert.equal(leases.length, 1);
  assert.deepEqual(releases, leases);
});


test("advisories and reasons render in separate semantic boxes with advisories first", async () => {
  const { open } = setupDialog();
  const { pending, dialog } = await open({
    choices: [{
      id: "one",
      label: "One",
      advisories: ["Advisory text"],
      reasons: ["Reason text"]
    }]
  });

  const html = dialog.host.html;
  const advisory = html.indexOf("ae5e-broker-status is-advisory");
  const reason = html.indexOf("ae5e-broker-status is-reason");
  assert.ok(advisory >= 0);
  assert.ok(reason > advisory);
  assert.ok(html.includes("Advisory text"));
  assert.ok(html.includes("Reason text"));

  await dialog.close();
  await pending;
});

test("temporary resource/capacity blocks render as reasons, not advisories", async () => {
  const { open } = setupDialog();
  const { pending, dialog } = await open({
    choices: [
      { id: "one", label: "One", cost: 1 },
      { id: "two", label: "Two", cost: 2, advisories: ["Still informational"] }
    ],
    selectionCapacity: 1,
    selectionCapacityReason: "Capacity warning",
    resource: { current: 2, max: 4, summary: "{remaining}/{max}" },
    resourceInsufficientReason: "Resource warning"
  });

  dialog.toggle("one");
  const html = dialog.host.html;
  assert.ok(html.includes("ae5e-broker-status is-advisory"));
  assert.ok(html.includes("ae5e-broker-status is-reason"));
  assert.ok(html.includes("Capacity warning"));
  assert.ok(html.includes("Resource warning"));

  await dialog.close();
  await pending;
});

test("presentation overrides become dialog-scoped CSS variables", async () => {
  const { open } = setupDialog();
  const { pending, dialog } = await open({
    presentation: {
      title: { fontSize: 18, fontWeight: 700 },
      prompt: { fontSize: 15, fontWeight: 500 },
      resource: { fontSize: 16, fontWeight: 800 },
      optionName: { fontSize: 15, fontWeight: 600 },
      optionDescription: { fontSize: 13, fontWeight: 400 },
      optionCost: { fontSize: 13, fontWeight: 500 },
      advisory: {
        fontSize: 14,
        fontWeight: 700,
        textColor: "#abc",
        borderColor: "#ff9f1c",
        borderOpacity: 0.5,
        backgroundColor: "#123456",
        backgroundOpacity: 0.25
      },
      reason: {
        fontSize: 15,
        fontWeight: 800,
        textColor: "#f05b5b",
        borderOpacity: 0.75,
        backgroundOpacity: 0.1
      },
      confirmButton: { fontSize: 14, fontWeight: 700 },
      declineButton: { fontSize: 13, fontWeight: 500 }
    }
  });

  assert.equal(dialog.styles.get("--ae5e-broker-title-font-size"), "18px");
  assert.equal(dialog.styles.get("--ae5e-broker-title-font-weight"), "700");
  assert.equal(dialog.styles.get("--ae5e-broker-option-description-font-size"), "13px");
  assert.equal(dialog.styles.get("--ae5e-broker-advisory-text-color"), "#abc");
  assert.equal(dialog.styles.get("--ae5e-broker-advisory-border-color"), "rgba(255, 159, 28, 0.5)");
  assert.equal(dialog.styles.get("--ae5e-broker-advisory-background-color"), "rgba(18, 52, 86, 0.25)");
  assert.equal(dialog.styles.get("--ae5e-broker-reason-border-color"), "rgba(220, 70, 70, 0.75)");
  assert.equal(dialog.styles.get("--ae5e-broker-reason-background-color"), "rgba(115, 24, 24, 0.1)");
  assert.equal(dialog.styles.get("--ae5e-broker-confirm-button-font-size"), "14px");
  assert.equal(dialog.styles.get("--ae5e-broker-decline-button-font-weight"), "500");

  await dialog.close();
  await pending;
});


test("acceptance, advisory, and reason boxes render in semantic order", async () => {
  const { open } = setupDialog();
  const { pending, dialog } = await open({
    choices: [{
      id: "one",
      label: "One",
      acceptances: ["Acceptance text"],
      advisories: ["Advisory text"],
      reasons: ["Reason text"]
    }]
  });

  const html = dialog.host.html;
  const acceptance = html.indexOf("ae5e-broker-status is-acceptance");
  const advisory = html.indexOf("ae5e-broker-status is-advisory");
  const reason = html.indexOf("ae5e-broker-status is-reason");
  assert.ok(acceptance >= 0);
  assert.ok(advisory > acceptance);
  assert.ok(reason > advisory);
  assert.ok(html.includes("Acceptance text"));
  assert.ok(html.includes("Advisory text"));
  assert.ok(html.includes("Reason text"));

  await dialog.close();
  await pending;
});

test("acceptance presentation overrides become dialog-scoped CSS variables", async () => {
  const { open } = setupDialog();
  const { pending, dialog } = await open({
    choices: [{
      id: "one",
      label: "One",
      acceptances: ["Acceptance text"]
    }],
    presentation: {
      acceptance: {
        fontSize: 14,
        fontWeight: 700,
        textColor: "#0f0",
        borderColor: "#18cc46",
        borderOpacity: 0.5,
        backgroundColor: "#123456",
        backgroundOpacity: 0.25
      }
    }
  });

  assert.equal(dialog.styles.get("--ae5e-broker-acceptance-font-size"), "14px");
  assert.equal(dialog.styles.get("--ae5e-broker-acceptance-font-weight"), "700");
  assert.equal(dialog.styles.get("--ae5e-broker-acceptance-text-color"), "#0f0");
  assert.equal(dialog.styles.get("--ae5e-broker-acceptance-border-color"), "rgba(24, 204, 70, 0.5)");
  assert.equal(dialog.styles.get("--ae5e-broker-acceptance-background-color"), "rgba(18, 52, 86, 0.25)");

  await dialog.close();
  await pending;
});
