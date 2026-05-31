import {
  DEBUG_TIMINGS_SETTING,
  SHOW_PAINT_HELP_SETTING,
} from "./region-painter-constants.js";

export function toFiniteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function nowMs() {
  try {
    if (typeof globalThis.performance?.now === "function") return globalThis.performance.now();
  } catch (_err) {
    // Fall through.
  }
  return Date.now();
}

export function roundTimingMs(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export function isDebugTimingEnabled(moduleId = "indy-regions") {
  try {
    return game?.settings?.get?.(moduleId, DEBUG_TIMINGS_SETTING) === true
      || globalThis.INDY_REGIONS_DEBUG_TIMINGS === true;
  } catch (_err) {
    return globalThis.INDY_REGIONS_DEBUG_TIMINGS === true;
  }
}

export function debugUiDisplayStyle(moduleId = "indy-regions") {
  return isDebugTimingEnabled(moduleId) ? "" : ' style="display:none;"';
}

export function paintHelpDisplayStyle(moduleId = "indy-regions") {
  try {
    return game?.settings?.get?.(moduleId, SHOW_PAINT_HELP_SETTING) !== false
      ? ' style="grid-column: 1 / -1; margin-top: 0;"'
      : ' style="display:none;"';
  } catch (_err) {
    return ' style="grid-column: 1 / -1; margin-top: 0;"';
  }
}

export function getStoredPaintHelpOpen(moduleId = "indy-regions") {
  try {
    return globalThis.localStorage?.getItem?.(`${moduleId}.paintHelpOpen`) === "true";
  } catch (_err) {
    return false;
  }
}

export function setStoredPaintHelpOpen(moduleId = "indy-regions", open = false) {
  try {
    globalThis.localStorage?.setItem?.(`${moduleId}.paintHelpOpen`, open === true ? "true" : "false");
  } catch (_err) {
    // Non-fatal.
  }
}

export function localizeText(moduleId, key, fallback = key) {
  const fullKey = `${moduleId}.${key}`;
  const value = game?.i18n?.localize?.(fullKey);
  return value && value !== fullKey ? value : fallback;
}

export function formatText(moduleId, key, data = {}, fallback = key) {
  const fullKey = `${moduleId}.${key}`;
  const value = game?.i18n?.format?.(fullKey, data);
  if (value && value !== fullKey) return value;
  return String(fallback).replace(/\{([^}]+)\}/g, (_match, name) => data?.[name] ?? "");
}

export function debugTiming(moduleId, label, payload = {}) {
  if (!isDebugTimingEnabled(moduleId)) return;
  try {
    console.debug(`${moduleId} | timing | ${label}`, payload);
  } catch (_err) {
    // Non-fatal.
  }
}
