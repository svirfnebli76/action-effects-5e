import { DISPLACEMENT_DESTINATION_STATES } from "../core/constants.js";
import { Logger } from "../core/logger.js";

const COLORS = Object.freeze({
  [DISPLACEMENT_DESTINATION_STATES.CLEAR]: 0x4FC978,
  [DISPLACEMENT_DESTINATION_STATES.SOFT_CONFLICT]: 0xE6B84A,
  [DISPLACEMENT_DESTINATION_STATES.PARTIAL]: 0xE58A3A,
  [DISPLACEMENT_DESTINATION_STATES.BLOCKED]: 0xD95C5C
});

// Large/Huge destination footprints overlap heavily. Their ghost footprint keeps
// the normal state color, while the compact click handle is deliberately a much
// brighter green so the actual selection target remains obvious.
const LARGE_TOKEN_SELECTOR_COLOR = 0x39FF14;

function drawRect(graphics, x, y, width, height, color, { fillAlpha = 0.22, strokeAlpha = 0.95, strokeWidth = 4 } = {}) {
  if (typeof graphics.rect === "function" && typeof graphics.fill === "function" && typeof graphics.stroke === "function") {
    graphics.rect(x, y, width, height);
    graphics.fill({ color, alpha: fillAlpha });
    graphics.stroke({ color, alpha: strokeAlpha, width: strokeWidth });
    return;
  }

  graphics.lineStyle?.(strokeWidth, color, strokeAlpha);
  graphics.beginFill?.(color, fillAlpha);
  graphics.drawRect?.(x, y, width, height);
  graphics.endFill?.();
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function buildLayout({ candidates = [], targetToken, gridSize }) {
  const resolvedGridSize = Math.max(1, finiteNumber(gridSize, 100));
  const targetWidthSquares = Math.max(finiteNumber(targetToken?.width, 1), 0.001);
  const targetHeightSquares = Math.max(finiteNumber(targetToken?.height, 1), 0.001);
  const width = targetWidthSquares * resolvedGridSize;
  const height = targetHeightSquares * resolvedGridSize;
  const compactSelection = targetWidthSquares > 1 || targetHeightSquares > 1;
  const handleSize = Math.max(28, Math.min(resolvedGridSize * 0.44, 64));
  const targetX = finiteNumber(targetToken?.x, 0);
  const targetY = finiteNumber(targetToken?.y, 0);

  return candidates.map((candidate, index) => {
    const displayPosition = candidate.selectable
      ? candidate.destination
      : candidate.requestedDestination;
    if (!displayPosition) return null;

    const stateColor = COLORS[candidate.state] ?? 0xFFFFFF;
    const footprint = {
      x: finiteNumber(displayPosition.x, 0),
      y: finiteNumber(displayPosition.y, 0),
      width,
      height
    };

    let handle = null;
    if (compactSelection && candidate.selectable) {
      const centerX = footprint.x + (width / 2);
      const centerY = footprint.y + (height / 2);
      const deltaX = footprint.x - targetX;
      const deltaY = footprint.y - targetY;
      const edgeInsetX = Math.min(resolvedGridSize / 2, width / 2);
      const edgeInsetY = Math.min(resolvedGridSize / 2, height / 2);

      let handleCenterX = centerX;
      let handleCenterY = centerY;
      if (deltaX > 0.001) handleCenterX = footprint.x + width - edgeInsetX;
      else if (deltaX < -0.001) handleCenterX = footprint.x + edgeInsetX;
      if (deltaY > 0.001) handleCenterY = footprint.y + height - edgeInsetY;
      else if (deltaY < -0.001) handleCenterY = footprint.y + edgeInsetY;

      handle = {
        x: handleCenterX - (handleSize / 2),
        y: handleCenterY - (handleSize / 2),
        width: handleSize,
        height: handleSize,
        centerX: handleCenterX,
        centerY: handleCenterY,
        color: LARGE_TOKEN_SELECTOR_COLOR
      };
    }

    return {
      index,
      candidate,
      candidateKey: candidate.key ?? null,
      state: candidate.state ?? null,
      selectable: candidate.selectable === true,
      displayPosition: {
        x: footprint.x,
        y: footprint.y,
        elevation: finiteNumber(displayPosition.elevation, 0)
      },
      compactSelection,
      stateColor,
      footprint,
      handle
    };
  }).filter(Boolean);
}

export class DisplacementDestinationOverlay {
  #container = null;
  #cancel = null;
  #keydown = null;

  clear({ cancelled = false } = {}) {
    if (this.#keydown) {
      globalThis.window?.removeEventListener?.("keydown", this.#keydown, true);
      this.#keydown = null;
    }
    if (this.#container) {
      try {
        this.#container.parent?.removeChild?.(this.#container);
        this.#container.destroy?.({ children: true });
      } catch (error) {
        Logger.debug("Could not fully destroy the displacement destination overlay.", error);
      }
      this.#container = null;
    }
    const cancel = this.#cancel;
    this.#cancel = null;
    if (cancelled && cancel) cancel();
  }

  /**
   * Pure geometry diagnostic used by Foundry-only regression tests. It exposes
   * the same footprint/compact-handle placement used by select() without
   * creating PIXI objects or opening an interaction.
   */
  describeLayout({ candidates = [], targetToken, gridSize = null } = {}) {
    const resolvedGridSize = finiteNumber(
      gridSize,
      finiteNumber(globalThis.canvas?.scene?.grid?.size ?? globalThis.canvas?.grid?.size, 100)
    );
    const layout = buildLayout({ candidates, targetToken, gridSize: resolvedGridSize });
    return {
      gridSize: resolvedGridSize,
      compactSelection: Math.max(finiteNumber(targetToken?.width, 1), finiteNumber(targetToken?.height, 1)) > 1,
      largeTokenSelectorColor: LARGE_TOKEN_SELECTOR_COLOR,
      entries: layout.map((entry) => ({
        candidateKey: entry.candidateKey,
        state: entry.state,
        selectable: entry.selectable,
        displayPosition: { ...entry.displayPosition },
        compactSelection: entry.compactSelection,
        stateColor: entry.stateColor,
        footprint: { ...entry.footprint },
        handle: entry.handle ? { ...entry.handle } : null
      }))
    };
  }

  async select({ candidates = [], targetToken, title = "Choose forced movement destination" } = {}) {
    this.clear({ cancelled: true });
    if (!canvas?.ready) throw new Error("A Scene canvas must be active to select a displacement destination.");
    const selectable = candidates.filter((candidate) => candidate?.selectable === true);
    if (!selectable.length) return null;
    if (selectable.length === 1) return selectable[0];

    const PIXI = globalThis.PIXI;
    if (!PIXI?.Container || !PIXI?.Graphics) {
      throw new Error("PIXI canvas primitives are unavailable for displacement destination selection.");
    }
    const parent = canvas.interface ?? canvas.controls ?? canvas.stage;
    if (!parent?.addChild) throw new Error("No suitable Foundry canvas group is available for displacement destination selection.");

    const gridSize = Number(canvas.scene?.grid?.size ?? canvas.grid?.size ?? 100);
    const layout = buildLayout({ candidates, targetToken, gridSize });
    const container = new PIXI.Container();
    container.name = "action-effects-5e-displacement-destinations";
    container.sortableChildren = true;

    const promise = new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        this.#cancel = null;
        this.clear();
        resolve(value);
      };
      this.#cancel = () => finish(null);

      for (const entry of layout) {
        const candidate = entry.candidate;

        // A 1x1 target can use the entire destination square as the click target.
        if (!entry.compactSelection) {
          const graphics = new PIXI.Graphics();
          drawRect(
            graphics,
            entry.footprint.x,
            entry.footprint.y,
            entry.footprint.width,
            entry.footprint.height,
            entry.stateColor,
            {
              fillAlpha: candidate.selectable ? 0.24 : 0.12,
              strokeAlpha: candidate.selectable ? 1 : 0.7,
              strokeWidth: candidate.selectable ? 4 : 3
            }
          );
          graphics.zIndex = 10;

          if (candidate.selectable) {
            graphics.eventMode = "static";
            graphics.interactive = true;
            graphics.cursor = "pointer";
            graphics.on?.("pointerover", () => { graphics.alpha = 0.7; });
            graphics.on?.("pointerout", () => { graphics.alpha = 1; });
            graphics.on?.("pointertap", (event) => {
              event?.stopPropagation?.();
              finish(candidate);
            });
          } else {
            graphics.eventMode = "none";
            graphics.interactive = false;
          }

          container.addChild(graphics);
          continue;
        }

        // Large+ destinations keep a faint, state-colored footprint ghost.
        const ghost = new PIXI.Graphics();
        drawRect(
          ghost,
          entry.footprint.x,
          entry.footprint.y,
          entry.footprint.width,
          entry.footprint.height,
          entry.stateColor,
          {
            fillAlpha: candidate.selectable ? 0.045 : 0.025,
            strokeAlpha: candidate.selectable ? 0.62 : 0.42,
            strokeWidth: candidate.selectable ? 3 : 2
          }
        );
        ghost.zIndex = 10;
        ghost.eventMode = "none";
        ghost.interactive = false;
        container.addChild(ghost);

        // Only selectable Large+ destinations receive the compact bright-green
        // target box. Blocked footprints remain visible in red without adding a
        // misleading disabled selection handle.
        if (!entry.handle) continue;

        const handle = new PIXI.Graphics();
        drawRect(
          handle,
          entry.handle.x,
          entry.handle.y,
          entry.handle.width,
          entry.handle.height,
          entry.handle.color,
          {
            fillAlpha: 0.62,
            strokeAlpha: 1,
            strokeWidth: 4
          }
        );
        handle.zIndex = 20;
        handle.eventMode = "static";
        handle.interactive = true;
        handle.cursor = "pointer";
        handle.on?.("pointerover", () => {
          handle.alpha = 0.72;
          ghost.alpha = 1;
        });
        handle.on?.("pointerout", () => {
          handle.alpha = 1;
          ghost.alpha = 1;
        });
        handle.on?.("pointertap", (event) => {
          event?.stopPropagation?.();
          finish(candidate);
        });
        container.addChild(handle);
      }

      this.#keydown = (event) => {
        if (event.key !== "Escape") return;
        event.preventDefault?.();
        event.stopPropagation?.();
        finish(null);
      };
      globalThis.window?.addEventListener?.("keydown", this.#keydown, true);
    });

    parent.addChild(container);
    this.#container = container;
    ui?.notifications?.info?.(`${title}: Select a destination. Press Esc to cancel.`);
    return promise;
  }
}
