import {
  LEGACY_REGION_SHADER_BEHAVIOR_TYPE,
  REGION_SHADER_BEHAVIOR_TYPE,
} from "./region-painter-constants.js";
import { toFiniteNumber } from "./region-painter-utils.js";

export function getSceneBackgroundPath(scene) {
  return String(
    scene?.background?.src ??
      scene?.background?.source ??
      scene?.img ??
      "",
  ).trim();
}

export function getSceneImageMapping(imgW, imgH) {
  const dims = canvas?.dimensions ?? {};
  return {
    sceneX: toFiniteNumber(dims.sceneX, 0),
    sceneY: toFiniteNumber(dims.sceneY, 0),
    sceneWidth: Math.max(1, toFiniteNumber(dims.sceneWidth, imgW)),
    sceneHeight: Math.max(1, toFiniteNumber(dims.sceneHeight, imgH)),
  };
}

export function sceneToImagePoint(sceneX, sceneY, imgW, imgH) {
  const map = getSceneImageMapping(imgW, imgH);
  return {
    x: Math.round(((sceneX - map.sceneX) / map.sceneWidth) * imgW),
    y: Math.round(((sceneY - map.sceneY) / map.sceneHeight) * imgH),
  };
}

export function imageGridPointToScene(x, y, gridStep, imgW, imgH) {
  const map = getSceneImageMapping(imgW, imgH);
  const scaleX = map.sceneWidth / imgW;
  const scaleY = map.sceneHeight / imgH;
  return {
    x: Math.round(map.sceneX + x * gridStep * scaleX),
    y: Math.round(map.sceneY + y * gridStep * scaleY),
  };
}

export function getPointerWorldPoint(event) {
  const global = event?.data?.global ?? event?.global;
  if (!global || !canvas?.stage?.toLocal) return null;
  const p = canvas.stage.toLocal(global);
  return { x: p.x, y: p.y };
}

export function getDomPointerWorldPoint(event) {
  if (!event || !canvas?.stage?.toLocal) return null;
  const point = new PIXI.Point();
  const renderer = canvas?.app?.renderer;
  try {
    if (typeof renderer?.events?.mapPositionToPoint === "function") {
      renderer.events.mapPositionToPoint(point, event.clientX, event.clientY);
    } else if (typeof renderer?.plugins?.interaction?.mapPositionToPoint === "function") {
      renderer.plugins.interaction.mapPositionToPoint(point, event.clientX, event.clientY);
    } else {
      const view = canvas?.app?.view ?? renderer?.view;
      const rect = view?.getBoundingClientRect?.();
      if (!rect) return null;
      const width = Number(view.width) || rect.width || 1;
      const height = Number(view.height) || rect.height || 1;
      point.x = (event.clientX - rect.left) * (width / Math.max(1, rect.width));
      point.y = (event.clientY - rect.top) * (height / Math.max(1, rect.height));
    }
    const p = canvas.stage.toLocal(point);
    return { x: p.x, y: p.y };
  } catch (_err) {
    return null;
  }
}

export function getWorldHitRadius(screenPx = 14) {
  const scale = Math.max(
    0.0001,
    Math.abs(Number(canvas?.stage?.scale?.x) || Number(canvas?.app?.stage?.scale?.x) || 1),
  );
  return screenPx / scale;
}

export function isPrimaryPointerEvent(event) {
  const original = event?.data?.originalEvent ?? event?.nativeEvent ?? event;
  const button = Number(original?.button ?? event?.button ?? 0);
  if (Number.isFinite(button) && button !== 0) return false;
  const buttons = Number(original?.buttons ?? event?.buttons ?? 1);
  if (Number.isFinite(buttons) && buttons > 0 && (buttons & 1) !== 1) return false;
  return true;
}

export function isPrimaryDomPointerEvent(event) {
  const button = Number(event?.button ?? 0);
  if (Number.isFinite(button) && button !== 0) return false;
  const buttons = Number(event?.buttons ?? 1);
  if (Number.isFinite(buttons) && buttons > 0 && (buttons & 1) !== 1) return false;
  return true;
}

export function consumePaintPointerEvent(event) {
  try {
    event?.preventDefault?.();
    event?.stopImmediatePropagation?.();
    event?.stopPropagation?.();
    const original = event?.data?.originalEvent ?? event?.nativeEvent ?? event;
    original?.preventDefault?.();
    original?.stopImmediatePropagation?.();
    original?.stopPropagation?.();
  } catch (_err) {
    // Non-fatal.
  }
}

export function getPreviewLayer() {
  return canvas?.interface?.primary ?? canvas?.interface ?? canvas?.stage ?? null;
}

export function suppressRegionLayerInteraction() {
  const layer = canvas?.regions ?? null;
  if (!layer) return null;
  const saved = {
    eventMode: layer.eventMode,
    interactive: layer.interactive,
    interactiveChildren: layer.interactiveChildren,
  };
  try {
    layer.eventMode = "none";
    layer.interactive = false;
    layer.interactiveChildren = false;
  } catch (_err) {
    // Non-fatal.
  }
  return () => {
    try {
      if (saved.eventMode !== undefined) layer.eventMode = saved.eventMode;
      if (saved.interactive !== undefined) layer.interactive = saved.interactive;
      if (saved.interactiveChildren !== undefined) layer.interactiveChildren = saved.interactiveChildren;
    } catch (_err) {
      // Non-fatal.
    }
  };
}

export function suppressCanvasDragSelection() {
  const layers = [
    canvas?.activeLayer,
    canvas?.regions,
    canvas?.tokens,
    canvas?.tiles,
    canvas?.drawings,
    canvas?.walls,
    canvas?.lighting,
    canvas?.sounds,
    canvas?.templates,
  ].filter(Boolean);
  const uniqueLayers = Array.from(new Set(layers));
  const dragHandlers = [
    "_onDragLeftStart",
    "_onDragLeftMove",
    "_onDragLeftDrop",
    "_onDragLeftCancel",
    "_onClickLeft",
    "_onClickLeft2",
  ];
  const saved = [];

  for (const layer of uniqueLayers) {
    for (const key of dragHandlers) {
      if (typeof layer?.[key] !== "function") continue;
      saved.push({ layer, key, fn: layer[key] });
      try {
        layer[key] = function suppressPaintSelectionInteraction(event) {
          consumePaintPointerEvent(event);
          return false;
        };
      } catch (_err) {
        // Non-fatal.
      }
    }
  }

  return () => {
    for (const entry of saved) {
      try {
        entry.layer[entry.key] = entry.fn;
      } catch (_err) {
        // Non-fatal.
      }
    }
  };
}

export function setRegionPlaceableVisible(region, visible) {
  const doc = region?.document ?? region;
  const placeable = region?.object ?? doc?.object ?? canvas?.regions?.get?.(doc?.id);
  try {
    if (placeable) {
      placeable.visible = visible === true;
      placeable.renderable = visible === true;
      if (visible !== true) placeable.alpha = 0;
      else if (Number(placeable.alpha) <= 0) placeable.alpha = 1;
    }
  } catch (_err) {
    // Non-fatal.
  }
}

export function collectionToArray(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  if (typeof collection.values === "function") return Array.from(collection.values());
  return [];
}

export function getRegionId(region) {
  return String(region?.id ?? region?._id ?? region?.document?.id ?? region?.document?._id ?? "");
}

export function isIndyFxRegionBehavior(behavior) {
  const type = String(behavior?.type ?? "").trim();
  return type === REGION_SHADER_BEHAVIOR_TYPE || type === LEGACY_REGION_SHADER_BEHAVIOR_TYPE;
}
