# Metamagic Stage 1 contract — source preview

Baseline: remote and local `3897427c0824de69e373682fe1ee2a116141fcc3`,
AE5E 0.4.5.32. The remote was checked read-only on 16 October 2026; there are no
repository `AGENTS.md` instructions. The supplied Stage 0 closeout and Stage 1
roadmap are the evidence baseline. Stage 0's chronological/topic Markdown files
are not in this checkout. Their absence does not reopen the investigation.

This draft implements the first Distant slice for local review and GM acceptance.
Source publication is authorized. It has not been installed in the user's world
or accepted in Foundry.
The release version is unchanged. Publication preserves the newer compendium-only
commit `a72873ac5510d72440f6af95cb683c2ecbf9ffb4` as its parent.

## Ownership and declarations

`flags.action-effects-5e.metamagic` is the v1 Item declaration. All declarations
have `version: 1`, `family: "metamagic"`, `type`, a stable lowercase hyphenated
`id`, and optional `enabled`. IDs identify definitions rather than cast instances.
Native UUIDs identify the actual granting or defining document.

| Role | Contract |
| --- | --- |
| `main` | `learnedOptions` IDs, `optionChoices` capacity, `selectionLimit`, `resource.identifier` and optional `resource.itemId` |
| `option` | Stable option ID, integer `cost >= 0`, `tooltip`, `execution.macroUuid`, Item-owned `rules`, optional `presentation.html` |
| `provider` | `grants` IDs, `choiceBonus`, `selectionLimit`, `costAdjustments`; each is optional |

`catalogue` is author-owned metadata such as source, rules revision, label and
pack reference. It is not an engine-maintained option list. A pack reference
does not authorize modifying that pack or importing it automatically.

`activation` supports explicit boolean `equipped` and `attuned` requirements.
`enabled: false` disables any role. Provider-specific feature behavior can change
its own activation/declaration data; the shared runtime does not recognize class,
level, feature names, or legacy CPR/Gambits flags as rules. In this slice there is
one active main Item per caster. A disabled or absent main leaves normal casts alone.

The five required examples and an inactive discount example are in
[declarations.json](../examples/metamagic-stage-1/declarations.json). The ring
grant requires a Distant definition Item on the actor but does not count as a
learned choice. Unequipping/removing the ring removes only its provenance.
An option that is also learned remains available once. A choice-bonus ring
increases learning capacity; it does not automatically learn a new option or
allow more options on a single cast. A combination provider raises the per-cast
selection limit. Separate main Items and duplicate active definitions are
configuration errors; no arbitrary first definition is selected.

`api.metamagic.reconcile(actor)` is a read-only, freshly computed view. No
background synchronization, Item conversion, import, deletion or duplication is
performed. `await api.metamagic.learn(actor, ["distant-spell"])` updates only the
active declared main Item's chosen IDs after checking ownership, capacity and
unambiguous definitions. Unlearning uses `[]`. Embedded Item IDs remain intact.
Removing a capacity provider can expose over-capacity choices; reconciliation
reports this and casts stop until the choices are corrected. It does not silently
delete or forget features. A dedicated learning-management window is later UI work.

## Executable contract

An option references a world/compendium Script Macro by UUID. AE5E calls
`Macro.execute({ phase, declaration, context })`. `context` contains the live
casting-local Activity/Item, caster, workflow, casting ID and initiating user ID.
It is never serialized in receipts. `declaration` is a cloned snapshot.

| Phase | Result and obligations |
| --- | --- |
| `offer` | `{ eligible: true }` or `{ eligible: false, reason: "..." }`; read-only, repeatable |
| `prepare` | `{ activityUpdates: { "range.value": 60, ... } }`; calculate proposed changes without writing documents, spending, rolling, or invoking another workflow |

Reserved Activity identity/flag/consumption paths and duplicate mutation paths
are rejected. Updates to two different nested paths can still be semantically
incompatible; authors must use coherent option executables and obtain acceptance
for their combinations. General damage/save/late-reroll executables are not part
of this first range-only contract. Do not implement them by replaying a cast.

The Distant executable is shipped as an example module, installed into a new
test-world Macro, and referenced by the option Item. It is not registered by
option name in production code. Its numerical minimum, multiplier, touch range,
cost, tooltip and output template are on the example declaration/Item. Its code
handles ft/mi/m/km, Touch and unsupported range types. New declared options can be
discovered without editing any runtime catalogue, as exercised in repository tests.

Macros are trusted executable documents, not sandboxed user text. Only install
reviewed Item/Macro definitions. Option Macro updates/deletion after choice and
before execution are not a supported hot-edit workflow.

## Casting identity and authority

The awaited `midi-qol.preTargetingV2` entry assigns a random `castingId` that is
independent of Midi's mutable Activity/ChatMessage workflow ID. Duplicate entries
for the same live workflow share one pending selection. Entry/completion hooks
normalize the direct, workflow, config.workflow and usage.workflow envelopes
recorded in the Stage 0 diagnostic reader. The native spell clone
receives a temporary `flags.action-effects-5e.casting` marker with schema, casting
and initiating-user IDs. It is not written to the source Item.

The initiating client captures `game.user.id` even when `workflow.userId` is null.
It must own the caster; a non-null conflicting workflow user ID is ignored.
Execution stays on that client. ChoicePromptService receives that explicit
controller, reusing existing routing and selection indicator/audio behavior.
Cross-client payment, disconnect takeover and player acceptance remain pending;
the current draft does not claim authority transfer across clients.

Every record captures full caster Actor/Token and source Item/Activity identity,
cached equipment provenance and native linked `cause`. Target snapshots use full
Actor and Token UUIDs. `api.metamagic.eventIdentity(castingId, event)` serializes
casting, phase, exact target Actor/Token and roll ID as a collision-resistant tuple.
It never substitutes a base Actor ID for a synthetic token actor.

`parentCastingId` and `continuation` are explicit reserved API inputs. Requests
using them currently stop with an explanation until a validated parent adapter
exists. Equipment provenance alone does not establish an original casting.
No-slot usage and same-Item/latest-cast heuristics are never used for parentage.
Do not enable this draft for sustained/continuation spells pending that adapter.

## Selection, effective cost and native consumption

The active main resolves exactly one existing native Item by `system.identifier`
and optional Item ID. The installer pins the existing `sorcery-points` Item ID;
it creates no point pool and does not alter Font of Magic conversion Activities.
Pool deletion/automatic destruction is unsupported.

Effective option price is `max(0, baseCost + sum(active provider adjustments))`.
Receipts preserve each adjustment's label and source UUID. This is a fixed
integer-price first slice. Conditional/free-use counters and rules for Innate
Sorcery, Sorcery Incarnate and Arcane Apotheosis require later Item-owned
executables and acceptance, rather than hardcoded feature switches here.

The existing prompt shows unavailable reasons. Selection is revalidated after
the wait, including changed definitions, grants, activation, price, affordability
and combination limits. Prices of selected options are summed and checked again.
The chooser continues without another modifier when closed; cancelling the
subsequent native spell configuration stops casting before any payment.

Range updates and a temporary cast marker apply only to an established
casting-local Item/Activity clone. Canonical embedded source documents are
rejected, rather than modified temporarily and restored later. The patch and casting marker are written together to the local parent Item source
at `system.activities.<activityId>.*`, using native embedded/final preparation and
restoring the prior preparation flag. Existing Activity receivers and the newly
prepared child receive the same fixed values. This keeps native use/scaling clones
from restoring ordinary spell range. Native `preUseActivity` and pre-consumption
preparation repeat those fixed values idempotently. The pre-write payment gate
rejects a lost selection patch before accepting the native debit plan.
At `preActivityConsumption` (after native configuration/scaling), the service
appends one native `itemUses` target for the total modifier cost and includes it
in consumption even if spell-slot consumption is disabled. The target cannot be
unchecked independently after accepting the modifier. Zero-price offers add no
target but still require the normal native consumption confirmation.

D&D5e calculates affordability, proposed updates and deltas and performs its
normal bulk update. AE5E's synchronous `activityConsumption` listener verifies
the proposed point debit before writes. A spell or linked Activity already
consuming that same pool requires a combined-cost adapter and is stopped, avoiding
native target-plan overwrites. AE5E does not debit an Item independently and does
not install another same-workflow native refund guard.

This follows pinned D&D5e 6.0.6 source at
`87e94dbd9f930135e0694cd7e7d49f210603cd2c`,
`module/documents/activity/mixin.mjs` and
`module/data/activity/fields/consumption-targets-field.mjs`, together with the
supplied installed Midi 14.6.2 `postChatCardChecks` source. Source compatibility
is not live acceptance of this implementation.

## Commitment, receipts and failures

States: `preparing → selected → native-prepared → consumed → committed → completed`.
No selection is `unmodified`; preparation errors are `rejected`. Completion
without the accepted transition is `unconfirmed`, not a guessed cancellation.

Native `postActivityConsumption` records the actual native deltas and payment
owner and seeds `flags.action-effects-5e.castingReceipt` in the existing message
configuration. The awaited `postPreambleComplete` transition is this slice's
candidate commitment point, conditional on native consumption confirmation.
The existing message gets updated receipts and an Item-authored contribution
through ChatCardAdapter. It reports selection and cost, without exposing private
roll totals/targets or rebuilding native controls. Contribution writes failing
do not undo mechanics; the receipt records presentation failure.

Closing before selection/configuration or a native pre-write veto incurs no
charge. Installed Midi's post-card target/range rejection calls native
`Activity.refund` on the original message deltas, which include the point debit.
Native refund owns that entire debit, including separate slot behavior. AE5E
does not make a second refund call. GM acceptance must verify final balances.
After commitment, a miss, successful save or later aborted flag never causes an
AE5E point refund. Font of Magic conversion remains its separate native transaction.

An arbitrary external post-consumption veto, failure between native writes/card
creation, module-owned deletion, or unannounced workflow abandonment has no
proven universal refund signal. This first slice does not infer one from a card
or aborted flag; such paths are unsupported and require an explicit adapter
assigning native-vs-separate debit ownership. Native manual refund controls remain
native. There is no promise of an atomic transaction across clients, crash-safe
payment recovery, or concurrent native bulk writes; these require acceptance and
possibly additional infrastructure before production use.

Records use workflow WeakMap/WeakRef associations; diagnostic history is bounded
to 100 latest casting snapshots, including selected/native-consumption stages
that may never reach completion. These snapshots are not cancellation/refund
claims. `runtimeRevision: "activity-source-bridge-2"` and `activityChecks` show
expected, receiver, prepared-child, parent-source and workflow values at each
observed boundary. Abandoned live records
can be inspected by workflow while it exists; no timer refunds them. The message
receipt is historical evidence, not an outstanding credit to spend or refund on
startup. Distant creates no ongoing ActiveEffect, grant, or concentration anchor.

## Contract reserved for lasting benefits

Later options use a separate persisted `flags.action-effects-5e.castingGrant`
schema. Do not mistake this design contract for implemented startup recovery:

```json
{
  "version": 1,
  "grantId": "unique-grant-id",
  "castingId": "independent-casting-id",
  "parentCastingId": null,
  "caster": { "actorUuid": "Actor...", "tokenUuid": "Scene...Token..." },
  "origin": { "itemUuid": "Actor...Item...", "activityId": "..." },
  "target": { "actorUuid": "Scene...Token...Actor...", "tokenUuid": "Scene...Token..." },
  "modifier": { "id": "declared-option-id", "sourceUuid": "Actor...Item...", "snapshot": {} },
  "lifecycle": { "anchorUuid": "Actor...ActiveEffect...", "kind": "native-dependency" },
  "execution": { "adapter": "validated-transport-id", "version": 1 }
}
```

The target carrier's creation adapter must attach the exact casting/grant
association before persistence. Native `flags.dnd5e.dependentOn` and native
dependency registration own concentration cleanup; source Item/target equality
must not broaden ownership. Startup must enumerate active persisted carriers,
validate schema and anchors, reconstruct only the relevant transport adapters,
and deduplicate by grant/event identity. An absent historical chat card or deleted
feature Item does not erase a durable snapshot. The stored rules snapshot and
versioned transport must execute without dereferencing a deleted granting Item.
Exact-Effect OverTime, original-card repeats and explicit sustained continuations
need separate validated transports. None is implemented by Distant's instant
range change; no extra standalone Stage 0 reload probe is scheduled.

## Ordered backlog

1. Run the local-install GM slice in the companion acceptance guide; resolve any
   clone/scaling/hook mismatch with its specific evidence.
2. Complete learning UI and management cases (grant removal, capacity changes,
   stable Item identity), then fixed/conditional cost and combination policy.
3. Add the simplest casting-local options (Subtle, Transmuted, Quickened) through
   Item definitions and narrowly validated mutation windows.
4. Add native persisted-grant/startup/cleanup transports for Extended, Heightened
   and Careful; include feature deletion, exact carrier and combined reload checks.
5. Add Empowered's selected-die replacement and Twinned's scaling/slot policy.
6. Add Seeking only with a validated late reclassification adapter that preserves
   reaction results; do not blindly call native hit checking a second time.
7. Implement Innate Sorcery, Sorcery Incarnate and Arcane Apotheosis as Item-owned
   providers/executables using existing Sorcery Points/Font of Magic.
8. Player/socket authority, disconnect and simultaneous-write acceptance across
   the integrated suite. Automated Counterspell remains explicitly unsupported
   unless a future provider supplies and validates a countered outcome.

Preserve the Stage 0 final isolation report's raw false matrix flag and reviewed
reporting-defect explanation. It is not a reason to repeat the accepted range,
refund, concentration or standalone reload probes.


## Formula-field preparation

D&D5e 6.0.6 RangeField.value is a FormulaField extending StringField. Its parent
source stores `"60"`; native final preparation evaluates the live distance to
`60`. The source update and native final preparation are separate operations.
The current child is finalized through Item.prepareFinalAttributes. Detached
receivers still held by Midi are updated and then finalized through their native
Activity.prepareFinalData. The prepared child is not source-updated again after
final preparation. Strict pre-payment validation remains in place on effective
values; it is not replaced with loose string/number equality.
