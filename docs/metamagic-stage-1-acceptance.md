# Stage 1 local installation and GM acceptance

Status: **Stage 1 source preview; Foundry acceptance pending**. Do not describe
the scripted repository models as live casting, range, resource or player tests.
The user authorized GitHub publication on 16 October 2026. This source preview
preserves the latest compendium-only commit `a72873a`. No live-world installation
or Foundry acceptance has been performed.

## Local installation

Use a separate Foundry test world and a disposable caster with an existing native
Sorcery Points/Font of Magic Item (`system.identifier: "sorcery-points"`). Retain
its existing resource relationship. Do not use this installer to convert the
character's CPR/Gambits Items. Leave `wild_magic_surge` and
`wild_magic_max_damage` unchanged.

Baseline is AE5E 0.4.5.32 at commit `3897427`. Copy these reviewed draft files
from this checkout into the local module installation, preserving relative paths:

- `scripts/metamagic/declaration-service.js`
- `scripts/metamagic/casting-service.js`
- `scripts/action-effects-5e.js`
- `scripts/api.js`
- `scripts/ui/choice-prompt-service.js`
- The complete `examples/metamagic-stage-1/` directory.

Keep the installed module's manifest, `packs/`, assets and existing world documents
unchanged. The draft intentionally retains version 0.4.5.32; check for
`game.modules.get("action-effects-5e").api.metamagic` to identify these local files.
Restart/reload Foundry after local file replacement. This is the necessary
implementation load, not another standalone persistence probe.

Run as GM. No combat is required for installation. Control exactly one disposable
caster token and paste [install.js](../examples/metamagic-stage-1/install.js) into
the browser console. It creates only two new tagged test feature Items on that
caster and one tagged world Script Macro, pins the existing point pool, and
prints serialized installation details. The main Item holds learned choices;
Distant holds its cost, rules, tooltip, output template and executable reference.
The world Script Macro remains editable independently of the module catalogue.
Running the installer again preserves existing tagged Items and their IDs.

Confirm the installed versions using
[inspect.js](../examples/metamagic-stage-1/inspect.js), also GM-only and read-only.
Stage 0 investigated Foundry 14.369, D&D5e 6.0.6, Midi 14.6.2, CAT 0.1.2 and DAE
14.6.1. If these differ, record the actual versions before relying on hook/API
compatibility. The console output is chunked serialized text, not expandable
object references.

## Focused implementation checks

These checks exercise the new implementation, rather than repeating Stage 0
mechanism research. No combat is required unless the chosen test spell/world
enforces it. If combat is already running, use the caster's fresh turn or end
combat before testing; use native turn advancement for action bookkeeping.
For the range/payment slice, prefer no-cost, non-concentration test
cantrips with no damaging/effect payload. Use a disposable target with enough HP
if an actual attack/save spell is used. Do not test Counterspell or sustained
continuations in this slice.

Record point `max`, `spent`, `available`, source spell range and source Item UUID
before each case. An accepted Distant casting costs **1 point**; ensure at least
1 point is available. Change only disposable fixture resources if a low-point
case is needed. Inspection and installation themselves never spend/refund points.

| Case | Procedure | Expected result |
| --- | --- | --- |
| Discovery | Inspect declarations and use a numerical-range spell | Distant is offered through its Item's Macro; exactly one active main and the existing pool resolve |
| Numerical range | Use a 30 ft test spell against a target 45 ft away; choose Distant | Casting-local range is 60 ft, native validation permits the target, one point is consumed, source range remains 30 ft |
| Touch | Use a Touch test spell against a legal target within 30 ft; choose Distant | Casting-local range is 30 ft, point cost is 1, source stays Touch |
| Ordinary later cast | Use the same spells and continue without Distant | Original range applies; no modifier point cost; the 45 ft target is rejected by an ordinary 30 ft cast if range enforcement is active |
| Choice close | Close the Metamagic choice window | Base spell continues without Distant or a modifier charge |
| Native configuration cancellation | Choose Distant, then cancel the native spell configuration dialog | No point or slot charge; no source change |
| Post-card native rejection | Choose Distant but intentionally fail native target/range validation (e.g. target beyond even doubled range) | The original native refund restores points and slots exactly as appropriate; no AE5E second refund |
| Affordability | Use a disposable caster with 0 points | Distant has an unavailable reason and cannot be selected; continue without a modifier remains available |
| Grant activation | Unlearn Distant, add the ring-provider declaration to a new disposable equipment Item, equip/attune it | Distant is granted without becoming learned; unequip/unattune/remove the provider and the offer disappears; no Item duplication |
| Learned plus granted | Learn Distant while that ring is active | One Distant offer, with both provenances; removing the ring retains the learned option |
| Choice capacity | Add/remove the choice-bonus declaration on a new disposable provider Item | Read-only reconciliation changes capacity; a lost bonus does not delete existing option Items or silently trim learned choices |
| Changed grant while waiting | Remove the only Distant access while either chooser or native configuration is open | The stale paid selection stops before native payment; no source mutation |
| Free price | Enable the explicitly labelled test discount provider on a disposable Item | Effective cost 0 with source-labelled adjustment, native completion confirmation, no point debit |
| Combination policy | Add a second disposable declared option with a distinct nonconflicting mutation and allow-two provider | Limit and combined affordability are enforced, one aggregate point debit; removing the provider restores one-option limit |
| Miss / successful enemy save | Use a suitable accepted Distant attack/save spell, then miss or have the enemy succeed | Point payment remains; no AE5E automatic refund for a resolved outcome |
| Isolation | Use an unrelated spell between modified casts | No inherited selection/range, and only the chosen casting has its receipt |
| Source deletion after completion | Delete the tagged test Distant feature only after the casting completes | Existing chat contribution/receipt retains its snapshotted information |
| Presentation | Inspect native card, rerender it, and retain the recorded result | Selection/cost contribution appears once; native rolls, masking and controls stay intact |

For learn/unlearn:

```js
const api = game.modules.get("action-effects-5e").api;
const actor = canvas.tokens.controlled[0].actor;
await api.metamagic.learn(actor, []); // unlearn, preserving embedded Item identity
await api.metamagic.learn(actor, ["distant-spell"]);
console.log(JSON.stringify(api.metamagic.reconcile(actor), null, 2));
```

Provider examples are in [declarations.json](../examples/metamagic-stage-1/declarations.json).
Only add them to **new disposable test Items**. The installer does not equip
rings or create these optional provider fixtures automatically. A new option's
definition and Script Macro must be added to the test actor before learning or
granting its stable ID. A provider is not a request to import compendium content.

After each casting, run the inspector and retain its plain-text report with
actual resource balances and the receipt. `consumed` without `committed` means
the candidate transition did not occur. Do not treat it as either a successful
refund or a completed paid cast. Record that exact failure and stop that path;
the next change should address the specific adapter mismatch, not restart the
entire Stage 0 investigation.

## Restrictions and cleanup

Supported acceptance target: one initiating GM, ordinary initial spell cast,
casting-local clone, native consumption, installed native target/range rejection
refund and the accepted preamble sequence. Player/socket execution, cross-client
handoff, simultaneous writes to one resource, native manual refund policy,
arbitrary module post-consumption vetoes, crash recovery, equipment-origin
variants, original-card repetitions and sustained continuations require separate
acceptance/adapters. Automated Counterspell remains unsupported.

Distant creates no persistent grant; no extra standalone grant/reload probe is
needed. Later persisted options require the combined startup/reconstruction gate
specified in the contract. Seeking's late reclassification remains restricted.

After all test casts finish, run
[cleanup.js](../examples/metamagic-stage-1/cleanup.js) as GM with the same caster
controlled. It removes only tagged feature Items, never the pool/spells/legacy
Items. Completed test casts legitimately consumed points; cleanup does not refund
them. Optional provider fixtures added manually must be removed manually. The
tagged Distant world Macro is retained in case another test actor references it;
delete only that new Macro manually after all test actors are finished. Existing
actor Wild Magic macros are untouched.

## Repository validation and handoff

Run `npm test` for the repository gate. Run
`node tests/metamagic-stage-1.test.mjs` for individual focused assertion results.
The native consumption helper in that suite models the verified native
target/update/delta shape; it is not an executed Foundry Activity implementation.
No automated output is evidence that the user has run the GM table above.

Stage 1 completion requires the live Distant selection/payment/cast/cleanup slice
in addition to these code checks. The contracts and ordered backlog are in
[metamagic-stage-1-contract.md](metamagic-stage-1-contract.md). GitHub publication is authorized; live GM acceptance remains the next gate.


## Applying the casting-local range correction

After the chooser/45-foot failure, update the module source and reload the GM's
browser page so the revised casting service is loaded. Keep the installed test
Items and their Macro; this fix does not change their definitions or require
reinstallation. Before retrying, inspect the existing pool. If the failed test
has not returned to its four-point baseline, report the actual balance rather
than manually resetting it or casting again.

On the next single Distant attempt, the inspector should show
`runtimeRevision: "activity-source-bridge-3"`. Its `activityChecks` record
`range.value: 60`, `range.units: "ft"` and `range.override: true` in the relevant
live receivers. Parent-source `range.value` is the formula string `"60"`; that
is correct native storage, while prepared receivers should report numeric `60`.
A selected/consumed snapshot alone does not prove
commitment or a refund. Retain the actual point balance and any range warning
along with this report; do not repeatedly recast on a failed boundary.
