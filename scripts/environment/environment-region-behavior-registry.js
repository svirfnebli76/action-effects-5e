import { ENVIRONMENT_BEHAVIOR_TYPES } from "../core/constants.js";
import { Logger } from "../core/logger.js";
import { FlammableRegionBehaviorType } from "./flammable-region-behavior-type.js";

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

    const type = ENVIRONMENT_BEHAVIOR_TYPES.FLAMMABLE;
    config.dataModels[type] = FlammableRegionBehaviorType;
    config.typeLabels ??= {};
    config.typeLabels[type] = "BEHAVIOR.TYPES.action-effects-5e.flammable.label";
    config.typeIcons ??= {};
    config.typeIcons[type] = "fa-solid fa-fire-flame-curved";
    this.#stats.registrations += 1;
    this.#initialized = true;

    globalThis.Hooks?.once?.("i18nInit", () => {
      try {
        globalThis.foundry?.helpers?.Localization?.localizeDataModel?.(FlammableRegionBehaviorType);
      } catch (error) {
        Logger.debug("Environmental RegionBehavior localization helper was unavailable.", error);
      }
    });

    return this.getStatus();
  }

  getStatus() {
    const type = ENVIRONMENT_BEHAVIOR_TYPES.FLAMMABLE;
    return Object.freeze({
      initialized: this.#initialized,
      flammableType: type,
      flammableRegistered: globalThis.CONFIG?.RegionBehavior?.dataModels?.[type] === FlammableRegionBehaviorType,
      icon: globalThis.CONFIG?.RegionBehavior?.typeIcons?.[type] ?? null,
      label: globalThis.CONFIG?.RegionBehavior?.typeLabels?.[type] ?? null,
      ...this.#stats
    });
  }
}
