# Action Effects 5E architecture

## Startup lifecycle

1. `SocketService` is initialized before Foundry `init` so Socketlib readiness cannot be missed.
2. `init` registers settings and publishes the API object.
3. `setup` refreshes compatibility state.
4. `ready` validates required dependencies, loads persisted relationships, initializes relationship movement, relationship rotation, and the central movement service, then emits `action-effects-5e.ready`.

## Relationship state

Relationships are persisted on the Scene under the Action Effects 5E namespace and indexed by leader/follower token UUID. The generic layer stores movement semantics without embedding the D&D Grapple check itself.

Important geometry fields are:

- `attachmentMode`: movement strategy. v0.3.23 adds `grappleFollower` while retaining `adjacentFollower`, `rigidOffset`, `passenger`, and `anchoredFollower`.
- `breakDistance`: maximum legal relationship separation in Scene distance units. `null` disables automatic separation detachment.
- `coordinationDistance`: current planar band preserved by coordinated Grapple-style translation/orbit.
- `forcedLeaderMovementPolicy`: `follow` or `independent`.
- `rotationPolicy`: `none` or `orbitFollower`.
- `collisionPolicy`: `stopGroup` or `detach`.
- `alliedEndpointPolicy` / `alliedEndpointGraceMs`: terminal same-side orbit-overlap behavior.

`breakDistance` and `coordinationDistance` intentionally differ. Example: a 10-foot reach grapple started adjacent may use `breakDistance: 10` and `coordinationDistance: 5`; one started at the outer reach band may use 10/10.

When both are finite, `coordinationDistance` may not exceed `breakDistance`; relationship creation or geometry-update requests that violate this invariant are rejected before Scene persistence.

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

## Allied occupied endpoint grace

A successful orbit may end in a same-side creature's occupied space. Friendly+Friendly and Hostile+Hostile are same-side for this relationship mechanic; Neutral/Secret are not inferred as allies.

With `alliedEndpointPolicy: grace`, the 3.5-second default timer begins after follower animation settlement. Continued movement into a legal/open position clears the timer. Consecutive same-side occupied endpoints retain the original legal anchor and restart the timer. Expiry restores both follower position and the exact matching leader rotation. Translation or relationship removal clears the pending state.

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

- `relationships.create/remove/updateGeometry`
- `relationships.moveGroup`
- `relationships.waitForMovementSettled`
- movement consumer registration and operation metadata helpers.

Development geometry helpers under `ae5e.tests` invoke the same real production services:

- configurable grapple fixture creation;
- geometry and shell inspection;
- shell validation;
- temporary orbit overlay;
- direct one-step clockwise/counterclockwise orbit commands.

No test-only alternative movement or orbit math exists.

## Security and coexistence

Player requests which mutate authoritative relationship state are GM-authorized through Socketlib and validated against relationship/token ownership. AE5E uses namespaced flags/options and narrow integrations. CPR and GPS are compatibility targets rather than dependencies; overlapping automation ownership remains a higher-layer concern.

## Current limits

- Dynamic orbit geometry currently requires a square Scene grid.
- Creature-size eligibility, unarmed-strike reach derivation, Grappled/Grappler effects, escape/action economy, movement-resource charging for rotation, and the Prone popup integration belong to later Grapple rules/item work.
- Fractional Tiny-token geometry is supported by the shell generator, but Foundry's occupied-grid-space distance API can collapse some sub-grid separations; live Tiny tests remain important before declaring final Grapple UX semantics.
