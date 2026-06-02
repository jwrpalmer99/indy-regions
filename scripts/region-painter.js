import {
  CARDINAL_DIRECTIONS,
  DEFAULT_TINY_HOLE_AREA_PX,
  DEFAULT_TINY_ISLAND_AREA_PX,
  DEFAULT_PAINT_OPTIONS,
  MIN_HOLE_LOOP_AREA_CELLS,
  PAINT_REGION_DEFAULT_NAME,
  SMALL_MORPH_RADIUS_CELLS,
  TINY_HOLE_AREA_SETTING,
  TINY_ISLAND_AREA_SETTING,
} from "./region-painter-constants.js";
import { renderPaintSessionDialog as renderPaintSessionDialogController } from "./region-painter-dialog-controller.js";
import {
  applyPaintDelta as applyPaintDeltaEntry,
  createPaintDeltaRecorder as createPaintDeltaRecorderForSession,
  finalizePaintDelta as finalizePaintDeltaRecorder,
} from "./region-painter-delta.js";
import {
  getSceneBackgroundPath,
  getSceneImageMapping,
  imageGridPointToScene,
  sceneToImagePoint,
  setRegionPlaceableVisible,
  suppressCanvasDragSelection,
  suppressRegionLayerInteraction,
} from "./region-painter-foundry.js";
import {
  finishPaintStroke as finishPaintStrokeOperation,
  installPaintInputHandlers,
} from "./region-painter-input.js";
import {
  beginPaintStroke as beginPaintStrokeOperation,
  continuePaintStroke as continuePaintStrokeOperation,
  floodFillPaintSession as floodFillPaintSessionOperation,
  paintTargetShapeSession as paintTargetShapeSessionOperation,
  stampPaintSession as stampPaintSessionOperation,
} from "./region-paint-operations.js";
import {
  pushPaintUndoSnapshot as pushPaintUndoSnapshotEntry,
  redoPaintSession as redoPaintSessionEntry,
  undoPaintSession as undoPaintSessionEntry,
} from "./region-painter-history.js";
import { PaintSession } from "./region-paint-session.js";
import {
  candidateShapesToRegionData,
  pointInPolygon,
  pointsBounds,
  polygonArea,
  smoothBoundaryPolygon,
} from "./region-painter-geometry.js";
import {
  cloneMaskData,
  expandMaskBounds,
  maskFullCols,
  maskFullRows,
  mergeMaskBounds,
  maskOffsetX,
  maskOffsetY,
  normalizeMaskBounds,
} from "./region-painter-mask.js";
import {
  clearMaskDerivedState,
  getDistanceCache,
  getGeometryCache,
  getMaskRevision,
  getMorphCache,
  getMorphTiming,
  setDistanceCache,
  setGeometryCache,
  setLastChangedBounds,
  setMorphCache,
  setMorphTiming,
} from "./region-painter-mask-state.js";
import {
  computeMaskBounds,
  emptyDerivedMaskData,
  expandBoundsByRadius,
  findMaskComponentsScanline,
  l1DistanceTransform,
  traceRunComponentBoundaries,
} from "./region-painter-morphology.js";
import {
  getStoredPaintColor,
  getStoredPaintOptions,
  normalizeFillBridgePx,
  normalizeBorderSmoothType,
  normalizeHexColor,
  normalizeHslFillBias,
  normalizeOptions,
  normalizeDialogScale,
  normalizePaintOpacity,
  rgb255ToHsl,
  setStoredPaintColor,
  setStoredPaintOptions,
} from "./region-painter-options.js";
import {
  destroyGraphics,
  destroyPreviewSprite,
} from "./region-painter-preview.js";
import {
  applyRegionShapeToMask as rasterApplyRegionShapeToMask,
  maskFromRegionShapes as rasterMaskFromRegionShapes,
} from "./region-painter-raster.js";
import {
  buildPaintRegionDocumentAppearance,
  findTargetRegionShapeAtPoint as findTargetRegionShapeAtPointInSources,
  loadPaintMaskFlag as loadPaintMaskFlagFromRegion,
  savePaintMaskFlag as savePaintMaskFlagToRegion,
} from "./region-painter-region-adapter.js";
import { setTargetRegionShaderSuppressed as setTargetRegionShaderSuppressedForSession } from "./region-painter-shaders.js";
import { RegionPainterState } from "./region-painter-state.js";
import {
  drawPaintBrush as drawPaintBrushForSession,
  drawSessionDebug as drawSessionDebugForSession,
  paintPreviewFromMask as createSessionPaintPreviewFromMask,
  setPaintMaskPreview as setPaintMaskPreviewForSession,
  updatePaintPreviewDirtyRectForSession,
} from "./region-painter-visuals.js";
import {
  clamp,
  debugTiming,
  localizeText,
  nowMs,
  roundTimingMs,
  toFiniteNumber,
} from "./region-painter-utils.js";

const painterState = new RegionPainterState();
const CANDIDATE_WORKER_MIN_CELLS = 2_000_000;
let candidateWorker = null;
let candidateWorkerRequestId = 0;
let candidateWorkerGeometryCacheKey = null;

function getCandidateWorker() {
  if (candidateWorker || typeof Worker === "undefined") return candidateWorker;
  try {
    candidateWorker = new Worker("modules/indy-regions/scripts/region-painter-candidate-worker.js", { type: "module" });
  } catch (err) {
    debugTiming(painterState.moduleId, "candidate-worker-unavailable", { error: err?.message ?? String(err) });
    candidateWorker = null;
  }
  return candidateWorker;
}

function cropMaskDataForWorker(maskData) {
  const bounds = getMaskBounds(maskData);
  const { mask, cols, rows, gridStep } = maskData ?? {};
  if (!mask || !bounds) return null;
  const crop = new Uint8Array(bounds.width * bounds.height);
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    const sourceRow = y * cols;
    const targetRow = (y - bounds.minY) * bounds.width;
    crop.set(mask.subarray(sourceRow + bounds.minX, sourceRow + bounds.maxX + 1), targetRow);
  }
  return {
    mask: crop,
    cols: bounds.width,
    rows: bounds.height,
    gridStep,
    offsetX: maskOffsetX(maskData) + bounds.minX,
    offsetY: maskOffsetY(maskData) + bounds.minY,
    fullCols: maskFullCols(maskData),
    fullRows: maskFullRows(maskData),
    cacheKey: maskData.cacheKey ?? null,
    bounds: {
      minX: 0,
      minY: 0,
      maxX: bounds.width - 1,
      maxY: bounds.height - 1,
      width: bounds.width,
      height: bounds.height,
    },
  };
}

function maskMetadataForWorker(maskData) {
  const bounds = getMaskBounds(maskData);
  if (!maskData || !bounds) return null;
  return {
    cols: maskData.cols,
    rows: maskData.rows,
    gridStep: maskData.gridStep,
    offsetX: maskOffsetX(maskData),
    offsetY: maskOffsetY(maskData),
    fullCols: maskFullCols(maskData),
    fullRows: maskFullRows(maskData),
    cacheKey: maskData.cacheKey ?? null,
    bounds: { ...bounds },
  };
}

function candidateFromMaskWorker(maskData, options = {}) {
  const worker = getCandidateWorker();
  const cacheKey = maskData?.cacheKey ?? null;
  const workerMaskData = cacheKey && cacheKey === candidateWorkerGeometryCacheKey
    ? maskMetadataForWorker(maskData)
    : cropMaskDataForWorker(maskData);
  if (!worker || !workerMaskData) return null;
  const requestId = ++candidateWorkerRequestId;
  const opts = normalizeOptions(options);
  const workerOptions = {
    smoothing: toFiniteNumber(opts.smoothing, DEFAULT_PAINT_OPTIONS.smoothing),
    borderSmoothType: normalizeBorderSmoothType(opts.borderSmoothType),
    fillHoles: opts.fillHoles === true,
  };
  const map = getSceneImageMapping(painterState.cachedImgW, painterState.cachedImgH);
  const mapping = {
    sceneX: map.sceneX,
    sceneY: map.sceneY,
    sceneWidth: map.sceneWidth,
    sceneHeight: map.sceneHeight,
    imgW: painterState.cachedImgW,
    imgH: painterState.cachedImgH,
  };
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
    };
    const onMessage = (event) => {
      if (event.data?.requestId !== requestId) return;
      cleanup();
      if (event.data?.error) reject(new Error(event.data.error));
      else {
        if (workerMaskData.cacheKey) candidateWorkerGeometryCacheKey = workerMaskData.cacheKey;
        resolve(event.data);
      }
    };
    const onError = (event) => {
      cleanup();
      reject(new Error(event?.message || "Candidate worker failed."));
    };
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    try {
      const transfer = workerMaskData.mask?.buffer ? [workerMaskData.mask.buffer] : [];
      worker.postMessage({
        requestId,
        maskData: workerMaskData,
        options: workerOptions,
        mapping,
      }, transfer);
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}

function configure({ moduleId = "indy-regions", getShaderChoices = null, syncRegionShaderFromBehavior = null } = {}) {
  painterState.configure({ moduleId, getShaderChoices, syncRegionShaderFromBehavior });
}

function clearCache() {
  painterState.clearImageCache();
  candidateWorkerGeometryCacheKey = null;
}

async function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Could not load scene background: ${src}`));
      img.src = src;
    });
  }

async function ensureImageCache() {
    const scene = canvas?.scene ?? null;
    const sceneId = String(scene?.id ?? "");
    const bgPath = getSceneBackgroundPath(scene);
    if (!scene) return false;

    if (painterState.hasImageCache(sceneId, bgPath)) return true;

    if (!bgPath) {
      const dims = canvas?.dimensions ?? {};
      const width = Math.max(1, Math.round(Number(dims.sceneWidth) || Number(scene.width) || 1));
      const height = Math.max(1, Math.round(Number(dims.sceneHeight) || Number(scene.height) || 1));
      const offscreen = document.createElement("canvas");
      offscreen.width = width;
      offscreen.height = height;
      const ctx = offscreen.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("Could not create analysis canvas.");
      painterState.setImageCache({
        sceneId,
        backgroundPath: "",
        imageData: ctx.getImageData(0, 0, width, height),
        width,
        height,
      });
      return true;
    }

    const img = await loadImage(bgPath);
    const offscreen = document.createElement("canvas");
    offscreen.width = Math.max(1, img.width);
    offscreen.height = Math.max(1, img.height);
    const ctx = offscreen.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Could not create analysis canvas.");
    ctx.drawImage(img, 0, 0);

    painterState.setImageCache({
      sceneId,
      backgroundPath: bgPath,
      imageData: ctx.getImageData(0, 0, offscreen.width, offscreen.height),
      width: offscreen.width,
      height: offscreen.height,
    });
    return true;
  }

function getMaskBounds(maskData) {
    if (!maskData?.mask) return null;
    if (maskData.boundsDirty === true || !maskData.bounds) {
      maskData.bounds = computeMaskBounds(maskData);
      maskData.boundsDirty = false;
    }
    return normalizeMaskBounds(maskData.bounds, maskData.cols, maskData.rows);
  }

function invalidateMaskDerivedData(maskData, { boundsDirty = false } = {}) {
    if (!maskData) return;
    clearMaskDerivedState(maskData);
    if (boundsDirty === true) maskData.boundsDirty = true;
  }

function createPaintDeltaRecorder(session, options = {}) {
    return createPaintDeltaRecorderForSession(session, options);
  }

function finalizePaintDelta(recorder) {
    return finalizePaintDeltaRecorder(recorder);
  }

function applyPaintDelta(session, entry) {
    return applyPaintDeltaEntry(session, entry, {
      invalidateMaskDerivedData: (maskData, options) => invalidateMaskDerivedData(maskData, options),
    });
  }

function smallRadiusDilateMaskData(maskData, radius) {
    const { mask, cols, rows, gridStep } = maskData ?? {};
    const bounds = getMaskBounds(maskData);
    const scanBounds = expandBoundsByRadius(bounds, radius, cols, rows);
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
    if (!dilatedBounds) return emptyDerivedMaskData(maskData);

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

function smallRadiusErodeMaskData(maskData, radius) {
    const { mask, cols, rows, gridStep } = maskData ?? {};
    const bounds = getMaskBounds(maskData);
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
    if (!erodedBounds) return emptyDerivedMaskData(maskData);

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

function erodeMaskData(maskData, radiusCells = 0) {
    const { mask, cols, rows, gridStep } = maskData ?? {};
    const radius = Math.max(0, Math.round(Number(radiusCells) || 0));
    if (!mask || !cols || !rows || !gridStep || radius <= 0) return maskData;
    const bounds = getMaskBounds(maskData);
    if (!bounds) return { mask: new Uint8Array(mask.length), cols, rows, gridStep, bounds: null };
    if (radius <= SMALL_MORPH_RADIUS_CELLS) {
      setMorphTiming(maskData, { distanceCacheHit: false, morphFastPath: true });
      return smallRadiusErodeMaskData(maskData, radius);
    }
    setMorphTiming(maskData, { distanceCacheHit: false, morphFastPath: false });
    const cacheKey = `erode:${bounds.minX},${bounds.minY},${bounds.maxX},${bounds.maxY}`;
    let distanceCache = getDistanceCache(maskData);
    let scanBounds = null;
    let distToEmpty = null;
    if (distanceCache?.key === cacheKey && distanceCache.radius >= radius) {
      scanBounds = distanceCache.scanBounds;
      distToEmpty = distanceCache.dist;
      setMorphTiming(maskData, { distanceCacheHit: true, morphFastPath: false });
    } else {
      setMorphTiming(maskData, { distanceCacheHit: false, morphFastPath: false });
      scanBounds = expandBoundsByRadius(bounds, radius, cols, rows) ?? bounds;
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
      l1DistanceTransform(distToEmpty, width, height);
      setDistanceCache(maskData, { key: cacheKey, mode: "erode", radius, scanBounds, dist: distToEmpty });
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

function dilateMaskData(maskData, radiusCells = 0) {
    const { mask, cols, rows, gridStep } = maskData ?? {};
    const radius = Math.max(0, Math.round(Number(radiusCells) || 0));
    if (!mask || !cols || !rows || !gridStep || radius <= 0) return maskData;
    const bounds = getMaskBounds(maskData);
    if (!bounds) return { mask: new Uint8Array(mask.length), cols, rows, gridStep, bounds: null };
    if (radius <= SMALL_MORPH_RADIUS_CELLS) {
      setMorphTiming(maskData, { distanceCacheHit: false, morphFastPath: true });
      return smallRadiusDilateMaskData(maskData, radius);
    }
    setMorphTiming(maskData, { distanceCacheHit: false, morphFastPath: false });
    const cacheKey = `dilate:${bounds.minX},${bounds.minY},${bounds.maxX},${bounds.maxY}`;
    let distanceCache = getDistanceCache(maskData);
    let scanBounds = null;
    let distToFilled = null;
    if (distanceCache?.key === cacheKey && distanceCache.radius >= radius) {
      scanBounds = distanceCache.scanBounds;
      distToFilled = distanceCache.dist;
      setMorphTiming(maskData, { distanceCacheHit: true, morphFastPath: false });
    } else {
      setMorphTiming(maskData, { distanceCacheHit: false, morphFastPath: false });
      scanBounds = expandBoundsByRadius(bounds, radius, cols, rows) ?? bounds;
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
      l1DistanceTransform(distToFilled, width, height);
      setDistanceCache(maskData, { key: cacheKey, mode: "dilate", radius, scanBounds, dist: distToFilled });
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

function getMaskCandidateCacheKey(maskData, morphKey = "none") {
    const bounds = getMaskBounds(maskData);
    return [
      getMaskRevision(maskData),
      morphKey,
      maskData?.cols ?? 0,
      maskData?.rows ?? 0,
      maskData?.gridStep ?? 0,
      maskOffsetX(maskData),
      maskOffsetY(maskData),
      maskFullCols(maskData),
      maskFullRows(maskData),
      bounds?.minX ?? -1,
      bounds?.minY ?? -1,
      bounds?.maxX ?? -1,
      bounds?.maxY ?? -1,
    ].join(":");
  }

function getCachedMorphMask(maskData, morphKey) {
    const cache = getMorphCache(maskData);
    if (cache?.entries instanceof Map) return cache.entries.get(morphKey) ?? null;
    if (cache?.key === morphKey && cache?.maskData) return cache.maskData;
    return null;
  }

function setCachedMorphMask(maskData, morphKey, candidateMaskData) {
    const existing = getMorphCache(maskData);
    const entries = existing?.entries instanceof Map ? existing.entries : new Map();
    entries.set(morphKey, candidateMaskData);
    if (entries.size > 16) entries.delete(entries.keys().next().value);
    setMorphCache(maskData, { entries });
  }

function candidateFromMaskWithOptions(maskData, options = {}) {
    const totalStart = nowMs();
    const opts = normalizeOptions(options);
    const gridStep = Math.max(1, Number(maskData?.gridStep) || DEFAULT_PAINT_OPTIONS.gridStep);
    const offsetPx = toFiniteNumber(opts.featherShrinkPx, DEFAULT_PAINT_OPTIONS.featherShrinkPx);
    const radiusCells = Math.floor(Math.abs(offsetPx) / gridStep);
    const morphStart = nowMs();
    const morphKey = radiusCells <= 0 ? "none" : `${offsetPx > 0 ? "grow" : "shrink"}:${radiusCells}`;
    let candidateMaskData = maskData;
    let morphCacheHit = false;
    const morphTiming = [];
    if (radiusCells > 0) {
      const cachedMorph = getCachedMorphMask(maskData, morphKey);
      if (cachedMorph) {
        candidateMaskData = cachedMorph;
        morphCacheHit = true;
      } else {
        const passStart = nowMs();
        candidateMaskData = offsetPx > 0
          ? dilateMaskData(maskData, radiusCells)
          : erodeMaskData(maskData, radiusCells);
        morphTiming.push({
          pass: offsetPx > 0 ? "shrink-grow:dilate" : "shrink-grow:erode",
          radiusCells,
          cols: candidateMaskData?.cols ?? 0,
          rows: candidateMaskData?.rows ?? 0,
          ms: roundTimingMs(nowMs() - passStart),
        });
        setCachedMorphMask(maskData, morphKey, candidateMaskData);
      }
    }
    if (candidateMaskData) candidateMaskData.cacheKey = getMaskCandidateCacheKey(maskData, morphKey);
    const morphMs = nowMs() - morphStart;
    const candidate = candidateFromMask(candidateMaskData, opts.smoothing, { fillHoles: opts.fillHoles, borderSmoothType: opts.borderSmoothType });
    let fallbackCandidate = null;
    if (!candidate && offsetPx < 0 && radiusCells > 0) {
      fallbackCandidate = candidateFromMask(maskData, opts.smoothing, { fillHoles: opts.fillHoles, borderSmoothType: opts.borderSmoothType });
    }
    const result = candidate ?? fallbackCandidate;
    debugTiming(painterState.moduleId, "candidate-with-options", {
      gridStep,
      cols: maskData?.cols ?? 0,
      rows: maskData?.rows ?? 0,
      cells: (maskData?.cols ?? 0) * (maskData?.rows ?? 0),
      bounds: getMaskBounds(maskData),
      offsetPx,
      radiusCells,
      morphTiming,
      morphCacheHit,
      distanceCacheHit: getMorphTiming(maskData).distanceCacheHit,
      morphFastPath: getMorphTiming(maskData).morphFastPath,
      morphMs: roundTimingMs(morphMs),
      totalMs: roundTimingMs(nowMs() - totalStart),
      hadCandidate: Boolean(result),
      usedFallback: Boolean(!candidate && fallbackCandidate),
      fillHoles: opts.fillHoles === true,
      borderSmoothType: opts.borderSmoothType,
    });
    return result;
  }

async function candidateFromMaskWithOptionsAsync(maskData, options = {}, { useWorker = false } = {}) {
    const totalStart = nowMs();
    const opts = normalizeOptions(options);
    const gridStep = Math.max(1, Number(maskData?.gridStep) || DEFAULT_PAINT_OPTIONS.gridStep);
    const offsetPx = toFiniteNumber(opts.featherShrinkPx, DEFAULT_PAINT_OPTIONS.featherShrinkPx);
    const radiusCells = Math.floor(Math.abs(offsetPx) / gridStep);
    const morphStart = nowMs();
    const morphKey = radiusCells <= 0 ? "none" : `${offsetPx > 0 ? "grow" : "shrink"}:${radiusCells}`;
    let candidateMaskData = maskData;
    let morphCacheHit = false;
    const morphTiming = [];
    if (radiusCells > 0) {
      const cachedMorph = getCachedMorphMask(maskData, morphKey);
      if (cachedMorph) {
        candidateMaskData = cachedMorph;
        morphCacheHit = true;
      } else {
        const passStart = nowMs();
        candidateMaskData = offsetPx > 0
          ? dilateMaskData(maskData, radiusCells)
          : erodeMaskData(maskData, radiusCells);
        morphTiming.push({
          pass: offsetPx > 0 ? "shrink-grow:dilate" : "shrink-grow:erode",
          radiusCells,
          cols: candidateMaskData?.cols ?? 0,
          rows: candidateMaskData?.rows ?? 0,
          ms: roundTimingMs(nowMs() - passStart),
        });
        setCachedMorphMask(maskData, morphKey, candidateMaskData);
      }
    }
    if (candidateMaskData) candidateMaskData.cacheKey = getMaskCandidateCacheKey(maskData, morphKey);
    const morphMs = nowMs() - morphStart;
    const candidateCells = (candidateMaskData?.cols ?? 0) * (candidateMaskData?.rows ?? 0);
    if (useWorker === true && candidateCells >= CANDIDATE_WORKER_MIN_CELLS) {
      try {
        const workerStart = nowMs();
        const workerResult = await candidateFromMaskWorker(candidateMaskData, opts);
        if (!workerResult) throw new Error("Candidate worker is not available.");
        const candidate = workerResult?.candidate ?? null;
        let fallbackCandidate = null;
        if (!candidate && offsetPx < 0 && radiusCells > 0) {
          maskData.cacheKey = getMaskCandidateCacheKey(maskData, "none");
          const fallbackResult = await candidateFromMaskWorker(maskData, opts);
          if (!fallbackResult) throw new Error("Candidate worker is not available.");
          fallbackCandidate = fallbackResult?.candidate ?? null;
        }
        const result = candidate ?? fallbackCandidate;
        if (result) result.maskData = maskData;
        debugTiming(painterState.moduleId, "candidate-with-options", {
          gridStep,
          cols: maskData?.cols ?? 0,
          rows: maskData?.rows ?? 0,
          cells: (maskData?.cols ?? 0) * (maskData?.rows ?? 0),
          bounds: getMaskBounds(maskData),
          offsetPx,
          radiusCells,
          morphTiming,
          morphCacheHit,
          distanceCacheHit: getMorphTiming(maskData).distanceCacheHit,
          morphFastPath: getMorphTiming(maskData).morphFastPath,
          morphMs: roundTimingMs(morphMs),
          worker: true,
          workerMs: roundTimingMs(nowMs() - workerStart),
          workerTiming: workerResult?.timing ?? null,
          totalMs: roundTimingMs(nowMs() - totalStart),
          hadCandidate: Boolean(result),
          usedFallback: Boolean(!candidate && fallbackCandidate),
          fillHoles: opts.fillHoles === true,
          borderSmoothType: opts.borderSmoothType,
        });
        return result;
      } catch (err) {
        debugTiming(painterState.moduleId, "candidate-worker-fallback", { error: err?.message ?? String(err) });
      }
    }
    return candidateFromMaskWithOptions(maskData, opts);
  }

function candidateFromMask(maskData, smoothing = DEFAULT_PAINT_OPTIONS.smoothing, { fillHoles = false, borderSmoothType = DEFAULT_PAINT_OPTIONS.borderSmoothType } = {}) {
    const totalStart = nowMs();
    const { mask, cols, rows, gridStep } = maskData ?? {};
    if (!mask || !cols || !rows || !gridStep) return null;
    const scanBounds = getMaskBounds(maskData);
    if (!scanBounds) return null;

    let areaMs = 0;
    let componentsMs = 0;
    let boundsMs = 0;
    let traceMs = 0;
    const geometryCache = getGeometryCache(maskData);
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
      setGeometryCache(maskData, geometry);
    }

    const area = geometry.area;
    if (area < 3) return null;

    const imgW = painterState.cachedImgW;
    const imgH = painterState.cachedImgH;
    const dataOffsetX = maskOffsetX(maskData);
    const dataOffsetY = maskOffsetY(maskData);
    const shapes = [];
    let simplifyMs = 0;
    let simplifiedBoundaryPoints = 0;
    const smoothType = normalizeBorderSmoothType(borderSmoothType);
    const smoothingKey = `${smoothType}:${Number(smoothing) || 0}`;
    let simplifiedShapes = geometry.simplifyCache?.get?.(smoothingKey) ?? null;

    if (!simplifiedShapes) {
      simplifiedShapes = [];
      for (const rawShape of geometry.rawShapes) {
        const rawBoundary = rawShape.rawBoundary;
        const simplifyStart = nowMs();
        const simplified = smoothBoundaryPolygon(rawBoundary, smoothing, smoothType);
        simplifyMs += nowMs() - simplifyStart;
        if (simplified.length < 3) continue;
        simplifiedShapes.push({ simplified, area: rawShape.area, isHole: rawShape.isHole === true });
      }
      if (!geometry.simplifyCache) geometry.simplifyCache = new Map();
      geometry.simplifyCache.set(smoothingKey, simplifiedShapes);
    }

    for (const simplifiedShape of simplifiedShapes) {
      if (fillHoles === true && simplifiedShape.isHole === true) continue;
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
      debugTiming(painterState.moduleId, "candidate-from-mask", {
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
        borderSmoothType: smoothType,
        fillHoles: fillHoles === true,
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
    debugTiming(painterState.moduleId, "candidate-from-mask", {
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
      borderSmoothType: smoothType,
      fillHoles: fillHoles === true,
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

function createEmptyMaskData(options = {}) {
    const opts = normalizeOptions(options);
    const gridStep = Math.max(1, Math.round(toFiniteNumber(opts.gridStep, DEFAULT_PAINT_OPTIONS.gridStep)));
    const imgW = painterState.cachedImgW;
    const imgH = painterState.cachedImgH;
    const cols = Math.ceil(imgW / gridStep);
    const rows = Math.ceil(imgH / gridStep);
    return {
      mask: new Uint8Array(cols * rows),
      cols,
      rows,
      gridStep,
    };
  }

function createMaskDataForGridStep(gridStep = DEFAULT_PAINT_OPTIONS.gridStep) {
    return createEmptyMaskData({ gridStep });
  }

function resampleMaskData(source, gridStep = DEFAULT_PAINT_OPTIONS.gridStep) {
    if (!source?.mask || !source.cols || !source.rows || !source.gridStep) return null;
    const target = createMaskDataForGridStep(gridStep);
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

function stampBrushOnMask(maskData, sceneX, sceneY, mode = "add", options = {}, changeRecorder = null) {
    const { mask, cols, rows, gridStep } = maskData ?? {};
    if (!mask || !cols || !rows || !gridStep) return 0;
    const opts = normalizeOptions(options);
    const imgW = painterState.cachedImgW;
    const imgH = painterState.cachedImgH;
    const imgPoint = sceneToImagePoint(sceneX, sceneY, imgW, imgH);
    if (imgPoint.x < 0 || imgPoint.x >= imgW || imgPoint.y < 0 || imgPoint.y >= imgH) return 0;

    const radiusPx = Math.max(0.5, toFiniteNumber(opts.brushSizePx, DEFAULT_PAINT_OPTIONS.brushSizePx) * 0.5);
    const radiusCells = Math.max(1, Math.ceil((radiusPx + (gridStep * 0.5)) / gridStep));
    const centerGX = Math.floor(imgPoint.x / gridStep);
    const centerGY = Math.floor(imgPoint.y / gridStep);
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
    const applyCell = (gx, gy) => {
      if (gx < 0 || gx >= cols || gy < 0 || gy >= rows) return;
      const idx = gy * cols + gx;
      if (op === "subtract" || op === "remove") {
        if (!mask[idx]) return;
        changeRecorder?.(maskData, idx, mask[idx]);
        mask[idx] = 0;
        if (maskData.alphaMask && idx < maskData.alphaMask.length) maskData.alphaMask[idx] = 0;
      } else {
        if (mask[idx]) return;
        changeRecorder?.(maskData, idx, mask[idx]);
        mask[idx] = 1;
        if (maskData.alphaMask && idx < maskData.alphaMask.length) maskData.alphaMask[idx] = 255;
      }
      changed += 1;
      noteChangedCell(gx, gy);
    };

    if (toFiniteNumber(opts.brushSizePx, DEFAULT_PAINT_OPTIONS.brushSizePx) <= gridStep) {
      applyCell(centerGX, centerGY);
    } else {

      for (let gy = centerGY - radiusCells; gy <= centerGY + radiusCells; gy += 1) {
        if (gy < 0 || gy >= rows) continue;
        for (let gx = centerGX - radiusCells; gx <= centerGX + radiusCells; gx += 1) {
          if (gx < 0 || gx >= cols) continue;
          const px = (gx + 0.5) * gridStep;
          const py = (gy + 0.5) * gridStep;
          const dx = Math.max(0, Math.abs(px - imgPoint.x) - (gridStep * 0.5));
          const dy = Math.max(0, Math.abs(py - imgPoint.y) - (gridStep * 0.5));
          if (((dx * dx) + (dy * dy)) > radiusSq) continue;
          applyCell(gx, gy);
          }
      }
    }

    if (changed > 0) {
      setLastChangedBounds(maskData, normalizeMaskBounds({
        minX: changedMinX,
        minY: changedMinY,
        maxX: changedMaxX,
        maxY: changedMaxY,
      }, cols, rows));
      if (op === "subtract" || op === "remove") {
        invalidateMaskDerivedData(maskData, { boundsDirty: true });
      } else {
        maskData.bounds = expandMaskBounds(maskData.bounds, changedMinX, changedMinY, cols, rows);
        maskData.bounds = expandMaskBounds(maskData.bounds, changedMaxX, changedMaxY, cols, rows);
        maskData.boundsDirty = false;
        invalidateMaskDerivedData(maskData);
      }
    }

    return changed;
  }

function applySparseFloodFillToMask(maskData, sceneX, sceneY, mode = "add", options = {}, changeRecorder = null) {
    const { mask, cols, rows, gridStep } = maskData ?? {};
    if (!mask || !cols || !rows || !gridStep) return { changed: 0, visited: 0 };

    const imgW = painterState.cachedImgW;
    const imgH = painterState.cachedImgH;
    const imageData = painterState.cachedImageData;
    if (!imageData || imgW <= 0 || imgH <= 0) return { changed: 0, visited: 0 };

    const opts = normalizeOptions(options);
    const imgPoint = sceneToImagePoint(sceneX, sceneY, imgW, imgH);
    if (imgPoint.x < 0 || imgPoint.x >= imgW || imgPoint.y < 0 || imgPoint.y >= imgH) return { changed: 0, visited: 0 };

    const pixels = imageData.data;
    const seedIdx = (imgPoint.y * imgW + imgPoint.x) * 4;
    const seedR = pixels[seedIdx];
    const seedG = pixels[seedIdx + 1];
    const seedB = pixels[seedIdx + 2];
    const fillColorMode = String(opts.fillColorMode ?? DEFAULT_PAINT_OPTIONS.fillColorMode).trim().toLowerCase() === "hsl"
      ? "hsl"
      : "rgb";
    const seedHsl = fillColorMode === "hsl" ? rgb255ToHsl(seedR, seedG, seedB) : null;
    const seedHue = seedHsl?.h ?? 0;
    const seedSaturation = seedHsl?.s ?? 0;
    const seedLightness = seedHsl?.l ?? 0;
    const hslBias = normalizeHslFillBias(opts.hslFillBias);
    const hueWeight = Math.pow(2, hslBias);
    const lightnessWeight = Math.pow(2, -hslBias);
    const tolSq = Math.max(0, Number(opts.tolerance) || 0) ** 2;
    const bridgeCells = Math.max(0, Math.round(toFiniteNumber(opts.fillBridgePx, DEFAULT_PAINT_OPTIONS.fillBridgePx) / gridStep));
    const offsetX = maskOffsetX(maskData);
    const offsetY = maskOffsetY(maskData);
    const seedGX = Math.floor(imgPoint.x / gridStep) - offsetX;
    const seedGY = Math.floor(imgPoint.y / gridStep) - offsetY;
    if (seedGX < 0 || seedGX >= cols || seedGY < 0 || seedGY >= rows) return { changed: 0, visited: 0 };

    const fullCols = maskFullCols(maskData);
    const fullRows = maskFullRows(maskData);
    const cellCount = cols * rows;
    let matchCache = null;
    let matchMap = null;
    try {
      matchCache = new Uint8Array(cellCount);
    } catch (_err) {
      matchMap = new Map();
    }

    const colorMatches = (gx, gy) => {
      const fullX = gx + offsetX;
      const fullY = gy + offsetY;
      if (fullX < 0 || fullX >= fullCols || fullY < 0 || fullY >= fullRows) return false;
      const localIndex = gy * cols + gx;
      if (matchCache) {
        const cached = matchCache[localIndex];
        if (cached) return cached === 2;
      } else if (matchMap) {
        const cached = matchMap.get(localIndex);
        if (cached !== undefined) return cached === true;
      }
      const px = Math.min(fullX * gridStep, imgW - 1);
      const py = Math.min(fullY * gridStep, imgH - 1);
      const idx = (py * imgW + px) * 4;
      let matches = true;
      if (fillColorMode === "hsl") {
        const r = pixels[idx] / 255;
        const g = pixels[idx + 1] / 255;
        const b = pixels[idx + 2] / 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const l = (max + min) * 0.5;
        let h = 0;
        let s = 0;
        if (max !== min) {
          const d = max - min;
          s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
          if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
          else if (max === g) h = ((b - r) / d + 2) / 6;
          else h = ((r - g) / d + 4) / 6;
        }
        const dhRaw = Math.abs(h - seedHue);
        const dh = Math.min(dhRaw, 1 - dhRaw) * 255;
        const ds = (s - seedSaturation) * 255;
        const dl = (l - seedLightness) * 255;
        matches = ((dh * dh * hueWeight) + (ds * ds) + (dl * dl * lightnessWeight)) <= tolSq;
      } else {
        const dr = pixels[idx] - seedR;
        const dg = pixels[idx + 1] - seedG;
        const db = pixels[idx + 2] - seedB;
        matches = ((dr * dr) + (dg * dg) + (db * db)) <= tolSq;
      }
      if (matchCache) matchCache[localIndex] = matches ? 2 : 1;
      else matchMap?.set(localIndex, matches);
      return matches;
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
        if (maskData.alphaMask && idx < maskData.alphaMask.length) maskData.alphaMask[idx] = 0;
      } else {
        if (mask[idx]) return;
        changeRecorder?.(maskData, idx, mask[idx]);
        mask[idx] = 1;
        if (maskData.alphaMask && idx < maskData.alphaMask.length) maskData.alphaMask[idx] = 255;
      }
      changed += 1;
      noteChangedCell(gx, gy);
    };

    const stackX = [seedGX];
    const stackY = [seedGY];
    const stackGap = bridgeCells > 0 ? [0] : null;
    let visitedBits = null;
    let visitedSet = null;
    let bestGap = null;
    let bestGapBytes = null;
    if (bridgeCells > 0) {
      try {
        bestGapBytes = new Uint8Array(cellCount);
        bestGapBytes.fill(255);
        bestGapBytes[seedGY * cols + seedGX] = 0;
      } catch (_err) {
        bestGap = new Map([[seedGY * cols + seedGX, 0]]);
      }
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
        if (bestGapBytes) {
          const currentBest = bestGapBytes[idx];
          if (currentBest !== 255 && gap >= currentBest) return;
          bestGapBytes[idx] = gap;
        } else {
          const currentBest = bestGap.get(idx);
          if (currentBest !== undefined && gap >= currentBest) return;
          bestGap.set(idx, gap);
        }
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

    if (bridgeCells <= 0) {
      const isVisitedIndex = (idx) => {
        if (visitedBits) return (visitedBits[idx >> 3] & (1 << (idx & 7))) !== 0;
        return visitedSet.has(idx);
      };
      const markVisitedIndex = (idx) => {
        if (visitedBits) visitedBits[idx >> 3] |= 1 << (idx & 7);
        else visitedSet.add(idx);
      };
      const maybePushSeed = (gx, gy) => {
        if (gx < 0 || gx >= cols || gy < 0 || gy >= rows) return;
        const idx = gy * cols + gx;
        if (isVisitedIndex(idx)) return;
        markVisitedIndex(idx);
        stackX.push(gx);
        stackY.push(gy);
      };
      const pushNeighborRuns = (ny, leftX, rightX) => {
        let x = leftX;
        while (x <= rightX) {
          const idx = ny * cols + x;
          if (isVisitedIndex(idx) || !colorMatches(x, ny)) {
            x += 1;
            continue;
          }
          maybePushSeed(x, ny);
          x += 1;
          while (x <= rightX) {
            const nextIdx = ny * cols + x;
            if (isVisitedIndex(nextIdx) || !colorMatches(x, ny)) break;
            x += 1;
          }
        }
      };

      while (stackX.length) {
        const seedX = stackX.pop();
        const y = stackY.pop();
        let left = seedX;
        let right = seedX;
        let idx = y * cols + left;
        visited += 1;
        if (!colorMatches(left, y)) continue;

        while (left > 0) {
          const nextX = left - 1;
          const nextIdx = idx - 1;
          if (isVisitedIndex(nextIdx)) break;
          markVisitedIndex(nextIdx);
          visited += 1;
          if (!colorMatches(nextX, y)) break;
          left = nextX;
          idx = nextIdx;
        }

        idx = y * cols + right;
        while (right < cols - 1) {
          const nextX = right + 1;
          const nextIdx = idx + 1;
          if (isVisitedIndex(nextIdx)) break;
          markVisitedIndex(nextIdx);
          visited += 1;
          if (!colorMatches(nextX, y)) break;
          right = nextX;
          idx = nextIdx;
        }

        for (let x = left; x <= right; x += 1) applyCell(x, y);

        if (y > 0) pushNeighborRuns(y - 1, left, right);
        if (y < rows - 1) pushNeighborRuns(y + 1, left, right);
      }

      if (changed > 0) {
        setLastChangedBounds(maskData, normalizeMaskBounds({
          minX: changedMinX,
          minY: changedMinY,
          maxX: changedMaxX,
          maxY: changedMaxY,
        }, cols, rows));
        if (op === "subtract" || op === "remove") {
          invalidateMaskDerivedData(maskData, { boundsDirty: true });
        } else {
          maskData.bounds = expandMaskBounds(maskData.bounds, changedMinX, changedMinY, cols, rows);
          maskData.bounds = expandMaskBounds(maskData.bounds, changedMaxX, changedMaxY, cols, rows);
          maskData.boundsDirty = false;
          invalidateMaskDerivedData(maskData);
        }
      }

      return { changed, visited };
    }

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
      setLastChangedBounds(maskData, normalizeMaskBounds({
        minX: changedMinX,
        minY: changedMinY,
        maxX: changedMaxX,
        maxY: changedMaxY,
      }, cols, rows));
      if (op === "subtract" || op === "remove") {
        invalidateMaskDerivedData(maskData, { boundsDirty: true });
      } else {
        maskData.bounds = expandMaskBounds(maskData.bounds, changedMinX, changedMinY, cols, rows);
        maskData.bounds = expandMaskBounds(maskData.bounds, changedMaxX, changedMaxY, cols, rows);
        maskData.boundsDirty = false;
        invalidateMaskDerivedData(maskData);
      }
    }

    return { changed, visited };
  }

function fillMaskAlpha(maskData, alpha = 255) {
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

function savePaintMaskFlag(region, session, options = {}) {
    return savePaintMaskFlagToRegion(region, session, {
      moduleId: painterState.moduleId,
      getMaskBounds: (data) => getMaskBounds(data),
      options,
    });
  }

function loadPaintMaskFlag(region, options = {}) {
    return loadPaintMaskFlagFromRegion(region, {
      moduleId: painterState.moduleId,
      options,
    });
  }

function paintPreviewFromMask(maskData, color = DEFAULT_PAINT_OPTIONS.paintColor, opacity = DEFAULT_PAINT_OPTIONS.paintOpacity) {
    return createSessionPaintPreviewFromMask(maskData, {
      color,
      opacity,
      imgW: painterState.cachedImgW,
      imgH: painterState.cachedImgH,
      getMaskBounds: (data) => getMaskBounds(data),
      moduleId: painterState.moduleId,
    });
  }

function updatePaintPreviewDirtyRect(session, dirtyBounds, color = DEFAULT_PAINT_OPTIONS.paintColor, opacity = DEFAULT_PAINT_OPTIONS.paintOpacity) {
    return updatePaintPreviewDirtyRectForSession(session, dirtyBounds, {
      color,
      opacity,
      getMaskBounds: (data) => getMaskBounds(data),
      moduleId: painterState.moduleId,
    });
  }

function setPaintMaskPreview(session) {
    return setPaintMaskPreviewForSession(session, {
      readOptions: (paintSession) => readPaintSessionOptions(paintSession),
      getMaskBounds: (data) => getMaskBounds(data),
      paintPreview: (maskData, color, opacity) => paintPreviewFromMask(maskData, color, opacity),
      updateDirtyRect: (paintSession, dirtyBounds, color, opacity) => updatePaintPreviewDirtyRect(paintSession, dirtyBounds, color, opacity),
      updateStatus: (paintSession) => updatePaintSessionStatus(paintSession),
      moduleId: painterState.moduleId,
    });
  }

function schedulePaintPreviewUpdate(session) {
    if (!session?.isPaintSession) return;
    session.requestPaintPreviewFrame?.(() => {
      setPaintMaskPreview(session);
      updatePaintSessionStatus(session);
    });
  }

function cancelPaintPreviewUpdate(session) {
    session?.cancelPaintPreviewFrame?.();
  }

function maskFromRegionShapes(region, options = {}) {
    return rasterMaskFromRegionShapes(region, {
      options,
      imgW: painterState.cachedImgW,
      imgH: painterState.cachedImgH,
      createEmptyMaskData: (opts) => createEmptyMaskData(opts),
      fillMaskAlpha: (maskData, alpha) => fillMaskAlpha(maskData, alpha),
      invalidateMaskDerivedData: (maskData, opts) => invalidateMaskDerivedData(maskData, opts),
    });
  }

function findTargetRegionShapeAtPoint(session, point) {
    return findTargetRegionShapeAtPointInSources(session, point, {
      moduleId: painterState.moduleId,
      candidateFromMask: (maskData) => candidateFromMask(maskData, 0),
    });
  }

function applyRegionShapeToMask(maskData, shape, mode = "add", changeRecorder = null) {
    return rasterApplyRegionShapeToMask(maskData, shape, {
      mode,
      imgW: painterState.cachedImgW,
      imgH: painterState.cachedImgH,
      changeRecorder,
      invalidateMaskDerivedData: (data, opts) => invalidateMaskDerivedData(data, opts),
    });
  }

function componentTouchesBounds(component, bounds) {
    return Boolean(component
      && bounds
      && (component.minX <= bounds.minX
        || component.minY <= bounds.minY
        || component.maxX >= bounds.maxX
        || component.maxY >= bounds.maxY));
  }

function getCleanupAreaLimitCells(maskData, setting, fallbackPx) {
    const gridStep = Math.max(1, Number(maskData?.gridStep) || 1);
    let areaPx = Number(fallbackPx) || 1;
    try {
      const settingValue = Number(game?.settings?.get?.(painterState.moduleId, setting));
      if (Number.isFinite(settingValue) && settingValue > 0) areaPx = settingValue;
    } catch (_err) {
      // Settings are unavailable in tests and early startup.
    }
    return Math.max(1, Math.ceil(areaPx / (gridStep * gridStep)));
  }

function setComponentRuns(maskData, component, value, recorder = null) {
    const { mask, cols, rows } = maskData ?? {};
    if (!mask || !component?.runs?.length) return { changed: 0, bounds: null };
    const nextValue = value ? 1 : 0;
    let changed = 0;
    let bounds = null;
    for (const run of component.runs) {
      const y = Math.max(0, Math.min(rows - 1, Math.round(Number(run.y))));
      const x1 = Math.max(0, Math.min(cols - 1, Math.round(Number(run.x1))));
      const x2 = Math.max(0, Math.min(cols - 1, Math.round(Number(run.x2))));
      const rowOffset = y * cols;
      let runChanged = false;
      for (let x = x1; x <= x2; x += 1) {
        const idx = rowOffset + x;
        if ((mask[idx] ? 1 : 0) === nextValue) continue;
        recorder?.record?.(maskData, idx, mask[idx]);
        mask[idx] = nextValue;
        if (maskData.alphaMask && idx < maskData.alphaMask.length) maskData.alphaMask[idx] = nextValue ? 255 : 0;
        changed += 1;
        runChanged = true;
      }
      if (runChanged) {
        bounds = expandMaskBounds(bounds, x1, y, cols, rows);
        bounds = expandMaskBounds(bounds, x2, y, cols, rows);
      }
    }
    return { changed, bounds };
  }

function removeTinyIslandsFromMask(maskData, maxCells = 1, recorder = null) {
    const { mask, cols, rows } = maskData ?? {};
    const bounds = getMaskBounds(maskData);
    if (!mask || !cols || !rows || !bounds) return { changed: 0, bounds: null, components: 0 };
    const components = findMaskComponentsScanline(mask, cols, rows, bounds);
    let changed = 0;
    let changedBounds = null;
    let removedComponents = 0;
    for (const component of components) {
      if (component.length > maxCells) continue;
      const result = setComponentRuns(maskData, component, 0, recorder);
      if (!result.changed) continue;
      removedComponents += 1;
      changed += result.changed;
      changedBounds = mergeMaskBounds(changedBounds, result.bounds, cols, rows);
    }
    if (changed > 0) {
      setLastChangedBounds(maskData, changedBounds);
      invalidateMaskDerivedData(maskData, { boundsDirty: true });
    }
    return { changed, bounds: changedBounds, components: removedComponents };
  }

function fillTinyHolesFromMask(maskData, maxCells = 1, recorder = null) {
    const { mask, cols, rows } = maskData ?? {};
    const bounds = getMaskBounds(maskData);
    const scanBounds = expandBoundsByRadius(bounds, 1, cols, rows);
    if (!mask || !cols || !rows || !bounds || !scanBounds) return { changed: 0, bounds: null, components: 0 };
    const tempCols = scanBounds.width;
    const tempRows = scanBounds.height;
    const inverted = new Uint8Array(tempCols * tempRows);
    for (let y = scanBounds.minY; y <= scanBounds.maxY; y += 1) {
      const sourceRow = y * cols;
      const tempRow = (y - scanBounds.minY) * tempCols;
      for (let x = scanBounds.minX; x <= scanBounds.maxX; x += 1) {
        if (!mask[sourceRow + x]) inverted[tempRow + (x - scanBounds.minX)] = 1;
      }
    }

    const tempBounds = { minX: 0, minY: 0, maxX: tempCols - 1, maxY: tempRows - 1, width: tempCols, height: tempRows };
    const holes = findMaskComponentsScanline(inverted, tempCols, tempRows, tempBounds);
    let changed = 0;
    let changedBounds = null;
    let filledComponents = 0;
    for (const component of holes) {
      if (component.length > maxCells || componentTouchesBounds(component, tempBounds)) continue;
      const translated = {
        ...component,
        runs: component.runs.map((run) => ({
          ...run,
          x1: run.x1 + scanBounds.minX,
          x2: run.x2 + scanBounds.minX,
          y: run.y + scanBounds.minY,
        })),
      };
      const result = setComponentRuns(maskData, translated, 1, recorder);
      if (!result.changed) continue;
      filledComponents += 1;
      changed += result.changed;
      changedBounds = mergeMaskBounds(changedBounds, result.bounds, cols, rows);
    }
    if (changed > 0) {
      setLastChangedBounds(maskData, changedBounds);
      maskData.bounds = mergeMaskBounds(maskData.bounds, changedBounds, cols, rows);
      maskData.boundsDirty = false;
      invalidateMaskDerivedData(maskData);
    }
    return { changed, bounds: changedBounds, components: filledComponents };
  }

async function applyPaintMaskCleanup(session, action, notificationKey, notificationFallback, debugData = {}) {
    if (!session?.maskData?.mask || typeof action !== "function") return;
    const recorder = createPaintDeltaRecorder(session, { preferSnapshot: true });
    const start = nowMs();
    const result = action(session.maskData, recorder) ?? { changed: 0, bounds: null, components: 0 };
    if (!result.changed) {
      debugTiming(painterState.moduleId, "paint-mask-cleanup", {
        ...debugData,
        changedCells: 0,
        components: result.components ?? 0,
        bounds: null,
        totalMs: roundTimingMs(nowMs() - start),
      });
      ui?.notifications?.info?.(localizeText(painterState.moduleId, notificationKey, notificationFallback));
      return;
    }
    session.sourceMaskData = resampleMaskData(session.maskData, 1) ?? cloneMaskData(session.maskData);
    session.paintPreviewDirtyBounds = result.bounds;
    pushPaintUndoSnapshot(session, finalizePaintDelta(recorder));
    session.clearRedo();
    setPaintMaskPreview(session);
    await refreshPaintCandidate(session, { forceCandidate: true });
    updatePaintSessionStatus(session);
    debugTiming(painterState.moduleId, "paint-mask-cleanup", {
      ...debugData,
      changedCells: result.changed,
      components: result.components,
      bounds: result.bounds,
      totalMs: roundTimingMs(nowMs() - start),
    });
  }

function removeTinyIslands(session) {
    const maxCells = getCleanupAreaLimitCells(session?.maskData, TINY_ISLAND_AREA_SETTING, DEFAULT_TINY_ISLAND_AREA_PX);
    return applyPaintMaskCleanup(
      session,
      (maskData, recorder) => removeTinyIslandsFromMask(maskData, maxCells, recorder),
      "Notifications.NoTinyIslands",
      "Indy Regions | No tiny islands found.",
      { action: "remove-tiny-islands", maxCells },
    );
  }

function removeTinyHoles(session) {
    const maxCells = getCleanupAreaLimitCells(session?.maskData, TINY_HOLE_AREA_SETTING, DEFAULT_TINY_HOLE_AREA_PX);
    return applyPaintMaskCleanup(
      session,
      (maskData, recorder) => fillTinyHolesFromMask(maskData, maxCells, recorder),
      "Notifications.NoTinyHoles",
      "Indy Regions | No tiny holes found.",
      { action: "remove-tiny-holes", maxCells },
    );
  }

function applyFillToMask(maskData, sceneX, sceneY, mode = "add", options = {}, { buildCandidate = true, changeRecorder = null } = {}) {
    const { mask, cols, rows, gridStep } = maskData ?? {};
    if (!mask || !cols || !rows || !gridStep) return { changed: 0, candidate: null };
    const opts = normalizeOptions(options);
    const { changed, visited } = applySparseFloodFillToMask(maskData, sceneX, sceneY, mode, opts, changeRecorder);
    if (!changed) return { changed: 0, candidate: null, visited };
    if (!buildCandidate) return { changed, candidate: null, visited };
    const candidate = candidateFromMaskWithOptions(maskData, opts);
    if (candidate) candidate.maskData = maskData;
    return { changed, candidate, visited };
  }

function readPaintSessionOptions(session) {
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
      opts.hslFillBias = normalizeHslFillBias(readNumber("hslFillBias", opts.hslFillBias), opts.hslFillBias);
      const fillColorModeInput = root.querySelector('[name="fillColorMode"]');
      const fillColorMode = String(fillColorModeInput?.value ?? opts.fillColorMode ?? DEFAULT_PAINT_OPTIONS.fillColorMode).trim().toLowerCase();
      opts.fillColorMode = fillColorMode === "hsl" ? "hsl" : "rgb";
      opts.smoothing = readNumber("smoothing", opts.smoothing);
      const borderSmoothTypeInput = root.querySelector('[name="borderSmoothType"]');
      if (borderSmoothTypeInput instanceof HTMLSelectElement) {
        opts.borderSmoothType = normalizeBorderSmoothType(borderSmoothTypeInput.value, opts.borderSmoothType);
      }
      opts.featherShrinkPx = readNumber("featherShrinkPx", opts.featherShrinkPx);
      opts.paintOpacity = normalizePaintOpacity(readNumber("paintOpacity", opts.paintOpacity), opts.paintOpacity);
      opts.dialogScale = normalizeDialogScale(readNumber("dialogScale", opts.dialogScale), opts.dialogScale);
      opts.paintBorderThickness = clamp(readNumber("paintBorderThickness", opts.paintBorderThickness), 0, 4);
      const debugInput = root.querySelector('[name="debug"]');
      if (debugInput instanceof HTMLInputElement) opts.debug = debugInput.checked === true;
      if (session?.isPaintSession === true) opts.debug = true;
      const fillHolesInput = root.querySelector('[name="fillHoles"]');
      if (fillHolesInput instanceof HTMLInputElement) opts.fillHoles = fillHolesInput.checked === true;
      const colorInput = root.querySelector('[name="paintColor"]');
      if (colorInput instanceof HTMLInputElement) {
        opts.paintColor = normalizeHexColor(colorInput.value, getStoredPaintColor(painterState.moduleId));
        colorInput.value = opts.paintColor;
        setStoredPaintColor(painterState.moduleId, opts.paintColor);
      }
    }
    setStoredPaintOptions(painterState.moduleId, opts);
    session.options = opts;
    return opts;
  }

function updatePaintSessionStatus(session) {
    if (!session?.root) return;
    const status = session.root.querySelector("[data-paint-status]");
    const undoButton = session.root.querySelector("[data-paint-action='undo']");
    const redoButton = session.root.querySelector("[data-paint-action='redo']");
    if (status) {
      const vertices = Number(session?.candidate?.vertexCount ?? 0);
      const area = Number(session?.candidate?.area ?? 0);
      status.textContent = vertices > 0
        ? `${vertices} vertices, ${area} painted cells`
        : "Paint on the canvas to add to the region. Shift-left mouse subtracts.";
    }
    if (undoButton instanceof HTMLButtonElement) undoButton.disabled = session?.canUndo !== true;
    if (redoButton instanceof HTMLButtonElement) redoButton.disabled = session?.canRedo !== true;
  }

function syncDialogInputsFromOptions(session) {
    const root = session?.root;
    if (!(root instanceof Element)) return;
    const opts = normalizeOptions(session.options ?? {});
    for (const [name, value] of Object.entries({
      tolerance: opts.tolerance,
      gridStep: opts.gridStep,
      fillBridgePx: opts.fillBridgePx,
      hslFillBias: opts.hslFillBias,
      smoothing: opts.smoothing,
      borderSmoothType: opts.borderSmoothType,
      paintOpacity: opts.paintOpacity,
      dialogScale: opts.dialogScale,
      paintBorderThickness: opts.paintBorderThickness,
      featherShrinkPx: opts.featherShrinkPx,
    })) {
      const inputs = root.querySelectorAll(`[name="${name}"]`);
      for (const input of inputs) {
        if (input instanceof HTMLInputElement || input instanceof HTMLSelectElement) input.value = String(value);
      }
    }
    const fillHolesInput = root.querySelector('[name="fillHoles"]');
    if (fillHolesInput instanceof HTMLInputElement) fillHolesInput.checked = opts.fillHoles === true;
  }

function drawSessionDebug(session) {
    return drawSessionDebugForSession(session, {
      imgW: painterState.cachedImgW,
      imgH: painterState.cachedImgH,
    });
  }

async function setTargetRegionShaderSuppressed(session, suppressed) {
    return setTargetRegionShaderSuppressedForSession(session, suppressed, {
      syncRegionShaderFromBehavior: painterState.syncRegionShaderFromBehavior,
    });
  }

async function refreshPaintCandidate(session, { forceCandidate = false, skipPreviewIfClean = false } = {}) {
    if (!session?.maskData) return;
    const refreshId = (session.candidateRefreshId ?? 0) + 1;
    session.candidateRefreshId = refreshId;
    const totalStart = nowMs();
    const opts = readPaintSessionOptions(session);
    const borderThickness = clamp(toFiniteNumber(opts.paintBorderThickness, DEFAULT_PAINT_OPTIONS.paintBorderThickness), 0, 4);
    if (session.isPaintSession === true && borderThickness <= 0 && forceCandidate !== true) {
      session.candidate = null;
      const previewDirty = Boolean(session.paintPreviewDirtyBounds) || !session.previewSprite;
      const previewStart = nowMs();
      if (!skipPreviewIfClean || previewDirty) setPaintMaskPreview(session);
      const previewMs = nowMs() - previewStart;
      const debugStart = nowMs();
      drawSessionDebug(session);
      const debugMs = nowMs() - debugStart;
      updatePaintSessionStatus(session);
      debugTiming(painterState.moduleId, "refresh-paint-candidate", {
        mode: "paint",
        gridStep: session.maskData?.gridStep ?? 0,
        cols: session.maskData?.cols ?? 0,
        rows: session.maskData?.rows ?? 0,
        cells: (session.maskData?.cols ?? 0) * (session.maskData?.rows ?? 0),
        candidateSkipped: true,
        borderThickness,
        previewMs: roundTimingMs(previewMs),
        previewSkipped: skipPreviewIfClean && !previewDirty,
        debugMs: roundTimingMs(debugMs),
        totalMs: roundTimingMs(nowMs() - totalStart),
        hadCandidate: false,
      });
      return;
    }
    const candidateStart = nowMs();
    const initialBorderThickness = clamp(toFiniteNumber(opts.paintBorderThickness, DEFAULT_PAINT_OPTIONS.paintBorderThickness), 0, 4);
    const nextCandidate = initialBorderThickness > 0
      ? await candidateFromMaskWithOptionsAsync(session.maskData, opts, { useWorker: session.isPaintSession === true })
      : null;
    if (session.candidateRefreshId !== refreshId || session.closed === true) return;
    session.candidate = nextCandidate;
    const candidateMs = nowMs() - candidateStart;
    if (session.candidate) session.candidate.maskData = session.maskData;
    const previewDirty = Boolean(session.paintPreviewDirtyBounds) || !session.previewSprite;
    const previewStart = nowMs();
    if (!skipPreviewIfClean || previewDirty) setPaintMaskPreview(session);
    const previewMs = nowMs() - previewStart;
    const debugStart = nowMs();
    drawSessionDebug(session);
    const debugMs = nowMs() - debugStart;
    updatePaintSessionStatus(session);
    debugTiming(painterState.moduleId, "refresh-paint-candidate", {
      mode: "paint",
      gridStep: session.maskData?.gridStep ?? 0,
      cols: session.maskData?.cols ?? 0,
      rows: session.maskData?.rows ?? 0,
      cells: (session.maskData?.cols ?? 0) * (session.maskData?.rows ?? 0),
      candidateMs: roundTimingMs(candidateMs),
      previewMs: roundTimingMs(previewMs),
      previewSkipped: skipPreviewIfClean && !previewDirty,
      debugMs: roundTimingMs(debugMs),
      totalMs: roundTimingMs(nowMs() - totalStart),
      hadCandidate: Boolean(session.candidate),
    });
  }

function refreshPaintCandidateAfterStroke(session) {
    if (!session?.maskData) return;
    setPaintMaskPreview(session);
    updatePaintSessionStatus(session);
    if (session.paintRefreshTimer) clearTimeout(session.paintRefreshTimer);
    session.paintRefreshTimer = setTimeout(() => {
      session.paintRefreshTimer = null;
      void refreshPaintCandidate(session, { forceCandidate: true, skipPreviewIfClean: true });
    }, 10);
  }

function drawPaintBrush(session, point, mode = null, options = null) {
    return drawPaintBrushForSession(session, point, mode, options ?? readPaintSessionOptions(session));
  }

function stampPaintSession(session, point, mode, options = null) {
    return stampPaintSessionOperation(session, point, mode, options, paintOperationCallbacks());
  }

async function floodFillPaintSession(session, point, subtract = false) {
    return floodFillPaintSessionOperation(session, point, subtract, paintOperationCallbacks());
  }

async function paintTargetShapeSession(session, point, subtract = false) {
    return paintTargetShapeSessionOperation(session, point, subtract, paintOperationCallbacks());
  }

function beginPaintStroke(session, point, subtract = false, forceHardPaint = false) {
    return beginPaintStrokeOperation(session, point, subtract, forceHardPaint, paintOperationCallbacks());
  }

function continuePaintStroke(session, point, subtract = false, forceHardPaint = false) {
    return continuePaintStrokeOperation(session, point, subtract, forceHardPaint, paintOperationCallbacks());
  }

function paintOperationCallbacks() {
    return {
      moduleId: painterState.moduleId,
      readOptions: (paintSession) => readPaintSessionOptions(paintSession),
      stampBrushOnMask: (maskData, x, y, mode, options, recorder) => stampBrushOnMask(maskData, x, y, mode, options, recorder),
      schedulePreviewUpdate: (paintSession) => schedulePaintPreviewUpdate(paintSession),
      updatePreview: (paintSession) => setPaintMaskPreview(paintSession),
      refreshCandidate: (paintSession, options) => refreshPaintCandidate(paintSession, options),
      createDeltaRecorder: (paintSession, options) => createPaintDeltaRecorder(paintSession, options),
      finalizeDelta: (recorder) => finalizePaintDelta(recorder),
      pushUndo: (paintSession, snapshot) => pushPaintUndoSnapshot(paintSession, snapshot),
      applyFillToMask: (maskData, x, y, mode, options, fillOptions) => applyFillToMask(maskData, x, y, mode, options, fillOptions),
      getMaskBounds: (maskData) => getMaskBounds(maskData),
      findTargetShape: (paintSession, point) => findTargetRegionShapeAtPoint(paintSession, point),
      applyRegionShapeToMask: (maskData, shape, mode, recorder) => applyRegionShapeToMask(maskData, shape, mode, recorder),
      drawBrush: (paintSession, point, mode, options) => drawPaintBrush(paintSession, point, mode, options),
      stamp: (paintSession, point, mode, options) => stampPaintSession(paintSession, point, mode, options),
    };
  }

function finishPaintStroke(session) {
    finishPaintStrokeOperation(session, {
      moduleId: painterState.moduleId,
      finalizeDelta: (recorder) => finalizePaintDelta(recorder),
      pushUndo: (paintSession, snapshot) => pushPaintUndoSnapshot(paintSession, snapshot),
      cancelPreviewUpdate: (paintSession) => cancelPaintPreviewUpdate(paintSession),
      refreshCandidate: (paintSession) => refreshPaintCandidateAfterStroke(paintSession),
    });
  }

function pushPaintUndoSnapshot(session, snapshot = null) {
    pushPaintUndoSnapshotEntry(session, snapshot);
  }

function undoPaintSession(session) {
    undoPaintSessionEntry(session, historyCallbacks());
  }

function redoPaintSession(session) {
    redoPaintSessionEntry(session, historyCallbacks());
  }

function historyCallbacks() {
    return {
      applyPaintDelta: (paintSession, entry) => applyPaintDelta(paintSession, entry),
      resampleMaskData: (maskData, gridStep) => resampleMaskData(maskData, gridStep),
      syncDialogInputs: (paintSession) => syncDialogInputsFromOptions(paintSession),
      refreshCandidate: (paintSession) => refreshPaintCandidate(paintSession),
      updateStatus: (paintSession) => updatePaintSessionStatus(paintSession),
    };
  }

async function resetPaintMaskResolution(session) {
    const totalStart = nowMs();
    const opts = readPaintSessionOptions(session);
    const previous = session?.maskData;
    const source = session?.sourceMaskData ?? previous;
    if (previous?.mask?.length && previous.gridStep && previous.gridStep !== opts.gridStep) {
      const resampleStart = nowMs();
      const next = resampleMaskData(source, opts.gridStep)
        ?? createEmptyMaskData(opts);
      const resampleMs = nowMs() - resampleStart;
      session.maskData = next;
      if (!session.sourceMaskData) session.sourceMaskData = resampleMaskData(next, 1) ?? cloneMaskData(next);
      await refreshPaintCandidate(session);
      debugTiming(painterState.moduleId, "reset-paint-mask-resolution", {
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
      maskData = maskFromRegionShapes({
        shapes: candidateShapesToRegionData(session.candidate),
      }, opts);
    }
    if (!maskData && session?.targetRegion) {
      maskData = maskFromRegionShapes(session.targetRegion, opts);
    }
    session.maskData = maskData ?? createEmptyMaskData(opts);
    session.sourceMaskData = resampleMaskData(session.maskData, 1) ?? cloneMaskData(session.maskData);
    await refreshPaintCandidate(session);
    debugTiming(painterState.moduleId, "reset-paint-mask-resolution", {
      fromGridStep: previous?.gridStep ?? 0,
      toGridStep: opts.gridStep,
      fromCells: (previous?.cols ?? 0) * (previous?.rows ?? 0),
      toCells: (session.maskData?.cols ?? 0) * (session.maskData?.rows ?? 0),
      rebuiltFromShapes: Boolean(maskData),
      totalMs: roundTimingMs(nowMs() - totalStart),
    });
  }

function endSession({ notify = false, keepRegion = false, closeDialog = true } = {}) {
    const session = painterState.activeSession;
    if (!session) return false;
    session.destroy({
      closeDialog,
      destroyPreviewSprite,
      destroyGraphics,
      restoreShader: (paintSession) => {
        void setTargetRegionShaderSuppressed(paintSession, false);
      },
    });
    painterState.clearActiveSession(session);
    if (notify) ui?.notifications?.info?.("Indy Regions | Region painting cancelled.");
    return true;
  }

async function renderPaintSessionDialog(session) {
    return renderPaintSessionDialogController(session, {
      moduleId: painterState.moduleId,
      getActiveSession: () => painterState.activeSession,
      readOptions: (paintSession) => readPaintSessionOptions(paintSession),
      refreshCandidate: (paintSession, options) => refreshPaintCandidate(paintSession, options),
      resetMaskResolution: (paintSession) => resetPaintMaskResolution(paintSession),
      drawBrush: (paintSession, point, mode, options) => drawPaintBrush(paintSession, point, mode, options),
      updateStatus: (paintSession) => updatePaintSessionStatus(paintSession),
      undo: (paintSession) => undoPaintSession(paintSession),
      redo: (paintSession) => redoPaintSession(paintSession),
      removeTinyIslands: (paintSession) => removeTinyIslands(paintSession),
      removeTinyHoles: (paintSession) => removeTinyHoles(paintSession),
      saveMaskFlag: async (region, paintSession, options) => {
        await savePaintMaskFlag(region, paintSession, options);
      },
      endSession: (options) => endSession(options),
      candidateShapesToRegionData,
      buildDocumentAppearance: (options) => buildPaintRegionDocumentAppearance(options),
      paintRegionDefaultName: PAINT_REGION_DEFAULT_NAME,
    });
  }

function previewFromMask(maskData) {
    const { mask, cols, rows, gridStep } = maskData ?? {};
    if (!mask || !cols || !rows || !gridStep) return null;
    const imgW = painterState.cachedImgW;
    const imgH = painterState.cachedImgH;
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

function cancelPaintSession({ notify = true } = {}) {
    if (painterState.activeSession) {
      return endSession({ notify });
    }
    return false;
  }

async function startPaintToCreate(options = {}) {
    if (!painterState.beginStart()) return false;
    try {
    if (!game?.user?.isGM) {
      ui?.notifications?.warn?.(localizeText(painterState.moduleId, "Notifications.GmOnlyPainting", "Indy Regions | Region painting is GM-only."));
      return false;
    }
    if (!canvas?.stage) {
      ui?.notifications?.warn?.(localizeText(painterState.moduleId, "Notifications.CanvasNotReady", "Indy Regions | Canvas is not ready."));
      return false;
    }
    cancelPaintSession();
    if (!await ensureImageCache()) {
      ui?.notifications?.warn?.(localizeText(painterState.moduleId, "Notifications.SceneNotReadyForPainting", "Indy Regions | Canvas scene is not ready for region painting."));
      return false;
    }

    const editRegion = options?.editRegion?.document ?? options?.editRegion ?? null;
    const storedOptions = getStoredPaintOptions(painterState.moduleId);
    const session = new PaintSession({
      options: normalizeOptions({
        ...storedOptions,
        paintColor: storedOptions.paintColor ?? getStoredPaintColor(painterState.moduleId),
        ...options,
      }),
      targetRegion: editRegion,
    });

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
      session.addCleanup?.(() => {
        session.restoreTargetRegionVisibility?.();
        session.restoreTargetRegionVisibility = null;
      });
      await setTargetRegionShaderSuppressed(session, true);
    }

    const opts = normalizeOptions(session.options);
    const storedPaintMask = editRegion ? loadPaintMaskFlag(editRegion, opts) : null;
    if (storedPaintMask) {
      session.options = normalizeOptions({
        ...session.options,
        paintColor: storedPaintMask.color,
        gridStep: storedPaintMask.maskData.gridStep,
      });
      session.maskData = storedPaintMask.maskData;
      session.sourceMaskData = resampleMaskData(session.maskData, 1) ?? cloneMaskData(session.maskData);
    } else {
      session.maskData = editRegion
        ? (maskFromRegionShapes(editRegion, opts) ?? createEmptyMaskData(opts))
        : createEmptyMaskData(opts);
      session.sourceMaskData = resampleMaskData(session.maskData, 1) ?? cloneMaskData(session.maskData);
    }
    const initialBorderThickness = clamp(toFiniteNumber(opts.paintBorderThickness, DEFAULT_PAINT_OPTIONS.paintBorderThickness), 0, 4);
    session.candidate = initialBorderThickness > 0
      ? candidateFromMaskWithOptions(session.maskData, opts)
      : null;
    if (session.candidate) session.candidate.maskData = session.maskData;
    installPaintInputHandlers(session, {
      moduleId: painterState.moduleId,
      getActiveSession: () => painterState.activeSession,
      readOptions: (paintSession) => readPaintSessionOptions(paintSession),
      drawBrush: (paintSession, point, mode, options) => drawPaintBrush(paintSession, point, mode, options),
      beginStroke: (paintSession, point, subtract, forceHardPaint) => beginPaintStroke(paintSession, point, subtract, forceHardPaint),
      continueStroke: (paintSession, point, subtract, forceHardPaint) => continuePaintStroke(paintSession, point, subtract, forceHardPaint),
      finishStroke: (paintSession) => finishPaintStroke(paintSession),
      floodFill: (paintSession, point, subtract) => floodFillPaintSession(paintSession, point, subtract),
      paintTargetShape: (paintSession, point, subtract) => paintTargetShapeSession(paintSession, point, subtract),
      undo: (paintSession) => undoPaintSession(paintSession),
      redo: (paintSession) => redoPaintSession(paintSession),
    });
    session.restoreRegionLayerInteraction = suppressRegionLayerInteraction();
    session.restoreCanvasDragSelection = suppressCanvasDragSelection();
    session.addCleanup?.(() => {
      session.restoreRegionLayerInteraction?.();
      session.restoreRegionLayerInteraction = null;
    });
    session.addCleanup?.(() => {
      session.restoreCanvasDragSelection?.();
      session.restoreCanvasDragSelection = null;
    });

    painterState.setActiveSession(session);
    session.attachListeners();
    void renderPaintSessionDialog(session).catch((err) => {
      console.error("Indy Regions | Failed to render paint dialog", err);
      ui?.notifications?.error?.("Indy Regions | Failed to render paint dialog.");
      endSession({ notify: false });
    });
    if (session.candidate || getMaskBounds(session.maskData)) {
      setPaintMaskPreview(session);
      drawSessionDebug(session);
      updatePaintSessionStatus(session);
    }
    ui?.notifications?.info?.(editRegion
      ? localizeText(painterState.moduleId, "Notifications.PaintingSelectedRegion", "Indy Regions | Painting selected Region. Left mouse adds, Shift-left subtracts.")
      : localizeText(painterState.moduleId, "Notifications.PaintRegion", "Indy Regions | Paint a Region. Left mouse adds, Shift-left subtracts."));
    return true;
  } finally {
      painterState.endStart();
    }
  }

export class RegionPainter {
  static configure(options = {}) {
    return configure(options);
  }

  static clearCache() {
    return clearCache();
  }

  static candidateFromMask(maskData, smoothing = DEFAULT_PAINT_OPTIONS.smoothing) {
    return candidateFromMask(maskData, smoothing);
  }

  static paintPreviewFromMask(maskData, color = DEFAULT_PAINT_OPTIONS.paintColor, opacity = DEFAULT_PAINT_OPTIONS.paintOpacity) {
    return paintPreviewFromMask(maskData, color, opacity);
  }

  static previewFromMask(maskData) {
    return previewFromMask(maskData);
  }

  static cancelPaintSession(options = {}) {
    return cancelPaintSession(options);
  }

  static startPaintToCreate(options = {}) {
    return startPaintToCreate(options);
  }
}
