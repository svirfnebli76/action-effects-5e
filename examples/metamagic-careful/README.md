# Careful Spell — Late-phase preview (AE5E 0.4.5.53)

These are **Item-owned CAT Embedded Macros**, not world macros or Midi On-Use macros. The
feature remains **preview-only** until the separately tested late Sorcery Point
transaction can succeed. Previewing a choice does not spend SP, apply B4
protection, change workflow targets, or register the option as a paid selection.

- Existing Metamagic base Item: retain its accepted **Metamagic Broker** CAT
  macro unchanged. Add **Metamagic Late Broker** CAT Called macro with pass
  \`actorAe5eDeclarationBroker\`, priority 50, source
  \`examples/metamagic-careful/late-broker.js\`. Extend the existing base
  declaration by adding:
  \`"lateExecution":{"interface":"cat-embedded","name":"Metamagic Late Broker"}\`.
- Careful Spell Item: set declaration
  \`{"id":"careful-spell","type":"option","cost":1,"selectionCost":1,
  "tooltip":"Choose protected creatures on the initial saving throw.",
  "phases":["saves-ready"],"acquisition":"learned",
  "execution":{"interface":"cat-embedded","name":"Careful Spell"}}\`.
  Add the **Careful Spell** Called CAT macro with pass
  \`actorAe5eDeclarationOption\`, priority 50, source
  \`examples/metamagic-careful/careful-spell.js\`.

The Item can be created directly on Symaali by a one-time console installer.
No compendium writes. If the actor's declaration optionChoices limit is full,
increase the test actor's choice capacity via an approved provider rather than
silently changing official sorcerer limits.

Acceptance: casting Fireball with five targets presents the existing pre-cast
chooser, then the new save-ready Metamagic chooser, then a Careful Spell
creature-selection dialog. Secret-disposition tokens do not appear.
Selected token UUIDs are recorded in the casting snapshot under \`latePreview\`
with status \`unpaid-not-applied\`. No pool changes, save overrides, or
automatic half-damage suppression occur in this preview build.
