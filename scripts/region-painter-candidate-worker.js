import {
  DEFAULT_WATER_OPTIONS,
  MIN_HOLE_LOOP_AREA_CELLS,
} from "./region-painter-constants.js";
import {
  pointInPolygon,
  pointsBounds,
  polygonArea,
  simplifyClosedPolygon,
} from "./region-painter-geometry.js";
import { normalizeMaskBounds } from "./region-painter-mask.js";
import {
  findMaskComponentsScanline,
  traceRunComponentBoundaries,
} from "./region-painter-morphology.js";
import { normalizeOptions } from "./region-painter-options.js";

function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function roundTimingMs(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function imageGridPointToScene(point, mapping) {
  const scaleX = mapping.sceneWidth / mapping.imgW;
  const scaleY = mapping.sceneHeight / mapping.imgH;
  return {
    x: Math.round(mapping.sceneX + point.x * mapping.gridStep * scaleX),
    y: Math.round(mapping.sceneY + point.y * mapping.gridStep * scaleY),
  };
}

function candidateFromMask(maskData, options = {}, mapping = {}) {
  const totalStart = nowMs();
  const opts = normalizeOptions(options);
  const smoothing = Number(opts.smoothing) || DEFAULT_WATER_OPTIONS.smoothing;
  const fillHoles = opts.fillHoles === true;
  const { mask, cols, rows, gridStep } = maskData ?? {};
  if (!mask || !cols || !rows || !gridStep) return { candidate: null, timing: { totalMs: 0 } };
  const scanBounds = normalizeMaskBounds(maskData.bounds, cols, rows);
  if (!scanBounds) return { candidate: null, timing: { totalMs: 0 } };

  let areaMs = 0;
  let componentsMs = 0;
  let traceMs = 0;
  let simplifyMs = 0;
  const areaStart = nowMs();
  let area = 0;
  for (let y = scanBounds.minY; y <= scanBounds.maxY; y += 1) {
    const rowOffset = y * cols;
    for (let x = scanBounds.minX; x <= scanBounds.maxX; x += 1) {
      if (mask[rowOffset + x]) area += 1;
    }
  }
  areaMs = nowMs() - areaStart;
  if (area < 3) return { candidate: null, timing: { areaMs: roundTimingMs(areaMs), totalMs: roundTimingMs(nowMs() - totalStart) } };

  const minShapeArea = Math.max(3, Number(DEFAULT_WATER_OPTIONS.minShapeArea) || 3);
  const componentsStart = nowMs();
  const allComponents = findMaskComponentsScanline(mask, cols, rows, scanBounds);
  const components = allComponents.filter((component) => component.length >= minShapeArea);
  componentsMs = nowMs() - componentsStart;

  const shapes = [];
  let tracedBoundaryPoints = 0;
  let simplifiedBoundaryPoints = 0;
  for (const component of components) {
    const traceStart = nowMs();
    const boundaryLoops = traceRunComponentBoundaries(component, cols, rows);
    traceMs += nowMs() - traceStart;
    const testPoint = Number.isFinite(component.minX) && Number.isFinite(component.minY)
      ? { x: component.minX + 0.5, y: component.minY + 0.5 }
      : null;
    const outerIndex = Math.max(0, boundaryLoops.findIndex((loop) => pointInPolygon(testPoint, loop)));
    for (let i = 0; i < boundaryLoops.length; i += 1) {
      const rawBoundary = boundaryLoops[i];
      if (!rawBoundary || rawBoundary.length < 3) continue;
      const isHole = i !== outerIndex;
      if (fillHoles === true && isHole) continue;
      if (isHole && Math.abs(polygonArea(rawBoundary)) < MIN_HOLE_LOOP_AREA_CELLS) continue;
      tracedBoundaryPoints += rawBoundary.length;
      const simplifyStart = nowMs();
      const simplified = simplifyClosedPolygon(rawBoundary, smoothing);
      simplifyMs += nowMs() - simplifyStart;
      if (simplified.length < 3) continue;
      simplifiedBoundaryPoints += simplified.length;
      const points = simplified.map((point) => imageGridPointToScene({
        x: point.x + (maskData.offsetX ?? 0),
        y: point.y + (maskData.offsetY ?? 0),
      }, {
        ...mapping,
        gridStep,
      }));
      if (points.length < 3) continue;
      shapes.push({
        points,
        area: isHole ? 0 : component.length,
        isHole,
        bounds: pointsBounds(points),
      });
    }
  }

  if (!shapes.length) {
    return {
      candidate: null,
      timing: {
        gridStep,
        cols,
        rows,
        cells: cols * rows,
        scanCells: scanBounds.width * scanBounds.height,
        scanBounds,
        filledCells: area,
        allComponents: allComponents.length,
        keptComponents: components.length,
        shapes: 0,
        areaMs: roundTimingMs(areaMs),
        componentsMs: roundTimingMs(componentsMs),
        traceMs: roundTimingMs(traceMs),
        simplifyMs: roundTimingMs(simplifyMs),
        totalMs: roundTimingMs(nowMs() - totalStart),
      },
    };
  }

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

  return {
    candidate: {
      points: shapes[0].points,
      shapes,
      area,
      componentCount: components.length,
      shapeCount: shapes.length,
      centroid: {
        x: cx / Math.max(1, pointCount),
        y: cy / Math.max(1, pointCount),
      },
      vertexCount: pointCount,
    },
    timing: {
      gridStep,
      cols,
      rows,
      cells: cols * rows,
      scanCells: scanBounds.width * scanBounds.height,
      scanBounds,
      filledCells: area,
      fillPercent: roundTimingMs((area / Math.max(1, cols * rows)) * 100),
      allComponents: allComponents.length,
      keptComponents: components.length,
      shapes: shapes.length,
      tracedBoundaryPoints,
      simplifiedBoundaryPoints,
      smoothing,
      fillHoles,
      areaMs: roundTimingMs(areaMs),
      componentsMs: roundTimingMs(componentsMs),
      traceMs: roundTimingMs(traceMs),
      simplifyMs: roundTimingMs(simplifyMs),
      totalMs: roundTimingMs(nowMs() - totalStart),
    },
  };
}

globalThis.onmessage = (event) => {
  const { requestId, maskData, options, mapping } = event.data ?? {};
  try {
    const result = candidateFromMask(maskData, options, mapping);
    globalThis.postMessage({ requestId, ...result });
  } catch (err) {
    globalThis.postMessage({
      requestId,
      error: err?.stack || err?.message || String(err),
    });
  }
};
