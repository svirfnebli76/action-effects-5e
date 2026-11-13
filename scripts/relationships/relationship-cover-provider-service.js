import {
  RELATIONSHIP_CONSTRAINT_STATES,
  RELATIONSHIP_COVER_PROVIDERS
} from "../core/constants.js";
import { RelationshipDistanceGeometry } from "./relationship-distance-provider-service.js";

function moduleApi(id) {
  const module = globalThis.game?.modules?.get?.(id);
  return module?.active === false ? null : module?.api ?? null;
}

function midiCoverSelection() {
  const candidates = [globalThis.MidiQOL, moduleApi("midi-qol")];
  for (const candidate of candidates) {
    try {
      const settings = candidate?.configSettings?.();
      const value = settings?.optionalRules?.coverCalculation;
      if (typeof value === "string" && value.trim()) return value.trim();
    } catch { /* try the next public surface */ }
  }
  return null;
}

function virtualToken(token, position = null) {
  if (!position) return token?.object ?? token;
  return {
    document: token,
    x: Number(position.x ?? token?.x ?? 0),
    y: Number(position.y ?? token?.y ?? 0),
    elevation: Number(position.elevation ?? token?.elevation ?? 0),
    width: Number(position.width ?? token?.width ?? 1),
    height: Number(position.height ?? token?.height ?? 1),
    depth: Number(position.depth ?? token?.depth ?? token?.height ?? 1),
    eye: Number(position.eye ?? token?.sight?.elevation ?? 0)
  };
}

function normalizedCoverState(total, provider, evidence = {}) {
  return {
    state: total ? RELATIONSHIP_CONSTRAINT_STATES.BROKEN : RELATIONSHIP_CONSTRAINT_STATES.CLEAR,
    provider,
    totalCover: Boolean(total),
    reason: total ? "total-cover" : "less-than-total-cover",
    evidence
  };
}

function collisionDetected(result) {
  if (Array.isArray(result)) return result.length > 0;
  if (result === null || result === undefined) return false;
  return Boolean(result);
}

export class RelationshipCoverProviderService {
  #providers = new Map();

  constructor() {
    this.register(RELATIONSHIP_COVER_PROVIDERS.SIMPLE_COVER, this.#simpleCover.bind(this));
    this.register(RELATIONSHIP_COVER_PROVIDERS.LEVELS_AUTO_COVER, this.#levelsAutoCover.bind(this));
    this.register(RELATIONSHIP_COVER_PROVIDERS.FOUNDRY, this.#foundryGeometry.bind(this));
  }

  register(id, provider) {
    if (typeof id !== "string" || !id.trim()) throw new TypeError("Relationship cover provider ID must be a non-empty string.");
    if (typeof provider !== "function") throw new TypeError(`Relationship cover provider '${id}' must be a function.`);
    this.#providers.set(id.trim(), provider);
    return () => this.#providers.delete(id.trim());
  }

  resolve(requested = RELATIONSHIP_COVER_PROVIDERS.MIDI) {
    if (requested !== RELATIONSHIP_COVER_PROVIDERS.MIDI) return requested;
    const selected = midiCoverSelection();
    if (selected === RELATIONSHIP_COVER_PROVIDERS.SIMPLE_COVER) return RELATIONSHIP_COVER_PROVIDERS.SIMPLE_COVER;
    if (selected === RELATIONSHIP_COVER_PROVIDERS.LEVELS_AUTO_COVER) return RELATIONSHIP_COVER_PROVIDERS.LEVELS_AUTO_COVER;
    return RELATIONSHIP_COVER_PROVIDERS.FOUNDRY;
  }

  async evaluate(context = {}) {
    const requestedProvider = context.provider ?? RELATIONSHIP_COVER_PROVIDERS.MIDI;
    const resolvedProvider = this.resolve(requestedProvider);
    const implementation = this.#providers.get(resolvedProvider);

    if (implementation) {
      try {
        const result = await implementation({ ...context, provider: resolvedProvider });
        if (result?.state !== RELATIONSHIP_CONSTRAINT_STATES.UNKNOWN) {
          return { ...result, requestedProvider, resolvedProvider };
        }
      } catch { /* use Foundry geometry below */ }
    }

    // A selected integration that is unavailable or throws falls back only to
    // core geometry. AE5E never consults the other installed cover module.
    if (resolvedProvider !== RELATIONSHIP_COVER_PROVIDERS.FOUNDRY) {
      try {
        const fallback = await this.#foundryGeometry({ ...context, provider: RELATIONSHIP_COVER_PROVIDERS.FOUNDRY });
        return {
          ...fallback,
          requestedProvider,
          resolvedProvider,
          fallbackProvider: RELATIONSHIP_COVER_PROVIDERS.FOUNDRY
        };
      } catch { /* unknown result below */ }
    }

    return {
      state: RELATIONSHIP_CONSTRAINT_STATES.UNKNOWN,
      provider: resolvedProvider,
      requestedProvider,
      resolvedProvider,
      totalCover: null,
      reason: "cover-provider-unavailable"
    };
  }

  async #simpleCover({ scene, leader, follower, leaderPosition = null, followerPosition = null } = {}) {
    const api = moduleApi(RELATIONSHIP_COVER_PROVIDERS.SIMPLE_COVER);
    if (typeof api?.getCover !== "function") throw new Error("Simple Cover 5e API is unavailable.");
    // Simple Cover supports a virtual attacker position but requires a real
    // target Token. A virtual target therefore falls through to core geometry.
    if (followerPosition) return { state: RELATIONSHIP_CONSTRAINT_STATES.UNKNOWN };
    const attacker = leaderPosition ? virtualToken(leader, leaderPosition) : (leader?.object ?? leader);
    const target = follower?.object ?? follower;
    const result = await api.getCover({
      attacker,
      target,
      scene,
      debug: false,
      losCheck: true,
      activity: null,
      includeEmbeddedCover: false
    });
    if (!["none", "half", "threeQuarters", "total"].includes(result?.cover)) {
      return { state: RELATIONSHIP_CONSTRAINT_STATES.UNKNOWN };
    }
    return normalizedCoverState(result?.cover === "total", RELATIONSHIP_COVER_PROVIDERS.SIMPLE_COVER, result ?? {});
  }

  async #levelsAutoCover({ leader, follower, leaderPosition = null, followerPosition = null } = {}) {
    const api = moduleApi(RELATIONSHIP_COVER_PROVIDERS.LEVELS_AUTO_COVER);
    if (typeof api?.computeCover !== "function") throw new Error("Levels Auto Cover API is unavailable.");
    const result = await api.computeCover(
      virtualToken(leader, leaderPosition),
      virtualToken(follower, followerPosition)
    );
    const tier = String(result?.tier?.id ?? result?.tier ?? "").toLowerCase();
    const percent = Number(result?.percent);
    if (!tier && !Number.isFinite(percent)) return { state: RELATIONSHIP_CONSTRAINT_STATES.UNKNOWN };
    const total = tier === "total" || (Number.isFinite(percent) && percent >= 100 - 1e-6);
    return normalizedCoverState(total, RELATIONSHIP_COVER_PROVIDERS.LEVELS_AUTO_COVER, result ?? {});
  }

  #foundryGeometry({ scene, leader, follower, leaderPosition = null, followerPosition = null } = {}) {
    const backend = globalThis.CONFIG?.Canvas?.polygonBackends?.sight;
    if (typeof backend?.testCollision !== "function") {
      return { state: RELATIONSHIP_CONSTRAINT_STATES.UNKNOWN };
    }
    const source = RelationshipDistanceGeometry.tokenCenter(leader, scene, leaderPosition);
    const targetCenter = RelationshipDistanceGeometry.tokenCenter(follower, scene, followerPosition);
    const gridSize = Math.max(1, Number(scene?.grid?.size ?? globalThis.canvas?.grid?.size ?? 1));
    const width = Math.max(0, Number(followerPosition?.width ?? follower?.width ?? 1)) * gridSize;
    const height = Math.max(0, Number(followerPosition?.height ?? follower?.height ?? 1)) * gridSize;
    const baseElevation = Number(followerPosition?.elevation ?? follower?.elevation ?? 0);
    const verticalHeight = Math.max(
      Number(scene?.grid?.distance ?? globalThis.canvas?.grid?.distance ?? 1),
      Number(followerPosition?.verticalHeight ?? follower?.height ?? 1) * Number(scene?.grid?.distance ?? 1)
    );
    const samples = [
      [0, 0, 0.5],
      [-0.35, -0.35, 0.15], [0.35, -0.35, 0.15],
      [-0.35, 0.35, 0.85], [0.35, 0.35, 0.85],
      [0, -0.35, 0.85], [0, 0.35, 0.15]
    ].map(([dx, dy, dz]) => ({
      x: targetCenter.x + (dx * width),
      y: targetCenter.y + (dy * height),
      z: baseElevation + (dz * verticalHeight)
    }));
    const origin = { x: source.x, y: source.y, z: source.elevation + (verticalHeight * 0.75) };

    let blocked = 0;
    for (const destination of samples) {
      const collision = backend.testCollision(origin, destination, {
        type: "sight",
        mode: "any",
        source: leader?.object?.vision ?? leader?.object ?? leader
      });
      if (collisionDetected(collision)) blocked += 1;
    }
    return normalizedCoverState(blocked === samples.length, RELATIONSHIP_COVER_PROVIDERS.FOUNDRY, {
      testedRays: samples.length,
      blockedRays: blocked
    });
  }
}

export const RelationshipCoverResolution = Object.freeze({ midiCoverSelection });
