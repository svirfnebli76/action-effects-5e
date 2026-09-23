# Update to Action Effects 5E v0.4.4.34

This patch fixes immediate cancellation when the included DialogV2 launcher closes. The dialog button's descendant blur is ignored; a real browser-window blur still cancels and cleans the placement session.

When updating an existing v0.4.4.33 checkout, copy the contents of the v0.4.4.34 ZIP over the module folder, then remove the obsolete documentation macro:

```bash
git rm --ignore-unmatch -- docs/acceptance-crosshairs3d-v0.4.4.33.txt
git add -A -- .
npm test
git commit -m "Fix Dialog blur cancellation in AE5E v0.4.4.34"
```

The only removed file is the v0.4.4.33 acceptance macro. Its v0.4.4.34 replacement is included. No runtime files require deletion, and packs and assets are unchanged.

After copying the module into Foundry's active Data/modules location, fully restart Foundry and use `docs/acceptance-crosshairs3d-v0.4.4.34.txt`.
