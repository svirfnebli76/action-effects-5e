import { ENVIRONMENT_BEHAVIOR_TYPES } from "../core/constants.js";
import { Logger } from "../core/logger.js";
import { FlammableRegionBehaviorType } from "./flammable-region-behavior-type.js";
import { PersistentAreaRegionBehaviorType } from "./persistent-area-region-behavior-type.js";

export class EnvironmentRegionBehaviorRegistry {
  #initialized = false;
  #stats = { registrations: 0, errors: 0 };

  initialize() {
    if (this.#initialized) return this.getStatus();
    const config = globalThis.CONFIG?.RegionBehavior;
    if (!config?.dataModels) {
      this.#stats.errors += 1;
      throw new Error("Foundry RegionBehavior configuration is unavailable during AE5E environmental initialization.");
    }

    const registrations = [
      {
        type: ENVIRONMENT_BEHAVIOR_TYPES.FLAMMABLE,
        model: FlammableRegionBehaviorType,
        label: "BEHAVIOR.TYPES.action-effects-5e.flammable.label",
        icon: "fa-solid fa-fire-flame-curved"
      },
      {
        type: ENVIRONMENT_BEHAVIOR_TYPES.PERSISTENT_AREA,
        model: PersistentAreaRegionBehaviorType,
        label: "BEHAVIOR.TYPES.action-effects-5e.persistent-area.label",
        icon: "fa-solid fa-vector-square"
      }
    ];
    config.typeLabels ??= {};
    config.typeIcons ??= {};
    for (const registration of registrations) {
      config.dataModels[registration.type] = registration.model;
      config.typeLabels[registration.type] = registration.label;
      config.typeIcons[registration.type] = registration.icon;
      this.#stats.registrations += 1;
    }
    this.#initialized = true;

    globalThis.Hooks?.once?.("i18nInit", () => {
      try {
        globalThis.foundry?.helpers?.Localization?.localizeDataModel?.(FlammableRegionBehaviorType);
        globalThis.foundry?.helpers?.Localization?.localizeDataModel?.(PersistentAreaRegionBehaviorType);
      } catch (error) {
        Logger.debug("Environmental RegionBehavior localization helper was unavailable.", error);
      }
    });

    return this.getStatus();
  }

  getStatus() {
    const flammableType = ENVIRONMENT_BEHAVIOR_TYPES.FLAMMABLE;
    const persistentAreaType = ENVIRONMENT_BEHAVIOR_TYPES.PERSISTENT_AREA;
    return Object.freeze({
      initialized: this.#initialized,
      flammableType,
      flammableRegistered: globalThis.CONFIG?.RegionBehavior?.dataModels?.[flammableType] === FlammableRegionBehaviorType,
      persistentAreaType,
      persistentAreaRegistered: globalThis.CONFIG?.RegionBehavior?.dataModels?.[persistentAreaType] === PersistentAreaRegionBehaviorType,
      persistentAreaIcon: globalThis.CONFIG?.RegionBehavior?.typeIcons?.[persistentAreaType] ?? null,
      persistentAreaLabel: globalThis.CONFIG?.RegionBehavior?.typeLabels?.[persistentAreaType] ?? null,
      icon: globalThis.CONFIG?.RegionBehavior?.typeIcons?.[flammableType] ?? null,
      label: globalThis.CONFIG?.RegionBehavior?.typeLabels?.[flammableType] ?? null,
      ...this.#stats
    });
  }
}
