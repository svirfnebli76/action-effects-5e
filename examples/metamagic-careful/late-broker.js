// CAT Embedded Macro: Metamagic Late Broker
// Event: Called | Pass: actorAe5eDeclarationBroker | Priority: 50
// Add as a second macro on the existing Metamagic base Item. DO NOT replace
// the accepted pre-cast "Metamagic Broker" macro.
if (data?.namespace !== "ae5e.declarations" || data.family !== "metamagic"
    || data.kind !== "broker" || data.phase !== "late-begin"
    || document?.uuid !== data.sourceItemUuid
    || macroName !== data.execution.name) return;

const api = game.modules.get("action-effects-5e")?.api;
if (!api?.prompts?.chooseBroker) throw new Error("AE5E late broker choice service is missing.");

const result = await data.context.begin(document, async ({
  phase, casting, offers, resource, selectionLimit
}) => {
  const list = offers.map(offer => ({
    id: offer.id,
    label: offer.label,
    description: offer.description ?? offer.declaration?.tooltip ?? "",
    cost: offer.cost,
    selectionCost: offer.declaration?.selectionCost ?? 1,
    disabled: offer.disabled,
    acceptances: offer.acceptances ?? [],
    advisories: offer.advisories ?? [],
    reasons: offer.reasons ?? (offer.reason ? [offer.reason] : [])
  }));
  const current = Number(resource.current);
  const maximum = Math.max(current, Number(resource.max));
  return api.prompts.chooseBroker({
    actorUuid: casting.casterActorUuid,
    tokenUuid: casting.casterTokenUuid,
    controllerUserId: casting.controllerUserId,
    role: "originator",
    title: "Metamagic",
    banner: "modules/action-effects-5e/assets/banners/feats/metamagic.webp",
    prompt: "With the spell's targets selected, you may use an available Metamagic option to alter its effects, or continue without using Metamagic. TEST PREVIEW: No points or protection will be applied.",
    choices: list,
    resource: { current, max: maximum, summary: String(current) + "/" + String(maximum) },
    selectionCapacity: Math.max(1, Number(selectionLimit) || 0),
    confirmLabel: "Use Metamagic (Preview)",
    declineLabel: "Normal Casting",
    closeOutcome: "decline",
    reason: "metamagic-save-ready-preview"
  });
});
return data.respond(document, macroName, result);
