export class AdminMediaService {
  #catalog; #downloads;
  constructor({ sourceCatalog, mediaDownloadService }) { this.#catalog = sourceCatalog; this.#downloads = mediaDownloadService; }
  async sources() {
    const sources = await this.#catalog.list();
    if (!sources || !Array.isArray(sources)) return { sources: [], count: 0 };
    const formatted = sources.map(({ provider, description, type, id, folder }) => ({
      provider, description, type, id, folder,
    }));
    return { sources: formatted, count: formatted.length };
  }
  async metadata(provider) {
    const sources = await this.#catalog.list();
    if (!sources || !Array.isArray(sources)) return { kind: 'not_configured' };
    const source = sources.find(item => item.provider === provider);
    if (!source) return { kind: 'not_found' };
    const result = await this.#downloads.fetchAndSaveMetadata(source);
    if (!result.ok) return { kind: 'failed', error: result.error };
    return { kind: 'ok', body: { ok: true, provider, title: result.title,
      thumbnailDownloaded: result.thumbnailDownloaded, metadataPath: result.metadataRelPath,
      thumbnailPath: result.thumbnailRelPath } };
  }
  async metadataAll() {
    const sources = await this.#catalog.list();
    if (!sources || !Array.isArray(sources)) return { results: [], count: 0 };
    const { results, total, success } = await this.#downloads.fetchAndSaveMetadataAll(sources);
    return { results, total, success };
  }
}
