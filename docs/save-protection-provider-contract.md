# Item-owned save-protection provider contract

AE5E v0.4.5.64 exposes generic, resource-free save protection at the awaited
Midi-QOL `saves-ready` boundary. AE5E owns workflow timing, affected-target
validation, automatic-save/super-saver mutation, claim isolation, rollback, and
cleanup. The source Item owns every feature rule, limit, visibility decision,
wording, image, and creature-selection interaction.

This family is separate from Metamagic. A class feature does not require the
Metamagic base Item, does not consume Sorcery Points, and does not count against
Metamagic selection capacity.

## Declaration

Store the versioned collection at
`flags.action-effects-5e.saveProtection`:

```json
{
  "version": 1,
  "declarations": [
    {
      "id": "feature-id",
      "type": "feature",
      "phase": "saves-ready",
      "priority": 0,
      "execution": {
        "interface": "cat-embedded",
        "name": "Feature Macro"
      }
    }
  ]
}
```

Configure exactly one CAT embedded Item macro with:

- Event: `Called`
- Pass: `actorAe5eDeclarationFeature`
- Name: the declaration's exact `execution.name`
- Priority: `50` unless the Item has a documented reason to choose another

## CAT phases

The macro must reject requests for any other source Item, family, kind, or macro
name. It may then receive these phases:

1. `offer` — return exactly one response containing `{eligible: boolean}`.
   The Item decides whether the current spell and finalized affected creatures
   qualify. An ineligible result opens no prompt.
2. `select` — present the Item-owned interaction and return either
   `{outcome:"decline"}` or `{outcome:"confirm", payload:{...}}`.
3. `apply` — revalidate the Item-owned selection and return
   `{saveProtection:{tokenUuids:[...], automaticSuccess:true, superSaver:true}}`.
4. `applied` — optional, nonblocking lifecycle notification after protection is
   armed. No response is required.

AE5E rejects duplicate/empty UUIDs, unsupported protection semantics, and any
creature outside the workflow's finalized `hitTargets`/`targets`. Item-owned
rules must still revalidate limits, caster exclusion, visibility, school, spell
level, and any other rule-specific fact immediately before `apply` responds.

## Composition and cleanup

Each successful provider receives an independent internal claim. Multiple
features may protect the same creature. Rolling back one claim removes only the
state owned solely by that claim. At `midi-qol.postCheckSaves`, AE5E restores
Midi's original automatic-save method but deliberately leaves super-saver
membership available for the workflow's later damage resolution.

Careful Spell's existing late Metamagic transaction uses this same application
service. Its Item declaration, CAT macro, Sorcery Point debit, and rollback
contract remain Metamagic-owned and unchanged.
