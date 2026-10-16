import { MODULE_ID } from "../core/constants.js";
import { duplicateSafely } from "../core/utils.js";

export const METAMAGIC_FLAG = "metamagic";
export const METAMAGIC_SCHEMA = 1;
const identifier = value => typeof value === "string" && /^[a-z][a-z0-9-]{0,79}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const uniqueIds = value => Array.isArray(value) && value.every(identifier) && new Set(value).size === value.length;

/** Item-owned rules and provenance. Never creates, converts, or deletes Items. */
export class MetamagicDeclarationService {
  async learn(actor, optionIds) {
    if (!actor?.isOwner || !uniqueIds(optionIds)) throw new Error("An owning user and unique option ids are required.");
    const compiled = this.compile(actor);
    if (compiled.optionChoices == null || optionIds.length > compiled.optionChoices) throw new Error("Learned choices exceed the active declaration capacity.");
    for (const id of optionIds) {
      const definitions = [...actor.items].filter(item => {
        const { declaration } = this.read(item);
        return declaration?.type === "option" && declaration.id === id && this.active(item, declaration);
      });
      if (definitions.length !== 1) throw new Error(`Option '${id}' needs exactly one active definition.`);
    }
    const main = [...actor.items].find(item => item.uuid === compiled.mainUuid);
    await main.update({ [`flags.${MODULE_ID}.${METAMAGIC_FLAG}.learnedOptions`]: [...optionIds] });
    return this.compile(actor);
  }

  read(item) {
    const value = item?.flags?.[MODULE_ID]?.[METAMAGIC_FLAG];
    if (value == null) return { declaration: null, errors: [] };
    const errors = [];
    const fail = message => errors.push(message);
    if (!value || typeof value !== "object" || Array.isArray(value)) return { declaration: null, errors: ["Declaration must be an object."] };
    if (value.version !== METAMAGIC_SCHEMA || value.family !== "metamagic") fail("Unsupported declaration version or family.");
    if (!["main", "provider", "option"].includes(value.type) || !identifier(value.id)) fail("Invalid declaration type or stable id.");
    if (value.enabled != null && typeof value.enabled !== "boolean") fail("enabled must be boolean.");
    if (value.activation != null && (!value.activation || typeof value.activation !== "object"
      || Object.keys(value.activation).some(key => !["equipped", "attuned"].includes(key))
      || Object.values(value.activation).some(entry => typeof entry !== "boolean"))) fail("Invalid activation requirements.");
    if (value.type === "main") {
      if (!uniqueIds(value.learnedOptions)) fail("learnedOptions must contain unique option ids.");
      if (!integer(value.optionChoices) || !integer(value.selectionLimit) || value.selectionLimit < 1) fail("Invalid choice or selection limit.");
      if (!identifier(value.resource?.identifier)) fail("A native resource identifier is required.");
      if (value.resource?.itemId != null && typeof value.resource.itemId !== "string") fail("Invalid resource Item id.");
    }
    if (value.type === "option") {
      if (!integer(value.cost)) fail("Option cost must be a non-negative integer.");
      if (typeof value.execution?.macroUuid !== "string" || !value.execution.macroUuid) fail("Option requires an executable Macro UUID.");
      if (typeof value.tooltip !== "string") fail("Option requires an Item-owned tooltip.");
    }
    if (value.type === "provider") {
      if (value.grants != null && !uniqueIds(value.grants)) fail("grants must contain unique option ids.");
      if (value.choiceBonus != null && !integer(value.choiceBonus)) fail("Invalid choice bonus.");
      if (value.selectionLimit != null && (!integer(value.selectionLimit) || value.selectionLimit < 1)) fail("Invalid selection limit.");
      if (value.costAdjustments != null && (!Array.isArray(value.costAdjustments)
        || value.costAdjustments.some(entry => !entry || !uniqueIds(entry.optionIds)
          || !Number.isSafeInteger(entry.amount) || typeof entry.label !== "string" || !entry.label))) fail("Invalid cost adjustments.");
    }
    return { declaration: errors.length ? null : duplicateSafely(value), errors };
  }

  active(item, declaration) {
    if (declaration.enabled === false) return false;
    for (const [key, required] of Object.entries(declaration.activation ?? {})) {
      if (Boolean(item.system?.[key]) !== required) return false;
    }
    return true;
  }

  compile(actor) {
    const diagnostics = [];
    const entries = [];
    for (const item of actor?.items ?? []) {
      const { declaration, errors } = this.read(item);
      for (const message of errors) diagnostics.push({ sourceUuid: item.uuid, message });
      if (declaration && this.active(item, declaration)) entries.push({ item, declaration });
    }
    const mains = entries.filter(entry => entry.declaration.type === "main");
    if (mains.length !== 1) return { ready: false, diagnostics: [...diagnostics, { message: "Exactly one active main declaration is required." }], options: [] };
    const main = mains[0];
    const providers = entries.filter(entry => entry.declaration.type === "provider");
    const choices = main.declaration.optionChoices + providers.reduce((total, entry) => total + (entry.declaration.choiceBonus ?? 0), 0);
    const learned = main.declaration.learnedOptions;
    if (learned.length > choices) diagnostics.push({ message: `Learned options exceed the declared choice capacity (${choices}).` });
    const { identifier: resourceIdentifier, itemId } = main.declaration.resource;
    const pools = [...(actor.items ?? [])].filter(item => item.system?.identifier === resourceIdentifier && (!itemId || item.id === itemId));
    const pool = pools.length === 1 ? pools[0] : null;
    if (!pool) diagnostics.push({ message: "Native resource Item is missing or ambiguous; set resource.itemId to disambiguate." });
    const provenance = new Map();
    const grant = (id, source, kind) => {
      const list = provenance.get(id) ?? [];
      list.push({ sourceUuid: source.uuid, kind });
      provenance.set(id, list);
    };
    for (const id of learned) grant(id, main.item, "learned");
    for (const entry of providers) for (const id of entry.declaration.grants ?? []) grant(id, entry.item, "granted");
    const options = [];
    for (const [id, origins] of provenance) {
      const candidates = entries.filter(entry => entry.declaration.type === "option" && entry.declaration.id === id);
      if (candidates.length !== 1) {
        diagnostics.push({ message: `Option '${id}' is missing or has duplicate active definitions.` });
        continue;
      }
      const { item, declaration } = candidates[0];
      const adjustments = providers.flatMap(entry => (entry.declaration.costAdjustments ?? [])
        .filter(adjustment => adjustment.optionIds.includes(id))
        .map(adjustment => ({ ...adjustment, sourceUuid: entry.item.uuid })));
      const cost = Math.max(0, declaration.cost + adjustments.reduce((total, entry) => total + entry.amount, 0));
      options.push({ id, label: item.name, sourceUuid: item.uuid, declaration, provenance: origins,
        baseCost: declaration.cost, cost, adjustments });
    }
    return {
      ready: Boolean(pool) && learned.length <= choices,
      mainUuid: main.item.uuid, resourceUuid: pool?.uuid ?? null, resourceId: pool?.id ?? null,
      optionChoices: choices, learnedOptions: [...learned],
      selectionLimit: Math.max(main.declaration.selectionLimit, ...providers.map(entry => entry.declaration.selectionLimit ?? 1)),
      providers: providers.map(entry => ({ sourceUuid: entry.item.uuid, id: entry.declaration.id })),
      diagnostics, options
    };
  }
}
