import { REGION_CELL_STATES } from "../core/constants.js";

/**
 * Compatibility facade for exact Region occupancy decisions.
 *
 * Unconfigured Regions retain Foundry's native containment semantics. Cell-backed
 * Regions use AE5E's Region-local 3D state volume. Movement code is deliberately
 * not wired to this facade until Checkpoint 3.
 */
export class RegionOccupancyService {
  #cells;
  #stats = {
    queries: 0,
    cellQueries: 0,
    nativeQueries: 0,
    traces: 0,
    errors: 0,
    lastQuery: null
  };

  constructor({ cells }) {
    this.#cells = cells;
  }

  getStats() {
    return { ...this.#stats };
  }

  isCellBacked(region) {
    return this.#cells.isConfigured(region);
  }

  testTokenAt(region, token, position = null, options = {}) {
    return this.inspectTokenAt(region, token, position, options).inside;
  }

  traceTokenSegment(region, token, options = {}) {
    this.#stats.traces += 1;
    if (!this.#cells.isConfigured(region)) {
      return { traced: false, reason: "native-region-trace-not-required", intervals: [], transitions: [], activeFraction: 0 };
    }
    return this.#cells.traceTokenSegment(region, token, options);
  }

  inspectTokenAt(region, token, position = null, { states = [REGION_CELL_STATES.ACTIVE], ...options } = {}) {
    this.#stats.queries += 1;
    try {
      if (this.#cells.isConfigured(region)) {
        this.#stats.cellQueries += 1;
        const result = this.#cells.intersectsToken(region, token, { position, states, ...options });
        const inspection = {
          inside: Boolean(result.intersects),
          source: "region-cells",
          result
        };
        this.#stats.lastQuery = { source: inspection.source, inside: inspection.inside, regionUuid: region?.uuid ?? null, tokenUuid: token?.uuid ?? null };
        return inspection;
      }

      this.#stats.nativeQueries += 1;
      const nativeTest = token?.testInsideRegion ?? token?.document?.testInsideRegion;
      const nativeSubject = typeof token?.testInsideRegion === "function" ? token : token?.document;
      const inside = typeof nativeTest === "function"
        ? Boolean(nativeTest.call(nativeSubject, region, position ?? undefined))
        : false;
      const inspection = { inside, source: "foundry", result: null };
      this.#stats.lastQuery = { source: inspection.source, inside, regionUuid: region?.uuid ?? null, tokenUuid: token?.uuid ?? null };
      return inspection;
    } catch (error) {
      this.#stats.errors += 1;
      this.#stats.lastQuery = { source: "error", inside: false, regionUuid: region?.uuid ?? null, tokenUuid: token?.uuid ?? null, message: error?.message ?? String(error) };
      throw error;
    }
  }
}
