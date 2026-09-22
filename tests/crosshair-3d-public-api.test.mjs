import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("v0.4.4.38 exposes the canonical PIXI placement and propagation API and removes legacy crosshairs", () => {
  const apiSource = fs.readFileSync(new URL("../scripts/api.js", import.meta.url), "utf8");
  const mainSource = fs.readFileSync(new URL("../scripts/action-effects-5e.js", import.meta.url), "utf8");
  assert.match(apiSource, /this\.crosshairs3d\s*=\s*Object\.freeze/);
  assert.match(apiSource, /geometry:\s*Object\.freeze/);
  assert.match(apiSource, /cells:\s*Object\.freeze/);
  assert.match(apiSource, /tokens:\s*Object\.freeze/);
  assert.match(apiSource, /targeting:\s*Object\.freeze/);
  assert.match(apiSource, /range:\s*Object\.freeze/);
  assert.match(apiSource, /revisions:\s*Object\.freeze/);
  assert.match(apiSource, /propagation:\s*Object\.freeze/);
  assert.match(apiSource, /persistent:\s*Object\.freeze/);
  assert.match(apiSource, /createFoundryEnvironment/);
  assert.match(apiSource, /placement:\s*Object\.freeze/);
  assert.match(apiSource, /show:\s*\(options\)\s*=>\s*crosshairs3dPlacement\.show\(options\)/);
  assert.match(mainSource, /new Crosshair3dGeometryService/);
  assert.match(mainSource, /new Crosshair3dCellRasterizerService/);
  assert.match(mainSource, /new Crosshair3dTargetingGeometryService/);
  assert.match(mainSource, /new Crosshair3dPlacementSessionService/);
  assert.doesNotMatch(apiSource, /this\.crosshairs\s*=/, "legacy API has no wrapper or redirect");
  assert.doesNotMatch(mainSource, /crosshairs3d.*\.initialize\(\)/, "live 3D input remains session-scoped and opt-in rather than globally installed");
});
