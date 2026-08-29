/** Resolve the media surface config across the legacy key migration. */
export class MediaSurfaceConfigService {
  constructor({ loadAppConfig } = {}) { this.loadAppConfig = loadAppConfig; }

  get(householdId = undefined) {
    const surfaceApp = this.loadAppConfig(householdId, 'media-app') || {};
    const legacyApp = this.loadAppConfig(householdId, 'media') || {};
    const appConfig = (surfaceApp.browse || surfaceApp.searchScopes) ? surfaceApp : legacyApp;
    return {
      browse: appConfig.browse || [],
      searchScopes: appConfig.searchScopes || [],
    };
  }
}

export default MediaSurfaceConfigService;
