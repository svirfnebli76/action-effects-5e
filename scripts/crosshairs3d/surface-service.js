import { finiteNumber } from "./geometry-utils.js";

export class Crosshair3dSurfaceService {
  resolveAt({
    x,
    y,
    fallbackElevation = 0,
    scene = globalThis.canvas?.scene,
    preferredLevel = globalThis.canvas?.level ?? null
  } = {}) {
    const fallback = finiteNumber(fallbackElevation);
    if (!scene?.getSurfaces) return Object.freeze({ elevation: fallback, surface: null, source: "fallback" });

    const collectMatches = (level = null) => {
      let surfaces = [];
      try {
        surfaces = Array.from(scene.getSurfaces({ type: "move", ...(level ? { level } : {}) }) ?? []);
      } catch (_error) {
        return [];
      }
      const matches = [];
      for (const surface of surfaces) {
        const elevation = finiteNumber(surface?.elevation, NaN);
        if (!Number.isFinite(elevation) || !surface?.region?.testPoint) continue;
        try {
          if (surface.region.testPoint({ x: finiteNumber(x), y: finiteNumber(y), elevation })) {
            matches.push({ elevation, surface });
          }
        } catch (_error) {
          // A malformed/third-party surface should not break placement.
        }
      }
      matches.sort((a, b) => a.elevation - b.elevation);
      return matches;
    };

    // Foundry Level identity is contextual, not geometrically authoritative.
    // Prefer the currently viewed Level when it has a matching physical move
    // surface, then fall back to all Scene surfaces. This avoids blindly
    // selecting a rooftop while the user is working on a lower Level, without
    // making Level membership a placement rule.
    const preferredMatches = preferredLevel ? collectMatches(preferredLevel) : [];
    const matches = preferredMatches.length ? preferredMatches : collectMatches();
    if (!matches.length) return Object.freeze({ elevation: fallback, surface: null, source: "fallback" });
    const selected = matches.at(-1);
    return Object.freeze({
      elevation: selected.elevation,
      surface: selected.surface,
      source: preferredMatches.length ? "foundry-level-surface" : "foundry-surface"
    });
  }
}
