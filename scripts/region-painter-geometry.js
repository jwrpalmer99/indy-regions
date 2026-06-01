export function polygonArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += (a.x * b.y) - (b.x * a.y);
  }
  return area * 0.5;
}

export function pointLineDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const x = a.x + t * dx;
  const y = a.y + t * dy;
  return Math.hypot(p.x - x, p.y - y);
}

export function simplifyRdpOpen(points, tolerance) {
  if (!Array.isArray(points) || points.length <= 2) return points ?? [];
  const tol = Math.max(0, Number(tolerance) || 0);
  if (tol <= 0) return points.slice();

  function simplify(start, end) {
    let maxDist = 0;
    let maxIndex = start;
    const a = points[start];
    const b = points[end];

    for (let i = start + 1; i < end; i += 1) {
      const dist = pointLineDistance(points[i], a, b);
      if (dist > maxDist) {
        maxDist = dist;
        maxIndex = i;
      }
    }

    if (maxDist > tol) {
      const left = simplify(start, maxIndex);
      const right = simplify(maxIndex, end);
      return left.slice(0, -1).concat(right);
    }

    return [a, b];
  }

  return simplify(0, points.length - 1);
}

export function simplifyClosedPolygonRdp(points, tolerance) {
  if (!Array.isArray(points) || points.length <= 3) return points ?? [];
  const amount = Math.max(0, Number(tolerance) || 0);
  let bestIndex = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i];
    const b = points[bestIndex];
    if (a.x < b.x || (a.x === b.x && a.y < b.y)) bestIndex = i;
  }
  const rotated = points.slice(bestIndex).concat(points.slice(0, bestIndex));
  rotated.push(rotated[0]);
  const simplified = simplifyRdpOpen(rotated, amount).slice(0, -1);
  return simplified.length >= 3 ? simplified : points.slice();
}

export function simplifyClosedPolygon(points, tolerance) {
  if (!Array.isArray(points) || points.length <= 3) return points ?? [];
  const amount = Math.max(0, Number(tolerance) || 0);
  const simplified = simplifyClosedPolygonRdp(points, amount);
  const base = simplified.length >= 3 ? simplified : points.slice();
  return smoothClosedPolygon(base, amount);
}

export function smoothBoundaryPolygon(points, amount, type = "rounded") {
  const smoothAmount = Math.max(0, Number(amount) || 0);
  const smoothType = String(type ?? "rounded").trim().toLowerCase();
  if (!Array.isArray(points) || points.length <= 3 || smoothAmount <= 0) return points?.slice?.() ?? [];
  if (smoothType === "rounded") return roundedSmoothClosedPolygon(points, smoothAmount);
  if (smoothType === "relaxed") return relaxedSmoothClosedPolygon(points, smoothAmount);
  return simplifyClosedPolygon(points, smoothAmount);
}

export function limitClosedPolygonPoints(points, maxPoints = 512) {
  if (!Array.isArray(points) || points.length <= maxPoints) return points ?? [];
  const stride = Math.ceil(points.length / maxPoints);
  const out = [];
  for (let i = 0; i < points.length; i += stride) out.push(points[i]);
  return out.length >= 3 ? out : points.slice(0, maxPoints);
}

export function resampleClosedPolygon(points, maxPoints = 512) {
  if (!Array.isArray(points) || points.length <= maxPoints) return points ?? [];
  const lengths = [];
  let perimeter = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    lengths.push(length);
    perimeter += length;
  }
  if (perimeter <= 0) return limitClosedPolygonPoints(points, maxPoints);

  const out = [];
  const step = perimeter / maxPoints;
  let edgeIndex = 0;
  let edgeStartDistance = 0;
  for (let sample = 0; sample < maxPoints; sample += 1) {
    const target = sample * step;
    while (edgeIndex < lengths.length - 1 && edgeStartDistance + lengths[edgeIndex] < target) {
      edgeStartDistance += lengths[edgeIndex];
      edgeIndex += 1;
    }
    const a = points[edgeIndex];
    const b = points[(edgeIndex + 1) % points.length];
    const edgeLength = lengths[edgeIndex] || 1;
    const t = Math.max(0, Math.min(1, (target - edgeStartDistance) / edgeLength));
    out.push({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    });
  }
  return out.length >= 3 ? out : points.slice(0, maxPoints);
}

export function smoothClosedPolygon(points, amount) {
  if (!Array.isArray(points) || points.length < 3) return points ?? [];
  const smoothAmount = Math.max(0, Number(amount) || 0);
  if (smoothAmount <= 0) return points.slice();

  const maxPoints = 512;
  const requestedSamples = Math.max(2, Math.min(10, Math.ceil(smoothAmount * 0.75)));
  const samplesPerSegment = Math.max(1, Math.min(requestedSamples, Math.floor(maxPoints / points.length)));
  if (samplesPerSegment <= 1) return points.slice();

  const catmullRom = (p0, p1, p2, p3, t) => {
    const t2 = t * t;
    const t3 = t2 * t;
    return {
      x: 0.5 * (
        (2 * p1.x) +
        ((-p0.x + p2.x) * t) +
        (((2 * p0.x) - (5 * p1.x) + (4 * p2.x) - p3.x) * t2) +
        ((-p0.x + (3 * p1.x) - (3 * p2.x) + p3.x) * t3)
      ),
      y: 0.5 * (
        (2 * p1.y) +
        ((-p0.y + p2.y) * t) +
        (((2 * p0.y) - (5 * p1.y) + (4 * p2.y) - p3.y) * t2) +
        ((-p0.y + (3 * p1.y) - (3 * p2.y) + p3.y) * t3)
      ),
    };
  };

  const out = [];
  for (let i = 0; i < points.length; i += 1) {
    const p0 = points[(i - 1 + points.length) % points.length];
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const p3 = points[(i + 2) % points.length];
    for (let sample = 0; sample < samplesPerSegment; sample += 1) {
      out.push(catmullRom(p0, p1, p2, p3, sample / samplesPerSegment));
    }
  }
  return limitClosedPolygonPoints(out, maxPoints);
}

export function roundedSmoothClosedPolygon(points, amount) {
  if (!Array.isArray(points) || points.length < 3) return points ?? [];
  const smoothAmount = Math.max(0, Number(amount) || 0);
  if (smoothAmount <= 0) return points.slice();

  let out = simplifyClosedPolygonRdp(points, smoothAmount * 0.35);
  out = resampleClosedPolygon(out, 256);
  const strength = Math.min(1, smoothAmount / 32);
  const fullIterations = Math.floor(strength * 4);
  const fractionalIteration = (strength * 4) - fullIterations;
  const iterations = fullIterations + (fractionalIteration > 0.001 ? 1 : 0);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    if (out.length < 3) break;
    const cut = iteration < fullIterations ? 0.25 : 0.25 * fractionalIteration;
    if (cut <= 0) continue;
    const next = [];
    for (let i = 0; i < out.length; i += 1) {
      const a = out[i];
      const b = out[(i + 1) % out.length];
      next.push({
        x: (a.x * (1 - cut)) + (b.x * cut),
        y: (a.y * (1 - cut)) + (b.y * cut),
      });
      next.push({
        x: (a.x * cut) + (b.x * (1 - cut)),
        y: (a.y * cut) + (b.y * (1 - cut)),
      });
    }
    out = resampleClosedPolygon(next, 512);
  }
  return resampleClosedPolygon(out, 512);
}

export function relaxedSmoothClosedPolygon(points, amount) {
  if (!Array.isArray(points) || points.length < 3) return points ?? [];
  const smoothAmount = Math.max(0, Number(amount) || 0);
  if (smoothAmount <= 0) return points.slice();

  const strength = Math.min(1, smoothAmount / 32);
  let out = simplifyClosedPolygonRdp(points, smoothAmount * 0.25);
  if (out.length < 3) out = points.slice();
  out = limitClosedPolygonPoints(out, 512);

  const smoothPass = (source, factor) => {
    const next = [];
    for (let i = 0; i < source.length; i += 1) {
      const prev = source[(i - 1 + source.length) % source.length];
      const point = source[i];
      const nextPoint = source[(i + 1) % source.length];
      const lx = ((prev.x + nextPoint.x) * 0.5) - point.x;
      const ly = ((prev.y + nextPoint.y) * 0.5) - point.y;
      next.push({ x: point.x + lx * factor, y: point.y + ly * factor });
    }
    return next;
  };

  const iterations = Math.max(1, Math.min(8, Math.ceil(strength * 8)));
  const passScale = strength / iterations;
  for (let i = 0; i < iterations; i += 1) {
    out = smoothPass(out, 0.5 * passScale);
    out = smoothPass(out, -0.53 * passScale);
  }
  return limitClosedPolygonPoints(out, 512);
}

export function candidateShapesToRegionData(candidate) {
  const shapes = Array.isArray(candidate?.shapes) && candidate.shapes.length
    ? candidate.shapes
    : (candidate?.points?.length ? [{ points: candidate.points }] : []);
  return shapes
    .filter((shape) => Array.isArray(shape?.points) && shape.points.length >= 3)
    .map((shape) => {
      const data = {
        type: "polygon",
        points: shape.points.flatMap((point) => [Math.round(point.x), Math.round(point.y)]),
      };
      if (shape.isHole === true) data.hole = true;
      return data;
    });
}

export function pointsBounds(points) {
  if (!Array.isArray(points) || !points.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, Number(point.x));
    minY = Math.min(minY, Number(point.y));
    maxX = Math.max(maxX, Number(point.x));
    maxY = Math.max(maxY, Number(point.y));
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function pointInPolygon(point, polygon) {
  if (!point || !Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const pi = polygon[i];
    const pj = polygon[j];
    const intersects = (
      (pi.y > point.y) !== (pj.y > point.y) &&
      point.x < ((pj.x - pi.x) * (point.y - pi.y)) / ((pj.y - pi.y) || 1e-9) + pi.x
    );
    if (intersects) inside = !inside;
  }
  return inside;
}

export function normalizeRegionShapePoints(shape) {
  const raw = Array.isArray(shape) ? shape : (Array.isArray(shape?.points) ? shape.points : []);
  if (!raw.length) return [];
  if (typeof raw[0] === "number") {
    const out = [];
    for (let i = 0; i + 1 < raw.length; i += 2) {
      const x = Number(raw[i]);
      const y = Number(raw[i + 1]);
      if (Number.isFinite(x) && Number.isFinite(y)) out.push({ x, y });
    }
    return out;
  }
  return raw
    .map((point) => ({ x: Number(point?.x), y: Number(point?.y) }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

export function normalizeRegionShapeContours(shape) {
  const data = regionShapeToObject(shape);
  if (!data) return [];
  const rawPoints = Array.isArray(data.points) ? data.points : [];
  const pointsAreContours = Array.isArray(rawPoints[0]) || Array.isArray(rawPoints[0]?.points);
  const objectContourKeys = ["contour", "vertices", "polygon"];
  const rawContours = Array.isArray(data.contours)
    ? data.contours
    : (pointsAreContours
      ? rawPoints
      : (Array.isArray(data.holes) ? [data.points, ...data.holes] : []));
  const contours = rawContours
    .map((contour) => {
      for (const key of objectContourKeys) {
        if (Array.isArray(contour?.[key])) return normalizeRegionShapePoints(contour[key]);
      }
      return normalizeRegionShapePoints(Array.isArray(contour?.points) ? contour.points : contour);
    })
    .filter((contour) => contour.length >= 3);
  if (contours.length) return contours;
  const points = normalizeRegionShapePoints(data);
  return points.length >= 3 ? [points] : [];
}

export function regionShapeToObject(shape) {
  if (!shape) return null;
  if (typeof shape.toObject === "function") {
    try {
      return shape.toObject();
    } catch (_err) {
      try {
        return shape.toObject(false);
      } catch (_err2) {
        // Fall through to the original object.
      }
    }
  }
  return shape;
}

export function isRegionShapeHole(shape) {
  const data = regionShapeToObject(shape);
  const op = String(data?.operation ?? data?.op ?? data?.mode ?? "").trim().toLowerCase();
  return data?.hole === true
    || data?.isHole === true
    || data?.negative === true
    || data?.positive === false
    || op === "subtract"
    || op === "hole"
    || op === "difference";
}

export function regionShapeBounds(shape) {
  const data = regionShapeToObject(shape);
  if (!data) return null;
  const type = String(data.type ?? data.shape ?? data.kind ?? "").toLowerCase();
  if (type === "polygon" || Array.isArray(data.points)) {
    const contours = normalizeRegionShapeContours(data);
    return pointsBounds(contours.flat());
  }
  if (type === "rectangle" || type === "rect" || type === "ellipse" || type === "oval" || type === "circle") {
    const bounds = normalizeRectBounds(data);
    if (!bounds) return null;
    return {
      minX: bounds.minX,
      minY: bounds.minY,
      maxX: bounds.maxX,
      maxY: bounds.maxY,
      width: bounds.maxX - bounds.minX,
      height: bounds.maxY - bounds.minY,
    };
  }
  return null;
}

export function readShapeNumber(shape, names, fallback = NaN) {
  for (const name of names) {
    const value = Number(shape?.[name]);
    if (Number.isFinite(value)) return value;
  }
  return fallback;
}

export function normalizeRectBounds(shape) {
  const bounds = shape?.bounds ?? {};
  const x1 = readShapeNumber(shape, ["x1", "left", "minX"], readShapeNumber(bounds, ["x", "left", "minX"]));
  const y1 = readShapeNumber(shape, ["y1", "top", "minY"], readShapeNumber(bounds, ["y", "top", "minY"]));
  const x = readShapeNumber(shape, ["x"], x1);
  const y = readShapeNumber(shape, ["y"], y1);
  const width = readShapeNumber(shape, ["width", "w"], readShapeNumber(bounds, ["width", "w"]));
  const height = readShapeNumber(shape, ["height", "h"], readShapeNumber(bounds, ["height", "h"]));
  const x2 = readShapeNumber(shape, ["x2", "right", "maxX"], Number.isFinite(width) ? x + width : NaN);
  const y2 = readShapeNumber(shape, ["y2", "bottom", "maxY"], Number.isFinite(height) ? y + height : NaN);
  if (![x, y, x2, y2].every(Number.isFinite)) return null;
  return {
    minX: Math.min(x, x2),
    minY: Math.min(y, y2),
    maxX: Math.max(x, x2),
    maxY: Math.max(y, y2),
  };
}

export function pointInRegionShape(point, shape) {
  const data = regionShapeToObject(shape);
  if (!point || !data) return false;
  const type = String(data.type ?? "").toLowerCase();

  if (type === "polygon" || Array.isArray(data.points)) {
    const contours = normalizeRegionShapeContours(data);
    let inside = false;
    for (const contour of contours) {
      if (pointInPolygon(point, contour)) inside = !inside;
    }
    return inside;
  }

  if (type === "rectangle" || type === "rect") {
    const bounds = normalizeRectBounds(data);
    return Boolean(bounds
      && point.x >= bounds.minX
      && point.x <= bounds.maxX
      && point.y >= bounds.minY
      && point.y <= bounds.maxY);
  }

  if (type === "ellipse" || type === "oval" || type === "circle") {
    const radius = readShapeNumber(data, ["radius", "r"]);
    const radiusX = readShapeNumber(data, ["radiusX", "rx"], radius);
    const radiusY = readShapeNumber(data, ["radiusY", "ry"], radius);
    if (Number.isFinite(radiusX) && Number.isFinite(radiusY) && radiusX > 0 && radiusY > 0) {
      const cx = readShapeNumber(data, ["centerX", "cx"], readShapeNumber(data, ["x"]));
      const cy = readShapeNumber(data, ["centerY", "cy"], readShapeNumber(data, ["y"]));
      if (Number.isFinite(cx) && Number.isFinite(cy)) {
        const nx = (point.x - cx) / radiusX;
        const ny = (point.y - cy) / radiusY;
        return ((nx * nx) + (ny * ny)) <= 1;
      }
    }

    const bounds = normalizeRectBounds(data);
    if (!bounds) return false;
    const cx = (bounds.minX + bounds.maxX) * 0.5;
    const cy = (bounds.minY + bounds.maxY) * 0.5;
    const rx = Math.max(0.0001, (bounds.maxX - bounds.minX) * 0.5);
    const ry = Math.max(0.0001, (bounds.maxY - bounds.minY) * 0.5);
    const nx = (point.x - cx) / rx;
    const ny = (point.y - cy) / ry;
    return ((nx * nx) + (ny * ny)) <= 1;
  }

  return false;
}

export function prepareRegionShape(shape) {
  const data = regionShapeToObject(shape);
  if (!data) return null;
  const type = String(data.type ?? data.shape ?? data.kind ?? "").toLowerCase();
  const prepared = {
    data,
    type,
    bounds: regionShapeBounds(data),
    isHole: isRegionShapeHole(data),
    polygon: null,
    contours: null,
    rectBounds: null,
  };

  if (type === "polygon" || Array.isArray(data.points)) {
    prepared.contours = normalizeRegionShapeContours(data);
    prepared.polygon = prepared.contours[0] ?? null;
    if (!prepared.polygon || prepared.polygon.length < 3) return null;
    prepared.bounds = prepared.bounds ?? pointsBounds(prepared.contours.flat());
  } else if (type === "rectangle" || type === "rect" || type === "ellipse" || type === "oval" || type === "circle") {
    prepared.rectBounds = normalizeRectBounds(data);
    if (!prepared.rectBounds) return null;
    prepared.bounds = prepared.bounds ?? {
      minX: prepared.rectBounds.minX,
      minY: prepared.rectBounds.minY,
      maxX: prepared.rectBounds.maxX,
      maxY: prepared.rectBounds.maxY,
      width: prepared.rectBounds.maxX - prepared.rectBounds.minX,
      height: prepared.rectBounds.maxY - prepared.rectBounds.minY,
    };
  } else {
    return null;
  }

  return prepared.bounds ? prepared : null;
}

export function pointInPreparedRegionShape(point, prepared) {
  if (!point || !prepared) return false;
  const bounds = prepared.bounds;
  if (bounds && (point.x < bounds.minX || point.x > bounds.maxX || point.y < bounds.minY || point.y > bounds.maxY)) return false;
  if (prepared.contours?.length) {
    let inside = false;
    for (const contour of prepared.contours) {
      if (pointInPolygon(point, contour)) inside = !inside;
    }
    return inside;
  }
  if (prepared.polygon) return pointInPolygon(point, prepared.polygon);

  const data = prepared.data;
  const type = prepared.type;
  if (type === "rectangle" || type === "rect") {
    const bounds = prepared.rectBounds;
    return Boolean(bounds
      && point.x >= bounds.minX
      && point.x <= bounds.maxX
      && point.y >= bounds.minY
      && point.y <= bounds.maxY);
  }

  if (type === "ellipse" || type === "oval" || type === "circle") {
    const radius = readShapeNumber(data, ["radius", "r"]);
    const radiusX = readShapeNumber(data, ["radiusX", "rx"], radius);
    const radiusY = readShapeNumber(data, ["radiusY", "ry"], radius);
    if (Number.isFinite(radiusX) && Number.isFinite(radiusY) && radiusX > 0 && radiusY > 0) {
      const cx = readShapeNumber(data, ["centerX", "cx"], readShapeNumber(data, ["x"]));
      const cy = readShapeNumber(data, ["centerY", "cy"], readShapeNumber(data, ["y"]));
      if (Number.isFinite(cx) && Number.isFinite(cy)) {
        const nx = (point.x - cx) / radiusX;
        const ny = (point.y - cy) / radiusY;
        return ((nx * nx) + (ny * ny)) <= 1;
      }
    }

    const bounds = prepared.rectBounds;
    if (!bounds) return false;
    const cx = (bounds.minX + bounds.maxX) * 0.5;
    const cy = (bounds.minY + bounds.maxY) * 0.5;
    const rx = Math.max(0.0001, (bounds.maxX - bounds.minX) * 0.5);
    const ry = Math.max(0.0001, (bounds.maxY - bounds.minY) * 0.5);
    const nx = (point.x - cx) / rx;
    const ny = (point.y - cy) / ry;
    return ((nx * nx) + (ny * ny)) <= 1;
  }

  return false;
}
