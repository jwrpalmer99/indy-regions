const PAINT_MASK_FLAG = "paintRegionMask";
const REGION_SHADER_BEHAVIOR_TYPE = "indy-fx.indyFX";
const LEGACY_REGION_SHADER_BEHAVIOR_TYPE = "indyFX";
const PAINT_HISTORY_LIMIT = 40;
const MIN_HOLE_LOOP_AREA_CELLS = 8;
const SMALL_MORPH_RADIUS_CELLS = 3;
const MAX_FILL_BRIDGE_PX = 20;
const PAINT_REGION_DEFAULT_NAME = "Region";
const DEBUG_TIMINGS_SETTING = "debugTimings";
const SHOW_PAINT_HELP_SETTING = "showPaintHelp";
const CARDINAL_DIRECTIONS = Object.freeze([
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
]);

const DEFAULT_WATER_OPTIONS = Object.freeze({
  tolerance: 28,
  gridStep: 4,
  fillColorMode: "rgb",
  fillBridgePx: 0,
  smoothing: 2.0,
  featherShrinkPx: 0,
  requireWaterLikeSeed: false,
  requireWaterLikeFill: false,
  minShapeArea: 24,
  debug: false,
  brushSizePx: 96,
  paintColor: "#ff0000",
  paintOpacity: 0.65,
  paintBorderThickness: 2,
});

function toFiniteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function nowMs() {
  try {
    if (typeof globalThis.performance?.now === "function") return globalThis.performance.now();
  } catch (_err) {
    // Fall through.
  }
  return Date.now();
}

function roundTimingMs(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function isDebugTimingEnabled(moduleId = "indy-regions") {
  try {
    return game?.settings?.get?.(moduleId, DEBUG_TIMINGS_SETTING) === true
      || globalThis.INDY_REGIONS_DEBUG_TIMINGS === true;
  } catch (_err) {
    return globalThis.INDY_REGIONS_DEBUG_TIMINGS === true;
  }
}

function debugUiDisplayStyle(moduleId = "indy-regions") {
  return isDebugTimingEnabled(moduleId) ? "" : ' style="display:none;"';
}

function paintHelpDisplayStyle(moduleId = "indy-regions") {
  try {
    return game?.settings?.get?.(moduleId, SHOW_PAINT_HELP_SETTING) !== false
      ? ' style="grid-column: 1 / -1; margin-top: 0;"'
      : ' style="display:none;"';
  } catch (_err) {
    return ' style="grid-column: 1 / -1; margin-top: 0;"';
  }
}

function getStoredPaintHelpOpen(moduleId = "indy-regions") {
  try {
    return globalThis.localStorage?.getItem?.(`${moduleId}.paintHelpOpen`) === "true";
  } catch (_err) {
    return false;
  }
}

function setStoredPaintHelpOpen(moduleId = "indy-regions", open = false) {
  try {
    globalThis.localStorage?.setItem?.(`${moduleId}.paintHelpOpen`, open === true ? "true" : "false");
  } catch (_err) {
    // Non-fatal.
  }
}

function localizeText(moduleId, key, fallback = key) {
  const fullKey = `${moduleId}.${key}`;
  const value = game?.i18n?.localize?.(fullKey);
  return value && value !== fullKey ? value : fallback;
}

function formatText(moduleId, key, data = {}, fallback = key) {
  const fullKey = `${moduleId}.${key}`;
  const value = game?.i18n?.format?.(fullKey, data);
  if (value && value !== fullKey) return value;
  return String(fallback).replace(/\{([^}]+)\}/g, (_match, name) => data?.[name] ?? "");
}

function debugTiming(moduleId, label, payload = {}) {
  if (!isDebugTimingEnabled(moduleId)) return;
  try {
    console.debug(`${moduleId} | timing | ${label}`, payload);
  } catch (_err) {
    // Non-fatal.
  }
}

function rgb255ToHsl(r, g, b) {
  const rn = clamp(Number(r) / 255, 0, 1);
  const gn = clamp(Number(g) / 255, 0, 1);
  const bn = clamp(Number(b) / 255, 0, 1);
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) * 0.5;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h, s, l };
}

function getSceneBackgroundPath(scene) {
  return String(
    scene?.background?.src ??
      scene?.background?.source ??
      scene?.img ??
      "",
  ).trim();
}

function getSceneImageMapping(imgW, imgH) {
  const dims = canvas?.dimensions ?? {};
  return {
    sceneX: toFiniteNumber(dims.sceneX, 0),
    sceneY: toFiniteNumber(dims.sceneY, 0),
    sceneWidth: Math.max(1, toFiniteNumber(dims.sceneWidth, imgW)),
    sceneHeight: Math.max(1, toFiniteNumber(dims.sceneHeight, imgH)),
  };
}

function sceneToImagePoint(sceneX, sceneY, imgW, imgH) {
  const map = getSceneImageMapping(imgW, imgH);
  return {
    x: Math.round(((sceneX - map.sceneX) / map.sceneWidth) * imgW),
    y: Math.round(((sceneY - map.sceneY) / map.sceneHeight) * imgH),
  };
}

function imageGridPointToScene(x, y, gridStep, imgW, imgH) {
  const map = getSceneImageMapping(imgW, imgH);
  const scaleX = map.sceneWidth / imgW;
  const scaleY = map.sceneHeight / imgH;
  return {
    x: Math.round(map.sceneX + x * gridStep * scaleX),
    y: Math.round(map.sceneY + y * gridStep * scaleY),
  };
}

function polygonArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += (a.x * b.y) - (b.x * a.y);
  }
  return area * 0.5;
}

function pointLineDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const x = a.x + t * dx;
  const y = a.y + t * dy;
  return Math.hypot(p.x - x, p.y - y);
}

function simplifyRdpOpen(points, tolerance) {
  if (!Array.isArray(points) || points.length <= 2) return points ?? [];
  const tol = Math.max(0, Number(tolerance) || 0);
  if (tol <= 0) return points.slice();

  function simplify(start, end) {
    let maxDist = 0;
    let maxIndex = start;
    const a = points[start];
    const b = points[end];

    for (let i = start + 1; i < end; i += 1) {
      const dist = pointLineDistance(points[i], a, b);
      if (dist > maxDist) {
        maxDist = dist;
        maxIndex = i;
      }
    }

    if (maxDist > tol) {
      const left = simplify(start, maxIndex);
      const right = simplify(maxIndex, end);
      return left.slice(0, -1).concat(right);
    }

    return [a, b];
  }

  return simplify(0, points.length - 1);
}

function simplifyClosedPolygon(points, tolerance) {
  if (!Array.isArray(points) || points.length <= 3) return points ?? [];
  const amount = Math.max(0, Number(tolerance) || 0);
  let bestIndex = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i];
    const b = points[bestIndex];
    if (a.x < b.x || (a.x === b.x && a.y < b.y)) bestIndex = i;
  }
  const rotated = points.slice(bestIndex).concat(points.slice(0, bestIndex));
  rotated.push(rotated[0]);
  const simplified = simplifyRdpOpen(rotated, amount).slice(0, -1);
  const base = simplified.length >= 3 ? simplified : points.slice();
  return smoothClosedPolygon(base, amount);
}

function limitClosedPolygonPoints(points, maxPoints = 512) {
  if (!Array.isArray(points) || points.length <= maxPoints) return points ?? [];
  const stride = Math.ceil(points.length / maxPoints);
  const out = [];
  for (let i = 0; i < points.length; i += stride) out.push(points[i]);
  return out.length >= 3 ? out : points.slice(0, maxPoints);
}

function smoothClosedPolygon(points, amount) {
  if (!Array.isArray(points) || points.length < 3) return points ?? [];
  const smoothAmount = Math.max(0, Number(amount) || 0);
  if (smoothAmount <= 0) return points.slice();

  const maxPoints = 512;
  const requestedSamples = Math.max(2, Math.min(10, Math.ceil(smoothAmount * 0.75)));
  const samplesPerSegment = Math.max(1, Math.min(requestedSamples, Math.floor(maxPoints / points.length)));
  if (samplesPerSegment <= 1) return points.slice();

  const catmullRom = (p0, p1, p2, p3, t) => {
    const t2 = t * t;
    const t3 = t2 * t;
    return {
      x: 0.5 * (
        (2 * p1.x) +
        ((-p0.x + p2.x) * t) +
        (((2 * p0.x) - (5 * p1.x) + (4 * p2.x) - p3.x) * t2) +
        ((-p0.x + (3 * p1.x) - (3 * p2.x) + p3.x) * t3)
      ),
      y: 0.5 * (
        (2 * p1.y) +
        ((-p0.y + p2.y) * t) +
        (((2 * p0.y) - (5 * p1.y) + (4 * p2.y) - p3.y) * t2) +
        ((-p0.y + (3 * p1.y) - (3 * p2.y) + p3.y) * t3)
      ),
    };
  };

  const out = [];
  for (let i = 0; i < points.length; i += 1) {
    const p0 = points[(i - 1 + points.length) % points.length];
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const p3 = points[(i + 2) % points.length];
    for (let sample = 0; sample < samplesPerSegment; sample += 1) {
      out.push(catmullRom(p0, p1, p2, p3, sample / samplesPerSegment));
    }
  }
  return limitClosedPolygonPoints(out, maxPoints);
}

function getPointerWorldPoint(event) {
  const global = event?.data?.global ?? event?.global;
  if (!global || !canvas?.stage?.toLocal) return null;
  const p = canvas.stage.toLocal(global);
  return { x: p.x, y: p.y };
}

function getDomPointerWorldPoint(event) {
  if (!event || !canvas?.stage?.toLocal) return null;
  const point = new PIXI.Point();
  const renderer = canvas?.app?.renderer;
  try {
    if (typeof renderer?.events?.mapPositionToPoint === "function") {
      renderer.events.mapPositionToPoint(point, event.clientX, event.clientY);
    } else if (typeof renderer?.plugins?.interaction?.mapPositionToPoint === "function") {
      renderer.plugins.interaction.mapPositionToPoint(point, event.clientX, event.clientY);
    } else {
      const view = canvas?.app?.view ?? renderer?.view;
      const rect = view?.getBoundingClientRect?.();
      if (!rect) return null;
      const width = Number(view.width) || rect.width || 1;
      const height = Number(view.height) || rect.height || 1;
      point.x = (event.clientX - rect.left) * (width / Math.max(1, rect.width));
      point.y = (event.clientY - rect.top) * (height / Math.max(1, rect.height));
    }
    const p = canvas.stage.toLocal(point);
    return { x: p.x, y: p.y };
  } catch (_err) {
    return null;
  }
}

function getWorldHitRadius(screenPx = 14) {
  const scale = Math.max(
    0.0001,
    Math.abs(Number(canvas?.stage?.scale?.x) || Number(canvas?.app?.stage?.scale?.x) || 1),
  );
  return screenPx / scale;
}

function isPrimaryPointerEvent(event) {
  const original = event?.data?.originalEvent ?? event?.nativeEvent ?? event;
  const button = Number(original?.button ?? event?.button ?? 0);
  if (Number.isFinite(button) && button !== 0) return false;
  const buttons = Number(original?.buttons ?? event?.buttons ?? 1);
  if (Number.isFinite(buttons) && buttons > 0 && (buttons & 1) !== 1) return false;
  return true;
}

function isPrimaryDomPointerEvent(event) {
  const button = Number(event?.button ?? 0);
  if (Number.isFinite(button) && button !== 0) return false;
  const buttons = Number(event?.buttons ?? 1);
  if (Number.isFinite(buttons) && buttons > 0 && (buttons & 1) !== 1) return false;
  return true;
}

function consumePaintPointerEvent(event) {
  try {
    event?.preventDefault?.();
    event?.stopImmediatePropagation?.();
    event?.stopPropagation?.();
    const original = event?.data?.originalEvent ?? event?.nativeEvent ?? event;
    original?.preventDefault?.();
    original?.stopImmediatePropagation?.();
    original?.stopPropagation?.();
  } catch (_err) {
    // Non-fatal.
  }
}

function normalizeOptions(options = {}) {
  const merged = {
    ...DEFAULT_WATER_OPTIONS,
    ...(options && typeof options === "object" ? options : {}),
  };
  merged.fillBridgePx = clamp(toFiniteNumber(merged.fillBridgePx, DEFAULT_WATER_OPTIONS.fillBridgePx), 0, MAX_FILL_BRIDGE_PX);
  return merged;
}

function normalizeFillBridgePx(value, fallback = DEFAULT_WATER_OPTIONS.fillBridgePx) {
  return clamp(toFiniteNumber(value, fallback), 0, MAX_FILL_BRIDGE_PX);
}

function normalizePaintOpacity(value, fallback = DEFAULT_WATER_OPTIONS.paintOpacity) {
  return clamp(toFiniteNumber(value, fallback), 0, 1);
}

function rgbToWaterScore(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  const luma = (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
  if (chroma < 7) return 0;
  if (luma < 8 || luma > 238) return 0;

  // Reject foliage and warm earth/wood tones before accepting cool water.
  if (g > b + 34 && g > r + 18) return 0;
  if (r > b + 16 && r > g + 8) return 0;

  const blueWater = b >= r + 8 && b >= g * 0.68;
  const cyanWater = g >= r + 8 && b >= r + 6 && Math.abs(g - b) <= 86;
  const darkWater = luma < 95 && b >= r + 4 && g >= r - 14 && chroma >= 9;
  if (!blueWater && !cyanWater && !darkWater) return 0;

  const coolStrength = Math.max(b - r, Math.min(g, b) - r, 0);
  return Math.max(0, Math.min(1, (coolStrength + chroma * 0.25) / 90));
}

function isWaterLikeRgb(r, g, b) {
  return rgbToWaterScore(r, g, b) >= 0.08;
}

function destroyPreviewSprite(sprite) {
  if (!sprite) return;
  try {
    sprite.parent?.removeChild?.(sprite);
    sprite.texture?.destroy?.(true);
    sprite.destroy?.({ children: true });
  } catch (_err) {
    // Non-fatal.
  }
}

function cloneMaskData(maskData) {
  if (!maskData?.mask) return null;
  return {
    mask: new Uint8Array(maskData.mask),
    alphaMask: maskData.alphaMask ? new Uint8Array(maskData.alphaMask) : null,
    cols: maskData.cols,
    rows: maskData.rows,
    gridStep: maskData.gridStep,
    offsetX: maskData.offsetX ?? 0,
    offsetY: maskData.offsetY ?? 0,
    fullCols: maskData.fullCols ?? maskData.cols,
    fullRows: maskData.fullRows ?? maskData.rows,
    bounds: maskData.bounds ? { ...maskData.bounds } : null,
    boundsDirty: maskData.boundsDirty === true,
  };
}

function clonePaintSnapshot(session, fallback = null) {
  const maskData = cloneMaskData(fallback ?? session?.maskData);
  if (!maskData) return null;
  return {
    maskData,
    sourceMaskData: cloneMaskData(session?.sourceMaskData ?? fallback ?? session?.maskData),
  };
}

function snapshotMaskData(snapshot) {
  return snapshot?.maskData ? snapshot.maskData : snapshot;
}

function snapshotSourceMaskData(snapshot) {
  return snapshot?.sourceMaskData ?? snapshot?.maskData ?? snapshot;
}

function normalizeMaskBounds(bounds, cols, rows) {
  const minX = Math.max(0, Math.floor(Number(bounds?.minX)));
  const minY = Math.max(0, Math.floor(Number(bounds?.minY)));
  const maxX = Math.min(Math.max(0, Number(cols) - 1), Math.ceil(Number(bounds?.maxX)));
  const maxY = Math.min(Math.max(0, Number(rows) - 1), Math.ceil(Number(bounds?.maxY)));
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  if (maxX < minX || maxY < minY) return null;
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: (maxX - minX) + 1,
    height: (maxY - minY) + 1,
  };
}

function expandMaskBounds(bounds, x, y, cols, rows) {
  const existing = normalizeMaskBounds(bounds, cols, rows);
  const gx = Math.max(0, Math.min(Math.max(0, Number(cols) - 1), Math.floor(Number(x))));
  const gy = Math.max(0, Math.min(Math.max(0, Number(rows) - 1), Math.floor(Number(y))));
  if (![gx, gy].every(Number.isFinite)) return existing;
  if (!existing) return normalizeMaskBounds({ minX: gx, minY: gy, maxX: gx, maxY: gy }, cols, rows);
  return normalizeMaskBounds({
    minX: Math.min(existing.minX, gx),
    minY: Math.min(existing.minY, gy),
    maxX: Math.max(existing.maxX, gx),
    maxY: Math.max(existing.maxY, gy),
  }, cols, rows);
}

function sameMaskBounds(a, b) {
  return Boolean(a && b
    && a.minX === b.minX
    && a.minY === b.minY
    && a.maxX === b.maxX
    && a.maxY === b.maxY
    && a.width === b.width
    && a.height === b.height);
}

function mergeMaskBounds(a, b, cols, rows) {
  const left = normalizeMaskBounds(a, cols, rows);
  const right = normalizeMaskBounds(b, cols, rows);
  if (!left) return right;
  if (!right) return left;
  return normalizeMaskBounds({
    minX: Math.min(left.minX, right.minX),
    minY: Math.min(left.minY, right.minY),
    maxX: Math.max(left.maxX, right.maxX),
    maxY: Math.max(left.maxY, right.maxY),
  }, cols, rows);
}

function maskOffsetX(maskData) {
  return Math.max(0, Math.round(Number(maskData?.offsetX) || 0));
}

function maskOffsetY(maskData) {
  return Math.max(0, Math.round(Number(maskData?.offsetY) || 0));
}

function maskFullCols(maskData) {
  return Math.max(1, Math.round(Number(maskData?.fullCols) || Number(maskData?.cols) || 1));
}

function maskFullRows(maskData) {
  return Math.max(1, Math.round(Number(maskData?.fullRows) || Number(maskData?.rows) || 1));
}

function normalizeHexColor(value, fallback = "#ff0000") {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^#?([0-9a-f]{6})$/i);
  return match ? `#${match[1].toLowerCase()}` : fallback;
}

function hexToRgbInt(value) {
  const hex = normalizeHexColor(value).slice(1);
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

function getStoredPaintColor(moduleId) {
  try {
    return normalizeHexColor(globalThis.localStorage?.getItem?.(`${moduleId}.paintRegionPenColor`), DEFAULT_WATER_OPTIONS.paintColor);
  } catch (_err) {
    return DEFAULT_WATER_OPTIONS.paintColor;
  }
}

function setStoredPaintColor(moduleId, color) {
  try {
    globalThis.localStorage?.setItem?.(`${moduleId}.paintRegionPenColor`, normalizeHexColor(color, DEFAULT_WATER_OPTIONS.paintColor));
  } catch (_err) {
    // Non-fatal.
  }
}

function getStoredPaintOptions(moduleId) {
  try {
    const raw = globalThis.localStorage?.getItem?.(`${moduleId}.paintRegionOptions`);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_err) {
    return {};
  }
}

function setStoredPaintOptions(moduleId, options = {}) {
  try {
    const stored = {
      brushSizePx: Math.max(1, toFiniteNumber(options.brushSizePx, DEFAULT_WATER_OPTIONS.brushSizePx)),
      tolerance: Math.max(0, toFiniteNumber(options.tolerance, DEFAULT_WATER_OPTIONS.tolerance)),
      gridStep: Math.max(1, Math.round(toFiniteNumber(options.gridStep, DEFAULT_WATER_OPTIONS.gridStep))),
      smoothing: Math.max(0, toFiniteNumber(options.smoothing, DEFAULT_WATER_OPTIONS.smoothing)),
      featherShrinkPx: toFiniteNumber(options.featherShrinkPx, DEFAULT_WATER_OPTIONS.featherShrinkPx),
      fillBridgePx: normalizeFillBridgePx(options.fillBridgePx),
      fillColorMode: String(options.fillColorMode ?? DEFAULT_WATER_OPTIONS.fillColorMode).trim().toLowerCase() === "hsl" ? "hsl" : "rgb",
      paintColor: normalizeHexColor(options.paintColor, DEFAULT_WATER_OPTIONS.paintColor),
      paintOpacity: normalizePaintOpacity(options.paintOpacity),
      paintBorderThickness: clamp(toFiniteNumber(options.paintBorderThickness, DEFAULT_WATER_OPTIONS.paintBorderThickness), 0, 4),
    };
    globalThis.localStorage?.setItem?.(`${moduleId}.paintRegionOptions`, JSON.stringify(stored));
    setStoredPaintColor(moduleId, stored.paintColor);
  } catch (_err) {
    // Non-fatal.
  }
}

function bytesToBase64(bytes) {
  if (!bytes?.length) return "";
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return globalThis.btoa?.(binary) ?? "";
}

function base64ToBytes(value) {
  try {
    const binary = globalThis.atob?.(String(value ?? "")) ?? "";
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch (_err) {
    return null;
  }
}

function destroyGraphics(gfx) {
  if (!gfx) return;
  try {
    gfx.parent?.removeChild?.(gfx);
    gfx.destroy?.({ children: true });
  } catch (_err) {
    // Non-fatal.
  }
}

function getPreviewLayer() {
  return canvas?.interface?.primary ?? canvas?.interface ?? canvas?.stage ?? null;
}

function suppressRegionLayerInteraction() {
  const layer = canvas?.regions ?? null;
  if (!layer) return null;
  const saved = {
    eventMode: layer.eventMode,
    interactive: layer.interactive,
    interactiveChildren: layer.interactiveChildren,
  };
  try {
    layer.eventMode = "none";
    layer.interactive = false;
    layer.interactiveChildren = false;
  } catch (_err) {
    // Non-fatal.
  }
  return () => {
    try {
      if (saved.eventMode !== undefined) layer.eventMode = saved.eventMode;
      if (saved.interactive !== undefined) layer.interactive = saved.interactive;
      if (saved.interactiveChildren !== undefined) layer.interactiveChildren = saved.interactiveChildren;
    } catch (_err) {
      // Non-fatal.
    }
  };
}

function suppressCanvasDragSelection() {
  const layers = [
    canvas?.activeLayer,
    canvas?.regions,
    canvas?.tokens,
    canvas?.tiles,
    canvas?.drawings,
    canvas?.walls,
    canvas?.lighting,
    canvas?.sounds,
    canvas?.templates,
  ].filter(Boolean);
  const uniqueLayers = Array.from(new Set(layers));
  const dragHandlers = [
    "_onDragLeftStart",
    "_onDragLeftMove",
    "_onDragLeftDrop",
    "_onDragLeftCancel",
    "_onClickLeft",
    "_onClickLeft2",
  ];
  const saved = [];

  for (const layer of uniqueLayers) {
    for (const key of dragHandlers) {
      if (typeof layer?.[key] !== "function") continue;
      saved.push({ layer, key, fn: layer[key] });
      try {
        layer[key] = function suppressPaintSelectionInteraction(event) {
          consumePaintPointerEvent(event);
          return false;
        };
      } catch (_err) {
        // Non-fatal.
      }
    }
  }

  return () => {
    for (const entry of saved) {
      try {
        entry.layer[entry.key] = entry.fn;
      } catch (_err) {
        // Non-fatal.
      }
    }
  };
}

function setRegionPlaceableVisible(region, visible) {
  const doc = region?.document ?? region;
  const placeable = region?.object ?? doc?.object ?? canvas?.regions?.get?.(doc?.id);
  try {
    if (placeable) {
      placeable.visible = visible === true;
      placeable.renderable = visible === true;
      if (visible !== true) placeable.alpha = 0;
      else if (Number(placeable.alpha) <= 0) placeable.alpha = 1;
    }
  } catch (_err) {
    // Non-fatal.
  }
}

function collectionToArray(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  if (typeof collection.values === "function") return Array.from(collection.values());
  return [];
}

function getRegionId(region) {
  return String(region?.id ?? region?._id ?? region?.document?.id ?? region?.document?._id ?? "");
}

function candidateShapesToRegionData(candidate) {
  const shapes = Array.isArray(candidate?.shapes) && candidate.shapes.length
    ? candidate.shapes
    : (candidate?.points?.length ? [{ points: candidate.points }] : []);
  return shapes
    .filter((shape) => Array.isArray(shape?.points) && shape.points.length >= 3)
    .map((shape) => {
      const data = {
        type: "polygon",
        points: shape.points.flatMap((point) => [Math.round(point.x), Math.round(point.y)]),
      };
      if (shape.isHole === true) data.hole = true;
      return data;
    });
}

function pointsBounds(points) {
  if (!Array.isArray(points) || !points.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, Number(point.x));
    minY = Math.min(minY, Number(point.y));
    maxX = Math.max(maxX, Number(point.x));
    maxY = Math.max(maxY, Number(point.y));
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function pointInPolygon(point, polygon) {
  if (!point || !Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const pi = polygon[i];
    const pj = polygon[j];
    const intersects = (
      (pi.y > point.y) !== (pj.y > point.y) &&
      point.x < ((pj.x - pi.x) * (point.y - pi.y)) / ((pj.y - pi.y) || 1e-9) + pi.x
    );
    if (intersects) inside = !inside;
  }
  return inside;
}

function normalizeRegionShapePoints(shape) {
  const raw = Array.isArray(shape?.points) ? shape.points : [];
  if (!raw.length) return [];
  if (typeof raw[0] === "number") {
    const out = [];
    for (let i = 0; i + 1 < raw.length; i += 2) {
      const x = Number(raw[i]);
      const y = Number(raw[i + 1]);
      if (Number.isFinite(x) && Number.isFinite(y)) out.push({ x, y });
    }
    return out;
  }
  return raw
    .map((point) => ({ x: Number(point?.x), y: Number(point?.y) }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

function regionShapeToObject(shape) {
  if (!shape) return null;
  if (typeof shape.toObject === "function") {
    try {
      return shape.toObject(false);
    } catch (_err) {
      // Fall through to the original object.
    }
  }
  return shape;
}

function isRegionShapeHole(shape) {
  const data = regionShapeToObject(shape);
  const op = String(data?.operation ?? data?.op ?? data?.mode ?? "").trim().toLowerCase();
  return data?.hole === true
    || data?.isHole === true
    || data?.negative === true
    || data?.positive === false
    || op === "subtract"
    || op === "hole"
    || op === "difference";
}

function isIndyFxRegionBehavior(behavior) {
  const type = String(behavior?.type ?? "").trim();
  return type === REGION_SHADER_BEHAVIOR_TYPE || type === LEGACY_REGION_SHADER_BEHAVIOR_TYPE;
}

function regionShapeBounds(shape) {
  const data = regionShapeToObject(shape);
  if (!data) return null;
  const type = String(data.type ?? data.shape ?? data.kind ?? "").toLowerCase();
  if (type === "polygon" || Array.isArray(data.points)) {
    return pointsBounds(normalizeRegionShapePoints(data));
  }
  if (type === "rectangle" || type === "rect" || type === "ellipse" || type === "oval" || type === "circle") {
    const bounds = normalizeRectBounds(data);
    if (!bounds) return null;
    return {
      minX: bounds.minX,
      minY: bounds.minY,
      maxX: bounds.maxX,
      maxY: bounds.maxY,
      width: bounds.maxX - bounds.minX,
      height: bounds.maxY - bounds.minY,
    };
  }
  return null;
}

function readShapeNumber(shape, names, fallback = NaN) {
  for (const name of names) {
    const value = Number(shape?.[name]);
    if (Number.isFinite(value)) return value;
  }
  return fallback;
}

function normalizeRectBounds(shape) {
  const bounds = shape?.bounds ?? {};
  const x1 = readShapeNumber(shape, ["x1", "left", "minX"], readShapeNumber(bounds, ["x", "left", "minX"]));
  const y1 = readShapeNumber(shape, ["y1", "top", "minY"], readShapeNumber(bounds, ["y", "top", "minY"]));
  const x = readShapeNumber(shape, ["x"], x1);
  const y = readShapeNumber(shape, ["y"], y1);
  const width = readShapeNumber(shape, ["width", "w"], readShapeNumber(bounds, ["width", "w"]));
  const height = readShapeNumber(shape, ["height", "h"], readShapeNumber(bounds, ["height", "h"]));
  const x2 = readShapeNumber(shape, ["x2", "right", "maxX"], Number.isFinite(width) ? x + width : NaN);
  const y2 = readShapeNumber(shape, ["y2", "bottom", "maxY"], Number.isFinite(height) ? y + height : NaN);
  if (![x, y, x2, y2].every(Number.isFinite)) return null;
  return {
    minX: Math.min(x, x2),
    minY: Math.min(y, y2),
    maxX: Math.max(x, x2),
    maxY: Math.max(y, y2),
  };
}

function pointInRegionShape(point, shape) {
  const data = regionShapeToObject(shape);
  if (!point || !data) return false;
  const type = String(data.type ?? "").toLowerCase();

  if (type === "polygon" || Array.isArray(data.points)) {
    const polygon = normalizeRegionShapePoints(data);
    return polygon.length >= 3 && pointInPolygon(point, polygon);
  }

  if (type === "rectangle" || type === "rect") {
    const bounds = normalizeRectBounds(data);
    return Boolean(bounds
      && point.x >= bounds.minX
      && point.x <= bounds.maxX
      && point.y >= bounds.minY
      && point.y <= bounds.maxY);
  }

  if (type === "ellipse" || type === "oval" || type === "circle") {
    const radius = readShapeNumber(data, ["radius", "r"]);
    const radiusX = readShapeNumber(data, ["radiusX", "rx"], radius);
    const radiusY = readShapeNumber(data, ["radiusY", "ry"], radius);
    if (Number.isFinite(radiusX) && Number.isFinite(radiusY) && radiusX > 0 && radiusY > 0) {
      const cx = readShapeNumber(data, ["centerX", "cx"], readShapeNumber(data, ["x"]));
      const cy = readShapeNumber(data, ["centerY", "cy"], readShapeNumber(data, ["y"]));
      if (Number.isFinite(cx) && Number.isFinite(cy)) {
        const nx = (point.x - cx) / radiusX;
        const ny = (point.y - cy) / radiusY;
        return ((nx * nx) + (ny * ny)) <= 1;
      }
    }

    const bounds = normalizeRectBounds(data);
    if (!bounds) return false;
    const cx = (bounds.minX + bounds.maxX) * 0.5;
    const cy = (bounds.minY + bounds.maxY) * 0.5;
    const rx = Math.max(0.0001, (bounds.maxX - bounds.minX) * 0.5);
    const ry = Math.max(0.0001, (bounds.maxY - bounds.minY) * 0.5);
    const nx = (point.x - cx) / rx;
    const ny = (point.y - cy) / ry;
    return ((nx * nx) + (ny * ny)) <= 1;
  }

  return false;
}

export class WaterRegionDetector {
  static #moduleId = "indy-regions";
  static #getShaderChoices = null;
  static #syncRegionShaderFromBehavior = null;
  static #cachedSceneId = "";
  static #cachedBackgroundPath = "";
  static #cachedImageData = null;
  static #cachedImgW = 0;
  static #cachedImgH = 0;
  static #activeSession = null;
  static #startingPaintSession = false;

  static configure({ moduleId = "indy-regions", getShaderChoices = null, syncRegionShaderFromBehavior = null } = {}) {
    WaterRegionDetector.#moduleId = String(moduleId || "indy-regions");
    WaterRegionDetector.#getShaderChoices = typeof getShaderChoices === "function"
      ? getShaderChoices
      : null;
    WaterRegionDetector.#syncRegionShaderFromBehavior = typeof syncRegionShaderFromBehavior === "function"
      ? syncRegionShaderFromBehavior
      : null;
  }

  static clearCache() {
    WaterRegionDetector.#cachedSceneId = "";
    WaterRegionDetector.#cachedBackgroundPath = "";
    WaterRegionDetector.#cachedImageData = null;
    WaterRegionDetector.#cachedImgW = 0;
    WaterRegionDetector.#cachedImgH = 0;
  }

  static async #loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Could not load scene background: ${src}`));
      img.src = src;
    });
  }

  static async #ensureImageCache() {
    const scene = canvas?.scene ?? null;
    const sceneId = String(scene?.id ?? "");
    const bgPath = getSceneBackgroundPath(scene);
    if (!scene) return false;

    if (
      WaterRegionDetector.#cachedImageData &&
      WaterRegionDetector.#cachedSceneId === sceneId &&
      WaterRegionDetector.#cachedBackgroundPath === bgPath
    ) {
      return true;
    }

    if (!bgPath) {
      const dims = canvas?.dimensions ?? {};
      const width = Math.max(1, Math.round(Number(dims.sceneWidth) || Number(scene.width) || 1));
      const height = Math.max(1, Math.round(Number(dims.sceneHeight) || Number(scene.height) || 1));
      const offscreen = document.createElement("canvas");
      offscreen.width = width;
      offscreen.height = height;
      const ctx = offscreen.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("Could not create analysis canvas.");
      WaterRegionDetector.#cachedSceneId = sceneId;
      WaterRegionDetector.#cachedBackgroundPath = "";
      WaterRegionDetector.#cachedImageData = ctx.getImageData(0, 0, width, height);
      WaterRegionDetector.#cachedImgW = width;
      WaterRegionDetector.#cachedImgH = height;
      return true;
    }

    const img = await WaterRegionDetector.#loadImage(bgPath);
    const offscreen = document.createElement("canvas");
    offscreen.width = Math.max(1, img.width);
    offscreen.height = Math.max(1, img.height);
    const ctx = offscreen.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Could not create analysis canvas.");
    ctx.drawImage(img, 0, 0);

    WaterRegionDetector.#cachedSceneId = sceneId;
    WaterRegionDetector.#cachedBackgroundPath = bgPath;
    WaterRegionDetector.#cachedImageData = ctx.getImageData(0, 0, offscreen.width, offscreen.height);
    WaterRegionDetector.#cachedImgW = offscreen.width;
    WaterRegionDetector.#cachedImgH = offscreen.height;
    return true;
  }

  static #isMaskCellSet(mask, cols, rows, x, y) {
    if (x < 0 || x >= cols || y < 0 || y >= rows) return false;
    return mask[y * cols + x] === 1;
  }

  static #traceMaskBoundaries(mask, cols, rows) {
    const edges = new Map();
    const addEdge = (ax, ay, bx, by) => {
      const key = `${ax},${ay}`;
      const list = edges.get(key) ?? [];
      list.push({ ax, ay, bx, by });
      edges.set(key, list);
    };
    const takeEdge = (key, preferredDirection = null) => {
      const list = edges.get(key);
      if (!Array.isArray(list) || !list.length) return null;

      let index = 0;
      if (preferredDirection) {
        const preferredIndex = list.findIndex((edge) => (
          Math.sign(edge.bx - edge.ax) === preferredDirection.x &&
          Math.sign(edge.by - edge.ay) === preferredDirection.y
        ));
        if (preferredIndex >= 0) index = preferredIndex;
      }

      const [edge] = list.splice(index, 1);
      if (list.length) edges.set(key, list);
      else edges.delete(key);
      return edge ?? null;
    };
    const firstEdgeEntry = () => {
      for (const [key, list] of edges.entries()) {
        if (Array.isArray(list) && list.length) return { key, edge: takeEdge(key) };
      }
      return null;
    };

    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        if (!WaterRegionDetector.#isMaskCellSet(mask, cols, rows, x, y)) continue;
        if (!WaterRegionDetector.#isMaskCellSet(mask, cols, rows, x, y - 1)) addEdge(x, y, x + 1, y);
        if (!WaterRegionDetector.#isMaskCellSet(mask, cols, rows, x + 1, y)) addEdge(x + 1, y, x + 1, y + 1);
        if (!WaterRegionDetector.#isMaskCellSet(mask, cols, rows, x, y + 1)) addEdge(x + 1, y + 1, x, y + 1);
        if (!WaterRegionDetector.#isMaskCellSet(mask, cols, rows, x - 1, y)) addEdge(x, y + 1, x, y);
      }
    }

    const loops = [];
    while (edges.size) {
      const firstEntry = firstEdgeEntry();
      if (!firstEntry?.edge) break;
      const first = firstEntry.edge;

      const loop = [{ x: first.ax, y: first.ay }];
      let edge = first;
      let guard = 0;
      while (guard < cols * rows * 4) {
        guard += 1;
        const nextPoint = { x: edge.bx, y: edge.by };
        if (nextPoint.x === loop[0].x && nextPoint.y === loop[0].y) break;
        loop.push(nextPoint);
        const nextKey = `${nextPoint.x},${nextPoint.y}`;
        const direction = {
          x: Math.sign(edge.bx - edge.ax),
          y: Math.sign(edge.by - edge.ay),
        };
        edge = takeEdge(nextKey, direction);
        if (!edge) break;
      }
      if (loop.length >= 3) loops.push(loop);
    }

    return loops
      .map((loop) => (polygonArea(loop) < 0 ? loop.slice().reverse() : loop))
      .sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)));
  }

  static #traceRunComponentBoundaries(component, cols, rows) {
    if (!component?.runs?.length) return [];
    const minX = Math.max(0, Math.floor(component.minX));
    const minY = Math.max(0, Math.floor(component.minY));
    const maxX = Math.min(cols - 1, Math.ceil(component.maxX));
    const maxY = Math.min(rows - 1, Math.ceil(component.maxY));
    const width = (maxX - minX) + 1;
    const height = (maxY - minY) + 1;
    if (width <= 0 || height <= 0) return [];

    const occupied = new Uint8Array(width * height);
    for (const run of component.runs) {
      const y = run.y - minY;
      if (y < 0 || y >= height) continue;
      const row = y * width;
      for (let x = Math.max(run.x1, minX); x <= Math.min(run.x2, maxX); x += 1) {
        occupied[row + (x - minX)] = 1;
      }
    }
    const has = (x, y) => {
      const lx = x - minX;
      const ly = y - minY;
      return lx >= 0 && lx < width && ly >= 0 && ly < height && occupied[(ly * width) + lx] === 1;
    };

    const pointWidth = width + 1;
    const pointKey = (x, y) => ((y - minY) * pointWidth) + (x - minX);
    const startToEdges = new Map();
    const ax = [];
    const ay = [];
    const bx = [];
    const by = [];
    const addEdge = (fromX, fromY, toX, toY) => {
      const edgeIndex = ax.length;
      ax.push(fromX);
      ay.push(fromY);
      bx.push(toX);
      by.push(toY);
      const key = pointKey(fromX, fromY);
      let list = startToEdges.get(key);
      if (!list) {
        list = [];
        startToEdges.set(key, list);
      }
      list.push(edgeIndex);
    };

    for (const run of component.runs) {
      const y = run.y;
      for (let x = Math.max(run.x1, minX); x <= Math.min(run.x2, maxX); x += 1) {
        if (!has(x, y - 1)) addEdge(x, y, x + 1, y);
        if (!has(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1);
        if (!has(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1);
        if (!has(x - 1, y)) addEdge(x, y + 1, x, y);
      }
    }

    const used = new Uint8Array(ax.length);
    const take = (key, prevIndex = -1) => {
      const list = startToEdges.get(key);
      if (!list?.length) return null;
      let best = -1;
      if (prevIndex >= 0) {
        const pdx = Math.sign(bx[prevIndex] - ax[prevIndex]);
        const pdy = Math.sign(by[prevIndex] - ay[prevIndex]);
        best = list.findIndex((edgeIndex) => !used[edgeIndex]
          && Math.sign(bx[edgeIndex] - ax[edgeIndex]) === pdx
          && Math.sign(by[edgeIndex] - ay[edgeIndex]) === pdy);
      }
      if (best < 0) best = list.findIndex((edgeIndex) => !used[edgeIndex]);
      if (best < 0) return null;
      const edgeIndex = list[best];
      used[edgeIndex] = 1;
      return edgeIndex;
    };

    const loops = [];
    for (const [key, list] of startToEdges.entries()) {
      for (const candidateIndex of list) {
        if (used[candidateIndex]) continue;
        used[candidateIndex] = 1;
        const loop = [{ x: ax[candidateIndex], y: ay[candidateIndex] }];
        let edgeIndex = candidateIndex;
        let guard = 0;
        while (guard < component.length * 4 + 16) {
          guard += 1;
          const nextPoint = { x: bx[edgeIndex], y: by[edgeIndex] };
          if (nextPoint.x === loop[0].x && nextPoint.y === loop[0].y) break;
          loop.push(nextPoint);
          edgeIndex = take(pointKey(nextPoint.x, nextPoint.y), edgeIndex);
          if (edgeIndex === null) break;
        }
        if (loop.length >= 3) loops.push(loop);
      }
      if (!startToEdges.has(key)) continue;
    }

    return loops
      .map((loop) => (polygonArea(loop) < 0 ? loop.slice().reverse() : loop))
      .sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)));
  }

  static #findMaskComponents(mask, cols, rows, bounds = null) {
    const scanBounds = normalizeMaskBounds(bounds, cols, rows) ?? {
      minX: 0,
      minY: 0,
      maxX: cols - 1,
      maxY: rows - 1,
    };
    scanBounds.width = (scanBounds.maxX - scanBounds.minX) + 1;
    scanBounds.height = (scanBounds.maxY - scanBounds.minY) + 1;
    const visited = new Uint8Array(scanBounds.width * scanBounds.height);
    const components = [];
    const visitedIndex = (x, y) => ((y - scanBounds.minY) * scanBounds.width) + (x - scanBounds.minX);
    for (let y = scanBounds.minY; y <= scanBounds.maxY; y += 1) {
      for (let x = scanBounds.minX; x <= scanBounds.maxX; x += 1) {
        const startIdx = y * cols + x;
        const startVisitedIdx = visitedIndex(x, y);
        if (!mask[startIdx] || visited[startVisitedIdx]) continue;
        const cells = [];
        const stack = [{ x, y }];
        visited[startVisitedIdx] = 1;
        while (stack.length) {
          const cell = stack.pop();
          cells.push(cell);
          for (const [dx, dy] of CARDINAL_DIRECTIONS) {
            const nx = cell.x + dx;
            const ny = cell.y + dy;
            if (nx < scanBounds.minX || nx > scanBounds.maxX || ny < scanBounds.minY || ny > scanBounds.maxY) continue;
            const idx = ny * cols + nx;
            const nextVisitedIdx = visitedIndex(nx, ny);
            if (!mask[idx] || visited[nextVisitedIdx]) continue;
            visited[nextVisitedIdx] = 1;
            stack.push({ x: nx, y: ny });
          }
        }
        components.push(cells);
      }
    }
    return components.sort((a, b) => b.length - a.length);
  }

  static #findMaskComponentsScanline(mask, cols, rows, bounds = null) {
    const scanBounds = normalizeMaskBounds(bounds, cols, rows) ?? {
      minX: 0,
      minY: 0,
      maxX: cols - 1,
      maxY: rows - 1,
      width: cols,
      height: rows,
    };
    scanBounds.width = (scanBounds.maxX - scanBounds.minX) + 1;
    scanBounds.height = (scanBounds.maxY - scanBounds.minY) + 1;

    const parent = [];
    const ranks = [];
    const makeSet = () => {
      const id = parent.length;
      parent.push(id);
      ranks.push(0);
      return id;
    };
    const find = (id) => {
      let x = id;
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    };
    const unite = (a, b) => {
      let ra = find(a);
      let rb = find(b);
      if (ra === rb) return ra;
      if (ranks[ra] < ranks[rb]) [ra, rb] = [rb, ra];
      parent[rb] = ra;
      if (ranks[ra] === ranks[rb]) ranks[ra] += 1;
      return ra;
    };

    let prevRuns = [];
    const runs = [];
    for (let y = scanBounds.minY; y <= scanBounds.maxY; y += 1) {
      const rowRuns = [];
      const rowOffset = y * cols;
      let x = scanBounds.minX;
      let prevIndex = 0;
      while (x <= scanBounds.maxX) {
        while (x <= scanBounds.maxX && !mask[rowOffset + x]) x += 1;
        if (x > scanBounds.maxX) break;
        const x1 = x;
        while (x <= scanBounds.maxX && mask[rowOffset + x]) x += 1;
        const x2 = x - 1;
        const label = makeSet();
        const run = { x1, x2, y, label, count: (x2 - x1) + 1 };
        while (prevIndex < prevRuns.length && prevRuns[prevIndex].x2 < x1) prevIndex += 1;
        for (let i = prevIndex; i < prevRuns.length && prevRuns[i].x1 <= x2; i += 1) {
          unite(label, prevRuns[i].label);
        }
        rowRuns.push(run);
        runs.push(run);
      }
      prevRuns = rowRuns;
    }

    const byRoot = new Map();
    for (const run of runs) {
      const root = find(run.label);
      let component = byRoot.get(root);
      if (!component) {
        component = {
          runs: [],
          length: 0,
          minX: Infinity,
          minY: Infinity,
          maxX: -Infinity,
          maxY: -Infinity,
        };
        byRoot.set(root, component);
      }
      component.runs.push(run);
      component.length += run.count;
      component.minX = Math.min(component.minX, run.x1);
      component.minY = Math.min(component.minY, run.y);
      component.maxX = Math.max(component.maxX, run.x2);
      component.maxY = Math.max(component.maxY, run.y);
    }

    return Array.from(byRoot.values())
      .sort((a, b) => b.length - a.length);
  }

  static #computeMaskBounds(maskData) {
    const { mask, cols, rows } = maskData ?? {};
    if (!mask || !cols || !rows) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let y = 0; y < rows; y += 1) {
      const rowOffset = y * cols;
      for (let x = 0; x < cols; x += 1) {
        if (!mask[rowOffset + x]) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    return normalizeMaskBounds({ minX, minY, maxX, maxY }, cols, rows);
  }

  static #getMaskBounds(maskData) {
    if (!maskData?.mask) return null;
    if (maskData.boundsDirty === true || !maskData.bounds) {
      maskData.bounds = WaterRegionDetector.#computeMaskBounds(maskData);
      maskData.boundsDirty = false;
    }
    return normalizeMaskBounds(maskData.bounds, maskData.cols, maskData.rows);
  }

  static #invalidateMaskDerivedData(maskData, { boundsDirty = false } = {}) {
    if (!maskData) return;
    maskData._morphCache = null;
    maskData._geometryCache = null;
    maskData._distanceCache = null;
    if (boundsDirty === true) maskData.boundsDirty = true;
  }

  static #maskDeltaMetadata(maskData) {
    if (!maskData?.mask) return null;
    return {
      cols: maskData.cols,
      rows: maskData.rows,
      gridStep: maskData.gridStep,
      offsetX: maskData.offsetX ?? 0,
      offsetY: maskData.offsetY ?? 0,
      fullCols: maskData.fullCols ?? maskData.cols,
      fullRows: maskData.fullRows ?? maskData.rows,
      bounds: maskData.bounds ? { ...maskData.bounds } : null,
      boundsDirty: maskData.boundsDirty === true,
    };
  }

  static #createMaskDelta(maskData) {
    const meta = WaterRegionDetector.#maskDeltaMetadata(maskData);
    return meta ? { ...meta, cells: new Map() } : null;
  }

  static #createPaintDeltaRecorder(session) {
    const maskData = session?.maskData ?? null;
    const sourceMaskData = session?.sourceMaskData ?? maskData;
    const maskDelta = WaterRegionDetector.#createMaskDelta(maskData);
    const sourceDelta = sourceMaskData && sourceMaskData !== maskData
      ? WaterRegionDetector.#createMaskDelta(sourceMaskData)
      : null;
    return {
      type: "delta",
      maskData: maskDelta,
      sourceMaskData: sourceDelta,
      record(target, index, previousValue) {
        const delta = target === maskData ? maskDelta : (target === sourceMaskData ? sourceDelta : null);
        if (!delta?.cells || delta.cells.has(index)) return;
        delta.cells.set(index, previousValue ? 1 : 0);
      },
    };
  }

  static #finalizeMaskDelta(delta) {
    if (!delta?.cells?.size) return null;
    const indexes = new Uint32Array(delta.cells.size);
    const values = new Uint8Array(delta.cells.size);
    let i = 0;
    for (const [index, value] of delta.cells.entries()) {
      indexes[i] = index;
      values[i] = value ? 1 : 0;
      i += 1;
    }
    const { cells: _cells, ...meta } = delta;
    return { ...meta, indexes, values };
  }

  static #finalizePaintDelta(recorder) {
    if (recorder?.type !== "delta") return null;
    const maskData = WaterRegionDetector.#finalizeMaskDelta(recorder.maskData);
    const sourceMaskData = WaterRegionDetector.#finalizeMaskDelta(recorder.sourceMaskData);
    if (!maskData && !sourceMaskData) return null;
    return { type: "delta", maskData, sourceMaskData };
  }

  static #applyMaskDelta(maskData, delta) {
    if (!maskData?.mask || !delta?.indexes || !delta?.values) return null;
    if (maskData.cols !== delta.cols || maskData.rows !== delta.rows || maskData.gridStep !== delta.gridStep) return null;
    const inverse = {
      ...WaterRegionDetector.#maskDeltaMetadata(maskData),
      indexes: new Uint32Array(delta.indexes.length),
      values: new Uint8Array(delta.values.length),
    };
    for (let i = 0; i < delta.indexes.length; i += 1) {
      const index = delta.indexes[i];
      if (index >= maskData.mask.length) continue;
      inverse.indexes[i] = index;
      inverse.values[i] = maskData.mask[index] ? 1 : 0;
      maskData.mask[index] = delta.values[i] ? 1 : 0;
    }
    maskData.bounds = delta.bounds ? { ...delta.bounds } : null;
    maskData.boundsDirty = delta.boundsDirty === true;
    WaterRegionDetector.#invalidateMaskDerivedData(maskData, { boundsDirty: maskData.boundsDirty });
    return inverse;
  }

  static #applyPaintDelta(session, entry) {
    if (!session || entry?.type !== "delta") return null;
    const inverseMask = WaterRegionDetector.#applyMaskDelta(session.maskData, entry.maskData);
    const inverseSource = session.sourceMaskData && session.sourceMaskData !== session.maskData
      ? WaterRegionDetector.#applyMaskDelta(session.sourceMaskData, entry.sourceMaskData)
      : null;
    if (!inverseMask && !inverseSource) return null;
    return { type: "delta", maskData: inverseMask, sourceMaskData: inverseSource };
  }

  static #expandBoundsByRadius(bounds, radius, cols, rows) {
    if (!bounds) return null;
    return normalizeMaskBounds({
      minX: bounds.minX - radius,
      minY: bounds.minY - radius,
      maxX: bounds.maxX + radius,
      maxY: bounds.maxY + radius,
    }, cols, rows);
  }

  static #l1DistanceTransform(dist, width, height) {
    const inf = 0x3fffffff;
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      const prevRow = row - width;
      for (let x = 0; x < width; x += 1) {
        const i = row + x;
        let d = dist[i];
        if (x > 0) d = Math.min(d, dist[i - 1] + 1);
        if (y > 0) d = Math.min(d, dist[prevRow + x] + 1);
        dist[i] = d > inf ? inf : d;
      }
    }
    for (let y = height - 1; y >= 0; y -= 1) {
      const row = y * width;
      const nextRow = row + width;
      for (let x = width - 1; x >= 0; x -= 1) {
        const i = row + x;
        let d = dist[i];
        if (x + 1 < width) d = Math.min(d, dist[i + 1] + 1);
        if (y + 1 < height) d = Math.min(d, dist[nextRow + x] + 1);
        dist[i] = d > inf ? inf : d;
      }
    }
    return dist;
  }

  static #componentMaskWithBounds(cells) {
    if (!Array.isArray(cells) || !cells.length) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const cell of cells) {
      minX = Math.min(minX, cell.x);
      minY = Math.min(minY, cell.y);
      maxX = Math.max(maxX, cell.x);
      maxY = Math.max(maxY, cell.y);
    }
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
    const cols = Math.max(1, (maxX - minX) + 1);
    const rows = Math.max(1, (maxY - minY) + 1);
    const mask = new Uint8Array(cols * rows);
    for (const cell of cells) {
      mask[(cell.y - minY) * cols + (cell.x - minX)] = 1;
    }
    return { mask, cols, rows, offsetX: minX, offsetY: minY };
  }

  static #emptyDerivedMaskData(maskData) {
    return {
      mask: new Uint8Array(0),
      cols: 0,
      rows: 0,
      gridStep: maskData?.gridStep,
      offsetX: maskOffsetX(maskData),
      offsetY: maskOffsetY(maskData),
      fullCols: maskFullCols(maskData),
      fullRows: maskFullRows(maskData),
      bounds: null,
    };
  }

  static #smallRadiusDilateMaskData(maskData, radius) {
    const { mask, cols, rows, gridStep } = maskData ?? {};
    const bounds = WaterRegionDetector.#getMaskBounds(maskData);
    const scanBounds = WaterRegionDetector.#expandBoundsByRadius(bounds, radius, cols, rows);
    if (!mask || !cols || !rows || !gridStep || !bounds || !scanBounds) return null;

    const width = scanBounds.width;
    const out = new Uint8Array(width * scanBounds.height);
    let dilatedBounds = null;
    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
      const rowOffset = y * cols;
      for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
        if (!mask[rowOffset + x]) continue;
        for (let dy = -radius; dy <= radius; dy += 1) {
          const yy = y + dy;
          if (yy < scanBounds.minY || yy > scanBounds.maxY) continue;
          const remaining = radius - Math.abs(dy);
          const outRow = (yy - scanBounds.minY) * width;
          for (let dx = -remaining; dx <= remaining; dx += 1) {
            const xx = x + dx;
            if (xx < scanBounds.minX || xx > scanBounds.maxX) continue;
            const outIdx = outRow + (xx - scanBounds.minX);
            if (out[outIdx]) continue;
            out[outIdx] = 1;
            dilatedBounds = expandMaskBounds(dilatedBounds, xx, yy, cols, rows);
          }
        }
      }
    }
    if (!dilatedBounds) return WaterRegionDetector.#emptyDerivedMaskData(maskData);

    const dilated = new Uint8Array(dilatedBounds.width * dilatedBounds.height);
    for (let y = dilatedBounds.minY; y <= dilatedBounds.maxY; y += 1) {
      const sourceRow = (y - scanBounds.minY) * width;
      const targetRow = (y - dilatedBounds.minY) * dilatedBounds.width;
      for (let x = dilatedBounds.minX; x <= dilatedBounds.maxX; x += 1) {
        if (out[sourceRow + (x - scanBounds.minX)]) {
          dilated[targetRow + (x - dilatedBounds.minX)] = 1;
        }
      }
    }

    return {
      mask: dilated,
      cols: dilatedBounds.width,
      rows: dilatedBounds.height,
      gridStep,
      offsetX: maskOffsetX(maskData) + dilatedBounds.minX,
      offsetY: maskOffsetY(maskData) + dilatedBounds.minY,
      fullCols: maskFullCols(maskData),
      fullRows: maskFullRows(maskData),
      bounds: { minX: 0, minY: 0, maxX: dilatedBounds.width - 1, maxY: dilatedBounds.height - 1, width: dilatedBounds.width, height: dilatedBounds.height },
    };
  }

  static #smallRadiusErodeMaskData(maskData, radius) {
    const { mask, cols, rows, gridStep } = maskData ?? {};
    const bounds = WaterRegionDetector.#getMaskBounds(maskData);
    if (!mask || !cols || !rows || !gridStep || !bounds) return null;

    const survives = (x, y) => {
      for (let dy = -radius; dy <= radius; dy += 1) {
        const yy = y + dy;
        const remaining = radius - Math.abs(dy);
        if (yy < 0 || yy >= rows) return false;
        const rowOffset = yy * cols;
        for (let dx = -remaining; dx <= remaining; dx += 1) {
          const xx = x + dx;
          if (xx < 0 || xx >= cols) return false;
          if (!mask[rowOffset + xx]) return false;
        }
      }
      return true;
    };

    let erodedBounds = null;
    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
      const rowOffset = y * cols;
      for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
        if (!mask[rowOffset + x]) continue;
        if (survives(x, y)) erodedBounds = expandMaskBounds(erodedBounds, x, y, cols, rows);
      }
    }
    if (!erodedBounds) return WaterRegionDetector.#emptyDerivedMaskData(maskData);

    const eroded = new Uint8Array(erodedBounds.width * erodedBounds.height);
    for (let y = erodedBounds.minY; y <= erodedBounds.maxY; y += 1) {
      const targetRow = (y - erodedBounds.minY) * erodedBounds.width;
      for (let x = erodedBounds.minX; x <= erodedBounds.maxX; x += 1) {
        if (mask[y * cols + x] && survives(x, y)) {
          eroded[targetRow + (x - erodedBounds.minX)] = 1;
        }
      }
    }

    return {
      mask: eroded,
      cols: erodedBounds.width,
      rows: erodedBounds.height,
      gridStep,
      offsetX: maskOffsetX(maskData) + erodedBounds.minX,
      offsetY: maskOffsetY(maskData) + erodedBounds.minY,
      fullCols: maskFullCols(maskData),
      fullRows: maskFullRows(maskData),
      bounds: { minX: 0, minY: 0, maxX: erodedBounds.width - 1, maxY: erodedBounds.height - 1, width: erodedBounds.width, height: erodedBounds.height },
    };
  }

  static #erodeMaskData(maskData, radiusCells = 0) {
    const { mask, cols, rows, gridStep } = maskData ?? {};
    const radius = Math.max(0, Math.round(Number(radiusCells) || 0));
    if (!mask || !cols || !rows || !gridStep || radius <= 0) return maskData;
    const bounds = WaterRegionDetector.#getMaskBounds(maskData);
    if (!bounds) return { mask: new Uint8Array(mask.length), cols, rows, gridStep, bounds: null };
    if (radius <= SMALL_MORPH_RADIUS_CELLS) {
      maskData._lastDistanceCacheHit = false;
      maskData._lastMorphFastPath = true;
      return WaterRegionDetector.#smallRadiusErodeMaskData(maskData, radius);
    }
    maskData._lastMorphFastPath = false;
    const cacheKey = `erode:${bounds.minX},${bounds.minY},${bounds.maxX},${bounds.maxY}`;
    let distanceCache = maskData._distanceCache;
    let scanBounds = null;
    let distToEmpty = null;
    if (distanceCache?.key === cacheKey && distanceCache.radius >= radius) {
      scanBounds = distanceCache.scanBounds;
      distToEmpty = distanceCache.dist;
      maskData._lastDistanceCacheHit = true;
    } else {
      maskData._lastDistanceCacheHit = false;
      scanBounds = WaterRegionDetector.#expandBoundsByRadius(bounds, radius, cols, rows) ?? bounds;
      const width = scanBounds.width;
      const height = scanBounds.height;
      const inf = 0x3fffffff;
      distToEmpty = new Int32Array(width * height);
      for (let y = 0; y < height; y += 1) {
        const sourceY = scanBounds.minY + y;
        const sourceRow = sourceY * cols;
        const row = y * width;
        for (let x = 0; x < width; x += 1) {
          const sourceX = scanBounds.minX + x;
          distToEmpty[row + x] = mask[sourceRow + sourceX] ? inf : 0;
        }
      }
      WaterRegionDetector.#l1DistanceTransform(distToEmpty, width, height);
      maskData._distanceCache = { key: cacheKey, mode: "erode", radius, scanBounds, dist: distToEmpty };
    }
    const width = scanBounds.width;

    let erodedBounds = null;
    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
      for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
        const idx = y * cols + x;
        if (!mask[idx]) continue;
        const cropIdx = (y - scanBounds.minY) * width + (x - scanBounds.minX);
        const outsideDist = Math.min(x + 1, y + 1, cols - x, rows - y);
        if (Math.min(distToEmpty[cropIdx], outsideDist) > radius) {
          erodedBounds = expandMaskBounds(erodedBounds, x, y, cols, rows);
        }
      }
    }
    if (!erodedBounds) return {
      mask: new Uint8Array(0),
      cols: 0,
      rows: 0,
      gridStep,
      offsetX: maskOffsetX(maskData),
      offsetY: maskOffsetY(maskData),
      fullCols: maskFullCols(maskData),
      fullRows: maskFullRows(maskData),
      bounds: null,
    };
    const eroded = new Uint8Array(erodedBounds.width * erodedBounds.height);
    for (let y = erodedBounds.minY; y <= erodedBounds.maxY; y += 1) {
      for (let x = erodedBounds.minX; x <= erodedBounds.maxX; x += 1) {
        const idx = y * cols + x;
        if (!mask[idx]) continue;
        const cropIdx = (y - scanBounds.minY) * width + (x - scanBounds.minX);
        const outsideDist = Math.min(x + 1, y + 1, cols - x, rows - y);
        if (Math.min(distToEmpty[cropIdx], outsideDist) > radius) {
          eroded[(y - erodedBounds.minY) * erodedBounds.width + (x - erodedBounds.minX)] = 1;
        }
      }
    }

    return {
      mask: eroded,
      cols: erodedBounds.width,
      rows: erodedBounds.height,
      gridStep,
      offsetX: maskOffsetX(maskData) + erodedBounds.minX,
      offsetY: maskOffsetY(maskData) + erodedBounds.minY,
      fullCols: maskFullCols(maskData),
      fullRows: maskFullRows(maskData),
      bounds: { minX: 0, minY: 0, maxX: erodedBounds.width - 1, maxY: erodedBounds.height - 1, width: erodedBounds.width, height: erodedBounds.height },
    };
  }

  static #dilateMaskData(maskData, radiusCells = 0) {
    const { mask, cols, rows, gridStep } = maskData ?? {};
    const radius = Math.max(0, Math.round(Number(radiusCells) || 0));
    if (!mask || !cols || !rows || !gridStep || radius <= 0) return maskData;
    const bounds = WaterRegionDetector.#getMaskBounds(maskData);
    if (!bounds) return { mask: new Uint8Array(mask.length), cols, rows, gridStep, bounds: null };
    if (radius <= SMALL_MORPH_RADIUS_CELLS) {
      maskData._lastDistanceCacheHit = false;
      maskData._lastMorphFastPath = true;
      return WaterRegionDetector.#smallRadiusDilateMaskData(maskData, radius);
    }
    maskData._lastMorphFastPath = false;
    const cacheKey = `dilate:${bounds.minX},${bounds.minY},${bounds.maxX},${bounds.maxY}`;
    let distanceCache = maskData._distanceCache;
    let scanBounds = null;
    let distToFilled = null;
    if (distanceCache?.key === cacheKey && distanceCache.radius >= radius) {
      scanBounds = distanceCache.scanBounds;
      distToFilled = distanceCache.dist;
      maskData._lastDistanceCacheHit = true;
    } else {
      maskData._lastDistanceCacheHit = false;
      scanBounds = WaterRegionDetector.#expandBoundsByRadius(bounds, radius, cols, rows) ?? bounds;
      const width = scanBounds.width;
      const height = scanBounds.height;
      const inf = 0x3fffffff;
      distToFilled = new Int32Array(width * height);
      for (let y = 0; y < height; y += 1) {
        const sourceY = scanBounds.minY + y;
        const sourceRow = sourceY * cols;
        const row = y * width;
        for (let x = 0; x < width; x += 1) {
          const sourceX = scanBounds.minX + x;
          distToFilled[row + x] = mask[sourceRow + sourceX] ? 0 : inf;
        }
      }
      WaterRegionDetector.#l1DistanceTransform(distToFilled, width, height);
      maskData._distanceCache = { key: cacheKey, mode: "dilate", radius, scanBounds, dist: distToFilled };
    }
    const width = scanBounds.width;
    const height = scanBounds.height;

    let dilatedBounds = null;
    for (let y = 0; y < height; y += 1) {
      const sourceY = scanBounds.minY + y;
      const row = y * width;
      for (let x = 0; x < width; x += 1) {
        if (distToFilled[row + x] > radius) continue;
        const sourceX = scanBounds.minX + x;
        dilatedBounds = expandMaskBounds(dilatedBounds, sourceX, sourceY, cols, rows);
      }
    }
    if (!dilatedBounds) return {
      mask: new Uint8Array(0),
      cols: 0,
      rows: 0,
      gridStep,
      offsetX: maskOffsetX(maskData),
      offsetY: maskOffsetY(maskData),
      fullCols: maskFullCols(maskData),
      fullRows: maskFullRows(maskData),
      bounds: null,
    };
    const dilated = new Uint8Array(dilatedBounds.width * dilatedBounds.height);
    for (let y = dilatedBounds.minY; y <= dilatedBounds.maxY; y += 1) {
      const row = (y - scanBounds.minY) * width;
      for (let x = dilatedBounds.minX; x <= dilatedBounds.maxX; x += 1) {
        if (distToFilled[row + (x - scanBounds.minX)] > radius) continue;
        dilated[(y - dilatedBounds.minY) * dilatedBounds.width + (x - dilatedBounds.minX)] = 1;
      }
    }

    return {
      mask: dilated,
      cols: dilatedBounds.width,
      rows: dilatedBounds.height,
      gridStep,
      offsetX: maskOffsetX(maskData) + dilatedBounds.minX,
      offsetY: maskOffsetY(maskData) + dilatedBounds.minY,
      fullCols: maskFullCols(maskData),
      fullRows: maskFullRows(maskData),
      bounds: { minX: 0, minY: 0, maxX: dilatedBounds.width - 1, maxY: dilatedBounds.height - 1, width: dilatedBounds.width, height: dilatedBounds.height },
    };
  }

  static #candidateFromMaskWithOptions(maskData, options = {}) {
    const totalStart = nowMs();
    const opts = normalizeOptions(options);
    const gridStep = Math.max(1, Number(maskData?.gridStep) || DEFAULT_WATER_OPTIONS.gridStep);
    const offsetPx = toFiniteNumber(opts.featherShrinkPx, DEFAULT_WATER_OPTIONS.featherShrinkPx);
    const radiusCells = Math.floor(Math.abs(offsetPx) / gridStep);
    const morphStart = nowMs();
    const morphKey = radiusCells <= 0 ? "none" : `${offsetPx > 0 ? "grow" : "shrink"}:${radiusCells}`;
    let candidateMaskData = maskData;
    let morphCacheHit = false;
    if (radiusCells > 0) {
      if (maskData?._morphCache?.key === morphKey && maskData._morphCache?.maskData) {
        candidateMaskData = maskData._morphCache.maskData;
        morphCacheHit = true;
      } else {
        candidateMaskData = offsetPx > 0
          ? WaterRegionDetector.#dilateMaskData(maskData, radiusCells)
          : WaterRegionDetector.#erodeMaskData(maskData, radiusCells);
        if (maskData) maskData._morphCache = { key: morphKey, maskData: candidateMaskData };
      }
    }
    const morphMs = nowMs() - morphStart;
    const candidate = WaterRegionDetector.candidateFromMask(candidateMaskData, opts.smoothing);
    let fallbackCandidate = null;
    if (!candidate && offsetPx < 0 && radiusCells > 0) {
      fallbackCandidate = WaterRegionDetector.candidateFromMask(maskData, opts.smoothing);
    }
    const result = candidate ?? fallbackCandidate;
    debugTiming(WaterRegionDetector.#moduleId, "candidate-with-options", {
      gridStep,
      cols: maskData?.cols ?? 0,
      rows: maskData?.rows ?? 0,
      cells: (maskData?.cols ?? 0) * (maskData?.rows ?? 0),
      bounds: WaterRegionDetector.#getMaskBounds(maskData),
      offsetPx,
      radiusCells,
      morphCacheHit,
      distanceCacheHit: maskData?._lastDistanceCacheHit === true,
      morphFastPath: maskData?._lastMorphFastPath === true,
      morphMs: roundTimingMs(morphMs),
      totalMs: roundTimingMs(nowMs() - totalStart),
      hadCandidate: Boolean(result),
      usedFallback: Boolean(!candidate && fallbackCandidate),
    });
    return result;
  }

  static candidateFromMask(maskData, smoothing = DEFAULT_WATER_OPTIONS.smoothing) {
    const totalStart = nowMs();
    const { mask, cols, rows, gridStep } = maskData ?? {};
    if (!mask || !cols || !rows || !gridStep) return null;
    const scanBounds = WaterRegionDetector.#getMaskBounds(maskData);
    if (!scanBounds) return null;

    let areaMs = 0;
    let componentsMs = 0;
    let boundsMs = 0;
    let traceMs = 0;
    const geometryCache = maskData._geometryCache;
    let geometry = geometryCache?.scanBounds
      && geometryCache.scanBounds.minX === scanBounds.minX
      && geometryCache.scanBounds.minY === scanBounds.minY
      && geometryCache.scanBounds.maxX === scanBounds.maxX
      && geometryCache.scanBounds.maxY === scanBounds.maxY
      ? geometryCache
      : null;

    if (!geometry) {
      const areaStart = nowMs();
      let area = 0;
      for (let y = scanBounds.minY; y <= scanBounds.maxY; y += 1) {
        const rowOffset = y * cols;
        for (let x = scanBounds.minX; x <= scanBounds.maxX; x += 1) {
          if (mask[rowOffset + x]) area += 1;
        }
      }
      areaMs = nowMs() - areaStart;
      if (area < 3) return null;

      const minShapeArea = Math.max(3, Number(DEFAULT_WATER_OPTIONS.minShapeArea) || 3);
      const componentsStart = nowMs();
      const allComponents = WaterRegionDetector.#findMaskComponentsScanline(mask, cols, rows, scanBounds);
      const components = allComponents.filter((component) => component.length >= minShapeArea);
      componentsMs = nowMs() - componentsStart;

      const rawShapes = [];
      let tracedBoundaryPoints = 0;
      for (const component of components) {
        const traceStart = nowMs();
        const boundaryLoops = WaterRegionDetector.#traceRunComponentBoundaries(component, cols, rows);
        traceMs += nowMs() - traceStart;
        const testPoint = Number.isFinite(component.minX) && Number.isFinite(component.minY)
          ? { x: component.minX + 0.5, y: component.minY + 0.5 }
          : null;
        const outerIndex = Math.max(0, boundaryLoops.findIndex((loop) => pointInPolygon(testPoint, loop)));
        const outerBoundary = boundaryLoops[outerIndex] ?? boundaryLoops[0] ?? null;
        if (!outerBoundary || outerBoundary.length < 3) continue;
        for (let i = 0; i < boundaryLoops.length; i += 1) {
          const rawBoundary = boundaryLoops[i];
          if (!rawBoundary || rawBoundary.length < 3) continue;
          const isHole = i !== outerIndex;
          if (isHole && Math.abs(polygonArea(rawBoundary)) < MIN_HOLE_LOOP_AREA_CELLS) continue;
          tracedBoundaryPoints += rawBoundary.length;
          rawShapes.push({
            rawBoundary,
            area: isHole ? 0 : component.length,
            isHole,
          });
        }
      }

      geometry = {
        area,
        allComponentCount: allComponents.length,
        componentCount: components.length,
        rawShapes,
        simplifyCache: new Map(),
        scanBounds: { ...scanBounds },
        tracedBoundaryPoints,
        areaMs,
        componentsMs,
        boundsMs,
        traceMs,
      };
      maskData._geometryCache = geometry;
    }

    const area = geometry.area;
    if (area < 3) return null;

    const imgW = WaterRegionDetector.#cachedImgW;
    const imgH = WaterRegionDetector.#cachedImgH;
    const dataOffsetX = maskOffsetX(maskData);
    const dataOffsetY = maskOffsetY(maskData);
    const shapes = [];
    let simplifyMs = 0;
    let simplifiedBoundaryPoints = 0;
    const smoothingKey = String(Number(smoothing) || 0);
    let simplifiedShapes = geometry.simplifyCache?.get?.(smoothingKey) ?? null;

    if (!simplifiedShapes) {
      simplifiedShapes = [];
      for (const rawShape of geometry.rawShapes) {
        const rawBoundary = rawShape.rawBoundary;
        const simplifyStart = nowMs();
        const simplified = simplifyClosedPolygon(rawBoundary, smoothing);
        simplifyMs += nowMs() - simplifyStart;
        if (simplified.length < 3) continue;
        simplifiedShapes.push({ simplified, area: rawShape.area, isHole: rawShape.isHole === true });
      }
      if (!geometry.simplifyCache) geometry.simplifyCache = new Map();
      geometry.simplifyCache.set(smoothingKey, simplifiedShapes);
    }

    for (const simplifiedShape of simplifiedShapes) {
      const simplified = simplifiedShape.simplified;
      simplifiedBoundaryPoints += simplified.length;
      const points = simplified.map((point) =>
        imageGridPointToScene(point.x + dataOffsetX, point.y + dataOffsetY, gridStep, imgW, imgH),
      );
      if (points.length >= 3) {
        shapes.push({
          points,
          area: simplifiedShape.area,
          isHole: simplifiedShape.isHole === true,
          bounds: pointsBounds(points),
        });
      }
    }
    if (!shapes.length) {
      debugTiming(WaterRegionDetector.#moduleId, "candidate-from-mask", {
        gridStep,
        cols,
        rows,
        cells: cols * rows,
        scanCells: scanBounds.width * scanBounds.height,
        scanBounds,
        filledCells: area,
        fillPercent: roundTimingMs((area / Math.max(1, cols * rows)) * 100),
        allComponents: geometry.allComponentCount,
        keptComponents: geometry.componentCount,
        shapes: 0,
        geometryCacheHit: geometryCache === geometry,
        areaMs: roundTimingMs(geometry.areaMs ?? areaMs),
        componentsMs: roundTimingMs(geometry.componentsMs ?? componentsMs),
        boundsMs: roundTimingMs(geometry.boundsMs ?? boundsMs),
        traceMs: roundTimingMs(geometry.traceMs ?? traceMs),
        simplifyMs: roundTimingMs(simplifyMs),
        totalMs: roundTimingMs(nowMs() - totalStart),
      });
      return null;
    }

    const points = shapes[0].points;

    let cx = 0;
    let cy = 0;
    let pointCount = 0;
    for (const shape of shapes) {
      for (const point of shape.points) {
        cx += point.x;
        cy += point.y;
        pointCount += 1;
      }
    }

    const result = {
      points,
      shapes,
      area,
      componentCount: geometry.componentCount,
      shapeCount: shapes.length,
      centroid: {
        x: cx / Math.max(1, pointCount),
        y: cy / Math.max(1, pointCount),
      },
      vertexCount: pointCount,
    };
    debugTiming(WaterRegionDetector.#moduleId, "candidate-from-mask", {
      gridStep,
      cols,
      rows,
      cells: cols * rows,
      scanCells: scanBounds.width * scanBounds.height,
      scanBounds,
      filledCells: area,
      fillPercent: roundTimingMs((area / Math.max(1, cols * rows)) * 100),
      allComponents: geometry.allComponentCount,
      keptComponents: geometry.componentCount,
      shapes: shapes.length,
      tracedBoundaryPoints: geometry.tracedBoundaryPoints,
      simplifiedBoundaryPoints,
      smoothing,
      geometryCacheHit: geometryCache === geometry,
      areaMs: roundTimingMs(geometry.areaMs ?? areaMs),
      componentsMs: roundTimingMs(geometry.componentsMs ?? componentsMs),
      boundsMs: roundTimingMs(geometry.boundsMs ?? boundsMs),
      traceMs: roundTimingMs(geometry.traceMs ?? traceMs),
      simplifyMs: roundTimingMs(simplifyMs),
      totalMs: roundTimingMs(nowMs() - totalStart),
    });
    return result;
  }

  static #createEmptyMaskData(options = {}) {
    const opts = normalizeOptions(options);
    const gridStep = Math.max(1, Math.round(toFiniteNumber(opts.gridStep, DEFAULT_WATER_OPTIONS.gridStep)));
    const imgW = WaterRegionDetector.#cachedImgW;
    const imgH = WaterRegionDetector.#cachedImgH;
    const cols = Math.ceil(imgW / gridStep);
    const rows = Math.ceil(imgH / gridStep);
    return {
      mask: new Uint8Array(cols * rows),
      cols,
      rows,
      gridStep,
    };
  }

  static #createMaskDataForGridStep(gridStep = DEFAULT_WATER_OPTIONS.gridStep) {
    return WaterRegionDetector.#createEmptyMaskData({ gridStep });
  }

  static #resampleMaskData(source, gridStep = DEFAULT_WATER_OPTIONS.gridStep) {
    if (!source?.mask || !source.cols || !source.rows || !source.gridStep) return null;
    const target = WaterRegionDetector.#createMaskDataForGridStep(gridStep);
    const scale = target.gridStep / source.gridStep;
    for (let y = 0; y < target.rows; y += 1) {
      const sy = Math.min(source.rows - 1, Math.max(0, Math.floor(y * scale)));
      for (let x = 0; x < target.cols; x += 1) {
        const sx = Math.min(source.cols - 1, Math.max(0, Math.floor(x * scale)));
        const from = sy * source.cols + sx;
        const to = y * target.cols + x;
        if (!source.mask[from]) continue;
        target.mask[to] = 1;
        target.bounds = expandMaskBounds(target.bounds, x, y, target.cols, target.rows);
      }
    }
    return target;
  }

  static #stampBrushOnMask(maskData, sceneX, sceneY, mode = "add", options = {}, changeRecorder = null) {
    const { mask, cols, rows, gridStep } = maskData ?? {};
    if (!mask || !cols || !rows || !gridStep) return 0;
    const opts = normalizeOptions(options);
    const imgW = WaterRegionDetector.#cachedImgW;
    const imgH = WaterRegionDetector.#cachedImgH;
    const imgPoint = sceneToImagePoint(sceneX, sceneY, imgW, imgH);
    if (imgPoint.x < 0 || imgPoint.x >= imgW || imgPoint.y < 0 || imgPoint.y >= imgH) return 0;

    const radiusPx = Math.max(0.5, toFiniteNumber(opts.brushSizePx, DEFAULT_WATER_OPTIONS.brushSizePx) * 0.5);
    const radiusCells = Math.max(1, Math.ceil(radiusPx / gridStep));
    const centerGX = Math.round(imgPoint.x / gridStep);
    const centerGY = Math.round(imgPoint.y / gridStep);
    const radiusSq = radiusPx * radiusPx;
    const op = String(mode ?? "add").trim().toLowerCase();
    let changed = 0;
    let changedMinX = Infinity;
    let changedMinY = Infinity;
    let changedMaxX = -Infinity;
    let changedMaxY = -Infinity;
    const noteChangedCell = (gx, gy) => {
      changedMinX = Math.min(changedMinX, gx);
      changedMinY = Math.min(changedMinY, gy);
      changedMaxX = Math.max(changedMaxX, gx);
      changedMaxY = Math.max(changedMaxY, gy);
    };

    for (let gy = centerGY - radiusCells; gy <= centerGY + radiusCells; gy += 1) {
      if (gy < 0 || gy >= rows) continue;
      for (let gx = centerGX - radiusCells; gx <= centerGX + radiusCells; gx += 1) {
        if (gx < 0 || gx >= cols) continue;
        const px = (gx + 0.5) * gridStep;
        const py = (gy + 0.5) * gridStep;
        const dx = px - imgPoint.x;
        const dy = py - imgPoint.y;
        if (((dx * dx) + (dy * dy)) > radiusSq) continue;
        const idx = gy * cols + gx;
        if (op === "subtract" || op === "remove") {
          if (mask[idx]) {
            changeRecorder?.(maskData, idx, mask[idx]);
            mask[idx] = 0;
            changed += 1;
            noteChangedCell(gx, gy);
          }
        } else {
          if (!mask[idx]) {
            changeRecorder?.(maskData, idx, mask[idx]);
            mask[idx] = 1;
            changed += 1;
            noteChangedCell(gx, gy);
          }
        }
      }
    }

    if (changed > 0) {
      maskData._lastChangedBounds = normalizeMaskBounds({
        minX: changedMinX,
        minY: changedMinY,
        maxX: changedMaxX,
        maxY: changedMaxY,
      }, cols, rows);
      if (op === "subtract" || op === "remove") {
        WaterRegionDetector.#invalidateMaskDerivedData(maskData, { boundsDirty: true });
      } else {
        maskData.bounds = expandMaskBounds(maskData.bounds, changedMinX, changedMinY, cols, rows);
        maskData.bounds = expandMaskBounds(maskData.bounds, changedMaxX, changedMaxY, cols, rows);
        maskData.boundsDirty = false;
        WaterRegionDetector.#invalidateMaskDerivedData(maskData);
      }
    }

    return changed;
  }

  static #applySparseFloodFillToMask(maskData, sceneX, sceneY, mode = "add", options = {}, changeRecorder = null) {
    const { mask, cols, rows, gridStep } = maskData ?? {};
    if (!mask || !cols || !rows || !gridStep) return { changed: 0, visited: 0 };

    const imgW = WaterRegionDetector.#cachedImgW;
    const imgH = WaterRegionDetector.#cachedImgH;
    const imageData = WaterRegionDetector.#cachedImageData;
    if (!imageData || imgW <= 0 || imgH <= 0) return { changed: 0, visited: 0 };

    const opts = normalizeOptions(options);
    const imgPoint = sceneToImagePoint(sceneX, sceneY, imgW, imgH);
    if (imgPoint.x < 0 || imgPoint.x >= imgW || imgPoint.y < 0 || imgPoint.y >= imgH) return { changed: 0, visited: 0 };

    const pixels = imageData.data;
    const seedIdx = (imgPoint.y * imgW + imgPoint.x) * 4;
    const seedR = pixels[seedIdx];
    const seedG = pixels[seedIdx + 1];
    const seedB = pixels[seedIdx + 2];
    if (opts.requireWaterLikeSeed !== false && !isWaterLikeRgb(seedR, seedG, seedB)) {
      return { changed: 0, visited: 0 };
    }

    const fillColorMode = String(opts.fillColorMode ?? DEFAULT_WATER_OPTIONS.fillColorMode).trim().toLowerCase() === "hsl"
      ? "hsl"
      : "rgb";
    const seedHsl = fillColorMode === "hsl" ? rgb255ToHsl(seedR, seedG, seedB) : null;
    const tolSq = Math.max(0, Number(opts.tolerance) || 0) ** 2;
    const bridgeCells = Math.max(0, Math.round(toFiniteNumber(opts.fillBridgePx, DEFAULT_WATER_OPTIONS.fillBridgePx) / gridStep));
    const offsetX = maskOffsetX(maskData);
    const offsetY = maskOffsetY(maskData);
    const seedGX = Math.floor(imgPoint.x / gridStep) - offsetX;
    const seedGY = Math.floor(imgPoint.y / gridStep) - offsetY;
    if (seedGX < 0 || seedGX >= cols || seedGY < 0 || seedGY >= rows) return { changed: 0, visited: 0 };

    const fullCols = maskFullCols(maskData);
    const fullRows = maskFullRows(maskData);
    const colorMatches = (gx, gy) => {
      const fullX = gx + offsetX;
      const fullY = gy + offsetY;
      if (fullX < 0 || fullX >= fullCols || fullY < 0 || fullY >= fullRows) return false;
      const px = Math.min(fullX * gridStep, imgW - 1);
      const py = Math.min(fullY * gridStep, imgH - 1);
      const idx = (py * imgW + px) * 4;
      if (fillColorMode === "hsl") {
        const hsl = rgb255ToHsl(pixels[idx], pixels[idx + 1], pixels[idx + 2]);
        const dhRaw = Math.abs(hsl.h - seedHsl.h);
        const dh = Math.min(dhRaw, 1 - dhRaw) * 255;
        const ds = (hsl.s - seedHsl.s) * 255;
        const dl = (hsl.l - seedHsl.l) * 255;
        if (((dh * dh) + (ds * ds) + (dl * dl)) > tolSq) return false;
      } else {
        const dr = pixels[idx] - seedR;
        const dg = pixels[idx + 1] - seedG;
        const db = pixels[idx + 2] - seedB;
        if (((dr * dr) + (dg * dg) + (db * db)) > tolSq) return false;
      }
      if (opts.requireWaterLikeFill === false) return true;
      return isWaterLikeRgb(pixels[idx], pixels[idx + 1], pixels[idx + 2]);
    };

    const op = String(mode ?? "add").trim().toLowerCase();
    let changed = 0;
    let visited = 0;
    let changedMinX = Infinity;
    let changedMinY = Infinity;
    let changedMaxX = -Infinity;
    let changedMaxY = -Infinity;
    const noteChangedCell = (gx, gy) => {
      changedMinX = Math.min(changedMinX, gx);
      changedMinY = Math.min(changedMinY, gy);
      changedMaxX = Math.max(changedMaxX, gx);
      changedMaxY = Math.max(changedMaxY, gy);
    };
    const applyCell = (gx, gy) => {
      const idx = gy * cols + gx;
      if (op === "subtract" || op === "remove") {
        if (!mask[idx]) return;
        changeRecorder?.(maskData, idx, mask[idx]);
        mask[idx] = 0;
      } else {
        if (mask[idx]) return;
        changeRecorder?.(maskData, idx, mask[idx]);
        mask[idx] = 1;
      }
      changed += 1;
      noteChangedCell(gx, gy);
    };

    const stackX = [seedGX];
    const stackY = [seedGY];
    const stackGap = bridgeCells > 0 ? [0] : null;
    const cellCount = cols * rows;
    let visitedBits = null;
    let visitedSet = null;
    let bestGap = null;
    if (bridgeCells > 0) {
      bestGap = new Map([[seedGY * cols + seedGX, 0]]);
    } else {
      try {
        visitedBits = new Uint8Array(Math.ceil(cellCount / 8));
        const seedBit = seedGY * cols + seedGX;
        visitedBits[seedBit >> 3] |= 1 << (seedBit & 7);
      } catch (_err) {
        visitedSet = new Set([seedGY * cols + seedGX]);
      }
    }

    const pushCell = (gx, gy, gap) => {
      if (gx < 0 || gx >= cols || gy < 0 || gy >= rows) return;
      const idx = gy * cols + gx;
      if (bridgeCells > 0) {
        const currentBest = bestGap.get(idx);
        if (currentBest !== undefined && gap >= currentBest) return;
        bestGap.set(idx, gap);
        stackGap.push(gap);
      } else if (visitedBits) {
        const byte = idx >> 3;
        const bit = 1 << (idx & 7);
        if ((visitedBits[byte] & bit) !== 0) return;
        visitedBits[byte] |= bit;
      } else {
        if (visitedSet.has(idx)) return;
        visitedSet.add(idx);
      }
      stackX.push(gx);
      stackY.push(gy);
    };

    while (stackX.length) {
      const x = stackX.pop();
      const y = stackY.pop();
      const gap = stackGap ? stackGap.pop() : 0;
      visited += 1;
      const matchingCell = colorMatches(x, y);
      if (matchingCell) applyCell(x, y);

      for (const [dx, dy] of CARDINAL_DIRECTIONS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
        const nextMatches = colorMatches(nx, ny);
        const nextGap = nextMatches ? 0 : gap + 1;
        if (nextGap > bridgeCells) continue;
        pushCell(nx, ny, nextGap);
      }
    }

    if (changed > 0) {
      maskData._lastChangedBounds = normalizeMaskBounds({
        minX: changedMinX,
        minY: changedMinY,
        maxX: changedMaxX,
        maxY: changedMaxY,
      }, cols, rows);
      if (op === "subtract" || op === "remove") {
        WaterRegionDetector.#invalidateMaskDerivedData(maskData, { boundsDirty: true });
      } else {
        maskData.bounds = expandMaskBounds(maskData.bounds, changedMinX, changedMinY, cols, rows);
        maskData.bounds = expandMaskBounds(maskData.bounds, changedMaxX, changedMaxY, cols, rows);
        maskData.boundsDirty = false;
        WaterRegionDetector.#invalidateMaskDerivedData(maskData);
      }
    }

    return { changed, visited };
  }

  static #fillMaskAlpha(maskData, alpha = 255) {
    if (!maskData?.mask) return maskData;
    if (!maskData.alphaMask || maskData.alphaMask.length !== maskData.mask.length) {
      maskData.alphaMask = new Uint8Array(maskData.mask.length);
    }
    for (let i = 0; i < maskData.mask.length; i += 1) {
      if (maskData.mask[i]) {
        maskData.alphaMask[i] = alpha;
      }
    }
    if (!maskData.bounds) maskData.boundsDirty = true;
    return maskData;
  }

  static #savePaintMaskFlag(region, session, options = {}) {
    if (!region?.setFlag || !session?.maskData?.mask) return;
    const { mask, cols, rows, gridStep } = session.maskData;
    const fullCols = maskFullCols(session.maskData);
    const fullRows = maskFullRows(session.maskData);
    const localOffsetX = maskOffsetX(session.maskData);
    const localOffsetY = maskOffsetY(session.maskData);
    const localBounds = WaterRegionDetector.#getMaskBounds(session.maskData);
    const bounds = localBounds ? normalizeMaskBounds({
      minX: localOffsetX + localBounds.minX,
      minY: localOffsetY + localBounds.minY,
      maxX: localOffsetX + localBounds.maxX,
      maxY: localOffsetY + localBounds.maxY,
    }, fullCols, fullRows) : null;
    const cropCols = localBounds?.width ?? 0;
    const cropRows = localBounds?.height ?? 0;
    const alpha = new Uint8Array(cropCols * cropRows);
    if (localBounds) {
      for (let y = localBounds.minY; y <= localBounds.maxY; y += 1) {
        const sourceRow = y * cols;
        const targetRow = (y - localBounds.minY) * cropCols;
        for (let x = localBounds.minX; x <= localBounds.maxX; x += 1) {
          if (mask[sourceRow + x]) alpha[targetRow + (x - localBounds.minX)] = 255;
        }
      }
    }
    void region.setFlag(WaterRegionDetector.#moduleId, PAINT_MASK_FLAG, {
      version: 2,
      format: "cropped-alpha",
      cols: fullCols,
      rows: fullRows,
      gridStep,
      bounds,
      offsetX: bounds?.minX ?? 0,
      offsetY: bounds?.minY ?? 0,
      cropCols,
      cropRows,
      color: normalizeHexColor(options.paintColor, DEFAULT_WATER_OPTIONS.paintColor),
      alpha: bytesToBase64(alpha),
    });
  }

  static #loadPaintMaskFlag(region, options = {}) {
    const data = region?.getFlag?.(WaterRegionDetector.#moduleId, PAINT_MASK_FLAG)
      ?? region?.document?.getFlag?.(WaterRegionDetector.#moduleId, PAINT_MASK_FLAG);
    if (!data) return null;
    const opts = normalizeOptions(options);
    const gridStep = Math.max(1, Math.round(toFiniteNumber(data.gridStep, opts.gridStep)));
    const cols = Math.max(1, Math.round(toFiniteNumber(data.cols, 0)));
    const rows = Math.max(1, Math.round(toFiniteNumber(data.rows, 0)));
    const alphaMask = base64ToBytes(data.alpha);
    if (!cols || !rows || !alphaMask) return null;
    const mask = new Uint8Array(cols * rows);
    const cropCols = Math.max(0, Math.round(toFiniteNumber(data.cropCols, 0)));
    const cropRows = Math.max(0, Math.round(toFiniteNumber(data.cropRows, 0)));
    const offsetX = Math.max(0, Math.round(toFiniteNumber(data.offsetX, 0)));
    const offsetY = Math.max(0, Math.round(toFiniteNumber(data.offsetY, 0)));
    if (data.version >= 2 || data.format === "cropped-alpha") {
      if (alphaMask.length !== cropCols * cropRows) return null;
      for (let y = 0; y < cropRows; y += 1) {
        const targetY = offsetY + y;
        if (targetY < 0 || targetY >= rows) continue;
        const sourceRow = y * cropCols;
        const targetRow = targetY * cols;
        for (let x = 0; x < cropCols; x += 1) {
          if (!alphaMask[sourceRow + x]) continue;
          const targetX = offsetX + x;
          if (targetX < 0 || targetX >= cols) continue;
          mask[targetRow + targetX] = 1;
        }
      }
    } else {
      if (alphaMask.length !== cols * rows) return null;
      for (let i = 0; i < alphaMask.length; i += 1) if (alphaMask[i]) mask[i] = 1;
    }
    const maskData = { mask, cols, rows, gridStep, bounds: normalizeMaskBounds(data.bounds, cols, rows) };
    if (!maskData.bounds) maskData.boundsDirty = true;
    return {
      maskData,
      color: normalizeHexColor(data.color, opts.paintColor),
    };
  }

  static paintPreviewFromMask(maskData, color = DEFAULT_WATER_OPTIONS.paintColor, opacity = DEFAULT_WATER_OPTIONS.paintOpacity) {
    const totalStart = nowMs();
    const { mask, alphaMask, cols, rows, gridStep } = maskData ?? {};
    if (!mask || !cols || !rows || !gridStep) return null;
    const imgW = WaterRegionDetector.#cachedImgW;
    const imgH = WaterRegionDetector.#cachedImgH;
    if (!imgW || !imgH) return null;
    const bounds = WaterRegionDetector.#getMaskBounds(maskData);
    if (!bounds) return null;
    const rgb = hexToRgbInt(color);
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = bounds.width;
    maskCanvas.height = bounds.height;
    const ctx = maskCanvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = false;

    const imageData = ctx.createImageData(bounds.width, bounds.height);
    const data = imageData.data;
    const pixelsStart = nowMs();
    let visibleCells = 0;
    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
      const sourceRowOffset = y * cols;
      const targetRowOffset = (y - bounds.minY) * bounds.width;
      for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
        const sourceIndex = sourceRowOffset + x;
        if (!mask[sourceIndex]) continue;
        const alpha = alphaMask?.[sourceIndex] ?? 255;
        if (alpha <= 0) continue;
        visibleCells += 1;
        const di = (targetRowOffset + (x - bounds.minX)) * 4;
        data[di] = rgb.r;
        data[di + 1] = rgb.g;
        data[di + 2] = rgb.b;
        data[di + 3] = alpha;
      }
    }
    ctx.putImageData(imageData, 0, 0);
    const pixelsMs = nowMs() - pixelsStart;

    const textureStart = nowMs();
    const texture = PIXI.Texture.from(maskCanvas);
    const sprite = new PIXI.Sprite(texture);
    const textureMs = nowMs() - textureStart;
    const map = getSceneImageMapping(imgW, imgH);
    const scaleX = map.sceneWidth / imgW;
    const scaleY = map.sceneHeight / imgH;
    sprite.x = map.sceneX + (bounds.minX * gridStep * scaleX);
    sprite.y = map.sceneY + (bounds.minY * gridStep * scaleY);
    sprite.width = bounds.width * gridStep * scaleX;
    sprite.height = bounds.height * gridStep * scaleY;
    sprite.alpha = normalizePaintOpacity(opacity);
    sprite.eventMode = "none";
    sprite.zIndex = 1000000;
    sprite._indyRegionsPreviewCanvas = maskCanvas;
    sprite._indyRegionsPreviewCtx = ctx;
    sprite._indyRegionsPreviewBounds = { ...bounds };
    sprite._indyRegionsPreviewColor = normalizeHexColor(color, DEFAULT_WATER_OPTIONS.paintColor);
    sprite._indyRegionsPreviewOpacity = normalizePaintOpacity(opacity);
    debugTiming(WaterRegionDetector.#moduleId, "paint-preview-from-mask", {
      gridStep,
      cols,
      rows,
      cells: cols * rows,
      previewCells: bounds.width * bounds.height,
      bounds,
      visibleCells,
      pixelsMs: roundTimingMs(pixelsMs),
      textureMs: roundTimingMs(textureMs),
      totalMs: roundTimingMs(nowMs() - totalStart),
    });
    return sprite;
  }

  static #updatePaintPreviewDirtyRect(session, dirtyBounds, color = DEFAULT_WATER_OPTIONS.paintColor, opacity = DEFAULT_WATER_OPTIONS.paintOpacity) {
    const totalStart = nowMs();
    const sprite = session?.previewSprite;
    const maskData = session?.maskData;
    const { mask, cols, rows } = maskData ?? {};
    const previewBounds = sprite?._indyRegionsPreviewBounds;
    const ctx = sprite?._indyRegionsPreviewCtx;
    if (!sprite || !ctx || !mask || !cols || !rows || !previewBounds) return false;
    const currentBounds = WaterRegionDetector.#getMaskBounds(maskData);
    const normalizedDirty = normalizeMaskBounds(dirtyBounds, cols, rows);
    const normalizedColor = normalizeHexColor(color, DEFAULT_WATER_OPTIONS.paintColor);
    const normalizedOpacity = normalizePaintOpacity(opacity);
    if (!currentBounds || !normalizedDirty) return false;
    if (!sameMaskBounds(currentBounds, previewBounds)) return false;
    if (sprite._indyRegionsPreviewColor !== normalizedColor) return false;
    sprite.alpha = normalizedOpacity;
    sprite._indyRegionsPreviewOpacity = normalizedOpacity;

    const updateBounds = normalizeMaskBounds({
      minX: Math.max(previewBounds.minX, normalizedDirty.minX),
      minY: Math.max(previewBounds.minY, normalizedDirty.minY),
      maxX: Math.min(previewBounds.maxX, normalizedDirty.maxX),
      maxY: Math.min(previewBounds.maxY, normalizedDirty.maxY),
    }, cols, rows);
    if (!updateBounds) return true;

    const rgb = hexToRgbInt(normalizedColor);
    const imageData = ctx.createImageData(updateBounds.width, updateBounds.height);
    const data = imageData.data;
    const pixelsStart = nowMs();
    let visibleCells = 0;
    for (let y = updateBounds.minY; y <= updateBounds.maxY; y += 1) {
      const sourceRowOffset = y * cols;
      const targetRowOffset = (y - updateBounds.minY) * updateBounds.width;
      for (let x = updateBounds.minX; x <= updateBounds.maxX; x += 1) {
        if (!mask[sourceRowOffset + x]) continue;
        visibleCells += 1;
        const di = (targetRowOffset + (x - updateBounds.minX)) * 4;
        data[di] = rgb.r;
        data[di + 1] = rgb.g;
        data[di + 2] = rgb.b;
        data[di + 3] = maskData.alphaMask?.[sourceRowOffset + x] ?? 255;
      }
    }
    const canvasX = updateBounds.minX - previewBounds.minX;
    const canvasY = updateBounds.minY - previewBounds.minY;
    ctx.clearRect(canvasX, canvasY, updateBounds.width, updateBounds.height);
    ctx.putImageData(imageData, canvasX, canvasY);
    const pixelsMs = nowMs() - pixelsStart;

    const textureStart = nowMs();
    try {
      sprite.texture?.update?.();
      sprite.texture?.baseTexture?.update?.();
    } catch (_err) {
      // Non-fatal. The next full rebuild will recover if this renderer does not expose update.
    }
    const textureMs = nowMs() - textureStart;
    debugTiming(WaterRegionDetector.#moduleId, "paint-preview-dirty-rect", {
      gridStep: maskData.gridStep ?? 0,
      cols,
      rows,
      dirtyCells: updateBounds.width * updateBounds.height,
      visibleCells,
      bounds: updateBounds,
      pixelsMs: roundTimingMs(pixelsMs),
      textureMs: roundTimingMs(textureMs),
      totalMs: roundTimingMs(nowMs() - totalStart),
    });
    return true;
  }

  static #setPaintMaskPreview(session) {
    if (!session?.isPaintSession) return;
    const totalStart = nowMs();
    const opts = WaterRegionDetector.#readPaintSessionOptions(session);
    const dirtyBounds = session.paintPreviewDirtyBounds;
    session.paintPreviewDirtyBounds = null;
    if (session.previewSprite) {
      session.previewSprite.alpha = normalizePaintOpacity(opts.paintOpacity);
      session.previewSprite._indyRegionsPreviewOpacity = normalizePaintOpacity(opts.paintOpacity);
    }
    if (dirtyBounds && WaterRegionDetector.#updatePaintPreviewDirtyRect(session, dirtyBounds, opts.paintColor, opts.paintOpacity)) {
      debugTiming(WaterRegionDetector.#moduleId, "set-paint-mask-preview", {
        gridStep: session.maskData?.gridStep ?? 0,
        cols: session.maskData?.cols ?? 0,
        rows: session.maskData?.rows ?? 0,
        dirtyPreview: true,
        totalMs: roundTimingMs(nowMs() - totalStart),
      });
      return;
    }

    destroyPreviewSprite(session.previewSprite);
    session.previewSprite = null;
    const sprite = WaterRegionDetector.paintPreviewFromMask(session.maskData, opts.paintColor, opts.paintOpacity);
    if (!sprite) return;
    getPreviewLayer()?.addChild?.(sprite);
    session.previewSprite = sprite;
    debugTiming(WaterRegionDetector.#moduleId, "set-paint-mask-preview", {
      gridStep: session.maskData?.gridStep ?? 0,
      cols: session.maskData?.cols ?? 0,
      rows: session.maskData?.rows ?? 0,
      dirtyPreview: false,
      totalMs: roundTimingMs(nowMs() - totalStart),
    });
  }

  static #maskFromRegionShapes(region, options = {}) {
    const opts = normalizeOptions(options);
    const maskData = WaterRegionDetector.#createEmptyMaskData(opts);
    const shapes = Array.isArray(region?.shapes)
      ? region.shapes
      : (Array.isArray(region?.document?.shapes) ? region.document.shapes : []);
    if (!shapes.length) return null;

    const imgW = WaterRegionDetector.#cachedImgW;
    const imgH = WaterRegionDetector.#cachedImgH;
    const { mask, cols, rows, gridStep } = maskData;
    const map = getSceneImageMapping(imgW, imgH);
    const scaleX = map.sceneWidth / imgW;
    const scaleY = map.sceneHeight / imgH;

    const usableShapes = shapes
      .map((shape) => regionShapeToObject(shape))
      .filter((shape) => shape && typeof shape === "object");
    if (!usableShapes.length) return null;
    const solidShapes = usableShapes.filter((shape) => !isRegionShapeHole(shape));
    const holeShapes = usableShapes.filter((shape) => isRegionShapeHole(shape));
    if (!solidShapes.length) return null;

    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const scenePoint = {
          x: map.sceneX + ((x + 0.5) * gridStep * scaleX),
          y: map.sceneY + ((y + 0.5) * gridStep * scaleY),
        };
        const insideSolid = solidShapes.some((shape) => pointInRegionShape(scenePoint, shape));
        if (!insideSolid) continue;
        const insideHole = holeShapes.some((shape) => pointInRegionShape(scenePoint, shape));
        if (!insideHole) {
          mask[y * cols + x] = 1;
          maskData.bounds = expandMaskBounds(maskData.bounds, x, y, cols, rows);
        }
      }
    }

    return WaterRegionDetector.#fillMaskAlpha(maskData, 255);
  }

  static #getCurrentRegionSources(session) {
    const sources = [];
    const seen = new Set();
    const add = (region) => {
      const doc = region?.document ?? region;
      if (!doc) return;
      const id = getRegionId(doc) || getRegionId(region);
      const key = id || String(sources.length);
      if (seen.has(key)) return;
      seen.add(key);
      sources.push(region);
    };

    for (const placeable of collectionToArray(canvas?.regions?.placeables)) add(placeable);
    for (const placeable of collectionToArray(canvas?.regions?.objects?.children)) add(placeable);
    for (const doc of collectionToArray(canvas?.scene?.regions)) add(doc);

    const targetId = getRegionId(session?.targetRegion);
    if (targetId && !seen.has(targetId)) {
      const currentTarget = canvas?.regions?.get?.(targetId)
        ?? canvas?.scene?.regions?.get?.(targetId)
        ?? session?.targetRegion;
      add(currentTarget);
    }

    if (Array.isArray(session?.candidate?.shapes) && session.candidate.shapes.length) {
      add({ shapes: session.candidate.shapes });
    } else if (session?.maskData?.mask) {
      const opts = normalizeOptions(session.options ?? {});
      const candidate = WaterRegionDetector.#candidateFromMaskWithOptions(session.maskData, opts);
      if (Array.isArray(candidate?.shapes) && candidate.shapes.length) add({ shapes: candidate.shapes });
    }

    return sources;
  }

  static #findTargetRegionShapeAtPoint(session, point) {
    if (!point) return null;
    const sources = WaterRegionDetector.#getCurrentRegionSources(session);
    for (let r = sources.length - 1; r >= 0; r -= 1) {
      const region = sources[r];
      const shapes = Array.isArray(region?.shapes)
        ? region.shapes
        : (Array.isArray(region?.document?.shapes) ? region.document.shapes : []);
      for (let i = shapes.length - 1; i >= 0; i -= 1) {
        const shape = regionShapeToObject(shapes[i]);
        if (shape && pointInRegionShape(point, shape)) return shape;
      }
    }
    return null;
  }

  static #applyRegionShapeToMask(maskData, shape, mode = "add", changeRecorder = null) {
    const { mask, cols, rows, gridStep } = maskData ?? {};
    if (!mask || !cols || !rows || !gridStep || !shape) return 0;
    const imgW = WaterRegionDetector.#cachedImgW;
    const imgH = WaterRegionDetector.#cachedImgH;
    if (!imgW || !imgH) return 0;
    const map = getSceneImageMapping(imgW, imgH);
    const scaleX = map.sceneWidth / imgW;
    const scaleY = map.sceneHeight / imgH;
    const bounds = regionShapeBounds(shape);
    const imageMinX = bounds ? (bounds.minX - map.sceneX) / scaleX : 0;
    const imageMinY = bounds ? (bounds.minY - map.sceneY) / scaleY : 0;
    const imageMaxX = bounds ? (bounds.maxX - map.sceneX) / scaleX : imgW;
    const imageMaxY = bounds ? (bounds.maxY - map.sceneY) / scaleY : imgH;
    const minGX = Math.max(0, Math.floor(Math.min(imageMinX, imageMaxX) / gridStep) - 1);
    const minGY = Math.max(0, Math.floor(Math.min(imageMinY, imageMaxY) / gridStep) - 1);
    const maxGX = Math.min(cols - 1, Math.ceil(Math.max(imageMinX, imageMaxX) / gridStep) + 1);
    const maxGY = Math.min(rows - 1, Math.ceil(Math.max(imageMinY, imageMaxY) / gridStep) + 1);
    if (maxGX < minGX || maxGY < minGY) return 0;

    const op = String(mode ?? "add").trim().toLowerCase();
    let changed = 0;
    let changedBounds = null;
    for (let y = minGY; y <= maxGY; y += 1) {
      const rowOffset = y * cols;
      for (let x = minGX; x <= maxGX; x += 1) {
        const scenePoint = {
          x: map.sceneX + ((x + 0.5) * gridStep * scaleX),
          y: map.sceneY + ((y + 0.5) * gridStep * scaleY),
        };
        if (!pointInRegionShape(scenePoint, shape)) continue;
        const idx = rowOffset + x;
        if (op === "subtract" || op === "remove") {
          if (!mask[idx]) continue;
          changeRecorder?.(maskData, idx, mask[idx]);
          mask[idx] = 0;
        } else {
          if (mask[idx]) continue;
          changeRecorder?.(maskData, idx, mask[idx]);
          mask[idx] = 1;
        }
        changed += 1;
        changedBounds = expandMaskBounds(changedBounds, x, y, cols, rows);
      }
    }

    if (changed > 0) {
      maskData._lastChangedBounds = changedBounds;
      if (op === "subtract" || op === "remove") {
        WaterRegionDetector.#invalidateMaskDerivedData(maskData, { boundsDirty: true });
      } else {
        maskData.bounds = mergeMaskBounds(maskData.bounds, changedBounds, cols, rows);
        maskData.boundsDirty = false;
        WaterRegionDetector.#invalidateMaskDerivedData(maskData);
      }
    }
    return changed;
  }

  static #applyFillToMask(maskData, sceneX, sceneY, mode = "add", options = {}, { buildCandidate = true, changeRecorder = null } = {}) {
    const { mask, cols, rows, gridStep } = maskData ?? {};
    if (!mask || !cols || !rows || !gridStep) return { changed: 0, candidate: null };
    const opts = normalizeOptions(options);
    const { changed, visited } = WaterRegionDetector.#applySparseFloodFillToMask(maskData, sceneX, sceneY, mode, opts, changeRecorder);
    if (!changed) return { changed: 0, candidate: null, visited };
    if (!buildCandidate) return { changed, candidate: null, visited };
    const candidate = WaterRegionDetector.#candidateFromMaskWithOptions(maskData, opts);
    if (candidate) candidate.maskData = maskData;
    return { changed, candidate, visited };
  }

  static #readPaintSessionOptions(session) {
    const opts = normalizeOptions(session?.options ?? {});
    const root = session?.root;
    if (root instanceof Element) {
      const readNumber = (name, fallback) => {
        const input = root.querySelector(`[name="${name}"]`);
        return toFiniteNumber(input?.value, fallback);
      };
      opts.brushSizePx = Math.max(1, readNumber("brushSizePx", opts.brushSizePx));
      opts.tolerance = Math.max(0, readNumber("tolerance", opts.tolerance));
      opts.gridStep = Math.max(1, Math.round(readNumber("gridStep", opts.gridStep)));
      opts.fillBridgePx = normalizeFillBridgePx(readNumber("fillBridgePx", opts.fillBridgePx), opts.fillBridgePx);
      const fillColorModeInput = root.querySelector('[name="fillColorMode"]');
      const fillColorMode = String(fillColorModeInput?.value ?? opts.fillColorMode ?? DEFAULT_WATER_OPTIONS.fillColorMode).trim().toLowerCase();
      opts.fillColorMode = fillColorMode === "hsl" ? "hsl" : "rgb";
      opts.smoothing = readNumber("smoothing", opts.smoothing);
      opts.featherShrinkPx = readNumber("featherShrinkPx", opts.featherShrinkPx);
      opts.paintOpacity = normalizePaintOpacity(readNumber("paintOpacity", opts.paintOpacity), opts.paintOpacity);
      opts.paintBorderThickness = clamp(readNumber("paintBorderThickness", opts.paintBorderThickness), 0, 4);
      const debugInput = root.querySelector('[name="debug"]');
      if (debugInput instanceof HTMLInputElement) opts.debug = debugInput.checked === true;
      if (session?.isPaintSession === true) opts.debug = true;
      const colorInput = root.querySelector('[name="paintColor"]');
      if (colorInput instanceof HTMLInputElement) {
        opts.paintColor = normalizeHexColor(colorInput.value, getStoredPaintColor(WaterRegionDetector.#moduleId));
        colorInput.value = opts.paintColor;
        setStoredPaintColor(WaterRegionDetector.#moduleId, opts.paintColor);
      }
    }
    setStoredPaintOptions(WaterRegionDetector.#moduleId, opts);
    session.options = opts;
    return opts;
  }

  static #updatePaintSessionStatus(session) {
    if (!session?.root) return;
    const status = session.root.querySelector("[data-water-status]");
    const undoButton = session.root.querySelector("[data-paint-action='undo']");
    const redoButton = session.root.querySelector("[data-paint-action='redo']");
    if (status) {
      const vertices = Number(session?.candidate?.vertexCount ?? 0);
      const area = Number(session?.candidate?.area ?? 0);
      status.textContent = vertices > 0
        ? `${vertices} vertices, ${area} painted cells`
        : "Paint on the canvas to add to the region. Shift-left mouse subtracts.";
    }
    if (undoButton instanceof HTMLButtonElement) undoButton.disabled = !session.paintUndoStack?.length;
    if (redoButton instanceof HTMLButtonElement) redoButton.disabled = !session.paintRedoStack?.length;
  }

  static #syncDialogInputsFromOptions(session) {
    const root = session?.root;
    if (!(root instanceof Element)) return;
    const opts = normalizeOptions(session.options ?? {});
    for (const [name, value] of Object.entries({
      tolerance: opts.tolerance,
      gridStep: opts.gridStep,
      fillBridgePx: opts.fillBridgePx,
      smoothing: opts.smoothing,
      paintOpacity: opts.paintOpacity,
      paintBorderThickness: opts.paintBorderThickness,
      featherShrinkPx: opts.featherShrinkPx,
    })) {
      const inputs = root.querySelectorAll(`[name="${name}"]`);
      for (const input of inputs) {
        if (input instanceof HTMLInputElement) input.value = String(value);
      }
    }
  }

  static #drawSessionDebug(session) {
    if (session?.closed === true) {
      destroyGraphics(session?.debugGfx);
      if (session) session.debugGfx = null;
      return;
    }
    const opts = normalizeOptions(session?.options ?? {});
    const paintBorderThickness = clamp(toFiniteNumber(opts.paintBorderThickness, DEFAULT_WATER_OPTIONS.paintBorderThickness), 0, 4);
    if (session?.isPaintSession === true && paintBorderThickness <= 0) {
      destroyGraphics(session?.debugGfx);
      if (session) session.debugGfx = null;
      return;
    }
    if (opts.debug !== true && session?.isPaintSession !== true) {
      destroyGraphics(session?.debugGfx);
      if (session) session.debugGfx = null;
      return;
    }
    if (!session) return;
    if (!session.debugGfx) {
      session.debugGfx = new PIXI.Graphics();
      session.debugGfx.eventMode = "none";
      session.debugGfx.zIndex = 1000001;
      getPreviewLayer()?.addChild?.(session.debugGfx);
    }

    const gfx = session.debugGfx;
    gfx.clear();

    const imgW = WaterRegionDetector.#cachedImgW;
    const imgH = WaterRegionDetector.#cachedImgH;
    if (imgW > 0 && imgH > 0) {
      const map = getSceneImageMapping(imgW, imgH);
      gfx.lineStyle(2, 0xff00ff, 0.55);
      gfx.drawRect(map.sceneX, map.sceneY, map.sceneWidth, map.sceneHeight);
    }

    const shapes = Array.isArray(session?.candidate?.shapes) ? session.candidate.shapes : [];
    for (let i = 0; i < shapes.length; i += 1) {
      const shape = shapes[i];
      const points = Array.isArray(shape?.points) ? shape.points : [];
      if (points.length < 3) continue;
      const width = session?.isPaintSession === true ? paintBorderThickness : (i === 0 ? 4 : 2);
      gfx.lineStyle(width, i === 0 ? 0x00ffff : 0x00ff88, i === 0 ? 0.95 : 0.75);
      gfx.moveTo(points[0].x, points[0].y);
      for (let p = 1; p < points.length; p += 1) gfx.lineTo(points[p].x, points[p].y);
      gfx.closePath();

      const bounds = shape.bounds ?? pointsBounds(points);
      if (bounds) {
        gfx.lineStyle(1, 0xffffff, 0.45);
        gfx.drawRect(bounds.minX, bounds.minY, bounds.width, bounds.height);
      }
    }
  }

  static #getRegionBehaviors(region) {
    const collection = region?.behaviors ?? region?.document?.behaviors;
    if (!collection) return [];
    if (Array.isArray(collection.contents)) return collection.contents;
    if (Array.isArray(collection)) return collection;
    if (typeof collection.values === "function") return Array.from(collection.values());
    return [];
  }

  static async #setTargetRegionShaderSuppressed(session, suppressed) {
    const region = session?.targetRegion;
    if (!region?.updateEmbeddedDocuments) return;
    const behaviors = WaterRegionDetector.#getRegionBehaviors(region)
      .filter((behavior) => behavior?.id && isIndyFxRegionBehavior(behavior));
    if (!behaviors.length) return;

    if (!session.suppressedTargetBehaviorStates) session.suppressedTargetBehaviorStates = new Map();
    const updates = [];
    for (const behavior of behaviors) {
      if (!session.suppressedTargetBehaviorStates.has(behavior.id)) {
        session.suppressedTargetBehaviorStates.set(behavior.id, behavior.disabled === true);
      }
      const originalDisabled = session.suppressedTargetBehaviorStates.get(behavior.id) === true;
      const disabled = suppressed ? true : originalDisabled;
      if (behavior.disabled === disabled) continue;
      updates.push({
        _id: behavior.id,
        disabled,
      });
    }

    if (!updates.length) return;
    try {
      await region.updateEmbeddedDocuments("RegionBehavior", updates);
      setTimeout(() => {
        try {
          WaterRegionDetector.#syncRegionShaderFromBehavior?.(region.id, { rebuild: true });
        } catch (_err) {
          // Non-fatal.
        }
      }, 0);
    } catch (_err) {
      // Non-fatal.
    }
  }

  static async #refreshPaintCandidate(session, { forceCandidate = false } = {}) {
    if (!session?.maskData) return;
    const totalStart = nowMs();
    const opts = WaterRegionDetector.#readPaintSessionOptions(session);
    const borderThickness = clamp(toFiniteNumber(opts.paintBorderThickness, DEFAULT_WATER_OPTIONS.paintBorderThickness), 0, 4);
    if (session.isPaintSession === true && borderThickness <= 0 && forceCandidate !== true) {
      session.candidate = null;
      const previewStart = nowMs();
      WaterRegionDetector.#setPaintMaskPreview(session);
      const previewMs = nowMs() - previewStart;
      const debugStart = nowMs();
      WaterRegionDetector.#drawSessionDebug(session);
      const debugMs = nowMs() - debugStart;
      WaterRegionDetector.#updatePaintSessionStatus(session);
      debugTiming(WaterRegionDetector.#moduleId, "refresh-paint-candidate", {
        mode: "paint",
        gridStep: session.maskData?.gridStep ?? 0,
        cols: session.maskData?.cols ?? 0,
        rows: session.maskData?.rows ?? 0,
        cells: (session.maskData?.cols ?? 0) * (session.maskData?.rows ?? 0),
        candidateSkipped: true,
        borderThickness,
        previewMs: roundTimingMs(previewMs),
        debugMs: roundTimingMs(debugMs),
        totalMs: roundTimingMs(nowMs() - totalStart),
        hadCandidate: false,
      });
      return;
    }
    const candidateStart = nowMs();
    const initialBorderThickness = clamp(toFiniteNumber(opts.paintBorderThickness, DEFAULT_WATER_OPTIONS.paintBorderThickness), 0, 4);
    session.candidate = initialBorderThickness > 0
      ? WaterRegionDetector.#candidateFromMaskWithOptions(session.maskData, opts)
      : null;
    const candidateMs = nowMs() - candidateStart;
    if (session.candidate) session.candidate.maskData = session.maskData;
    const previewStart = nowMs();
    WaterRegionDetector.#setPaintMaskPreview(session);
    const previewMs = nowMs() - previewStart;
    const debugStart = nowMs();
    WaterRegionDetector.#drawSessionDebug(session);
    const debugMs = nowMs() - debugStart;
    WaterRegionDetector.#updatePaintSessionStatus(session);
    debugTiming(WaterRegionDetector.#moduleId, "refresh-paint-candidate", {
      mode: "paint",
      gridStep: session.maskData?.gridStep ?? 0,
      cols: session.maskData?.cols ?? 0,
      rows: session.maskData?.rows ?? 0,
      cells: (session.maskData?.cols ?? 0) * (session.maskData?.rows ?? 0),
      candidateMs: roundTimingMs(candidateMs),
      previewMs: roundTimingMs(previewMs),
      debugMs: roundTimingMs(debugMs),
      totalMs: roundTimingMs(nowMs() - totalStart),
      hadCandidate: Boolean(session.candidate),
    });
  }

  static #drawPaintBrush(session, point, mode = null, options = null) {
    if (!session || session.closed === true) return;
    if (!point) {
      destroyGraphics(session.brushGfx);
      session.brushGfx = null;
      session.lastBrushPoint = null;
      return;
    }

    const opts = WaterRegionDetector.#readPaintSessionOptions(session);
    const radius = Math.max(1, toFiniteNumber(opts.brushSizePx, DEFAULT_WATER_OPTIONS.brushSizePx) * 0.5);
    const brushMode = mode ?? session.paintMode ?? "add";
    const color = brushMode === "subtract" ? 0xff6b4a : 0x35b7ff;
    session.lastBrushPoint = { x: point.x, y: point.y };

    if (!session.brushGfx) {
      session.brushGfx = new PIXI.Graphics();
      session.brushGfx.eventMode = "none";
      session.brushGfx.zIndex = 1000002;
      getPreviewLayer()?.addChild?.(session.brushGfx);
    }

    const gfx = session.brushGfx;
    gfx.clear();
    gfx.lineStyle(2, color, 0.85);
    gfx.beginFill(color, 0.18);
    gfx.drawCircle(point.x, point.y, radius);
    gfx.endFill();
    gfx.lineStyle(1, 0xffffff, 0.45);
    gfx.drawCircle(point.x, point.y, Math.max(1, radius - 2));
  }

  static #stampPaintSession(session, point, mode, options = null) {
    if (!session?.maskData || !point) return 0;
    const opts = options ?? WaterRegionDetector.#readPaintSessionOptions(session);
    const record = session.paintDeltaRecorder?.record?.bind(session.paintDeltaRecorder) ?? null;
    const changed = WaterRegionDetector.#stampBrushOnMask(session.maskData, point.x, point.y, mode, opts, record);
    const changedBounds = session.maskData._lastChangedBounds;
    if (changed && session.sourceMaskData && session.sourceMaskData !== session.maskData) {
      WaterRegionDetector.#stampBrushOnMask(session.sourceMaskData, point.x, point.y, mode, {
        ...opts,
        gridStep: session.sourceMaskData.gridStep,
      }, record);
    }
    if (!changed) return 0;
    session.paintPreviewDirtyBounds = mergeMaskBounds(session.paintPreviewDirtyBounds, changedBounds, session.maskData.cols, session.maskData.rows);
    session.paintStrokeChangedCells = (Number(session.paintStrokeChangedCells) || 0) + changed;
    session.paintStrokeChanged = true;
    session.paintDirty = true;
    if (session.paintRefreshTimer) return changed;
    session.paintRefreshTimer = setTimeout(() => {
      session.paintRefreshTimer = null;
      if (session.isPaintSession === true) {
        WaterRegionDetector.#setPaintMaskPreview(session);
        WaterRegionDetector.#updatePaintSessionStatus(session);
        return;
      }
      void WaterRegionDetector.#refreshPaintCandidate(session);
    }, session.isPaintSession === true ? 140 : 80);
    return changed;
  }

  static async #floodFillPaintSession(session, point, subtract = false) {
    if (!session?.maskData || !point || session.closed === true) return 0;
    const opts = {
      ...WaterRegionDetector.#readPaintSessionOptions(session),
      fillColorMode: "hsl",
      requireWaterLikeSeed: false,
      requireWaterLikeFill: false,
    };
    const recorder = WaterRegionDetector.#createPaintDeltaRecorder(session);
    const record = recorder.record.bind(recorder);
    const mode = subtract === true ? "subtract" : "add";
    const result = WaterRegionDetector.#applyFillToMask(session.maskData, point.x, point.y, mode, opts, { buildCandidate: false, changeRecorder: record });
    if (result.changed && session.sourceMaskData && session.sourceMaskData !== session.maskData) {
      WaterRegionDetector.#applyFillToMask(session.sourceMaskData, point.x, point.y, mode, {
        ...opts,
        gridStep: session.sourceMaskData.gridStep,
      }, { buildCandidate: false, changeRecorder: record });
    }
    if (!result.changed) return 0;
    WaterRegionDetector.#pushPaintUndoSnapshot(session, WaterRegionDetector.#finalizePaintDelta(recorder));
    session.paintRedoStack = [];
    session.paintStrokeChangedCells = (Number(session.paintStrokeChangedCells) || 0) + result.changed;
    await WaterRegionDetector.#refreshPaintCandidate(session);
    debugTiming(WaterRegionDetector.#moduleId, "paint-hsl-flood-fill", {
      mode,
      changedCells: result.changed,
      visitedCells: result.visited ?? 0,
      tolerance: opts.tolerance,
      gridStep: session.maskData?.gridStep ?? 0,
      bounds: WaterRegionDetector.#getMaskBounds(session.maskData),
    });
    return result.changed;
  }

  static async #paintTargetShapeSession(session, point, subtract = false) {
    if (!session?.maskData || !point || session.closed === true) return 0;
    const shape = WaterRegionDetector.#findTargetRegionShapeAtPoint(session, point);
    if (!shape) {
      ui?.notifications?.warn?.(localizeText(WaterRegionDetector.#moduleId, "Notifications.NoSourceShape", "Indy Regions | No source region shape under the cursor."));
      return 0;
    }
    const recorder = WaterRegionDetector.#createPaintDeltaRecorder(session);
    const record = recorder.record.bind(recorder);
    const mode = subtract === true ? "subtract" : "add";
    const changed = WaterRegionDetector.#applyRegionShapeToMask(session.maskData, shape, mode, record);
    const changedBounds = session.maskData._lastChangedBounds;
    if (changed && session.sourceMaskData && session.sourceMaskData !== session.maskData) {
      WaterRegionDetector.#applyRegionShapeToMask(session.sourceMaskData, shape, mode, record);
    }
    if (!changed) return 0;
    WaterRegionDetector.#pushPaintUndoSnapshot(session, WaterRegionDetector.#finalizePaintDelta(recorder));
    session.paintRedoStack = [];
    session.paintPreviewDirtyBounds = mergeMaskBounds(session.paintPreviewDirtyBounds, changedBounds, session.maskData.cols, session.maskData.rows);
    await WaterRegionDetector.#refreshPaintCandidate(session);
    debugTiming(WaterRegionDetector.#moduleId, "paint-region-shape", {
      mode,
      changedCells: changed,
      gridStep: session.maskData?.gridStep ?? 0,
      bounds: WaterRegionDetector.#getMaskBounds(session.maskData),
    });
    return changed;
  }

  static #beginPaintStroke(session, point, subtract = false, forceHardPaint = false) {
    if (!point || session?.closed === true) return;
    const mode = subtract === true ? "subtract" : "add";
    const paintOpts = WaterRegionDetector.#readPaintSessionOptions(session);
    paintOpts.forceHardPaint = forceHardPaint === true;
    WaterRegionDetector.#drawPaintBrush(session, point, mode, paintOpts);
    session.painting = true;
    session.paintMode = mode;
    session.lastPaintPoint = point;
    session.paintDeltaRecorder = WaterRegionDetector.#createPaintDeltaRecorder(session);
    session.paintStrokeChanged = false;
    session.paintStrokeChangedCells = 0;
    WaterRegionDetector.#stampPaintSession(session, point, mode, paintOpts);
  }

  static #continuePaintStroke(session, point, subtract = false, forceHardPaint = false) {
    if (!point || session?.closed === true) return;
    const mode = subtract === true ? "subtract" : (session.paintMode ?? "add");
    const paintOpts = WaterRegionDetector.#readPaintSessionOptions(session);
    paintOpts.forceHardPaint = forceHardPaint === true;
    WaterRegionDetector.#drawPaintBrush(session, point, mode, paintOpts);
    if (!session?.painting) return;
    const brushSize = Math.max(1, toFiniteNumber(paintOpts.brushSizePx, DEFAULT_WATER_OPTIONS.brushSizePx));
    const spacing = Math.max(brushSize * 0.35, brushSize * 0.8);
    const last = session.lastPaintPoint ?? point;
    const dx = point.x - last.x;
    const dy = point.y - last.y;
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(dist / spacing));
    let changed = 0;
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      changed += WaterRegionDetector.#stampPaintSession(session, {
        x: last.x + (dx * t),
        y: last.y + (dy * t),
      }, session.paintMode, paintOpts);
    }
    session.lastPaintPoint = point;
    return changed;
  }

  static #handlePaintPointerDown(session, event) {
    const point = getPointerWorldPoint(event);
    if (!point || session?.closed === true) return;
    const primary = isPrimaryPointerEvent(event);
    const original = event?.data?.originalEvent ?? event?.nativeEvent ?? event;
    if (!primary) return;
    consumePaintPointerEvent(event);
    if (original?.altKey === true) {
      void WaterRegionDetector.#paintTargetShapeSession(session, point, original?.shiftKey === true);
      return;
    }
    if (original?.ctrlKey === true || original?.metaKey === true) {
      void WaterRegionDetector.#floodFillPaintSession(session, point, original?.shiftKey === true);
      return;
    }
    WaterRegionDetector.#beginPaintStroke(session, point, original?.shiftKey === true, original?.ctrlKey === true || original?.metaKey === true);
  }

  static #handlePaintPointerMove(session, event) {
    const point = getPointerWorldPoint(event);
    if (!point || session?.closed === true) return;
    const original = event?.data?.originalEvent ?? event?.nativeEvent ?? event;
    const changed = WaterRegionDetector.#continuePaintStroke(session, point, original?.shiftKey === true, original?.ctrlKey === true || original?.metaKey === true);
    if (session?.painting || changed) consumePaintPointerEvent(event);
  }

  static #handlePaintPointerUp(session) {
    const strokeStart = nowMs();
    const strokeChanged = session?.paintStrokeChanged === true;
    const strokeChangedCells = Number(session?.paintStrokeChangedCells) || 0;
    if (session?.paintStrokeChanged && session.paintDeltaRecorder) {
      WaterRegionDetector.#pushPaintUndoSnapshot(session, WaterRegionDetector.#finalizePaintDelta(session.paintDeltaRecorder));
      session.paintRedoStack = [];
    }
    session.painting = false;
    session.paintMode = null;
    session.lastPaintPoint = null;
    session.paintDeltaRecorder = null;
    session.paintStrokeChanged = false;
    if (session.paintDirty) {
      session.paintDirty = false;
      if (session.paintRefreshTimer) {
        clearTimeout(session.paintRefreshTimer);
        session.paintRefreshTimer = null;
      }
      void WaterRegionDetector.#refreshPaintCandidate(session);
    }
    debugTiming(WaterRegionDetector.#moduleId, "paint-stroke-end", {
      changed: strokeChanged,
      changedCells: strokeChangedCells,
      gridStep: session?.maskData?.gridStep ?? 0,
      cols: session?.maskData?.cols ?? 0,
      rows: session?.maskData?.rows ?? 0,
      totalMs: roundTimingMs(nowMs() - strokeStart),
    });
    session.paintStrokeChangedCells = 0;
  }

  static #handlePaintDomPointerDown(session, event) {
    if (session?.closed === true || !isPrimaryDomPointerEvent(event)) return;
    const view = canvas?.app?.view;
    if (event?.target !== view) return;
    const now = globalThis.performance?.now?.() ?? Date.now();
    if (String(event?.type ?? "").startsWith("mouse") && Number(session.suppressCompatMouseUntil ?? 0) > now) {
      consumePaintPointerEvent(event);
      return;
    }
    if (String(event?.type ?? "").startsWith("pointer")) session.suppressCompatMouseUntil = now + 500;
    const point = getDomPointerWorldPoint(event);
    if (!point) return;
    consumePaintPointerEvent(event);
    if (event.altKey === true) {
      void WaterRegionDetector.#paintTargetShapeSession(session, point, event.shiftKey === true);
      return;
    }
    if (event.ctrlKey === true || event.metaKey === true) {
      void WaterRegionDetector.#floodFillPaintSession(session, point, event.shiftKey === true);
      return;
    }
    try {
      (canvas?.app?.view ?? event.currentTarget)?.setPointerCapture?.(event.pointerId);
    } catch (_err) {
      // Non-fatal.
    }
    WaterRegionDetector.#beginPaintStroke(session, point, event.shiftKey === true, event.ctrlKey === true || event.metaKey === true);
  }

  static #handlePaintDomPointerMove(session, event) {
    if (session?.closed === true) return;
    const view = canvas?.app?.view;
    if (event?.target !== view && !session.painting) return;
    const now = globalThis.performance?.now?.() ?? Date.now();
    if (String(event?.type ?? "").startsWith("mouse") && Number(session.suppressCompatMouseUntil ?? 0) > now) {
      consumePaintPointerEvent(event);
      return;
    }
    const point = getDomPointerWorldPoint(event);
    if (!point) return;
    const changed = WaterRegionDetector.#continuePaintStroke(session, point, event.shiftKey === true, event.ctrlKey === true || event.metaKey === true);
    if (session?.painting || changed) consumePaintPointerEvent(event);
  }

  static #handlePaintDomPointerUp(session, event) {
    if (session?.closed === true || !session.painting) return;
    const now = globalThis.performance?.now?.() ?? Date.now();
    if (String(event?.type ?? "").startsWith("mouse") && Number(session.suppressCompatMouseUntil ?? 0) > now) {
      consumePaintPointerEvent(event);
      return;
    }
    consumePaintPointerEvent(event);
    try {
      (canvas?.app?.view ?? event.currentTarget)?.releasePointerCapture?.(event.pointerId);
    } catch (_err) {
      // Non-fatal.
    }
    const point = getDomPointerWorldPoint(event);
    WaterRegionDetector.#handlePaintPointerUp(session);
    if (point) WaterRegionDetector.#drawPaintBrush(session, point, event.shiftKey === true ? "subtract" : "add");
  }

  static #setPaintDialogNumber(session, name, value) {
    const root = session?.root;
    if (!(root instanceof Element)) return;
    const inputs = root.querySelectorAll(`[name="${name}"]`);
    for (const input of inputs) {
      if (input instanceof HTMLInputElement) input.value = String(value);
    }
  }

  static #handlePaintWheel(session, event) {
    if (session?.closed === true) return;
    if (event?.ctrlKey !== true && event?.metaKey !== true) return;
    const point = getDomPointerWorldPoint(event);
    if (!point) return;
    consumePaintPointerEvent(event);
    const opts = WaterRegionDetector.#readPaintSessionOptions(session);
    const direction = Number(event.deltaY) < 0 ? 1 : -1;

    const current = Math.max(1, toFiniteNumber(opts.brushSizePx, DEFAULT_WATER_OPTIONS.brushSizePx));
    const step = event.shiftKey === true ? 1 : Math.max(2, Math.round(current * 0.08));
    opts.brushSizePx = clamp(Math.round(current + (direction * step)), 1, 512);
    WaterRegionDetector.#setPaintDialogNumber(session, "brushSizePx", opts.brushSizePx);

    session.options = opts;
    setStoredPaintOptions(WaterRegionDetector.#moduleId, opts);
    WaterRegionDetector.#drawPaintBrush(session, point, event.shiftKey === true && session.painting ? "subtract" : session.paintMode, opts);
  }

  static #pushPaintUndoSnapshot(session, snapshot = null) {
    const paintSnapshot = snapshot?.type === "delta"
      ? snapshot
      : snapshot?.maskData
      ? {
          maskData: cloneMaskData(snapshot.maskData),
          sourceMaskData: cloneMaskData(snapshot.sourceMaskData ?? snapshot.maskData),
        }
      : clonePaintSnapshot(session, snapshot);
    if (!session || !paintSnapshot?.maskData) return;
    if (!Array.isArray(session.paintUndoStack)) session.paintUndoStack = [];
    session.paintUndoStack.push(paintSnapshot);
    if (session.paintUndoStack.length > PAINT_HISTORY_LIMIT) session.paintUndoStack.shift();
  }

  static #cancelPaintStroke(session) {
    if (!session) return;
    session.painting = false;
    session.paintMode = null;
    session.lastPaintPoint = null;
    session.paintDeltaRecorder = null;
    session.paintStrokeChanged = false;
    session.paintPreviewDirtyBounds = null;
    session.paintDirty = false;
    if (session.paintRefreshTimer) {
      clearTimeout(session.paintRefreshTimer);
      session.paintRefreshTimer = null;
    }
    if (session.gridStepUpdateTimer) {
      clearTimeout(session.gridStepUpdateTimer);
      session.gridStepUpdateTimer = null;
    }
  }

  static async #restorePaintSnapshot(session, snapshot) {
    if (!session || !snapshot) return;
    WaterRegionDetector.#cancelPaintStroke(session);
    const restoredMask = cloneMaskData(snapshotMaskData(snapshot));
    session.maskData = restoredMask;
    session.sourceMaskData = cloneMaskData(snapshotSourceMaskData(snapshot))
      ?? WaterRegionDetector.#resampleMaskData(restoredMask, 1)
      ?? cloneMaskData(restoredMask);
    if (session.maskData?.gridStep) {
      session.options = {
        ...normalizeOptions(session.options ?? {}),
        gridStep: session.maskData.gridStep,
      };
      WaterRegionDetector.#syncDialogInputsFromOptions(session);
    }
    await WaterRegionDetector.#refreshPaintCandidate(session);
  }

  static #undoPaintSession(session) {
    if (!session?.paintUndoStack?.length) return;
    if (!Array.isArray(session.paintRedoStack)) session.paintRedoStack = [];
    void WaterRegionDetector.#applyPaintHistory(session, session.paintUndoStack, session.paintRedoStack);
  }

  static #redoPaintSession(session) {
    if (!session?.paintRedoStack?.length) return;
    if (!Array.isArray(session.paintUndoStack)) session.paintUndoStack = [];
    void WaterRegionDetector.#applyPaintHistory(session, session.paintRedoStack, session.paintUndoStack);
  }

  static async #applyPaintHistory(session, fromStack, toStack) {
    if (!session || !Array.isArray(fromStack) || !fromStack.length) return;
    const entry = fromStack.pop();
    let inverse = null;
    if (entry?.type === "delta") {
      WaterRegionDetector.#cancelPaintStroke(session);
      inverse = WaterRegionDetector.#applyPaintDelta(session, entry);
      if (inverse) await WaterRegionDetector.#refreshPaintCandidate(session);
    } else {
      inverse = clonePaintSnapshot(session);
      await WaterRegionDetector.#restorePaintSnapshot(session, entry);
    }
    if (!inverse) return;
    if (!Array.isArray(toStack)) return;
    toStack.push(inverse);
    if (toStack.length > PAINT_HISTORY_LIMIT) toStack.shift();
    WaterRegionDetector.#updatePaintSessionStatus(session);
  }

  static #handlePaintKeyDown(session, event) {
    if (!session || session.closed === true || WaterRegionDetector.#activeSession !== session) return;
    const key = String(event?.key ?? "").toLowerCase();
    const hasModifier = event?.ctrlKey === true || event?.metaKey === true;
    if (!hasModifier) return;
    const undo = key === "z" && event?.shiftKey !== true;
    const redo = key === "y" || (key === "z" && event?.shiftKey === true);
    if (!undo && !redo) return;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (undo) WaterRegionDetector.#undoPaintSession(session);
    else WaterRegionDetector.#redoPaintSession(session);
  }

  static async #resetPaintMaskResolution(session) {
    const totalStart = nowMs();
    const opts = WaterRegionDetector.#readPaintSessionOptions(session);
    const previous = session?.maskData;
    const source = session?.sourceMaskData ?? previous;
    if (previous?.mask?.length && previous.gridStep && previous.gridStep !== opts.gridStep) {
      const resampleStart = nowMs();
      const next = WaterRegionDetector.#resampleMaskData(source, opts.gridStep)
        ?? WaterRegionDetector.#createEmptyMaskData(opts);
      const resampleMs = nowMs() - resampleStart;
      session.maskData = next;
      if (!session.sourceMaskData) session.sourceMaskData = WaterRegionDetector.#resampleMaskData(next, 1) ?? cloneMaskData(next);
      await WaterRegionDetector.#refreshPaintCandidate(session);
      debugTiming(WaterRegionDetector.#moduleId, "reset-paint-mask-resolution", {
        fromGridStep: previous.gridStep,
        toGridStep: opts.gridStep,
        fromCells: previous.cols * previous.rows,
        toCells: next.cols * next.rows,
        resampleMs: roundTimingMs(resampleMs),
        totalMs: roundTimingMs(nowMs() - totalStart),
      });
      return;
    }
    let maskData = null;
    if (session?.candidate) {
      maskData = WaterRegionDetector.#maskFromRegionShapes({
        shapes: candidateShapesToRegionData(session.candidate),
      }, opts);
    }
    if (!maskData && session?.targetRegion) {
      maskData = WaterRegionDetector.#maskFromRegionShapes(session.targetRegion, opts);
    }
    session.maskData = maskData ?? WaterRegionDetector.#createEmptyMaskData(opts);
    session.sourceMaskData = WaterRegionDetector.#resampleMaskData(session.maskData, 1) ?? cloneMaskData(session.maskData);
    await WaterRegionDetector.#refreshPaintCandidate(session);
    debugTiming(WaterRegionDetector.#moduleId, "reset-paint-mask-resolution", {
      fromGridStep: previous?.gridStep ?? 0,
      toGridStep: opts.gridStep,
      fromCells: (previous?.cols ?? 0) * (previous?.rows ?? 0),
      toCells: (session.maskData?.cols ?? 0) * (session.maskData?.rows ?? 0),
      rebuiltFromShapes: Boolean(maskData),
      totalMs: roundTimingMs(nowMs() - totalStart),
    });
  }

  static #endSession({ notify = false, keepRegion = false, closeDialog = true } = {}) {
    const session = WaterRegionDetector.#activeSession;
    if (!session) return false;
    session.closed = true;
    if (canvas?.stage) {
      canvas.stage.off("pointerdown", session.onDown);
    }
    if (session.paintRefreshTimer) {
      clearTimeout(session.paintRefreshTimer);
      session.paintRefreshTimer = null;
    }
    if (session.onKeyDown) {
      window.removeEventListener("keydown", session.onKeyDown, true);
      session.onKeyDown = null;
    }
    if (session.onMove) canvas?.stage?.off?.("pointermove", session.onMove);
    if (session.onUp) canvas?.stage?.off?.("pointerup", session.onUp);
    if (session.onUp) canvas?.stage?.off?.("pointerupoutside", session.onUp);
    const view = canvas?.app?.view;
    if (view && session.onDomDown) view.removeEventListener("pointerdown", session.onDomDown, true);
    if (view && session.onDomMove) view.removeEventListener("pointermove", session.onDomMove, true);
    if (view && session.onDomUp) view.removeEventListener("pointerup", session.onDomUp, true);
    if (view && session.onDomUp) view.removeEventListener("pointercancel", session.onDomUp, true);
    if (view && session.onDomLeave) view.removeEventListener("pointerleave", session.onDomLeave, true);
    if (view && session.onDomDown) view.removeEventListener("mousedown", session.onDomDown, true);
    if (view && session.onDomMove) view.removeEventListener("mousemove", session.onDomMove, true);
    if (view && session.onDomUp) view.removeEventListener("mouseup", session.onDomUp, true);
    if (view && session.onDomLeave) view.removeEventListener("mouseleave", session.onDomLeave, true);
    if (view && session.onWheel) view.removeEventListener("wheel", session.onWheel, { capture: true });
    if (session.onDomDown) document.removeEventListener("pointerdown", session.onDomDown, true);
    if (session.onDomMove) document.removeEventListener("pointermove", session.onDomMove, true);
    if (session.onDomUp) document.removeEventListener("pointerup", session.onDomUp, true);
    if (session.onDomUp) document.removeEventListener("pointercancel", session.onDomUp, true);
    if (session.onDomDown) document.removeEventListener("mousedown", session.onDomDown, true);
    if (session.onDomMove) document.removeEventListener("mousemove", session.onDomMove, true);
    if (session.onDomUp) document.removeEventListener("mouseup", session.onDomUp, true);
    session.onDomDown = null;
    session.onDomMove = null;
    session.onDomUp = null;
    session.onDomLeave = null;
    session.onWheel = null;
    if (typeof session.restoreRegionLayerInteraction === "function") {
      session.restoreRegionLayerInteraction();
      session.restoreRegionLayerInteraction = null;
    }
    if (typeof session.restoreCanvasDragSelection === "function") {
      session.restoreCanvasDragSelection();
      session.restoreCanvasDragSelection = null;
    }
    if (typeof session.restoreTargetRegionVisibility === "function") {
      session.restoreTargetRegionVisibility();
      session.restoreTargetRegionVisibility = null;
    }
    destroyPreviewSprite(session.previewSprite);
    session.previewSprite = null;
    destroyGraphics(session.debugGfx);
    session.debugGfx = null;
    destroyGraphics(session.brushGfx);
    session.brushGfx = null;
    void WaterRegionDetector.#setTargetRegionShaderSuppressed(session, false);
    WaterRegionDetector.#activeSession = null;
    if (closeDialog) {
      try {
        session.closingFromEndSession = true;
        session.dialog?.close?.({ force: true });
      } catch (_err) {
        // Non-fatal.
      } finally {
        session.closingFromEndSession = false;
      }
    }
    if (notify) ui?.notifications?.info?.("Indy Regions | Region painting cancelled.");
    return true;
  }

  static #renderPaintSessionDialog(session) {
    const opts = normalizeOptions(session.options);
    const debugStyle = debugUiDisplayStyle(WaterRegionDetector.#moduleId);
    const helpStyle = paintHelpDisplayStyle(WaterRegionDetector.#moduleId);
    const helpOpenAttr = getStoredPaintHelpOpen(WaterRegionDetector.#moduleId) ? " open" : "";
    const t = (key, fallback) => localizeText(WaterRegionDetector.#moduleId, key, fallback);
    const content = `
      <form class="indy-regions-water-region-tool">
        <details class="notes" data-paint-help${helpOpenAttr}${helpStyle}>
          <summary>${t("Dialog.Help.Title", "Help")}</summary>
          <div style="line-height: 1.35; margin-top: 0.35rem;">
            <div>${t("Dialog.Help.ShiftDrag", "Shift-drag erases painted cells.")}</div>
            <div>${t("Dialog.Help.CtrlClick", "Ctrl-click HSL-fills from the clicked colour.")}</div>
            <div>${t("Dialog.Help.CtrlShiftClick", "Ctrl-Shift-click HSL-erases from the clicked colour.")}</div>
            <div>${t("Dialog.Help.AltClick", "Alt-click fills the clicked source region shape.")}</div>
            <div>${t("Dialog.Help.ShiftAltClick", "Shift-Alt-click erases the clicked source region shape.")}</div>
            <div>${t("Dialog.Help.CtrlWheel", "Ctrl-wheel changes brush size.")}</div>
          </div>
        </details>
        <div class="form-group"${debugStyle}>
          <label>${t("Dialog.Label.Status", "Status")}</label>
          <div class="form-fields">
            <span data-water-status>${t("Dialog.Status.Paint", "Paint on the canvas to add to the region. Shift-left mouse subtracts.")}</span>
          </div>
        </div>
        <div class="form-group">
          <label>${t("Dialog.Label.History", "History")}</label>
          <div class="form-fields">
            <button type="button" data-paint-action="undo" disabled><i class="fas fa-undo"></i> ${t("Dialog.Button.Undo", "Undo")}</button>
            <button type="button" data-paint-action="redo" disabled><i class="fas fa-redo"></i> ${t("Dialog.Button.Redo", "Redo")}</button>
          </div>
        </div>
        <div class="form-group">
          <label>${t("Dialog.Label.PenColour", "Pen Colour")}</label>
          <div class="form-fields">
            <input type="color" name="paintColor" value="${normalizeHexColor(opts.paintColor, DEFAULT_WATER_OPTIONS.paintColor)}">
          </div>
        </div>
        <div class="form-group">
          <label>${t("Dialog.Label.PaintOpacity", "Paint Opacity")}</label>
          <div class="form-fields">
            <input type="range" name="paintOpacity" min="0" max="1" step="0.05" value="${normalizePaintOpacity(opts.paintOpacity)}">
            <input type="number" name="paintOpacity" min="0" max="1" step="0.05" value="${normalizePaintOpacity(opts.paintOpacity)}">
          </div>
        </div>
        <div class="form-group">
          <label>${t("Dialog.Label.BrushSize", "Brush Size")}</label>
          <div class="form-fields">
            <input type="range" name="brushSizePx" min="1" max="512" step="1" value="${opts.brushSizePx}">
            <input type="number" name="brushSizePx" min="1" max="512" step="1" value="${opts.brushSizePx}">
          </div>
        </div>
        <div class="form-group">
          <label>${t("Dialog.Label.FillTolerance", "Fill Tolerance")}</label>
          <div class="form-fields">
            <input type="range" name="tolerance" min="1" max="160" step="1" value="${opts.tolerance}">
            <input type="number" name="tolerance" min="1" max="160" step="1" value="${opts.tolerance}">
          </div>
        </div>
        <div class="form-group">
          <label>${t("Dialog.Label.FillBridge", "Fill Bridge")}</label>
          <div class="form-fields">
            <input type="range" name="fillBridgePx" min="0" max="${MAX_FILL_BRIDGE_PX}" step="1" value="${opts.fillBridgePx}">
            <input type="number" name="fillBridgePx" min="0" max="${MAX_FILL_BRIDGE_PX}" step="1" value="${opts.fillBridgePx}">
          </div>
        </div>
        <input type="hidden" name="fillColorMode" value="hsl">
        <div class="form-group">
          <label>${t("Dialog.Label.GridStep", "Grid Step")}</label>
          <div class="form-fields">
            <input type="range" name="gridStep" min="1" max="16" step="1" value="${opts.gridStep}">
            <input type="number" name="gridStep" min="1" max="16" step="1" value="${opts.gridStep}">
          </div>
        </div>
        <div class="form-group">
          <label>${t("Dialog.Label.ShrinkGrow", "Shrink / Grow")}</label>
          <div class="form-fields">
            <input type="range" name="featherShrinkPx" min="-64" max="64" step="1" value="${opts.featherShrinkPx}">
            <input type="number" name="featherShrinkPx" min="-64" max="64" step="1" value="${opts.featherShrinkPx}">
          </div>
        </div>
        <div class="form-group">
          <label>${t("Dialog.Label.BorderSmooth", "Border Smooth")}</label>
          <div class="form-fields">
            <input type="range" name="smoothing" min="0" max="16" step="0.25" value="${opts.smoothing}">
            <input type="number" name="smoothing" min="0" max="16" step="0.25" value="${opts.smoothing}">
          </div>
        </div>
        <div class="form-group">
          <label>${t("Dialog.Label.BorderThickness", "Border Thickness")}</label>
          <div class="form-fields">
            <input type="range" name="paintBorderThickness" min="0" max="4" step="0.25" value="${opts.paintBorderThickness}">
            <input type="number" name="paintBorderThickness" min="0" max="4" step="0.25" value="${opts.paintBorderThickness}">
          </div>
        </div>
      </form>
    `;

    const dialog = new foundry.applications.api.DialogV2({
      window: {
        title: t("Dialog.Title.PaintRegion", "Paint Region"),
        icon: "fas fa-paintbrush",
      },
      content,
      buttons: [
        {
          action: "create",
          label: session.targetRegion ? t("Dialog.Button.UpdateRegion", "Update Region") : t("Dialog.Button.CreateRegion", "Create Region"),
          icon: "fas fa-check",
          default: true,
          callback: async () => {
            await WaterRegionDetector.#refreshPaintCandidate(session, { forceCandidate: true });
            if (!session.candidate) {
              ui?.notifications?.warn?.(t("Notifications.PaintAreaFirst", "Indy Regions | Paint an area first."));
              return false;
            }
            const opts = WaterRegionDetector.#readPaintSessionOptions(session);
            const shapes = candidateShapesToRegionData(session.candidate);
            let region = session.targetRegion ?? null;
            if (session.targetRegion?.update) {
              await session.targetRegion.update({ shapes });
              region = session.targetRegion;
            } else if (region?.update) {
              await region.update({ shapes });
            } else {
              const scene = canvas?.scene ?? null;
              const created = await scene?.createEmbeddedDocuments?.("Region", [{
                name: PAINT_REGION_DEFAULT_NAME,
                shapes,
              }]);
              region = created?.[0] ?? null;
            }
            if (region) WaterRegionDetector.#savePaintMaskFlag(region, session, opts);
            WaterRegionDetector.#endSession({ keepRegion: true });
            return true;
          },
        },
        {
          action: "cancel",
          label: t("Dialog.Button.Cancel", "Cancel"),
          icon: "fas fa-times",
          callback: () => {
            WaterRegionDetector.#endSession({ notify: false });
          },
        },
      ],
      close: () => {
        WaterRegionDetector.#endSession({ notify: false });
      },
    });
    session.dialog = dialog;
    const originalClose = typeof dialog.close === "function" ? dialog.close.bind(dialog) : null;
    if (originalClose) {
      dialog.close = async (...args) => {
        if (session.closingFromEndSession !== true && WaterRegionDetector.#activeSession === session) {
          WaterRegionDetector.#endSession({ notify: false, closeDialog: false });
        }
        return originalClose(...args);
      };
    }
    void dialog.render(true).then(() => {
      const root = dialog.element instanceof Element
        ? dialog.element
        : (dialog.element?.[0] instanceof Element ? dialog.element[0] : null);
      session.root = root?.querySelector?.(".indy-regions-water-region-tool") ?? root;
      if (!session.root) return;
      const helpDetails = session.root.querySelector("[data-paint-help]");
      if (helpDetails instanceof HTMLDetailsElement) {
        helpDetails.addEventListener("toggle", () => {
          setStoredPaintHelpOpen(WaterRegionDetector.#moduleId, helpDetails.open === true);
        });
      }
      const onInput = (event) => {
        const input = event.target;
        if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLSelectElement)) return;
        const peers = session.root.querySelectorAll(`[name="${input.name}"]`);
        for (const peer of peers) {
          if (peer !== input && (peer instanceof HTMLInputElement || peer instanceof HTMLSelectElement)) peer.value = input.value;
        }
        WaterRegionDetector.#readPaintSessionOptions(session);
        if (input.name === "brushSizePx" && session.lastBrushPoint) {
          WaterRegionDetector.#drawPaintBrush(session, session.lastBrushPoint, session.paintMode ?? "add");
        }
        if (["gridStep", "smoothing", "featherShrinkPx", "paintBorderThickness", "paintOpacity", "debug", "paintColor"].includes(input.name)) {
          if (input.name === "gridStep") {
            if (session.gridStepUpdateTimer) clearTimeout(session.gridStepUpdateTimer);
            session.gridStepUpdateTimer = setTimeout(() => {
              session.gridStepUpdateTimer = null;
              void WaterRegionDetector.#resetPaintMaskResolution(session);
            }, 180);
          } else {
            void WaterRegionDetector.#refreshPaintCandidate(session);
          }
        }
      };
      session.root.addEventListener("click", (event) => {
        const button = event.target?.closest?.("[data-paint-action]");
        if (!(button instanceof HTMLButtonElement)) return;
        event.preventDefault();
        const action = button.dataset.paintAction;
        if (action === "undo") WaterRegionDetector.#undoPaintSession(session);
        if (action === "redo") WaterRegionDetector.#redoPaintSession(session);
      });
      session.root.addEventListener("input", onInput);
      session.root.addEventListener("change", onInput);
      WaterRegionDetector.#updatePaintSessionStatus(session);
    });
  }

  static previewFromMask(maskData) {
    const { mask, cols, rows, gridStep } = maskData ?? {};
    if (!mask || !cols || !rows || !gridStep) return null;
    const imgW = WaterRegionDetector.#cachedImgW;
    const imgH = WaterRegionDetector.#cachedImgH;
    if (imgW <= 0 || imgH <= 0) return null;

    const canvasEl = document.createElement("canvas");
    canvasEl.width = imgW;
    canvasEl.height = imgH;
    const ctx = canvasEl.getContext("2d");
    if (!ctx) return null;
    const image = ctx.createImageData(imgW, imgH);
    const data = image.data;

    for (let gy = 0; gy < rows; gy += 1) {
      for (let gx = 0; gx < cols; gx += 1) {
        if (!mask[gy * cols + gx]) continue;
        for (let dy = 0; dy < gridStep && (gy * gridStep + dy) < imgH; dy += 1) {
          for (let dx = 0; dx < gridStep && (gx * gridStep + dx) < imgW; dx += 1) {
            const idx = ((gy * gridStep + dy) * imgW + (gx * gridStep + dx)) * 4;
            data[idx] = 40;
            data[idx + 1] = 140;
            data[idx + 2] = 240;
            data[idx + 3] = 110;
          }
        }
      }
    }

    ctx.putImageData(image, 0, 0);
    const texture = PIXI.Texture.from(canvasEl);
    const sprite = new PIXI.Sprite(texture);
    const map = getSceneImageMapping(imgW, imgH);
    sprite.x = map.sceneX;
    sprite.y = map.sceneY;
    sprite.width = map.sceneWidth;
    sprite.height = map.sceneHeight;
    sprite.alpha = 0.6;
    sprite.eventMode = "none";
    return sprite;
  }

  static cancelPaintSession({ notify = true } = {}) {
    if (WaterRegionDetector.#activeSession) {
      return WaterRegionDetector.#endSession({ notify });
    }
    return false;
  }

  static async startPaintToCreate(options = {}) {
    if (WaterRegionDetector.#startingPaintSession) return false;
    WaterRegionDetector.#startingPaintSession = true;
    try {
    if (!game?.user?.isGM) {
      ui?.notifications?.warn?.(localizeText(WaterRegionDetector.#moduleId, "Notifications.GmOnlyPainting", "Indy Regions | Region painting is GM-only."));
      return false;
    }
    if (!canvas?.stage) {
      ui?.notifications?.warn?.(localizeText(WaterRegionDetector.#moduleId, "Notifications.CanvasNotReady", "Indy Regions | Canvas is not ready."));
      return false;
    }
    WaterRegionDetector.cancelPaintSession();
    if (!await WaterRegionDetector.#ensureImageCache()) {
      ui?.notifications?.warn?.(localizeText(WaterRegionDetector.#moduleId, "Notifications.SceneNotReadyForPainting", "Indy Regions | Canvas scene is not ready for region painting."));
      return false;
    }

    const editRegion = options?.editRegion?.document ?? options?.editRegion ?? null;
    const storedOptions = getStoredPaintOptions(WaterRegionDetector.#moduleId);
    const session = {
      options: normalizeOptions({
        ...storedOptions,
        paintColor: storedOptions.paintColor ?? getStoredPaintColor(WaterRegionDetector.#moduleId),
        ...options,
      }),
      isPaintSession: true,
      maskData: null,
      candidate: null,
      paintUndoStack: [],
      paintRedoStack: [],
      previewSprite: null,
      brushGfx: null,
      suppressedTargetBehaviorStates: null,
      dialog: null,
      root: null,
      paintRefreshTimer: null,
      paintDirty: false,
      painting: false,
      paintMode: null,
      lastPaintPoint: null,
      lastBrushPoint: null,
      paintStrokeChanged: false,
      closed: false,
      onDown: null,
      onMove: null,
      onUp: null,
      onKeyDown: null,
      onDomDown: null,
      onDomMove: null,
      onDomUp: null,
      onDomLeave: null,
      onWheel: null,
      gridStepUpdateTimer: null,
      suppressCompatMouseUntil: 0,
      restoreRegionLayerInteraction: null,
      restoreCanvasDragSelection: null,
      restoreTargetRegionVisibility: null,
      targetRegion: editRegion,
    };

    if (editRegion) {
      const doc = editRegion?.document ?? editRegion;
      const placeable = editRegion?.object ?? doc?.object ?? canvas?.regions?.get?.(doc?.id);
      session.originalTargetRegionVisible = placeable?.visible !== false && placeable?.renderable !== false;
      session.originalTargetRegionAlpha = Number.isFinite(Number(placeable?.alpha)) ? Number(placeable.alpha) : 1;
      setRegionPlaceableVisible(editRegion, false);
      session.restoreTargetRegionVisibility = () => {
        setRegionPlaceableVisible(editRegion, session.originalTargetRegionVisible !== false);
        const target = editRegion?.object ?? doc?.object ?? canvas?.regions?.get?.(doc?.id);
        if (target && Number.isFinite(Number(session.originalTargetRegionAlpha))) target.alpha = session.originalTargetRegionAlpha;
      };
      await WaterRegionDetector.#setTargetRegionShaderSuppressed(session, true);
    }

    const opts = normalizeOptions(session.options);
    const storedPaintMask = editRegion ? WaterRegionDetector.#loadPaintMaskFlag(editRegion, opts) : null;
    if (storedPaintMask) {
      session.options = normalizeOptions({
        ...session.options,
        paintColor: storedPaintMask.color,
        gridStep: storedPaintMask.maskData.gridStep,
      });
      session.maskData = storedPaintMask.maskData;
      session.sourceMaskData = WaterRegionDetector.#resampleMaskData(session.maskData, 1) ?? cloneMaskData(session.maskData);
    } else {
      session.maskData = editRegion
        ? (WaterRegionDetector.#maskFromRegionShapes(editRegion, opts) ?? WaterRegionDetector.#createEmptyMaskData(opts))
        : WaterRegionDetector.#createEmptyMaskData(opts);
      session.sourceMaskData = WaterRegionDetector.#resampleMaskData(session.maskData, 1) ?? cloneMaskData(session.maskData);
    }
    const initialBorderThickness = clamp(toFiniteNumber(opts.paintBorderThickness, DEFAULT_WATER_OPTIONS.paintBorderThickness), 0, 4);
    session.candidate = initialBorderThickness > 0
      ? WaterRegionDetector.#candidateFromMaskWithOptions(session.maskData, opts)
      : null;
    if (session.candidate) session.candidate.maskData = session.maskData;
    session.onDown = (event) => WaterRegionDetector.#handlePaintPointerDown(session, event);
    session.onMove = (event) => WaterRegionDetector.#handlePaintPointerMove(session, event);
    session.onUp = () => WaterRegionDetector.#handlePaintPointerUp(session);
    session.onKeyDown = (event) => WaterRegionDetector.#handlePaintKeyDown(session, event);
    session.onDomDown = (event) => WaterRegionDetector.#handlePaintDomPointerDown(session, event);
    session.onDomMove = (event) => WaterRegionDetector.#handlePaintDomPointerMove(session, event);
    session.onDomUp = (event) => WaterRegionDetector.#handlePaintDomPointerUp(session, event);
    session.onDomLeave = () => {
      if (!session.painting) WaterRegionDetector.#drawPaintBrush(session, null);
    };
    session.onWheel = (event) => WaterRegionDetector.#handlePaintWheel(session, event);
    session.restoreRegionLayerInteraction = suppressRegionLayerInteraction();
    session.restoreCanvasDragSelection = suppressCanvasDragSelection();

    WaterRegionDetector.#activeSession = session;
    const view = canvas?.app?.view;
    if (view) {
      view.addEventListener("pointerdown", session.onDomDown, true);
      view.addEventListener("pointermove", session.onDomMove, true);
      view.addEventListener("pointerup", session.onDomUp, true);
      view.addEventListener("pointercancel", session.onDomUp, true);
      view.addEventListener("pointerleave", session.onDomLeave, true);
      view.addEventListener("mousedown", session.onDomDown, true);
      view.addEventListener("mousemove", session.onDomMove, true);
      view.addEventListener("mouseup", session.onDomUp, true);
      view.addEventListener("mouseleave", session.onDomLeave, true);
      view.addEventListener("wheel", session.onWheel, { capture: true, passive: false });
    }
    document.addEventListener("pointerdown", session.onDomDown, true);
    document.addEventListener("pointermove", session.onDomMove, true);
    document.addEventListener("pointerup", session.onDomUp, true);
    document.addEventListener("pointercancel", session.onDomUp, true);
    document.addEventListener("mousedown", session.onDomDown, true);
    document.addEventListener("mousemove", session.onDomMove, true);
    document.addEventListener("mouseup", session.onDomUp, true);
    canvas.stage.on("pointerdown", session.onDown);
    canvas.stage.on("pointermove", session.onMove);
    canvas.stage.on("pointerup", session.onUp);
    canvas.stage.on("pointerupoutside", session.onUp);
    window.addEventListener("keydown", session.onKeyDown, true);
    WaterRegionDetector.#renderPaintSessionDialog(session);
    if (session.candidate || WaterRegionDetector.#getMaskBounds(session.maskData)) {
      WaterRegionDetector.#setPaintMaskPreview(session);
      WaterRegionDetector.#drawSessionDebug(session);
      WaterRegionDetector.#updatePaintSessionStatus(session);
    }
    ui?.notifications?.info?.(editRegion
      ? localizeText(WaterRegionDetector.#moduleId, "Notifications.PaintingSelectedRegion", "Indy Regions | Painting selected Region. Left mouse adds, Shift-left subtracts.")
      : localizeText(WaterRegionDetector.#moduleId, "Notifications.PaintRegion", "Indy Regions | Paint a Region. Left mouse adds, Shift-left subtracts."));
    return true;
    } finally {
      WaterRegionDetector.#startingPaintSession = false;
    }
  }
}

export const RegionPainter = WaterRegionDetector;

