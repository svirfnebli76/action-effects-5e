# Action Effects 5E architecture

## Startup lifecycle

1. `SocketService` is initialized before Foundry `init` so Socketlib readiness cannot be missed.
2. `init` registers settings and publishes the API object.
3. `setup` refreshes compatibility state.
4. `ready` validates required dependencies, loads persisted relationships, initializes movement/relationship/displacement services plus the selection-indicator service, then emits `action-effects-5e.ready`.

## v0.3.29 native movement-resource accounting

AE5E does not own a second movement allowance ledger. Foundry/D&D5e `TokenDocument.movementHistory` is the sole source of truth for movement cost already consumed. `MovementTransaction` remains a semantic event model (agency, resource, source, relationship, displacement, path type, etc.), and now includes a lightweight snapshot/summary of that native history for consumers that need to reason about movement without maintaining another counter.

AE5E registers a hidden `action-effects-5e.no-cost` Token movement action during `init`. It is `measure: true` with a cost multiplier of 0. This distinction is intentional: forced/follower/passenger/rollback paths still need normal spatial distance and traversal semantics, but they must not spend the moved Token's ordinary movement resource.

Accounting ownership rules are:

- **Normal voluntary Leader movement:** preserve Foundry/D&D5e's original movement action and native cost.
- **Relationship Follower/passenger movement:** measured, native cost 0. The established trailing/vacated-space route is unchanged.
- **Forced Push/Pull displacement:** measured, native cost 0; existing forced-movement semantic metadata is preserved.
- **Orbit Follower movement:** measured, native cost 0.
- **AE5E rollback/reposition movement:** native cost 0 and semantically administrative.
- **Teleport:** preserve teleport movement-action semantics rather than converting the path to an ordinary traverse action.

The movement accounting service also exposes a final-cost modifier action API. A modifier wraps the selected base movement action's native cost function and then returns the final segment cost. The future 2024 Grapple drag surcharge should therefore be expressed as `nativeCost + distance`, not `nativeCost * 2`; this preserves whatever D&D5e/Regions already contributed to native cost before Grapple adds one extra foot for each foot moved. v0.3.29 deliberately does not activate that surcharge because the Grapple Activity/rule layer has not been built yet. Stationary orbit charging is likewise deferred rather than represented through fake Leader movement or a parallel AE5E ledger.

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
