# AE5E Independent Results Card Service (schema 1)

This service adds independent results cards alongside the existing Activity Cards, Chat Card Adapter, and contribution API. It does not change the Midi workflow, native usage card, Fireball macros, or any compendium.

## API example (illustrative values, not a real cast)

    const ae5e = game.modules.get("action-effects-5e")?.api;
    await ae5e.chatCards.createResultsCard({
      item: workflow.item,
      workflow,
      header: { title: "Fireball:", subtitle: "Saves / Damage" },
      saves: {
        heading: "DC 15 Dexterity Saving Throw",
        rows: [
          { name: "Leader", image: "icons/svg/mystery-man.svg",
            outcome: "failed", total: 8, dc: 15 },
          { name: "Neutral", image: "icons/svg/mystery-man.svg",
            outcome: "passed", total: 19, dc: 15 }
        ]
      },
      damage: {
        heading: "Damage Results",
        rows: [
          { name: "Leader", amount: 28, type: "Fire" },
          { name: "Neutral", amount: 14, type: "Fire" }
        ]
      }
    });

The caller supplies authoritative, FINAL damage amounts and actual resolved save outcomes; AE5E does not recompute saves, damage, resistance, or successful-save reductions. Outcomes must explicitly be passed or failed. Save totals and DC can be omitted if those details should not be displayed. Sections are independent; at least one nonempty save or damage section is required. The damage heading is centered, with left aligned 12 px target names and right aligned bold 12 px totals such as 14 Fire.

## Style defaults and overrides

    const defaults = ae5e.chatCards.getResultsCardDefaults();
    await ae5e.chatCards.createResultsCard({
      // ...header, saves and/or damage...
      style: {
        title: { size: 18 },
        subtitle: { weight: 700 },
        saveTargetName: { size: 13, weight: 600 },
        damageAmount: { size: 14, weight: 700 },
        iconSize: 56,
        rowGap: 8
      }
    });

Typography fields: title, subtitle, saveHeading, saveTargetName, saveTotal, saveDc, damageHeading, damageTargetName, damageAmount. Each accepts integer size (9 to 32 pixels) and weight (100 to 900, in steps of 100).

Dimensions: iconSize, portraitSize, saveSymbolSize, rowMinHeight, rowPadding, rowGap, sectionSpacing, headerGap, damageRowPadding, damageColumnGap; integer pixel values in validated ranges. Unsupported keys and invalid properties are rejected. Do not pass HTML or CSS strings.

Approved defaults: 48 px icon, 16/700 main title, 16/600 subtitle, 13/700 save heading, 14/600 target name, 12/700 roll, 12/500 DC badge, 24 px portrait, 13/700 Damage Results heading, 12/500 damage name, 12/700 damage total. Save rows use the existing AE5E green #2d5137, red #63353d and #eee foreground. Text outside save rows inherits Foundry theme colors. The compact save symbol is 16 px.

All resolved sizes/weights are captured as validated CSS custom properties on the generated message and persisted in flags.action-effects-5e.resultsCard. Historical cards retain their original resolved style values and text data. Scoped ae5e-results styles do not alter unrelated chat cards.

## Workflow ownership and privacy

The Results Card service produces only a chat message. It does not roll, infer saving throws, apply damage, or deduplicate multiple clients. Call it once from an authoritative automation completion handler after Midi and D&D5e have resolved all results. The existing Fireball Save DIME has not been modified; inspect its real data fields before migrating.

By default this is a public message. Use whisper: [userId] and optionally blind: true for a private card; public blind cards are rejected. Only viewer-safe values should be supplied, because the visible data is also stored in message flags. Do not put secret Midi workflow arrays or raw hidden rolls into a publicly visible results card. Suppressing roll totals is not enough if the outcome is itself confidential. Visibility testing on GM/player clients is required.

## Live acceptance

1. Post a sample card from the API, compare against Cunning Strike Poison and approved Fireball Visual Prototype 03.
2. Check long target names, right-aligned amount, narrow chat sidebar, icon dimensions, green/red row hues.
3. Try per-item size/weight overrides and confirm the existing card is unchanged after new cards are created.
4. Reload the world and pop out chat; verify persistence.
5. Test GM/player, blind/whisper, and hidden saving throw data.
6. Review the existing Fireball Save DIME and migrate only after identifying authoritative finalized damage and saves to avoid double cards.

Unit tests cover defaults, validation, escaping, persistence snapshot, independent sections and whisper/blind visibility. Live Foundry acceptance remains pending.
