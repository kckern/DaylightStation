import { IMediaSourceCatalog } from '#apps/admin/ports/IMediaSourceCatalog.mjs';

export class ConfigMediaSourceCatalog extends IMediaSourceCatalog {
  #loadFile;
  constructor({ loadFile }) { super(); this.#loadFile = loadFile; }
  async list() {
    const raw = await this.#loadFile('media/sources');
    if (!Array.isArray(raw)) return raw;
    return raw.map((source) => ({
      provider: source.shortcode,
      description: source.description,
      type: source.type?.toLowerCase() === 'channel' ? 'channel' : 'playlist',
      id: source.playlist,
      folder: source.folder,
      sourceRef: Object.freeze({
        platform: source.src || 'youtube',
        collectionType: source.type?.toLowerCase() === 'channel' ? 'channel' : 'playlist',
        locator: source.playlist,
      }),
    }));
  }
}
