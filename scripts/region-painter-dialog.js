export const PAINT_DIALOG_TEMPLATE = "modules/indy-regions/templates/region-paint-dialog.html";

export async function renderPaintDialogContent(data) {
  const renderer = globalThis.foundry?.applications?.handlebars?.renderTemplate ?? globalThis.renderTemplate;
  if (typeof renderer === "function") return renderer(PAINT_DIALOG_TEMPLATE, data);
  throw new Error("Foundry renderTemplate is not available.");
}
