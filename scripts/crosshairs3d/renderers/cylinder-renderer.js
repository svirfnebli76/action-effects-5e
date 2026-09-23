import { freeLineEndpoints, freeLineRangeBoundary } from "../free-line-placement.js";
import { clamp01, controlHints, updateTextResolution, TARGET_PREVIEW_NOTICE_TEXT, TARGET_PREVIEW_NOTICE_COLOR, targetPreviewNoticeEnabled } from "./shared.js";

// Rendering and text layout preserved from AE5E-Cylinder-No-Sequencer-Test-01.txt.
export function createRenderer(context) {
  const { shape, sourceVolume, metrics, metricsService, geometry, options, capabilities, propagationMode, parent } = context;
  const api = { geometry };
  const scene = globalThis.canvas.scene;
  const scale = metrics.size / metrics.distance;
  const unit = String(scene.grid.units || "ft");
  const RANGE = Number(options.range?.max ?? options.maxRange ?? 60);
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

  // VISUAL-ONLY OBLIQUE HEIGHT. Targeting always uses the true cylinder.
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
  const CIRCLE_SAMPLES = 96;
  const VISIBLE_VERTICAL_LINE_COUNT = 5;
  const HIDDEN_VERTICAL_LINE_COUNT = 3;

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
    root.name = "ae5e-pixi-cylinder-test";

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

    const lerpPoint = (from, to, amount) => ({
      x: from.x + (to.x - from.x) * amount,
      y: from.y + (to.y - from.y) * amount
    });

    const circlePoint = (center, radius, angle) => ({
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius
    });

    function sampleCircle(center, radius, count = CIRCLE_SAMPLES) {
      return Array.from({ length: count }, (_, index) =>
        circlePoint(center, radius, Math.PI * 2 * index / count)
      );
    }

    function sampleArc(center, radius, start, end, count = 48) {
      return Array.from({ length: count + 1 }, (_, index) =>
        circlePoint(center, radius, start + (end - start) * index / count)
      );
    }

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

    function dashedPolyline(graphics, points, color, alpha, width) {
      if (points.length < 2) return;
      let drawingDash = true;
      let remaining = HIDDEN_EDGE_DASH_LENGTH;

      for (let index = 0; index < points.length - 1; index++) {
        const from = points[index];
        const to = points[index + 1];
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const length = Math.hypot(dx, dy);
        if (length < 1e-7) continue;
        const ux = dx / length;
        const uy = dy / length;
        let distance = 0;

        while (distance < length - 1e-7) {
          const amount = Math.min(remaining, length - distance);
          if (drawingDash) {
            line(
              graphics,
              {
                x: from.x + ux * distance,
                y: from.y + uy * distance
              },
              {
                x: from.x + ux * (distance + amount),
                y: from.y + uy * (distance + amount)
              },
              color,
              alpha * HIDDEN_EDGE_ALPHA,
              width
            );
          }
          distance += amount;
          remaining -= amount;
          if (remaining <= 1e-7) {
            drawingDash = !drawingDash;
            remaining = drawingDash
              ? HIDDEN_EDGE_DASH_LENGTH
              : HIDDEN_EDGE_GAP_LENGTH;
          }
        }
      }
    }

    function classifiedSegments(from, to, coverCenter, coverRadius) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const fx = from.x - coverCenter.x;
      const fy = from.y - coverCenter.y;
      const a = dx * dx + dy * dy;
      const b = 2 * (fx * dx + fy * dy);
      const c = fx * fx + fy * fy - coverRadius * coverRadius;
      const parameters = [0, 1];
      const discriminant = b * b - 4 * a * c;

      if (a > 1e-12 && discriminant >= 0) {
        const root = Math.sqrt(discriminant);
        for (const value of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
          if (value > 1e-6 && value < 1 - 1e-6) parameters.push(value);
        }
      }

      parameters.sort((left, right) => left - right);
      const unique = parameters.filter((value, index) =>
        index === 0 || Math.abs(value - parameters[index - 1]) > 1e-6
      );

      return unique.slice(0, -1).map((start, index) => {
        const end = unique[index + 1];
        const midpoint = lerpPoint(from, to, (start + end) / 2);
        return {
          from: lerpPoint(from, to, start),
          to: lerpPoint(from, to, end),
          hidden: Math.hypot(
            midpoint.x - coverCenter.x,
            midpoint.y - coverCenter.y
          ) < coverRadius - 0.25
        };
      });
    }

    function classifiedLine(
      graphics,
      from,
      to,
      coverCenter,
      coverRadius,
      color,
      alpha,
      width
    ) {
      for (const part of classifiedSegments(
        from,
        to,
        coverCenter,
        coverRadius
      )) {
        if (part.hidden) {
          dashedLine(graphics, part.from, part.to, color, alpha, width);
        } else {
          line(graphics, part.from, part.to, color, alpha, width);
        }
      }
    }

    function visibleClassifiedLine(
      graphics,
      from,
      to,
      coverCenter,
      coverRadius,
      color,
      alpha,
      width
    ) {
      for (const part of classifiedSegments(
        from,
        to,
        coverCenter,
        coverRadius
      )) {
        if (!part.hidden) {
          line(graphics, part.from, part.to, color, alpha, width);
        }
      }
    }

    function classifiedCircle(
      graphics,
      points,
      coverCenter,
      coverRadius,
      color,
      alpha,
      width,
      visibleOnly = false
    ) {
      let hiddenRun = [];
      const flushHidden = () => {
        if (hiddenRun.length > 1 && !visibleOnly) {
          dashedPolyline(
            graphics,
            hiddenRun,
            color,
            alpha,
            width
          );
        }
        hiddenRun = [];
      };

      for (let index = 0; index < points.length; index++) {
        const from = points[index];
        const to = points[(index + 1) % points.length];
        const midpoint = lerpPoint(from, to, 0.5);
        const hidden = Math.hypot(
          midpoint.x - coverCenter.x,
          midpoint.y - coverCenter.y
        ) < coverRadius - 0.25;
        if (hidden) {
          if (!hiddenRun.length) hiddenRun.push(from);
          hiddenRun.push(to);
        } else {
          flushHidden();
          line(graphics, from, to, color, alpha, width);
        }
      }
      flushHidden();
    }

    function cylinderPresentation(point) {
      const bottomCenter = toPixel(point);
      const radiusPixels = RADIUS * scale;
      const depthDistance = Math.min(
        HEIGHT * VISUAL_DEPTH_SCALE,
        DIAMETER * VISUAL_DEPTH_CAP
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
      const topCenter = {
        x: bottomCenter.x + offset.x,
        y: bottomCenter.y + offset.y
      };
      const bottom = sampleCircle(bottomCenter, radiusPixels);
      const top = sampleCircle(topCenter, radiusPixels);
      const frontAngle = Math.atan2(-offset.y, -offset.x);
      const side = [
        ...sampleArc(
          topCenter,
          radiusPixels,
          frontAngle - Math.PI / 2,
          frontAngle + Math.PI / 2
        ),
        ...sampleArc(
          bottomCenter,
          radiusPixels,
          frontAngle + Math.PI / 2,
          frontAngle - Math.PI / 2
        )
      ];
      const visibleVerticals = Array.from(
        { length: VISIBLE_VERTICAL_LINE_COUNT },
        (_, index) => {
          const ratio = VISIBLE_VERTICAL_LINE_COUNT === 1
            ? 0.5
            : index / (VISIBLE_VERTICAL_LINE_COUNT - 1);
          const angle = frontAngle - Math.PI / 2 + Math.PI * ratio;
          return {
            top: circlePoint(topCenter, radiusPixels, angle),
            bottom: circlePoint(bottomCenter, radiusPixels, angle)
          };
        }
      );
      const hiddenVerticals = Array.from(
        { length: HIDDEN_VERTICAL_LINE_COUNT },
        (_, index) => {
          const ratio = (index + 1) / (HIDDEN_VERTICAL_LINE_COUNT + 1);
          const angle = frontAngle + Math.PI / 2 + Math.PI * ratio;
          return {
            top: circlePoint(topCenter, radiusPixels, angle),
            bottom: circlePoint(bottomCenter, radiusPixels, angle)
          };
        }
      );

      return {
        bottomCenter,
        topCenter,
        radiusPixels,
        bottom,
        top,
        side,
        visibleVerticals,
        hiddenVerticals,
        offset
      };
    }

    function drawCylinder(point) {
      const presentation = cylinderPresentation(point);
      const elevation = elevationBaseColor(point);
      const baseColor = elevation.color;
      const edgeColor = elevation.palette === "red"
        ? RED_BASE_COLOR
        : TEAL_BASE_COLOR;
      const topColor = mixColor(baseColor, 0xFFFFFF, TOP_FACE_HIGHLIGHT);
      const sideColor = mixColor(
        baseColor,
        0x000000,
        (SIDE_FACE_SHADOW_LIGHT + SIDE_FACE_SHADOW_DARK) / 2
      );

      polygon(drawing, presentation.bottom, baseColor, BOTTOM_FACE_FILL_ALPHA);
      polygon(drawing, presentation.side, sideColor, SIDE_FACE_FILL_ALPHA);
      polygon(drawing, presentation.top, topColor, TOP_FACE_FILL_ALPHA);

      // Static structure: hidden segments remain dashed and never glow.
      outline(
        drawing,
        presentation.top,
        0x000000,
        0.40,
        STRUCTURE_UNDERLAY_WIDTH
      );
      for (const vertical of [
        ...presentation.visibleVerticals,
        ...presentation.hiddenVerticals
      ]) {
        classifiedLine(
          drawing,
          vertical.top,
          vertical.bottom,
          presentation.topCenter,
          presentation.radiusPixels,
          0x000000,
          0.40,
          STRUCTURE_UNDERLAY_WIDTH
        );
      }
      classifiedCircle(
        drawing,
        presentation.bottom,
        presentation.topCenter,
        presentation.radiusPixels,
        0x000000,
        0.40,
        STRUCTURE_UNDERLAY_WIDTH
      );

      outline(
        drawing,
        presentation.top,
        edgeColor,
        0.92,
        STRUCTURE_EDGE_WIDTH
      );
      for (const vertical of [
        ...presentation.visibleVerticals,
        ...presentation.hiddenVerticals
      ]) {
        classifiedLine(
          drawing,
          vertical.top,
          vertical.bottom,
          presentation.topCenter,
          presentation.radiusPixels,
          edgeColor,
          0.76,
          STRUCTURE_EDGE_WIDTH
        );
      }
      classifiedCircle(
        drawing,
        presentation.bottom,
        presentation.topCenter,
        presentation.radiusPixels,
        edgeColor,
        0.92,
        STRUCTURE_EDGE_WIDTH
      );

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

    function updateCylinderIllumination(now) {
      lightLines.clear();
      if (!revision) return;

      const presentation = cylinderPresentation(revision.point);
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
      // The top rim lights first and remains lit while illumination travels
      // down the exposed vertical surface guides.
      outline(
        lightLines,
        presentation.top,
        lightColor,
        LIGHT_ALPHA_MAX,
        LIGHT_OUTLINE_WIDTH
      );

      for (const vertical of [
        ...presentation.visibleVerticals,
        ...presentation.hiddenVerticals
      ]) {
        const front = lerpPoint(vertical.top, vertical.bottom, progress);
        visibleClassifiedLine(
          lightLines,
          vertical.top,
          front,
          presentation.topCenter,
          presentation.radiusPixels,
          lightColor,
          LIGHT_ALPHA_MAX,
          LIGHT_OUTLINE_WIDTH
        );
      }

      // Only the exposed part of the exact bottom footprint illuminates last.
      // Its hidden dashed arc never receives the glow.
      const bottomStrength = spreading
        ? clamp01((progress - 0.82) / 0.18)
        : 1;
      if (bottomStrength > 0) {
        classifiedCircle(
          lightLines,
          presentation.bottom,
          presentation.topCenter,
          presentation.radiusPixels,
          lightColor,
          LIGHT_ALPHA_MAX * bottomStrength,
          LIGHT_OUTLINE_WIDTH,
          true
        );
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
      const presentation = cylinderPresentation(current.point);
      const allCorners = [
        ...presentation.bottom,
        ...presentation.top
      ];
      const minimumY = Math.min(...allCorners.map(point => point.y));
      const maximumY = Math.max(...allCorners.map(point => point.y));

      if (redrawShape) {
        drawing.clear();

        const boundary = freeLineRangeBoundary(
          sourceVolume,
          RANGE,
          current.point.z
        ).map(toPixel);

        if (options.range?.showBoundary !== false && boundary.length) {
          drawing.lineStyle(1.5, RANGE_RING_COLOR, RANGE_RING_ALPHA);
          drawing.drawPolygon(boundary.flatMap(point => [point.x, point.y]));
        }

        drawCylinder(current.point);
        drawSourceTracer(
          toPixel({
            x: (sourceVolume.minX + sourceVolume.maxX) / 2,
            y: (sourceVolume.minY + sourceVolume.maxY) / 2,
            z: sourceVolume.bottom
          }),
          center
        );
        drawBottomCenterMarker(center);
      }

      textRoot.position.set(center.x, center.y);
      modeText.text = mode;
      dimensions.text =
        `Diameter ${format(DIAMETER)} ${unit} · Height ${format(HEIGHT)} ${unit}`;

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
updateCylinderIllumination(now);
      if (updateTextResolution(labels)) render(false);
    },
    clear() { root?.parent?.removeChild(root); root?.destroy({ children: true }); }
  };
}
