// Paste into the base Item's CAT Embedded Macro editor.
// Name: Metamagic Broker | Event: Called | Pass: actorAe5eDeclarationBroker
if (data?.namespace !== "ae5e.declarations" || data.family !== "metamagic"
  || data.kind !== "broker" || data.phase !== "begin"
  || document?.uuid !== data.sourceItemUuid || macroName !== data.execution.name) return;

const api = game.modules.get("action-effects-5e")?.api;
if (!api?.prompts?.choose) throw new Error("AE5E's choice prompt service is unavailable.");

const result = await data.context.begin(document, async ({ casting, offers, selectionLimit }) => {
  const selected = [];
  while (selected.length < selectionLimit) {
    const spent = offers.filter(offer => selected.includes(offer.id)).reduce((sum, offer) => sum + offer.cost, 0);
    const remaining = offers.filter(offer => !selected.includes(offer.id));
    if (!remaining.length) break;
    const id = await api.prompts.choose({
      actorUuid: casting.casterActorUuid,
      tokenUuid: casting.casterTokenUuid,
      controllerUserId: casting.controllerUserId,
      role: "originator",
      title: "Metamagic",
      prompt: "Choose an option, or continue casting without another option.",
      reason: "metamagic-choice",
      allowCancel: true,
      cancelLabel: "Continue casting",
      choices: remaining.map(offer => ({
        id: offer.id,
        label: offer.label,
        detail: `${offer.cost} Sorcery Point(s). ${offer.declaration.tooltip}${offer.reason ? ` ${offer.reason}` : ""}`,
        disabled: offer.disabled || spent + offer.cost > offer.available
      })).concat({ id: "__finish", label: "Continue casting" }),
      defaultChoiceId: "__finish"
    });
    if (id == null || id === "__finish") break;
    selected.push(id);
  }
  return selected;
});
return data.respond(document, macroName, result);
