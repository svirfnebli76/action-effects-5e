# Update to Action Effects 5E v0.4.4.33

This is the Checkpoint 2 PIXI integration build. Sequencer remains required for AE5E automations. The legacy crosshair API is removed immediately, with no compatibility redirect. Existing Items using it must wait for the agreed migration after Checkpoint 4.

## GitHub Desktop / local Git checkout (Windows)

1. Open a terminal **inside the Action Effects 5E module folder** containing `module.json` in your Git checkout. Run `git status`. Commit or otherwise preserve your current work before overlaying this release.
2. Create an update branch:

   ```powershell
   git switch -c ae5e-v0.4.4.33
   ```

3. Extract the release ZIP elsewhere. Copy the **contents** of its `action-effects-5e` folder over your module folder. Avoid nesting another `action-effects-5e` directory. This copies new/modified files but does not remove old ones.
4. Run the included deletion script from that module folder:

   ```powershell
   & .\scripts\dev\apply-v0.4.4.33-deletions.ps1
   ```

   If your environment does not run PowerShell scripts, use the explicit `git rm` command below in Git Bash. Neither path forces deletion of locally modified obsolete files. Inspect and preserve any local edits Git reports before retrying.
5. Review `git status` and `git diff`. If your checkout was clean before the update and shows only the release changes listed below, stage and validate:

   ```powershell
   git add -A -- .
   git diff --cached --stat
   npm test
   git commit -m "Integrate PIXI crosshairs in AE5E v0.4.4.33"
   git push -u origin ae5e-v0.4.4.33
   ```

   These commands publish your new branch when you choose to run them; no GitHub push or merge has been performed for you. Use GitHub Desktop's commit/publish controls instead if preferred.

## Git Bash / Linux / macOS deletion

Run from the updated module folder:

```bash
bash scripts/dev/apply-v0.4.4.33-deletions.sh
```

Or run this exact deletion command in Git Bash (no script required):

```bash
git rm --ignore-unmatch -- \
  scripts/crosshairs/crosshair-service.js \
  scripts/crosshairs/eskie-crosshair-catalog.js \
  scripts/crosshairs3d/placement-guide-service.js \
  scripts/crosshairs3d/placement-overlay-service.js \
  scripts/crosshairs3d/placement-visual-service.js \
  scripts/dev/crosshair-test-suite.js \
  tests/crosshair-3d-guide.test.mjs \
  tests/crosshair-3d-overlay.test.mjs \
  tests/crosshair-resolver.test.mjs
```

`git rm` records deletions in your local Git index; committing and pushing carries those deletions to GitHub. Do not use `git clean`, forced resets, or broad folder deletion for this update. The now-empty `scripts/crosshairs/` folder disappears because Git does not track empty folders.

## Foundry installation

For a separate Foundry Data/modules copy, close the world/server as appropriate and replace the entire old `action-effects-5e` folder with the ZIP's folder, preserving a backup first. If you overlay instead, manually remove every DELETE path below from that copy too. Reload Foundry and confirm module version **0.4.4.33**. Keep Sequencer enabled.

Copy the complete `docs/acceptance-crosshairs3d-v0.4.4.33.txt` into a Script Macro, select a source Token, and test every shape. Its PASS banner checks lifecycle only; follow `docs/testing.md` for visual/targeting acceptance. Packs and assets are unchanged. No persistent Regions are created by the launcher.

## Exact file changes relative to v0.4.4.32

### DELETE (9)

```text
scripts/crosshairs/crosshair-service.js
scripts/crosshairs/eskie-crosshair-catalog.js
scripts/crosshairs3d/placement-guide-service.js
scripts/crosshairs3d/placement-overlay-service.js
scripts/crosshairs3d/placement-visual-service.js
scripts/dev/crosshair-test-suite.js
tests/crosshair-3d-guide.test.mjs
tests/crosshair-3d-overlay.test.mjs
tests/crosshair-resolver.test.mjs
```

### ADD (14)

```text
UPDATE-v0.4.4.33.md
docs/acceptance-crosshairs3d-v0.4.4.33.txt
docs/validation-v0.4.4.33.md
scripts/crosshairs3d/pixi-placement-renderer.js
scripts/crosshairs3d/renderers/cone-renderer.js
scripts/crosshairs3d/renderers/cylinder-renderer.js
scripts/crosshairs3d/renderers/free-line-renderer.js
scripts/crosshairs3d/renderers/prism-renderer.js
scripts/crosshairs3d/renderers/shared.js
scripts/crosshairs3d/renderers/source-line-renderer.js
scripts/crosshairs3d/renderers/sphere-renderer.js
scripts/dev/apply-v0.4.4.33-deletions.ps1
scripts/dev/apply-v0.4.4.33-deletions.sh
tests/helpers/pixi-session-harness.mjs
```

### MODIFY (15)

```text
CHANGELOG.md
README.md
docs/architecture.md
docs/testing.md
module.json
package.json
scripts/action-effects-5e.js
scripts/api.js
scripts/core/constants.js
scripts/crosshairs3d/placement-session-service.js
scripts/dev/test-harness.js
tests/crosshair-3d-live-session.test.mjs
tests/crosshair-3d-public-api.test.mjs
tests/crosshair-3d-visual.test.mjs
tests/environmental-framework.test.mjs
```

