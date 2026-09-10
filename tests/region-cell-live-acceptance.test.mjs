import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("Region Cell physical live-acceptance harness is wired through TestHarness and public API", () => {
  const harness = fs.readFileSync(new URL("../scripts/dev/test-harness.js", import.meta.url), "utf8");
  const api = fs.readFileSync(new URL("../scripts/api.js", import.meta.url), "utf8");
  const suite = fs.readFileSync(new URL("../scripts/dev/region-cell-live-acceptance-suite.js", import.meta.url), "utf8");

  assert.match(harness, /new RegionCellLiveAcceptanceSuite/);
  for (const name of [
    "setupRegionCellLiveMovementTest",
    "resetRegionCellLiveMovementTest",
    "reportRegionCellLiveMovementTest",
    "cleanupRegionCellLiveMovementTest",
    "setupRegionCellLiveAttachmentTest",
    "resetRegionCellLiveAttachmentTest",
    "reportRegionCellLiveAttachmentTest",
    "cleanupRegionCellLiveAttachmentTest",
    "cleanupRegionCellLiveAcceptance",
    "getRegionCellLiveAcceptanceStatus"
  ]) {
    assert.match(harness, new RegExp(name));
    assert.match(api, new RegExp(name));
  }
  assert.match(suite, /createTokenEmanation/);
  assert.match(suite, /measureMovementPath/);
});
