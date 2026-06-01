import {
  BORDER_SMOOTH_TYPES,
  DEFAULT_WATER_OPTIONS,
  MAX_FILL_BRIDGE_PX,
} from "./region-painter-constants.js";
import {
  clamp,
  toFiniteNumber,
} from "./region-painter-utils.js";

export function rgb255ToHsl(r, g, b) {
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

export function normalizeOptions(options = {}) {
  const merged = {
    ...DEFAULT_WATER_OPTIONS,
    ...(options && typeof options === "object" ? options : {}),
  };
  merged.fillBridgePx = clamp(toFiniteNumber(merged.fillBridgePx, DEFAULT_WATER_OPTIONS.fillBridgePx), 0, MAX_FILL_BRIDGE_PX);
  merged.borderSmoothType = normalizeBorderSmoothType(merged.borderSmoothType);
  merged.fillHoles = merged.fillHoles === true;
  return merged;
}

export function normalizeBorderSmoothType(value, fallback = DEFAULT_WATER_OPTIONS.borderSmoothType) {
  const raw = String(value ?? fallback ?? DEFAULT_WATER_OPTIONS.borderSmoothType).trim().toLowerCase();
  if (raw === "current") return "catmull";
  if (raw === "area") return DEFAULT_WATER_OPTIONS.borderSmoothType;
  return BORDER_SMOOTH_TYPES.includes(raw) ? raw : DEFAULT_WATER_OPTIONS.borderSmoothType;
}

export function normalizeFillBridgePx(value, fallback = DEFAULT_WATER_OPTIONS.fillBridgePx) {
  return clamp(toFiniteNumber(value, fallback), 0, MAX_FILL_BRIDGE_PX);
}

export function normalizePaintOpacity(value, fallback = DEFAULT_WATER_OPTIONS.paintOpacity) {
  return clamp(toFiniteNumber(value, fallback), 0, 1);
}

export function normalizeHslFillBias(value, fallback = DEFAULT_WATER_OPTIONS.hslFillBias) {
  return clamp(toFiniteNumber(value, fallback), -1, 1);
}

export function rgbToWaterScore(r, g, b) {
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

export function isWaterLikeRgb(r, g, b) {
  return rgbToWaterScore(r, g, b) >= 0.08;
}

export function normalizeHexColor(value, fallback = "#ff0000") {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^#?([0-9a-f]{6})$/i);
  return match ? `#${match[1].toLowerCase()}` : fallback;
}

export function hexToRgbInt(value) {
  const hex = normalizeHexColor(value).slice(1);
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

export function getStoredPaintColor(moduleId) {
  try {
    return normalizeHexColor(globalThis.localStorage?.getItem?.(`${moduleId}.paintRegionPenColor`), DEFAULT_WATER_OPTIONS.paintColor);
  } catch (_err) {
    return DEFAULT_WATER_OPTIONS.paintColor;
  }
}

export function setStoredPaintColor(moduleId, color) {
  try {
    globalThis.localStorage?.setItem?.(`${moduleId}.paintRegionPenColor`, normalizeHexColor(color, DEFAULT_WATER_OPTIONS.paintColor));
  } catch (_err) {
    // Non-fatal.
  }
}

export function getStoredPaintOptions(moduleId) {
  try {
    const raw = globalThis.localStorage?.getItem?.(`${moduleId}.paintRegionOptions`);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_err) {
    return {};
  }
}

export function setStoredPaintOptions(moduleId, options = {}) {
  try {
    const stored = {
      brushSizePx: Math.max(1, toFiniteNumber(options.brushSizePx, DEFAULT_WATER_OPTIONS.brushSizePx)),
      tolerance: Math.max(0, toFiniteNumber(options.tolerance, DEFAULT_WATER_OPTIONS.tolerance)),
      gridStep: Math.max(1, Math.round(toFiniteNumber(options.gridStep, DEFAULT_WATER_OPTIONS.gridStep))),
      smoothing: Math.max(0, toFiniteNumber(options.smoothing, DEFAULT_WATER_OPTIONS.smoothing)),
      borderSmoothType: normalizeBorderSmoothType(options.borderSmoothType),
      featherShrinkPx: toFiniteNumber(options.featherShrinkPx, DEFAULT_WATER_OPTIONS.featherShrinkPx),
      fillBridgePx: normalizeFillBridgePx(options.fillBridgePx),
      fillColorMode: String(options.fillColorMode ?? DEFAULT_WATER_OPTIONS.fillColorMode).trim().toLowerCase() === "hsl" ? "hsl" : "rgb",
      paintColor: normalizeHexColor(options.paintColor, DEFAULT_WATER_OPTIONS.paintColor),
      paintOpacity: normalizePaintOpacity(options.paintOpacity),
      hslFillBias: normalizeHslFillBias(options.hslFillBias),
      paintBorderThickness: clamp(toFiniteNumber(options.paintBorderThickness, DEFAULT_WATER_OPTIONS.paintBorderThickness), 0, 4),
      fillHoles: options.fillHoles === true,
    };
    globalThis.localStorage?.setItem?.(`${moduleId}.paintRegionOptions`, JSON.stringify(stored));
    setStoredPaintColor(moduleId, stored.paintColor);
  } catch (_err) {
    // Non-fatal.
  }
}
