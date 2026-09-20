#!/usr/bin/env bash
# Run from the updated module directory in a Git checkout. No commit or push.
set -euo pipefail
python3 - <<'CHECK'
import json
with open('module.json') as f: manifest=json.load(f)
if manifest.get('id')!='action-effects-5e' or manifest.get('version')!='0.4.4.33':
    raise SystemExit('Run from the updated Action Effects 5E v0.4.4.33 module directory.')
CHECK
git rev-parse --is-inside-work-tree >/dev/null
git rm --ignore-unmatch -- \
  'scripts/crosshairs/crosshair-service.js' \
  'scripts/crosshairs/eskie-crosshair-catalog.js' \
  'scripts/crosshairs3d/placement-guide-service.js' \
  'scripts/crosshairs3d/placement-overlay-service.js' \
  'scripts/crosshairs3d/placement-visual-service.js' \
  'scripts/dev/crosshair-test-suite.js' \
  'tests/crosshair-3d-guide.test.mjs' \
  'tests/crosshair-3d-overlay.test.mjs' \
  'tests/crosshair-resolver.test.mjs'
printf '%s\n' 'Obsolete tracked files deleted/staged. Review git status and the release change list before committing.'
