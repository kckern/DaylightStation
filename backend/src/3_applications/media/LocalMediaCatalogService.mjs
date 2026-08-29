export class LocalMediaCatalogService {
  constructor({ source = null }) { this.source = source; }
  get available() { return Boolean(this.source); }
  async roots() { return this.source ? { kind: 'found', value: await this.source.getRoots() } : { kind: 'unavailable' }; }
  async browse(path) { return this.source ? { kind: 'found', value: await this.source.getList(path) } : { kind: 'unavailable' }; }
  async search(text) { return this.source ? { kind: 'found', value: await this.source.search({ text }) } : { kind: 'unavailable' }; }
  async reindex() {
    if (!this.source) return { kind: 'unavailable' };
    this.source.clearCache(); const roots = await this.source.getRoots(); let files = 0;
    for (const root of roots) { const value = await this.source.getList(root.path); files += Array.isArray(value) ? value.length : value?.children?.length || 0; }
    return { kind: 'completed', roots: roots.length, files };
  }
}
