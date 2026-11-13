import { MODULE_ID } from "../core/constants.js";

/** Read-only discovery for independently owned save-protection feature Items. */
export class SaveProtectionDeclarationService {
  constructor({ collections }) { this.collections = collections; }

  read(item) { return this.collections.read(item, "save-protection"); }

  hasAny(actor) {
    return [...(actor?.items ?? [])].some(item =>
      Array.isArray(item.flags?.[MODULE_ID]?.saveProtection?.declarations));
  }

  compile(actor, context = {}) {
    const discovered = this.collections.discover(actor?.items ?? []);
    const diagnostics = discovered.diagnostics.filter(entry => entry.family === "save-protection");
    const features = [];
    for (const entry of discovered.entries.filter(candidate => candidate.family === "save-protection")) {
      const evaluation = this.collections.evaluate(entry, context);
      if (!evaluation.ok) {
        diagnostics.push({
          identity: entry.identity,
          sourceItemUuid: entry.sourceItemUuid,
          message: `Declaration condition could not be evaluated: ${evaluation.reason}.`
        });
        continue;
      }
      if (!evaluation.eligible) continue;
      features.push({
        id: entry.declarationId,
        identity: entry.identity,
        family: entry.family,
        label: entry.item.name,
        sourceUuid: entry.sourceItemUuid,
        declaration: entry.declaration,
        priority: Number(entry.declaration.priority) || 0
      });
    }
    features.sort((left, right) => right.priority - left.priority
      || left.label.localeCompare(right.label)
      || left.identity.localeCompare(right.identity));
    return {
      participating: this.hasAny(actor),
      ready: diagnostics.length === 0,
      diagnostics,
      features
    };
  }
}
