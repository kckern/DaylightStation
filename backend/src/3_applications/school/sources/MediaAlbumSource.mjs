/** Audio collection → album/work → track/chapter School-material projection. */
const SOURCE = 'media-album';

export class MediaAlbumSource {
  #mediaCatalog;

  constructor({ mediaCatalog } = {}) {
    if (!mediaCatalog) throw new Error('MediaAlbumSource requires mediaCatalog');
    this.#mediaCatalog = mediaCatalog;
  }

  async listMaterials(rootReference) {
    const albums = await this.#mediaCatalog.listChildren(rootReference);
    const first = albums[0] ?? {};
    return [{
      id: this.#mediaCatalog.canonicalId(rootReference),
      title: first.parent?.title ?? null,
      poster: first.parent?.poster ?? first.poster ?? null,
      source: SOURCE,
      medium: 'audio',
      kind: 'collection',
      durationMs: null,
      unitCount: albums.length,
    }];
  }

  async listWorks(rootReference) {
    const albums = await this.#mediaCatalog.listChildren(rootReference);
    return albums.map((album) => ({
      id: album.id,
      title: album.title,
      poster: album.poster ?? null,
      summary: album.summary ?? null,
      source: SOURCE,
      medium: 'audio',
      kind: 'work',
      durationMs: null,
      unitCount: album.childCount ?? null,
    }));
  }

  async getMaterial(materialId) {
    const tracks = await this.#mediaCatalog.listChildren(materialId);
    const units = tracks.map((track, index) => ({
      id: track.id,
      index: track.index ?? index + 1,
      title: track.title,
      durationMs: track.durationMs ?? null,
      group: null,
    }));
    const first = tracks[0] ?? {};
    return {
      id: this.#mediaCatalog.canonicalId(materialId),
      title: first.parent?.title ?? null,
      poster: first.parent?.poster ?? null,
      source: SOURCE,
      medium: 'audio',
      durationMs: units.reduce((sum, unit) => sum + (unit.durationMs ?? 0), 0),
      unitCount: units.length,
      units,
    };
  }
}

export default MediaAlbumSource;
