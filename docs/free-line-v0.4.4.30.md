# Freely placed Line — v0.4.4.30 test build

Select a source token and execute docs/test-macros/free-line-v0.4.4.30.js as a Script macro after installing and reloading this build.

## Controls

- Mouse: move the center.
- Mousewheel: rotate about the center.
- Shift+wheel: extend/shorten both ends symmetrically, bounded by minLength and the original maximum length.
- Ctrl+wheel: raise/lower the entire line, keeping its ends level. Respects the existing reverse-elevation-wheel setting.
- Ctrl+Shift+wheel: no operation.
- Left-click: confirm. Right-click: cancel and restore prior targets.

Starts at the configured full length. Default length and elevation steps are one Scene grid-distance unit; default rotation step is 5 degrees. Holding a manipulation modifier locks mouse translation until released.

## API and placement rules

Use crosshairs3d.show({source, shape: {type: "free-line", length, width, height, yaw}, range: {max, policy}}). Also accepts type "line" with placement.mode "free"; omitted height then defaults to width.

Dimensions and range use Scene distance units. Live placement treats the supplied shape.origin as the initial interaction center; the returned placementPoint is the bottom-center. Returned shape.origin is the first endpoint, as required by the existing free-line geometry API. Height extends upward from the base elevation. These are horizontal lines; Ctrl changes base elevation, not pitch.

range.policy must be explicit:
- center: only bottom-center is constrained. Endpoints may extend beyond range.
- origin: the first bottom endpoint is constrained and highlighted white. It never switches automatically to whichever endpoint is closer.
- endpoints: both bottom endpoints must remain in range. Thickness corners and the top of the wall are not separately constrained.

The faint boundary is the horizontal slice of the existing Euclidean XYZ range around the source occupied cuboid. It shrinks above/below the source vertical extent, and can look like a rounded rectangle around a large source. This is an AE5E measurement policy, not a claim that all 2024 spells require endpoint containment or Euclidean grid measurement. Set range.showBoundary false to hide it.

Range-limited operations stop at the boundary and may produce partial length/elevation/rotation increments. They never automatically shorten the line to permit a move. If the full length cannot fit under the endpoint policy at initial yaw, placement fails before input listeners are installed. Configure the spell's dimensions and range policy accordingly.

Existing surface resolution applies during mouse movement. Existing LOS validation is applied to the center (center/endpoints policy) or first endpoint (origin policy); this does not implement spell-specific supporting-surface, panel, obstruction, or propagation rules. No persistent Region or wall is created. Preview is a horizontal footprint with height and elevation readouts. Source-bound filleted tube graphics remain unchanged.

## Live acceptance

1. Verify full-length startup, centered rotation, symmetric resize and both length limits.
2. Raise/lower, then move; check both ends remain level and targets change with the full width/height.
3. Move, rotate, resize and elevate against the faint range boundary. Try center and origin policies separately.
4. Tap Alt before/during Ctrl and Shift, release, then resume each operation.
5. Rapidly wheel and immediately confirm; verify final dimensions match. Cancel another run and verify old targets return.
6. Ensure all preview graphics and input interception disappear. Recheck the accepted source-bound Line macro.
