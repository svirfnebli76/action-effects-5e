import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const entry = fs.readFileSync(new URL("../scripts/action-effects-5e.js", import.meta.url), "utf8");
const harness = fs.readFileSync(new URL("../scripts/dev/test-harness.js", import.meta.url), "utf8");

test("persistent-area services are threaded through live TestHarness startup wiring", () => {
  assert.match(
    entry,
    /const\s+tests\s*=\s*new\s+TestHarness\s*\(\s*\{[\s\S]*?persistentAreaEvents\s*,[\s\S]*?persistentAreaLifecycle\s*,[\s\S]*?\}\s*\)/,
    "module entry must pass persistentAreaEvents and persistentAreaLifecycle into TestHarness"
  );

  const constructor = harness.match(/constructor\s*\(\s*\{([\s\S]*?)\}\s*\)\s*\{/);
  assert.ok(constructor, "TestHarness constructor destructuring must be discoverable");
  assert.match(constructor[1], /\bpersistentAreaEvents\b/, "TestHarness constructor must receive persistentAreaEvents");
  assert.match(constructor[1], /\bpersistentAreaLifecycle\b/, "TestHarness constructor must receive persistentAreaLifecycle");

  assert.match(
    harness,
    /new\s+EnvironmentalTestSuite\s*\(\s*\{[\s\S]*?persistentAreaEvents\s*,[\s\S]*?persistentAreaLifecycle\s*,[\s\S]*?\}\s*\)/,
    "TestHarness must forward both persistent-area services into EnvironmentalTestSuite"
  );

  assert.match(
    entry,
    /new\s+PersistentAreaEventService\s*\(\s*\{[\s\S]*?geometry\s*:\s*environmentGeometry[\s\S]*?\}\s*\)/,
    "PersistentAreaEventService must receive the shared EnvironmentGeometryService for generic Region event qualifiers"
  );
});
