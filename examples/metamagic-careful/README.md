# Careful Spell — paid save-ready integration (AE5E 0.4.5.56)

The existing Metamagic Broker is reused at saves-ready. Careful Spell owns
eligibility, creature selection, and its declarative save-protection request.

AE5E validates the request, debits the aggregate late Metamagic cost through
D&D5e Actor.performBulkUpdate, then arms the active Midi-QOL workflow. If
application fails after payment, AE5E removes its protection and immediately
restores the verified debit.

Protected tokens return true from the workflow's sculpt/careful check and are
added to workflow.superSavers. The method override is restored after
midi-qol.postCheckSaves; superSavers remain for later damage resolution.

No second Metamagic broker is introduced, and AE5E does not create or overwrite
the Careful Spell compendium Item.
