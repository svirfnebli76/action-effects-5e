## v0.4.2.4 CAT metadata authoring UI boundary

`CatMetadataContextMenuService` wraps Foundry v14's Compendium entry context-option provider and adds a GM-only `Edit Item Version` action only for the explicit `CAT_PUBLIC_AUTOMATION_PACK_IDS` allowlist. It delegates all writes to `CatMetadataAuthoringService`; the UI does not own validation or CAT metadata semantics. Authoring can update `system.identifier`, `system.source.rules`, `flags.cat.automation.source`, and `flags.cat.automation.version`, while Item name/type remain read-only. Locked compendiums are temporarily unlocked by the authoring service and restored to their prior lock state. After a successful save, `CatAutomationRegistry.refreshPublicCompendiums()` re-evaluates the public pack gate and refreshes CAT registrations without an AE5E module release.

## v0.4.2.3 CAT public-registration boundary

`CatAutomationRegistry` is now the permanent CAT publication boundary. It still initializes once during AE5E `init` and waits for CAT's `catReady`, but after source registration it evaluates only `CAT_PUBLIC_AUTOMATION_PACK_IDS`. Internal packs never enter this path.

Publication is deliberately **pack-atomic and fail-closed**. Before calling CAT's public `registerAutomationCompendium()` API, AE5E indexes the non-empty candidate pack for identifier, ruleset, Item type, CAT source, and CAT automation version. Every Item must be fully authored and its version must pass AE5E's SemVer validator. If even one Item is incomplete, the entire pack is deferred and CAT is not called for that pack. This avoids CAT's normal missing-version fallback of `"0"` and preserves the accepted canonical-Item-as-version-authority design. Empty public packs are skipped without error.

This makes rollout incremental without weakening metadata discipline: once every Item in a public pack is authored, the next Foundry reload automatically publishes that pack with versions read directly from the canonical Items. The current authoritative Level 2 pack qualifies because Misty Step is stamped as `action-effects-5e` / `1.0.0`; other unfinished public packs remain visible in registration diagnostics as deferred.

# Action Effects 5E architecture

## v0.4.2.2 CAT metadata authoring boundary

AE5E treats CAT automation source/version metadata as canonical Item authoring data, not module-version data. The production writer is `ae5e.authoring.cat.setMetadata()`. It is GM-only, requires valid `system.identifier`, `system.source.rules` (`2014` or `2024`), Item `type`, and strict SemVer, writes only `flags.cat.automation.source` plus `flags.cat.automation.version`, and refuses to replace foreign CAT ownership.

The read-only audit layer (`auditItem`, `auditPack`, `auditPublicPacks`) uses an explicit public-pack allowlist. Spell packs and Actions - Common are eligible; AE5E Administrative is explicitly excluded. This separation is intentional so later CAT compendium registration can reuse the same allowlist without accidentally publishing internal helper/template Items. v0.4.2.2 does not yet register those public packs with CAT and does not migrate existing compendium Items.

## Startup lifecycle

1. `SocketService` is initialized before Foundry `init` so Socketlib readiness cannot be missed.
2. `init` registers settings and publishes the API object.
3. `setup` refreshes compatibility state.
4. `ready` validates required dependencies, loads persisted relationships, initializes movement/relationship/displacement services plus the selection-indicator service, then emits `action-effects-5e.ready`.

## v0.4.1 Spell Modifier Engine

SME is a generic orchestration layer between spell-interacting feature declarations and the live Midi/D&D5e workflow. It does not embed feature names into spells and it does not make CAT the rules engine.

### Responsibility split

- **Midi-QOL/D&D5e** owns the actual spell workflow, target/save/damage sequence, and native rolls/application.
- **SME event adapter** normalizes changing/raw Midi hook names into seven stable AE5E semantic phases.
- **SME registry** owns programmatic modifier-handler definitions.
- **SME discovery** scans only the caster Actor, embedded Items, and ActiveEffects for declarative `flags.action-effects-5e.spellModifier` registrations. It does not canvas-scan unrelated documents.
- **SME choice service** aggregates all optional opportunities discovered at one phase into one controller-routed DialogV2 and reuses the AE5E selection-indicator lease.
- **SpellModifierSession** owns one cast's decisions/applications/errors/conflicts/rollback stack.
- **CatSpellAdapter** supplies characterized utility primitives when available. Feature handlers receive those utilities through `SpellModifierContext`; direct CAT calls are outside the SME contract.

### Semantic lifecycle

The normalized phase vocabulary is `preTargeting`, `targetingComplete`, `savesComplete`, `beforeDamageRoll`, `damageRollComplete`, `beforeDamageApplication`, and `workflowComplete`. The adapter currently maps those to the validated Midi V2/premades hooks, and duplicate damage-roll-complete/workflow-complete hook surfaces are reduced by the session event-key de-duplication layer. In Midi 14.0.11 the `preDamageRoll` hook is asynchronously awaited immediately before the damage roll, making SME `beforeDamageRoll` the validated boundary for damage Activity replacement that must govern the imminent D&D5e roll. `beforeDamageApplication` is keyed per target so each target may legitimately run that phase once, but the underlying Midi `preTargetDamageApplication` hook is settings/outcome dependent and is not assumed to fire in every workflow.

Only the local workflow coordinator processes a spell. An explicit active `workflow.userId` wins; otherwise the first active non-GM Actor owner is used; otherwise the primary GM is the coordinator. Other connected clients observe the normal Foundry/Midi workflow but do not independently execute SME modifiers.

### Registry and declarative discovery

A registered modifier declares its semantic phases, automatic/optional mode, priority, optional conflict group, once-per-cast behavior, capability requirements, eligibility callback, optional runtime option generator, apply callback, and failure policy. Discovery declarations contain the handler ID plus source-specific overrides such as label, mode, priority, conflict group, phases, and once-per-cast behavior.

A single handler may return multiple runtime options. Unless `allowMultipleOptions` is explicitly enabled, SME assigns those options one selection group so choosing one excludes its siblings. Explicit conflict groups work across separate modifier sources. Successful applications mark the session immediately so later phases cannot silently reapply a once-per-cast handler.

Automatic modifiers execute before optional selection at the same semantic phase. The remaining optional opportunities are shown together in one choice transaction. The chooser response is validated again by the engine; UI state is never trusted as the conflict/selection authority.

### Per-cast state and rollback

The live `SpellModifierSession` is AE5E's authoritative transaction state. It is stored in memory against the Midi workflow, not persisted on the Actor or Item. Successful handlers may return a rollback callback; manual/session rollback executes those callbacks in reverse application order. Handler errors fail open by default, preserving the base spell, but a handler may opt into `failurePolicy: "abort"`. A handler may also explicitly return `abort: true`. Aborted, completed, and rolled-back sessions enter bounded recent-session diagnostics.

CAT 0.0.6's characterized `workflowUtils.setWorkflowProperty/getWorkflowProperty` behavior is used only as a workflow-local mirror/interoperability surface. SME writes the serialized session snapshot to `workflow.cat.sme.actionEffects5e`. That state follows the same live workflow through later phases and is naturally isolated from a different cast; `SpellModifierSession` remains authoritative even if CAT is absent.

### CAT utility boundary

`CatSpellAdapter` exposes only characterized CAT 0.0.6 primitives: cast/save/action/damage facts, Activity substitution and damage-modified Activity data, synthetic in-memory Activities/Items, complete Activity execution, the validated roll utility set (`rollDiceSync`, `rollDice`, `getRollsTotal`, `getCriticalFormula`, `addToRoll`, `damageRoll`, `hasDuplicateDie`), and per-target applied-damage helpers (`applyWorkflowDamage`, `modifyDamageAppliedFlat`, `setDamageItemDamage`, `negateDamageItemDamage`). Newer/uncharacterized CAT helpers are not assumed.

CAT `rollUtils.getChangedDamageRoll()` is a special case: its `.evaluate()` is intentional because CAT treats the `damageRoll` pass as mutable/re-rollable and `damageRollComplete` as finalized. AE5E therefore does **not** surface the ambiguous CAT name on `SpellModifierContext`. Handlers that intentionally want a reconstructed/re-evaluated roll call `rebuildChangedDamageRoll()`. Handlers that already have evaluated dice and only need a type metadata change call AE5E `retagDamageRollsPreservingResults()`, which mutates `roll.options.type` and commits the same roll objects with Midi `workflow.setDamageRolls()`. This is the same preserve-results pattern used by CPR Chaos Bolt at `damageRollComplete`. Live Foundry validation additionally established that CAT `setActivity()` updates `workflow.activity` but does not replace the already-running D&D5e Activity instance whose `rollDamage()` method is executing. Therefore a Transmuted Spell-style feature should choose/stage the intended type before damage is rolled, then call preserve-results retagging at SME `damageRollComplete`; in-flight Activity substitution is not the damage-type contract.

The per-target Midi hook supplies `{ item, workflow, damageItem }`; the adapter normalizes that canonical `damageItem` into `SpellModifierContext.damageItem` and retains `ditem` only as a backward-compatible alias for CAT/older helper code.

Handlers list required capability names. Beginning with v0.4.2.1 CAT 0.0.8+ is required, but capability checks remain fail-closed: if a required utility is unexpectedly absent, discovery omits that handler rather than partially executing it. Cast-level and save-DC facts retain narrow AE5E fallbacks for diagnostics/eligibility; mutating utilities fail explicitly if a handler calls one without the required capability. The required CAT 0.0.8 line includes the corrected `documentUtils.getSavedCastData()` behavior; AE5E keeps its narrow fallback for defensive diagnostics rather than depending on a second state model.

### v0.4.1 scope boundary

This release builds the reusable engine and live integration seam. It deliberately does not encode individual feat/metamagic/item names in SME core and does not attempt to reproduce every feature's resource-consumption policy. Individual features will be added as registered SME consumers and can use their own validated resource logic until a genuinely generic resource abstraction is justified. The finalized v0.3.30 movement, displacement, relationship, Shove, selection-indicator, and Reaction Broker architectures remain independent and unchanged.

## v0.3.30 CAT movement interoperability

CAT is an execution/permission integration, not AE5E's rules engine. The boundary is deliberately bidirectional and asymmetric.

### AE5E → CAT execution

`CatMovementAdapter` is the only CAT-facing movement facade. For eligible single-token movement it calls CAT `tokenUtils.moveToken()` when CAT is active; otherwise it uses native `TokenDocument.move()`. A CAT call that throws is never automatically retried natively because the token may already have moved partway.

Forced Push/Pull remains fully planned by AE5E. `DisplacementService` still determines semantic direction, complete-token geometry, hard/soft occupancy, partial distance, nonhostile grace, source/target metadata, and the movement transaction. Only the final Token execution call is delegated to the adapter.

AE5E group relationship movement deliberately remains on the existing coordinated `Scene.moveTokens()` path. That code requires one multi-token operation, pre-operation snapshots, complete-group rollback, follower/passenger accounting, and relationship-specific obstruction semantics; CAT's single-token helper does not replace those responsibilities.

### Movement-action ownership

CAT 0.0.6 defines `catForce` with `measure: false`. Live characterization showed that it moves successfully but produces zero measured distance and zero cost. AE5E v0.3.29 requires a different semantic shape for generated forced/passenger movement: **real measured traverse distance with zero resource cost**. Therefore `action-effects-5e.no-cost` remains authoritative and is passed through CAT unchanged.

This separation is intentional:

- CAT may execute/authorize the Token move;
- Foundry/D&D5e remains the native movement-history ledger;
- AE5E selects the movement action which expresses its resource policy; and
- AE5E remains authoritative for higher-level movement semantics.

### CAT → AE5E semantic recognition

`MovementService` asks the CAT adapter to enrich raw movement operations before constructing `MovementTransaction`. CAT's unique `catForce` action is sufficient evidence to classify the operation as forced/no-resource and to mark `interoperabilityProvider: "cat"`. This lets relationship/reaction consumers distinguish external forced movement from voluntary movement even when the external caller did not know AE5E's metadata schema.

The adapter fails closed on information CAT does not carry. It does **not** infer a Source token, Push versus Pull, displacement direction, requested distance, or an AE5E relationship. Normal `walk` actions are not marked CAT-origin because CAT ultimately delegates them into Foundry's ordinary movement pipeline and no reliable provenance remains.

### v0.4.2.1 CAT automation-provider foundation

CAT is a required AE5E dependency beginning with the v0.4.2 branch. AE5E still owns its runtime semantics and services; CAT is the standardized provider-registration, Item installation/update, and future per-Item configuration layer. `CatAutomationRegistry` owns the startup boundary so individual Items and runtime services never need to manage CAT's `catReady` timing themselves.

The registry is initialized once during AE5E `init`, subscribes once to CAT's `catReady` hook, and registers only the source display name `Action Effects 5E` through CAT's public API. v0.4.2.1 deliberately registers no Item automation and performs no compendium mutation. Public diagnostics are exposed under `ae5e.interoperability.cat.registration`; CAT's internal automation map is consulted only for diagnostics/acceptance verification, not as the registration mechanism.

Future v0.4.2 stages can add explicitly allowlisted public automation Items/compendiums and CAT configuration schemas behind this boundary while keeping administrative/support packs private.

### v0.4.1.8 CAT teleport lifecycle adapter

CAT's teleport lifecycle is explicit even though its physical Foundry movement is currently the ordinary `displace` action. `CatMovementAdapter` therefore wraps only `cat.lib.Events.MovementEvent.prototype.run`, records successful `preTeleport` semantics, correlates the token and destination to the following Foundry movement, and clears the temporary context at `postTeleport`. A canceled pre-event never creates a teleport context, and a destination mismatch never converts an unrelated `displace` movement. Once a Foundry movement ID has been matched, its classification is retained across both movement-hook phases.

A correlated move is translated into the already-existing AE5E teleport vocabulary (`pathType: teleport`, `resource: none`, `movementMode: teleport`, plus CAT provenance and the actual native movement action). The lifecycle does not reveal whether the creature willingly teleported, so AE5E leaves `agency` unknown unless richer metadata was already supplied. No Grapple, displacement, restriction, or accounting algorithm is delegated to CAT.

For a non-GM initiator, CAT may execute the physical move on a GM through CAT's own permission/query mechanism. Before CAT proceeds, AE5E sockets only the temporary plain-data teleport context to active GMs so whichever client receives the movement hook can make the same semantic classification. Existing AE5E relationship authority sockets then process any normal consequence such as teleport detachment; AE5E does not create a second token-movement permission route.

## v0.3.29 native movement-resource accounting

AE5E does not own a second movement allowance ledger. Foundry/D&D5e `TokenDocument.movementHistory` is the sole source of truth for movement cost already consumed. `MovementTransaction` remains a semantic event model (agency, resource, source, relationship, displacement, path type, etc.), and now includes a lightweight snapshot/summary of that native history for consumers that need to reason about movement without maintaining another counter.

AE5E registers a hidden `action-effects-5e.no-cost` Token movement action during `init`. It is `measure: true`, cannot be selected through the normal movement UI, and exposes a final movement-cost function that always returns 0. The startup descriptor supplies the required icon and deliberately remains mutable so Foundry v14 can normalize it in place into the final movement-action configuration. This distinction is intentional: forced/follower/passenger/rollback paths still need normal spatial distance and traversal semantics, but they must not spend the moved Token's ordinary movement resource.

Accounting ownership rules are:

- **Normal voluntary Leader movement:** preserve Foundry/D&D5e's original movement action and native cost.
- **Voluntary Grapple Leader drag:** when at least one active carried relationship uses the Grapple movement-cost policy, wrap the Leader's native action in a temporary final-cost modifier that returns `nativeCost * 2`. This is the project's chosen gameplay policy for dragging a grappled target. Multiple grapple followers do not stack the multiplier.
- **Relationship Follower/passenger movement:** measured, native cost 0. The established trailing/vacated-space route is unchanged.
- **Forced Push/Pull displacement:** measured, native cost 0; existing forced-movement semantic metadata is preserved. Forced Leader movement does not receive the Grapple surcharge.
- **Orbit Follower movement:** measured, native cost 0 for the Follower. A Grapple orbit additionally spends the measured shell-step distance on the Leader through the non-positional movement-spend service.
- **AE5E rollback/reposition movement:** native cost 0 and semantically administrative. Any synthetic Grapple orbit spend owned by a reverted orbit is refunded by receipt.
- **Teleport:** preserve teleport movement-action semantics rather than converting the path to an ordinary traverse action; Grapple drag cost does not apply.

The movement accounting service exposes a final-cost modifier action API. A modifier wraps the selected base movement action's native cost function and then returns the final segment cost. v0.4.1.17 uses that layer for Grapple dragging so terrain, diagonal rules, Regions, and other native Foundry/D&D5e cost contributions are measured first and the final native cost is then doubled. Orbital movement does not fake Leader translation: it uses AE5E's GM-authoritative non-positional movement ledger and an exact rollback receipt.

v0.4.1.18 also makes the generated Follower instruction explicitly passenger-safe at the native constraint layer. The Follower bypasses its own movement-cost budget, while creature blocking is preflighted by AE5E rather than delegated blindly to D&D5e's token-aware `constrainMovementPath()`. The relationship Leader is excluded from that Follower-body check because it vacates the trailing square in the same coordinated operation; other hostile bodies and occupied non-participant endpoints remain blocking. These bypasses apply only to the generated Follower instruction, never to the Leader's movement.

### v0.4.1.21 Grapple orbit/ledger integrity boundary

v0.4.1.21 adds a second ledger-integrity boundary immediately before coordinated Grapple translation. The relationship movement service invokes the GM-authoritative `MovementSpendService.reconcileLedgerAsAuthority()` with strict inactive cleanup before voluntary movement-resource Grapple group movement. Active native recording preserves legitimate spent movement during stale re-anchoring; inactive recording clears any non-empty history, including an already-aligned synthetic entry that may have been created by v0.4.1.20 orbit behavior.

Orbit cost accounting now follows the same Foundry recording predicate. The Follower shell step is always generated as no-cost passenger movement, while a measured Leader movement spend is written only when the Leader's `TokenDocument._shouldRecordMovementHistory()` reports active recording. This prevents out-of-combat orbital repositioning from creating Leader ledger entries.

The wheel adapter no longer predicts and queues later shell steps. An accepted orbit input sets a per-relationship local input lock before the Token rotation commit; additional Shift/Ctrl-wheel events are cancelled while that lock is held. The lock releases only after the socketed GM orbit operation and local Follower animation settle (or after failure/rollback). Therefore every accepted wheel event replans from authoritative live positions.

v0.4.1.20 adds two Grapple-specific integrity guards around that coordinated path. Relationship creation first waits for any live Leader movement animation to settle and validates the endpoint of native `movementHistory` against the authoritative Token position. A stale ledger is repaired before the relationship is persisted: active-turn movement cost is preserved as a same-position AE5E spend at the real Token position, while stale history outside active recording is cleared. Reconciliation is verified and Grapple creation fails closed on repair failure; AE5E does not rewrite a later `pathType: teleport` back to traverse.

Player-originated Grapple translation also uses a per-Leader local in-flight lock. Once AE5E cancels a native manual movement and schedules its GM-authoritative replacement, further manual inputs for that same grappler are cancelled until the entire `relationships.moveGroup` request returns after Leader/Follower animation settlement. Inputs are deliberately not queued or rebased. The lock is Grapple-only and per Leader; unrelated Tokens and non-Grapple relationships retain their existing movement behavior. The GM socket handler independently returns structured `leader-busy` / `stale-origin` results as a final concurrency guard instead of throwing expected timing races through Socketlib.

## Relationship state

Relationships are persisted on the Scene under the Action Effects 5E namespace and indexed by leader/follower token UUID. The generic layer stores movement semantics without embedding the D&D Grapple check itself.

Important geometry fields are:

- `attachmentMode`: movement strategy. v0.3.23 adds `grappleFollower` while retaining `adjacentFollower`, `rigidOffset`, `passenger`, and `anchoredFollower`.
- `breakDistance`: maximum legal relationship separation in Scene distance units. `null` disables automatic separation detachment.
- `coordinationDistance`: current planar band preserved by coordinated Grapple-style translation/orbit.
- `forcedLeaderMovementPolicy`: `follow` or `independent`.
- `rotationPolicy`: `none` or `orbitFollower`.
- `movementCostPolicy`: `none` or `grapple`. v0.4.1.17 defaults real `GRAPPLE` relationships and `grappleFollower` attachments to `grapple`; missing policy fields on older persisted Grapple relationships are inferred at runtime for compatibility.
- `collisionPolicy`: `stopGroup` or `detach`.
- `nonhostileEndpointPolicy` / `nonhostileEndpointGraceMs`: terminal nonhostile orbit-overlap behavior. The former `alliedEndpointPolicy` / `alliedEndpointGraceMs` names remain persisted compatibility aliases during the v0.3.x migration.

`breakDistance` and `coordinationDistance` intentionally differ. Example: a 10-foot reach grapple started adjacent may use `breakDistance: 10` and `coordinationDistance: 5`; one started at the outer reach band may use 10/10.

When both are finite, `coordinationDistance` may not exceed `breakDistance`; relationship creation or geometry-update requests that violate this invariant are rejected before Scene persistence.

v0.4.1.16 adds an explicit, opt-in `lifecycle` block to persisted relationships. This is deliberately separate from legacy `sourceUuid` provenance so existing relationships do not accidentally gain document ownership. When `lifecycle.sourceEffect` is present, `sourceUuid` must resolve to an Active Effect; deleting that effect removes the relationship, and relationship removal can delete the source effect. `lifecycle.participantItemGrants` can clone relationship-owned Items onto the leader or follower Actor and persists each clone UUID with the relationship. Grant clones carry `flags.action-effects-5e.relationshipGrant` so cleanup can verify ownership before deleting them. All normal detach paths converge on the same centralized relationship-removal method, so teleport, break-distance, collision/policy detachment, explicit Release actions, and token cleanup share one lifecycle cleanup path.

## Central movement pipeline

`MovementService` owns the Foundry movement hook set. `MovementRegistry` indexes only consumers which can care about a token. Relationship movement uses namespaced transient metadata so AE5E-generated operations are classified, deduplicated, and kept distinct from ordinary player/external movement.

Normal unrelated movement should stay on the Foundry fast path. Relationship handling activates only for indexed participants.

## Coordinated translation

For `grappleFollower`, `RelationshipMovementPlanner` expands a gridded leader route through Foundry's public grid path when available and processes the route one planar step at a time.

For each leader step:

1. derive the movement vector;
2. generate the follower's legal coordination shell around the leader's new footprint;
3. select the shell position opposite the movement vector (rear side), using displacement as a tie-breaker;
4. emit that follower waypoint with the appropriate elevation;
5. continue from the newly planned leader/follower state.

For ordinary 1x1 tokens at a 5-foot band, this reduces to the historically validated rule that the follower enters the leader's vacated square. Larger/smaller/rectangular footprints and longer reach bands use the same geometry rather than separate size-specific branches.

Pure vertical movement preserves the planar follower offset and applies elevation delta when `followElevation` is enabled. Teleport-follow remains fixed-offset rather than using the trailing shell.

## Geometry service

`RelationshipGeometryService` is the pure geometry layer shared by translation, orbit planning, and the test harness.

On a square grid it:

- reads actual token `width`/`height` rather than creature-size labels;
- supports fractional and rectangular footprint anchors;
- calculates token centers/bounds and follower bearing;
- generates the rectangular/Minkowski-style perimeter shell for a requested `coordinationDistance`;
- orders shell anchors clockwise;
- locates the follower on the current shell;
- plans exactly one clockwise/counterclockwise shell step;
- computes the exact directed bearing delta represented by that step;
- selects rear trailing positions;
- validates duplicate anchors, overlap, inverse traversal, and full-circuit angular closure.

For common square footprints the shell counts naturally expand: 1x1 around 1x1 at 5 feet has 8 positions; a 2x2 leader with 1x1 follower at 5 feet has 12; 1x1/1x1 at 10 feet has 16. These are consequences of the generic footprint calculation, not hard-coded size tables.

`RelationshipDistance` remains the rules-facing break-distance service. On gridded Scenes it measures closest occupied grid spaces and delegates diagonal/elevation distance to Foundry's grid measurement. The orbit shell additionally uses actual pixel/token footprint geometry, which is important for fractional tokens.

## Orbit input and exact leader rotation

A narrow libWrapper wrapper around the TokenLayer mouse-wheel handler only arms an orbit gesture when:

- exactly one token is controlled;
- it is the leader of exactly one orbit-enabled AE5E relationship; and
- Shift or Ctrl is held.

The wrapper does not calculate destinations. Foundry then proposes its normal rotation update. On the initiating client, `preUpdateToken` receives that pending update and AE5E:

1. reads only the requested rotation direction;
2. ignores the native fast/slow magnitude for orbit-step count;
3. plans one adjacent follower shell position in that direction;
4. computes that position's exact bearing delta;
5. rewrites the pending `changes.rotation` to `predictedLeaderRotation + angularDelta`;
6. stores authoritative before/after geometry snapshots in namespaced update options.

Thus Shift+wheel and Ctrl+wheel both mean **one follower orbit position** while grappling. The exact leader angle can be 45°, 36.87°, 26.565°, or another value implied by the shell. Outside an active orbit relationship, AE5E does not alter normal Foundry rotation behavior.

This use of `preUpdateToken` follows Foundry's supported pre-update contract: the differential update data may be modified before the workflow commits.

## Rapid orbit input

Wheel updates can arrive before the previous follower animation settles. Each relationship therefore keeps runtime-only predicted state:

- predicted follower position;
- predicted leader rotation;
- queued orbit events;
- generation number.

New wheel input plans from the predicted state, while actual GM-authorized follower movements are drained serially. If any step fails, rollback restores exact snapshots, the generation is reset, and later speculative events are discarded rather than replayed from stale geometry.

## Orbit authorization and rollback

Follower orbit movement is executed through the GM-authorized `relationships.orbitFollower` Socketlib handler. The active GM validates requester ownership, relationship identity, Scene/token state, position snapshots, direction, exact angular delta, current shell, and target shell position, then independently recomputes the step.

For `collisionPolicy: stopGroup`, wall/path failure or incomplete movement restores the exact captured pre-step leader rotation. It never reconstructs prior rotation from asynchronous live state. This preserves the v0.3.1 stale-TokenDocument rollback fix under variable-angle geometry.

Follower artwork rotation is disabled for orbit moves. Only its position changes.

## Relative creature relationships and geometry ownership

`RelativeTokenRelationshipService` resolves a third creature relative to an explicitly supplied reference token. Foundry disposition is treated as a player-relative side indicator rather than a direct NPC-to-NPC relationship graph:

- Friendly relative to Friendly -> nonhostile;
- Hostile relative to Hostile -> nonhostile;
- Friendly relative to Hostile (or the reverse) -> hostile;
- if either participant is Neutral -> nonhostile;
- if either participant is Secret -> nonhostile.

The caller, not the resolver, chooses the reference creature. Geometry channels make that ownership explicit:

- `follower-body`: the Follower is the reference creature because its physical body is traversing/occupying the space;
- `grapple-link`: the Leader/Grappler is the reference creature because the Leader's appendage/link is traversing/occupying the space. This channel is defined in v0.3.24 for the upcoming physical-link validator but is not yet used to block movement.

Transition-level policy will eventually combine these channels with hard-conflict precedence: any hostile body/link conflict rejects the transition; otherwise persistent nonhostile final conflicts may use grace.

## Nonhostile occupied endpoint grace

A successful orbit may end in a nonhostile creature's occupied space. Same-side Friendly/Friendly and Hostile/Hostile pairs are nonhostile, and Neutral/Secret are universal nonhostile overrides.

With `nonhostileEndpointPolicy: grace`, the 3.5-second default timer begins after follower animation settlement. Continued movement into a legal/open position clears the timer. Consecutive nonhostile occupied endpoints retain the original legal anchor and restart the timer. Expiry restores both follower position and the exact matching leader rotation. Translation or relationship removal clears the pending state. Legacy `alliedEndpointPolicy` / `alliedEndpointGraceMs` values remain readable.

For orbit follower-body preflight, AE5E separates wall/surface obstruction from creature obstruction. It preserves Foundry's environment constraint result, classifies intersecting token footprints relative to the Follower, hard-blocks hostile creatures, and only bypasses D&D5e token blocking when every identified creature conflict is nonhostile.


## Selection/popup indicator (0.3.27)

`SelectionIndicatorService` is a rules-agnostic UI service for any AE5E workflow that is waiting for a user's choice. It contains no Grapple, displacement, or Item rules; those systems consume it only when they need to expose an interactive wait.

A caller acquires a lease for the acting token before presenting an interaction and releases it when the interaction finishes. The service indexes lease IDs by Token UUID. The first lease on a token starts one visual; later leases share it. The visual ends only when the final lease is released. `withIndicator()` implements the acquisition/release pair with `try/finally`; `waitForDialog()` applies the same lifecycle around Foundry v14 `foundry.applications.api.DialogV2.wait()`.

Each lease also owns a semantic role. `originator` identifies the creature/user initiating an AE5E choice, `responder` identifies another participant being asked to answer that AE5E action, and `external` is reserved for confidently recognized third-party prompts. Presentation is centralized per role: originator is green `#18cc46` with `notification01.ogg`; responder is currently amber `#ff9f1c` with no assigned audio; external is blue `#2f9bff` with no assigned audio. Distinct responder/external sounds can be added later without changing callers. When roles overlap on one token, one visual is retained and deterministic priority (`originator` > `responder` > `external`) chooses the displayed presentation. Releasing a dominant lease may reveal a still-active lower-priority role without replaying its sound.

Sequencer is an optional/recommended rendering integration rather than a foundation dependency. When active, AE5E creates a named persistent effect attached to the canvas Token. Sequencer's default non-local playback makes the marker visible to other connected users on the Scene. The attachment uses a grid-unit offset of `0.40 × TokenDocument.width` horizontally and `-0.40 × TokenDocument.height` vertically, placing the effect center one tenth of a token footprint inward from the upper-right corner. asset-specific `scaleToObject()` sizing derives the marker from token footprint rather than artwork scale: the preferred Eskie d20 uses `0.68` to compensate for transparent padding in its source canvas, while the Foundry fallback icon uses `0.28`. `bindRotation: false` prevents token rotation from orbiting the UI marker.

The preferred source is Eskie's raw WebM at `modules/eskie-effects/assets/UI/Ability_Check/D20/01/UI_Ability_Check_D20_01_Roll_Default_White.webm`, tinted `#18cc46` by AE5E. AE5E deliberately bypasses the corresponding Sequencer database entry because that entry carries marker metadata which changes persistence/loop behavior; the raw WebM loops seamlessly when persisted. If the `eskie-effects` package is not installed, the service falls back to core `icons/vtt-512.png`. Missing/broken Sequencer rendering is advisory only: it is logged and the underlying workflow continues.

Because this is an interaction-status marker rather than an in-world effect, the Sequencer effect uses `aboveInterface()` with a high effect `zIndex`. Sequencer routes `aboveInterface()` effects into Foundry's `canvas.controls` layer, allowing the marker to render above token control/selection outlines rather than being obscured by them.

All AE5E selection effects share the namespaced effect name `action-effects-5e.selection-indicator`; per-token EffectManager filtering prevents one user's release from ending another token's indicator. Startup GM cleanup removes stale indicators because a DialogV2 cannot remain valid across a reload.

`ExternalPromptBridgeService` is deliberately conservative. It observes Foundry v14 `renderApplicationV2` globally, but does not infer token ownership from current control, dialog text, arbitrary DOM shape, or unknown module data. Registered adapters are ordered by priority and must return a concrete Token/Token UUID before the bridge adopts an application. Adoption creates an `external` lease on the local popup recipient's client and registers a one-shot ApplicationV2 `close` event listener to release it. `selection.waitForDialog()` marks AE5E-owned DialogV2 windows with a namespaced class so external adapters cannot accidentally reclassify them. The public `externalPrompts` facade permits future Midi-QOL, CPR, GPS, or other narrowly-reviewed adapters without coupling the core visual service to those modules.

The v0.3.25+ Push destination selector is the first production consumer. When Push needs a runtime destination choice, `DisplacementService` wraps the existing canvas selector in `selection.withIndicator()` using the Source/acting token. The visual therefore describes who is making the choice, not which Target will be displaced. Pull and Push calls that already provide `directionKey` do not open a selector and do not acquire an indicator lease.

## Generic forced displacement (v0.3.25)

Push/Pull are one-shot displacement operations and do **not** create relationships merely because one token caused another token to move. Persistent state such as Grapple, Tether, Mount, Carry, or Passenger remains a relationship concern. A later item such as a grappling hook can therefore perform a Pull first and create a Tether relationship only if its own rules require persistent linkage afterward.

Responsibility is intentionally split:

- the Item/integration declares `type`, distance, and semantic direction constraint;
- AC5E may pass those semantics when an Automated Conditions feature owns the initiating rule;
- AE5E calculates spatial candidates, evaluates obstruction/occupancy, presents the runtime destination selector, authorizes the movement through the GM, and emits the forced `MovementTransaction`.

The public direction vocabulary is `AWAY`, `STRAIGHT_AWAY`, and `STRAIGHT_TOWARD`. Push accepts `AWAY` or `STRAIGHT_AWAY`. Pull is deliberately `STRAIGHT_TOWARD` only: it is a direct-line operation toward the Source/puller and never presents a destination-choice fan. On square grids, AE5E builds a semantic unit vector from the center of the Source's complete footprint to the center of the Target's complete footprint. `AWAY` accepts each of the eight grid directions whose normalized vector has positive projection on that original semantic vector. The allowed `AWAY` fan is anchored once at displacement start, but each 5-foot step may choose any member of that same fan; AE5E does not recompute the fan after each step. This permits intermediate-angle multi-step endpoints without allowing the shove to curl sideways or back around the Source. `STRAIGHT_*` retains the best-aligned single direction; Pull resolves any exact square-grid alignment tie deterministically so it can remain automatic. This avoids encoding 1x1 assumptions into Shove while keeping Pull mechanically distinct and direct.

For `AWAY`, the supplied distance is a maximum destination distance. AE5E enumerates every unique endpoint reachable in one through N grid steps and keeps only minimum-step routes to each endpoint, so intentional shorter stops are first-class choices rather than partial failures. Equal-length route orderings which reach the same endpoint are evaluated independently against walls and creature occupancy; a legal ordering is preferred when one exists. For backwards compatibility, integrations which explicitly supply a single `directionKey` still request the farthest fixed-ray candidate in that direction.

Direction centers are **not** collision geometry. `MovementObstructionService` translates the Target's complete footprint through each candidate grid step. Environment/walls are checked through Foundry's public constraint pipeline with token blocking excluded for that preflight. Creature occupancy is then classified relative to the displaced Target through `RelativeTokenRelationshipService` using the `displaced-body` geometry channel. Hostile occupancy stops before the offending step; nonhostile occupancy is traversable.

A requested displacement is therefore a maximum distance rather than all-or-nothing movement. If a 10-foot Push has one legal 5-foot step and then encounters a wall or hostile creature, the actual result is 5 feet and is reported as `partial`. An endpoint which remains occupied by a nonhostile creature is temporarily legal and enters generic endpoint grace. If the endpoint occupant moves away during grace, the pending rollback clears immediately. Expiry while the overlap remains returns the Target to the latest clear position reached by that same displacement, skipping earlier traversed positions that were themselves nonhostile-occupied.

D&D5e Full Movement Automation performs token blocking during `findMovementPath` before ordinary constraint options can disable it. While an AE5E displacement is active, AE5E uses the D&D5e occupied-grid-space hook to remove only the exact blocker UUIDs that the independent displaced-body preflight already classified nonhostile. The bypass map exists only for that Target and only for the duration of that movement; hard/environment checks remain authoritative.

Every executed Push/Pull movement is tagged `agency: forced`, `resource: none`, `pathType: traverse`, plus Source/Target and displacement identity/type/direction/requested-vs-actual distance. This allows Grapple, Booming Blade, Regions, opportunity logic, and later effects to distinguish forced movement without prompting users or inferring agency from coordinates.

The on-canvas selector is used for Push operations which require a runtime destination choice. It is ephemeral PIXI state: clear candidates are green, soft endpoint conflicts yellow, partial stops orange, and blocked requested endpoints red. Blocked endpoints remain visible but disabled. For 1x1 targets the destination square itself is clickable. For targets larger than 1x1, adjacent destination footprints overlap heavily, so AE5E renders each full footprint as a faint state-colored ghost and places a smaller bright-green clickable handle on the destination's leading edge/corner. Those handles are independently laid out to remain separated for the normal 2x2/3x3 shove fan. Pull does not invoke the selector; its `STRAIGHT_TOWARD` destination is resolved automatically. No Drawings, Tiles, Regions, Scene flags, or temporary Item/Active Effect documents are created for selection.

## Forced movement and re-anchoring

External forced movement is not treated as coordinated dragging.

- Follower forced movement is allowed even when manual follower self-movement is locked.
- `forcedLeaderMovementPolicy: independent` leaves the follower stationary when the leader is externally forced.
- After movement settles, AE5E evaluates full 3D `breakDistance`.
- If separation exceeds the maximum, the relationship is removed and the successful external movement remains in place.
- If separation remains legal and the movement was forced, AE5E may update `coordinationDistance` to the new non-zero planar separation. This lets a 10-foot-reach grapple move between 5- and 10-foot coordination bands without breaking.
- Zero-distance overlap is deliberately not stored as the new orbit band.

A simultaneous external operation which moves both participants is evaluated from their settled final state, preventing a temporary intermediate separation from breaking an otherwise legal relationship.

## Manual follower movement

When `followerCanSelfMove` is false, manual follower movement methods (dragging, keyboard, HUD, configuration) are rejected in the BEFORE phase. AE5E-internal passenger movement and explicitly classified external forced movement are not mistaken for voluntary follower movement.

## Collision and atomicity

Coordinated `stopGroup` movement preflights follower constraints where possible. If Foundry reports an incomplete linked group movement, rollback restores **every surviving participant** from the pre-operation origin snapshot, because a token reported `false` may already have been constrained partway along its route.

Core token occupancy is not globally converted into an endpoint blocker; rule-specific consequences belong above the generic relationship layer.

## Teleport behavior

Relationships retain explicit `detach`, `follow`, and `block` teleport policies. Teleport-follow uses fixed offset rather than trailing geometry. Follower teleport may bypass the manual self-movement lock and then detach after GM validation according to relationship policy.

## Public/testing APIs

Production-facing helpers include:

- `displacement.request/push/pull/getCandidates`
- `relationships.create/remove/updateGeometry`
- `relationships.getGrantConfig/getLifecycleStats`
- `relationships.moveGroup`
- `relationships.waitForMovementSettled`
- `relationships.resolveRelativeRelationship` / `resolveRelativeRelationshipForGeometry`
- movement consumer registration and operation metadata helpers.

Development geometry helpers under `ae5e.tests` invoke the same real production services:

- configurable grapple fixture creation;
- geometry and shell inspection;
- shell validation;
- temporary orbit overlay;
- direct one-step clockwise/counterclockwise orbit commands;
- the Foundry-only eight-case `runFollowerBodyDispositionMatrix` regression harness;
- `runDisplacementFoundationTest` and the interactive `previewDisplacementFromControlledTokens` selector smoke test.

No test-only alternative movement or orbit math exists.

## Security and coexistence

Player requests which mutate authoritative relationship state are GM-authorized through Socketlib and validated against relationship/token ownership. AE5E uses namespaced flags/options and narrow integrations. CPR and GPS are compatibility targets rather than dependencies; overlapping automation ownership remains a higher-layer concern.

## Current limits

- Dynamic orbit geometry and v0.3.25 Push/Pull destination generation currently require a square Scene grid.
- v0.3.26 adds physical `grapple-link` sweep/final-corridor obstruction using the Leader/Grappler as its relative-relationship reference, while displaced-body obstruction continues to use the displaced/Follower token as reference.
- Push/Pull item adapters (Unarmed Strike/Shove, grappling hooks, spells, etc.) are not bundled in v0.3.25; this build provides the reusable infrastructure they will call.
- Creature-size eligibility, unarmed-strike reach derivation, Grappled/Grappler effects, escape/action economy, movement-resource charging for rotation, and the Prone popup integration belong to later Grapple rules/item work.
- Fractional Tiny-token geometry is supported by the shell generator, but Foundry's occupied-grid-space distance API can collapse some sub-grid separations; live Tiny tests remain important before declaring final Grapple UX semantics.

## Grapple-link geometry (0.3.26)

Grapple-like relationships use three independent geometry channels during orbital movement:

- `follower-body`: full Follower footprint; relative relationship reference is the Follower.
- `grapple-link` sweep: the physical link swept from the prior legal state to the requested state; reference is the Leader/Grappler.
- `grapple-link` final: the physical link at the requested endpoint; reference is the Leader/Grappler.

The link is the exterior portion of the center-to-center ray after clipping it to both token footprints. Third-party creature intersection uses the complete third-party token footprint with a small non-zero link-width tolerance. The transition sweep is sampled at sub-grid intervals so the fan swept by a rotating link is evaluated rather than only its starting/final rays. Movement-wall obstruction uses Foundry v14's `CONFIG.Canvas.polygonBackends.move.testCollision` public collision backend.

Hard conflicts always win. Hostile link sweep/final conflicts and wall intersections reject the orbit. Nonhostile sweep-only conflicts do not block. Nonhostile final-link conflicts share the relationship endpoint grace state and, if unresolved, restore both the prior Follower shell position and corresponding Leader rotation. Physical link handling is controlled by `linkObstructionPolicy`, defaulting to `grapple` only for Grapple / `grappleFollower` relationships and `none` otherwise.


## v0.3.28 Reaction Broker

The Reaction Broker is AE5E's generic event-driven reaction coordinator. It does not poll Actors, Items, effects, or tokens. External workflow events are normalized by a small adapter and only triggers with registered handlers enter discovery. v0.3.28 implements only `spellCast`.

```text
Midi / external workflow event
        ↓
ReactionEventAdapter
        ↓
ReactionContext
        ↓
ReactionBroker
        ↓
Activity reaction discovery
        ↓
Frozen Reactor order
(distance → Dexterity → GM d20)
        ↓
GM-authorized sequential transaction
        ↓
controller-local Reaction Broker UI
        ↓
handler result: resume / abort
```

### Reaction registration

Reaction metadata belongs primarily on a D&D5e Activity:

```js
flags.action-effects-5e.reaction = {
  enabled: true,
  trigger: "spellCast",
  handler: "counterspell2024"
};
```

The metadata identifies the reaction. Rules remain in a registered handler. Arbitrary executable JavaScript is never read from reaction flags.

### Reactor queue

An opportunity contains only actual registered reaction offers. `Do not use a reaction` is a Broker response (`declined`), not an offer. A Reactor with one real reaction and a Reactor with several real reactions use the same window.

Initial Reactors are sorted once by:

1. shortest token-space distance to the Attacker;
2. highest Dexterity score;
3. GM-authoritative d20 rolls, rerolling unresolved ties.

The order is frozen. Eligibility is dynamic: immediately before activation, the Broker rediscovers that Reactor's offers. Lost eligibility skips the Reactor; changed offers replace the displayed choices; no new Reactor is inserted into the frozen queue.

All initial Reactors receive a Broker window. Only the current Reactor is active; all others wait. The active Reactor's existing window becomes the choice view, resolves, and closes before the next eligible window activates. A resolved reaction advances by default unless its handler explicitly stops the queue or aborts the source.

### Authority and dialog ownership

Reaction authority and UI ownership are different roles. The longest continuously connected active GM is the arbiter, while each dialog is routed to the user controlling that Reactor. NPC/unowned Reactors route to the elected GM.

AE5E stores a small hidden world ledger of GM browser-session IDs and connection sequence. Foundry's own active GM is used only to serialize writes to that ledger. If the elected GM leaves while another GM remains, the next-oldest continuous GM becomes arbiter.

A source workflow is not moved into the GM browser merely to arbitrate reactions. Its awaitable orchestration remains on the source-workflow client; selected/declined decisions and ordering d20s are validated by the elected GM over Socketlib. This is what lets a player-originated source workflow remain resumable if the last GM temporarily disconnects.

If no GM exists before a new opportunity begins, the Broker is bypassed. If the last GM disappears during an existing player-hosted transaction, the active view enters `WAITING_FOR_AUTHORITY`: OK is disabled, Cancel remains enabled, and reconnecting a GM restores the same view. Cancel means manual adjudication and unwinds every view in that transaction.

Remote Reactor prompts are also connection-aware. If the controller who owns the currently active Broker window disconnects, that transport loss is classified as an internal `interrupted` prompt rather than `declined` or `manual`. The same frozen Reactor slot is revalidated. If another authority remains available, the controller can fall back to the elected GM and a fresh Broker host is opened there; if the lost controller was the last GM, the transaction instead follows the normal `WAITING_FOR_AUTHORITY` path until a GM returns or a surviving participant presses Cancel.

A hard platform boundary remains: if the browser which owns the *originating workflow itself* disappears (for example, a GM-controlled Attacker whose GM refreshes), the live Midi/JavaScript workflow call stack is gone with that browser. Reaction transaction state can be diagnosed, but AE5E cannot reconstruct and resume a destroyed external workflow promise. The recoverable GM-loss design therefore assumes the source-workflow client remains connected.

### Nested reactions

Transactions carry `parentTransactionId` and `rootTransactionId`. A child reaction resolves completely before its parent's handler resumes. The dialog service keeps one host per reacting token and stacks transaction views, so a child can temporarily replace a parent waiting/resolving view without opening duplicate Broker windows for that token.

### Selection indicator

Only the `ACTIVE` Reactor acquires a v0.3.27 `responder` selection-indicator lease. Waiting, resolving, and authority-waiting states are intentionally unmarked. The lease is released before another Reactor becomes active or whenever the transaction exits.


## Reusable Eskie crosshair layer (v0.4.1.2)

AE5E treats custom placement graphics as an optional presentation layer above Sequencer's functional crosshair transaction. Rules code should ask `ae5e.crosshairs` for a visual; it should not hard-code free/Patreon detection or individual Eskie paths inside each spell.

Resolution order is intentionally deterministic:

```text
requested visual
    ↓
exact native premium recolor
    ↓ if missing
same-style premium white + tint
    ↓ if missing
alternate premium style
    ↓ if premium unavailable/missing
free white + tint
    ↓ if missing
native functional Sequencer crosshair
```

The underlying functional crosshair and the Eskie visual shape are separate concepts. For example, Fireball uses a functional circular placement plus an Eskie Circle area visual and a separate Eskie Line tracer. `Line` means a source-to-template tracer; `Ray` means the path/beam itself. This distinction is stored in `ESKIE_CROSSHAIR_SEMANTICS`.

When AE5E has a valid custom replacement visual, it applies the live-proven native suppression values `borderAlpha: 0`, `fillAlpha: 0`, `gridHighlight: false`. Suppression is conditional: if the visual resolver falls back native, AE5E leaves Sequencer's normal crosshair visible so a missing optional art module can never make an item unusable.

The catalog is explicit rather than synthesized. Premium v1.9.0 includes 244 supplied crosshair WebMs and contains a known asymmetric entry (`Circle/Generic_01` Red normal/base has 40ft rather than 60ft, while the white 60ft and Red NoBase 60ft assets exist). The resolver therefore checks real entries and prefers same-style white+tint before changing art styles. The confirmed free catalog used by this release contains 52 white crosshairs and covers all six shapes, including Rectangle and Reticle. Free white artwork is the tintable fallback when a native premium recolor is unavailable.


## Ongoing-effect multiplayer result authority (v0.4.1.6)

Ongoing-action execution deliberately separates **interaction authority** from **document authority**. The controlling client owns the prompt and executes the live D&D5e/Midi Activity so player agency and the normal roll UI remain local. The completed Midi Workflow is not a transport object: AE5E reduces it on that client to a versioned plain-data result envelope containing only the linked effect/item/actor/activity/workflow identifiers, success state, execution user, and simple roll diagnostics.

The execution client sends that envelope through the existing AE5E Socketlib service to the primary GM. The GM re-resolves the UUIDs, validates that the granted Item still points at the supplied parent ActiveEffect and Actor, and alone performs success cleanup. A failure result leaves the ongoing effect/grant intact. Duplicate Midi completion-hook notifications are collapsed by workflow identity before routing; GM resolution is also idempotent if a successful result arrives after the effect has already been removed.

This boundary is generic and does not encode Entangle or another spell name. Prompt/execute socket handlers return only serializable execution summaries and never expose a live Midi Workflow across the socket boundary.

## Animation ownership arbitration (v0.4.1.5, expanded v0.4.1.12)

Animation ownership is not a global animation-module toggle. AE5E supports two complementary ownership lifetimes:

1. **Persistent document ownership** uses the canonical declaration `flags.action-effects-5e.animation.automatedAnimations = "suppress"`. The resolver checks the immediate AA subject first, then an Item parent/origin chain, then same-Actor status ownership. Status inheritance is deliberately Actor-local: AE5E never edits or suppresses Foundry's global/native Restrained definition.
2. **Transient workflow ownership** is runtime-only. A caller registers a short-lived Item/Activity claim around one Activity execution. When an Activity is supplied, both Item and Activity identity must match; another Activity on the same Item is not suppressed. The scoped helper removes the claim in `finally` and performs no document update.

The Automated Animations adapter listens at `AutomatedAnimations-WorkflowStart`. A synchronous decision (including a transient claim) sets `clonedData.stopWorkflow` before AA proceeds. If resolving an origin UUID requires asynchronous work, the adapter appends a Promise to `clonedData.deferrals`; AA 7.0.22+ awaits those deferrals before testing `stopWorkflow`. This keeps arbitration inside AA's supported inter-module seam instead of monkey-patching AA or cancelling Sequencer effects after they start. Item/Activity identity may be read from AA's cloned workflow payload or the secondary animation context supplied by the hook.

Transient claims live only on the initiating client and require no Socketlib path because they do not perform privileged document writes. They are intended for one-shot Item/Activity workflows such as an authored Activity that plays its own Sequencer animation. Persistent flags remain the correct tool for an effect such as Entangled whose ownership must apply to later AA workflows.

For child effects created directly by AE5E/item automation, callers may copy the effective explicit persistent policy into creation data with `ae5e.animationOwnership.inheritAutomatedAnimationsPolicy()`. This provides exact provenance where the caller controls document creation. Status-ID inheritance remains a fallback for native/third-party child status documents whose creator does not expose an explicit parent-effect reference.
