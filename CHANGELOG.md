## 0.3.28

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
