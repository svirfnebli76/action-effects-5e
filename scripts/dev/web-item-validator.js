import {
  ANIMATION_AUTOMATED_ANIMATIONS_POLICIES,
  ANIMATION_FLAG_KEY,
  MODULE_ID
} from "../core/constants.js";

function asArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return [...value];
  if (typeof value.values === "function") return [...value.values()];
  return [value];
}

function getProperty(object, path) {
  if (globalThis.foundry?.utils?.getProperty) return foundry.utils.getProperty(object, path);
  return String(path).split(".").reduce((value, part) => value?.[part], object);
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function activityField(activity, path, fallback = undefined) {
  const direct = getProperty(activity, path);
  if (direct !== undefined) return direct;
  const nested = getProperty(activity, `system.${path}`);
  return nested !== undefined ? nested : fallback;
}

function activitiesOf(item) {
  const activities = item?.system?.activities;
  if (!activities) return [];
  if (typeof activities.values === "function") return [...activities.values()];
  return Object.values(activities);
}

function findActivity(item, ...references) {
  const wanted = new Set(references.map(normalize).filter(Boolean));
  if (!wanted.size) return null;
  return activitiesOf(item).find(activity => {
    const values = [
      activity?.id,
      activity?._id,
      activity?.identifier,
      activity?.system?.identifier,
      activity?.name
    ].map(normalize);
    return values.some(value => wanted.has(value));
  }) ?? null;
}

function noAppliedEffects(activity) {
  return asArray(activityField(activity, "effects", [])).length === 0;
}

function noConsumption(activity, owningItem) {
  const targets = asArray(activityField(activity, "consumption.targets", []));
  const spellSlot = activityField(activity, "consumption.spellSlot", false);
  const canConsumeSpellSlot = owningItem?.type === "spell";
  return targets.length === 0 && !(canConsumeSpellSlot && spellSlot === true);
}

function automationTargetIsExternal(activity) {
  return activityField(activity, "target.override", false) === true
    && activityField(activity, "target.prompt", true) === false;
}

/**
 * Development-only authoring validator for the 2024 Web Item.
 *
 * This class deliberately lives under scripts/dev. It may know Web's Item
 * contract because it is validation tooling, not runtime automation. It never
 * creates Regions, executes Activities, applies effects, or encodes gameplay
 * behavior into AE5E production services.
 */
export class WebItemValidator {
  async validate({ item = null, itemUuid = null, escapeTemplateUuid = null } = {}) {
    let sourceItem = item;
    if (!sourceItem && itemUuid) {
      try { sourceItem = await globalThis.fromUuid?.(itemUuid); } catch { sourceItem = null; }
    }

    const checks = [];
    const record = (name, passed, details = null) => checks.push({ name, passed: Boolean(passed), details });

    if (!sourceItem || sourceItem.documentName !== "Item") {
      record("Web source Item resolves", false, itemUuid ?? null);
      return { passed: false, checks, itemUuid: null };
    }

    record("Web source Item resolves", true, sourceItem.uuid ?? null);
    record("Source Item is a spell", sourceItem.type === "spell", sourceItem.type ?? null);
    record("Web uses the 2024 ruleset", String(sourceItem.system?.source?.rules ?? "") === "2024", sourceItem.system?.source?.rules ?? null);
    record("Web identifier is 'web'", normalize(sourceItem.system?.identifier) === "web", sourceItem.system?.identifier ?? null);
    record("Web is a 2nd-level Conjuration spell", Number(sourceItem.system?.level) === 2 && String(sourceItem.system?.school ?? "") === "con", {
      level: sourceItem.system?.level ?? null,
      school: sourceItem.system?.school ?? null
    });
    record("Web has a 1 Action casting time", String(sourceItem.system?.activation?.type ?? "") === "action", sourceItem.system?.activation ?? null);
    record("Web duration is 1 hour", Number(sourceItem.system?.duration?.value) === 1 && String(sourceItem.system?.duration?.units ?? "") === "hour", sourceItem.system?.duration ?? null);

    const properties = new Set(asArray(sourceItem.system?.properties));
    record("Web is configured as Concentration", properties.has("concentration"), [...properties]);
    record("Web has Verbal, Somatic, and Material components", ["vocal", "somatic", "material"].every(value => properties.has(value)), [...properties]);
    record("Web range is 60 feet", Number(sourceItem.system?.range?.value) === 60 && String(sourceItem.system?.range?.units ?? "") === "ft", sourceItem.system?.range ?? null);
    record("Web descriptive target is a 20-foot cube", String(sourceItem.system?.target?.template?.type ?? "") === "cube" && Number(sourceItem.system?.target?.template?.size) === 20, sourceItem.system?.target?.template ?? null);

    const cast = findActivity(sourceItem, "Cast Web", "cast-web");
    const save = findActivity(sourceItem, "Web Save", "web-save");
    const burn = findActivity(sourceItem, "Burning Web Damage", "burning-web-damage");

    record("Cast Web Activity exists and is Utility", cast?.type === "utility", cast?.type ?? null);
    record("Cast Web overrides parent targeting and suppresses native template prompting", Boolean(cast) && automationTargetIsExternal(cast), activityField(cast, "target", null));
    record("Cast Web applies no source effects directly", Boolean(cast) && noAppliedEffects(cast), activityField(cast, "effects", null));

    record("Web Save Activity exists and is a Save", save?.type === "save", save?.type ?? null);
    record("Web Save overrides parent targeting and suppresses native template prompting", Boolean(save) && automationTargetIsExternal(save), activityField(save, "target", null));
    const rawSaveAbility = activityField(save, "save.ability", null);
    const saveAbilities = new Set(asArray(rawSaveAbility));
    if (!saveAbilities.size && typeof rawSaveAbility === "string") saveAbilities.add(rawSaveAbility);
    record("Web Save uses Dexterity", saveAbilities.has("dex"), [...saveAbilities]);
    const saveDcCalculation = String(activityField(save, "save.dc.calculation", "") ?? "");
    record("Web Save uses the caster's spell save DC", saveDcCalculation === "spellcasting", {
      calculation: saveDcCalculation,
      formula: activityField(save, "save.dc.formula", "")
    });
    record("Web Save has no damage or automatic effects", asArray(activityField(save, "damage.parts", [])).length === 0 && noAppliedEffects(save), {
      damageParts: asArray(activityField(save, "damage.parts", [])).length,
      effects: asArray(activityField(save, "effects", [])).length
    });
    record("Web Save does not consume another spell slot or resource", Boolean(save) && noConsumption(save, sourceItem), activityField(save, "consumption", null));

    record("Burning Web Damage Activity exists and is Damage", burn?.type === "damage", burn?.type ?? null);
    record("Burning Web Damage overrides parent targeting and suppresses native template prompting", Boolean(burn) && automationTargetIsExternal(burn), activityField(burn, "target", null));
    const damageParts = asArray(activityField(burn, "damage.parts", []));
    const fireParts = damageParts.filter(part => new Set(asArray(part?.types)).has("fire") || String(part?.type ?? "") === "fire");
    const firePart = fireParts[0] ?? null;
    const is2d4 = Boolean(firePart && Number(firePart.number) === 2 && Number(firePart.denomination) === 4);
    record("Burning Web Damage is exactly one 2d4 Fire damage part", damageParts.length === 1 && fireParts.length === 1 && is2d4, damageParts);
    record("Burning Web Damage has no save or automatic effects", asArray(activityField(burn, "save.ability", [])).length === 0 && noAppliedEffects(burn), {
      saveAbility: activityField(burn, "save.ability", null),
      effects: asArray(activityField(burn, "effects", [])).length
    });
    record("Burning Web Damage does not consume another spell slot or resource", Boolean(burn) && noConsumption(burn, sourceItem), activityField(burn, "consumption", null));

    const restrainedTemplate = asArray(sourceItem.effects).find(effect => normalize(effect?.name) === "restrained by web") ?? null;
    record("Transfer-disabled Restrained by Web source Active Effect exists", Boolean(restrainedTemplate) && restrainedTemplate.transfer !== true, restrainedTemplate?.uuid ?? restrainedTemplate?.name ?? null);
    const statuses = new Set(asArray(restrainedTemplate?.statuses));
    record("Restrained by Web source effect carries the Restrained status", statuses.has("restrained"), [...statuses]);

    let escapeTemplate = null;
    if (String(escapeTemplateUuid ?? "").trim()) {
      try { escapeTemplate = await globalThis.fromUuid?.(String(escapeTemplateUuid).trim()); } catch { escapeTemplate = null; }
    }
    record("Authoritative Escape Web helper UUID is supplied", Boolean(String(escapeTemplateUuid ?? "").trim()), escapeTemplateUuid ?? null);
    record("Authoritative Escape Web helper Item resolves", escapeTemplate?.documentName === "Item", escapeTemplate?.uuid ?? escapeTemplateUuid ?? null);
    const escape = escapeTemplate?.documentName === "Item"
      ? findActivity(escapeTemplate, "escape-web", "Escape Web")
      : null;
    record("Escape Web helper contains a Check Activity", escape?.type === "check", escape?.type ?? null);
    const escapeAbility = String(activityField(escape, "check.ability", "") ?? "");
    const escapeAssociated = new Set(asArray(activityField(escape, "check.associated", [])));
    record("Escape Web uses Strength (Athletics)", escapeAbility === "str" && escapeAssociated.has("ath"), {
      ability: escapeAbility,
      associated: [...escapeAssociated]
    });
    record("Escape Web is an Action", String(activityField(escape, "activation.type", "")) === "action", activityField(escape, "activation", null));
    record("Escape Web targets Self", normalize(activityField(escape, "target.affects.type", "")) === "self", activityField(escape, "target", null));
    record("Escape Web has no damage or automatic effects", asArray(activityField(escape, "damage.parts", [])).length === 0 && noAppliedEffects(escape), {
      damageParts: asArray(activityField(escape, "damage.parts", [])).length,
      effects: asArray(activityField(escape, "effects", [])).length
    });
    record("Escape Web does not consume a spell slot or resource", Boolean(escape) && noConsumption(escape, escapeTemplate), activityField(escape, "consumption", null));

    const aaPolicy = getProperty(sourceItem, `flags.${MODULE_ID}.${ANIMATION_FLAG_KEY}.automatedAnimations`);
    record("Automated Animations is explicitly suppressed through AE5E ownership", aaPolicy === ANIMATION_AUTOMATED_ANIMATIONS_POLICIES.SUPPRESS, aaPolicy ?? null);

    return {
      passed: checks.every(check => check.passed),
      checks,
      itemUuid: sourceItem.uuid ?? null,
      activities: {
        cast: cast?.uuid ?? cast?.id ?? null,
        save: save?.uuid ?? save?.id ?? null,
        burnDamage: burn?.uuid ?? burn?.id ?? null,
        escape: escape?.uuid ?? escape?.id ?? null,
        escapeTemplate: escapeTemplate?.uuid ?? null
      }
    };
  }
}
