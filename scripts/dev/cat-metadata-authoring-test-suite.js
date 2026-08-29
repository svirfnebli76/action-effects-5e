import { MODULE_VERSION } from "../core/constants.js";
import {
  CAT_AUTOMATION_SOURCE_FLAG,
  CAT_AUTOMATION_VERSION_FLAG,
  CAT_INTERNAL_PACK_IDS,
  CAT_PUBLIC_AUTOMATION_PACK_IDS
} from "../authoring/cat-metadata-authoring-service.js";
import { CAT_AUTOMATION_SOURCE_ID } from "../integrations/cat-automation-registry.js";

export class CatMetadataAuthoringTestSuite {
  #authoring;

  constructor({ authoring }) {
    this.#authoring = authoring;
  }

  async runLiveTest({
    notify = true,
    packId = "action-effects-5e.spells-level-2",
    identifier = "misty-step",
    initialVersion = "1.0.0",
    updatedVersion = "1.0.1"
  } = {}) {
    if (!globalThis.game?.user?.isGM) throw new Error("The CAT metadata authoring acceptance test requires a GM user.");

    const checks = [];
    const record = (name, passed, details = null) => checks.push({ name, passed: Boolean(passed), details });
    let tempItem = null;

    try {
      record("Runtime version is v0.4.2.6", MODULE_VERSION === "0.4.2.6", { moduleVersion: MODULE_VERSION });
      record("SemVer accepts 1.0.0", this.#authoring.isValidVersion("1.0.0"));
      record("SemVer accepts prerelease form", this.#authoring.isValidVersion("2.1.0-beta.1"));
      record("SemVer rejects incomplete 1.0", !this.#authoring.isValidVersion("1.0"));
      record("Administrative pack is excluded from public CAT authoring allowlist",
        !CAT_PUBLIC_AUTOMATION_PACK_IDS.includes("action-effects-5e.ae5e-administrative")
          && CAT_INTERNAL_PACK_IDS.includes("action-effects-5e.ae5e-administrative"),
        { publicPacks: CAT_PUBLIC_AUTOMATION_PACK_IDS, internalPacks: CAT_INTERNAL_PACK_IDS });

      const pack = game.packs.get(packId);
      if (!pack) throw new Error(`Could not find ${packId}.`);
      const index = await pack.getIndex({ fields: ["name", "type", "system.identifier", "system.source.rules", CAT_AUTOMATION_SOURCE_FLAG, CAT_AUTOMATION_VERSION_FLAG] });
      const entry = [...index].find(document => document.system?.identifier === identifier);
      if (!entry) throw new Error(`Could not find identifier '${identifier}' in ${packId}.`);
      const canonical = await pack.getDocument(entry._id);
      if (!canonical) throw new Error("Canonical Item could not be loaded.");

      const core = this.#authoring.validateItem(canonical);
      record("Canonical Item has valid core metadata", core.valid, core);

      const canonicalBefore = this.#authoring.auditDocument(canonical);
      record("Canonical Item audit is structured", canonicalBefore.identifier === identifier && Array.isArray(canonicalBefore.issues), canonicalBefore);

      const packReport = await this.#authoring.auditPack(pack);
      record("Pack audit inspected every Item", packReport.total === (await pack.getDocuments()).length && Array.isArray(packReport.items), {
        pack: packReport.pack,
        total: packReport.total,
        valid: packReport.valid,
        invalid: packReport.invalid
      });

      const publicReport = await this.#authoring.auditPublicPacks();
      record("Public-pack audit excludes AE5E Administrative", publicReport.excludedInternalPacks.includes("action-effects-5e.ae5e-administrative")
        && !publicReport.packIds.includes("action-effects-5e.ae5e-administrative"), {
        packsAudited: publicReport.packsAudited,
        total: publicReport.total,
        missingPacks: publicReport.missingPacks
      });

      const tempData = canonical.toObject();
      delete tempData._id;
      tempData.name = `AE5E CAT Metadata Authoring Test — ${foundry.utils.randomID(6)}`;
      if (tempData.flags?.cat?.automation) delete tempData.flags.cat.automation;
      tempItem = await Item.create(tempData, { renderSheet: false });
      if (!tempItem) throw new Error("Temporary Item could not be created.");

      const probeKey = "__ae5eMetadataAuthoringProbe";
      const probeValue = "preserve-me";
      await tempItem.update({ [`flags.cat.config.${probeKey}`]: probeValue });
      tempItem = game.items.get(tempItem.id);
      record("Temporary un-stamped Item created", Boolean(tempItem), {
        uuid: tempItem.uuid,
        source: tempItem.flags?.cat?.automation?.source ?? null,
        version: tempItem.flags?.cat?.automation?.version ?? null
      });

      const preAudit = this.#authoring.auditDocument(tempItem);
      record("Audit detects missing CAT metadata before stamping", !preAudit.valid
        && preAudit.issues.some(issue => issue.includes(CAT_AUTOMATION_SOURCE_FLAG))
        && preAudit.issues.some(issue => issue.includes(CAT_AUTOMATION_VERSION_FLAG)), preAudit);

      const protectedBefore = {
        name: tempItem.name,
        type: tempItem.type,
        identifier: tempItem.system?.identifier,
        rules: tempItem.system?.source?.rules,
        configProbe: tempItem.flags?.cat?.config?.[probeKey],
        ae5eFlags: JSON.stringify(tempItem.flags?.[CAT_AUTOMATION_SOURCE_ID] ?? null),
        effects: tempItem.effects.map(effect => ({ id: effect.id, name: effect.name })),
        activities: Array.from(tempItem.system?.activities ?? []).map(activity => ({ id: activity.id, name: activity.name, type: activity.type }))
      };

      const firstStamp = await this.#authoring.setMetadata(tempItem.uuid, { version: initialVersion });
      tempItem = game.items.get(tempItem.id);
      record("Authoring API stamps AE5E source", tempItem.flags?.cat?.automation?.source === CAT_AUTOMATION_SOURCE_ID, tempItem.flags?.cat?.automation ?? null);
      record("Authoring API stamps initial automation version", tempItem.flags?.cat?.automation?.version === initialVersion, tempItem.flags?.cat?.automation ?? null);
      record("Stamped Item passes audit", firstStamp.audit.valid, firstStamp.audit);

      const protectedAfter = {
        name: tempItem.name,
        type: tempItem.type,
        identifier: tempItem.system?.identifier,
        rules: tempItem.system?.source?.rules,
        configProbe: tempItem.flags?.cat?.config?.[probeKey],
        ae5eFlags: JSON.stringify(tempItem.flags?.[CAT_AUTOMATION_SOURCE_ID] ?? null),
        effects: tempItem.effects.map(effect => ({ id: effect.id, name: effect.name })),
        activities: Array.from(tempItem.system?.activities ?? []).map(activity => ({ id: activity.id, name: activity.name, type: activity.type }))
      };

      record("Metadata stamping preserves Item identity/core metadata", protectedAfter.name === protectedBefore.name
        && protectedAfter.type === protectedBefore.type
        && protectedAfter.identifier === protectedBefore.identifier
        && protectedAfter.rules === protectedBefore.rules, { before: protectedBefore, after: protectedAfter });
      record("Metadata stamping preserves CAT configuration", protectedAfter.configProbe === probeValue, { value: protectedAfter.configProbe });
      record("Metadata stamping preserves AE5E flags", protectedAfter.ae5eFlags === protectedBefore.ae5eFlags);
      record("Metadata stamping preserves Active Effects", JSON.stringify(protectedAfter.effects) === JSON.stringify(protectedBefore.effects));
      record("Metadata stamping preserves Activities", JSON.stringify(protectedAfter.activities) === JSON.stringify(protectedBefore.activities));

      const secondStamp = await this.#authoring.setMetadata(tempItem, { version: updatedVersion });
      tempItem = game.items.get(tempItem.id);
      record("Authoring API bumps automation version independently", tempItem.flags?.cat?.automation?.version === updatedVersion && secondStamp.audit.valid, secondStamp.audit);

      let invalidRejected = false;
      try { await this.#authoring.setMetadata(tempItem, { version: "1.0" }); }
      catch { invalidRejected = true; }
      tempItem = game.items.get(tempItem.id);
      record("Invalid automation version is rejected without mutation", invalidRejected && tempItem.flags?.cat?.automation?.version === updatedVersion, {
        version: tempItem.flags?.cat?.automation?.version
      });

      const finalAudit = await this.#authoring.auditItem(tempItem.uuid);
      record("Final authored Item is valid", finalAudit.valid
        && finalAudit.source === CAT_AUTOMATION_SOURCE_ID
        && finalAudit.version === updatedVersion
        && finalAudit.identifier === identifier, finalAudit);
    } catch (error) {
      record("Live metadata authoring execution completed without error", false, {
        message: error?.message ?? String(error),
        stack: error?.stack ?? null
      });
    } finally {
      if (tempItem) {
        const id = tempItem.id;
        try {
          const live = game.items.get(id);
          if (live) await live.delete();
          record("Temporary authoring test Item removed", !game.items.get(id), { deletedId: id });
        } catch (error) {
          record("Temporary authoring test Item removed", false, { message: error?.message ?? String(error) });
        }
      }
    }

    const passed = checks.every(check => check.passed);
    const count = checks.filter(check => check.passed).length;
    const result = {
      passed,
      passedCount: count,
      total: checks.length,
      checks,
      authoring: this.#authoring.getStatus(),
      stats: this.#authoring.getStats(),
      safety: { canonicalCompendiumModified: false, temporaryWorldItemOnly: true }
    };

    console.group(`AE5E ${MODULE_VERSION} — CAT METADATA AUTHORING — ${passed ? "PASS" : "FAIL"}`);
    console.table(checks.map((check, index) => ({ case: index + 1, test: check.name, result: check.passed ? "PASS" : "FAIL" })));
    console.log("Full result:", result);
    console.groupEnd();
    console.log(
      `%cAE5E ${MODULE_VERSION} — CAT METADATA AUTHORING — ${passed ? "PASS" : "FAIL"}`,
      `font-size:24px;font-weight:bold;color:${passed ? "#5cff8d" : "#ff5c5c"};`
    );

    if (notify && globalThis.ui?.notifications) {
      const message = `AE5E CAT Metadata Authoring: ${count}/${checks.length} ${passed ? "PASS" : "FAIL"}`;
      if (passed) ui.notifications.info(message);
      else ui.notifications.error(message);
    }

    return result;
  }
}
