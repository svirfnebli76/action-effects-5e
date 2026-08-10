# Changelog

## 0.3.25 - Generic forced Push/Pull displacement foundation

- Added a relationship-independent `DisplacementService` for one-shot forced movement. Push and Pull requests carry Source, Target, distance, and a semantic direction constraint; persistent relationships are not created merely because one creature forced another to move.
- Added first-class `AWAY`, `STRAIGHT_AWAY`, `TOWARD`, and `STRAIGHT_TOWARD` direction constraints. Direction semantics are calculated from the center of the Source's complete token footprint to the center of the Target's complete footprint; collision always uses the Target's full footprint rather than center points.
- Added square-grid candidate generation for all legal 8-direction destinations. `AWAY`/`TOWARD` expose every direction with a positive projection on the semantic vector, while the `STRAIGHT_*` forms expose only the best-aligned direction(s). This naturally permits additional Shove directions beside Large/Huge sources when center-relative geometry warrants them.
- Added an ephemeral PIXI destination selector. Clear destinations are green, persistent nonhostile endpoint conflicts are yellow, partial-distance destinations are orange, and hard-blocked requested destinations are red and disabled. Blocked choices remain visible so the user can see why a direction is unavailable; Esc cancels selection.
- Added `MovementObstructionService` for displaced-body footprint checks. Walls/environment constraints hard-stop movement; a creature hostile relative to the **displaced Target** hard-stops movement; nonhostile creatures may be traversed. Neutral and Secret retain the universal nonhostile semantics validated in v0.3.24.
- Displacement is resolved one grid step at a time. A hard obstruction after one or more legal steps produces a partial displacement to the last legal step instead of cancelling the entire Push/Pull.
- Generalized the 3.5-second occupied-endpoint concept for forced displacement. If a displacement ends overlapping a nonhostile creature, grace begins; if that occupant moves away, the pending rollback clears immediately; if the overlap remains at expiry, the Target returns to the most recent **clear** position reached by that displacement, not necessarily its original starting position.
- Added a narrow D&D5e occupied-space integration for active AE5E displacement only. AE5E removes from D&D5e's blocking set only the exact token UUIDs that its own body preflight already classified nonhostile; it does not globally disable token collision.
- AE5E-generated Push/Pull movement now produces normal movement transactions with `agency: "forced"`, `resource: "none"`, and displacement metadata (`displacementId`, type, direction constraint/direction, requested distance, actual distance, Source, and Target) so other AE5E features can reliably distinguish forced movement without prompts or guessed heuristics.
- Added public `ae5e.displacement` APIs for `request`, `push`, `pull`, `getCandidates`, selection/grace cleanup, recent results, and stats, plus `action-effects-5e.displacementResolved`.
- Added Foundry-only `ae5e.tests.runDisplacementFoundationTest()` coverage for 1x1/2x2/3x3 direction geometry, actual Pull execution, Target-relative hostile blocking, forced transaction metadata, nonhostile grace/rollback, immediate grace clearing when the occupant leaves, Neutral/Secret endpoints, nonhostile transit, and wall partial-stop behavior. Test fixtures use a Foundry v14 movement action configured as teleportation rather than the deprecated database `teleport` update option.
- Repaired the built-in follower-body disposition matrix fixture placement so it also uses exact modern movement-action fixture positioning and validates the resulting token coordinates before testing behavior.
- Physical Grapple-link sweep/final occupancy remains intentionally deferred to v0.3.26, where it can reuse the new generic obstruction foundation while resolving link relationships relative to the Leader/Grappler.

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
