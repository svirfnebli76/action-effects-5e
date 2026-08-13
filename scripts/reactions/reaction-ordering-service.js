import { RelationshipDistance } from "../relationships/relationship-distance.js";

/**
 * Generic AE5E Reactor ordering policy.
 * 1) closest to the Attacker, 2) highest Dexterity, 3) GM d20 tiebreak.
 * The resulting order is frozen for the lifetime of the transaction.
 */
export class ReactionOrderingService {
  async order(opportunities, { sourceToken = null, scene = globalThis.canvas?.scene ?? null, rollTies } = {}) {
    const entries = opportunities.map((opportunity, index) => ({
      ...opportunity,
      _originalIndex: index,
      _tieBreakPath: [],
      distance: this.#distance(sourceToken, opportunity.tokenDocument, scene),
      dexterity: this.#dexterity(opportunity.actor)
    }));

    entries.sort((a, b) => this.#compareBase(a, b));
    if (typeof rollTies === "function") await this.#breakTies(entries, rollTies);
    entries.sort((a, b) => this.#compareFinal(a, b));

    return entries.map(({ _originalIndex, _tieBreakPath, actor, tokenDocument, ...entry }) => ({
      ...entry,
      // Preserve every d20 used when a tied roll had to be rerolled. This makes
      // the ordering explainable without allowing a later reroll to erase the
      // precedence established by an earlier roll.
      tieBreak: _tieBreakPath.length ? [..._tieBreakPath] : null,
      actor,
      tokenDocument
    }));
  }

  #distance(sourceToken, reactorToken, scene) {
    if (!sourceToken || !reactorToken || !scene) return Number.POSITIVE_INFINITY;
    const measured = RelationshipDistance.measure({
      scene,
      leader: sourceToken,
      follower: reactorToken
    });
    return Number.isFinite(measured) ? measured : Number.POSITIVE_INFINITY;
  }

  #dexterity(actor) {
    const ability = actor?.system?.abilities?.dex;
    const score = Number(ability?.value);
    if (Number.isFinite(score)) return score;
    const mod = Number(ability?.mod);
    return Number.isFinite(mod) ? mod : Number.NEGATIVE_INFINITY;
  }

  #compareBase(a, b) {
    if (a.distance !== b.distance) return a.distance - b.distance;
    if (a.dexterity !== b.dexterity) return b.dexterity - a.dexterity;
    return a._originalIndex - b._originalIndex;
  }

  #compareFinal(a, b) {
    if (a.distance !== b.distance) return a.distance - b.distance;
    if (a.dexterity !== b.dexterity) return b.dexterity - a.dexterity;
    const pathResult = this.#compareTiePaths(a._tieBreakPath, b._tieBreakPath);
    if (pathResult !== 0) return pathResult;
    return a._originalIndex - b._originalIndex;
  }

  #compareTiePaths(a = [], b = []) {
    const length = Math.max(a.length, b.length);
    for (let index = 0; index < length; index += 1) {
      const ar = Number(a[index] ?? Number.NEGATIVE_INFINITY);
      const br = Number(b[index] ?? Number.NEGATIVE_INFINITY);
      if (ar !== br) return br - ar;
    }
    return 0;
  }

  async #breakTies(entries, rollTies) {
    let index = 0;
    while (index < entries.length) {
      const group = [entries[index]];
      let next = index + 1;
      while (next < entries.length
        && entries[next].distance === entries[index].distance
        && entries[next].dexterity === entries[index].dexterity) {
        group.push(entries[next]);
        next += 1;
      }

      if (group.length > 1) await this.#resolveTieGroup(group, rollTies);
      index = next;
    }
  }

  async #resolveTieGroup(group, rollTies) {
    let unresolvedGroups = [[...group]];
    while (unresolvedGroups.length) {
      const nextGroups = [];
      for (const unresolved of unresolvedGroups) {
        const ids = unresolved.map(entry => entry.reactorTokenUuid);
        const result = await rollTies(ids);
        const rolls = result?.rolls ?? result ?? {};
        const buckets = new Map();

        for (const entry of unresolved) {
          const value = Number(rolls[entry.reactorTokenUuid]);
          if (!Number.isInteger(value) || value < 1 || value > 20) {
            throw new Error(`Reaction ordering received an invalid d20 tiebreak for '${entry.reactorTokenUuid}'.`);
          }
          entry._tieBreakPath.push(value);
          let bucket = buckets.get(value);
          if (!bucket) {
            bucket = [];
            buckets.set(value, bucket);
          }
          bucket.push(entry);
        }

        for (const bucket of buckets.values()) {
          if (bucket.length > 1) nextGroups.push(bucket);
        }
      }
      unresolvedGroups = nextGroups;
    }
  }
}
