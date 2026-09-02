import { ENVIRONMENT_BEHAVIOR_TYPES } from "../core/constants.js";
import { Logger } from "../core/logger.js";
import { FlammableRegionBehaviorType } from "./flammable-region-behavior-type.js";
import { WebRegionBehaviorType } from "./web-region-behavior-type.js";

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
        type: ENVIRONMENT_BEHAVIOR_TYPES.WEB,
        model: WebRegionBehaviorType,
        label: "BEHAVIOR.TYPES.action-effects-5e.web.label",
        icon: "fa-solid fa-spider-web"
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
        globalThis.foundry?.helpers?.Localization?.localizeDataModel?.(WebRegionBehaviorType);
      } catch (error) {
        Logger.debug("Environmental RegionBehavior localization helper was unavailable.", error);
      }
    });

    return this.getStatus();
  }

  getStatus() {
    const flammableType = ENVIRONMENT_BEHAVIOR_TYPES.FLAMMABLE;
    const webType = ENVIRONMENT_BEHAVIOR_TYPES.WEB;
    return Object.freeze({
      initialized: this.#initialized,
      flammableType,
      flammableRegistered: globalThis.CONFIG?.RegionBehavior?.dataModels?.[flammableType] === FlammableRegionBehaviorType,
      webType,
      webRegistered: globalThis.CONFIG?.RegionBehavior?.dataModels?.[webType] === WebRegionBehaviorType,
      icon: globalThis.CONFIG?.RegionBehavior?.typeIcons?.[flammableType] ?? null,
      label: globalThis.CONFIG?.RegionBehavior?.typeLabels?.[flammableType] ?? null,
      webIcon: globalThis.CONFIG?.RegionBehavior?.typeIcons?.[webType] ?? null,
      webLabel: globalThis.CONFIG?.RegionBehavior?.typeLabels?.[webType] ?? null,
      ...this.#stats
    });
  }
}
