# Action Effects 5E

Action Effects 5E is a Foundry VTT v14.357+ module for reusable D&D5e automation infrastructure and premade items. Its first subsystem is a low-overhead movement, spatial-event, and rules-aware token relationship framework.

## Required modules

- Midi-QOL
- Dynamic Active Effects (DAE)
- Socketlib
- libWrapper

Chris's Premades and Gambit's Premades are **not dependencies**, but coexistence with both is a first-class design requirement.

## Build 0.2.9: animation-settled external sync and elevation trailing

This build adds the first working attachment behavior on top of the validated 0.1.1 foundation:

- A leader's normal Foundry movement is intercepted only when it has registered followers.
- The original movement is replaced with one GM-authorized `Scene.moveTokens()` operation for the group.
- `adjacentFollower` relationships trail through spaces just vacated by the leader; `rigidOffset` relationships continue to preserve their current X/Y offset.
- Elevation follows by preserving the original elevation difference when configured.
- Manual follower movement is blocked when `followerCanSelfMove` is false.
- API-driven follower movement remains possible so other automations can still push, pull, teleport, or reposition it. A follower teleport now breaks its relationship after the completed teleport is GM-validated.
- External API/undo/paste movement of a leader is allowed to complete normally, then followers are synchronized afterward so CPR/GPS or other callers do not receive a false movement result.
- Internal movement metadata prevents recursive attachment movement.
- Best-effort wall/surface preflight is performed through Foundry's public movement constraint API when the active GM has the Scene rendered.
- If Foundry stops part of a coordinated move, completed group members are restored to their starting positions.
- Leader teleport policies support `detach`, `follow`, and `block`; a follower teleport is allowed to escape and breaks the relationship.
- Collision policies support `stopGroup` and `detach`.
- Relationship chains and cycles are rejected in this milestone.





### v0.2.9 animation-settled external synchronization

Live Foundry 14.365 timing showed that `TokenMovementOperation.finished` can resolve while the public TokenDocument and rendered token are still interpolating at their old coordinates. The movement's authoritative destination is already committed, but exact `document.x`, `document.y`, and `document.elevation` values do not settle until `movement.animation.ended` resolves. AE5E therefore waits for logical movement completion **and**, when present, animation settlement before exact-position validation, external follower synchronization, or follower-teleport detachment. Synthetic/API contexts without an animation promise retain the existing completion/fallback behavior.

### v0.2.8 external movement completion and elevation correction

v0.2.8 introduced stable-subpath deduplication, full-route destination validation, elevation-interpolation collapsing, and waiting for `TokenMovementOperation.finished`. Live testing subsequently showed that `finished` alone does not guarantee the live TokenDocument has reached its final animated coordinates; v0.2.9 completes that lifecycle handling by also waiting for `movement.animation.ended` when available.

For `adjacentFollower`, consecutive elevation interpolation points at the same x/y coordinate are collapsed into one planar space before applying the one-space trailing offset. A leader that moves one square while rising therefore leaves the follower in the leader's vacated x/y/elevation position instead of consuming the trailing offset on an intermediate elevation-only point. Pure vertical movement preserves the follower's planar offset while applying the leader's elevation delta when `followElevation` is enabled.

### v0.2.7 follower entry-anchor correction

Foundry computes a direct path between checkpoints. For an `adjacentFollower`, the first synthetic trailing destination is the leader's vacated origin. If that destination is only a non-checkpoint waypoint, a follower starting to the side of the leader can skip the vacated origin and cut diagonally toward a later checkpoint. AE5E now marks the leader's vacated origin as the follower's first checkpoint, then preserves the leader's declared checkpoints and the follower's terminal trailing checkpoint. This makes the follower enter the leader's starting square first and then trace the leader's route one space behind.

### v0.2.6 checkpoint and continuation correction

Foundry v14 processes a user-authored route with explicit checkpoints as multiple movement operations. At each checkpoint the current `movement.id` can change, while waypoint `subpathId` continues to identify the original movement instruction. The current leg is exposed through `movement.passed.waypoints` and later legs through `movement.pending.waypoints`. AE5E now reconstructs the full intercepted route from both collections and resolves transient internal movement metadata through either the current movement ID or the stable subpath ID. This preserves L-shaped and other multi-checkpoint routes and prevents Foundry continuation stages from being mistaken for new manual relationship movement.



### v0.2.5 trailing and teleport correction

`adjacentFollower` now represents a dragged/trailing relationship instead of behaving like `rigidOffset`. For a leader route `L0 -> L1 -> L2`, the follower route is `L0 -> L1`, so the follower occupies the space the leader just vacated. On a gridded Scene, AE5E expands straight or multi-waypoint segments through Foundry's public grid `getDirectPath()` API before dropping the leader's final space; this keeps a follower one grid space behind even when the leader is dragged several spaces in one operation. A one-square leader move therefore places the follower directly into the leader's starting square. `rigidOffset` remains available for mounts, passengers, carried objects, and other relationships that should mirror movement. Teleport-follow deliberately preserves offset instead of using the trailing route.

Follower teleports are symmetric with leader detach behavior: the teleport itself is not blocked by `followerCanSelfMove: false`, and after the completed movement the active GM validates the teleport and removes the follower's relationship. Primary-GM movement receipts are now indexed for both leaders and followers so this also works for non-GM players without trusting a client-supplied detach request.

Movement classification no longer reads Foundry's deprecated `DatabaseUpdateOperation#teleport` accessor. Teleports are detected from AE5E metadata, explicit own caller data, movement methods, and Foundry movement actions such as `blink`.

### v0.2.4 terminal-checkpoint correction

Live Foundry 14.365 testing demonstrated that programmatic `Scene.moveTokens()` relationship movement can resolve `false` when the generated terminal waypoint omits an explicit checkpoint, even though the final waypoint is terminal. Action Effects 5E now explicitly sets `checkpoint: true` on the final leader and follower waypoint for coordinated movement, follower synchronization, and rollback destinations. Intermediate waypoint checkpoint state is preserved. The fix does not inject `action` or `level`; those continue to use Foundry's normal movement state.

### v0.2.3 replacement-movement scheduling correction

Manual leader movement is cancelled in `preMoveToken` and replaced with one coordinated `Scene.moveTokens()` operation. The replacement is now deferred to the **next event-loop task** rather than a microtask. This gives Foundry time to completely unwind the rejected original movement workflow before Action Effects 5E starts a new movement document update. External follower synchronization uses the same next-task boundary to avoid nested movement updates from inside `moveToken`.

### v0.2.2 movement identity correction

Foundry v14 accepts explicit IDs on `Scene.moveTokens()` instructions, but those IDs must be valid Foundry UIDs. Action Effects 5E therefore uses opaque 16-character alphanumeric movement IDs and keeps module-specific semantic metadata in its transient movement-context registry. This prevents recursive relationship handling without placing namespaced strings into Foundry's validated movement-ID field.

### Current attachment scope

Version 0.2.9 distinguishes **trailing adjacency** from **fixed-offset following**. `adjacentFollower` follows the leader's vacated spaces, while `rigidOffset` preserves the original relative offset. Selecting an alternate legal adjacent square or rotating a grappled target around its grappler is still future work.

Core token occupancy is not treated as a collision in this build. Wall/surface checking is best-effort, while Foundry's final movement result remains authoritative.

## Installation for development

Place the repository at:

```text
Data/modules/action-effects-5e
```

Enable the required modules and then enable Action Effects 5E. Restart Foundry after replacing module files.

## Console API

```js
const ae5e = game.modules.get("action-effects-5e").api;
```

Run the non-destructive foundation test:

```js
await ae5e.tests.runFoundationSmokeTest();
```

## Coordinated movement test

1. Place two tokens on the same Scene.
2. Control exactly two tokens. The first entry in the controlled-token collection becomes the leader and the second becomes the follower.
3. Run:

```js
await ae5e.tests.createTestRelationshipFromControlledTokens();
```

The harness releases the follower and leaves the leader controlled.

4. Drag or keyboard-move the leader one square. The `adjacentFollower` should move into the square the leader just vacated.
5. Try to drag the follower manually. The move should be rejected with a warning.
6. Inspect either controlled token:

```js
ae5e.tests.inspectControlledRelationship();
```

7. Remove the test relationship:

```js
await ae5e.tests.removeTestRelationships();
```

Inspect runtime state:

```js
ae5e.movement.getStats();
ae5e.relationships.getStats();
ae5e.relationships.getMovementStats();
ae5e.relationships.list();
ae5e.compatibility.getStatus();
```

## Performance principles

- One central movement hook set, not one hook per item.
- Relationship movement consumers are indexed only for tokens that currently participate in a relationship.
- A token with no relationship or registered movement consumer exits after inexpensive map lookups.
- No canvas-wide token, Item, Active Effect, or Region scans occur during normal movement.
- No polling and no animation-frame document writes.
- One coordinated `Scene.moveTokens()` call moves the active relationship group.
- Scene flags are written only when relationships are created, removed, detached, or cleaned up.
- Detailed collision work runs only for actual followers.

## Original implementation policy

Action Effects 5E is an independent implementation based on D&D5e rules and Foundry's public APIs. CPR and GPS may be studied for compatibility and high-level architectural lessons, but their code is not copied or required.
