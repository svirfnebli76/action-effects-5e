import { RELATIONSHIP_DISTANCE_PROVIDERS } from "../core/constants.js";

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function tokenPosition(token, override = null) {
  return {
    x: finite(override?.x, finite(token?.x)),
    y: finite(override?.y, finite(token?.y)),
    elevation: finite(override?.elevation, finite(token?.elevation))
  };
}

function tokenCenter(token, scene, override = null) {
  const position = tokenPosition(token, override);
  const gridSize = Math.max(1, finite(scene?.grid?.size, finite(globalThis.canvas?.grid?.size, 1)));
  const width = Math.max(0, finite(override?.width, finite(token?.width, 1)));
  const height = Math.max(0, finite(override?.height, finite(token?.height, 1)));
  return {
    x: position.x + (width * gridSize / 2),
    y: position.y + (height * gridSize / 2),
    elevation: position.elevation
  };
}

export class RelationshipDistanceProviderService {
  #providers = new Map();

  constructor() {
    this.register(RELATIONSHIP_DISTANCE_PROVIDERS.CENTER_3D, this.#center3d.bind(this));
  }

  register(id, provider) {
    if (typeof id !== "string" || !id.trim()) throw new TypeError("Relationship distance provider ID must be a non-empty string.");
    if (typeof provider !== "function") throw new TypeError(`Relationship distance provider '${id}' must be a function.`);
    this.#providers.set(id.trim(), provider);
    return () => this.#providers.delete(id.trim());
  }

  has(id) {
    return this.#providers.has(id);
  }

  async measure({ provider = RELATIONSHIP_DISTANCE_PROVIDERS.CENTER_3D, ...context } = {}) {
    const implementation = this.#providers.get(provider);
    if (!implementation) {
      return { state: "unknown", provider, distance: null, reason: "distance-provider-unavailable" };
    }
    try {
      const distance = Number(await implementation(context));
      if (!Number.isFinite(distance)) {
        return { state: "unknown", provider, distance: null, reason: "distance-not-finite" };
      }
      return { state: "clear", provider, distance, reason: "measured" };
    } catch (error) {
      return { state: "unknown", provider, distance: null, reason: "distance-provider-error", error };
    }
  }

  #center3d({ scene, leader, follower, leaderPosition = null, followerPosition = null } = {}) {
    if (!scene || !leader || !follower) throw new Error("Center-to-center distance requires a Scene and two TokenDocuments.");
    const a = tokenCenter(leader, scene, leaderPosition);
    const b = tokenCenter(follower, scene, followerPosition);
    const gridSize = Math.max(1, finite(scene?.grid?.size, finite(globalThis.canvas?.grid?.size, 1)));
    const gridDistance = Math.max(0, finite(scene?.grid?.distance, finite(globalThis.canvas?.grid?.distance, 1)));
    let planar = null;
    if (typeof scene?.grid?.measurePath === "function") {
      try {
        const measured = scene.grid.measurePath([
          { x: a.x, y: a.y, elevation: 0 },
          { x: b.x, y: b.y, elevation: 0 }
        ]);
        const value = Number(measured?.distance ?? measured?.cost);
        if (Number.isFinite(value)) planar = value;
      } catch { /* Euclidean fallback below */ }
    }
    planar ??= Math.hypot(b.x - a.x, b.y - a.y) / gridSize * gridDistance;
    return Math.hypot(planar, b.elevation - a.elevation);
  }
}

export const RelationshipDistanceGeometry = Object.freeze({ tokenCenter, tokenPosition });
