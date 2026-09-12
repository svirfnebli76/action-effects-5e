import { CROSSHAIR_3D_EPSILON, finiteNumber } from "./geometry-utils.js";

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object ?? {}, key);
}

export class Crosshair3dTokenVolumeService {
  resolve(token, { position = null, grid = null, coordinateSpace = "pixels" } = {}) {
    if (!token) return null;
    const document = token.document ?? token;
    const source = token._source ?? document?._source ?? {};
    const width = finiteNumber(position?.width ?? document?.width ?? source.width ?? token.width, 1);
    const height = finiteNumber(position?.height ?? document?.height ?? source.height ?? token.height, 1);
    if (!(width > 0) || !(height > 0)) return null;

    let depth = null;
    if (position && hasOwn(position, "depth") && Number.isFinite(Number(position.depth))) depth = Number(position.depth);
    else if (hasOwn(source, "depth") && Number.isFinite(Number(source.depth))) depth = Number(source.depth);
    else if (document && hasOwn(document, "depth") && Number.isFinite(Number(document.depth))) depth = Number(document.depth);
    else if (hasOwn(token, "depth") && Number.isFinite(Number(token.depth))) depth = Number(token.depth);
    if (depth === null) depth = Math.max(width, height);
    depth = Math.max(0, depth);

    const elevation = finiteNumber(position?.elevation ?? document?.elevation ?? source.elevation ?? token.elevation);
    const rawX = finiteNumber(position?.x ?? document?.x ?? source.x ?? token.x);
    const rawY = finiteNumber(position?.y ?? document?.y ?? source.y ?? token.y);

    const metrics = this.normalizeGrid(grid);
    let x = rawX;
    let y = rawY;
    let footprintWidth = width;
    let footprintHeight = height;
    let zUnit = 1;
    if (coordinateSpace === "pixels") {
      if (!metrics) throw new Error("Pixel-space Token volume resolution requires grid size and distance.");
      x = ((rawX - metrics.originX) / metrics.size) * metrics.distance;
      y = ((rawY - metrics.originY) / metrics.size) * metrics.distance;
      footprintWidth = width * metrics.distance;
      footprintHeight = height * metrics.distance;
      zUnit = metrics.distance;
    } else if (coordinateSpace === "distance") {
      zUnit = metrics?.distance ?? 1;
      footprintWidth = width * zUnit;
      footprintHeight = height * zUnit;
    } else {
      throw new RangeError(`Unsupported Token coordinateSpace '${coordinateSpace}'.`);
    }

    return Object.freeze({
      x,
      y,
      minX: x,
      maxX: x + footprintWidth,
      minY: y,
      maxY: y + footprintHeight,
      widthUnits: width,
      heightUnits: height,
      depthUnits: depth,
      bottom: elevation,
      top: elevation + (depth * zUnit),
      elevation,
      coordinateSpace,
      grid: metrics
    });
  }

  normalizeGrid(grid = null) {
    if (!grid) return null;
    const size = finiteNumber(grid.size ?? grid.sizePixels ?? grid.gridSize, 0);
    const distance = finiteNumber(grid.distance ?? grid.gridDistance, 0);
    if (!(size > 0) || !(distance > 0)) throw new RangeError("Grid metrics require positive size and distance.");
    return Object.freeze({
      size,
      distance,
      originX: finiteNumber(grid.originX ?? grid.origin?.x),
      originY: finiteNumber(grid.originY ?? grid.origin?.y)
    });
  }

  intersectsCell(volume, cell, { epsilon = CROSSHAIR_3D_EPSILON } = {}) {
    if (!volume || !cell) return false;
    return Math.min(volume.maxX, cell.maxX) - Math.max(volume.minX, cell.minX) > epsilon
      && Math.min(volume.maxY, cell.maxY) - Math.max(volume.minY, cell.minY) > epsilon
      && Math.min(volume.top, cell.maxZ) - Math.max(volume.bottom, cell.minZ) > epsilon;
  }

  intersectsAnyCell(volume, cells, options = {}) {
    return Array.from(cells ?? []).some(cell => this.intersectsCell(volume, cell, options));
  }
}
