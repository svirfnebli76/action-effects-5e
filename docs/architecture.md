# Movement and Relationship Architecture

## Startup lifecycle

- Module evaluation: register the Socketlib ready listener and socket handlers.
- `init`: register settings and expose the public API.
- `setup`: detect CPR and GPS.
- `ready`: validate dependencies, load relationship indexes, index relationship movement consumers, and activate the central movement hooks.

## Normal movement fast path

For a token with no registered movement consumer, no relationship, and diagnostics disabled:

1. `preMoveToken` fires.
2. Action Effects 5E performs indexed Boolean lookups.
3. No movement transaction is constructed.
4. Processing ends.

No Scene-wide scans occur.

## Manual / AE5E-owned relationship movement path

Foundry v14's `preMoveToken` hook permits rejecting movement but not rewriting its finalized waypoints. Action Effects 5E therefore uses this sequence:

1. The initiating client attempts to move a relationship leader.
2. The central listener finds a token-indexed relationship movement consumer.
3. The consumer extracts and sanitizes the final pending waypoints.
4. The original move is rejected.
5. A Socketlib request sends the plan to the active GM.
6. The GM validates user ownership, Scene identity, leader origin, relationship state, and waypoint data.
7. Follower paths are planned according to attachment mode: `rigidOffset` preserves relative offset, while `adjacentFollower` trails through the leader positions that are being vacated. On a gridded Scene, the planner expands declared leader segments through the public grid `getDirectPath()` API so a long drag trails by grid spaces rather than only by user-authored waypoints.
8. Foundry's public collision constraint API performs best-effort preflight where available.
9. Action Effects 5E explicitly marks the terminal generated leader and follower waypoint as `checkpoint: true`; intermediate checkpoint state is preserved.
10. One `Scene.moveTokens()` call moves the leader and followers.
11. Action Effects 5E metadata identifies the replacement as an internal relationship movement so it is not intercepted recursively.

### External API movement

Version 0.2.11 adds a deliberately narrow libWrapper integration at Foundry v14's public `Scene.moveTokens()` boundary. The wrapper is present so AE5E can coordinate followers **before animation begins**, but its hot path is only indexed relationship lookups and conservative shape checks. It changes a call only when all of the following are true:

- exactly one token instruction is present;
- that token is an active AE5E relationship leader;
- every active relationship for that leader uses `coordinationPolicy: "coordinated"`;
- the method is a supported external style (`api`, `undo`, or `paste`);
- the instruction is pure movement rather than a resize or mixed token update;
- the movement is traversal rather than teleportation.

For a GM caller, AE5E reconstructs the declared route directly from the incoming instruction, plans follower routes, preflights the whole group, adds followers to the same operation, marks the operation with transient AE5E metadata, and invokes the original wrapped `Scene.moveTokens()` once. The external caller still receives only the result key it originally supplied. Leader and followers therefore share one Foundry movement operation and can animate together.

For a non-GM caller, the compatible request is handed to the active GM through the existing Socketlib group-movement handler. The GM revalidates leader ownership, origin, relationship state, and route before moving the group, so the player does not need ownership of attached followers.

The integration is intentionally fail-open to compatibility. Unrelated tokens, follower-only movement, multi-token external calls, teleports, mixed/resize payloads, unavailable followers, `postSync` policy, and failed player-to-GM handoff use the original `Scene.moveTokens()` call. The v0.2.10 terminal-subpath after-phase synchronizer remains available as the fallback for compatible relationship movement that could not be safely pre-coordinated.

For `adjacentFollower`, both coordinated external traversal and fallback post-sync use the same historical-route planner, so the follower ends in the leader's most recently vacated space rather than mirroring the leader's delta.


## Relationship coordination policy

Relationships persist a `coordinationPolicy`:

- `coordinated` (default): eligible manual and compatible external leader movement is planned as a group before movement begins. Existing pre-v0.2.11 relationships without this field are treated as coordinated at runtime.
- `postSync`: external movement is deliberately left to the original caller and the validated after-phase follower synchronizer is used instead.

Teleport behavior is not selected by this policy. Teleports continue to use the relationship's explicit `teleportPolicy` because teleporting does not traverse the intervening path.

## Public relationship movement entry points

`relationships.moveGroup()` provides a GM-authorized group-movement entry point for future consumers such as Grapple, mounts, passengers, and carried tokens. Callers provide a leader UUID plus destination/waypoints and movement semantics; the relationship service owns route normalization, follower planning, authorization, movement IDs, terminal checkpoints, collision preflight, rollback, and operation metadata.

`relationships.waitForMovementSettled()` is a testing/consumer helper which observes public token `movementAnimationPromise` values plus AE5E's active/queued relationship state. It avoids fixed sleeps when a leader operation can be followed by additional relationship movement.

## Security

The GM-side socket handler does not trust arbitrary document or coordinate data blindly. It verifies:

- The requesting user still exists.
- The Scene and leader token still exist.
- A non-GM requester owns the leader.
- The leader remains at the intercepted origin.
- Waypoints contain only approved primitive movement fields.
- The current persisted relationship controls each follower.
- Only a GM request may preserve an original ignore-walls movement option.
- Primary-GM movement receipts are indexed for every relationship participant. Non-GM leader synchronization and follower-teleport detachment are validated against those receipts rather than trusting client-supplied coordinates or movement semantics.

## External movement fallback settlement

When the v0.2.11 pre-coordination wrapper intentionally passes an external relationship movement through, API/undo/paste leader movement is allowed to complete without replacing the caller's operation. Foundry can split one route at explicit checkpoints into several movement operations sharing a stable `subpathId`. AE5E ignores non-terminal operations while `movement.pending.waypoints` remains non-empty. The terminal operation reconstructs the complete current subpath from Foundry movement history plus its passed waypoints, then waits for logical `movement.finished` and `movement.animation.ended` when Foundry provides that promise. This is necessary because Foundry 14.365 can commit the destination while the public TokenDocument and rendered token still expose animated/intermediate coordinates. Exact GM-side position validation and follower synchronization therefore occur only after the **terminal subpath operation** has settled. Synthetic operations without animation metadata fall back to logical completion or the existing next-task handoff.

Primary-GM receipts follow the same rule. Intermediate checkpoint operations do not create trusted synchronization receipts; the terminal movement ID receives one receipt containing the GM-observed full origin/path/destination for that subpath. This lets non-GM clients request follower synchronization without supplying authoritative route geometry.

## Follower self-movement

Manual movement methods (`dragging`, `keyboard`, `hud`, and `config`) are rejected when `followerCanSelfMove` is false, except for movements classified as teleports. A follower teleport is allowed to complete and then breaks every relationship in which that token is the follower. API, undo, and paste movement are not automatically blocked so external forced-movement and administrative systems remain possible. Later rules adapters will decide whether other non-teleport movements break, preserve, or transform a relationship.

## Collision behavior

- `stopGroup`: reject the leader's requested movement when a rendered follower path is constrained.
- `detach`: omit that follower and remove the relationship after successful leader movement.
- If Foundry reports a partial group failure despite preflight, tokens that completed are restored to their origins with automation suppressed for Action Effects 5E.

Version 0.2.11 does not implement occupied-token collision or nearest-valid-square searching.

## Teleport behavior

Leader teleport policy:

- `detach`: move only the leader and remove the relationship after success.
- `follow`: teleport the follower while preserving its offset, even for `adjacentFollower`.
- `block`: reject an intercepted leader teleport.

Follower teleport behavior is symmetric escape behavior: the follower teleport is permitted and, once the active GM validates the completed teleport, the follower relationship is removed.

Movement classification does not read Foundry's deprecated `DatabaseUpdateOperation#teleport` accessor. It uses Action Effects metadata, explicit own caller data, movement method semantics, and Foundry movement action configuration such as `blink.teleport` instead.

## Movement semantics

The coordinated operation carries one transaction ID plus leader and relationship provenance. Movement transactions classify:

- The leader as voluntary movement using its movement resource.
- Each follower as passenger movement using no movement resource.

This allows later Region, hazard, Opportunity Attack, and Grapple logic to distinguish traversal from agency.

## Compatibility

The coordinated movement uses ordinary Foundry movement APIs rather than private CPR or GPS functions. CPR and GPS can observe the resulting token movements normally. Action Effects 5E uses namespaced operation metadata and does not create reach Regions, reaction dialogs, or aura processing in this milestone.
