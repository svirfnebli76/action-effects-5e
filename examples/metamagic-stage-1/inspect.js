/* GM read-only diagnostics. No combat, casting, resources, or documents changed. */
(() => {
  if (!game.user.isGM || canvas.tokens.controlled.length !== 1) throw new Error("Run as GM with exactly one test caster controlled. No combat required.");
  const actor = canvas.tokens.controlled[0].actor;
  const api = game.modules.get("action-effects-5e")?.api;
  const report = {
    versions: { foundry: game.version, system: game.system.version,
      modules: ["action-effects-5e", "midi-qol", "cat", "dae"].map(id => ({ id, version: game.modules.get(id)?.version })) },
    actorUuid: actor.uuid, declarations: api.metamagic.reconcile(actor),
    pools: actor.items.filter(item => item.system?.identifier === "sorcery-points")
      .map(item => ({ uuid: item.uuid, max: item.system.uses.max, spent: item.system.uses.spent, available: item.system.uses.value })),
    recent: api.metamagic.getRecentCastings()
  };
  const text = JSON.stringify(report, null, 2);
  for (let index = 0; index < text.length; index += 1600) console.log(`AE5E METAMAGIC STAGE 1 ${index / 1600 + 1}\n${text.slice(index, index + 1600)}`);
})();
