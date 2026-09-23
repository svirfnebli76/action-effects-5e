import { clamp01, controlHints, updateTextResolution, illuminationPhase, TARGET_PREVIEW_NOTICE_TEXT, TARGET_PREVIEW_NOTICE_COLOR, targetPreviewNoticeEnabled } from "./shared.js";
// Source-driven Line Gradient Test 03, with the user's final pasted palette.
export function createRenderer(context) {
  const { shape, metrics, metricsService, geometry, capabilities, propagationMode, parent } = context;
  const api = { geometry };
  const scene = globalThis.canvas.scene;
  const LENGTH = shape.length, WIDTH = shape.width;
  const labels = [];
  let revision, mode = "MOVE", textRoot;
  const TEAL_LIGHTNESS_MIN = 0.00;
  const TEAL_LIGHTNESS_MAX = 1;
  const RED_DARKNESS_MIN = 0.00;
  const RED_DARKNESS_MAX = 0.80;

  // Slightly darker than the original teal so upward lightening is clearer.
  const TEAL_BASE_COLOR = 0x388e8e;
  const RED_BASE_COLOR = 0xFF4D4D;
  const GRADIENT_BANDS = 32;
  const GRADIENT_FILL_ALPHA = 0.55;
  const GRADIENT_CAP_ALPHA = 0.40;

    
    const colorChannels = color => [
      (color >> 16) & 0xFF,
      (color >> 8) & 0xFF,
      color & 0xFF
    ];
    const packColor = channels =>
      (channels[0] << 16) | (channels[1] << 8) | channels[2];
    const mixColor = (from, to, amount) => {
      const a = colorChannels(from);
      const b = colorChannels(to);
      const t = clamp01(amount);
      return packColor(a.map((value, index) =>
        Math.round(value + (b[index] - value) * t)
      ));
    };
    const gradientColor = (fraction, elevationRatio, downward) => {
      const progress = clamp01(fraction) * clamp01(Math.abs(elevationRatio));
      if (downward) {
        const darkness = RED_DARKNESS_MIN +
          (RED_DARKNESS_MAX - RED_DARKNESS_MIN) * progress;
        return mixColor(RED_BASE_COLOR, 0x000000, darkness);
      }
      const lightness = TEAL_LIGHTNESS_MIN +
        (TEAL_LIGHTNESS_MAX - TEAL_LIGHTNESS_MIN) * progress;
      return mixColor(TEAL_BASE_COLOR, 0xFFFFFF, lightness);
    };
    const convexHull = points => {
      const unique = [...new Map(points.map(point => [
        `${point.x.toFixed(5)},${point.y.toFixed(5)}`,
        point
      ])).values()].sort((a, b) => a.x - b.x || a.y - b.y);
      if (unique.length <= 2) return unique;
      const cross = (origin, a, b) =>
        ((a.x - origin.x) * (b.y - origin.y)) -
        ((a.y - origin.y) * (b.x - origin.x));
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
    };
    const drawPolygon = (graphics, points, {
      fillColor = 0x000000,
      fillAlpha = 0,
      lineColor = fillColor,
      lineAlpha = 0,
      lineWidth = 0
    } = {}) => {
      if (!points?.length) return;
      graphics.lineStyle(lineWidth, lineColor, lineAlpha);
      if (fillAlpha > 0) graphics.beginFill(fillColor, fillAlpha);
      graphics.drawPolygon(points.flatMap(point => [point.x, point.y]));
      if (fillAlpha > 0) graphics.endFill();
    };
    const drawLine = (graphics, a, b, color, alpha, width) => {
      graphics.lineStyle(width, color, alpha);
      graphics.moveTo(a.x, a.y);
      graphics.lineTo(b.x, b.y);
    };

    function createGradientGuide() {
      const container = new PIXI.Container();
      container.name = "ae5e-pixi-source-line-gradient-guide";
      container.eventMode = "none";
      const graphics = new PIXI.Graphics();
      graphics.eventMode = "none";
      const glow = new PIXI.Graphics();
      let glowGeometry = null;
      const startedAt = performance.now();
      container.addChild(graphics, glow);

      const endpointText = new PIXI.Text("");
      endpointText.style = new PIXI.TextStyle({
        fontFamily: "Arial, sans-serif",
        fontSize: 18,
        fontWeight: "600",
        fill: "#FFFFFF",
        align: "center",
        stroke: "#000000",
        strokeThickness: 5
      });
      endpointText.anchor.set(0.5);
      endpointText.eventMode = "none";
      endpointText.visible = false;
      container.addChild(endpointText);
      labels.push(endpointText);
      parent.addChild(container);

      const toPixel = point => metricsService.distanceToPixels(point, metrics);
      const formatElevation = value => {
        const rounded = Math.round(Number(value) * 10) / 10;
        return Number.isInteger(rounded)
          ? `${rounded} ft`
          : `${rounded.toFixed(1)} ft`;
      };

      return {
        show: () => true,
        update(shapeInput) {
          const shape = api.geometry.normalizeShape(shapeInput);
          const basis = api.geometry.lineBasis(shape);
          graphics.clear();
          endpointText.visible = false;

          const half = shape.width * 0.7 / 2;
          const fillet = Math.min(metrics.distance * 0.17, half * 0.95);
          const inset = half - fillet;
          const perimeter = [];
          for (let corner = 0; corner < 4; corner++) {
            const midpoint = (corner * 90 + 45) * Math.PI / 180;
            const u = Math.sign(Math.cos(midpoint)) * inset;
            const v = Math.sign(Math.sin(midpoint)) * inset;
            for (let step = 0; step <= 10; step++) {
              const angle = (corner * 90 + step * 9) * Math.PI / 180;
              perimeter.push({
                u: u + fillet * Math.cos(angle),
                v: v + fillet * Math.sin(angle)
              });
            }
          }

          const endpoint = {
            x: shape.origin.x + basis.direction.x * shape.length,
            y: shape.origin.y + basis.direction.y * shape.length,
            z: shape.origin.z + basis.direction.z * shape.length
          };
          const elevationRatio = Math.max(-1, Math.min(1,
            (endpoint.z - shape.origin.z) / shape.length
          ));
          const downward = elevationRatio < -1e-7;

          const section = fraction => {
            const center = {
              x: shape.origin.x + basis.direction.x * shape.length * fraction,
              y: shape.origin.y + basis.direction.y * shape.length * fraction,
              z: shape.origin.z + basis.direction.z * shape.length * fraction
            };
            return perimeter.map(({ u, v }) => {
              const world = {
                x: center.x + u * basis.widthAxis.x + v * basis.heightAxis.x,
                y: center.y + u * basis.widthAxis.y + v * basis.heightAxis.y,
                z: center.z + u * basis.widthAxis.z + v * basis.heightAxis.z
              };
              return { ...toPixel(world), z: world.z };
            });
          };

          const sections = Array.from(
            { length: GRADIENT_BANDS + 1 },
            (_, index) => section(index / GRADIENT_BANDS)
          );
          const visibleFaces = [];
          for (let i = 0; i < perimeter.length; i++) {
            const j = (i + 1) % perimeter.length;
            const du = perimeter[j].u - perimeter[i].u;
            const dv = perimeter[j].v - perimeter[i].v;
            const magnitude = Math.hypot(du, dv);
            if (magnitude < 1e-8) continue;
            const normal = {};
            for (const axis of ["x", "y", "z"]) {
              normal[axis] = (
                dv * basis.widthAxis[axis] -
                du * basis.heightAxis[axis]
              ) / magnitude;
            }
            if (normal.z > 1e-8) visibleFaces.push({ i, j });
          }

          const faces = [];
          for (let band = 0; band < GRADIENT_BANDS; band++) {
            const fraction = (band + 0.5) / GRADIENT_BANDS;
            const color = gradientColor(fraction, elevationRatio, downward);
            for (const face of visibleFaces) {
              const points = [
                sections[band][face.i],
                sections[band][face.j],
                sections[band + 1][face.j],
                sections[band + 1][face.i]
              ];
              const meanZ = points.reduce((sum, point) => sum + point.z, 0) /
                points.length;
              faces.push({ points, color, meanZ });
            }
          }
          faces.sort((a, b) => a.meanZ - b.meanZ);
          for (const face of faces) {
            drawPolygon(graphics, face.points, {
              fillColor: face.color,
              fillAlpha: GRADIENT_FILL_ALPHA
            });
          }

          const near = sections[0];
          const far = sections.at(-1);
          const silhouette = convexHull([...near, ...far]);
          const sourceColor = gradientColor(0, elevationRatio, downward);
          const endpointColor = gradientColor(1, elevationRatio, downward);
          // Keep the exterior colored stroke in the normal palette. The first
          // gradient draft darkened this stroke independently and made it look
          // detached from the translucent body.
          const outlineColor = downward
            ? RED_BASE_COLOR
            : TEAL_BASE_COLOR;

          drawPolygon(graphics, silhouette, {
            lineColor: 0x000000,
            lineAlpha: 0.40,
            lineWidth: 4.5
          });
          drawPolygon(graphics, silhouette, {
            lineColor: outlineColor,
            lineAlpha: 0.92,
            lineWidth: 2.25
          });
          drawPolygon(graphics, near, {
            fillColor: sourceColor,
            fillAlpha: GRADIENT_CAP_ALPHA,
            lineColor: sourceColor,
            lineAlpha: 0.45,
            lineWidth: 1.5
          });
          drawPolygon(graphics, far, {
            fillColor: endpointColor,
            fillAlpha: GRADIENT_CAP_ALPHA,
            lineColor: endpointColor,
            lineAlpha: 0.90,
            lineWidth: 1.5
          });
          for (const index of [10, 11]) {
            drawLine(
              graphics,
              near[index],
              far[index],
              downward ? 0xFFBABA : 0xC4FFF7,
              0.45,
              1
            );
          }

          // Only exposed longitudinal edges participate; no animated face fill.
          const exposed = new Set(visibleFaces.flatMap(face => [face.i, face.j]));
          const longitudinal = [...exposed].filter(i => [0, 10, 11, 21, 22, 32, 33, 43].includes(i));
          glowGeometry = { near, far, longitudinal, color: mixColor(outlineColor, 0xFFFFFF, 0.60) };
          const terminal = toPixel(endpoint);
          graphics.lineStyle(3, 0x000000, 0.95);
          graphics.beginFill(endpointColor, 1);
          graphics.drawCircle(terminal.x, terminal.y, 6);
          graphics.endFill();

          endpointText.text = formatElevation(endpoint.z);
          endpointText.position.set(terminal.x, terminal.y + 20);
          endpointText.visible = true;
        },
        frame(now) {
          glow.clear();
          if (!glowGeometry) return;
          const { progress, alpha } = illuminationPhase(now - startedAt);
          if (alpha <= 0) return;
          const { near, far, longitudinal, color } = glowGeometry;
          drawPolygon(glow, near, { lineColor: color, lineAlpha: 0.60 * alpha, lineWidth: 3.5 });
          for (const i of longitudinal) {
            drawLine(glow, near[i], {
              x: near[i].x + (far[i].x - near[i].x) * progress,
              y: near[i].y + (far[i].y - near[i].y) * progress
            }, color, 0.60 * alpha, 3.5);
          }
          // The terminal rim lights only when the traveling edge reaches it.
          if (progress >= 1) drawPolygon(glow, far, { lineColor: color, lineAlpha: 0.60 * alpha, lineWidth: 3.5 });
        },
        clear() {
          container.parent?.removeChild?.(container);
          container.destroy?.({ children: true });
        }
      };
    }


const guide = createGradientGuide();
    const scale = metrics.size / metrics.distance;
    const unit = String(scene.grid.units || "ft");


    textRoot = new PIXI.Container();
    textRoot.eventMode = "none";
    textRoot.name = "ae5e-independent-source-line-text";
    parent.addChild(textRoot);

    function createText(value, bold = false) {
      const label = new PIXI.Text(value);
      label.style = new PIXI.TextStyle({
        fontFamily: "Arial",
        fontSize: 16,
        fontWeight: bold ? "700" : "400",
        fill: "#FFFFFF",
        stroke: "#000000",
        strokeThickness: 0,
        dropShadow: false,
        padding: 4
      });
      label.anchor.set(0, 0.5);
      label.resolution = 2;
      label.eventMode = "none";
      labels.push(label);
      return label;
    }

    const header = new PIXI.Container();
    const badge = new PIXI.Graphics();
    const modeText = createText("MOVE", true);
    const dimensions = createText(`Length ${LENGTH} ${unit}`, true);
    header.addChild(badge, modeText, dimensions);

    const instructions = new PIXI.Container();
    for (const [value, bold] of controlHints(capabilities)) {
      instructions.addChild(createText(value, bold));
    }
    const targetPreviewNotice = targetPreviewNoticeEnabled(propagationMode)
      ? createText(TARGET_PREVIEW_NOTICE_TEXT)
      : null;
    if (targetPreviewNotice) {
      targetPreviewNotice.style.fill = TARGET_PREVIEW_NOTICE_COLOR;
      targetPreviewNotice.anchor.set(0.5, 0.5);
    }
    textRoot.addChild(header, instructions);
    if (targetPreviewNotice) textRoot.addChild(targetPreviewNotice);
    function updatePresentation(redrawGuide = true) {
      if (!revision) return;

      if (redrawGuide) {
        guide.update(revision.shape, {
          color: 0x7FEFEF
        });
      }

      const originPx = metricsService.distanceToPixels(
        revision.shape.origin,
        metrics
      );
      const endpointPx = metricsService.distanceToPixels(
        revision.endpoint,
        metrics
      );
      const centerPx = {
        x: (originPx.x + endpointPx.x) / 2,
        y: (originPx.y + endpointPx.y) / 2
      };
      const labelAngle = (
        (((revision.yaw + 90) % 180 + 180) % 180) - 90
      ) * Math.PI / 180;

      textRoot.position.set(centerPx.x, centerPx.y);
      textRoot.rotation = labelAngle;

      modeText.text = mode;
      dimensions.text = `Length ${LENGTH} ${unit}`;
      const badgeWidth = modeText.width + 18;
      badge
        .clear()
        .beginFill(0x202020, 0.92)
        .drawRoundedRect(0, -14, badgeWidth, 28, 4)
        .endFill();
      modeText.position.set(9, 0);
      dimensions.position.set(badgeWidth + 14, 0);
      header.pivot.x = (badgeWidth + 14 + dimensions.width) / 2;
      header.position.set(0, -WIDTH * scale / 2 - 20);

      let instructionWidth = 0;
      for (const label of instructions.children) {
        label.position.set(instructionWidth, 0);
        instructionWidth += label.width;
      }
      instructions.pivot.x = instructionWidth / 2;
      const instructionY = WIDTH * scale / 2 + 20;
      instructions.position.set(0, instructionY);
      if (targetPreviewNotice) targetPreviewNotice.position.set(0, instructionY + 22);



    }


  return {
    update(next, nextMode) { revision = next; mode = nextMode; updatePresentation(); },
    frame(now) { guide.frame(now); if (updateTextResolution(labels)) updatePresentation(false); },
    clear() { guide.clear(); textRoot?.parent?.removeChild(textRoot); textRoot?.destroy({ children: true }); }
  };
}
