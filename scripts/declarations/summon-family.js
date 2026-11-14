import {
  MODULE_ID,
  SUMMON_DECLARATION_SCHEMA_VERSION,
  SUMMON_INITIATIVE_MODES
} from "../core/constants.js";
import { isObject } from "./json-data.js";

const initiativeModes = new Set(Object.values(SUMMON_INITIATIVE_MODES));

/**
 * Generic summon infrastructure declaration.
 *
 * Creature rules remain on the summoning Item and summoned Actor. This
 * declaration only opts a summoning activity into persistent context and
 * initiative coordination.
 */
export function registerSummonFamily(registry) {
  return registry.register({
    id: "summon",
    label: "Summon",
    flagPath: `flags.${MODULE_ID}.summon`,
    version: SUMMON_DECLARATION_SCHEMA_VERSION,
    schema: {
      type: "object",
      required: ["id", "type", "initiative"],
      roles: ["summon"],
      initiative: { modes: [...initiativeModes] }
    },
    templates: [{
      id: "summon",
      label: "Coordinated summon",
      record: {
        id: "summon",
        type: "summon",
        initiative: { mode: SUMMON_INITIATIVE_MODES.AFTER_SUMMONER }
      }
    }],
    validate(record) {
      const issues = [];
      if (record.type !== "summon") issues.push("type must be summon.");
      if (!isObject(record.initiative) || !initiativeModes.has(record.initiative?.mode)) {
        issues.push("initiative.mode must be a supported summon initiative mode.");
      }
      if (isObject(record.initiative)) {
        const unknown = Object.keys(record.initiative).filter(key => key !== "mode");
        if (unknown.length) issues.push(`initiative contains unsupported fields: ${unknown.join(", ")}.`);
      }
      return issues;
    }
  });
}
