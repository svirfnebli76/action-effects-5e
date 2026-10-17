import { MODULE_ID } from "../core/constants.js";
import { clone, getPath, isObject, jsonIssues } from "./json-data.js";

export const declarationIdentity = (sourceItemUuid, family, declarationId) => JSON.stringify([sourceItemUuid, family, declarationId]);

/** Read-only discovery. No conversion, flag writes, feature hooks or execution. */
export class DeclarationCollectionService {
  constructor({ registry, ac5e = null }) { this.registry = registry; this.ac5e = ac5e; }

  read(item, familyId) {
    const family = this.registry.get(familyId);
    if (!family) return { valid: false, absent: false, issues: [`Unknown declaration family '${familyId}'.`], records: [] };
    const raw = getPath(item, family.flagPath);
    if (raw === undefined) return { valid: true, absent: true, issues: [], records: [], envelope: null };
    const issues = jsonIssues(raw);
    if (issues.length) return { valid: false, absent: false, issues, records: [], envelope: null, blocked: true };
    if (!isObject(raw) || raw.version !== family.version || !Array.isArray(raw.declarations)) {
      issues.push(`Expected version ${family.version} declaration collection; legacy or unsupported data requires explicit migration.`);
      return { valid: false, absent: false, issues, records: [], envelope: clone(raw), blocked: true };
    }
    const ids = new Set();
    raw.declarations.forEach((record, index) => {
      for (const message of this.registry.validateRecord(familyId, record).issues) issues.push(`${record?.id ?? index}: ${message}`);
      if (ids.has(record?.id)) issues.push(`${record?.id}: duplicate declaration id.`);
      ids.add(record?.id);
    });
    return { valid: !issues.length, absent: false, issues, records: clone(raw.declarations), envelope: clone(raw), blocked: false };
  }

  migrate(item, familyId) {
    const family = this.registry.get(familyId);
    if (!family?.migrate) throw new Error("No explicit migration is registered for this family; existing data is preserved.");
    const envelope = family.migrate(clone(getPath(item, family.flagPath)));
    const candidate = { flags: { [MODULE_ID]: { [family.flagPath.split(".").at(-1)]: envelope } } };
    const result = this.read(candidate, familyId);
    if (!result.valid) throw new Error(result.issues.join(" "));
    return clone(envelope); // caller must explicitly review/save; never writes here
  }

  discover(items) {
    const entries = [];
    const diagnostics = [];
    const identities = new Set();
    for (const item of items ?? []) {
      for (const family of this.registry.list()) {
        const result = this.read(item, family.id);
        for (const message of result.issues) diagnostics.push({ sourceItemUuid: item.uuid, family: family.id, message });
        if (!result.valid) continue; // a malformed collection never contributes a partial definition
        for (const declaration of result.records) {
          if (!item.uuid) { diagnostics.push({ family: family.id, message: "Source Item UUID is required." }); continue; }
          const identity = declarationIdentity(item.uuid, family.id, declaration.id);
          if (identities.has(identity)) continue;
          identities.add(identity);
          entries.push({ identity, family: family.id, declarationId: declaration.id, sourceItemUuid: item.uuid,
            flagPath: family.flagPath, declaration, item,
            active: Object.entries(declaration.activation ?? {}).every(([key, required]) => Boolean(item.system?.[key]) === required) });
        }
      }
      // Other Item flags are independent. Only collection-shaped unknown data is reported.
      for (const [key, value] of Object.entries(item.flags?.[MODULE_ID] ?? {})) {
        if (isObject(value) && Array.isArray(value.declarations)
          && !this.registry.list().some(family => family.flagPath === `flags.${MODULE_ID}.${key}`)) {
          diagnostics.push({ sourceItemUuid: item.uuid, family: key, message: "Unknown declaration family; data preserved and not consumed." });
        }
      }
    }
    return { entries, diagnostics };
  }

  evaluate(entry, context = {}) {
    if (!entry?.active) return { ok: true, eligible: false, reason: "activation-requirements" };
    const expression = entry.declaration.condition ?? "";
    if (!expression.trim()) return { ok: true, eligible: true, reason: "no-condition" };
    if (!this.ac5e) return { ok: false, eligible: false, reason: "ac5e-unavailable" };
    return this.ac5e.evaluateCondition({ ...context, expression,
      context: { ...context.context, family: entry.family, declarationIdentity: entry.identity, sourceItemUuid: entry.sourceItemUuid } });
  }

  /** Consumers provide semantic keys; shared code never names individual options. */
  resolveGrants({ definitions, grants }) {
    const options = [];
    const diagnostics = [];
    for (const key of new Set(grants.map(grant => grant.key))) {
      const candidates = [...new Map(definitions.filter(definition => definition.key === key && definition.entry.active)
        .map(definition => [definition.entry.identity, definition.entry])).values()];
      const provenance = [...new Map(grants.filter(grant => grant.key === key && grant.entry.active)
        .map(grant => [JSON.stringify([grant.entry.identity, grant.kind]), { identity: grant.entry.identity,
          sourceItemUuid: grant.entry.sourceItemUuid, family: grant.entry.family, declarationId: grant.entry.declarationId, kind: grant.kind }])).values()];
      if (!provenance.length) continue;
      if (candidates.length !== 1) { diagnostics.push({ key, message: "Definition is missing or ambiguous." }); continue; }
      options.push({ key, entry: candidates[0], provenance });
    }
    return { options, diagnostics };
  }
}
