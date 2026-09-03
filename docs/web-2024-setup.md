# Web (2024) — AE5E v0.4.3.10 setup

This document describes the source-Item authoring contract expected by the Web infrastructure. AE5E supplies infrastructure only; the Web spell and any helper Items are authored manually in Foundry and added to compendiums manually.

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

## Web spell Activities

Create these three Activities on the Web spell.

### Cast Web

- Type: Use / Utility
- This is the only player-facing casting Activity.
- Use the normal spell-slot consumption for the cast.
- Disable the Activity target/template prompt.
- Do not attach Active Effects to this Activity.
- Item DIME passes: **Called before the item is rolled** and **After Active Effects**.
- Both passes use the complete ItemMacro in `docs/item-macros/web-2024-premium.txt`.
- The ItemMacro supplies the authoritative external Escape Web helper UUID to `ae5e.web.commitCast()`.

### Web Save

- Type: Save
- Ability: Dexterity
- DC: Spellcasting
- No damage parts.
- No applied effects.
- No spell-slot/resource consumption.
- Automation-only.
- AE5E invokes it through CAT/Midi when a creature first enters Web on a turn or starts its turn there.

### Burning Web Damage

- Type: Damage
- Exactly one damage part: `2d4` Fire
- No save.
- No applied effects.
- No spell-slot/resource consumption.
- Automation-only.
- AE5E invokes it only for a creature starting its turn in a currently burning 5-foot Web cell.

## Authoritative Escape Web helper Item

Create **Escape Web** manually in the hidden/administrative compendium and pass its compendium UUID from the Web ItemMacro. AE5E does not create or ship this source Item.

Recommended helper configuration:

- Item type: Feature
- Activity: Check
- Activity identifier: `escape-web`
- Activation: Action
- Ability: Strength
- Associated skill: Athletics
- No damage or effects
- No resource consumption
- Custom DC formula may remain blank; the runtime helper reads the originating Web's saved DC.

The helper relationship is Item-specific configuration and therefore lives in the Web ItemMacro, not in AE5E constants and not as hidden authoring metadata on the source Active Effect.

## Active Effect template

Add an editable source Base Active Effect named **Restrained by Web**:

- Transfer: OFF
- Status: Restrained
- No fixed duration
- No Changes entries
- Allow independent copies to coexist
- Do not add AE5E ongoing-action flags to the source template
- Do not apply it directly from Cast Web or Web Save

AE5E clones/stamps the runtime instance with Web provenance, movement restriction, the originating caster's save DC, concentration ownership, and the Item-supplied ongoing-action configuration preserved on the authoritative Web Region.

## Runtime configuration transport

`ae5e.web.commitCast()` accepts an optional `restraintOngoingAction` object. AE5E validates it using the generic ongoing-effect infrastructure and stores it on that Web Region. If a creature fails a Web save later, AE5E copies the configuration onto the runtime `Restrained by Web` effect before the generic ongoing-effect service creates the granted helper Item.

This is the same ownership model used by Grapple: the Item chooses its helper Item; AE5E supplies lifecycle infrastructure. Web simply has an extra persistent Region between the original Item use and the later runtime effect.

For backward compatibility, Web Items authored before v0.4.3.8 can still use source-effect `ongoingAction` metadata or the older source-Activity-derived Escape Web fallback.

## Automated Animations ownership

The source Web Item must contain:

```text
flags.action-effects-5e.animation.automatedAnimations = "suppress"
```

This uses AE5E async WorkflowStart ownership arbitration; do not use the old synchronous AA-disable method.

## Source Item validation

The validator accepts the external helper UUID:

```js
await game.modules.get("action-effects-5e").api.tests.environment.validateWebItem({
  itemUuid: "PASTE-WEB-ITEM-UUID-HERE",
  escapeTemplateUuid: "PASTE-ESCAPE-WEB-COMPENDIUM-UUID-HERE",
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
