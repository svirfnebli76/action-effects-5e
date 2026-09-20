import { freeLineEndpoints, freeLineRangeBoundary } from "../free-line-placement.js";
import { clamp01, controlHints, updateTextResolution } from "./shared.js";

// Rendering and text layout preserved from AE5E-Cone-No-Sequencer-Test-07.txt.
export function createRenderer(context) {
  const { shape, sourceVolume, metrics, metricsService, geometry, options, capabilities, parent } = context;
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

  // Shape shading is independent of elevation color.
  const BODY_FILL_ALPHA = 0.28;
  const TERMINAL_FILL_ALPHA = 0.20;
  const CONTOUR_FILL_ALPHA = 0.045;
  const CURVATURE_SHADOW = 0.20;
  const CURVATURE_HIGHLIGHT = 0.16;
  const STRUCTURE_UNDERLAY_WIDTH = 4.5;
  const STRUCTURE_EDGE_WIDTH = 2.25;
  const SURFACE_GRID_ALPHA = 0.40;
  const SURFACE_GRID_WIDTH = 1.4;
  const CONTOUR_FRACTIONS = [0.20, 0.40, 0.60, 0.80];
  const GENERATOR_COUNT = 8;
  const RING_SAMPLES = 64;

  // TEXT LAYOUT. Labels follow the projected sides at low pitch, then migrate
  // continuously to terminal-center-derived anchors as the sides collapse.
  const TEXT_SIDE_ALONG = 0.55;
  const TEXT_SIDE_GAP = 22;
  const TEXT_TERMINAL_GAP = 22;
  // Interpolating between two individually safe anchors can briefly carry a
  // label across the projected cone. Start the outward clearance before the
  // positional blend, hold it through the circular transition, then fade it.
  const TEXT_TRANSITION_CLEARANCE = 28;
  const TEXT_CLEARANCE_START_DEGREES = 35;
  const TEXT_CLEARANCE_FULL_DEGREES = 52;
  const TEXT_CLEARANCE_FADE_DEGREES = 60;
  const TEXT_CLEARANCE_END_DEGREES = 75;
  const TEXT_BLEND_START_DEGREES = 50;
  const TEXT_BLEND_END_DEGREES = 70;

  // Light spreads from the legal apex to the terminal face, holds, then fades.
  const LIGHT_SPREAD_MS = 2200;
  const FULLY_LIT_HOLD_MS = 650;
  const FULL_FADE_MS = 500;
  const RESTART_PAUSE_MS = 150;
  const LIGHTEN_AMOUNT = 0.60;
  const LIGHT_ALPHA_MAX = 0.60;
  const LIGHT_LINE_WIDTH = 3.5;
  const ZOOM_SETTLE_MS = 200;



  const normalizeDegrees = value => ((Number(value) % 360) + 360) % 360;
  const format = value => String(Math.round(Number(value) * 10) / 10);
  const sameIds = (a, b) =>
    [...a].sort().join("|") === [...b].sort().join("|");

  function mixColor(from, to, amount) {
    const t = clamp01(amount);
    const channel = shift => Math.round(
      ((from >> shift) & 0xFF) +
      ((((to >> shift) & 0xFF) - ((from >> shift) & 0xFF)) * t)
    );
    return (channel(16) << 16) | (channel(8) << 8) | channel(0);
  }

    function elevationBaseColor(current) {
      const delta = current.terminal.z - current.point.z;
      const rawRatio = clamp01(Math.abs(delta) / Math.max(LENGTH, 1e-7));
      const ratio = Math.round(rawRatio * GRADIENT_BANDS) / GRADIENT_BANDS;

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
    root.name = "ae5e-pixi-cone-test";

    const drawing = new PIXI.Graphics();
    const lightLines = new PIXI.Graphics();
    const markerDrawing = new PIXI.Graphics();
    const textRoot = new PIXI.Container();
    root.addChild(drawing, lightLines, markerDrawing, textRoot);
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
    const modeText = makeText("AIM", true);
    const dimensions = makeText("", true);
    header.addChild(badge, modeText, dimensions);

    const endpointElevation = makeText("", true);
    const instructions = new PIXI.Container();
    for (const [value, bold] of controlHints(capabilities)) { instructions.addChild(makeText(value, bold)); }
    textRoot.addChild(header, endpointElevation, instructions);
    let lastResolution = 2;

    const line = (graphics, from, to, color, alpha, width) => {
      graphics.lineStyle(width, color, alpha);
      graphics.moveTo(from.x, from.y);
      graphics.lineTo(to.x, to.y);
    };

    const polygon = (
      graphics,
      points,
      fillColor,
      fillAlpha,
      lineColor = fillColor,
      lineAlpha = 0,
      lineWidth = 0
    ) => {
      if (!points.length) return;
      graphics.lineStyle(lineWidth, lineColor, lineAlpha);
      if (fillAlpha > 0) graphics.beginFill(fillColor, fillAlpha);
      graphics.drawPolygon(points.flatMap(point => [point.x, point.y]));
      if (fillAlpha > 0) graphics.endFill();
    };

    function convexHull(points) {
      const unique = [...new Map(points.map(point => [
        `${point.x.toFixed(5)},${point.y.toFixed(5)}`,
        point
      ])).values()].sort((a, b) => a.x - b.x || a.y - b.y);
      if (unique.length <= 2) return unique;
      const cross = (origin, a, b) =>
        (a.x - origin.x) * (b.y - origin.y) -
        (a.y - origin.y) * (b.x - origin.x);
      const lower = [];
      for (const point of unique) {
        while (
          lower.length >= 2 &&
          cross(lower.at(-2), lower.at(-1), point) <= 0
        ) lower.pop();
        lower.push(point);
      }
      const upper = [];
      for (const point of [...unique].reverse()) {
        while (
          upper.length >= 2 &&
          cross(upper.at(-2), upper.at(-1), point) <= 0
        ) upper.pop();
        upper.push(point);
      }
      lower.pop();
      upper.pop();
      return [...lower, ...upper];
    }

    function presentation(current) {
      const shape = api.geometry.normalizeShape({
        type: "cone",
        origin: current.point,
        length: LENGTH,
        yaw: current.yaw,
        pitch: current.pitch
      });
      const direction = api.geometry.direction(shape);
      const basis = api.geometry.lineBasis(shape);
      const apex = toPixel(shape.origin);

      const projectedRing = (fraction, samples = RING_SAMPLES) => {
        const center3d = {
          x: shape.origin.x + direction.x * LENGTH * fraction,
          y: shape.origin.y + direction.y * LENGTH * fraction,
          z: shape.origin.z + direction.z * LENGTH * fraction
        };
        const radius = LENGTH * fraction / 2;
        const points = [];
        for (let index = 0; index < samples; index++) {
          const angle = index / samples * Math.PI * 2;
          const cosine = Math.cos(angle);
          const sine = Math.sin(angle);
          points.push(toPixel({
            x: center3d.x + radius * (
              basis.widthAxis.x * cosine + basis.heightAxis.x * sine
            ),
            y: center3d.y + radius * (
              basis.widthAxis.y * cosine + basis.heightAxis.y * sine
            ),
            z: center3d.z + radius * (
              basis.widthAxis.z * cosine + basis.heightAxis.z * sine
            )
          }));
        }
        return { center3d, center: toPixel(center3d), points };
      };

      const terminal = projectedRing(1);
      const silhouette = convexHull([apex, ...terminal.points]);
      const contours = CONTOUR_FRACTIONS.map(fraction => ({
        fraction,
        ...projectedRing(fraction, 48)
      }));
      const generators = Array.from({ length: GENERATOR_COUNT }, (_, index) => {
        const terminalIndex = Math.round(index * RING_SAMPLES / GENERATOR_COUNT) %
          RING_SAMPLES;
        return { index: terminalIndex, end: terminal.points[terminalIndex] };
      });
      return { shape, apex, terminal, silhouette, contours, generators };
    }

    const lerpPoint = (from, to, amount) => ({
      x: from.x + (to.x - from.x) * amount,
      y: from.y + (to.y - from.y) * amount
    });

    function normalizeVector(vector, fallback = { x: 1, y: 0 }) {
      const length = Math.hypot(vector.x, vector.y);
      if (length < 1e-7) return { ...fallback };
      return { x: vector.x / length, y: vector.y / length };
    }

    function uprightAngle(vector) {
      let angle = Math.atan2(vector.y, vector.x);
      if (angle > Math.PI / 2) angle -= Math.PI;
      if (angle < -Math.PI / 2) angle += Math.PI;
      return angle;
    }

    function mixAngle(from, to, amount) {
      let delta = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
      if (delta < -Math.PI) delta += Math.PI * 2;
      return from + delta * amount;
    }

    function smoothstep(edge0, edge1, value) {
      const amount = clamp01((value - edge0) / (edge1 - edge0));
      return amount * amount * (3 - 2 * amount);
    }

    function textLayout(geometry, current) {
      const projectedAxis = {
        x: geometry.terminal.center.x - geometry.apex.x,
        y: geometry.terminal.center.y - geometry.apex.y
      };
      const yawRadians = current.yaw * Math.PI / 180;
      const axis = normalizeVector(projectedAxis, {
        x: Math.cos(yawRadians),
        y: Math.sin(yawRadians)
      });
      const perpendicular = { x: -axis.y, y: axis.x };

      // Keep the header on the visually upper side. When the cone points
      // exactly vertically on screen, prefer the left side deterministically.
      const invert = perpendicular.y > 1e-7 ||
        (Math.abs(perpendicular.y) <= 1e-7 && perpendicular.x > 0);
      const headerNormal = invert
        ? { x: -perpendicular.x, y: -perpendicular.y }
        : perpendicular;
      const instructionNormal = {
        x: -headerNormal.x,
        y: -headerNormal.y
      };

      const extreme = (normal, maximum = true) =>
        geometry.terminal.points.reduce((best, point) => {
          const score =
            (point.x - geometry.terminal.center.x) * normal.x +
            (point.y - geometry.terminal.center.y) * normal.y;
          if (!best || (maximum ? score > best.score : score < best.score)) {
            return { point, score };
          }
          return best;
        }, null).point;

      const headerEdge = extreme(headerNormal);
      const instructionEdge = extreme(instructionNormal);
      const headerSideDirection = normalizeVector({
        x: headerEdge.x - geometry.apex.x,
        y: headerEdge.y - geometry.apex.y
      }, axis);
      const instructionSideDirection = normalizeVector({
        x: instructionEdge.x - geometry.apex.x,
        y: instructionEdge.y - geometry.apex.y
      }, axis);

      const sideHeader = lerpPoint(
        geometry.apex,
        headerEdge,
        TEXT_SIDE_ALONG
      );
      sideHeader.x += headerNormal.x * TEXT_SIDE_GAP;
      sideHeader.y += headerNormal.y * TEXT_SIDE_GAP;

      const sideInstructions = lerpPoint(
        geometry.apex,
        instructionEdge,
        TEXT_SIDE_ALONG
      );
      sideInstructions.x += instructionNormal.x * TEXT_SIDE_GAP;
      sideInstructions.y += instructionNormal.y * TEXT_SIDE_GAP;

      const terminalRadius = Math.max(
        0,
        ...geometry.terminal.points.map(point => Math.hypot(
          point.x - geometry.terminal.center.x,
          point.y - geometry.terminal.center.y
        ))
      );
      const terminalOffset = terminalRadius + TEXT_TERMINAL_GAP;
      const terminalHeader = {
        x: geometry.terminal.center.x + headerNormal.x * terminalOffset,
        y: geometry.terminal.center.y + headerNormal.y * terminalOffset
      };
      const terminalInstructions = {
        x: geometry.terminal.center.x + instructionNormal.x * terminalOffset,
        y: geometry.terminal.center.y + instructionNormal.y * terminalOffset
      };

      const blend = smoothstep(
        TEXT_BLEND_START_DEGREES,
        TEXT_BLEND_END_DEGREES,
        Math.abs(current.pitch)
      );
      const axisRotation = uprightAngle(axis);
      const absolutePitch = Math.abs(current.pitch);
      const clearanceRise = smoothstep(
        TEXT_CLEARANCE_START_DEGREES,
        TEXT_CLEARANCE_FULL_DEGREES,
        absolutePitch
      );
      const clearanceFall = 1 - smoothstep(
        TEXT_CLEARANCE_FADE_DEGREES,
        TEXT_CLEARANCE_END_DEGREES,
        absolutePitch
      );
      const transitionClearance =
        TEXT_TRANSITION_CLEARANCE * clearanceRise * clearanceFall;
      const headerPosition = lerpPoint(sideHeader, terminalHeader, blend);
      headerPosition.x += headerNormal.x * transitionClearance;
      headerPosition.y += headerNormal.y * transitionClearance;
      const instructionPosition = lerpPoint(
        sideInstructions,
        terminalInstructions,
        blend
      );
      instructionPosition.x +=
        instructionNormal.x * transitionClearance;
      instructionPosition.y +=
        instructionNormal.y * transitionClearance;

      return {
        headerPosition,
        instructionPosition,
        headerRotation: mixAngle(
          uprightAngle(headerSideDirection),
          axisRotation,
          blend
        ),
        instructionRotation: mixAngle(
          uprightAngle(instructionSideDirection),
          axisRotation,
          blend
        ),
        blend
      };
    }

    function drawCone(current) {
      const geometry = presentation(current);
      const elevation = elevationBaseColor(current);
      const baseColor = elevation.color;
      const edgeColor = elevation.palette === "red"
        ? RED_BASE_COLOR
        : TEAL_BASE_COLOR;
      const shadowColor = mixColor(baseColor, 0x000000, CURVATURE_SHADOW);
      const highlightColor = mixColor(baseColor, 0xFFFFFF, CURVATURE_HIGHLIGHT);

      polygon(
        drawing,
        geometry.silhouette,
        shadowColor,
        BODY_FILL_ALPHA,
        0x000000,
        0.40,
        STRUCTURE_UNDERLAY_WIDTH
      );

      // Broad-to-narrow translucent rings give the projected body depth while
      // preserving elevation color as a separate first-stage calculation.
      for (const contour of [...geometry.contours].reverse()) {
        const curvatureColor = mixColor(
          baseColor,
          highlightColor,
          1 - contour.fraction
        );
        polygon(
          drawing,
          contour.points,
          curvatureColor,
          CONTOUR_FILL_ALPHA
        );
      }

      polygon(
        drawing,
        geometry.silhouette,
        baseColor,
        0,
        edgeColor,
        0.92,
        STRUCTURE_EDGE_WIDTH
      );
      polygon(
        drawing,
        geometry.terminal.points,
        baseColor,
        TERMINAL_FILL_ALPHA,
        edgeColor,
        0.92,
        STRUCTURE_EDGE_WIDTH
      );

      for (const contour of geometry.contours) {
        polygon(
          drawing,
          contour.points,
          baseColor,
          0,
          edgeColor,
          SURFACE_GRID_ALPHA,
          SURFACE_GRID_WIDTH
        );
      }
      for (const generator of geometry.generators) {
        line(
          drawing,
          geometry.apex,
          generator.end,
          edgeColor,
          SURFACE_GRID_ALPHA,
          SURFACE_GRID_WIDTH
        );
      }

      line(
        drawing,
        geometry.apex,
        geometry.terminal.center,
        0x000000,
        0.55,
        4.5
      );
      line(
        drawing,
        geometry.apex,
        geometry.terminal.center,
        edgeColor,
        0.82,
        2.0
      );
      return geometry;
    }

    function drawMarkers(geometry, current) {
      markerDrawing.clear();
      const elevation = elevationBaseColor(current);
      const color = elevation.palette === "red"
        ? RED_BASE_COLOR
        : TEAL_BASE_COLOR;

      markerDrawing.lineStyle(3, 0x000000, 0.95);
      markerDrawing.beginFill(color, 0.90);
      markerDrawing.drawCircle(geometry.apex.x, geometry.apex.y, 5);
      markerDrawing.endFill();
      markerDrawing.beginFill(color, 1);
      markerDrawing.drawCircle(
        geometry.terminal.center.x,
        geometry.terminal.center.y,
        6
      );
      markerDrawing.endFill();
    }

    function updateIllumination(now) {
      lightLines.clear();
      if (!revision) return;

      const geometry = presentation(revision);
      const cycleDuration = LIGHT_SPREAD_MS + FULLY_LIT_HOLD_MS +
        FULL_FADE_MS + RESTART_PAUSE_MS;
      const elapsed = (((now - lightStartedAt) % cycleDuration) +
        cycleDuration) % cycleDuration;
      const elevation = elevationBaseColor(revision);
      const paletteColor = elevation.palette === "red"
        ? RED_BASE_COLOR
        : TEAL_BASE_COLOR;
      const lightColor = mixColor(paletteColor, 0xFFFFFF, LIGHTEN_AMOUNT);

      let progress = 1;
      let fade = 1;
      if (elapsed < LIGHT_SPREAD_MS) {
        progress = elapsed / LIGHT_SPREAD_MS;
      } else if (elapsed < LIGHT_SPREAD_MS + FULLY_LIT_HOLD_MS) {
        progress = 1;
      } else if (
        elapsed < LIGHT_SPREAD_MS + FULLY_LIT_HOLD_MS + FULL_FADE_MS
      ) {
        fade = 1 - (
          elapsed - LIGHT_SPREAD_MS - FULLY_LIT_HOLD_MS
        ) / FULL_FADE_MS;
      } else {
        return;
      }
      lightLines.alpha = fade;

      // Every generator retains its illuminated portion as the light front
      // moves from the apex to the terminal face.
      for (const generator of geometry.generators) {
        line(
          lightLines,
          geometry.apex,
          {
            x: geometry.apex.x +
              (generator.end.x - geometry.apex.x) * progress,
            y: geometry.apex.y +
              (generator.end.y - geometry.apex.y) * progress
          },
          lightColor,
          LIGHT_ALPHA_MAX,
          LIGHT_LINE_WIDTH
        );
      }

      // Each contour becomes fully illuminated only when the spreading front
      // reaches its true fraction along the cone.
      for (const contour of geometry.contours) {
        if (progress + 1e-7 < contour.fraction) continue;
        polygon(
          lightLines,
          contour.points,
          lightColor,
          0,
          lightColor,
          LIGHT_ALPHA_MAX,
          LIGHT_LINE_WIDTH
        );
      }

      if (progress >= 1 - 1e-7) {
        polygon(
          lightLines,
          geometry.terminal.points,
          lightColor,
          0,
          lightColor,
          LIGHT_ALPHA_MAX,
          LIGHT_LINE_WIDTH
        );
        polygon(
          lightLines,
          geometry.silhouette,
          lightColor,
          0,
          lightColor,
          LIGHT_ALPHA_MAX,
          LIGHT_LINE_WIDTH
        );
      }
    }

    function render(redrawShape = true) {
      const current = revision;
      if (!current) return;
      const geometry = presentation(current);
      const layout = textLayout(geometry, current);

      if (redrawShape) {
        drawing.clear();

        const drawn = drawCone(current);
        drawMarkers(drawn, current);
      }

      modeText.text = mode;
      dimensions.text = `Length ${format(LENGTH)} ${unit}`;
      const badgeWidth = modeText.width + 18;
      badge
        .clear()
        .beginFill(0x202020, 0.92)
        .drawRoundedRect(0, -14, badgeWidth, 28, 4)
        .endFill();
      modeText.position.set(9, 0);
      dimensions.position.set(badgeWidth + 14, 0);
      header.pivot.x = (badgeWidth + 14 + dimensions.width) / 2;
      header.position.set(
        layout.headerPosition.x,
        layout.headerPosition.y
      );
      header.rotation = layout.headerRotation;

      endpointElevation.text = `${format(current.terminal.z)} ${unit}`;
      endpointElevation.position.set(
        geometry.terminal.center.x + 16,
        geometry.terminal.center.y
      );

      let cursor = 0;
      for (const label of instructions.children) {
        label.position.set(cursor, 0);
        cursor += label.width;
      }
      instructions.pivot.x = cursor / 2;
      instructions.position.set(
        layout.instructionPosition.x,
        layout.instructionPosition.y
      );
      instructions.rotation = layout.instructionRotation;
      labelsDirty = false;
    }


  return {
    update(next, nextMode) {
      revision = next;
      mode = nextMode;
      render(true);
    },
    frame(now) {
updateIllumination(now);
      if (updateTextResolution(labels)) render(false);
    },
    clear() { root?.parent?.removeChild(root); root?.destroy({ children: true }); }
  };
}
