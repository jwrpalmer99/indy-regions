import { DEFAULT_PAINT_OPTIONS } from "./region-painter-constants.js";
import {
  getPreviewLayer,
  getSceneImageMapping,
} from "./region-painter-foundry.js";
import { pointsBounds } from "./region-painter-geometry.js";
import {
  createPaintPreviewFromMask,
  destroyGraphics,
  destroyPreviewSprite,
  updatePaintPreviewDirtyRect,
} from "./region-painter-preview.js";
import {
  normalizeOptions,
  normalizePaintOpacity,
} from "./region-painter-options.js";
import {
  clamp,
  debugTiming,
  nowMs,
  roundTimingMs,
  toFiniteNumber,
} from "./region-painter-utils.js";

export function paintPreviewFromMask(maskData, {
  color = DEFAULT_PAINT_OPTIONS.paintColor,
  opacity = DEFAULT_PAINT_OPTIONS.paintOpacity,
  imgW = 0,
  imgH = 0,
  getMaskBounds = null,
  moduleId = "indy-regions",
} = {}) {
  return createPaintPreviewFromMask(maskData, {
    color,
    opacity,
    imgW,
    imgH,
    getMaskBounds,
    moduleId,
  });
}

export function updatePaintPreviewDirtyRectForSession(session, dirtyBounds, {
  color = DEFAULT_PAINT_OPTIONS.paintColor,
  opacity = DEFAULT_PAINT_OPTIONS.paintOpacity,
  getMaskBounds = null,
  moduleId = "indy-regions",
} = {}) {
  return updatePaintPreviewDirtyRect(session, dirtyBounds, {
    color,
    opacity,
    getMaskBounds,
    moduleId,
  });
}

export function setPaintMaskPreview(session, {
  readOptions = null,
  getMaskBounds = null,
  paintPreview = null,
  updateDirtyRect = null,
  updateStatus = null,
  moduleId = "indy-regions",
} = {}) {
  if (!session?.isPaintSession) return;
  const totalStart = nowMs();
  const opts = readOptions?.(session) ?? normalizeOptions(session.options ?? {});
  const dirtyBounds = session.paintPreviewDirtyBounds;
  session.paintPreviewDirtyBounds = null;
  if (session.previewSprite) {
    session.previewSprite.alpha = normalizePaintOpacity(opts.paintOpacity);
    session.previewSprite._indyRegionsPreviewOpacity = normalizePaintOpacity(opts.paintOpacity);
  }
  if (dirtyBounds && updateDirtyRect?.(session, dirtyBounds, opts.paintColor, opts.paintOpacity)) {
    debugTiming(moduleId, "set-paint-mask-preview", {
      gridStep: session.maskData?.gridStep ?? 0,
      cols: session.maskData?.cols ?? 0,
      rows: session.maskData?.rows ?? 0,
      dirtyPreview: true,
      totalMs: roundTimingMs(nowMs() - totalStart),
    });
    return;
  }

  destroyPreviewSprite(session.previewSprite);
  session.previewSprite = null;
  const sprite = paintPreview?.(session.maskData, opts.paintColor, opts.paintOpacity)
    ?? paintPreviewFromMask(session.maskData, {
      color: opts.paintColor,
      opacity: opts.paintOpacity,
      getMaskBounds,
      moduleId,
    });
  if (!sprite) return;
  getPreviewLayer()?.addChild?.(sprite);
  session.previewSprite = sprite;
  updateStatus?.(session);
  debugTiming(moduleId, "set-paint-mask-preview", {
    gridStep: session.maskData?.gridStep ?? 0,
    cols: session.maskData?.cols ?? 0,
    rows: session.maskData?.rows ?? 0,
    dirtyPreview: false,
    totalMs: roundTimingMs(nowMs() - totalStart),
  });
}

export function drawSessionDebug(session, {
  imgW = 0,
  imgH = 0,
} = {}) {
  if (session?.closed === true) {
    destroyGraphics(session?.debugGfx);
    if (session) session.debugGfx = null;
    return;
  }
  const opts = normalizeOptions(session?.options ?? {});
  const paintBorderThickness = clamp(toFiniteNumber(opts.paintBorderThickness, DEFAULT_PAINT_OPTIONS.paintBorderThickness), 0, 4);
  if (session?.isPaintSession === true && paintBorderThickness <= 0) {
    destroyGraphics(session?.debugGfx);
    if (session) session.debugGfx = null;
    return;
  }
  if (opts.debug !== true && session?.isPaintSession !== true) {
    destroyGraphics(session?.debugGfx);
    if (session) session.debugGfx = null;
    return;
  }
  if (!session) return;
  if (!session.debugGfx) {
    session.debugGfx = new PIXI.Graphics();
    session.debugGfx.eventMode = "none";
    session.debugGfx.zIndex = 1000001;
    getPreviewLayer()?.addChild?.(session.debugGfx);
  }

  const gfx = session.debugGfx;
  gfx.clear();

  if (imgW > 0 && imgH > 0) {
    const map = getSceneImageMapping(imgW, imgH);
    gfx.lineStyle(2, 0xff00ff, 0.55);
    gfx.drawRect(map.sceneX, map.sceneY, map.sceneWidth, map.sceneHeight);
  }

  const shapes = Array.isArray(session?.candidate?.shapes) ? session.candidate.shapes : [];
  for (let i = 0; i < shapes.length; i += 1) {
    const shape = shapes[i];
    const points = Array.isArray(shape?.points) ? shape.points : [];
    if (points.length < 3) continue;
    const width = session?.isPaintSession === true ? paintBorderThickness : (i === 0 ? 4 : 2);
    gfx.lineStyle(width, i === 0 ? 0x00ffff : 0x00ff88, i === 0 ? 0.95 : 0.75);
    gfx.moveTo(points[0].x, points[0].y);
    for (let p = 1; p < points.length; p += 1) gfx.lineTo(points[p].x, points[p].y);
    gfx.closePath();

    const bounds = shape.bounds ?? pointsBounds(points);
    if (bounds) {
      gfx.lineStyle(1, 0xffffff, 0.45);
      gfx.drawRect(bounds.minX, bounds.minY, bounds.width, bounds.height);
    }
  }
}

export function drawPaintBrush(session, point, mode = null, options = null) {
  if (!session || session.closed === true) return;
  if (!point) {
    destroyGraphics(session.brushGfx);
    session.brushGfx = null;
    session.lastBrushPoint = null;
    return;
  }

  const opts = normalizeOptions(options ?? session.options ?? {});
  const radius = Math.max(1, toFiniteNumber(opts.brushSizePx, DEFAULT_PAINT_OPTIONS.brushSizePx)) / 2;
  const paintMode = mode ?? session.paintMode ?? "add";
  const color = paintMode === "subtract" ? 0xff6b4a : 0x35b7ff;
  session.lastBrushPoint = { x: point.x, y: point.y };

  if (!session.brushGfx) {
    session.brushGfx = new PIXI.Graphics();
    session.brushGfx.eventMode = "none";
    session.brushGfx.zIndex = 1000002;
    getPreviewLayer()?.addChild?.(session.brushGfx);
  }

  const gfx = session.brushGfx;
  gfx.clear();
  gfx.lineStyle(2, color, 0.85);
  gfx.beginFill(color, 0.18);
  gfx.drawCircle(point.x, point.y, radius);
  gfx.endFill();
  gfx.lineStyle(1, 0xffffff, 0.45);
  gfx.drawCircle(point.x, point.y, Math.max(1, radius - 2));
}
