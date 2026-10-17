# Stage 1 draft validation — 16 October 2026

Baseline: `3897427c0824de69e373682fe1ee2a116141fcc3` (AE5E 0.4.5.32).
Repository validation below was completed before publication. The user authorized
GitHub publication on 16 October 2026. Publication is based on the newer
compendium-only commit `a72873a`, preserving its compendium tree. No world writes
were made.

| Check | Result |
| --- | --- |
| `npm test` on the final code | PASS, all 55 test files; no failures |
| Production syntax gate | PASS, 147 JavaScript files |
| `node tests/metamagic-stage-1.test.mjs` | PASS, 31 focused assertions |
| `node tests/choice-prompt.test.mjs` | PASS, 5 checks including escaped unavailable explanations |
| Installer, inspector and cleanup script syntax | PASS via `node --check` |
| `git diff --check` | PASS |
| Compendium/asset/manifest preservation | 123 tracked files hash-identical to baseline Git blobs |
| Live Foundry installation and GM table | NOT RUN — no live-world connection in this session |
| Player, disconnect, simultaneous-payment and persisted-benefit acceptance | NOT RUN — later milestones |
| Publication | Source preview authorized; live Foundry acceptance remains pending |

Focused coverage includes declaration validation; learned/equipment grant
provenance and removal; capacity and combination policy; effective fixed/free
prices; exact resource selection; casting-local numerical/touch range; later-cast
isolation; native consumption plan and delta shape; affordability at selection
and payment; grant changes during both dialogs; source/authority protection;
duplicate entry hooks; orphaned/cross-client markers; payload normalization;
stable casting/target/roll identity; historical snapshots after feature deletion;
and presentation failure preserving resolved mechanics.

The native-consumption test helper models the target/update/delta contract. It
does not execute Foundry's actual document, Activity or Midi lifecycle. The tests
deliberately emit two warning stacks for a simulated unavailable chat card; those
warnings verify presentation failure does not undo the cast. They are not failed
tests or observed live-world errors.

No claim is made that the full Stage 1 completion gate has passed. Use the
[GM acceptance guide](metamagic-stage-1-acceptance.md) to install locally and
exercise the actual Distant selection/payment/cast/cleanup path. Keep the broader
restrictions in the [contract](metamagic-stage-1-contract.md) until their specific
adapters and acceptance are complete.

## Installer route correction

The first live installation attempt failed before world writes because Foundry's
route helper removed a directory's trailing slash. The installer now resolves
complete filenames through the route helper for both declarations and the Macro
source. It also awaits installation at module level so callers receive failures.
Three installer regression checks pass: root hosting, path-prefix hosting and
404 failure before any Item/Macro writes. Installer syntax and diff checks pass.
These checks do not replace live casting acceptance.


## Casting-local range source correction

The first live numerical Distant attempt showed the chooser, but Midi rejected
a target at 45 feet using the ordinary 30-foot range. That attempt is not a
passing Distant acceptance result; no point-balance/refund conclusion was supplied.

A new source-backed regression reproduced numerical and Touch range loss when
the local parent Item rebuilt/cloned its Activities. Pinned D&D5e 6.0.6 source
shows native use clones the parent Item, native scaling updates its source and
reacquires the child, while PseudoDocument.updateSource only prepares its own
model. The fix atomically places the Activity patch and casting marker into the
casting-local parent source, prepares its attributes using the native pattern,
and updates both existing and reconstructed receivers. It also preserves the
local native consumption target through Activity reconstruction. Canonical Item
data remains untouched.

The latest repository gate passes all 56 test files and the 147-file production
syntax check. The focused suite now has 35 passing checks, including source-backed numerical
and Touch clones, native scaling, preparation flag restoration and rejection of
a lost range patch before accepting a native debit plan. Casting snapshots retain
expected/actual values through post-use, even without workflow completion.
The native lifecycle is still modeled in these tests, not executed in Foundry.
A new live 45-foot retry and its actual Sorcery Point balance remain pending.


## Confirmed formula/prepared-value mismatch

The user's captured revision-1 diagnostic identifies the immediate rejection:
expected range was numeric 60, the prepared child was numeric 60, and the original
receiver/workflow and parent source held formula string "60". No native debit
existed; the live point balance remained four. The patch was present, and the
strict guard rejected the unfinalized receiver rather than a reverted range.

Pinned native RangeField and FormulaField confirm string source storage and
numeric final preparation. The earlier source-backed model omitted this field
cleaning. Updating that model reproduced the user's exact rejection before the
fix. Revision 2 finalizes detached receivers with native prepareFinalData and
avoids source-updating the already prepared child afterward. Numerical, Touch,
scaling, source-isolation and pre-payment-loss checks pass, including an explicit
assertion that parent source "60" and effective receiver 60 coexist correctly.
The focused suite now has 36 passing checks. No strict value guard was weakened
and no source Item, Macro definition, pool or compendium was changed. Live
confirmation of the next 45-foot casting remains pending.


## Confirmed post-use override loss

Stage 0's range proof remains accepted. The revision-2 live report retained
numeric Activity range 60 through post-use but lost `range.override` on the
actual receiver/workflow. Midi 14.6.2's
[`activityRanges` helper](https://gitlab.com/tposney/midi-qol/-/blob/v14.6.2/src/module/utils.ts#L3471-3479)
then prefers the Item's ordinary range 30. The supplied installed checker/use
source confirms this call path. A native debit was recorded, and the reported
pool returned to four after the failed range check; this is not a successful cast.

Revision 3 restores the already selected Activity patch to matching casting-local
receivers at post-use, before Midi's range check. It does not rerun the option
Macro, add another consumption target, bypass range validation, or issue a refund.
A restoration failure leaves commitment unconfirmed; post-use cancellation alone
does not establish refund ownership. Snapshots include the pre-restoration state.

The source-backed test fixture previously aliased Item and Activity range objects,
masking the Item fallback. They are now independent. The regression first failed
with effective Midi range 30 despite Activity value 60, then passed with range 60
and exactly one native debit. Source isolation and a later ordinary 30-foot cast
also pass. The focused suite passes 38 checks; the repository gate passes all 56
test files and the 147-file production syntax check. Live Foundry confirmation
remains pending. Existing fixture Items and Macro definitions need no reinstall.


## Revision 3 live failure and Stage 0 parent-range correction

Evidence: sediment file_000000004c1c8230866837992d237b33, 16 October 2026.
Installed revision 3 selected/prepared/consumed range60/ft/override=true. At
post-use the held receiver lacked override; its attempted restoration produced
range30/ft with override still absent, while the prepared child and parent
Activity source retained 60. Midi rejected the 45-foot target. The snapshot
recorded a one-point native delta; the actual pool reported available4/spent3.
No successful cast, completed receipt or full acceptance is claimed.

Review of Metamagic Development 1 recovered the actual successful RangeParent
probe: it updated system.range on the unsaved parent Item as well as both held
and rebuilt Activities. Revision 4 carries that verified fallback forward.
A regression first failed with effective Midi range30 after live override loss.
The corrected version retains range60 via the casting-local parent, including
when held-receiver re-preparation would strip metadata and read the parent.
Mechanically correct post-use receivers are not re-prepared just to restore a
metadata field. A negative matrix rejects incorrect fallback value/units or lost
source override intent when restoration is unavailable. Touch fallback, native
cloning/scaling, one debit and later ordinary-cast isolation are also covered.

Focused suite: 39 checks pass. Full repository gate: 56 test files pass, with
147 production JavaScript files passing syntax checks; git diff --check passes.
Compendiums, assets, manifest and test Item/Macro definitions are unchanged.
These are modeled receiver/consumption contracts,
not execution of Foundry's document runtime. Live GM acceptance of revision 4 is
pending. Existing test Items and Macro definitions require no reinstall.
