import test from "node:test";
import assert from "node:assert/strict";

let idCounter = 0;
const documents = new Map();
const hooks = new Map();
let hookId = 0;

globalThis.Hooks = {
  on(name, handler) {
    const id = ++hookId;
    if (!hooks.has(name)) hooks.set(name, new Map());
    hooks.get(name).set(id, handler);
    return id;
  },
  off(name, id) {
    hooks.get(name)?.delete(id);
  },
  callAll(name, ...args) {
    for (const handler of hooks.get(name)?.values() ?? []) handler(...args);
  }
};

class FakeCollection extends Map {
  [Symbol.iterator]() { return this.values(); }
  find(predicate) { return [...this.values()].find(predicate); }
}

class FakeActor {
  constructor(id) {
    this.id = id;
    this.uuid = `Actor.${id}`;
    this.items = new FakeCollection();
    this.effects = new FakeCollection();
    documents.set(this.uuid, this);
  }

  async createEmbeddedDocuments(type, data) {
    const created = [];
    for (const source of data) {
      const id = `embedded-${++idCounter}`;
      const document = type === "Item"
        ? new FakeItem({ id, parent: this, data: source })
        : new FakeActiveEffect({ id, parent: this, data: source });
      const collection = type === "Item" ? this.items : this.effects;
      collection.set(id, document);
      documents.set(document.uuid, document);
      created.push(document);
      Hooks.callAll(type === "Item" ? "createItem" : "createActiveEffect", document, {});
    }
    return created;
  }

  async deleteEmbeddedDocuments(type, ids, options = {}) {
    const collection = type === "Item" ? this.items : this.effects;
    const hook = type === "Item" ? "deleteItem" : "deleteActiveEffect";
    for (const id of ids) {
      const document = collection.get(id);
      if (!document) continue;
      collection.delete(id);
      documents.delete(document.uuid);
      Hooks.callAll(hook, document, options);
    }
    return [];
  }
}

class FakeItem {
  documentName = "Item";

  constructor({ id, parent = null, data = {} }) {
    this.id = id;
    this.parent = parent;
    this.name = data.name ?? "Template Item";
    this.flags = structuredClone(data.flags ?? {});
    this.uuid = parent ? `${parent.uuid}.Item.${id}` : `Compendium.test.Item.${id}`;
  }

  getFlag(scope, key) {
    return this.flags?.[scope]?.[key];
  }

  toObject() {
    return {
      _id: this.id,
      name: this.name,
      type: "feat",
      flags: structuredClone(this.flags)
    };
  }
}

class FakeActiveEffect {
  documentName = "ActiveEffect";

  constructor({ id, parent, data = {} }) {
    this.id = id;
    this.parent = parent;
    this.name = data.name ?? "Source Effect";
    this.flags = structuredClone(data.flags ?? {});
    this.uuid = `${parent.uuid}.ActiveEffect.${id}`;
  }
}

class FakeScene {
  constructor(id) {
    this.id = id;
    this.uuid = `Scene.${id}`;
    this.flags = {};
  }

  getFlag(scope, key) {
    return this.flags?.[scope]?.[key];
  }

  async setFlag(scope, key, value) {
    this.flags[scope] ??= {};
    this.flags[scope][key] = structuredClone(value);
    Hooks.callAll("updateScene", this, { flags: { [scope]: { [key]: structuredClone(value) } } });
    return this;
  }
}

class FakeTokenDocument {
  constructor({ id, scene, actor, owner = true }) {
    this.id = id;
    this.parent = scene;
    this.actor = actor;
    this.owner = owner;
    this.uuid = `${scene.uuid}.Token.${id}`;
    documents.set(this.uuid, this);
  }

  testUserPermission() {
    return this.owner;
  }
}

class FakeSocket {
  handlers = new Map();

  register(name, handler) {
    this.handlers.set(name, handler);
  }

  async executeAsGM(name, payload) {
    const previous = game.user;
    try {
      game.user = gmUser;
      return await this.handlers.get(name)(payload);
    } finally {
      game.user = previous;
    }
  }
}

globalThis.foundry = {
  documents: { TokenDocument: FakeTokenDocument },
  utils: {
    deepClone: (value) => structuredClone(value),
    randomID: (length = 16) => String(++idCounter).padStart(length, "0"),
    hasProperty: (object, path) => path.split(".").reduce((value, key) => value?.[key], object) !== undefined,
    setProperty(object, path, value) {
      const parts = path.split(".");
      const leaf = parts.pop();
      let current = object;
      for (const part of parts) current = current[part] ??= {};
      current[leaf] = value;
      return true;
    }
  }
};

globalThis.CONST = {
  DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 },
  TOKEN_DISPOSITIONS: { FRIENDLY: 1, NEUTRAL: 0, HOSTILE: -1, SECRET: -2 }
};

const gmUser = { id: "gm", isGM: true, active: true };
const playerUser = { id: "player", isGM: false, active: true };
const users = new FakeCollection([[gmUser.id, gmUser], [playerUser.id, playerUser]]);
users.activeGM = gmUser;

globalThis.game = {
  user: gmUser,
  users,
  scenes: new FakeCollection(),
  settings: { get() { return false; } }
};

globalThis.fromUuid = async (uuid) => documents.get(uuid) ?? null;

const { RelationshipLifecycleService } = await import("../scripts/relationships/relationship-lifecycle-service.js");
const { RelationshipService } = await import("../scripts/relationships/relationship-service.js");
const { RELATIONSHIP_GRANT_FLAG } = await import("../scripts/core/constants.js");

function fixture(name = "fixture") {
  const scene = new FakeScene(`${name}-scene`);
  game.scenes.set(scene.id, scene);
  const leaderActor = new FakeActor(`${name}-leader-actor`);
  const followerActor = new FakeActor(`${name}-follower-actor`);
  const leader = new FakeTokenDocument({ id: `${name}-leader`, scene, actor: leaderActor });
  const follower = new FakeTokenDocument({ id: `${name}-follower`, scene, actor: followerActor });
  const template = new FakeItem({ id: `${name}-release-template`, data: { name: "Release Grapple" } });
  documents.set(template.uuid, template);
  return { scene, leaderActor, followerActor, leader, follower, template };
}

async function createSourceEffect(actor, name = "Unarmed Grapple") {
  const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [{ name }]);
  return effect;
}

function buildServices({ spending = null } = {}) {
  const socket = new FakeSocket();
  let relationships = null;
  const lifecycle = new RelationshipLifecycleService({ relationshipsAccessor: () => relationships });
  relationships = new RelationshipService({ socket, lifecycle, spending });
  return { socket, lifecycle, relationships };
}

async function waitUntil(predicate, timeoutMs = 500) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return false;
}

test("relationship lifecycle provisions a leader grant and relationship removal cleans grant plus source effect", async () => {
  const f = fixture("remove");
  const source = await createSourceEffect(f.followerActor);
  const { lifecycle, relationships } = buildServices();
  await relationships.initialize();
  await lifecycle.initialize();

  const relationship = await relationships.create({
    type: "grapple",
    attachmentMode: "grappleFollower",
    leaderUuid: f.leader.uuid,
    followerUuid: f.follower.uuid,
    sourceUuid: source.uuid,
    lifecycle: {
      sourceEffect: {},
      participantItemGrants: [{
        participant: "leader",
        role: "release",
        templateUuid: f.template.uuid
      }]
    }
  });

  const grant = relationship.lifecycle.participantItemGrants[0];
  assert.equal(grant.participant, "leader");
  assert.equal(grant.role, "release");
  assert.ok(grant.itemUuid);
  const grantedItem = await fromUuid(grant.itemUuid);
  assert.ok(grantedItem);
  assert.deepEqual(grantedItem.getFlag("action-effects-5e", RELATIONSHIP_GRANT_FLAG), {
    schema: 1,
    relationshipId: relationship.id,
    relationshipType: "grapple",
    role: "release",
    participant: "leader",
    leaderUuid: f.leader.uuid,
    followerUuid: f.follower.uuid,
    sourceEffectUuid: source.uuid,
    templateUuid: f.template.uuid
  });

  assert.equal(await relationships.remove(relationship.id), true);
  assert.equal(relationships.get(relationship.id), null);
  assert.equal(await fromUuid(grant.itemUuid), null, "Relationship-owned Release Item should be deleted.");
  assert.equal(await fromUuid(source.uuid), null, "Relationship-owned source ActiveEffect should be deleted.");
  assert.equal(lifecycle.getStats().grantsRemoved, 1);
  assert.equal(lifecycle.getStats().sourceEffectsRemoved, 1);

  lifecycle.shutdown();
  relationships.shutdown();
  game.scenes.delete(f.scene.id);
});

test("deleting the linked source ActiveEffect removes the relationship and its participant grant", async () => {
  const f = fixture("effect-delete");
  const source = await createSourceEffect(f.followerActor);
  const { lifecycle, relationships } = buildServices();
  await relationships.initialize();
  await lifecycle.initialize();

  const relationship = await relationships.create({
    type: "grapple",
    attachmentMode: "grappleFollower",
    leaderUuid: f.leader.uuid,
    followerUuid: f.follower.uuid,
    sourceUuid: source.uuid,
    lifecycle: {
      sourceEffect: {},
      participantItemGrants: [{ participant: "leader", role: "release", templateUuid: f.template.uuid }]
    }
  });
  const grantUuid = relationship.lifecycle.participantItemGrants[0].itemUuid;

  await f.followerActor.deleteEmbeddedDocuments("ActiveEffect", [source.id], { userDeleted: true });
  assert.equal(await waitUntil(() => relationships.get(relationship.id) === null), true, "Effect deletion should asynchronously break the relationship on the active GM.");
  assert.equal(await waitUntil(() => !documents.has(grantUuid)), true, "Breaking from source-effect deletion should clean the leader grant.");
  assert.equal(await waitUntil(() => lifecycle.getStats().sourceEffectBreaks === 1), true);

  lifecycle.shutdown();
  relationships.shutdown();
  game.scenes.delete(f.scene.id);
});

test("legacy sourceUuid remains non-owning unless lifecycle sourceEffect is explicitly enabled", async () => {
  const f = fixture("legacy");
  const { lifecycle, relationships } = buildServices();
  await relationships.initialize();
  await lifecycle.initialize();

  const relationship = await relationships.create({
    type: "test",
    attachmentMode: "adjacentFollower",
    leaderUuid: f.leader.uuid,
    followerUuid: f.follower.uuid,
    sourceUuid: f.leader.uuid
  });
  assert.equal(relationship.lifecycle, null);
  assert.equal(await relationships.remove(relationship.id), true);
  assert.equal(await fromUuid(f.leader.uuid), f.leader, "Legacy sourceUuid Token must not be deleted by relationship cleanup.");

  lifecycle.shutdown();
  relationships.shutdown();
  game.scenes.delete(f.scene.id);
});

test("source-effect lifecycle rejects a non-ActiveEffect sourceUuid", async () => {
  const f = fixture("validation");
  const { lifecycle, relationships } = buildServices();
  await relationships.initialize();
  await lifecycle.initialize();

  await assert.rejects(
    relationships.create({
      type: "grapple",
      attachmentMode: "grappleFollower",
      leaderUuid: f.leader.uuid,
      followerUuid: f.follower.uuid,
      sourceUuid: f.leader.uuid,
      lifecycle: { sourceEffect: {} }
    }),
    /must resolve to an ActiveEffect/i
  );
  assert.equal(relationships.list().length, 0);

  lifecycle.shutdown();
  relationships.shutdown();
  game.scenes.delete(f.scene.id);
});

test("player-owned leader can remove a lifecycle relationship through the existing GM socket route", async () => {
  const f = fixture("player");
  const source = await createSourceEffect(f.followerActor);
  const { lifecycle, relationships } = buildServices();
  await relationships.initialize();
  await lifecycle.initialize();

  const relationship = await relationships.create({
    type: "grapple",
    attachmentMode: "grappleFollower",
    leaderUuid: f.leader.uuid,
    followerUuid: f.follower.uuid,
    sourceUuid: source.uuid,
    lifecycle: {
      sourceEffect: {},
      participantItemGrants: [{ participant: "leader", role: "release", templateUuid: f.template.uuid }]
    }
  });

  game.user = playerUser;
  try {
    assert.equal(await relationships.remove(relationship.id), true);
  } finally {
    game.user = gmUser;
  }
  assert.equal(relationships.get(relationship.id), null);
  assert.equal(await fromUuid(source.uuid), null);

  lifecycle.shutdown();
  relationships.shutdown();
  game.scenes.delete(f.scene.id);
});


test("grapple creation reconciles the leader movement ledger before persisting the relationship", async () => {
  const f = fixture("grapple-reconcile");
  const calls = [];
  const spending = {
    async reconcileLedgerAsAuthority(token, options) {
      calls.push({ token, options });
      return { checked: true, reconciled: true, reason: "reanchored-preserving-cost" };
    }
  };
  const { lifecycle, relationships } = buildServices({ spending });
  await relationships.initialize();
  await lifecycle.initialize();

  const relationship = await relationships.create({
    type: "grapple",
    attachmentMode: "grappleFollower",
    leaderUuid: f.leader.uuid,
    followerUuid: f.follower.uuid
  });

  assert.ok(relationship);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].token, f.leader);
  assert.equal(calls[0].options.reason, "grapple-start");
  assert.equal(calls[0].options.requestedByUserId, gmUser.id);
  assert.equal(calls[0].options.clearInactiveHistory, true);

  lifecycle.shutdown();
  relationships.shutdown();
  game.scenes.delete(f.scene.id);
});

test("failed grapple ledger reconciliation blocks relationship persistence", async () => {
  const f = fixture("grapple-reconcile-fail");
  const spending = {
    async reconcileLedgerAsAuthority() {
      throw new Error("synthetic reconciliation failure");
    }
  };
  const { lifecycle, relationships } = buildServices({ spending });
  await relationships.initialize();
  await lifecycle.initialize();

  await assert.rejects(
    relationships.create({
      type: "grapple",
      attachmentMode: "grappleFollower",
      leaderUuid: f.leader.uuid,
      followerUuid: f.follower.uuid
    }),
    /Grapple could not begin because the leader's movement history is out of sync/i
  );
  assert.equal(relationships.list().length, 0);

  lifecycle.shutdown();
  relationships.shutdown();
  game.scenes.delete(f.scene.id);
});

test("non-grapple relationship creation does not invoke grapple ledger reconciliation", async () => {
  const f = fixture("nongrapple-no-reconcile");
  let calls = 0;
  const spending = {
    async reconcileLedgerAsAuthority() {
      calls += 1;
    }
  };
  const { lifecycle, relationships } = buildServices({ spending });
  await relationships.initialize();
  await lifecycle.initialize();

  await relationships.create({
    type: "test",
    attachmentMode: "adjacentFollower",
    leaderUuid: f.leader.uuid,
    followerUuid: f.follower.uuid
  });
  assert.equal(calls, 0);

  lifecycle.shutdown();
  relationships.shutdown();
  game.scenes.delete(f.scene.id);
});
