export class PaintSession {
  constructor(data = {}) {
    Object.assign(this, data);
    this.isPaintSession = true;
    this.maskData ??= null;
    this.sourceMaskData ??= null;
    this.candidate ??= null;
    this.paintUndoStack ??= [];
    this.paintRedoStack ??= [];
    this.previewSprite ??= null;
    this.brushGfx ??= null;
    this.debugGfx ??= null;
    this.suppressedTargetBehaviorStates ??= null;
    this.dialog ??= null;
    this.root ??= null;
    this.paintRefreshTimer ??= null;
    this.paintPreviewFrame ??= null;
    this.paintPreviewFrameType ??= null;
    this.paintDirty ??= false;
    this.painting ??= false;
    this.paintMode ??= null;
    this.lastPaintPoint ??= null;
    this.lastBrushPoint ??= null;
    this.paintStrokeChanged ??= false;
    this.paintStrokeChangedCells ??= 0;
    this.closed ??= false;
    this.onDown ??= null;
    this.onMove ??= null;
    this.onUp ??= null;
    this.onKeyDown ??= null;
    this.onDomDown ??= null;
    this.onDomMove ??= null;
    this.onDomUp ??= null;
    this.onDomLeave ??= null;
    this.onWheel ??= null;
    this.gridStepUpdateTimer ??= null;
    this.suppressCompatMouseUntil ??= 0;
    this.restoreRegionLayerInteraction ??= null;
    this.restoreCanvasDragSelection ??= null;
    this.restoreTargetRegionVisibility ??= null;
    this.cleanupFns ??= [];
  }

  close() {
    this.closed = true;
  }

  clearTimers() {
    if (this.paintRefreshTimer) {
      clearTimeout(this.paintRefreshTimer);
      this.paintRefreshTimer = null;
    }
    this.cancelPaintPreviewFrame();
    if (this.gridStepUpdateTimer) {
      clearTimeout(this.gridStepUpdateTimer);
      this.gridStepUpdateTimer = null;
    }
  }

  requestPaintPreviewFrame(callback) {
    if (typeof callback !== "function" || this.paintPreviewFrame) return false;
    const raf = globalThis.requestAnimationFrame;
    if (typeof raf === "function") {
      this.paintPreviewFrameType = "raf";
      this.paintPreviewFrame = raf(() => {
        this.paintPreviewFrame = null;
        this.paintPreviewFrameType = null;
        if (this.closed !== true) callback();
      });
      return true;
    }
    this.paintPreviewFrameType = "timeout";
    this.paintPreviewFrame = setTimeout(() => {
      this.paintPreviewFrame = null;
      this.paintPreviewFrameType = null;
      if (this.closed !== true) callback();
    }, 16);
    return true;
  }

  cancelPaintPreviewFrame() {
    if (!this.paintPreviewFrame) return;
    if (this.paintPreviewFrameType === "raf" && typeof globalThis.cancelAnimationFrame === "function") {
      globalThis.cancelAnimationFrame(this.paintPreviewFrame);
    } else {
      clearTimeout(this.paintPreviewFrame);
    }
    this.paintPreviewFrame = null;
    this.paintPreviewFrameType = null;
  }

  flushPaintPreviewFrame(callback) {
    this.cancelPaintPreviewFrame();
    if (typeof callback === "function" && this.closed !== true) callback();
  }

  setMaskData(maskData, sourceMaskData = this.sourceMaskData) {
    this.maskData = maskData;
    this.sourceMaskData = sourceMaskData;
    this.paintPreviewDirtyBounds = null;
    return this;
  }

  clearHistory() {
    this.paintUndoStack = [];
    this.paintRedoStack = [];
  }

  get canUndo() {
    return Array.isArray(this.paintUndoStack) && this.paintUndoStack.length > 0;
  }

  get canRedo() {
    return Array.isArray(this.paintRedoStack) && this.paintRedoStack.length > 0;
  }

  pushUndo(snapshot, limit = 40) {
    if (!snapshot) return false;
    if (!Array.isArray(this.paintUndoStack)) this.paintUndoStack = [];
    this.paintUndoStack.push(snapshot);
    while (this.paintUndoStack.length > limit) this.paintUndoStack.shift();
    return true;
  }

  clearRedo() {
    this.paintRedoStack = [];
  }

  popUndo() {
    return Array.isArray(this.paintUndoStack) ? this.paintUndoStack.pop() : null;
  }

  popRedo() {
    return Array.isArray(this.paintRedoStack) ? this.paintRedoStack.pop() : null;
  }

  pushRedo(snapshot, limit = 40) {
    if (!snapshot) return false;
    if (!Array.isArray(this.paintRedoStack)) this.paintRedoStack = [];
    this.paintRedoStack.push(snapshot);
    while (this.paintRedoStack.length > limit) this.paintRedoStack.shift();
    return true;
  }

  pushUndoFromRedo(snapshot, limit = 40) {
    if (!snapshot) return false;
    if (!Array.isArray(this.paintUndoStack)) this.paintUndoStack = [];
    this.paintUndoStack.push(snapshot);
    while (this.paintUndoStack.length > limit) this.paintUndoStack.shift();
    return true;
  }

  beginStroke({ point = null, mode = "add", deltaRecorder = null } = {}) {
    this.painting = true;
    this.paintMode = mode;
    this.lastPaintPoint = point;
    this.paintDeltaRecorder = deltaRecorder;
    this.paintStrokeChanged = false;
    this.paintStrokeChangedCells = 0;
    this.paintDirty = false;
  }

  markStrokeChanged(cells = 0) {
    const changed = Math.max(0, Number(cells) || 0);
    if (changed <= 0) return;
    this.paintStrokeChangedCells = (Number(this.paintStrokeChangedCells) || 0) + changed;
    this.paintStrokeChanged = true;
    this.paintDirty = true;
  }

  continueStroke(point = null) {
    const last = this.lastPaintPoint ?? point;
    this.lastPaintPoint = point;
    return last;
  }

  endStroke() {
    const state = {
      changed: this.paintStrokeChanged === true,
      changedCells: Number(this.paintStrokeChangedCells) || 0,
      deltaRecorder: this.paintDeltaRecorder ?? null,
      dirty: this.paintDirty === true,
    };
    this.painting = false;
    this.paintMode = null;
    this.lastPaintPoint = null;
    this.paintDeltaRecorder = null;
    this.paintStrokeChanged = false;
    this.paintStrokeChangedCells = 0;
    this.paintDirty = false;
    return state;
  }

  cancelStroke({ clearDirty = true, clearTimers = true } = {}) {
    this.painting = false;
    this.paintMode = null;
    this.lastPaintPoint = null;
    this.paintDeltaRecorder = null;
    this.paintStrokeChanged = false;
    this.paintStrokeChangedCells = 0;
    if (clearDirty === true) {
      this.paintPreviewDirtyBounds = null;
      this.paintDirty = false;
    }
    if (clearTimers === true) this.clearTimers();
  }

  addCleanup(fn) {
    if (typeof fn !== "function") return null;
    this.cleanupFns.push(fn);
    return fn;
  }

  addDomListener(target, type, listener, options) {
    if (!target || typeof target.addEventListener !== "function" || typeof listener !== "function") return;
    target.addEventListener(type, listener, options);
    this.addCleanup(() => target.removeEventListener?.(type, listener, options));
  }

  addPixiListener(target, type, listener) {
    if (!target || typeof target.on !== "function" || typeof listener !== "function") return;
    target.on(type, listener);
    this.addCleanup(() => target.off?.(type, listener));
  }

  attachCanvasListeners({
    view = globalThis.canvas?.app?.view,
    stage = globalThis.canvas?.stage,
    documentRef = globalThis.document,
    windowRef = globalThis.window,
  } = {}) {
    if (view) {
      this.addDomListener(view, "pointerdown", this.onDomDown, true);
      this.addDomListener(view, "pointermove", this.onDomMove, true);
      this.addDomListener(view, "pointerup", this.onDomUp, true);
      this.addDomListener(view, "pointercancel", this.onDomUp, true);
      this.addDomListener(view, "pointerleave", this.onDomLeave, true);
      this.addDomListener(view, "mousedown", this.onDomDown, true);
      this.addDomListener(view, "mousemove", this.onDomMove, true);
      this.addDomListener(view, "mouseup", this.onDomUp, true);
      this.addDomListener(view, "mouseleave", this.onDomLeave, true);
      this.addDomListener(view, "wheel", this.onWheel, { capture: true, passive: false });
    }
    this.addDomListener(documentRef, "pointerdown", this.onDomDown, true);
    this.addDomListener(documentRef, "pointermove", this.onDomMove, true);
    this.addDomListener(documentRef, "pointerup", this.onDomUp, true);
    this.addDomListener(documentRef, "pointercancel", this.onDomUp, true);
    this.addDomListener(documentRef, "mousedown", this.onDomDown, true);
    this.addDomListener(documentRef, "mousemove", this.onDomMove, true);
    this.addDomListener(documentRef, "mouseup", this.onDomUp, true);
    this.addPixiListener(stage, "pointerdown", this.onDown);
    this.addPixiListener(stage, "pointermove", this.onMove);
    this.addPixiListener(stage, "pointerup", this.onUp);
    this.addPixiListener(stage, "pointerupoutside", this.onUp);
    this.addDomListener(windowRef, "keydown", this.onKeyDown, true);
  }

  attachListeners(options = {}) {
    this.attachCanvasListeners(options);
  }

  detachListeners() {
    this.runCleanup();
  }

  runCleanup() {
    const fns = Array.isArray(this.cleanupFns) ? this.cleanupFns.splice(0).reverse() : [];
    for (const fn of fns) {
      try {
        fn();
      } catch (_err) {
        // Non-fatal cleanup.
      }
    }
  }

  destroy({
    closeDialog = true,
    destroyPreviewSprite = null,
    destroyGraphics = null,
    restoreShader = null,
  } = {}) {
    this.close();
    this.clearTimers();
    this.detachListeners();
    this.onDown = null;
    this.onMove = null;
    this.onUp = null;
    this.onKeyDown = null;
    this.onDomDown = null;
    this.onDomMove = null;
    this.onDomUp = null;
    this.onDomLeave = null;
    this.onWheel = null;
    destroyPreviewSprite?.(this.previewSprite);
    this.previewSprite = null;
    destroyGraphics?.(this.debugGfx);
    this.debugGfx = null;
    destroyGraphics?.(this.brushGfx);
    this.brushGfx = null;
    restoreShader?.(this);
    if (closeDialog) {
      try {
        this.closingFromEndSession = true;
        this.dialog?.close?.({ force: true });
      } catch (_err) {
        // Non-fatal.
      } finally {
        this.closingFromEndSession = false;
      }
    }
  }
}
