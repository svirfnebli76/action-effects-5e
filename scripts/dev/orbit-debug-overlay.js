import { Logger } from "../core/logger.js";

/**
 * Ephemeral on-canvas visualization for relationship orbit testing. It never
 * creates Scene documents, Regions, Drawings, Tiles, or flags.
 */
export class OrbitDebugOverlay {
  #container = null;

  clear() {
    if (!this.#container) return false;
    try {
      this.#container.parent?.removeChild?.(this.#container);
      this.#container.destroy?.({ children: true });
    } catch (error) {
      Logger.debug("Could not fully destroy the orbit debug overlay.", error);
    }
    this.#container = null;
    return true;
  }

  show({ shell = [], currentIndex = null, leader = null, follower = null, grid = null } = {}) {
    this.clear();
    if (!canvas?.ready) throw new Error("A Scene canvas must be active to show the orbit debug overlay.");
    const PIXI = globalThis.PIXI;
    if (!PIXI?.Container || !PIXI?.Graphics || !PIXI?.Text) {
      throw new Error("PIXI canvas primitives are unavailable.");
    }
    const parent = canvas.interface ?? canvas.controls ?? canvas.stage;
    if (!parent?.addChild) throw new Error("No suitable Foundry canvas group is available for the orbit debug overlay.");

    const container = new PIXI.Container();
    container.name = "action-effects-5e-orbit-debug";
    container.eventMode = "none";
    const size = Number(grid?.size ?? canvas.grid?.size ?? 100);
    const followerWidth = Math.max(Number(follower?.width ?? 1), 0.001) * size;
    const followerHeight = Math.max(Number(follower?.height ?? 1), 0.001) * size;

    for (const position of shell) {
      const graphics = new PIXI.Graphics();
      const isCurrent = position.index === currentIndex;
      const lineWidth = isCurrent ? 4 : 2;
      try {
        if (typeof graphics.rect === "function" && typeof graphics.stroke === "function") {
          graphics.rect(position.x, position.y, followerWidth, followerHeight);
          graphics.stroke({ width: lineWidth, color: 0xFFFFFF, alpha: isCurrent ? 1 : 0.75 });
        } else {
          graphics.lineStyle?.(lineWidth, 0xFFFFFF, isCurrent ? 1 : 0.75);
          graphics.drawRect?.(position.x, position.y, followerWidth, followerHeight);
        }
      } catch {
        // The numeric labels remain useful even if the local PIXI build changes
        // its Graphics drawing API.
      }
      container.addChild(graphics);

      const labelText = String(position.index);
      let label;
      try {
        label = new PIXI.Text({
          text: labelText,
          style: { fontSize: Math.max(12, Math.round(size * 0.18)), fill: 0xFFFFFF, stroke: { color: 0x000000, width: 3 } }
        });
      } catch {
        label = new PIXI.Text(labelText, {
          fontSize: Math.max(12, Math.round(size * 0.18)),
          fill: 0xFFFFFF,
          stroke: 0x000000,
          strokeThickness: 3
        });
      }
      label.anchor?.set?.(0.5, 0.5);
      label.x = position.x + (followerWidth / 2);
      label.y = position.y + (followerHeight / 2);
      container.addChild(label);
    }

    parent.addChild(container);
    this.#container = container;
    return {
      shown: true,
      positions: shell.length,
      currentIndex,
      leaderUuid: leader?.uuid ?? null,
      followerUuid: follower?.uuid ?? null
    };
  }
}
