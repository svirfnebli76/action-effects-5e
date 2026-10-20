# AE5E Chat Card Adapter (v0.4.5.21)

## Independent native-card sections (v0.4.5.32)

The optional `flavor: true` switch visually hides the native `.card-flavor`
block on the opted-in usage message. The underlying Activity flavor content is
unchanged; e.g. Automated Animations still reads `[noaa]` at roll time.
The legacy schema 1 policy with only targeting, saves, and damageApplication
remains valid; flavor defaults to visible when omitted. To re-show flavor on an
existing card, call `chatCards.setSections` with `flavor: false` or omit it.

An Item automation may independently suppress initial-card targeting, save data,
and the manual damage-application tray. This is a per-message presentation
snapshot; it requires no replacement layout and has no AE5E-wide default. The
Item owns its CAT option definitions, defaults and preference reads.

At Midi `preItemRoll`, place the resolved booleans on the **current cast's**
`args[0].options.message.data.flags`:

```js
message.data.flags["action-effects-5e"].initialCardSections = {
  schema: 1,
  targeting: true,
  saves: true,
  damageApplication: true
};
```

Here `true` means suppress that section. Initialize missing parent objects while
preserving other flags. For an existing usage ChatMessage, or as an after-save
fallback, use its actual Workflow or explicit ChatMessage:

```js
await game.modules.get("action-effects-5e").api.chatCards.setSections(workflow, {
  schema: 1, targeting: true, saves: false, damageApplication: true
});
```

Writes require message ownership, serialize with other adapter writes, and skip
identical snapshots. Every option must be a boolean; invalid policies fail open
when rendering and are rejected by the write API. A later explicit all-false
snapshot restores the same DOM nodes and event listeners. Absent flags leave
unrelated cards, existing compact layouts and separate result messages alone.

The renderer places scoped classes on the message-content host on every render,
including reload/popout/player renders. CSS handles controls created later by
native custom elements. Target suppression excludes targeting inside application
trays. Save suppression covers the Midi results block and native save summary;
it does not delete rolls or change challenge visibility. Damage-application
suppression hides its Apply tray but preserves the damage roll, consumption
controls, native data and automatic HP updates. Authors who require manual
application must leave that checkbox unchecked to expose the native tray.

Run `tests/chat-card-sections-browser.html` in a local browser to exercise all
eight combinations with representative native markup. Actual Foundry/Midi
GM/player rendering, automation timing, Apply/undo and popouts still require live
acceptance.

Opt-in presentation infrastructure for Foundry 14 / D&D5e 6.0.6 / Midi-QOL 14.6. Native usage messages, rolls, targeting, effect application and damage application remain authoritative. No Items or compendiums are configured by installing this module. Live GM/player acceptance is required before treating this release as proven in a world.

## Item-owned layouts

Store `flags.action-effects-5e.chatCard` on an Item or Activity. An Activity policy replaces the Item default entirely; an explicitly disabled Activity overrides an enabled Item. A native usage-creation hook snapshots valid presentation onto the ChatMessage. `completeActivity` provides a fallback snapshot for an existing workflow. Subsequent Item edits affect future cards, not existing message snapshots.

```js
{
  schema: 1, enabled: true,
  layout: `<section>
    <div data-ae5e-slot="header" style="--ae5e-icon-size:48px;--ae5e-title-size:16px"></div>
    <div data-ae5e-slot="description"></div>
    <div data-ae5e-slot="use"></div>
    <div data-ae5e-slot="saves"></div>
    <div data-ae5e-slot="outcome"></div>
    <div data-ae5e-slot="modifications"></div>
    <div data-ae5e-slot="controls"></div>
  </section>`,
  saveStyle: "target", hideCompletedControls: true
}
```

Slots are named destinations, not rule execution. Native slots: `header`, `description`, `flavor`, `attack`, `hits`, `saves`, `damage` (main/other/bonus), and `utility`. `controls` moves the system icon rows, recorded targets and effect application controls; native attack/damage/confirmation buttons and damage-application trays retain their native parents. Omitted native slots leave their components in place, rather than discarding rolls or buttons. `header` is required; duplicate, nested and unknown slots are rejected.

The existing Activity completion service supplies `use` and `outcome`; this still requires an explicit `activityCard` policy and completion call after Item automation. A target-style save row retains native portrait, target, result symbol, total node and tooltip; visible DC text is repeated in the row. It never reconstructs information removed by Midi. Summary-only viewers retain the native fallback.

`description` mounts the system's already-enriched description. D&D5e falls back to Item prose when Activity description is empty. Authors should fill the Activity's brief description; the adapter does not invent rules text. On completed compact cards it opens that description. Header defaults are 48px icon and 16px bold title, vertically aligned; the two inline CSS variables change those sizes on the Item.

Manual controls are preserved by default, including while a save reroll is pending. To hide the specified completed-card targeting/effect controls, the layout must opt in and the Item automation must explicitly signal that no manual steps remain:

```js
await game.modules.get("action-effects-5e").api.chatCards.completeActivity(
  workflow, { controlsResolved: true }
);
```

Do not pass that option merely because a save failed. Unresolved saves, unconfirmed failed-save effects, and failed/unknown movement keep the controls even when the caller supplies this signal. Keep presentation errors separate from rule execution. No AE5E-wide setting changes other cards.

## Card contributions

A contribution is Item-supplied content added to an existing card. The receiving spell requires no layout policy. Supply the actual parent spell Workflow or its ChatMessage explicitly; the adapter does not guess parentage from names or recurse through child workflows.

An option Item may store a template at `flags.action-effects-5e.chatCard.contribution.html` (this alone does not enable a layout):

```html
<p><strong>{{name}}</strong> — {{change}}. Cost: {{cost}} Sorcery Points.</p>
```

Then its automation submits confirmed values:

```js
await game.modules.get("action-effects-5e").api.chatCards.upsertContribution(
  spellWorkflow, {
    id: "cast123-distant", source: optionItem,
    slot: "modifications", placement: "after-description",
    data: { name: "Distant Spell", change: "Range increased from 60 ft to 120 ft", cost: 1 }
  }
);
```

An explicit `html` argument can override the source template. Flat string/number/boolean values use `{{name}}` placeholders and are escaped; missing values become empty text. No conditionals, script execution, roll access or feature-name switches exist. IDs must be 1–160 letters, digits, underscores or hyphens and cannot be prototype keys. Include cast, option and attack/roll identity where distinct events need separate entries.

Use the same ID to update a contribution after Seeking/Empowered or a cost correction. Use a different ID for another contribution. To remove one:

```js
await game.modules.get("action-effects-5e").api.chatCards.removeContribution(spellWorkflow, "cast123-distant");
```

The rendered template, source UUID and placement are saved in message flags, surviving reload and source deletion. Writes target only one contribution field and serialize within one client. Caller infrastructure must still choose one authoritative workflow handler across clients and provide actual transaction results. This API does not spend/refund points, commit a cast, reroll dice or infer successful application.

On a custom layout, a matching slot receives the contribution. Otherwise supported native anchors are `after-description` (default), `before-results`, and `after-results`. Missing description/results use the native header/card as fallback. Native cards and custom cards share the same API. Contributions inherit message visibility; blind, invisible and concealed cards retain native rendering. Caller-supplied prose must be appropriate for every viewer of the message: it is not a mechanism for hiding secret raw roll data in flags.

## Authoring boundaries and verification

Allowed HTML: div, section, p, span, strong, b, em, i, small, br, ul, ol, li, h3, h4. Attributes: `class` (ae5e-prefixed only), restricted inline presentation `style`, and layout-only `data-ae5e-slot`. No executable elements, links, images, event handlers, global styles, URLs or arbitrary expressions are accepted. Limited CSS includes typography, spacing, flex alignment, colors, borders and width, plus the icon/title size variables. Validation precedes native DOM changes; invalid input retains native presentation and reports a console warning/error.

Regression tests cover policy precedence, authority, path validation and serialized update recovery. A separate local DOM harness checks native node/listener preservation, masked/hidden/concealed/blind views, pending controls, Item templates, multiple contributions, updates, reload persistence and escaping. The existing Activity formatter remains available when no new layout is configured.

Live acceptance: load the package on every client, then test a native spell contribution on GM and player, a late update and removal, rerender/reload, attack/damage tooltips and Apply/undo. Test completed Trip passed/failed rows, short description, icon/title sizing, multi-target saves, rerolls, summary-only settings and private/blind messages. Any unsupported component remains native. Metamagic casting hooks and payment behavior are separate Stage 0 work, not delivered by this adapter.

## Optional presentation refinements

`chatCard.titlePrefix` is author-owned plain text (up to 160 characters), snapshotted with the layout and displayed above the completed title beside the native icon. The module supplies no feature-specific prefix.

Layout slots can opt into `ae5e-align-left` (description), `ae5e-align-center` (use/outcome), and `ae5e-save-compact` (saves). Compact saves retain the native success/failure icon and roll total, hide the added outcome/Roll words, add an outcome-colored 2px portrait ring and a 6px heading gap. `--ae5e-target-name-size:18px` sets target text size; long names and centered sentences wrap. These are presentation choices only and do not affect automation or message visibility.

Compact save rows vertically center target names. Optional `--ae5e-save-total-size:12px` and `--ae5e-save-dc-size:12px` control the native total and DC badge sizes independently of the name. Both default to 12px and retain native roll tooltips.

## Optional interim save-card suppression (v0.4.5.29)

Set `chatCard.hideUntilComplete: true` on an already configured save Activity to hide its initial usage card while automatic saves process. The creation hook snapshots an `interimStartedAt` timestamp only for save Activities with known automatic Midi save settings. The ChatMessage remains available to Midi; no roll, permission, visibility mode or automation behavior changes. An AE5E `activityCard` completion snapshot reveals the card even if manual resolution remains.

Manual/chat-save settings and usable native attack/damage, consumption or template-placement buttons keep the card visible. Save/check buttons under known automatic settings do not bypass suppression merely because their native button remains enabled. Unknown settings fail open. Midi RollComplete is not a reveal signal: asynchronous author completion macros may still be running. After 8 seconds, a local timer reveals a stalled card; the deadline derives from the saved timestamp and does not restart on rerender or reload. Existing unstamped cards stay visible. Deleted cards cancel the timer. The option defaults off and does not suppress attack/damage or movement Activities. Author completion macros remain required for the finished custom presentation.
