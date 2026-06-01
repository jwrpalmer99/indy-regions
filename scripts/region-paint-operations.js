import { DEFAULT_WATER_OPTIONS } from "./region-painter-constants.js";
import { mergeMaskBounds } from "./region-painter-mask.js";
import { getLastChangedBounds } from "./region-painter-mask-state.js";
import {
  debugTiming,
  localizeText,
  toFiniteNumber,
} from "./region-painter-utils.js";

export function stampPaintSession(session, point, mode, options = null, {
  readOptions = null,
  stampBrushOnMask = null,
  schedulePreviewUpdate = null,
  refreshCandidate = null,
} = {}) {
  if (!session?.maskData || !point) return 0;
  const opts = options ?? readOptions?.(session);
  const record = session.paintDeltaRecorder?.record?.bind(session.paintDeltaRecorder) ?? null;
  const changed = stampBrushOnMask?.(session.maskData, point.x, point.y, mode, opts, record) ?? 0;
  const changedBounds = getLastChangedBounds(session.maskData);
  if (changed && session.sourceMaskData && session.sourceMaskData !== session.maskData) {
    stampBrushOnMask?.(session.sourceMaskData, point.x, point.y, mode, {
      ...opts,
      gridStep: session.sourceMaskData.gridStep,
    }, record);
  }
  if (!changed) return 0;
  session.paintPreviewDirtyBounds = mergeMaskBounds(session.paintPreviewDirtyBounds, changedBounds, session.maskData.cols, session.maskData.rows);
  session.markStrokeChanged(changed);
  if (session.paintRefreshTimer) return changed;
  if (session.isPaintSession === true) {
    schedulePreviewUpdate?.(session);
    return changed;
  }
  session.paintRefreshTimer = setTimeout(() => {
    session.paintRefreshTimer = null;
    void refreshCandidate?.(session);
  }, 10);
  return changed;
}

export async function floodFillPaintSession(session, point, subtract = false, {
  moduleId = "indy-regions",
  readOptions = null,
  createDeltaRecorder = null,
  finalizeDelta = null,
  pushUndo = null,
  applyFillToMask = null,
  updatePreview = null,
  refreshCandidate = null,
  getMaskBounds = null,
} = {}) {
  if (!session?.maskData || !point || session.closed === true) return 0;
  const opts = {
    ...readOptions?.(session),
    fillColorMode: "hsl",
    requireWaterLikeSeed: false,
    requireWaterLikeFill: false,
  };
  const recorder = createDeltaRecorder?.(session);
  const record = recorder?.snapshotOnly === true ? null : (recorder?.record?.bind(recorder) ?? null);
  const mode = subtract === true ? "subtract" : "add";
  const result = applyFillToMask?.(session.maskData, point.x, point.y, mode, opts, { buildCandidate: false, changeRecorder: record }) ?? { changed: 0 };
  const changedBounds = getLastChangedBounds(session.maskData);
  if (result.changed && session.sourceMaskData && session.sourceMaskData !== session.maskData) {
    applyFillToMask?.(session.sourceMaskData, point.x, point.y, mode, {
      ...opts,
      gridStep: session.sourceMaskData.gridStep,
    }, { buildCandidate: false, changeRecorder: record });
  }
  if (!result.changed) return 0;
  pushUndo?.(session, finalizeDelta?.(recorder));
  session.clearRedo();
  session.paintPreviewDirtyBounds = mergeMaskBounds(session.paintPreviewDirtyBounds, changedBounds, session.maskData.cols, session.maskData.rows);
  updatePreview?.(session);
  await refreshCandidate?.(session, { skipPreviewIfClean: true });
  debugTiming(moduleId, "paint-hsl-flood-fill", {
    mode,
    changedCells: result.changed,
    visitedCells: result.visited ?? 0,
    tolerance: opts.tolerance,
    hslFillBias: opts.hslFillBias,
    gridStep: session.maskData?.gridStep ?? 0,
    bounds: getMaskBounds?.(session.maskData),
  });
  return result.changed;
}

export async function paintTargetShapeSession(session, point, subtract = false, {
  moduleId = "indy-regions",
  findTargetShape = null,
  createDeltaRecorder = null,
  finalizeDelta = null,
  pushUndo = null,
  applyRegionShapeToMask = null,
  updatePreview = null,
  refreshCandidate = null,
  getMaskBounds = null,
} = {}) {
  if (!session?.maskData || !point || session.closed === true) return 0;
  const shape = findTargetShape?.(session, point);
  if (!shape) {
    ui?.notifications?.warn?.(localizeText(moduleId, "Notifications.NoSourceShape", "Indy Regions | No source region shape under the cursor."));
    return 0;
  }
  const recorder = createDeltaRecorder?.(session);
  const record = recorder?.record?.bind(recorder) ?? null;
  const mode = subtract === true ? "subtract" : "add";
  const changed = applyRegionShapeToMask?.(session.maskData, shape, mode, record) ?? 0;
  const changedBounds = getLastChangedBounds(session.maskData);
  if (changed && session.sourceMaskData && session.sourceMaskData !== session.maskData) {
    applyRegionShapeToMask?.(session.sourceMaskData, shape, mode, record);
  }
  if (!changed) return 0;
  pushUndo?.(session, finalizeDelta?.(recorder));
  session.clearRedo();
  session.paintPreviewDirtyBounds = mergeMaskBounds(session.paintPreviewDirtyBounds, changedBounds, session.maskData.cols, session.maskData.rows);
  updatePreview?.(session);
  await refreshCandidate?.(session, { skipPreviewIfClean: true });
  debugTiming(moduleId, "paint-region-shape", {
    mode,
    changedCells: changed,
    gridStep: session.maskData?.gridStep ?? 0,
    bounds: getMaskBounds?.(session.maskData),
  });
  return changed;
}

export function beginPaintStroke(session, point, subtract = false, forceHardPaint = false, {
  readOptions = null,
  drawBrush = null,
  createDeltaRecorder = null,
  stamp = null,
} = {}) {
  if (!point || session?.closed === true) return;
  const mode = subtract === true ? "subtract" : "add";
  const paintOpts = readOptions?.(session);
  paintOpts.forceHardPaint = forceHardPaint === true;
  drawBrush?.(session, point, mode, paintOpts);
  const deltaRecorder = createDeltaRecorder?.(session);
  session.beginStroke({ point, mode, deltaRecorder });
  stamp?.(session, point, mode, paintOpts);
}

export function continuePaintStroke(session, point, subtract = false, forceHardPaint = false, {
  readOptions = null,
  drawBrush = null,
  stamp = null,
} = {}) {
  if (!point || session?.closed === true) return;
  const mode = subtract === true ? "subtract" : (session.paintMode ?? "add");
  const paintOpts = readOptions?.(session);
  paintOpts.forceHardPaint = forceHardPaint === true;
  drawBrush?.(session, point, mode, paintOpts);
  if (!session?.painting) return;
  const brushSize = Math.max(1, toFiniteNumber(paintOpts.brushSizePx, DEFAULT_WATER_OPTIONS.brushSizePx));
  const spacing = Math.max(brushSize * 0.35, brushSize * 0.8);
  const last = session.continueStroke(point) ?? point;
  const dx = point.x - last.x;
  const dy = point.y - last.y;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / spacing));
  let changed = 0;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    changed += stamp?.(session, {
      x: last.x + (dx * t),
      y: last.y + (dy * t),
    }, session.paintMode, paintOpts) ?? 0;
  }
  return changed;
}
