import { DEFAULT_WATER_OPTIONS } from "./region-painter-constants.js";
import { getSceneImageMapping } from "./region-painter-foundry.js";
import { sameMaskBounds, normalizeMaskBounds } from "./region-painter-mask.js";
import {
  hexToRgbInt,
  normalizeHexColor,
  normalizePaintOpacity,
} from "./region-painter-options.js";
import {
  debugTiming,
  nowMs,
  roundTimingMs,
} from "./region-painter-utils.js";

export function destroyPreviewSprite(sprite) {
  if (!sprite) return;
  try {
    sprite.parent?.removeChild?.(sprite);
    sprite.texture?.destroy?.(true);
    sprite.destroy?.({ children: true });
  } catch (_err) {
    // Non-fatal.
  }
}

export function destroyGraphics(gfx) {
  if (!gfx) return;
  try {
    gfx.parent?.removeChild?.(gfx);
    gfx.destroy?.({ children: true });
  } catch (_err) {
    // Non-fatal.
  }
}

export function createPaintPreviewFromMask(maskData, {
  color = DEFAULT_WATER_OPTIONS.paintColor,
  opacity = DEFAULT_WATER_OPTIONS.paintOpacity,
  imgW = 0,
  imgH = 0,
  getMaskBounds = null,
  moduleId = "indy-regions",
} = {}) {
  const totalStart = nowMs();
  const { mask, alphaMask, cols, rows, gridStep } = maskData ?? {};
  if (!mask || !cols || !rows || !gridStep) return null;
  if (!imgW || !imgH) return null;
  const bounds = getMaskBounds?.(maskData) ?? null;
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
  debugTiming(moduleId, "paint-preview-from-mask", {
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

export function updatePaintPreviewDirtyRect(session, dirtyBounds, {
  color = DEFAULT_WATER_OPTIONS.paintColor,
  opacity = DEFAULT_WATER_OPTIONS.paintOpacity,
  getMaskBounds = null,
  moduleId = "indy-regions",
} = {}) {
  const totalStart = nowMs();
  const sprite = session?.previewSprite;
  const maskData = session?.maskData;
  const { mask, cols, rows } = maskData ?? {};
  const previewBounds = sprite?._indyRegionsPreviewBounds;
  const ctx = sprite?._indyRegionsPreviewCtx;
  if (!sprite || !ctx || !mask || !cols || !rows || !previewBounds) return false;
  const currentBounds = getMaskBounds?.(maskData) ?? null;
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
  debugTiming(moduleId, "paint-preview-dirty-rect", {
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
