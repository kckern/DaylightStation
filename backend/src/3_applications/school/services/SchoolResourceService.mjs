/** Public School catalog/resource access without exposing concrete sources to HTTP. */
export class SchoolResourceService {
  constructor({
    learnerDirectory = null,
    learningCatalog = null,
    flashcardAssets = null,
    materialProgressStore = null,
    surfaceRegistry = null,
    getScreenConfig = null,
  } = {}) {
    this.learnerDirectory = learnerDirectory;
    this.learningCatalog = learningCatalog;
    this.flashcardAssets = flashcardAssets;
    this.materialProgressStore = materialProgressStore;
    this.surfaceRegistry = surfaceRegistry;
    this.getScreenConfig = getScreenConfig;
  }

  async listLearners() {
    return this.learnerDirectory ? this.learnerDirectory.listLearners() : null;
  }

  async listCatalogs(learnerId) {
    if (!this.learningCatalog) return null;
    return this.learningCatalog.list({ learnerId });
  }

  async getCatalogLesson(address) {
    if (!this.learningCatalog) return null;
    return this.learningCatalog.lesson(address);
  }

  getFlashcardAsset(assetId) {
    return this.flashcardAssets?.get?.(assetId) ?? null;
  }

  recordMaterialProgress({ userId, unitId, percent, playhead, durationMs }) {
    if (!userId || !this.materialProgressStore) return { recorded: false };
    this.materialProgressStore.record({
      userId,
      plexId: unitId,
      percent,
      seconds: playhead,
      duration: durationMs != null ? durationMs / 1000 : undefined,
    });
    return { recorded: true };
  }

  async resolveSurfaceProfile(screen) {
    if (!this.surfaceRegistry) return { kind: 'unresolved', reason: 'surface registry not configured' };
    let surfaceId = 'screen-browser';
    if (screen !== null && screen !== 'browser') {
      if (!this.getScreenConfig) return { kind: 'unresolved', reason: 'screen config lookup not configured' };
      const config = await this.getScreenConfig(screen);
      if (!config) return { kind: 'unresolved', reason: 'screen config not found' };
      if (!config.surfaceProfile) return { kind: 'unresolved', reason: 'screen config has no surfaceProfile key' };
      surfaceId = config.surfaceProfile;
    }
    const profile = this.surfaceRegistry.get(surfaceId);
    return profile
      ? { kind: 'found', profile }
      : { kind: 'unresolved', reason: `unknown surfaceId '${surfaceId}'` };
  }
}

export default SchoolResourceService;
