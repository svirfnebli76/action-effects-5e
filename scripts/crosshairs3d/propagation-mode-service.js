export const CROSSHAIR_3D_PROPAGATION_MODES = Object.freeze({
  NONE: "none",
  DIRECT: "direct",
  SPREAD: "spread"
});

export const CROSSHAIR_3D_PROPAGATION_OVERRIDE_DEFAULT = "default";

const VALID_MODES = new Set(Object.values(CROSSHAIR_3D_PROPAGATION_MODES));

export class Crosshair3dPropagationModeService {
  normalize(value, fallback = CROSSHAIR_3D_PROPAGATION_MODES.NONE) {
    const mode = String(value ?? fallback).trim().toLowerCase();
    if (!VALID_MODES.has(mode)) throw new RangeError(`Unsupported Action Effects 3D Crosshairs propagation mode '${mode}'.`);
    return mode;
  }

  resolve({ itemDefault = CROSSHAIR_3D_PROPAGATION_MODES.NONE, override = CROSSHAIR_3D_PROPAGATION_OVERRIDE_DEFAULT } = {}) {
    const normalizedDefault = this.normalize(itemDefault);
    const normalizedOverride = String(override ?? CROSSHAIR_3D_PROPAGATION_OVERRIDE_DEFAULT).trim().toLowerCase();
    if (normalizedOverride === CROSSHAIR_3D_PROPAGATION_OVERRIDE_DEFAULT) {
      return Object.freeze({ mode: normalizedDefault, source: "item-default" });
    }
    return Object.freeze({ mode: this.normalize(normalizedOverride), source: "override" });
  }
}
