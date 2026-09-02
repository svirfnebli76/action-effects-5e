import { ENVIRONMENT_DELIVERY_MODES, ENVIRONMENT_EVENT_TYPES } from "../core/constants.js";
import { Logger } from "../core/logger.js";

function values(collection) {
  if (!collection) return [];
  try { return [...collection]; } catch { return []; }
}

function detailTypes(workflow) {
  const types = new Set();
  for (const key of ["rawDamageDetail", "rawOtherDamageDetail", "rawBonusDamageDetail"]) {
    for (const detail of workflow?.[key] ?? []) {
      const type = String(detail?.type ?? "").trim().toLowerCase();
      if (type) types.add(type);
    }
  }
  for (const key of ["damageRolls", "otherDamageRolls", "bonusDamageRolls"]) {
    for (const roll of workflow?.[key] ?? []) {
      const type = String(roll?.options?.type ?? "").trim().toLowerCase();
      if (type) types.add(type);
    }
  }
  return types;
}

function isAttackWorkflow(workflow) {
  if (workflow?.activity?.hasAttack === true) return true;
  if (workflow?.activity?.attack) return true;
  const actionType = String(workflow?.item?.system?.actionType ?? workflow?.activity?.actionType ?? "").toLowerCase();
  return ["mwak", "rwak", "msak", "rsak"].includes(actionType);
}

/** Interprets ordinary Midi-QOL fire workflows without modifying source Items. */
export class MidiEnvironmentAdapter {
  #environment;
  #geometry;
  #initialized = false;
  #hookId = null;
  #stats = {
    workflowsSeen: 0,
    earlyNoConsumers: 0,
    nonFire: 0,
    fireWorkflows: 0,
    areaEvents: 0,
    impactEvents: 0,
    unresolvedAreaSources: 0,
    emitted: 0,
    errors: 0
  };

  constructor({ environment, geometry }) {
    this.#environment = environment;
    this.#geometry = geometry;
  }

  initialize() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#hookId = globalThis.Hooks?.on?.("midi-qol.DamageRollComplete", workflow => {
      // Snapshot the transient workflow geometry synchronously, then allow Midi
      // to continue without waiting for Region mutations or socket traffic.
      void this.processWorkflow(workflow).catch(error => {
        this.#stats.errors += 1;
        Logger.error("Midi environmental workflow processing failed", error);
      });
    });
  }


  /**
   * Interpret and emit one completed Midi-QOL damage workflow.
   *
   * The global DamageRollComplete hook uses this exact path. It is deliberately
   * public on the adapter so AE5E's automated acceptance suite can exercise the
   * full Midi -> Environmental Event -> Region reaction bridge without firing a
   * synthetic global Midi hook that could wake unrelated third-party listeners.
   */
  async processWorkflow(workflow) {
    const events = this.interpretWorkflow(workflow);
    if (!events.length) return { processed: false, events: [], results: [] };
    const results = await this.#emitEvents(events);
    return { processed: true, events, results };
  }

  interpretWorkflow(workflow) {
    this.#stats.workflowsSeen += 1;
    if (!workflow || workflow.aborted) return [];
    // Damage-type rejection is intentionally first. The overwhelming majority
    // of workflows are not environmental fire, so they never need to touch the
    // Scene Region index at all.
    const types = detailTypes(workflow);
    if (!types.has(ENVIRONMENT_EVENT_TYPES.FIRE)) {
      this.#stats.nonFire += 1;
      return [];
    }
    const scene = workflow?.token?.document?.parent ?? globalThis.canvas?.scene ?? null;
    if (!this.#environment.hasConsumers(ENVIRONMENT_EVENT_TYPES.FIRE, scene)) {
      this.#stats.earlyNoConsumers += 1;
      return [];
    }
    this.#stats.fireWorkflows += 1;

    const workflowId = String(workflow.id ?? workflow.uuid ?? workflow.itemCardUuid ?? "unknown");
    const source = {
      adapter: "midi-qol",
      workflowId,
      itemUuid: workflow.item?.uuid ?? null,
      activityUuid: workflow.activity?.uuid ?? null,
      actorUuid: workflow.actor?.uuid ?? null,
      tokenUuid: workflow.token?.document?.uuid ?? workflow.token?.uuid ?? null,
      damageTypes: [...types]
    };
    const sceneUuid = scene?.uuid ?? null;
    const templateUuids = [...new Set([...(workflow.templateUuids ?? []), workflow.templateUuid].filter(Boolean))];
    const events = [];

    if (templateUuids.length) {
      templateUuids.forEach((uuid, index) => {
        let document = null;
        try { document = globalThis.fromUuidSync?.(uuid) ?? null; } catch { document = null; }
        if (!document && workflow.template?.uuid === uuid) document = workflow.template;
        const geometry = document ? this.#geometry.normalize(document, { scene }) : null;
        if (!geometry) {
          this.#stats.unresolvedAreaSources += 1;
          return;
        }
        this.#stats.areaEvents += 1;
        events.push({
          type: ENVIRONMENT_EVENT_TYPES.FIRE,
          geometry,
          source,
          delivery: ENVIRONMENT_DELIVERY_MODES.AREA,
          sceneUuid: geometry.sceneUuid ?? sceneUuid,
          idempotencyKey: `midi:${workflowId}:fire:area:${index}:${uuid}`,
          metadata: { templateUuid: uuid }
        });
      });
      // If a workflow explicitly declared area geometry but it could not be
      // resolved, do not silently reinterpret it as point fire at its targets.
      return events;
    }

    const attack = isAttackWorkflow(workflow);
    const targets = attack ? values(workflow.hitTargets) : values(workflow.targets);
    if (attack && !targets.length) return [];
    targets.forEach((target, index) => {
      const geometry = this.#geometry.fromToken(target, { source: attack ? "midi-attack-impact" : "midi-target-impact" });
      if (!geometry) return;
      this.#stats.impactEvents += 1;
      events.push({
        type: ENVIRONMENT_EVENT_TYPES.FIRE,
        geometry,
        source,
        delivery: attack ? ENVIRONMENT_DELIVERY_MODES.IMPACT : ENVIRONMENT_DELIVERY_MODES.TARGET,
        sceneUuid: geometry.sceneUuid ?? sceneUuid,
        idempotencyKey: `midi:${workflowId}:fire:${attack ? "impact" : "target"}:${index}:${target?.document?.uuid ?? target?.uuid ?? "unknown"}`,
        metadata: { targetUuid: target?.document?.uuid ?? target?.uuid ?? null }
      });
    });
    return events;
  }

  async #emitEvents(events) {
    const results = [];
    for (const event of events) {
      results.push(await this.#environment.emit(event));
      this.#stats.emitted += 1;
    }
    return results;
  }

  getStats() {
    return Object.freeze({ ...this.#stats, initialized: this.#initialized, hookRegistered: this.#hookId !== null && this.#hookId !== undefined });
  }
}
