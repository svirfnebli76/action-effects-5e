Warning: truncated output (original token count: 69595)
Total output lines: 1891

# v0.4.5.61 - D&D5e attack reroll advantage-mode correction

- Corrects generic late d20 rerolls for D&D5e attack Rolls made with advantage or disadvantage. D&D5e stores this state as `advantageMode`, so the replacement is now compared with the other eligible d20 and exactly one result contributes to the recomputed total.
- Preserves the selected original die as inactive rerolled history and the unselected die as discarded or active according to D&D5e's original roll mode.
- Retains Foundry's native modifier reevaluation for rolls that use ordinary keep-high or keep-low modifiers instead of D&D5e's D20Roll mode.
- Adds focused regressions for both disadvantage (`20`, `5`, reroll `5` to `9` => `9 + modifiers`) and advantage. No option-specific rules, Items, macros, artwork, assets, or compendium content are changed.

# v0.4.5.60 - Generic late attack-die rerolls

- Activates Metamagic's generic `attack-resolved` transaction at Midi-QOL's awaited `hitsChecked` boundary, after the original attack roll is visible but before Midi displays the final hit or miss.
- Adds an Item-driven `attackRollMutation` contract for rerolling one selected evaluated d20 result while preserving the original Roll, DiceTerm, result identity, and reroll history.
- Reapplies Foundry's native die modifiers so either d20 may be selected under advantage or disadvantage, commits through `workflow.setAttackRoll()`, and asks Midi to reassess hit targets without repeating reactions or target On Use macros.
- Presents only the fresh replacement through Midi's Dice So Nice bridge, and restores the exact original attack state, hit assessment, and Sorcery Point debit if mutation or presentation fails.
- Deduplicates the gate per attack Roll rather than per casting, allowing an Item-owned option declined on one attack to participate in a later attack while preventing a used option from being selected twice.
- Keeps all eligibility, miss detection, wording, dice previews, selection rules, cost, stacking policy, and option identity in Item declarations and CAT macros. No option-specific rules, Items, macros, artwork, assets, or compendium content are included in AE5E.

# v0.4.5.59 - Generic broker dice previews

- Adds an optional, structured `dicePreview` field to generic broker choices so Item-owned offers can show evaluated die results without injecting raw HTML.
- Validates, normalizes, controller-routes, and safely renders die faces, values, colors, and tooltips using Foundry's built-in d4/d6/d8/d10/d12/d20 silhouettes, with a generic fallback for unusual die sizes.
- Keeps the preview display-only: broker selection, resource projection, confirmation, and option application remain unchanged.
- Preserves Item ownership of preview wording, damage-type colors, and die data; AE5E contains no Empowered Spell rules or option-name branches.
- Adds focused request-validation, socket-transport, safe-rendering, and Metamagic offer-preservation coverage. No Item declarations, embedded CAT macros, artwork, or compendium content are included in AE5E.

# v0.4.5.58 — Post-presentation Metamagic damage gate

- Adds the generic `damage-presented` Metamagic phase for options that must be chosen only after the original evaluated damage dice are visible to the player.
- Keeps `damage-mutable` as the pre-presentation phase for mutations such as damage-type retagging, then uses Midi-QOL's own awaited Dice So Nice presenter before opening a separate post-presentation broker.
- Restricts generic `reroll-dice` mutations to `damage-presented`; confirmed replacement results are presented separately while the already-shown original dice are not animated twice.
- Activates the early presentation gate only when an Item-owned declaration participates in `damage-presented`. Castings without such an option retain Midi's ordinary presentation path.
- Adds focused phase-order, original-presentation, replacement-presentation, idempotency, rollback, and full-suite regression coverage. No option-specific rules, Item declarations, CAT macros, artwork, or compendium content are added to AE5E.

# v0.4.5.57 — Generic selected-die rerolls and declaration-driven Metamagic capacity

- Adds a generic `reroll-dice` damage-roll mutation for Item-owned late Metamagic options. Selected active die results are rerolled individually through Foundry's DiceTerm API while preserving the original Roll, damage profile, unselected dice, and inactive/rerolled result history.
- Recomputes existing damage-roll totals after the selected replacements and commits the same Roll objects through Midi. Invalid or stale selections fail before payment; application failures restore exact result identity, history, totals, and the late Sorcery Point debit.
- Makes every Metamagic capacity check use each option declaration's validated `selectionCost`, allowing a zero-capacity option to accompany one ordinary option while still preventing the same option from being used twice on a casting.
- Charges a multi-option late transaction only for Item-owned selections that actually confirm, rather than options whose follow-up chooser was declined.
- Adds focused mixed-profile, lower-result, rollback, pre-cast/late capacity, and partial-decline regression coverage. No option-specific rules, Item declarations, CAT macros, artwork, or compendium content are changed.

# v0.4.5.51 — Generic casting-local spell component property updates

- Extends Metamagic's existing casting-local Item update contract to support `system.properties` for detached spell copies, without adding Subtle Spell rules or a special execution path.
- Permits only removal of existing Verbal (`vocal`), Somatic (`somatic`), and Material (`material`) property identifiers; other properties and order must be preserved, and unchanged arrays are accepted.
- Validates changes against the actor-owned original, then verifies both source-backed properties and the prepared D&D5e Set before native Sorcery Point consumption. The native derived `mgc` property is accounted for without masking other unexpected properties.
- Preserves all existing spell, Activity, Active Effect, and native consumption behavior; original spell Items, Item declarations, CAT macros, spell descriptions, and compendiums are not changed.
- Adds focused component-property validation and casting lifecycle regression tests. Live Foundry/Midi acceptance is still required.

# v0.4.5.50 — Metamagic committed lifecycle and pre-cast guards

- Adds an optional Item-owned Metamagic guard contract through `guardPhases`; this release deliberately permits only the existing cancel-safe `pre-cast` phase.
- Runs declared guards before the Metamagic broker, casting-local mutation, or native resource consumption. Guard-enabled Items must explicitly allow or deny the cast, while options without guards are never queried.
- Adds a generic, nonblocking `committed` lifecycle notification to selected Metamagic option Items after the casting record has entered its committed state. Notification failures never unwind a native committed cast.
- Provides the generic lifecycle boundaries required for Item-owned same-turn casting restrictions without hardcoding Quickened Spell or any other Metamagic option into AE5E core.
- Adds regression coverage for guard schema validation, pre-broker veto/fail-closed behavior, and exactly-once committed notification. No compendium content, CAT configuration, Item macros, or Metamagic base macro are changed.

# v0.4.5.49 — Casting-local activation post-use preservation

- Preserves a validated casting-local activation change when D&D5e drops only the live `activation.override` metadata after native use while the effective activation value and the Activity's own source still retain the selected override.
- Avoids re-preparing an already-correct detached post-use Activity, which can make it re-inherit the canonical spell activation and incorrectly abort the workflow after native consumption.
- Keeps all pre-consumption integrity checks strict and continues to reject/veto post-use activation state when the live activation, source activation value, or source override intent no longer matches the selected modifier.
- Adds focused positive/negative regression coverage. No Metamagic option names, Quickened-specific rules, compendium content, CAT macros, or Item declarations are added to AE5E core.

# v0.4.5.48 — Metamagic turn casting state

- Adds passive, Metamagic-scoped turn casting observation for actors that own the Metamagic base declaration; individual spells require no AE5E, CAT, CPR, GPS, or SRD-specific tracking configuration.
- Stores only the current relevant combat-turn snapshot at `flags.action-effects-5e.metamagic.turnCasting`, with a latched level-1+ fact and exactly three bounded latest-cast slots: Action, Bonus Action, and Reaction. Stale turns read as empty and the next committed spell replaces the old snapshot.
- Observes the existing post-targeting/committed casting boundary, so pre-cast and cancelled-before-commit attempts do not create state. Midi `automationOnly` Activities and AE5E child workflows are ignored.
- Resolves combat identity from the actual workflow token first, including off-turn Reactions. A known token never falls back to another token of the same linked Actor; ambiguous actor-only multi-combat cases fail open without writing state.
- Exposes read-only `api.metamagic.getTurnCasting`, `inspectTurnCasting`, and `getTurnCastingStatus` access for future Item-owned rules such as Quickened Spell. This release does not enforce Quickened Spell, the 2024 spell-slot-per-turn rule, or any other casting restriction.
- Aligns the exported `MODULE_VERSION` with the manifest/package version and adds bounded-state/multi-combat regression coverage.

# v0.4.5.47 — Argon Target Picker startup compatibility check

- Adds a GM-only startup interoperability check for the active Argon - Combat HUD (CORE) world setting `Target Picker`.
- When Argon's Target Picker is enabled, AE5E explains the duplicate/conflicting targeting risk and asks for explicit permission before changing the setting. AE5E never disables Argon itself and never changes the setting silently.
- Accepting **Disable Target Picker** sets only `enhancedcombathud.rangepicker` to `false` and confirms the change with an AE5E notification; **Cancel** leaves the world unchanged.
- The check is skipped when Argon is inactive, the setting is unavailable or already disabled, or the current user is not a GM. The prompt is session-deduplicated and the setting is rechecked before mutation.
- Preserves Magic Missile, Metamagic/Twinned targeting data, Midi Target Confirmation, compendiums, CAT metadata, macros, and all other Argon settings.

# v0.4.5.46 — Target Confirmation sizing and selection indicator

- Fixes the opted-in Midi Target Confirmation window resetting from the requested 500px to Midi's 300px default during subsequent target-selection renders. The adapter now enforces bounded native ApplicationV2 position width and instance-scoped CSS width on every render; narrower viewports are safely clamped.
- Adds AE5E's existing green Originator selection indicator to customized late Target Confirmation dialogs, suppressing an extra sound, retaining a single lease across rerenders, and reliably releasing it on continue, cancel, X/Escape, failure, or an asynchronously delayed indicator start. Opt out with `indicator: false`.
- Preserves native Midi controls and resource lifecycle, casting-local scaling, per-Item presentation, other AE5E indication leases, compendiums, CAT macros, and existing assets. Includes new lifecycle regression tests. Live Foundry smoke testing remains required.

# v0.4.5.45 — Twinned Targeting presentation and casting-local scaling

- Makes the generic native Midi target confirmation adapter support bounded, Item-supplied banner assets, safe two-part instruction text with controlled semantic highlight colors, and a 500px default width.
- Arranges all three **original native Midi buttons** on one row, left-to-right Clear Targets / Cancel Casting / Continue Casting, preserving their existing callbacks and matched tab order.
- Adds bounded appearance controls for banner corner radius, banner spacing, section spacing and command-line spacing; retains all previous target validation, privacy, range and cancellation behavior.
- Adds an opt-in, single-use, casting-local target-capacity service triggered after native upcast scaling at `dnd5e.preActivityConsumption`; source Items, spell slot levels, Sorcery Points, and native saves are left to D&D5e/Midi/Item rules.
- Adds focused unit tests. Live Foundry acceptance is still required for the combined UI and scaling on Midi 14.6.4.
- No modifications to compendiums, artwork assets, CAT metadata, embedded Item macros, or spell rules.

# v0.4.5.44 — Generic native Target Confirmation Adapter (Phase 3B-04)

- Adds the opt-in, casting-scoped AE5E Target Confirmation Adapter, preserving Midi-QOL 14.6.3's native target list, Roll/Cancel callbacks, consumption and cancellation refunds.
- Reuses Midi's native token artwork, including animated-token thumbnails, with disposition rings (AE5E red/amber/green; GM-only purple for Secret), per-target range status, disabled invalid continuation, dynamic target-count line, and optional Item-owned reminder.
- Adds bounded per-Item overrides for typography, ring/portrait dimensions, window size, colors, row spacing, and button wording; ordinary native Midi dialogs remain unchanged.
- Adds unit tests and public `api.targetConfirmation.arm/cancel/getStatus` interface. Twinned Spell Item rules, upcasting adapter, CAT macros, compendiums and assets remain unchanged.
- Live Foundry acceptance remains required.

# v0.4.5.43 — Broker acceptance statuses and affordability wording

- Adds a third generic broker status type for positive/accepted conditions. Item-supplied `acceptance`/`acceptances` render in a separate green box using AE5E's originator-selection green (`#18cc46`) by default, before orange advisories and red reasons/warnings.
- Extends broker presentation overrides so acceptance boxes support the same validated font, text color, border color, background color and opacity controls as advisory/reason boxes. Existing callers remain unchanged when no acceptance data is supplied.
- Preserves Metamagic Item-owned acceptance text through the casting offer bridge. Item-owned `unaffordableReason` now supplies both the compatibility singular reason and the reasons list, eliminating the redundant generic "Insufficient resource uses." line when custom affordability wording exists.
- Adds regression coverage for acceptance validation/render order/presentation overrides and Metamagic acceptance plus affordability-message transport. No production Item, CAT macro, declaration or compendium data is changed automatically.

# v0.4.5.42 — Broker status semantics and presentation overrides

- Separates advisory and reason/warning status boxes in the generic broker chooser. Advisories use AE5E's responder-selection orange (`#ff9f1c`) by default; reasons and temporary selection-capacity/resource blocks retain the existing red warning treatment. When both are present, the advisory renders first and the warning renders separately.
- Adds optional, validated macro/API typography overrides for every visible broker text surface: window title, prompt, resource summary, option name, option description, option cost, advisory, reason/warning, confirm button, and decline/continue button. AE5E defaults remain unchanged when overrides are omitted.
- Adds optional advisory/reason status-box overrides for text, border and background colors plus independent background/border opacity. Colors are restricted to safe hex values; font sizes, weights and opacity are bounded. Status text remains escaped plain text and arbitrary HTML/emphasis is not introduced.
- Existing broker callers remain compatible. No Metamagic Broker, Distant Spell, CAT configuration, declaration, compendium, or feature-specific rule changes are required.

# v0.4.5.41 — Broker chooser DialogV2 compatibility fix

- Fixes the first Metamagic chooser failing to open with Foundry's "You must define at least one entry in config.buttons" error. The generic broker now configures real Confirm and Continue actions instead of an empty DialogV2 button list and custom HTML buttons.
- Keeps Item-owned button wording, selection/resource limits, explicit Normal Casting, and phase-aware X/Escape outcomes. Confirm stays disabled without a selection, including keyboard/programmatic submission; native submission owns closing the window.
- Uses the label's native checkbox behavior so clicking an option row selects or deselects it once. Keeps the configured action footer visible when a long option list scrolls.
- Adds regression coverage that executes the registered chooser handler and enforces Foundry's non-empty button contract, selection toggling, confirm/decline/dismissal outcomes, and selection-indicator cleanup.
- Requires no CAT macro, Item declaration, or compendium changes.

# v0.4.5.40 — Generic broker chooser and casting-phase infrastructure

- Adds a reusable controller-routed broker chooser with checkbox rows, Item-supplied descriptions/cost labels, advisory and disabled status lines, projected resource balance, declared generic selection capacity, and explicit confirm/decline/abort outcomes.
- Adds reusable casting lifecycle phases for pre-cast, post-targeting, finalized attack outcome, and mutable-damage timing. Consumers register by semantic phase; AE5E contains no Metamagic option catalogue or option-specific rules.
- Adds phase-aware cancellation safety: only cancellation-safe lifecycle points may stop a source workflow. Later phases fail open so closing/declining cannot attempt to unwind an already-progressed cast.
- Extends the existing Metamagic casting bridge so Item-owned option offers can carry advisories/reasons, pre-cast options may declare phases, and the base Item chooser can distinguish normal casting from an explicit abort while remaining backward-compatible with the existing array-return broker.
- Preserves controller routing, GM fallback, selection indicators, stale-selection revalidation, native D&D5e resource consumption/refunds, source-Item immutability, existing compendiums/assets, Sneak Attack/Devious Strikes, and current CAT Item macros.
- This release provides infrastructure only. Distant Spell remains the first planned live acceptance option; CAT Item macro replacements are intentionally separate from this source publication.

# v0.4.5.38 — Item-owned console messages

- Removes the feature-specific console strings added to AE5E in v0.4.5.37.
  The base and Distant Spell CAT macros now own their messages and wording.
- Routes a best-effort consumed lifecycle notification through CAT's existing
  Called dispatcher, with confirmed aggregate/per-option amounts and source
  identity. AE5E does not format usage/payment messages or supply fallback text.
- Keeps optional notifications separate from strict offer/prepare responses.
  Items can ignore the notification; recipient failures cannot undo native
  payment or suppress other recipients. Repeated native confirmations notify
  only once and preserve the original receipt.
- Preserves Item declarations, native range/payment/refund behavior, compendiums,
  assets and Sneak Attack. Install the source update and paste the replacement
  CAT macro bodies into both compendium and actor copies; no declaration edits
  or automatic document migrations are required.

# v0.4.5.37 — Metamagic console notes

- Logs the actor's decision to continue without Metamagic once per casting.
- After native consumption confirmation, logs Metamagic use and each selected
  Item's use and effective Sorcery Point cost, using the requested `[AE5E]`
  format. Selection and cancelled-before-payment casts do not claim a debit.
- Ignores duplicate native consumption notifications, retaining the first receipt
  and printing no duplicate notes. Console failures cannot interrupt a cast.
- Existing Item macros, declarations, compendiums, assets and Sneak Attack remain
  unchanged. Future option Items use the same diagnostics automatically.

# v0.4.5.36 — CAT Item-owned Metamagic and retirement of the preview

- Connects versioned declaration collections to CAT Embedded Item macros using
  CAT's public Called dispatcher in the verified preTargetingV2 window. The base
  Item owns the chooser and Distant Spell's Item owns its rules; no new code
  interpreter or option catalogue is introduced.
- Discovers learned options from owned actor Items automatically, with capacity,
  grant-only access, conditions, full source/record provenance and stale checks.
- Removes the singleton reader, standalone world-Macro launcher, manual learn
  API, built-in chooser and Stage 1 test installer immediately at the user's
  request. Existing documents are not automatically changed or deleted.
- Retains and regression-tests the casting-local parent range bridge, native
  payment/refund ownership and receipts through the new CAT path. Preserves
  Sneak Attack/Devious Strikes, compendiums, assets and compendium-only menus.
- Supplies manual authoring instructions and pasteable base/Distant CAT macros.
  Installed Foundry acceptance remains required before moving to another option.

# v0.4.5.35 — JSON line numbers and reliable declaration selection

- Updates the edited row label in place instead of rebuilding the list when
  the JSON field loses focus. The first mouse click now switches records after
  valid or invalid edits, while preserving each record's draft.
- Adds line numbers to declaration JSON and CAT Configuration JSON, synchronized
  with edits, record selection and vertical scrolling.
- Adds Chromium regressions driven by trusted keyboard/mouse events, including
  saving with invalid JSON in an unselected record. Compendium-only menu scope,
  existing Items, compendiums, assets and casting behavior are unchanged.

# v0.4.5.34 — Compendium-only authoring controls

- Removes the additional world/owned Item-sheet authoring button and its global
  render hooks, following the user's clarified UI scope. Edit Item Options and
  Edit Item Version remain GM-only context actions in approved AE5E compendiums.
- Retains the declaration editor, collection services and explicit authoring
  APIs. Existing compendiums, Items, assets and casting behavior are unchanged.

# v0.4.5.33 — Shared Item declaration infrastructure

- Adds registered family schemas/templates, versioned multi-record Item
  collections, stable source/family/record identities, validation, discovery,
  activation, AC5E eligibility forwarding and grant provenance/ambiguity handling.
- Extends Edit Item Options with CAT Configuration and AE5E Declarations tabs,
  grouped draft records, Add/Duplicate/Remove, validation and Save All Changes.
  GM users can author new world/owned Items from their sheet header.
- Preserves CAT preferences, unrelated/unknown data, legacy singleton declarations,
  existing Sneak Attack/Devious Strikes and the Metamagic source preview. No
  compendiums, assets, test Items or resources are converted or removed.
- This is the infrastructure slice. Installed Foundry editor verification and the
  finished Item-owned Metamagic broker/Distant path remain pending. See
  `docs/item-declaration-infrastructure.md` for source-overlay installation.

# Metamagic Stage 1 — Source preview (16 October 2026)

- Adds versioned Item declarations for main, provider and option roles, learned
  choice reconciliation, equipment grants, combination limits and fixed costs.
- Adds casting-local option execution through Item-referenced Script Macros,
  stable casting/event identity, native consumption targets and result receipts.
- Provides a Distant Spell example, clean test-actor installer, diagnostics,
  cleanup, contracts and GM acceptance instructions. Reuses the existing point
  pool, prompt/indicator and native-card contribution services.
- Repository checks are separate from pending live Foundry acceptance. Player
  authority, continuations and automated Counterspell are not accepted by this
  draft. Manifest/version, existing compendiums and assets remain unchanged.
- Published as a source preview with user authorization. Live Foundry acceptance
  remains pending; this does not certify a completed Metamagic suite.

# v0.4.5.32 — Independent native-card section presentation

- Adds explicit per-message switches for initial targeting, saving-throw data,
  and the manual damage-application tray. Each switch is independent and defaults
  off for unconfigured messages. Item automation supplies resolved CAT values.
- Adds `chatCards.setSections(workflowOrMessage, policy)` for owned-message
  snapshots, with serialized writes and unchanged-policy deduplication.
- Keeps native nodes, rolls, application data and listeners intact. Scoped CSS
  survives rerender/reload and custom-element updates on all clients. Damage
  rolls and consumption remain visible; separate results cards are unaffected.
- No compendium payloads or Item rules changed. Live Foundry GM/player acceptance
  is still required.

# v0.4.5.31 — Repeat-save card outcomes

- Adds Activity-authored saveMode: "repeat", passedResult and failedResult policies. Observes the specific existing over-time effect rather than a new application; successful saves confirm its removal, failed saves confirm its continuation.
- Defers repeat presentation completion without blocking Midi's post-workflow effect cleanup. Observes removal for up to two seconds; unconfirmed/unresolved results preserve controls. Uses the explicit overtime effect UUID when provided, preserving unrelated effects and conditions.
- Deduplicates pending completion calls and drops superseded captures or unavailable messages. Initial saves, movement and the 8-second interim fallback remain unchanged. No compendium payloads or Item rules changed.

# v0.4.5.30 — Keep interim cards hidden through presentation completion

- Stops releasing interim save cards on Midi RollComplete, which can precede asynchronous author completion macros. AE5E presentation completion remains the reveal signal.
- Automatic-save buttons no longer trigger the manual-control fallback merely because their native button remains enabled. Other manual roll, consumption and placement buttons stay accessible; manual/chat-save settings still fail open.
- Reduces the stalled-card fallback from 15 seconds to 8 seconds as requested. Existing authored policies need no reconfiguration. No compendium payloads or Item mechanics changed.

# v0.4.5.29 — Optional interim save card suppression

- Adds author-owned hideUntilComplete for automatic save Activities, snapshotted when creating the usage card. The message remains available to Midi while hidden; an AE5E completion snapshot reveals the formatted card.
- Retains cards for chat/manual saves and usable native roll, consumption or template buttons. Workflow completion without a presentation snapshot releases the card; stalled processing reveals it after 15 seconds. Historical cards remain visible.
- No compendium payloads or Item mechanics changed.

# v0.4.5.28 — Compact save row text alignment

- Vertically centers compact target names and their native name stacks with consistent line height.
- Adds author-owned --ae5e-save-total-size and --ae5e-save-dc-size variables (12px defaults) and tighter DC badge padding to leave more room for names.
- No compendium payloads or Item mechanics changed.

# v0.4.5.27 — Author-selected card presentation

- Supports snapshotted author-owned titlePrefix text and optional layout classes for left/center alignment and compact save rows with outcome-colored portrait rings, smaller names and label-free totals.
- Normalizes native save DC text so labels already containing DC are not prefixed twice. Preserves native roll nodes, masking and completion suppression.
- No compendium payloads or production Items changed automatically.

# v0.4.5.26 — Completed save tray header suppression

- Suppresses the entire rebuilt DCC save-row container on opted-in, confirmed-complete adapted cards, including its shield, collapse control and DC badge.
- Retains the main save heading/result row, pending cards and damage controls. No compendium payloads or Item mechanics changed.

# v0.4.5.25 — Rebuilt completed card controls

- Marks the adapted content host only when opted-in control completion is confirmed. Suppresses targeting and save-summary rows rebuilt outside the controls slot, including DCC pending-save placeholders.
- Keeps pending/unconfirmed cards, native roll rows and damage-application controls available. The scoped rule also covers rows inserted after the adapter hook.
- No compendium payloads or Item mechanics changed. Live compatibility verification remains pending.

# v0.4.5.24 — Completed card control suppression

- Explicitly suppresses the controls slot and redundant native save summaries on completed adapted cards, including custom-element content populated after rendering.
- Uses an adapter-scoped display rule that wins over system/theme row styles. Pending or unconfirmed save/effect controls remain available; native damage application is retained.
- No compendium payloads or Item mechanics changed. Live layout verification remains pending.

# v0.4.5.23 — Native v14 contribution deletion

- Removes chat card contributions with Foundry v14 ForcedDeletion instead of deprecated -=key syntax.
- Adds regression coverage for sibling/layout preservation and repeated removal. No compendium payloads or Item mechanics changed.

# v0.4.5.22 — Chat card reload rendering

- Registers Activity card and Chat Card Adapter hooks during init, before restored chat messages render. Saved contributions and layouts no longer depend on asynchronous ready services finishing before the first render.
- Adds startup regression coverage for a saved contribution rendered before ready. No Item mechanics or compendium payloads changed. Live Foundry reload verification remains pending.

# v0.4.5.21 — Item-owned Chat Card Adapter

- Adds snapshotted Item/Activity HTML layouts with named native-component slots and Activity overrides.
- Adds persistent, independently updatable Item contributions to existing native or custom cards; receiving spells need no configuration.
- Keeps native rolls, listeners, masked results and application mechanics. Provides opt-in completed save rows, 48px icons and 16px bold titles; authors control layout and typography on Items.
- Requires an explicit Item completion signal before hiding completed targeting/effect controls; pending/manual interactions retain native presentation.
- Validates restricted presentation HTML, escapes flat template values and serializes same-client contribution writes. Adds generic regression coverage and authoring documentation.
- Install ZIP excludes the entire packs/ directory. Manifest pack declarations are preserved. No compendium or production Item was changed. Live Foundry acceptance remains pending.

# v0.4.5.20 — Opt-in Activity chat-card infrastructure

- Adds shared completed-Activity card presentation via declarative `flags.action-effects-5e.activityCard` policies and `api.chatCards.completeActivity(workflow)`.
- Captures native save outcomes and source-qualified effect/status observations without applying effects or rolling dice; invalidates old presentation while a save reroll is pending.
- Reuses native Midi save nodes, viewer-masked totals/DCs and tooltips; preserves action/effect controls and falls back to native summaries when Midi rows are unavailable.
- Supports caller-selected movement outcome fields and caller-owned completion text. Feature names, durations, activation timing and opportunity-attack rules remain in item automation/configuration.
- Adds neutral infrastructure regression coverage. No item configuration, migration, or strike macro is installed by the module.
- Complete archive retains existing packs, assets, pack declarations and folders unchanged. Live Foundry acceptance remains pending.

# v0.4.5.19 — Foundry v14 Custom ActiveEffect declarations

- Removes the abandoned AE5E ActiveEffect change-type registration, configuration accessor, registration status, and public AE5E_CHANGE_TYPE / SNEAK_ATTACK_CHANGE_TYPE constants.
- Reads Sneak Attack declarations from system.changes and accepts only exact type: "custom" changes on flags.action-effects-5e.sneakAttack. Diagnostic snapshots record type and phase; no legacy mode reader or fallback remains.
- Audits every production ActiveEffect reader/writer: no CONST.ACTIVE_EFFECT_MODES or numeric change.mode logic exists in this baseline; the OA immunity writer already uses system.changes with type: "override" and phase: "final" and is retained.
- Enforces the declaration-owned max-selections rule at transaction selection, rejecting invalid limits and over-limit selections without mutating the previous selection. No Rogue level or feature-name rules are hardcoded.
- Adds v14 transport, non-Custom/legacy rejection, Cunning Strike Trip/Poison/Withdraw, Improved Cunning Strike max-selections=2, one-option, invalid-limit, and unchanged-state regression coverage.
- Makes the syntax-check utility use fileURLToPath so it can run on Windows as well as Unix; updates the Withdraw live acceptance probe's required version.
- Retains all compendium paths, directory entries, file bytes, pack declarations/folders, and assets exactly as supplied in the authoritative v0.4.5.18 archive. No migration or pack export is performed.

# v0.4.5.18 — D&D5e 6 compendium source-index compatibility

- Fixes the D&D5e 6 / Foundry v14 compendium-index collision that produced `Cannot create property 'rules' on number '1'` during CAT public-pack readiness checks.
- CAT readiness indexing now requests the D&D5e 6 parent field `system.source` and continues reading `entry.system.source.rules`, instead of explicitly requesting the nested `system.source.rules` field that Foundry merges with the system-provided parent index field.
- Updates CAT live/dev acceptance probes to use the D&D5e 6-safe parent-field request and adds regression coverage requiring production readiness indexing to include `system.source` and exclude `system.source.rules`.
- Repairs a pre-existing test-only Class Features LevelDB assertion to follow the pack's `CURRENT` manifest pointer instead of a historical manifest filename; pack bytes are unchanged.
- No Item, compendium, pack, asset, CAT metadata, Sneak Attack declaration, or automation behavior is migrated or changed.

# v0.4.5.17 — Chevron movement instructions and scoped OA protection

- Moves the accepted 20px PIXI movement instruction panel into the Chevron renderer, with a 1.5-grid clearance and positioning opposite the cursor.
- Adds `movement.instructions` (default true for movement-enabled paths) and `movement.opportunityAttackImmunity` (default false). The immunity notice describes the caller's planned protection; placement itself remains read-only.
- Adds reusable `movement.beginOpportunityAttackImmunity()` and `withOpportunityAttackImmunity()` APIs. Transaction-owned effects apply the prepared Gambit OA flag only for the execution window and preserve other immunity contributions on cleanup.
- Registers narrow Active Effect scrolling-label suppression through module-owned libWrapper initialization on every client. Unrelated labels continue normally.
- Gambit's Premades and Terrain Mapper remain optional. Live Gambit v14 engine acceptance remains pending provider availability.
- Includes no compendium data or sources; pack declarations are unchanged.

# v0.4.5.16 — Chevron movement cost

- Opt-in `movement: { enabled: true, action: "walk" }` uses native Token terrain processing and movement cost for path limits and the counter.
- Results retain physical `distance` and add `cost`, `movementDistance`, and `movementAction`; `remaining` uses cost.
- Default Chevron behavior is unchanged. Terrain Mapper is optional.
- Rechecks cost at confirmation and on relevant Region/Actor changes; no calculations on pulse frames or mouse changes within the same snapped square.

## 0.4.5.15 — Chevron Indicator and waypoint placement

- Adds a PIXI-only Chevron Indicator to Action Effects 3D Crosshairs with single-point and waypoint-path placement modes. This selector is not an affected-area geometry primitive.
- Shares the existing PIXI renderer lifecycle and one-active-placement gate with all area crosshairs; adds AbortSignal, source-change, browser-blur, and canvas-teardown cleanup.
- Provides `crosshairs3d.chevron.showPoint()` and `showPath()` convenience calls, low-level `show({ shape: { type: "chevron" } })`, and stored Item/Activity configuration through `showConfigured()`.
- Preserves Ctrl-click waypoint creation, plain-click route confirmation, right-click undo (cancel when empty), and Escape cancellation. Ctrl-wheel elevation respects the suite's reverse-wheel preference.
- Adds snapped path-distance preview and caller-supplied limits; over-limit previews are red and cannot be fixed as waypoints or confirmed. Flat movement uses native equal-cost grid diagonals; vertical travel uses the accepted prototype's equal-cost XYZ policy. Point mode defaults to Euclidean distance from the source center.
- Preserves the 110% inward chevrons, pulse, grey arrowed path, elevation gradient, change-only waypoint markers, and 16px bold labels with a 2px black stroke. Label texture resolution starts at 2 and follows the suite's shared zoom-resolution helper.
- Returns immutable Scene-unit XYZ points plus pixel-center waypoints. Placement neither moves Tokens nor changes user targets. Movement execution, terrain, movement types/consumption, opportunity attacks, and item rules remain caller responsibilities.
- Adds focused point/path, range, measurement-cache, configured-call, session-exclusion, and cleanup regression coverage. Existing area geometry/propagation behavior is unchanged.
- No compendium payload is included in this release. Existing pack declarations and assets are retained unchanged.

## 0.4.5.14 — Generic lowercase AE5E Active Effect change type

- Replaces the Sneak-Attack-specific custom Active Effect change type with the generic lowercase type `action-effects-5e.ae5e`, displayed in the Foundry/DAE editor simply as `AE5E`.
- Fixes DAE v14 authoring compatibility: DAE normalizes change-type IDs to lowercase while rendering changes, so the prior camelCase `action-effects-5e.sneakAttackDeclaration` ID could not remain selected and fell back to `Custom`.
- Keeps `flags.action-effects-5e.sneakAttack` as the authoritative Sneak Attack declaration key; the generic AE5E type is only an authoring/type marker and does not determine which subsystem consumes a declaration.
- Publishes `AE5E_CHANGE_TYPE` through the public constants API and preserves `SNEAK_ATTACK_CHANGE_TYPE` as a compatibility alias to the new generic type.
- Adds regression coverage requiring the registered AE5E type ID to be lowercase and preserving the inert/no-handler contract.
- No compendium content, Item mechanics, Sneak Attack transaction behavior, declaration grammar, CAT ownership rules, or Cunning Strike data are changed in source.

## 0.4.5.13 — Class Features compendium foundation

- Adds a new empty public Item compendium named `Class Features` at `packs/class-features`.
- Adds a `Class Features` child folder under the existing `Action Effects 5E` compendium folder and places the new pack there.
- Adds `action-effects-5e.class-features` to AE5E's explicit CAT public-automation pack allowlist so future class-feature Items in this pack can register through the established CAT metadata pipeline.
- Adds focused regression coverage for the manifest declaration, pack-folder grouping, LevelDB pack presence, and CAT public-pack exposure.
- No Sneak Attack Item or Rogue-specific rules are added in this release; the accepted Sneak Attack infrastructure from v0.4.5.12 is unchanged.

## 0.4.5.12 — Sneak Attack transaction target contract correction

- Corrects the Phase E integration contract so generic Sneak Attack eligibility and child-Activity semantic targeting consume the canonical Phase C transaction field `sneakTargetUuid` directly.
- Retains the earlier `transaction.targetUuid` spelling only as a compatibility fallback for callers that still supply it.
- Adds an integration regression that creates a real Phase C transaction snapshot and feeds it directly into Phase B eligibility and semantic targeting without any synthetic alias.
- No Sneak Attack Item, Rogue feature rules, CAT provider behavior, DAE declaration grammar, parent-damage behavior, compendium content, 3D Crosshairs, Region-local 3D Cell State, packs, or assets are changed.

## 0.4.5.11 — Sneak Attack parent-workflow damage infrastructure

- Adds the generic Phase D Sneak Attack parent-damage bridge without adding Rogue feature rules or a Sneak Attack Item to AE5E. Callers supply the already-final damage formula after transaction choices are resolved.
- Delegates bonus DamageRoll construction, critical-hit conversion, parent damage-type inheritance, and attachment to the existing parent Midi workflow to CAT `workflowUtils.bonusDamage()`, preserving the live-accepted parent-workflow architecture.
- Adds transaction-bound validation requiring a committed transaction and matching parent workflow before injection, plus bounded per-workflow/transaction duplicate protection.
- Exposes `api.sneakAttack.damage.inject(...)`, `injectForTransaction(...)`, status, and diagnostics/statistics for generic Item/broker consumers.
- Extends the CAT spell/workflow adapter with characterized `bonusDamage()` capability detection and forwarding.
- Adds six Phase D regressions covering normal damage, critical delegation, default/explicit damage type behavior, transaction binding, duplicate prevention, CAT failure/retry, and fail-safe invalid requests.
- No Sneak Attack Item, Cunning Strike/Devious Strikes Item, Rogue scaling table, feature-specific rules, compendium content, 3D Crosshairs, Region-local 3D Cell State, or assets are changed.

## 0.4.5.10 — Sneak Attack transaction and combat-turn infrastructure

- Adds the generic Phase C Sneak Attack transaction model with unique transaction IDs, committed sneak-target UUIDs, parent workflow/activity linkage, declaration selections, caller-supplied dice accounting, child-workflow result storage, and diagnostic history.
- Adds current-combat-turn tracking keyed by combat ID, round, turn index, and active combatant identity so own-turn and off-turn Sneak Attack usage windows are independent rather than once-per-round.
- Adds explicit `commitOnOk()` and `decline()` transaction boundaries: OK commits usage immediately for the current Foundry turn, while Do Not Use leaves usage untouched; stale dialogs fail closed if the combat turn changes before commitment.
- Persists only the latest tracked usage receipt on the actor under the module runtime flag; outside combat remains intentionally untracked because Foundry has no authoritative current turn.
- Exposes turn inspection/commit and transaction create/select/record/commit/decline diagnostics through `api.sneakAttack.turns` and `api.sneakAttack.transactions`.
- Adds eight Phase C regressions covering own-turn use, off-turn reactions, same-turn blocking, next-turn availability, round rollover, Do Not Use, OK idempotency, stale-turn protection, target retention, dice accounting, and child-result capture.
- No Sneak Attack Item, Cunning Strike/Devious Strikes Item, Rogue scaling table, feature-specific rules, compendium content, 3D Crosshairs, Region-local 3D Cell State, or assets are changed.

## 0.4.5.9 — AC5E eligibility debug-contract correction

- Corrects the Phase B AC5E adapter so AE5E boolean debug state is not forwarded directly to AC5E `safeEval()`, whose `debug` parameter is mutable metadata.
- Omits `debug` for the normal false/default path, passes an empty metadata object for explicit debug mode, and shallow-copies supplied debug metadata objects.
- Adds a regression reproducing AC5E 14.533.18-style `debug.log` mutation; literal true/false condition evaluation no longer fails before expression evaluation.
- No Sneak Attack rules, child Activity behavior, CAT/DAE infrastructure, 3D Crosshairs, Region-local 3D Cell State, compendium content, or assets are changed.

## 0.4.5.8 — Sneak Attack eligibility and child Activity infrastructure

- Adds the generic Phase B Sneak Attack eligibility layer using AC5E's public `evaluationData()` and `safeEval(..., mode: "condition")` helpers; AE5E does not implement a competing expression engine.
- Adds strict Sneak Attack child Activity resolution by stable Activity identifier with optional Activity-type integrity assertions and fail-safe diagnostics for missing, ambiguous, or mismatched Activities.
- Adds semantic target translation for `sneakTarget`, `self`, `parentTargets`, and `parentHitTargets`, preserving the committed Sneak Attack target independently of current user targeting.
- Reuses the existing authority-safe Activity execution service for child Midi workflows, adds parent/transaction linkage metadata, explicit no-consumption controls, and richer JSON-safe workflow result summaries.
- Adds focused regression coverage for AC5E availability/evaluation, stable Activity resolution, semantic targeting, linkage, resource controls, and child-workflow result capture.
- Publishes the already-authored Web Item to CAT by adding only `flags.cat.automation.source = "action-effects-5e"` and `flags.cat.automation.version = "1.0.0"`; no Web mechanics, Activities, macros, or effects are changed.
- Existing 3D Crosshairs, Region-local 3D Cell State, movement, displacement, relationship, and animation infrastructure are unchanged.

## 0.4.5.7 — Sneak Attack declaration infrastructure

- Adds the generic Phase A Sneak Attack declaration foundation without adding Rogue feature rules to AE5E.
- Registers the single declarative Active Effect transport key `flags.action-effects-5e.sneakAttack` and scans matching changes independently to preserve effect and Item provenance.
- Adds a robust quote/parenthesis/escape-aware declaration parser with numeric/boolean normalization, unknown-field preservation, and fail-safe diagnostics.
- Resolves declaration source Items through DAE, validates current CAT provider ownership read-only, and compiles generic broker/option/rule/option-modifier/transaction-rider declarations with level/order sorting and conflict checks.
- Exposes declaration diagnostics and read-only CAT provider inspection through the public AE5E API.
- Adds focused Phase A regression coverage; existing 3D Crosshairs, Region-local 3D Cell State, compendiums, and assets are unchanged.

## 0.4.5.6

- Removed obsolete spell-specific Web runtime/development remnants and stale public test hooks.
- Retired the redundant Web-era 4×4×4 Region-cell simulation wrapper; existing generic Region-local 3D Cell State foundation/stress coverage remains authoritative.
- Generalized retained ongoing-effect, Activity, environmental, and Region-cell regression fixtures so they no longer encode Web-specific names.
- Removed stale Web RegionBehavior localization and README guidance.
- Compendium Items and Region-local 3D Cell State runtime behavior are unchanged.

## 0.4.5.5 — Source-bound Prism/Cube placement

- Adds reusable source-bound placement for Prism/Cube geometry through `placement: { mode: "source" }`. The source anchor slides continuously around the source Token perimeter and the Prism center remains one half-length outward from that anchor, preserving a full outward-facing box without corner attachment.
- Source-bound Prism is MOVE-only: independent Shift rotation, Ctrl elevation, and Alt resize are disabled. Ordinary freely placed Prism/Cube behavior is unchanged.
- None, Direct, and Spread remain supported. Direct/Spread physical propagation uses the source-edge anchor for this placement mode rather than the Prism center; CAT propagation overrides continue to resolve normally.
- Source-bound Prism presentation omits the remote-placement range boundary and source tracer while retaining the existing Prism rules volume, rasterization, targeting, target-preview scheduling, and final-confirmation authority. Contradictory `remote: true` configuration is rejected.
- Adds four focused source-bound Prism/configuration regressions. The focused Prism tests pass. The full suite contains 489 tests; one unrelated pre-existing Web runtime-boundary failure already present in the authoritative v0.4.5.4-with-compendiums baseline remains unchanged.
- Rebased onto the corrected v0.4.5.4-with-compendiums authority. Compendium packs, assets, Region-cell infrastructure, Web runtime code, and unrelated crosshair geometry remain unchanged.

## 0.4.5.4 — Foundry v14 Spread wall-probe precision correction

- Corrects the generic Spread shared-face movement-Wall probe so each perpendicular collision ray extends at least one canvas pixel to either side of the tested face. Live Foundry v14 diagnostics showed the prior `gridDistance * 1e-4` inset produced a 0.02-pixel total ray on a 100 px / 5 ft grid, below Foundry's reliable movement-collision precision; a 2-pixel total ray was the first consistently detected length.
- Keeps the accepted 10x10 shared-face sampling, largest-contiguous-opening >=10% rule, orthogonal-only traversal, propagation masks, analytic Line SAT support, and Direct/None behavior unchanged.
- The correction applies to the shared Foundry Spread environment used by Lines, Sphere, Prism, and Cylinder; Cone Spread remains explicitly unsupported.
- Adds regressions proving the one-pixel-per-side minimum at normal and lower canvas resolutions. Automated coverage is now 485 tests. Packs/assets remain unchanged.

## 0.4.5.3 — Analytic Line Spread support / Cone Spread retirement

- Replaces sampled hidden traversal support for source-driven and freely placed Lines with exact OBB-vs-grid-cell separating-axis tests. Only strict positive-volume intersections become traversal support; face/edge/point tangency is excluded.
- Keeps the authoritative >=50% affected-cell mask separate from traversal support, so support-only cells still cannot target Tokens or persist as ACTIVE Region cells. Orthogonal-only traversal, the 10% contiguous shared-face opening rule, and Wall/Surface/Level obstruction checks are unchanged.
- Explicitly disallows Cone + Spread instead of silently remapping it. Low-level propagation, raw placement, configured Item/Activity resolution, and CAT overrides all reject the combination before placement. Cone-specific CAT authoring data omits Spread.
- Legacy attached Cone+Spread persistent areas fail closed by deactivating their cell mask on rehydration; once inactive they are not repeatedly rewritten.
- Preserves Cone None/Direct behavior, including the v0.4.5.2 17-slab Direct correctness fix, and leaves Sphere/Prism/Cylinder geometry plus the responsive 24 ms propagation scheduler unchanged.
- Expands automated coverage to 483 tests, including broad analytic-vs-sampled Line matrices, positive-volume tangency rules, Cone rejection boundaries, CAT/configuration behavior, raw placement rejection, and legacy persisted-area cleanup. Packs/assets remain unchanged.

## 0.4.5.2 — Line/Cone physical propagation correction

- Corrects Spread for source-driven Lines, Freely Placed Lines, and pitched Cones without changing their authoritative affected-cell masks. Spread now uses an internal positive-volume traversal mask for those narrow/angled shapes, allowing orthogonal physical flow through cells the continuous shape occupies even when those cells do not meet the normal 50% affected threshold.
- Traversal-only cells can never become returned affected cells, live targets, or persistent Region cells. Spread still advances only through orthogonal shared faces and retains the existing 10% contiguous-opening requirement, so Walls/Surfaces/Levels continue to block physical flow.
- Corrects Direct sampling for Cones by matching the rasterizer's 17-slice Z evidence within the Cone/cell overlap instead of relying on four generic cell mid-slabs. Normally qualifying pitched Cone cells therefore survive clear-space Direct, while the horizontal Cone's intentional 25% apex exception remains subject to Direct's independent 50% rule.
- Adds nine focused regressions for Line yaw/pitch, Free Line yaw, Cone Spread pitch, traversal-only output isolation, wall interruption, no diagonal jumping, pitched Cone Direct, and the horizontal Cone apex exception. Sphere chart/tangency behavior is unchanged.

## 0.4.5.1 — Direct/Spread target-preview notice

- Carries forward the accepted v0.4.4.47 responsiveness architecture unchanged: immediate PIXI presentation, 24 ms rapid-input coalescing, cooperative stale-work cancellation, and exact final-confirmation authority.
- Adds the centered placement notice `Target Preview takes 1-2sec` directly below the existing bottom control hint whenever the resolved propagation mode is `direct` or `spread`. `none` placements do not show the notice.
- Uses the same 16 px instruction size with color `#e0dcdd`. The notice is presentation-only and is available across Prism/Cube, Cylinder, Sphere, Cone, source-driven Line, and Freely Placed Line renderers.
- Adds renderer regressions for all six renderer families under None/Direct/Spread plus a placement-session regression proving the resolved propagation mode reaches PIXI presentation. Propagation, targeting, geometry, persistence, and sampling behavior are unchanged.

## 0.4.4.47 — coalesced Direct/Spread live propagation

- Builds on v0.4.4.46 cooperative sampling. Live Foundry testing showed a major responsiveness improvement, but continuous movement still produced thousands of short-lived stale Direct/Spread calculations, leaving some residual roughness.
- Adds a 24 ms quiet window for rapid mouse/wheel intent before Direct/Spread physical propagation begins. PIXI presentation remains immediate; newer intent replaces the pending physical request without starting collision work. Initial, environment/token refresh, and final-confirm requests remain immediate.
- Keeps cooperative physical sampling as a second safety layer once propagation is actually running. If newer intent arrives during a calculation, the stale run still aborts at its next cooperative boundary.
- Adds `coalescedRequests` and `propagationStarts` diagnostics so live acceptance can distinguish cheap request collapsing from actual physical work. Final confirmation still bypasses the quiet window and waits for the exact final authoritative propagation/target result.
- Adds a rapid-input regression proving repeated Direct pointer movement starts no obsolete physical calculations and resolves only the newest stable presentation. All propagation geometry, sampling density, targeting, persistence, and cleanup rules remain unchanged.

## 0.4.4.46 — cooperative Direct/Spread physical sampling

- Supersedes the incomplete v0.4.4.45 responsiveness correction. v0.4.4.45 separated PIXI presentation from authoritative propagation, but live Foundry testing showed Direct/Spread physical collision sampling still monopolized the main JavaScript task, preventing pointer events and rendering from advancing during the 70–120 ms resolver window.
- Adds cooperative main-thread yields inside bounded batches of Foundry physical collision samples. Sampling density and every accepted Direct/Spread threshold remain unchanged.
- Treats an in-flight physical calculation as stale as soon as a newer placement serial is presented. At the next cooperative boundary stale work terminates instead of finishing an obsolete full propagation pass.
- Keeps the v0.4.4.45 two-state authority model and final-confirmation barrier: PIXI may lead propagation, but targets, returned revisions, and persistent Regions still use only the newest fully resolved propagation result.
- Adds regressions proving the Foundry physical adapter yields without changing evidence, stale sampling aborts at a cooperative boundary, and pointer input can advance while a physical propagation run is in flight. Packs and assets remain unchanged.

## 0.4.4.45 — 3D Crosshairs presentation/propagation decoupling

- Separates immediate PIXI presentation from asynchronous Direct/Spread propagation and target collection. Accepted mouse/wheel intent now updates the visible 3D guide before physical obstruction sampling completes.
- Keeps `session.current` authoritative: only the newest completed propagation/target result can replace it or publish targets. Stale calculations are discarded and never redraw the guide or overwrite newer targets.
- Adds a final confirmation barrier that freezes input, waits for propagation of the exact final presented state, and gives persistent Region creation that exact authoritative cell set. Cancellation still invalidates pending work and restores prior targets.
- Adds presentation/resolution statistics for live diagnosis plus deterministic delayed-propagation regressions covering immediate rendering, stale rejection, final confirmation, persistence, cancellation, and error cleanup.
- Adds a self-cleaning Foundry responsiveness acceptance macro comparing the same 20-foot Sphere under None, Direct, and Spread. Packs and assets remain unchanged.

## 0.4.4.44 — CAT configuration utility path correction

- Uses CAT's live `cat.utils.automationUtils.getConfigValue()` boundary for per-Item 3D propagation choices, preserving the utility receiver when invoked.
- Retains the early direct `cat.automationUtils` lookup only as a compatibility fallback.
- Adds regressions for CAT's real global-object structure, receiver binding, direct-path fallback, explicit override bypass, and CAT-read failure behavior.
- Removes the obsolete root-level `UPDATE-v0.4.4.33.md` and `UPDATE-v0.4.4.34.md` stragglers. Packs and assets remain unchanged.

## 0.4.4.43 — Foundry Document isolation correction

- Corrects the v0.4.4.42 live acceptance failure where configuration inspection recursively froze the resolved result while it still contained a live Foundry Item document, whose circular folder/collection graph overflowed the call stack.
- Makes inspection output document-free and publishes only Item/Activity UUIDs, cloned configuration data, and source labels. Internal resolution retains document references only long enough to read flags and CAT preferences.
- Shallow-freezes configured placement result wrappers so their live Token references are neither recursively traversed nor frozen.
- Adds circular Foundry Item, folder, parent collection, Token, and TokenDocument regressions while retaining all Checkpoint 4 behavior.

## 0.4.4.42 — Action Effects 3D Crosshairs, Checkpoint 4 production integration

- Adds the production Item/Activity configuration boundary at `flags.action-effects-5e.crosshairs3d`, with deterministic Item → Activity → explicit → runtime override precedence, schema validation, immutable resolved options, and sanitized provenance.
- Adds the high-level `crosshairs3d.showConfigured()` / `crosshairs3d.configured.show()` API while retaining the accepted low-level placement and geometry APIs for diagnostics and bespoke automation.
- Finishes CAT's per-Item propagation override boundary. Item-authored defaults remain `none`, `direct`, or `spread`; CAT may select `default`, `none`, `direct`, or `spread` through its standard configuration-value API.
- Rehydrates attached Direct/Spread areas when the module initializes and whenever a Scene becomes canvas-ready, preventing persisted masks from remaining stale after a client reload. None areas remain unaffected.
- Adds bounded production diagnostics, explicit validation failures, CAT-read failure fallback, cancellation/error accounting, and D&D5e-version isolation through flags rather than system-internal paths.
- Adds consolidated automated coverage and a self-cleaning Foundry acceptance macro. Packs and assets remain byte-for-byte unchanged; existing Item migrations remain deferred.

## 0.4.4.41 — Exact Region cell-mask replacement

- Corrects the live Foundry v14 flag-write behavior exposed by v0.4.4.40 acceptance: object-valued flags merge recursively, so a new 14-cell mask written over a prior 28-cell mask retained all 28 keys.
- Makes every complete Region cell configuration a true replacement by removing the previous flag before publishing the normalized snapshot. Per-Region write queues preserve ordering, and a failed second write remains safely unconfigured rather than retaining stale affected cells.
- Applies the same replacement path to sparse cell-state mutations so restoring a cell to the default state actually removes its persisted override.
- Adds a Foundry-merge regression for the exact 28 → 14 case and retains the focused live clear → blocked → restored acceptance.

## 0.4.4.40 — Attached cell-mask publication correction

- Routes attached Direct/Spread mask replacement through the dedicated GM-authoritative Region Cell State service. Live diagnostics proved propagation correctly changed 28 cells to 14 behind a Wall while the previous combined geometry/metadata update left the stored mask at 28.
- Restricts the crosshair Region geometry/metadata writer from accepting `regionCells`; exact cell data now has one canonical mutation path.
- Removes the v0.4.4.39 frame-settlement delay after live evidence proved Foundry's raw movement collision already included the new Wall immediately.
- Adds read/write separation regressions, fail-closed coverage, and a focused live clear → blocked → restored stored-mask acceptance.

## 0.4.4.39 — Attached obstruction timing correction

- Defers Wall, Scene Level, and movement-Surface attached-area re-propagation until Foundry has applied the corresponding collision-geometry update. This prevents an attached Direct/Spread Region from rewriting its prior mask when a physical obstruction is created or changed.
- Keeps source-Token transform re-propagation immediate; only environment-document hooks use the settlement barrier.
- Adds a deterministic regression proving that a Wall hook cannot resolve on the hook turn or first animation frame and resolves after the second frame, plus a focused live macro that verifies clear → blocked → restored cell counts with automatic cleanup.

## 0.4.4.38 — Checkpoint 3 persistence and live-acceptance hardening

- Attached Direct and Spread persistent areas now re-resolve on source-token transforms and on movement Wall, Scene Level, or movement Surface changes. Only the primary GM writes the replacement mask; failed or empty resolution deactivates the mask instead of retaining stale affected cells.
- Added a restricted, idempotent GM-authority update route for AE5E-owned crosshair Region geometry and metadata. It cannot edit arbitrary Region fields or non-AE5E Regions.
- Exact unobstructed prisms and cylinders now persist as a single native Foundry rectangle/circle with exact elevation. Spheres, Direct/Spread results, pitched/irregular shapes, and areas requiring cell behavior remain cell-backed.
- Expanded automated coverage for attachment re-resolution, fail-closed behavior, authority and backend selection. Added extended GM and player live-acceptance macros for real Levels, Surfaces, cancellation, native persistence, attached re-resolution, and player-to-GM Region authority.

## 0.4.4.37 — Action Effects 3D Crosshairs, Checkpoint 3

- Added `none`, `direct`, and `spread` propagation over the authoritative 3D affected-cell mask. Sphere propagation preserves every chart-derived cell rather than intersecting the mask with a continuous sphere again.
- Direct propagation requires at least 50% clear XY coverage through positive Z thickness and does not route around obstructions. Spread uses six-face traversal and requires a largest contiguous shared-face opening of at least 10%; disconnected holes and diagonal contact do not combine.
- Added Foundry v14 physical obstruction integration. Movement-blocking Walls use the bottom/top elevation span of each assigned Scene Level, unbounded default Levels remain unbounded, horizontal movement-blocking Surfaces use their exact elevation, and the viewed Level never selects propagation geometry.
- Placement revisions now publish resolved propagation cells and targets together. Final confirmation waits for the newest revision; cancellation and stale async work cannot create a Region.
- Added persistent-area creation as one GM-authoritative Region document operation. The native Region is a broad XY shell and its AE5E Region-cell flag contains the exact 3D active cells from birth. Player-routed retries use an idempotent request ID.
- Added static and Token-attached persistent frames, exact propagated-cell target collection, bounded approved Spread connectors, environment-change recalculation, and public diagnostic APIs.
- Added automated regression coverage for supplied Sphere radii, the complete 20-foot chart, rounded chart corners, Direct thresholds, wall shadows, positive thickness, Spread connectivity, Foundry Wall/Surface query policy, persistence, attachment transforms, idempotency, final revision publication, and cancellation.
- Added the GM live acceptance macro `docs/acceptance-crosshairs3d-v0.4.4.37.txt`; it restores all named Token positions and targets and removes its temporary Wall and Region.

## 0.4.4.36 — Chart-authoritative 3D Sphere targeting

- Replaces the maximum-horizontal-slice Sphere rasterizer with the approved square-center chart calculation. Each XY square receives a vertical half-height from the sphere equation, rounded to the nearest Scene grid unit with half-grid ties rounded upward.
- Makes the resulting chart-derived 3D cells authoritative for Sphere targeting. The v0.4.4.35 continuous-sphere post-filter is removed so it cannot reject cells intentionally included by grid rounding.
- Snaps remote Sphere centers to a full XY grid-cell center and complete Z grid increments, and requires Sphere radii to be positive whole Scene grid units.
- Measures Sphere range from the nearest caster-volume corner. The grey tracer and current range guide use the same deterministic corner and terminate at the Sphere center.
- Adds exact chart regressions for 10, 15, 20, 25, 30, 40, 50 and 60-foot radii, plus full 20-foot matrix, symmetry, translation, elevation, rounding authority, tangency, range, snapping and validation coverage.

## 0.4.4.35 — Sphere targeting and placement presentation corrections

- Requires sphere targets to overlap both an accepted affected grid cell and the true continuous 3D sphere, eliminating XYZ corner-cell leakage while preserving the established 50% cell policy and exact-tangency exclusion.
- Removes the dark source tracer from the Cone guide.
- Removes Rotate mode and its Shift control hint from source-driven Line placement; mouse aiming remains continuous and elevation remains available.
- Adds regressions for the live diagnostic corner positions, sphere tangency/interior controls, Cone presentation, and source-driven Line capabilities.

## 0.4.4.34 — Dialog blur lifecycle correction

- Prevents the shape-selection dialog's focused button from cancelling a newly started placement as the dialog closes.
- Retains cancellation when the browser window itself loses focus.
- Adds a regression that distinguishes descendant focus blur from true window blur and verifies cleanup.

## 0.4.4.33 — PIXI crosshair integration, Checkpoint 2

- Integrates all six approved procedural renderers and source-line traveling edge illumination.
- Replaces the hidden placement carrier with session-scoped pointer, modifier, confirmation, cancellation and ticker handling. No placement media assets or Measured Templates are created.
- Preserves exact approved palettes/layouts, cone text transition, direct-Z remote placement, continuous source anchoring and shape-specific controls.
- Removes the legacy crosshair API/catalog/services and old media/overlay/guide tests; introduces integrated renderer/input coverage and a live acceptance launcher.
- Moves Sequencer from recommended to required in the manifest and dependency validator. Ordinary animation workflows remain unchanged.
- Keeps packs/assets untouched. Existing legacy Item migrations remain deferred until after Checkpoint 4. Live Foundry acceptance of this integration is pending.
- Exact DELETE/ADD/MODIFY lists and Git deletion scripts accompany this release.

## 0.4.4.32 — Free Line zoom, Alt length and local labels

- Plain wheel is no longer intercepted for free Lines, allowing native Foundry canvas zoom. Shift+wheel rotates, Ctrl+wheel elevates, Alt+wheel resizes. Multiple manipulation modifiers perform no combined change.
- Length mode uses physical wheel flags for actual changes; its UI state recovers on Alt release, trusted pointer input and window blur. Synthetic pointer events cannot overwrite modifier state.
- Removes free Line fixed mode/control badges. Plain Move/Rotate/Elevate/Length text sits above the footprint; one conditional instruction sentence sits below. Both rotate with the geometry and stay upright. Dimension and elevation readouts remain.
- Source-bound Line UI is unchanged. All 370 automated tests pass; native Foundry zoom, Alt handling and visual layout require live acceptance.

## 0.4.4.31 — Free Line elevation steps and rotating labels

- Free Line elevation now accepts a whole configured step or stays at the last valid elevation. Range limits no longer introduce a fractional height that shifts all subsequent wheel increments.
- Free Line dimension and elevation labels rotate with the line. Their offsets rotate together and text flips by 180 degrees when needed to remain upright. Fixed HUD controls stay horizontal.
- Thickness remains configurable per spell/item; the 5-ft test value is not a universal rule.
- Tests cover upper/lower limits under all three range policies, reversing direction after blocked ticks, and label rotation/offset/reset. Source-bound geometry, packs and assets unchanged.

## 0.4.4.30 — Freely placed Line test build

- Adds midpoint-based free Line placement. Plain wheel rotates, Shift+wheel resizes symmetrically up to the initial length, Ctrl+wheel translates elevation, and Ctrl+Shift+wheel does nothing.
- Requires an explicit center, designated origin, or endpoint range policy; validates XYZ distance against the source occupied volume. Shows a faint horizontal range boundary at the current base elevation.
- Keeps the authoritative geometry start-based with separate height and thickness. Preview shows footprint, center, endpoints, dimensions, and elevation; origin policy highlights its designated endpoint.
- Adds control-burst, range-policy, elevation, resize-limit, rotation-boundary, and cleanup tests. Includes a standalone free Line test macro.
- Source-bound Line behavior, compendium content, and assets are unchanged. Live Foundry acceptance remains required. This adds placement infrastructure, not automatic conversion of spell activities or persistent walls/Regions.

## 0.4.4.29 — Line anchor, filleted presentation, Alt recovery

- Source-bound Line near-face center slides continuously along the source perimeter instead of inheriting Cone grid-corner snapping. Cone apex selection remains unchanged. This removes the cardinal-heading anchor jump without changing the 50% cell-coverage rule.
- Implements the approved rounded longitudinal edges and flat end planes: visual width is 70% of rules width (3.5 ft for a 5-ft Line), fillet radius is 0.17 Scene grid-distance units (0.85 ft on a 5-ft grid), capped for narrow Lines. Retained shaded teal/red surfaces, always-white endpoint label, no Eskie artwork. Targeting keeps the full unfilleted W×W volume.
- Retains Alt capture suppression and adds session-scoped, Alt-armed trusted pointer recovery for swallowed Ctrl/Shift releases. No persistent Alt-down latch; pre-Ctrl pointer motion does not disarm recovery. Synthetic events and ordinary pointer activity outside recovery cannot change modes. Native browser/Electron behavior still requires live acceptance.
- Fixes initial Line HUD creation to use the fixed viewport position immediately.
- Adds cardinal continuity, west-target angular coverage, Alt recovery across four shapes, fillet dimensions, and unchanged targeting-volume regressions.
- Retest: west-heading rotation/targeting, Alt before and during ELEVATE/ROTATE, gauge stability, tube graphics at horizontal/pitched/vertical orientations, confirm/cancel cleanup. No compendium, Item, propagation, or freely placed Line changes.

## 0.4.4.28 — Source-bound Line

- Replaces the experimental 3D `ray` shape and `rayBasis` API with `line` and `lineBasis`; no deprecated alias. Existing 2D crosshairs are unchanged.
- Source-bound Line uses a fixed-length, zero-roll W×W rectangular tube, with source Z fixed to Token elevation and endpoint elevation controlled by pitch.
- AE5E retained guide replaces Eskie Line artwork and tracer: projected eight-vertex silhouette, section contours, terminal dot, white elevation label, and downward red styling.
- Line uses the fixed viewport control HUD. Per-placement rotation/elevation steps, cyclic pitch, accepted-state targeting, and cleanup remain supported.
- Freely placed live Line is explicitly deferred. Its pre-existing geometry foundation is retained as `free-line` but not exposed through live placement.
- See `docs/source-bound-line-v0.4.4.28.md` for breaking API migration and live acceptance checks.

## 0.4.4.18 — Action Effects 3D Crosshairs — retained Prism artwork rotation

- Fixes retained Sequencer placement artwork so accepted yaw changes rotate the existing live `spriteContainer` in place instead of only updating `data.angle`.
- Preserves the no-flicker retained CanvasEffect path: no `EffectManager.updateEffects()` or effect recreation during interactive rotation.
- Geometry, targeting, 5-degree yaw accounting, elevation, gauge, overlay UX, and Alt suppression are unchanged from v0.4.4.17.
- Adds a regression that models Sequencer 4.2.3's split between creation-time `.rotate()` handling and `_transformSprite()` updates.

## 0.4.4.17 — Action Effects 3D Crosshairs — crosshair-local control instructions

- Removed the AE5E-owned `Action Effects 3D Crosshairs — click to confirm` label from the center of the placement visual. Confirmation remains the normal left-click interaction; the redundant center text is no longer created.
- Replaced the bottom-screen control HUD with retained PIXI control badges attached directly below the authoritative crosshair footprint. The instruction stack follows accepted placement instead of covering Foundry's hotbar.
- Control instructions are capability-conditional and use the locked order and wording: rotation first (`Hold Shift+Mousewheel to change Rotation`) when enabled, elevation second (`Hold Ctrl+Mousewheel to change Elevation`) when enabled, and `Right Click to Cancel` last. Each instruction occupies its own line/badge.
- Instruction text uses the same 16 px size, bold white treatment, and dark rounded presentation as the MOVE / ROTATE / ELEVATE mode badge. The accepted elevation readout and mode badge positions remain unchanged.
- Preserved v0.4.4.16 Alt capture suppression, Crosshair Elevation Gauge behavior, exact grid-Z stepping, cyclic elevation travel, targeting/range behavior, and cleanup.
- Added deterministic regressions for removal of the center confirmation label, crosshair-local hint placement, per-line badge presentation, font-size parity with the mode badge, and capability-conditional rotation/elevation/cancel ordering.

## 0.4.4.16 — Action Effects 3D Crosshairs — Alt capture suppression experiment

- Removed the v0.4.4.14–0.4.4.15 Alt modifier-recovery state and all placement-session pointer recovery listeners. Those recovery paths could not reliably overcome Chromium/Electron Alt focus behavior without risking the already-fixed Crosshair Elevation Gauge flicker.
- Alt has no Action Effects 3D Crosshairs control function, so an active 3D placement session now intercepts both Alt keydown and Alt keyup at the capture stage with `preventDefault()`, `stopPropagation()`, and `stopImmediatePropagation()`. The intent is to prevent Alt from entering Chromium/Electron menu/focus handling before it can disturb later Ctrl/Shift keyup delivery.
- Ctrl/Shift keyboard events and wheel events remain the only authoritative modifier-state sources. Ordinary pointermove/pointerdown input cannot alter MOVE / ROTATE / ELEVATE and no modifier-recovery pointer listeners are installed.
- Preserved the accepted v0.4.4.15 Crosshair Elevation Gauge presentation, exact grid-Z stepping, 360-degree construction-plane travel, red-below-origin readouts, targeting/range behavior, wheel-direction preference, and cleanup.
- Added deterministic regressions proving Alt is fully capture-suppressed during placement, a brief Alt press before ELEVATE does not alter the later normal Ctrl-release path, and pointer activity remains unable to flicker a Ctrl-held gauge.

## 0.4.4.15 — Action Effects 3D Crosshairs — Alt recovery without persistent Alt state

- Removed the persistent `altActive` placement-session latch introduced in v0.4.4.14. Chromium/Electron can omit Alt keyup entirely after menu/focus handling, so AE5E no longer requires that event to prove Alt was released.
- Alt now only **arms** modifier recovery. Recovery checks the live `event.altKey` value on each trusted physical pointer event instead of remembering an Alt-down boolean that can become stale.
- Added a tracked-modifier phase to the recovery window. A brief Alt press before ELEVATE keeps recovery armed until a later Ctrl/Shift cycle has actually been observed, preventing ordinary pointer movement between Alt and Ctrl from prematurely disarming recovery.
- If the subsequent Ctrl/Shift keyup is swallowed, the next trusted pointer event with `altKey=false` can resynchronize the physical modifier state and return to MOVE. Synthetic/programmatic pointer events remain ignored, preserving the accepted no-flicker behavior.
- Wheel input remains authoritative, so an ordinary unmodified wheel still immediately clears stale Ctrl/Shift state and passes through to Foundry canvas zoom. Blur still clears all placement modifier/recovery state.
- Preserved the accepted v0.4.4.14 Crosshair Elevation Gauge rendering, geometry, mode visibility, 5-degree ticks, 50% `#484848` background, immediate initial reading, exact grid-Z stepping, red-below-origin readouts, targeting/range behavior, and cleanup.
- Added a deterministic regression for the exact live sequence: Alt keydown with **no Alt keyup delivered**, trusted pointer activity before ELEVATE, later Ctrl/ELEVATE with swallowed Ctrl keyup, then trusted pointer recovery to MOVE.

## 0.4.4.14 — Action Effects 3D Crosshairs — targeted Alt modifier recovery

- Corrected the remaining Foundry/Electron Alt edge case without restoring the v0.4.4.12 Crosshair Elevation Gauge flicker. Pressing Alt now arms a short-lived modifier-recovery state instead of making ordinary pointer movement authoritative for the whole placement session.
- During normal placement, pointer movement still cannot change MOVE / ROTATE / ELEVATE. After Alt has been observed, only a **trusted physical** `pointermove` or `pointerdown` event may resynchronize Ctrl/Shift; synthetic/programmatic Foundry or Sequencer pointer events are ignored.
- Recovery remains armed while Ctrl or Shift is physically held, so a real pointer event that still reports Ctrl does not prematurely end recovery. If the later modifier keyup is swallowed, the next trusted pointer event that reports the modifier released restores MOVE and hides the Crosshair Elevation Gauge.
- Keyboard and wheel events remain authoritative, blur still clears modifier state, Ctrl+Shift remains intentionally non-operative/MOVE, and Alt itself still has no AE5E placement action.
- Preserved the accepted v0.4.4.13 gauge appearance, ELEVATE-only visibility, immediate initial reading, exact grid-Z stepping, 360-degree construction-plane travel, red-below-origin readouts, targeting/range behavior, and cleanup.
- Added deterministic regressions for stale Alt/Ctrl recovery through trusted pointer input, rejection of synthetic pointer recovery, continued recovery while Ctrl remains held, and no-flicker pointer behavior when Alt recovery is not active.

## 0.4.4.13 — Action Effects 3D Crosshairs — Elevation Gauge mode-stability fix

- Corrected a live Checkpoint 2 regression introduced by v0.4.4.12 where Foundry/Sequencer pointer activity could repeatedly resynchronize Ctrl/Shift from unreliable `pointermove` modifier flags, briefly forcing ELEVATE back to MOVE and making the Crosshair Elevation Gauge flicker on first appearance.
- Removed `pointermove` as an authoritative modifier-state source. Keyboard keydown/keyup, wheel events, and window blur remain responsible for modifier synchronization; the accepted Alt recovery from v0.4.4.12 is preserved.
- Preserved the accepted Crosshair Elevation Gauge appearance and geometry, ELEVATE-only visibility, immediate initial reading, exact grid-Z stepping, 360-degree construction-plane travel, red-below-origin readouts, targeting/range behavior, and cleanup.
- Replaced the pointer self-heal regression with a deterministic no-flicker regression proving pointer movement cannot knock a Ctrl-held session out of ELEVATE or hide the gauge, while Ctrl keyup still returns cleanly to MOVE.

## 0.4.4.12 — Action Effects 3D Crosshairs — modifier-state hardening

- Corrected a live Foundry/Electron input edge case where pressing **Alt** could cause a missed Ctrl/Shift keyup to leave Action Effects 3D Crosshairs latched in ELEVATE or ROTATE. AE5E no longer allows its cached modifier booleans to overrule fresh browser input state.
- Keyboard events now resynchronize Ctrl/Shift from each event's physical modifier flags while still handling the modifier key currently going down/up explicitly. Alt is not assigned any Action Effects 3D Crosshairs behavior; it merely provides another fresh event that can repair stale modifier state.
- Added lightweight `pointermove` resynchronization so the next ordinary mouse movement self-heals a swallowed modifier keyup and restores MOVE without requiring another wheel notch or key press. Blur continues to clear all session modifier state.
- Wheel interception now trusts the wheel event's current Ctrl/Shift state. An ordinary unmodified wheel can no longer be captured because a previous Ctrl/Shift value remained cached. Ctrl+Shift remains intentionally non-operative/MOVE.
- Preserved all accepted v0.4.4.11 Crosshair Elevation Gauge presentation, exact grid-Z stepping, 360-degree construction-plane travel, targeting/range behavior, wheel-direction preference, and cleanup.
- Added deterministic regressions for Alt-associated swallowed Ctrl keyup recovery, pointer-move self-healing, and rejecting unmodified wheel input when cached Ctrl had become stale.

## 0.4.4.11 — Action Effects 3D Crosshairs — Elevation Gauge live UX refinement

- Refined the Checkpoint 2 **Crosshair Elevation Gauge** after the first live Foundry acceptance pass. Circumference graduations now occur every **5 degrees**, with longer 10-degree, 45-degree, and cardinal orientation marks retained for readability.
- Added a solid `#484848` gauge-circle background at **50% opacity** so the side-view instrument remains legible over bright or visually busy Scenes while still allowing the map to show through.
- The Crosshair Elevation Gauge is now visible **only while ELEVATE mode is active**. MOVE, ROTATE, Ctrl release, Ctrl+Shift ambiguity, and other non-ELEVATE states hide it immediately without destroying the retained gauge object.
- Entering ELEVATE now initializes the retained remote construction plane immediately and publishes the current A→B distance, side-view phase, and elevation before the first Ctrl-wheel notch. The initial gauge therefore reflects the authoritative crosshair position as soon as Ctrl is held instead of waiting for a Z change.
- Preserved v0.4.4.10 gauge size/location, 10% range headroom, radial A→B presentation, below-origin red elevation behavior, screen-space pan/zoom compensation, exact grid-Z stepping, targeting/range behavior, and cleanup.
- Added deterministic regressions for the 5-degree tick interval, `#484848`/50% background, ELEVATE-only visibility, immediate pre-wheel gauge publication, and nonzero initial side-view phase.

## 0.4.4.10 — Action Effects 3D Crosshairs — Crosshair Elevation Gauge

- Added the Checkpoint 2 **Crosshair Elevation Gauge**, a temporary retained PIXI/SmoothGraphics-style side-view HUD for elevation-capable Action Effects 3D Crosshairs placement. It is approximately 276 px in diameter, anchored near screen position 320×275 on a 1920×1080 canvas, remains fixed in screen space through Scene pan/zoom, and cleans up with the placement session.
- The gauge uses a fixed visual diameter while its internal radial scale follows the spell/effect range with 10% visual headroom. It shows a source/origin center dot, dashed source-level horizontal axis, 0°/90°/180°/270° labels, 10-degree circumference ticks, stronger orientation ticks, an A→B radial vector, current source-to-destination distance, and the current side-view elevation at B.
- The destination elevation label follows the accepted side-view angle: 181°–359° places the label below B; the remaining half places it above. Below-origin gauge elevation is red; otherwise it is white. Remote placement preserves the retained construction-circle phase so far-side 181°–359° travel remains visible instead of collapsing into a right-half-plane projection. Self Cone/Ray uses the fixed-length endpoint and pitch arc for the same side-view instrument.
- Updated the existing crosshair elevation readout so accepted destination elevations below the source Token's base elevation render red (`#FF3B30`); elevations at or above the source base remain white. Text content/position remains unchanged from v0.4.4.9.
- Preserved all accepted v0.4.4.9 geometry, exact Scene-grid Z snapping, cyclic 360-degree elevation travel, range/targeting rules, wheel preference, cursor-centered MOVE handoff, authoritative confirmation label, mode badge, and dark-grey source tracer.
- Added deterministic regressions for fixed-size screen-space gauge anchoring, pan/zoom scale cancellation, gauge range/elevation/distance presentation, negative-elevation color, retained cleanup, session-state wiring, and red-below-source overlay behavior.

## 0.4.4.9 — Action Effects 3D Crosshairs — deterministic PIXI text styling

- Corrected the live Foundry v14/PIXI overlay styling path discovered in v0.4.4.8. AE5E now constructs the text display first and then assigns an explicit `PIXI.TextStyle`, avoiding runtimes that accept the text string but silently ignore a second constructor style argument and leave the display at PIXI's default black styling.
- Kept pure white (`#FFFFFF`) as the intended overlay text color and applies it explicitly to the elevation readout, authoritative click-to-confirm label, and MOVE / ROTATE / ELEVATE badge text.
- Increased the elevation readout from 20 px to 22 px and changed its center-relative downward offset to 44 px (exactly two text-height units). The anchor remains the authoritative crosshair center and does not depend on map-grid-square centers.
- Preserved all accepted v0.4.4.8 geometry, exact Scene-grid Z snapping, 360-degree cyclic elevation travel, wheel-direction preference, cursor-centered MOVE handoff, targeting/range behavior, mode-badge placement, authoritative confirmation-label placement, and dark-grey source tracer behavior.
- Updated the overlay regression to emulate the v0.4.4.8 Foundry failure mode where constructor styling is ignored, proving explicit post-construction TextStyle assignment and the new 22 px / 44 px elevation presentation.

## 0.4.4.8 — Action Effects 3D Crosshairs — placement HUD polish and ELEVATE wheel preference

- Corrected Foundry/PIXI text construction for the AE5E placement overlay. The authoritative confirmation label now renders its intended text instead of `[object Object]`, and overlay text styling is applied reliably.
- Centered the elevation readout on the authoritative crosshair point, then applies a fixed 20 px downward visual offset. The readout is explicitly white, bold, and increased from the intended v0.4.4.7 18 px size to 20 px.
- Moved the MOVE / ROTATE / ELEVATE badge from the top of the screen to an AE5E canvas badge that follows accepted placement and sits above the crosshair footprint while retaining the dark rounded presentation.
- Added a client-scoped **3D Crosshair Settings** option: `Reverse mouse wheel direction in ELEVATE mode`. It defaults enabled and reverses only Ctrl+mouse-wheel ELEVATE/PITCH travel; Shift+wheel ROTATE direction is unchanged.
- Preserved the accepted v0.4.4.7 exact Scene-grid Z snapping, free XY construction-circle solving, 360-degree cyclic travel, cursor-centered MOVE handoff, targeting, range, and dark-grey source tracer behavior.
- Added deterministic regressions for Foundry-compatible overlay text, 20 px centered elevation placement, moving mode badge, setting registration/default, and reversed ELEVATE wheel input.

## 0.4.4.7 — Action Effects 3D Crosshairs — grid-Z elevation snapping and authoritative confirm label

- Corrected remote ELEVATE snapping to match the intended vertical-grid UX. Ctrl-wheel now advances to the next horizontal Scene-grid Z plane encountered around the retained construction circle, so accepted elevations stay on exact grid-distance values (for example `0, 5, 10, 15...` on a 5-ft Scene) regardless of construction-circle radius. XY is solved continuously from the fixed-radius circle during ELEVATE rather than being quantized to map-grid XY coordinates.
- Preserved cyclic 360-degree travel in either direction. If zenith/nadir lies between two legal Z planes, traversal crosses the pole without publishing the unsnapped pole elevation; the next accepted point is the corresponding snapped Z-plane intersection on the far side.
- Removed the click-to-confirm text from Sequencer's invisible functional cursor carrier. AE5E now owns that text in its placement overlay and positions it from each accepted authoritative crosshair point, preventing out-of-range cursor motion from making the label chase the cursor and flicker back.
- Retained the accepted v0.4.4.6 behavior for default cursor-centered MOVE after modifier release, manual absolute-Z preservation, cyclic elevation state, and the dark-grey Entangle/Fireball source tracer. Self Cone/Ray pitch remains unchanged pending dedicated live acceptance.
- Added deterministic regressions for exact grid-Z snapping, free XY circle solving, unsnapped-pole traversal, and authoritative confirmation-label ownership/cleanup.

## 0.4.4.6 — Action Effects 3D Crosshairs — restore default cursor-centered MOVE handoff

- Reverted only the v0.4.4.5 modifier-to-MOVE pointer-offset preservation after live-test preference. Releasing Ctrl/Shift now returns remote placement to the established/default Sequencer cursor-centered MOVE behavior: the next mouse movement reacquires cursor XY directly.
- Manual absolute Z remains preserved across that MOVE transition. The v0.4.4.5 constant one-Scene-grid-distance orbital arc stepping, 360-degree cyclic travel, and retained dark-grey Entangle/Fireball source tracer remain unchanged.
- Replaced the smooth-handoff regression with deterministic coverage proving cursor-centered XY reacquisition plus manual-Z preservation.

## 0.4.4.5 — Action Effects 3D Crosshairs — uniform orbital steps and smooth MOVE handoff

- Corrected remote Ctrl-wheel elevation so each accepted notch advances exactly one Scene grid-distance along the fixed-radius construction arc (`s = rθ`). This removes the large spatial jumps near zenith/nadir while preserving continuous 360° travel in either direction.
- Corrected the ELEVATE/ROTATE → MOVE handoff. AE5E now preserves the accepted crosshair-to-pointer XY offset when modifiers are released, so subsequent normal mouse movement translates smoothly from the authoritative 3D position instead of snapping the crosshair back under the physical cursor. Manual world-Z remains preserved.
- Restored the established AE5E source-to-placement tracer used by Entangle/Fireball: Eskie `generic_01` line, `#4A4A4A` tint, 0.8 opacity, below Tokens. The retained tracer endpoint updates in place and is cleaned on confirm/cancel/error with the rest of the temporary placement presentation.
- Added `elevationRadius` to accepted remote elevation revisions so live diagnostics can verify the exact orbital arc distance (`radius × phase delta`) for each accepted wheel notch.
- Added deterministic regressions for constant one-grid orbital arc travel, smooth modifier-to-MOVE handoff, and retained non-destructive tracer updates.
- Kept Self Cone/Ray pitch/apex behavior unchanged pending its dedicated live acceptance tests. No Checkpoint 3 propagation, persistent Region, compendium, or Item behavior was added or changed.

## 0.4.4.4 — Action Effects 3D Crosshairs — cyclic remote elevation

- Corrected remote construction-plane elevation so every Ctrl-wheel notch contributes the full one-grid-distance manipulation amount even when that step crosses zenith or nadir; unused distance is carried through the pole instead of being discarded by a clamp.
- Remote construction-plane elevation now uses a cyclic 0–360° phase. Reverse input from phase 0 wraps into the previous quadrant rather than sticking at zero/±180°, and repeated travel may continue around the circle in either direction.
- Added `elevationPhase` to accepted remote elevation revisions for flat live diagnostics; actual XY MOVE resets the temporary construction-plane phase as designed.
- Kept Self Cone/Ray pitch/apex behavior unchanged pending its dedicated live acceptance tests.
- Added deterministic regressions for pole carry-through, reverse-direction wrapping, repeated cyclic travel, and Ctrl release/re-entry.
- No Checkpoint 3 propagation, persistent Region, compendium, or Item behavior was added or changed.

## 0.4.4.3 — Action Effects 3D Crosshairs — Checkpoint 2 live acceptance corrections

- Corrected remote ELEVATE construction-plane travel so Sphere/Prism-style remote placements continue naturally through vertical and onto the opposite side of the source instead of clamping at ±90 degrees. The retained arc survives Ctrl release/re-entry and resets when actual XY MOVE changes the placement plane.
- Corrected accepted-state Eskie/Sequencer presentation flicker. Session-owned placement artwork is now transformed in place instead of calling Sequencer 4.2.x `EffectManager.updateEffects()`, whose update path destroys and reinitializes CanvasEffect media. If the required live transform capability is unavailable, AE5E falls back to its retained guide instead of repeatedly rebuilding the effect.
- Corrected final-confirm synchronization so a click cannot reconcile an older hidden-carrier position over a newer still-resolving wheel revision. Confirmation now waits for the newest authoritative revision before final carrier reconciliation and commit.
- Added deterministic regressions for through-vertical remote elevation across modifier release/re-entry, retained non-destructive visual updates, and confirmation while manipulation work is still pending.
- No Checkpoint 3 propagation, persistent Region, compendium, or Item behavior was added or changed.

## 0.4.4.2 — Action Effects 3D Crosshairs — live placement and targeting

- Added the opt-in live `ae5e.crosshairs3d.show(...)` placement session on top of the v0.4.4.1 pure 3D geometry foundation. Existing `ae5e.crosshairs` Items remain unchanged.
- Added session-scoped MOVE / ROTATE / ELEVATE controls: normal mouse movement controls XY, Shift + mouse wheel applies exact 5-degree yaw increments, and Ctrl + mouse wheel applies one Scene grid-distance elevation increment. Ctrl+Shift is intentionally non-operative, and all temporary input interception is cleaned up on confirm, cancel, or error.
- Added accepted-revision targeting on every usable placement change using the locked gridded rules path: continuous 3D primitive -> affected 3D grid cells -> full Token 3D-volume positive overlap. Rapid input is coalesced without losing wheel notches, and stale async revisions cannot overwrite newer target state.
- Added atomic accepted-state publication: target highlighting, AE5E guides, elevation labels, the hidden Sequencer carrier, and optional Eskie presentation advance only after the newest revision has resolved. Final confirmation waits for the newest authoritative revision before committing targets.
- Added remote surface-following through Foundry v14 move surfaces, preferring a matching surface on the currently viewed Level as contextual guidance while keeping exact XYZ authoritative. After manual elevation, later XY movement preserves the selected absolute world-Z plane unless higher physical terrain requires an upward clamp.
- Added true-3D range enforcement for remote placement. When a requested XY point exceeds range, AE5E solves the farthest legal horizontal placement while preserving the selected absolute Z plane and re-resolving physical surface elevation along the solve.
- Added Self Cone/Ray 3D pitch controls with fixed centerline length, legal source-boundary apex resolution, endpoint elevation tracking, deterministic zero-roll Ray geometry, and opposite-apex handoff when pitch crosses through vertical.
- Added retained accepted-state presentation: horizontal shapes may use Eskie artwork when available; pitched Cones switch to an AE5E-owned retained PIXI 3D guide; Ray XY projection shortens with pitch while preserving a W x W vertical footprint. Presentation failure falls back to the AE5E geometry guide rather than failing placement.
- Added lightweight placement UI with current mode, current elevation, only the controls enabled for that placement, and the persistent Right Click to Cancel hint.
- Added optional LOS validation against the resolved authoritative XYZ using the source Token vision API. The cursor remains free while accepted placement state is constrained to legal revisions.
- Preserved hidden/Invisible target secrecy by performing no AE5E visibility filtering or disclosure UI: mechanically eligible Tokens can remain in the authoritative target set while Foundry/Midi presentation controls what the player can see.
- Added deterministic regression coverage for live confirmation/cancel target ownership, exact wheel increments, rapid-input coalescing, Self pitch, vertical apex handoff, current-Level surface preference, absolute-Z range clamping, and retained Eskie/fallback visual behavior.
- Checkpoint 2 deliberately does not yet implement live `Direct` / `Spread` obstruction propagation or persistent Region generation; those remain Checkpoint 3 work.

## 0.4.4.1 — Action Effects 3D Crosshairs — geometry foundation

- Began the Action Effects 3D Crosshairs major feature line as an opt-in foundation. Existing 2D/Eskie crosshair Items are unchanged and no live placement hooks are registered by this checkpoint.
- Added pure authoritative 3D geometry for Prism/Cube, vertical Cylinder, Sphere, finite right Cone, sq…19595 tokens truncated…kflow-context handling so Item/Activity identity can be resolved from the cloned workflow payload or AA's secondary animation context. AA diagnostics now annotate transient claim id/reason without mutating the source Item/Activity.
- Persistent `flags.action-effects-5e.animation.automatedAnimations = "suppress"`, origin-chain inheritance, same-Actor status ownership, and child-policy stamping remain unchanged for persistent effects such as Entangled.
- No new Socketlib path is required. Transient claims are client-local runtime state surrounding the initiating Activity execution and perform no privileged document updates.
- Added focused regression coverage for Activity isolation, non-persistence, cleanup on success/failure, AA adapter suppression, and secondary-context identity matching. The repository development suite is **106/106 PASS**.
- No compendium contents were changed, regenerated, migrated, or overwritten in this release.

## 0.4.1.11 — Common actions compendium structure

- Added a new **Actions - Common** Compendium Pack folder beneath the existing top-level **Action Effects 5E** compendium folder.
- Added a new empty D&D5e `Item` compendium named **Actions - Common** inside that folder, using the stable internal pack identifier `actions-common`.
- Existing spell and administrative compendium contents were preserved byte-for-byte; no existing compendium was regenerated, migrated, or overwritten.
- Advanced module/package/runtime version metadata to `0.4.1.11`. No runtime behavior, macros, sockets, movement services, CAT interoperability, or crosshair behavior changed in this release.

## 0.4.1.10 — Eskie custom-color crosshair resolver fix

- Fixed custom hex crosshair colors when Patreon/premium Eskie is active. A custom color such as Misty Step's `#8FD8FF` is no longer normalized to the white asset lookup color and then incorrectly classified as a native premium-white request.
- Premium white artwork remains the preferred tintable base for custom colors. The resolver now returns the requested tint with reasons such as `premium-white-tinted`; authored premium Red/Teal/White/Yellow requests still use their native recolors without Sequencer tinting.
- Added a Foundry foundation regression for the exact 30-foot `Fantasy_01` no-base Misty Step request and four targeted Node resolver regressions covering premium custom hex, premium-only custom hex, native named color preservation, and true white preservation.
- No new Socketlib path is required: crosshair asset resolution and Sequencer tint application execute on the client that owns the placement UI and do not perform privileged document changes.
- No compendium contents were changed, regenerated, or migrated in this release.

## 0.4.1.9 — Relationship orbit regression-suite modernization

- Modernized the legacy Node relationship-orbit fixture so `RelationshipRotationService` receives an explicit clear Grapple-link obstruction test double, matching the relevant production dependency shape instead of accidentally exercising the runtime's intentional `link-preflight-unavailable` fail-closed fallback.
- Restored five stale orbit simulations covering Shift/Ctrl one-shell-step normalization, rapid serialized wheel input, nonhostile endpoint grace/continuation, and player-to-GM orbit authorization. No production relationship, movement, collision, accounting, or socket behavior was changed.
- Updated the obsolete opposing-occupant assertion to the current Follower-body collision policy: a hostile occupied orbit endpoint hard-blocks before `Scene.moveTokens()` and never arms nonhostile endpoint grace.
- Strengthened the non-45-degree collision rollback regression to assert the actual Follower-body environmental obstruction reason and that movement is stopped before `Scene.moveTokens()`, preventing the test from passing merely because Grapple-link preflight is unavailable.
- The repository Node suite now completes **97/97 PASS**. This cleanup does not replace Foundry-side behavioral acceptance; it removes known simulation debt so future Node regressions are easier to distinguish from stale fixtures.
- No compendium contents were changed, regenerated, or migrated in this release.

## 0.4.1.8 — CAT teleport semantic compatibility

- Extended the existing `CatMovementAdapter` to observe CAT's explicit `preTeleport` / `postTeleport` `MovementEvent` lifecycle. CAT currently performs the physical token move with the ordinary `displace` action, so AE5E correlates CAT's semantic lifecycle to that Foundry movement rather than guessing teleportation from distance or action alone.
- CAT remains an input/execution adapter. AE5E still owns `MovementTransaction` classification consequences, voluntary-movement restrictions, Grapple/relationship policy, Push/Pull/Shove displacement, collision/obstruction rules, and Foundry/D&D5e movement accounting.
- A correlated CAT teleport is normalized into AE5E's existing teleport path (`pathType: teleport`, `resource: none`, semantic `movementMode: teleport`) while preserving the actual native movement action and any richer metadata already supplied by the caller. AE5E does not infer willingness; agency remains unknown unless explicitly provided.
- CAT teleports now pass the reusable v0.4.1.7 voluntary-movement restriction policy. Existing relationship semantics then apply unchanged: a grappled Follower may teleport, and the default `detach` teleport policy breaks that relationship after the move settles.
- Added destination-correlated, bounded temporary state so unrelated `displace` movement is not mislabeled. A canceled `preTeleport` event and a destination mismatch remain ordinary movement; recognized movement IDs retain their teleport classification across both Foundry movement-hook phases.
- Added multiplayer semantic routing. When a non-GM initiates a CAT teleport, AE5E sends only a JSON-serializable temporary teleport context to active GMs before CAT proceeds. CAT continues to own its own movement/permission query, while AE5E's existing GM-authority relationship sockets continue to resolve consequences such as Grapple detachment.
- Added five deterministic Node regression checks plus `ae5e.tests.runCatTeleportCompatibilityTest()` for live Foundry/CAT acceptance with a disposable movement-restricted grapple fixture. The repository Node suite adds no new failures relative to v0.4.1.7.
- No compendium contents were changed, regenerated, or migrated in this release.

## 0.4.1.7 — Voluntary movement restriction policy

- Added a reusable Active Effect movement policy at `flags.action-effects-5e.movement.voluntaryRestriction`.
- Active restrictions cancel ordinary voluntary token movement during `preMoveToken`, before AE5E's normal no-interest fast path, so native drag/keyboard walking is blocked without requiring a corrective snapback.
- Forced, compelled, passenger/relationship-follower, administrative, and teleport movement remain allowed. An affected relationship leader is still blocked from voluntarily walking, while an affected grapple/passenger follower can still be carried or dragged by another creature.
- Restriction resolution is Actor-local, ignores disabled/suppressed effects, supports an optional per-effect message and priority, and exposes read/evaluation diagnostics through `ae5e.movement`.
- Added focused Node regression coverage plus a Foundry live acceptance macro.
- No compendium contents were changed, regenerated, or migrated in this release.

## 0.4.1.6 — Ongoing-effect multiplayer result authority fix

- Fixed player-controlled ongoing actions such as **Entangle — Escape** where the player prompt and roll completed but the authoritative success/failure lifecycle did not finish.
- The client that executes the D&D5e Activity now reduces the completed Midi workflow to a versioned, JSON-serializable result envelope and routes that outcome to the primary GM through AE5E's generic ongoing-effect socket. Live Midi Workflow objects are never transported over Socketlib.
- The primary GM re-resolves and validates the exact granted Item and parent ActiveEffect UUIDs before applying consequences. Success removes the linked parent effect (which owns grant cleanup); failure leaves the effect and granted Item intact.
- Added per-workflow result de-duplication so Midi's overlapping completion hooks cannot resolve the same ongoing action twice.
- Added focused Node regression coverage for player-to-GM serialization/routing, duplicate-hook suppression, GM success cleanup, failure preservation, and circular/live-workflow isolation.
- No compendium contents were changed, regenerated, or migrated in this release.

## 0.4.1.5 — Animation ownership and Automated Animations arbitration

- Added generic AE5E animation-ownership infrastructure using `flags.action-effects-5e.animation.automatedAnimations`. The first supported policy is `"suppress"`.
- Added an Automated Animations adapter for the supported `AutomatedAnimations-WorkflowStart` arbitration hook. Direct ownership decisions set `clonedData.stopWorkflow` immediately; ownership that requires an asynchronous UUID-origin lookup is added to `clonedData.deferrals`, matching the AA 7.0.22+ interoperability contract.
- Active Effect animation ownership can be inherited from an Item-owned effect template, from a resolvable origin document chain, or from a same-Actor suppressing Active Effect that owns the same native status ID. This allows a suppressing `Entangled` effect carrying `restrained` to suppress a related `Restrained` Active Effect animation without globally disabling Restrained animations.
- Added `ae5e.animationOwnership` diagnostics/resolution APIs plus helpers to stamp or inherit the canonical AA policy when AE5E/item automation explicitly creates child effect data.
- Added `ae5e.interoperability.automatedAnimations` status/statistics reporting. Automated Animations remains optional; AE5E does not globally alter AA settings.
- Added `runAnimationOwnershipFoundationTest()` and a focused Node regression covering explicit suppression, Item-owned template inheritance, child-status inheritance/isolation, deferred UUID-origin resolution, and canonical flag stamping.
- No compendium contents were changed, regenerated, or migrated in this release.

## 0.4.1.4 — Generic Region authority and ongoing-action prompt controls

- Added a generic `ae5e.regions` authority bridge for Scene Region documents. Item/activity macros remain responsible for placement geometry and spell-specific Region behaviors; AE5E only routes create/delete persistence through the primary active GM.
- Added AE5E Region ownership metadata under `flags.action-effects-5e.authorityRegion`. The generic delete API intentionally refuses to delete Regions that were not created through AE5E Region authority.
- Added `indicatorRole` to ongoing-action declarations. Existing declarations remain green/originator by default; callers may opt into any registered AE5E semantic selection-indicator role such as orange/responder.
- Added opt-in `suppressPromptWhenUnusable`. When enabled, AE5E checks the granted D&D5e Activity before routing a turn prompt and suppresses the prompt when the Activity reports `canUse === false` or its configured activation resource is unavailable.
- Exposed `ae5e.ongoingEffects.getActivityUsability()` for diagnostics and spell/item automation.
- Added Foundry-side Region authority foundation/live-lifecycle tests and expanded the ongoing-effect foundation gate for indicator-role validation and unusable-prompt suppression.
- This release is generic infrastructure only. No spell-specific Entangle behavior, compendium UUID, targeting rule, Difficult Terrain behavior, or animation is hard-coded into AE5E runtime.

## 0.4.1.3 — Ongoing effect actions and combat reminders
- revised2 test instrumentation: added a Foundry-only live mandatory-save execution characterization suite. The suite creates and cleans a temporary dedicated template in the hidden AE5E Administrative pack, grants it from a temporary Active Effect, executes the Save Activity through CAT/Midi, and validates live workflow outcome plus success/failure lifecycle behavior.

- Added the first narrow AE5E ongoing-effect action infrastructure for effects that grant a dedicated follow-up Item such as a repeat saving throw or an escape action.
- Added `flags.action-effects-5e.ongoingAction` on the parent ActiveEffect. A declaration references a stable compendium Item UUID, optional `turnStart`/`turnEnd` timing, mandatory-vs-optional prompt behavior, and success cleanup policy.
- Added GM-authoritative cloning of the referenced compendium Item onto the affected Actor. Each clone carries `flags.action-effects-5e.ongoingActionGrant` with the exact parent ActiveEffect UUID and template UUID; the parent ActiveEffect stores the granted Item UUID for deterministic bidirectional lifecycle cleanup.
- Added parent-owned cleanup and reconciliation. Removing an ongoing ActiveEffect removes only its own granted Item; missing granted Items can be recreated; orphaned granted Items can be removed. Identical template UUIDs are never used as instance identity.
- Added CAT `documentUtils.getSavedCastData()` exposure through `CatSpellAdapter`, with fallback flag reads, so v0.4.1.3 can preserve original-cast context on granted Items without hard-coding caster values into compendium templates. This relies on the ActiveEffect document fix available in CAT 0.0.7+ when CAT is used for that capability.
- Added combat timing for affected-actor `turnStart` and `turnEnd`. While combat is active, matching ongoing effects prompt the controlling player every applicable turn while the effect remains.
- Mandatory prompts provide one Proceed/Roll action and automatically proceed after 10 seconds if unanswered. Execution is claim-guarded so a near-simultaneous player click and timeout cannot double-execute the Activity.
- Optional actions such as escape attempts provide `Use Action` / `Not Now` semantics with no automatic timeout. If the effect remains, the opportunity is presented again at its next configured turn timing.
- Outside combat, AE5E performs no world-time or six-second scheduling. The granted Actor Item remains available for normal GM-directed resolution.
- Added a public end-of-combat chat summary listing unresolved AE5E ongoing effects that remain on combatants. The card is visible to the table and contains no scheduling/action buttons.
- Added `ae5e.ongoingEffects` API methods for inspection, grant lifecycle, reconciliation, timing, prompt/execution, workflow result handling, summary generation, and diagnostics.
- Added Foundry-side automated validation: a deterministic ongoing-effect foundation suite and a live Actor lifecycle suite covering bidirectional links, same-template instance isolation, selective cleanup, missing-child reconciliation, and cleanup of repaired grants.
- Added the hidden D&D5e Item compendium **AE5E Administrative** directly under the existing **Action Effects 5E** compendium-folder hierarchy. It is GM-only and intentionally ships empty; spell/effect-specific follow-up templates and internal folders can be added later without changing the runtime contract.


## 0.4.1.2 — Reusable Eskie crosshair infrastructure

- Added the first centralized `ae5e.crosshairs` service for custom AE5E placement visuals. Item/spell macros can now query Eskie installation status, inspect shape semantics/catalog data, resolve the best available asset, and launch a Sequencer crosshair with an AE5E Eskie replacement visual.
- Added explicit runtime detection for Patreon/premium Eskie (`eskie-effects`) and the public free module (`eskie-effects-free`), kept independent from Sequencer detection.
- Added an explicit premium catalog generated from the supplied Eskie Effects v1.9.0 Crosshair archive: **244 WebM assets** across Circle (64), Cone (64), Line (20), Ray (40), Rectangle (48), and Reticle (8). Explicit paths are retained instead of assuming a perfectly symmetric filename matrix.
- Added the confirmed free crosshair catalog: **52 white WebM assets** across all six shapes: Circle, Cone, Line, Ray, Rectangle, and Reticle. AE5E can tint these white assets when a native premium color is unavailable.
- Added premium-first resolution: exact native premium color → same-style premium white + tint → alternate premium style → free white + tint → native crosshair fallback. This preserves same-style fidelity for the known `Circle/Generic_01` Red 60ft catalog hole rather than silently switching styles.
- Added centralized approximate tint values for Red, Teal, and Yellow. Native Patreon recolors always take priority; tinting is a fallback for white artwork, not a claim that the result is artistically identical to the premium recolor.
- Preserved the Fireball crosshair semantics: Eskie `Line` is a source-to-template tracer; Eskie `Ray` represents the path/beam itself.
- Centralized the proven custom-crosshair suppression settings: `borderAlpha: 0`, `fillAlpha: 0`, `gridHighlight: false`. These are applied only when a custom Eskie visual actually resolves; otherwise Sequencer's native crosshair remains visible and functional.
- Corrected the live Sequencer 4.2.x adapter after interactive validation: `Sequencer.Crosshair.show()` now receives the current two-argument contract (`config`, `callbacks`), AE5E `type` is translated to Sequencer's measured-template `t`, and `limitMaxRange` is nested under `config.location`. This ensures custom SHOW callbacks actually fire and the authored distance/visual-suppression settings are honored.
- Added `runCrosshairFoundationTest()` and `runCrosshairInteractiveTest()` Foundry harnesses. The interactive gate opens a Fireball-style Circle + Line placement from exactly one controlled token and verifies local persistent crosshair effects are cleaned up after placement/cancellation.
- Existing v0.4.1.1 compendium hierarchy and prior SME/movement/reaction runtimes are otherwise unchanged.

## 0.4.1.1 — Module spell compendium structure

- Added the first AE5E-owned compendium library structure for Foundry VTT.
- Added the top-level **Action Effects 5E** Compendium Pack folder with a nested **Spells** folder.
- Added ten empty D&D5e `Item` compendium packs beneath **Spells**: **Cantrips**, **Level 1**, **Level 2**, **Level 3**, **Level 4**, **Level 5**, **Level 6**, **Level 7**, **Level 8**, and **Level 9**.
- Assigned stable internal pack identifiers `spells-cantrips` and `spells-level-1` through `spells-level-9` for future AE5E content and UUID references.
- This release adds compendium/package metadata only. The finalized v0.4.1 runtime behavior is preserved; the shared `MODULE_VERSION` constant is advanced to `0.4.1.1` so the public AE5E API reports the installed package version correctly. All other runtime JavaScript, tests, styles, and localization are unchanged.


## 0.4.1 — Spell Modifier Engine foundation

- Added the first production **Spell Modifier Engine (SME)** foundation. SME is a generic per-cast orchestration layer for feats, class features, metamagic, items, effects, and later integrations that can inspect or modify a spell workflow without requiring each spell to hard-code awareness of those features.
- Added seven AE5E semantic spell phases: `preTargeting`, `targetingComplete`, `savesComplete`, `beforeDamageRoll`, `damageRollComplete`, `beforeDamageApplication`, and `workflowComplete`. `SpellModifierEventAdapter` normalizes the relevant live Midi-QOL hooks into those phases and de-duplicates equivalent duplicate hook surfaces.
- Added a programmatic modifier-handler registry with priority, automatic/optional mode, capability requirements, per-cast application policy, conflict groups, multi-option support, eligibility, option generation, apply callbacks, configurable fail-open/fail-closed behavior, and reverse-order rollback callbacks.
- Added declarative modifier discovery on caster Actor, Item, and ActiveEffect sources through `flags.action-effects-5e.spellModifier` (plus plural compatibility input). Declarations identify a registered generic handler; the engine, rather than individual spells, discovers applicable opportunities at each phase.
- Added an aggregated optional-modifier chooser. All optional opportunities discovered at one semantic phase are presented in one movable AE5E DialogV2, use the existing originator selection indicator/audio lease, and enforce option-selection groups and explicit conflict groups before application. Closing the choice window fails open and continues the unmodified base spell.
- Added `SpellModifierSession`, one isolated per-cast transaction that records normalized phase visits, decisions, successful applications, errors, applied/conflict keys, rollback callbacks, and terminal state. Sessions are kept off Actor/Item documents and archived into a bounded recent diagnostic history.
- Integrated the CAT workflow-local state mechanism characterized during SME research. While CAT exposes `setWorkflowProperty` / `getWorkflowProperty`, AE5E mirrors the current session snapshot at `workflow.cat.sme.actionEffects5e` (`SME_WORKFLOW_STATE_PATH = "sme.actionEffects5e"`). AE5E's `SpellModifierSession` remains authoritative; the CAT property is a workflow-local interoperability/diagnostic mirror and does not persist between casts.
- Added `CatSpellAdapter`, the single CAT-facing SME utility facade. It wraps the CAT 0.0.6 workflow/activity/item/roll/applied-damage primitives already characterized in Foundry, including Activity substitution, cast/save facts, synthetic in-memory Activities/Items, explicit roll reconstruction/re-evaluation, preserve-results damage-type retagging, roll augmentation, and per-target applied-damage adjustment. Modifier handlers consume AE5E `SpellModifierContext` methods rather than calling CAT directly.
- Clarified the damage-roll mutation contract after CAT maintainer feedback and live Foundry validation: CAT `rollUtils.getChangedDamageRoll()` intentionally constructs/evaluates a replacement DamageRoll, so SME exposes that behavior as `rebuildChangedDamageRoll()` rather than the ambiguous CAT helper name. Added AE5E `retagDamageRollsPreservingResults()` for post-roll type-only changes; it follows the proven CPR Chaos Bolt pattern by mutating `roll.options.type` and committing the same evaluated roll objects through Midi `workflow.setDamageRolls()`, preserving totals/formulas/dice results. Live validation also proved CAT `setActivity()` changes `workflow.activity` but does not replace the already-running D&D5e Activity instance used by `rollDamage()`. For Transmuted Spell-style mechanics, SME therefore stages the chosen type before damage is rolled and physically retags the evaluated rolls at `damageRollComplete` without rerolling them.
- Capability-gated handlers simply do not become offers when their required CAT utility is unavailable. CAT therefore remains recommended rather than a hard module dependency for the generic SME core; specific modifiers may declare the capabilities they require.
- Added public `ae5e.sme` / `ae5e.spellModifiers` APIs for handler registration, discovery, phase processing, session diagnostics/rollback/cleanup, registry/UI/event-adapter diagnostics, and CAT spell-capability diagnostics. SME constants are exposed through `ae5e.constants`.
- Added Foundry-only SME validation: `runSpellModifierEngineFoundationTest()` covers generic registry/discovery/choice/conflict/session/rollback/event-adapter behavior, while `runSpellModifierEngineLiveActivitySubstitutionTest()` executes a disposable synthetic spell through the real Midi/CAT/D&D5e workflow and proves the preserve-results damage-retag contract, phase propagation, conditional per-target damage-application mapping, workflow-local state mirroring, and cleanup.
- v0.4.1 deliberately ships **infrastructure, not hard-coded Transmuted Spell/Empowered Spell/etc. implementations**. It also does not create a second general resource-consumption engine; individual modifier implementations can add their own validated resource policy as those features are built.
- The finalized v0.3.30 movement, Shove, relationship, displacement, selection-indicator, and Reaction Broker runtimes are otherwise preserved.


### Final v0.4.1 Foundry acceptance

- Finalized the **revised3 runtime with no further runtime JavaScript changes**; finalization is release-documentation cleanup only.
- SME foundation: **26/26 PASS**.
- Live Midi/CAT/D&D5e preserve-results damage retag: **31/31 PASS**. D&D5e evaluated the original fire roll once; SME then retagged that exact evaluated roll to cold at `damageRollComplete` without replacing the roll object or changing its total/formula/dice result.
- Interactive SME choice UI: **9/9 PASS**, covering single choice, one aggregated multi-modifier chooser, option-group exclusivity, explicit conflict groups, continue-without-modifiers, X-close fail-open behavior, and selection-indicator cleanup.
- Remote non-GM controller routing: **5/5 PASS** plus manual acceptance that the chooser appeared only on the owning player, the green selection indicator remained active while the player chose, and the private notification sound played for the player but not the GM.
- Live save-spell lifecycle: **8/8 PASS**, proving `targetingComplete` and `savesComplete` map from real Midi hooks and remain on one per-cast SME session through `workflowComplete`.
- Preserved v0.3.30 regression suites all passed individually: foundation **13/13**, native movement accounting **12/12**, displacement foundation **9/9**, Follower-body disposition **8/8**, Grapple-link obstruction **6/6**, and Reaction Broker foundation **18/18** — **66/66 underlying regression checks PASS**.
- Terrain Mapper `updateToken`, CRLNGN UI `renderSceneNavigation`, and Foundry graphics readback warnings observed during regression setup are external/known console noise; the underlying AE5E suites still returned PASS and completed cleanup.

## 0.3.30 — CAT movement interoperability

### Final Foundry acceptance

- Finalized the revised1 runtime with **no further runtime JavaScript changes** after the complete Foundry acceptance gate passed.
- CAT interoperability harness: **19/19 PASS**, including external `catForce` semantic recognition, AE5E-through-CAT measured/zero-cost movement, metadata preservation, real wall-constrained execution, and disposable-fixture cleanup.
- CAT non-owner player → GM movement routing: **PASS** using a connected non-GM player against a non-owned fixture Token.
- Broad movement regression: **48/48 PASS** across foundation smoke, native movement accounting, forced displacement, Follower-body disposition, and Grapple-link obstruction.
- Live forced-displacement native accounting through CAT: **21/21 PASS** for Push, Pull, soft-endpoint grace, and administrative rollback, all preserving Foundry movement history and AE5E's measured zero-cost movement action.
- Reaction Broker foundation sanity regression: **18/18 PASS**; the unchanged deeper v0.3.28 Broker certification remains authoritative.
- Revised Shove destination geometry: **11/11 PASS**, proving three intentional 5-foot stops plus five 10-foot endpoints, mixed-direction paths inside the original AWAY fan, and separated compact selectors for 2x2/3x3 targets.
- Live large-token selector acceptance: **PASS** for both 2x2 and 3x3 targets; all eight bright-green edge/corner handles were visually distinguishable, easy to associate with their destination, and easy to click.
- Final post-revision displacement gate: displacement foundation **9/9 PASS** plus live forced-displacement accounting **21/21 PASS**.
- Terrain Mapper `updateToken`, Effect Macro combat-hook, and CRLNGN UI scene-navigation console exceptions observed during test setup are external module errors previously seen outside this revision; they did not alter any AE5E acceptance result.

### Revised1 — steerable AWAY Shove destinations

- Changed `AWAY` Push from a one-time fixed 45-degree ray choice into a fixed **directional fan**: the legal fan is still calculated once from the original Source/Target center geometry, but each 5-foot step may choose any direction inside that original fan. This permits intermediate-angle endpoints such as `NW -> N` and `N -> NW` during a 10-foot shove without allowing the path to curve sideways/back around the Source.
- `AWAY` distance is now an **up-to maximum** for destination choice. A 10-foot Shove directly away from a south-adjacent Source exposes the three legal 5-foot stops plus five legal 10-foot endpoints (eight selectable squares total when unobstructed). `STRAIGHT_AWAY` and `STRAIGHT_TOWARD` retain their established direct-ray behavior.
- Groups multiple equal-length paths that reach the same AWAY endpoint and chooses a fully legal path when one exists. This allows an intermediate-angle endpoint to remain selectable when one ordering of its steps is obstructed but another legal ordering reaches the same square.
- Added stable destination keys and `directionPath` metadata for multi-direction Pushes. Legacy automation which supplies a single `directionKey` for `AWAY` remains compatible and resolves to the farthest fixed-ray candidate in that direction.
- Preserved partial-stop semantics without duplicating an orange partial selector on top of an already-offered intentional shorter AWAY endpoint.
- Strengthened Large/Huge destination selection: overlapping full token footprints remain faint state-colored ghosts, while each selectable destination gets a separate smaller **bright-green** click handle on its leading edge/corner. Blocked footprints remain visible without a misleading disabled green handle.
- Added `ae5e.tests.runShoveDestinationGeometryTest()` plus targeted Node coverage. The Foundry harness validates the eight-square 10-foot geometry, intentional 5-foot stopping, mixed-direction execution through the production movement path, fixed-fan semantics, and non-overlapping bright-green 2x2/3x3 selection handles.

- Added `CatMovementAdapter`, a single AE5E-owned facade for all CAT movement integration. Feature code no longer needs to call CAT directly.
- CAT remains a recommended/optional module. When CAT is active and exposes `cat.utils.tokenUtils.moveToken()`, eligible AE5E single-token movement uses CAT; when CAT is unavailable before execution, the facade falls back to native `TokenDocument.move()`. CAT execution exceptions are not retried natively, preventing duplicate movement after partial execution.
- Routed AE5E forced Push/Pull's final low-level Token movement through the CAT facade while preserving the finalized v0.3.29 semantic operation metadata, collision planning, endpoint grace, and movement-settlement handling.
- Deliberately retained AE5E's `action-effects-5e.no-cost` movement action for forced/no-resource movement. CAT 0.0.6 `catForce` is `measure: false` and therefore records 0 distance / 0 cost; it cannot satisfy AE5E's required measured-distance/zero-cost semantics.
- Added CAT → AE5E recognition for external `catForce` movement. Such movement is surfaced as `agency: forced`, `resource: none`, `movementMode: catForce`, and `interoperabilityProvider: cat`, while source, Push/Pull type, and direction remain unset unless explicitly supplied by another integration.
- Ordinary CAT `walk` movement is intentionally not claimed as CAT-origin because it is indistinguishable from ordinary Foundry/API walk movement after CAT delegates it.
- Preserved AE5E relationship group movement on the existing coordinated `Scene.moveTokens()` implementation; CAT's single-token helper is not used to replace atomic Leader/Follower movement or AE5E rollback semantics.
- Added CAT state/version to compatibility diagnostics and public `ae5e.interoperability.cat.getStatus()` / `getStats()` diagnostics.
- Added Foundry-only `ae5e.tests.runCatMovementInteroperabilityTest()`. The disposable fixture validates CAT execution, external `catForce` semantic recognition, AE5E-through-CAT measured distance with zero movement cost, metadata preservation, live wall-constrained execution, and cleanup.
- Updated manifest verification to Foundry 14.366 and recommends CAT without making it a hard dependency.
- Preserved v0.3.29 native movement accounting and the finalized v0.3.28 Reaction Broker runtime unchanged outside the movement interoperability seams.

## 0.3.29 — Finalized native Foundry/D&D5e movement accounting foundation

### Final Foundry acceptance

- Finalized the revised4 runtime implementation with no further runtime changes after the complete Foundry VTT acceptance gate passed.
- Final v0.3.29 validation: foundation + movement accounting **24/24 PASS**; live Leader/Follower combat accounting **18/18 PASS**; displacement foundation **9/9 PASS**; live forced-displacement accounting **21/21 PASS**; Follower-body disposition matrix **8/8 PASS**; Grapple-link obstruction **6/6 PASS**; Reaction Broker foundation sanity regression **18/18 PASS**; normal interactive Reaction Broker sanity regression **12/12 PASS**; live final-cost modifier acceptance **6/6 PASS**.
- Live native-ledger proof: ordinary 5-foot Leader movement consumed **5** native movement; generated Follower translation/orbit, forced Push/Pull, and administrative grace rollback recorded native movement history using `action-effects-5e.no-cost` with **0** movement cost.
- Live final-cost modifier proof: a one-grid move with native cost **5** plus distance **5** recorded **10** in Foundry's native `movementHistory`, validating the future Grapple `native cost + distance` foundation.
- The finalized v0.3.28 Reaction Broker implementation remains unchanged. A foundation and normal interactive sanity regression were rerun successfully; the deeper finalized v0.3.28 nested/Midi/multiplayer/disconnect matrix remains the authoritative baseline for unchanged Broker behavior.
- External Terrain Mapper `updateToken` and Effect Macro combat-hook console exceptions were observed during automated fixture/combat setup, but did not alter any AE5E acceptance result and are not treated as v0.3.29 release failures.

### Revised4 Foundry v14.365 normalization/test correction

- Registers the internal no-cost action and hidden cost-modifier slots with an explicit `canSelect: () => false` function. This avoids Foundry v14.365 normalizing the boolean shorthand into an undefined-returning closure for these third-party actions.
- Corrects the movement-accounting Foundry test harness to use the rendered `Token.measureMovementPath()` API for action-aware movement-cost measurement. The lower-level `TokenDocument.measureMovementPath()` remains useful for geometry measurement but does not resolve waypoint action costing in the same way.
- No movement-rule semantics changed: AE5E-generated no-resource movement remains measured and zero-cost; normal voluntary movement remains native; final-cost modifiers remain pre-registered-slot based.

- Fixed runtime final-cost modifier registration on Foundry v14, where `CONFIG.Token.movement.actions` is sealed after initialization.
- Reworked the reusable final-cost modifier API to use eight hidden modifier slots registered during `init`; runtime registration now assigns behavior to a pre-existing slot and does not mutate Foundry's sealed movement-action registry.
- Expanded the Foundry-only movement-accounting test to verify modifier-slot registration, sealed-registry-safe runtime assignment, native-cost-plus-distance calculation, and slot cleanup.
- Preserves the revised2 startup-safe no-cost movement action and all finalized 0.3.28 behavior.

## 0.3.29 revised2 — Foundry v14 mutable movement-action descriptor correction

- Fixed the remaining world-startup blocker exposed after revised1: Foundry v14 expands `CONFIG.Token.movement.actions` descriptors in place during `Game.initializeConfig()`, so AE5E must not freeze the descriptor before core normalization.
- Replaced the hidden no-cost action with Foundry's documented simplified descriptor form: `costMultiplier: 0`, `canSelect: false`, `measure: true`, and the required icon. Foundry is allowed to normalize the descriptor into its final movement-action config.
- Removed descriptor freezing from AE5E movement-action registration paths so Foundry/core compatibility layers can safely add or normalize fields.
- Runtime final-cost modifier actions now expose `canSelect` in normalized function form while retaining the existing native-cost wrapper semantics.
- No movement-rule behavior was changed from the intended 0.3.29 design.

## 0.3.29 revised1 — Foundry v14 movement-action startup correction

- Fixed a world-startup blocker in the initial 0.3.29 candidate: Foundry v14 normalizes movement-action descriptors into a final config that requires an `icon`, so the hidden `action-effects-5e.no-cost` action now supplies a valid Font Awesome icon.
- Registered the hidden action with stable final-form semantics (`canSelect` function and `getCostFunction`) so it remains compatible before and after Foundry's movement-action normalization step.
- Hardened the movement-accounting test to validate the startup-safe icon, evaluate normalized `canSelect` behavior, and verify zero-cost semantics through `getCostFunction` rather than relying on pre-normalization descriptor fields.
- No movement-rule behavior was otherwise changed from the 0.3.29 candidate.

## 0.3.29 — Native Foundry/D&D5e movement accounting foundation

- Made Foundry v14 `TokenDocument.movementHistory` the sole movement-resource ledger used by AE5E. AE5E retains semantic `MovementTransaction` metadata but does not maintain a second allowance/spent/remaining counter.
- Added an internal, non-selectable `action-effects-5e.no-cost` movement action using Foundry's movement-action configuration. The action remains measured while its native cost multiplier is 0, so generated movement still has distance/path geometry without spending a creature's ordinary movement resource.
- AE5E forced Push/Pull displacement now uses the internal measured/no-cost action while preserving `agency: forced`, `resource: none`, Source/Target, displacement direction, requested/actual distance, and the established collision/grace semantics.
- Coordinated relationship movement now preserves the Leader's normal Foundry/D&D5e movement action and cost, while AE5E-generated Follower/passenger movement uses the no-cost action. The validated Grapple trailing rule remains unchanged: the Follower moves through the Leader's vacated spaces rather than mirroring the Leader's displacement.
- Orbit-generated Follower movement and AE5E administrative rollback movement now use native zero-cost accounting. Existing wall, hostile/nonhostile, Grapple-link, and 3.5-second grace behavior is unchanged.
- Teleport relationship behavior remains on the established teleport action/path so detach/follow/block semantics and teleport classification are not converted into traversed movement.
- Added lightweight native movement-history summaries to emitted `MovementTransaction` objects (`nativeMovement` and `movementCostConsumed`). These are observations of Foundry's ledger, not a second AE5E ledger.
- Added public movement-accounting helpers: history snapshot/history-cost access, the internal no-cost action ID, no-cost waypoint stamping, and a reusable final-cost modifier registration API.
- The final-cost modifier API wraps the selected native movement action's cost function before applying an AE5E modifier. This is the foundation for the later 2024 Grapple drag rule: **native D&D5e movement cost + distance moved**, rather than multiplying the already-modified native cost. The Grapple Activity itself is not added in this release.
- Stationary Grapple orbit charging remains intentionally deferred until the Grapple rule layer is implemented; v0.3.29 does not fake Leader movement or introduce a private movement counter to charge it.
- Added `ae5e.tests.runMovementAccountingTest()` for Foundry-only validation of the hidden measured/no-cost action, zero native measured cost, native-cost-plus-distance modifier wrapping, and non-mutation of existing movement history.
- Preserved the finalized v0.3.28 Reaction Broker, v0.3.27 selection indicator, forced-displacement geometry, relationship collision/link obstruction, Pull `STRAIGHT_TOWARD` semantics, CPR/GPS coexistence policy, and Foundry-only release-test policy without redesign.

## 0.3.28 — Finalized Reaction Broker foundation

- Finalized the v0.3.28 Reaction Broker foundation on the revised12 runtime/test baseline after the complete Foundry VTT release gate passed.
- Final Foundry acceptance: foundation **18/18 PASS**; normal interactive Broker **12/12 PASS**; nested parent/child Broker **21/21 PASS**; live Midi RESUME gate **6/6 PASS**; live Midi ABORT gate **6/6 PASS**; ordinary multiplayer routing **6/6 PASS**; last-GM disconnect/reconnect recovery **7/7 PASS**; active-controller disconnect/reroute recovery **7/7 PASS**; no-GM startup bypass **PASS**.
- The nested chronology regression proves the parent enters resolving before child creation, the child completes before the parent records the nested result, the parent does not advance to the next Reactor early, and the parent completes only after the child.
- Real Midi testing proves `midi-qol.prePreambleComplete` is genuinely awaitable by AE5E: RESUME reaches `postPreambleComplete` only after Broker completion, while ABORT prevents `postPreambleComplete`.
- Multiplayer testing proves controller-local prompt routing, longest-connected-GM arbitration, recovery after the last GM browser session is replaced, rerouting of an interrupted player-controlled Reactor to the GM without recording a decline, and clean bypass when no GM exists at transaction creation.
- No real Counterspell handler is included in v0.3.28; this release is the reusable reaction infrastructure on which Counterspell and later reaction automations will be built.
- The Firefox/Sequencer `Invalid URI` media warning remains the previously isolated Sequencer 4.x browser-media warning and is not an AE5E Reaction Broker release failure. A freshly reloaded browser may also defer its first private notification cue until the browser receives a user gesture because of browser audio autoplay policy.

## 0.3.28

- Revised12 controller-disconnect validation: strengthened the Foundry multiplayer harness so player-controller loss can no longer false-PASS. The test now proves that the interrupted Reactor 1 slot is rerouted to the elected GM, remains the same frozen queue slot, is not recorded as a decline, opens a fresh GM prompt, reaches all three Reactors, and completes without manual/authorization fallback. Added the rerouted Reactor UUID to transaction history diagnostics.

### 0.3.28 revised11
- Fixed the disconnect-recovery test false positive exposed by refreshing the sole GM during a player-owned active Reactor prompt.
- Synthetic test handlers now self-register on each client when the test suite is constructed, so a reloaded GM can immediately revalidate frozen test offers. Production handlers already register normally at module startup.
- Added explicit recovery assertions for GM browser-session replacement, WAITING_FOR_AUTHORITY entry, authority restoration, no manual/authorization fallback, all three frozen Reactor slots being reached, and Reactor 2/3 active prompts appearing on the reloaded GM.
- Clarified recovery UI policy: waiting windows destroyed by a GM browser refresh are not recreated immediately; their Reactors open fresh Broker hosts when they become ACTIVE.

### Revised10 test-harness correction
- Corrected the multiplayer baseline test so distributed UI is validated by the per-client routing aggregator instead of reusing single-client assertions that require all three Broker hosts and all three waiting views on the GM client.
- The underlying Reaction Broker routing behavior is unchanged.

# Changelog

## 0.3.28 - Reaction Broker foundation

- Revised8 multiplayer harness: the baseline routing test now temporarily assigns exactly **Reactor 1** to the selected connected non-GM player while Reactor 2 and Reactor 3 remain GM-routed, so a player does not need to bring a normal character token into the fixture. Original Actor ownership is backed up in AE5E fixture flags and restored automatically after the test or by `clearReactionBrokerTestState()`.
- Revised8 multiplayer harness: captures per-client Reaction Dialog counters before/after the baseline transaction and automatically verifies that the player received exactly one fixture host/active prompt/indicator while the elected GM received exactly the two GM-routed fixture hosts and subsequent active prompt.
- Revised7 live Midi gate hardening: duplicate-arm checks occur before secondary instrumentation/banner output, cleanup is guaranteed, the default live-probe window is approximately ten minutes, and timing assertions no longer treat missing timestamps as a successful wait.
- Revised5 responder audio: ACTIVE Reactor/responder prompts use the established private `assets/audio/ui/notification01.ogg` cue once when the Reactor becomes active; waiting Reactors remain silent.
- Revised6 test hardening: nested interactive tests now prove parent/child chronology (parent enters RESOLVING, child is created/completes, then parent records the nested result and resumes/advances) instead of only checking that a child transaction existed.

- Revised test build 3: corrected the persistent Reaction Broker host for Foundry v14 `DialogV2`, which rejects an empty `buttons` configuration. The host now supplies one inert hidden placeholder button while AE5E continues to render its actual Reaction Broker controls inside the persistent host content.
- Revised test build 3: hardened the interactive Foundry regression so the Broker error-recovery path can no longer report a false PASS. The test now requires three actual host opens/waiting views, at least one active prompt, an active-Reactor indicator acquisition, and explicitly fails on a `broker-error` result before accepting cleanup/result assertions.
- Added the generic **Reaction Broker** subsystem as the reusable foundation for Counterspell and future AE5E reactions. The first normalized trigger vocabulary intentionally contains only `spellCast`.
- Added `ReactionEventAdapter`, translating Midi-QOL `midi-qol.prePreambleComplete` spell workflows into socket-safe AE5E `ReactionContext` snapshots while keeping the external Midi hook name out of reaction items/handlers.
- Added Activity-first reaction registration using `flags.action-effects-5e.reaction` with `enabled`, `trigger`, and `handler`, plus a parent-Item keyed compatibility fallback for Activity data models which do not expose flags directly. Reaction flags identify a registered handler; they never contain executable JavaScript.
- Added `ReactionRegistry`, `ReactionDiscoveryService`, `ReactionOrderingService`, `ReactionTransaction`, `ReactionAuthorityService`, `ReactionDialogService`, and `ReactionBroker` with separate responsibilities for handler registration, candidate discovery, ordering, transaction state, GM arbitration, controller UI, and source workflow orchestration.
- Added the agreed generic Reactor order: shortest rules-facing distance to the Attacker first, then highest Dexterity score, then GM-authoritative d20 tiebreaks. Ordering is calculated once and frozen for the transaction; repeated d20 ties reroll only the still-tied group while preserving earlier roll precedence.
- Added dynamic eligibility revalidation before each frozen Reactor becomes active. A Reactor may be skipped or have its available reaction list changed without reordering the remaining queue. A source-validity callback is also supported so future handlers can stop a stale root opportunity cleanly.
- Added one controller-local Reaction Broker window per reacting token. All initially eligible Reactors receive a window immediately: exactly one is `ACTIVE`, while the others display `Please wait while another actor chooses whether or not to use a reaction`. The same host transitions from waiting to active instead of spawning a replacement dialog.
- The active Broker window lists every actual eligible reaction plus a separate `Do not use a reaction` decision. `Do not use a reaction` is not a reaction type and is never stored in the `ReactionOffer` list. Single-reaction and multi-reaction cases deliberately use the same Broker window and transaction path.
- `Cancel` is transaction-level manual adjudication, not a decline. Cancelling from either an active or waiting Reactor immediately unwinds all participant windows and resumes source control for manual reaction handling. Closing a Broker window with the X is treated the same as Cancel, never as `Do not use a reaction`.
- Integrated Reaction Broker UI with the v0.3.27 selection-indicator service. **Only the currently ACTIVE Reactor receives the animated responder indicator**; waiting/resolving/GM-waiting Reactors never own an indicator lease. Cleanup is guaranteed as transaction views change or close.
- Added nested transaction lineage (`parentTransactionId` / `rootTransactionId`) and a per-token UI view stack so a child reaction can temporarily replace a parent Reaction Broker view and return to it afterward. Synthetic Foundry tests exercise LIFO-capable transaction structure before Counterspell is implemented.
- Added deterministic GM authority election. AE5E records GM browser sessions in a hidden world ledger and chooses the **longest continuously connected active GM** as Reaction Broker arbiter. Foundry's own active GM is used only as the single ledger writer, not as AE5E's reaction-order authority.
- If no GM is connected when an opportunity begins, Reaction Broker automation is bypassed and the originating workflow continues. AE5E never elects a player as temporary reaction authority.
- If the elected primary GM disconnects while another GM remains, authority moves to the next-longest continuously connected GM. If the last GM disappears during an in-flight player-hosted source workflow, the transaction remains pending, the active OK control is disabled, and the agreed warning is shown visibly and as a hover tooltip: `Game Master has been disconnected, waiting for game master to reconnect. Click cancel to proceed with manual reaction selection`. Reconnection re-enables the existing active view; Cancel remains available throughout.
- Kept the resumable async source transaction on the client which owns the originating workflow while requiring every state-changing reaction decision and d20 ordering roll to be authorized by the elected primary GM. This prevents GM arbitration from being confused with dialog ownership and allows player-originated workflows to survive temporary loss of GM authority.
- Added active-Reactor controller disconnect recovery so a lost remote DialogV2 request cannot indefinitely suspend the source workflow. The disconnect is treated as an internal prompt interruption rather than a decline; AE5E revalidates the same frozen Reactor slot and, when a GM remains online, reroutes that Reactor's prompt to the elected GM.
- Added transaction duplicate joining for the same normalized `eventKey`, standardized `selected` / `declined` / `manual` responses, standardized `resume` / `abort` source results, per-reaction result history, and recent transaction diagnostics.
- Added public `api.reactions` registration, processing, authority, diagnostics, ordering-preview, and transaction inspection methods. No real Counterspell handler is shipped in 0.3.28.
- Added a release-critical **live Midi workflow gate probe**. It arms the next real local spell workflow with temporary synthetic offers, records the real `prePreambleComplete` Broker interval, and verifies either that `postPreambleComplete` occurs only after a resume decision or does not occur when the Broker returns `abort`.
- Added cross-client Reaction Broker test cleanup so interrupted tests can close Broker hosts and unregister temporary handlers before a clean rerun.
- Added a Foundry-only Reaction Broker fixture/test suite. It can create an isolated five-token test Scene, installs temporary synthetic reaction handlers across connected clients only for the duration of a test, and exercises Activity flag parsing, event normalization, candidate grouping, distance/Dex/d20 ordering, repeated tie handling, duplicate-event joining, nested lineage, sequential waiting/active UI, single/multiple reaction choices, manual Cancel, indicator cleanup, multiplayer controller routing, GM disconnect/reconnect behavior, and no-GM bypass. Test handlers are unregistered in test cleanup/finally paths and never write reaction metadata onto gameplay Items.

## 0.3.27 - Selection/popup activity indicator

- Added a reusable `SelectionIndicatorService` for workflows which are waiting on a user's popup, destination selector, or other interactive choice.
- Added lease/reference counting: multiple simultaneous waits on the same token share one visual, and closing one wait cannot remove the indicator while another remains active.
- Expanded selection leases with semantic roles: `originator`, `responder`, and `external`. Originator preserves the live-tested green `#18cc46`; responder currently uses temporary amber `#ff9f1c`; recognized external prompts use blue `#2f9bff`. The raw Eskie WebM and fallback Foundry icon are both tinted so the role remains visible when the preferred asset is unavailable.
- Role belongs to each lease rather than permanently to a token. If different roles overlap on one token, AE5E renders one indicator using deterministic priority (`originator` > `responder` > `external`) and returns to the next still-active role without replaying audio when a higher-priority lease ends.
- Added role-specific presentation profiles with independent tint, sound asset, and volume. Originator and responder profiles use the private `notification01.ogg` cue; the external profile remains silent until a distinct asset is supplied.
- Added a conservative `ExternalPromptBridgeService` using Foundry v14's global `renderApplicationV2` hook. It observes foreign ApplicationV2 windows but never guesses token ownership: only a registered adapter that positively identifies an actionable prompt and its Token may create the blue `external` lease. AE5E-owned DialogV2 windows are explicitly marked and excluded.
- Added public `externalPrompts.registerAdapter()`, `unregisterAdapter()`, `trackApplication()`, `clearAll()`, and `getStats()` APIs for future Midi-QOL/CPR/GPS and other module-specific adapters. A tracked ApplicationV2 releases its external lease from the application's native `close` event. No generic DOM observer or blanket "currently controlled token" heuristic is used.
- Added `selection.withIndicator()` for arbitrary asynchronous interactions and `selection.waitForDialog()` for Foundry v14 `DialogV2.wait()` workflows; both guarantee cleanup with `finally`, including button submission, cancel/X close, and thrown errors.
- Added a persistent Sequencer effect attached to the selecting token and broadcast through Sequencer's normal non-local effect path so other connected users viewing the Scene can see that the player is making a choice.
- Finalized live-tested placement at a `0.40` token-footprint corner offset and preferred Eskie scaling at `scaleToObject(0.68)`; the Foundry fallback remains `0.28`. Token artwork scale is ignored and token rotation does not orbit the indicator.
- Preferred animation now uses the raw Eskie file `modules/eskie-effects/assets/UI/Ability_Check/D20/01/UI_Ability_Check_D20_01_Roll_Default_White.webm` instead of the Sequencer database key. This intentionally bypasses Eskie's loop-marker metadata so the persisted WebM loops seamlessly.
- Preferred tint finalized as `#18cc46`. If Eskie Effects is not installed, the service uses Foundry's `icons/vtt-512.png` as a static fallback.
- Added the one-shot selection notification sound `modules/action-effects-5e/assets/audio/ui/notification01.ogg` at Sequencer volume `1`. The sound is restricted with Sequencer `forUsers()` to the user whose client opened the selection wait; other connected users still see the shared indicator but do not hear the notification.
- Notification audio is emitted only when the first lease creates the token's indicator and is never persisted, repeated, or looped. Additional overlapping leases on the same token share the existing indicator without replaying the sound. The synthetic lease-lifecycle regression suppresses audio so the manual dialog test produces only one notification.
- The indicator now uses Sequencer `aboveInterface()` plus a high effect `zIndex` so it is rendered through Foundry's ControlsLayer and can appear above the orange token control/selection outline.
- Sequencer is recommended, not required. If it is unavailable, AE5E logs a warning and the underlying rules workflow continues without the advisory visual.
- Added startup/stale-effect cleanup and per-token cleanup so a closed dialog does not leave a persistent marker behind.
- Added the public `selection` API and constants for preferred asset/tint, fallback asset, scale, placement, and effect name.
- Integrated the shared indicator with the existing interactive Push destination selector; while a player is choosing a Push destination, the marker appears on the Source/acting token and clears when the selection completes or is cancelled. Pull remains automatic and does not show an indicator.
- Added Foundry-only `runSelectionIndicatorTest()` coverage for shared lease behavior, final cleanup, DialogV2 close cleanup, placement/scale inspection, seamless raw-WebM looping, selection-outline layering, asset fallback observation, and multi-user visibility observation. The synthetic lease phase allows Sequencer 4.x persistent-effect initialization to settle before teardown, avoiding a test-only initialization/cleanup race.
- Added Foundry-only `runSelectionIndicatorRolePairTest()` to display green originator and amber responder indicators simultaneously on two controlled tokens, plus `runExternalPromptBridgeTest()` which registers a temporary exact-match adapter and verifies that a simulated foreign ApplicationV2 receives the blue external indicator and cleans up on close.
- Added Foundry-only `runExternalPromptIsolationTest()` for automatic fail-closed coverage: ordinary/unrecognized applications stay inert, tokenless adapter matches are ignored, adapter exceptions are isolated, AE5E-owned dialogs cannot be claimed externally, re-renders cannot duplicate leases, simultaneous recognized prompts on one token share one blue visual, and staged close events preserve/clean up the correct leases. The regression calls the bridge's internal test entry point directly so synthetic applications are never broadcast through the global Foundry hook to unrelated installed modules.

## 0.3.26

- Added relationship-specific physical Grapple-link obstruction geometry.
- Grapple-like relationships now evaluate three independent spatial channels during orbit: Follower body, Grapple-link sweep, and Grapple-link final occupancy.
- Grapple-link creature conflicts are classified relative to the Leader/Grappler while Follower-body conflicts remain relative to the Follower.
- Hostile Grapple-link sweep/final conflicts hard-block the orbit; nonhostile sweep-only conflicts may pass.
- Nonhostile final Grapple-link occupancy uses the existing 3.5-second relationship grace window and restores the previous Follower shell position plus matching Leader rotation if unresolved.
- Added physical movement-wall collision checking for the Grapple link using Foundry v14's movement polygon collision backend.
- Added `linkObstructionPolicy` with Grapple-aware defaults so physical link behavior is not applied to unrelated relationship types.
- Added structured `grappleLink` diagnostics to rotation decisions and public link inspection helpers.
- Added a Foundry-only automated Grapple-link obstruction regression covering hostile final-link blocking, nonhostile final-link grace/rollback, wall blocking, nonhostile sweep-only pass-through, hostile sweep-only blocking, and dual body/link hard-conflict precedence.
- Corrected the Foundry-only sweep-only regression fixture after validation showed the original 0.5x0.5 search footprint could not fit inside the narrow swept-link fan without also touching an endpoint link. The harness now uses a deterministic 0.25x0.25 diagnostic footprint and explicitly verifies initial-link clear, mid-sweep intersection, and final-link clear before exercising production movement.

## 0.3.25 - Generic forced Push/Pull displacement foundation

- Added relationship-independent forced displacement infrastructure for one-shot Push and Pull movement.
- Added `AWAY`, `STRAIGHT_AWAY`, and `STRAIGHT_TOWARD` direction constraints with center-to-center Source/Target semantics and full Target-footprint collision checks. Pull is direct-line only and resolves automatically without a destination selector.
- Added displaced-body wall/environment and relative-creature obstruction. Hostile creature space hard-blocks; nonhostile creature space is traversable; Neutral and Secret remain universally nonhostile through the centralized resolver.
- Added partial-distance resolution so a longer displacement can stop at its last legal step instead of cancelling the entire movement.
- Added generic 3.5-second nonhostile endpoint grace with rollback to the latest clear displacement step, plus immediate cancellation when the conflicting occupant leaves.
- Tagged executed Push/Pull movement as `agency: forced`, `resource: none`, and `pathType: traverse`, with Source/Target, displacement type, direction, and requested/actual distance metadata.
- Added an ephemeral canvas destination selector foundation for clear, soft-conflict, partial, and blocked candidate footprints.
- Added Foundry-only `runDisplacementFoundationTest()` coverage and an interactive `previewDisplacementFromControlledTokens()` smoke test.
- Hardened post-movement settlement after Foundry validation exposed a timing gap: endpoint/grace evaluation now waits for AE5E's `AFTER` movement transaction boundary before reading final displacement state, while retaining the semantic movement context and temporary D&D5e nonhostile-token bypass through that boundary.
- Improved the displacement foundation harness so a failed forced-metadata/soft-entry case prints the exact failed predicates and captured movement transaction.
- Hardened multi-waypoint settlement a second time after Foundry validation showed the logical `AFTER` transaction can precede the Scene TokenDocument reaching the final animated waypoint. Endpoint/grace decisions now wait for the actual Scene document to reach the planned endpoint while retaining the movement context and nonhostile-token bypass, and never infer endpoint arrival from the transaction destination alone.
- Refined the canvas destination selector for Large+ displaced targets: full future footprints remain faintly outlined, while compact click handles are placed on each destination's leading edge/corner rather than its center so one-step choices do not sit on top of the token being moved.
- Finalized Pull semantics as `STRAIGHT_TOWARD` only. Removed free-choice `TOWARD` from the public direction vocabulary; `displacement.pull()` now resolves its direct toward direction automatically and never opens the destination selector.

## 0.3.24 - Relative creature semantics for follower-body obstruction

- Added `RelativeTokenRelationshipService`, a centralized pairwise resolver for creature obstruction. Callers explicitly select the reference creature instead of treating Foundry token disposition as a direct NPC-to-NPC relationship.
- Added geometry-channel identities for `follower-body` and the reserved future `grapple-link` channel. Follower-body obstruction is resolved relative to the Follower; future grapple-link/appendage obstruction is defined to resolve relative to the Leader/Grappler.
- Friendly/Hostile remain pairwise sides: matching Friendly/Friendly or Hostile/Hostile is nonhostile, while Friendly/Hostile is hostile. Neutral and Secret are universal nonhostile overrides regardless of the other participant's disposition.
- Split orbit preflight into environment and creature decisions. AE5E first preserves Foundry wall/surface constraints, then classifies intersecting creature footprints using the follower-body resolver. Hostile body intersections hard-block; nonhostile intersections may proceed.
- When D&D5e token blocking alone would reject a Neutral/Secret or other AE5E-nonhostile body path, AE5E reuses the public movement constraint path with token blocking disabled only after independently confirming that all identified creature conflicts are nonhostile. Walls remain constrained.
- Generalized the existing 3.5-second same-side endpoint grace to **nonhostile endpoint grace**, so Neutral and Secret occupied orbit endpoints now receive the same temporary-overlap/rollback behavior as same-side Friendly/Hostile endpoints.
- Added `nonhostileEndpointPolicy` / `nonhostileEndpointGraceMs` relationship fields while preserving `alliedEndpointPolicy` / `alliedEndpointGraceMs` as persisted compatibility aliases. Runtime diagnostics now expose `pendingNonhostileOverlaps` while retaining `pendingAlliedOverlaps` as a legacy alias.
- Added structured obstruction diagnostics recording geometry channel, reference UUID, blocker UUID, relative relationship, reason code, and whether D&D5e token constraint bypass was required.
- Added public relative-relationship resolver helpers and a Foundry-only `ae5e.tests.runFollowerBodyDispositionMatrix()` regression harness. Before changing the Scene, the harness validates the full 4x4 Friendly/Hostile/Neutral/Secret resolver matrix and confirms `follower-body` uses the Follower while `grapple-link` uses the Leader. It then automates the Leader/Follower/Ally/Enemy/Neutral/Secret fixture, verifies Follower-relative body semantics in eight cases, waits through nonhostile grace, checks rollback/queues, restores the scene on full pass, and leaves a failed fixture visible for inspection.
- Deliberately left physical grapple-link sweep/final-corridor collision for the next development step. v0.3.24 establishes the relationship semantics and diagnostics that validator will consume without changing the validated orbit-shell geometry.

## 0.3.23 - Dynamic grapple geometry and one-step orbit control

- Added `grappleFollower`, a relationship attachment mode whose coordinated translation is derived from the leader/follower token footprints and a planar `coordinationDistance` instead of assuming two 1x1 tokens.
- Added `RelationshipGeometryService`, which generates clockwise square-grid orbit shells from the actual TokenDocument width/height, supports fractional and rectangular footprints, finds current shell positions, plans one-position clockwise/counterclockwise orbit steps, selects rear trailing positions, and validates shell invariants.
- Separated `coordinationDistance` from `breakDistance`. `breakDistance` remains the maximum legal 3D participant separation; `coordinationDistance` is the planar distance band preserved by normal coordinated dragging and orbiting. This supports extended-reach relationships which can be coordinated at 5, 10, 15, or other Scene distance bands while retaining a larger maximum reach.
- External forced movement which remains within `breakDistance` can re-anchor `coordinationDistance` to the participants' new non-zero planar separation. Forced overlap at zero distance is deliberately not persisted as an orbit band; movement beyond `breakDistance` still detaches without snapback.
- Generalized grapple-follow translation for unequal footprints and extended reach. Each expanded leader grid step selects the legal shell position opposite the leader's movement vector, preserving the familiar 1x1 "follower enters the vacated leader square" behavior as a special case.
- Replaced fixed 45-degree orbital quanta with one adjacent shell-position step per qualifying rotation input. The leader's pending rotation is rewritten in `preUpdateToken` to the exact bearing delta represented by that follower step, so larger shells can use variable angles such as 26.565° or 36.87° without visible 45° overshoot/snapback.
- Normalized native Shift+mouse-wheel and Ctrl+mouse-wheel rotation while an active orbit-enabled relationship leader is controlled. Both modifiers request exactly one follower shell position in the native requested direction; Foundry's differing fast/slow rotation magnitudes are retained only as diagnostics and are not used as the number of orbit steps. Outside an active AE5E orbit relationship, Foundry controls remain untouched.
- Added speculative predicted follower/leader state for rapid wheel input. Multiple native updates can be planned ahead but are resolved serially through the same GM-authorized orbit pipeline; any failed step discards later speculative events and restores from exact captured snapshots.
- Preserved `stopGroup` collision rollback, follower artwork rotation suppression, Socketlib authority, allied endpoint grace, relationship-removal cleanup, and exact leader-rotation restoration under the new variable-angle shell geometry.
- Added persisted relationship geometry updates through `relationships.updateGeometry` / `relationships.updateGeometryAsGM` and a `relationshipUpdated` hook. Action Effects 5E now registers nine Socketlib handlers in this build.
- Enforced the geometry invariant that a finite `coordinationDistance` cannot exceed a finite `breakDistance`; invalid creation/update requests are rejected before persistence, and rejected updates leave prior state intact.
- Added development geometry tooling: `inspectRelationshipGeometry`, `inspectOrbitShell`, `validateRelationshipGeometry`, `showOrbitDebug`, `clearOrbitDebug`, `orbitClockwise`, and `orbitCounterclockwise` under `ae5e.tests`.
- The grapple-like test fixture now accepts `{ breakDistance, coordinationDistance }`, uses `grappleFollower`, derives actual token dimensions from the controlled tokens, and rejects obviously inconsistent test bands.
- Added a temporary PIXI orbit-debug overlay which numbers generated shell anchors without creating persistent Scene Drawings, Tiles, Regions, or flags.
- Expanded automated coverage to 61 tests. New regressions cover Tiny-through-Gargantuan-style footprint shells, 5/10/15-foot bands, exact ±360° shell circuits, Shift/Ctrl normalization, rapid predicted rotation input, non-45-degree rollback, unequal-size/extended-reach trailing, forced-movement re-anchoring, zero-distance overlap handling, and all previously validated forced-movement/break-distance behavior.

## 0.3.22 - Forced movement and break-distance relationships

- Added persisted `forcedLeaderMovementPolicy` values `follow` and `independent`. Existing relationships default to `follow`; grapple-like relationships can use `independent` so an external forced displacement of the leader does not automatically drag the follower.
- Activated the persisted `breakDistance` relationship field as an optional maximum participant separation expressed in the Scene grid's distance units. `null` disables automatic separation detachment.
- Added `RelationshipDistance`, which measures gridded participants from the closest occupied grid spaces rather than token centers and delegates diagonal/elevation distance to Foundry v14 `BaseGrid#measurePath`. This keeps Large and larger token footprints compatible with normal reach-style distance checks.
- External forced movement of either participant is allowed to finish at its legitimate destination. If the settled separation exceeds `breakDistance`, AE5E removes the relationship afterward without rolling either token back. If the participants remain in range, the relationship is preserved.
- Forced leader movement using `forcedLeaderMovementPolicy: "independent"` leaves the follower stationary. Normal voluntary leader movement continues to use the existing coordinated trailing behavior.
- Break-distance validation waits for Foundry token animation settlement before reading live TokenDocument positions, preventing stale animated coordinates from preserving a relationship that should have ended.
- Added a GM-authorized `relationships.enforceBreakDistance` Socketlib handler and separation diagnostics in relationship movement stats.
- Added `ae5e.tests.createGrappleMovementTestRelationshipFromControlledTokens()` for a grapple-like test fixture using `adjacentFollower`, independent forced-leader movement, orbiting, follower self-movement lock, and a one-grid-unit break distance.
- Documented the agreed Grapple rules boundary for later item/effect work: Prone alone does not break a grapple; a Grappled+Prone target cannot stand while its Speed remains 0; forced movement breaks the grapple only if the resulting separation exceeds its stored grapple range.
- Expanded automated coverage from 50 to 58 tests, including forced movement in/out of range, no forced-movement rollback, larger-token distance measurement, settled-animation distance validation, and simultaneous participant displacement that remains in range.

## 0.3.21 - Allied orbit endpoint grace

- Added a 3.5-second grace window when an orbiting follower finishes a rotation step in a same-side creature's occupied space.
- Same-side detection is pairwise: Hostile+Hostile and Friendly+Friendly are treated as allied for this purpose; Neutral/Secret and opposing dispositions do not arm the grace timer. This avoids interpreting a token's disposition label in isolation.
- The grace window starts after the follower's orbital movement animation settles. A continued rotation into an open space clears the pending rollback; another same-side occupied endpoint retains the original last-legal anchor and restarts the grace window.
- If the follower remains in the allied occupied endpoint when the timer expires, AE5E administratively restores the follower to the pre-overlap orbit position and restores the leader's exact corresponding pre-overlap rotation.
- Non-orbit translation of either relationship participant cancels the pending overlap state so normal trailing movement supersedes the temporary orbit endpoint.
- Added persisted `alliedEndpointPolicy` (`grace`/`allow`) and `alliedEndpointGraceMs` relationship fields. Existing persisted orbit relationships without these fields use `grace` and 3500 ms at runtime.
- Added rotation diagnostics for `pendingAlliedOverlaps`.
- Added regression coverage for same-side Hostile NPC overlap expiry, continued rotation out of the occupied square, opposing Hostile/Friendly NPC disposition handling, and relationship default persistence.

## 0.3.2 - Atomic partial-movement rollback

- Fixed linked `stopGroup` rollback leaving a follower partially advanced into a wall when Foundry returned that follower's `Scene.moveTokens()` result as `false`.
- Atomic relationship rollback now restores every surviving participant from the pre-move origin snapshot instead of restoring only tokens whose movement result was `true`.
- Preserved rollback movement as administrative, wall-ignoring, automation-suppressed internal movement so restoring a partially constrained token cannot recursively trigger relationship automation.
- Strengthened the partial-movement regression to simulate the leader completing while the follower is physically constrained partway and reported incomplete; both tokens must now be included in the rollback operation and return to their captured origins.

## 0.3.1 - Deterministic blocked-orbit rollback

- Fixed `collisionPolicy: stopGroup` orbital rotation restoring the leader one rotation quantum too far when Foundry v14 exposes the pre-update `TokenDocument.rotation` during asynchronous GM resolution.
- Rotation events now capture the authoritative leader facing immediately before and after each native `updateToken` rotation and carry both snapshots through the GM-authorized Socketlib request.
- GM orbit authorization validates that the captured before/after snapshots agree with the observed signed rotation delta.
- Blocked, failed, and unsupported orbit paths now restore the exact captured pre-update leader rotation instead of reconstructing it from potentially stale document state.
- Preserved the pre-event partial rotation accumulator so a blocked threshold can be retried naturally on a later qualifying increment.
- Added a regression test matching the live Foundry v14.365 stale-document lifecycle that reproduced `270° -> requested 315° -> incorrect 225°`; the leader now restores exactly to `270°`.

## 0.3.0-hotfix.1 - Rotation lifecycle test hotfix

- Fixed Foundry v14.365 `updateToken` rotation tracking to use `changes.rotation`, because the TokenDocument still exposes its pre-update rotation while the hook is running.
- This removes the one-update lag that caused the first 45° leader rotation to be ignored and could make follower orbiting appear to require extra leader rotation.
- Added regression coverage for the live Foundry hook lifecycle and for resuming leader-controlled orbit after manually rotating the follower.
- This is a focused test build; the planned v0.3.1 configuration/override work is not included.


## 0.3.0 - Relationship orbital rotation

- Added a dedicated `RelationshipRotationService` and pure `RelationshipOrbitPlanner` for rotation-driven follower movement.
- Added persisted relationship `rotationPolicy` values `none` and `orbitFollower`; existing relationships without the field remain opt-out, while new test-harness relationships enable orbital rotation.
- Added a narrow libWrapper integration around Foundry v14 `TokenLayer._onMouseWheel`. It only arms when exactly one controlled token is an orbit-enabled AE5E leader and Shift or Control is held; all other wheel handling remains native Foundry behavior.
- Orbital movement is driven by the leader TokenDocument's **actual committed rotation delta**, not mouse-wheel click counts. Signed deltas accumulate at a 45-degree quantum, so native/future rotation increments can vary without changing orbit behavior.
- Initial geometry supports a 1x1 leader and 1x1 follower on square grids. Positive rotation advances `W -> NW -> N -> NE -> E -> SE -> S -> SW -> W`; reverse rotation walks the ring backward. Every orbital waypoint is an explicit checkpoint so multi-step bursts cannot cut across the leader.
- The leader stays in place and retains native facing rotation; only the follower changes position, with follower artwork rotation explicitly disabled.
- Orbit movement is GM-authorized through Socketlib. The GM validates requester ownership, relationship identity, Scene/token state, supported geometry, current leader/follower positions, direction, step count, and observed rotation magnitude before computing the destination itself.
- Orbit follower movement is classified as `agency: passenger`, `resource: none`, `pathType: traverse`, and carries `relationshipOrbit` metadata for later Region/reaction consumers.
- `collisionPolicy: stopGroup` is atomic for orbiting: follower path preflight occurs before movement, and a blocked/failed step restores the exact committed leader rotation delta which crossed the threshold. The pre-event partial accumulator is preserved so the next qualifying increment can retry naturally.
- `collisionPolicy: detach` keeps the leader's native rotation but detaches the relationship if the follower cannot complete the orbit.
- Rotation events are serialized per relationship. Rapid wheel input is converted into one or more full 45-degree ring steps without overlapping follower movement animations.
- Partial orbit accumulation is runtime-only and is reset when control is released, the relationship changes/reindexes, the Scene is readied, either relationship participant translates outside AE5E orbit movement, or the leader receives an unarmed/API/configuration/other-client rotation.
- Hardened `relationships.waitForMovementSettled()` against an already-resolved `movementAnimationPromise` being temporarily retained, and made the public helper wait for relationship rotation work before normal relationship movement settlement.
- Expanded automated coverage from 39 to 45 tests, including ring geometry/direction, 0/360 rotation deltas, actual-delta accumulation, atomic collision rollback plus accumulator preservation, player-to-GM orbit authorization, and retained resolved animation promises.

## 0.2.11 - Selective simultaneous external relationship movement

- Added a narrow libWrapper integration at Foundry v14's public `Scene.moveTokens()` boundary so compatible external/API relationship-leader movement can be upgraded before animation begins.
- The integration is intentionally selective: it acts only on exactly one moved token that is the leader of an active `coordinationPolicy: "coordinated"` relationship and leaves unrelated, follower-only, multi-token, mixed-update, teleport, and explicit `postSync` calls untouched.
- GM external movement now augments the original leader instruction with planned follower instructions and submits the group through the caller's single `Scene.moveTokens()` operation, allowing leader and followers to animate together while preserving the external caller's leader-only result shape.
- Non-GM external movement is coordinated through the existing GM-authorized Socketlib `relationships.moveGroup` handler so a player does not need ownership of the attached follower. If GM handoff fails, the original call is allowed through and the v0.2.10 terminal post-sync path remains the compatibility fallback.
- Added persisted relationship `coordinationPolicy` values `coordinated` and `postSync`; pre-v0.2.11 relationships default to `coordinated` at runtime.
- Preserved teleport `detach` / `follow` / `block` semantics on the existing validated teleport path instead of converting teleports into ordinary trailing movement.
- Coordinated external movement now performs follower path preflight before either token begins moving and retains the existing partial-result rollback defense.
- Added instruction-route normalization for pre-operation `Scene.moveTokens()` data, including partial waypoint coordinates, checkpoints, action, and elevation.
- Added public `relationships.moveGroup()` for future relationship consumers and `relationships.waitForMovementSettled()` for deterministic live tests without arbitrary timeout guesses.
- Added debug-only coordinated-movement diagnostics reporting source, leader, follower count, relationship IDs/modes, path type, method, checkpoints, and elevation change.
- Expanded automated coverage to 39 tests, including simultaneous GM coordination, player-to-GM coordination, recursion prevention, unrelated/post-sync/follower passthrough, teleport/mixed-payload fallback, public group movement, settlement waiting, and preflight-before-movement behavior.

## 0.2.10 - Terminal-subpath external synchronization

- Fixed external/API multi-checkpoint leader movement attempting follower synchronization after the first checkpoint operation instead of after the terminal Foundry movement operation.
- Non-terminal checkpoint legs are now ignored for external follower synchronization; only the terminal operation of the stable `subpathId` can synchronize followers.
- Added full-subpath reconstruction from Foundry movement history plus the terminal operation's passed waypoints, preserving the original route origin and every checkpoint leg.
- External `adjacentFollower` synchronization now receives the complete historical route and ends one planar space behind the leader even when an API route contains one or more explicit checkpoints.
- Primary-GM movement receipts are now terminal-subpath receipts: non-terminal legs do not create synchronization receipts, and the terminal receipt stores the GM-observed full route rather than trusting client-supplied path data.
- Follower teleport detachment follows the same terminal-subpath rule for multi-operation teleports.
- Retained v0.2.9 movement settlement: the terminal operation still waits for both `movement.finished` and `movement.animation.ended` when available before exact live-position validation.
- Added regression coverage for terminal-only synchronization, full route reconstruction across multiple checkpoints, and non-GM full-subpath receipt validation.

## 0.2.9 - Animation-settled external synchronization

- Fixed the remaining external/API follower synchronization race observed during live elevation movement on Foundry 14.365.
- Live timing confirmed `TokenMovementOperation.finished` can resolve while the live TokenDocument and canvas token are still animated at the origin, even though the movement destination is already committed.
- Renamed the internal completion helper to `#awaitMovementSettled()` to reflect the distinction between logical movement completion and reliable final live coordinates.
- External leader synchronization now waits for `movement.finished` and, when available, `movement.animation.ended` before exact-position validation.
- Follower-teleport relationship detachment uses the same settled-movement lifecycle before GM-side validation.
- Synthetic/test callers and movement operations without an animation promise retain the existing next-task/logical-completion fallback.
- Added regression coverage that resolves `movement.finished` while leaving the leader at its origin, then moves the leader to the destination only when `animation.ended` resolves.
- Strengthened follower-teleport coverage to prove relationships remain attached until both movement completion and animation settlement.

## 0.2.8 - Movement completion and elevation-safe trailing

- Fixed external/API leader follower synchronization racing Foundry's movement animation/document state.
- External synchronization now waits for the public `TokenMovementOperation.finished` promise before validating the leader's final position.
- Stable `subpathId` now deduplicates external synchronization across explicit-checkpoint continuation movement IDs.
- External synchronization validates against the final reconstructed route waypoint rather than a current-leg `movement.destination`.
- Fixed `adjacentFollower` treating Foundry's same-x/y elevation interpolation waypoints as additional trailing spaces.
- Consecutive identical planar positions are collapsed while preserving the final elevation plus checkpoint/explicit semantics for that space.
- Pure vertical leader movement preserves the follower's planar offset and applies the elevation delta when `followElevation` is enabled.
- Follower teleport detachment now also waits for movement completion before GM-side validation.
- Added live-regression-style automated coverage for one-square +10 ft movement, delayed movement completion, stable-subpath external continuations, and pure vertical following.

## 0.2.7 - Follower entry-anchor checkpoint

- Fixed `adjacentFollower` movement cutting diagonally toward a later checkpoint when the follower begins beside the leader rather than already on the leader's route.
- The follower's first synthetic trailing waypoint—the leader's vacated origin—is now an explicit Foundry movement checkpoint.
- This makes Foundry complete the follower's entry into the leader's starting square before continuing along the leader's preserved route.
- Existing user-authored leader checkpoints remain unchanged, and the follower still ends one grid step behind the leader.
- Confirmed the v0.2.6 subpath-context fix remains the mechanism for keeping checkpoint continuation stages internal even though raw continuation operations do not retain `actionEffects5e` metadata.
- Added regression coverage for a follower starting diagonally adjacent to the leader, matching the live Foundry 14.365 failure case.

## 0.2.6 - Full-route checkpoints and subpath identity

- Fixed manual multi-waypoint relationship movement collapsing user-authored routes into a direct path after AE5E intercepted the leader.
- Relationship movement now reconstructs Foundry v14 routes from `movement.passed.waypoints` plus `movement.pending.waypoints`, preserving explicit checkpoints and their declared order.
- Added duplicate-seam normalization so a waypoint repeated at the passed/pending boundary does not create a zero-length segment.
- Added subpath-aware transient movement identity. Foundry may assign a new `movement.id` after an explicit checkpoint while retaining the original instruction ID as `subpathId`; AE5E now resolves internal movement context by either identifier.
- Added `subpathId` to movement transactions for diagnostics and future spatial consumers.
- Prevented checkpoint continuations of AE5E-owned coordinated movement from being mistaken for a new manual leader request.
- Added regression coverage based on live Foundry 14.365 movement data for L-shaped passed/pending routes, explicit checkpoint preservation, and movement-ID changes across a stable subpath.

## 0.2.5 - Trailing followers and symmetric teleport breaks

- Removed the deprecated `DatabaseUpdateOperation#teleport` prototype read that produced a Foundry v14 compatibility warning and is scheduled for removal in v15.
- Teleport classification now relies on AE5E metadata, an explicit own caller property when present, movement method semantics, and Foundry movement action configuration such as `blink.teleport`.
- Added follower-side teleport escape: a follower teleport bypasses the normal independent-movement lock and removes the follower relationship after the completed teleport is GM-validated.
- Added primary-GM movement receipts for all relationship participants, not leaders only, so non-GM follower teleports can be verified without trusting client-supplied coordinates or semantics.
- Added `queuedFollowerDetaches` and `indexedReceiptTokens` relationship-movement diagnostics.
- Suppressed the generic unsafe-sync warning for an external leader teleport that intentionally uses `teleportPolicy: detach`.
- Implemented true `adjacentFollower` trailing movement. For leader path `L0 -> L1 -> L2`, the follower path is `L0 -> L1`, so a one-square leader move places the follower in the leader's starting square. On a gridded Scene, declared path segments are expanded with Foundry's public grid `getDirectPath()` API so long drags still end one grid space behind.
- Kept `rigidOffset` behavior unchanged for relationships which should mirror leader movement.
- Kept `teleportPolicy: follow` fixed-offset even for `adjacentFollower`; teleporting together does not use the trailing path.
- Updated the test harness to create `adjacentFollower` relationships.
- Expanded the automated suite to 19 tests, including deprecated-accessor protection, trailing-path planning, GM follower-teleport detachment, and non-GM movement-receipt validation.

## 0.2.4 - Explicit terminal movement checkpoints

- Fixed coordinated `Scene.moveTokens()` operations resolving `false` in Foundry 14.365 when Action Effects 5E-generated terminal waypoints omitted an explicit checkpoint.
- Leader and follower paths now force only the terminal generated waypoint to `checkpoint: true`; existing intermediate checkpoint state is preserved.
- External follower synchronization uses the same terminal-checkpoint normalization.
- Partial-movement rollback destinations now explicitly include `checkpoint: true`.
- Deliberately did not inject `action` or `level`; live matrix testing showed neither field affected the failure.
- Strengthened movement-boundary tests so every generated `Scene.moveTokens()` instruction must have a valid 16-character movement ID and an explicit terminal checkpoint.
- Added a regression test proving checkpoint normalization does not add unrelated `action` or `level` fields.

## 0.2.3 - Deferred replacement movement

- Fixed manual coordinated movement being started from a microtask while Foundry was still unwinding the `preMoveToken` workflow that Action Effects 5E had just cancelled.
- Replacement `Scene.moveTokens()` execution now yields to the next event-loop task before starting the coordinated group update.
- External follower synchronization also yields to the next task so it does not begin a second token movement update from inside the completed `moveToken` hook stack.
- Added a regression test that fails if the replacement request executes after only a microtask turn instead of waiting for the next task.
- Added explicit failed-token result logging when Foundry reports an incomplete coordinated movement, making future live failures identify the rejected token IDs directly.

## 0.2.2 - Foundry-valid movement IDs

- Fixed `Scene.moveTokens()` rejecting Action Effects 5E-generated movement IDs with `Invalid movement ID`.
- Internal movement instructions now use Foundry-valid 16-character alphanumeric UIDs generated by `foundry.utils.randomID(16)`.
- Kept Action Effects semantic identity in the transient movement-context map instead of encoding module names into Foundry's movement ID field.
- Strengthened the coordinated-movement regression test so the fake `Scene.moveTokens()` boundary rejects invalid movement IDs the same way live Foundry does.
- Added assertions that every generated leader and follower movement ID is a unique 16-character alphanumeric UID.

## 0.2.1 - Internal movement identity fix

- Fixed coordinated leader/follower movement being rejected by Action Effects 5E's own `preMoveToken` relationship handler.
- Added explicit Foundry v14 movement IDs to every internally generated token movement instruction.
- Added a transient movement-context registry so semantic metadata survives even when custom `Scene.moveTokens` operation options are not exposed unchanged to `preMoveToken`.
- Internal follower movement is again classified as passenger movement without relying on third-party or private APIs.
- Rollback and external follower synchronization now use the same explicit movement identity mechanism.
- Failed coordinated movement results now include the specific token IDs which Foundry reported as incomplete.
- Added a regression test reproducing the live v0.2.0 metadata-loss condition.
- Raised the minimum Foundry build for this development release to 14.357, where explicit movement IDs for `Scene.moveTokens` instructions were added; verified against build 14.365.

## 0.2.0 — Coordinated token relationships

- Added an original rules-aware relationship movement service.
- Added token-indexed pre-movement consumers only for active relationship participants.
- Added GM-authorized coordinated movement through one `Scene.moveTokens()` operation.
- Added waypoint sanitization, origin validation, request deduplication, and active-leader locks.
- Added rigid-offset X/Y and elevation following.
- Added manual follower movement blocking while permitting API-driven external movement.
- Added post-operation follower synchronization for external API, undo, and paste leader movement so other modules retain their original successful movement result.
- Added recursion-safe relationship movement metadata.
- Added best-effort follower wall/surface preflight through Foundry's public constraint API.
- Added group rollback when Foundry reports partial movement failure.
- Added teleport policies: detach, follow, and block.
- Added collision policies: stop group and detach.
- Rejected relationship chains and cycles for this milestone.
- Added relationship movement statistics and live inspection utilities.
- Expanded the automated suite to twelve tests.

## 0.1.1 — Socketlib initialization fix

- Registered the `socketlib.ready` listener during module script evaluation rather than inside the Foundry `init` callback.
- Added a defensive Socketlib API availability check.
- Corrected the movement-service startup log to include its stop listener.

## 0.1.0 — Foundation

- Added Foundry v14+ module manifest.
- Declared D&D5e, Midi-QOL, DAE, Socketlib, and libWrapper requirements.
- Added startup dependency validation.
- Added CPR and GPS compatibility detection.
- Added world overlap-policy setting and client diagnostics settings.
- Added immutable movement transaction model.
- Added indexed movement consumer registry.
- Added low-overhead centralized movement hook service.
- Added persistent Scene-based token relationship registry.
- Added Socketlib-authorized relationship creation and removal.
- Added test harness and syntax-check script.

### 0.3.28 revised4 test-build adjustment
- Waiting Reaction Broker windows now show a single **Decline** action during normal GM-authorized operation; doing nothing continues to wait.
- A waiting Decline is GM-authorized, records an explicit decline, closes only that Reactor's Broker window, preserves the frozen queue/history, and skips that Reactor when its turn would arrive.
- If all GM authority is lost, waiting Decline is disabled and **Cancel** becomes available for the separate transaction-level manual-adjudication path.

### 0.3.28 revised5 test-build adjustment
- Restored the established private `notification01.ogg` cue for Reaction Broker ACTIVE Reactors by assigning the responder selection-indicator role the same one-shot notification sound used by the 0.3.27 originator role.
- The responder visual remains role-specific/amber; only the audio cue is shared.
- Strengthened the interactive Reaction Broker harness so every acquired ACTIVE-Reactor indicator must also request its private notification sound; missing Reaction Broker audio can no longer pass the interactive test silently.

### 0.3.28 revised7 test-build adjustment
- Hardened the live Midi workflow-gate harness after an accidental duplicate-arm test exposed misleading instrumentation. A second arm attempt is now rejected **before** temporary handlers/hooks are installed or an incorrect mode banner is printed.
- Wrapped live-gate instrumentation in guaranteed cleanup so an arm-time exception cannot leak the temporary `midi-qol.postPreambleComplete` observer or synthetic reaction handlers.
- Increased the live gate's default arm window from 2 minutes to 10 minutes and prints the remaining test window in the console/notification, making chat-guided Foundry validation less likely to expire before the probe spell is used.
- Tightened `brokerActuallyWaited` so a timed-out/unstarted probe can no longer appear to pass that individual assertion merely because null timestamps coerce to zero.

- 0.3.28 revised9: Fixed Foundry v14 multiplayer test-fixture ownership replacement.

### v0.4.1 revised3 validation adjustment
- Live Foundry validation proved CAT `setActivity()` changes `workflow.activity` but does not replace an already-running D&D5e Activity instance used by `rollDamage()`.
- SME no longer treats in-flight Activity substitution as the Transmuted Spell damage-type contract. The validated pattern is: choose/stage the damage type before the roll, then at `damageRollComplete` retag the evaluated Midi damage rolls with `retagDamageRollsPreservingResults()` so the same roll objects, totals, formulas, and dice results are preserved.
- The live SME test now validates this two-phase contract and retains conditional `preTargetDamageApplication` coverage.

### 0.4.1.3 revised4 — mandatory-save success validation
- Kept CAT saved-cast-data handling native after the updated CAT build resolved the prior live metadata issue.
- Made ongoing granted-Item cleanup idempotent against concurrent/socketed deletion races.
- Added a deterministic live mandatory-save success test using a temporary DC -100 fixture so CAT/D&D5e/Midi must return the real success branch.
- Added assertions for live workflow DC propagation, parent ActiveEffect removal, and child granted-Item cleanup on success.
