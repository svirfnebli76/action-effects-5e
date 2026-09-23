import { clamp01, controlHints, updateTextResolution, TARGET_PREVIEW_NOTICE_TEXT, TARGET_PREVIEW_NOTICE_COLOR, targetPreviewNoticeEnabled } from "./shared.js";

// Rendering and text layout preserved from AE5E-Sphere-PIXI-Surface-Illumination-Test-13.txt.
export function createRenderer(context) {
  const { shape, sourceVolume, metrics, metricsService, geometry, options, capabilities, propagationMode, parent } = context;
  const api = { geometry };
  const scene = globalThis.canvas.scene;
  const scale = metrics.size / metrics.distance;
  const unit = String(scene.grid.units || "ft");
  const RANGE = Number(options.range?.max ?? options.maxRange ?? 60);
  const toPixel = point => metricsService.distanceToPixels(point, metrics);
  let root, revision, mode = "MOVE", labelsDirty = false;
  const labels = [];
  const lightStartedAt = performance.now(), waveStartedAt = lightStartedAt, pulseStartedAt = lightStartedAt;
const LENGTH = shape.length, WIDTH = shape.width, HEIGHT = shape.height, RADIUS = shape.radius, DIAMETER = shape.radius * 2;
  const TEAL_BASE_COLOR = 0x388E8E;
  const RED_BASE_COLOR = 0xFF4D4D;
  const TEAL_LIGHTNESS_MIN = 0.00;
  const TEAL_LIGHTNESS_MAX = 0.4;
  const RED_DARKNESS_MIN = 0.00;
  const RED_DARKNESS_MAX = 0.55;

  // Curvature is applied after the elevation color is resolved.
  const CURVATURE_SHADOW = 0.275;
  const CURVATURE_HIGHLIGHT = 0.24;
  const CURVATURE_BANDS = 48;
  const SPHERE_FILL_ALPHA = 0.5;
  const CURVATURE_LAYER_ALPHA = 0.025;

  // Visual light-source position, expressed as a fraction of sphere radius.
  const HIGHLIGHT_OFFSET_X = -0.0;
  const HIGHLIGHT_OFFSET_Y = -0.0;

  // Pole-on sphere surface grid. The outside silhouette acts as the equator.
  const MERIDIAN_DIAMETER_COUNT = 6;
  const LATITUDE_COUNT = 3;
  const SURFACE_GRID_ALPHA = 0.30;
  const SURFACE_GRID_WIDTH = 1;
  const MERIDIAN_FADE_SEGMENTS = 6;
  const MERIDIAN_EDGE_ALPHA = 0.12;

  const RANGE_RING_COLOR = 0x7FEFEF;
  const RANGE_RING_ALPHA = 0.40;
  const TRACER_COLOR = 0x4A4A4A;
  const TRACER_ALPHA = 0.80;
  const TRACER_WIDTH = 3;
  const TRACER_CHEVRON_SIZE = 7;
  const TRACER_CHEVRON_SPACING = 70;
  // Surface illumination accumulates from apex to equator, holds with the
  // complete grid lit, and only then fades as one object.
  const LIGHT_SPREAD_MS = 2200;
  const FULLY_LIT_HOLD_MS = 650;
  const FULL_FADE_MS = 500;
  const RESTART_PAUSE_MS = 150;
  const LIGHT_EDGE_BAND_WIDTH = 0.12;
  const LIGHT_EDGE_SEGMENTS = 4;
  const LIGHTEN_AMOUNT = 0.60;
  const SETTLED_LIGHT_ALPHA = 0.38;
  const LIGHT_ALPHA_MAX = 0.60;
  const LIGHT_OUTLINE_WIDTH = 3.5;
  const LIGHT_GRID_WIDTH = 1.75;
  const ZOOM_SETTLE_MS = 200;



  const format = value => String(Math.round(Number(value) * 10) / 10);

  function nearestSourceCorner(point) {
    let best = null;
    for (const z of [sourceVolume.bottom, sourceVolume.top]) {
      for (const y of [sourceVolume.minY, sourceVolume.maxY]) {
        for (const x of [sourceVolume.minX, sourceVolume.maxX]) {
          const distance = Math.hypot(point.x - x, point.y - y, point.z - z);
          if (!best || distance < best.distance) best = { x, y, z, distance };
        }
      }
    }
    return best;
  }

  function mixColor(from, to, amount) {
    const t = clamp01(amount);
    const channel = (shift, a = from, b = to) => Math.round(
      ((a >> shift) & 0xFF) + ((((b >> shift) & 0xFF) - ((a >> shift) & 0xFF)) * t)
    );
    return (channel(16) << 16) | (channel(8) << 8) | channel(0);
  }

    function elevationBaseColor(point) {
      const delta = point.z - sourceVolume.bottom;
      const ratio = clamp01(Math.abs(delta) / Math.max(RANGE, 1e-7));

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
    root.name = "ae5e-pixi-sphere-test";

    const drawing = new PIXI.Graphics();
    const pulseGrid = new PIXI.Graphics();
    const pulseOutline = new PIXI.Graphics();
    const apexDrawing = new PIXI.Graphics();
    const textRoot = new PIXI.Container();
    root.addChild(
      drawing,
      pulseGrid,
      pulseOutline,
      apexDrawing,
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
    const dimensions = makeText(`Diameter ${format(RADIUS * 2)} ${unit}`, true);
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

    function drawSphere(center, point) {
      const radiusPixels = RADIUS * scale;
      const elevation = elevationBaseColor(point);
      const baseColor = elevation.color;
      const shadowColor = mixColor(baseColor, 0x000000, CURVATURE_SHADOW);
      const highlightColor = mixColor(baseColor, 0xFFFFFF, CURVATURE_HIGHLIGHT);

      // Base silhouette. It always keeps the full configured XY diameter.
      drawing.lineStyle(0);
      drawing.beginFill(shadowColor, SPHERE_FILL_ALPHA);
      drawing.drawCircle(center.x, center.y, radiusPixels);
      drawing.endFill();

      // Retained nested layers create subtle curvature. Elevation changes the
      // base palette first; these layers then add the independent shape cue.
      for (let index = 1; index <= CURVATURE_BANDS; index++) {
        const t = index / CURVATURE_BANDS;
        const radius = radiusPixels * (1 - t * 0.92);
        const x = center.x + radiusPixels * HIGHLIGHT_OFFSET_X * t;
        const y = center.y + radiusPixels * HIGHLIGHT_OFFSET_Y * t;
        const color = mixColor(baseColor, highlightColor, t);
        drawing.beginFill(color, CURVATURE_LAYER_ALPHA);
        drawing.drawCircle(x, y, radius);
        drawing.endFill();
      }

      // Pole-on latitude/longitude grid. Latitude spacing uses spherical
      // projection rather than equal screen-space spacing. Twelve individual
      // meridian spokes fade toward the equator so they do not read as six
      // heavy flat diameters.
      const paletteColor = elevation.palette === "red"
        ? RED_BASE_COLOR
        : TEAL_BASE_COLOR;
      const gridColor = mixColor(paletteColor, 0xFFFFFF, 0.12);
      for (let index = 1; index <= LATITUDE_COUNT; index++) {
        const angle = (index / (LATITUDE_COUNT + 1)) * Math.PI / 2;
        const projectedRadius = radiusPixels * Math.sin(angle);
        drawing.lineStyle(
          SURFACE_GRID_WIDTH,
          gridColor,
          SURFACE_GRID_ALPHA
        );
        drawing.drawCircle(
          center.x,
          center.y,
          projectedRadius
        );
      }

      const boundaryRadius = radiusPixels - 2;
      for (let ray = 0; ray < MERIDIAN_DIAMETER_COUNT * 2; ray++) {
        const angle = (
          ray / (MERIDIAN_DIAMETER_COUNT * 2)
        ) * Math.PI * 2;
        const direction = { x: Math.cos(angle), y: Math.sin(angle) };

        for (let segment = 0; segment < MERIDIAN_FADE_SEGMENTS; segment++) {
          const fromT = segment / MERIDIAN_FADE_SEGMENTS;
          const toT = (segment + 1) / MERIDIAN_FADE_SEGMENTS;
          const alpha = SURFACE_GRID_ALPHA +
            (MERIDIAN_EDGE_ALPHA - SURFACE_GRID_ALPHA) * toT;
          drawing.lineStyle(SURFACE_GRID_WIDTH, gridColor, alpha);
          drawing.moveTo(
            center.x + direction.x * boundaryRadius * fromT,
            center.y + direction.y * boundaryRadius * fromT
          );
          drawing.lineTo(
            center.x + direction.x * boundaryRadius * toT,
            center.y + direction.y * boundaryRadius * toT
          );
        }
      }

      drawing.lineStyle(4.5, 0x000000, 0.40);
      drawing.drawCircle(center.x, center.y, radiusPixels);
      drawing.lineStyle(2.25,
        elevation.palette === "red" ? RED_BASE_COLOR : TEAL_BASE_COLOR,
        0.92
      );
      drawing.drawCircle(center.x, center.y, radiusPixels);

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

    function updateSurfaceIllumination(now) {
      pulseGrid.clear();
      pulseOutline.clear();
      if (!revision) return;

      const center = toPixel(revision.point);
      const radiusPixels = RADIUS * scale;
      const boundaryRadius = radiusPixels - 2;
      const edgeBandPixels = Math.max(
        1,
        radiusPixels * LIGHT_EDGE_BAND_WIDTH
      );
      const cycleDuration = LIGHT_SPREAD_MS + FULLY_LIT_HOLD_MS +
        FULL_FADE_MS + RESTART_PAUSE_MS;
      const elapsed = (
        ((now - waveStartedAt) % cycleDuration) + cycleDuration
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

      let surfaceProgress = 1;
      let fade = 1;
      let spreading = false;

      if (elapsed < LIGHT_SPREAD_MS) {
        surfaceProgress = elapsed / LIGHT_SPREAD_MS;
        spreading = true;
      } else if (elapsed < LIGHT_SPREAD_MS + FULLY_LIT_HOLD_MS) {
        surfaceProgress = 1;
      } else if (
        elapsed < LIGHT_SPREAD_MS + FULLY_LIT_HOLD_MS + FULL_FADE_MS
      ) {
        surfaceProgress = 1;
        fade = 1 - (
          elapsed - LIGHT_SPREAD_MS - FULLY_LIT_HOLD_MS
        ) / FULL_FADE_MS;
      } else {
        return;
      }

      // Constant travel over a spherical surface projects as sin(theta) on
      // the canvas: rapid near the apex and progressively slower at the rim.
      const frontRadius = radiusPixels * Math.sin(
        surfaceProgress * Math.PI / 2
      );
      const settledEnd = spreading
        ? Math.max(0, frontRadius - edgeBandPixels)
        : frontRadius;
      const settledAlpha = (
        spreading ? SETTLED_LIGHT_ALPHA : LIGHT_ALPHA_MAX
      ) * fade;

      // Every point behind the advancing edge remains illuminated. Each
      // meridian is an independent spoke from the apex toward the equator.
      for (let ray = 0; ray < MERIDIAN_DIAMETER_COUNT * 2; ray++) {
        const angle = (
          ray / (MERIDIAN_DIAMETER_COUNT * 2)
        ) * Math.PI * 2;
        const direction = { x: Math.cos(angle), y: Math.sin(angle) };

        if (settledEnd > 0) {
          pulseGrid.lineStyle(
            LIGHT_GRID_WIDTH,
            lightColor,
            settledAlpha
          );
          pulseGrid.moveTo(
            center.x,
            center.y
          );
          pulseGrid.lineTo(
            center.x + direction.x * Math.min(settledEnd, boundaryRadius),
            center.y + direction.y * Math.min(settledEnd, boundaryRadius)
          );
        }

        if (spreading && frontRadius > settledEnd) {
          for (let segment = 0; segment < LIGHT_EDGE_SEGMENTS; segment++) {
            const fromT = segment / LIGHT_EDGE_SEGMENTS;
            const toT = (segment + 1) / LIGHT_EDGE_SEGMENTS;
            const fromRadius = settledEnd +
              (frontRadius - settledEnd) * fromT;
            const toRadius = settledEnd +
              (frontRadius - settledEnd) * toT;
            const edgeAlpha = (
              SETTLED_LIGHT_ALPHA +
              (LIGHT_ALPHA_MAX - SETTLED_LIGHT_ALPHA) * toT
            ) * fade;

            pulseGrid.lineStyle(
              LIGHT_GRID_WIDTH,
              lightColor,
              edgeAlpha
            );
            pulseGrid.moveTo(
              center.x + direction.x * Math.min(fromRadius, boundaryRadius),
              center.y + direction.y * Math.min(fromRadius, boundaryRadius)
            );
            pulseGrid.lineTo(
              center.x + direction.x * Math.min(toRadius, boundaryRadius),
              center.y + direction.y * Math.min(toRadius, boundaryRadius)
            );
          }
        }
      }

      // Reached latitude rings stay lit. The newest ring receives an extra
      // edge bloom while the light front passes over it.
      for (let index = 1; index <= LATITUDE_COUNT; index++) {
        const angle = (index / (LATITUDE_COUNT + 1)) * Math.PI / 2;
        const latitudeRadius = radiusPixels * Math.sin(angle);
        if (frontRadius + 1e-7 < latitudeRadius) continue;
        const edgeStrength = spreading
          ? clamp01(
            1 - Math.abs(frontRadius - latitudeRadius) / edgeBandPixels
          )
          : 1;
        const alpha = Math.min(
          LIGHT_ALPHA_MAX,
          (spreading
            ? SETTLED_LIGHT_ALPHA +
              (LIGHT_ALPHA_MAX - SETTLED_LIGHT_ALPHA) * edgeStrength
            : LIGHT_ALPHA_MAX) * fade
        );

        pulseGrid.lineStyle(
          LIGHT_GRID_WIDTH,
          lightColor,
          alpha
        );
        pulseGrid.drawCircle(center.x, center.y, latitudeRadius);
      }

      // The apex remains illuminated for the complete spread/hold/fade cycle.
      pulseOutline.lineStyle(
        LIGHT_OUTLINE_WIDTH,
        lightColor,
        LIGHT_ALPHA_MAX * fade
      );
      pulseOutline.drawCircle(center.x, center.y, 7);

      const edgeStrength = spreading
        ? clamp01(
          1 - Math.abs(frontRadius - radiusPixels) / edgeBandPixels
        )
        : 1;
      if (edgeStrength > 0) {
        pulseOutline.lineStyle(
          LIGHT_OUTLINE_WIDTH,
          lightColor,
          LIGHT_ALPHA_MAX * edgeStrength * fade
        );
        pulseOutline.drawCircle(center.x, center.y, radiusPixels);
      }
    }

    function drawApex(center) {
      // The geometric top/apex is directly above the center in 3D and thus
      // projects to this exact point in the top-down canvas view.
      apexDrawing.clear();
      apexDrawing.lineStyle(3, 0x000000, 0.90);
      apexDrawing.beginFill(0xFFFFFF, 0.90);
      apexDrawing.drawCircle(center.x, center.y, 5);
      apexDrawing.endFill();
    }

    function render(redrawShape = true) {
      const current = revision;
      if (!current) return;

      const center = toPixel(current.point);
      const radiusPixels = RADIUS * scale;

      if (redrawShape) {
        drawing.clear();

        const sourceCorner = nearestSourceCorner(current.point);
        const verticalDistance = Math.abs(current.point.z - sourceCorner.z);
        const planarRange = Math.sqrt(Math.max(0, (RANGE * RANGE) - (verticalDistance * verticalDistance)));
        if (options.range?.showBoundary !== false && planarRange > 1e-7) {
          const boundaryCenter = toPixel(sourceCorner);
          drawing.lineStyle(1.5, RANGE_RING_COLOR, RANGE_RING_ALPHA);
          drawing.drawCircle(boundaryCenter.x, boundaryCenter.y, planarRange * scale);
        }

        drawSphere(center, current.point);
        drawSourceTracer(
          toPixel(sourceCorner),
          center
        );
        drawApex(center);
      }

      textRoot.position.set(center.x, center.y);
      modeText.text = mode;
      dimensions.text = `Diameter ${format(RADIUS * 2)} ${unit}`;

      const badgeWidth = modeText.width + 18;
      badge
        .clear()
        .beginFill(0x202020, 0.92)
        .drawRoundedRect(0, -14, badgeWidth, 28, 4)
        .endFill();
      modeText.position.set(9, 0);
      dimensions.position.set(badgeWidth + 14, 0);
      header.pivot.x = (badgeWidth + 14 + dimensions.width) / 2;
      header.position.set(0, -radiusPixels - 20);

      centerElevation.text = `${format(current.point.z)} ${unit}`;
      centerElevation.position.set(18, 0);

      let cursor = 0;
      for (const label of instructions.children) {
        label.position.set(cursor, 0);
        cursor += label.width;
      }
      instructions.pivot.x = cursor / 2;
      const instructionY = radiusPixels + 20;
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
updateSurfaceIllumination(now);
      if (updateTextResolution(labels)) render(false);
    },
    clear() { root?.parent?.removeChild(root); root?.destroy({ children: true }); }
  };
}
