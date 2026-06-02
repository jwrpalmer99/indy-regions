import { getSceneImageMapping } from "./region-painter-foundry.js";
import { getRegionDocumentShapes } from "./region-painter-region-adapter.js";
import {
  pointInPreparedRegionShape,
  prepareRegionShape,
} from "./region-painter-geometry.js";
import {
  expandMaskBounds,
  mergeMaskBounds,
} from "./region-painter-mask.js";
import { setLastChangedBounds } from "./region-painter-mask-state.js";
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

  // 1. Unpack contours (Outer boundary + any holes)
  // Fallback to a single polygon if no contours array exists
  const rawContours = shape.contours && shape.contours.length > 0 
    ? shape.contours 
    : (shape.polygon ? [shape.polygon] : []);
    
  if (rawContours.length === 0) return 0;

  const map = getSceneImageMapping(imgW, imgH);
  const scaleX = map.sceneWidth / imgW;
  const scaleY = map.sceneHeight / imgH;
  
  const op = String(mode ?? "add").trim().toLowerCase();
  const isRemove = op === "subtract" || op === "remove";
  const targetValue = isRemove ? 0 : 1;
  const hasChangeRecorder = typeof changeRecorder === 'function';

  const stepX = gridStep * scaleX;
  const stepY = gridStep * scaleY;
  
  // 2. Pre-process ALL edges into Grid Space ONCE
  // Instead of an array of points, we build a flat array of all edges
  // This makes the scanline loop incredibly fast, regardless of holes
  const edges = [];
  let minGY = rows, maxGY = -1;

  for (let c = 0; c < rawContours.length; c++) {
    const contour = rawContours[c];
    const len = contour.length;
    if (len < 3) continue;

    for (let i = 0; i < len; i++) {
      const pt1 = contour[i];
      const pt2 = contour[i === len - 1 ? 0 : i + 1]; // Wrap around to close path

      const y1 = (pt1.y - map.sceneY) / stepY - 0.5;
      const y2 = (pt2.y - map.sceneY) / stepY - 0.5;
      
      // Track absolute Y bounds
      if (y1 < minGY) minGY = y1;
      if (y1 > maxGY) maxGY = y1;

      // Ignore perfectly horizontal edges (they don't intersect Y-scanlines)
      if (y1 === y2) continue;

      const x1 = (pt1.x - map.sceneX) / stepX - 0.5;
      const x2 = (pt2.x - map.sceneX) / stepX - 0.5;

      // Store edges with their specific min/max Y for fast filtering later
      edges.push({
        yMin: Math.min(y1, y2),
        yMax: Math.max(y1, y2),
        x1: y1 < y2 ? x1 : x2, // x at yMin
        x2: y1 < y2 ? x2 : x1, // x at yMax
        y1: y1 < y2 ? y1 : y2, // yMin
        y2: y1 < y2 ? y2 : y1  // yMax
      });
    }
  }

  const numEdges = edges.length;
  if (numEdges === 0) return 0;

  minGY = Math.max(0, Math.floor(minGY));
  maxGY = Math.min(rows - 1, Math.ceil(maxGY));
  if (maxGY < minGY) return 0;

  let changed = 0;
  let minCX = Infinity, minCY = Infinity;
  let maxCX = -Infinity, maxCY = -Infinity;

  // Maximum possible intersections is the number of edges
  const nodes = new Float64Array(numEdges); 

  // 3. The Scanline Loop
  for (let y = minGY; y <= maxGY; y++) {
    let nodeCount = 0;

    // Find intersecting edges for this Y row
    for (let i = 0; i < numEdges; i++) {
      const edge = edges[i];
      
      // If the scanline passes through the edge's Y-bounds
      if (y >= edge.yMin && y < edge.yMax) {
        // Linear interpolation to find the exact X intersection
        nodes[nodeCount++] = edge.x1 + (y - edge.y1) / (edge.y2 - edge.y1) * (edge.x2 - edge.x1);
      }
    }

    if (nodeCount === 0) continue;

    // Inline insertion sort (Bypasses JS built-in sort overhead for small arrays)
    for (let i = 1; i < nodeCount; i++) {
      let key = nodes[i];
      let j = i - 1;
      while (j >= 0 && nodes[j] > key) {
        nodes[j + 1] = nodes[j];
        j--;
      }
      nodes[j + 1] = key;
    }
    
    // We can use the sorted 'nodes' array directly now, avoiding .subarray() allocation
    const activeNodes = nodes; 

    const rowOffset = y * cols;

    // 4. Fill the pixels (Even-Odd Parity handles holes automatically)
    // i += 2 pairs up the start and end of a fill segment
    for (let i = 0; i < nodeCount; i += 2) {
      if (i + 1 >= nodeCount) break;

      let startX = Math.max(0, Math.ceil(activeNodes[i]));
      let endX = Math.min(cols - 1, Math.floor(activeNodes[i + 1]));

      for (let x = startX; x <= endX; x++) {
        const idx = rowOffset + x;
        const currentVal = mask[idx];

        if (currentVal === targetValue) continue;

        if (hasChangeRecorder) {
          changeRecorder(maskData, idx, currentVal);
        }

        mask[idx] = targetValue;
        if (maskData.alphaMask && idx < maskData.alphaMask.length) {
          maskData.alphaMask[idx] = targetValue ? 255 : 0;
        }
        changed++;

        if (x < minCX) minCX = x;
        if (x > maxCX) maxCX = x;
        if (y < minCY) minCY = y;
        if (y > maxCY) maxCY = y;
      }
    }
  }

  // 5. Finalize Bounds
  if (changed > 0) {
    let changedBounds = null;
    changedBounds = expandMaskBounds(changedBounds, minCX, minCY, cols, rows);
    changedBounds = expandMaskBounds(changedBounds, maxCX, maxCY, cols, rows);

    setLastChangedBounds(maskData, changedBounds);
    
    if (isRemove) {
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
  const shapes = getRegionDocumentShapes(region);
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
