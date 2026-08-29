/** Reads and normalizes the household's configured top-level Browse entries. */
export class BrowseCatalogService {
  constructor({ loadMediaConfig }) { this.loadMediaConfig = loadMediaConfig; }
  getEntries() {
    const browse = this.loadMediaConfig?.()?.browse;
    return Array.isArray(browse) ? browse.filter((entry) => entry?.source) : [];
  }
}
export default BrowseCatalogService;
