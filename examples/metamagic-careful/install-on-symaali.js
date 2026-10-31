// AE5E 0.4.5.53 Careful Spell preview Item installer (Symaali only).
// No compendium writes, no Sorcery Point debit, no save/damage modification.
(async () => {
  "use strict";
  const ID="wxeRMRdZhusJLxt0", MOD="action-effects-5e";
  const actor=game.actors.get(ID), module=game.modules.get(MOD);
  const deep=value=>foundry.utils.deepClone(value);
  const requireOk=(ok,message)=>{if(!ok)throw new Error(message);};
  const root="modules/action-effects-5e/examples/metamagic-careful/";
  let createdId=null,base=null,oldRecords=null,oldMacros=null,changedBase=false;
  console.group("AE5E Careful Spell — Install on Symaali");
  try {
    requireOk(actor?.isOwner,"Symaali is not found or you do not own the Actor.");
    requireOk(module?.version==="0.4.5.53","Install AE5E 0.4.5.53 first.");
    requireOk(typeof module.api?.metamagic?.reconcile==="function","Metamagic API unavailable.");
    const ownedItems=Array.from(actor.items.values());
    const pool=ownedItems.find(i=>i.system?.identifier==="sorcery-points");
    requireOk(pool,"Sorcery Points Item is missing.");
    requireOk(!ownedItems.some(i=>i.system?.identifier==="careful-spell" || /careful[\s-]*spell/i.test(i.name)),
      "A Careful Spell Item already exists; this installer will not overwrite it.");
    const mains=ownedItems.flatMap(i=>(i.flags?.[MOD]?.metamagic?.declarations??[])
      .filter(r=>r?.type==="main").map(record=>({item:i,record})));
    requireOk(mains.length===1,"Expected exactly one base Metamagic declaration.");
    base=mains[0].item;
    const main=mains[0].record;
    requireOk(!main.lateExecution || (
      main.lateExecution.interface==="cat-embedded" && main.lateExecution.name==="Metamagic Late Broker"
    ),"Base already has a different lateExecution; nothing overwritten.");
    const declarations=ownedItems.flatMap(i=>i.flags?.[MOD]?.metamagic?.declarations??[]);
    const learned=declarations.filter(r=>r?.type==="option" && r.acquisition!=="grant-only").length;
    const bonus=declarations.filter(r=>r?.type==="provider")
      .reduce((total,r)=>total+(Number(r.choiceBonus)||0),0);
    const cap=(Number(main.optionChoices)||0)+bonus;
    requireOk(learned+1<=cap,"Metamagic learned-choice capacity reached ("+
      learned+"/"+cap+"). Increase the TEST actor's approved choice capacity first.");
    const getScript=async filename=>{
      const response=await fetch(root+filename,{cache:"no-store"});
      requireOk(response.ok,"Missing installed script "+filename+" ("+response.status+").");
      const s=await response.text();
      requireOk(s.includes("data.respond(document, macroName"),"Invalid CAT script "+filename);
      return s;
    };
    const [brokerSource,carefulSource]=await Promise.all([
      getScript("late-broker.js"),getScript("careful-spell.js")
    ]);
    const entry=(name,pass,source)=>({
      name,event:"called",pass,macros:[{priority:50,macro:source}]
    });
    oldRecords=deep(base.flags?.[MOD]?.metamagic?.declarations??[]);
    oldMacros=deep(base.flags?.cat?.embeddedMacros??[]);
    requireOk(oldMacros.some(m=>m.name==="Metamagic Broker"),
      "Existing base Metamagic Broker CAT macro was not found.");
    const existingLate=oldMacros.filter(m=>m.name==="Metamagic Late Broker");
    requireOk(!existingLate.length,"Late Broker CAT macro is already installed; refusing to duplicate.");
    const newBaseRecords=oldRecords.map(r=>r.type==="main"
      ? {...r,lateExecution:{interface:"cat-embedded",name:"Metamagic Late Broker"}}:r);
    const carefulData={
      name:"Metamagic — Careful Spell",type:"feat",
      img:"modules/action-effects-5e/assets/icons/feats/Sorcerer/metamagicCarefullSpell.webp",
      system:{
        identifier:"careful-spell",type:{value:"class",subtype:"metamagic"},
        source:{rules:"2024"},
        description:{value:"<p><strong>Cost:</strong> 1 Sorcery Point.</p>"+
          "<p>Choose up to your Charisma modifier (minimum one) of the creatures "+
          "affected by a saving-throw spell. A chosen creature automatically succeeds "+
          "on its initial save and takes no damage if success would normally halve it.</p>"+
          "<p><em>AE5E B5.3 preview: no points spent or protection applied until payment is integrated.</em></p>",
          chat:""},
        uses:{max:"",spent:0,recovery:[]},activities:{},properties:[]
      },
      effects:[],
      flags:{
        [MOD]:{metamagic:{version:1,declarations:[{
          id:"careful-spell",type:"option",cost:1,selectionCost:1,
          tooltip:"Select creatures to protect from this spell's initial saving throw.",
          phases:["saves-ready"],acquisition:"learned",
          execution:{interface:"cat-embedded",name:"Careful Spell"}
        }]}},
        cat:{embeddedMacros:[entry("Careful Spell","actorAe5eDeclarationOption",carefulSource)]}
      }
    };
    const created=(await actor.createEmbeddedDocuments("Item",[carefulData]))[0];
    requireOk(created,"The Item could not be created.");
    createdId=created.id;
    const path="flags."+MOD+".metamagic.declarations";
    await base.update({[path]:newBaseRecords,
      "flags.cat.embeddedMacros":[...oldMacros,entry("Metamagic Late Broker",
        "actorAe5eDeclarationBroker",brokerSource)]});
    changedBase=true;
    const compiled=module.api.metamagic.reconcile(actor);
    requireOk(compiled?.ready,"Metamagic compilation rejected this Item: "+
      (compiled?.diagnostics??[]).map(x=>x.message).join(" | "));
    requireOk(compiled.options?.some(x=>x.id==="careful-spell"),
      "Careful Spell was not discovered in the Metamagic collection.");
    console.log("ITEM CREATED:",created.name,created.uuid);
    console.log("BASE UPDATED:",base.name,base.uuid);
    console.log("Careful CAT: Called / actorAe5eDeclarationOption / Careful Spell");
    console.log("Late broker CAT: Called / actorAe5eDeclarationBroker / Metamagic Late Broker");
    console.log("Declaration: careful-spell / saves-ready / 1 SP (preview only)");
    console.log("Sorcery Points unchanged:",pool.system.uses.value);
    console.log("FINAL RESULT: PASS");
    ui.notifications.info("Careful Spell and late broker installed on Symaali in preview mode.");
  } catch(error) {
    console.error("INSTALL FAILED:",error);
    if(createdId) {
      try {await actor.deleteEmbeddedDocuments("Item",[createdId]);}
      catch(e){console.error("Could not roll back newly created Careful Item:",e);}
    }
    if(changedBase && base) {
      try {const path="flags."+MOD+".metamagic.declarations";
        await base.update({[path]:oldRecords,"flags.cat.embeddedMacros":oldMacros});}
      catch(e){console.error("Could not restore base broker:",e);}
    }
    ui.notifications.error("AE5E Careful installer: "+error.message);
  } finally {console.groupEnd();}
})();
