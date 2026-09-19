# Source-bound Line — v0.4.4.28

Checkpoint 2 live testing build, based on v0.4.4.27. Cone, Sphere and Prism behavior is preserved. No propagation or persistent areas are added.

## API

Use `shape.type: "line"` and `placement: { mode: "source" }`. Supply `length`, `width`, `yaw` and `pitch`. Rotation and elevation increments are `controls.rotationStep` (degrees) and `controls.elevationStep` (Scene distance units); both may be 2.5. MOVE heading snapping uses the rotation increment too.

The old experimental `ray` name is rejected, and the public geometry helper is now `lineBasis`. Old freely placed `line` macros must not be reused unchanged: `line` now means source-bound. Remote/free live placement is rejected. The existing horizontal geometry is retained under `free-line` solely as groundwork for the later design.

Sequencer's invisible functional template still requires its own `ray` identifier internally; it is not an AE5E shape name. Legacy production 2D crosshairs and their asset catalog are unchanged.

## Geometry and presentation

The legal source-boundary XY anchor follows heading; source Z stays at the source Token's listed elevation, including downward pitch. The near face is centered on this anchor. Centerline length is fixed in XYZ, so increasing endpoint height shortens the XY projection. Pitch can cross vertical and hand off to the opposite source boundary. The deterministic W×W cross-section has no arbitrary roll.

The retained PIXI guide projects all eight authoritative tube vertices. It uses translucent teal faces, section contours, an endpoint dot and always-white absolute elevation text. Downward pitch turns the tube red. The instruction HUD is fixed in the viewport. Eskie artwork/tracers are disabled for this shape.

This is the project's explicit square-cross-section implementation, not a claim that D&D defines a cylindrical or square 3D Line volume.

## Live acceptance still required

Control exactly one disposable test Token. Test horizontal MOVE and repeated full-turn Shift-wheel rotation; Ctrl-wheel pitch above and below source; vertical footprint; crossing vertical in both directions; rapid wheel input; elevated targets; confirmation preserving final targets; cancellation restoring original targets; and complete input/visual cleanup. Source elevation must remain fixed and the guide/targets must share each accepted revision. Compare GM/Player hidden/invisible behavior without revealing target names or counts in player UI.

Freely placed Line is deliberately not part of this acceptance pass.
