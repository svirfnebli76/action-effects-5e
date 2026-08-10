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
- `nonhostileEndpointPolicy` / `nonhostileEndpointGraceMs`: terminal nonhostile orbit-overlap behavior. The former `alliedEndpointPolicy` / `alliedEndpointGraceMs` names remain persisted compatibility aliases during the v0.3.x migration.

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

## Generic forced displacement (v0.3.25)

Push/Pull are one-shot displacement operations and do **not** create relationships merely because one token caused another token to move. Persistent state such as Grapple, Tether, Mount, Carry, or Passenger remains a relationship concern. A later item such as a grappling hook can therefore perform a Pull first and create a Tether relationship only if its own rules require persistent linkage afterward.

Responsibility is intentionally split:

- the Item/integration declares `type`, distance, and semantic direction constraint;
- AC5E may pass those semantics when an Automated Conditions feature owns the initiating rule;
- AE5E calculates spatial candidates, evaluates obstruction/occupancy, presents the runtime destination selector, authorizes the movement through the GM, and emits the forced `MovementTransaction`.

The public direction vocabulary is `AWAY`, `STRAIGHT_AWAY`, and `STRAIGHT_TOWARD`. Push accepts `AWAY` or `STRAIGHT_AWAY`. Pull is deliberately `STRAIGHT_TOWARD` only: it is a direct-line operation toward the Source/puller and never presents a destination-choice fan. On square grids, AE5E builds a semantic unit vector from the center of the Source's complete footprint to the center of the Target's complete footprint. `AWAY` accepts each of the eight grid directions whose normalized vector has positive projection on the semantic vector. `STRAIGHT_*` retains the best-aligned direction; Pull resolves any exact square-grid alignment tie deterministically so it can remain automatic. This avoids encoding 1x1 assumptions into Shove while keeping Pull mechanically distinct and direct.

Direction centers are **not** collision geometry. `MovementObstructionService` translates the Target's complete footprint through each candidate grid step. Environment/walls are checked through Foundry's public constraint pipeline with token blocking excluded for that preflight. Creature occupancy is then classified relative to the displaced Target through `RelativeTokenRelationshipService` using the `displaced-body` geometry channel. Hostile occupancy stops before the offending step; nonhostile occupancy is traversable.

A requested displacement is therefore a maximum distance rather than all-or-nothing movement. If a 10-foot Push has one legal 5-foot step and then encounters a wall or hostile creature, the actual result is 5 feet and is reported as `partial`. An endpoint which remains occupied by a nonhostile creature is temporarily legal and enters generic endpoint grace. If the endpoint occupant moves away during grace, the pending rollback clears immediately. Expiry while the overlap remains returns the Target to the latest clear position reached by that same displacement, skipping earlier traversed positions that were themselves nonhostile-occupied.

D&D5e Full Movement Automation performs token blocking during `findMovementPath` before ordinary constraint options can disable it. While an AE5E displacement is active, AE5E uses the D&D5e occupied-grid-space hook to remove only the exact blocker UUIDs that the independent displaced-body preflight already classified nonhostile. The bypass map exists only for that Target and only for the duration of that movement; hard/environment checks remain authoritative.

Every executed Push/Pull movement is tagged `agency: forced`, `resource: none`, `pathType: traverse`, plus Source/Target and displacement identity/type/direction/requested-vs-actual distance. This allows Grapple, Booming Blade, Regions, opportunity logic, and later effects to distinguish forced movement without prompting users or inferring agency from coordinates.

The on-canvas selector is used for Push operations which require a runtime destination choice. It is ephemeral PIXI state: clear candidates are green, soft endpoint conflicts yellow, partial stops orange, and blocked requested endpoints red. Blocked endpoints remain visible but disabled. Pull does not invoke the selector; its `STRAIGHT_TOWARD` destination is resolved automatically. No Drawings, Tiles, Regions, Scene flags, or temporary Item/Active Effect documents are created for selection.

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
- v0.3.25 provides displaced-body obstruction only. Physical `grapple-link` sweep/final-corridor obstruction is intentionally deferred to v0.3.26 and will use the Leader/Grappler as its relative-relationship reference.
- Push/Pull item adapters (Unarmed Strike/Shove, grappling hooks, spells, etc.) are not bundled in v0.3.25; this build provides the reusable infrastructure they will call.
- Creature-size eligibility, unarmed-strike reach derivation, Grappled/Grappler effects, escape/action economy, movement-resource charging for rotation, and the Prone popup integration belong to later Grapple rules/item work.
- Fractional Tiny-token geometry is supported by the shell generator, but Foundry's occupied-grid-space distance API can collapse some sub-grid separations; live Tiny tests remain important before declaring final Grapple UX semantics.
