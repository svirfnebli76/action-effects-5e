import { MODULE_ID, REGION_AUTHORITY_FLAG } from "../core/constants.js";

export class RegionAuthorityTestSuite {
  #service;
  #socket;

  constructor({ service, socket }) {
    this.#service = service;
    this.#socket = socket;
  }

  async runFoundationTest({ notify = true } = {}) {
    const checks = [];
    const record = (name, passed, details = null) => checks.push({ name, passed: Boolean(passed), details });
    const stats = this.#service.getStats();
    const registrations = this.#socket.getRegisteredNames?.() ?? [];

    record("Region create socket handler is registered", registrations.includes("regions.create"), registrations);
    record("Region delete socket handler is registered", registrations.includes("regions.delete"), registrations);
    record("Region authority service reports socket readiness", typeof stats.socketReady === "boolean", stats);

    const synthetic = {
      flags: {
        [MODULE_ID]: {
          [REGION_AUTHORITY_FLAG]: {
            requestId: "AE5ETestRegion",
            metadata: { purpose: "foundation" }
          }
        }
      }
    };
    record("AE5E-owned Region flag is recognized", this.#service.isOwned(synthetic) === true, this.#service.getOwnership(synthetic));
    record("Unowned Region is rejected by ownership detection", this.#service.isOwned({ flags: {} }) === false);
    record("Region ownership metadata round-trips", this.#service.getOwnership(synthetic)?.metadata?.purpose === "foundation", this.#service.getOwnership(synthetic));

    const invalidDelete = await this.#service.delete("not-a-region-uuid");
    record("Invalid Region UUID is rejected before authority routing", invalidDelete?.deleted === false && invalidDelete?.reason === "invalid-region-uuid", invalidDelete);

    const passed = checks.every(check => check.passed);
    const result = { passed, checks, stats: this.#service.getStats() };
    console.log(`%cAE5E 0.4.1.4 — REGION AUTHORITY FOUNDATION — ${passed ? "PASS" : "FAIL"}`, `font-size:24px;font-weight:bold;color:${passed ? "#5cff8d" : "#ff5c5c"};`);
    console.table(checks.map(check => ({ Check: check.name, Result: check.passed ? "PASS" : "FAIL" })));
    console.log(result);
    if (notify) ui?.notifications?.[passed ? "info" : "error"]?.(`AE5E Region authority foundation ${passed ? "PASSED" : "FAILED"}. See console.`);
    return result;
  }

  async runLiveLifecycleTest({ notify = true, scene = null } = {}) {
    if (!game.user?.isGM) throw new Error("Run the Region authority live lifecycle test as a GM.");
    scene ??= canvas?.scene ?? null;
    if (!scene) throw new Error("Activate a Scene before running the Region authority live lifecycle test.");

    const checks = [];
    const record = (name, passed, details = null) => checks.push({ name, passed: Boolean(passed), details });
    const gridSize = Number(scene.grid?.size ?? scene.dimensions?.size ?? canvas?.grid?.size ?? 100) || 100;
    const sceneX = Number(scene.dimensions?.sceneX ?? 0) || 0;
    const sceneY = Number(scene.dimensions?.sceneY ?? 0) || 0;
    let regionUuid = null;

    try {
      const create = await this.#service.create({
        name: "AE5E TEST — Region Authority",
        color: "#18cc46",
        locked: true,
        shapes: [{
          type: "rectangle",
          x: sceneX + gridSize,
          y: sceneY + gridSize,
          width: gridSize * 2,
          height: gridSize * 2
        }]
      }, {
        scene,
        metadata: { testFixture: true, suite: "region-authority" }
      });
      regionUuid = create?.regionUuid ?? null;
      record("GM-authoritative Region create request succeeds", create?.created === true && Boolean(regionUuid), create);

      const region = regionUuid ? await fromUuid(regionUuid) : null;
      record("Created Region resolves from its UUID", region?.documentName === "Region" && region?.parent?.uuid === scene.uuid, { regionUuid, sceneUuid: region?.parent?.uuid ?? null });
      record("Created Region is stamped as AE5E-owned", this.#service.isOwned(region) === true, this.#service.getOwnership(region));
      record("Caller metadata is retained on the authority flag", this.#service.getOwnership(region)?.metadata?.testFixture === true, this.#service.getOwnership(region));
      record("Region shape geometry survives persistence", region?.shapes?.length === 1 || region?.toObject?.().shapes?.length === 1, region?.toObject?.().shapes ?? null);

      const remove = await this.#service.delete(regionUuid);
      record("GM-authoritative Region delete request succeeds", remove?.deleted === true, remove);
      const after = await fromUuid(regionUuid);
      record("Deleted Region no longer resolves", !after, { regionUuid });
      regionUuid = null;
    } finally {
      if (regionUuid) {
        let region = null;
        try { region = await fromUuid(regionUuid); } catch { /* best-effort cleanup below */ }
        if (region?.parent?.deleteEmbeddedDocuments) {
          try { await region.parent.deleteEmbeddedDocuments("Region", [region.id], { ae5eTestCleanup: true }); } catch { /* noop */ }
        }
      }
    }

    const passed = checks.every(check => check.passed);
    const result = { passed, checks, sceneUuid: scene.uuid, stats: this.#service.getStats() };
    console.log(`%cAE5E 0.4.1.4 — REGION AUTHORITY LIVE LIFECYCLE — ${passed ? "PASS" : "FAIL"}`, `font-size:24px;font-weight:bold;color:${passed ? "#5cff8d" : "#ff5c5c"};`);
    console.table(checks.map(check => ({ Check: check.name, Result: check.passed ? "PASS" : "FAIL" })));
    console.log(result);
    if (notify) ui?.notifications?.[passed ? "info" : "error"]?.(`AE5E Region authority lifecycle ${passed ? "PASSED" : "FAILED"}. See console.`);
    return result;
  }
}
