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

const PREVIEW_TILE_SIZE = 512;

export function destroyPreviewSprite(sprite) {
  if (!sprite) return;
  try {
    const tiles = sprite._indyRegionsPreviewTiles;
    if (tiles instanceof Map) {
      for (const tile of tiles.values()) {
        tile.sprite?.parent?.removeChild?.(tile.sprite);
        tile.sprite?.texture?.destroy?.(true);
        tile.sprite?.destroy?.({ children: true });
      }
      tiles.clear();
    }
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

function paintPreviewTile(tile, maskData, rgb) {
  const { mask, alphaMask, cols } = maskData;
  const { bounds, ctx } = tile;
  const imageData = ctx.createImageData(bounds.width, bounds.height);
  const data = imageData.data;
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
  ctx.clearRect(0, 0, bounds.width, bounds.height);
  ctx.putImageData(imageData, 0, 0);
  return visibleCells;
}

function updateTileTexture(tile) {
  try {
    tile.sprite?.texture?.update?.();
    tile.sprite?.texture?.baseTexture?.update?.();
  } catch (_err) {
    // Non-fatal. A future full rebuild will recover if texture update is unavailable.
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
  const pixelsStart = nowMs();
  const map = getSceneImageMapping(imgW, imgH);
  const scaleX = map.sceneWidth / imgW;
  const scaleY = map.sceneHeight / imgH;
  const container = new PIXI.Container();
  container.alpha = normalizePaintOpacity(opacity);
  container.eventMode = "none";
  container.zIndex = 1000000;
  container._indyRegionsPreviewTiles = new Map();
  container._indyRegionsPreviewBounds = { ...bounds };
  container._indyRegionsPreviewColor = normalizeHexColor(color, DEFAULT_WATER_OPTIONS.paintColor);
  container._indyRegionsPreviewOpacity = normalizePaintOpacity(opacity);
  container._indyRegionsPreviewTileSize = PREVIEW_TILE_SIZE;
  let visibleCells = 0;
  const textureStart = nowMs();
  for (let tileY = bounds.minY; tileY <= bounds.maxY; tileY += PREVIEW_TILE_SIZE) {
    for (let tileX = bounds.minX; tileX <= bounds.maxX; tileX += PREVIEW_TILE_SIZE) {
      const tileBounds = normalizeMaskBounds({
        minX: tileX,
        minY: tileY,
        maxX: Math.min(bounds.maxX, tileX + PREVIEW_TILE_SIZE - 1),
        maxY: Math.min(bounds.maxY, tileY + PREVIEW_TILE_SIZE - 1),
      }, cols, rows);
      if (!tileBounds) continue;
      const canvas = document.createElement("canvas");
      canvas.width = tileBounds.width;
      canvas.height = tileBounds.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      ctx.imageSmoothingEnabled = false;
      const texture = PIXI.Texture.from(canvas);
      const sprite = new PIXI.Sprite(texture);
      sprite.x = map.sceneX + (tileBounds.minX * gridStep * scaleX);
      sprite.y = map.sceneY + (tileBounds.minY * gridStep * scaleY);
      sprite.width = tileBounds.width * gridStep * scaleX;
      sprite.height = tileBounds.height * gridStep * scaleY;
      sprite.eventMode = "none";
      const tile = { bounds: tileBounds, canvas, ctx, sprite };
      visibleCells += paintPreviewTile(tile, maskData, rgb);
      updateTileTexture(tile);
      container.addChild(sprite);
      container._indyRegionsPreviewTiles.set(`${tileBounds.minX},${tileBounds.minY}`, tile);
    }
  }
  const pixelsMs = nowMs() - pixelsStart;
  const textureMs = nowMs() - textureStart;
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
  return container;
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
  const tiles = sprite?._indyRegionsPreviewTiles;
  if (!sprite || !(tiles instanceof Map) || !mask || !cols || !rows || !previewBounds) return false;
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
  const pixelsStart = nowMs();
  let visibleCells = 0;
  let updatedTiles = 0;
  for (const tile of tiles.values()) {
    const tileUpdateBounds = normalizeMaskBounds({
      minX: Math.max(tile.bounds.minX, updateBounds.minX),
      minY: Math.max(tile.bounds.minY, updateBounds.minY),
      maxX: Math.min(tile.bounds.maxX, updateBounds.maxX),
      maxY: Math.min(tile.bounds.maxY, updateBounds.maxY),
    }, cols, rows);
    if (!tileUpdateBounds) continue;
    const localX = tileUpdateBounds.minX - tile.bounds.minX;
    const localY = tileUpdateBounds.minY - tile.bounds.minY;
    const imageData = tile.ctx.createImageData(tileUpdateBounds.width, tileUpdateBounds.height);
    const data = imageData.data;
    for (let y = tileUpdateBounds.minY; y <= tileUpdateBounds.maxY; y += 1) {
      const sourceRowOffset = y * cols;
      const targetRowOffset = (y - tileUpdateBounds.minY) * tileUpdateBounds.width;
      for (let x = tileUpdateBounds.minX; x <= tileUpdateBounds.maxX; x += 1) {
        if (!mask[sourceRowOffset + x]) continue;
        visibleCells += 1;
        const di = (targetRowOffset + (x - tileUpdateBounds.minX)) * 4;
        data[di] = rgb.r;
        data[di + 1] = rgb.g;
        data[di + 2] = rgb.b;
        data[di + 3] = maskData.alphaMask?.[sourceRowOffset + x] ?? 255;
      }
    }
    tile.ctx.clearRect(localX, localY, tileUpdateBounds.width, tileUpdateBounds.height);
    tile.ctx.putImageData(imageData, localX, localY);
    updateTileTexture(tile);
    updatedTiles += 1;
  }
  const pixelsMs = nowMs() - pixelsStart;

  const textureStart = nowMs();
  const textureMs = nowMs() - textureStart;
  debugTiming(moduleId, "paint-preview-dirty-rect", {
    gridStep: maskData.gridStep ?? 0,
    cols,
    rows,
    dirtyCells: updateBounds.width * updateBounds.height,
    visibleCells,
    bounds: updateBounds,
    updatedTiles,
    pixelsMs: roundTimingMs(pixelsMs),
    textureMs: roundTimingMs(textureMs),
    totalMs: roundTimingMs(nowMs() - totalStart),
  });
  return true;
}
