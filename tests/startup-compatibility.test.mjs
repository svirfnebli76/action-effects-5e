import assert from "node:assert/strict";
import test from "node:test";
import { StartupCompatibilityService } from "../scripts/core/startup-compatibility-service.js";

function installEnvironment({
  enabled = true,
  active = true,
  isGM = true,
  choose = "disable"
} = {}) {
  const previous = {
    game: globalThis.game,
    foundry: globalThis.foundry,
    ui: globalThis.ui
  };

  let value = enabled;
  let setCalls = 0;
  let dialogConfig = null;
  const notifications = [];

  class FakeDialogV2 {
    constructor(config) {
      dialogConfig = config;
      this.config = config;
    }

    addEventListener() {}

    async render() {
      const button = this.config.buttons.find(entry =>
        entry.action === (choose === "disable" ? "disable-target-picker" : "cancel")
      );
      const response = button.callback();
      this.config.submit(response);
      return this;
    }
  }

  globalThis.game = {
    modules: new Map([
      ["enhancedcombathud", { active }]
    ]),
    user: { isGM },
    settings: {
      settings: new Map([
        ["enhancedcombathud.rangepicker", { scope: "world" }]
      ]),
      get(namespace, key) {
        assert.equal(namespace, "enhancedcombathud");
        assert.equal(key, "rangepicker");
        return value;
      },
      async set(namespace, key, next) {
        assert.equal(namespace, "enhancedcombathud");
        assert.equal(key, "rangepicker");
        setCalls += 1;
        value = next;
        return next;
      }
    }
  };

  globalThis.foundry = {
    applications: {
      api: { DialogV2: FakeDialogV2 }
    }
  };

  globalThis.ui = {
    notifications: {
      info: message => notifications.push(["info", message]),
      error: message => notifications.push(["error", message])
    }
  };

  return {
    restore() {
      globalThis.game = previous.game;
      globalThis.foundry = previous.foundry;
      globalThis.ui = previous.ui;
    },
    get value() { return value; },
    get setCalls() { return setCalls; },
    get dialogConfig() { return dialogConfig; },
    notifications
  };
}

test("GM can approve disabling Argon's world Target Picker setting", async () => {
  const env = installEnvironment();
  try {
    const service = new StartupCompatibilityService();
    const result = await service.run();

    assert.equal(result.changed, true);
    assert.equal(result.lastReason, "disabled");
    assert.equal(env.value, false);
    assert.equal(env.setCalls, 1);
    assert.equal(env.dialogConfig.window.title, "Action Effects 5E Start-up Checks");
    assert.deepEqual(
      env.dialogConfig.buttons.map(button => button.label),
      ["Disable Target Picker", "Cancel"]
    );
    assert.match(env.dialogConfig.content, /Argon - Combat HUD \(CORE\)/);
    assert.match(env.dialogConfig.content, /<strong>Setting:<\/strong> Target Picker/);
    assert.match(env.dialogConfig.content, /<strong>Required:<\/strong> Off/);
    assert.deepEqual(env.notifications, [["info", "AE5E | Argon Target Picker disabled."]]);

    const repeated = await service.run();
    assert.equal(repeated.lastReason, "already-checked");
    assert.equal(env.setCalls, 1);
  } finally {
    env.restore();
  }
});

test("Cancel leaves Argon's Target Picker unchanged", async () => {
  const env = installEnvironment({ choose: "cancel" });
  try {
    const result = await new StartupCompatibilityService().run();
    assert.equal(result.changed, false);
    assert.equal(result.prompted, true);
    assert.equal(result.lastReason, "declined");
    assert.equal(env.value, true);
    assert.equal(env.setCalls, 0);
  } finally {
    env.restore();
  }
});

test("disabled setting and non-GM clients do not receive a prompt", async () => {
  const disabled = installEnvironment({ enabled: false });
  try {
    const result = await new StartupCompatibilityService().run();
    assert.equal(result.lastReason, "already-disabled");
    assert.equal(disabled.dialogConfig, null);
  } finally {
    disabled.restore();
  }

  const player = installEnvironment({ enabled: true, isGM: false });
  try {
    const result = await new StartupCompatibilityService().run();
    assert.equal(result.lastReason, "not-gm");
    assert.equal(player.dialogConfig, null);
    assert.equal(player.setCalls, 0);
  } finally {
    player.restore();
  }
});
