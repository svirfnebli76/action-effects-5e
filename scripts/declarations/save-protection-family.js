import { MODULE_ID } from "../core/constants.js";
import { isObject } from "./json-data.js";
import { CASTING_PHASES } from "../casting/casting-phase-service.js";

const validExecution = execution => isObject(execution)
  && execution.interface === "cat-embedded"
  && typeof execution.name === "string"
  && Boolean(execution.name.trim())
  && execution.macroUuid === undefined;

/**
 * Generic save-protection providers. Item-owned CAT macros retain every
 * feature rule, selection limit, eligibility check, and presentation string.
 */
export function registerSaveProtectionFamily(registry) {
  return registry.register({
    id: "save-protection",
    label: "Save Protection",
    flagPath: `flags.${MODULE_ID}.saveProtection`,
    version: 1,
    schema: {
      type: "object",
      required: ["id", "type", "execution"],
      roles: ["feature"],
      execution: { interfaces: ["cat-embedded"], owner: "source Item" }
    },
    templates: [{
      id: "feature",
      label: "Save-protection feature",
      record: {
        id: "save-protection-feature",
        type: "feature",
        phase: CASTING_PHASES.SAVES_READY,
        priority: 0,
        execution: { interface: "cat-embedded", name: "" }
      }
    }],
    validate(record) {
      const issues = [];
      if (record.type !== "feature") issues.push("type must be feature.");
      if (record.phase !== CASTING_PHASES.SAVES_READY) {
        issues.push("phase must be saves-ready.");
      }
      if (record.priority !== undefined && !Number.isSafeInteger(record.priority)) {
        issues.push("priority must be an integer.");
      }
      if (!validExecution(record.execution)) {
        issues.push("execution must reference a named CAT embedded Item macro.");
      }
      return issues;
    }
  });
}
