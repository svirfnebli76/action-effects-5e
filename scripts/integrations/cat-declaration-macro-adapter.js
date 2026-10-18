import { duplicateSafely, randomId } from "../core/utils.js";

export const DECLARATION_MACRO_PASSES = Object.freeze({
  broker: "ae5eDeclarationBroker", option: "ae5eDeclarationOption"
});
export const declarationActorPass = kind => `actor${DECLARATION_MACRO_PASSES[kind][0].toUpperCase()}${DECLARATION_MACRO_PASSES[kind].slice(1)}`;

/** Uses CAT's public Called-event dispatcher. Never compiles or evaluates code. */
export class CatDeclarationMacroAdapter {
  constructor({ catAccessor = () => globalThis.cat } = {}) { this.catAccessor = catAccessor; }

  notify(request) { return this.execute({ ...request, requireResponse: false }); }

  async execute({ actor, sourceUuid, identity, family, declaration, kind, phase, context, requireResponse = true }) {
    const pass = DECLARATION_MACRO_PASSES[kind];
    const source = [...(actor?.items ?? [])].find(item => item.uuid === sourceUuid);
    const execution = declaration.execution;
    if (!pass || !source || source.actor !== actor || !actor.isOwner) throw new Error("An owned source Item is required for declaration execution.");
    if (execution?.interface !== "cat-embedded") throw new Error("This casting adapter requires the CAT embedded Item macro interface.");
    const macros = (source.flags?.cat?.embeddedMacros ?? []).filter(macro => macro.name === execution.name);
    if (macros.length !== 1 || macros[0].event !== "called" || macros[0].pass !== declarationActorPass(kind)
      || macros[0].macros?.length !== 1 || typeof macros[0].macros[0].macro !== "string" || !macros[0].macros[0].macro.trim()) {
      throw new Error(`Configure exactly one '${execution.name}' CAT Called macro on ${source.name}, with pass '${declarationActorPass(kind)}'.`);
    }
    const automation = this.catAccessor()?.utils?.automationUtils;
    if (typeof automation?.calledEvent !== "function") throw new Error("CAT's public calledEvent dispatcher is unavailable.");
    const responses = [];
    let invalidResponse = false;
    let open = true;
    const request = {
      namespace: "ae5e.declarations", requestId: randomId(), kind, phase, family, identity,
      sourceItemUuid: sourceUuid, declarationId: declaration.id,
      execution: duplicateSafely(execution), declaration: duplicateSafely(declaration), context,
      respond(document, name, result) {
        if (!open || document !== source || name !== execution.name || responses.length) {
          invalidResponse = true;
          throw new Error("Declaration macro response has an incorrect source or was repeated.");
        }
        responses.push(result);
        return true;
      }
    };
    try {
      await automation.calledEvent(pass, actor, { canOverlap: true, multiResult: true, data: request });
    } finally { open = false; }
    // CAT catches script errors. Transactions need a response; optional
    // lifecycle notifications may be ignored by the receiving Item macro.
    if (invalidResponse || (requireResponse && responses.length !== 1)) throw new Error(`No unique response from '${execution.name}' on ${source.name}.`);
    return responses[0];
  }
}
