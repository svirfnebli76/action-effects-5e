import { Crosshair3dGeometryService } from "../../scripts/crosshairs3d/geometry-service.js";
import { Crosshair3dCellRasterizerService } from "../../scripts/crosshairs3d/cell-rasterizer-service.js";
import { Crosshair3dTokenVolumeService } from "../../scripts/crosshairs3d/token-volume-service.js";
import { Crosshair3dRangeService } from "../../scripts/crosshairs3d/range-service.js";
import { Crosshair3dPlacementRevisionService } from "../../scripts/crosshairs3d/placement-revision-service.js";
import { Crosshair3dTargetingGeometryService } from "../../scripts/crosshairs3d/targeting-geometry-service.js";
import { Crosshair3dCanvasMetricsService } from "../../scripts/crosshairs3d/canvas-metrics-service.js";
import { Crosshair3dPlacementSessionService } from "../../scripts/crosshairs3d/placement-session-service.js";
import { Crosshair3dPixiPlacementRenderer } from "../../scripts/crosshairs3d/pixi-placement-renderer.js";

export function installPixi() {
  const records = { graphics: [], texts: [] };
  class Point { constructor(x = 0, y = 0) { this.x = x; this.y = y; } set(x, y = x) { this.x = x; this.y = y; } }
  class Container {
    constructor() { this.children = []; this.position = new Point(); this.pivot = new Point(); this.scale = new Point(1, 1); this.rotation = 0; this.alpha = 1; this.visible = true; }
    addChild(...children) { for (const c of children) { c.parent = this; this.children.push(c); } return children[0]; }
    removeChild(c) { this.children = this.children.filter(v => v !== c); c.parent = null; }
    destroy() { this.destroyed = true; for (const c of [...this.children]) c.destroy(); this.children = []; }
    toLocal(p) { return p; }
  }
  class Graphics extends Container {
    constructor() { super(); this.commands = []; records.graphics.push(this); }
    clear() { this.commands = []; return this; }
  }
  for (const name of ['lineStyle', 'beginFill', 'endFill', 'drawPolygon', 'drawCircle', 'drawEllipse', 'drawRect', 'drawRoundedRect', 'moveTo', 'lineTo', 'arc', 'closePath', 'bezierCurveTo', 'quadraticCurveTo']) {
    Graphics.prototype[name] = function(...args) {
      for (const n of args.flat(Infinity)) if (typeof n === 'number' && !Number.isFinite(n)) throw new Error(`Non-finite ${name}`);
      this.commands.push([name, ...args]); return this;
    };
  }
  class Text extends Container {
    constructor(text = '', style = {}) { super(); this.text = text; this.style = style; this.anchor = new Point(); this.resolution = 2; records.texts.push(this); }
    get width() { return this.text.length * (this.style.fontSize ?? 16) * .55; }
    get height() { return this.style.fontSize ?? 16; }
  }
  globalThis.PIXI = { Container, Graphics, Text, Point, TextStyle: class { constructor(s) { Object.assign(this, s); } }, UPDATE_PRIORITY: { HIGH: 25 } };
  return records;
}
function eventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    dispatch(type, event) { for (const fn of [...listeners.get(type) ?? []]) fn(event); },
    count() { return [...listeners.values()].reduce((a, b) => a + b.size, 0); }
  };
}
export function harness({ renderer: overrideRenderer, reverse = false, ground = 0, placementDependencies = {} } = {}) {
  const records = installPixi();
  const geometry = new Crosshair3dGeometryService(), metrics = new Crosshair3dCanvasMetricsService();
  const tokens = new Crosshair3dTokenVolumeService(), range = new Crosshair3dRangeService();
  const cells = new Crosshair3dCellRasterizerService({ geometry });
  const targeting = new Crosshair3dTargetingGeometryService({ cells, geometry, tokens });
  const scene = { id: 'test', grid: { size: 100, distance: 5, units: 'ft' } };
  const token = (id, x, y, elevation = 0) => ({ id, name: id, actor: {}, document: { id, x, y, width: 1, height: 1, depth: 1, elevation, parent: scene, uuid: `Scene.test.Token.${id}` } });
  const source = token('source', 0, 0), inside = token('inside', 150, 150), outside = token('outside', 1600, 1600);
  const placeables = [source, inside, outside];
  const ticker = new Set(), hooks = new Map(), win = eventTarget();
  const view = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 2000, height: 2000 }) };
  let now = 0;
  globalThis.performance = { now: () => now };
  globalThis.window = win;
  globalThis.game = { user: { targets: new Set([outside]) }, settings: { get: () => reverse } };
  globalThis.Hooks = { on(name, fn) { if (!hooks.has(name)) hooks.set(name, new Set()); hooks.get(name).add(fn); return fn; }, off(name, fn) { hooks.get(name)?.delete(fn); } };
  globalThis.CONST = { GRID_SNAPPING_MODES: { CENTER: 1 } };
  globalThis.foundry = { utils: { randomID: () => 'test-session' } };
  const history = [];
  globalThis.canvas = { ready: true, scene, grid: { isSquare: true, getSnappedPoint: p => p }, dimensions: { sceneRect: { x: 0, y: 0 } },
    stage: new PIXI.Container(), interface: new PIXI.Container(),
    app: { renderer: { view, screen: { width: 2000, height: 2000 }, resolution: 1 }, ticker: { add: fn => ticker.add(fn), remove: fn => ticker.delete(fn) } },
    tokens: { placeables, get: id => placeables.find(t => t.id === id), setTargets(ids) { history.push(ids); game.user.targets = new Set(ids.map(id => placeables.find(t => t.id === id)).filter(Boolean)); } } };
  delete globalThis.Sequencer; delete globalThis.Sequence;
  globalThis.MidiQOL = { isTargetable: () => true };
  const renderer = overrideRenderer ?? new Crosshair3dPixiPlacementRenderer();
  const service = new Crosshair3dPlacementSessionService({ geometry, tokens, range, revisions: new Crosshair3dPlacementRevisionService(), targeting,
    metrics, surfaces: { resolveAt: () => ({ elevation: typeof ground === 'function' ? ground() : ground }) }, renderer,
    ...placementDependencies });
  const dispatch = (type, extra = {}) => {
    const e = { target: view, clientX: 200, clientY: 200, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
      pointerId: 1, button: 0, preventDefault() { this.prevented = true; }, stopPropagation() {}, stopImmediatePropagation() {}, ...extra };
    win.dispatch(type, e); return e;
  };
  const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
  const tick = async (dt = 16) => { now += dt; for (const fn of [...ticker]) fn(); await flush(); };
  const confirm = async () => { dispatch('pointerdown'); dispatch('pointerup'); await tick(160); await flush(); };
  return { records, service, source, inside, outside, placeables, history, geometry, range, tokens, metrics, cells, renderer,
    dispatch, flush, tick, confirm, win, ticker, hooks, setNow: t => { now = t; },
    hook: (name, doc) => { for (const fn of hooks.get(name) ?? []) fn(doc); },
    clean: () => win.count() === 0 && ticker.size === 0 && [...hooks.values()].every(s => !s.size) && canvas.interface.children.length === 0 };
}
