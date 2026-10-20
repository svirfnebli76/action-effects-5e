import { MODULE_ID } from "../core/constants.js";

export const DEFAULT_BROKER_EXECUTION = Object.freeze({ interface: "cat-embedded", name: "Metamagic Broker" });

/** Family consumer. Owned option Items are the learned set; nothing is written. */
export class MetamagicCollectionConsumer {
  constructor({ collections }) { this.collections = collections; }

  compile(actor, context = {}) {
    const discovered = this.collections.discover(actor?.items ?? []);
    const diagnostics = discovered.diagnostics.filter(entry => entry.family === "metamagic");
    const entries = discovered.entries.filter(entry => entry.family === "metamagic" && this.eligible(entry, context, diagnostics));
    const mains = entries.filter(entry => entry.declaration.type === "main");
    const rawBase = [...(actor?.items ?? [])].some(item => {
      const records = item.flags?.[MODULE_ID]?.metamagic?.declarations;
      return Array.isArray(records) && records.some(record => record?.type === "main");
    });
    if (mains.length !== 1) return { mode: "collection", participating: rawBase && (mains.length > 0 || diagnostics.length > 0), ready: false,
      options: [], diagnostics: [...diagnostics, { message: "Exactly one eligible base declaration is required." }] };
    const main = mains[0];
    const providers = entries.filter(entry => entry.declaration.type === "provider");
    const definitions = entries.filter(entry => entry.declaration.type === "option");
    const ownedOptions = discovered.entries.filter(entry => entry.family === "metamagic" && entry.active && entry.declaration.type === "option");
    const learned = definitions.filter(entry => entry.declaration.acquisition !== "grant-only");
    const learnedIds = [...new Set(ownedOptions.filter(entry => entry.declaration.acquisition !== "grant-only").map(entry => entry.declarationId))];
    const optionChoices = main.declaration.optionChoices + providers.reduce((sum, entry) => sum + (entry.declaration.choiceBonus ?? 0), 0);
    if (learnedIds.length > optionChoices) diagnostics.push({ message: `Owned learned options exceed the declared choice capacity (${optionChoices}); remove extra learned option Items or add a capacity provider.` });
    const grants = learned.map(entry => ({ key: entry.declarationId, entry, kind: "learned" }));
    for (const entry of providers) for (const key of entry.declaration.grants ?? []) {
      // A known definition can be ineligible for this particular casting.
      // A missing definition remains a diagnostic, rather than a silent grant.
      if (ownedOptions.some(option => option.declarationId === key) && !definitions.some(option => option.declarationId === key)) continue;
      grants.push({ key, entry, kind: "granted" });
    }
    const resolved = this.collections.resolveGrants({ definitions: definitions.map(entry => ({ key: entry.declarationId, entry })), grants });
    diagnostics.push(...resolved.diagnostics);
    const { identifier, itemId } = main.declaration.resource;
    const pools = [...(actor?.items ?? [])].filter(item => item.system?.identifier === identifier && (!itemId || item.id === itemId));
    const pool = pools.length === 1 ? pools[0] : null;
    if (!pool) diagnostics.push({ message: "Native resource Item is missing or ambiguous; set resource.itemId to disambiguate." });
    const options = resolved.options.map(({ key, entry, provenance }) => {
      const adjustments = providers.flatMap(provider => (provider.declaration.costAdjustments ?? [])
        .filter(adjustment => adjustment.optionIds.includes(key))
        .map(adjustment => ({ ...adjustment, identity: provider.identity, sourceUuid: provider.sourceItemUuid })));
      return { id: key, label: entry.item.name, identity: entry.identity, family: entry.family,
        sourceUuid: entry.sourceItemUuid, declaration: entry.declaration, provenance,
        baseCost: entry.declaration.cost,
        cost: Math.max(0, entry.declaration.cost + adjustments.reduce((sum, adjustment) => sum + adjustment.amount, 0)), adjustments };
    });
    return { mode: "collection", participating: true, ready: !diagnostics.length,
      mainUuid: main.sourceItemUuid, mainIdentity: main.identity,
      mainDeclaration: { ...main.declaration, execution: main.declaration.execution ?? { ...DEFAULT_BROKER_EXECUTION } },
      resourceUuid: pool?.uuid ?? null, resourceId: pool?.id ?? null,
      optionChoices, learnedOptions: learnedIds,
      selectionLimit: Math.max(main.declaration.selectionLimit, ...providers.map(entry => entry.declaration.selectionLimit ?? 1)),
      providers: providers.map(entry => ({ identity: entry.identity, sourceUuid: entry.sourceItemUuid, id: entry.declarationId })),
      diagnostics, options };
  }

  eligible(entry, context, diagnostics) {
    const result = this.collections.evaluate(entry, context);
    if (!result.ok) diagnostics.push({ identity: entry.identity, sourceItemUuid: entry.sourceItemUuid,
      message: `Declaration condition could not be evaluated: ${result.reason}.` });
    return result.ok && result.eligible;
  }
}
