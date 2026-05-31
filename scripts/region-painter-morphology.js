import {
  maskFullCols,
  maskFullRows,
  maskOffsetX,
  maskOffsetY,
  normalizeMaskBounds,
} from "./region-painter-mask.js";

export function isMaskCellSet(mask, cols, rows, x, y) {
  if (x < 0 || y < 0 || x >= cols || y >= rows) return false;
  return mask[y * cols + x] !== 0;
}

export function computeMaskBounds(maskData) {
  const { mask, cols, rows } = maskData ?? {};
  if (!mask || !cols || !rows) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < rows; y += 1) {
    const rowOffset = y * cols;
    for (let x = 0; x < cols; x += 1) {
      if (!mask[rowOffset + x]) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return normalizeMaskBounds({ minX, minY, maxX, maxY }, cols, rows);
}

export function expandBoundsByRadius(bounds, radius, cols, rows) {
  const normalized = normalizeMaskBounds(bounds, cols, rows);
  if (!normalized) return null;
  const r = Math.max(0, Math.round(Number(radius) || 0));
  return normalizeMaskBounds({
    minX: normalized.minX - r,
    minY: normalized.minY - r,
    maxX: normalized.maxX + r,
    maxY: normalized.maxY + r,
  }, cols, rows);
}

export function l1DistanceTransform(dist, width, height) {
  const inf = 0x3fffffff;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    const prevRow = row - width;
    for (let x = 0; x < width; x += 1) {
      const i = row + x;
      let d = dist[i];
      if (x > 0) d = Math.min(d, dist[i - 1] + 1);
      if (y > 0) d = Math.min(d, dist[prevRow + x] + 1);
      dist[i] = d > inf ? inf : d;
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    const row = y * width;
    const nextRow = row + width;
    for (let x = width - 1; x >= 0; x -= 1) {
      const i = row + x;
      let d = dist[i];
      if (x + 1 < width) d = Math.min(d, dist[i + 1] + 1);
      if (y + 1 < height) d = Math.min(d, dist[nextRow + x] + 1);
      dist[i] = d > inf ? inf : d;
    }
  }
  return dist;
}

export function componentMaskWithBounds(cells) {
  if (!cells?.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const cell of cells) {
    minX = Math.min(minX, cell.x);
    minY = Math.min(minY, cell.y);
    maxX = Math.max(maxX, cell.x);
    maxY = Math.max(maxY, cell.y);
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  const cols = Math.max(1, (maxX - minX) + 1);
  const rows = Math.max(1, (maxY - minY) + 1);
  const mask = new Uint8Array(cols * rows);
  for (const cell of cells) {
    mask[(cell.y - minY) * cols + (cell.x - minX)] = 1;
  }
  return { mask, cols, rows, offsetX: minX, offsetY: minY };
}

export function emptyDerivedMaskData(maskData) {
  return {
    mask: new Uint8Array(0),
    cols: 0,
    rows: 0,
    gridStep: maskData?.gridStep,
    offsetX: maskOffsetX(maskData),
    offsetY: maskOffsetY(maskData),
    fullCols: maskFullCols(maskData),
    fullRows: maskFullRows(maskData),
    bounds: null,
  };
}
