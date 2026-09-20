import { createRenderer as prism } from "./renderers/prism-renderer.js";
import { createRenderer as cylinder } from "./renderers/cylinder-renderer.js";
import { createRenderer as sphere } from "./renderers/sphere-renderer.js";
import { createRenderer as cone } from "./renderers/cone-renderer.js";
import { createRenderer as freeLine } from "./renderers/free-line-renderer.js";
import { createRenderer as sourceLine } from "./renderers/source-line-renderer.js";

const renderers = Object.freeze({ prism, cylinder, sphere, cone, "free-line": freeLine, line: sourceLine });
/** Every session owns its complete PIXI tree, including partial-init cleanup. */
export class Crosshair3dPixiPlacementRenderer {
  #root = null;
  #renderer = null;
  show(context) {
    this.clear();
    try {
      this.#root = new PIXI.Container();
      this.#root.name = "ae5e-crosshairs3d-placement";
      this.#root.eventMode = "none";
      globalThis.canvas.interface.addChild(this.#root);
      const create = renderers[context.shape.type];
      if (!create) throw new Error(`No PIXI renderer for ${context.shape.type}.`);
      this.#renderer = create({ ...context, parent: this.#root });
    } catch (error) { this.clear(); throw error; }
  }
  update(revision, mode) { this.#renderer?.update(revision, mode); }
  frame(now) { this.#renderer?.frame(now); }
  clear() {
    try { this.#renderer?.clear(); }
    finally {
      this.#renderer = null;
      this.#root?.parent?.removeChild(this.#root);
      this.#root?.destroy({ children: true });
      this.#root = null;
    }
  }
}
