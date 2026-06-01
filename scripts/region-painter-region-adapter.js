import {
  DEFAULT_WATER_OPTIONS,
  PAINT_MASK_FLAG,
} from "./region-painter-constants.js";
import {
  collectionToArray,
  getRegionId,
} from "./region-painter-foundry.js";
import {
  pointsBounds,
  polygonArea,
  pointInPolygon,
  pointInPreparedRegionShape,
  prepareRegionShape,
} from "./region-painter-geometry.js";
import {
  base64ToBytes,
  bytesToBase64,
  maskFullCols,
  maskFullRows,
  maskOffsetX,
  maskOffsetY,
  normalizeMaskBounds,
} from "./region-painter-mask.js";
import {
  normalizeHexColor,
  normalizeOptions,
} from "./region-painter-options.js";
import {
  debugTiming,
  toFiniteNumber,
} from "./region-painter-utils.js";

export function buildPaintRegionDocumentAppearance(options = {}) {
  return {
    color: normalizeHexColor(options.paintColor, DEFAULT_WATER_OPTIONS.paintColor),
  };
}

export function savePaintMaskFlag(region, session, {
  moduleId = "indy-regions",
  getMaskBounds = null,
  options = {},
} = {}) {
  if (!region?.setFlag || !session?.maskData?.mask) return null;
  const { mask, cols, rows, gridStep } = session.maskData;
  const fullCols = maskFullCols(session.maskData);
  const fullRows = maskFullRows(session.maskData);
  const localOffsetX = maskOffsetX(session.maskData);
  const localOffsetY = maskOffsetY(session.maskData);
  const localBounds = getMaskBounds?.(session.maskData) ?? null;
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
  const flagData = {
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
  };
  return region.setFlag(moduleId, PAINT_MASK_FLAG, flagData);
}

export function loadPaintMaskFlag(region, {
  moduleId = "indy-regions",
  options = {},
} = {}) {
  const flagData = region?.getFlag?.(moduleId, PAINT_MASK_FLAG)
    ?? region?.document?.getFlag?.(moduleId, PAINT_MASK_FLAG);
  if (!flagData) return null;
  const opts = normalizeOptions(options);
  const gridStep = Math.max(1, Math.round(toFiniteNumber(flagData.gridStep, opts.gridStep)));
  const cols = Math.max(1, Math.round(toFiniteNumber(flagData.cols, 0)));
  const rows = Math.max(1, Math.round(toFiniteNumber(flagData.rows, 0)));
  const alphaMask = base64ToBytes(flagData.alpha);
  if (!cols || !rows || !alphaMask) return null;
  const mask = new Uint8Array(cols * rows);
  const cropCols = Math.max(0, Math.round(toFiniteNumber(flagData.cropCols, 0)));
  const cropRows = Math.max(0, Math.round(toFiniteNumber(flagData.cropRows, 0)));
  const offsetX = Math.max(0, Math.round(toFiniteNumber(flagData.offsetX, 0)));
  const offsetY = Math.max(0, Math.round(toFiniteNumber(flagData.offsetY, 0)));
  if (flagData.version >= 2 || flagData.format === "cropped-alpha") {
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
  const maskData = { mask, cols, rows, gridStep, bounds: normalizeMaskBounds(flagData.bounds, cols, rows) };
  if (!maskData.bounds) maskData.boundsDirty = true;
  return {
    maskData,
    color: normalizeHexColor(flagData.color, opts.paintColor),
  };
}

export function getCurrentRegionSources(session, {
  candidateFromMask = null,
} = {}) {
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

  if (session?.maskData?.mask) {
    const candidate = candidateFromMask?.(session.maskData, normalizeOptions(session.options ?? {}));
    if (Array.isArray(candidate?.shapes) && candidate.shapes.length) add({ shapes: candidate.shapes });
  }

  return sources;
}

export function getRegionDocumentShapes(region) {
  const doc = region?.document ?? region;
  if (Array.isArray(doc?.shapes)) return doc.shapes;
  if (!region?.document && Array.isArray(region?.shapes)) return region.shapes;
  return [];
}

export function findTargetRegionShapeAtPoint(session, point, options = {}) {
  if (!point) return null;
  const sources = getCurrentRegionSources(session, options);
  const pointInBounds = (bounds) => Boolean(bounds
    && point.x >= bounds.minX
    && point.x <= bounds.maxX
    && point.y >= bounds.minY
    && point.y <= bounds.maxY);
  const boundsArea = (bounds) => Math.max(0, Number(bounds?.width) || 0) * Math.max(0, Number(bounds?.height) || 0);
  for (let r = sources.length - 1; r >= 0; r -= 1) {
    const region = sources[r];
    const shapes = getRegionDocumentShapes(region);
    let testedShapes = 0;
    let testedHoles = 0;
    let boundsHoleHits = 0;
    let firstSolidMatch = null;
    let bestHoleBoundsMatch = null;
    let bestHoleBoundsArea = Infinity;
    for (let i = shapes.length - 1; i >= 0; i -= 1) {
      const shape = prepareRegionShape(shapes[i]);
      if (!shape) continue;
      testedShapes += 1;
      if (Array.isArray(shape.contours) && shape.contours.length > 1) {
        let bestHoleContour = null;
        let bestHoleArea = Infinity;
        let bestHoleExact = false;
        const outerArea = Math.max(...shape.contours.map((contour) => Math.abs(polygonArea(contour))));
        for (let c = 0; c < shape.contours.length; c += 1) {
          const contour = shape.contours[c];
          const exactHit = pointInPolygon(point, contour);
          const contourBounds = exactHit ? null : pointsBounds(contour);
          if (!exactHit && !pointInBounds(contourBounds)) continue;
          const area = Math.abs(polygonArea(contour));
          let containerCount = 0;
          const sample = contour[0];
          for (let j = 0; j < shape.contours.length; j += 1) {
            if (j === c) continue;
            if (pointInPolygon(sample, shape.contours[j])) containerCount += 1;
          }
          const isHoleContour = (containerCount % 2 === 1) || (area < outerArea);
          if (!isHoleContour) continue;
          if (bestHoleContour && bestHoleExact && !exactHit) continue;
          if (bestHoleContour && exactHit === bestHoleExact && area >= bestHoleArea) continue;
          bestHoleContour = contour;
          bestHoleArea = area;
          bestHoleExact = exactHit;
        }
        if (bestHoleContour) {
          return {
            ...shape,
            bounds: shape.bounds,
            contours: [bestHoleContour],
            data: { type: "polygon", points: bestHoleContour, hole: true },
            isHole: true,
            polygon: bestHoleContour,
          };
        }
      }
      const exactShapeHit = pointInPreparedRegionShape(point, shape);
      if (shape.isHole === true) {
        testedHoles += 1;
        if (exactShapeHit) return shape;
        if (!pointInBounds(shape.bounds)) continue;
        boundsHoleHits += 1;
        const area = boundsArea(shape.bounds);
        if (area < bestHoleBoundsArea) {
          bestHoleBoundsMatch = shape;
          bestHoleBoundsArea = area;
        }
        continue;
      }
      if (!exactShapeHit) continue;
      firstSolidMatch ??= shape;
    }
    if (bestHoleBoundsMatch) return bestHoleBoundsMatch;
    if (firstSolidMatch) return firstSolidMatch;
    debugTiming(options.moduleId ?? "indy-regions", "paint-shape-hit-test-miss", {
      sourceIndex: r,
      sourceCount: sources.length,
      shapeCount: shapes.length,
      testedShapes,
      testedHoles,
      boundsHoleHits,
      point: { x: Math.round(point.x), y: Math.round(point.y) },
    });
  }
  return null;
}
