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

## Relationship movement path

Foundry v14's `preMoveToken` hook permits rejecting movement but not rewriting its finalized waypoints. Action Effects 5E therefore uses this sequence:

1. The initiating client attempts to move a relationship leader.
2. The central listener finds a token-indexed relationship movement consumer.
3. The consumer extracts and sanitizes the final pending waypoints.
4. The original move is rejected.
5. A Socketlib request sends the plan to the active GM.
6. The GM validates user ownership, Scene identity, leader origin, relationship state, and waypoint data.
7. Follower paths are translated from the leader path using their current offsets.
8. Foundry's public collision constraint API performs best-effort preflight where available.
9. One `Scene.moveTokens()` call moves the leader and followers.
10. Action Effects 5E metadata identifies the replacement as an internal relationship movement so it is not intercepted recursively.

### External API movement

API, undo, and paste movement is not rejected in the before phase. Rejecting it would cause the calling module's movement promise to resolve as failed even though Action Effects 5E later moved the group. Instead, the leader completes its original operation and the initiating client requests a follower-only synchronization in the after phase. If a follower cannot safely synchronize after an external move, the affected relationship is detached rather than rewriting the external caller's completed result.

## Security

The GM-side socket handler does not trust arbitrary document or coordinate data blindly. It verifies:

- The requesting user still exists.
- The Scene and leader token still exist.
- A non-GM requester owns the leader.
- The leader remains at the intercepted origin.
- Waypoints contain only approved primitive movement fields.
- The current persisted relationship controls each follower.
- Only a GM request may preserve an original ignore-walls movement option.

## Follower self-movement

Manual movement methods (`dragging`, `keyboard`, `hud`, and `config`) are rejected when `followerCanSelfMove` is false. API, undo, and paste movement are not automatically blocked so external forced-movement and administrative systems remain possible. Later rules adapters will decide whether those movements break, preserve, or transform a relationship.

## Collision behavior

- `stopGroup`: reject the leader's requested movement when a rendered follower path is constrained.
- `detach`: omit that follower and remove the relationship after successful leader movement.
- If Foundry reports a partial group failure despite preflight, tokens that completed are restored to their origins with automation suppressed for Action Effects 5E.

Version 0.2.0 does not implement occupied-token collision or nearest-valid-square searching.

## Teleport behavior

- `detach`: move only the leader and remove the relationship after success.
- `follow`: teleport the follower while preserving its offset.
- `block`: reject the teleport.

## Movement semantics

The coordinated operation carries one transaction ID plus leader and relationship provenance. Movement transactions classify:

- The leader as voluntary movement using its movement resource.
- Each follower as passenger movement using no movement resource.

This allows later Region, hazard, Opportunity Attack, and Grapple logic to distinguish traversal from agency.

## Compatibility

The coordinated movement uses ordinary Foundry movement APIs rather than private CPR or GPS functions. CPR and GPS can observe the resulting token movements normally. Action Effects 5E uses namespaced operation metadata and does not create reach Regions, reaction dialogs, or aura processing in this milestone.
