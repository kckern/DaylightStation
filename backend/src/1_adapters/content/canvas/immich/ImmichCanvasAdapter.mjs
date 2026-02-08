// backend/src/1_adapters/content/canvas/immich/ImmichCanvasAdapter.mjs
import { DisplayableItem } from '#domains/content/capabilities/Displayable.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

export class ImmichCanvasAdapter {
  #client;
  #library;
  #proxyPath;

  constructor(config, deps = {}) {
    if (!deps.client) {
      throw new InfrastructureError('ImmichCanvasAdapter requires client', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'client',
      });
    }

    this.#client = deps.client;
    this.#library = config.library || 'art';
    this.#proxyPath = config.proxyPath || '/api/v1/proxy/immich-canvas';
  }

  get source() {
    return 'canvas-immich';
  }

  get prefixes() {
    return [{ prefix: 'canvas-immich' }];
  }

  async list(filters = {}) {
    if (filters.albumId) {
      const album = await this.#client.getAlbum(filters.albumId);
      return this.#albumToItems(album);
    }

    const albums = await this.#client.getAlbums();
    const items = [];

    for (const album of albums) {
      if (filters.categories?.length > 0 && !filters.categories.includes(album.albumName)) {
        continue;
      }

      const fullAlbum = await this.#client.getAlbum(album.id);
      items.push(...this.#albumToItems(fullAlbum));
    }

    return items;
  }

  async getItem(id) {
    const assetId = id.replace(/^canvas-immich:/, '');

    try {
      const asset = await this.#client.getAsset(assetId);
      if (!asset) return null;

      return this.#assetToItem(asset, null);
    } catch {
      return null;
    }
  }

  #albumToItems(album) {
    return (album.assets || [])
      .filter(asset => asset.type === 'IMAGE')
      .map(asset => this.#assetToItem(asset, album.albumName));
  }

  #assetToItem(asset, category) {
    const exif = asset.exifInfo || {};

    return new DisplayableItem({
      id: `canvas-immich:${asset.id}`,
      source: this.source,
      title: this.#titleFromFilename(asset.originalFileName),
      imageUrl: `${this.#proxyPath}/assets/${asset.id}/original`,
      thumbnail: `${this.#proxyPath}/assets/${asset.id}/thumbnail`,
      category,
      artist: exif.Artist || null,
      year: this.#parseYear(exif.DateTimeOriginal),
      tags: [],
      frameStyle: 'classic',
      width: asset.width,
      height: asset.height,
    });
  }

  #parseYear(dateString) {
    if (!dateString) return null;
    const match = String(dateString).match(/^(\d{4})/);
    return match ? parseInt(match[1], 10) : null;
  }

  #titleFromFilename(filename) {
    if (!filename) return 'Untitled';
    return filename
      .replace(/\.[^.]+$/, '')
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  /**
   * Canvas items are standalone display art — no meaningful sibling navigation.
   * @param {string} _compoundId
   * @returns {Promise<null>}
   */
  async resolveSiblings(_compoundId) {
    return null;
  }
}

export default ImmichCanvasAdapter;
