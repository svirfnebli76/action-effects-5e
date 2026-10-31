# Careful Spell — save-ready integration (AE5E 0.4.5.54)

There is one Metamagic Broker.

AE5E invokes the existing base Item's **Metamagic Broker** CAT Called macro at
pre-cast when pre-cast options are relevant, and invokes that same macro again
at \`saves-ready\` only when a learned option declares that phase. There is no
second broker macro and no separate late broker declaration.

The existing Careful Spell compendium Item is authored manually in Foundry.
AE5E does not create or overwrite it.

Careful Spell declaration:

\`\`\`json
{
  "id": "careful-spell",
  "type": "option",
  "cost": 1,
  "selectionCost": 1,
  "tooltip": "Choose creatures to protect from the spell's initial saving throw.",
  "phases": ["saves-ready"],
  "acquisition": "learned",
  "execution": {
    "interface": "cat-embedded",
    "name": "Careful Spell"
  }
}
\`\`\`

Careful Spell CAT:
- Name: \`Careful Spell\`
- Event: \`Called\`
- Pass: \`actorAe5eDeclarationOption\`
- Priority: \`50\`
- Source: \`examples/metamagic-careful/careful-spell.js\`

B5.3 remains preview-only after creature selection. The Item-owned payload is
recorded on the existing casting record under \`latePreview\`. Payment/refund
and B4 protection are connected after this real broker/item path is accepted.
