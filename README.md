# Action Effects 5E

Action Effects 5E is a Foundry VTT v14.357+ module for reusable D&D5e automation infrastructure and premade items. Its first subsystem is a low-overhead movement, spatial-event, and rules-aware token relationship framework.

## Required modules

- Midi-QOL
- Dynamic Active Effects (DAE)
- Socketlib
- libWrapper

Chris's Premades and Gambit's Premades are **not dependencies**, but coexistence with both is a first-class design requirement.

## Build 0.2.3: coordinated token relationships

This build adds the first working attachment behavior on top of the validated 0.1.1 foundation:

- A leader's normal Foundry movement is intercepted only when it has registered followers.
- The original movement is replaced with one GM-authorized `Scene.moveTokens()` operation for the group.
- Followers preserve their current X/Y offset from the leader across every waypoint.
- Elevation follows by preserving the original elevation difference when configured.
- Manual follower movement is blocked when `followerCanSelfMove` is false.
- API-driven follower movement remains possible so other automations can still push, pull, teleport, or reposition it.
- External API/undo/paste movement of a leader is allowed to complete normally, then followers are synchronized afterward so CPR/GPS or other callers do not receive a false movement result.
- Internal movement metadata prevents recursive attachment movement.
- Best-effort wall/surface preflight is performed through Foundry's public movement constraint API when the active GM has the Scene rendered.
- If Foundry stops part of a coordinated move, completed group members are restored to their starting positions.
- Teleport policies support `detach`, `follow`, and `block`.
- Collision policies support `stopGroup` and `detach`.
- Relationship chains and cycles are rejected in this milestone.



### v0.2.3 replacement-movement scheduling correction

Manual leader movement is cancelled in `preMoveToken` and replaced with one coordinated `Scene.moveTokens()` operation. The replacement is now deferred to the **next event-loop task** rather than a microtask. This gives Foundry time to completely unwind the rejected original movement workflow before Action Effects 5E starts a new movement document update. External follower synchronization uses the same next-task boundary to avoid nested movement updates from inside `moveToken`.

### v0.2.2 movement identity correction

Foundry v14 accepts explicit IDs on `Scene.moveTokens()` instructions, but those IDs must be valid Foundry UIDs. Action Effects 5E therefore uses opaque 16-character alphanumeric movement IDs and keeps module-specific semantic metadata in its transient movement-context registry. This prevents recursive relationship handling without placing namespaced strings into Foundry's validated movement-ID field.

### Current attachment scope

Version 0.2.3 deliberately uses **fixed-offset following**. The `adjacentFollower` mode currently preserves its existing offset in the same way as `rigidOffset`; choosing a new legal adjacent square or rotating a grappled target around its grappler comes later.

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

4. Drag or keyboard-move the leader. The follower should preserve its offset and move in the same coordinated operation.
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
