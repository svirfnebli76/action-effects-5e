# AE5E Target Confirmation Adapter — Phase 3B-04 candidate

**Status:** Published as AE5E 0.4.5.44; live Foundry acceptance pending.
**Target baseline:** AE5E 0.4.5.43 → release 0.4.5.44, Foundry v14 / D&D5e 6.0.6 / Midi-QOL 14.6.3.

## Responsibility split

AE5E owns the reusable opt-in **Midi native TargetConfirmationDialog adapter**:
scoped registration, native UI reshaping, current target art and disposition rings,
validation using `MidiQOL.checkActivityRange()`, rerender lifecycle, restoration,
and bounded per-Item appearance overrides. It does not own spell-specific rules.

The Item macro owns Twinned Spell eligibility, true effective target capacity,
Sorcery Point expenditure, and the Item-specific title/instructions/reminder.
**Phase 3C must establish native effective-level scaling before the late dialog
is created.** This Phase 3B-04 release does not itself provide Twinned scaling
or automatically launch late target confirmation.

## Calling contract

During the exact casting after the Item chooses Twinned, before Midi opens
its **late** confirmation (after the caster chooses the native slot):

```js
const api = game.modules.get('action-effects-5e').api;
const sessionId = api.targetConfirmation.arm({
  workflow, // current executing Midi workflow (not a saved Item or stale workflow)
  title: 'Twinned Spell Targeting',
  instructions: 'Twinned Spell increases the number of creatures this spell can target. **Shift-click** a creature on the canvas to add it, or **Right-click** a selected target below to remove it.',
  counter: '{selected} of {maximum} targets selected.',
  reminder: '(You do not need to use ALL available Target slots)',
  labels: {
    continue: 'Continue Casting',
    cancel: 'Cancel Casting',
    clear: 'Clear Targets'
  },
  validation: { minTargets: 1, enforceRange: true, allowLongRange: true },
  appearance: {
    windowWidth: 480, maxHeight: 800,
    portraitSize: 48, ringWidth: 3,
    instructions: { fontSize: 13, fontWeight: 400, align: 'left' },
    targetName: { fontSize: 14, fontWeight: 700 },
    range: { fontSize: 12, fontWeight: 500 },
    counter: { fontSize: 13, fontWeight: 600, align: 'center' },
    reminder: { fontSize: 12, fontWeight: 400, align: 'center' },
    buttons: { fontSize: 13, fontWeight: 700 }
  }
});

// Arrange native target confirmation through the existing Midi workflow,
// as proven by Phase 3A and 3B diagnostics, not by an AE5E-owned substitute:
workflow.workflowOptions.targetConfirmation = 'always';

// If the casting stops before Midi opens the late native dialog:
// api.targetConfirmation.cancel(sessionId);
```

This snippet describes the *future Twinned Item integration*; it is not installed
into an Item by this candidate. `arm` is opt-in per casting; ordinary Midi dialogs
are unaffected. The adapter claims only one matching native dialog and releases
it on close. Pending registrations for a previous cast of the same Item are
cleared when a new cast begins; pending registrations also expire after 180 s.

## Presentation overrides

`appearance` supports numeric `windowWidth`, `maxHeight`, `portraitSize`,
`ringWidth`, `rowMinHeight`, `rowPadding`, `rowGap`, `sectionGap`, `reminderGap`;
text slots `title`, `instructions`, `targetName`, `range`, `counter`, `reminder`,
`buttons` support `{fontSize, fontWeight, textColor, align}`. `fontSize` is
bounded to 8–48 px; weights are multiples of 100 between 100 and 900;
`textColor` accepts only six-digit hexadecimal colors; align is left/center/right.
`rowBackgroundColor` accepts a six-digit hex color. `colors` permits overriding
`hostile`, `friendly`, `neutral`, `secret`, `unrevealed`, `inRange`, `longRange`,
and `outOfRange` with six-digit hex values.

Defaults inherit the existing AE5E broker green (`#18cc46`), amber (`#ff9f1c`),
and red (`#f05b5b`) presentation vars; the approved purple fallback for authorized
Secret tokens is `#a668d8`. Unauthorized players get a nondistinct neutral-grey
ring (`unrevealed`); AE5E never creates a secret CSS marker for them.

Item-supplied instructions are displayed as escaped text, with just `**bold**`
converted into strong text nodes. No arbitrary Item HTML or CSS is executed.
Original Midi target images/names/range strings remain authoritative, including
video thumbnails and player-visible name handling.

## Validation / cancellation

The adapter enforces min/max selected targets and rejects result `fail` from
`checkActivityRange`. Result `dis` is valid by default (long range might imply
attack disadvantage but not prohibition); it can be disallowed per request.
The final action is disabled if any selected target fails. A capture-phase
click/keyboard/submit guard separately rejects stale activation.

The adapter does **not** create a new refund path or spend resources; native Midi
Roll and Cancel remain untouched. If its own markup application fails, it invokes
native `app.close()` to cancel and trigger Midi's callback/refund rather than
silently permitting a cast without the requested validation.

## Tests and live acceptance

`node --test tests/target-confirmation-adapter.test.mjs`

Tests verify bounded customization, AE5E palette, Secret privacy, owner scoping,
request cancellation, and stale-registration prevention.

After publication, Foundry acceptance (not yet conducted) must cover:

1. Normal Midi dialogs unchanged when no Item has armed the adapter.
2. Twinned title/instructions, portrait on left, correct disposition rings,
   native thumbnail of an animated token, and no secret purple for players.
3. Accurate `X of Y targets selected.` after native upcast/Twinned scaling
   has been applied in Phase 3C (3B alone still uses native count).
4. Target row statuses and invalid range enforcement, including movement of
   caster/target and keyboard/submit paths.
5. Continue Casting on a valid selection with unused capacity succeeds.
6. Cancel Casting, window X, and Escape retain native resource refunds.
7. No duplicate hooks, stale requests, or side effects on other Item casts.

**No packs, Items, macros, or assets are modified by this candidate.**

## v0.4.5.45 presentation additions (Item-owned)

`arm()` additionally accepts `banner` (safe same-origin `modules/...` or `systems/...` image path; webp, PNG or JPEG) and optional `instructionLayout` with a centered `description` and 1–3 rows of `{label, text, tone}`. Tone is `positive`, `negative` or `neutral`. This is rendered with DOM text nodes, not HTML. The old `instructions` plain-text / `**bold**` form remains supported.

Twinned Spell Item example (not installed by this release):

```js
api.targetConfirmation.arm({
  workflow,
  title: 'Twinned Spell Targeting',
  banner: 'modules/action-effects-5e/assets/banners/feats/twinnedSpell.webp',
  instructionLayout: {
    description: 'Twinned Spell increases the number of creatures this spell can target',
    commands: [
      { label: 'SHIFT-CLICK', text: ' a token to add a Target', tone: 'positive' },
      { label: 'RIGHT-CLICK', text: ' a token to remove a Target', tone: 'negative' }
    ]
  },
  counter: '{selected} of {maximum} targets selected.',
  reminder: '(You do not need to use ALL available Target slots)',
  labels: { clear: 'Clear Targets', cancel: 'Cancel Casting', continue: 'Continue Casting' },
  validation: { minTargets: 1, enforceRange: true, allowLongRange: true },
  appearance: {
    windowWidth: 500, maxHeight: 800, bannerRadius: 6, bannerGap: 10,
    instructionLeadGap: 12, instructionLineGap: 4,
    instructions: { fontSize: 15, fontWeight: 400, align: 'center' },
    portraitSize: 48, ringWidth: 3
  }
});
```

The `positive` and `negative` command labels inherit AE5E's acceptance green (`#18cc46`) and warning red (`#f05b5b`) respectively, and respect the already bounded `appearance.colors.friendly` / `appearance.colors.hostile` override. Button order is clear → cancel → continue for both keyboard and visual order; original Midi callbacks and cancellation/refund ownership remain unchanged. Banner failure hides the decorative image without interrupting casting. Ordinary non-opted-in Midi confirmations are unaffected.
