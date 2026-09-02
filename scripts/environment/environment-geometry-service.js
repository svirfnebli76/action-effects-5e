function clone(value) {
  if (value === undefined) return undefined;
  if (globalThis.foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
  if (globalThis.structuredClone) return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function number(value, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function radians(degrees) {
  return number(degrees) * Math.PI / 180;
}

function rotatePoint(point, center, degrees) {
  const angle = radians(degrees);
  if (!angle) return { x: point.x, y: point.y };
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos
  };
}

function pointOnSegment(point, a, b, epsilon = 0.001) {
  const cross = (point.y - a.y) * (b.x - a.x) - (point.x - a.x) * (b.y - a.y);
  if (Math.abs(cross) > epsilon) return false;
  const dot = (point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y);
  if (dot < -epsilon) return false;
  const lengthSq = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  return dot <= lengthSq + epsilon;
}

function pointInPolygon(point, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j];
    const b = polygon[i];
    if (pointOnSegment(point, a, b)) return true;
    const intersects = ((b.y > point.y) !== (a.y > point.y))
      && (point.x < (a.x - b.x) * (point.y - b.y) / ((a.y - b.y) || Number.EPSILON) + b.x);
    if (intersects) inside = !inside;
  }
  return inside;
}

function orientation(a, b, c) {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < 0.0001) return 0;
  return value > 0 ? 1 : 2;
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && pointOnSegment(c, a, b)) return true;
  if (o2 === 0 && pointOnSegment(d, a, b)) return true;
  if (o3 === 0 && pointOnSegment(a, c, d)) return true;
  if (o4 === 0 && pointOnSegment(b, c, d)) return true;
  return false;
}

function polygonEdges(points) {
  if (!Array.isArray(points) || points.length < 2) return [];
  return points.map((point, index) => [point, points[(index + 1) % points.length]]);
}

function segmentIntersectionPoint(a, b, c, d) {
  if (!segmentsIntersect(a, b, c, d)) return null;
  const denominator = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
  if (Math.abs(denominator) < 0.0001) {
    for (const point of [a, b, c, d]) {
      if (pointOnSegment(point, a, b) && pointOnSegment(point, c, d)) return { x: point.x, y: point.y };
    }
    return null;
  }
  const left = a.x * b.y - a.y * b.x;
  const right = c.x * d.y - c.y * d.x;
  return {
    x: (left * (c.x - d.x) - (a.x - b.x) * right) / denominator,
    y: (left * (c.y - d.y) - (a.y - b.y) * right) / denominator
  };
}

function polygonIntersectionPoints(left, right) {
  const points = [];
  const rightEdges = polygonEdges(right);
  for (const [a, b] of polygonEdges(left)) {
    for (const [c, d] of rightEdges) {
      const point = segmentIntersectionPoint(a, b, c, d);
      if (point) points.push(point);
    }
  }
  return points;
}

function polygonsIntersect(left, right) {
  if (!left.length || !right.length) return false;
  if (left.some(point => pointInPolygon(point, right))) return true;
  if (right.some(point => pointInPolygon(point, left))) return true;
  const rightEdges = polygonEdges(right);
  for (const [a, b] of polygonEdges(left)) {
    if (rightEdges.some(([c, d]) => segmentsIntersect(a, b, c, d))) return true;
  }
  return false;
}

function boundsIntersect(left, right) {
  if (!left || !right) return true;
  return left.maxX >= right.minX && left.minX <= right.maxX
    && left.maxY >= right.minY && left.minY <= right.maxY;
}

function elevationOverlaps(left, right) {
  if (!left || !right) return true;
  const aBottom = Number(left.bottom);
  const aTop = Number(left.top);
  const bBottom = Number(right.bottom);
  const bTop = Number(right.top);
  if (![aBottom, aTop, bBottom, bTop].every(Number.isFinite)) return true;
  return aTop >= bBottom && bTop >= aBottom;
}

function normalizePoints(points) {
  if (!Array.isArray(points)) return [];
  if (points.length && typeof points[0] === "object") {
    return points.map(point => ({ x: number(point.x), y: number(point.y) }));
  }
  const result = [];
  for (let index = 0; index + 1 < points.length; index += 2) {
    result.push({ x: number(points[index]), y: number(points[index + 1]) });
  }
  return result;
}

function flattenPoints(points) {
  return points.flatMap(point => [point.x, point.y]);
}

function centerOfBounds(bounds) {
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
}

/**
 * Region-first geometry adapter used by environmental interactions.
 *
 * Persistent world state is expected to be a Foundry Region. MeasuredTemplate
 * support exists only at this boundary for compatibility with older content.
 */
export class EnvironmentGeometryService {
  normalize(input, options = {}) {
    if (!input) return null;
    if (input.ae5eEnvironmentGeometry === 1 && Array.isArray(input.shapes)) {
      // Treat the AE5E marker as a normalized-geometry contract only when the
      // cached bounds are actually present. Some callers intentionally build a
      // tagged geometry object from native shapes; re-normalize those objects
      // so they still receive canonical shapes and the broad-phase bounds used
      // by the intersection fast path.
      if (input.bounds && [input.bounds.minX, input.bounds.minY, input.bounds.maxX, input.bounds.maxY].every(Number.isFinite)) {
        return clone(input);
      }
      return this.#createGeometry({
        source: options.source ?? input.source ?? "normalized",
        documentUuid: input.documentUuid ?? null,
        sceneUuid: input.sceneUuid ?? options.scene?.uuid ?? null,
        elevation: input.elevation ?? null,
        shapes: input.shapes
      });
    }
    if (input.document && input.document !== input) return this.normalize(input.document, options);
    if (input.documentName === "Region" || (Array.isArray(input.shapes) && input.parent?.documentName === "Scene")) {
      return this.fromRegion(input, options);
    }
    if (input.documentName === "MeasuredTemplate" || ["circle", "cone", "ray", "rect", "rectangle"].includes(input.t ?? input.type)) {
      return this.fromMeasuredTemplate(input, options);
    }
    if (Number.isFinite(Number(input.x)) && Number.isFinite(Number(input.y)) && !input.type && !input.t && !input.shapes) {
      return this.fromPoint(input, options);
    }
    if (Array.isArray(input.shapes)) {
      return this.#createGeometry({
        source: options.source ?? input.source ?? "normalized",
        documentUuid: input.documentUuid ?? null,
        sceneUuid: input.sceneUuid ?? options.scene?.uuid ?? null,
        elevation: input.elevation ?? null,
        shapes: input.shapes
      });
    }
    return null;
  }

  fromPoint(point, { scene = null, source = "point" } = {}) {
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const elevation = Number(point?.elevation);
    return this.#createGeometry({
      source,
      sceneUuid: scene?.uuid ?? point?.sceneUuid ?? null,
      elevation: Number.isFinite(elevation) ? { bottom: elevation, top: elevation } : null,
      shapes: [{ type: "point", x, y, hole: false }]
    });
  }

  fromToken(token, { source = "token-impact" } = {}) {
    const document = token?.document ?? token;
    const center = token?.center ?? document?.object?.center ?? {
      x: number(document?.x) + number(document?.width, 1) * number(document?.parent?.grid?.size ?? globalThis.canvas?.grid?.size, 100) / 2,
      y: number(document?.y) + number(document?.height, 1) * number(document?.parent?.grid?.size ?? globalThis.canvas?.grid?.size, 100) / 2
    };
    return this.fromPoint({
      x: center?.x,
      y: center?.y,
      elevation: document?.elevation,
      sceneUuid: document?.parent?.uuid ?? null
    }, { source });
  }

  fromRegion(region, { source = "region" } = {}) {
    const data = region?.toObject?.(false) ?? region ?? {};
    const liveShapes = [...(region?.shapes ?? [])];
    const sourceShapes = data.shapes ?? liveShapes;
    const shapes = [];

    // Foundry v14 Region shape DataModels expose their resolved polygons. Prefer
    // those when a live RegionDocument is available so AE5E automatically
    // supports native shape families (grid, line, ring, emanation, token, etc.)
    // without reimplementing Foundry's grid-aware shape mathematics. The hole
    // flag remains semantic Region geometry and is preserved on every polygon.
    if (liveShapes.length) {
      for (const shape of liveShapes) {
        const raw = shape?.toObject?.(false) ?? shape ?? {};
        const polygons = shape?.polygons ? [...shape.polygons] : [];
        let converted = false;
        for (const polygon of polygons) {
          const points = normalizePoints(polygon?.points ?? polygon);
          if (points.length < 3) continue;
          shapes.push({ type: "polygon", points: flattenPoints(points), hole: Boolean(raw.hole ?? shape?.hole) });
          converted = true;
        }
        if (!converted) shapes.push(raw);
      }
    } else {
      shapes.push(...sourceShapes.map(shape => shape?.toObject?.(false) ?? shape));
    }

    return this.#createGeometry({
      source,
      documentUuid: region?.uuid ?? data.uuid ?? null,
      sceneUuid: region?.parent?.uuid ?? data.sceneUuid ?? null,
      elevation: clone(data.elevation ?? region?.elevation ?? null),
      shapes
    });
  }

  fromCrosshair(crosshair, options = {}) {
    return this.normalize(crosshair?.document ?? crosshair, { ...options, source: options.source ?? "crosshair" });
  }

  fromMeasuredTemplate(template, { scene = null, source = "measured-template-compatibility" } = {}) {
    const document = template?.document ?? template;
    const data = document?.toObject?.(false) ?? document ?? {};
    const parentScene = scene ?? document?.parent ?? globalThis.canvas?.scene ?? null;

    // Prefer the rendered Foundry shape when available. It is already the
    // authoritative pixel footprint and avoids reimplementing template math.
    const renderedShape = template?.object?.shape ?? document?.object?.shape ?? null;
    if (renderedShape) {
      const points = this.#renderedShapePoints(renderedShape, data.x ?? document?.x ?? 0, data.y ?? document?.y ?? 0);
      if (points.length >= 3) {
        return this.#createGeometry({
          source,
          documentUuid: document?.uuid ?? null,
          sceneUuid: parentScene?.uuid ?? null,
          elevation: this.#templateElevation(document),
          shapes: [{ type: "polygon", points: flattenPoints(points), hole: false }]
        });
      }
    }

    const x = number(data.x ?? document?.x);
    const y = number(data.y ?? document?.y);
    const distance = this.#distanceToPixels(data.distance ?? document?.distance, parentScene);
    const width = this.#distanceToPixels(data.width ?? document?.width ?? data.distance ?? document?.distance, parentScene);
    const direction = number(data.direction ?? document?.direction);
    const angle = number(data.angle ?? document?.angle, 90);
    const type = String(data.t ?? data.type ?? document?.t ?? document?.type ?? "circle").toLowerCase();
    let shape;
    if (type === "cone") shape = { type: "cone", x, y, distance, angle, direction };
    else if (type === "ray") shape = { type: "ray", x, y, distance, width: width || distance, direction };
    else if (["rect", "rectangle"].includes(type)) shape = { type: "rectangle", x, y, width: distance, height: distance, rotation: direction };
    else shape = { type: "circle", x, y, radius: distance };

    return this.#createGeometry({
      source,
      documentUuid: document?.uuid ?? null,
      sceneUuid: parentScene?.uuid ?? null,
      elevation: this.#templateElevation(document),
      shapes: [shape]
    });
  }

  serialize(geometry) {
    return clone(this.normalize(geometry));
  }

  getBounds(geometry) {
    const normalized = this.normalize(geometry);
    return normalized?.bounds ? clone(normalized.bounds) : null;
  }

  containsPoint(geometry, point) {
    const normalized = this.normalize(geometry);
    if (!normalized || !point) return false;
    if (normalized.elevation) {
      const elevation = Number(point.elevation);
      if (Number.isFinite(elevation)) {
        const bottom = Number(normalized.elevation.bottom);
        const top = Number(normalized.elevation.top);
        if (Number.isFinite(bottom) && elevation < bottom) return false;
        if (Number.isFinite(top) && elevation > top) return false;
      }
    }
    const positives = normalized.shapes.filter(shape => !shape.hole);
    const holes = normalized.shapes.filter(shape => shape.hole);
    const insidePositive = positives.some(shape => this.#shapeContainsPoint(shape, point));
    if (!insidePositive) return false;
    return !holes.some(shape => this.#shapeContainsPoint(shape, point));
  }

  intersects(left, right) {
    const a = this.normalize(left);
    const b = this.normalize(right);
    if (!a || !b) return false;
    if (!elevationOverlaps(a.elevation, b.elevation)) return false;
    if (!boundsIntersect(a.bounds, b.bounds)) return false;

    const aPoints = a.shapes.filter(shape => !shape.hole && shape.type === "point");
    if (aPoints.some(shape => this.containsPoint(b, shape))) return true;
    const bPoints = b.shapes.filter(shape => !shape.hole && shape.type === "point");
    if (bPoints.some(shape => this.containsPoint(a, shape))) return true;

    const aPolygons = a.shapes.filter(shape => !shape.hole && shape.type !== "point").map(shape => this.#shapePolygon(shape));
    const bPolygons = b.shapes.filter(shape => !shape.hole && shape.type !== "point").map(shape => this.#shapePolygon(shape));
    for (const polygonA of aPolygons) {
      if (!polygonA.length) continue;
      for (const polygonB of bPolygons) {
        if (!polygonB.length || !polygonsIntersect(polygonA, polygonB)) continue;
        // Polygon intersection can cross a Region hole boundary. Confirm a
        // representative overlap point against both full positive-minus-hole
        // geometries before declaring a precise hit.
        const candidates = [...polygonA, ...polygonB, ...polygonIntersectionPoints(polygonA, polygonB)];
        if (candidates.some(point => this.containsPoint(a, point) && this.containsPoint(b, point))) return true;
        const midpoint = centerOfBounds({
          minX: Math.max(a.bounds.minX, b.bounds.minX),
          minY: Math.max(a.bounds.minY, b.bounds.minY),
          maxX: Math.min(a.bounds.maxX, b.bounds.maxX),
          maxY: Math.min(a.bounds.maxY, b.bounds.maxY)
        });
        if (this.containsPoint(a, midpoint) && this.containsPoint(b, midpoint)) return true;
      }
    }
    return false;
  }

  createRectangle({ x, y, width, height, rotation = 0, hole = false } = {}) {
    // Public AE5E callers continue to supply top-left x/y. Emit Foundry v14's
    // current RectangleShapeData schema explicitly: x/y are the pivot and the
    // 0.5 anchors place that pivot at the rectangle center. This avoids Foundry
    // migrating the shape after persistence and keeps repeated geometry
    // mutations byte-stable across document round-trips.
    const w = Math.max(0, number(width));
    const h = Math.max(0, number(height));
    return {
      type: "rectangle",
      x: number(x) + w / 2,
      y: number(y) + h / 2,
      width: w,
      height: h,
      rotation: number(rotation),
      anchorX: 0.5,
      anchorY: 0.5,
      gridBased: false,
      hole: Boolean(hole)
    };
  }

  #createGeometry({ source, documentUuid = null, sceneUuid = null, elevation = null, shapes }) {
    const normalizedShapes = (shapes ?? []).map(shape => this.#normalizeShape(shape)).filter(Boolean);
    if (!normalizedShapes.length) return null;
    const points = normalizedShapes.flatMap(shape => shape.type === "point" ? [{ x: shape.x, y: shape.y }] : this.#shapePolygon(shape));
    if (!points.length) return null;
    const xs = points.map(point => point.x);
    const ys = points.map(point => point.y);
    return {
      ae5eEnvironmentGeometry: 1,
      source: String(source ?? "unknown"),
      documentUuid: documentUuid ?? null,
      sceneUuid: sceneUuid ?? null,
      elevation: elevation ? {
        bottom: elevation.bottom ?? elevation.min ?? null,
        top: elevation.top ?? elevation.max ?? null
      } : null,
      shapes: normalizedShapes,
      bounds: {
        minX: Math.min(...xs),
        minY: Math.min(...ys),
        maxX: Math.max(...xs),
        maxY: Math.max(...ys)
      }
    };
  }

  #normalizeShape(shape) {
    if (!shape || typeof shape !== "object") return null;
    const type = String(shape.type ?? "").toLowerCase();
    const hole = Boolean(shape.hole);
    if (type === "point") return { type, x: number(shape.x), y: number(shape.y), hole };
    if (type === "polygon") {
      const points = normalizePoints(shape.points);
      if (points.length < 3) return null;
      return { type, points: flattenPoints(points), hole };
    }
    if (type === "ellipse") return {
      type, x: number(shape.x), y: number(shape.y), radiusX: Math.abs(number(shape.radiusX)), radiusY: Math.abs(number(shape.radiusY)), rotation: number(shape.rotation), hole
    };
    if (type === "rectangle") {
      const anchorX = Number(shape.anchorX);
      const anchorY = Number(shape.anchorY);
      return {
        type,
        x: number(shape.x),
        y: number(shape.y),
        width: Math.abs(number(shape.width)),
        height: Math.abs(number(shape.height)),
        rotation: number(shape.rotation),
        anchorX: Number.isFinite(anchorX) ? anchorX : null,
        anchorY: Number.isFinite(anchorY) ? anchorY : null,
        gridBased: Boolean(shape.gridBased),
        hole
      };
    }
    if (type === "circle") return { type, x: number(shape.x), y: number(shape.y), radius: Math.abs(number(shape.radius ?? shape.distance)), hole };
    if (type === "cone") return { type, x: number(shape.x), y: number(shape.y), distance: Math.abs(number(shape.distance ?? shape.radius)), angle: Math.abs(number(shape.angle, 90)), direction: number(shape.direction), hole };
    if (type === "ray") return { type, x: number(shape.x), y: number(shape.y), distance: Math.abs(number(shape.distance)), width: Math.abs(number(shape.width)), direction: number(shape.direction), hole };
    return null;
  }

  #shapeContainsPoint(shape, point) {
    if (shape.type === "point") return Math.hypot(number(point.x) - shape.x, number(point.y) - shape.y) < 0.001;
    return pointInPolygon({ x: number(point.x), y: number(point.y) }, this.#shapePolygon(shape));
  }

  #shapePolygon(shape, segments = 32) {
    if (shape.type === "polygon") return normalizePoints(shape.points);
    if (shape.type === "rectangle") {
      // Foundry v14 RectangleShapeData uses (x, y) as the pivot and anchorX/Y
      // to locate the rectangle around that pivot. AE5E also accepts its older
      // concise top-left form when no anchors are present.
      const nativeAnchors = Number.isFinite(Number(shape.anchorX)) && Number.isFinite(Number(shape.anchorY));
      const pivot = nativeAnchors
        ? { x: shape.x, y: shape.y }
        : { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
      const left = nativeAnchors ? shape.x - shape.width * Number(shape.anchorX) : shape.x;
      const top = nativeAnchors ? shape.y - shape.height * Number(shape.anchorY) : shape.y;
      const corners = [
        { x: left, y: top },
        { x: left + shape.width, y: top },
        { x: left + shape.width, y: top + shape.height },
        { x: left, y: top + shape.height }
      ];
      return shape.rotation ? corners.map(point => rotatePoint(point, pivot, shape.rotation)) : corners;
    }
    if (["ellipse", "circle"].includes(shape.type)) {
      const rx = shape.type === "circle" ? shape.radius : shape.radiusX;
      const ry = shape.type === "circle" ? shape.radius : shape.radiusY;
      const points = [];
      for (let index = 0; index < segments; index += 1) {
        const angle = Math.PI * 2 * index / segments;
        const point = { x: shape.x + rx * Math.cos(angle), y: shape.y + ry * Math.sin(angle) };
        points.push(shape.rotation ? rotatePoint(point, { x: shape.x, y: shape.y }, shape.rotation) : point);
      }
      return points;
    }
    if (shape.type === "cone") {
      const points = [{ x: shape.x, y: shape.y }];
      const start = shape.direction - shape.angle / 2;
      const slices = Math.max(8, Math.ceil(segments * Math.min(1, shape.angle / 360)));
      for (let index = 0; index <= slices; index += 1) {
        const angle = radians(start + shape.angle * index / slices);
        points.push({ x: shape.x + shape.distance * Math.cos(angle), y: shape.y + shape.distance * Math.sin(angle) });
      }
      return points;
    }
    if (shape.type === "ray") {
      const direction = radians(shape.direction);
      const perpendicular = { x: -Math.sin(direction), y: Math.cos(direction) };
      const half = shape.width / 2;
      const end = { x: shape.x + shape.distance * Math.cos(direction), y: shape.y + shape.distance * Math.sin(direction) };
      return [
        { x: shape.x + perpendicular.x * half, y: shape.y + perpendicular.y * half },
        { x: end.x + perpendicular.x * half, y: end.y + perpendicular.y * half },
        { x: end.x - perpendicular.x * half, y: end.y - perpendicular.y * half },
        { x: shape.x - perpendicular.x * half, y: shape.y - perpendicular.y * half }
      ];
    }
    return [];
  }

  #renderedShapePoints(shape, offsetX, offsetY) {
    let polygon = shape;
    if (typeof shape.toPolygon === "function") polygon = shape.toPolygon();
    const raw = polygon?.points;
    if (!Array.isArray(raw) && !ArrayBuffer.isView(raw)) return [];
    const points = [];
    for (let index = 0; index + 1 < raw.length; index += 2) {
      points.push({ x: number(raw[index]) + number(offsetX), y: number(raw[index + 1]) + number(offsetY) });
    }
    return points;
  }

  #distanceToPixels(distance, scene) {
    const numeric = Math.abs(number(distance));
    const gridSize = number(scene?.grid?.size ?? scene?.dimensions?.size ?? globalThis.canvas?.grid?.size, 100);
    const gridDistance = number(scene?.grid?.distance ?? scene?.dimensions?.distance ?? globalThis.canvas?.scene?.grid?.distance, 5);
    return gridDistance > 0 ? numeric * gridSize / gridDistance : numeric;
  }

  #templateElevation(document) {
    const elevation = Number(document?.elevation ?? document?.object?.document?.elevation);
    return Number.isFinite(elevation) ? { bottom: elevation, top: elevation } : null;
  }
}
