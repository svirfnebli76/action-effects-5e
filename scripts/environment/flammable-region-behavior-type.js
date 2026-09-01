import { ENVIRONMENT_CAPABILITIES } from "../core/constants.js";

/**
 * Foundry v14 RegionBehavior declaration for environmental fire consumers.
 * The behavior itself does not listen for native token Region events; AE5E's
 * Environmental Interaction Service delivers fire exposure to it.
 */
export class FlammableRegionBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  static LOCALIZATION_PREFIXES = [
    "BEHAVIOR.TYPES.action-effects-5e.flammable",
    "BEHAVIOR.TYPES.base"
  ];

  static defineSchema() {
    const { NumberField, StringField } = foundry.data.fields;
    return {
      profileId: new StringField({
        required: true,
        blank: false,
        initial: "generic",
        label: "BEHAVIOR.TYPES.action-effects-5e.flammable.FIELDS.profileId.label",
        hint: "BEHAVIOR.TYPES.action-effects-5e.flammable.FIELDS.profileId.hint"
      }),
      priority: new NumberField({
        required: true,
        integer: true,
        initial: 0,
        label: "BEHAVIOR.TYPES.action-effects-5e.flammable.FIELDS.priority.label",
        hint: "BEHAVIOR.TYPES.action-effects-5e.flammable.FIELDS.priority.hint"
      })
    };
  }

  get ae5eCapabilityId() {
    return ENVIRONMENT_CAPABILITIES.FLAMMABLE;
  }
}
