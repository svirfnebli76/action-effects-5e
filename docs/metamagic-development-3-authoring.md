# Metamagic Development 3 — CAT Item macros, v0.4.5.37

Prepared 16 October 2026, America/Los_Angeles. This is the current authoring and
runtime contract. The shared editor passed the guided GM verification. The CAT
casting path is undergoing guided Foundry acceptance; repository tests do not
establish live acceptance. See the live checkpoint below.

## What changed

Metamagic now consumes only the versioned declaration collections. The old
singleton reader, standalone world-Macro launcher, manual learned-ID write API,
built-in Metamagic chooser and Stage 1 test installer are removed. The user
explicitly retired that preview; there is no compatibility execution branch.
Existing world documents are never automatically deleted or converted.

The base Item owns the chooser in a CAT Embedded Macro. The option Item owns its
eligibility and feature behavior in another CAT Embedded Macro. AE5E coordinates
declaration discovery, source identity, stale-choice checks, casting-local
Activity updates, native consumption and result receipts. Its casting code does
not contain Distant Spell's range rules or an option-name catalogue.

Sneak Attack/Devious Strikes use their existing independent implementation.
This build preserves compendium and asset bytes, authoring-menu scope, shared
prompt/indicator services, and the previously tested parent-source range bridge
and native consumption/refund ownership.

## Install source without overwriting your compendium edits

Install v0.4.5.37 from the published repository using the existing source-overlay
method. Replace the module's `scripts/` contents and `module.json`; synchronize
`package.json` if you keep the development checkout. The new scripts are:

- `scripts/integrations/cat-declaration-macro-adapter.js`
- `scripts/metamagic/collection-consumer.js`

Also copy the changed `scripts/action-effects-5e.js`, `scripts/api.js`,
`scripts/core/constants.js`, `scripts/declarations/metamagic-family.js`,
`scripts/metamagic/declaration-service.js` and
`scripts/metamagic/casting-service.js`. Copying the source `scripts/` folder covers
all of them. **Preserve your installed `packs/` and `assets/` folders**, including
the new Metamagic Item you have just authored. Restart/reload Foundry and clients.
The old `examples/metamagic-stage-1/` files can be removed from the installation;
the new runtime never imports or executes them.

Optional read-only console verification:

```js
(() => {
  const module = game.modules.get("action-effects-5e");
  console.log({
    manifestVersion: module?.version,
    runtimeVersion: module?.api?.version,
    families: module?.api?.declarations?.listFamilies?.().map(family => family.id),
    catCalledEvent: typeof globalThis.cat?.utils?.automationUtils?.calledEvent,
    retiredManualLearn: typeof module?.api?.metamagic?.learn
  });
})();
```

Expect both versions `0.4.5.37`, family `metamagic`, `catCalledEvent: "function"`
and `retiredManualLearn: "undefined"`. This is a capability check, not a cast test.

## Base Item — the next guided authoring section

Continue with the manually authored Metamagic Item in AE5E Class Features.
Keep its identifier `metamagic`, Class Feature type, required Sorcerer level 2,
Passive Trait, no limited-use maximum, and no Activities or Effects.

In Edit Item Options → AE5E Declarations, its base record can be:

```json
{
  "id": "base",
  "type": "main",
  "optionChoices": 2,
  "selectionLimit": 1,
  "resource": { "identifier": "sorcery-points" }
}
```

The editor supplies the collection envelope; paste one record, not an Item
export or a second wrapper. A `learnedOptions: []` field saved by v0.4.5.35 is
preserved as inert data and may be removed manually. It is never an access list
and is not automatically written. The new base template omits it.

Open CAT's native Embedded Macros editor on this Item and add:

| Field | Value |
| --- | --- |
| Name | `Metamagic Broker` |
| Event | Called (`called`) |
| Pass | `actorAe5eDeclarationBroker` |
| Priority | `50` |
| Macro code | Paste [base-broker.js](../examples/metamagic-development-3/base-broker.js) |

Use one macro body with that name. This is a CAT Item macro, not a standalone
Foundry Macro. Its code presents choices through AE5E's existing public prompt
API. It does not create/delete Items or debit resources.

The explicit Continue casting choice is the default. Keep `allowCancel: false`
in the broker macro to avoid a second identically labeled cancel button.
Closing the window still returns no selection and continues the ordinary cast.
For copies authored with the original example, make that one-line change in both
the compendium base Item and the actor's existing base Item; editing the
compendium does not update its already-imported actor copy. No AE5E runtime
reinstallation is required for this Item-macro correction.

The name above is the base role's default. A base record may explicitly supply
`"execution": {"interface":"cat-embedded","name":"Your broker name"}` if needed;
the configured CAT name must match. Stay with the default for this first test.
Do not add the same broker to Actor On-Use or another spell hook.

## Distant Spell — subsequent guided section

Manually create Metamagic — Distant Spell in the same approved compendium.
Configure its CAT registration/metadata through the existing Item workflow.
Its declaration is the `distant` record in
[declarations.json](../examples/metamagic-development-3/declarations.json).
Add it through AE5E Declarations using the Option template and id `distant-spell`;
replace the selected record JSON with that record, validate and save.

Configure its CAT Embedded Macro:

| Field | Value |
| --- | --- |
| Name | `Distant Spell` |
| Event | Called (`called`) |
| Pass | `actorAe5eDeclarationOption` |
| Priority | `50` |
| Macro code | Paste [distant-spell.js](../examples/metamagic-development-3/distant-spell.js) |

No separate Use Activity is needed for this execution path. The option macro
responds during the original spell's casting; the user never uses Distant as a
second Activity. The option Item owns numerical-range doubling and Touch-to-30ft
rules, eligibility explanations and card presentation.

## Automatic learning and grants

Only Items embedded in the caster's inventory participate. A normal option
record defaults to `"acquisition": "learned"`; its presence on the actor supplies
learned access. Adding/removing eligible option Items reconciles automatically
when the base reads declarations. Merely storing an Item in a compendium does
not grant it. Reconciliation is read-only and never rewrites the compendium or
the actor's base declaration with derived IDs.

The returned `learnedOptions` is a derived list. Its unique IDs count against
`optionChoices` plus eligible provider `choiceBonus` values. An option's
casting-condition failure does not erase its learned capacity. Over-capacity
actors receive a diagnostic; AE5E never silently chooses which options to keep.

A definition that should require an external grant uses
`"acquisition": "grant-only"`. Providers can grant its ID, require equipped/
attuned state, add choice capacity, raise the casting selection limit, or adjust
prices. These examples are included in `declarations.json`. Multiple grant
origins produce one choice with all provenance retained. Grant-only access does
not consume learned capacity. Missing or ambiguous definitions are diagnosed.
Removing all eligible grants makes a grant-only option unavailable.

Multiple records/families on an Item retain their independent identities.
Identity includes the complete source Item UUID, family and declaration ID,
including synthetic Actor/Token paths. AC5E evaluates Item-owned conditions using
the existing adapter and casting context; no second expression evaluator exists.

## Timing and execution boundaries

AE5E uses its previously verified awaited `midi-qol.preTargetingV2` window, before
native spell consumption. It requests the base macro through CAT's public
`cat.utils.automationUtils.calledEvent`, then requests option `offer` and
`prepare` responses through that same supported interface. CAT supplies the
normal `document`, `macroName`, utilities and `data` scope and executes the code.
AE5E never builds a JavaScript function, evaluates code or resolves a Macro UUID.

The supplied macros guard family, phase, source UUID and macro name before doing
anything. The adapter requires one matching source response, prevents duplicate
responses and fails closed when CAT catches a macro exception. Missing option
executables become explained disabled choices; a missing base broker stops the
cast before payment with configuration instructions. The first adapter supports
`cat-embedded`; other interface names in family metadata are not implemented
casting adapters and do not silently fall back to another execution method.

CAT interface/timing research used tag 0.1.2, commit
`b576949a67603616a505cfda8bdc193ab446fff9` in the
[CAT repository](https://github.com/chrisk123999/covens-automation-toolkit/tree/b576949a67603616a505cfda8bdc193ab446fff9):
`utilities/automationUtils.mjs` (`calledEvent`), `lib/event.mjs`
(`CalledEvent`, actor-scoped passes and script scope), and
`applications/embedded-macros.mjs` (Called supports a custom text Pass).
CAT's ordinary `preTargeting` macro scope lacks the workflow provided at the
verified V2 window, while `preItemRoll` occurs after consumption; neither was
substituted for that window.

## First live acceptance

Finish the base and Distant Items together, then use disposable actor fixtures
for boundary tests. The original AE5E Test — Metamagic / Distant Spell Items and
standalone test Macro are retired. Remove only those old tagged fixtures when
preparing the test actor; do not run the removed installer. Preserve the
Sorcery Points/Font of Magic pool, other class features, Wild Magic macros,
Sneak Attack/Devious Strikes and existing compendium Items.

Read the actual point balance and any diagnostic provider state; do not reset
them. The last historical balance was 2/7, and an offered free-cast diagnostic
was never confirmed. A remaining singleton declaration is reported as unsupported
when mixed with a new base; it is never executed or converted.

Test automatic option discovery, no-base isolation, numerical and Touch ranges,
canonical-source preservation, a later ordinary cast, chooser close,
native-dialog cancellation, range rejection with native refund ownership,
exactly-once payment, misses retaining payment, affordability, fixed/free prices,
provider activation/provenance and stale choices. Retain snapshots for already
committed casts even if a source Item is subsequently removed. Confirm cards,
permissions and player-controller behavior on the actual clients before claiming
their acceptance. Complete Distant acceptance before adding another option.

## Repository verification

The final v0.4.5.36 source passed `AE5E_BROWSER_TESTS=1 npm test`: 672 tests,
zero failures or skips, including the editor Chromium checks. Production syntax
validation covers 155 JavaScript files. The focused replacement suites contain
34 collection/CAT checks and 27 native casting checks, including the former
FormulaField, parent-source reconstruction and post-use range regressions.

A direct source comparison confirmed that the native range bridge, pre-write
consumption validation, post-use handling and receipt/presentation code remain
unchanged. The pre-consumption declaration recheck now uses collection identity,
provenance and prices. No files under `packs/`, `assets/` or `scripts/sneak-attack/`
changed. Their publication-parent trees remain preserved. The implementation
baseline is GitHub main `71b5c69cf1d4e829e50cd4cecf89cc9faf5176e5`.

These tests model CAT's documented scope/dispatch and native consumption contracts;
they do not run the installed Foundry world. Live acceptance remains pending.

During publication, a newer user compendium commit arrived on main:
`ba68bc3`. The source update was rebased onto that commit without changing its
source or tests. The publication preserves its pack tree
`eac81aee577e0dbb48d3c0e426994cc4ce1c0b52` and the existing asset tree
`58729887dac4b7d042e5b6f1726f4e3f71d3dd76` exactly. Source-only installation
remains necessary to preserve any further live compendium edits.

## v0.4.5.37 console notes

The shared casting coordinator supplies brief `console.info` notes on the
initiating client's console. Existing CAT Item macros do not need editing.
Continuing without an option (or closing the chooser) prints:

```text
[AE5E] Metamagic - Symaali Skorswaldt did not use Metamagic
```

After native consumption confirms a selected paid option, it prints:

```text
[AE5E] Metamagic - Symaali Skorswaldt used Metamagic
[AE5E] Metamagic - Distant Spell used by Symaali Skorswaldt
[AE5E] Metamagic - Distant Spell consumed 1 Sorcery Point from Symaali Skorswaldt
```

Actor and option names come from the actual Items; future options need no
hardcoded logging entries. Each selected option reports its effective adjusted
cost, including zero for free use. Repeated native consumption notifications do
not replace the original receipt or print another set of notes. Offer probes and
selection alone print no use/payment messages. Cancelling before native payment
therefore does not claim a debit. These are event notes; a later refund remains
owned by the native Activity and is not represented as a net-balance summary.
Console failures do not change casting, payment or result handling.

## Guided live checkpoint — 17 October 2026, America/Los_Angeles

The user verified installed manifest/runtime v0.4.5.36 and CAT's public
`calledEvent` function. The base and Distant Items were manually authored in the
AE5E compendium and copied onto Symaali Skorswaldt. Discovery returned ready,
one automatically learned `distant-spell`, cost 1, no diagnostics and the correct
CAT names/Called passes. The reported point balance at that check was 7/7,
spent 0; do not substitute the older historical 2/7 balance or reset resources.

The chooser opened and Continue casting was selected. A duplicate Continue
button was identified and the supplied Item macro was corrected to
`allowCancel: false` (published in `a5cbda7`). The user has not separately
reported the resulting button count or balance after that declined cast.

The new Item-owned Distant path passed the live numerical-range test:
Poison Spray had normal range 30ft, Distant extended it to 60ft, and a target
50ft away was accepted. One Sorcery Point was subtracted despite a miss.
The attached card showed 60ft, Resolved and cost 1. A later cast without
Distant had the ordinary 30ft range. This establishes numerical range, debit on
miss, receipt presentation and later-cast range isolation for that GM client;
it does not establish every spell or controller path.

The user requested console notes before the next Touch-to-30ft test.
The v0.4.5.37 source adds those notes. Installation/live logging verification,
Touch, native cancellation/refund, affordability, providers, stale choices and
remaining acceptance checks are still pending. Read the actual current balance
before testing; no precise post-test balance has been reported.

The final v0.4.5.37 source passed `AE5E_BROWSER_TESTS=1 npm test`: 678 tests,
zero failures or skips, and the 155-file syntax gate. Six new focused checks
cover decline/close notes, confirmed native payment, duplicate notifications,
a resolved miss, pre-payment cancellation/depletion, adjusted zero cost and
console failures. Existing CAT macros, compendiums, assets and Sneak Attack
are unchanged from the publication parent.
