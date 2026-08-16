import {
  COMPATIBILITY_MODULES,
  MODULE_ID,
  OVERLAP_POLICIES,
  SETTINGS
} from "./constants.js";
import { Logger } from "./logger.js";

export class CompatibilityService {
  #status = Object.freeze({ cpr: false, gps: false, cat: false, overlapPolicy: OVERLAP_POLICIES.AUTO_SAFE });

  refresh() {
    const cprModule = game.modules.get(COMPATIBILITY_MODULES.CPR);
    const gpsModule = game.modules.get(COMPATIBILITY_MODULES.GPS);
    const catModule = game.modules.get(COMPATIBILITY_MODULES.CAT);
    const overlapPolicy = game.settings.get(MODULE_ID, SETTINGS.OVERLAP_POLICY);

    this.#status = Object.freeze({
      cpr: Boolean(cprModule?.active),
      cprVersion: cprModule?.version ?? null,
      gps: Boolean(gpsModule?.active),
      gpsVersion: gpsModule?.version ?? null,
      cat: Boolean(catModule?.active),
      catVersion: catModule?.version ?? null,
      overlapPolicy
    });

    Logger.info("Compatibility detection", this.#status);
    return this.#status;
  }

  getStatus() {
    return { ...this.#status };
  }

  getPreferredController({ supportsCpr = true, supportsGps = true } = {}) {
    const status = this.#status;

    switch (status.overlapPolicy) {
      case OVERLAP_POLICIES.PREFER_AE5E:
        return MODULE_ID;
      case OVERLAP_POLICIES.PREFER_EXTERNAL:
        if (supportsGps && status.gps) return COMPATIBILITY_MODULES.GPS;
        if (supportsCpr && status.cpr) return COMPATIBILITY_MODULES.CPR;
        return MODULE_ID;
      case OVERLAP_POLICIES.MANUAL:
        return "manual";
      case OVERLAP_POLICIES.AUTO_SAFE:
      default:
        if (supportsGps && status.gps) return COMPATIBILITY_MODULES.GPS;
        if (supportsCpr && status.cpr) return COMPATIBILITY_MODULES.CPR;
        return MODULE_ID;
    }
  }
}
