# Web (2024) — source Item authoring contract during AE5E infrastructure cleanup

This document describes only the source-Item contract that can be validated while Web's final On Use macro is intentionally shelved. It does **not** define or ship the final Web runtime recipe.

AE5E production runtime contains generic persistent-area infrastructure only. Web-specific rules will be declared by the Item automation after the infrastructure checkpoint is accepted.

## Base spell

Keep the normal 2024 D&D5e Web spell data:

- Identifier: `web`
- Rules: `2024`
- Level: 2
- School: Conjuration
- Casting time: 1 Action
- Range: 60 ft
- Duration: 1 hour
- Components: Verbal, Somatic, Material, Concentration
- Descriptive target/template: 20-foot Cube

The descriptive Item target remains intact. Automation-only Activities override that inherited targeting rather than deleting the spell's descriptive target.

## Activities

### Cast Web

- Type: Utility
- Player-facing casting Activity
- Normal spell-slot consumption for the cast
- `target.override = true`
- `target.prompt = false`
- No directly applied Active Effects

### Web Save

- Type: Save
- Dexterity
- DC: Spellcasting
- `target.override = true`
- `target.prompt = false`
- No damage
- No applied effects
- No additional spell-slot/resource consumption

### Burning Web Damage

- Type: Damage
- Exactly one `2d4` Fire damage part
- `target.override = true`
- `target.prompt = false`
- No save
- No applied effects
- No additional spell-slot/resource consumption

## Escape Web helper

The authoritative Escape Web helper remains an external Item in the hidden administrative compendium. The Web spell itself should not contain a legacy Escape Web Activity.

Expected helper contract:

- Item type: Feature
- Check Activity identifier/name: `escape-web` / Escape Web
- Activation: Action
- Ability: Strength
- Associated skill: Athletics
- No damage/effects
- No effective resource consumption

The final Web Item automation will supply this helper's real compendium UUID.

## Restrained by Web source effect

The Web source Item contains an editable Active Effect template:

- Name: `Restrained by Web`
- Transfer: OFF
- Status: Restrained
- No fixed runtime duration requirement

The final Item recipe will instruct AE5E's generic lifecycle service how and when to clone it. AE5E production runtime does not know the Web effect name.

## Automated Animations ownership

The source Item must contain:

```text
flags.action-effects-5e.animation.automatedAnimations = "suppress"
```

AA suppression remains AE5E async WorkflowStart arbitration.

## Dev-only source Item validation

```js
await game.modules.get("action-effects-5e").api.tests.environment.validateWebItem({
  itemUuid: "PASTE-WEB-ITEM-UUID-HERE",
  escapeTemplateUuid: "PASTE-ESCAPE-WEB-COMPENDIUM-UUID-HERE",
  notify: true
});
```

This validator is development/test tooling only. It performs no runtime Web automation.

## Final macro status

The final Web On Use macro is deliberately deferred until the generic AE5E infrastructure has passed its final live acceptance. Do not restore the retired spell-specific Web runtime API path.
