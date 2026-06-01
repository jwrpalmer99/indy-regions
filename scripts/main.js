import { RegionPainter } from "./region-painter.js";
import {
  GRID_STEP_DEBOUNCE_SETTING,
  INPUT_DEBOUNCE_SETTING,
  RANGE_DEBOUNCE_SETTING,
} from "./region-painter-constants.js";

const MODULE_ID = "indy-regions";
const PAINT_REGION_TOOL_NAME = "indy-regions-paint-region";
let paintRegionToolStarting = false;

function localize(key, fallback = key) {
  const fullKey = `${MODULE_ID}.${key}`;
  const value = game?.i18n?.localize?.(fullKey);
  return value && value !== fullKey ? value : fallback;
}

function getLayerPlaceables(layer) {
  const placeables = layer?.placeables;
  if (Array.isArray(placeables)) return placeables;
  if (typeof placeables?.values === "function") return Array.from(placeables.values());
  if (typeof layer?.objects?.children?.values === "function") return Array.from(layer.objects.children.values());
  if (Array.isArray(layer?.objects?.children)) return layer.objects.children;
  return [];
}

function getSingleSelectedRegionDocument() {
  const controlled = getLayerPlaceables(canvas?.regions)
    .filter((region) => region?.controlled === true || region?._controlled === true);
  if (controlled.length === 1) return controlled[0]?.document ?? controlled[0];

  const layerControlled = canvas?.regions?.controlled;
  if (Array.isArray(layerControlled) && layerControlled.length === 1) {
    return layerControlled[0]?.document ?? layerControlled[0];
  }
  return null;
}

function startPaintRegionTool(...args) {
  const activeState = args.find((value) => typeof value === "boolean");
  if (activeState === false) return;
  if (paintRegionToolStarting) return;
  if (!game?.user?.isGM) {
    ui.notifications.warn(localize("Notifications.GmOnlyPaint", "Only GMs can paint regions."));
    return;
  }

  const editRegion = getSingleSelectedRegionDocument();
  paintRegionToolStarting = true;
  void RegionPainter.startPaintToCreate({ editRegion })
    .finally(() => {
      paintRegionToolStarting = false;
    });
}

function addTool(control, tool) {
  if (!control || typeof control !== "object") return;
  if (Array.isArray(control.tools)) {
    const existingIndex = control.tools.findIndex((entry) => entry?.name === tool.name);
    if (existingIndex >= 0) {
      control.tools[existingIndex] = {
        ...control.tools[existingIndex],
        ...tool,
      };
    } else {
      control.tools.push(tool);
    }
    return;
  }
  control.tools ??= {};
  control.tools[tool.name] = {
    ...(control.tools[tool.name] ?? {}),
    ...tool,
  };
}

function addRegionPaintTool(controls) {
  if (!controls) return;
  const tool = {
    name: PAINT_REGION_TOOL_NAME,
    title: localize("Controls.PaintRegion", "Paint Region"),
    icon: "fas fa-paintbrush",
    button: true,
    visible: game?.user?.isGM === true,
    onChange: (...args) => startPaintRegionTool(...args),
  };

  if (Array.isArray(controls)) {
    for (const control of controls) {
      const name = String(control?.name ?? "").toLowerCase();
      if (name === "region" || name === "regions") addTool(control, tool);
    }
    return;
  }

  for (const [key, control] of Object.entries(controls)) {
    const name = String(control?.name ?? key ?? "").toLowerCase();
    if (name === "region" || name === "regions") addTool(control, tool);
  }
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "debugTimings", {
    name: localize("Settings.DebugTimings.Name", "Debug Region Paint Timings"),
    hint: localize("Settings.DebugTimings.Hint", "Log timing details for region paint mask rebuilds, previews, and commits."),
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
  });
  game.settings.register(MODULE_ID, "showPaintHelp", {
    name: localize("Settings.ShowPaintHelp.Name", "Show Region Paint Help"),
    hint: localize("Settings.ShowPaintHelp.Hint", "Show the short mouse/keyboard help text in the Region Paint dialog."),
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });
  game.settings.register(MODULE_ID, GRID_STEP_DEBOUNCE_SETTING, {
    name: localize("Settings.PaintGridStepDebounce.Name", "Paint Grid Step Debounce"),
    hint: localize("Settings.PaintGridStepDebounce.Hint", "Delay in milliseconds before rebuilding mask resolution after changing Grid Step."),
    scope: "client",
    config: true,
    type: Number,
    default: 50,
    range: { min: 0, max: 2000, step: 10 },
  });
  game.settings.register(MODULE_ID, RANGE_DEBOUNCE_SETTING, {
    name: localize("Settings.PaintRangeDebounce.Name", "Paint Slider Debounce"),
    hint: localize("Settings.PaintRangeDebounce.Hint", "Delay in milliseconds before recalculating region boundaries while dragging paint dialog sliders."),
    scope: "client",
    config: true,
    type: Number,
    default: 0,
    range: { min: 0, max: 2000, step: 10 },
  });
  game.settings.register(MODULE_ID, INPUT_DEBOUNCE_SETTING, {
    name: localize("Settings.PaintInputDebounce.Name", "Paint Input Debounce"),
    hint: localize("Settings.PaintInputDebounce.Hint", "Delay in milliseconds before recalculating region boundaries after number, checkbox, or selector changes."),
    scope: "client",
    config: true,
    type: Number,
    default: 10,
    range: { min: 0, max: 2000, step: 10 },
  });
  RegionPainter.configure({ moduleId: MODULE_ID });
});

Hooks.once("ready", () => {
  game.indyRegions = {
    paint: {
      start: (options = {}) => RegionPainter.startPaintToCreate(options),
      cancel: () => RegionPainter.cancelPaintSession(),
      clearCache: () => RegionPainter.clearCache(),
    },
  };
});

Hooks.on("canvasReady", () => {
  RegionPainter.clearCache();
});

Hooks.on("getSceneControlButtons", addRegionPaintTool);
