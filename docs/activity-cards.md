# Completed Activity cards

AE5E v0.4.5.20 provides shared, opt-in presentation for D&D5e 6 / Midi-QOL 14.6 usage cards. Item automation remains responsible for rules, timing and effects. Installing AE5E alone does not enable these cards on any Item.

## Activity policy

Store a policy at `flags.action-effects-5e.activityCard`:

```js
{
  schema: 1,
  enabled: true,
  title: "Example Feature — Activity",
  kind: "save",
  effectName: "Example Applied Effect",
  status: "prone",
  nativeStatus: false,
  result: "Example result",
  duration: "caller-owned duration text"
}
```

`effectName` selects enabled, unsuppressed effects bound to the source Item by `origin` or DAE's `itemUuid`. When `status` is supplied, that status must also be present. `nativeStatus: true` instead observes the native status; this accommodates automations that remove a temporary carrier after applying a native condition. The service records whether matching state already existed before saves. Presence alone cannot prove a particular causal application or detect every same-document duration refresh.

Movement policies use `kind: "movement"`, an `outcomeKey` selecting a caller-populated field on the Workflow, and optional caller-owned `completedText`. The result field has `{ status, cost, allowance }`. Recognized statuses are `completed`, `cancelled`, `no-movement`, and `failed`. Cost is movement allowance expenditure, not necessarily physical distance. No movement or opportunity-attack rule is inferred by AE5E.

## Completion

After the Item automation finishes, on the owning workflow client:

```js
await game.modules.get("action-effects-5e").api.chatCards.completeActivity(workflow);
```

This method expects the real local Midi Workflow, not serialized socket data. It snapshots observed results on the existing ChatMessage; it never rolls dice or applies/deletes effects. Save observers wait up to 500ms for asynchronous effect/status creation. Callers should catch presentation errors so rule execution remains independent.

All connected clients must load the new AE5E runtime. Per-client rendering uses native masked save nodes and their listeners, visible source/target names, and native totals/DCs. Explicit Passed/Failed and result text are shown only where Midi retained the result symbol. Pending, blind, concealed, and invisible messages keep native presentation. Native action/effect controls remain available. Clients whose summary settings omit Midi rows retain native summaries as a fallback; duplicate DC information can remain in that mode.

Results are historical snapshots, not live effect-expiry trackers. A new save clears prior presentation while it is pending; a subsequent completion captures the new result. Manual changes after completion require another completion call to update the snapshot. Repeat activities and unrelated Items are untouched unless explicitly configured by their author.

The schema-1 contract is provisional pending live Foundry/Midi/CAT acceptance. Development coverage includes source qualification, immunity/status checks, asynchronous status creation, reroll invalidation, ownership, and caller-owned movement text.
