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
  assert.match(suite, /const actorId =/);
  assert.match(suite, /actorId,/);
  assert.match(suite, /actorLink:\s*false/);
  assert.doesNotMatch(suite, /actorId:\s*null/);
  assert.match(suite, /sight:\s*\{\s*enabled:\s*false\s*\}/);
  assert.doesNotMatch(suite, /const token = duplicateSafely\(sourceData\)/);
  assert.match(suite, /cleanupStaleAttachmentFixtureRegions/);
  assert.match(suite, /rotationOffset:\s*-sourceOrigin\.rotation/);
  assert.match(suite, /const translationVolume = this\.#cells\.getCellWorldVolume/);
  assert.match(suite, /const rotationVolume = this\.#cells\.getCellWorldVolume/);
  assert.match(suite, /Attachment fixture geometry is ambiguous/);
  assert.match(suite, /catch \(error\) \{[\s\S]*this\.#regions\.delete\(region\)/);
  assert.match(suite, /const createdByName = new Map\(created\.map/);
  assert.match(suite, /const ordered = placements\.map\(placement => createdByName\.get\(placement\.name\)\)/);
  assert.match(suite, /return ordered;/);
});
