import { RegionPainter } from "./region-painter.js";
import { getRegionDocumentShapes } from "./region-painter-region-adapter.js";
import {
  pointInPolygon,
  polygonArea,
} from "./region-painter-geometry.js";
import {
  PAINT_MASK_FLAG,
  GRID_STEP_DEBOUNCE_SETTING,
  INPUT_DEBOUNCE_SETTING,
  RANGE_DEBOUNCE_SETTING,
  TINY_HOLE_AREA_SETTING,
  TINY_ISLAND_AREA_SETTING,
  DEFAULT_TINY_HOLE_AREA_PX,
  DEFAULT_TINY_ISLAND_AREA_PX,
} from "./region-painter-constants.js";

const MODULE_ID = "indy-regions";
const PAINT_REGION_TOOL_NAME = "indy-regions-paint-region";
const MERGE_REGIONS_TOOL_NAME = "indy-regions-merge-regions";
const SPLIT_REGIONS_TOOL_NAME = "indy-regions-split-regions";
let paintRegionToolStarting = false;
let mergeRegionsToolStarting = false;
let splitRegionsToolStarting = false;

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
  const selected = getSelectedRegionDocuments();
  return selected.length === 1 ? selected[0] : null;
}

function getSelectedRegionDocuments() {
  const controlled = getLayerPlaceables(canvas?.regions)
    .filter((region) => region?.controlled === true || region?._controlled === true);
  const docs = controlled.map((region) => region?.document ?? region).filter(Boolean);

  const layerControlled = canvas?.regions?.controlled;
  if (Array.isArray(layerControlled)) {
    docs.push(...layerControlled.map((region) => region?.document ?? region).filter(Boolean));
  }

  const seen = new Set();
  const selected = [];
  for (const doc of docs) {
    const id = doc?.id ?? doc?._id ?? null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    selected.push(doc);
  }
  return selected;
}

function cloneRegionShapeData(shape) {
  if (typeof shape?.toObject === "function") return shape.toObject();
  if (typeof globalThis.foundry?.utils?.deepClone === "function") return globalThis.foundry.utils.deepClone(shape);
  return JSON.parse(JSON.stringify(shape));
}

function regionShapePoints(shape) {
  const points = Array.isArray(shape?.points) ? shape.points : [];
  const out = [];
  if (points.length && typeof points[0] === "number") {
    for (let i = 0; i + 1 < points.length; i += 2) out.push({ x: Number(points[i]), y: Number(points[i + 1]) });
  } else {
    for (const point of points) out.push({ x: Number(point?.x), y: Number(point?.y) });
  }
  return out.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

function groupRegionShapesForSplit(shapes) {
  const outers = [];
  const holes = [];
  for (const shape of shapes ?? []) {
    const clone = cloneRegionShapeData(shape);
    if (clone?.hole === true) holes.push(clone);
    else outers.push({ shape: clone, holes: [], points: regionShapePoints(clone) });
  }
  for (const hole of holes) {
    const sample = regionShapePoints(hole)[0] ?? null;
    let best = null;
    let bestArea = Infinity;
    for (const outer of outers) {
      if (!sample || outer.points.length < 3 || !pointInPolygon(sample, outer.points)) continue;
      const area = Math.abs(polygonArea(outer.points));
      if (area < bestArea) {
        best = outer;
        bestArea = area;
      }
    }
    if (best) best.holes.push(hole);
  }
  return outers.map((outer) => [outer.shape, ...outer.holes]);
}

function splitRegionCreateData(region, shapes, suffix) {
  const base = typeof region?.toObject === "function" ? region.toObject() : {};
  const data = typeof globalThis.foundry?.utils?.deepClone === "function"
    ? globalThis.foundry.utils.deepClone(base)
    : JSON.parse(JSON.stringify(base));
  delete data._id;
  delete data.id;
  data.name = `${region?.name ?? localize("Controls.SplitRegions", "Split Regions")} ${suffix}`;
  data.shapes = shapes;
  if (data.flags?.[MODULE_ID]) delete data.flags[MODULE_ID][PAINT_MASK_FLAG];
  return data;
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

async function mergeSelectedRegionsTool(...args) {
  const activeState = args.find((value) => typeof value === "boolean");
  if (activeState === false) return;
  if (mergeRegionsToolStarting) return;
  if (!game?.user?.isGM) {
    ui.notifications.warn(localize("Notifications.GmOnlyPaint", "Only GMs can paint regions."));
    return;
  }

  const selected = getSelectedRegionDocuments();
  if (selected.length < 2) {
    ui.notifications.warn(localize("Notifications.SelectMultipleRegionsToMerge", "Indy Regions | Select at least two Regions to merge."));
    return;
  }

  mergeRegionsToolStarting = true;
  try {
    const target = selected[0];
    const others = selected.slice(1);
    const shapes = selected.flatMap((region) => getRegionDocumentShapes(region).map(cloneRegionShapeData));
    if (!target?.update || !shapes.length) {
      ui.notifications.warn(localize("Notifications.NoRegionShapesToMerge", "Indy Regions | Selected Regions have no shapes to merge."));
      return;
    }

    await target.update({ shapes });
    if (typeof target.unsetFlag === "function") await target.unsetFlag(MODULE_ID, PAINT_MASK_FLAG);

    const deleteIds = others.map((region) => region?.id ?? region?._id).filter(Boolean);
    if (deleteIds.length) {
      const scene = target.parent ?? canvas?.scene;
      if (scene?.deleteEmbeddedDocuments) await scene.deleteEmbeddedDocuments("Region", deleteIds);
      else await Promise.all(others.map((region) => region?.delete?.()).filter(Boolean));
    }

    ui.notifications.info(`${localize("Notifications.MergedRegions", "Indy Regions | Merged Regions:")} ${selected.length}`);
  } catch (err) {
    console.error("Indy Regions | Failed to merge selected regions", err);
    ui.notifications.error(localize("Notifications.MergeRegionsFailed", "Indy Regions | Failed to merge selected Regions."));
  } finally {
    mergeRegionsToolStarting = false;
  }
}

async function splitSelectedRegionsTool(...args) {
  const activeState = args.find((value) => typeof value === "boolean");
  if (activeState === false) return;
  if (splitRegionsToolStarting) return;
  if (!game?.user?.isGM) {
    ui.notifications.warn(localize("Notifications.GmOnlyPaint", "Only GMs can paint regions."));
    return;
  }

  const selected = getSelectedRegionDocuments();
  if (!selected.length) {
    ui.notifications.warn(localize("Notifications.SelectRegionsToSplit", "Indy Regions | Select at least one Region to split."));
    return;
  }

  splitRegionsToolStarting = true;
  try {
    let splitCount = 0;
    for (const region of selected) {
      const groups = groupRegionShapesForSplit(getRegionDocumentShapes(region));
      if (groups.length < 2 || !region?.update) continue;

      await region.update({ shapes: groups[0] });
      if (typeof region.unsetFlag === "function") await region.unsetFlag(MODULE_ID, PAINT_MASK_FLAG);

      const scene = region.parent ?? canvas?.scene;
      const docs = groups.slice(1).map((group, index) => splitRegionCreateData(region, group, index + 2));
      if (docs.length && scene?.createEmbeddedDocuments) {
        const created = await scene.createEmbeddedDocuments("Region", docs);
        splitCount += 1 + (created?.length ?? 0);
      } else {
        splitCount += 1;
      }
    }

    if (!splitCount) {
      ui.notifications.warn(localize("Notifications.NoRegionsToSplit", "Indy Regions | Selected Regions do not contain multiple solid shapes."));
      return;
    }
    ui.notifications.info(`${localize("Notifications.SplitCreated", "Indy Regions | Split into regions:")} ${splitCount}`);
  } catch (err) {
    console.error("Indy Regions | Failed to split selected regions", err);
    ui.notifications.error(localize("Notifications.SplitRegionsFailed", "Indy Regions | Failed to split selected Regions."));
  } finally {
    splitRegionsToolStarting = false;
  }
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

function addRegionTools(controls) {
  if (!controls) return;
  const paintTool = {
    name: PAINT_REGION_TOOL_NAME,
    title: localize("Controls.PaintRegion", "Paint Region"),
    icon: "fas fa-paintbrush",
    button: true,
    visible: game?.user?.isGM === true,
    onChange: (...args) => startPaintRegionTool(...args),
  };
  const mergeTool = {
    name: MERGE_REGIONS_TOOL_NAME,
    title: localize("Controls.MergeRegions", "Merge Regions"),
    icon: "fas fa-object-group",
    button: true,
    visible: game?.user?.isGM === true,
    onChange: (...args) => mergeSelectedRegionsTool(...args),
  };
  const splitTool = {
    name: SPLIT_REGIONS_TOOL_NAME,
    title: localize("Controls.SplitRegions", "Split Regions"),
    icon: "fas fa-object-ungroup",
    button: true,
    visible: game?.user?.isGM === true,
    onChange: (...args) => splitSelectedRegionsTool(...args),
  };
  const addRegionControlTools = (control) => {
    addTool(control, paintTool);
    addTool(control, splitTool);
    addTool(control, mergeTool);
  };

  if (Array.isArray(controls)) {
    for (const control of controls) {
      const name = String(control?.name ?? "").toLowerCase();
      if (name === "region" || name === "regions") addRegionControlTools(control);
    }
    return;
  }

  for (const [key, control] of Object.entries(controls)) {
    const name = String(control?.name ?? key ?? "").toLowerCase();
    if (name === "region" || name === "regions") addRegionControlTools(control);
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
  game.settings.register(MODULE_ID, TINY_ISLAND_AREA_SETTING, {
    name: localize("Settings.PaintTinyIslandArea.Name", "Paint Tiny Island Area"),
    hint: localize("Settings.PaintTinyIslandArea.Hint", "Maximum island area, in image pixels, removed by the Remove Tiny Islands button."),
    scope: "client",
    config: true,
    type: Number,
    default: DEFAULT_TINY_ISLAND_AREA_PX,
    range: { min: 1, max: 65536, step: 64 },
  });
  game.settings.register(MODULE_ID, TINY_HOLE_AREA_SETTING, {
    name: localize("Settings.PaintTinyHoleArea.Name", "Paint Tiny Hole Area"),
    hint: localize("Settings.PaintTinyHoleArea.Hint", "Maximum hole area, in image pixels, filled by the Remove Tiny Holes button."),
    scope: "client",
    config: true,
    type: Number,
    default: DEFAULT_TINY_HOLE_AREA_PX,
    range: { min: 1, max: 65536, step: 64 },
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

Hooks.on("getSceneControlButtons", addRegionTools);
