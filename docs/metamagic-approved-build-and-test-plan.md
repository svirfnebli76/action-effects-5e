# Approved Metamagic build and first-option test plan

Agreed with the user on 16 October 2026 (America/Los_Angeles).
This is the current continuation plan. Where older Stage 1 draft documents
describe a single declaration per Item or direct execution of a standalone
world Macro UUID, this agreement supersedes those designs.

## Agreed sequence

1. Build and validate the shared AE5E declaration infrastructure first: family
   registry, versioned collection storage, discovery/provenance and Item Options
   editor. Install it and verify the editor works before replacing test Items.
2. Then delete only the tagged AE5E Test — Metamagic and AE5E Test — Distant Spell
   Items. Remove their standalone AE5E Test — Distant Spell world Script Macro
   once nothing references it. Preserve the existing Sorcery Points/Font of Magic
   pool, legacy Items and existing actor Wild Magic macros.
3. Together, manually create the new Metamagic Class Feature in Foundry,
   register it with CAT and place its declaration-listener/broker macro in the
   appropriate Item-owned macro location. CAT Embedded Macros are a likely
   choice; select the actual hook from the verified lifecycle requirements.
4. Manually create Metamagic — Distant Spell, register it with CAT and configure
   its declarations through the new editor. The assistant supplies the data to
   paste into that editor and the executable macro code for the appropriate
   native authoring interface. Configure an Activity if the selected execution
   path requires one; a Use Activity is a possibility, not a settled requirement.
5. Selecting Distant in the broker must modify the original spell casting.
   It must not require a second manual use of the Distant feature.
6. Test and troubleshoot the complete broker/Distant path thoroughly. Distant
   is the first finished option and establishes the pattern for later options.
   Do not expand to the next option until this first path is accepted.

Authoring must be possible within Foundry's Item Options, Activity and macro
editors. No external Item JSON editing/export or setup Script Macro is required
to construct the finished Items. Read-only diagnostics can still support tests.
Macros normally live in established Midi On-Use, Actor On-Use, Effect Macro or
CAT locations. Standalone world/compendium Macros are exceptional, not the
normal Metamagic execution contract.

## Shared declaration requirements

- Infrastructure is reusable for Metamagic, Sneak Attack and future class
  features. AE5E registers family definitions, schemas, validators and consumers;
  individual declarations reside on Items.
- Each declaration belongs to one family and its registered flag path. That
  family flag holds a versioned collection of records. Items support zero, one
  or many declarations per family and more than one family simultaneously.
- One declaration does not contain arbitrary multiple flag destinations. Other
  Item/Activity/Effect flags remain separate from declaration records.
- Identity includes source Item UUID, family and declaration ID. IDs are unique
  within a family on an Item. Multiple grant sources retain provenance; ambiguous
  competing option definitions must not be silently resolved.
- The editor groups records by family, supports Add Declaration, Duplicate with
  a new ID, Remove Declaration, one selected-record JSON editor, explicit storage
  destination and validation. No All Declarations editing tab or generic Enabled
  checkbox/field. Presence makes a declaration participate, subject to explicit
  eligibility/activation requirements.
- Editing stays in a draft until Save All Changes; switching records preserves
  edits. Save preserves other declarations and unrelated Item data.
- Reuse Poison's eligibility pattern: Item-owned condition expressions are
  evaluated through the AE5E AC5E adapter using AC5E evaluationData/safeEval.
  Item-owned automation presents and executes the option. Do not introduce a
  second expression language or hardcode option rules in shared infrastructure.
- The base Metamagic Item enables and brokers access. Removing it leaves new
  ordinary spellcasting unchanged and prevents remaining option Items from
  independently offering/spending Metamagic.
- Existing Sneak Attack/Devious Strikes and compendium content are not
  automatically converted or overwritten by this work.

## Thorough first-option acceptance

Exercise discovery, eligibility, selection, native payment, casting-local range
changes, chat results and cleanup through the finished Item-owned execution path.
Include numerical range doubling; Touch-to-30ft; canonical source preservation;
ordinary later-cast isolation; chooser close; native-dialog cancellation;
out-of-range rejection with native refund ownership; exactly-once payment;
resolved misses retaining payment; affordability; declared grant activation and
provenance; fixed/free-price behavior; stale choices; and base-Item absence.
Validate presentation and applicable controller/ownership behavior before
claiming acceptance for those clients. Use disposable fixtures for destructive
or resource-boundary cases. Do not change compendiums to run acceptance.

The completed Stage 0 mechanisms remain accepted. Earlier Stage 1 live numerical,
Touch, cancellation, refund, source-isolation and provider checks are a behavior
baseline, not acceptance of the new declaration/macro execution path. Do not
restart standalone Stage 0 probes without specific conflicting evidence.

Latest confirmed live resource balance: Symaali has two Sorcery Points remaining
(max7, spent5). The free-cast test was offered but no result has been received;
do not assume its temporary ring was installed, removed or its casting completed.
Check actual state when testing resumes rather than resetting resources.

Current work is infrastructure/build planning. Do not remove existing test Items
until the new infrastructure is installed and its editor verified. The user
explicitly requested this plan be saved for continued work.
