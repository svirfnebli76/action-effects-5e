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
