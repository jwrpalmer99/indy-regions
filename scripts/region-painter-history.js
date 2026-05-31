import { PAINT_HISTORY_LIMIT } from "./region-painter-constants.js";
import {
  cloneMaskData,
  clonePaintSnapshot,
  snapshotMaskData,
  snapshotSourceMaskData,
} from "./region-painter-mask.js";
import { normalizeOptions } from "./region-painter-options.js";

export function pushPaintUndoSnapshot(session, snapshot = null) {
  const paintSnapshot = snapshot?.type === "delta"
    ? snapshot
    : snapshot?.maskData
    ? {
        maskData: cloneMaskData(snapshot.maskData),
        sourceMaskData: cloneMaskData(snapshot.sourceMaskData ?? snapshot.maskData),
      }
    : clonePaintSnapshot(session, snapshot);
  if (!session || !paintSnapshot?.maskData) return;
  session.pushUndo(paintSnapshot, PAINT_HISTORY_LIMIT);
}

export function cancelPaintStroke(session) {
  if (!session) return;
  session.cancelStroke();
}

export async function restorePaintSnapshot(session, snapshot, {
  resampleMaskData = null,
  syncDialogInputs = null,
  refreshCandidate = null,
} = {}) {
  if (!session || !snapshot) return;
  cancelPaintStroke(session);
  const restoredMask = cloneMaskData(snapshotMaskData(snapshot));
  session.maskData = restoredMask;
  session.sourceMaskData = cloneMaskData(snapshotSourceMaskData(snapshot))
    ?? resampleMaskData?.(restoredMask, 1)
    ?? cloneMaskData(restoredMask);
  if (session.maskData?.gridStep) {
    session.options = {
      ...normalizeOptions(session.options ?? {}),
      gridStep: session.maskData.gridStep,
    };
    syncDialogInputs?.(session);
  }
  await refreshCandidate?.(session);
}

export function undoPaintSession(session, callbacks = {}) {
  if (session?.canUndo !== true) return;
  void applyPaintHistory(session, "undo", callbacks);
}

export function redoPaintSession(session, callbacks = {}) {
  if (session?.canRedo !== true) return;
  void applyPaintHistory(session, "redo", callbacks);
}

export async function applyPaintHistory(session, direction = "undo", {
  applyPaintDelta = null,
  resampleMaskData = null,
  syncDialogInputs = null,
  refreshCandidate = null,
  updateStatus = null,
} = {}) {
  if (!session) return;
  const redo = direction === "redo";
  const entry = redo ? session.popRedo() : session.popUndo();
  if (!entry) return;
  let inverse = null;
  if (entry?.type === "delta") {
    cancelPaintStroke(session);
    inverse = applyPaintDelta?.(session, entry) ?? null;
    if (inverse) await refreshCandidate?.(session);
  } else {
    inverse = clonePaintSnapshot(session);
    await restorePaintSnapshot(session, entry, {
      resampleMaskData,
      syncDialogInputs,
      refreshCandidate,
    });
  }
  if (!inverse) return;
  if (redo) {
    session.pushUndoFromRedo(inverse, PAINT_HISTORY_LIMIT);
  } else session.pushRedo(inverse, PAINT_HISTORY_LIMIT);
  updateStatus?.(session);
}
