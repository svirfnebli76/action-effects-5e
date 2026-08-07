# Action Effects 5E

Action Effects 5E is a Foundry VTT v14+ module for reusable D&D5e automation infrastructure and premade items. The first development milestone is a low-overhead movement and spatial-event foundation.

## Required modules

- Midi-QOL
- Dynamic Active Effects (DAE)
- Socketlib
- libWrapper

Chris's Premades and Gambit's Premades are **not dependencies**, but coexistence with both is a first-class design requirement.

## Foundation build: 0.1.0

This build provides:

1. A Foundry module manifest and repository structure.
2. Startup validation for Foundry v14+, D&D5e, Midi-QOL, DAE, Socketlib, and libWrapper.
3. CPR/GPS detection and an initial overlap-policy setting.
4. An immutable movement-transaction data model.
5. One centralized `preMoveToken` listener and one centralized `moveToken` listener with indexed early-exit processing.
6. A persistent, Socketlib-authorized token relationship registry stored on Scene flags.
7. A console-based smoke test and relationship round-trip test.

This milestone does **not** yet automatically move an attached follower. It establishes the safe storage, indexing, permission, transaction, and testing layers that attachment movement and Grapple will use.

## Installation for development

Place this repository at:

```text
Data/modules/action-effects-5e
```

Enable the required modules and then enable Action Effects 5E.

## Console API

Open the browser developer console and run:

```js
const ae5e = game.modules.get("action-effects-5e").api;
```

Run the non-destructive foundation test:

```js
await ae5e.tests.runFoundationSmokeTest();
```

Create a temporary test relationship:

1. Control exactly two tokens.
2. The first controlled token is treated as the leader.
3. Run:

```js
await ae5e.tests.createTestRelationshipFromControlledTokens();
```

Remove test relationships:

```js
await ae5e.tests.removeTestRelationships();
```

Inspect runtime state:

```js
ae5e.movement.getStats();
ae5e.relationships.list();
ae5e.compatibility.getStatus();
```

## Performance principles

- One central movement hook pair, not one hook per item.
- No canvas-wide scan during ordinary movement.
- Fast token UUID and Scene ID indexes.
- Initiator-scoped movement consumers by default, preventing every connected client from resolving the same mechanic.
- No transaction construction unless a registered consumer, relationship, or diagnostics setting needs it.
- No document writes during ordinary movement in this foundation build.
- Scene flags are written only when relationships are created or removed.
- Detailed geometry and Regions will be activated only by features that require them.

## Original implementation policy

Action Effects 5E is an independent implementation based on D&D5e rules and Foundry's public APIs. CPR and GPS may be studied for compatibility and high-level architectural lessons, but their code is not copied or required.
