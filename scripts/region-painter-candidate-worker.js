import {
  DEFAULT_PAINT_OPTIONS,
  MIN_HOLE_LOOP_AREA_CELLS,
} from "./region-painter-constants.js";
import {
  pointInPolygon,
  pointsBounds,
  polygonArea,
  smoothBoundaryPolygon,
} from "./region-painter-geometry.js";
import { normalizeMaskBounds } from "./region-painter-mask.js";
import {
  findMaskComponentsScanline,
  traceRunComponentBoundaries,
} from "./region-painter-morphology.js";
import {
  normalizeBorderSmoothType,
  normalizeOptions,
} from "./region-painter-options.js";
import { toFiniteNumber } from "./region-painter-utils.js";

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

let lastGeometryCache = null;

function candidateFromMask(maskData, options = {}, mapping = {}) {
  const totalStart = nowMs();
  const opts = normalizeOptions(options);
  const smoothing = Math.max(0, toFiniteNumber(opts.smoothing, DEFAULT_PAINT_OPTIONS.smoothing));
  const borderSmoothType = normalizeBorderSmoothType(opts.borderSmoothType);
  const fillHoles = opts.fillHoles === true;
  const { mask, cols, rows, gridStep } = maskData ?? {};
  if (!cols || !rows || !gridStep) return { candidate: null, timing: { totalMs: 0 } };
  const scanBounds = normalizeMaskBounds(maskData.bounds, cols, rows);
  if (!scanBounds) return { candidate: null, timing: { totalMs: 0 } };

  let areaMs = 0;
  let componentsMs = 0;
  let traceMs = 0;
  let simplifyMs = 0;
  const geometryCacheHit = lastGeometryCache?.key
    && lastGeometryCache.key === maskData.cacheKey
    && lastGeometryCache.scanBounds?.minX === scanBounds.minX
    && lastGeometryCache.scanBounds?.minY === scanBounds.minY
    && lastGeometryCache.scanBounds?.maxX === scanBounds.maxX
    && lastGeometryCache.scanBounds?.maxY === scanBounds.maxY;
  if (!mask && !geometryCacheHit) return { candidate: null, timing: { totalMs: 0 } };
  let geometry = geometryCacheHit ? lastGeometryCache : null;
  let area = geometry?.area ?? 0;

  if (!geometry) {
    const areaStart = nowMs();
    for (let y = scanBounds.minY; y <= scanBounds.maxY; y += 1) {
      const rowOffset = y * cols;
      for (let x = scanBounds.minX; x <= scanBounds.maxX; x += 1) {
        if (mask[rowOffset + x]) area += 1;
      }
    }
    areaMs = nowMs() - areaStart;
  }
  if (area < 3) return { candidate: null, timing: { areaMs: roundTimingMs(areaMs), totalMs: roundTimingMs(nowMs() - totalStart) } };

  if (!geometry) {
    const minShapeArea = Math.max(3, Number(DEFAULT_PAINT_OPTIONS.minShapeArea) || 3);
    const componentsStart = nowMs();
    const allComponents = findMaskComponentsScanline(mask, cols, rows, scanBounds);
    const components = allComponents.filter((component) => component.length >= minShapeArea);
    componentsMs = nowMs() - componentsStart;

    const rawShapes = [];
    let tracedBoundaryPoints = 0;
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
      key: maskData.cacheKey ?? null,
      scanBounds: { ...scanBounds },
      area,
      rawShapes,
      allComponentCount: allComponents.length,
      componentCount: components.length,
      tracedBoundaryPoints,
      areaMs,
      componentsMs,
      traceMs,
      simplifyCache: new Map(),
    };
    lastGeometryCache = geometry;
  }

  const smoothingKey = `${borderSmoothType}:${smoothing}`;
  let simplifiedShapes = geometry.simplifyCache?.get?.(smoothingKey) ?? null;
  if (!simplifiedShapes) {
    simplifiedShapes = [];
    for (const rawShape of geometry.rawShapes) {
      const simplifyStart = nowMs();
      const simplified = smoothBoundaryPolygon(rawShape.rawBoundary, smoothing, borderSmoothType);
      simplifyMs += nowMs() - simplifyStart;
      if (simplified.length >= 3) simplifiedShapes.push({ ...rawShape, simplified });
    }
    geometry.simplifyCache ??= new Map();
    geometry.simplifyCache.set(smoothingKey, simplifiedShapes);
  }

  const shapes = [];
  let simplifiedBoundaryPoints = 0;
  for (const simplifiedShape of simplifiedShapes) {
    if (fillHoles === true && simplifiedShape.isHole === true) continue;
    const simplified = simplifiedShape.simplified;
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
      area: simplifiedShape.area,
      isHole: simplifiedShape.isHole,
      bounds: pointsBounds(points),
    });
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
        allComponents: geometry.allComponentCount,
        keptComponents: geometry.componentCount,
        shapes: 0,
        geometryCacheHit,
        areaMs: roundTimingMs(geometry.areaMs ?? areaMs),
        componentsMs: roundTimingMs(geometry.componentsMs ?? componentsMs),
        traceMs: roundTimingMs(geometry.traceMs ?? traceMs),
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
      componentCount: geometry.componentCount,
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
      allComponents: geometry.allComponentCount,
      keptComponents: geometry.componentCount,
      shapes: shapes.length,
      tracedBoundaryPoints: geometry.tracedBoundaryPoints,
      simplifiedBoundaryPoints,
      smoothing,
      borderSmoothType,
      fillHoles,
      geometryCacheHit,
      areaMs: roundTimingMs(geometry.areaMs ?? areaMs),
      componentsMs: roundTimingMs(geometry.componentsMs ?? componentsMs),
      traceMs: roundTimingMs(geometry.traceMs ?? traceMs),
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
