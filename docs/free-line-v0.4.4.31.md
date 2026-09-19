# Free Line v0.4.4.31

Corrects v0.4.4.30 elevation near range limits: each Ctrl+wheel tick either moves a full elevationStep or does nothing. The last legal whole step is retained, even if the continuous range boundary lies slightly farther away. Reversing direction immediately moves a complete step. Starting on a fractional terrain elevation still preserves that starting offset; no range clamp adds a new fractional offset.

Both dimensions and elevation labels rotate parallel to the line, with their positional offsets rotated about its midpoint. Text remains upright; mode and instruction HUD stays horizontal.

Use docs/test-macros/free-line-v0.4.4.31.js. It retains the 60-ft maximum length, 5-ft thickness, 20-ft height and 120-ft endpoint range for comparison. Thickness is shape.width; set it per item. No change to targeting rules or spell integration.

Live check: elevate to the ceiling, wheel several extra ticks, then descend. All heights should remain on the original 5-ft sequence. Repeat downward, with center/origin policies, and rotate a full turn to inspect both labels. Confirm/cancel should clean everything up.

The v0.4.4.30 note allowing partial elevation increments is superseded by this release. Continuous clamping of movement, rotation and length is unchanged.
