# Run from the module directory inside your Git checkout after copying v0.4.4.33.
# Deletes and stages only the explicitly retired tracked files; does not commit or push.
$ErrorActionPreference = 'Stop'
$manifest = Get-Content -LiteralPath 'module.json' -Raw | ConvertFrom-Json
if ($manifest.id -ne 'action-effects-5e' -or $manifest.version -ne '0.4.4.33') {
    throw 'Run from the updated Action Effects 5E v0.4.4.33 module directory.'
}
git rev-parse --is-inside-work-tree | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'This directory is not inside a Git checkout.' }
$obsolete = @(
    'scripts/crosshairs/crosshair-service.js',
    'scripts/crosshairs/eskie-crosshair-catalog.js',
    'scripts/crosshairs3d/placement-guide-service.js',
    'scripts/crosshairs3d/placement-overlay-service.js',
    'scripts/crosshairs3d/placement-visual-service.js',
    'scripts/dev/crosshair-test-suite.js',
    'tests/crosshair-3d-guide.test.mjs',
    'tests/crosshair-3d-overlay.test.mjs',
    'tests/crosshair-resolver.test.mjs'
)
git rm --ignore-unmatch -- $obsolete
if ($LASTEXITCODE -ne 0) { throw 'Git refused a deletion. Review local edits; this script will not force their removal.' }
Write-Host 'Obsolete tracked files deleted/staged. Review git status and the release change list before committing.'
