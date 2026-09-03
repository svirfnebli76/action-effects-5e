import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const macroUrl = new URL("../docs/item-macros/web-2024-premium.txt", import.meta.url);

async function source() {
  return readFile(macroUrl, "utf8");
}

test("Web Premium ItemMacro parses as a Foundry-style async macro body and covers both configured passes", async () => {
  const text = await source();
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  assert.doesNotThrow(() => new AsyncFunction("args", "workflow", "item", "actor", "token", "canvas", "game", "ui", text));
  assert.match(text, /macroPass === "preItemRoll"/);
  assert.match(text, /macroPass\s*===\s*"postActiveEffects"/);
  assert.match(text, /webActivity\?\.name/);
  assert.match(text, /!==\s*"cast web"[\s\S]*?return true/);
});

test("Web Premium ItemMacro owns fixed-square placement targeting while delegating Web runtime mechanics to AE5E", async () => {
  const text = await source();
  assert.match(text, /ae5e\.crosshairs\.show\(/);
  assert.match(text, /ae5e\.crosshairs\.resolveAsset\(/);
  assert.match(text, /collectTargets:\s*false/);
  assert.match(text, /collectWebSquareTargets\(/);
  assert.match(text, /canvas\.tokens\.setTargets\(/);
  assert.match(text, /sameTargetSet\(/);
  assert.match(text, /new\s+Sequence\s*\(/);
  assert.match(text, /ae5e\.web\.commitCast\(/);
  assert.doesNotMatch(text, /ae5e\.web\.placeCast\(/);
  assert.doesNotMatch(text, /ae5e\.web\.restorePlacementTargets\(/);
  assert.doesNotMatch(text, /createEmbeddedDocuments\s*\(\s*["']Region["']/);
  assert.doesNotMatch(text, /new\s+Roll\s*\(/);
  assert.doesNotMatch(text, /MidiQOL\./);
  assert.match(text, /Web Save and Burning Web Damage/);
  assert.match(text, /ESCAPE_WEB_TEMPLATE_UUID/);
  assert.match(text, /restraintOngoingAction/);
  assert.match(text, /templateUuid:\s*ESCAPE_WEB_TEMPLATE_UUID/);
  assert.match(text, /activityIdentifier:\s*"escape-web"/);
  assert.match(text, /indicatorRole:\s*"responder"/);
});
