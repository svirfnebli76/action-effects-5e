import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Web knowledge is exposed only through dev/test validation and never api.web", async () => {
  const api = await readFile(new URL("../scripts/api.js", import.meta.url), "utf8");
  const harness = await readFile(new URL("../scripts/dev/test-harness.js", import.meta.url), "utf8");
  assert.doesNotMatch(api, /this\.web\s*=/);
  assert.match(api, /validateWebItem:\s*\(options\)\s*=>\s*tests\.validateWebItem/);
  assert.match(harness, /WebItemValidator/);
  assert.match(harness, /validateWebItem\(options\s*=\s*\{\}\)/);
});
