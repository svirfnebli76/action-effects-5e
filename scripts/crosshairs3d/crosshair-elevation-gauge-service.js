import { finiteNumber, normalizeDegrees } from "./geometry-utils.js";

const GAUGE_DIAMETER_PX = 276;
const GAUGE_RADIUS_PX = GAUGE_DIAMETER_PX / 2;
const GAUGE_TARGET_CENTER_X = 320;
const GAUGE_TARGET_CENTER_Y = 275;
const GAUGE_VIEWPORT_MARGIN = 24;
const GAUGE_RANGE_PADDING_FACTOR = 1.10;
const GAUGE_LINE_COLOR = 0xD35BFF;
const GAUGE_WHITE = 0xFFFFFF;
const GAUGE_BLACK = 0x000000;
const GAUGE_BACKGROUND = 0x484848;
const GAUGE_BACKGROUND_ALPHA = 0.50;
const GAUGE_TICK_INCREMENT_DEGREES = 5;
const GAUGE_NEGATIVE = "#FF3B30";
const GAUGE_POSITIVE = "#FFFFFF";
const CARDINAL_FONT_SIZE = 16;
const VALUE_FONT_SIZE = 18;
const DISTANCE_FONT_SIZE = 15;
const TITLE_FONT_SIZE = 17;

function graphicsClass(PIXI) {
  return globalThis.SmoothGraphics
    ?? PIXI?.smooth?.SmoothGraphics
    ?? PIXI?.SmoothGraphics
    ?? PIXI?.Graphics
    ?? null;
}

function setPosition(display, x, y) {
  if (display?.position?.set) display.position.set(x, y);
  else if (display?.position) { display.position.x = x; display.position.y = y; }
  else display.position = { x, y };
}

function setScale(display, x, y = x) {
  if (display?.scale?.set) display.scale.set(x, y);
  else if (display?.scale) { display.scale.x = x; display.scale.y = y; }
}

function clearGraphics(graphics) {
  try { graphics?.clear?.(); } catch (_error) { /* noop */ }
}

function drawLine(graphics, x1, y1, x2, y2, { color = GAUGE_WHITE, alpha = 1, width = 2 } = {}) {
  if (!graphics) return;
  if (typeof graphics.stroke === "function") {
    try {
      graphics.moveTo?.(x1, y1);
      graphics.lineTo?.(x2, y2);
      graphics.stroke({ color, alpha, width });
      return;
    } catch (_error) { /* classic fallback below */ }
  }
  try {
    graphics.lineStyle?.(width, color, alpha);
    graphics.moveTo?.(x1, y1);
    graphics.lineTo?.(x2, y2);
  } catch (_error) { /* noop */ }
}

function drawCircle(graphics, x, y, radius, { lineColor = GAUGE_WHITE, lineAlpha = 1, lineWidth = 2, fillColor = null, fillAlpha = 0 } = {}) {
  if (!graphics) return;
  if (typeof graphics.circle === "function" && typeof graphics.stroke === "function") {
    try {
      const path = graphics.circle(x, y, radius);
      if (fillColor !== null && typeof path.fill === "function") path.fill({ color: fillColor, alpha: fillAlpha });
      path.stroke({ color: lineColor, alpha: lineAlpha, width: lineWidth });
      return;
    } catch (_error) { /* classic fallback below */ }
  }
  try {
    graphics.lineStyle?.(lineWidth, lineColor, lineAlpha);
    if (fillColor !== null) graphics.beginFill?.(fillColor, fillAlpha);
    graphics.drawCircle?.(x, y, radius);
    if (fillColor !== null) graphics.endFill?.();
  } catch (_error) { /* noop */ }
}

function signedText(value) {
  const number = finiteNumber(value);
  const rounded = Math.abs(number) < 1e-7 ? 0 : number;
  const formatted = Number.isInteger(rounded) ? String(Math.abs(rounded)) : Math.abs(rounded).toFixed(1).replace(/\.0$/, "");
  if (rounded > 0) return `+${formatted}`;
  if (rounded < 0) return `-${formatted}`;
  return "0";
}

function plainDistanceText(value) {
  const number = Math.max(0, finiteNumber(value));
  return Number.isInteger(number) ? String(number) : number.toFixed(1).replace(/\.0$/, "");
}

export class CrosshairElevationGaugeService {
  #parent = null;
  #container = null;
  #staticGraphics = null;
  #dynamicGraphics = null;
  #elevationText = null;
  #distanceText = null;
  #ticker = null;
  #tickerCallback = null;
  #texts = [];
  #enabled = false;

  show({ enabled = true } = {}) {
    this.clear();
    this.#enabled = Boolean(enabled);
    if (!this.#enabled) return false;

    const PIXI = globalThis.PIXI;
    const GraphicsClass = graphicsClass(PIXI);
    const parent = globalThis.canvas?.interface ?? globalThis.canvas?.controls ?? globalThis.canvas?.stage;
    if (!PIXI?.Container || !PIXI?.Text || !GraphicsClass || !parent?.addChild) return false;

    const container = new PIXI.Container();
    container.name = "action-effects-5e-crosshair-elevation-gauge";
    container.eventMode = "none";
    container.visible = false;

    const staticGraphics = new GraphicsClass();
    staticGraphics.name = "action-effects-5e-crosshair-elevation-gauge-static";
    staticGraphics.eventMode = "none";
    const dynamicGraphics = new GraphicsClass();
    dynamicGraphics.name = "action-effects-5e-crosshair-elevation-gauge-dynamic";
    dynamicGraphics.eventMode = "none";
    container.addChild(staticGraphics);
    container.addChild(dynamicGraphics);

    parent.addChild(container);
    this.#parent = parent;
    this.#container = container;
    this.#staticGraphics = staticGraphics;
    this.#dynamicGraphics = dynamicGraphics;

    this.#drawStaticGauge();
    this.#createLabels(PIXI);
    this.#syncScreenAnchor();
    this.#installTicker();
    return true;
  }

  update({ distance = 0, maxRange = null, angle = 0, elevationDelta = 0, belowOrigin = null, visible = true } = {}) {
    if (!this.#container || !this.#dynamicGraphics) return false;
    if (!visible) {
      this.#container.visible = false;
      return true;
    }

    const radialDistance = Math.max(0, finiteNumber(distance));
    const range = Number.isFinite(Number(maxRange)) && Number(maxRange) > 0 ? Number(maxRange) : null;
    const scaleMaximum = Math.max(
      1,
      radialDistance * 1.05,
      range ? range * GAUGE_RANGE_PADDING_FACTOR : radialDistance * GAUGE_RANGE_PADDING_FACTOR
    );
    const angleDegrees = normalizeDegrees(angle);
    const angleRadians = (angleDegrees * Math.PI) / 180;
    const radialPixels = Math.min(GAUGE_RADIUS_PX - 8, (radialDistance / scaleMaximum) * GAUGE_RADIUS_PX);
    const bx = Math.cos(angleRadians) * radialPixels;
    const by = -Math.sin(angleRadians) * radialPixels;

    const g = this.#dynamicGraphics;
    clearGraphics(g);

    // AB: current origin-to-crosshair radial vector. The dark under-stroke
    // keeps the intentionally crude side-view guide readable over any Scene.
    drawLine(g, 0, 0, bx, by, { color: GAUGE_BLACK, alpha: 0.90, width: 6 });
    drawLine(g, 0, 0, bx, by, { color: GAUGE_LINE_COLOR, alpha: 0.98, width: 3 });

    drawCircle(g, 0, 0, 6, { lineColor: GAUGE_BLACK, lineWidth: 3, fillColor: GAUGE_WHITE, fillAlpha: 1 });
    drawCircle(g, bx, by, 6, { lineColor: GAUGE_BLACK, lineWidth: 3, fillColor: GAUGE_WHITE, fillAlpha: 1 });

    const negative = belowOrigin === null ? finiteNumber(elevationDelta) < 0 : Boolean(belowOrigin);
    if (this.#elevationText) {
      this.#elevationText.text = `${signedText(elevationDelta)} ft`;
      this.#setTextFill(this.#elevationText, negative ? GAUGE_NEGATIVE : GAUGE_POSITIVE);
      const labelBelow = angleDegrees > 180 && angleDegrees < 360;
      setPosition(this.#elevationText, bx, by + (labelBelow ? 19 : -19));
      this.#elevationText.visible = true;
    }

    if (this.#distanceText) {
      const lineLength = Math.hypot(bx, by);
      this.#distanceText.text = `${plainDistanceText(radialDistance)} ft`;
      if (lineLength > 18) {
        const ux = bx / lineLength;
        const uy = by / lineLength;
        const nx = -uy;
        const ny = ux;
        setPosition(this.#distanceText, (bx * 0.56) + (nx * 14), (by * 0.56) + (ny * 14));
        this.#distanceText.visible = true;
      } else this.#distanceText.visible = false;
    }

    this.#container.visible = true;
    this.#syncScreenAnchor();
    return true;
  }

  clear() {
    if (this.#ticker && this.#tickerCallback) {
      try { this.#ticker.remove?.(this.#tickerCallback); } catch (_error) { /* noop */ }
    }
    this.#ticker = null;
    this.#tickerCallback = null;

    if (this.#container) {
      try {
        this.#container.parent?.removeChild?.(this.#container);
        this.#container.destroy?.({ children: true });
      } catch (_error) { /* noop */ }
    }

    this.#parent = null;
    this.#container = null;
    this.#staticGraphics = null;
    this.#dynamicGraphics = null;
    this.#elevationText = null;
    this.#distanceText = null;
    this.#texts = [];
    this.#enabled = false;
  }

  #drawStaticGauge() {
    const g = this.#staticGraphics;
    if (!g) return;
    clearGraphics(g);

    // Outer range dial: fixed physical size. Range changes only the internal
    // radial scale used for B, never the gauge diameter itself.
    drawCircle(g, 0, 0, GAUGE_RADIUS_PX, {
      lineColor: GAUGE_BLACK,
      lineAlpha: 0.90,
      lineWidth: 5,
      fillColor: GAUGE_BACKGROUND,
      fillAlpha: GAUGE_BACKGROUND_ALPHA
    });
    drawCircle(g, 0, 0, GAUGE_RADIUS_PX, { lineColor: GAUGE_WHITE, lineAlpha: 0.92, lineWidth: 2 });

    // Source-level horizontal axis, intentionally dashed like the user's
    // side-view sketch.
    const dash = 10;
    const gap = 7;
    for (let x = -GAUGE_RADIUS_PX + 12; x < GAUGE_RADIUS_PX - 12; x += dash + gap) {
      const x2 = Math.min(x + dash, GAUGE_RADIUS_PX - 12);
      drawLine(g, x, 0, x2, 0, { color: GAUGE_BLACK, alpha: 0.82, width: 4 });
      drawLine(g, x, 0, x2, 0, { color: GAUGE_WHITE, alpha: 0.72, width: 1.5 });
    }

    // 5-degree ticks. Cardinal axes remain strongest, 45-degree orientation
    // ticks stay prominent, and each 10-degree interval is longer than the
    // intervening 5-degree tick. 0° points right, 90° up, 180° left, 270° down.
    for (let degrees = 0; degrees < 360; degrees += GAUGE_TICK_INCREMENT_DEGREES) {
      const cardinal = degrees % 90 === 0;
      const orientation = degrees % 45 === 0;
      const tenDegree = degrees % 10 === 0;
      const length = cardinal ? 20 : orientation ? 15 : tenDegree ? 10 : 6;
      const width = cardinal ? 4 : orientation ? 3 : tenDegree ? 2 : 1.5;
      this.#drawTick(degrees, length, width);
    }
  }

  #drawTick(degrees, length, width) {
    const radians = (degrees * Math.PI) / 180;
    const outer = GAUGE_RADIUS_PX - 1;
    const inner = outer - length;
    const x1 = Math.cos(radians) * inner;
    const y1 = -Math.sin(radians) * inner;
    const x2 = Math.cos(radians) * outer;
    const y2 = -Math.sin(radians) * outer;
    drawLine(this.#staticGraphics, x1, y1, x2, y2, { color: GAUGE_BLACK, alpha: 0.90, width: width + 2 });
    drawLine(this.#staticGraphics, x1, y1, x2, y2, { color: GAUGE_WHITE, alpha: 0.95, width });
  }

  #createLabels(PIXI) {
    const cardinalStyle = {
      fontFamily: "Arial",
      fontSize: CARDINAL_FONT_SIZE,
      fill: "#FFFFFF",
      fontWeight: "700",
      stroke: { color: "#000000", width: 4 }
    };
    const valueStyle = {
      fontFamily: "Arial",
      fontSize: VALUE_FONT_SIZE,
      fill: "#FFFFFF",
      fontWeight: "700",
      stroke: { color: "#000000", width: 4 }
    };
    const distanceStyle = {
      fontFamily: "Arial",
      fontSize: DISTANCE_FONT_SIZE,
      fill: "#FFFFFF",
      fontWeight: "600",
      stroke: { color: "#000000", width: 4 }
    };
    const titleStyle = {
      fontFamily: "Arial",
      fontSize: TITLE_FONT_SIZE,
      fill: "#FFFFFF",
      fontWeight: "700",
      letterSpacing: 1.5,
      stroke: { color: "#000000", width: 4 }
    };

    const cardinals = [
      ["0°", GAUGE_RADIUS_PX + 18, 0],
      ["90°", 0, -GAUGE_RADIUS_PX - 17],
      ["180°", -GAUGE_RADIUS_PX - 24, 0],
      ["270°", 0, GAUGE_RADIUS_PX + 17]
    ];
    for (const [label, x, y] of cardinals) {
      const text = this.#createText(PIXI, label, cardinalStyle);
      text.name = `action-effects-5e-crosshair-elevation-gauge-${label.replace(/[^0-9]/g, "")}`;
      text.eventMode = "none";
      text.anchor?.set?.(0.5, 0.5);
      setPosition(text, x, y);
      this.#container.addChild(text);
      this.#texts.push(text);
    }

    const title = this.#createText(PIXI, "SIDE VIEW", titleStyle);
    title.name = "action-effects-5e-crosshair-elevation-gauge-title";
    title.eventMode = "none";
    title.anchor?.set?.(0.5, 0.5);
    setPosition(title, 0, GAUGE_RADIUS_PX + 43);
    this.#container.addChild(title);
    this.#texts.push(title);

    const elevationText = this.#createText(PIXI, "0 ft", valueStyle);
    elevationText.name = "action-effects-5e-crosshair-elevation-gauge-elevation";
    elevationText.eventMode = "none";
    elevationText.anchor?.set?.(0.5, 0.5);
    elevationText.visible = false;
    this.#container.addChild(elevationText);
    this.#elevationText = elevationText;
    this.#texts.push(elevationText);

    const distanceText = this.#createText(PIXI, "0 ft", distanceStyle);
    distanceText.name = "action-effects-5e-crosshair-elevation-gauge-distance";
    distanceText.eventMode = "none";
    distanceText.anchor?.set?.(0.5, 0.5);
    distanceText.visible = false;
    this.#container.addChild(distanceText);
    this.#distanceText = distanceText;
    this.#texts.push(distanceText);
  }

  #createText(PIXI, text, style) {
    const content = String(text ?? "");
    let display;
    try { display = new PIXI.Text(content); }
    catch (_error) { display = new PIXI.Text({ text: content }); }

    let resolvedStyle = style;
    if (PIXI.TextStyle) {
      try { resolvedStyle = new PIXI.TextStyle(style); }
      catch (_error) { /* direct assignment below remains available */ }
    }
    try { display.style = resolvedStyle; }
    catch (_error) {
      try { Object.assign(display.style ?? {}, style); } catch (_nestedError) { /* noop */ }
    }
    display.text = content;
    return display;
  }

  #setTextFill(display, fill) {
    if (!display) return;
    try { display.style.fill = fill; }
    catch (_error) {
      try { Object.assign(display.style ?? {}, { fill }); } catch (_nestedError) { /* noop */ }
    }
  }

  #installTicker() {
    const ticker = globalThis.canvas?.app?.ticker;
    if (!ticker?.add) return;
    const callback = () => this.#syncScreenAnchor();
    try {
      ticker.add(callback);
      this.#ticker = ticker;
      this.#tickerCallback = callback;
    } catch (_error) { /* noop */ }
  }

  #syncScreenAnchor() {
    const container = this.#container;
    const parent = this.#parent;
    if (!container || !parent) return;

    const rendererScreen = globalThis.canvas?.app?.renderer?.screen;
    const width = Math.max(1, finiteNumber(rendererScreen?.width ?? globalThis.window?.innerWidth, 1920));
    const height = Math.max(1, finiteNumber(rendererScreen?.height ?? globalThis.window?.innerHeight, 1080));
    const horizontalExtent = GAUGE_RADIUS_PX + 42;
    const verticalExtentTop = GAUGE_RADIUS_PX + 34;
    const verticalExtentBottom = GAUGE_RADIUS_PX + 66;
    const minX = horizontalExtent + GAUGE_VIEWPORT_MARGIN;
    const maxX = Math.max(minX, width - horizontalExtent - GAUGE_VIEWPORT_MARGIN);
    const minY = verticalExtentTop + GAUGE_VIEWPORT_MARGIN;
    const maxY = Math.max(minY, height - verticalExtentBottom - GAUGE_VIEWPORT_MARGIN);
    const screenX = Math.max(minX, Math.min(GAUGE_TARGET_CENTER_X, maxX));
    const screenY = Math.max(minY, Math.min(GAUGE_TARGET_CENTER_Y, maxY));

    let local = { x: screenX, y: screenY };
    try {
      if (typeof parent.toLocal === "function") local = parent.toLocal({ x: screenX, y: screenY });
      else if (parent.worldTransform?.applyInverse) local = parent.worldTransform.applyInverse({ x: screenX, y: screenY });
    } catch (_error) { /* direct-screen fallback */ }
    setPosition(container, finiteNumber(local?.x, screenX), finiteNumber(local?.y, screenY));

    // If the canvas group itself participates in pan/zoom, cancel its scale so
    // the gauge remains a fixed ~276 px HUD instrument rather than a Scene
    // object that grows/shrinks with the map.
    const transform = parent.worldTransform;
    const scaleX = transform ? Math.hypot(finiteNumber(transform.a, 1), finiteNumber(transform.b)) : 1;
    const scaleY = transform ? Math.hypot(finiteNumber(transform.c), finiteNumber(transform.d, 1)) : 1;
    setScale(container, scaleX > 1e-9 ? 1 / scaleX : 1, scaleY > 1e-9 ? 1 / scaleY : 1);
  }
}

export const CROSSHAIR_ELEVATION_GAUGE_PRESENTATION = Object.freeze({
  diameterPx: GAUGE_DIAMETER_PX,
  radiusPx: GAUGE_RADIUS_PX,
  targetCenterX: GAUGE_TARGET_CENTER_X,
  targetCenterY: GAUGE_TARGET_CENTER_Y,
  rangePaddingFactor: GAUGE_RANGE_PADDING_FACTOR,
  lineColor: GAUGE_LINE_COLOR,
  backgroundColor: GAUGE_BACKGROUND,
  backgroundAlpha: GAUGE_BACKGROUND_ALPHA,
  tickIncrementDegrees: GAUGE_TICK_INCREMENT_DEGREES,
  negativeColor: GAUGE_NEGATIVE,
  positiveColor: GAUGE_POSITIVE
});
