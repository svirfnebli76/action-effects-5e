import { MODULE_ID } from "../core/constants.js";
import { isObject, validId } from "./json-data.js";

const integer = value => Number.isSafeInteger(value) && value >= 0;
const ids = value => Array.isArray(value) && value.every(validId) && new Set(value).size === value.length;
const validExecution = execution => isObject(execution)
  && ["cat-embedded", "midi-on-use", "actor-on-use", "effect-macro"].includes(execution.interface)
  && typeof execution.name === "string" && Boolean(execution.name.trim()) && execution.macroUuid === undefined;

/** Infrastructure schema only. Item-owned macros supply broker/option behavior. */
export function registerMetamagicFamily(registry) {
  return registry.register({
    id: "metamagic", label: "Metamagic", flagPath: `flags.${MODULE_ID}.metamagic`, version: 1,
    schema: { type: "object", required: ["id", "type"], roles: ["main", "option", "provider"],
      execution: { interfaces: ["cat-embedded", "midi-on-use", "actor-on-use", "effect-macro"], owner: "source Item" } },
    templates: [
      { id: "main", label: "Base / broker", record: { id: "base", type: "main", optionChoices: 2,
        selectionLimit: 1, resource: { identifier: "sorcery-points" } } },
      { id: "option", label: "Option", record: { id: "option", type: "option", cost: 1, tooltip: "",
        execution: { interface: "cat-embedded", name: "" } } },
      { id: "provider", label: "Provider / grant", record: { id: "provider", type: "provider", grants: [] } }
    ],
    validate(record) {
      const issues = [];
      if (!["main", "option", "provider"].includes(record.type)) issues.push("type must be main, option or provider.");
      if (record.type === "main") {
        if (!integer(record.optionChoices) || !integer(record.selectionLimit) || !record.selectionLimit) issues.push("Invalid choice capacity or selection limit.");
        if (!validId(record.resource?.identifier) || (record.resource?.itemId !== undefined && typeof record.resource.itemId !== "string")) issues.push("A native resource identifier and optional Item id are required.");
        if (record.execution !== undefined && !validExecution(record.execution)) issues.push("The broker execution must reference a named Item-owned macro.");
      }
      if (record.type === "option") {
        if (!integer(record.cost)) issues.push("cost must be a non-negative integer.");
        if (typeof record.tooltip !== "string") issues.push("tooltip must be Item-owned text.");
        if (!validExecution(record.execution)) {
          issues.push("execution must reference a named macro in an established Item-owned interface; standalone Macro UUIDs are unsupported.");
        }
        if (record.acquisition !== undefined && !["learned", "grant-only"].includes(record.acquisition)) issues.push("acquisition must be learned or grant-only.");
      }
      if (record.type === "provider") {
        if (record.grants !== undefined && !ids(record.grants)) issues.push("grants must contain unique option ids.");
        if (record.choiceBonus !== undefined && !integer(record.choiceBonus)) issues.push("choiceBonus must be non-negative.");
        if (record.selectionLimit !== undefined && (!integer(record.selectionLimit) || !record.selectionLimit)) issues.push("selectionLimit must be positive.");
        if (record.costAdjustments !== undefined && (!Array.isArray(record.costAdjustments) || record.costAdjustments.some(adjustment =>
          !isObject(adjustment) || !ids(adjustment.optionIds) || !Number.isSafeInteger(adjustment.amount)
          || typeof adjustment.label !== "string" || !adjustment.label.trim()))) issues.push("Invalid costAdjustments.");
      }
      return issues;
    }
  });
}
