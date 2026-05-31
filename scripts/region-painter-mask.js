export function cloneMaskData(maskData) {
  if (!maskData?.mask) return null;
  return {
    mask: new Uint8Array(maskData.mask),
    alphaMask: maskData.alphaMask ? new Uint8Array(maskData.alphaMask) : null,
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

export function clonePaintSnapshot(session, fallback = null) {
  const maskData = cloneMaskData(fallback ?? session?.maskData);
  if (!maskData) return null;
  return {
    maskData,
    sourceMaskData: cloneMaskData(session?.sourceMaskData ?? fallback ?? session?.maskData),
  };
}

export function snapshotMaskData(snapshot) {
  return snapshot?.maskData ? snapshot.maskData : snapshot;
}

export function snapshotSourceMaskData(snapshot) {
  return snapshot?.sourceMaskData ?? snapshot?.maskData ?? snapshot;
}

export function normalizeMaskBounds(bounds, cols, rows) {
  const minX = Math.max(0, Math.floor(Number(bounds?.minX)));
  const minY = Math.max(0, Math.floor(Number(bounds?.minY)));
  const maxX = Math.min(Math.max(0, Number(cols) - 1), Math.ceil(Number(bounds?.maxX)));
  const maxY = Math.min(Math.max(0, Number(rows) - 1), Math.ceil(Number(bounds?.maxY)));
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  if (maxX < minX || maxY < minY) return null;
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: (maxX - minX) + 1,
    height: (maxY - minY) + 1,
  };
}

export function expandMaskBounds(bounds, x, y, cols, rows) {
  const existing = normalizeMaskBounds(bounds, cols, rows);
  const gx = Math.max(0, Math.min(Math.max(0, Number(cols) - 1), Math.floor(Number(x))));
  const gy = Math.max(0, Math.min(Math.max(0, Number(rows) - 1), Math.floor(Number(y))));
  if (![gx, gy].every(Number.isFinite)) return existing;
  if (!existing) return normalizeMaskBounds({ minX: gx, minY: gy, maxX: gx, maxY: gy }, cols, rows);
  return normalizeMaskBounds({
    minX: Math.min(existing.minX, gx),
    minY: Math.min(existing.minY, gy),
    maxX: Math.max(existing.maxX, gx),
    maxY: Math.max(existing.maxY, gy),
  }, cols, rows);
}

export function sameMaskBounds(a, b) {
  return Boolean(a && b
    && a.minX === b.minX
    && a.minY === b.minY
    && a.maxX === b.maxX
    && a.maxY === b.maxY
    && a.width === b.width
    && a.height === b.height);
}

export function mergeMaskBounds(a, b, cols, rows) {
  const left = normalizeMaskBounds(a, cols, rows);
  const right = normalizeMaskBounds(b, cols, rows);
  if (!left) return right;
  if (!right) return left;
  return normalizeMaskBounds({
    minX: Math.min(left.minX, right.minX),
    minY: Math.min(left.minY, right.minY),
    maxX: Math.max(left.maxX, right.maxX),
    maxY: Math.max(left.maxY, right.maxY),
  }, cols, rows);
}

export function maskOffsetX(maskData) {
  return Math.max(0, Math.round(Number(maskData?.offsetX) || 0));
}

export function maskOffsetY(maskData) {
  return Math.max(0, Math.round(Number(maskData?.offsetY) || 0));
}

export function maskFullCols(maskData) {
  return Math.max(1, Math.round(Number(maskData?.fullCols) || Number(maskData?.cols) || 1));
}

export function maskFullRows(maskData) {
  return Math.max(1, Math.round(Number(maskData?.fullRows) || Number(maskData?.rows) || 1));
}

export function bytesToBase64(bytes) {
  if (!bytes?.length) return "";
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return globalThis.btoa?.(binary) ?? "";
}

export function base64ToBytes(value) {
  try {
    const binary = globalThis.atob?.(String(value ?? "")) ?? "";
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch (_err) {
    return null;
  }
}
