import {
  DEFAULT_WATER_OPTIONS,
  GRID_STEP_DEBOUNCE_SETTING,
  INPUT_DEBOUNCE_SETTING,
  MAX_FILL_BRIDGE_PX,
  RANGE_DEBOUNCE_SETTING,
} from "./region-painter-constants.js";
import { renderPaintDialogContent } from "./region-painter-dialog.js";
import {
  normalizeHexColor,
  normalizeBorderSmoothType,
  normalizeHslFillBias,
  normalizeOptions,
  normalizePaintOpacity,
} from "./region-painter-options.js";
import {
  debugUiDisplayStyle,
  getStoredPaintHelpOpen,
  localizeText,
  paintHelpDisplayStyle,
  setStoredPaintHelpOpen,
} from "./region-painter-utils.js";

function getDebounceSetting(moduleId, setting, fallback) {
  try {
    const value = Number(game?.settings?.get?.(moduleId, setting));
    if (Number.isFinite(value)) return Math.max(0, Math.round(value));
  } catch (_err) {
    // Fall back when settings are unavailable during tests or early startup.
  }
  return fallback;
}

export async function renderPaintSessionDialog(session, {
  moduleId = "indy-regions",
  getActiveSession = null,
  readOptions = null,
  refreshCandidate = null,
  resetMaskResolution = null,
  drawBrush = null,
  updateStatus = null,
  undo = null,
  redo = null,
  saveMaskFlag = null,
  endSession = null,
  candidateShapesToRegionData = null,
  buildDocumentAppearance = null,
  paintRegionDefaultName = "Painted Region",
} = {}) {
  const opts = normalizeOptions(session.options);
  const debugStyle = debugUiDisplayStyle(moduleId);
  const helpStyle = paintHelpDisplayStyle(moduleId);
  const helpOpenAttr = getStoredPaintHelpOpen(moduleId) ? " open" : "";
  const t = (key, fallback) => localizeText(moduleId, key, fallback);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[char]);
  const borderSmoothType = normalizeBorderSmoothType(opts.borderSmoothType);
  const borderSmoothTypeChoices = [
    ["catmull", t("Dialog.BorderSmoothType.Catmull", "Catmull-Rom")],
    ["rounded", t("Dialog.BorderSmoothType.Rounded", "Rounded")],
    ["relaxed", t("Dialog.BorderSmoothType.Relaxed", "Relaxed")],
  ];
  const content = await renderPaintDialogContent({
    helpOpenAttr,
    helpStyle,
    debugStyle,
    maxFillBridgePx: MAX_FILL_BRIDGE_PX,
    help: {
      title: t("Dialog.Help.Title", "Help"),
      shiftDrag: t("Dialog.Help.ShiftDrag", "Shift-drag erases painted cells."),
      ctrlClick: t("Dialog.Help.CtrlClick", "Ctrl-click HSL-fills from the clicked colour."),
      ctrlShiftClick: t("Dialog.Help.CtrlShiftClick", "Ctrl-Shift-click HSL-erases from the clicked colour."),
      altClick: t("Dialog.Help.AltClick", "Alt-click fills the clicked source region shape."),
      shiftAltClick: t("Dialog.Help.ShiftAltClick", "Shift-Alt-click erases the clicked source region shape."),
      ctrlWheel: t("Dialog.Help.CtrlWheel", "Ctrl-wheel changes brush size."),
    },
    labels: {
      status: t("Dialog.Label.Status", "Status"),
      history: t("Dialog.Label.History", "History"),
      penColour: t("Dialog.Label.PenColour", "Pen Colour"),
      paintOpacity: t("Dialog.Label.PaintOpacity", "Paint Opacity"),
      brushSize: t("Dialog.Label.BrushSize", "Brush Size"),
      fillTolerance: t("Dialog.Label.FillTolerance", "Fill Tolerance"),
      hslFillBias: t("Dialog.Label.HslFillBias", "HSL Fill Bias"),
      hue: t("Dialog.Label.Hue", "Hue"),
      lightness: t("Dialog.Label.Lightness", "Lightness"),
      fillBridge: t("Dialog.Label.FillBridge", "Fill Bridge"),
      fillHoles: t("Dialog.Label.FillHoles", "Fill Holes"),
      gridStep: t("Dialog.Label.GridStep", "Grid Step"),
      shrinkGrow: t("Dialog.Label.ShrinkGrow", "Shrink / Grow"),
      borderSmooth: t("Dialog.Label.BorderSmooth", "Border Smooth"),
      borderSmoothType: t("Dialog.Label.BorderSmoothType", "Border Smooth Type"),
      borderThickness: t("Dialog.Label.BorderThickness", "Border Thickness"),
    },
    status: {
      paint: t("Dialog.Status.Paint", "Paint on the canvas to add to the region. Shift-left mouse subtracts."),
    },
    buttons: {
      undo: t("Dialog.Button.Undo", "Undo"),
      redo: t("Dialog.Button.Redo", "Redo"),
    },
    hints: {
      paintOpacity: t("Dialog.Hint.PaintOpacity", "0 transparent, 1 opaque."),
      brushSize: t("Dialog.Hint.BrushSize", "Brush diameter in pixels. Ctrl-wheel also changes this."),
      fillTolerance: t("Dialog.Hint.FillTolerance", "Lower is stricter, higher fills more similar colours."),
      hslFillBias: t("Dialog.Hint.HslFillBias", "-1 favors lightness, 0 balanced, 1 favors hue."),
      fillBridge: t("Dialog.Hint.FillBridge", "0 is strict; higher values cross small gaps."),
      fillHoles: t("Dialog.Hint.FillHoles", "Fill internal holes when calculating the final Region boundary."),
      gridStep: t("Dialog.Hint.GridStep", "1 is most precise; higher values are faster but coarser."),
      shrinkGrow: t("Dialog.Hint.ShrinkGrow", "Negative shrinks, positive grows the final boundary."),
      borderSmooth: t("Dialog.Hint.BorderSmooth", "0 keeps detail; higher values simplify jagged edges."),
      borderSmoothType: t("Dialog.Hint.BorderSmoothType", "Choose how the traced boundary is smoothed after mask processing."),
      borderThickness: t("Dialog.Hint.BorderThickness", "0 hides live borders; thicker values make them easier to see."),
    },
    values: {
      paintColor: normalizeHexColor(opts.paintColor, DEFAULT_WATER_OPTIONS.paintColor),
      paintOpacity: normalizePaintOpacity(opts.paintOpacity),
      brushSizePx: opts.brushSizePx,
      tolerance: opts.tolerance,
      hslFillBias: normalizeHslFillBias(opts.hslFillBias),
      fillBridgePx: opts.fillBridgePx,
      fillHoles: opts.fillHoles === true ? "checked" : "",
      gridStep: opts.gridStep,
      featherShrinkPx: opts.featherShrinkPx,
      smoothing: opts.smoothing,
      borderSmoothType,
      paintBorderThickness: opts.paintBorderThickness,
    },
    borderSmoothTypeOptions: borderSmoothTypeChoices
      .map(([value, label]) => `<option value="${escapeHtml(value)}"${value === borderSmoothType ? " selected" : ""}>${escapeHtml(label)}</option>`)
      .join(""),
  });
  if (getActiveSession?.() !== session) return;

  const dialog = new foundry.applications.api.DialogV2({
    classes: ["indy-regions-paint-window"],
    window: {
      title: t("Dialog.Title.PaintRegion", "Paint Region"),
      icon: "fas fa-paintbrush",
    },
    content,
    buttons: [
      {
        action: "create",
        label: session.targetRegion ? t("Dialog.Button.UpdateRegion", "Update Region") : t("Dialog.Button.CreateRegion", "Create Region"),
        icon: "fas fa-check",
        default: true,
        callback: async () => {
          await refreshCandidate?.(session, { forceCandidate: true });
          if (!session.candidate) {
            ui?.notifications?.warn?.(t("Notifications.PaintAreaFirst", "Indy Regions | Paint an area first."));
            return false;
          }
          const nextOptions = readOptions?.(session) ?? normalizeOptions(session.options);
          const shapes = candidateShapesToRegionData?.(session.candidate) ?? [];
          let region = session.targetRegion ?? null;
          if (session.targetRegion?.update) {
            await session.targetRegion.update({ shapes });
            region = session.targetRegion;
          } else if (region?.update) {
            await region.update({ shapes });
          } else {
            const scene = canvas?.scene ?? null;
            const created = await scene?.createEmbeddedDocuments?.("Region", [{
              name: paintRegionDefaultName,
              ...(buildDocumentAppearance?.(nextOptions) ?? {
                color: normalizeHexColor(nextOptions.paintColor, DEFAULT_WATER_OPTIONS.paintColor),
              }),
              shapes,
            }]);
            region = created?.[0] ?? null;
          }
          if (region) {
            await saveMaskFlag?.(region, session, nextOptions);
          }
          endSession?.({ keepRegion: true });
          return true;
        },
      },
      {
        action: "cancel",
        label: t("Dialog.Button.Cancel", "Cancel"),
        icon: "fas fa-times",
        callback: () => endSession?.({ notify: false }),
      },
    ],
    close: () => endSession?.({ notify: false }),
  });
  session.dialog = dialog;
  const originalClose = typeof dialog.close === "function" ? dialog.close.bind(dialog) : null;
  if (originalClose) {
    dialog.close = async (...args) => {
      if (session.closingFromEndSession !== true && getActiveSession?.() === session) {
        endSession?.({ notify: false, closeDialog: false });
      }
      return originalClose(...args);
    };
  }
  void dialog.render(true).then(() => {
    if (session.closed === true) return;
    const root = dialog.element instanceof Element
      ? dialog.element
      : (dialog.element?.[0] instanceof Element ? dialog.element[0] : null);
    session.root = root?.querySelector?.(".indy-regions-paint-dialog") ?? root;
    if (!session.root) return;
    const helpDetails = session.root.querySelector("[data-paint-help]");
    if (helpDetails instanceof HTMLDetailsElement) {
      session.addDomListener(helpDetails, "toggle", () => {
        setStoredPaintHelpOpen(moduleId, helpDetails.open === true);
      });
    }
    const onInput = (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLSelectElement)) return;
      const peers = session.root.querySelectorAll(`[name="${input.name}"]`);
      for (const peer of peers) {
        if (peer === input || (!(peer instanceof HTMLInputElement) && !(peer instanceof HTMLSelectElement))) continue;
        if (peer instanceof HTMLInputElement && peer.type === "checkbox" && input instanceof HTMLInputElement) peer.checked = input.checked;
        else peer.value = input.value;
      }
      readOptions?.(session);
      if (input.name === "brushSizePx" && session.lastBrushPoint) {
        drawBrush?.(session, session.lastBrushPoint, session.paintMode ?? "add");
      }
      if (["gridStep", "smoothing", "borderSmoothType", "featherShrinkPx", "paintBorderThickness", "paintOpacity", "debug", "paintColor", "fillHoles"].includes(input.name)) {
        if (input.name === "gridStep") {
          if (session.gridStepUpdateTimer) clearTimeout(session.gridStepUpdateTimer);
          session.gridStepUpdateTimer = setTimeout(() => {
            session.gridStepUpdateTimer = null;
            void resetMaskResolution?.(session);
          }, getDebounceSetting(moduleId, GRID_STEP_DEBOUNCE_SETTING, 180));
        } else if (["smoothing", "borderSmoothType", "featherShrinkPx", "fillHoles"].includes(input.name)) {
          if (session.paintOptionsUpdateTimer) clearTimeout(session.paintOptionsUpdateTimer);
          session.paintOptionsUpdateTimer = setTimeout(() => {
            session.paintOptionsUpdateTimer = null;
            void refreshCandidate?.(session);
          }, input.type === "range"
            ? getDebounceSetting(moduleId, RANGE_DEBOUNCE_SETTING, 220)
            : getDebounceSetting(moduleId, INPUT_DEBOUNCE_SETTING, 80));
        } else {
          void refreshCandidate?.(session);
        }
      }
    };
    session.addDomListener(session.root, "click", (event) => {
      const button = event.target?.closest?.("[data-paint-action]");
      if (!(button instanceof HTMLButtonElement)) return;
      event.preventDefault();
      const action = button.dataset.paintAction;
      if (action === "undo") undo?.(session);
      if (action === "redo") redo?.(session);
    });
    session.addDomListener(session.root, "input", onInput);
    session.addDomListener(session.root, "change", onInput);
    updateStatus?.(session);
  });
}
