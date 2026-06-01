const maskRuntimeState = new WeakMap();

export function getMaskRuntimeState(maskData) {
  if (!maskData || typeof maskData !== "object") return null;
  let state = maskRuntimeState.get(maskData);
  if (!state) {
    state = {
      morphCache: null,
      geometryCache: null,
      distanceCache: null,
      revision: 0,
      lastDistanceCacheHit: false,
      lastMorphFastPath: false,
      lastChangedBounds: null,
    };
    maskRuntimeState.set(maskData, state);
  }
  return state;
}

export function clearMaskDerivedState(maskData) {
  const state = getMaskRuntimeState(maskData);
  if (!state) return;
  state.morphCache = null;
  state.geometryCache = null;
  state.distanceCache = null;
  state.revision = (state.revision ?? 0) + 1;
}

export function getMaskRevision(maskData) {
  return getMaskRuntimeState(maskData)?.revision ?? 0;
}

export function getMorphCache(maskData) {
  return getMaskRuntimeState(maskData)?.morphCache ?? null;
}

export function setMorphCache(maskData, cache) {
  const state = getMaskRuntimeState(maskData);
  if (state) state.morphCache = cache ?? null;
}

export function getGeometryCache(maskData) {
  return getMaskRuntimeState(maskData)?.geometryCache ?? null;
}

export function setGeometryCache(maskData, cache) {
  const state = getMaskRuntimeState(maskData);
  if (state) state.geometryCache = cache ?? null;
}

export function getDistanceCache(maskData) {
  return getMaskRuntimeState(maskData)?.distanceCache ?? null;
}

export function setDistanceCache(maskData, cache) {
  const state = getMaskRuntimeState(maskData);
  if (state) state.distanceCache = cache ?? null;
}

export function setMorphTiming(maskData, { distanceCacheHit = false, morphFastPath = false } = {}) {
  const state = getMaskRuntimeState(maskData);
  if (!state) return;
  state.lastDistanceCacheHit = distanceCacheHit === true;
  state.lastMorphFastPath = morphFastPath === true;
}

export function getMorphTiming(maskData) {
  const state = getMaskRuntimeState(maskData);
  return {
    distanceCacheHit: state?.lastDistanceCacheHit === true,
    morphFastPath: state?.lastMorphFastPath === true,
  };
}

export function getLastChangedBounds(maskData) {
  return getMaskRuntimeState(maskData)?.lastChangedBounds ?? null;
}

export function setLastChangedBounds(maskData, bounds) {
  const state = getMaskRuntimeState(maskData);
  if (state) state.lastChangedBounds = bounds ?? null;
}
