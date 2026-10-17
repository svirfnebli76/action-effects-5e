import { MODULE_ID } from "../core/constants.js";
import { MetamagicCollectionConsumer } from "./collection-consumer.js";

/** Collection-only Item rules and provenance. Never creates or rewrites Items. */
export class MetamagicDeclarationService {
  constructor({ collections }) {
    this.collections = collections;
    this.consumer = new MetamagicCollectionConsumer({ collections });
  }

  hasBase(actor) {
    return [...(actor?.items ?? [])].some(item => {
      const records = item.flags?.[MODULE_ID]?.metamagic?.declarations;
      return Array.isArray(records) && records.some(record => record?.type === "main");
    });
  }

  read(item) { return this.collections.read(item, "metamagic"); }

  compile(actor, context = {}) { return this.consumer.compile(actor, context); }
}
