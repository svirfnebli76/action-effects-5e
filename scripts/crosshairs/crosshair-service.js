import { Logger } from "../core/logger.js";
import {
  ESKIE_CROSSHAIR_CATALOG,
  ESKIE_CROSSHAIR_COLORS,
  ESKIE_CROSSHAIR_DEFAULTS,
  ESKIE_CROSSHAIR_SHAPES,
  ESKIE_CROSSHAIR_SEMANTICS,
  ESKIE_FREE_MODULE_ID,
  ESKIE_PREMIUM_MODULE_ID,
  ESKIE_TINT_APPROXIMATIONS,
  SEQUENCER_MODULE_ID
} from "./eskie-crosshair-catalog.js";

const SOURCE_ORDER = Object.freeze(["premium", "free"]);
const NATIVE_TYPE_BY_VISUAL = Object.freeze({
  circle: "circle",
  cone: "cone",
  ray: "ray",
  rectangle: "rect",
  reticle: "circle"
});

function lower(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value).trim().toLowerCase();
}

function normalizeBase(value) {
  const normalized = lower(value, "full")?.replaceAll("-", "_");
  if (["nobase", "no_base", "none"].includes(normalized)) return "no_base";
  return "full";
}

function parseSize(value) {
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value) && value.length >= 2) {
    return { kind: "rectangle", width: Number(value[0]), height: Number(value[1]) };
  }
  if (typeof value === "object" && value) {
    if (Number.isFinite(Number(value.width)) && Number.isFinite(Number(value.height))) {
      return { kind: "rectangle", width: Number(value.width), height: Number(value.height) };
    }
    if (Number.isFinite(Number(value.feet ?? value.distance ?? value.radius ?? value.value))) {
      return { kind: "linear", feet: Number(value.feet ?? value.distance ?? value.radius ?? value.value) };
    }
  }
  if (Number.isFinite(Number(value))) return { kind: "linear", feet: Number(value) };

  let text = lower(value)?.replace(/^radius_/, "").replace(/\s+/g, "").replace(/feet$/, "ft");
  const rectangle = text?.match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(?:ft)?$/);
  if (rectangle) {
    return { kind: "rectangle", width: Number(rectangle[1]), height: Number(rectangle[2]) };
  }
  const linear = text?.match(/^(\d+(?:\.\d+)?)(?:ft)?$/);
  if (linear) return { kind: "linear", feet: Number(linear[1]) };
  return { kind: "raw", value: text };
}

function sizeEquals(left, right) {
  const a = parseSize(left);
  const b = parseSize(right);
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === "linear") return Math.abs(a.feet - b.feet) < 0.001;
  if (a.kind === "rectangle") {
    return Math.abs(a.width - b.width) < 0.001 && Math.abs(a.height - b.height) < 0.001;
  }
  return a.value === b.value;
}

function linearDistance(entrySize, requestSize) {
  const entry = parseSize(entrySize);
  const request = parseSize(requestSize);
  if (entry?.kind !== "linear" || request?.kind !== "linear") return null;
  return entry.feet - request.feet;
}

function rectangleDistance(entrySize, requestSize) {
  const entry = parseSize(entrySize);
  const request = parseSize(requestSize);
  if (entry?.kind !== "rectangle" || request?.kind !== "rectangle") return null;
  return Math.hypot(entry.width - request.width, entry.height - request.height);
}

function chooseSizedEntry(entries, requestedSize, strategy = "floor") {
  if (!entries.length) return null;
  if (requestedSize === null || requestedSize === undefined || requestedSize === "") {
    return entries.find((entry) => entry.size === null) ?? entries[0] ?? null;
  }

  const exact = entries.find((entry) => sizeEquals(entry.size, requestedSize));
  if (exact) return exact;
  if (strategy === "exact") return null;

  const requested = parseSize(requestedSize);
  if (requested?.kind === "rectangle") {
    return entries
      .map((entry) => ({ entry, distance: rectangleDistance(entry.size, requestedSize) }))
      .filter((candidate) => Number.isFinite(candidate.distance))
      .sort((a, b) => a.distance - b.distance)[0]?.entry ?? null;
  }

  const linear = entries
    .map((entry) => ({ entry, delta: linearDistance(entry.size, requestedSize) }))
    .filter((candidate) => Number.isFinite(candidate.delta));
  if (!linear.length) return entries[0] ?? null;

  if (strategy === "ceiling") {
    const above = linear.filter((candidate) => candidate.delta >= 0).sort((a, b) => a.delta - b.delta);
    if (above.length) return above[0].entry;
    return linear.sort((a, b) => b.delta - a.delta)[0].entry;
  }

  if (strategy === "nearest") {
    return linear.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))[0].entry;
  }

  // Fireball established the floor behavior: use the largest authored visual
  // not larger than the requested radius/length, falling back to the smallest
  // authored visual when the request is below the catalog minimum.
  const below = linear.filter((candidate) => candidate.delta <= 0).sort((a, b) => b.delta - a.delta);
  if (below.length) return below[0].entry;
  return linear.sort((a, b) => a.delta - b.delta)[0].entry;
}

function requestTint(color, tintOverride = null) {
  if (typeof tintOverride === "string" && tintOverride.trim()) return tintOverride.trim();
  if (typeof color === "string" && color.trim().startsWith("#")) return color.trim();
  const named = lower(color, "white");
  if (named === "white") return null;
  return ESKIE_TINT_APPROXIMATIONS[named] ?? null;
}

function randomId() {
  try {
    return globalThis.foundry?.utils?.randomID?.(12) ?? crypto.randomUUID();
  } catch (_error) {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export class CrosshairService {
  #stats = {
    resolves: 0,
    premiumResolves: 0,
    freeResolves: 0,
    tintedResolves: 0,
    nativeFallbacks: 0,
    shows: 0,
    cancellations: 0,
    errors: 0
  };

  getEskieStatus() {
    const moduleStatus = (id) => {
      const module = globalThis.game?.modules?.get?.(id) ?? null;
      return Object.freeze({
        id,
        installed: Boolean(module),
        active: Boolean(module?.active),
        version: module?.version ?? null
      });
    };

    return Object.freeze({
      premium: moduleStatus(ESKIE_PREMIUM_MODULE_ID),
      free: moduleStatus(ESKIE_FREE_MODULE_ID),
      sequencer: moduleStatus(SEQUENCER_MODULE_ID),
      sequencerApi: Boolean(globalThis.Sequencer?.Crosshair?.show && globalThis.Sequence)
    });
  }

  getShapeInfo(shape = null) {
    const normalized = lower(shape);
    if (!normalized) return ESKIE_CROSSHAIR_SEMANTICS;
    return ESKIE_CROSSHAIR_SEMANTICS[normalized] ?? null;
  }

  getCatalog({ source = null, shape = null } = {}) {
    const normalizedSource = lower(source);
    const normalizedShape = lower(shape);
    const sources = normalizedSource ? [normalizedSource] : SOURCE_ORDER;
    return sources.flatMap((key) => {
      const entries = ESKIE_CROSSHAIR_CATALOG[key] ?? [];
      return normalizedShape ? entries.filter((entry) => entry.shape === normalizedShape) : [...entries];
    });
  }

  resolveAsset(request = {}, { status = null } = {}) {
    this.#stats.resolves += 1;
    const shape = lower(request.shape);
    if (!ESKIE_CROSSHAIR_SHAPES.includes(shape)) {
      return this.#nativeFallback(request, `Unsupported Eskie crosshair shape '${request.shape ?? "null"}'.`);
    }

    const defaults = ESKIE_CROSSHAIR_DEFAULTS[shape];
    const style = lower(request.style, defaults.style);
    const variant = lower(request.variant, defaults.variant);
    const base = normalizeBase(request.base ?? defaults.base);
    const size = request.size ?? defaults.size;
    const rawColor = request.color ?? "white";
    const requestedColor = lower(rawColor, "white");
    const namedColor = ESKIE_CROSSHAIR_COLORS.includes(requestedColor) ? requestedColor : "white";
    const tint = requestTint(rawColor, request.tint);
    const sizeStrategy = lower(request.sizeStrategy, "floor");
    const allowStyleFallback = request.allowStyleFallback !== false;
    const detected = status ?? this.getEskieStatus();

    const normalizedStatus = {
      premium: Boolean(detected?.premium?.active ?? detected?.premium),
      free: Boolean(detected?.free?.active ?? detected?.free),
      sequencer: Boolean(detected?.sequencer?.active ?? detected?.sequencer ?? true)
    };

    const criteria = { shape, style, variant, base, size, namedColor, tint, sizeStrategy };

    if (normalizedStatus.premium) {
      // Preserve the requested style before considering a different authored
      // style. This matters for known asymmetric premium entries: a same-style
      // white asset plus tint is preferable to silently switching art styles.
      const native = this.#findEntry("premium", criteria, namedColor, false);
      if (native) {
        this.#stats.premiumResolves += 1;
        return this.#resolution(native, {
          requested: request,
          color: namedColor,
          tint: null,
          source: "premium",
          fallback: false,
          reason: "native-premium-color"
        });
      }

      const white = this.#findEntry("premium", criteria, "white", false);
      if (white) {
        const appliedTint = requestedColor === "white" ? null : tint;
        this.#stats.premiumResolves += 1;
        if (appliedTint) this.#stats.tintedResolves += 1;
        return this.#resolution(white, {
          requested: request,
          color: requestedColor,
          tint: appliedTint,
          source: "premium",
          fallback: true,
          reason: appliedTint ? "premium-white-tinted" : "premium-white-fallback"
        });
      }

      if (allowStyleFallback) {
        const alternateColor = this.#findEntry("premium", criteria, namedColor, true);
        if (alternateColor) {
          this.#stats.premiumResolves += 1;
          return this.#resolution(alternateColor, {
            requested: request,
            color: namedColor,
            tint: null,
            source: "premium",
            fallback: true,
            reason: "premium-style-fallback"
          });
        }
        const alternateWhite = this.#findEntry("premium", criteria, "white", true);
        if (alternateWhite) {
          const appliedTint = requestedColor === "white" ? null : tint;
          this.#stats.premiumResolves += 1;
          if (appliedTint) this.#stats.tintedResolves += 1;
          return this.#resolution(alternateWhite, {
            requested: request,
            color: requestedColor,
            tint: appliedTint,
            source: "premium",
            fallback: true,
            reason: appliedTint ? "premium-style-white-tinted" : "premium-style-white-fallback"
          });
        }
      }
    }

    if (normalizedStatus.free) {
      let white = this.#findEntry("free", criteria, "white", false);
      if (!white && allowStyleFallback) white = this.#findEntry("free", criteria, "white", true);
      if (white) {
        const appliedTint = requestedColor === "white" ? null : tint;
        this.#stats.freeResolves += 1;
        if (appliedTint) this.#stats.tintedResolves += 1;
        return this.#resolution(white, {
          requested: request,
          color: requestedColor,
          tint: appliedTint,
          source: "free",
          fallback: requestedColor !== "white" || white.style !== style || white.variant !== variant,
          reason: appliedTint ? "free-white-tinted" : "free-white"
        });
      }
    }

    return this.#nativeFallback(request, `No installed Eskie asset matches ${shape}/${style}/${variant ?? "default"}/${base}/${String(size ?? "unsized")}.`);
  }

  async show({
    source = null,
    type = null,
    location = null,
    distance = null,
    limitMaxRange = null,
    placement = {},
    appearance = {},
    visual = null,
    tracer = null,
    callbacks = {},
    collectTargets = false,
    nativeFallback = true
  } = {}) {
    this.#stats.shows += 1;
    const status = this.getEskieStatus();
    const sequencerReady = Boolean(status.sequencer.active && status.sequencerApi);
    if (!sequencerReady) {
      this.#stats.errors += 1;
      throw new Error("AE5E crosshairs require an active Sequencer module and its Crosshair API.");
    }

    const visualResolution = visual ? this.resolveAsset(visual, { status }) : null;
    const tracerConfig = tracer === true ? { shape: "line" } : tracer;
    const tracerResolution = tracerConfig ? this.resolveAsset({ shape: "line", ...tracerConfig }, { status }) : null;
    const showCallbackKey = globalThis.Sequencer.Crosshair.CALLBACKS?.SHOW;
    const hasVisualReplacement = Boolean(showCallbackKey && visualResolution?.file && !visualResolution.nativeFallback);
    const hasCustomEffects = Boolean(
      showCallbackKey && (
        hasVisualReplacement ||
        (source && tracerResolution?.file && !tracerResolution.nativeFallback)
      )
    );

    const visualShape = lower(visual?.shape);
    const nativeType = type ?? placement.type ?? NATIVE_TYPE_BY_VISUAL[visualShape] ?? null;
    if (!nativeType) {
      throw new Error("AE5E crosshairs require a functional Sequencer crosshair 'type'. Visual Line is a tracer and does not imply a functional template type.");
    }

    const resolvedLocation = location ?? placement.location ?? (source ? { obj: source } : null);
    const locationConfig = {
      ...placement,
      type: nativeType,
      ...(resolvedLocation ? { location: resolvedLocation } : {}),
      ...(limitMaxRange !== null && limitMaxRange !== undefined ? { limitMaxRange } : {})
    };

    const appearanceConfig = {
      ...appearance,
      ...(distance !== null && distance !== undefined ? { distance } : {})
    };

    // Only suppress Sequencer's native crosshair when AE5E actually has a
    // replacement visual. Without Eskie, keep the functional crosshair visible.
    if (hasVisualReplacement) {
      appearanceConfig.borderAlpha = 0;
      appearanceConfig.fillAlpha = 0;
      appearanceConfig.gridHighlight = false;
    } else if (!nativeFallback && visual) {
      throw new Error(visualResolution?.reason ?? "The requested custom crosshair visual is unavailable.");
    }

    const effectName = `action-effects-5e.crosshair.${randomId()}`;
    const userShowCallback = showCallbackKey ? callbacks?.[showCallbackKey] : null;
    const callbackConfig = { ...callbacks };

    if (showCallbackKey) {
      callbackConfig[showCallbackKey] = async (crosshair) => {
        if (hasCustomEffects) {
          await this.#startVisuals({
            effectName,
            crosshair,
            source,
            visual,
            visualResolution,
            tracer: tracerConfig,
            tracerResolution
          });
        }
        if (typeof userShowCallback === "function") await userShowCallback(crosshair);
      };
    }

    let position = null;
    try {
      position = await globalThis.Sequencer.Crosshair.show(locationConfig, appearanceConfig, callbackConfig);
      if (!position) this.#stats.cancellations += 1;
      const targets = position && collectTargets
        ? await globalThis.Sequencer.Crosshair.collect(position)
        : null;
      return Object.freeze({
        position: position ?? null,
        cancelled: !position,
        targets,
        mode: hasCustomEffects ? "eskie" : "native",
        visual: visualResolution,
        tracer: tracerResolution,
        effectName
      });
    } catch (error) {
      this.#stats.errors += 1;
      Logger.error("Crosshair placement failed", error);
      throw error;
    } finally {
      try {
        await globalThis.Sequencer?.EffectManager?.endEffects?.({ name: effectName });
      } catch (cleanupError) {
        Logger.warn("Crosshair visual cleanup failed", cleanupError);
      }
    }
  }

  getStats() {
    const status = this.getEskieStatus();
    return Object.freeze({
      ...this.#stats,
      status,
      catalog: Object.freeze({
        premium: ESKIE_CROSSHAIR_CATALOG.premium.length,
        free: ESKIE_CROSSHAIR_CATALOG.free.length,
        shapes: [...ESKIE_CROSSHAIR_SHAPES]
      })
    });
  }

  #findEntry(source, criteria, color, allowStyleFallback) {
    const entries = ESKIE_CROSSHAIR_CATALOG[source] ?? [];
    const findFor = ({ style, variant }) => {
      let matching = entries.filter((entry) => entry.shape === criteria.shape
        && entry.style === style
        && entry.variant === variant
        && entry.base === criteria.base
        && entry.color === color);

      let selected = chooseSizedEntry(matching, criteria.size, criteria.sizeStrategy);
      if (selected) return selected;

      // Some asset families (Line/Reticle) do not define NoBase. If a caller
      // requests NoBase there, allowing a style fallback should still prefer a
      // usable same-style authored asset instead of dropping immediately native.
      if (criteria.base === "no_base") {
        matching = entries.filter((entry) => entry.shape === criteria.shape
          && entry.style === style
          && entry.variant === variant
          && entry.base === "full"
          && entry.color === color);
        selected = chooseSizedEntry(matching, criteria.size, criteria.sizeStrategy);
        if (selected) return selected;
      }
      return null;
    };

    const exactStyle = findFor({ style: criteria.style, variant: criteria.variant });
    if (exactStyle || !allowStyleFallback) return exactStyle;

    const defaults = ESKIE_CROSSHAIR_DEFAULTS[criteria.shape];
    return findFor({ style: defaults.style, variant: defaults.variant });
  }

  #resolution(entry, { requested, color, tint, source, fallback, reason }) {
    return Object.freeze({
      file: entry.path,
      tint,
      source,
      reason,
      fallback: Boolean(fallback),
      nativeFallback: false,
      requested: Object.freeze({ ...requested }),
      resolved: Object.freeze({
        shape: entry.shape,
        style: entry.style,
        variant: entry.variant,
        base: entry.base,
        size: entry.size,
        assetColor: entry.color,
        requestedColor: color
      })
    });
  }

  #nativeFallback(request, reason) {
    this.#stats.nativeFallbacks += 1;
    return Object.freeze({
      file: null,
      tint: null,
      source: "native",
      reason,
      fallback: true,
      nativeFallback: true,
      requested: Object.freeze({ ...request }),
      resolved: null
    });
  }

  async #startVisuals({ effectName, crosshair, source, visual, visualResolution, tracer, tracerResolution }) {
    const sequence = new globalThis.Sequence();

    if (tracer && source && tracerResolution?.file && !tracerResolution.nativeFallback) {
      let section = sequence
        .effect()
        .name(effectName)
        .file(tracerResolution.file)
        .attachTo(source)
        .stretchTo(crosshair, { attachTo: true })
        .opacity(Number(tracer.opacity ?? 0.8))
        .locally()
        .persist();
      if (tracerResolution.tint && typeof section.tint === "function") section = section.tint(tracerResolution.tint);
      if (tracer.belowTokens !== false && typeof section.belowTokens === "function") section = section.belowTokens();
    }

    if (visualResolution?.file && !visualResolution.nativeFallback) {
      let section = sequence.effect().name(effectName).file(visualResolution.file);
      const shape = lower(visual?.shape);
      if (shape === "line") {
        if (!source) throw new Error("An Eskie Line visual requires a source object because Line is a source-to-template tracer.");
        section = section.attachTo(source).stretchTo(crosshair, { attachTo: true });
      } else {
        section = section.attachTo(crosshair);
        if (visual?.scaleToObject !== false && typeof section.scaleToObject === "function") {
          section = section.scaleToObject(Number(visual?.scale ?? 1));
        }
      }

      section = section.opacity(Number(visual?.opacity ?? 0.8)).locally().persist();
      if (visualResolution.tint && typeof section.tint === "function") section = section.tint(visualResolution.tint);
      if (visual?.belowTokens !== false && typeof section.belowTokens === "function") section = section.belowTokens();
    }

    await sequence.play();
  }
}
