## v0.4.2.5 CAT metadata context-menu acceptance

After installing/reloading v0.4.2.5, run `await game.modules.get("action-effects-5e").api.tests.runCatMetadataContextMenuTest({notify:true})` as GM. Then open an approved AE5E public compendium and right-click an Item: `Edit Item Version` should appear. Confirm the editor pre-fills Item Name, Item Type, Identifier, Ruleset, provider, and existing/default version; cancel without saving for the first visual check. The option must not appear in AE5E Administrative or non-AE5E compendiums.

## v0.4.2.3 permanent CAT public-registration acceptance

After installing/reloading v0.4.2.3, run as a GM from the Foundry browser console:

```js
const ae5e = game.modules.get("action-effects-5e")?.api;
await ae5e.tests.runCatIntegrationFoundationTest({ notify: true });
```

The gate waits for AE5E's asynchronous `catReady` registration to finish, verifies the required CAT dependency/API boundary, confirms the explicit public-pack allowlist and Administrative exclusion, requires all configured public packs to exist, validates that every published AE5E automation carries a real SemVer rather than CAT's fallback `0`, verifies incomplete packs are deferred fail-closed, and confirms canonical 2014 Misty Step is registered from `action-effects-5e.spells-level-2` at automation version `1.0.0`. Duplicate initialization must not repeat source or pack registration.

Useful diagnostics:

```js
ae5e.interoperability.cat.registration.getStatus();
ae5e.interoperability.cat.registration.getStats();
await ae5e.authoring.cat.auditPublicPacks();
```

A public pack reported under `deferredPacks` is intentionally unavailable through CAT until every Item in that pack has valid AE5E CAT source/version metadata. This prevents accidental publication at CAT's implicit version `0`.

## v0.4.2.2 CAT metadata authoring / validation acceptance

This release adds the production authoring and pack-audit API but deliberately leaves canonical compendium Items unchanged. Run as a GM from the Foundry browser console:

```js
const ae5e = game.modules.get("action-effects-5e")?.api;
await ae5e.tests.runCatMetadataAuthoringTest({ notify: true });
```

The gate audits the real Level 2 pack read-only, then creates a disposable World Item from Misty Step and exercises the production authoring API. A complete PASS verifies source/version stamping, independent version bumping, strict SemVer rejection, CAT config preservation, AE5E flag preservation, Activity/Active Effect preservation, final metadata validity, and fixture cleanup. The canonical compendium is never written by the test.

Useful non-mutating diagnostics:

```js
await ae5e.authoring.cat.auditItem("Compendium.action-effects-5e.spells-level-2.Item.pLcoNw3VnVbgzGU8");
await ae5e.authoring.cat.auditPack("action-effects-5e.spells-level-2");
await ae5e.authoring.cat.auditPublicPacks();
ae5e.authoring.cat.getStatus();
```

When intentionally authoring an unlocked canonical Item, the write API is:

```js
await ae5e.authoring.cat.setMetadata(
  "Compendium.action-effects-5e.spells-level-2.Item.pLcoNw3VnVbgzGU8",
  { version: "1.0.0" }
);
```

The writer is GM-only, requires a valid identifier/ruleset/type, rejects malformed versions, and refuses to replace a foreign CAT automation source. Do not stamp production compendium Items until that Item's automation version is intentionally being established or bumped.

## v0.4.2.1 CAT automation-provider foundation acceptance

This branch makes CAT 0.0.8+ a required AE5E dependency but deliberately registers no Items yet. After installing v0.4.2.1 with CAT active, run the automated Foundry-side gate as GM from the browser console:

```js
const ae5e = game.modules.get("action-effects-5e")?.api;
await ae5e.tests.runCatIntegrationFoundationTest({ notify: true });
```

The gate waits briefly for CAT's delayed `catReady` lifecycle if needed, then verifies the AE5E/CAT required-module relationship, CAT 0.0.8+ manifest floor, runtime dependency validation, CAT public automation-registration API, `catReady` observation, the registered source name `Action Effects 5E`, zero AE5E Item automations, and idempotent duplicate initialization. A complete PASS is the acceptance requirement for the new provider foundation.

Then run the unchanged broad non-destructive smoke gate:

```js
await ae5e.tests.runFoundationSmokeTest({ notify: true });
```

For diagnostics without mutating anything:

```js
console.log(ae5e.interoperability.cat.registration.getStatus());
console.log(ae5e.interoperability.cat.registration.getStats());
```

Expected foundation state: source `action-effects-5e` is verified as `Action Effects 5E`, `automationsRegistered` is exactly `0`, and no registration error is recorded. Misty Step registration is intentionally deferred to the next stage. Compendium and asset contents must remain unchanged from the supplied v0.4.1.22 authority package.

## v0.4.1.21 Grapple orbit / Rotate → Drag acceptance

Repository development gate: `npm test` must report **137/137 PASS**. New/changed coverage verifies strict aligned inactive-ledger cleanup, the pre-translation Grapple ledger guard, out-of-combat orbit with no synthetic Leader spend, active-recording orbit with normal measured spend, and single-in-flight wheel input that ignores rapid additional events but unlocks after settlement.

Live Foundry acceptance remains authoritative. Test the real Unarmed Strike Grapple workflow as the non-GM grappler controller. Outside combat, Grapple a target, use Rotate Target one shell position, then drag the grappler one grid space: the target must follow, the Grapple relationship/effects/grants must remain active, and the rotation must not add movement to the Leader's native movement ledger. Spin the mouse wheel rapidly during one orbit step and confirm only one shell step resolves; a new wheel input after settlement must resolve normally. In combat on the grappler's active movement-recording turn, repeat one orbit step and confirm normal measured movement is charged before the next input unlocks, then drag and confirm the established 2× Grapple drag cost remains intact.

After the live sequence, inspect `ae5e.relationships.getRotationStats()` and `ae5e.relationships.getMovementStats()`. Expected `.21` diagnostics include `orbitInputMode: "single-in-flight-shell-step"`; rapid wheel testing should increment `ignoredOrbitInputs`; out-of-combat orbit should increment `grappleOrbitSpendSkips` without incrementing `grappleOrbitSpends`; and a subsequent Grapple translation should increment `grappleLedgerGuards`.

No compendium, asset, or Unarmed Strike/Grapple Item macro change is part of v0.4.1.21.

## v0.4.1.20 Grapple movement hardening

Repository acceptance baseline: `npm test` must report **135/135 PASS**.

Focused regressions cover:

- stale active-turn movement history re-anchored to the Token's authoritative position while preserving total movement already spent;
- stale history outside active movement recording cleared without preserving obsolete cost;
- healthy aligned movement history left untouched;
- Grapple relationship creation invokes reconciliation before persistence and fails closed when reconciliation fails;
- rapid second manual movement for an in-flight Grapple Leader is cancelled before a second `relationships.moveGroup` request can be sent;
- the Grapple-only local lock releases after the complete authoritative request and does not apply to non-Grapple relationships.

Live Foundry acceptance should additionally confirm: (1) intentionally stale Caerwyn movement history is repaired before Grapple becomes active; (2) legitimate active-turn movement expenditure remains spent after repair; (3) a healthy native ledger is unchanged; (4) a real teleport remains a teleport; and (5) rapid arrow-key input while dragging a grappled target no longer produces Socketlib `leader changed position` errors or overlapping movement requests.

## v0.4.1.18 Grapple passenger drag constraints

The deterministic repository release gate is:

```bash
npm test
```

Expected result: **127/127 PASS**. The two new regressions cover the multiplayer Grapple failure reproduced by a player-controlled Leader: generated Follower/passenger movement must carry `ignoreCost: true` so a Grappled/Speed-0 Follower can be translated, and after AE5E performs its own environment/body preflight it must carry `ignoreTokens: true` so D&D5e does not reject the simultaneously vacating relationship Leader. A separate regression confirms that excluding the Leader does not permit movement through a different hostile creature.

Live Foundry acceptance should be performed as the non-GM grappler controller. Grapple a Friendly-disposition target and then an opposed-disposition target in an open area; in both cases, moving the Leader one grid space should move the Follower into the trailing/vacated space without removing the relationship, Grapple effects, Escape Grapple, or Release Grapple. Repeat Rotate Target, Escape Grapple, and Release Grapple as a smoke test. A genuine wall or third-party hostile creature in the translated Follower path should still prevent coordinated movement.

No Unarmed Strike/Grapple Item macro, compendium, or asset changes are part of this release.

## v0.4.1.12 transient Automated Animations ownership acceptance

This release adds client-local runtime arbitration and does not require a new Socketlib path. After installing v0.4.1.12 with Automated Animations 7.0.22+ active, run the existing animation-ownership foundation test in Foundry:

```js
const ae5e = game.modules.get("action-effects-5e")?.api;
await ae5e.tests.runAnimationOwnershipFoundationTest({ notify: true });
```

The foundation gate now additionally verifies that a transient claim matches the requested Activity, does not suppress a sibling Activity on the same Item, immediately vetoes the matching AA workflow, leaves no persistent animation flag on the Item/Activity, and is automatically released by `withAutomatedAnimationsSuppressed()`. Existing persistent ownership checks (explicit flag, Item-owned effect inheritance, Entangled→Restrained same-Actor inheritance, origin chain, and ordinary unsuppressed workflow) remain part of the same gate.

Then verify the live adapter and runtime-claim diagnostics:

```js
console.log(ae5e.version);
console.log(ae5e.interoperability.automatedAnimations.getStatus());
console.log(ae5e.animationOwnership.getActiveAutomatedAnimationsSuppressions());
```

Expected baseline: `ae5e.version` is `0.4.1.12`, AA reports its workflow-start hook registered, and the active transient-claim list is empty when no scoped Activity is running.

For the real Item acceptance, use an Item with at least two Activities (the common Unarmed Strike Attack/Shove/Grapple Item is suitable) and wrap only one selected Activity:

```js
await ae5e.animationOwnership.withAutomatedAnimationsSuppressed(
  { item: sourceItem, activity: selectedActivity, reason: "AA transient acceptance" },
  async () => selectedActivity.use({})
);
```

Confirm that AA does not play for the wrapped Activity, AE5E/custom animation may play normally, and a different sibling Activity remains eligible for AA when used without the wrapper. After either completion or cancellation/error, `getActiveAutomatedAnimationsSuppressions()` must return an empty array. No Item/Activity `flags.action-effects-5e.animation` value should have been written by the transient API.

The repository development regression suite is **106/106 PASS**. Per project policy, that is supporting regression coverage rather than a substitute for the live Foundry acceptance above. Compendium contents are intentionally unchanged from v0.4.1.11.

## v0.4.1.11 common actions compendium acceptance

This release changes compendium/package metadata only. After installing v0.4.1.11, open the Foundry **Compendium Packs** sidebar and confirm the hierarchy contains:

```text
Action Effects 5E
└─ Actions - Common
   └─ Actions - Common
```

The leaf pack must be a D&D5e `Item` compendium with internal id `actions-common`. Existing **Spells** and **AE5E Administrative** packs should retain their prior contents unchanged. No multiplayer or Socketlib acceptance is required because v0.4.1.11 introduces no player-executed or privileged runtime behavior.

## v0.4.1.10 Eskie custom-color resolver regression

After installing v0.4.1.10, run the existing Foundry crosshair foundation test as GM:

```js
const ae5e = game.modules.get("action-effects-5e")?.api;
await ae5e.tests.runCrosshairFoundationTest({ notify: true });
```

The suite now includes the exact Misty Step resolver request (`Circle`, `Fantasy_01`, `NoBase`, 30 ft, exact sizing, `#8FD8FF`) with premium and free Eskie both available. It must resolve the premium white 30-foot WebM with `tint: "#8FD8FF"`, `reason: "premium-white-tinted"`, and no native fallback. Native premium named-color checks remain in the same suite. No multiplayer/Socketlib acceptance is required for this resolver-only change because no privileged document write or GM-authoritative operation is involved.

# Action Effects 5E testing

## Project test policy

Action Effects 5E behavioral and regression testing is performed **inside Foundry VTT**. Do not use an external `npm test` run as a release gate for this project. The repository may retain older Node-oriented development files for history/reference, but current validation is based on the live Foundry APIs, hooks, movement pipeline, Socketlib authority, token documents, canvas geometry, and installed-module coexistence that the production module actually uses.

v0.3.24 adds a built-in Foundry regression harness for relative creature semantics:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.runFollowerBodyDispositionMatrix();
```

The harness configures the exact `Leader`, `Follower`, `Ally`, `Enemy`, `Neutral`, and `Secret` fixture, runs eight Follower-body occupancy cases, waits through the 3.5-second nonhostile endpoint grace where required, verifies rollback and queue settlement, restores all six tokens on a complete pass, and leaves a failed fixture visible for inspection.

## Startup check

After replacing module files and restarting Foundry, confirm that Action Effects 5E reports its Socketlib registrations, dependency validation, and `Foundation ready` without an AE5E startup exception. The exact Socketlib handler count is not a release invariant because subsystems add handlers over time.

Run the non-destructive smoke test:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.runFoundationSmokeTest();
```

## v0.4.1.9 relationship-orbit regression cleanup

v0.4.1.9 changes the repository test fixture and assertions only; production relationship movement/rotation runtime behavior is unchanged from v0.4.1.8. The legacy Node orbit fixture now supplies an explicit clear Grapple-link obstruction dependency, matching the Grapple-link dependency production AE5E provides while keeping those tests focused on orbit/follower-body behavior. The obsolete hostile-endpoint assertion now expects the current hard-block policy. The complete repository Node suite is **97/97 PASS** after this cleanup.

Foundry remains the behavioral release environment. After installing v0.4.1.9, a focused live regression can be run as GM on an active Scene:

```js
const ae5e = game.modules.get("action-effects-5e").api;

await ae5e.tests.runFoundationSmokeTest({ notify: true });
await ae5e.tests.runFollowerBodyDispositionMatrix();
await ae5e.tests.runGrappleLinkObstructionTest();
```

The first smoke test should report a complete PASS. The Follower-body and Grapple-link suites exercise the two live collision channels whose test-fixture boundary was clarified in this release and restore their fixtures on a complete pass. No new Socketlib path is introduced by v0.4.1.9 because no production player-executed behavior changed.

## v0.4.1.8 CAT teleport compatibility acceptance

With CAT active, run this test as GM on an active Scene:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.runCatTeleportCompatibilityTest({ notify: true });
```

The test creates disposable Actors/Tokens, applies the reusable voluntary-movement restriction to the teleporting creature, creates a temporary Grapple relationship with the normal `detach` teleport policy, and runs CAT's real `preTeleport` → `moveToken(... displace ...)` → `postTeleport` semantic lifecycle. It verifies that both AE5E movement-hook phases are classified as teleport, the movement restriction does not block the teleport, CAT provenance/native-action metadata survives, the Grapple relationship detaches through the existing relationship service, and all disposable fixtures plus temporary semantic state are cleaned up.

For multiplayer acceptance, also initiate one real CAT teleport as a non-GM player. CAT remains responsible for any GM-routed physical token move; AE5E only routes the temporary teleport classification context to active GMs. Confirm that `ae5e.interoperability.cat.getStatus().teleportLifecycle` reports the wrapper and socket handlers active and that the resulting AE5E relationship behavior matches the same GM test.

## v0.4.1.2 Eskie crosshair acceptance

After installing 0.4.1.2, run the deterministic Foundry-side resolver/catalog gate first:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.runCrosshairFoundationTest({ notify: true });
```

Expected result: **18/18 PASS**. This checks the 244-entry premium catalog, 52-entry free catalog, all-six-shape coverage in both catalogs, Line-vs-Ray semantics, premium exact-color resolution, the known Generic_01 Red 60ft asymmetry, free white+tint fallback including Rectangle/Reticle, rectangle dimension normalization, Fireball-style floor sizing, custom hex tinting, unsupported-shape safety, and live module detection.

Then control exactly one token on an active Scene and run:

```js
await ae5e.tests.runCrosshairInteractiveTest({
  color: "red",
  radius: 20,
  range: 150
});
```

The expected visual is the Fireball placement pattern: an Eskie Circle at the movable template and an Eskie Line tracing from the controlled source token to that template. If Patreon Eskie is active, the native premium red assets should be used. If only the free Eskie module is active, the white assets should be tinted. If neither compatible Eskie visual is available, the native Sequencer crosshair must remain visible and functional.

During the custom-visual path, confirm that Sequencer's native border/fill/grid highlight are not visible. Placement and X/Escape cancellation must both end with **0 lingering AE5E crosshair effects**. The interactive test prints whether the resolver selected `premium`, `free`, or `native` mode and reports cleanup separately from placement/cancellation.

This release does not migrate Fireball itself; the purpose of the test is to prove the reusable service can reproduce Fireball's established Circle + Line placement behavior before spells are converted to it.

## v0.4.1 Spell Modifier Engine acceptance

SME behavioral acceptance is performed inside Foundry. The first gate is deterministic and does not cast a real spell:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.runSpellModifierEngineFoundationTest({ notify: true });
```

Expected foundation result: **26/26 PASS**. It validates the seven semantic phases, registry/discovery from caster feature flags, multi-option selection groups, automatic-before-optional ordering, one aggregated optional chooser, explicit conflicts, normalized spell facts, duplicate event suppression, once-per-cast policy, cross-phase session continuity, later-phase application, reverse-order rollback, recent-session archival, non-spell fast exit, workflow completion, event-adapter hook installation, and test-handler cleanup. It also validates the explicit damage-roll semantic split: intentional CAT reconstruction/re-evaluation is exposed as `rebuildChangedDamageRoll`, while AE5E preserve-results retagging keeps the same roll objects, totals, and formulas, never calls their evaluator, and commits only the changed type metadata. This is a Foundry execution gate even though the test uses synthetic workflow objects for deterministic engine isolation.

The second gate exercises the production Midi/CAT/D&D5e seam. Run as GM with CAT active, an active Scene, and **exactly one caster token controlled**. The controlled Actor must own at least one simple `damage`-type spell Activity with damage parts and no measured template; Magic Missile's dart Activity is a typical valid fixture.

```js
await ae5e.tests.runSpellModifierEngineLiveActivitySubstitutionTest({ notify: true });
```

A complete live pass should report **31/31 PASS**. The test uses the controlled Actor only as a read-only template source. It creates disposable source/target Actors and hidden Tokens, embeds only a disposable feature registration on the disposable source, builds the test spell as a CAT synthetic in-memory Item, and executes it with `consumeUsage: false`, `consumeResources: false`, and `spellSlot: false`.

The live gate proves:

1. required CAT 0.0.6 Activity/workflow-state/synthetic/execution capabilities are present;
2. SME discovers a declarative feature registration on the caster;
3. SME stages a cold damage-type decision at `beforeDamageRoll` while no evaluated damage roll exists yet;
4. D&D5e evaluates the original fire DamageRoll exactly once;
5. at `damageRollComplete`, SME retags that exact evaluated roll to cold with `retagDamageRollsPreservingResults()`, preserving object identity, total, formula, and dice result;
6. SME reaches `beforeDamageRoll`, `damageRollComplete`, and `workflowComplete`; if Midi invokes its settings/outcome-dependent `preTargetDamageApplication` hook, SME must also map that invocation to the per-target `beforeDamageApplication` phase with the target and canonical `damageItem`;
7. the same SME session crosses the real workflow and finishes `complete`;
8. the completed session is mirrored at `workflow.cat.sme.actionEffects5e`;
9. the real controlled caster's HP, Items, Effects, and spell-resource data remain unchanged; and
10. all test-created Actors, Tokens, handlers, and ChatMessages are cleaned up.

The synthetic live spell does not force Midi to invoke `preTargetDamageApplication`, because that hook depends on damage-application settings/outcome. The gate records a passing deferred result when the raw Midi hook is absent; when it is present, the same check becomes strict and requires SME to observe the matching target/damage item.

Do not treat external module console warnings as SME failures unless an SME acceptance check fails or the workflow result is altered. After both SME gates pass, rerun the unchanged v0.3.30 foundation/movement and targeted Reaction Broker sanity tests before finalizing 0.4.1.


### Final v0.4.1 acceptance record

The **revised3 runtime** is the behaviorally accepted v0.4.1 runtime. Final release packaging changes documentation only.

- SME foundation: **26/26 PASS**.
- Live Midi/CAT/D&D5e preserve-results damage retag: **31/31 PASS**.
- Interactive real SME choice UI: **9/9 PASS**.
- Remote non-GM controller routing: **5/5 PASS**, with manual confirmation that the chooser appeared only on the owning player, the green selection indicator stayed active while choosing, and the notification sound played only for that player.
- Live save-spell lifecycle: **8/8 PASS**, including real `targetingComplete`, `savesComplete`, shared-session continuity, save classification, and `workflowComplete`.
- Preserved v0.3.30 regression suites: foundation **13/13**, native movement accounting **12/12**, displacement foundation **9/9**, Follower-body disposition **8/8**, Grapple-link obstruction **6/6**, Reaction Broker foundation **18/18** — **66/66 underlying checks PASS**.

The ad-hoc final aggregation console macro used after those suites initially printed `0/43 FAIL` because its normalizer expected `check.pass` while several existing harnesses report `check.passed`, and it did not normalize `casesCompleted/results` suites. That aggregate number is **not an AE5E runtime failure**: every underlying suite printed and returned its own PASS result. No module code change was made for this reporting-only macro mistake.

Terrain Mapper `updateToken`, CRLNGN UI `renderSceneNavigation`, and Foundry graphics readback warnings seen during the regression remain external/known test-environment noise; they did not change any underlying AE5E suite result or cleanup outcome.

## v0.3.30 CAT movement interoperability regression

Behavioral validation remains inside Foundry VTT. CAT must be active for this specific regression. On an active Scene as GM, run the complete macro below exactly as written:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.runCatMovementInteroperabilityTest();
```

No manual fixture setup is required. The harness creates a disposable character Actor and Token, then cleans both up. A complete pass verifies:

1. CAT is active and `cat.utils.tokenUtils.moveToken()` is available;
2. CAT's `catForce` action is present and remains intentionally unmeasured (`measure: false`);
3. AE5E's `action-effects-5e.no-cost` action remains measured;
4. a direct external CAT `catForce` move completes and produces Foundry's native `moveToken` event;
5. AE5E converts that external CAT movement into a semantic transaction with `agency: forced`, `resource: none`, `movementMode: catForce`, and CAT provenance while leaving Source/Push/Pull details unset;
6. an AE5E movement sent through the CAT facade actually increments CAT-execution diagnostics;
7. the AE5E no-cost action sent through CAT still reports positive physical distance and zero movement cost;
8. AE5E semantic operation metadata survives CAT execution;
9. the CAT facade receives a real wall-constrained movement attempt;
10. CAT honors the movement wall and does not move the Token through it; and
11. the disposable Actor/Token and diagnostic Wall are removed.

After this CAT-specific gate, rerun the v0.3.29 movement release regressions because forced displacement now crosses the CAT facade:

```js
await ae5e.tests.runFoundationSmokeTest();
await ae5e.tests.runMovementAccountingTest(); // control exactly one ordinary token
await ae5e.tests.runDisplacementFoundationTest();
await ae5e.tests.runFollowerBodyDispositionMatrix();
await ae5e.tests.runGrappleLinkObstructionTest();
```

The relationship movement/rotation suites are regression checks rather than CAT executor tests: v0.3.30 deliberately keeps coordinated relationship operations on AE5E's established `Scene.moveTokens()` implementation. A targeted Reaction Broker foundation/interactive sanity regression remains appropriate because CAT-origin forced movement now enters the same semantic movement pipeline used by future reaction consumers, although the Broker runtime itself is unchanged.

## v0.3.29 native movement-accounting regression

Behavioral validation remains Foundry-only. After loading v0.3.29, control exactly one ordinary Token in the active test Scene and run:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.runMovementAccountingTest();
```

The test is non-destructive: it measures paths but does not move the controlled Token or clear its history. A complete pass verifies that:

1. `action-effects-5e.no-cost` survives Foundry v14 startup normalization, has the required icon, and cannot be selected through the normal movement UI;
2. the internal action remains measured (distance is greater than 0 for a one-grid path);
3. its normalized cost function and the measured one-grid path both resolve native movement cost to 0;
4. the reusable final-cost modifier can wrap the current native movement action and produce `native cost + distance`; and
5. the controlled Token's existing `TokenDocument.movementHistory` is unchanged by the probe.

Then repeat the existing movement regressions that exercise the movement types whose accounting changed:

```js
await ae5e.tests.runDisplacementFoundationTest();
await ae5e.tests.runGrappleLinkObstructionTest();
```

For manual relationship verification, use the existing Grapple movement fixture and confirm that ordinary Leader movement still records its normal native cost while the generated Follower path records zero cost. Repeat an orbit step and confirm the Follower's movement is zero-cost. Existing trailing/vacated-space placement, wall/hostile blocking, nonhostile grace, teleport policies, and rollback behavior must remain unchanged.

Final v0.3.29 Foundry acceptance additionally included live combat movement-history validation for ordinary Leader movement, generated Follower translation/orbit, forced Push/Pull, grace rollback, and a real hidden-slot final-cost modifier move. The final-cost acceptance recorded `5 native + 5 distance = 10` directly in Foundry's native movement history.

Because the Reaction Broker runtime was unchanged in v0.3.29, release regression used a targeted sanity gate rather than repeating the entire finalized v0.3.28 matrix: Reaction Broker foundation **18/18 PASS** and normal interactive Broker **12/12 PASS**. The deeper finalized v0.3.28 nested/Midi/multiplayer/disconnect results remain the authoritative baseline for that unchanged subsystem.

Final v0.3.29 acceptance matrix: foundation + movement accounting **24/24 PASS**; live Leader/Follower combat accounting **18/18 PASS**; displacement foundation **9/9 PASS**; live forced-displacement accounting **21/21 PASS**; Follower-body disposition matrix **8/8 PASS**; Grapple-link obstruction **6/6 PASS**; Reaction Broker foundation sanity **18/18 PASS**; normal interactive Broker sanity **12/12 PASS**; live final-cost modifier **6/6 PASS**.

## v0.3.30 revised Shove destination geometry

Run the targeted Foundry-only Shove geometry regression before repeating the established displacement/accounting gates:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.runShoveDestinationGeometryTest();
```

The harness uses the standard `Leader`, `Follower`, `Ally`, `Enemy`, `Neutral`, and `Secret` fixture and restores it on a complete pass. It verifies: an unobstructed 10-foot northward `AWAY` Push exposes exactly eight endpoints (three intentional 5-foot stops plus five 10-foot endpoints); the two former intermediate-angle gaps are reachable by mixed direction paths; every path step stays inside the original Source-to-Target fan; a mixed two-step destination executes through the production movement executor; an intentional 5-foot selection from a 10-foot maximum reports the shorter requested distance rather than a partial failure; and 2x2/3x3 targets receive eight separated bright-green compact selection handles near the leading edges of their overlapping footprint ghosts. A failure leaves the diagnostic fixture visible.

After the automated pass, perform an interactive visual/clickability smoke test with a 2x2 and then a 3x3 Target using `previewDisplacementFromControlledTokens({ distance: 10 })`. Confirm that all eight valid choices are visually distinguishable and that the bright-green compact handles, rather than the overlapping ghost footprints, are easy to click.

### Final v0.3.30 acceptance record

The finalized v0.3.30 runtime is the tested revised1 implementation; finalization changed release documentation only. Foundry acceptance completed with:

- CAT movement interoperability: **19/19 PASS**.
- CAT non-owner player → GM permission routing: **PASS**.
- Broad movement regression: **48/48 PASS**.
- Live forced-displacement native accounting: **21/21 PASS**.
- Reaction Broker foundation sanity: **18/18 PASS**.
- Revised Shove destination geometry: **11/11 PASS**.
- Interactive 2x2 and 3x3 large-token Shove selector usability: **PASS** for both sizes.
- Final post-revision displacement foundation: **9/9 PASS**.
- Final post-revision live forced-displacement accounting: **21/21 PASS**.

The final Shove rule for `AWAY` is a fixed original directional fan with step-by-step steering only among directions inside that fan, and the requested distance is a maximum: shorter legal endpoints remain selectable. `STRAIGHT_AWAY` and Pull's `STRAIGHT_TOWARD` remain fixed-ray/direct-line behaviors.

## v0.3.25 forced-displacement foundation

Run the complete Foundry-only displacement regression:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.runDisplacementFoundationTest();
```

The harness resolves the exact `Leader`, `Follower`, `Ally`, `Enemy`, `Neutral`, and `Secret` tokens, rejects unrelated Leader/Follower relationships, removes only AE5E test-harness relationships, snapshots the fixture, and uses a Foundry v14 movement action configured with `teleport: true` for deterministic test positioning. It does **not** use the deprecated database `teleport` update option. Every fixture move verifies the resulting TokenDocument coordinates before behavioral assertions begin.

A normal pass validates nine groups:

1. 1x1 direction semantics: Push `AWAY` = NE/E/SE, Push `STRAIGHT_AWAY` = E, and Pull `STRAIGHT_TOWARD` = W. The Pull execution test calls `displacement.pull()` without a direction key to verify automatic direct-line resolution.
2. Center-relative Large/Huge-style Source geometry: the selected 2x2 and 3x3 fixtures expose N/NE/E/SE for Push `AWAY`.
3. Actual Pull execution and Target-relative hostile collision.
4. Push hard-block when the destination creature is hostile relative to the displaced Target, regardless of Source disposition.
5. Forced movement transaction metadata plus a 10-foot Push ending in nonhostile occupancy; after 3.5 seconds the Target must return only to the last clear 5-foot step.
6. If the nonhostile creature causing an occupied endpoint moves away during grace, the pending rollback clears immediately and the displaced Target remains in place.
7. Neutral and Secret endpoint candidates are soft/selectable.
8. A 10-foot Push may pass through a nonhostile creature at the first step and end clear, exercising the narrow D&D5e occupied-space bypass.
9. A 10-foot Push partially stops at 5 feet when the next step is blocked by the harness's diagnostic wall.

A complete pass removes the diagnostic wall, clears displacement grace, restores the six token states, and prints a large PASS banner/table/full JSON. A failure leaves the fixture visible for inspection.

Interactive selector smoke test: control exactly two tokens in order, Source first and Target second, then run:

```js
await ae5e.tests.previewDisplacementFromControlledTokens({
  type: ae5e.constants.DISPLACEMENT_TYPES.PUSH,
  directionConstraint: ae5e.constants.DISPLACEMENT_DIRECTION_CONSTRAINTS.AWAY,
  distance: 5
});
```

Expected overlay: green = clear; yellow `~` = nonhostile occupied endpoint; orange = partial distance (`actual/requested`); red `X` = hard blocked and not selectable. Press Esc to cancel.

## v0.3.27 selection-indicator and external-prompt regressions

After the interactive indicator tests, control exactly one token and run the automated external-prompt isolation regression:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.runExternalPromptIsolationTest();
```

This is deliberately non-interactive. It exercises the external bridge's fail-closed classification path without broadcasting fake `renderApplicationV2` events to unrelated installed modules. It verifies that ordinary/unrecognized applications remain inert, tokenless adapter matches are ignored, adapter exceptions do not create indicators, AE5E-owned dialogs cannot be claimed by an external adapter, a recognized application's re-render cannot duplicate its lease, two recognized prompts for the same token share one blue visual, closing one preserves the remaining lease, and closing the final prompt returns both bridge and selection-indicator counts to zero.

A complete pass reports `PASS`. The test suppresses notification audio and cleans up all temporary adapters/applications in `finally`.

## Creating a grapple geometry fixture

Control exactly two tokens, Leader first and Follower second, then run:

```js
const ae5e = game.modules.get("action-effects-5e").api;

await ae5e.tests.createGrappleMovementTestRelationshipFromControlledTokens({
  breakDistance: 5,
  coordinationDistance: 5
});
```

For extended reach, first place the tokens on the requested band and use, for example:

```js
await ae5e.tests.createGrappleMovementTestRelationshipFromControlledTokens({
  breakDistance: 10,
  coordinationDistance: 10
});
```

The fixture uses `grappleFollower`, `followerCanSelfMove: false`, `forcedLeaderMovementPolicy: "independent"`, `collisionPolicy: "stopGroup"`, and `rotationPolicy: "orbitFollower"`.

Remove test relationships with:

```js
await ae5e.tests.removeTestRelationships();
```

## Geometry inspection before movement

With the Leader controlled (or pass `{ relationshipId }` explicitly):

```js
await ae5e.tests.inspectRelationshipGeometry();
await ae5e.tests.inspectOrbitShell();
await ae5e.tests.validateRelationshipGeometry();
```

`validateRelationshipGeometry()` should report all checks passed, including unique anchors, no Leader/Follower footprint overlap, clockwise/counterclockwise inverse traversal, and full circuit totals of +360/-360 degrees.

Show the temporary numbered shell overlay:

```js
await ae5e.tests.showOrbitDebug();
```

Clear it with:

```js
ae5e.tests.clearOrbitDebug();
```

The overlay is canvas-only and must not create persistent Drawings, Tiles, Regions, or Scene flags.

## v0.3.24 follower-body disposition matrix

Run:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.runFollowerBodyDispositionMatrix();
```

Expected Follower-relative body outcomes:

```text
Leader HOSTILE / Follower FRIENDLY
  Ally    Hostile  -> HARD
  Enemy   Friendly -> SOFT -> grace -> rollback if overlap persists
  Neutral Neutral  -> SOFT -> grace -> rollback if overlap persists
  Secret  Secret   -> SOFT -> grace -> rollback if overlap persists

Leader FRIENDLY / Follower HOSTILE
  Ally    Hostile  -> SOFT -> grace -> rollback if overlap persists
  Enemy   Friendly -> HARD
  Neutral Neutral  -> SOFT -> grace -> rollback if overlap persists
  Secret  Secret   -> SOFT -> grace -> rollback if overlap persists
```

Before modifying the Scene, the same command runs a 4x4 resolver matrix over Friendly, Hostile, Neutral, and Secret in both reference directions. It also verifies geometry ownership directly: `follower-body` resolves relative to the Follower and the reserved `grapple-link` channel resolves relative to the Leader/Grappler. In v0.3.25 the physical fixture setup uses an exact Foundry movement-action teleport and asserts every resulting coordinate, preventing ordinary token blocking from corrupting the matrix setup.

Leader disposition is deliberately varied as a control. Because this matrix validates **Follower-body** geometry, the third creature is classified relative to the Follower. Neutral and Secret must remain nonhostile regardless of either participant's Friendly/Hostile side. The later physical `grapple-link` collision matrix will use the Leader/Grappler as its reference.

Hard cases must expose `lastDecision.obstruction.geometryChannel === "follower-body"` and `reasonCode === "hostile-creature"`. Soft cases must expose a nonhostile endpoint conflict, `pendingNonhostileOverlaps >= 1`, then restore the complete prior legal Follower position and matching Leader rotation after grace expiry.

## v0.3.23 rotation-input matrix

For every geometry below, test both clockwise and counterclockwise directions.

1. Use Shift+mouse-wheel for one notch/update. Follower must advance exactly one adjacent shell position and Leader must rotate by the exact bearing delta for that step.
2. Reset and use Ctrl+mouse-wheel in the same direction. It must produce the same one-shell-position result even if Foundry's native requested rotation magnitude differs.
3. Inspect:

```js
ae5e.relationships.getRotationStats();
await ae5e.tests.inspectRelationshipGeometry();
```

The diagnostics should retain the native requested rotation/modifier while showing `orbitStepsRequested: 1`, `orbitStepsCompleted: 1`, exact shell indices, calculated leader delta, and committed leader rotation.
4. Rapidly scroll several notches. Follower movement must serialize through each adjacent shell position; no step may be skipped merely because native rotation updates arrived quickly.
5. Reverse direction and confirm each reverse input walks exactly one shell position back.
6. Complete a full circuit. Follower must return exactly to its starting anchor and cumulative Leader rotation must represent one full 360-degree revolution without drift.

Direct service tests can isolate geometry from mouse input:

```js
await ae5e.tests.orbitClockwise();
await ae5e.tests.orbitCounterclockwise();
```

These call the same planner and GM-authorized resolver used by wheel control.

## Size/footprint live matrix

Use actual Token width/height, not creature-size names. Recommended minimum matrix:

```text
Leader   Follower   coordinationDistance
0.5x0.5  0.5x0.5    5
0.5x0.5  1x1        5
1x1      0.5x0.5    5
1x1      1x1        5
2x2      1x1        5
1x1      2x2        5
2x2      2x2        5
2x2      3x3        5
3x3      2x2        5
4x4      3x3        5
1x1      1x1       10
2x2      1x1       10
1x1      2x2       10
2x2      3x3       10
1x1      1x1       15
```

For each configuration:

- inspect/validate the shell;
- rotate at least one full circuit in both directions;
- test a wall on one adjacent shell step and verify exact Leader/Follower rollback;
- test normal Leader translation in multiple directions and around a corner;
- confirm the Follower remains on the configured planar coordination band;
- test follower-manual-movement lock.

Fractional Tiny tokens deserve extra visual scrutiny because Foundry occupied-grid-space measurement can map more than one sub-grid token location to the same 5-foot grid cell.

## Extended-reach/re-anchoring tests

Create a 10-foot relationship at the outer band:

```js
await ae5e.tests.createGrappleMovementTestRelationshipFromControlledTokens({
  breakDistance: 10,
  coordinationDistance: 10
});
```

Validate:

1. normal coordinated translation/orbit preserves the 10-foot band;
2. external forced movement which moves the Follower from 10 feet to a legal 5-foot separation keeps the relationship and updates `coordinationDistance` to 5;
3. future normal translation/orbit now uses the 5-foot shell;
4. force the participant back to a legal 10-foot separation; `coordinationDistance` should become 10;
5. a forced zero-distance overlap may remain temporarily legal but must **not** persist `coordinationDistance: 0`;
6. movement beyond `breakDistance: 10` removes the relationship without moving either participant back.

Inspect persisted state with:

```js
console.log(JSON.stringify(
  ae5e.relationships.list({ sceneId: canvas.scene.id }),
  null,
  2
));
```

## Forced-movement regression matrix retained from v0.3.22

The following 1x1 cases were live-validated before v0.3.23 and must remain unchanged:

- Force Follower; final separation ≤ break distance → Follower moves independently, Leader stays, relationship remains.
- Force Follower; final separation > break distance → Follower stays at forced destination, relationship ends.
- Force Leader with `independent`; final separation ≤ break distance → Leader moves, Follower stays, relationship remains.
- Force Leader; final separation > break distance → Leader stays at forced destination, relationship ends.
- Force both participants in one `Scene.moveTokens()` operation while final separation remains legal → both movements succeed and relationship remains.

No forced-movement break-distance case should use relationship rollback merely because the relationship becomes invalid after successful external movement.

## Nonhostile endpoint grace regression

With a nonhostile creature occupying the next orbit shell anchor:

1. orbit into the occupied endpoint;
2. verify the 3.5-second grace begins only after follower animation settles;
3. allow expiry: Follower and Leader rotation must restore to the exact original legal anchor;
4. repeat and continue to an open shell anchor before expiry: timer must clear with no later snapback;
5. repeat across consecutive nonhostile occupied anchors: original legal anchor remains the rollback target while timer restarts;
6. remove the relationship during grace: no orphaned timer may move either token later;
7. verify Friendly/Friendly and Hostile/Hostile are nonhostile, Friendly/Hostile is hostile, and Neutral/Secret are nonhostile regardless of the other participant's side.

## Collision/rollback regression

For `collisionPolicy: "stopGroup"`:

- block one follower orbit shell step with a wall;
- Follower must remain at the prior shell anchor;
- Leader must restore to the exact pre-step rotation, including non-45-degree angles;
- rapid speculative events queued after the blocked step must be discarded;
- coordinated translation which Foundry partially constrains must restore every surviving linked participant from the pre-move origin snapshot, even when a token's `moveTokens()` result is `false`.

## Translation regression

For `grappleFollower`:

- 1x1/1x1 at 5 feet must retain `F L . -> . F L` behavior on an eastward one-square move;
- 2x2 Leader/1x1 Follower and the reverse must select a rear legal shell anchor without overlap;
- 10-foot coordination must preserve the outer band rather than collapsing to ordinary adjacency;
- multi-step and corner routes should be processed one Leader grid step at a time when Foundry exposes a square-grid direct path;
- pure vertical movement preserves planar offset and follows elevation when enabled;
- teleport-follow preserves fixed offset rather than using grapple trailing geometry.

## Runtime settlement and diagnostics

Never use guessed sleeps when the public settlement helper can observe the relationship pipeline:

```js
const rel = ae5e.relationships.list({ sceneId: canvas.scene.id })[0];
await ae5e.relationships.waitForMovementSettled({ leaderUuid: rel.leaderUuid });
```

Useful diagnostics:

```js
ae5e.movement.getStats();
ae5e.relationships.getStats();
ae5e.relationships.getMovementStats();
ae5e.relationships.getRotationStats();
ae5e.movement.getRecentTransactions();
```

After a settled operation, queued/active relationship movement and rotation counts should return to zero. During nonhostile endpoint grace, `pendingNonhostileOverlaps` should be 1. `pendingAlliedOverlaps` remains a legacy diagnostics alias during the v0.3.x migration.

## Coexistence testing

After isolated geometry tests, repeat representative cases with the user's normal Foundry module set. CPR/GPS coexistence remains a first-class project requirement even though neither is required. Pay particular attention to other modules registering `preMoveToken`, `moveToken`, `preUpdateToken`, `updateToken`, or Scene movement wrappers.

Test isolation should distinguish an AE5E defect from another module altering the same Foundry lifecycle; do not build product behavior around test-only bypasses.

## 0.3.26 Grapple-link obstruction regression

Run only inside Foundry VTT as GM:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.runGrappleLinkObstructionTest();
```

The harness requires exactly one token each named `Leader`, `Follower`, `Ally`, `Enemy`, `Neutral`, and `Secret`. It automatically snapshots/restores them on a complete pass, removes only AE5E test relationships and AE5E diagnostic walls, creates a 10-foot Grapple-like relationship, and verifies:

1. a hostile creature intersecting only the Grapple link hard-blocks orbital movement using Leader-relative disposition semantics;
2. a nonhostile creature occupying only the final Grapple link permits the orbit, starts the 3.5-second grace window, then restores the prior Follower shell plus Leader rotation if unresolved;
3. a movement wall intersecting the Grapple-link sweep hard-blocks while the Follower body path remains clear;
4. a nonhostile creature intersecting only the swept Grapple link may be passed through and does not start endpoint grace when the final link is clear;
   The harness uses a deterministic 0.25x0.25 diagnostic footprint for this narrow sweep-fan fixture and first asserts that the creature is clear of both the initial and final link while intersecting an intermediate sampled link.
5. the same sweep-only geometry hard-blocks when the creature is hostile to the Leader/Grappler;
6. when one creature simultaneously produces a nonhostile Follower-body conflict and a hostile Leader-relative Grapple-link conflict, the hard Grapple-link conflict wins.

A failed fixture is intentionally left in place. No Node/npm behavioral test is a release gate for this project.

## 0.3.27 selection/popup indicator regression

Run inside Foundry VTT with Sequencer active. Control exactly one token, then run:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.runSelectionIndicatorTest();
```

The command performs an automated lease lifecycle first:

1. first lease starts one token visual;
2. second lease on the same token increments the lease count but does not create a second visual;
3. releasing the first lease leaves the visual active;
4. releasing the second/final lease removes the visual.

It then opens an actual Foundry v14 DialogV2 through `selection.waitForDialog()`. While the dialog remains open, verify in Foundry:

- the marker sits slightly inward from the controlled token's upper-right footprint corner and partially overlaps the token;
- visible marker size is approximately 25-30% of token width; repeat with 1x1, 2x2, and 3x3 tokens;
- the marker follows token translation while the dialog is open and does not rotate around the token when the token rotates;
- when Eskie Effects is installed, the raw WebM `modules/eskie-effects/assets/UI/Ability_Check/D20/01/UI_Ability_Check_D20_01_Roll_Default_White.webm` loops seamlessly and is tinted `#18cc46`; if Eskie Effects is absent, `icons/vtt-512.png` is shown instead;
- where the marker overlaps the controlled token's orange selection/control outline, the marker renders above that outline;
- from a second connected client viewing the same Scene, the marker is visible even though the DialogV2 exists only on the selecting user's client;
- closing with the default button, Cancel, or the window X removes the marker immediately;
- after closure, `ae5e.selection.getStats()` reports `activeLeases: 0`, `activeTokens: 0`, and `renderedTokens: 0`.

The visual service is advisory. For a separate compatibility check, disabling Sequencer must not prevent an interaction wrapped by `selection.withIndicator()` or `selection.waitForDialog()` from resolving; AE5E should warn and continue without a marker. Sequencer is recommended, not required.

### Role-pair presentation

Control exactly two tokens in originator-first, responder-second order and run:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.runSelectionIndicatorRolePairTest();
```

Verify the first token has the green `originator` indicator and plays `notification01.ogg` once for the executing user. Verify the second token simultaneously has the amber `responder` indicator and plays its responder notification cue once for the executing user. Closing the test dialog must remove both indicators.

### External ApplicationV2 bridge

Control exactly one token and run:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.runExternalPromptBridgeTest();
```

The harness registers one temporary exact-match external adapter and opens a DialogV2 that deliberately does **not** use `selection.waitForDialog()`. The global `renderApplicationV2` bridge should recognize only that tagged test application, display the blue `external` indicator on the controlled token, and remove it from the ApplicationV2 `close` event. The production bridge does not ship with a catch-all token heuristic; unknown external windows remain unmarked until a reliable module-specific adapter exists.

### Production Push-selector integration

To verify the first real consumer of the service, control exactly two tokens in Source-first, Target-second order and run:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.previewDisplacementFromControlledTokens({ type: "push" });
```

While the Push destination overlay is waiting for a click, the selection indicator must be on the Source/acting token, not the displaced Target. Clicking a legal destination or cancelling the selector must remove the indicator. A Pull preview should resolve its direct destination without opening the selector or displaying a waiting marker.


## 0.3.28 Reaction Broker regression

All Reaction Broker behavioral acceptance is performed inside Foundry VTT. The synthetic handlers used by this harness are installed across connected clients only while a test is running and are removed afterward. They are gated to `ae5eTest` contexts and never modify real Items.

### 1. Create/reset the fixture

Run as GM:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.setupReactionBrokerTestScene();
```

This creates/activates `AE5E 0.3.28 Reaction Broker Test` with Attacker, Reactor 1, Reactor 2, Reactor 3, and Non-Reactor tokens. Reactor 1 is closest to Attacker. Reactors 2 and 3 are placed at the same distance, with Reactor 2 carrying the higher Dexterity fixture. The fixture may assign currently active players during initial creation, but the dedicated multiplayer test overrides fixture ownership deterministically for the duration of that test. The fixture also tries to clone a harmless D&D5e cantrip onto Attacker as `AE5E Reaction Gate Probe — ...`; if no suitable core spell is available, the live Midi gate test can use any other real spell cast from the source client.

### 2. Automated foundation test

Run as GM:

```js
await ae5e.tests.runReactionBrokerFoundationTest();
```

The console prints large PASS/FAIL lines and a final table. It validates, without requiring user choices:

- elected Reaction authority exists and is the oldest continuous browser-session start among connected GMs;
- Activity reaction metadata parses independently from test offers;
- `Do not use a reaction` is not registered as an offer/handler;
- three synthetic Reactors are discovered while Non-Reactor is ignored;
- one actual reaction remains exactly one offer and multiple actual reactions remain multiple offers;
- distance precedes Dexterity in Reactor ordering;
- Dexterity orders equal-distance Reactors;
- d20 ties can reroll an unresolved subgroup without losing precedence established by the earlier roll;
- parent/root transaction lineage is preserved for nested transactions;
- concurrent processing of the same event key joins one in-flight transaction;
- one synthetic spell workflow creates exactly one normalized AE5E `spellCast`;
- a non-spell workflow creates no `spellCast`;
- no Broker dialog or selection-indicator lease remains after the noninteractive run.

### 3. Sequential UI test

Run as GM (or on the source client after the GM has created the fixture):

```js
await ae5e.tests.runReactionBrokerInteractiveTest();
```

Expected behavior:

1. Reactor 1, Reactor 2, and Reactor 3 receive Broker windows immediately.
2. Only Reactor 1 is active and only Reactor 1 shows the v0.3.27 animated responder indicator.
3. Reactor 2 and Reactor 3 display `Please wait while another actor chooses whether or not to use a reaction`.
4. Reactor 1 shows two actual synthetic reactions plus `Do not use a reaction`.
5. After Reactor 1 resolves/declines, its indicator and window clean up and Reactor 2's existing window becomes active. Reactor 2 has one actual reaction and still uses the same Broker window, showing that reaction plus `Do not use a reaction`.
6. Reactor 3 follows in the same fashion.
7. `Cancel` from any waiting or active Reactor closes the automated transaction as manual adjudication; it must never be recorded as a decline.
8. At completion, the harness requires `activeLeases: 0` and zero Reaction Broker dialog hosts.

Selecting `Abort Source Test Reaction` proves the Broker's standardized abort contract; selecting Continue/declining through the queue proves the resume path.

### 4. Nested/LIFO UI test

```js
await ae5e.tests.runReactionBrokerInteractiveTest({ nested: true });
```

Choose `Nested Reaction Test` for Reactor 1. The parent transaction enters resolving while a child `spellCast` transaction is created. Any token participating in both transactions reuses its single Broker host; the child view temporarily sits above the parent view. The child transaction must complete before the parent continues. The automated test now verifies the full chronology: parent enters `RESOLVING` before child creation, child carries the correct parent/root lineage, child reaches completion before the parent records the nested reaction result, the parent does not advance to its next Reactor before child completion, and the parent resumes/completes only afterward. The console also prints an `AE5E nested transaction chronology` object with the relevant timestamps and transaction IDs.

### 5. Live Midi workflow gate

This is the release-critical integration probe for the actual `midi-qol.prePreambleComplete` interception point. It uses the next **real spell workflow** on the client running the command while keeping the reaction itself synthetic.

Resume path:

```js
await ae5e.tests.runReactionBrokerMidiWorkflowGateTest({ mode: "resume" });
```

After arming, use the `AE5E Reaction Gate Probe — ...` spell on Attacker (or cast any real spell from that same client if the fixture could not clone one). Choose `Continue Test Reaction` or `Do not use a reaction`. PASS requires the Broker transaction to complete before Midi reaches `midi-qol.postPreambleComplete`, followed by normal source continuation.

Abort path:

```js
await ae5e.tests.runReactionBrokerMidiWorkflowGateTest({ mode: "abort", setup: false });
```

Cast another real spell and choose `Abort Source Test Reaction`. PASS requires the Broker to return the standardized `abort` contract and the matching workflow must **not** reach `midi-qol.postPreambleComplete`. Both modes also require zero stale Broker hosts and zero indicator leases after completion.

This probe deliberately uses real Midi workflow timing rather than simulating the external hook, so it is the strongest evidence in 0.3.28 that the source workflow is actually gated by the Reaction Broker.

### 6. Multiplayer routing

Connect at least one player and one GM. The player does **not** need to place or bring a normal character token onto the fixture Scene. Run from the GM client:

```js
await ae5e.tests.runReactionBrokerMultiplayerTest({ setup: false });
```

The harness temporarily configures the existing fixture so **Reactor 1 is owned by the selected connected player**, while Reactor 2 and Reactor 3 are unowned and therefore route to the elected GM. Original fixture ownership is backed up and restored automatically after the transaction; `clearReactionBrokerTestState()` also restores it after an interrupted test.

For the baseline routing run, let the queue advance normally (do not use the Stop Queue reaction and do not early-decline Reactor 2/3). Expected routing is:

- Reactor 1 Broker host/ACTIVE prompt/indicator appear on the player client only.
- Reactor 2 and Reactor 3 waiting hosts appear on the elected GM client.
- After Reactor 1 resolves/declines, Reactor 2 then Reactor 3 become active on the GM client.
- Only the currently active Reactor has the selection indicator and private notification sound.

The harness captures per-client dialog counters before and after the transaction and automatically verifies the routing split, in addition to the normal interactive cleanup/order assertions.

With two GMs connected, inspect:

```js
ae5e.tests.inspectReactionBroker().authority;
```

The GM with the oldest active browser-session start must be primary. Disconnect that GM while the other remains: authority should transfer to the next-longest session without disabling the active Reactor's OK control.

### 7. Last-GM disconnect/reconnect

For the strongest recovery test, first ensure the fixture exists, then start the multiplayer test from a **player/source client** while one GM is connected. The GM-side socket helper temporarily applies the same Reactor 1 ownership routing even though the command originates from the player:

```js
await ae5e.tests.runReactionBrokerMultiplayerTest({ setup: false, testDisconnectRecovery: true });
```

While an active Reactor is deciding, disconnect or refresh the last GM. Verify:

- the source workflow remains pending rather than being treated as a decline;
- active OK is disabled;
- the warning is visible and available on hover: `Game Master has been disconnected, waiting for game master to reconnect. Click cancel to proceed with manual reaction selection`;
- waiting Reactors remain waiting and do not gain indicators;
- Cancel remains enabled and terminates automated handling as manual adjudication;
- if a GM reconnects instead, the same active view is re-enabled and can continue;
- final cleanup leaves no Broker hosts or indicator leases.

Do not use a GM-owned source workflow for the reconnect-resume assertion: refreshing the browser which owns the original Midi workflow destroys that external workflow call stack, which no module can resume in-place.

### 8. Active Reactor controller-disconnect recovery

With a GM and at least one player connected, run:

```js
await ae5e.tests.runReactionBrokerMultiplayerTest({
  setup: false,
  testControllerDisconnectRecovery: true
});
```

While a **player-owned Reactor is ACTIVE**, disconnect or refresh that player browser.

Verify:

- the Attacker/source workflow does not remain permanently suspended on the lost remote dialog request;
- the disconnect is **not** recorded as `Do not use a reaction`;
- AE5E revalidates the same frozen Reactor queue slot;
- if a GM remains available, control of that Reactor's Broker prompt reroutes to the elected primary GM;
- the original distance/DEX/d20 queue position remains frozen;
- the rerouted decision is still GM-authorized normally.

If the disconnected controller was also the **last GM**, this folds into the normal `WAITING_FOR_AUTHORITY` behavior instead: surviving Reactor windows show the GM-disconnected warning, the source remains suspended, and either a GM reconnect or `Cancel` is required.

### 9. No-GM bypass

Disconnect every GM and run from a player client:

```js
await ae5e.tests.runReactionBrokerNoGmTest();
```

Expected PASS: source result is `resume`, reason is `no-active-gm`, and no Reaction Broker window opens. The Broker never elects a player authority.

### Test cleanup / recovery

If a manual test is interrupted, a browser is refreshed, or you want a clean rerun, use:

```js
await ae5e.tests.clearReactionBrokerTestState();
```

This closes Reaction Broker hosts on all connected clients and unregisters temporary test handlers. To also remove the fixture Scene and its temporary Actors, run as GM:

```js
await ae5e.tests.clearReactionBrokerTestState({ removeFixture: true });
```

### Diagnostics

```js
ae5e.tests.inspectReactionBroker();
ae5e.reactions.getStats();
ae5e.reactions.getAuthorityStatus();
ae5e.reactions.getRecentTransactions();
ae5e.reactions.getDialogStats();
ae5e.reactions.getEventAdapterStats();
```

### Final 0.3.28 acceptance record

The finalized v0.3.28 release completed the Foundry-only release matrix with the following results:

- Foundation: **18/18 PASS**.
- Normal interactive Reaction Broker: **12/12 PASS**.
- Nested interactive Reaction Broker and parent/child chronology: **21/21 PASS**.
- Live Midi workflow gate — RESUME: **6/6 PASS**.
- Live Midi workflow gate — ABORT: **6/6 PASS**.
- Ordinary cross-client multiplayer routing: **6/6 PASS**.
- Last-GM disconnect/reconnect recovery: **7/7 PASS**.
- Active player-controller disconnect and GM reroute recovery: **7/7 PASS**.
- No-GM transaction-start bypass: **PASS**.

The Firefox/Sequencer `Invalid URI` media warning observed during indicator playback is the separately isolated Sequencer 4.x browser-media warning and did not fail any Reaction Broker acceptance check. A browser that has just reloaded may defer its first private notification cue until a user gesture unlocks browser audio; this does not change transaction state or routing.

The final release gate for 0.3.28 is the Foundry matrix above. The repository's legacy Node simulation suite is not a project release gate; the finalized 0.3.27 baseline already contains six relationship-rotation simulation failures which remain unchanged in this build.

### Live Midi gate duplicate-arm/timeout note (0.3.28 revised7)
The live Midi gate remains armed for approximately 10 minutes by default. If a probe is already `armed` or `running`, a second `runReactionBrokerMidiWorkflowGateTest()` call is rejected before any second test instrumentation is installed. Use the already-armed spell probe, or call `await ae5e.tests.clearReactionBrokerTestState()` before intentionally changing modes. The mode banner is printed only after the probe has successfully armed.

### SME live damage-type contract
The live Midi/CAT/D&D5e test intentionally begins with a fire Activity, records a cold transmutation decision at SME `beforeDamageRoll`, verifies no evaluated damage roll exists yet, allows D&D5e to evaluate the original fire roll once, and then retags that exact roll to cold at SME `damageRollComplete`. Acceptance requires object identity, total, and formula to remain unchanged while the roll type becomes cold.


## v0.4.1.6 ongoing-effect multiplayer authority acceptance

The focused Node regression for the v0.4.1.6 transport/authority fix is:

```bash
node --test tests/ongoing-effect-authority.test.mjs
```

Expected result: **5/5 PASS**. It proves that a non-GM execution client reduces the live workflow to JSON-serializable data, routes that result exactly once despite overlapping Midi completion hooks, never deletes the parent effect locally, and that the GM validates the linked grant before success cleanup while preserving the lifecycle on failure. It also proves the prompt socket does not return a circular/live Midi Workflow object.

The repository-wide Node suite continues to contain the same six legacy relationship/orbit simulation failures present in the untouched v0.4.1.5 baseline; v0.4.1.6 adds no new failures to that suite. Foundry remains the behavioral release gate for those subsystems.

For the live multiplayer acceptance, connect a GM and the non-GM player who owns the affected Actor, then use a real ongoing-action consumer such as **Entangle — Escape**:

1. Apply the ongoing effect to the player-controlled Actor and confirm its granted action Item exists.
2. From the player's prompt, choose the action and complete the Athletics/check workflow.
3. On a **successful** check, confirm the parent ongoing ActiveEffect is removed and its owned granted Item is cleaned up.
4. On a **failed** check, confirm both the parent effect and granted Item remain available for the next legal opportunity.
5. Repeat once with a GM-controlled target to confirm the existing same-client authority path still resolves normally.

Useful diagnostics after the player case are `ae5e.ongoingEffects.getStats()`: the execution client should increment `resultsRoutedToAuthority`, while the primary GM should increment `authorityResultsResolved` when it accepts a result.

Compendium contents are intentionally unchanged in v0.4.1.6 and must remain byte-identical to v0.4.1.5.

## v0.4.1.5 animation ownership acceptance

After installing v0.4.1.5 in Foundry, run:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.runAnimationOwnershipFoundationTest({ notify: true });
```

The foundation gate must report PASS for direct `"suppress"` recognition, Item-owned Active Effect inheritance, same-Actor `Entangled` → `Restrained` status inheritance, isolation of an unrelated Restrained status, origin-chain inheritance, child-data flag stamping, and AA workflow veto behavior.

Then inspect the live adapter status:

```js
ae5e.animationOwnership.getAutomatedAnimationsStatus();
ae5e.interoperability.automatedAnimations.getStats();
```

With Automated Animations 7.0.22+ active, the status should report the `AutomatedAnimations-WorkflowStart` hook registered. Spell-specific acceptance should then verify that a real Entangle application with the flag on its owning Item/`Entangled` effect does not play AA's Entangled or child Restrained animation, while an unrelated Restrained application remains eligible for AA.

The v0.4.1.5 build intentionally makes no compendium-content changes. Compendium byte hashes should remain identical to the supplied v0.4.1.4 baseline.

## v0.4.1.4 generic infrastructure acceptance

Run these gates inside Foundry VTT after merging the 0.4.1.4 runtime update. No spell-specific Item is required.

First validate the new Region authority service:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.runRegionAuthorityFoundationTest({ notify: true });
```

With an active Scene, run the live Region lifecycle gate as GM:

```js
await ae5e.tests.runRegionAuthorityLiveLifecycleTest({ notify: true });
```

The live gate creates one temporary rectangular Region, verifies the AE5E authority ownership flag and caller metadata, deletes the Region through the same authority service, verifies that the UUID no longer resolves, and performs best-effort cleanup if the test is interrupted.

Then rerun the ongoing-effect foundation gate:

```js
await ae5e.tests.runOngoingEffectFoundationTest({ notify: true });
```

In addition to the v0.4.1.3 checks, this gate validates the `responder` indicator-role declaration, rejection of unknown roles, validation of `suppressPromptWhenUnusable`, D&D5e Activity `canUse` handling, activation-resource availability, and the early prompt-suppression path. Existing ongoing-action declarations which omit the new fields must remain backward-compatible.

The release is accepted only after these infrastructure gates pass in Foundry. Spell-specific Region geometry/behavior and ongoing-action presentation remain the responsibility of the Item automation that consumes these APIs.

## v0.4.1.3 ongoing-effect action acceptance

Run all behavioral validation inside Foundry VTT after installing 0.4.1.3.

First run the deterministic foundation gate:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.runOngoingEffectFoundationTest({ notify: true });
```

The foundation gate validates runtime hook registration, canonical `turnStart`/`turnEnd` timing, the 10-second mandatory timeout constant, declaration validation, parent/child flag parsing, CAT Activity/saved-cast-data capability detection, and the presence plus GM-only visibility of **AE5E Administrative**.

Then activate a Scene, control exactly one token, and run the live grant lifecycle gate:

```js
await ae5e.tests.runOngoingEffectLiveLifecycleTest({ notify: true });
```

The harness automatically selects an available AE5E compendium Item as a disposable template fixture. It does **not** alter the source compendium document. It creates temporary ActiveEffects and cloned Items only on the controlled Actor, then cleans them up. The live gate validates:

1. ActiveEffect creation clones the referenced compendium Item onto the affected Actor;
2. the cloned Item points to the exact parent ActiveEffect instance;
3. the parent ActiveEffect points back to the exact cloned Item;
4. the clone records the original compendium template UUID;
5. pre-existing Actor Items are preserved;
6. two effects referencing the same template receive distinct child Items;
7. deleting one parent removes only its child Item;
8. manually deleting a child does not delete its parent;
9. reconciliation recreates a missing child and restores its exact parent link; and
10. deleting the reconciled parent removes the repaired child.

After the infrastructure gates pass, spell-specific acceptance should be added when the first Administrative templates are created. That later live gate must validate a real mandatory repeat save through CAT/D&D5e/Midi, the 10-second exactly-once fallback, player-owner routing, optional escape `Not Now` behavior, repeat prompting on a later turn while the effect persists, success removal of the parent effect, failure preservation, out-of-combat manual Item use, and the public unresolved-effects combat-end card.


## v0.4.1.13 remote choice prompt acceptance

Run the deterministic Foundry foundation gate after installing v0.4.1.13:

```js
const ae5e = game.modules.get("action-effects-5e").api;
await ae5e.tests.runChoicePromptFoundationTest({ notify: true });
```

Expected result: **6/6 PASS** and the large console banner `AE5E 0.4.1.13 — REMOTE CHOICE PROMPT FOUNDATION — PASS`. This verifies the canonical Shove-style request schema, duplicate-id rejection, indicator-role validation, Socketlib registration, the amber responder presentation, and prompt diagnostics.

For the live routing check, activate a Scene and control exactly one target token, then run:

```js
await ae5e.tests.runChoicePromptInteractiveTest({ notify: true });
```

If that Actor has an active non-GM owner, the STR/DEX dialog must open on that player's client. If the Actor has no active player owner, it must open on the primary active GM instead. While the dialog is open, the target token must show the amber responder indicator; closing by choosing Strength or Dexterity must remove the indicator immediately. The console report records `controller.reason` (`active-owner` or `gm-fallback`) and the returned `choice` (`str` or `dex`).

For the offline-owner case, leave the Actor owned by a player who is disconnected and rerun the interactive test from the GM. The dialog must appear on the GM without trying to route to the offline user. For a mid-prompt disconnect check, open the prompt on the player and disconnect that client before making a choice; AE5E should reroute the same plain-data request to an active GM rather than leaving the initiating workflow waiting indefinitely.

The Node regression is:

```bash
node --test tests/choice-prompt.test.mjs
```

Expected result: **4/4 PASS**. The complete repository suite is **110/110 PASS**. Compendium contents must remain byte-identical to the supplied v0.4.1.12 build.


## v0.4.1.15 non-positional movement-spend acceptance

Activate a Scene, control exactly one Token as the GM, and run:

```js
const ae5e = game.modules.get("action-effects-5e")?.api;

if (!ae5e) {
  throw new Error("Action Effects 5E API is unavailable.");
}

console.log("AE5E Version:", ae5e.version);

const result = await ae5e.tests.runNonPositionalMovementSpendTest({
  notify: true,
  amount: 15
});

console.log("Non-Positional Movement Spending:", result);
console.log("Movement Spend Stats:", ae5e.movement.getSpendStats());

return result;
```

Expected result: **9/9 PASS** and the large console banner `AE5E 0.4.1.15 — NON-POSITIONAL MOVEMENT SPENDING — PASS`. The test snapshots the controlled Token's current authoritative movement history, spends 15 movement without changing position, verifies the exact cost delta and receipt entry, rolls that receipt back, and confirms that the original movement cost and byte-equivalent history data are restored. A fail-safe cleanup attempts to restore the original history if live acceptance fails partway through.

This specifically regresses the v0.4.1.14 live failure: Foundry strips direct `_movementHistory` changes from ordinary Token updates. AE5E now uses Foundry's explicit `isUndo` history-write gate for history-only spend/rollback operations, matching the mechanism used by native `revertRecordedMovement()` without changing Token position.

For multiplayer acceptance, run the production API from a player who owns the Token:

```js
const ae5e = game.modules.get("action-effects-5e")?.api;
const token = canvas.tokens.controlled[0];

const before = ae5e.movement.getHistoryCost(token);
const receipt = await ae5e.movement.spend(token, 15, {
  reason: "v0.4.1.15-player-routing-test"
});
const after = ae5e.movement.getHistoryCost(token);

console.log({ before, after, delta: after - before, receipt });

// Cleanup the test charge.
console.log(await ae5e.movement.rollbackSpend(receipt));
```

Expected behavior: the player's call completes through the GM Socketlib handler, `delta` is exactly `15`, the Token never changes position, and rollback removes the charge. A player who does not own the Token is rejected by the GM authority handler.

The focused Node regression is:

```bash
node --test tests/movement-spend.test.mjs
```

Expected result: **6/6 PASS**. The complete repository suite is **116/116 PASS**. The regression fixture now mirrors Foundry v14 by stripping ordinary `_movementHistory` writes unless the explicit undo gate is used. Compendium contents must remain byte-identical to the supplied v0.4.1.14 build.


## v0.4.1.16 relationship lifecycle grant acceptance

Activate a Scene as the GM and control exactly two tokens in **leader first, follower second** order. The two tokens must not already participate in an AE5E relationship. Then run:

```js
const ae5e = game.modules.get("action-effects-5e")?.api;
if (!ae5e) throw new Error("Action Effects 5E API is unavailable.");

console.log("AE5E Version:", ae5e.version);

const result = await ae5e.tests.runRelationshipLifecycleGrantTest({
  notify: true
});

console.log("Relationship Lifecycle Grants:", result);
console.log("Relationship Lifecycle Stats:", ae5e.relationships.getLifecycleStats());

return result;
```

Expected result: the large console banner `AE5E 0.4.1.16 — RELATIONSHIP LIFECYCLE GRANTS — PASS`. The live test creates only temporary embedded documents on the two controlled Actors: one disposable Item template, relationship-owned Item clones, and disposable source Active Effects. It does not modify any compendium. It verifies both directions of source-effect ownership, leader-side grant stamping/cleanup, and lifecycle hook registration, then removes all temporary documents.

The deterministic repository regression is:

```bash
node --test tests/relationship-lifecycle.test.mjs
```

The complete repository suite is **121/121 PASS**. Compendium and asset contents must remain byte-identical to the supplied v0.4.1.15 build.

## v0.4.1.17 Grapple movement cost accounting

The release gate for Grapple movement cost accounting is the complete deterministic repository suite:

```bash
npm test
```

Expected result: **125/125 PASS**. The focused regressions prove that voluntary Grapple translation applies one 2× final-cost wrapper to the Leader's native movement action, the generated Follower path remains on AE5E's hidden no-cost action, forced/teleport/no-resource movement does not receive the surcharge, one orbit shell step spends normal measured movement on the Leader, and a nonhostile endpoint grace rollback refunds the exact orbit-spend receipt.

For live Foundry acceptance, establish a real Grapple (or the existing `grappleFollower` test fixture) on an open square-grid Scene and verify these two accounting outcomes against `ae5e.movement.getHistoryCost(grapplerToken.document)`:

1. move the grappler 5 feet while carrying the target: the grappler's movement-history cost increases by **10 feet**, while the target's generated passenger move remains zero-cost;
2. from a clean movement-history baseline, rotate/orbit the target by one 5-foot shell step: the grappler's movement-history cost increases by **5 feet**, while the target still spends 0 feet.

Also confirm forced movement and teleport behavior remain unchanged. Relationship diagnostics are available through `ae5e.relationships.getMovementStats()` and `ae5e.relationships.getRotationStats()`. No compendium or asset content is modified by this release.

