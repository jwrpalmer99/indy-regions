import { getSceneImageMapping } from "./region-painter-foundry.js";
import {
  pointInPreparedRegionShape,
  prepareRegionShape,
} from "./region-painter-geometry.js";
import {
  expandMaskBounds,
  mergeMaskBounds,
} from "./region-painter-mask.js";
import { normalizeOptions } from "./region-painter-options.js";

export function applyRegionShapeToMask(maskData, shape, {
  mode = "add",
  imgW = 0,
  imgH = 0,
  changeRecorder = null,
  invalidateMaskDerivedData = null,
} = {}) {
  const { mask, cols, rows, gridStep } = maskData ?? {};
  if (!mask || !cols || !rows || !gridStep || !shape) return 0;
  if (!imgW || !imgH) return 0;
  const map = getSceneImageMapping(imgW, imgH);
  const scaleX = map.sceneWidth / imgW;
  const scaleY = map.sceneHeight / imgH;
  const prepared = (shape?.polygon || shape?.rectBounds) ? shape : prepareRegionShape(shape);
  if (!prepared) return 0;
  const bounds = prepared.bounds;
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
      if (!pointInPreparedRegionShape(scenePoint, prepared)) continue;
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
      invalidateMaskDerivedData?.(maskData, { boundsDirty: true });
    } else {
      maskData.bounds = mergeMaskBounds(maskData.bounds, changedBounds, cols, rows);
      maskData.boundsDirty = false;
      invalidateMaskDerivedData?.(maskData);
    }
  }
  return changed;
}

export function maskFromRegionShapes(region, {
  options = {},
  imgW = 0,
  imgH = 0,
  createEmptyMaskData = null,
  fillMaskAlpha = null,
  invalidateMaskDerivedData = null,
} = {}) {
  const opts = normalizeOptions(options);
  const maskData = createEmptyMaskData?.(opts);
  if (!maskData) return null;
  const shapes = Array.isArray(region?.shapes)
    ? region.shapes
    : (Array.isArray(region?.document?.shapes) ? region.document.shapes : []);
  if (!shapes.length) return null;

  const usableShapes = shapes
    .map((shape) => prepareRegionShape(shape))
    .filter((shape) => shape && typeof shape === "object");
  if (!usableShapes.length) return null;
  if (!usableShapes.some((shape) => !shape.isHole)) return null;

  for (const shape of usableShapes.filter((entry) => !entry.isHole)) {
    applyRegionShapeToMask(maskData, shape, { mode: "add", imgW, imgH, invalidateMaskDerivedData });
  }
  for (const shape of usableShapes.filter((entry) => entry.isHole)) {
    applyRegionShapeToMask(maskData, shape, { mode: "subtract", imgW, imgH, invalidateMaskDerivedData });
  }

  return fillMaskAlpha?.(maskData, 255) ?? maskData;
}
