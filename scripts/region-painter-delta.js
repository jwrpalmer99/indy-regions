import {
  initializeMaskOccupancy,
  updateMaskOccupancy,
} from "./region-painter-mask.js";

const MAX_DELTA_CELLS = 100_000;

export function maskDeltaMetadata(maskData) {
  if (!maskData?.mask) return null;
  return {
    cols: maskData.cols,
    rows: maskData.rows,
    gridStep: maskData.gridStep,
    offsetX: maskData.offsetX ?? 0,
    offsetY: maskData.offsetY ?? 0,
    fullCols: maskData.fullCols ?? maskData.cols,
    fullRows: maskData.fullRows ?? maskData.rows,
    bounds: maskData.bounds ? { ...maskData.bounds } : null,
    boundsDirty: maskData.boundsDirty === true,
  };
}

export function createMaskDelta(maskData) {
  const meta = maskDeltaMetadata(maskData);
  return meta ? { ...meta, cells: new Map() } : null;
}

export function snapshotMaskBeforeDelta(maskData, delta) {
  const meta = delta ? { ...delta } : maskDeltaMetadata(maskData);
  if (!maskData?.mask || !meta) return null;
  delete meta.cells;
  const mask = new Uint8Array(maskData.mask);
  if (delta?.cells?.size) {
    for (const [index, value] of delta.cells.entries()) {
      if (index < mask.length) mask[index] = value ? 1 : 0;
    }
  }
  const snapshot = { ...meta, mask };
  initializeMaskOccupancy(snapshot, snapshot.bounds);
  return snapshot;
}

export function createPaintDeltaRecorder(session, {
  preferSnapshot = false,
} = {}) {
  const maskData = session?.maskData ?? null;
  const sourceMaskData = session?.sourceMaskData ?? maskData;
  if (preferSnapshot === true) {
    return {
      type: "snapshot",
      snapshotOnly: true,
      maskSnapshot: snapshotMaskBeforeDelta(maskData, null),
      sourceMaskSnapshot: sourceMaskData && sourceMaskData !== maskData
        ? snapshotMaskBeforeDelta(sourceMaskData, null)
        : snapshotMaskBeforeDelta(maskData, null),
      record() {},
    };
  }
  const maskDelta = createMaskDelta(maskData);
  const sourceDelta = sourceMaskData && sourceMaskData !== maskData
    ? createMaskDelta(sourceMaskData)
    : null;
  let maskSnapshot = null;
  let sourceSnapshot = null;
  const snapshotForTarget = (target, delta) => {
    if (target === maskData) {
      maskSnapshot ??= snapshotMaskBeforeDelta(maskData, delta);
      return maskSnapshot;
    }
    if (target === sourceMaskData) {
      sourceSnapshot ??= snapshotMaskBeforeDelta(sourceMaskData, delta);
      return sourceSnapshot;
    }
    return null;
  };
  return {
    type: "delta",
    maskData: maskDelta,
    sourceMaskData: sourceDelta,
    get maskSnapshot() {
      return maskSnapshot;
    },
    get sourceMaskSnapshot() {
      return sourceSnapshot;
    },
    get currentMaskData() {
      return maskData;
    },
    get currentSourceMaskData() {
      return sourceMaskData;
    },
    record(target, index, previousValue) {
      const delta = target === maskData ? maskDelta : (target === sourceMaskData ? sourceDelta : null);
      if (target === maskData && maskSnapshot) return;
      if (target === sourceMaskData && sourceSnapshot) return;
      if (!delta?.cells || delta.cells.has(index)) return;
      if (delta.cells.size >= MAX_DELTA_CELLS) {
        snapshotForTarget(target, delta);
        delta.cells = null;
        return;
      }
      delta.cells.set(index, previousValue ? 1 : 0);
    },
  };
}

export function finalizeMaskDelta(delta) {
  if (!delta?.cells?.size) return null;
  const indexes = new Uint32Array(delta.cells.size);
  const values = new Uint8Array(delta.cells.size);
  let i = 0;
  for (const [index, value] of delta.cells.entries()) {
    indexes[i] = index;
    values[i] = value ? 1 : 0;
    i += 1;
  }
  const { cells: _cells, ...meta } = delta;
  return { ...meta, indexes, values };
}

export function finalizePaintDelta(recorder) {
  if (recorder?.type === "snapshot") {
    if (!recorder.maskSnapshot) return null;
    return {
      maskData: recorder.maskSnapshot,
      sourceMaskData: recorder.sourceMaskSnapshot ?? recorder.maskSnapshot,
    };
  }
  if (recorder?.type !== "delta") return null;
  if (recorder.maskSnapshot || recorder.sourceMaskSnapshot) {
    const maskData = recorder.maskSnapshot ?? snapshotMaskBeforeDelta(recorder.currentMaskData, recorder.maskData);
    const sourceMaskData = recorder.currentSourceMaskData && recorder.currentSourceMaskData !== recorder.currentMaskData
      ? (recorder.sourceMaskSnapshot ?? snapshotMaskBeforeDelta(recorder.currentSourceMaskData, recorder.sourceMaskData))
      : maskData;
    if (!maskData) return null;
    return {
      maskData,
      sourceMaskData,
    };
  }
  const maskData = finalizeMaskDelta(recorder.maskData);
  const sourceMaskData = finalizeMaskDelta(recorder.sourceMaskData);
  if (!maskData && !sourceMaskData) return null;
  return { type: "delta", maskData, sourceMaskData };
}

export function applyMaskDelta(maskData, delta, {
  invalidateMaskDerivedData = null,
} = {}) {
  if (!maskData?.mask || !delta?.indexes || !delta?.values) return null;
  if (maskData.cols !== delta.cols || maskData.rows !== delta.rows || maskData.gridStep !== delta.gridStep) return null;
  const inverse = {
    ...maskDeltaMetadata(maskData),
    indexes: new Uint32Array(delta.indexes.length),
    values: new Uint8Array(delta.values.length),
  };
  for (let i = 0; i < delta.indexes.length; i += 1) {
    const index = delta.indexes[i];
    if (index >= maskData.mask.length) continue;
    inverse.indexes[i] = index;
    const previousValue = maskData.mask[index] ? 1 : 0;
    const nextValue = delta.values[i] ? 1 : 0;
    inverse.values[i] = previousValue;
    maskData.mask[index] = delta.values[i] ? 1 : 0;
    updateMaskOccupancy(maskData, index % maskData.cols, Math.floor(index / maskData.cols), previousValue, nextValue);
    if (maskData.alphaMask && index < maskData.alphaMask.length) {
      maskData.alphaMask[index] = maskData.mask[index] ? 255 : 0;
    }
  }
  maskData.bounds = delta.bounds ? { ...delta.bounds } : null;
  maskData.boundsDirty = delta.boundsDirty === true;
  invalidateMaskDerivedData?.(maskData, { boundsDirty: maskData.boundsDirty });
  return inverse;
}

export function applyPaintDelta(session, entry, options = {}) {
  if (!session || entry?.type !== "delta") return null;
  const inverseMask = applyMaskDelta(session.maskData, entry.maskData, options);
  const inverseSource = session.sourceMaskData && session.sourceMaskData !== session.maskData
    ? applyMaskDelta(session.sourceMaskData, entry.sourceMaskData, options)
    : null;
  if (!inverseMask && !inverseSource) return null;
  return { type: "delta", maskData: inverseMask, sourceMaskData: inverseSource };
}
