# Casting-local target scaling service (v0.4.5.45)

AE5E exposes the generic `api.targetScaling` service to Item macros:

```js
const api = game.modules.get('action-effects-5e').api;
const scaleId = api.targetScaling.arm({ workflow, bonusTargets: 1 });
const dialogId = api.targetConfirmation.arm({ workflow, /* Item-owned display configuration */ });
workflow.workflowOptions.targetConfirmation = 'always';
// If a casting is abandoned BEFORE native consumption/confirmation:
// api.targetScaling.cancel(scaleId); api.targetConfirmation.cancel(dialogId);
```

The service is a one-use staging registration. When D&D5e fires `dnd5e.preActivityConsumption`, native upcasting already has calculated `activity.target.affects.count`; the service checks the temporary casting Activity is different from the embedded source Activity (including Item, target, and affects references), checks casting identity / available numeric target capacity / chosen slot, and adds `bonusTargets` to that copy only. It never changes the spell slot level, spell damage/duration, Sorcery Points, or source Item, and it does not decide whether Twinned may stack with Distant. The Item macro owns rules and cost. Midi still opens the late native Target Confirmation dialog and handles saves/roll/cancel/refund.

The service drops its pending request after one matching consumption event, on cancel, when a new casting of the same Item supersedes it, or on a 180-second idle timeout. It refuses invalid/missing native target counts, unsafely shared Activities, and non-spell-slot consumption; failures return `false` from the `dnd5e.preActivityConsumption` hook to abort Activity use, consistent with the D&D5e 6.0 hook contract. The Item should still handle any separately charged resources if it paid before that hook.

`api.targetScaling.getStatus()` exposes pending count and basic diagnostics (`armed`, `applied`, `rejected`, `canceled`, `expired`). Live Foundry acceptance for the packaged service remains pending after publication, even though the standalone console 3C-01 through 3C-04 tests proved the isolated mutation and multi-target Midi save processing mechanism.
