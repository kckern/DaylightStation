/** Semantic fitness-facing projection over configured content sources. */
export class FitnessContentService {
  constructor({ fitnessConfigService, userHydrator, contentAccessAvailable = true, contentCatalog }) {
    this.fitnessConfigService = fitnessConfigService;
    this.userHydrator = userHydrator;
    this.contentAccessAvailable = contentAccessAvailable;
    this.contentCatalog = contentCatalog;
  }

  async getConfig(householdId) {
    const raw = this.fitnessConfigService?.getPublicConfig(householdId);
    if (!raw) return null;
    const config = this.userHydrator.hydrateConfig(raw);
    config._household = householdId;
    await this.contentCatalog?.enrichConfiguredPlaylists?.(config);
    return config;
  }

  async getGovernedContent(householdId, limit) {
    if (!this.contentAccessAvailable) return { kind: 'registry_unconfigured' };
    const config = this.fitnessConfigService?.getNormalizedConfig(householdId);
    if (!config) return { kind: 'config_not_found' };
    const { governedLabels, governedTypes } = config;
    if (!governedLabels || governedLabels.length === 0) {
      return {
        kind: 'found',
        body: { items: [], governanceConfig: { labels: [], types: governedTypes }, message: 'No governed labels configured' },
      };
    }
    if (!this.contentCatalog) return { kind: 'adapter_unconfigured' };
    const items = await this.contentCatalog.getGovernedItems(governedLabels, { types: governedTypes, limit });
    return {
      kind: 'found',
      body: { items, governanceConfig: { labels: governedLabels, types: governedTypes }, total: items.length },
    };
  }

  async getShow(id) {
    if (!this.contentAccessAvailable) return { kind: 'registry_unconfigured' };
    if (!this.contentCatalog) return { kind: 'adapter_unconfigured' };
    const compoundId = this.contentCatalog.canonicalize(id).contentId;
    const item = await this.contentCatalog.getItem(compoundId);
    if (!item) return { kind: 'not_found' };
    const info = await this.contentCatalog.getContainerInfo(compoundId);
    return { kind: 'found', compoundId, item, info };
  }
}

export default FitnessContentService;
