export const PAINT_MASK_FLAG = "paintRegionMask";
export const REGION_SHADER_BEHAVIOR_TYPE = "indy-fx.indyFX";
export const LEGACY_REGION_SHADER_BEHAVIOR_TYPE = "indyFX";
export const PAINT_HISTORY_LIMIT = 40;
export const MIN_HOLE_LOOP_AREA_CELLS = 8;
export const DEFAULT_TINY_ISLAND_AREA_PX = 512;
export const DEFAULT_TINY_HOLE_AREA_PX = 1024;
export const SMALL_MORPH_RADIUS_CELLS = 3;
export const MAX_FILL_BRIDGE_PX = 20;
export const PAINT_REGION_DEFAULT_NAME = "Region";
export const DEBUG_TIMINGS_SETTING = "debugTimings";
export const SHOW_PAINT_HELP_SETTING = "showPaintHelp";
export const GRID_STEP_DEBOUNCE_SETTING = "paintGridStepDebounceMs";
export const RANGE_DEBOUNCE_SETTING = "paintRangeDebounceMs";
export const INPUT_DEBOUNCE_SETTING = "paintInputDebounceMs";
export const TINY_ISLAND_AREA_SETTING = "paintTinyIslandAreaPx";
export const TINY_HOLE_AREA_SETTING = "paintTinyHoleAreaPx";
export const BORDER_SMOOTH_TYPES = Object.freeze(["catmull", "rounded", "relaxed"]);
export const CARDINAL_DIRECTIONS = Object.freeze([
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
]);

export const DEFAULT_WATER_OPTIONS = Object.freeze({
  tolerance: 28,
  gridStep: 4,
  fillColorMode: "rgb",
  fillBridgePx: 0,
  smoothing: 2.0,
  borderSmoothType: "rounded",
  featherShrinkPx: 0,
  requireWaterLikeSeed: false,
  requireWaterLikeFill: false,
  minShapeArea: 24,
  debug: false,
  brushSizePx: 96,
  paintColor: "#ff0000",
  paintOpacity: 0.65,
  dialogScale: 1,
  hslFillBias: 0,
  paintBorderThickness: 2,
  fillHoles: false,
});
