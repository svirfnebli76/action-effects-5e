// CAT Embedded Macro: Careful Spell
// Event: Called | Pass: actorAe5eDeclarationOption | Priority: 50
// This Stage B5.3 preview records selected creatures only. Does not pay or protect.
if (data?.namespace !== "ae5e.declarations" || data.family !== "metamagic"
    || data.kind !== "option" || document?.uuid !== data.sourceItemUuid
    || macroName !== data.execution.name) return;

const wf = data.context?.workflow;
const caster = data.context?.actor;
const maxProtect = Math.max(1, Number(caster?.system?.abilities?.cha?.mod) || 0);
const secret = globalThis.CONST?.TOKEN_DISPOSITIONS?.SECRET ?? -2;
const relevant = [...(wf?.hitTargets ?? wf?.targets ?? [])];
const eligible = relevant.filter(token => {
  const doc = token?.document ?? token;
  return doc && doc.disposition !== secret && !!(doc.uuid ?? token.uuid);
});
const unique = [...new Map(eligible.map(token => {
  const doc = token.document ?? token;
  return [doc.uuid ?? token.uuid, token];
})).values()];

if (data.phase === "offer") {
  const reasons = [];
  if (data.context.castingPhase !== "saves-ready") reasons.push("Careful Spell requires finalized targets.");
  if (!wf?.activity || (wf.item ?? wf.activity?.item)?.type !== "spell")
    reasons.push("Careful Spell can modify only spells.");
  if (!unique.length)
    reasons.push("There are no eligible affected creatures to protect.");
  // Save-throw validation uses Activity data rather than a spell catalogue.
  const saveActivity = wf.activity?.type === "save" ||
    Boolean(wf.activity?.save?.ability?.length || wf.activity?.save?.dc);
  if (!saveActivity)
    reasons.push("This Activity does not require a saving throw.");
  return data.respond(document, macroName, {
    eligible: reasons.length === 0,
    reasons,
    description: "Choose up to " + maxProtect +
      " affected creature(s). They automatically succeed on the initial save and avoid half damage.",
    advisory: "Preview only: Sorcery Points are not spent and saving throws are not modified."
  });
}

if (data.phase !== "select") return;
if (!data.context.previewOnly) throw new Error("Careful Spell preview requires explicit preview mode.");
if (!unique.length) return data.respond(document, macroName, { outcome: "decline" });

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, ch =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]
);
const colorFor = doc => ({
  [-1]: "#e74c3c", [0]: "#e2a53c", [1]: "#18cc46"
})[doc?.disposition] ?? "#9ca3af";

const controls = unique.map(token => {
  const doc = token.document ?? token;
  const uuid = doc.uuid ?? token.uuid;
  const name = doc.name ?? token.name ?? token.actor?.name ?? "Creature";
  const portrait = doc.texture?.src ?? token.actor?.img ??
    "icons/svg/mystery-man.svg";
  const border = colorFor(doc);
  return '<label style="display:flex;align-items:center;gap:10px;padding:5px 8px;min-height:52px;cursor:pointer;">' +
    '<input type="checkbox" name="ae5e-careful-protected" value="' + escapeHtml(uuid) + '">' +
    '<img src="' + escapeHtml(portrait) + '" style="width:48px;height:48px;object-fit:cover;border-radius:50%;border:3px solid ' + border + ';">' +
    '<span style="flex:1;font-size:13px;">' + escapeHtml(name) + '</span></label>';
}).join("");

const content = '<section class="ae5e-careful-preview" style="width:100%;padding:0 6px;">' +
  '<img src="modules/action-effects-5e/assets/banners/feats/carefulSpell.webp" ' +
  'style="width:100%;border-radius:6px;display:block;margin:0 auto 12px;">' +
  '<p style="text-align:center;">Choose which creatures to protect from the spell&#39;s initial saving throw.</p>' +
  '<p style="text-align:center;font-size:12px;">You may select between 1 and ' + maxProtect +
  ' eligible affected creatures. Secret creatures are excluded.</p>' +
  '<p style="color:#e67e22;text-align:center;font-size:12px;">' +
  'TEST PREVIEW ONLY: This does not spend Sorcery Points or change saving throws.</p>' +
  '<div style="max-height:420px;overflow-y:auto;">' + controls + '</div>' +
  '<p style="text-align:center;font-size:12px;">You do not need to use all available protection slots.</p>' +
  '</section>';

const DialogV2 = foundry.applications.api.DialogV2;
const answer = await DialogV2.wait({
  window: { title: "Careful Spell Protection", resizable: true },
  position: { width: 500 },
  content,
  buttons: [
    {
      action: "confirm",
      label: "Preview Protection",
      icon: "fa-solid fa-check",
      default: true,
      callback: (event, button, dialog) => {
        const checked = Array.from(dialog.element.querySelectorAll(
          'input[name="ae5e-careful-protected"]:checked'
        )).map(node => node.value);
        if (!checked.length || checked.length > maxProtect) {
          ui.notifications.warn("Choose between 1 and " + maxProtect + " creatures.");
          return { outcome: "decline" };
        }
        return { outcome: "confirm", selectedTokenUuids: checked };
      }
    },
    {
      action: "cancel",
      label: "Cancel Careful Spell",
      icon: "fa-solid fa-xmark",
      callback: () => ({ outcome: "decline" })
    }
  ],
  close: () => ({ outcome: "decline" })
});
return data.respond(document, macroName, answer ?? { outcome: "decline" });
