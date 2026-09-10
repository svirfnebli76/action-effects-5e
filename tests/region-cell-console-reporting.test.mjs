import test from "node:test";
import assert from "node:assert/strict";
import { formatConsoleDetails } from "../scripts/dev/region-cell-test-suite.js";

test("Region-cell console diagnostics safely serialize circular Foundry-style document graphs", () => {
  const scene = { id: "synthetic", regions: [] };
  const source = {
    uuid: "Scene.synthetic.Token.source",
    documentName: "Token",
    parent: scene,
    attachments: { regions: new Set() }
  };
  const region = {
    uuid: "Scene.synthetic.Region.region-cells",
    documentName: "Region",
    parent: scene
  };
  scene.regions.push(region);
  source.attachments.regions.add(region);

  const detail = [{ source, region, scene }];
  const output = formatConsoleDetails(detail);

  assert.equal(typeof output, "string");
  assert.match(output, /Scene\.synthetic\.Token\.source/);
  assert.match(output, /Scene\.synthetic\.Region\.region-cells/);
  assert.doesNotThrow(() => JSON.parse(output));
});

test("Region-cell console diagnostics tolerate generic circular objects", () => {
  const a = { name: "a" };
  const b = { name: "b", a };
  a.b = b;
  const output = formatConsoleDetails(a);
  assert.match(output, /\[Circular\]/);
  assert.doesNotThrow(() => JSON.parse(output));
});
