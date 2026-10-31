// Existing base Metamagic Item CAT Embedded Macro.
// Name: Metamagic Broker | Event: Called | Pass: actorAe5eDeclarationBroker
// AE5E invokes THIS SAME broker at each phase with relevant learned options.
if (data?.namespace !== "ae5e.declarations" || data.family !== "metamagic"
  || data.kind !== "broker"
  || document?.uuid !== data.sourceItemUuid || macroName !== data.execution.name) return;

const note = message => { try { console.info(message); } catch {} };
const actorName = data.context.actor.name ?? data.context.actor.uuid;

if (data.phase === "consumed") {
  note("[AE5E] Metamagic - " + actorName + " used Metamagic");
  return data.respond(document, macroName, true);
}
if (data.phase !== "begin") return;

const api = game.modules.get("action-effects-5e")?.api;
if (!api?.prompts?.chooseBroker) throw new Error("AE5E's broker choice prompt service is unavailable.");

const result = await data.context.begin(document, async ({
  phase, casting, offers, resource, selectionLimit, closeOutcome
}) => {
  const late = phase === "saves-ready";
  const prompt = late
    ? "With the spell’s targets selected, you may use an available Metamagic option to alter its effects, or continue without using Metamagic."
    : "Before casting, you may use an available Metamagic option to modify the spell, or continue casting normally.";

  const current = Number(resource?.current ?? 0);
  const maximum = Number.isFinite(Number(resource?.max)) ? Number(resource.max) : current;

  return api.prompts.chooseBroker({
    actorUuid: casting.casterActorUuid,
    tokenUuid: casting.casterTokenUuid,
    controllerUserId: casting.controllerUserId,
    role: "originator",
    title: "Metamagic",
    banner: "modules/action-effects-5e/assets/banners/feats/metamagic.webp",
    prompt,
    choices: offers.map(offer => ({
      id: offer.id,
      label: offer.label,
      description: offer.description ?? offer.declaration?.tooltip ?? "",
      cost: offer.cost,
      costLabel: String(offer.cost),
      selectionCost: offer.declaration?.selectionCost ?? 1,
      disabled: offer.disabled === true,
      acceptances: offer.acceptances ?? [],
      advisories: offer.advisories ?? [],
      reasons: offer.reasons ?? (offer.reason ? [offer.reason] : [])
    })),
    resource: { current, max: maximum, summary: current + "/" + maximum },
    selectionCapacity: Math.max(0, Number(selectionLimit) || 0),
    confirmLabel: "Use Metamagic",
    declineLabel: "Normal Casting",
    closeOutcome: late ? "decline" : (closeOutcome ?? "abort"),
    reason: late ? "metamagic-saves-ready" : "metamagic-pre-cast"
  });
});

return data.respond(document, macroName, result);
