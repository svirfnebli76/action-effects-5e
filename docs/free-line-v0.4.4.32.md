# Free Line v0.4.4.32

Controls supersede the v0.4.4.30 mapping:
- Plain mousewheel: native Foundry canvas zoom; no AE5E preventDefault or propagation stop.
- Shift+wheel: rotate about midpoint.
- Ctrl+wheel: change whole-line elevation in complete steps.
- Alt+wheel: change length symmetrically.
- Multiple modifiers: no combined manipulation.
- Left-click confirms; right-click cancels.

Removed the free Line fixed HUD and separate hint badges. The mode label (Move, Rotate, Elevate, Length) now sits outside the top long edge at X in the supplied mockup. The instruction sentence sits outside the opposite long edge at Y: Shift to Rotate, Ctrl to Elevate, Alt to Alter Length. Disabled capabilities omit their instruction. Both labels and offsets rotate with the line, remaining upright. Dimensions and elevation are retained. Source-bound UI is untouched.

Wheel modifiers determine each operation directly. Alt key state only supports the mode display and temporary movement lock; keyup, trusted physical pointer input and blur recover it. Synthetic pointer events do not change modes. All listeners and labels are session-owned and removed on completion.

Live acceptance: check zoom at both limits without line rotation/resize, each modifier control, Alt release without moving the mouse, Alt release followed by pointer movement, full-turn label rotation, confirm/cancel cleanup, and the accepted source-bound UI. The test macro is docs/test-macros/free-line-v0.4.4.32.js.

Automated result: 370 tests pass, including plain-wheel pass-through, modifier mapping, Alt recovery, multiple-modifier suppression, plain rotating labels, cleanup, prior elevation-boundary regressions and source-bound regressions. Live browser/Foundry rendering remains to be verified.
