# Source-bound Line — v0.4.4.29 live acceptance

Built on v0.4.4.28. The existing Line test macro remains compatible. Keep `shape.width: 5` for the 5-ft targeting volume; do not change it to 3.5 to request the narrower art.

## Changes

- Line anchoring: continuous centerline/perimeter intersection replaces the inherited corner snap. Exactly west starts at the midpoint of the source's left face. Cone corner anchoring is unchanged. Source elevation, fixed XYZ length, and pitch handoff remain unchanged.
- Line art: 70% visual width, 0.17-grid-unit longitudinal fillets, flat terminal planes, subtly shaded camera-facing surfaces. Radius is capped at 95% of visual half-width for narrow shapes. The authoritative shape and affected-cell calculation remain full-width and unfilleted. Downward art stays red and endpoint elevation stays white. No new appearance options are required in macros.
- Alt: suppression remains, with a session-local recovery window armed by Alt/AltGraph. After a tracked modifier cycle, trusted pointer events with Alt released can resynchronize Ctrl/Shift. Synthetic events are ignored. Pointer motion before the modifier cycle does not prematurely disarm recovery. All listeners are removed on termination. Browser-native focus handling cannot be proven by the automated harness.

## Live tests

1. Rotate through west in both directions at 2.5-degree steps, targeting a same-elevation Token directly west. Repeat north, east, south; check a larger source if practical.
2. Check the shaded tube at pitch 0, positive/negative pitch, vertical, and through the opposite-side handoff. Targeting must retain its configured width even where artwork is inset.
3. Tap Alt before Ctrl; move the mouse; enter ELEVATE; release Ctrl; move again. Repeat with Alt during Ctrl and with Shift/ROTATE. Check both Alt keys if practical.
4. Verify normal Ctrl-held and Ctrl+Shift-held Sphere/Prism gauge behavior does not flicker. Test without Alt and after a recovered Alt cycle.
5. Confirm preserves final targets; cancel restores original targets. Temporary tube, endpoint label, HUD, gauge, and all input interception must clean up.

Checkpoint 2 remains open pending live acceptance. Freely placed Line and Checkpoints 3/4 are not implemented here.
