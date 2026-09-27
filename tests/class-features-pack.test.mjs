import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CAT_PUBLIC_AUTOMATION_PACK_IDS } from "../scripts/authoring/cat-metadata-authoring-service.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Class Features compendium is declared, grouped, present, and CAT-public", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf8"));
  const pack = manifest.packs.find(entry => entry.name === "class-features");

  assert.deepEqual(pack, {
    name: "class-features",
    label: "Class Features",
    path: "packs/class-features",
    type: "Item",
    system: "dnd5e"
  });

  const rootFolder = manifest.packFolders.find(folder => folder.name === "Action Effects 5E");
  const classFolder = rootFolder?.folders?.find(folder => folder.name === "Class Features");
  assert.ok(classFolder);
  assert.deepEqual(classFolder.packs, ["class-features"]);
  assert.deepEqual(classFolder.folders, []);

  const packPath = path.join(ROOT, pack.path);
  assert.equal(fs.existsSync(packPath), true);
  assert.equal(fs.existsSync(path.join(packPath, "CURRENT")), true);
  assert.equal(fs.existsSync(path.join(packPath, "MANIFEST-000190")), true);

  assert.equal(
    CAT_PUBLIC_AUTOMATION_PACK_IDS.includes("action-effects-5e.class-features"),
    true
  );
});
