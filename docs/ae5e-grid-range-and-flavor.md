# AE5E: grid range measurement and optional native card flavor hiding

This release changes the default **remote 3D Crosshairs placement range metric** to equal-cost 3D grid diagonals (`max(|dx|, |dy|, |dz|)`). Range is measured from the nearest applicable occupied source Token volume point/corner. The reachable origin boundary is square in XY and honors elevation. This does **not** change the geometric area occupied by a Sphere or the cells/targets/propagation affected.

The existing per-call option `range.metric: "euclidean"` selects previous straight-line XYZ range behavior. The standalone RangeService methods retain Euclidean defaults for previous callers, accepting optional `metric` arguments. The Chevron path and movement-cost APIs, terrain calculations, Withdraw, D&D5e damage and save handling remain unchanged.

`flags.action-effects-5e.initialCardSections` supports an additional optional **boolean** `flavor` field. The legacy three fields (`targeting`, `saves`, `damageApplication`) continue to be required and retain their behavior. When `flavor: true`, only the rendered native flavor area is hidden for that message; the actual Activity Chat Flavor data, including `[noaa]`, is not modified.

At Midi preItemRoll, Fireball's item-owned setup macro may snapshot the three CAT preferences plus `flavor:true` onto the usage message:

```js
const root = args?.[0]?.options?.message?.data;
if (root) {
  root.flags ??= {};
  root.flags["action-effects-5e"] ??= {};
  const prefs = (workflow?.item ?? item)?.flags?.cat?.config ?? {};
  root.flags["action-effects-5e"].initialCardSections = {
    schema: 1, flavor: true,
    targeting: prefs.suppressChatTargeting === true,
    saves: prefs.suppressChatSaves === true,
    damageApplication: prefs.suppressChatDamageApplication === true
  };
}
```

The full visual Fireball Item DIME remains at `preDamageRollConfig` and Save DIME at `postActiveEffects`. All options default off. No compendium or installed Item is changed by this code-only release.

Test with `npm test`; follow with GM/player Foundry live range placement, elevation, hidden-flavor/AA exclusion, native application controls, target visibility, and chat card reload tests.
