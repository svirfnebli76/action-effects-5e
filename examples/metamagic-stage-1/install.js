/* Run as GM in a TEST world, with exactly one disposable caster token controlled.
 * Requires one existing native sorcery-points Item. No combat or casting occurs.
 * Creates only tagged test Items on that caster and one new world Script Macro.
 * Never edits character legacy Items, macros, pools, or compendiums.
 */
(async () => {
  const scope = "action-effects-5e";
  const tag = "metamagic-stage-1";
  if (!game.user.isGM) throw new Error("Run as GM.");
  if (canvas.tokens.controlled.length !== 1) throw new Error("Control exactly one disposable caster token.");
  const actor = canvas.tokens.controlled[0].actor;
  const api = game.modules.get(scope)?.api;
  if (!api?.metamagic) throw new Error("Install the Stage 1 source preview locally and reload first.");
  const pools = actor.items.filter(item => item.system?.identifier === "sorcery-points");
  if (pools.length !== 1) throw new Error("Caster must have exactly one existing native sorcery-points Item. No new pool will be created.");
  if (actor.items.some(item => item.flags?.[scope]?.metamagic?.type === "main" && item.flags?.[scope]?.testFixture !== tag)) {
    throw new Error("This actor already has a non-test main Metamagic declaration; use a disposable caster.");
  }
  const existing = actor.items.filter(item => item.flags?.[scope]?.testFixture === tag);
  if (existing.length) {
    console.log(`AE5E Stage 1 already installed; no changes.\n${JSON.stringify(api.metamagic.reconcile(actor), null, 2)}`);
    return;
  }
  const route = foundry.utils.getRoute?.(`modules/${scope}/examples/metamagic-stage-1/`) ?? `modules/${scope}/examples/metamagic-stage-1/`;
  const response = await fetch(`${route}declarations.json`);
  if (!response.ok) throw new Error(`Declaration fixture download failed (${response.status}).`);
  const definitions = await response.json();
  const { distantSpell } = await import(`${window.location.origin}/${route.replace(/^\//, "")}distant-spell.mjs`);
  let macro = game.macros.find(document => document.flags?.[scope]?.testFixture === tag);
  let createdMacro = false;
  if (!macro) {
    macro = await Macro.create({ name: "AE5E Test — Distant Spell", type: "script", scope: "global",
      command: `return await (${distantSpell.toString()})(scope);`,
      flags: { [scope]: { testFixture: tag } } });
    createdMacro = true;
  }
  definitions.main.resource.itemId = pools[0].id;
  definitions.distant.execution.macroUuid = macro.uuid;
  const feature = (name, identifier, declaration) => ({ name, type: "feat", img: "icons/magic/symbols/runes-star-pentagon-magenta.webp",
    system: { identifier, type: { value: "class", subtype: "" }, description: { value: `<p>${declaration.tooltip ?? "AE5E Stage 1 test configuration. Uses the existing Sorcery Points pool."}</p>` } },
    flags: { [scope]: { testFixture: tag, metamagic: declaration } } });
  let items;
  try {
    items = await actor.createEmbeddedDocuments("Item", [
      feature("AE5E Test — Metamagic", "ae5e-test-metamagic", definitions.main),
      feature("AE5E Test — Distant Spell", "ae5e-test-distant-spell", definitions.distant)
    ]);
  } catch (error) {
    if (createdMacro) await macro.delete();
    throw error;
  }
  console.log(`AE5E Stage 1 installation. No combat or resource consumption occurred.\n${JSON.stringify({
    actorUuid: actor.uuid, items: items.map(item => item.uuid), macroUuid: macro.uuid,
    poolUuid: pools[0].uuid, pointsAvailable: pools[0].system.uses.value,
    declarations: api.metamagic.reconcile(actor)
  }, null, 2)}`);
})();
