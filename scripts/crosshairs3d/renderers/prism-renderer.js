import { freeLineEndpoints, freeLineRangeBoundary } from "../free-line-placement.js";
import { clamp01, controlHints, updateTextResolution, TARGET_PREVIEW_NOTICE_TEXT, TARGET_PREVIEW_NOTICE_COLOR, targetPreviewNoticeEnabled } from "./shared.js";

// Rendering and text layout preserved from AE5E-Prism-Visible-Edge-Glow-Test-04.txt.
export function createRenderer(context) {
  const { shape, sourceVolume, metrics, metricsService, geometry, options, capabilities, propagationMode, parent } = context;
  const api = { geometry };
  const scene = globalThis.canvas.scene;
  const scale = metrics.size / metrics.distance;
  const unit = String(scene.grid.units || "ft");
  const RANGE = Number(options.range?.max ?? options.maxRange ?? 60);
  const sourceBound = String(options.placement?.mode ?? "").trim().toLowerCase() === "source";
  const toPixel = point => metricsService.distanceToPixels(point, metrics);
  const sourceCenterPixels = toPixel({ x: (sourceVolume.minX + sourceVolume.maxX) / 2,
    y: (sourceVolume.minY + sourceVolume.maxY) / 2, z: sourceVolume.bottom });
  let root, revision, mode = "MOVE", labelsDirty = false;
  const labels = [];
  const lightStartedAt = performance.now(), waveStartedAt = lightStartedAt, pulseStartedAt = lightStartedAt;
const LENGTH = shape.length, WIDTH = shape.width, HEIGHT = shape.height, RADIUS = shape.radius, DIAMETER = shape.radius * 2;
  const TEAL_BASE_COLOR = 0x388E8E;
  const RED_BASE_COLOR = 0xFF4D4D;
  const TEAL_LIGHTNESS_MIN = 0.00;
  const TEAL_LIGHTNESS_MAX = 0.70;
  const RED_DARKNESS_MIN = 0.00;
  const RED_DARKNESS_MAX = 0.65;
  const GRADIENT_BANDS = 32;

  // VISUAL-ONLY OBLIQUE HEIGHT. Targeting always uses the unshifted prism.
  const VISUAL_DEPTH_SCALE = 0.15;
  const VISUAL_DEPTH_CAP = 0.22;
  const VISUAL_PROJECTION_X = -0.65;
  const VISUAL_PROJECTION_Y = -1.00;

  // Face shading is applied after elevation color is resolved.
  const TOP_FACE_HIGHLIGHT = 0.10;
  const SIDE_FACE_SHADOW_LIGHT = 0.16;
  const SIDE_FACE_SHADOW_DARK = 0.28;
  const BOTTOM_FACE_FILL_ALPHA = 0.24;
  const TOP_FACE_FILL_ALPHA = 0.50;
  const SIDE_FACE_FILL_ALPHA = 0.44;
  const STRUCTURE_UNDERLAY_WIDTH = 4.5;
  const STRUCTURE_EDGE_WIDTH = 2.25;
  const HIDDEN_EDGE_DASH_LENGTH = 8;
  const HIDDEN_EDGE_GAP_LENGTH = 6;
  const HIDDEN_EDGE_ALPHA = 0.65;

  const RANGE_RING_COLOR = 0x7FEFEF;
  const RANGE_RING_ALPHA = 0.40;
  const TRACER_COLOR = 0x4A4A4A;
  const TRACER_ALPHA = 0.80;
  const TRACER_WIDTH = 3;
  const TRACER_CHEVRON_SIZE = 7;
  const TRACER_CHEVRON_SPACING = 70;
  // Illumination accumulates from the visual top face to the authoritative
  // bottom face, holds fully lit, and only then fades as one object.
  const LIGHT_SPREAD_MS = 2200;
  const FULLY_LIT_HOLD_MS = 650;
  const FULL_FADE_MS = 500;
  const RESTART_PAUSE_MS = 150;
  const LIGHTEN_AMOUNT = 0.60;
  const LIGHT_ALPHA_MAX = 0.60;
  const LIGHT_OUTLINE_WIDTH = 3.5;
  const ZOOM_SETTLE_MS = 200;



  const format = value => String(Math.round(Number(value) * 10) / 10);

  function mixColor(from, to, amount) {
    const t = clamp01(amount);
    const channel = (shift, a = from, b = to) => Math.round(
      ((a >> shift) & 0xFF) + ((((b >> shift) & 0xFF) - ((a >> shift) & 0xFF)) * t)
    );
    return (channel(16) << 16) | (channel(8) << 8) | channel(0);
  }

    function elevationBaseColor(point) {
      const delta = point.z - sourceVolume.bottom;
      const rawRatio = clamp01(
        Math.abs(delta) / Math.max(RANGE, 1e-7)
      );
      const ratio = Math.round(rawRatio * GRADIENT_BANDS) /
        GRADIENT_BANDS;

      if (delta < -1e-7) {
        const darkness = RED_DARKNESS_MIN +
          (RED_DARKNESS_MAX - RED_DARKNESS_MIN) * ratio;
        return {
          color: mixColor(RED_BASE_COLOR, 0x000000, darkness),
          palette: "red"
        };
      }

      const lightness = TEAL_LIGHTNESS_MIN +
        (TEAL_LIGHTNESS_MAX - TEAL_LIGHTNESS_MIN) * ratio;
      return {
        color: mixColor(TEAL_BASE_COLOR, 0xFFFFFF, lightness),
        palette: "teal"
      };
    }

    root = new PIXI.Container();
    root.eventMode = "none";
    root.name = "ae5e-pixi-prism-test";

    const drawing = new PIXI.Graphics();
    const lightLines = new PIXI.Graphics();
    const markerDrawing = new PIXI.Graphics();
    const textRoot = new PIXI.Container();
    root.addChild(
      drawing,
      lightLines,
      markerDrawing,
      textRoot
    );
    parent.addChild(root);

    function makeText(value, bold = false) {
      const label = new PIXI.Text(value, new PIXI.TextStyle({
        fontFamily: "Arial",
        fontSize: 16,
        fontWeight: bold ? "700" : "400",
        fill: "#FFFFFF",
        stroke: "#000000",
        strokeThickness: 0,
        dropShadow: false,
        padding: 4
      }));
      label.anchor.set(0, 0.5);
      label.resolution = 2;
      label.eventMode = "none";
      labels.push(label);
      return label;
    }

    const header = new PIXI.Container();
    const badge = new PIXI.Graphics();
    const modeText = makeText("MOVE", true);
    const dimensions = makeText("", true);
    header.addChild(badge, modeText, dimensions);

    const centerElevation = makeText("", true);
    const instructions = new PIXI.Container();
    for (const [value, bold] of controlHints(capabilities)) { instructions.addChild(makeText(value, bold)); }
    const targetPreviewNotice = targetPreviewNoticeEnabled(propagationMode)
      ? makeText(TARGET_PREVIEW_NOTICE_TEXT)
      : null;
    if (targetPreviewNotice) {
      targetPreviewNotice.style.fill = TARGET_PREVIEW_NOTICE_COLOR;
      targetPreviewNotice.anchor.set(0.5, 0.5);
    }
    textRoot.addChild(header, centerElevation, instructions);
    if (targetPreviewNotice) textRoot.addChild(targetPreviewNotice);

    let lastResolution = 2;

    const polygon = (graphics, points, fillColor, fillAlpha = 0) => {
      graphics.lineStyle(0);
      if (fillAlpha > 0) graphics.beginFill(fillColor, fillAlpha);
      graphics.drawPolygon(points.flatMap(point => [point.x, point.y]));
      if (fillAlpha > 0) graphics.endFill();
    };

    const outline = (graphics, points, color, alpha, width) => {
      graphics.lineStyle(width, color, alpha);
      graphics.drawPolygon(points.flatMap(point => [point.x, point.y]));
    };

    const line = (graphics, from, to, color, alpha, width) => {
      graphics.lineStyle(width, color, alpha);
      graphics.moveTo(from.x, from.y);
      graphics.lineTo(to.x, to.y);
    };

    function dashedLine(graphics, from, to, color, alpha, width) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.hypot(dx, dy);
      if (length < 1e-7) return;
      const ux = dx / length;
      const uy = dy / length;
      const cycle = HIDDEN_EDGE_DASH_LENGTH + HIDDEN_EDGE_GAP_LENGTH;

      for (let distance = 0; distance < length; distance += cycle) {
        const end = Math.min(length, distance + HIDDEN_EDGE_DASH_LENGTH);
        line(
          graphics,
          { x: from.x + ux * distance, y: from.y + uy * distance },
          { x: from.x + ux * end, y: from.y + uy * end },
          color,
          alpha * HIDDEN_EDGE_ALPHA,
          width
        );
      }
    }

    const cross2d = (a, b) => a.x * b.y - a.y * b.x;

    function segmentIntersectionParameter(from, to, a, b) {
      const r = { x: to.x - from.x, y: to.y - from.y };
      const s = { x: b.x - a.x, y: b.y - a.y };
      const denominator = cross2d(r, s);
      if (Math.abs(denominator) < 1e-7) return null;
      const offset = { x: a.x - from.x, y: a.y - from.y };
      const t = cross2d(offset, s) / denominator;
      const u = cross2d(offset, r) / denominator;
      if (t <= 1e-7 || t >= 1 - 1e-7 || u < -1e-7 || u > 1 + 1e-7) {
        return null;
      }
      return t;
    }

    function pointInsidePolygon(point, points) {
      let inside = false;
      for (let index = 0, previous = points.length - 1;
        index < points.length;
        previous = index++) {
        const a = points[index];
        const b = points[previous];
        const crosses = (a.y > point.y) !== (b.y > point.y) &&
          point.x < (b.x - a.x) * (point.y - a.y) /
            ((b.y - a.y) || 1e-12) + a.x;
        if (crosses) inside = !inside;
      }
      return inside;
    }

    function classifiedSegments(from, to, coverPolygon) {
      const parameters = [0, 1];
      for (let index = 0; index < coverPolygon.length; index++) {
        const value = segmentIntersectionParameter(
          from,
          to,
          coverPolygon[index],
          coverPolygon[(index + 1) % coverPolygon.length]
        );
        if (value !== null) parameters.push(value);
      }
      parameters.sort((a, b) => a - b);
      const unique = parameters.filter((value, index) =>
        index === 0 || Math.abs(value - parameters[index - 1]) > 1e-6
      );

      const parts = [];
      for (let index = 0; index < unique.length - 1; index++) {
        const start = unique[index];
        const end = unique[index + 1];
        const midpoint = (start + end) / 2;
        parts.push({
          from: lerpPoint(from, to, start),
          to: lerpPoint(from, to, end),
          hidden: pointInsidePolygon(
            lerpPoint(from, to, midpoint),
            coverPolygon
          )
        });
      }
      return parts;
    }

    function classifiedLine(
      graphics,
      from,
      to,
      coverPolygon,
      color,
      alpha,
      width
    ) {
      for (const part of classifiedSegments(from, to, coverPolygon)) {
        if (part.hidden) {
          dashedLine(
            graphics,
            part.from,
            part.to,
            color,
            alpha,
            width
          );
        } else {
          line(graphics, part.from, part.to, color, alpha, width);
        }
      }
    }

    function visibleClassifiedLine(
      graphics,
      from,
      to,
      coverPolygon,
      color,
      alpha,
      width
    ) {
      for (const part of classifiedSegments(from, to, coverPolygon)) {
        // Hidden segments remain present only in the static dashed layer.
        // The animated illumination is restricted to exposed solid edges.
        if (!part.hidden) {
          line(graphics, part.from, part.to, color, alpha, width);
        }
      }
    }

    const lerpPoint = (from, to, amount) => ({
      x: from.x + (to.x - from.x) * amount,
      y: from.y + (to.y - from.y) * amount
    });

    function prismPresentation(point, yaw) {
      const radians = yaw * Math.PI / 180;
      const c = Math.cos(radians);
      const s = Math.sin(radians);
      const halfLength = LENGTH / 2;
      const halfWidth = WIDTH / 2;
      const bottom = [
        [-halfLength, -halfWidth],
        [halfLength, -halfWidth],
        [halfLength, halfWidth],
        [-halfLength, halfWidth]
      ].map(([x, y]) => toPixel({
        x: point.x + x * c - y * s,
        y: point.y + x * s + y * c,
        z: point.z
      }));

      const depthDistance = Math.min(
        HEIGHT * VISUAL_DEPTH_SCALE,
        Math.min(LENGTH, WIDTH) * VISUAL_DEPTH_CAP
      );
      const projectionLength = Math.hypot(
        VISUAL_PROJECTION_X,
        VISUAL_PROJECTION_Y
      ) || 1;
      const depthPixels = depthDistance * scale;
      const offset = {
        x: VISUAL_PROJECTION_X / projectionLength * depthPixels,
        y: VISUAL_PROJECTION_Y / projectionLength * depthPixels
      };
      const top = bottom.map(corner => ({
        x: corner.x + offset.x,
        y: corner.y + offset.y
      }));

      // The corners are clockwise in canvas coordinates. A side is visible
      // when its outward normal faces the exposed bottom-to-top displacement.
      const visibleSides = [];
      for (let index = 0; index < bottom.length; index++) {
        const next = (index + 1) % bottom.length;
        const edge = {
          x: bottom[next].x - bottom[index].x,
          y: bottom[next].y - bottom[index].y
        };
        const outward = { x: edge.y, y: -edge.x };
        if (outward.x * -offset.x + outward.y * -offset.y > 1e-7) {
          visibleSides.push({
            index,
            next,
            points: [top[index], top[next], bottom[next], bottom[index]]
          });
        }
      }
      return { bottom, top, visibleSides, offset };
    }

    function drawPrism(point, yaw) {
      const presentation = prismPresentation(point, yaw);
      const elevation = elevationBaseColor(point);
      const baseColor = elevation.color;
      const edgeColor = elevation.palette === "red"
        ? RED_BASE_COLOR
        : TEAL_BASE_COLOR;
      const topColor = mixColor(baseColor, 0xFFFFFF, TOP_FACE_HIGHLIGHT);

      // The bottom rectangle is the exact rules footprint. Everything offset
      // from it is presentation only and never reaches targeting geometry.
      polygon(
        drawing,
        presentation.bottom,
        baseColor,
        BOTTOM_FACE_FILL_ALPHA
      );

      presentation.visibleSides.forEach((side, index) => {
        const shadow = index % 2
          ? SIDE_FACE_SHADOW_DARK
          : SIDE_FACE_SHADOW_LIGHT;
        polygon(
          drawing,
          side.points,
          mixColor(baseColor, 0x000000, shadow),
          SIDE_FACE_FILL_ALPHA
        );
      });

      polygon(
        drawing,
        presentation.top,
        topColor,
        TOP_FACE_FILL_ALPHA
      );

      // Dark underlay keeps the visual readable over bright maps.
      outline(
        drawing,
        presentation.top,
        0x000000,
        0.40,
        STRUCTURE_UNDERLAY_WIDTH
      );
      // Draw all four height connectors, including the rear corner line. The
      // portions covered by the upper face are dynamically dashed.
      for (let index = 0; index < 4; index++) {
        classifiedLine(
          drawing,
          presentation.top[index],
          presentation.bottom[index],
          presentation.top,
          0x000000,
          0.40,
          STRUCTURE_UNDERLAY_WIDTH
        );
      }
      for (let index = 0; index < 4; index++) {
        classifiedLine(
          drawing,
          presentation.bottom[index],
          presentation.bottom[(index + 1) % 4],
          presentation.top,
          0x000000,
          0.40,
          STRUCTURE_UNDERLAY_WIDTH
        );
      }

      outline(
        drawing,
        presentation.top,
        edgeColor,
        0.92,
        STRUCTURE_EDGE_WIDTH
      );
      for (let index = 0; index < 4; index++) {
        classifiedLine(
          drawing,
          presentation.top[index],
          presentation.bottom[index],
          presentation.top,
          edgeColor,
          0.76,
          STRUCTURE_EDGE_WIDTH
        );
      }
      for (let index = 0; index < 4; index++) {
        classifiedLine(
          drawing,
          presentation.bottom[index],
          presentation.bottom[(index + 1) % 4],
          presentation.top,
          edgeColor,
          0.92,
          STRUCTURE_EDGE_WIDTH
        );
      }

      return presentation;
    }

    function drawSourceTracer(from, to) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.hypot(dx, dy);
      if (length < 1e-7) return;

      const direction = { x: dx / length, y: dy / length };
      const normal = { x: -direction.y, y: direction.x };

      drawing.lineStyle(TRACER_WIDTH, TRACER_COLOR, TRACER_ALPHA);
      drawing.moveTo(from.x, from.y);
      drawing.lineTo(to.x, to.y);

      const chevrons = Math.max(
        0,
        Math.floor(length / TRACER_CHEVRON_SPACING)
      );
      for (let index = 1; index <= chevrons; index++) {
        const t = index / (chevrons + 1);
        const point = {
          x: from.x + dx * t,
          y: from.y + dy * t
        };
        const back = {
          x: point.x - direction.x * TRACER_CHEVRON_SIZE,
          y: point.y - direction.y * TRACER_CHEVRON_SIZE
        };
        drawing.moveTo(
          back.x + normal.x * TRACER_CHEVRON_SIZE * 0.55,
          back.y + normal.y * TRACER_CHEVRON_SIZE * 0.55
        );
        drawing.lineTo(point.x, point.y);
        drawing.lineTo(
          back.x - normal.x * TRACER_CHEVRON_SIZE * 0.55,
          back.y - normal.y * TRACER_CHEVRON_SIZE * 0.55
        );
      }
    }

    function updateCubeIllumination(now) {
      lightLines.clear();
      if (!revision) return;

      const presentation = prismPresentation(revision.point, revision.yaw);
      const cycleDuration = LIGHT_SPREAD_MS + FULLY_LIT_HOLD_MS +
        FULL_FADE_MS + RESTART_PAUSE_MS;
      const elapsed = (
        ((now - lightStartedAt) % cycleDuration) + cycleDuration
      ) % cycleDuration;
      const elevation = elevationBaseColor(revision.point);
      const paletteColor = elevation.palette === "red"
        ? RED_BASE_COLOR
        : TEAL_BASE_COLOR;
      const lightColor = mixColor(
        paletteColor,
        0xFFFFFF,
        LIGHTEN_AMOUNT
      );

      let progress = 1;
      let fade = 1;
      let spreading = false;

      if (elapsed < LIGHT_SPREAD_MS) {
        progress = elapsed / LIGHT_SPREAD_MS;
        spreading = true;
      } else if (elapsed < LIGHT_SPREAD_MS + FULLY_LIT_HOLD_MS) {
        progress = 1;
      } else if (
        elapsed < LIGHT_SPREAD_MS + FULLY_LIT_HOLD_MS + FULL_FADE_MS
      ) {
        progress = 1;
        fade = 1 - (
          elapsed - LIGHT_SPREAD_MS - FULLY_LIT_HOLD_MS
        ) / FULL_FADE_MS;
      } else {
        return;
      }

      lightLines.alpha = fade;

      // Only lines illuminate: the static face fills never change brightness.
      // The top outline lights first and remains lit while illumination travels
      // down the four height edges.
      outline(
        lightLines,
        presentation.top,
        lightColor,
        LIGHT_ALPHA_MAX,
        LIGHT_OUTLINE_WIDTH
      );

      const front = presentation.top.map((corner, index) =>
        lerpPoint(corner, presentation.bottom[index], progress)
      );

      for (let index = 0; index < 4; index++) {
        visibleClassifiedLine(
          lightLines,
          presentation.top[index],
          front[index],
          presentation.top,
          lightColor,
          LIGHT_ALPHA_MAX,
          LIGHT_OUTLINE_WIDTH
        );
      }

      // The exact bottom footprint illuminates last, then remains lit for the
      // full hold and unified fade stages.
      const bottomStrength = spreading
        ? clamp01((progress - 0.82) / 0.18)
        : 1;
      if (bottomStrength > 0) {
        for (let index = 0; index < 4; index++) {
          visibleClassifiedLine(
            lightLines,
            presentation.bottom[index],
            presentation.bottom[(index + 1) % 4],
            presentation.top,
            lightColor,
            LIGHT_ALPHA_MAX * bottomStrength,
            LIGHT_OUTLINE_WIDTH
          );
        }
      }
    }

    function drawBottomCenterMarker(center) {
      markerDrawing.clear();
      markerDrawing.lineStyle(3, 0x000000, 0.90);
      markerDrawing.beginFill(0xFFFFFF, 0.90);
      markerDrawing.drawCircle(center.x, center.y, 5);
      markerDrawing.endFill();
    }

    function render(redrawShape = true) {
      const current = revision;
      if (!current) return;

      const center = toPixel(current.point);
      const presentation = prismPresentation(current.point, current.yaw);
      const allCorners = [
        ...presentation.bottom,
        ...presentation.top
      ];
      const minimumY = Math.min(...allCorners.map(point => point.y));
      const maximumY = Math.max(...allCorners.map(point => point.y));

      if (redrawShape) {
        drawing.clear();

        if (!sourceBound) {
          const boundary = freeLineRangeBoundary(
            sourceVolume,
            RANGE,
            current.point.z
          ).map(toPixel);

          if (options.range?.showBoundary !== false && boundary.length) {
            drawing.lineStyle(1.5, RANGE_RING_COLOR, RANGE_RING_ALPHA);
            drawing.drawPolygon(boundary.flatMap(point => [point.x, point.y]));
          }
        }

        drawPrism(current.point, current.yaw);
        if (!sourceBound) {
          drawSourceTracer(
            toPixel({
              x: (sourceVolume.minX + sourceVolume.maxX) / 2,
              y: (sourceVolume.minY + sourceVolume.maxY) / 2,
              z: sourceVolume.bottom
            }),
            center
          );
        }
        drawBottomCenterMarker(center);
      }

      textRoot.position.set(center.x, center.y);
      modeText.text = mode;
      dimensions.text =
        `${format(LENGTH)} × ${format(WIDTH)} × ${format(HEIGHT)} ${unit}`;

      const badgeWidth = modeText.width + 18;
      badge
        .clear()
        .beginFill(0x202020, 0.92)
        .drawRoundedRect(0, -14, badgeWidth, 28, 4)
        .endFill();
      modeText.position.set(9, 0);
      dimensions.position.set(badgeWidth + 14, 0);
      header.pivot.x = (badgeWidth + 14 + dimensions.width) / 2;
      header.position.set(0, minimumY - center.y - 20);

      centerElevation.text = `${format(current.point.z)} ${unit}`;
      centerElevation.position.set(18, 0);

      let cursor = 0;
      for (const label of instructions.children) {
        label.position.set(cursor, 0);
        cursor += label.width;
      }
      instructions.pivot.x = cursor / 2;
      const instructionY = maximumY - center.y + 20;
      instructions.position.set(0, instructionY);
      if (targetPreviewNotice) targetPreviewNotice.position.set(0, instructionY + 22);
      labelsDirty = false;
    }


  return {
    update(next, nextMode) {
      revision = next;
      mode = nextMode;
      render(true);
    },
    frame(now) {
updateCubeIllumination(now);
      if (updateTextResolution(labels)) render(false);
    },
    clear() { root?.parent?.removeChild(root); root?.destroy({ children: true }); }
  };
}
