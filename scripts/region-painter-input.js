import { DEFAULT_WATER_OPTIONS } from "./region-painter-constants.js";
import {
  consumePaintPointerEvent,
  getDomPointerWorldPoint,
  getPointerWorldPoint,
  isPrimaryDomPointerEvent,
  isPrimaryPointerEvent,
} from "./region-painter-foundry.js";
import { setStoredPaintOptions } from "./region-painter-options.js";
import {
  clamp,
  debugTiming,
  nowMs,
  roundTimingMs,
  toFiniteNumber,
} from "./region-painter-utils.js";

function setDialogNumber(session, name, value) {
  const root = session?.root;
  if (!(root instanceof Element)) return;
  const inputs = root.querySelectorAll(`[name="${name}"]`);
  for (const input of inputs) {
    if (input instanceof HTMLInputElement) input.value = String(value);
  }
}

export function installPaintInputHandlers(session, {
  moduleId = "indy-regions",
  getActiveSession = null,
  readOptions = null,
  drawBrush = null,
  beginStroke = null,
  continueStroke = null,
  finishStroke = null,
  floodFill = null,
  paintTargetShape = null,
  undo = null,
  redo = null,
} = {}) {
  session.onDown = (event) => {
    const point = getPointerWorldPoint(event);
    if (!point || session?.closed === true) return;
    const primary = isPrimaryPointerEvent(event);
    const original = event?.data?.originalEvent ?? event?.nativeEvent ?? event;
    if (!primary) return;
    consumePaintPointerEvent(event);
    if (original?.altKey === true) {
      void paintTargetShape?.(session, point, original?.shiftKey === true);
      return;
    }
    if (original?.ctrlKey === true || original?.metaKey === true) {
      void floodFill?.(session, point, original?.shiftKey === true);
      return;
    }
    beginStroke?.(session, point, original?.shiftKey === true, original?.ctrlKey === true || original?.metaKey === true);
  };

  session.onMove = (event) => {
    const point = getPointerWorldPoint(event);
    if (!point || session?.closed === true) return;
    const original = event?.data?.originalEvent ?? event?.nativeEvent ?? event;
    const changed = continueStroke?.(session, point, original?.shiftKey === true, original?.ctrlKey === true || original?.metaKey === true);
    if (session?.painting || changed) consumePaintPointerEvent(event);
  };

  session.onUp = () => finishStroke?.(session);

  session.onDomDown = (event) => {
    if (session?.closed === true || !isPrimaryDomPointerEvent(event)) return;
    const view = canvas?.app?.view;
    if (event?.target !== view) return;
    const now = globalThis.performance?.now?.() ?? Date.now();
    if (String(event?.type ?? "").startsWith("mouse") && Number(session.suppressCompatMouseUntil ?? 0) > now) {
      consumePaintPointerEvent(event);
      return;
    }
    if (String(event?.type ?? "").startsWith("pointer")) session.suppressCompatMouseUntil = now + 500;
    const point = getDomPointerWorldPoint(event);
    if (!point) return;
    consumePaintPointerEvent(event);
    if (event.altKey === true) {
      void paintTargetShape?.(session, point, event.shiftKey === true);
      return;
    }
    if (event.ctrlKey === true || event.metaKey === true) {
      void floodFill?.(session, point, event.shiftKey === true);
      return;
    }
    try {
      (canvas?.app?.view ?? event.currentTarget)?.setPointerCapture?.(event.pointerId);
    } catch (_err) {
      // Non-fatal.
    }
    beginStroke?.(session, point, event.shiftKey === true, event.ctrlKey === true || event.metaKey === true);
  };

  session.onDomMove = (event) => {
    if (session?.closed === true) return;
    const view = canvas?.app?.view;
    if (event?.target !== view && !session.painting) return;
    const now = globalThis.performance?.now?.() ?? Date.now();
    if (String(event?.type ?? "").startsWith("mouse") && Number(session.suppressCompatMouseUntil ?? 0) > now) {
      consumePaintPointerEvent(event);
      return;
    }
    const point = getDomPointerWorldPoint(event);
    if (!point) return;
    const changed = continueStroke?.(session, point, event.shiftKey === true, event.ctrlKey === true || event.metaKey === true);
    if (session?.painting || changed) consumePaintPointerEvent(event);
  };

  session.onDomUp = (event) => {
    if (session?.closed === true || !session.painting) return;
    const now = globalThis.performance?.now?.() ?? Date.now();
    if (String(event?.type ?? "").startsWith("mouse") && Number(session.suppressCompatMouseUntil ?? 0) > now) {
      consumePaintPointerEvent(event);
      return;
    }
    consumePaintPointerEvent(event);
    try {
      (canvas?.app?.view ?? event.currentTarget)?.releasePointerCapture?.(event.pointerId);
    } catch (_err) {
      // Non-fatal.
    }
    const point = getDomPointerWorldPoint(event);
    finishStroke?.(session);
    if (point) drawBrush?.(session, point, event.shiftKey === true ? "subtract" : "add");
  };

  session.onDomLeave = () => {
    if (!session.painting) drawBrush?.(session, null);
  };

  session.onWheel = (event) => {
    if (session?.closed === true) return;
    if (event?.ctrlKey !== true && event?.metaKey !== true) return;
    const point = getDomPointerWorldPoint(event);
    if (!point) return;
    consumePaintPointerEvent(event);
    const opts = readOptions?.(session);
    const direction = Number(event.deltaY) < 0 ? 1 : -1;
    const current = Math.max(1, toFiniteNumber(opts?.brushSizePx, DEFAULT_WATER_OPTIONS.brushSizePx));
    const step = event.shiftKey === true ? 1 : Math.max(2, Math.round(current * 0.08));
    opts.brushSizePx = clamp(Math.round(current + (direction * step)), 1, 512);
    setDialogNumber(session, "brushSizePx", opts.brushSizePx);
    session.options = opts;
    setStoredPaintOptions(moduleId, opts);
    drawBrush?.(session, point, event.shiftKey === true && session.painting ? "subtract" : session.paintMode, opts);
  };

  session.onKeyDown = (event) => {
    if (!session || session.closed === true || getActiveSession?.() !== session) return;
    const key = String(event?.key ?? "").toLowerCase();
    const hasModifier = event?.ctrlKey === true || event?.metaKey === true;
    if (!hasModifier) return;
    const isUndo = key === "z" && event?.shiftKey !== true;
    const isRedo = key === "y" || (key === "z" && event?.shiftKey === true);
    if (!isUndo && !isRedo) return;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (isUndo) undo?.(session);
    else redo?.(session);
  };
}

export function finishPaintStroke(session, {
  moduleId = "indy-regions",
  finalizeDelta = null,
  pushUndo = null,
  cancelPreviewUpdate = null,
  refreshCandidate = null,
} = {}) {
  const strokeStart = nowMs();
  const strokeState = session?.endStroke();
  if (!strokeState) return;
  if (strokeState.changed && strokeState.deltaRecorder) {
    pushUndo?.(session, finalizeDelta?.(strokeState.deltaRecorder));
    session.clearRedo();
  }
  if (strokeState.dirty) {
    cancelPreviewUpdate?.(session);
    if (session.paintRefreshTimer) {
      clearTimeout(session.paintRefreshTimer);
      session.paintRefreshTimer = null;
    }
    void refreshCandidate?.(session);
  }
  debugTiming(moduleId, "paint-stroke-end", {
    changed: strokeState.changed,
    changedCells: strokeState.changedCells,
    gridStep: session?.maskData?.gridStep ?? 0,
    cols: session?.maskData?.cols ?? 0,
    rows: session?.maskData?.rows ?? 0,
    totalMs: roundTimingMs(nowMs() - strokeStart),
  });
}
