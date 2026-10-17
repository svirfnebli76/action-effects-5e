# Shared Item declarations — v0.4.5.33

Implementation started 16 October 2026 (America/Los_Angeles), following the
[approved plan](metamagic-approved-build-and-test-plan.md) and
[handoff](metamagic-development-3-handoff.md).

## Verified baseline and current boundary

The cloud workspace is `/workspace/action-effects-5e`. Its clean starting HEAD
and GitHub `main` both resolved to `6e45fe26cec2b6fc4c14019f35866885537a35bb`,
tree `f8fd2cebe619f995bf1a53127f5fa372a365a7f3`. GitHub's releases collection was
empty. The bundle's `MANIFEST.json` and `START-HERE.txt` state that the supporting
handoff was not published; their publication status supersedes the handoff's
assumption about a descendant documentation commit. Three missing reference
documents have been copied from the supplied bundle; trailing whitespace was
normalized for the repository whitespace gate.

This slice adds shared collection infrastructure and Item Options authoring.
It does not install AE5E in Foundry, change the live world, convert existing
Items, or claim acceptance of a finished Metamagic broker/option execution path.
The publication version is **0.4.5.33**, synchronized across `module.json`,
`package.json` and `scripts/core/constants.js`. This identifies the infrastructure
build separately from the preserved 0.4.5.32 casting preview.

All existing compendiums, assets, Sneak Attack/Devious Strikes transport, casting
range/payment logic and Stage 1 test Items are preserved. No database was opened
for writing. The installed world and its current resources were not inspected
or changed from this cloud environment.

## Storage and validation

AE5E code registers families through `DeclarationFamilyRegistry`, including a
label, one dedicated Item flag path, collection version, schema description,
record validator and authoring templates. Duplicate families and storage paths
are rejected. Schema/template data is immutable. Items cannot register families
by changing their names or JSON fields.

The initial registered family is `metamagic` at
`flags.action-effects-5e.metamagic`. Its collection is always:

```json
{
  "version": 1,
  "declarations": []
}
```

Zero, one and many records use this same envelope. Other registered families
have their own flags; one Item can carry any number of families. Other Item,
Activity and Effect flags remain independent. Record ids are unique within one
family on one Item; source Item UUID + family + record id form the identity.
Discovery preserves full UUIDs, including synthetic Actor/Token identity.

Validation rejects duplicate JSON keys (including escaped/nested duplicates),
duplicate record ids, non-JSON values, unsafe object keys, a generic `enabled`
field, incorrect family routing, and family-specific invalid settings. Unknown
fields within valid records are preserved. Unknown collection-shaped family
flags produce diagnostics and are never consumed or rewritten. A malformed
registered collection contributes no partial definitions.

Legacy singleton and unsupported-version data is read-only in the new editor.
There is no automatic migration, including for existing Sneak Attack Effects.
Families may register an explicit migration function; `previewMigration`
validates and returns its proposed envelope without writing anything. The
initial Metamagic family intentionally has no migration from the temporary
standalone-Macro execution contract. Existing test Items must stay intact.

## Authoring

Approved AE5E public compendiums retain **Edit Item Options**. GM users can also
open **Item Options** from the header of a world or Actor-owned Item sheet,
including an Item with no declarations. The programmatic entry point is
`api.authoring.itemOptions.openEditor(itemOrUuid)`; ordinary authoring does not
require a console script. Third-party and administrative compendiums remain
excluded. Authoring is GM-only in this slice.

The window has **CAT Configuration** and **AE5E Declarations** tabs. The latter
provides family/template/id controls for Add Declaration, a grouped list, one
selected-record JSON editor, a registered storage-path display, Duplicate and
Remove. Duplicate requires a fresh id. Switching rows preserves typed drafts,
including invalid JSON that needs repair. No All Declarations editor or generic
Enabled control exists. Add never registers a new family. Opening creates no
flags or records.

**Validate All** reports family/id errors. **Save All Changes** validates all
editable declarations and changed CAT definitions before one Item update.
Unchanged legacy data, other family flags, unrelated Item data and CAT preference
values are preserved. Records are persisted as replacement arrays, so removal
cannot leave merged child records behind. CAT control and descriptor deletions
use Foundry deletion syntax. Changed-family/CAT baselines guard against saving
over changes observed while the draft was open; this is not a server-side
compare-and-swap guarantee between simultaneous clients. Approved locked packs
are temporarily unlocked only for explicit saves and re-locked afterward.
Cancel/window close discards drafts; close is deferred during an in-flight save.

CAT definitions remain at `flags.action-effects-5e.cat.configSchema` and installed
preferences remain at `flags.cat.config.*`. Declarations are not duplicated into
CAT preferences. CAT metadata publication remains its existing separate workflow.

## Public services and execution boundary

The existing module API now exposes:

| API | Purpose |
| --- | --- |
| `declarations.registerFamily/getFamily/listFamilies` | Code-owned family definitions |
| `declarations.validateRecord(family, record)` | Common and registered validation |
| `declarations.read(item, family)` | Versioned records and diagnostics |
| `declarations.discover(items)` | Every valid family/record, identity and activation state |
| `declarations.evaluate(entry, context)` | Explicit activation and existing AC5E adapter |
| `declarations.resolveGrants({definitions, grants})` | One semantic choice, all grant origins, ambiguity diagnostics |
| `declarations.registerConsumer/consume` | Explicit dispatch to registered family consumers |
| `declarations.previewMigration(item, family)` | Read-only, explicit migration preview |
| `authoring.itemOptions.canEdit/createDraft/save/openEditor` | Draft authoring and unified persistence |

`resolveGrants` receives definitions as `{key, entry}` and grants as
`{key, entry, kind}`. Consumers choose semantic keys and supply eligible entries.
Duplicate grant origins are coalesced, independent origins are retained, and
competing active definitions are diagnosed without selecting one arbitrarily.
No feature-name catalogue or inventory requirements are built into shared code.

Conditions remain Item-owned strings passed through the existing
`Ac5eEligibilityAdapter`/AC5E evaluationData and safeEval. The new service adds
family/identity provenance to the supplied `ae5e` context. It does not parse or
evaluate another expression language or add another AC5E declaration flag.

Metamagic authoring templates cover `main`, `option` and `provider` roles, not
individual named options. Option execution metadata refers to a named macro in
an established Item-owned interface (`cat-embedded`, `midi-on-use`,
`actor-on-use` or `effect-macro`); standalone world Macro UUIDs are rejected.
This metadata is a reference, not a new macro engine or a verified CAT pass.
Templates are starting drafts; an option's macro name must be supplied to save.

The preserved Stage 1 runtime still owns its legacy preview path. It has not
been switched to these collections or an Item-owned Metamagic broker, and no new
family consumers are automatically invoked by spellcasting in this slice.
Before constructing finished Items, implement/verify that bridge using the
accepted timing, native debit/refund ownership, range-locality and card services.
Merely storing the new declaration does not make a finished option executable.

## Verification and next installation gate

This slice passed `AE5E_BROWSER_TESTS=1 npm test`: 652 tests, no failures or skips,
including the 18 browser checks; production syntax validation covered 153 files.
`git diff --check` passed. Git comparison against the verified baseline found no
changes under `packs`, `assets`, `scripts/sneak-attack` or `scripts/metamagic`,
and the manifest changes only its version to 0.4.5.33. The publication baseline
is `6e45fe2`. Release validation after the version change passed all 652 tests
with no failures or skips, including the browser checks, and the 153-file syntax
gate.

Focused Node tests cover collection cardinality, multiple families, complete
identity, unknown/malformed data, duplicate keys/ids, activation/AC5E forwarding,
grant provenance/ambiguity, explicit migration, draft preservation, save failures,
concurrent edits, CAT deletion behavior and pack relocking. A Chromium harness
exercises the actual editor mount and a simulated DialogV2 lifecycle, including
18 browser interactions and sheet-entry-point checks.

Run `npm test` and `git diff --check`. Browser execution is opt-in with
`AE5E_BROWSER_TESTS=1 npm test` and requires installed Chromium and permission to
open a loopback test server/browser processes. The browser uses disposable
fixtures, not live Foundry or compendium documents. An ordinary run may skip that
optional browser case; record the separate browser result explicitly.

## Install the source update, then verify in Foundry

This is a GitHub source publication rather than a GitHub Releases asset or a
Foundry package-manager update. Keep the installed module folder and its
`packs/` directory. Stop Foundry, then overlay the following files from the
published 0.4.5.33 commit into the existing `Data/modules/action-effects-5e/`
folder, preserving their relative paths. Create the new source directories as
needed; do not replace the module folder with an extracted repository archive.

```text
module.json
scripts/core/constants.js
scripts/action-effects-5e.js
scripts/api.js
scripts/authoring/cat-metadata-context-menu-service.js
scripts/authoring/item-options-authoring-service.js
scripts/authoring/item-options-editor.js
scripts/declarations/json-data.js
scripts/declarations/family-registry.js
scripts/declarations/collection-service.js
scripts/declarations/metamagic-family.js
styles/action-effects-5e.css
```

Do not copy `packs/`, assets or historical setup/cleanup scripts to apply this
update. No setup Script Macro or Item JSON export is needed. Start Foundry again
and reload each connected browser client. This read-only console check identifies
both the loaded manifest and runtime; both version fields must say `0.4.5.33`:

```js
const ae5eModule = game.modules.get("action-effects-5e");
console.log(JSON.stringify({
  manifestVersion: ae5eModule?.version,
  runtimeVersion: ae5eModule?.api?.version,
  declarationFamilies: ae5eModule?.api?.declarations?.listFamilies().map(family => family.id),
  itemOptionsEditor: typeof ae5eModule?.api?.authoring?.itemOptions?.openEditor
}, null, 2));
```

Expected: `declarationFamilies` includes `metamagic` and `itemOptionsEditor` is
`"function"`. This check reads module state and does not alter world documents.

Verify the installed editor as GM on a
new disposable world/owned Item: header entry point, empty declaration tab,
Add/Edit/Switch/Duplicate/Remove, validation, Save/reopen persistence and Cancel.
Use its CAT editor for actual supported controls and confirm chosen preferences
stay intact. Do not edit an existing pack to run this check. Confirm the actual
installed module version/source before proceeding.

Only after installation and editor verification may the agreed tagged Metamagic
test cleanup occur. Then manually author the finished base and Distant Items
with the user and test the complete Item-owned path under the approved plan.
Keep the existing Sorcery Points pool, legacy Items and Wild Magic macros;
inspect actual resources/temporary free-cast fixtures when live testing resumes.
