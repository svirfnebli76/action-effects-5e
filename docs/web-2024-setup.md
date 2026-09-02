# Web (2024) — AE5E v0.4.3.7 setup

This is the source-Item authoring contract expected by `WebService.validateSourceItem()`.

## Base spell

Create or duplicate the 2024 **Web** spell and keep the normal D&D5e spell data:

- Identifier: `web`
- Rules: `2024`
- Level: 2
- School: Conjuration
- Casting time: 1 Action
- Range: 60 ft
- Duration: 1 hour
- Components: Verbal, Somatic, Material, Concentration
- Target/template description: 20-foot Cube

The Item's descriptive cube is retained for rules/UI data. The **Cast Web** Activity must not prompt for a native D&D5e template because AE5E's functional/Eskie placement owns placement.

## Activities

Create four Activities with these exact names.

### Cast Web

- Type: Utility
- This is the only player-facing casting Activity.
- Use the normal spell-slot consumption for the cast.
- Disable the Activity target/template prompt.
- Do not attach Active Effects to this Activity.
- Midi On Use / ItemMacro passes: **Before Item Roll** and **After Active Effects**.
- Both passes use the complete ItemMacro in `docs/item-macros/web-2024-premium.txt`.

### Web Save

- Type: Save
- Ability: Dexterity
- DC: Spellcasting
- No damage parts.
- No applied effects.
- No spell-slot/resource consumption.
- Do not expose this as the normal casting Activity; AE5E invokes it through CAT/Midi when a creature first enters Web on a turn or starts its turn there.

### Escape Web

- Type: Check
- Activation: Action
- Ability: Strength
- Associated skill: Athletics
- No damage parts.
- No applied effects.
- No spell-slot/resource consumption.
- The source DC may remain spellcasting/default; AE5E stamps the original caster's actual spell save DC onto the temporary runtime Escape Web grant.

### Burning Web Damage

- Type: Damage
- Exactly one damage part: `2d4` Fire
- No save.
- No applied effects.
- No spell-slot/resource consumption.
- AE5E invokes it only for a creature starting its turn in a currently burning 5-foot Web cell.

## Active Effect template

Add an editable source Active Effect named **Restrained by Web**:

- Transfer: OFF
- Status: Restrained
- Leave it as a source template; do not apply it directly from Cast Web or Web Save.

AE5E clones/stamps the runtime instance, adds Web provenance and voluntary-movement restriction metadata, and derives the temporary **Web — Escape** action from the source `Escape Web` Activity.

## Automated Animations ownership

The source Item must contain:

```text
flags.action-effects-5e.animation.automatedAnimations = "suppress"
```

This uses AE5E async WorkflowStart ownership arbitration; do not use the old synchronous AA-disable method.

## Source Item validation

After authoring the Item, copy its UUID and run on the GM client:

```js
await game.modules.get("action-effects-5e").api.tests.environment.validateWebItem({
  itemUuid: "PASTE-WEB-ITEM-UUID-HERE",
  notify: true
});
```

All checks should PASS before gameplay testing.

## Module/live acceptance

Run on AE5E's primary GM client with a Scene active:

```js
await game.modules.get("action-effects-5e").api.tests.environment.runAll({ notify: true });
```

The Web-specific subset is:

```js
await game.modules.get("action-effects-5e").api.tests.environment.runWeb({ notify: true });
```

Manual smoke testing is still required for the Premium Eskie crosshair appearance and for confirming that the Region mask visually refreshes cleanly as 5-foot holes are burned away.
