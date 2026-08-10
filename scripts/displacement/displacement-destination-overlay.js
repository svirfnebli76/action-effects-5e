import { DISPLACEMENT_DESTINATION_STATES } from "../core/constants.js";
import { Logger } from "../core/logger.js";

const COLORS = Object.freeze({
  [DISPLACEMENT_DESTINATION_STATES.CLEAR]: 0x4FC978,
  [DISPLACEMENT_DESTINATION_STATES.SOFT_CONFLICT]: 0xE6B84A,
  [DISPLACEMENT_DESTINATION_STATES.PARTIAL]: 0xE58A3A,
  [DISPLACEMENT_DESTINATION_STATES.BLOCKED]: 0xD95C5C
});

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
    const targetWidthSquares = Math.max(Number(targetToken?.width ?? 1), 0.001);
    const targetHeightSquares = Math.max(Number(targetToken?.height ?? 1), 0.001);
    const width = targetWidthSquares * gridSize;
    const height = targetHeightSquares * gridSize;
    const compactSelection = targetWidthSquares > 1 || targetHeightSquares > 1;
    const handleSize = Math.max(28, Math.min(gridSize * 0.44, 64));

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

      for (const candidate of candidates) {
        const displayPosition = candidate.selectable
          ? candidate.destination
          : candidate.requestedDestination;
        if (!displayPosition) continue;

        const color = COLORS[candidate.state] ?? 0xFFFFFF;

        // A 1x1 target can use the entire destination square as the click target.
        // Larger target footprints overlap one another for adjacent direction choices,
        // so render their full footprint only as a faint ghost and use a compact,
        // non-overlapping handle at the future token center for selection.
        if (!compactSelection) {
          const graphics = new PIXI.Graphics();
          drawRect(
            graphics,
            displayPosition.x,
            displayPosition.y,
            width,
            height,
            color,
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

        const ghost = new PIXI.Graphics();
        drawRect(
          ghost,
          displayPosition.x,
          displayPosition.y,
          width,
          height,
          color,
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

        const handle = new PIXI.Graphics();
        const centerX = displayPosition.x + (width / 2);
        const centerY = displayPosition.y + (height / 2);

        // Put the compact selector on the destination footprint's leading
        // edge/corner instead of its center. A one-grid-step displacement of
        // a Large+ token necessarily overlaps much of its starting footprint;
        // a centered handle can therefore sit on top of the token being moved.
        // The leading destination cell is both visually unambiguous and remains
        // associated with the full ghost footprint that will be occupied.
        const targetX = Number(targetToken?.x ?? 0);
        const targetY = Number(targetToken?.y ?? 0);
        const deltaX = Number(displayPosition.x) - targetX;
        const deltaY = Number(displayPosition.y) - targetY;
        const edgeInsetX = Math.min(gridSize / 2, width / 2);
        const edgeInsetY = Math.min(gridSize / 2, height / 2);

        let handleCenterX = centerX;
        let handleCenterY = centerY;

        if (deltaX > 0.001) handleCenterX = displayPosition.x + width - edgeInsetX;
        else if (deltaX < -0.001) handleCenterX = displayPosition.x + edgeInsetX;

        if (deltaY > 0.001) handleCenterY = displayPosition.y + height - edgeInsetY;
        else if (deltaY < -0.001) handleCenterY = displayPosition.y + edgeInsetY;

        drawRect(
          handle,
          handleCenterX - (handleSize / 2),
          handleCenterY - (handleSize / 2),
          handleSize,
          handleSize,
          color,
          {
            fillAlpha: candidate.selectable ? 0.5 : 0.2,
            strokeAlpha: candidate.selectable ? 1 : 0.72,
            strokeWidth: candidate.selectable ? 4 : 3
          }
        );
        handle.zIndex = 20;

        if (candidate.selectable) {
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
        } else {
          handle.eventMode = "none";
          handle.interactive = false;
        }

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
