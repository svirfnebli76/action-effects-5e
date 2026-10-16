/** This function is installed into a world Script Macro referenced by the option Item. */
export async function distantSpell({ phase, declaration, context }) {
  const range = context.activity.range;
  const rules = declaration.rules;
  const feetPerUnit = { ft: 1, mi: 5280, m: 1 / 0.3048, km: 1000 / 0.3048 };
  let updates;
  if (range?.units === "touch") {
    updates = { "range.override": true, "range.units": rules.touch.units, "range.value": rules.touch.value };
  } else {
    const value = Number(range?.value);
    const multiplier = feetPerUnit[range?.units];
    if (!multiplier || !Number.isFinite(value) || value * multiplier < rules.minimumFeet) {
      return { eligible: false, reason: "Requires Touch or a numerical range of at least 5 feet; Self and Special are unavailable." };
    }
    updates = { "range.override": true, "range.units": range.units, "range.value": value * rules.multiplier };
  }
  if (phase === "offer") return { eligible: true };
  if (phase === "prepare") return { activityUpdates: updates };
  throw new Error(`Unsupported option execution phase '${phase}'.`);
}
