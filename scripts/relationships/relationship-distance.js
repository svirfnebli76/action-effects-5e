/**
 * Measure the shortest rules-facing distance between two token spaces.
 *
 * On gridded Scenes, distance is measured between the centers of the closest
 * occupied grid spaces so a 1x1 token adjacent to any edge of a larger token is
 * one grid distance away rather than being measured center-to-center across the
 * larger footprint. Foundry's BaseGrid#measurePath remains authoritative for
 * diagonal and elevation measurement.
 *
 * Gridless Scenes fall back to center-to-center BaseGrid measurement because
 * there are no discrete occupied spaces to enumerate.
 */
export class RelationshipDistance {
  static measure({ scene, leader, follower } = {}) {
    return this.#measure({ scene, leader, follower, planarOnly: false });
  }

  static measurePlanar({ scene, leader, follower } = {}) {
    return this.#measure({ scene, leader, follower, planarOnly: true });
  }

  static #measure({ scene, leader, follower, planarOnly = false } = {}) {
    const grid = scene?.grid;
    if (!grid || !leader || !follower) return null;

    const leaderPoints = this.#measurementPoints(leader, grid, { planarOnly });
    const followerPoints = this.#measurementPoints(follower, grid, { planarOnly });
    if (!leaderPoints.length || !followerPoints.length) return null;

    let shortest = Infinity;
    for (const a of leaderPoints) {
      for (const b of followerPoints) {
        let measured;
        try {
          measured = Number(grid.measurePath([a, b])?.distance);
        } catch {
          measured = NaN;
        }
        if (Number.isFinite(measured)) shortest = Math.min(shortest, measured);
      }
    }

    return Number.isFinite(shortest) ? shortest : null;
  }

  static #measurementPoints(token, grid, { planarOnly = false } = {}) {
    const elevation = planarOnly ? 0 : Number(token.elevation ?? 0);
    if (grid.isGridless === true || typeof grid.getOffsetRange !== "function" || typeof grid.getCenterPoint !== "function") {
      return [this.#tokenCenter(token, grid, elevation)];
    }

    const sizeX = Number(grid.sizeX ?? grid.size ?? 1);
    const sizeY = Number(grid.sizeY ?? grid.size ?? 1);
    const width = Math.max(Number(token.width ?? 1), 0.001) * sizeX;
    const height = Math.max(Number(token.height ?? 1), 0.001) * sizeY;

    // Inset the rectangle by a tiny amount so a token whose right/bottom edge
    // lies exactly on a grid boundary does not claim the neighboring space.
    const epsilon = Math.max(0.0001, Math.min(sizeX, sizeY) * 1e-6);
    const bounds = {
      x: Number(token.x ?? 0) + epsilon,
      y: Number(token.y ?? 0) + epsilon,
      width: Math.max(epsilon, width - (2 * epsilon)),
      height: Math.max(epsilon, height - (2 * epsilon))
    };

    let range;
    try {
      range = grid.getOffsetRange(bounds);
    } catch {
      return [this.#tokenCenter(token, grid, elevation)];
    }

    if (!Array.isArray(range) || range.length < 4) {
      return [this.#tokenCenter(token, grid, elevation)];
    }

    const [i0, j0, i1, j1] = range.map(Number);
    if (![i0, j0, i1, j1].every(Number.isFinite)) {
      return [this.#tokenCenter(token, grid, elevation)];
    }

    const points = [];
    for (let i = i0; i < i1; i += 1) {
      for (let j = j0; j < j1; j += 1) {
        try {
          const center = grid.getCenterPoint({ i, j });
          if (!center || !Number.isFinite(Number(center.x)) || !Number.isFinite(Number(center.y))) continue;
          points.push({ x: Number(center.x), y: Number(center.y), elevation });
        } catch {
          // Ignore an invalid offset and retain any other occupied spaces.
        }
      }
    }

    return points.length ? points : [this.#tokenCenter(token, grid, elevation)];
  }

  static #tokenCenter(token, grid, elevation) {
    const sizeX = Number(grid.sizeX ?? grid.size ?? 1);
    const sizeY = Number(grid.sizeY ?? grid.size ?? 1);
    return {
      x: Number(token.x ?? 0) + (Math.max(Number(token.width ?? 1), 0) * sizeX / 2),
      y: Number(token.y ?? 0) + (Math.max(Number(token.height ?? 1), 0) * sizeY / 2),
      elevation
    };
  }
}
