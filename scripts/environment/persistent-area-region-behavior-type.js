import { ENVIRONMENT_BEHAVIOR_TYPES } from "../core/constants.js";

/**
 * Generic native Foundry v14 RegionBehavior for persistent-area event recipes.
 *
 * The Item automation authors the recipe. AE5E only transports native Region
 * events to PersistentAreaEventService and provides reusable execution/gating
 * infrastructure. No spell or feature rules belong in this DataModel.
 */
export class PersistentAreaRegionBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  static #service = null;

  static LOCALIZATION_PREFIXES = [
    "BEHAVIOR.TYPES.action-effects-5e.persistent-area",
    "BEHAVIOR.TYPES.base"
  ];

  static configure(service) {
    this.#service = service ?? null;
  }

  static defineSchema() {
    const { StringField } = foundry.data.fields;
    const regionEvents = CONST.REGION_EVENTS ?? {};
    const supported = [
      regionEvents.TOKEN_MOVE_IN ?? "tokenMoveIn",
      regionEvents.TOKEN_MOVE_WITHIN ?? "tokenMoveWithin",
      regionEvents.TOKEN_ENTER ?? "tokenEnter",
      regionEvents.TOKEN_EXIT ?? "tokenExit",
      regionEvents.TOKEN_TURN_START ?? "tokenTurnStart",
      regionEvents.TOKEN_TURN_END ?? "tokenTurnEnd"
    ];

    return {
      events: this._createEventsField({ events: supported }),
      instanceId: new StringField({ required: true, blank: false }),
      recipeJson: new StringField({ required: true, blank: false, initial: "{}" }),
      stateJson: new StringField({ required: true, blank: false, initial: "{}" })
    };
  }

  async _handleRegionEvent(event) {
    const service = PersistentAreaRegionBehaviorType.#service;
    if (!service) return;
    return service.handleRegionEvent(this.behavior, event);
  }

  get ae5eBehaviorType() {
    return ENVIRONMENT_BEHAVIOR_TYPES.PERSISTENT_AREA;
  }
}
