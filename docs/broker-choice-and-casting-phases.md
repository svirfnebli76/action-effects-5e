# Generic broker-choice and casting-phase infrastructure

AE5E v0.4.5.40 adds reusable lifecycle and chooser services. These services do
not contain Metamagic option names, feature rules, or feature-specific wording.
Items and family consumers remain responsible for those decisions.

## Casting phases

`api.casting.phases` exposes semantic lifecycle ids:

- `PRE_CAST` / `pre-cast`
- `POST_TARGETING` / `post-targeting`
- `ATTACK_RESOLVED` / `attack-resolved`
- `DAMAGE_MUTABLE` / `damage-mutable`

Register a consumer with:

```js
const release = api.casting.registerPhaseConsumer("my-feature", {
  phases: [api.casting.phases.PRE_CAST],
  priority: 0,
  async handler(event) {
    // Item/family code decides whether this event matters.
    return true;
  }
});
```

The event contains the live workflow/Activity/Actor plus generic casting facts.
Only phases marked cancellation-safe may propagate `false` to the source hook.
Later phases fail open so a consumer cannot unwind an already-progressed cast.

## Broker chooser

`api.prompts.chooseBroker(options)` routes to the active controlling player with
GM fallback and returns one of three explicit outcomes:

```js
{ outcome: "confirm", selectedIds: ["option-id"], controllerUserId }
{ outcome: "decline", selectedIds: [], controllerUserId }
{ outcome: "abort", selectedIds: [], controllerUserId }
```

The caller supplies every visible feature string. Supported generic fields
include:

```js
{
  title,
  prompt,
  banner,
  choices: [{
    id,
    label,
    description,
    cost,
    costLabel,
    selectionCost,
    disabled,
    advisories: [],
    reasons: []
  }],
  resource: {
    current,
    max,
    summary: "{remaining}/{max}"
  },
  selectionCapacity,
  selectionCapacityReason,
  resourceInsufficientReason,
  confirmLabel,
  declineLabel,
  closeOutcome: "abort", // or "decline"
  presentation: {
    title: { fontSize, fontWeight },
    prompt: { fontSize, fontWeight },
    resource: { fontSize, fontWeight },
    optionName: { fontSize, fontWeight },
    optionDescription: { fontSize, fontWeight },
    optionCost: { fontSize, fontWeight },
    advisory: {
      fontSize, fontWeight, textColor, borderColor, backgroundColor,
      backgroundOpacity, borderOpacity
    },
    reason: {
      fontSize, fontWeight, textColor, borderColor, backgroundColor,
      backgroundOpacity, borderOpacity
    },
    confirmButton: { fontSize, fontWeight },
    declineButton: { fontSize, fontWeight }
  }
}
```

Advisories and reasons are rendered separately: advisories default to AE5E's
responder-selection orange (`#ff9f1c`) while reasons and temporary
resource/capacity blocks retain the existing red warning treatment. Presentation
overrides are optional; omitted fields retain AE5E defaults. Font sizes are
numeric pixel values from 8 through 48, font weights are 100-900 in 100-step
increments, colors are 3- or 6-digit hex values, and opacity values are 0-1.
Status text remains escaped plain text; this API does not allow arbitrary HTML.

The chooser projects resource usage locally while checkboxes change. It does not
write resources. Confirmation is revalidated against the declared generic
resource/capacity envelope; the feature transaction remains responsible for its
authoritative state/resource checks and native Foundry/D&D5e consumption.

## Metamagic collection extension

Metamagic option declarations may now optionally declare generic `phases` and
`selectionCost`. Existing option declarations without `phases` continue to
participate in `pre-cast` for compatibility.

The Metamagic casting bridge preserves Item-owned `description`,
`advisory`/`advisories`, `reason`/`reasons`, and
`unaffordableReason` offer data. It also exposes the current native resource
snapshot to the option's offer call so the Item can own its displayed
affordability wording.

v0.4.5.40 does not add option-specific late-phase execution rules. The generic
phase dispatcher is the reusable trigger foundation for later Item integrations.
