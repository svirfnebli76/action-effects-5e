import { randomId } from "../core/utils.js";

const tokenUuid = token => token?.document?.uuid ?? token?.uuid ?? null;

/**
 * Casting-local automatic-save and super-saver claims shared by any feature.
 * Feature rules remain outside this service; it validates only safe workflow
 * mutation and affected-target membership.
 */
export class SaveProtectionApplicationService {
  #states = new WeakMap();
  #hooks = [];
  #stats = {
    installed: 0,
    rolledBack: 0,
    restored: 0,
    lastEvent: null
  };

  initialize() {
    if (this.#hooks.length) return;
    const restore = workflow => this.restore(workflow);
    this.#hooks.push(["midi-qol.postCheckSaves", Hooks.on("midi-qol.postCheckSaves", restore)]);
    this.#hooks.push(["midi-qol.RollComplete", Hooks.on("midi-qol.RollComplete", restore)]);
    this.#hooks.push(["midi-qol.premades.postRollFinished",
      Hooks.on("midi-qol.premades.postRollFinished", restore)]);
  }

  shutdown() {
    for (const [name, id] of this.#hooks) Hooks.off(name, id);
    this.#hooks.length = 0;
  }

  validate(workflow, request, { label = "Save protection" } = {}) {
    if (!request || typeof request !== "object" || Array.isArray(request)) {
      throw new Error(`${label} returned no save-protection request.`);
    }
    const tokenUuids = request.tokenUuids;
    if (!Array.isArray(tokenUuids) || !tokenUuids.length
      || new Set(tokenUuids).size !== tokenUuids.length
      || tokenUuids.some(uuid => typeof uuid !== "string" || !uuid)) {
      throw new Error(`${label} returned invalid save-protection targets.`);
    }
    if (request.automaticSuccess !== true || request.superSaver !== true) {
      throw new Error(`${label} requested unsupported save-protection semantics.`);
    }
    const candidates = this.#candidates(workflow);
    if (tokenUuids.some(uuid => !candidates.has(uuid))) {
      throw new Error(`${label} attempted to protect a creature outside the finalized affected targets.`);
    }
    if (typeof workflow?.checkSculptOrCarefulSpells !== "function") {
      throw new Error("Midi-QOL save-protection API is unavailable on this workflow.");
    }
    const superSavers = workflow.superSavers;
    if (superSavers != null && (typeof superSavers.add !== "function"
      || typeof superSavers.has !== "function" || typeof superSavers.delete !== "function")) {
      throw new Error("Midi-QOL super-saver collection is incompatible.");
    }
    return Object.freeze({
      tokenUuids: Object.freeze([...tokenUuids]),
      automaticSuccess: true,
      superSaver: true
    });
  }

  install(workflow, request, options = {}) {
    const normalized = this.validate(workflow, request, options);
    let state = this.#states.get(workflow);
    if (!state) {
      const original = workflow.checkSculptOrCarefulSpells;
      const claims = new Map();
      state = { original, claims, addedSuperSavers: new Set(), tokensByUuid: new Map(), wrapper: null };
      state.wrapper = function(target, ...args) {
        const uuid = tokenUuid(target);
        if (uuid && [...claims.values()].some(claim => claim.has(uuid))) return true;
        return original.call(this, target, ...args);
      };
      workflow.checkSculptOrCarefulSpells = state.wrapper;
      this.#states.set(workflow, state);
    }

    let id;
    do { id = randomId(); } while (state.claims.has(id));
    const claimUuids = new Set(normalized.tokenUuids);
    state.claims.set(id, claimUuids);
    const candidates = this.#candidates(workflow);
    workflow.superSavers ??= new Set();
    for (const uuid of claimUuids) {
      const token = candidates.get(uuid);
      state.tokensByUuid.set(uuid, token);
      if (!workflow.superSavers.has(token)) {
        workflow.superSavers.add(token);
        state.addedSuperSavers.add(token);
      }
    }
    const claim = Object.freeze({ id, workflow, tokenUuids: Object.freeze([...claimUuids]) });
    this.#stats.installed += 1;
    this.#record("install", workflow, { claimId: id, tokenUuids: [...claimUuids] });
    return claim;
  }

  rollback(workflow, claim) {
    const state = this.#states.get(workflow);
    if (!state || !claim?.id || !state.claims.has(claim.id)) return false;
    const removed = state.claims.get(claim.id);
    state.claims.delete(claim.id);
    const stillProtected = new Set([...state.claims.values()].flatMap(uuids => [...uuids]));
    for (const uuid of removed) {
      if (stillProtected.has(uuid)) continue;
      const token = state.tokensByUuid.get(uuid);
      if (token && state.addedSuperSavers.has(token)) {
        workflow.superSavers?.delete?.(token);
        state.addedSuperSavers.delete(token);
      }
      state.tokensByUuid.delete(uuid);
    }
    if (!state.claims.size) this.#restoreWrapper(workflow, state);
    this.#stats.rolledBack += 1;
    this.#record("rollback", workflow, { claimId: claim.id });
    return true;
  }

  restore(workflow) {
    const state = this.#states.get(workflow);
    if (!state) return false;
    // Super-saver membership must survive through later damage application.
    this.#restoreWrapper(workflow, state);
    this.#stats.restored += 1;
    this.#record("restore", workflow);
    return true;
  }

  getStatus() {
    return {
      initialized: this.#hooks.length > 0,
      hooks: this.#hooks.map(([name]) => name),
      ...this.#stats
    };
  }

  #restoreWrapper(workflow, state) {
    state.claims.clear();
    if (workflow?.checkSculptOrCarefulSpells === state.wrapper && state.original) {
      workflow.checkSculptOrCarefulSpells = state.original;
    }
    this.#states.delete(workflow);
  }

  #candidates(workflow) {
    const affected = workflow?.hitTargets?.size
      ? workflow.hitTargets
      : workflow?.targets ?? [];
    return new Map([...affected]
      .map(token => [tokenUuid(token), token])
      .filter(([uuid]) => Boolean(uuid)));
  }

  #record(type, workflow, details = {}) {
    this.#stats.lastEvent = {
      type,
      workflowId: workflow?.uuid ?? workflow?.id ?? null,
      ...details,
      at: new Date().toISOString()
    };
  }
}
