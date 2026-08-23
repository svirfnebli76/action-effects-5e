## 0.4.1.13 — Remote choice prompt infrastructure

- Added generic `ae5e.prompts.choose()` infrastructure for small controller-owned decisions such as a Shove defender choosing Strength or Dexterity. Callers provide Actor/token context plus plain choice descriptors; the API returns only the selected choice id or `null`.
- Added centralized controller resolution. AE5E prefers an active non-GM owner of the target Actor, falls back to the primary active GM when no player owner is online, and can reroute a remote prompt to an active GM if the selected player disconnects while the prompt is open.
- Added the Socketlib handler `prompts.choose`. Live Actor, Token, Workflow, or other document objects are never transported through Socketlib; only UUIDs and JSON-serializable prompt data cross the boundary.
- Integrated the existing semantic `responder` selection-indicator role so the target token carries the amber `#ff9f1c` indicator for the full DialogV2 lifetime with guaranteed cleanup.
- Routed the existing selection-indicator Sequencer notification sound through Foundry's `interface` audio channel via `.audioChannel("interface")`.
- Added `ae5e.prompts.resolveController()`, `validateChoiceRequest()`, and `getStats()` diagnostics, plus Foundry foundation/interactive test entry points.
- Added four focused Node regressions covering request validation, active-player-owner routing, offline-owner GM fallback, socket-safe result transport, responder indicator ownership, and mid-prompt disconnect rerouting. The repository development suite is **110/110 PASS**.
- No compendium contents were changed, regenerated, migrated, or overwritten in this release.

## 0.4.1.12 — Transient Automated Animations workflow ownership

- Retained AE5E's existing Automated Animations 7.0.22+ arbitration integration: synchronous ownership still sets `clonedData.stopWorkflow` immediately, while ownership requiring asynchronous resolution continues to use AA's supported `clonedData.deferrals` seam.
- Added transient, workflow-scoped animation ownership for one-shot Item/Activity execution. Item macros can now suppress AA for a specific Activity without writing persistent Item or Active Effect flags.
- Added `ae5e.animationOwnership.withAutomatedAnimationsSuppressed(scope, callback)` as the preferred scoped API, plus lower-level claim/release helpers and active-claim diagnostics. Claims are always released by the scoped helper in `finally`, including when the wrapped Activity throws or rejects.
- Transient matching is Activity-specific when an Activity is supplied. Stable Item and Activity UUID/ID identity is used so sibling Activities on the same Item (for example Attack, Shove, and Grapple) are not broadly suppressed.
- Extended AA workflow-context handling so Item/Activity identity can be resolved from the cloned workflow payload or AA's secondary animation context. AA diagnostics now annotate transient claim id/reason without mutating the source Item/Activity.
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
