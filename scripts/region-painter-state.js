export class RegionPainterState {
  constructor({
    moduleId = "indy-regions",
  } = {}) {
    this.moduleId = moduleId;
    this.getShaderChoices = null;
    this.syncRegionShaderFromBehavior = null;
    this.activeSession = null;
    this.startingPaintSession = false;
    this.imageCache = {
      sceneId: "",
      backgroundPath: "",
      imageData: null,
      width: 0,
      height: 0,
    };
  }

  configure({ moduleId = "indy-regions", getShaderChoices = null, syncRegionShaderFromBehavior = null } = {}) {
    this.moduleId = String(moduleId || "indy-regions");
    this.getShaderChoices = typeof getShaderChoices === "function" ? getShaderChoices : null;
    this.syncRegionShaderFromBehavior = typeof syncRegionShaderFromBehavior === "function"
      ? syncRegionShaderFromBehavior
      : null;
  }

  clearImageCache() {
    this.imageCache = {
      sceneId: "",
      backgroundPath: "",
      imageData: null,
      width: 0,
      height: 0,
    };
  }

  hasImageCache(sceneId, backgroundPath) {
    return Boolean(this.imageCache.imageData
      && this.imageCache.sceneId === String(sceneId ?? "")
      && this.imageCache.backgroundPath === String(backgroundPath ?? ""));
  }

  setImageCache({ sceneId = "", backgroundPath = "", imageData = null, width = 0, height = 0 } = {}) {
    this.imageCache = {
      sceneId: String(sceneId ?? ""),
      backgroundPath: String(backgroundPath ?? ""),
      imageData,
      width: Math.max(0, Math.round(Number(width) || 0)),
      height: Math.max(0, Math.round(Number(height) || 0)),
    };
  }

  get cachedImageData() {
    return this.imageCache.imageData;
  }

  get cachedImgW() {
    return this.imageCache.width;
  }

  get cachedImgH() {
    return this.imageCache.height;
  }

  get imageSize() {
    return {
      width: this.imageCache.width,
      height: this.imageCache.height,
    };
  }

  beginStart() {
    if (this.startingPaintSession) return false;
    this.startingPaintSession = true;
    return true;
  }

  endStart() {
    this.startingPaintSession = false;
  }

  setActiveSession(session) {
    this.activeSession = session ?? null;
  }

  clearActiveSession(session = this.activeSession) {
    if (!session || this.activeSession === session) this.activeSession = null;
  }
}
