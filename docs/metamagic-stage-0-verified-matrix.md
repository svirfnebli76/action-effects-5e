# AE5E Metamagic — Stage 0 Closeout and Stage 1 Handoff

14 October 2026 · GM investigation · AE5E 0.4.5.31

## Status and next step

Stage 0 investigation is closed within the agreed five-item closeout scope. The GM-tested lifecycle mechanisms and known unsupported paths are recorded below. This is not acceptance of a finished Metamagic suite.

The next chat should begin Stage 1: define the item/provider declarations, casting identity, authority, resource/result contracts and examples specified by the roadmap. Do not restart basic range, refund or reload probes without new conflicting evidence.

This chat changed investigation scripts and documentation only. No production AE5E runtime, manifest, assets or existing compendiums were changed or published. Temporary Items, cached spells and Effects from the final probes were removed. Normal diagnostic chat/roll records may remain.

Prepared 14 October 2026, America/Los_Angeles. The installed runtime baseline is AE5E 0.4.5.31. The local /workspace/action-effects-5e checkout began at 0.4.5.19; refresh the authoritative repository and inspect its instructions before implementation. /workspace/reference-sources/ae5e-current is a researched 0.4.5.31 snapshot, not a promise that the remote has stayed unchanged.

## Project constraints and ownership

- User permits direct AE5E GitHub publication; a ZIP is not required. Never overwrite or alter existing compendiums. Create a new compendium only on a specific user request. Reference-document workflows do not expand that permission.

- Existing actor Metamagic Items are mixed CPR/Gambits material and are not authoritative AE5E feature definitions. Preserve them during development.

- Leave Symaali's wild_magic_surge and wild_magic_max_damage actor macros unchanged. They ran during cantrip probes and exited through existing logic.

- Build an integrated suite: main Metamagic, all ten options, existing Sorcery Points/Font of Magic, Innate Sorcery, Sorcery Incarnate and Arcane Apotheosis. Use the existing point pool; no second pool.

- Option rules, eligibility, costs, tooltips and executable feature behavior belong on Items. Generic infrastructure owns declaration discovery, timing, transactions, identity and presentation; do not add a feature-name switch catalogue.

- User ran Stage 0 as GM. Player acceptance is deferred until implementation, as requested. Console diagnostics must print serialized, uncollapsed text with explicit combat and resource instructions.

- User accepted prior reload evidence as sufficient. Combined implementation reload acceptance is later work; do not schedule another standalone persistence probe merely to repeat it.

## Last observed environment

Gambits/CPR legacy metadata on Items does not establish an active provider. The Counterspell inspection showed no active Gambits/CPR in the relevant module inventory. User confirmed Counterspell is not currently in use. Do not activate or repair unrelated Counterspell automations for this project.

| Component | Version |
| --- | --- |
| Foundry VTT | 14.369 |
| D&D5e | 6.0.6 |
| AE5E | 0.4.5.31 |
| Midi-QOL | 14.6.2 |
| DAE | 14.6.1 |
| CAT | 0.1.2 |
| AC5E | 14.606.2.3 |
| Effect Macro | 14.0.1 (earlier full runtime inventory) |
| Midi Item Showcase Community | 2.0.2 (Counterspell inspection) |

## The five closeout areas

| Area | Result and boundary |
| --- | --- |
| 1. Seeking miss timing | LIVE: awaited midi-qol.hitsChecked after one native checkHits. Miss total9 vsAC15; downstream events occurred only after the diagnostic confirmation closed. Complete late reroll/reclassification without reaction replay is still an implementation constraint. |
| 2. Commitment / cancellation | LIVE: native preUseActivity false stops before consumption/card creation; accepted utility traverses consumption, card, targeting, preamble and resolution. Source proves post-card validation can still refund. Automated Counterspell integration is explicitly unsupported/unverified in this world. |
| 3. Casting origins | LIVE: off-turn reaction, native equipment Cast/cache, initial sustained use and continuation. Equipment provenance survives through cachedFor/cause. Continuation has a new workflow but no native unique parent-cast ID; explicit bridge required. |
| 4. Isolation / advantage / concentration | LIVE: distinct diagnostic A/B records on same source/target stay isolated; native advantage cancels A disadvantage and benefits B. Native endConcentration removes dependent A while preserving independent B and native advantage. All final fixtures removed. Raw matrix flag had a recorder-label defect; ordered evidence review verifies results. |
| 5. OverTime warning | Characterized against supplied DAE/Midi note section9: end-turn Activity checked at turn start produces misleading lookup warning; actual end-turn saves succeed. Different from blank DAE callback lookup and suppressed expired carrier problems. |

## Verified lifecycle and trigger matrix

Runtime evidence is GM-only on the stated fixtures and module versions. A source-established ordering or cancellation rule is not blanket acceptance of every module combination. Midi workflow IDs can begin as Activity UUIDs and later become ChatMessage UUIDs; use an independent casting identity.

In the accepted utility trace: preTargetingV2 → preItemRollV2 → native preUseActivity → preActivityConsumption → activityConsumption → postActivityConsumption → postUseActivity/card → postNoAction → targetingComplete → postPreambleComplete → preWaitForAttackRoll → preWaitForSaves → RollComplete → postRollFinished. Names containing Attack do not imply an attack occurred.

| Window / API | Payload and established use | Authority / abort limit |
| --- | --- | --- |
| Midi preTargetingV2 | Workflow/current Activity and usage context; cast-local mutation before relevant checks. Awaited false cancellation tested. | GM initiating client tested; source Item stays unchanged. Not all reaction providers tested. |
| D&D5e preUseActivity | Activity, usage config, dialog config, message config. False veto tested before resource updates and card. | Synchronous native veto; no automatic refund of a separately charged cost follows from returning false. |
| Native consumption hooks | Activity, config, message config and proposed updates; itemUses plans/spend/refund tested. | Pre and activity consumption false reject updates. Post hook runs after writes; false is not rollback. |
| postUseActivity / card checks | Native card and usage deltas exist before Midi postChatCardChecks. | Card/consumption alone are not commitment; target/range rejection can directly Activity.refund and delete card. |
| Targeting / preamble / resolution | Targeting checks and CAT abort/refund checkpoints precede resolution. Accepted transition sequence verified. | Semantic commitment belongs after accepted validation. Confirm transition in production; no universal countered-cast event proved. |
| postWaitForAttackRoll / preCheckHits | Mutable attack d20 and native setAttackRoll; natural fumble state recovery tested. | Before checkHits reaction resolution; not a general finalized-miss predicate. |
| hitsChecked | Workflow native hit sets and scalar target display row; awaiting a confirmation tested after native checkHits returns. | Native hit check invoked once. Does not itself supply a pure late reroll-and-hit-reclassification API. |
| preTargetSave | Target token, Workflow, save details / native RollModifierTracker. Attributed DIS added for selected target. | Initial saves and exact-Effect OverTime repeats proven. Preserve other sources; no broad Actor DIS flag. |
| Original-card repeat save | Installed save handler passes direct config.workflow; Midi accepts explicit midiOptions.advantageByChoice with native trackers. | Changing only saved targetSaveDetails did not reach repeat roll. Clean-target explicit-map route verified, not universal recomputation. |
| Mutable damage window | Native roll parts/dice, total/type and subsequent damage payloads. Retag and selected-die replacement tested. | Preserve dice identity/history; do not replay full workflows or flatten damage profiles. |
| Target damage application | Selected protected target has workflow superSaver behavior before native downstream damage. | One half-on-save fixture proved zero vs ordinary half damage; not all damage/defense combinations. |
| Concentration roll configuration | Native system.attributes.concentration.roll.mode additive change on concentration Effect. | Only concentration benefited, ordinary CON stayed normal; persisted across reload and ended with Effect. |
| OverTime / native dependencies | workflowOptions.overTimeEffectUuid identifies target carrier. flags.dnd5e.dependentOn registers native dependence. | Active GM native dependent deletion tested. Source Item alone is insufficient per-casting identity. |
| Item Cast / cached spell | pre/postUseLinkedSpell, dnd5e.cachedFor, sourceItem, source reference and message.system.cause. | Equipment origin verified; these identify source, not a unique original casting. |
| Chat presentation | Use AE5E completeActivity/upsertContribution/removeContribution and existing native message. | Prior Devious Strikes acceptance is reference evidence. Do not rebuild the card API; preserve viewer masking. |

## Earlier option-mechanism findings

| Mechanism | Established diagnostic evidence; important limit |
| --- | --- |
| Distant | Cast-local range60 allowed a45ft Poison Spray; ordinary range30 rejected afterward. No canonical mutation. Other range types await option acceptance. |
| Subtle | Cast-local V/S and tested material property changes propagated while source metadata stayed unchanged. Separate consumed/costly material and item-command rules remain item-owned. |
| Transmuted | Cast-local damage type replacement reached downstream damage while preserving dice; source spell unchanged. Mixed profiles and defenses need actual option acceptance. |
| Empowered | Selected d12 replacement retained discarded history and recalculated downstream total; lower replacement case also examined. Full eligibility/payment/UI not implemented. |
| Seeking | Native setAttackRoll and natural1/fumble recovery established; final miss pause now proved. General late result reclassification and reaction interactions remain restricted. |
| Heightened | Chosen target initial DIS, explicit-map original-card repeat, exact-Effect OverTime repeat, saved grant recovery and automatic pre-create attachment all established in separate fixtures. |
| Quickened | Cast-local bonus activation produced native Bonus Action Used/count; next turn cleared it. World enforcement was displayOnly, so hard blocking not proved. |
| Twinned | Prepared Invisibility scaling increased target count while late consumption used actual2nd-level slot; both target effects shared concentration. General slot/item/eligibility cases not accepted. |
| Extended | Prepared Guidance duration120s created120s concentration; source remained1minute. Native concentration-only advantage persisted and ended with concentration. Arbitrary target-buff extension not proved. |
| Careful | Selected target automatic success and superSaver zero-on-half damage fixture passed; ordinary second target took half. Full rules, target limits and repeated-save policy need actual feature acceptance. |

## Resources, refunds and commitment

Existing Sorcery Points pool is Actor.wxeRMRdZhusJLxt0.Item.vyFbXSfGkkCuI0dh, identifier sorcery-points. Final observed max7, spent3, available4. Legacy Sorcery Incarnate is not an authoritative Metamagic implementation.

Native affordable update plans affect only the point pool; an unaffordable plan rejects. Native one-point consume/refund and pre-write vetoes were verified. The original failed attack-veto test was recovered and retired; do not rerun it.

The user-requested duplicate-refund test issued three requests on the same Midi workflow, including an overlapping request. Native Activity.refund ran once, restoring the original balance. The extra requests were generated by the probe, not evidence of naturally competing modules. Do not add another guard for that exact path without new evidence.

Workflow.refundConsumption has an instance guard set before awaiting the refund. Direct Activity.refund, including the installed postChatCardChecks rejection helper, is a distinct path. Assign refund ownership to each actual debit and verify resulting balances; do not infer a universal rollback from abort/removal or from the existence of a card.

Roadmap rule: pre-cast cancellation refunds Metamagic payment; after casting, a miss, successful save or Counterspell does not refund it. Conversion remains its own transaction. Inactive Counterspell automation prevents claiming its current event boundary is live-tested. A future provider needs an explicit countered outcome; spell-slot refunds under its rules are separate from Sorcery Point policy.

## Identity, persistence and cleanup contracts

- Use stable castingId independent of mutable workflow/card IDs. Preserve full target Actor/Token UUIDs; two unlinked tokens can share a base Actor ID.

- Saved grant should contain schema, castingId, caster, originating spell/Activity, exact target, modifier and lifecycle anchor. Probe field names/fixture snapshots are not a finalized production schema.

- Automatic attachment was proved using preCreateActiveEffect.updateSource on only the exact fixture target/session, before native persistence. The later workflow read the original casting association from that Effect.

- Reload recovery was independently proved by a fresh adapter reading persisted Effect data. Probe reconstruction was manual; automatic AE5E startup registration is not built. Absence of an old chat card should not erase an active grant.

- OverTime repeats supply exact carrier UUID and create a new workflow. Original-card repeated saves follow a different transport route. Build adapters for the actual route; do not rely on a single old workflow object.

- Native concentration dependency registration and active-GM deletion preserve independent carriers. A same source Item/target pair must not imply the same casting or cleanup ownership.

- The final native WIS advantage source was preserved in the tracker alongside attributed DIS. Both sources canceled for A; B retained ADV. Ordinary controls stayed scoped appropriately.

- Feature-Item deletion is not the same as ending a spell. Snapshot durable benefits so an ongoing casting does not depend on the granting feature continuing to exist; actual feature deletion/readdition acceptance remains later.

- Observed workflow.userId was null in origin probes. Capture initiating/controller authority explicitly; do not assume that property always identifies an owner. Player/socket acceptance is deferred.

## Final isolation result and reporting defect

The raw final probe printed matrixPassed=false because the Actor-method recorder left the four automatic result role/workflow fields null, producing empty per-role summary arrays. This is retained as a diagnostic reporting defect; it is not silently relabeled as a clean original pass.

Each actual roll is unambiguously bracketed by a source-tagged repeat-tracker and its matching repeat-complete record, with exactly one result and no overlapping spans. Offline validation reconstructs the matrix below from those events. The reporting code was corrected and checked against the captured evidence and an ambiguous-record negative case. No additional Foundry run was performed or requested.

Native cleanup was independently explicit: concentration gone=true, A gone=true, B remains=true, advantage remains=true. Final cleanup: temporary Item gone, target fixtures gone, concentration gone, wrapper restored, original Guidance unchanged, resources/HP/source roll unchanged. The independent evidence review JSON preserves the raw false flag and the reasoning for the reviewed result.

| Condition | A (grant) | B (control) |
| --- | --- | --- |
| Without native advantage | DIS, total3, mode-1 | Normal, total2, mode0 |
| With native advantage | Normal, total19, mode0 | ADV, total9, mode1 |
| Native concentration ended | Dependent A removed | Independent B remains |
| Ordinary controls | Baseline normal11; native-ADV control10 | Final normal19 after fixture removal |

## Known restrictions and later acceptance

- Seeking: the final miss observation/pause point is established, but no universal pure late re-evaluator preserving arbitrary reaction outcomes has been proved. Disable unsupported cases or implement a specifically validated adapter; do not rerun checkHits blindly.

- Commitment: consumption/postUse/card creation is too early. The accepted-resolution sequence is a candidate semantic boundary, not a universal Counterspell-aware event. Do not treat every later aborted flag as a refundable pre-cast cancellation.

- Continuations: same Item and no slot consumption are insufficient parent-cast evidence. CAT's isSustainedRoll heuristic includes fresh no-slot spells. Require explicit parent identity; do not choose the latest same-Item cast.

- The known start-turn OverTime warning matches the prior note's timing skip, with successful end-turn execution. Exact explanatory source was14.6.0; current14.6.2 text/stack/timing matches. Reopen if an intended end-turn save fails. Do not apply Knock Out's blank-callback or expiry fixes indiscriminately.

- GM fixtures do not prove all options, discounts/free uses, real multi-target/attack cases, suppressed/forced modifier variants, source-feature deletion, disconnect recovery or concurrent-player writes. Those require implementation acceptance.

- Diagnostic casts used no-cost cantrips, altered DCs and condition-free carriers. The simultaneous-carrier test directly assembled records; it did not demonstrate two legal simultaneous concentration spells.

- Native action bookkeeping and normal test chat records can occur. Source/point/slot/HP comparisons establish their stated scope; no claim of a byte-identical whole world is made.

## Stage 1 entry checklist

- Refresh the authoritative AE5E repository; inspect current AGENTS.md and current production code before edits. Keep compendium content unchanged.

- Finalize versioned main/provider/option declarations, stable identifiers, catalogue/pack metadata, provenance, grant activation and item-owned executable references.

- Define casting identity, per-target/per-roll event identity, explicit parent/continuation associations and authority when Midi userId is absent.

- Define cost/combination modifiers, explanations and result receipts. Reuse existing Font of Magic pool. Coordinate native consumption ownership; do not add speculative duplicate refund logic.

- Define cancellation/commit outcomes and pre/post-cast failure handling. Keep unsupported integrations visible as restrictions; do not imply Counterspell support.

- Define persisted grant schema, lifecycle anchors, native dependency registration and initialization reconstruction. Preserve benefits through feature-source deletion as required by rules.

- Produce example declarations for main Metamagic, Distant, a ring granting Distant, a ring adding a choice and a feature allowing two options. Demonstrate discovery of a new declared option without editing an engine catalogue.

- Continue the staged roadmap: management/reconciliation, resource/casting state, popup/chat, first end-to-end Distant, then additional options/features and final player acceptance. Do not jump into all-ten implementation in the first Stage 1 step.

## Local references and evidence index

Current summary/matrix: /workspace/action-effects-5e/docs/metamagic-stage-0-verified-matrix.md. Chronological log: docs/metamagic-stage-0.md. Topic documents: metamagic-cancellation-ownership.md; metamagic-persistence-investigation.md; metamagic-heightened-later-saves.md; metamagic-seeking-final-miss.md; metamagic-origin-paths.md; metamagic-isolation-and-cleanup.md.

Investigation scripts: /workspace/action-effects-5e/examples/AE5E_Metamagic_Stage0_*.js. These are diagnostic code, not installable Metamagic features. Some historical probes were retired; follow topic documents instead of rerunning every file.

Original roadmap: /workspace/attachments/e2de1087-410f-4897-935b-c57a581887ae/AE5E_Metamagic_Project_Roadmap_and_Handoff.docx. Prior warning reference: /workspace/attachments/1646d5ca-ce97-422c-8b0a-00e8a7ac62b6/DAE-Midi-Expiry-and-Activity-Lookup-Fix.docx, section9.

Sources: user-supplied installed-code excerpts and native Foundry outputs take precedence over moving public Midi branches. D&D5e6.0.6 pinned87e94dbd9f930135e0694cd7e7d49f210603cd2c; CAT0.1.2 pinnedb576949a67603616a505cfda8bdc193ab446fff9. Current AE5E card APIs and the accepted Devious Strikes Development 3 work provide prior chat/presentation evidence.

| Evidence | Sediment file ID |
| --- | --- |
| Duplicate refund requests, one actual refund | file_00000000ee4c81fd83f9de1528a0b4fc |
| Original-card repeated-save explicit map | file_00000000082481fd96bd5d0869aa617b |
| Automatic OverTime disadvantage | file_00000000a44c81fd8246a9581acdda05 |
| Reloaded grant / native successful-save deletion | file_00000000048081fd938b368438e9dc79 |
| Automatic cast-to-Effect attachment | file_000000001c1c81fd8c537e7ffedc6a0a |
| Finalized miss awaited gate | file_0000000082bc81fd825107220e5462b0 |
| Installed Counterspell / validation source | file_00000000840c81fd80cc4f101e217a54 |
| Native veto and accepted usage trace | file_00000000fc40823083a1f4397da55963 |
| Reaction / equipment / continuation origins | file_00000000316081fd9d261b78320fa8d2 |
| Final isolation, native advantage, dependent cleanup | file_00000000acf481fd8a9ae34171f11644 |
