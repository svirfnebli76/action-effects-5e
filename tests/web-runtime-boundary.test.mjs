import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

async function collectFiles(root) {
  const out = [];
  for (const name of await readdir(root)) {
    const full = path.join(root, name);
    const info = await stat(full);
    if (info.isDirectory()) {
      if (name === "dev") continue;
      out.push(...await collectFiles(full));
    } else if (name.endsWith(".js")) out.push(full);
  }
  return out;
}

test("AE5E production runtime contains no Web-specific spell implementation", async () => {
  const root = fileURLToPath(new URL("../scripts/", import.meta.url));
  const files = await collectFiles(root);
  const forbidden = [
    "Web Save",
    "Restrained by Web",
    "Escape Web",
    "Burning Web Damage",
    "WEB_ACTIVITY_REFERENCES",
    "WEB_FLAG_KEY",
    "WEB_PROFILE_ID",
    "WEB_SCHEMA_VERSION",
    "WebService",
    "WebRegionBehaviorType",
    "web.regionEvent"
  ];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const term of forbidden) {
      assert.equal(source.includes(term), false, `${path.relative(root, file)} must not contain runtime Web rule '${term}'`);
    }
  }
});
