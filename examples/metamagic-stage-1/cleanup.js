/* GM: control the disposable caster after all test casts finish. No combat required.
 * Deletes ONLY test-tagged Metamagic feature Items on that actor. Does not refund
 * completed casts or change the pool, spells, legacy Items or existing macros.
 */
(async () => {
  if (!game.user.isGM || canvas.tokens.controlled.length !== 1) throw new Error("Run as GM with exactly one test caster controlled.");
  const actor = canvas.tokens.controlled[0].actor;
  const ids = actor.items.filter(item => item.flags?.["action-effects-5e"]?.testFixture === "metamagic-stage-1").map(item => item.id);
  await actor.deleteEmbeddedDocuments("Item", ids);
  console.log(`AE5E Stage 1 cleanup\n${JSON.stringify({ actorUuid: actor.uuid, deletedItemIds: ids,
    pointsUnchangedByCleanup: true,
    retainedTestMacros: game.macros.filter(macro => macro.flags?.["action-effects-5e"]?.testFixture === "metamagic-stage-1").map(macro => macro.uuid),
    note: "The tagged Distant world Macro is retained for other test actors. Delete it manually after all Stage 1 testing is finished."
  }, null, 2)}`);
})();
