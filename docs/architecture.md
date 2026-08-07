# Foundation Architecture

## Startup lifecycle

- `init`: register settings, prepare Socketlib, expose the API.
- `setup`: detect CPR and GPS.
- `ready`: validate dependencies, load relationship indexes, and activate movement hooks.

## Movement fast path

For a token with no registered movement consumer, no relationship, and diagnostics disabled:

1. `preMoveToken` fires.
2. Action Effects 5E performs indexed Boolean lookups.
3. No transaction is constructed.
4. Processing ends.

The same early-exit process occurs for `moveToken`.

## Movement consumers

Consumers register once with the central registry. They may target:

- Specific token UUIDs
- Specific Scene IDs
- All movement

Consumers may subscribe to the synchronous `before` phase or asynchronous `after` phase, have an explicit priority, and declare an execution scope: initiating client, primary GM, or all clients. The default is the initiating client to prevent duplicate mechanical resolution.

## Movement transactions

Transactions preserve standardized semantic fields even when a feature does not use all of them yet:

- Path type
- Agency
- Resource
- Movement mode
- Source UUID
- Initiator UUID
- Leader and relationship IDs
- Internal-operation and suppression metadata

Action Effects 5E-initiated movements should use `api.movement.createOperationOptions()` so later systems can understand why a token moved.

## Relationships

Relationships are persisted on the Scene under:

```text
flags.action-effects-5e.relationships
```

Runtime maps provide constant-time checks by leader or follower UUID. Flags are changed only when a relationship is created, removed, or cleaned up.

The foundation stores relationships but intentionally does not yet synchronize token positions. Automatic following will be implemented after the movement transaction layer has been tested in Foundry v14.

## Compatibility

The compatibility service detects:

- `chris-premades`
- `gambits-premades`

No CPR or GPS API is required. The initial overlap policy is intentionally broad; later releases will add ownership controls for Opportunity Attacks, moving areas, auras, forced movement, and other overlapping subsystems.
