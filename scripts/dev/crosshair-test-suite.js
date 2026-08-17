import { MODULE_ID } from "../core/constants.js";

function banner(text, color = "#18cc46", size = 20) {
  console.log(`%c${text}`, `font-size:${size}px;font-weight:bold;color:${color}`);
}

export class CrosshairTestSuite {
  #crosshairs;

  constructor({ crosshairs }) {
    this.#crosshairs = crosshairs;
  }

  async runFoundationTest({ notify = true } = {}) {
    const checks = [];
    const record = (name, passed, details = null) => {
      const entry = { name, passed: Boolean(passed), details };
      checks.push(entry);
      console.log(
        `%c${entry.passed ? "PASS" : "FAIL"}%c | ${name}`,
        `font-size:14px;font-weight:bold;color:${entry.passed ? "#18cc46" : "#ff5555"}`,
        "color:inherit",
        details ?? ""
      );
      return entry;
    };

    banner("AE5E 0.4.1.2 — ESKIE CROSSHAIR FOUNDATION", "#7ddcff", 26);

    const allCatalog = this.#crosshairs.getCatalog();
    const premiumCatalog = this.#crosshairs.getCatalog({ source: "premium" });
    const freeCatalog = this.#crosshairs.getCatalog({ source: "free" });
    const shapes = ["circle", "cone", "line", "ray", "rectangle", "reticle"];

    record("Premium catalog contains 244 supplied WebM assets", premiumCatalog.length === 244, { count: premiumCatalog.length });
    record("Free catalog contains the 52 confirmed white crosshair assets", freeCatalog.length === 52, { count: freeCatalog.length });
    record("All six Eskie crosshair shapes are cataloged", shapes.every(shape => premiumCatalog.some(entry => entry.shape === shape)), {
      shapes: Object.fromEntries(shapes.map(shape => [shape, premiumCatalog.filter(entry => entry.shape === shape).length]))
    });
    record("Free catalog covers all six Eskie crosshair shapes", shapes.every(shape => freeCatalog.some(entry => entry.shape === shape)), {
      freeShapes: [...new Set(freeCatalog.map(entry => entry.shape))]
    });

    const lineInfo = this.#crosshairs.getShapeInfo("line");
    const rayInfo = this.#crosshairs.getShapeInfo("ray");
    record("Line is classified as a source-to-template tracer", lineInfo?.role === "tracer", lineInfo);
    record("Ray is classified as the beam/path itself", rayInfo?.role === "beam", rayInfo);

    const premiumRed = this.#crosshairs.resolveAsset({
      shape: "circle",
      style: "fantasy_01",
      size: 30,
      color: "red"
    }, { status: { premium: true, free: true } });
    record("Premium exact color wins when available", premiumRed.source === "premium"
      && premiumRed.tint === null
      && premiumRed.file?.endsWith("Crosshair_Circle_Fantasy_01_Red_30ft.webm"), premiumRed);

    const asymmetric = this.#crosshairs.resolveAsset({
      shape: "circle",
      style: "generic_01",
      size: 60,
      color: "red",
      sizeStrategy: "exact"
    }, { status: { premium: true, free: false } });
    record("Known Generic_01 Red 60ft asymmetry falls back to premium white + tint", asymmetric.source === "premium"
      && asymmetric.tint
      && asymmetric.file?.endsWith("Crosshair_Circle_Generic_01_White_60ft.webm"), asymmetric);

    const freeTinted = this.#crosshairs.resolveAsset({
      shape: "circle",
      style: "fantasy_01",
      size: "30ft",
      color: "red"
    }, { status: { premium: false, free: true } });
    record("Free edition resolves colored Circle as white + tint", freeTinted.source === "free"
      && freeTinted.tint
      && freeTinted.file?.includes("eskie-effects-free")
      && freeTinted.file?.endsWith("White_30ft.webm"), freeTinted);

    const freeWhite = this.#crosshairs.resolveAsset({
      shape: "ray",
      size: 60,
      color: "white",
      base: "no_base"
    }, { status: { premium: false, free: true } });
    record("Free white Ray resolves without tint", freeWhite.source === "free"
      && freeWhite.tint === null
      && freeWhite.file?.endsWith("Crosshair_Ray_Fantasy_01_White_NoBase_60ft.webm"), freeWhite);

    const premiumRectangle = this.#crosshairs.resolveAsset({
      shape: "rectangle",
      size: [20, 10],
      color: "yellow",
      base: "no_base"
    }, { status: { premium: true, free: true } });
    record("Rectangle dimensions normalize to the authored premium asset", premiumRectangle.source === "premium"
      && premiumRectangle.file?.endsWith("Crosshair_Rectangle_Fantasy_01_Yellow_NoBase_20x10ft.webm"), premiumRectangle);

    const freeRectangle = this.#crosshairs.resolveAsset({
      shape: "rectangle",
      size: "20x10ft",
      color: "red"
    }, { status: { premium: false, free: true } });
    record("Free-only Rectangle resolves as white + tint", freeRectangle.source === "free"
      && freeRectangle.tint === "#ff0000"
      && freeRectangle.file?.endsWith("Crosshair_Rectangle_Fantasy_01_White_20x10ft.webm"), freeRectangle);

    const freeReticle = this.#crosshairs.resolveAsset({
      shape: "reticle",
      style: "generic_02",
      color: "teal"
    }, { status: { premium: false, free: true } });
    record("Free-only premium Reticle style falls back to Generic_01 white + tint", freeReticle.source === "free"
      && freeReticle.tint === "#00b7b7"
      && freeReticle.fallback === true
      && freeReticle.file?.endsWith("Crosshair_Reticle_Generic_01_White.webm"), freeReticle);

    const floorSize = this.#crosshairs.resolveAsset({
      shape: "circle",
      size: 25,
      color: "white"
    }, { status: { premium: true, free: false } });
    record("Default size strategy preserves Fireball-style floor sizing", floorSize.resolved?.size === "20ft", floorSize);

    const customTint = this.#crosshairs.resolveAsset({
      shape: "cone",
      variant: "wide",
      size: 30,
      color: "#ff66cc"
    }, { status: { premium: false, free: true } });
    record("Custom hex color uses free white artwork with the requested tint", customTint.source === "free"
      && customTint.tint === "#ff66cc"
      && customTint.file?.includes("White_30ft.webm"), customTint);

    const unsupported = this.#crosshairs.resolveAsset({ shape: "hexagon", color: "red" }, {
      status: { premium: true, free: true }
    });
    record("Unsupported visual shape fails safely to native", unsupported.nativeFallback === true, unsupported);

    record("Catalog getter returns immutable source data without losing entries", allCatalog.length === premiumCatalog.length + freeCatalog.length, {
      all: allCatalog.length,
      premium: premiumCatalog.length,
      free: freeCatalog.length
    });

    const runtime = this.#crosshairs.getEskieStatus();
    record("Runtime module detection exposes premium/free/Sequencer independently", Boolean(runtime?.premium?.id && runtime?.free?.id && runtime?.sequencer?.id), runtime);

    const passed = checks.every(check => check.passed);
    const report = {
      test: "AE5E 0.4.1.2 — Eskie Crosshair Foundation",
      version: game.modules.get(MODULE_ID)?.version ?? null,
      environment: {
        foundry: game.version,
        dnd5e: game.system.version,
        sequencer: game.modules.get("sequencer")?.version ?? null,
        eskiePremium: game.modules.get("eskie-effects")?.version ?? null,
        eskieFree: game.modules.get("eskie-effects-free")?.version ?? null
      },
      summary: {
        passed: checks.filter(check => check.passed).length,
        failed: checks.filter(check => !check.passed).length,
        total: checks.length
      },
      checks,
      crosshairs: this.#crosshairs.getStats()
    };

    console.table(checks.map((check, index) => ({ "#": index + 1, Check: check.name, Result: check.passed ? "PASS" : "FAIL" })));
    banner(`AE5E 0.4.1.2 CROSSHAIR FOUNDATION — ${report.summary.passed}/${report.summary.total} ${passed ? "PASS" : "FAIL"}`, passed ? "#18cc46" : "#ff5555", 28);
    console.log("AE5E crosshair foundation full result", report);
    if (notify && ui?.notifications) {
      ui.notifications[passed ? "info" : "error"](
        passed
          ? `AE5E 0.4.1.2 crosshair foundation passed (${report.summary.passed}/${report.summary.total}).`
          : `AE5E 0.4.1.2 crosshair foundation FAILED (${report.summary.failed} failing checks). See console.`
      );
    }
    return report;
  }

  async runInteractiveTest({ notify = true, color = "red", radius = 20, range = 150 } = {}) {
    if (!canvas?.ready) throw new Error("An active Scene canvas is required for the crosshair interactive test.");
    if (canvas.tokens.controlled.length !== 1) throw new Error("Control exactly one token for the crosshair interactive test.");

    const token = canvas.tokens.controlled[0];
    banner("AE5E 0.4.1.2 — CROSSHAIR INTERACTIVE CIRCLE + LINE", "#7ddcff", 26);
    console.log("AE5E crosshair interactive test | Click to place the crosshair, or cancel to test cancellation cleanup.");

    const result = await this.#crosshairs.show({
      source: token,
      type: "circle",
      distance: Number(radius),
      limitMaxRange: Number(range),
      visual: {
        shape: "circle",
        style: "fantasy_01",
        size: Number(radius),
        color,
        opacity: 0.8,
        belowTokens: true
      },
      tracer: {
        shape: "line",
        style: "generic_01",
        size: 90,
        color,
        opacity: 0.8,
        belowTokens: true
      }
    });

    const lingering = await globalThis.Sequencer?.EffectManager?.getEffects?.({ name: result.effectName }) ?? [];
    const report = {
      test: "AE5E 0.4.1.2 — Crosshair Interactive Circle + Line",
      result,
      cleanup: {
        effectName: result.effectName,
        lingeringEffects: lingering.length,
        passed: lingering.length === 0
      },
      runtime: this.#crosshairs.getEskieStatus()
    };

    const passed = report.cleanup.passed;
    banner(`AE5E 0.4.1.2 CROSSHAIR INTERACTIVE — ${passed ? "CLEANUP PASS" : "CLEANUP FAIL"}`, passed ? "#18cc46" : "#ff5555", 28);
    console.log("AE5E crosshair interactive result", report);
    if (notify && ui?.notifications) {
      ui.notifications[passed ? "info" : "error"](
        result.cancelled
          ? `AE5E crosshair cancellation cleanup ${passed ? "passed" : "failed"}.`
          : `AE5E crosshair placement cleanup ${passed ? "passed" : "failed"}.`
      );
    }
    return report;
  }
}
