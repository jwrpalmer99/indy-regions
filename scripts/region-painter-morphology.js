import {
  maskFullCols,
  maskFullRows,
  maskOffsetX,
  maskOffsetY,
  normalizeMaskBounds,
} from "./region-painter-mask.js";
import { polygonArea } from "./region-painter-geometry.js";

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

export function traceRunComponentBoundaries(component, cols, rows) {
  if (!component?.runs?.length) return [];
  const minX = Math.max(0, Math.floor(component.minX));
  const minY = Math.max(0, Math.floor(component.minY));
  const maxX = Math.min(cols - 1, Math.ceil(component.maxX));
  const maxY = Math.min(rows - 1, Math.ceil(component.maxY));
  const width = (maxX - minX) + 1;
  const height = (maxY - minY) + 1;
  if (width <= 0 || height <= 0) return [];

  const occupied = new Uint8Array(width * height);
  for (const run of component.runs) {
    const y = run.y - minY;
    if (y < 0 || y >= height) continue;
    const row = y * width;
    for (let x = Math.max(run.x1, minX); x <= Math.min(run.x2, maxX); x += 1) {
      occupied[row + (x - minX)] = 1;
    }
  }
  const has = (x, y) => {
    const lx = x - minX;
    const ly = y - minY;
    return lx >= 0 && lx < width && ly >= 0 && ly < height && occupied[(ly * width) + lx] === 1;
  };

  const pointWidth = width + 1;
  const pointKey = (x, y) => ((y - minY) * pointWidth) + (x - minX);
  const startToEdges = new Map();
  const ax = [];
  const ay = [];
  const bx = [];
  const by = [];
  const addEdge = (fromX, fromY, toX, toY) => {
    const edgeIndex = ax.length;
    ax.push(fromX);
    ay.push(fromY);
    bx.push(toX);
    by.push(toY);
    const key = pointKey(fromX, fromY);
    let list = startToEdges.get(key);
    if (!list) {
      list = [];
      startToEdges.set(key, list);
    }
    list.push(edgeIndex);
  };

  for (const run of component.runs) {
    const y = run.y;
    for (let x = Math.max(run.x1, minX); x <= Math.min(run.x2, maxX); x += 1) {
      if (!has(x, y - 1)) addEdge(x, y, x + 1, y);
      if (!has(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1);
      if (!has(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1);
      if (!has(x - 1, y)) addEdge(x, y + 1, x, y);
    }
  }

  const used = new Uint8Array(ax.length);
  const take = (key, prevIndex = -1) => {
    const list = startToEdges.get(key);
    if (!list?.length) return null;
    let best = -1;
    if (prevIndex >= 0) {
      const pdx = Math.sign(bx[prevIndex] - ax[prevIndex]);
      const pdy = Math.sign(by[prevIndex] - ay[prevIndex]);
      best = list.findIndex((edgeIndex) => !used[edgeIndex]
        && Math.sign(bx[edgeIndex] - ax[edgeIndex]) === pdx
        && Math.sign(by[edgeIndex] - ay[edgeIndex]) === pdy);
    }
    if (best < 0) best = list.findIndex((edgeIndex) => !used[edgeIndex]);
    if (best < 0) return null;
    const edgeIndex = list[best];
    used[edgeIndex] = 1;
    return edgeIndex;
  };

  const loops = [];
  for (const [key, list] of startToEdges.entries()) {
    for (const candidateIndex of list) {
      if (used[candidateIndex]) continue;
      used[candidateIndex] = 1;
      const loop = [{ x: ax[candidateIndex], y: ay[candidateIndex] }];
      let edgeIndex = candidateIndex;
      let guard = 0;
      while (guard < component.length * 4 + 16) {
        guard += 1;
        const nextPoint = { x: bx[edgeIndex], y: by[edgeIndex] };
        if (nextPoint.x === loop[0].x && nextPoint.y === loop[0].y) break;
        loop.push(nextPoint);
        edgeIndex = take(pointKey(nextPoint.x, nextPoint.y), edgeIndex);
        if (edgeIndex === null) break;
      }
      if (loop.length >= 3) loops.push(loop);
    }
    if (!startToEdges.has(key)) continue;
  }

  return loops
    .map((loop) => (polygonArea(loop) < 0 ? loop.slice().reverse() : loop))
    .sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)));
}

export function findMaskComponentsScanline(mask, cols, rows, bounds = null) {
  const scanBounds = normalizeMaskBounds(bounds, cols, rows) ?? {
    minX: 0,
    minY: 0,
    maxX: cols - 1,
    maxY: rows - 1,
    width: cols,
    height: rows,
  };
  scanBounds.width = (scanBounds.maxX - scanBounds.minX) + 1;
  scanBounds.height = (scanBounds.maxY - scanBounds.minY) + 1;

  const parent = [];
  const ranks = [];
  const makeSet = () => {
    const id = parent.length;
    parent.push(id);
    ranks.push(0);
    return id;
  };
  const find = (id) => {
    let x = id;
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const unite = (a, b) => {
    let ra = find(a);
    let rb = find(b);
    if (ra === rb) return ra;
    if (ranks[ra] < ranks[rb]) [ra, rb] = [rb, ra];
    parent[rb] = ra;
    if (ranks[ra] === ranks[rb]) ranks[ra] += 1;
    return ra;
  };

  let prevRuns = [];
  const runs = [];
  for (let y = scanBounds.minY; y <= scanBounds.maxY; y += 1) {
    const rowRuns = [];
    const rowOffset = y * cols;
    let x = scanBounds.minX;
    let prevIndex = 0;
    while (x <= scanBounds.maxX) {
      while (x <= scanBounds.maxX && !mask[rowOffset + x]) x += 1;
      if (x > scanBounds.maxX) break;
      const x1 = x;
      while (x <= scanBounds.maxX && mask[rowOffset + x]) x += 1;
      const x2 = x - 1;
      const label = makeSet();
      const run = { x1, x2, y, label, count: (x2 - x1) + 1 };
      while (prevIndex < prevRuns.length && prevRuns[prevIndex].x2 < x1) prevIndex += 1;
      for (let i = prevIndex; i < prevRuns.length && prevRuns[i].x1 <= x2; i += 1) {
        unite(label, prevRuns[i].label);
      }
      rowRuns.push(run);
      runs.push(run);
    }
    prevRuns = rowRuns;
  }

  const byRoot = new Map();
  for (const run of runs) {
    const root = find(run.label);
    let component = byRoot.get(root);
    if (!component) {
      component = {
        runs: [],
        length: 0,
        minX: Infinity,
        minY: Infinity,
        maxX: -Infinity,
        maxY: -Infinity,
      };
      byRoot.set(root, component);
    }
    component.runs.push(run);
    component.length += run.count;
    component.minX = Math.min(component.minX, run.x1);
    component.minY = Math.min(component.minY, run.y);
    component.maxX = Math.max(component.maxX, run.x2);
    component.maxY = Math.max(component.maxY, run.y);
  }

  return Array.from(byRoot.values())
    .sort((a, b) => b.length - a.length);
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
