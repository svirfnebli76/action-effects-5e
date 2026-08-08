# Changelog

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
