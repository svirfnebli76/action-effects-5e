import { DeclarationFamilyRegistry } from "../../scripts/declarations/family-registry.js";
import { DeclarationCollectionService } from "../../scripts/declarations/collection-service.js";
import { registerMetamagicFamily } from "../../scripts/declarations/metamagic-family.js";
import { CatConfigurationAuthoringService } from "../../scripts/authoring/cat-configuration-authoring-service.js";
import { ItemOptionsAuthoringService } from "../../scripts/authoring/item-options-authoring-service.js";

const copy = value => JSON.parse(JSON.stringify(value));
function merge(target, data) {
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith("-=")) delete target[key.slice(2)];
    else if (value && typeof value === "object" && !Array.isArray(value)) {
      target[key] ??= {};
      merge(target[key], value);
    } else target[key] = copy(value);
  }
}
export function applyUpdates(item, updates) {
  for (const [path, value] of Object.entries(updates)) {
    const keys = path.split(".");
    let object = item;
    while (keys.length > 1) { const key = keys.shift(); object[key] ??= {}; object = object[key]; }
    merge(object, { [keys[0]]: value });
  }
}
export function fixture({ isGM = true, pack = null, ac5e = null } = {}) {
  const registry = new DeclarationFamilyRegistry();
  registerMetamagicFamily(registry);
  registry.register({ id: "future", label: "Future family", flagPath: "flags.action-effects-5e.future", version: 1,
    schema: { type: "object" }, templates: [{ id: "example", label: "Example", record: { id: "example", settings: {} } }], validate: () => [] });
  const collections = new DeclarationCollectionService({ registry, ac5e });
  const user = { isGM };
  const writes = [];
  const item = { documentName: "Item", uuid: "Actor.synthetic.Token.full.Item.source", name: "New Feature", pack,
    system: { equipped: true, attuned: true },
    flags: { "action-effects-5e": { unrelated: { keep: true } }, cat: { config: { choice: false } } },
    async update(updates) { writes.push(copy(updates)); applyUpdates(this, updates); return this; } };
  const packs = new Map();
  const configurationAuthoring = new CatConfigurationAuthoringService({ userAccessor: () => user, packsAccessor: () => packs });
  const authoring = new ItemOptionsAuthoringService({ collections, configurationAuthoring, userAccessor: () => user, packsAccessor: () => packs });
  return { registry, collections, item, writes, user, packs, configurationAuthoring, authoring };
}
export const envelope = declarations => ({ version: 1, declarations });
export const option = (id = "distance") => ({ id, type: "option", cost: 1, tooltip: "Item-owned rule",
  execution: { interface: "cat-embedded", name: "Option macro" } });
