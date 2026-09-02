import { ENVIRONMENT_BEHAVIOR_TYPES, WEB_ACTIVITY_REFERENCES } from "../core/constants.js";

/**
 * Native Foundry v14 RegionBehavior for the 2024 Web spell.
 *
 * The behavior receives native Region token events. Movement-entry events are
 * handled on the initiating user's client so Foundry's pause/resume/stop API can
 * be used correctly; rules resolution is delegated to AE5E WebService, which
 * routes shared document changes through the primary GM.
 */
export class WebRegionBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  static #service = null;

  static LOCALIZATION_PREFIXES = [
    "BEHAVIOR.TYPES.action-effects-5e.web",
    "BEHAVIOR.TYPES.base"
  ];

  static configure(service) {
    this.#service = service ?? null;
  }

  static defineSchema() {
    const { NumberField, StringField } = foundry.data.fields;
    return {
      events: this._createEventsField({
        events: [
          CONST.REGION_EVENTS.TOKEN_MOVE_IN,
          CONST.REGION_EVENTS.TOKEN_ENTER,
          CONST.REGION_EVENTS.TOKEN_EXIT,
          CONST.REGION_EVENTS.TOKEN_TURN_START
        ]
      }),
      instanceId: new StringField({ required: true, blank: false }),
      sourceItemUuid: new StringField({ required: true, blank: false }),
      casterActorUuid: new StringField({ required: true, blank: false }),
      casterTokenUuid: new StringField({ required: false, blank: true, initial: "" }),
      saveActivity: new StringField({ required: true, blank: false, initial: WEB_ACTIVITY_REFERENCES.SAVE }),
      burnDamageActivity: new StringField({ required: true, blank: false, initial: WEB_ACTIVITY_REFERENCES.BURN_DAMAGE }),
      restrainedEffectRole: new StringField({ required: true, blank: false, initial: "restrained-template" }),
      sizeFeet: new NumberField({ required: true, positive: true, initial: 20 }),
      cellSizeFeet: new NumberField({ required: true, positive: true, initial: 5 })
    };
  }

  async _handleRegionEvent(event) {
    const service = WebRegionBehaviorType.#service;
    if (!service) return;
    return service.handleRegionEvent(this.behavior, event);
  }

  get ae5eBehaviorType() {
    return ENVIRONMENT_BEHAVIOR_TYPES.WEB;
  }
}
