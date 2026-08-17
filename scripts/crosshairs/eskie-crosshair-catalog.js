/**
 * Eskie Effects crosshair asset catalog.
 *
 * Premium entries are generated from the user-supplied Eskie Effects 1.9.0
 * Crosshair archive. Free entries mirror the user-confirmed free-module
 * crosshair surface, including Circle, Cone, Line, Ray, Rectangle, and Reticle.
 *
 * Paths are explicit by design. The premium archive contains at least one
 * asymmetric filename/size combination, so AE5E must not synthesize paths
 * from an assumed perfectly rectangular matrix.
 */

export const ESKIE_PREMIUM_MODULE_ID = "eskie-effects";
export const ESKIE_FREE_MODULE_ID = "eskie-effects-free";
export const SEQUENCER_MODULE_ID = "sequencer";

export const ESKIE_CROSSHAIR_SHAPES = Object.freeze([
  "circle",
  "cone",
  "line",
  "ray",
  "rectangle",
  "reticle"
]);

export const ESKIE_CROSSHAIR_SEMANTICS = Object.freeze({
  circle: Object.freeze({ role: "area", description: "Circular area/template visual." }),
  cone: Object.freeze({ role: "area", description: "Cone area/template visual." }),
  line: Object.freeze({ role: "tracer", description: "Source-to-template tracer; the line is not itself the affected beam area." }),
  ray: Object.freeze({ role: "beam", description: "Beam/path visual; the ray represents the path the effect itself travels." }),
  rectangle: Object.freeze({ role: "area", description: "Rectangular area/template visual." }),
  reticle: Object.freeze({ role: "point", description: "Point, creature, or destination selection reticle." })
});

export const ESKIE_CROSSHAIR_COLORS = Object.freeze([
  "red",
  "teal",
  "white",
  "yellow"
]);

// These are deliberate approximations for tinting the free white artwork.
// Native premium recolors always win when the exact requested asset exists.
export const ESKIE_TINT_APPROXIMATIONS = Object.freeze({
  red: "#ff0000",
  teal: "#00b7b7",
  white: "#ffffff",
  yellow: "#ffd400"
});

export const ESKIE_PREMIUM_CROSSHAIR_ASSETS = Object.freeze([
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "fantasy_01",
  color: "red",
  base: "full",
  size: "10ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Fantasy_01/Crosshair_Circle_Fantasy_01_Red_10ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "fantasy_01",
  color: "red",
  base: "full",
  size: "20ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Fantasy_01/Crosshair_Circle_Fantasy_01_Red_20ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "fantasy_01",
  color: "red",
  base: "full",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Fantasy_01/Crosshair_Circle_Fantasy_01_Red_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "fantasy_01",
  color: "red",
  base: "full",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Fantasy_01/Crosshair_Circle_Fantasy_01_Red_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "fantasy_01",
  color: "red",
  base: "no_base",
  size: "10ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Fantasy_01/Crosshair_Circle_Fantasy_01_Red_NoBase_10ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "fantasy_01",
  color: "red",
  base: "no_base",
  size: "20ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Fantasy_01/Crosshair_Circle_Fantasy_01_Red_NoBase_20ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "fantasy_01",
  color: "red",
  base: "no_base",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Fantasy_01/Crosshair_Circle_Fantasy_01_Red_NoBase_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "fantasy_01",
  color: "red",
  base: "no_base",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Fantasy_01/Crosshair_Circle_Fantasy_01_Red_NoBase_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "fantasy_01",
  color: "teal",
  base: "full",
  size: "10ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Fantasy_01/Crosshair_Circle_Fantasy_01_Teal_10ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "fantasy_01",
  color: "teal",
  base: "full",
  size: "20ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Fantasy_01/Crosshair_Circle_Fantasy_01_Teal_20ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "fantasy_01",
  color: "teal",
  base: "full",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Fantasy_01/Crosshair_Circle_Fantasy_01_Teal_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "fantasy_01",
  color: "teal",
  base: "full",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Fantasy_01/Crosshair_Circle_Fantasy_01_Teal_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "fantasy_01",
  color: "teal",
  base: "no_base",
  size: "10ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Fantasy_01/Crosshair_Circle_Fantasy_01_Teal_NoBase_10ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "fantasy_01",
  color: "teal",
  base: "no_base",
  size: "20ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Fantasy_01/Crosshair_Circle_Fantasy_01_Teal_NoBase_20ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "fantasy_01",
  color: "teal",
  base: "no_base",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Fantasy_01/Crosshair_Circle_Fantasy_01_Teal_NoBase_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "fantasy_01",
  color: "teal",
  base: "no_base",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Fantasy_01/Crosshair_Circle_Fantasy_01_Teal_NoBase_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "10ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Fantasy_01/Crosshair_Circle_Fantasy_01_White_10ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "20ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Fantasy_01/Crosshair_Circle_Fantasy_01_White_20ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Fantasy_01/Crosshair_Circle_Fantasy_01_White_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Fantasy_01/Crosshair_Circle_Fantasy_01_White_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "10ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Fantasy_01/Crosshair_Circle_Fantasy_01_White_NoBase_10ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "20ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Fantasy_01/Crosshair_Circle_Fantasy_01_White_NoBase_20ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Fantasy_01/Crosshair_Circle_Fantasy_01_White_NoBase_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Fantasy_01/Crosshair_Circle_Fantasy_01_White_NoBase_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "fantasy_01",
  color: "yellow",
  base: "full",
  size: "10ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Fantasy_01/Crosshair_Circle_Fantasy_01_Yellow_10ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "fantasy_01",
  color: "yellow",
  base: "full",
  size: "20ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Fantasy_01/Crosshair_Circle_Fantasy_01_Yellow_20ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "fantasy_01",
  color: "yellow",
  base: "full",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Fantasy_01/Crosshair_Circle_Fantasy_01_Yellow_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "fantasy_01",
  color: "yellow",
  base: "full",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Fantasy_01/Crosshair_Circle_Fantasy_01_Yellow_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "fantasy_01",
  color: "yellow",
  base: "no_base",
  size: "10ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Fantasy_01/Crosshair_Circle_Fantasy_01_Yellow_NoBase_10ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "fantasy_01",
  color: "yellow",
  base: "no_base",
  size: "20ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Fantasy_01/Crosshair_Circle_Fantasy_01_Yellow_NoBase_20ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "fantasy_01",
  color: "yellow",
  base: "no_base",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Fantasy_01/Crosshair_Circle_Fantasy_01_Yellow_NoBase_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "fantasy_01",
  color: "yellow",
  base: "no_base",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Fantasy_01/Crosshair_Circle_Fantasy_01_Yellow_NoBase_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "generic_01",
  color: "red",
  base: "full",
  size: "10ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Generic_01/Crosshair_Circle_Generic_01_Red_10ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "generic_01",
  color: "red",
  base: "full",
  size: "20ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Generic_01/Crosshair_Circle_Generic_01_Red_20ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "generic_01",
  color: "red",
  base: "full",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Generic_01/Crosshair_Circle_Generic_01_Red_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "generic_01",
  color: "red",
  base: "full",
  size: "40ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Generic_01/Crosshair_Circle_Generic_01_Red_40ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "generic_01",
  color: "red",
  base: "no_base",
  size: "10ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Generic_01/Crosshair_Circle_Generic_01_Red_NoBase_10ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "generic_01",
  color: "red",
  base: "no_base",
  size: "20ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Generic_01/Crosshair_Circle_Generic_01_Red_NoBase_20ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "generic_01",
  color: "red",
  base: "no_base",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Generic_01/Crosshair_Circle_Generic_01_Red_NoBase_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "generic_01",
  color: "red",
  base: "no_base",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Generic_01/Crosshair_Circle_Generic_01_Red_NoBase_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "generic_01",
  color: "teal",
  base: "full",
  size: "10ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Generic_01/Crosshair_Circle_Generic_01_Teal_10ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "generic_01",
  color: "teal",
  base: "full",
  size: "20ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Generic_01/Crosshair_Circle_Generic_01_Teal_20ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "generic_01",
  color: "teal",
  base: "full",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Generic_01/Crosshair_Circle_Generic_01_Teal_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "generic_01",
  color: "teal",
  base: "full",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Generic_01/Crosshair_Circle_Generic_01_Teal_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "generic_01",
  color: "teal",
  base: "no_base",
  size: "10ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Generic_01/Crosshair_Circle_Generic_01_Teal_NoBase_10ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "generic_01",
  color: "teal",
  base: "no_base",
  size: "20ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Generic_01/Crosshair_Circle_Generic_01_Teal_NoBase_20ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "generic_01",
  color: "teal",
  base: "no_base",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Generic_01/Crosshair_Circle_Generic_01_Teal_NoBase_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "generic_01",
  color: "teal",
  base: "no_base",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Generic_01/Crosshair_Circle_Generic_01_Teal_NoBase_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "generic_01",
  color: "white",
  base: "full",
  size: "10ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Generic_01/Crosshair_Circle_Generic_01_White_10ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "generic_01",
  color: "white",
  base: "full",
  size: "20ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Generic_01/Crosshair_Circle_Generic_01_White_20ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "generic_01",
  color: "white",
  base: "full",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Generic_01/Crosshair_Circle_Generic_01_White_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "generic_01",
  color: "white",
  base: "full",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Generic_01/Crosshair_Circle_Generic_01_White_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "generic_01",
  color: "white",
  base: "no_base",
  size: "10ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Generic_01/Crosshair_Circle_Generic_01_White_NoBase_10ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "generic_01",
  color: "white",
  base: "no_base",
  size: "20ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Generic_01/Crosshair_Circle_Generic_01_White_NoBase_20ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "generic_01",
  color: "white",
  base: "no_base",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Generic_01/Crosshair_Circle_Generic_01_White_NoBase_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "generic_01",
  color: "white",
  base: "no_base",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Generic_01/Crosshair_Circle_Generic_01_White_NoBase_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "generic_01",
  color: "yellow",
  base: "full",
  size: "10ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Generic_01/Crosshair_Circle_Generic_01_Yellow_10ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "generic_01",
  color: "yellow",
  base: "full",
  size: "20ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Generic_01/Crosshair_Circle_Generic_01_Yellow_20ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "generic_01",
  color: "yellow",
  base: "full",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Generic_01/Crosshair_Circle_Generic_01_Yellow_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "generic_01",
  color: "yellow",
  base: "full",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Generic_01/Crosshair_Circle_Generic_01_Yellow_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "generic_01",
  color: "yellow",
  base: "no_base",
  size: "10ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Generic_01/Crosshair_Circle_Generic_01_Yellow_NoBase_10ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "generic_01",
  color: "yellow",
  base: "no_base",
  size: "20ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Generic_01/Crosshair_Circle_Generic_01_Yellow_NoBase_20ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "generic_01",
  color: "yellow",
  base: "no_base",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Generic_01/Crosshair_Circle_Generic_01_Yellow_NoBase_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "circle",
  variant: null,
  style: "generic_01",
  color: "yellow",
  base: "no_base",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Circle/Generic_01/Crosshair_Circle_Generic_01_Yellow_NoBase_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "thin",
  style: "fantasy_01",
  color: "red",
  base: "full",
  size: "15ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Thin/Fantasy_01/Crosshair_Cone_Thin_Fantasy_01_Red_15ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "thin",
  style: "fantasy_01",
  color: "red",
  base: "full",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Thin/Fantasy_01/Crosshair_Cone_Thin_Fantasy_01_Red_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "thin",
  style: "fantasy_01",
  color: "red",
  base: "full",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Thin/Fantasy_01/Crosshair_Cone_Thin_Fantasy_01_Red_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "thin",
  style: "fantasy_01",
  color: "red",
  base: "full",
  size: "90ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Thin/Fantasy_01/Crosshair_Cone_Thin_Fantasy_01_Red_90ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "thin",
  style: "fantasy_01",
  color: "red",
  base: "no_base",
  size: "15ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Thin/Fantasy_01/Crosshair_Cone_Thin_Fantasy_01_Red_NoBase_15ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "thin",
  style: "fantasy_01",
  color: "red",
  base: "no_base",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Thin/Fantasy_01/Crosshair_Cone_Thin_Fantasy_01_Red_NoBase_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "thin",
  style: "fantasy_01",
  color: "red",
  base: "no_base",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Thin/Fantasy_01/Crosshair_Cone_Thin_Fantasy_01_Red_NoBase_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "thin",
  style: "fantasy_01",
  color: "red",
  base: "no_base",
  size: "90ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Thin/Fantasy_01/Crosshair_Cone_Thin_Fantasy_01_Red_NoBase_90ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "thin",
  style: "fantasy_01",
  color: "teal",
  base: "full",
  size: "15ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Thin/Fantasy_01/Crosshair_Cone_Thin_Fantasy_01_Teal_15ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "thin",
  style: "fantasy_01",
  color: "teal",
  base: "full",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Thin/Fantasy_01/Crosshair_Cone_Thin_Fantasy_01_Teal_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "thin",
  style: "fantasy_01",
  color: "teal",
  base: "full",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Thin/Fantasy_01/Crosshair_Cone_Thin_Fantasy_01_Teal_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "thin",
  style: "fantasy_01",
  color: "teal",
  base: "full",
  size: "90ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Thin/Fantasy_01/Crosshair_Cone_Thin_Fantasy_01_Teal_90ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "thin",
  style: "fantasy_01",
  color: "teal",
  base: "no_base",
  size: "15ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Thin/Fantasy_01/Crosshair_Cone_Thin_Fantasy_01_Teal_NoBase_15ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "thin",
  style: "fantasy_01",
  color: "teal",
  base: "no_base",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Thin/Fantasy_01/Crosshair_Cone_Thin_Fantasy_01_Teal_NoBase_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "thin",
  style: "fantasy_01",
  color: "teal",
  base: "no_base",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Thin/Fantasy_01/Crosshair_Cone_Thin_Fantasy_01_Teal_NoBase_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "thin",
  style: "fantasy_01",
  color: "teal",
  base: "no_base",
  size: "90ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Thin/Fantasy_01/Crosshair_Cone_Thin_Fantasy_01_Teal_NoBase_90ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "thin",
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "15ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Thin/Fantasy_01/Crosshair_Cone_Thin_Fantasy_01_White_15ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "thin",
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Thin/Fantasy_01/Crosshair_Cone_Thin_Fantasy_01_White_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "thin",
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Thin/Fantasy_01/Crosshair_Cone_Thin_Fantasy_01_White_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "thin",
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "90ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Thin/Fantasy_01/Crosshair_Cone_Thin_Fantasy_01_White_90ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "thin",
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "15ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Thin/Fantasy_01/Crosshair_Cone_Thin_Fantasy_01_White_NoBase_15ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "thin",
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Thin/Fantasy_01/Crosshair_Cone_Thin_Fantasy_01_White_NoBase_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "thin",
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Thin/Fantasy_01/Crosshair_Cone_Thin_Fantasy_01_White_NoBase_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "thin",
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "90ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Thin/Fantasy_01/Crosshair_Cone_Thin_Fantasy_01_White_NoBase_90ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "thin",
  style: "fantasy_01",
  color: "yellow",
  base: "full",
  size: "15ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Thin/Fantasy_01/Crosshair_Cone_Thin_Fantasy_01_Yellow_15ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "thin",
  style: "fantasy_01",
  color: "yellow",
  base: "full",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Thin/Fantasy_01/Crosshair_Cone_Thin_Fantasy_01_Yellow_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "thin",
  style: "fantasy_01",
  color: "yellow",
  base: "full",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Thin/Fantasy_01/Crosshair_Cone_Thin_Fantasy_01_Yellow_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "thin",
  style: "fantasy_01",
  color: "yellow",
  base: "full",
  size: "90ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Thin/Fantasy_01/Crosshair_Cone_Thin_Fantasy_01_Yellow_90ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "thin",
  style: "fantasy_01",
  color: "yellow",
  base: "no_base",
  size: "15ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Thin/Fantasy_01/Crosshair_Cone_Thin_Fantasy_01_Yellow_NoBase_15ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "thin",
  style: "fantasy_01",
  color: "yellow",
  base: "no_base",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Thin/Fantasy_01/Crosshair_Cone_Thin_Fantasy_01_Yellow_NoBase_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "thin",
  style: "fantasy_01",
  color: "yellow",
  base: "no_base",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Thin/Fantasy_01/Crosshair_Cone_Thin_Fantasy_01_Yellow_NoBase_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "thin",
  style: "fantasy_01",
  color: "yellow",
  base: "no_base",
  size: "90ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Thin/Fantasy_01/Crosshair_Cone_Thin_Fantasy_01_Yellow_NoBase_90ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "wide",
  style: "fantasy_01",
  color: "red",
  base: "full",
  size: "15ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Wide/Fantasy_01/Crosshair_Cone_Wide_Fantasy_01_Red_15ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "wide",
  style: "fantasy_01",
  color: "red",
  base: "full",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Wide/Fantasy_01/Crosshair_Cone_Wide_Fantasy_01_Red_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "wide",
  style: "fantasy_01",
  color: "red",
  base: "full",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Wide/Fantasy_01/Crosshair_Cone_Wide_Fantasy_01_Red_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "wide",
  style: "fantasy_01",
  color: "red",
  base: "full",
  size: "90ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Wide/Fantasy_01/Crosshair_Cone_Wide_Fantasy_01_Red_90ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "wide",
  style: "fantasy_01",
  color: "red",
  base: "no_base",
  size: "15ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Wide/Fantasy_01/Crosshair_Cone_Wide_Fantasy_01_Red_NoBase_15ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "wide",
  style: "fantasy_01",
  color: "red",
  base: "no_base",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Wide/Fantasy_01/Crosshair_Cone_Wide_Fantasy_01_Red_NoBase_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "wide",
  style: "fantasy_01",
  color: "red",
  base: "no_base",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Wide/Fantasy_01/Crosshair_Cone_Wide_Fantasy_01_Red_NoBase_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "wide",
  style: "fantasy_01",
  color: "red",
  base: "no_base",
  size: "90ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Wide/Fantasy_01/Crosshair_Cone_Wide_Fantasy_01_Red_NoBase_90ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "wide",
  style: "fantasy_01",
  color: "teal",
  base: "full",
  size: "15ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Wide/Fantasy_01/Crosshair_Cone_Wide_Fantasy_01_Teal_15ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "wide",
  style: "fantasy_01",
  color: "teal",
  base: "full",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Wide/Fantasy_01/Crosshair_Cone_Wide_Fantasy_01_Teal_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "wide",
  style: "fantasy_01",
  color: "teal",
  base: "full",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Wide/Fantasy_01/Crosshair_Cone_Wide_Fantasy_01_Teal_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "wide",
  style: "fantasy_01",
  color: "teal",
  base: "full",
  size: "90ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Wide/Fantasy_01/Crosshair_Cone_Wide_Fantasy_01_Teal_90ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "wide",
  style: "fantasy_01",
  color: "teal",
  base: "no_base",
  size: "15ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Wide/Fantasy_01/Crosshair_Cone_Wide_Fantasy_01_Teal_NoBase_15ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "wide",
  style: "fantasy_01",
  color: "teal",
  base: "no_base",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Wide/Fantasy_01/Crosshair_Cone_Wide_Fantasy_01_Teal_NoBase_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "wide",
  style: "fantasy_01",
  color: "teal",
  base: "no_base",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Wide/Fantasy_01/Crosshair_Cone_Wide_Fantasy_01_Teal_NoBase_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "wide",
  style: "fantasy_01",
  color: "teal",
  base: "no_base",
  size: "90ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Wide/Fantasy_01/Crosshair_Cone_Wide_Fantasy_01_Teal_NoBase_90ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "wide",
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "15ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Wide/Fantasy_01/Crosshair_Cone_Wide_Fantasy_01_White_15ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "wide",
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Wide/Fantasy_01/Crosshair_Cone_Wide_Fantasy_01_White_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "wide",
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Wide/Fantasy_01/Crosshair_Cone_Wide_Fantasy_01_White_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "wide",
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "90ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Wide/Fantasy_01/Crosshair_Cone_Wide_Fantasy_01_White_90ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "wide",
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "15ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Wide/Fantasy_01/Crosshair_Cone_Wide_Fantasy_01_White_NoBase_15ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "wide",
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Wide/Fantasy_01/Crosshair_Cone_Wide_Fantasy_01_White_NoBase_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "wide",
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Wide/Fantasy_01/Crosshair_Cone_Wide_Fantasy_01_White_NoBase_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "wide",
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "90ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Wide/Fantasy_01/Crosshair_Cone_Wide_Fantasy_01_White_NoBase_90ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "wide",
  style: "fantasy_01",
  color: "yellow",
  base: "full",
  size: "15ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Wide/Fantasy_01/Crosshair_Cone_Wide_Fantasy_01_Yellow_15ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "wide",
  style: "fantasy_01",
  color: "yellow",
  base: "full",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Wide/Fantasy_01/Crosshair_Cone_Wide_Fantasy_01_Yellow_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "wide",
  style: "fantasy_01",
  color: "yellow",
  base: "full",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Wide/Fantasy_01/Crosshair_Cone_Wide_Fantasy_01_Yellow_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "wide",
  style: "fantasy_01",
  color: "yellow",
  base: "full",
  size: "90ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Wide/Fantasy_01/Crosshair_Cone_Wide_Fantasy_01_Yellow_90ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "wide",
  style: "fantasy_01",
  color: "yellow",
  base: "no_base",
  size: "15ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Wide/Fantasy_01/Crosshair_Cone_Wide_Fantasy_01_Yellow_NoBase_15ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "wide",
  style: "fantasy_01",
  color: "yellow",
  base: "no_base",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Wide/Fantasy_01/Crosshair_Cone_Wide_Fantasy_01_Yellow_NoBase_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "wide",
  style: "fantasy_01",
  color: "yellow",
  base: "no_base",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Wide/Fantasy_01/Crosshair_Cone_Wide_Fantasy_01_Yellow_NoBase_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "cone",
  variant: "wide",
  style: "fantasy_01",
  color: "yellow",
  base: "no_base",
  size: "90ft",
  path: "modules/eskie-effects/assets/Crosshair/Cone/Wide/Fantasy_01/Crosshair_Cone_Wide_Fantasy_01_Yellow_NoBase_90ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "line",
  variant: null,
  style: "generic_01",
  color: "red",
  base: "full",
  size: "05ft",
  path: "modules/eskie-effects/assets/Crosshair/Line/Generic_01/Crosshair_Line_Generic_01_Red_05ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "line",
  variant: null,
  style: "generic_01",
  color: "red",
  base: "full",
  size: "15ft",
  path: "modules/eskie-effects/assets/Crosshair/Line/Generic_01/Crosshair_Line_Generic_01_Red_15ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "line",
  variant: null,
  style: "generic_01",
  color: "red",
  base: "full",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Line/Generic_01/Crosshair_Line_Generic_01_Red_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "line",
  variant: null,
  style: "generic_01",
  color: "red",
  base: "full",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Line/Generic_01/Crosshair_Line_Generic_01_Red_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "line",
  variant: null,
  style: "generic_01",
  color: "red",
  base: "full",
  size: "90ft",
  path: "modules/eskie-effects/assets/Crosshair/Line/Generic_01/Crosshair_Line_Generic_01_Red_90ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "line",
  variant: null,
  style: "generic_01",
  color: "teal",
  base: "full",
  size: "05ft",
  path: "modules/eskie-effects/assets/Crosshair/Line/Generic_01/Crosshair_Line_Generic_01_Teal_05ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "line",
  variant: null,
  style: "generic_01",
  color: "teal",
  base: "full",
  size: "15ft",
  path: "modules/eskie-effects/assets/Crosshair/Line/Generic_01/Crosshair_Line_Generic_01_Teal_15ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "line",
  variant: null,
  style: "generic_01",
  color: "teal",
  base: "full",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Line/Generic_01/Crosshair_Line_Generic_01_Teal_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "line",
  variant: null,
  style: "generic_01",
  color: "teal",
  base: "full",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Line/Generic_01/Crosshair_Line_Generic_01_Teal_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "line",
  variant: null,
  style: "generic_01",
  color: "teal",
  base: "full",
  size: "90ft",
  path: "modules/eskie-effects/assets/Crosshair/Line/Generic_01/Crosshair_Line_Generic_01_Teal_90ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "line",
  variant: null,
  style: "generic_01",
  color: "white",
  base: "full",
  size: "05ft",
  path: "modules/eskie-effects/assets/Crosshair/Line/Generic_01/Crosshair_Line_Generic_01_White_05ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "line",
  variant: null,
  style: "generic_01",
  color: "white",
  base: "full",
  size: "15ft",
  path: "modules/eskie-effects/assets/Crosshair/Line/Generic_01/Crosshair_Line_Generic_01_White_15ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "line",
  variant: null,
  style: "generic_01",
  color: "white",
  base: "full",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Line/Generic_01/Crosshair_Line_Generic_01_White_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "line",
  variant: null,
  style: "generic_01",
  color: "white",
  base: "full",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Line/Generic_01/Crosshair_Line_Generic_01_White_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "line",
  variant: null,
  style: "generic_01",
  color: "white",
  base: "full",
  size: "90ft",
  path: "modules/eskie-effects/assets/Crosshair/Line/Generic_01/Crosshair_Line_Generic_01_White_90ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "line",
  variant: null,
  style: "generic_01",
  color: "yellow",
  base: "full",
  size: "05ft",
  path: "modules/eskie-effects/assets/Crosshair/Line/Generic_01/Crosshair_Line_Generic_01_Yellow_05ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "line",
  variant: null,
  style: "generic_01",
  color: "yellow",
  base: "full",
  size: "15ft",
  path: "modules/eskie-effects/assets/Crosshair/Line/Generic_01/Crosshair_Line_Generic_01_Yellow_15ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "line",
  variant: null,
  style: "generic_01",
  color: "yellow",
  base: "full",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Line/Generic_01/Crosshair_Line_Generic_01_Yellow_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "line",
  variant: null,
  style: "generic_01",
  color: "yellow",
  base: "full",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Line/Generic_01/Crosshair_Line_Generic_01_Yellow_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "line",
  variant: null,
  style: "generic_01",
  color: "yellow",
  base: "full",
  size: "90ft",
  path: "modules/eskie-effects/assets/Crosshair/Line/Generic_01/Crosshair_Line_Generic_01_Yellow_90ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "red",
  base: "full",
  size: "05ft",
  path: "modules/eskie-effects/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_Red_05ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "red",
  base: "full",
  size: "15ft",
  path: "modules/eskie-effects/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_Red_15ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "red",
  base: "full",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_Red_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "red",
  base: "full",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_Red_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "red",
  base: "full",
  size: "90ft",
  path: "modules/eskie-effects/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_Red_90ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "red",
  base: "no_base",
  size: "05ft",
  path: "modules/eskie-effects/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_Red_NoBase_05ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "red",
  base: "no_base",
  size: "15ft",
  path: "modules/eskie-effects/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_Red_NoBase_15ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "red",
  base: "no_base",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_Red_NoBase_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "red",
  base: "no_base",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_Red_NoBase_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "red",
  base: "no_base",
  size: "90ft",
  path: "modules/eskie-effects/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_Red_NoBase_90ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "teal",
  base: "full",
  size: "05ft",
  path: "modules/eskie-effects/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_Teal_05ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "teal",
  base: "full",
  size: "15ft",
  path: "modules/eskie-effects/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_Teal_15ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "teal",
  base: "full",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_Teal_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "teal",
  base: "full",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_Teal_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "teal",
  base: "full",
  size: "90ft",
  path: "modules/eskie-effects/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_Teal_90ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "teal",
  base: "no_base",
  size: "05ft",
  path: "modules/eskie-effects/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_Teal_NoBase_05ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "teal",
  base: "no_base",
  size: "15ft",
  path: "modules/eskie-effects/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_Teal_NoBase_15ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "teal",
  base: "no_base",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_Teal_NoBase_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "teal",
  base: "no_base",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_Teal_NoBase_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "teal",
  base: "no_base",
  size: "90ft",
  path: "modules/eskie-effects/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_Teal_NoBase_90ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "05ft",
  path: "modules/eskie-effects/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_White_05ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "15ft",
  path: "modules/eskie-effects/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_White_15ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_White_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_White_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "90ft",
  path: "modules/eskie-effects/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_White_90ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "05ft",
  path: "modules/eskie-effects/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_White_NoBase_05ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "15ft",
  path: "modules/eskie-effects/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_White_NoBase_15ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_White_NoBase_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_White_NoBase_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "90ft",
  path: "modules/eskie-effects/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_White_NoBase_90ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "yellow",
  base: "full",
  size: "05ft",
  path: "modules/eskie-effects/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_Yellow_05ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "yellow",
  base: "full",
  size: "15ft",
  path: "modules/eskie-effects/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_Yellow_15ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "yellow",
  base: "full",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_Yellow_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "yellow",
  base: "full",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_Yellow_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "yellow",
  base: "full",
  size: "90ft",
  path: "modules/eskie-effects/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_Yellow_90ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "yellow",
  base: "no_base",
  size: "05ft",
  path: "modules/eskie-effects/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_Yellow_NoBase_05ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "yellow",
  base: "no_base",
  size: "15ft",
  path: "modules/eskie-effects/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_Yellow_NoBase_15ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "yellow",
  base: "no_base",
  size: "30ft",
  path: "modules/eskie-effects/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_Yellow_NoBase_30ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "yellow",
  base: "no_base",
  size: "60ft",
  path: "modules/eskie-effects/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_Yellow_NoBase_60ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "yellow",
  base: "no_base",
  size: "90ft",
  path: "modules/eskie-effects/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_Yellow_NoBase_90ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "red",
  base: "full",
  size: "05x05ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_Red_05x05ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "red",
  base: "full",
  size: "10x05ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_Red_10x05ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "red",
  base: "full",
  size: "10x10ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_Red_10x10ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "red",
  base: "full",
  size: "20x10ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_Red_20x10ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "red",
  base: "full",
  size: "20x20ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_Red_20x20ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "red",
  base: "full",
  size: "40x20ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_Red_40x20ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "red",
  base: "no_base",
  size: "05x05ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_Red_NoBase_05x05ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "red",
  base: "no_base",
  size: "10x05ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_Red_NoBase_10x05ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "red",
  base: "no_base",
  size: "10x10ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_Red_NoBase_10x10ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "red",
  base: "no_base",
  size: "20x10ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_Red_NoBase_20x10ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "red",
  base: "no_base",
  size: "20x20ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_Red_NoBase_20x20ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "red",
  base: "no_base",
  size: "40x20ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_Red_NoBase_40x20ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "teal",
  base: "full",
  size: "05x05ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_Teal_05x05ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "teal",
  base: "full",
  size: "10x05ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_Teal_10x05ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "teal",
  base: "full",
  size: "10x10ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_Teal_10x10ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "teal",
  base: "full",
  size: "20x10ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_Teal_20x10ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "teal",
  base: "full",
  size: "20x20ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_Teal_20x20ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "teal",
  base: "full",
  size: "40x20ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_Teal_40x20ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "teal",
  base: "no_base",
  size: "05x05ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_Teal_NoBase_05x05ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "teal",
  base: "no_base",
  size: "10x05ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_Teal_NoBase_10x05ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "teal",
  base: "no_base",
  size: "10x10ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_Teal_NoBase_10x10ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "teal",
  base: "no_base",
  size: "20x10ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_Teal_NoBase_20x10ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "teal",
  base: "no_base",
  size: "20x20ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_Teal_NoBase_20x20ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "teal",
  base: "no_base",
  size: "40x20ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_Teal_NoBase_40x20ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "05x05ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_White_05x05ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "10x05ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_White_10x05ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "10x10ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_White_10x10ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "20x10ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_White_20x10ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "20x20ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_White_20x20ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "40x20ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_White_40x20ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "05x05ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_White_NoBase_05x05ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "10x05ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_White_NoBase_10x05ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "10x10ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_White_NoBase_10x10ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "20x10ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_White_NoBase_20x10ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "20x20ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_White_NoBase_20x20ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "40x20ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_White_NoBase_40x20ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "yellow",
  base: "full",
  size: "05x05ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_Yellow_05x05ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "yellow",
  base: "full",
  size: "10x05ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_Yellow_10x05ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "yellow",
  base: "full",
  size: "10x10ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_Yellow_10x10ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "yellow",
  base: "full",
  size: "20x10ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_Yellow_20x10ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "yellow",
  base: "full",
  size: "20x20ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_Yellow_20x20ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "yellow",
  base: "full",
  size: "40x20ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_Yellow_40x20ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "yellow",
  base: "no_base",
  size: "05x05ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_Yellow_NoBase_05x05ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "yellow",
  base: "no_base",
  size: "10x05ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_Yellow_NoBase_10x05ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "yellow",
  base: "no_base",
  size: "10x10ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_Yellow_NoBase_10x10ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "yellow",
  base: "no_base",
  size: "20x10ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_Yellow_NoBase_20x10ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "yellow",
  base: "no_base",
  size: "20x20ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_Yellow_NoBase_20x20ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "yellow",
  base: "no_base",
  size: "40x20ft",
  path: "modules/eskie-effects/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_Yellow_NoBase_40x20ft.webm"
}),
Object.freeze({
  source: "premium",
  shape: "reticle",
  variant: null,
  style: "generic_01",
  color: "red",
  base: "full",
  size: null,
  path: "modules/eskie-effects/assets/Crosshair/Reticle/Generic_01/Crosshair_Reticle_Generic_01_Red.webm"
}),
Object.freeze({
  source: "premium",
  shape: "reticle",
  variant: null,
  style: "generic_01",
  color: "teal",
  base: "full",
  size: null,
  path: "modules/eskie-effects/assets/Crosshair/Reticle/Generic_01/Crosshair_Reticle_Generic_01_Teal.webm"
}),
Object.freeze({
  source: "premium",
  shape: "reticle",
  variant: null,
  style: "generic_01",
  color: "white",
  base: "full",
  size: null,
  path: "modules/eskie-effects/assets/Crosshair/Reticle/Generic_01/Crosshair_Reticle_Generic_01_White.webm"
}),
Object.freeze({
  source: "premium",
  shape: "reticle",
  variant: null,
  style: "generic_01",
  color: "yellow",
  base: "full",
  size: null,
  path: "modules/eskie-effects/assets/Crosshair/Reticle/Generic_01/Crosshair_Reticle_Generic_01_Yellow.webm"
}),
Object.freeze({
  source: "premium",
  shape: "reticle",
  variant: null,
  style: "generic_02",
  color: "red",
  base: "full",
  size: null,
  path: "modules/eskie-effects/assets/Crosshair/Reticle/Generic_02/Crosshair_Reticle_Generic_02_Red.webm"
}),
Object.freeze({
  source: "premium",
  shape: "reticle",
  variant: null,
  style: "generic_02",
  color: "teal",
  base: "full",
  size: null,
  path: "modules/eskie-effects/assets/Crosshair/Reticle/Generic_02/Crosshair_Reticle_Generic_02_Teal.webm"
}),
Object.freeze({
  source: "premium",
  shape: "reticle",
  variant: null,
  style: "generic_02",
  color: "white",
  base: "full",
  size: null,
  path: "modules/eskie-effects/assets/Crosshair/Reticle/Generic_02/Crosshair_Reticle_Generic_02_White.webm"
}),
Object.freeze({
  source: "premium",
  shape: "reticle",
  variant: null,
  style: "generic_02",
  color: "yellow",
  base: "full",
  size: null,
  path: "modules/eskie-effects/assets/Crosshair/Reticle/Generic_02/Crosshair_Reticle_Generic_02_Yellow.webm"
})
]);

export const ESKIE_FREE_CROSSHAIR_ASSETS = Object.freeze([
Object.freeze({
  source: "free",
  shape: "circle",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "10ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Circle/Fantasy_01/Crosshair_Circle_Fantasy_01_White_10ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "circle",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "20ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Circle/Fantasy_01/Crosshair_Circle_Fantasy_01_White_20ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "circle",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "30ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Circle/Fantasy_01/Crosshair_Circle_Fantasy_01_White_30ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "circle",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "60ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Circle/Fantasy_01/Crosshair_Circle_Fantasy_01_White_60ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "circle",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "10ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Circle/Fantasy_01/Crosshair_Circle_Fantasy_01_White_NoBase_10ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "circle",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "20ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Circle/Fantasy_01/Crosshair_Circle_Fantasy_01_White_NoBase_20ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "circle",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "30ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Circle/Fantasy_01/Crosshair_Circle_Fantasy_01_White_NoBase_30ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "circle",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "60ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Circle/Fantasy_01/Crosshair_Circle_Fantasy_01_White_NoBase_60ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "cone",
  variant: "thin",
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "15ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Cone/Thin/Fantasy_01/Crosshair_Cone_Thin_Fantasy_01_White_15ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "cone",
  variant: "thin",
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "30ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Cone/Thin/Fantasy_01/Crosshair_Cone_Thin_Fantasy_01_White_30ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "cone",
  variant: "thin",
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "60ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Cone/Thin/Fantasy_01/Crosshair_Cone_Thin_Fantasy_01_White_60ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "cone",
  variant: "thin",
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "90ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Cone/Thin/Fantasy_01/Crosshair_Cone_Thin_Fantasy_01_White_90ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "cone",
  variant: "thin",
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "15ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Cone/Thin/Fantasy_01/Crosshair_Cone_Thin_Fantasy_01_White_NoBase_15ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "cone",
  variant: "thin",
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "30ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Cone/Thin/Fantasy_01/Crosshair_Cone_Thin_Fantasy_01_White_NoBase_30ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "cone",
  variant: "thin",
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "60ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Cone/Thin/Fantasy_01/Crosshair_Cone_Thin_Fantasy_01_White_NoBase_60ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "cone",
  variant: "thin",
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "90ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Cone/Thin/Fantasy_01/Crosshair_Cone_Thin_Fantasy_01_White_NoBase_90ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "cone",
  variant: "wide",
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "15ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Cone/Wide/Fantasy_01/Crosshair_Cone_Wide_Fantasy_01_White_15ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "cone",
  variant: "wide",
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "30ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Cone/Wide/Fantasy_01/Crosshair_Cone_Wide_Fantasy_01_White_30ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "cone",
  variant: "wide",
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "60ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Cone/Wide/Fantasy_01/Crosshair_Cone_Wide_Fantasy_01_White_60ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "cone",
  variant: "wide",
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "90ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Cone/Wide/Fantasy_01/Crosshair_Cone_Wide_Fantasy_01_White_90ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "cone",
  variant: "wide",
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "15ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Cone/Wide/Fantasy_01/Crosshair_Cone_Wide_Fantasy_01_White_NoBase_15ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "cone",
  variant: "wide",
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "30ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Cone/Wide/Fantasy_01/Crosshair_Cone_Wide_Fantasy_01_White_NoBase_30ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "cone",
  variant: "wide",
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "60ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Cone/Wide/Fantasy_01/Crosshair_Cone_Wide_Fantasy_01_White_NoBase_60ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "cone",
  variant: "wide",
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "90ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Cone/Wide/Fantasy_01/Crosshair_Cone_Wide_Fantasy_01_White_NoBase_90ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "line",
  variant: null,
  style: "generic_01",
  color: "white",
  base: "full",
  size: "05ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Line/Generic_01/Crosshair_Line_Generic_01_White_05ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "line",
  variant: null,
  style: "generic_01",
  color: "white",
  base: "full",
  size: "15ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Line/Generic_01/Crosshair_Line_Generic_01_White_15ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "line",
  variant: null,
  style: "generic_01",
  color: "white",
  base: "full",
  size: "30ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Line/Generic_01/Crosshair_Line_Generic_01_White_30ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "line",
  variant: null,
  style: "generic_01",
  color: "white",
  base: "full",
  size: "60ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Line/Generic_01/Crosshair_Line_Generic_01_White_60ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "line",
  variant: null,
  style: "generic_01",
  color: "white",
  base: "full",
  size: "90ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Line/Generic_01/Crosshair_Line_Generic_01_White_90ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "05ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_White_05ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "15ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_White_15ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "30ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_White_30ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "60ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_White_60ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "90ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_White_90ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "05ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_White_NoBase_05ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "15ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_White_NoBase_15ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "30ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_White_NoBase_30ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "60ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_White_NoBase_60ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "ray",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "90ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Ray/Fantasy_01/Crosshair_Ray_Fantasy_01_White_NoBase_90ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "05x05ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_White_05x05ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "10x05ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_White_10x05ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "10x10ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_White_10x10ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "20x10ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_White_20x10ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "20x20ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_White_20x20ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "full",
  size: "40x20ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_White_40x20ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "05x05ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_White_NoBase_05x05ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "10x05ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_White_NoBase_10x05ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "10x10ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_White_NoBase_10x10ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "20x10ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_White_NoBase_20x10ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "20x20ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_White_NoBase_20x20ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "rectangle",
  variant: null,
  style: "fantasy_01",
  color: "white",
  base: "no_base",
  size: "40x20ft",
  path: "modules/eskie-effects-free/assets/Crosshair/Rectangle/Fantasy_01/Crosshair_Rectangle_Fantasy_01_White_NoBase_40x20ft.webm"
}),
Object.freeze({
  source: "free",
  shape: "reticle",
  variant: null,
  style: "generic_01",
  color: "white",
  base: "full",
  size: null,
  path: "modules/eskie-effects-free/assets/Crosshair/Reticle/Generic_01/Crosshair_Reticle_Generic_01_White.webm"
})
]);

export const ESKIE_CROSSHAIR_DEFAULTS = Object.freeze({
  circle: Object.freeze({ style: "fantasy_01", variant: null, base: "full", size: "20ft" }),
  cone: Object.freeze({ style: "fantasy_01", variant: "thin", base: "full", size: "30ft" }),
  line: Object.freeze({ style: "generic_01", variant: null, base: "full", size: "90ft" }),
  ray: Object.freeze({ style: "fantasy_01", variant: null, base: "full", size: "30ft" }),
  rectangle: Object.freeze({ style: "fantasy_01", variant: null, base: "full", size: "10x10ft" }),
  reticle: Object.freeze({ style: "generic_01", variant: null, base: "full", size: null })
});

export const ESKIE_CROSSHAIR_CATALOG = Object.freeze({
  premium: ESKIE_PREMIUM_CROSSHAIR_ASSETS,
  free: ESKIE_FREE_CROSSHAIR_ASSETS
});
