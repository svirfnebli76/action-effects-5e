// Paste into the Distant Spell Item's CAT Embedded Macro editor.
// Name: Distant Spell | Event: Called | Pass: actorAe5eDeclarationOption
if (data?.namespace !== "ae5e.declarations" || data.family !== "metamagic"
  || data.kind !== "option" || !["offer", "prepare"].includes(data.phase)
  || document?.uuid !== data.sourceItemUuid || macroName !== data.execution.name) return;

const range = data.context.activity.range;
const rules = data.declaration.rules;
if (!rules || !Number.isFinite(rules.minimumFeet) || rules.minimumFeet < 0
  || !Number.isFinite(rules.multiplier) || rules.multiplier <= 0
  || !Number.isFinite(rules.touch?.value) || rules.touch.value < 0 || rules.touch.units !== "ft") {
  throw new Error("Distant Spell's Item declaration has invalid range rules.");
}

const feetPerUnit = { ft: 1, mi: 5280, m: 1 / 0.3048, km: 1000 / 0.3048 };
let updates;
if (range?.units === "touch") {
  updates = { "range.override": true, "range.units": rules.touch.units, "range.value": rules.touch.value };
} else {
  const value = Number(range?.value);
  const multiplier = feetPerUnit[range?.units];
  if (!multiplier || !Number.isFinite(value) || !Number.isFinite(value * rules.multiplier) || value * multiplier < rules.minimumFeet) {
    return data.respond(document, macroName, { eligible: false,
      reason: "Requires Touch or a numerical range of at least 5 feet; Self and Special are unavailable." });
  }
  updates = { "range.override": true, "range.units": range.units, "range.value": value * rules.multiplier };
}
return data.respond(document, macroName, data.phase === "offer" ? { eligible: true } : { activityUpdates: updates });
