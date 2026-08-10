import {
  RELATIONSHIP_GEOMETRY_CHANNELS,
  RELATIVE_TOKEN_RELATIONSHIPS
} from "../core/constants.js";

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function tokenDocument(token) {
  return token?.document ?? token ?? null;
}

function tokenUuid(token) {
  const document = tokenDocument(token);
  return document?.uuid ?? null;
}

/**
 * Resolve whether one token is hostile or nonhostile relative to another.
 *
 * Foundry token disposition is player-relative, not an NPC-to-NPC relationship
 * graph. AE5E therefore treats Friendly/Hostile as two sides for pairwise
 * obstruction checks while Neutral and Secret are universal nonhostile
 * overrides. The caller chooses the reference token according to the geometry
 * being validated (for example follower-body vs grapple-link).
 */
export class RelativeTokenRelationshipService {
  resolve({ referenceToken, otherToken, geometryChannel = null } = {}) {
    const reference = tokenDocument(referenceToken);
    const other = tokenDocument(otherToken);
    if (!reference || !other) {
      return this.#result({
        reference,
        other,
        geometryChannel,
        relationship: RELATIVE_TOKEN_RELATIONSHIPS.HOSTILE,
        reasonCode: "missing-token"
      });
    }

    const dispositions = globalThis.CONST?.TOKEN_DISPOSITIONS ?? {};
    const friendly = finiteNumber(dispositions.FRIENDLY, 1);
    const hostile = finiteNumber(dispositions.HOSTILE, -1);
    const neutral = finiteNumber(dispositions.NEUTRAL, 0);
    const secret = finiteNumber(dispositions.SECRET, -2);

    const referenceDisposition = finiteNumber(reference.disposition);
    const otherDisposition = finiteNumber(other.disposition);

    // Neutral and Secret are always nonhostile for AE5E relationship
    // obstruction, regardless of which participant owns either disposition.
    if (referenceDisposition === neutral || otherDisposition === neutral) {
      return this.#result({
        reference,
        other,
        geometryChannel,
        relationship: RELATIVE_TOKEN_RELATIONSHIPS.NONHOSTILE,
        reasonCode: "neutral-disposition"
      });
    }
    if (referenceDisposition === secret || otherDisposition === secret) {
      return this.#result({
        reference,
        other,
        geometryChannel,
        relationship: RELATIVE_TOKEN_RELATIONSHIPS.NONHOSTILE,
        reasonCode: "secret-disposition"
      });
    }

    const referenceIsSide = referenceDisposition === friendly || referenceDisposition === hostile;
    const otherIsSide = otherDisposition === friendly || otherDisposition === hostile;
    if (referenceIsSide && otherIsSide) {
      return this.#result({
        reference,
        other,
        geometryChannel,
        relationship: referenceDisposition === otherDisposition
          ? RELATIVE_TOKEN_RELATIONSHIPS.NONHOSTILE
          : RELATIVE_TOKEN_RELATIONSHIPS.HOSTILE,
        reasonCode: referenceDisposition === otherDisposition
          ? "same-disposition-side"
          : "opposed-disposition-side"
      });
    }

    // TokenDocuments should normally carry one of Foundry's defined
    // dispositions. Unknown values fail closed so an unrecognized token cannot
    // silently bypass collision protection.
    return this.#result({
      reference,
      other,
      geometryChannel,
      relationship: RELATIVE_TOKEN_RELATIONSHIPS.HOSTILE,
      reasonCode: "unresolved-disposition"
    });
  }

  isNonhostile(options = {}) {
    return this.resolve(options).relationship === RELATIVE_TOKEN_RELATIONSHIPS.NONHOSTILE;
  }

  referenceForGeometry({ geometryChannel, leaderToken, followerToken } = {}) {
    if (geometryChannel === RELATIONSHIP_GEOMETRY_CHANNELS.FOLLOWER_BODY) return tokenDocument(followerToken);
    if (geometryChannel === RELATIONSHIP_GEOMETRY_CHANNELS.GRAPPLE_LINK) return tokenDocument(leaderToken);
    return null;
  }

  resolveForGeometry({ geometryChannel, leaderToken, followerToken, otherToken } = {}) {
    const referenceToken = this.referenceForGeometry({ geometryChannel, leaderToken, followerToken });
    return this.resolve({ referenceToken, otherToken, geometryChannel });
  }

  #result({ reference, other, geometryChannel, relationship, reasonCode }) {
    return Object.freeze({
      relationship,
      reasonCode,
      geometryChannel: geometryChannel ?? null,
      referenceUuid: tokenUuid(reference),
      otherUuid: tokenUuid(other),
      referenceDisposition: finiteNumber(reference?.disposition),
      otherDisposition: finiteNumber(other?.disposition)
    });
  }
}
