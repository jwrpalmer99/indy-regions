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

export function createPaintDeltaRecorder(session) {
  const maskData = session?.maskData ?? null;
  const sourceMaskData = session?.sourceMaskData ?? maskData;
  const maskDelta = createMaskDelta(maskData);
  const sourceDelta = sourceMaskData && sourceMaskData !== maskData
    ? createMaskDelta(sourceMaskData)
    : null;
  return {
    type: "delta",
    maskData: maskDelta,
    sourceMaskData: sourceDelta,
    record(target, index, previousValue) {
      const delta = target === maskData ? maskDelta : (target === sourceMaskData ? sourceDelta : null);
      if (!delta?.cells || delta.cells.has(index)) return;
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
  if (recorder?.type !== "delta") return null;
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
    inverse.values[i] = maskData.mask[index] ? 1 : 0;
    maskData.mask[index] = delta.values[i] ? 1 : 0;
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
